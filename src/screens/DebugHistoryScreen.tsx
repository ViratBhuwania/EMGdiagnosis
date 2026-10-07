import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { deleteAllSessions, deleteSet, loadSessionHistory } from '../sessionHistory/sessionHistoryStore';
import type { SessionSummaryRecord } from '../sessionHistory/types';
import { formatSessionDataText } from '../sessionHistory/setDataExport';

interface DebugHistoryScreenProps {
  visible: boolean;
  profileId: string;
  onClose: () => void;
}

function formatDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;
}

/**
 * Sessions saved before these debug fields existed have them missing
 * (undefined) once loaded from disk, even though the type says `number` --
 * the type describes what NEW saves write, not what's already on disk. Every
 * display of a possibly-legacy value goes through this instead of a raw
 * .toFixed(), so an old record shows "N/A" instead of crashing the screen.
 */
function fmtOrNA(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? 'N/A' : value.toFixed(1);
}

function formatElapsed(sec: number | undefined): string {
  if (sec === undefined || Number.isNaN(sec)) {
    return 'N/A';
  }
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Raw/technical companion to SessionHistoryScreen, for debugging the
 * calibration ceiling logic specifically -- not meant for regular use.
 * Shows exactly what fed activationCeiling for each saved session, and
 * each set's own 90th-percentile peak next to it, so it's visible which
 * source (max-effort test, rolling historical peak, or the session's own
 * peak) is governing activationPct, and whether a given set actually
 * reached that ceiling.
 */
export default function DebugHistoryScreen({ visible, profileId, onClose }: DebugHistoryScreenProps) {
  const [history, setHistory] = useState<SessionSummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setLoading(true);
    setSelectedId(null);
    loadSessionHistory(profileId).then(h => {
      setHistory([...h].sort((a, b) => b.timestampMs - a.timestampMs));
      setLoading(false);
    });
  }, [visible, profileId]);

  const selected = history.find(s => s.id === selectedId) ?? null;

  const handleDeleteSet = useCallback(
    (sessionId: string, setNumber: number) => {
      Alert.alert(
        'Delete this set?',
        `This permanently deletes Set ${setNumber}'s data. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteSet(profileId, sessionId, setNumber).then(updated => {
                setHistory([...updated].sort((a, b) => b.timestampMs - a.timestampMs));
                // The session itself is gone if that was its last set.
                if (!updated.some(s => s.id === sessionId)) {
                  setSelectedId(null);
                }
              });
            },
          },
        ],
      );
    },
    [profileId],
  );

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      'Delete all sessions?',
      'This permanently deletes every saved session for this profile. This cannot be undone. Calibration and max-effort data are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: () => {
            deleteAllSessions(profileId).then(() => {
              setHistory([]);
              setSelectedId(null);
            });
          },
        },
      ],
    );
  }, [profileId]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Debug: History</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color="#2F6FED" style={styles.loading} />
        ) : history.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No sessions saved yet.</Text>
          </View>
        ) : selected ? (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Pressable style={styles.backLink} onPress={() => setSelectedId(null)}>
              <Text style={styles.backLinkLabel}>‹ All sessions</Text>
            </Pressable>

            <Text style={styles.sessionDate}>{formatDate(selected.timestampMs)}</Text>
            <Pressable
              style={styles.backLink}
              onPress={() => Share.share({ message: formatSessionDataText(selected) }).catch(() => {})}
            >
              <Text style={styles.backLinkLabel}>Share this session&apos;s data</Text>
            </Pressable>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ceiling used this session</Text>
              <Text style={styles.debugLine}>
                Max-effort reference: {fmtOrNA(selected.maxEffortReferenceAtTime)}
              </Text>
              <Text style={styles.debugLine}>
                Rolling historical peak: {fmtOrNA(selected.rollingHistoricalPeakAtTime)}
              </Text>
              <Text style={styles.debugLine}>Session&apos;s own peak: {fmtOrNA(selected.sessionBestPeak)}</Text>
              <Text style={styles.ceilingValue}>= {fmtOrNA(selected.activationCeilingAtTime)}</Text>
            </View>

            {selected.sets.map(set => {
              const hasCeilingData =
                set.p90Peak !== undefined &&
                !Number.isNaN(set.p90Peak) &&
                selected.activationCeilingAtTime !== undefined &&
                !Number.isNaN(selected.activationCeilingAtTime);
              const atCeiling = hasCeilingData && set.p90Peak >= selected.activationCeilingAtTime;
              return (
                <View key={set.setNumber} style={styles.card}>
                  <View style={styles.setHeader}>
                    <Text style={styles.cardTitle}>
                      Set {set.setNumber}
                      {set.label ? ` — ${set.label}` : ''}
                    </Text>
                    <Text style={styles.timeIntoSession}>
                      at {formatElapsed(set.firstRepStartSec)} into session
                    </Text>
                  </View>
                  <Text style={styles.debugLine}>Reps: {set.repCount}</Text>
                  <Text style={styles.debugLine}>
                    Your label:{' '}
                    {set.userOutcome === 'failure' ? 'reached failure' : set.userOutcome === 'easy' ? 'easy' : 'not labeled'}
                    {set.hand ? ` · ${set.hand === 'L' ? 'left' : 'right'} arm` : ''}
                  </Text>
                  {set.mdfBinsHz && set.mdfBinsHz.length > 0 && (
                    <Text style={styles.debugLine}>
                      MDF Hz: {set.mdfBinsHz.map(x => (x === null ? '–' : x.toFixed(1))).join('  ')}
                    </Text>
                  )}
                  <Text style={styles.debugLine}>Peak (max): {fmtOrNA(set.peakEnvelope)}</Text>
                  <Text style={styles.debugLine}>Peak (90th percentile): {fmtOrNA(set.p90Peak)}</Text>
                  <View
                    style={[
                      styles.badge,
                      hasCeilingData ? (atCeiling ? styles.badgeHit : styles.badgeMiss) : styles.badgeMiss,
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {hasCeilingData ? (atCeiling ? 'At or above ceiling' : 'Below ceiling') : 'N/A'}
                    </Text>
                  </View>
                  {set.fatigueDetected && (
                    <Text style={styles.fatigueLine}>
                      Fatigue reached{set.fatigueStartRep !== null ? ` at rep ${set.fatigueStartRep}` : ''}
                    </Text>
                  )}
                  <Pressable
                    style={styles.deleteSetButton}
                    onPress={() => handleDeleteSet(selected.id, set.setNumber)}
                  >
                    <Text style={styles.deleteSetButtonLabel}>Delete Set</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Pressable style={styles.deleteAllButton} onPress={handleDeleteAll}>
              <Text style={styles.deleteAllButtonLabel}>Delete All Sessions</Text>
            </Pressable>
            {history.map(record => (
              <Pressable key={record.id} style={styles.card} onPress={() => setSelectedId(record.id)}>
                <Text style={styles.sessionDate}>{formatDate(record.timestampMs)}</Text>
                <Text style={styles.debugLine}>
                  {record.totalReps} reps across {record.sets.length} set{record.sets.length === 1 ? '' : 's'}
                </Text>
                <Text style={styles.debugLine}>Ceiling used: {fmtOrNA(record.activationCeilingAtTime)}</Text>
              </Pressable>
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
  scroll: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 32,
  },
  backLink: {
    paddingVertical: 10,
  },
  backLinkLabel: {
    color: '#2F6FED',
    fontSize: 14,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardTitle: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  sessionDate: {
    color: '#E6E8EB',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  debugLine: {
    color: '#8A8F98',
    fontSize: 12,
    fontFamily: 'Courier',
    marginBottom: 2,
  },
  ceilingValue: {
    color: '#33C481',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
  },
  setHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  timeIntoSession: {
    color: '#5B6270',
    fontSize: 11,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  badgeHit: {
    backgroundColor: '#14231F',
  },
  badgeMiss: {
    backgroundColor: '#1A1D24',
  },
  badgeText: {
    color: '#8A8F98',
    fontSize: 11,
    fontWeight: '700',
  },
  fatigueLine: {
    color: '#F5A623',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
  },
  deleteAllButton: {
    backgroundColor: '#2A1414',
    borderColor: '#C62828',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 14,
  },
  deleteAllButtonLabel: {
    color: '#F28B82',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteSetButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  deleteSetButtonLabel: {
    color: '#C62828',
    fontSize: 12,
    fontWeight: '700',
  },
});
