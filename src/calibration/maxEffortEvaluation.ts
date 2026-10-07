/**
 * PLACEHOLDER -- not a validated number. Set low enough that it should
 * essentially never reject a genuine maximal effort, but high enough to
 * catch an attempt that came back barely different from the submax hold,
 * which is a clear failure signal (distraction, dropped effort, electrode
 * issue). This very likely needs to scale per person (e.g. relative to
 * their own rolling historical peak once one exists) rather than being a
 * single global constant, since a fixed submax load is a much smaller
 * fraction of true capacity for a strong person than a weaker one.
 *
 * DO NOT change this based on assumption -- see the validation script this
 * calibration module's design was requested alongside: it computes
 * max_effort_peak / submax_peak across real recorded people first, and
 * only then should this constant move.
 */
export const MAX_EFFORT_MIN_RATIO = 1.5;

export interface MaxEffortEvaluation {
  accepted: boolean;
  ratioAchieved: number;
  ratioRequired: number;
}

/**
 * Whether a freshly-captured max-effort reading clears the minimum bar
 * against that day's submax reference. This is the only gate a max-effort
 * reading gets -- it's captured once with no scheduled second chance, so a
 * bad single attempt would otherwise persist indefinitely with nothing to
 * catch it.
 */
export function evaluateMaxEffortAttempt(
  candidateValue: number,
  submaxReference: number,
): MaxEffortEvaluation {
  const ratioAchieved = submaxReference > 0 ? candidateValue / submaxReference : 0;
  return {
    accepted: ratioAchieved >= MAX_EFFORT_MIN_RATIO,
    ratioAchieved,
    ratioRequired: MAX_EFFORT_MIN_RATIO,
  };
}
