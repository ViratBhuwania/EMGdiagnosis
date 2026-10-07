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

/**
 * Named distinctly from analyzeHold()/compute_calibration_value() on
 * purpose, so the two extraction methods are never accidentally conflated
 * or swapped: a true maximal contraction can't be sustained the way a
 * submax hold can. High-threshold motor units start dropping out within a
 * couple of seconds, so force decays almost immediately after the initial
 * peak -- there's no steady plateau to take a percentile over. The whole
 * capture is ~4-5s: ~1s ramp-up, ~2-3s of genuine max effort, ~1s release.
 * Both ends are trimmed away (not just the start) and the single highest
 * envelope value within what's left is taken -- the true peak could land
 * anywhere in that 2-3s window, so no percentile or averaging is applied
 * to it either. Null if there isn't enough data left after trimming to
 * trust the result.
 */
export function extractMaxEffortValue(
  samples: HoldSample[],
  rampTrimS: number = 1.0,
  releaseTrimS: number = 1.0,
): number | null {
  if (samples.length === 0) {
    return null;
  }
  const totalDuration = samples[samples.length - 1].elapsedSec;
  const effortWindow = samples.filter(
    s => s.elapsedSec >= rampTrimS && s.elapsedSec <= totalDuration - releaseTrimS,
  );
  if (effortWindow.length < 5) {
    return null;
  }
  return Math.max(...effortWindow.map(s => s.envelope));
}
