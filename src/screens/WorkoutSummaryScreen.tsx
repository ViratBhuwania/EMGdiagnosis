import React from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SetSummaryRecord } from '../sessionHistory/types';
import { setColor } from '../components/setColors';

interface WorkoutSummaryScreenProps {
  visible: boolean;
  /**
   * Every set performed in the current workout, in chronological order,
   * spanning every Start/Stop recording since Start Workout was pressed --
   * NOT just the most recent recording's own sets. `set.setNumber` is only
   * unique within the recording it came from, so display/comparison here
   * uses each set's position in this array instead.
   */
  sets: SetSummaryRecord[];
  onClose: () => void;
}

function setTitleFor(index: number, set: SetSummaryRecord): string {
  const n = index + 1;
  return set.label ? `Set ${n} — ${set.label}` : `Set ${n}`;
}

/** Percent change of `to` relative to `from`, e.g. 20 means "20% more." */
function pctChange(from: number, to: number): number | null {
  if (from <= 0) {
    return null;
  }
  return ((to - from) / from) * 100;
}

/**
 * Set-to-set comparison across the WHOLE workout (every saved Start/Stop
 * recording since Start Workout), distinct from SessionDetailScreen's
 * trace/chart view, which only ever shows one recording. Per set: the
 * 90th-percentile peak (a steadier "typical high effort" figure than the
 * single max) and the highest single rep, then the percent change from
 * each set to the next -- "Set 2 had 12% more activation than Set 1" --
 * using the 90th percentile as the comparison basis rather than the single
 * max, since one outlier rep shouldn't decide which set was "better."
 */
export default function WorkoutSummaryScreen({ visible, sets, onClose }: WorkoutSummaryScreenProps) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Workout Summary</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>

        {sets.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No sets saved in this workout yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            {sets.map((set, i) => (
              <View key={i} style={styles.card}>
                <Text style={[styles.setTitle, { color: setColor(i + 1) }]}>{setTitleFor(i, set)}</Text>
                <Text style={styles.line}>Reps: {set.repCount}</Text>
                <Text style={styles.line}>Mean 90th-percentile EMG: {set.p90Peak.toFixed(1)}</Text>
                <Text style={styles.line}>Highest EMG reached: {set.peakEnvelope.toFixed(1)}</Text>
              </View>
            ))}

            {sets.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Set-to-set comparison</Text>
                {sets.slice(1).map((set, i) => {
                  const previous = sets[i];
                  const change = pctChange(previous.p90Peak, set.p90Peak);
                  const isMore = change !== null && change >= 0;
                  return (
                    <Text key={i + 1} style={styles.comparisonLine}>
                      {change === null ? (
                        `${setTitleFor(i + 1, set)} vs. ${setTitleFor(i, previous)}: not comparable`
                      ) : (
                        <>
                          <Text style={{ color: setColor(i + 2) }}>Set {i + 2}</Text>
                          {' had '}
                          <Text style={isMore ? styles.more : styles.less}>
                            {Math.abs(change).toFixed(1)}% {isMore ? 'more' : 'less'}
                          </Text>
                          {' activation than '}
                          <Text style={{ color: setColor(i + 1) }}>Set {i + 1}</Text>.
                        </>
                      )}
                    </Text>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#111318',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: '#E6E8EB',
    fontSize: 18,
    fontWeight: '800',
  },
  closeLabel: {
    color: '#2F6FED',
    fontSize: 15,
    fontWeight: '700',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: '#8A8F98',
    fontSize: 14,
    textAlign: 'center',
  },
  scroll: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  setTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  line: {
    color: '#E6E8EB',
    fontSize: 13,
    marginBottom: 3,
  },
  comparisonLine: {
    color: '#E6E8EB',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 6,
  },
  more: {
    color: '#33C481',
    fontWeight: '700',
  },
  less: {
    color: '#F5A623',
    fontWeight: '700',
  },
});
