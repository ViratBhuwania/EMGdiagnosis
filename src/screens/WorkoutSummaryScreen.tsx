import React from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SetSummaryRecord } from '../sessionHistory/types';
import { setColor } from '../components/setColors';
import { groupSetsByExercise } from '../sessionHistory/exerciseGroups';

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

/** Percent change of `to` relative to `from`, e.g. 20 means "20% more." */
function pctChange(from: number, to: number): number | null {
  if (from <= 0) {
    return null;
  }
  return ((to - from) / from) * 100;
}

interface ComparisonLineProps {
  later: SetSummaryRecord;
  earlier: SetSummaryRecord;
  laterNumber: number;
  earlierNumber: number;
  laterColor: string;
  earlierColor: string;
  firstToLast?: boolean;
}

/** "Set 2 had 12% more activation than Set 1." (with the weights when they differ). */
function ComparisonLine({
  later,
  earlier,
  laterNumber,
  earlierNumber,
  laterColor,
  earlierColor,
  firstToLast,
}: ComparisonLineProps) {
  const change = pctChange(earlier.p90Peak, later.p90Peak);
  const isMore = change !== null && change >= 0;
  const weightNote =
    later.weightKg != null && earlier.weightKg != null && later.weightKg !== earlier.weightKg
      ? ` (${later.weightKg} kg vs ${earlier.weightKg} kg)`
      : '';
  if (change === null) {
    return (
      <Text style={styles.comparisonLine}>
        {`Set ${laterNumber} vs. Set ${earlierNumber}: not comparable`}
      </Text>
    );
  }
  return (
    <Text style={styles.comparisonLine}>
      {firstToLast ? 'First to last: ' : ''}
      <Text style={{ color: laterColor }}>Set {laterNumber}</Text>
      {' had '}
      <Text style={isMore ? styles.more : styles.less}>
        {Math.abs(change).toFixed(1)}% {isMore ? 'more' : 'less'}
      </Text>
      {' activation than '}
      <Text style={{ color: earlierColor }}>Set {earlierNumber}</Text>
      {weightNote}.
    </Text>
  );
}

/**
 * Set-to-set comparison across the WHOLE workout (every saved Start/Stop
 * recording since Start Workout), grouped by exercise so each exercise's sets
 * are compared only with each other, distinct from SessionDetailScreen's
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
            {groupSetsByExercise(sets).map(group => (
              <View key={group.key || 'unlabelled'}>
                <Text style={styles.groupTitle}>
                  {group.title} · {group.items.length} {group.items.length === 1 ? 'set' : 'sets'}
                </Text>

                {group.items.map(({ set, workoutIndex }, n) => (
                  <View key={workoutIndex} style={styles.card}>
                    <Text style={[styles.setTitle, { color: setColor(workoutIndex + 1) }]}>
                      {`Set ${n + 1}${group.items.length > 1 ? ` of ${group.title}` : ''}`}
                    </Text>
                    <Text style={styles.line}>Reps: {set.repCount}</Text>
                    {set.weightKg != null && <Text style={styles.line}>Weight: {set.weightKg} kg</Text>}
                    <Text style={styles.line}>Mean 90th-percentile EMG: {set.p90Peak.toFixed(1)}</Text>
                    <Text style={styles.line}>Highest EMG reached: {set.peakEnvelope.toFixed(1)}</Text>
                  </View>
                ))}

                {group.items.length > 1 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>{group.title}: set-to-set comparison</Text>
                    {group.items.slice(1).map(({ set, workoutIndex }, i) => {
                      const prev = group.items[i];
                      return (
                        <ComparisonLine
                          key={workoutIndex}
                          later={set}
                          earlier={prev.set}
                          laterNumber={i + 2}
                          earlierNumber={i + 1}
                          laterColor={setColor(workoutIndex + 1)}
                          earlierColor={setColor(prev.workoutIndex + 1)}
                        />
                      );
                    })}
                    {group.items.length > 2 && (
                      <ComparisonLine
                        later={group.items[group.items.length - 1].set}
                        earlier={group.items[0].set}
                        laterNumber={group.items.length}
                        earlierNumber={1}
                        laterColor={setColor(group.items[group.items.length - 1].workoutIndex + 1)}
                        earlierColor={setColor(group.items[0].workoutIndex + 1)}
                        firstToLast
                      />
                    )}
                  </View>
                )}
              </View>
            ))}
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
  groupTitle: {
    color: '#E6E8EB',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 8,
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
