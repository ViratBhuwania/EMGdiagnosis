import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RepFeatures } from '../analysis/types';
import { setColor } from './setColors';

interface ActivationBarChartProps {
  reps: RepFeatures[];
}

const MAX_BAR_HEIGHT = 130;

/** Per-rep activation bars, colored by set -- the mobile equivalent of plot_summary_screen. */
export default function ActivationBarChart({ reps }: ActivationBarChartProps) {
  if (reps.length === 0) {
    return null;
  }
  const average = reps.reduce((a, r) => a + r.activationPct, 0) / reps.length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Activation per Rep</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.barsRow}>
          {reps.map(rep => (
            <View key={rep.repNumber} style={styles.barColumn}>
              <Text style={styles.barValueLabel}>{rep.activationPct.toFixed(0)}%</Text>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(2, (rep.activationPct / 100) * MAX_BAR_HEIGHT),
                    backgroundColor: setColor(rep.setNumber),
                  },
                ]}
              />
              <Text style={styles.barRepLabel}>{rep.repNumber}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <Text style={styles.averageLabel}>Average: {average.toFixed(1)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  title: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: MAX_BAR_HEIGHT + 40,
  },
  barColumn: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: 28,
    height: MAX_BAR_HEIGHT + 40,
  },
  barValueLabel: {
    color: '#8A8F98',
    fontSize: 9,
    marginBottom: 2,
  },
  bar: {
    width: 14,
    borderRadius: 3,
  },
  barRepLabel: {
    color: '#8A8F98',
    fontSize: 10,
    marginTop: 4,
  },
  averageLabel: {
    color: '#E6E8EB',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
});
