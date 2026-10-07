import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { UseBleDeviceResult } from '../hooks/useBleDevice';
import { extractMaxEffortValue, HoldSample } from '../calibration/analyzeHold';
import { loadCalibrationHistory } from '../calibration/calibrationStore';
import { computeEffectiveReference } from '../calibration/calibrationTrend';
import { evaluateMaxEffortAttempt } from '../calibration/maxEffortEvaluation';
import { logRejectedMaxEffortAttempt, saveAcceptedMaxEffort } from '../calibration/maxEffortStore';
import type { MaxEffortRecord } from '../calibration/maxEffortTypes';

const COUNTDOWN_SECONDS = 3;
/**
 * Total capture window: ~1s ramp-up + ~2-3s of genuine max effort + ~1s
 * release, both ends trimmed away by extractMaxEffortValue()'s defaults
 * before the peak is taken. Shorter than the submax hold's 6s either way --
 * a genuine maximal push can't be sustained as long or as steadily.
 */
const HOLD_SECONDS = 5;

type Phase =
  | 'instructions'
  | 'missing_submax'
  | 'countdown'
  | 'holding'
  | 'processing'
  | 'rejected'
  | 'success'
  | 'error';

interface MaxEffortTestScreenProps {
  ble: UseBleDeviceResult;
  profileId: string;
  onDone: () => void;
}

/**
 * The one-time, resisted maximal-effort capture -- additive to the existing
 * submax calibration flow (CalibrationScreen), not a replacement for it.
 * Needs a submax reference to already exist, since every accepted reading
 * is validated against it (see maxEffortEvaluation.ts) before being stored.
 */
export default function MaxEffortTestScreen({ ble, profileId, onDone }: MaxEffortTestScreenProps) {
  const [phase, setPhase] = useState<Phase>('instructions');
  const [countdownValue, setCountdownValue] = useState(COUNTDOWN_SECONDS);
  const [liveEnvelope, setLiveEnvelope] = useState<number | null>(null);
  const [holdElapsedSec, setHoldElapsedSec] = useState(0);
  const [capturedValue, setCapturedValue] = useState<number | null>(null);
  const [ratioAchieved, setRatioAchieved] = useState<number | null>(null);
  const [ratioRequired, setRatioRequired] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const samplesRef = useRef<HoldSample[]>([]);
  const holdStartRef = useRef<number | null>(null);
  const submaxReferenceRef = useRef<number | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    loadCalibrationHistory(profileId).then(history => {
      submaxReferenceRef.current = computeEffectiveReference(history);
      if (submaxReferenceRef.current === null) {
        setPhase('missing_submax');
      }
    });
  }, [profileId]);

  useEffect(() => {
    if (phase !== 'holding') {
      return;
    }
    const unsubscribe = ble.subscribeToSamples(sample => {
      if (holdStartRef.current === null) {
        return;
      }
      const elapsedSec = (Date.now() - holdStartRef.current) / 1000;
      samplesRef.current.push({ envelope: sample.envelope, elapsedSec });
      setLiveEnvelope(sample.envelope);
      setHoldElapsedSec(elapsedSec);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ble.subscribeToSamples]);

  useEffect(() => {
    if (phase !== 'countdown') {
      return;
    }
    if (countdownValue <= 0) {
      samplesRef.current = [];
      finishingRef.current = false;
      holdStartRef.current = Date.now();
      setHoldElapsedSec(0);
      setPhase('holding');
      return;
    }
    const t = setTimeout(() => setCountdownValue(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdownValue]);

  const finishHold = useCallback(async () => {
    setPhase('processing');
    const submaxReference = submaxReferenceRef.current;
    if (submaxReference === null) {
      setPhase('missing_submax');
      return;
    }

    const peak = extractMaxEffortValue(samplesRef.current);
    if (peak === null) {
      setErrorMessage('Not enough data was captured during the push. Please try again.');
      setPhase('error');
      return;
    }

    const evaluation = evaluateMaxEffortAttempt(peak, submaxReference);
    setCapturedValue(peak);
    setRatioAchieved(evaluation.ratioAchieved);
    setRatioRequired(evaluation.ratioRequired);

    if (!evaluation.accepted) {
      await logRejectedMaxEffortAttempt(profileId, {
        timestampMs: Date.now(),
        value: peak,
        submaxReferenceAtCapture: submaxReference,
        ratioAchieved: evaluation.ratioAchieved,
        ratioRequired: evaluation.ratioRequired,
      });
      setPhase('rejected');
      return;
    }

    try {
      const record: MaxEffortRecord = {
        timestampMs: Date.now(),
        value: peak,
        submaxReferenceAtCapture: submaxReference,
        ratioAchieved: evaluation.ratioAchieved,
      };
      await saveAcceptedMaxEffort(profileId, record);
      setPhase('success');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Could not save the max-effort reading.');
      setPhase('error');
    }
  }, [profileId]);

  useEffect(() => {
    if (phase !== 'holding') {
      finishingRef.current = false;
      return;
    }
    if (holdElapsedSec >= HOLD_SECONDS && !finishingRef.current) {
      finishingRef.current = true;
      void finishHold();
    }
  }, [phase, holdElapsedSec, finishHold]);

  const startCountdown = useCallback(() => {
    setCountdownValue(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }, []);

  const retry = useCallback(() => {
    setErrorMessage(null);
    setCapturedValue(null);
    setPhase('instructions');
  }, []);

  const canStart = ble.connectionState === 'connected';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Max-Effort Test</Text>

        {phase === 'missing_submax' && (
          <View style={styles.card}>
            <Text style={styles.warningTitle}>Submax calibration needed first</Text>
            <Text style={styles.body}>
              This test is validated against your submax hold, so that has to exist first. Go
              run the regular Calibration flow, then come back here.
            </Text>
            <Pressable style={styles.primaryButton} onPress={onDone}>
              <Text style={styles.primaryButtonLabel}>Back</Text>
            </Pressable>
          </View>
        )}

        {phase === 'instructions' && (
          <View style={styles.card}>
            <Text style={styles.body}>
              This is a one-time test of your true maximal effort — captured once, not repeated
              every session.
            </Text>
            <Text style={styles.body}>
              Push into resistance you can&apos;t move — brace against something immovable, or
              resist with your other hand — and drive as hard as you genuinely can for{' '}
              {HOLD_SECONDS} seconds. Not an unloaded squeeze in open air: resistance gives your
              nervous system something concrete to drive against, which produces a higher, more
              consistent maximal reading.
            </Text>
            {ble.connectionState !== 'connected' && (
              <Text style={styles.warning}>Connect to your device before testing.</Text>
            )}
            <Pressable
              style={[styles.primaryButton, !canStart && styles.buttonDisabled]}
              disabled={!canStart}
              onPress={startCountdown}
            >
              <Text style={styles.primaryButtonLabel}>Start</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onDone}>
              <Text style={styles.secondaryButtonLabel}>Skip for now</Text>
            </Pressable>
          </View>
        )}

        {phase === 'countdown' && (
          <View style={styles.centerCard}>
            <Text style={styles.getReadyLabel}>Get ready…</Text>
            <Text style={styles.countdownNumber}>{countdownValue}</Text>
          </View>
        )}

        {phase === 'holding' && (
          <View style={styles.centerCard}>
            <Text style={styles.getReadyLabel}>Push as hard as you can</Text>
            <Text style={styles.holdTimer}>
              {Math.max(0, HOLD_SECONDS - holdElapsedSec).toFixed(1)}s
            </Text>
            <Text style={styles.liveReading}>
              {liveEnvelope !== null ? liveEnvelope.toFixed(0) : '—'}
            </Text>
          </View>
        )}

        {phase === 'processing' && (
          <View style={styles.centerCard}>
            <Text style={styles.body}>Analyzing…</Text>
          </View>
        )}

        {phase === 'rejected' && (
          <View style={styles.card}>
            <Text style={styles.warningTitle}>That didn&apos;t clear the bar</Text>
            <Text style={styles.body}>
              Your reading ({capturedValue?.toFixed(0)}) was only {ratioAchieved?.toFixed(2)}x your
              submax hold — a genuine maximal effort should clear it by at least{' '}
              {ratioRequired?.toFixed(2)}x. This usually means the effort wasn&apos;t truly
              maximal (distraction, dropped effort partway through) or something shifted with the
              electrode. It hasn&apos;t been saved — let&apos;s try again.
            </Text>
            <Pressable style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonLabel}>Try Again</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onDone}>
              <Text style={styles.secondaryButtonLabel}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {phase === 'success' && (
          <View style={styles.card}>
            <Text style={styles.successTitle}>Max-effort reference captured</Text>
            <Text style={styles.body}>
              Reference: {capturedValue?.toFixed(0)} ({ratioAchieved?.toFixed(2)}x your submax
              hold)
            </Text>
            <Pressable style={styles.primaryButton} onPress={onDone}>
              <Text style={styles.primaryButtonLabel}>Done</Text>
            </Pressable>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.card}>
            <Text style={styles.warningTitle}>Couldn&apos;t complete the test</Text>
            <Text style={styles.body}>{errorMessage}</Text>
            <Pressable style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonLabel}>Try Again</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onDone}>
              <Text style={styles.secondaryButtonLabel}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
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
    flexGrow: 1,
  },
  header: {
    color: '#E6E8EB',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 16,
  },
  centerCard: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 280,
  },
  body: {
    color: '#E6E8EB',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  warning: {
    color: '#F5A623',
    fontSize: 13,
    marginBottom: 12,
  },
  warningTitle: {
    color: '#F5A623',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  successTitle: {
    color: '#33C481',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  getReadyLabel: {
    color: '#8A8F98',
    fontSize: 14,
    marginBottom: 12,
  },
  countdownNumber: {
    color: '#E6E8EB',
    fontSize: 64,
    fontWeight: '800',
  },
  holdTimer: {
    color: '#2F6FED',
    fontSize: 48,
    fontWeight: '800',
    marginBottom: 12,
  },
  liveReading: {
    color: '#8A8F98',
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: '#2F6FED',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: '#3A3F4B',
  },
  primaryButtonLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonLabel: {
    color: '#8A8F98',
    fontSize: 14,
    fontWeight: '600',
  },
});
