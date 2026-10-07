/**
 * The exercise tag (needed to look up `rollingHistoricalPeak`) is entered
 * in the summary panel AFTER Stop, but analyzeSession() already runs right
 * at Stop, before any tag exists. Rather than re-running the whole
 * detection pipeline when the tag is set/changed afterward, this cheaply
 * re-derives just the ceiling-dependent numbers (every rep's activationPct,
 * and the per-set stats built from it) from data analyzeSession() already
 * computed -- no FFT, no re-detection, just a re-scale.
 */
import type { RepFeatures, SessionAnalysis, SetFatigue } from './types';

function rescaleRep(rep: RepFeatures, ceiling: number): RepFeatures {
  return {
    ...rep,
    activationPct: ceiling > 0 ? (rep.peakRaw / ceiling) * 100 : 0,
  };
}

function rescaleSet(reps: RepFeatures[], original: SetFatigue): SetFatigue {
  const sub = reps.filter(r => r.setNumber === original.setNumber);
  const meanActivationPct = sub.reduce((a, r) => a + r.activationPct, 0) / sub.length;
  return {
    ...original,
    meanActivationPct,
    firstActivationPct: sub[0].activationPct,
    lastActivationPct: sub[sub.length - 1].activationPct,
  };
}

export function recomputeWithCeiling(
  analysis: SessionAnalysis,
  newCeiling: number,
  newRollingHistoricalPeakUsed: number | null,
): SessionAnalysis {
  if (newCeiling === analysis.activationCeiling) {
    return analysis;
  }
  const reps = analysis.reps.map(r => rescaleRep(r, newCeiling));
  const sets = analysis.sets.map(s => rescaleSet(reps, s));
  return {
    ...analysis,
    reps,
    sets,
    activationCeiling: newCeiling,
    rollingHistoricalPeakUsed: newRollingHistoricalPeakUsed,
  };
}
