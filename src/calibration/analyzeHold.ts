export interface HoldSample {
  envelope: number;
  elapsedSec: number;
}

export interface HoldAnalysis {
  referenceValue: number;
  isStable: boolean;
  coefficientOfVariation: number;
}

const TRIM_SECONDS = 0.5;
/**
 * Relative variability (stdDev/mean) above this in the hold's stable middle
 * window suggests something went wrong mid-hold (electrode shift, losing
 * position) rather than a genuinely steady contraction. A starting point,
 * not a validated threshold -- worth tuning against real holds.
 */
const MAX_COEFFICIENT_OF_VARIATION = 0.4;

/**
 * Trims ramp-up/relax noise off each end of a hold and summarizes the
 * stable middle: its mean (the candidate calibration value) and whether it
 * looked steady enough to trust. Null if there isn't enough clean data
 * (hold was too short, or entirely trimmed away).
 */
export function analyzeHold(samples: HoldSample[]): HoldAnalysis | null {
  if (samples.length === 0) {
    return null;
  }
  const totalDuration = samples[samples.length - 1].elapsedSec;
  const middle = samples.filter(
    s => s.elapsedSec >= TRIM_SECONDS && s.elapsedSec <= totalDuration - TRIM_SECONDS,
  );
  if (middle.length < 5) {
    return null;
  }

  const values = middle.map(s => s.envelope);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = mean > 0 ? stdDev / mean : Infinity;

  return {
    referenceValue: mean,
    isStable: coefficientOfVariation <= MAX_COEFFICIENT_OF_VARIATION,
    coefficientOfVariation,
  };
}
