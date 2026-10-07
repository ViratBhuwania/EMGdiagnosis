import type { SessionAnalysis } from '../analysis/types';
import type { SessionSummaryRecord, SetUserTag } from './types';

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
  setTags: Record<number, SetUserTag> = {},
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
    sets: analysis.sets.map(set => {
      const setReps = analysis.reps.filter(r => r.setNumber === set.setNumber);
      return {
        setNumber: set.setNumber,
        label: setLabels[set.setNumber]?.trim() || null,
        repCount: set.repCount,
        meanActivationPct: set.meanActivationPct,
        meanArea: set.meanArea,
        peakEnvelope: set.peakEnvelope,
        p90Peak: set.p90Peak,
        firstRepStartSec: Math.min(...setReps.map(r => r.startSec)),
        fatigueDetected: set.fatigueDetected,
        fatigueStartRep: set.fatigueStartRep,
        userOutcome: setTags[set.setNumber]?.outcome ?? null,
        hand: setTags[set.setNumber]?.hand ?? null,
        durationSec:
          setReps.length > 0
            ? Math.max(...setReps.map(r => r.endSec)) - Math.min(...setReps.map(r => r.startSec))
            : undefined,
        fatigueAssessment: set.fatigueAssessment,
        mdfBinSeconds: set.mdfBinSeconds,
        mdfBinsHz: set.mdfBinsHz,
        zcrBinsHz: set.zcrBinsHz,
        mdfActiveSec: set.mdfActiveSec,
        mdfValidBins: set.mdfValidBins,
        summaryParts: set.summaryParts,
        mdfSlope: set.fatigueSlopeMdf,
        mdfR2: set.fatigueSlopeMdfR2,
        mdfDropPct: set.mdfDropPct,
        areaSlope: set.fatigueSlopeArea,
        areaR2: set.fatigueSlopeAreaR2,
        meanDurationSec: set.meanDurationSec,
        firstActivationPct: set.firstActivationPct,
        lastActivationPct: set.lastActivationPct,
      };
    }),
    sessionBestPeak: analysis.sessionBestPeak,
    calibrationReferenceAtTime,
    calibrationRelativePct,
    exerciseTag: exerciseTag.trim() || null,
    description: description.trim() || null,
    maxEffortReferenceAtTime: analysis.maxEffortReferenceUsed,
    rollingHistoricalPeakAtTime: analysis.rollingHistoricalPeakUsed,
    activationCeilingAtTime: analysis.activationCeiling,
  };
}
