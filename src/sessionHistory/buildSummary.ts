import type { SessionAnalysis } from '../analysis/types';
import type { SessionSummaryRecord } from './types';

/**
 * Turns a freshly-computed SessionAnalysis into the compact record saved to
 * history. `setLabels` (set number -> user-entered exercise name) and the
 * session-level `exerciseTag`/`description` all come from the summary
 * panel, since labeling happens after analysis, not as part of it.
 */
export function buildSessionSummaryRecord(
  analysis: SessionAnalysis,
  calibrationReferenceAtTime: number | null,
  setLabels: Record<number, string> = {},
  exerciseTag: string = '',
  description: string = '',
): SessionSummaryRecord {
  const totalReps = analysis.sets.reduce((sum, set) => sum + set.repCount, 0);
  const calibrationRelativePct =
    calibrationReferenceAtTime !== null && calibrationReferenceAtTime > 0
      ? (analysis.sessionBestPeak / calibrationReferenceAtTime) * 100
      : null;

  return {
    id: `${Date.now()}`,
    timestampMs: Date.now(),
    sampleRateHz: analysis.sampleRateHz,
    totalReps,
    sets: analysis.sets.map(set => ({
      setNumber: set.setNumber,
      label: setLabels[set.setNumber]?.trim() || null,
      repCount: set.repCount,
      meanActivationPct: set.meanActivationPct,
      meanArea: set.meanArea,
      fatigueDetected: set.fatigueDetected,
      fatigueStartRep: set.fatigueStartRep,
    })),
    sessionBestPeak: analysis.sessionBestPeak,
    calibrationReferenceAtTime,
    calibrationRelativePct,
    exerciseTag: exerciseTag.trim() || null,
    description: description.trim() || null,
  };
}
