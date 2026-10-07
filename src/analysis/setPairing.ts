/**
 * Shared pairing types for matching the firmware's per-set summaries with the
 * sets the phone detected from the live stream (see summaryMdf.ts). There is
 * no shared clock between the two, so pairing goes by order plus a duration
 * check.
 */

/**
 * A summary and a detected set are only paired if their durations agree within
 * this fraction. Loose on purpose: the detected span can legitimately run
 * longer than the summary's active time (rests inside a set, the 2 s smoothing
 * window, the 8 s rest rule), while a genuinely different burst of activity is
 * off by far more.
 */
export const MAX_DURATION_MISMATCH_FRAC = 0.35;

/** One detected set's overall span, e.g. SessionAnalysis.setSpansSec zipped with its 1-based position (setNumber). */
export interface DetectedSetSpan {
  setNumber: number;
  startSec: number;
  endSec: number;
}
