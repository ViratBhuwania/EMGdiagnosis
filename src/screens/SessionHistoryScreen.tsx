import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { loadSessionHistory } from '../sessionHistory/sessionHistoryStore';
import type { SessionSummaryRecord } from '../sessionHistory/types';

interface SessionHistoryScreenProps {
  visible: boolean;
  profileId: string;
  onClose: () => void;
}

function formatDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/**
 * The previous session with the SAME exercise tag (untagged counts as its
 * own group), searching forward from `idx` in a list already sorted most-
 * recent-first. Computed against the full history regardless of any active
 * filter, so the delta shown never changes depending on what's visible --
 * filtering only narrows what's on screen, it doesn't change the math.
 */
function findPreviousSameTag(
  history: SessionSummaryRecord[],
  idx: number,
): SessionSummaryRecord | undefined {
  const tag = history[idx].exerciseTag;
  for (let i = idx + 1; i < history.length; i++) {
    if (history[i].exerciseTag === tag) {
      return history[i];
    }
  }
  return undefined;
}

/**
 * Past sessions, most recent first, each showing the one number that's
 * actually comparable across different days: peak activation as a
 * percentage of the calibration reference in effect at the time (not the
 * session-local activation %, which resets fresh every session and isn't
 * meaningful to compare day to day -- see buildSummary.ts). The delta
 * shown is against the previous session with the SAME exercise tag, not
 * just the previous session overall -- otherwise a "Bicep Curl" session
 * would get compared against an unrelated "Shoulder Press" session that
 * happened to be logged in between. Tag chips let you filter to one
 * exercise at a time for a cleaner trend view.
 */
export default function SessionHistoryScreen({
  visible,
  profileId,
  onClose,
}: SessionHistoryScreenProps) {
  const [history, setHistory] = useState<SessionSummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setLoading(true);
    setSelectedTag(null);
    loadSessionHistory(profileId).then(h => {
      setHistory([...h].sort((a, b) => b.timestampMs - a.timestampMs));
      setLoading(false);
    });
  }, [visible, profileId]);

  const tags = useMemo(() => {
    const seen = new Set<string>();
    for (const record of history) {
      if (record.exerciseTag) {
        seen.add(record.exerciseTag);
      }
    }
    return [...seen];
  }, [history]);

  const visibleIndices = useMemo(
    () =>
      history
        .map((record, idx) => idx)
        .filter(idx => selectedTag === null || history[idx].exerciseTag === selectedTag),
    [history, selectedTag],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Session History</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color="#2F6FED" style={styles.loading} />
        ) : history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No sessions recorded yet. Complete a session and it&apos;ll show up here.
            </Text>
          </View>
        ) : (
          <>
            {tags.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tagRow}
              >
                <Pressable
                  style={[styles.tagChip, selectedTag === null && styles.tagChipActive]}
                  onPress={() => setSelectedTag(null)}
                >
                  <Text
                    style={[
                      styles.tagChipLabel,
                      selectedTag === null && styles.tagChipLabelActive,
                    ]}
                  >
                    All
                  </Text>
                </Pressable>
                {tags.map(tag => (
                  <Pressable
                    key={tag}
                    style={[styles.tagChip, selectedTag === tag && styles.tagChipActive]}
                    onPress={() => setSelectedTag(tag)}
                  >
                    <Text
                      style={[
                        styles.tagChipLabel,
                        selectedTag === tag && styles.tagChipLabelActive,
                      ]}
                    >
                      {tag}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <ScrollView contentContainerStyle={styles.scroll}>
              {visibleIndices.map(idx => {
                const record = history[idx];
                const previous = findPreviousSameTag(history, idx);
                const delta =
                  record.calibrationRelativePct !== null &&
                  previous !== undefined &&
                  previous.calibrationRelativePct !== null
                    ? record.calibrationRelativePct - previous.calibrationRelativePct
                    : null;
                const fatigueCount = record.sets.filter(s => s.fatigueDetected).length;

                return (
                  <View key={record.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.date}>{formatDate(record.timestampMs)}</Text>
                      {record.exerciseTag && (
                        <View style={styles.exerciseTagBadge}>
                          <Text style={styles.exerciseTagBadgeText}>{record.exerciseTag}</Text>
                        </View>
                      )}
                    </View>
                    {record.description && (
                      <Text style={styles.description}>{record.description}</Text>
                    )}
                    {record.calibrationRelativePct !== null ? (
                      <View style={styles.relativeRow}>
                        <Text style={styles.relativeValue}>
                          {record.calibrationRelativePct.toFixed(0)}%
                        </Text>
                        <Text style={styles.relativeLabel}>of calibrated reference</Text>
                        {delta !== null && (
                          <Text
                            style={[
                              styles.delta,
                              { color: delta >= 0 ? '#33C481' : '#C62828' },
                            ]}
                          >
                            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
                          </Text>
                        )}
                      </View>
                    ) : (
                      <Text style={styles.noCalibration}>No calibration reference at the time</Text>
                    )}
                    <Text style={styles.caption}>
                      {record.totalReps} rep{record.totalReps === 1 ? '' : 's'} across{' '}
                      {record.sets.length} set{record.sets.length === 1 ? '' : 's'} ·{' '}
                      {fatigueCount}/{record.sets.length} reached fatigue
                    </Text>
                    {record.sets.length > 1 && (
                      <View style={styles.setsBreakdown}>
                        {record.sets.map(set => (
                          <View key={set.setNumber} style={styles.setBreakdownRow}>
                            <Text style={styles.setBreakdownLabel}>
                              {set.label?.trim() ? set.label : `Set ${set.setNumber}`}
                            </Text>
                            <Text style={styles.setBreakdownStats}>
                              {set.repCount} reps · {set.meanActivationPct.toFixed(0)}% ·{' '}
                              {set.fatigueDetected ? 'fatigue reached' : 'no fatigue'}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </>
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
  loading: {
    marginTop: 40,
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
  tagRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tagChip: {
    backgroundColor: '#1C1F26',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  tagChipActive: {
    backgroundColor: '#2F6FED',
  },
  tagChipLabel: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '700',
  },
  tagChipLabelActive: {
    color: '#FFFFFF',
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
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  date: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '600',
  },
  exerciseTagBadge: {
    backgroundColor: '#111318',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  exerciseTagBadgeText: {
    color: '#2F6FED',
    fontSize: 11,
    fontWeight: '700',
  },
  description: {
    color: '#8A8F98',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  relativeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  relativeValue: {
    color: '#33C481',
    fontSize: 24,
    fontWeight: '800',
    marginRight: 6,
  },
  relativeLabel: {
    color: '#8A8F98',
    fontSize: 11,
    flex: 1,
  },
  delta: {
    fontSize: 13,
    fontWeight: '700',
  },
  noCalibration: {
    color: '#8A8F98',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  caption: {
    color: '#E6E8EB',
    fontSize: 12,
  },
  setsBreakdown: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#2A2D35',
  },
  setBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  setBreakdownLabel: {
    color: '#E6E8EB',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 8,
    flexShrink: 1,
  },
  setBreakdownStats: {
    color: '#8A8F98',
    fontSize: 11,
  },
});
