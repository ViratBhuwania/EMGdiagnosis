import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface StatsBarProps {
  elapsedSec: number;
  sampleCount: number;
  currentEnvelope: number | null;
  repCount: number;
}

function formatElapsed(sec: number): string {
  const totalSeconds = Math.floor(sec);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/** Compact stats readout: elapsed session time, sample count, live envelope, rep count. */
export default function StatsBar({
  elapsedSec,
  sampleCount,
  currentEnvelope,
  repCount,
}: StatsBarProps) {
  return (
    <View style={styles.container}>
      <Stat label="Time" value={formatElapsed(elapsedSec)} />
      <Stat label="Samples" value={sampleCount.toString()} />
      <Stat label="Envelope" value={currentEnvelope !== null ? currentEnvelope.toFixed(0) : '—'} />
      <Stat label="Reps" value={repCount.toString()} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 10,
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  value: {
    color: '#E6E8EB',
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  label: {
    color: '#8A8F98',
    fontSize: 11,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
