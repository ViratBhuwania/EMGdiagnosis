import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { UseBleDeviceResult } from '../hooks/useBleDevice';
import { analyzeHold, HoldSample } from '../calibration/analyzeHold';
import { loadCalibrationHistory, saveCalibrationRecord } from '../calibration/calibrationStore';
import { computeEffectiveReference, isLikelyOutlier } from '../calibration/calibrationTrend';
import type { CalibrationRecord } from '../calibration/types';

const COUNTDOWN_SECONDS = 3;
const HOLD_SECONDS = 6;

type Phase =
  | 'instructions'
  | 'countdown'
  | 'holding'
  | 'processing'
  | 'unstable'
  | 'outlier'
  | 'success'
  | 'error';

interface CalibrationScreenProps {
  ble: UseBleDeviceResult;
  profileId: string;
  onDone: () => void;
}

export default function CalibrationScreen({ ble, profileId, onDone }: CalibrationScreenProps) {
  const [phase, setPhase] = useState<Phase>('instructions');
  const [weightKgText, setWeightKgText] = useState('2');
  const [countdownValue, setCountdownValue] = useState(COUNTDOWN_SECONDS);
  const [liveEnvelope, setLiveEnvelope] = useState<number | null>(null);
  const [holdElapsedSec, setHoldElapsedSec] = useState(0);
  const [capturedValue, setCapturedValue] = useState<number | null>(null);
  const [effectiveReference, setEffectiveReference] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const samplesRef = useRef<HoldSample[]>([]);
  const holdStartRef = useRef<number | null>(null);
  const historyRef = useRef<CalibrationRecord[]>([]);
  const pendingCandidateRef = useRef<{ value: number; weightKg: number } | null>(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    loadCalibrationHistory(profileId).then(h => {
      historyRef.current = h;
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

  const commitCalibration = useCallback(
    async (value: number, weightKg: number, wasFlaggedOutlier: boolean) => {
      const record: CalibrationRecord = {
        timestampMs: Date.now(),
        weightKg,
        referenceValue: value,
        wasFlaggedOutlier,
      };
      try {
        const updated = await saveCalibrationRecord(profileId, record);
        historyRef.current = updated;
        setCapturedValue(value);
        setEffectiveReference(computeEffectiveReference(updated));
        setPhase('success');
      } catch (e) {
        setErrorMessage(e instanceof Error ? e.message : 'Could not save calibration.');
        setPhase('error');
      }
    },
    [profileId],
  );

  const finishHold = useCallback(() => {
    setPhase('processing');
    const weightKg = parseFloat(weightKgText) || 0;
    const analysis = analyzeHold(samplesRef.current);

    if (!analysis) {
      setErrorMessage('Not enough data was captured during the hold. Please try again.');
      setPhase('error');
      return;
    }
    if (!analysis.isStable) {
      setCapturedValue(analysis.referenceValue);
      setPhase('unstable');
      return;
    }

    const outlier = isLikelyOutlier(historyRef.current, analysis.referenceValue, Date.now());
    if (outlier) {
      pendingCandidateRef.current = { value: analysis.referenceValue, weightKg };
      setCapturedValue(analysis.referenceValue);
      setPhase('outlier');
      return;
    }

    void commitCalibration(analysis.referenceValue, weightKg, false);
  }, [weightKgText, commitCalibration]);

  useEffect(() => {
    if (phase !== 'holding') {
      finishingRef.current = false;
      return;
    }
    if (holdElapsedSec >= HOLD_SECONDS && !finishingRef.current) {
      finishingRef.current = true;
      finishHold();
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

  const weightValid = parseFloat(weightKgText) > 0;
  const canStart = ble.connectionState === 'connected' && weightValid;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Calibration</Text>

        {phase === 'instructions' && (
          <View style={styles.card}>
            <Text style={styles.body}>
              Hold a fixed, known weight steady for {HOLD_SECONDS} seconds, with your elbow at a
              consistent angle (e.g. 90°) — a still isometric hold, not a curling motion.
            </Text>
            <Text style={styles.body}>
              Use the same weight every time you calibrate — that consistency is what makes
              readings comparable across sessions.
            </Text>
            <Text style={styles.label}>Weight (kg)</Text>
            <TextInput
              style={styles.input}
              value={weightKgText}
              onChangeText={setWeightKgText}
              keyboardType="decimal-pad"
              placeholder="2.0"
              placeholderTextColor="#5B6270"
            />
            {ble.connectionState !== 'connected' && (
              <Text style={styles.warning}>Connect to your device before calibrating.</Text>
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
            <Text style={styles.getReadyLabel}>Hold steady</Text>
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
            <Text style={styles.body}>Analyzing hold…</Text>
          </View>
        )}

        {phase === 'unstable' && (
          <View style={styles.card}>
            <Text style={styles.warningTitle}>That looked unstable</Text>
            <Text style={styles.body}>
              The reading varied more than expected during the hold — this usually means the
              electrode shifted or the weight wasn&apos;t held steady. Let&apos;s try again.
            </Text>
            <Pressable style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonLabel}>Try Again</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={onDone}>
              <Text style={styles.secondaryButtonLabel}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {phase === 'outlier' && (
          <View style={styles.card}>
            <Text style={styles.warningTitle}>This reading looks unusual</Text>
            <Text style={styles.body}>
              It&apos;s well outside your recent calibration trend ({capturedValue?.toFixed(0)} vs.
              your typical range). This can be a genuine change, or a one-off (tired, distracted,
              electrode placement) — up to you.
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                const pending = pendingCandidateRef.current;
                if (pending) {
                  void commitCalibration(pending.value, pending.weightKg, true);
                }
              }}
            >
              <Text style={styles.primaryButtonLabel}>Keep Anyway</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={retry}>
              <Text style={styles.secondaryButtonLabel}>Redo Instead</Text>
            </Pressable>
          </View>
        )}

        {phase === 'success' && (
          <View style={styles.card}>
            <Text style={styles.successTitle}>Calibrated</Text>
            <Text style={styles.body}>
              Reference: {capturedValue?.toFixed(0)}
              {effectiveReference !== null && Math.round(effectiveReference) !== Math.round(capturedValue ?? 0)
                ? ` (trend-adjusted: ${effectiveReference.toFixed(0)})`
                : ''}
            </Text>
            <Pressable style={styles.primaryButton} onPress={onDone}>
              <Text style={styles.primaryButtonLabel}>Done</Text>
            </Pressable>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.card}>
            <Text style={styles.warningTitle}>Couldn&apos;t calibrate</Text>
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
  label: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#111318',
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 8,
    color: '#E6E8EB',
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
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
