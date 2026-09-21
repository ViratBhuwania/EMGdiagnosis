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
import SessionHistoryScreen from './SessionHistoryScreen';
import type { SensorRow } from '../types';
import { loadCalibrationHistory } from '../calibration/calibrationStore';
import { computeEffectiveReference, daysSince } from '../calibration/calibrationTrend';
import { saveSessionSummary } from '../sessionHistory/sessionHistoryStore';
import { buildSessionSummaryRecord } from '../sessionHistory/buildSummary';

interface LiveSessionScreenProps {
  ble: UseBleDeviceResult;
  profileId: string;
  /** Returns to the scan screen (used to give up on a dead/failed connection). */
  onLeave: () => void;
  onStartCalibration: () => void;
}

type AnalysisStatus = 'idle' | 'analyzing' | 'done';

export default function LiveSessionScreen({
  ble,
  profileId,
  onLeave,
  onStartCalibration,
}: LiveSessionScreenProps) {
  const recorder = useSessionRecorder();

  const envelopeChartRef = useRef<LiveChartHandle>(null);
  const rollChartRef = useRef<LiveChartHandle>(null);
  const gyroChartRef = useRef<LiveChartHandle>(null);

  const hasSessionData = useRef(false);

  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [showDetailScreen, setShowDetailScreen] = useState(false);
  const [showHistoryScreen, setShowHistoryScreen] = useState(false);
  const [historyDecision, setHistoryDecision] = useState<'pending' | 'saved' | 'discarded'>(
    'pending',
  );
  const [setLabels, setSetLabels] = useState<Record<number, string>>({});
  const [exerciseTag, setExerciseTag] = useState('');
  const [description, setDescription] = useState('');

  const [calibrationReference, setCalibrationReference] = useState<number | null>(null);
  const [lastCalibratedAt, setLastCalibratedAt] = useState<number | null>(null);
  const calibrationReferenceRef = useRef<number | null>(null);

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
    const unsubscribe = ble.subscribeToSamples(sample => {
      const row = recorder.recordRow(sample);
      if (!row) {
        return;
      }
      hasSessionData.current = true;
      envelopeChartRef.current?.push([row.envelope], row.sample);
      rollChartRef.current?.push([row.rollDeg], row.sample);
      gyroChartRef.current?.push([row.gxDps, row.gyDps, row.gzDps], row.sample);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ble.subscribeToSamples]);

  /**
   * Runs the on-device rep-detection pipeline right after Stop. This is a
   * synchronous, single-threaded computation (no worker/native module here),
   * so it briefly blocks interaction on longer sessions -- the "Analyzing…"
   * state at least makes that visible instead of the screen looking frozen.
   * The setTimeout(0) just lets the Stop button's own state update render
   * first, before the heavy pass starts.
   */
  const runAnalysis = useCallback((rows: SensorRow[]) => {
    setAnalysisStatus('analyzing');
    setAnalysisResult(null);
    setHistoryDecision('pending');
    setTimeout(() => {
      const result = analyzeSession(rows, calibrationReferenceRef.current);
      setAnalysisResult(result);
      setAnalysisStatus('done');
    }, 0);
  }, []);

  /**
   * Saving to history is an explicit choice, not automatic -- a session
   * that's just testing electrode placement or filter behavior shouldn't
   * silently pollute the day-over-day comparison in Session History.
   */
  const handleSaveToHistory = useCallback(() => {
    if (!analysisResult?.ok) {
      return;
    }
    const record = buildSessionSummaryRecord(
      analysisResult.analysis,
      calibrationReferenceRef.current,
      setLabels,
      exerciseTag,
      description,
    );
    void saveSessionSummary(profileId, record);
    setHistoryDecision('saved');
  }, [analysisResult, profileId, setLabels, exerciseTag, description]);

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
    setShowDetailScreen(false);
    setSetLabels({});
    setExerciseTag('');
    setDescription('');
    recorder.start();
  }, [recorder]);

  const handleLabelChange = useCallback((setNumber: number, label: string) => {
    setSetLabels(prev => ({ ...prev, [setNumber]: label }));
  }, []);

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
          <Pressable style={styles.historyLink} onPress={() => setShowHistoryScreen(true)}>
            <Text style={styles.historyLinkLabel}>View Session History</Text>
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
        onClose={() => setShowDetailScreen(false)}
      />
      <SessionHistoryScreen
        visible={showHistoryScreen}
        profileId={profileId}
        onClose={() => setShowHistoryScreen(false)}
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
});
