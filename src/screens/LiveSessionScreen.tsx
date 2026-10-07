import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { UseBleDeviceResult } from '../hooks/useBleDevice';
import { useSessionRecorder } from '../hooks/useSessionRecorder';
import { useSetSummaries } from '../hooks/useSetSummaries';
import { exportSession, shareExportedSession } from '../export/exportSession';
import { analyzeSession, AnalysisResult } from '../analysis/analyzeSession';
import LiveChart, { LiveChartHandle } from '../components/LiveChart';
import RepMarkerButton from '../components/RepMarkerButton';
import SessionControls from '../components/SessionControls';
import StatsBar from '../components/StatsBar';
import ConnectionStatusBadge from '../components/ConnectionStatusBadge';
import ActivationGauge from '../components/ActivationGauge';
import SessionAnalysisPanel from '../components/SessionAnalysisPanel';
import SessionDetailScreen from './SessionDetailScreen';
import WorkoutSummaryScreen from './WorkoutSummaryScreen';
import SessionHistoryScreen from './SessionHistoryScreen';
import DebugHistoryScreen from './DebugHistoryScreen';
import type { SensorRow } from '../types';
import { loadCalibrationHistory } from '../calibration/calibrationStore';
import { computeEffectiveReference, daysSince } from '../calibration/calibrationTrend';
import { loadMaxEffortStatus } from '../calibration/maxEffortStore';
import { computeActivationCeiling, shouldSuggestMaxEffortRetest } from '../calibration/activationCeiling';
import {
  computeRollingHistoricalPeakFromSessionSummaries,
  currentRollingWindow,
  finalizePendingSession,
  mergeRecordingIntoPendingSession,
} from '../calibration/rollingSessionSummary';
import { loadExerciseRollingState, saveExerciseRollingState } from '../calibration/rollingSessionSummaryStore';
import { recomputeWithCeiling } from '../analysis/recomputeActivationCeiling';
import type { DetectedSetSpan } from '../analysis/setPairing';
import { applySummaryVerdicts } from '../analysis/summaryMdf';
import { loadSessionHistory, saveSessionSummary, updateSetUserTag } from '../sessionHistory/sessionHistoryStore';
import type { SessionSummaryRecord, SetSummaryRecord, SetUserTag } from '../sessionHistory/types';
import { buildSessionSummaryRecord } from '../sessionHistory/buildSummary';

interface LiveSessionScreenProps {
  ble: UseBleDeviceResult;
  profileId: string;
  /** Returns to the scan screen (used to give up on a dead/failed connection). */
  onLeave: () => void;
  onStartCalibration: () => void;
  onStartMaxEffortTest: () => void;
}

type AnalysisStatus = 'idle' | 'analyzing' | 'done';

export default function LiveSessionScreen({
  ble,
  profileId,
  onLeave,
  onStartCalibration,
  onStartMaxEffortTest,
}: LiveSessionScreenProps) {
  const recorder = useSessionRecorder();
  const { summaries, addSummary, reset: resetSummaries } = useSetSummaries();
  const summariesRef = useRef(summaries);
  useEffect(() => {
    summariesRef.current = summaries;
  }, [summaries]);
  // Set once Stop's analysis has run on the summary path (the only path now): the
  // detected sets to pair summaries with. Lets a summary that arrives AFTER
  // Stop (the firmware only closes a set ~8 s after the last rep) still be
  // applied -- see the effect below.
  const summaryPathRef = useRef(false);
  const detectedSpansRef = useRef<DetectedSetSpan[] | null>(null);

  const envelopeChartRef = useRef<LiveChartHandle>(null);
  const rollChartRef = useRef<LiveChartHandle>(null);
  const gyroChartRef = useRef<LiveChartHandle>(null);

  const hasSessionData = useRef(false);

  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [showDetailScreen, setShowDetailScreen] = useState(false);
  const [showWorkoutSummaryScreen, setShowWorkoutSummaryScreen] = useState(false);
  const [showHistoryScreen, setShowHistoryScreen] = useState(false);
  const [showDebugHistoryScreen, setShowDebugHistoryScreen] = useState(false);
  /** Every set saved so far in the current workout, across every Start/Stop recording since Start Workout -- see handleSaveToHistory and handleStartWorkout. */
  const [workoutSets, setWorkoutSets] = useState<SetSummaryRecord[]>([]);
  const [historyDecision, setHistoryDecision] = useState<'pending' | 'saved' | 'discarded'>(
    'pending',
  );
  const [setLabels, setSetLabels] = useState<Record<number, string>>({});
  /** Per-set "reached failure / easy" + hand labels entered in Session Details; saved with the set. */
  const [setTags, setSetTags] = useState<Record<number, SetUserTag>>({});
  const setTagsRef = useRef<Record<number, SetUserTag>>({});
  /** Id of this recording's history record once saved, so a label entered after saving can still be written to it. */
  const savedSessionIdRef = useRef<string | null>(null);
  const [exerciseTag, setExerciseTag] = useState('');
  const [description, setDescription] = useState('');

  const [calibrationReference, setCalibrationReference] = useState<number | null>(null);
  const [lastCalibratedAt, setLastCalibratedAt] = useState<number | null>(null);
  const calibrationReferenceRef = useRef<number | null>(null);

  const [maxEffortCapturedAt, setMaxEffortCapturedAt] = useState<number | null>(null);
  const maxEffortReferenceRef = useRef<number | null>(null);
  const sessionHistoryRef = useRef<SessionSummaryRecord[]>([]);
  const [showRetestPrompt, setShowRetestPrompt] = useState(false);
  const [rollingHistoricalPeak, setRollingHistoricalPeak] = useState<number | null>(null);

  const refreshRollingHistoricalPeak = useCallback(() => {
    loadExerciseRollingState(profileId, exerciseTag).then(state => {
      setRollingHistoricalPeak(
        computeRollingHistoricalPeakFromSessionSummaries(currentRollingWindow(state)),
      );
    });
  }, [profileId, exerciseTag]);

  useEffect(() => {
    refreshRollingHistoricalPeak();
  }, [refreshRollingHistoricalPeak]);

  const [workoutActive, setWorkoutActive] = useState(false);

  /**
   * Explicit workout boundary, replacing the old idle-gap guess: sets
   * recorded between Start Workout and End Workout are pooled into one
   * rolling-window entry regardless of how much time passes between them
   * (rest between sets, a break to change plates, etc.) -- named "Workout"
   * rather than "Session" in the UI specifically to avoid colliding with
   * the existing per-recording Start/Stop controls below, which the rest
   * of the app already calls a "session."
   */
  const handleStartWorkout = useCallback(async () => {
    // Safety net: if a previous workout was left open (End Workout never
    // pressed), close it out first so today's sets don't silently pool
    // with a stale one.
    const state = await loadExerciseRollingState(profileId, exerciseTag);
    const finalized = finalizePendingSession(state);
    await saveExerciseRollingState(profileId, exerciseTag, finalized);
    refreshRollingHistoricalPeak();
    setWorkoutSets([]);
    setWorkoutActive(true);
  }, [profileId, exerciseTag, refreshRollingHistoricalPeak]);

  const handleEndWorkout = useCallback(async () => {
    const state = await loadExerciseRollingState(profileId, exerciseTag);
    const finalized = finalizePendingSession(state);
    await saveExerciseRollingState(profileId, exerciseTag, finalized);
    refreshRollingHistoricalPeak();
    setWorkoutActive(false);
  }, [profileId, exerciseTag, refreshRollingHistoricalPeak]);

  const refreshCalibrationStatus = useCallback(() => {
    loadCalibrationHistory(profileId).then(history => {
      const reference = computeEffectiveReference(history);
      calibrationReferenceRef.current = reference;
      setCalibrationReference(reference);
      setLastCalibratedAt(history.length > 0 ? history[history.length - 1].timestampMs : null);
    });
  }, [profileId]);

  useEffect(() => {
    refreshCalibrationStatus();
  }, [refreshCalibrationStatus]);

  useEffect(() => {
    loadMaxEffortStatus(profileId).then(status => {
      maxEffortReferenceRef.current = status.accepted?.value ?? null;
      setMaxEffortCapturedAt(status.accepted?.timestampMs ?? null);
    });
    loadSessionHistory(profileId).then(history => {
      sessionHistoryRef.current = history;
    });
  }, [profileId]);

  const appendRow = useCallback(
    (row: SensorRow) => {
      hasSessionData.current = true;
      envelopeChartRef.current?.push([row.envelope], row.sample);
      rollChartRef.current?.push([row.rollDeg], row.sample);
      gyroChartRef.current?.push([row.gxDps, row.gyDps, row.gzDps], row.sample);
    },
    [],
  );

  useEffect(() => {
    const unsubscribe = ble.subscribeToSamples(sample => {
      const row = recorder.recordRow(sample);
      if (!row) {
        return;
      }
      appendRow(row);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ble.subscribeToSamples, appendRow]);

  // The firmware's per-set MDF/ZCR summary arrives as a text line on the
  // live characteristic (see ble/summaryLine.ts); collect it for the
  // fatigue pairing done at Stop.
  useEffect(() => {
    const unsubscribe = ble.subscribeToSummaries(addSummary);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ble.subscribeToSummaries, addSummary]);

  /**
   * Runs the on-device rep-detection pipeline right after Stop. This is a
   * synchronous, single-threaded computation (no worker/native module here),
   * so it briefly blocks interaction on longer sessions -- the "Analyzing…"
   * state at least makes that visible instead of the screen looking frozen.
   * The setTimeout(0) just lets the Stop button's own state update render
   * first, before the heavy pass starts.
   */
  const runAnalysis = useCallback(
    (rows: SensorRow[]) => {
      setAnalysisStatus('analyzing');
      setAnalysisResult(null);
      setHistoryDecision('pending');
      setTimeout(async () => {
        // No exercise tag is known yet at Stop time -- it's entered in the
        // summary panel afterward -- so this first pass always looks up the
        // untagged bucket's rolling window. The exerciseTag-change effect
        // below cheaply corrects the ceiling once a real tag is entered.
        const rollingState = await loadExerciseRollingState(profileId, null);
        const rollingHistoricalPeakForCeiling = computeRollingHistoricalPeakFromSessionSummaries(
          currentRollingWindow(rollingState),
        );
        const result = analyzeSession(
          rows,
          calibrationReferenceRef.current,
          maxEffortReferenceRef.current,
          rollingHistoricalPeakForCeiling,
        );
        setAnalysisResult(result);
        setAnalysisStatus('done');

        // Pair the firmware's per-set summaries with the detected sets and
        // derive each set's fatigue verdict from them (see summaryMdf.ts).
        if (result.ok) {
          const detectedSpans: DetectedSetSpan[] = result.analysis.setSpansSec.map(
            ([startSec, endSec], i) => ({ setNumber: i + 1, startSec, endSec }),
          );
          console.log(
            `[summaryMdf] ${summariesRef.current.length} set summary(ies) received vs ` +
              `${detectedSpans.length} set(s) detected from the live stream`,
          );
          summaryPathRef.current = true;
          detectedSpansRef.current = detectedSpans;
          setAnalysisResult({
            ok: true,
            analysis: applySummaryVerdicts(result.analysis, summariesRef.current, detectedSpans, true),
          });
        }
      }, 0);
    },
    [profileId],
  );

  /**
   * A summary can arrive after Stop's analysis already ran (the firmware only
   * closes a set after ~8 s of quiet, then computes and sends it). Pair it
   * with the detected sets as soon as it lands, instead of leaving the set
   * without a verdict.
   */
  useEffect(() => {
    const spans = detectedSpansRef.current;
    if (!summaryPathRef.current || !spans) {
      return;
    }
    setAnalysisResult(prev =>
      prev?.ok ? { ok: true, analysis: applySummaryVerdicts(prev.analysis, summaries, spans, true) } : prev,
    );
  }, [summaries]);

  /**
   * The exercise tag is chosen after Stop, so the ceiling analyzeSession()
   * used at Stop time couldn't know this exercise's rolling historical
   * peak yet. Once a tag is entered/changed, cheaply re-derive the
   * ceiling-dependent numbers (no re-running detection) instead of leaving
   * activationPct silently wrong for the rest of the session review.
   */
  useEffect(() => {
    let cancelled = false;
    loadExerciseRollingState(profileId, exerciseTag).then(rollingState => {
      if (cancelled) {
        return;
      }
      const rollingHistoricalPeakForCeiling = computeRollingHistoricalPeakFromSessionSummaries(
        currentRollingWindow(rollingState),
      );
      setAnalysisResult(prev => {
        if (!prev?.ok) {
          return prev;
        }
        const newCeiling = computeActivationCeiling({
          maxEffortReference: maxEffortReferenceRef.current,
          rollingHistoricalPeak: rollingHistoricalPeakForCeiling,
          currentSessionPeak: prev.analysis.sessionBestPeak,
        });
        const recomputed = recomputeWithCeiling(prev.analysis, newCeiling, rollingHistoricalPeakForCeiling);
        return recomputed === prev.analysis ? prev : { ok: true, analysis: recomputed };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [exerciseTag, profileId]);

  /**
   * Saving to history is an explicit choice, not automatic -- a session
   * that's just testing electrode placement or filter behavior shouldn't
   * silently pollute the day-over-day comparison in Session History.
   */
  const handleSaveToHistory = useCallback(async () => {
    if (!analysisResult?.ok) {
      return;
    }
    const record = buildSessionSummaryRecord(
      analysisResult.analysis,
      calibrationReferenceRef.current,
      setLabels,
      exerciseTag,
      description,
      setTags,
    );
    savedSessionIdRef.current = record.id;
    const repPeaks = analysisResult.analysis.reps.map(r => r.peakRaw);

    const [updatedHistory, rollingState] = await Promise.all([
      saveSessionSummary(profileId, record),
      loadExerciseRollingState(profileId, exerciseTag),
    ]);
    sessionHistoryRef.current = updatedHistory;
    setWorkoutSets(prev => [...prev, ...record.sets]);

    // Folds this recording's rep peaks into the exercise's still-open
    // workout -- finalizing only happens via the explicit End Workout
    // action, not automatically here.
    const updatedRollingState = mergeRecordingIntoPendingSession(rollingState, repPeaks);
    await saveExerciseRollingState(profileId, exerciseTag, updatedRollingState);

    // "Current ceiling" for this check excludes today's session peak on
    // purpose -- it's already reflected in updatedRollingState (via the
    // still-open pending session, if this recording joined one), so
    // including it again here would double-count it.
    const updatedRollingHistoricalPeak = computeRollingHistoricalPeakFromSessionSummaries(
      currentRollingWindow(updatedRollingState),
    );
    setRollingHistoricalPeak(updatedRollingHistoricalPeak);
    const currentCeiling = computeActivationCeiling({
      maxEffortReference: maxEffortReferenceRef.current,
      rollingHistoricalPeak: updatedRollingHistoricalPeak,
      currentSessionPeak: 0,
    });
    setShowRetestPrompt(shouldSuggestMaxEffortRetest(updatedHistory, exerciseTag, currentCeiling));

    setHistoryDecision('saved');
  }, [analysisResult, profileId, setLabels, exerciseTag, description, setTags]);

  const handleDiscardFromHistory = useCallback(() => {
    setHistoryDecision('discarded');
  }, []);

  const handleStart = useCallback(() => {
    envelopeChartRef.current?.clear();
    rollChartRef.current?.clear();
    gyroChartRef.current?.clear();
    hasSessionData.current = false;
    setAnalysisStatus('idle');
    setAnalysisResult(null);
    summaryPathRef.current = false;
    detectedSpansRef.current = null;
    setShowDetailScreen(false);
    setSetLabels({});
    setSetTags({});
    setTagsRef.current = {};
    savedSessionIdRef.current = null;
    setExerciseTag('');
    setDescription('');
    resetSummaries();
    recorder.start();
  }, [recorder, resetSummaries]);

  const handleLabelChange = useCallback((setNumber: number, label: string) => {
    setSetLabels(prev => ({ ...prev, [setNumber]: label }));
  }, []);

  const handleSetTagChange = useCallback(
    (setNumber: number, patch: SetUserTag) => {
      const next = { ...setTagsRef.current[setNumber], ...patch };
      setTagsRef.current = { ...setTagsRef.current, [setNumber]: next };
      setSetTags(setTagsRef.current);
      // Already saved to history: write the label into the saved record too.
      if (historyDecision === 'saved' && savedSessionIdRef.current) {
        updateSetUserTag(profileId, savedSessionIdRef.current, setNumber, next).catch(() => {});
      }
    },
    [historyDecision, profileId],
  );

  /**
   * Stable reference, not an inline arrow at the call site below -- SessionDetailScreen
   * is React.memo'd specifically to stop its heavy Skia charts from re-rendering on
   * every unrelated LiveSessionScreen re-render (e.g. the recorder's ~5Hz stats tick
   * while recording); a fresh onClose function on every render would silently defeat
   * that memoization, since a new prop reference always counts as "changed."
   */
  const closeDetailScreen = useCallback(() => setShowDetailScreen(false), []);

  const handleStop = useCallback(() => {
    recorder.stop();
    runAnalysis(recorder.getSnapshot().rows);
  }, [recorder, runAnalysis]);

  const handleMarkRep = useCallback(() => {
    const mark = recorder.markRep();
    if (!mark) {
      return;
    }
    envelopeChartRef.current?.addRepMarker(mark);
    rollChartRef.current?.addRepMarker(mark);
    gyroChartRef.current?.addRepMarker(mark);
  }, [recorder]);

  const handleExport = useCallback(async () => {
    const { rows, reps } = recorder.getSnapshot();
    if (rows.length === 0) {
      return;
    }
    try {
      const result = await exportSession(rows, reps);
      await shareExportedSession(result);
    } catch (e) {
      Alert.alert(
        'Export failed',
        e instanceof Error ? e.message : 'Could not build or share the session file.',
      );
    }
  }, [recorder]);

  const handleStopAndExport = useCallback(async () => {
    recorder.stop();
    runAnalysis(recorder.getSnapshot().rows);
    await handleExport();
  }, [recorder, runAnalysis, handleExport]);

  const snapshot = recorder.getSnapshot();
  const canExport = !recorder.isRecording && snapshot.rows.length > 0;
  const fallbackSummary = !recorder.isRecording ? recorder.getActivationSummary() : null;

  // The current recording's own sets, only while they haven't been saved
  // (or discarded) yet -- once saved, they're already in workoutSets via
  // handleSaveToHistory, and including them again here would duplicate
  // them; once discarded, they're deliberately excluded.
  const unsavedCurrentSets =
    analysisResult?.ok && historyDecision === 'pending'
      ? buildSessionSummaryRecord(
          analysisResult.analysis,
          calibrationReferenceRef.current,
          setLabels,
          exerciseTag,
          description,
          setTags,
        ).sets
      : [];
  const workoutSummarySets = [...workoutSets, ...unsavedCurrentSets];

  const showReconnectPrompt =
    (ble.connectionState === 'disconnected' || ble.connectionState === 'reconnecting') &&
    hasSessionData.current;

  const showGiveUpPrompt =
    ble.connectionState === 'disconnected' && !hasSessionData.current;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ConnectionStatusBadge
          connectionState={ble.connectionState}
          deviceName={ble.connectedDeviceName}
          onDisconnect={ble.disconnect}
        />

        {!recorder.isRecording && (
          <Pressable style={styles.calibrationBanner} onPress={onStartCalibration}>
            <View style={styles.calibrationBannerText}>
              <Text style={styles.calibrationBannerTitle}>
                {lastCalibratedAt === null
                  ? 'Not yet calibrated'
                  : `Calibrated ${Math.round(daysSince(lastCalibratedAt))} day${
                      Math.round(daysSince(lastCalibratedAt)) === 1 ? '' : 's'
                    } ago`}
              </Text>
              <Text style={styles.calibrationBannerSubtitle}>
                {lastCalibratedAt === null
                  ? 'Calibrate to unlock cross-session comparisons'
                  : `Reference: ${calibrationReference?.toFixed(0) ?? '—'} · tap to recalibrate`}
              </Text>
            </View>
            <Text style={styles.calibrationBannerAction}>
              {lastCalibratedAt === null ? 'Calibrate' : 'Recalibrate'}
            </Text>
          </Pressable>
        )}

        {!recorder.isRecording && (
          <Pressable style={styles.calibrationBanner} onPress={onStartMaxEffortTest}>
            <View style={styles.calibrationBannerText}>
              <Text style={styles.calibrationBannerTitle}>
                {maxEffortCapturedAt === null ? 'Max-effort test not done' : 'Max-effort captured'}
              </Text>
              <Text style={styles.calibrationBannerSubtitle}>
                {maxEffortCapturedAt === null
                  ? 'One-time test — sets your true activation ceiling'
                  : `${Math.round(daysSince(maxEffortCapturedAt))} day${
                      Math.round(daysSince(maxEffortCapturedAt)) === 1 ? '' : 's'
                    } ago · tap to redo`}
              </Text>
            </View>
            <Text style={styles.calibrationBannerAction}>
              {maxEffortCapturedAt === null ? 'Test' : 'Redo'}
            </Text>
          </Pressable>
        )}

        {!recorder.isRecording && rollingHistoricalPeak !== null && (
          <View style={styles.rollingHighRow}>
            <Text style={styles.rollingHighLabel}>Rolling High</Text>
            <Text style={styles.rollingHighValue}>{rollingHistoricalPeak.toFixed(0)}</Text>
          </View>
        )}

        {ble.connectionState === 'connected' && (
          <View style={styles.rollingHighRow}>
            <Text style={styles.rollingHighLabel}>Set Summaries Received (debug)</Text>
            <Text style={styles.rollingHighValue}>{summaries.length}</Text>
          </View>
        )}

        {!recorder.isRecording && (
          <Pressable
            style={[styles.workoutButton, workoutActive && styles.workoutButtonActive]}
            onPress={() => void (workoutActive ? handleEndWorkout() : handleStartWorkout())}
          >
            <Text style={styles.workoutButtonLabel}>
              {workoutActive ? 'End Workout' : 'Start Workout'}
            </Text>
          </Pressable>
        )}
        {workoutActive && (
          <Text style={styles.workoutHint}>
            Sets you save now count toward this one workout, however long it takes — tap End
            Workout when you&apos;re done.
          </Text>
        )}

        {!recorder.isRecording && showRetestPrompt && (
          <View style={styles.retestBanner}>
            <Text style={styles.retestBannerText}>
              Your recent sets have been matching your all-time high — want to redo your
              max-effort test?
            </Text>
            <View style={styles.bannerActions}>
              <Text style={styles.bannerAction} onPress={onStartMaxEffortTest}>
                Retest
              </Text>
              <Text style={styles.retestDismiss} onPress={() => setShowRetestPrompt(false)}>
                Not now
              </Text>
            </View>
          </View>
        )}

        {!recorder.isRecording && (
          <Pressable style={styles.historyLink} onPress={() => setShowHistoryScreen(true)}>
            <Text style={styles.historyLinkLabel}>View Session History</Text>
          </Pressable>
        )}

        {!recorder.isRecording && (
          <Pressable style={styles.historyLink} onPress={() => setShowDebugHistoryScreen(true)}>
            <Text style={styles.historyLinkLabel}>Debug: History</Text>
          </Pressable>
        )}

        {showReconnectPrompt && (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>
              {ble.connectionState === 'reconnecting'
                ? 'Connection lost — reconnecting…'
                : 'Connection lost'}
            </Text>
            <Text style={styles.bannerBody}>
              {recorder.isRecording
                ? `Recording is paused. ${snapshot.rows.length} samples captured so far are safe.`
                : `${snapshot.rows.length} samples were captured before the drop.`}
            </Text>
            {ble.connectionState === 'disconnected' && (
              <View style={styles.bannerActions}>
                <Text style={styles.bannerAction} onPress={ble.resumeAfterDrop}>
                  Try Reconnect
                </Text>
                {recorder.isRecording && (
                  <Text style={styles.bannerActionDanger} onPress={handleStopAndExport}>
                    Stop &amp; Export
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {showGiveUpPrompt && (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Couldn&apos;t stay connected</Text>
            <Text style={styles.bannerBody}>{ble.lastError ?? 'The device disconnected.'}</Text>
            <View style={styles.bannerActions}>
              <Text style={styles.bannerAction} onPress={ble.resumeAfterDrop}>
                Try Reconnect
              </Text>
              <Text style={styles.bannerActionDanger} onPress={onLeave}>
                Back to Scan
              </Text>
            </View>
          </View>
        )}

        <StatsBar
          elapsedSec={recorder.elapsedSec}
          sampleCount={recorder.sampleCount}
          currentEnvelope={recorder.latestEnvelope}
          repCount={recorder.reps.length}
        />

        {recorder.isRecording && (
          <ActivationGauge ratio={recorder.liveActivationRatio} />
        )}

        <LiveChart
          ref={envelopeChartRef}
          title="EMG Envelope"
          series={[{ key: 'envelope', label: 'Envelope', color: '#2F6FED' }]}
          // Fixed, not auto-scaling -- see the crash investigation: an
          // unfixed range means the Skia-rendered min/max axis labels
          // (Y-axis text) change on nearly every live sample, forcing
          // continuous SkStrikeCache glyph-atlas regeneration for the
          // whole duration of every recording. Starting point based on
          // observed real peaks (~2000-2500) with headroom -- raise this
          // if your signal genuinely clips above it.
          yDomain={[0, 3000]}
        />
        <LiveChart
          ref={rollChartRef}
          title="Upper-Arm Tilt (Roll)"
          series={[{ key: 'roll', label: 'Roll °', color: '#33C481' }]}
          yDomain={[-180, 180]}
        />
        <LiveChart
          ref={gyroChartRef}
          title="Gyroscope"
          // Fixed to the gyro's actual configured full-scale range (see
          // GYRO_SCALE's comment in ble/constants.ts: +/-250 deg/s) --
          // same reasoning as the envelope chart above, but this value
          // isn't a guess, it's the sensor's real range.
          yDomain={[-250, 250]}
          series={[
            { key: 'gx', label: 'X', color: '#F5A623' },
            { key: 'gy', label: 'Y', color: '#E24A90' },
            { key: 'gz', label: 'Z', color: '#4CC2FF' },
          ]}
        />

        <View style={styles.markRepWrapper}>
          <RepMarkerButton disabled={!recorder.isRecording} onPress={handleMarkRep} />
        </View>

        {!recorder.isRecording && analysisStatus !== 'idle' && (
          <SessionAnalysisPanel
            status={analysisStatus === 'analyzing' ? 'analyzing' : 'done'}
            result={analysisResult}
            fallbackSummary={fallbackSummary}
            onViewDetails={
              analysisResult?.ok ? () => setShowDetailScreen(true) : undefined
            }
            onViewWorkoutSummary={
              analysisResult?.ok ? () => setShowWorkoutSummaryScreen(true) : undefined
            }
            historyDecision={analysisResult?.ok ? historyDecision : undefined}
            onSaveToHistory={handleSaveToHistory}
            onDiscardFromHistory={handleDiscardFromHistory}
            setLabels={setLabels}
            onLabelChange={handleLabelChange}
            exerciseTag={exerciseTag}
            onExerciseTagChange={setExerciseTag}
            description={description}
            onDescriptionChange={setDescription}
          />
        )}

        <SessionControls
          isRecording={recorder.isRecording}
          canExport={canExport}
          onStart={handleStart}
          onStop={handleStop}
          onExport={handleExport}
        />
      </ScrollView>

      <SessionDetailScreen
        visible={showDetailScreen}
        analysis={analysisResult?.ok ? analysisResult.analysis : null}
        setLabels={setLabels}
        setTags={setTags}
        onSetTagChange={handleSetTagChange}
        exerciseTag={exerciseTag}
        onClose={closeDetailScreen}
      />
      <WorkoutSummaryScreen
        visible={showWorkoutSummaryScreen}
        sets={workoutSummarySets}
        onClose={() => setShowWorkoutSummaryScreen(false)}
      />
      <SessionHistoryScreen
        visible={showHistoryScreen}
        profileId={profileId}
        onClose={() => setShowHistoryScreen(false)}
      />
      <DebugHistoryScreen
        visible={showDebugHistoryScreen}
        profileId={profileId}
        onClose={() => setShowDebugHistoryScreen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111318',
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  markRepWrapper: {
    marginBottom: 14,
  },
  calibrationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  calibrationBannerText: {
    flex: 1,
    marginRight: 8,
  },
  calibrationBannerTitle: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '700',
  },
  calibrationBannerSubtitle: {
    color: '#8A8F98',
    fontSize: 11,
    marginTop: 2,
  },
  calibrationBannerAction: {
    color: '#2F6FED',
    fontSize: 13,
    fontWeight: '700',
  },
  rollingHighRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  rollingHighLabel: {
    color: '#8A8F98',
    fontSize: 13,
    fontWeight: '700',
  },
  rollingHighValue: {
    color: '#33C481',
    fontSize: 16,
    fontWeight: '800',
  },
  workoutButton: {
    backgroundColor: '#1C1F26',
    borderColor: '#2F6FED',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  workoutButtonActive: {
    backgroundColor: '#14231F',
    borderColor: '#33C481',
  },
  workoutButtonLabel: {
    color: '#E6E8EB',
    fontSize: 14,
    fontWeight: '700',
  },
  workoutHint: {
    color: '#5B6270',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  historyLink: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 12,
  },
  historyLinkLabel: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  banner: {
    backgroundColor: '#2A1F14',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  bannerTitle: {
    color: '#F5A623',
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 4,
  },
  bannerBody: {
    color: '#E6E8EB',
    fontSize: 13,
    marginBottom: 8,
  },
  bannerActions: {
    flexDirection: 'row',
  },
  bannerAction: {
    color: '#2F6FED',
    fontWeight: '700',
    fontSize: 13,
    marginRight: 20,
  },
  bannerActionDanger: {
    color: '#C62828',
    fontWeight: '700',
    fontSize: 13,
  },
  retestBanner: {
    backgroundColor: '#14231F',
    borderColor: '#33C481',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  retestBannerText: {
    color: '#E6E8EB',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  retestDismiss: {
    color: '#8A8F98',
    fontWeight: '700',
    fontSize: 13,
  },
});
