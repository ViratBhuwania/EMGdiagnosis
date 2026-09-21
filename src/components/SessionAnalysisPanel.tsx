import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AnalysisResult } from '../analysis/analyzeSession';
import type { ActivationSummary } from '../types';

interface SessionAnalysisPanelProps {
  status: 'analyzing' | 'done';
  result: AnalysisResult | null;
  /** Manually-marked-rep summary, shown as a fallback if auto-detection couldn't find sets/reps. */
  fallbackSummary: ActivationSummary | null;
  /** Opens the full trace/bar-chart detail view. Omit to hide the button entirely. */
  onViewDetails?: () => void;
  /** 'pending' shows the Save/Discard choice; omit entirely to hide it (e.g. while still analyzing). */
  historyDecision?: 'pending' | 'saved' | 'discarded';
  onSaveToHistory?: () => void;
  onDiscardFromHistory?: () => void;
  /** Set number -> user-entered exercise name, e.g. for telling "Hammer Curl" apart from "Set 2". */
  setLabels?: Record<number, string>;
  onLabelChange?: (setNumber: number, label: string) => void;
  /** Session-level exercise tag (e.g. "Bicep Curl"), used to group sessions for across-day comparison. */
  exerciseTag?: string;
  onExerciseTagChange?: (tag: string) => void;
  /** Freeform notes for the user's own memory (e.g. "used the barbell today"), not used for grouping. */
  description?: string;
  onDescriptionChange?: (description: string) => void;
}

const FAILURE_MESSAGES: Record<string, string> = {
  too_few_samples: "This session was too short to analyze.",
  no_sets_detected: "No clear sets of activity were detected in this session.",
  no_reps_detected: "A set was detected, but individual reps couldn't be identified.",
};

function scoreOf10(pct: number): number {
  return Math.min(10, Math.max(1, Math.round(pct / 10)));
}

export default function SessionAnalysisPanel({
  status,
  result,
  fallbackSummary,
  onViewDetails,
  historyDecision,
  onSaveToHistory,
  onDiscardFromHistory,
  setLabels = {},
  onLabelChange,
  exerciseTag = '',
  onExerciseTagChange,
  description = '',
  onDescriptionChange,
}: SessionAnalysisPanelProps) {
  if (status === 'analyzing') {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#2F6FED" />
        <Text style={styles.analyzingText}>Analyzing session…</Text>
      </View>
    );
  }

  if (!result || !result.ok) {
    const message = result ? FAILURE_MESSAGES[result.reason] : 'Analysis unavailable.';
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Session Summary</Text>
        <Text style={styles.failureText}>{message}</Text>
        {fallbackSummary && (
          <View style={styles.fallback}>
            <Text style={styles.fallbackScore}>{fallbackSummary.averageScore10}/10</Text>
            <Text style={styles.fallbackCaption}>
              Based on your {fallbackSummary.repActivations.length} manually marked rep
              {fallbackSummary.repActivations.length === 1 ? '' : 's'}
            </Text>
          </View>
        )}
      </View>
    );
  }

  const { sets, lowActivationWarning } = result.analysis;
  const totalReps = sets.reduce((sum, set) => sum + set.repCount, 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Session Summary</Text>
      {lowActivationWarning && (
        <View style={styles.lowActivationBanner}>
          <Text style={styles.lowActivationText}>
            Activation was well below your calibrated reference this session — check your
            weight, form, or sensor placement.
          </Text>
        </View>
      )}
      <Text style={styles.totalReps}>
        Total reps: {totalReps} across {sets.length} set{sets.length === 1 ? '' : 's'}
      </Text>

      {onExerciseTagChange && (
        <TextInput
          style={styles.tagInput}
          value={exerciseTag}
          onChangeText={onExerciseTagChange}
          placeholder="Exercise tag (e.g. Bicep Curl) — groups sessions for comparison"
          placeholderTextColor="#5B6270"
        />
      )}
      {onDescriptionChange && (
        <TextInput
          style={styles.descriptionInput}
          value={description}
          onChangeText={onDescriptionChange}
          placeholder="Notes (e.g. used the barbell today)"
          placeholderTextColor="#5B6270"
          multiline
        />
      )}

      <Text style={styles.fatigueMethodNote}>
        Fatigue is estimated from amplitude trend — your device's BLE data rate is too low for
        the frequency-based confirmation signal.
      </Text>

      {sets.map(set => (
        <View key={set.setNumber} style={styles.setRow}>
          <View style={styles.setRowHeader}>
            <Text style={styles.setLabel}>Set {set.setNumber}</Text>
            <View style={[styles.fatigueBadge, !set.fatigueDetected && styles.fatigueBadgeNeutral]}>
              <Text
                style={[
                  styles.fatigueBadgeText,
                  !set.fatigueDetected && styles.fatigueBadgeTextNeutral,
                ]}
              >
                {set.fatigueDetected
                  ? /* Testing-only: rep number included for validating the
                       detection algorithm. The shipped UI should drop the
                       rep number -- see fatigueStartRep's doc comment. */
                    `Fatigue reached${
                      set.fatigueStartRep !== null ? ` (rep ${set.fatigueStartRep})` : ''
                    } — good going!`
                  : 'Fatigue not reached'}
              </Text>
            </View>
          </View>
          {onLabelChange && (
            <TextInput
              style={styles.labelInput}
              value={setLabels[set.setNumber] ?? ''}
              onChangeText={text => onLabelChange(set.setNumber, text)}
              placeholder="Add exercise name (e.g. Hammer Curl)"
              placeholderTextColor="#5B6270"
            />
          )}
          <View style={styles.setRowBody}>
            <Text style={styles.setScore}>{scoreOf10(set.meanActivationPct)}/10</Text>
            <Text style={styles.setCaption}>
              {set.repCount} rep{set.repCount === 1 ? '' : 's'} · avg activation
            </Text>
          </View>
        </View>
      ))}
      {historyDecision === 'pending' && onSaveToHistory && onDiscardFromHistory && (
        <View style={styles.historyDecisionRow}>
          <Pressable style={styles.saveButton} onPress={onSaveToHistory}>
            <Text style={styles.saveButtonLabel}>Save to History</Text>
          </Pressable>
          <Pressable style={styles.discardButton} onPress={onDiscardFromHistory}>
            <Text style={styles.discardButtonLabel}>Discard (just testing)</Text>
          </Pressable>
        </View>
      )}
      {historyDecision === 'saved' && (
        <Text style={styles.historyStatusText}>✓ Saved to history</Text>
      )}
      {historyDecision === 'discarded' && (
        <Text style={styles.historyStatusText}>Discarded — not saved to history</Text>
      )}

      {onViewDetails && (
        <Pressable style={styles.detailsButton} onPress={onViewDetails}>
          <Text style={styles.detailsButtonLabel}>View Full Summary &amp; Charts</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  analyzingText: {
    color: '#8A8F98',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  title: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  failureText: {
    color: '#E6E8EB',
    fontSize: 13,
  },
  totalReps: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  lowActivationBanner: {
    backgroundColor: '#2A1414',
    borderColor: '#C62828',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  lowActivationText: {
    color: '#F28B82',
    fontSize: 12,
    lineHeight: 17,
  },
  fallback: {
    marginTop: 12,
    alignItems: 'center',
  },
  fallbackScore: {
    color: '#33C481',
    fontSize: 28,
    fontWeight: '800',
  },
  fallbackCaption: {
    color: '#8A8F98',
    fontSize: 12,
    marginTop: 2,
  },
  tagInput: {
    backgroundColor: '#111318',
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 8,
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  descriptionInput: {
    backgroundColor: '#111318',
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 8,
    color: '#E6E8EB',
    fontSize: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 8,
    minHeight: 40,
    textAlignVertical: 'top',
  },
  fatigueMethodNote: {
    color: '#5B6270',
    fontSize: 10,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  setRow: {
    marginBottom: 12,
  },
  setRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  setLabel: {
    color: '#E6E8EB',
    fontSize: 14,
    fontWeight: '700',
  },
  fatigueBadge: {
    backgroundColor: '#2A1F14',
    borderColor: '#F5A623',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  fatigueBadgeText: {
    color: '#F5A623',
    fontSize: 11,
    fontWeight: '700',
  },
  fatigueBadgeNeutral: {
    backgroundColor: '#1A1D24',
    borderColor: '#3A3F4B',
  },
  fatigueBadgeTextNeutral: {
    color: '#8A8F98',
  },
  detailsButton: {
    marginTop: 6,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#2A2D35',
  },
  detailsButtonLabel: {
    color: '#2F6FED',
    fontSize: 13,
    fontWeight: '700',
  },
  historyDecisionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#2E7D32',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveButtonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  discardButton: {
    flex: 1,
    backgroundColor: '#2A2D35',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  discardButtonLabel: {
    color: '#8A8F98',
    fontSize: 13,
    fontWeight: '700',
  },
  historyStatusText: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  labelInput: {
    backgroundColor: '#111318',
    borderColor: '#3A3F4B',
    borderWidth: 1,
    borderRadius: 8,
    color: '#E6E8EB',
    fontSize: 13,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  setRowBody: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  setScore: {
    color: '#33C481',
    fontSize: 22,
    fontWeight: '800',
    marginRight: 8,
  },
  setCaption: {
    color: '#8A8F98',
    fontSize: 12,
  },
});
