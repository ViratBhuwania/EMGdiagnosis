/**
 * Light-effort gate: movement with almost no muscle effort (a warm-up wave,
 * an unloaded arm swing) still looks like reps to the swing detector, because
 * every other gate is relative to the set's own strongest reps. This gate
 * compares a set's strong-rep level (p90 of rep peaks) to an absolute
 * reference the user has already established.
 *
 * Reference, best first: max(max-effort, rolling historical peak) with a
 * 0.20x floor; else the submax calibration hold with a 0.35x floor; else no
 * gate (cold start -- nothing to compare against). Fitted on 17 Oct data:
 * real working sets had p90 peaks of 1931-5651, the warm-up 246.
 */
export const LIGHT_EFFORT_FRAC_OF_CEILING = 0.2;
export const LIGHT_EFFORT_FRAC_OF_CALIBRATION = 0.35;

export interface LightEffortFloor {
  floor: number;
  reference: number;
}

export function lightEffortFloor(
  calibrationReference: number | null,
  maxEffortReference: number | null,
  rollingHistoricalPeak: number | null,
): LightEffortFloor | null {
  const ceiling = Math.max(maxEffortReference ?? 0, rollingHistoricalPeak ?? 0);
  if (ceiling > 0) {
    return { floor: LIGHT_EFFORT_FRAC_OF_CEILING * ceiling, reference: ceiling };
  }
  if (calibrationReference !== null && calibrationReference > 0) {
    return { floor: LIGHT_EFFORT_FRAC_OF_CALIBRATION * calibrationReference, reference: calibrationReference };
  }
  return null;
}
