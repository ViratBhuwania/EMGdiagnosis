import React from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SessionAnalysis } from '../analysis/types';
import SessionTraceChart from '../components/SessionTraceChart';
import ActivationBarChart from '../components/ActivationBarChart';
import { setColor } from '../components/setColors';

interface SessionDetailScreenProps {
  visible: boolean;
  analysis: SessionAnalysis | null;
  /** Set number -> user-entered exercise name, shown alongside "Set N" when present. */
  setLabels?: Record<number, string>;
  onClose: () => void;
}

/**
 * Full-session review: the mobile equivalent of what
 * rep_detector_emg_primary_v2.py's plot_results()/plot_summary_screen()
 * showed on the desktop -- the EMG trace with detected sets/reps overlaid,
 * a per-rep activation bar chart, and per-set fatigue detail. Presented as
 * a full-screen modal over the live session screen rather than a separate
 * app-level screen, since it's a drill-down into the session just finished,
 * not a distinct navigation destination.
 */
export default function SessionDetailScreen({
  visible,
  analysis,
  setLabels = {},
  onClose,
}: SessionDetailScreenProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Session Details</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>

        {analysis ? (
          <ScrollView contentContainerStyle={styles.scroll}>
            <SessionTraceChart
              title="EMG Trace"
              timesSec={analysis.timesSec}
              values={analysis.smoothDet}
              setSpansSec={analysis.setSpansSec}
              reps={analysis.reps}
              height={200}
            />
            <ActivationBarChart reps={analysis.reps} />
            {analysis.sets.map(set => (
              <View key={set.setNumber} style={styles.setDetailCard}>
                <Text style={[styles.setDetailTitle, { color: setColor(set.setNumber) }]}>
                  Set {set.setNumber}
                  {setLabels[set.setNumber]?.trim() ? ` — ${setLabels[set.setNumber]}` : ''}
                </Text>
                <Text style={styles.setDetailLine}>Reps: {set.repCount}</Text>
                <Text style={styles.setDetailLine}>
                  Activation — first: {set.firstActivationPct.toFixed(0)}% · last:{' '}
                  {set.lastActivationPct.toFixed(0)}% · mean: {set.meanActivationPct.toFixed(0)}%
                </Text>
                <Text style={styles.setDetailLine}>
                  Mean duration: {set.meanDurationSec.toFixed(2)}s · Mean area:{' '}
                  {set.meanArea.toFixed(1)}
                </Text>
                {set.fatigueSlopeArea !== null && (
                  <Text style={styles.setDetailLine}>
                    Area slope: {set.fatigueSlopeArea.toFixed(2)}/rep
                    {set.fatigueSlopeAreaR2 !== null ? ` (r²=${set.fatigueSlopeAreaR2.toFixed(2)})` : ''}
                  </Text>
                )}
                {set.fatigueSlopeMdf !== null && (
                  <Text style={styles.setDetailLine}>
                    MDF slope: {set.fatigueSlopeMdf.toFixed(2)} Hz/rep
                    {set.fatigueSlopeMdfR2 !== null ? ` (r²=${set.fatigueSlopeMdfR2.toFixed(2)})` : ''}
                  </Text>
                )}
                <Text
                  style={[
                    styles.fatigueLine,
                    { color: set.fatigueDetected ? '#F5A623' : '#8A8F98' },
                  ]}
                >
                  {set.fatigueDetected
                    ? `Fatigue reached${
                        set.fatigueStartRep !== null ? ` at rep ${set.fatigueStartRep}` : ''
                      }`
                    : 'Fatigue not reached'}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No analysis available for this session.</Text>
          </View>
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
  scroll: {
    padding: 16,
    paddingBottom: 32,
  },
  setDetailCard: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  setDetailTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  setDetailLine: {
    color: '#E6E8EB',
    fontSize: 12,
    marginBottom: 3,
  },
  fatigueLine: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#8A8F98',
    fontSize: 14,
  },
});
