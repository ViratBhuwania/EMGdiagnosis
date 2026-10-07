import React from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import type { SessionAnalysis } from '../analysis/types';
import SessionTraceChart from '../components/SessionTraceChart';
import ActivationBarChart from '../components/ActivationBarChart';
import FusionDebugChart from '../components/FusionDebugChart';
import { setColor } from '../components/setColors';
import { buildSessionSummaryRecord } from '../sessionHistory/buildSummary';
import { formatSessionDataText } from '../sessionHistory/setDataExport';
import type { SetUserTag } from '../sessionHistory/types';

interface SessionDetailScreenProps {
  visible: boolean;
  analysis: SessionAnalysis | null;
  /** Set number -> user-entered exercise name, shown alongside "Set N" when present. */
  setLabels?: Record<number, string>;
  /** Set number -> the user's failure/easy + hand label. */
  setTags?: Record<number, SetUserTag>;
  onSetTagChange?: (setNumber: number, patch: SetUserTag) => void;
  exerciseTag?: string;
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
function SessionDetailScreen({
  visible,
  analysis,
  setLabels = {},
  setTags = {},
  onSetTagChange,
  exerciseTag = '',
  onClose,
}: SessionDetailScreenProps) {
  const shareSetData = () => {
    if (!analysis) {
      return;
    }
    const record = buildSessionSummaryRecord(analysis, null, setLabels, exerciseTag, '', setTags);
    Share.share({ message: formatSessionDataText(record) }).catch(() => {});
  };
  const binsText = (v?: Array<number | null>) =>
    v && v.length > 0 ? v.map(x => (x === null ? '–' : x.toFixed(1))).join('  ') : null;
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
          {analysis && (
            <Pressable onPress={shareSetData} hitSlop={8}>
              <Text style={styles.closeLabel}>Share data</Text>
            </Pressable>
          )}
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
              height={120}
            />
            <ActivationBarChart reps={analysis.reps} />
            {analysis.fusedAngle && <FusionDebugChart track={analysis.fusedAngle} />}
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
                    MDF slope: {set.fatigueSlopeMdf.toFixed(2)} Hz/{set.mdfBinSeconds ? `${set.mdfBinSeconds}s` : 'rep'}
                    {set.fatigueSlopeMdfR2 !== null ? ` (r²=${set.fatigueSlopeMdfR2.toFixed(2)})` : ''}
                  </Text>
                )}
                {set.mdfDropPct !== undefined && (
                  <Text style={styles.setDetailLine}>
                    MDF change: {set.mdfDropPct.toFixed(1)}% (first → last third)
                  </Text>
                )}
                <Text
                  style={[
                    styles.fatigueLine,
                    { color: set.fatigueDetected ? '#F5A623' : '#8A8F98' },
                  ]}
                >
                  {set.fatigueAssessment === 'no-summary'
                    ? 'Fatigue: not assessed (no set summary yet)'
                    : set.fatigueAssessment === 'too-short'
                      ? 'Fatigue: set too short to judge'
                      : set.fatigueDetected
                        ? `Fatigue reached${
                            set.fatigueStartRep !== null ? ` at rep ${set.fatigueStartRep}` : ''
                          }`
                        : 'Fatigue not reached'}
                </Text>
                {binsText(set.mdfBinsHz) && (
                  <Text style={styles.dataLine}>
                    MDF Hz (per {set.mdfBinSeconds}s): {binsText(set.mdfBinsHz)}
                  </Text>
                )}
                {binsText(set.zcrBinsHz) && (
                  <Text style={styles.dataLine}>ZCR Hz: {binsText(set.zcrBinsHz)}</Text>
                )}
                {set.mdfActiveSec !== undefined && (
                  <Text style={styles.dataLine}>
                    Active {set.mdfActiveSec.toFixed(1)}s · valid bins {set.mdfValidBins}/{set.mdfBinsHz?.length ?? '?'}
                    {set.summaryParts && set.summaryParts > 1 ? ` · ${set.summaryParts} summaries joined` : ''}
                  </Text>
                )}
                {onSetTagChange && (
                  <View style={styles.tagBlock}>
                    <Text style={styles.tagTitle}>Your label for this set</Text>
                    <View style={styles.tagRow}>
                      {(['failure', 'easy'] as const).map(o => {
                        const on = setTags[set.setNumber]?.outcome === o;
                        return (
                          <Pressable
                            key={o}
                            style={[styles.tagButton, on && styles.tagButtonOn]}
                            onPress={() => onSetTagChange(set.setNumber, { outcome: on ? null : o })}
                          >
                            <Text style={[styles.tagButtonLabel, on && styles.tagButtonLabelOn]}>
                              {o === 'failure' ? 'Reached failure' : 'Easy / stopped early'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={styles.tagRow}>
                      {(['L', 'R'] as const).map(h => {
                        const on = setTags[set.setNumber]?.hand === h;
                        return (
                          <Pressable
                            key={h}
                            style={[styles.tagButton, on && styles.tagButtonOn]}
                            onPress={() => onSetTagChange(set.setNumber, { hand: on ? null : h })}
                          >
                            <Text style={[styles.tagButtonLabel, on && styles.tagButtonLabelOn]}>
                              {h === 'L' ? 'Left arm' : 'Right arm'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}
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

/**
 * Memoized because this tree holds the heavy Skia canvases
 * (SessionTraceChart, FusionDebugChart), which otherwise re-render (and
 * RNSkia re-commits the native scene) on every ancestor re-render even
 * while this modal is closed -- see LiveSessionScreen's onClose comment
 * for why that requires the caller to pass a stable callback too.
 */
export default React.memo(SessionDetailScreen);

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
    borderRadius: 14,
    padding: 20,
    marginBottom: 14,
  },
  setDetailTitle: {
    fontSize: 19,
    fontWeight: '800',
    marginBottom: 10,
  },
  setDetailLine: {
    color: '#E6E8EB',
    fontSize: 14,
    marginBottom: 6,
    lineHeight: 20,
  },
  fatigueLine: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
  },
  dataLine: {
    color: '#8A8F98',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  tagBlock: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#2A2E37',
    paddingTop: 12,
  },
  tagTitle: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  tagButton: {
    borderWidth: 1,
    borderColor: '#3A3F4A',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tagButtonOn: {
    backgroundColor: '#2F6FED',
    borderColor: '#2F6FED',
  },
  tagButtonLabel: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
  },
  tagButtonLabelOn: {
    color: '#FFFFFF',
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
