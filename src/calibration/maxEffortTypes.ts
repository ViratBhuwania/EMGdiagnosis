/**
 * The one-time, resisted maximal-effort reading -- distinct from the
 * existing submax hold (CalibrationRecord in types.ts), which stays
 * unchanged and keeps correcting for that day's skin/electrode conditions.
 * This captures the person's actual ceiling instead, so activation % can be
 * anchored to something more meaningful than "the best rep so far."
 */
export interface MaxEffortRecord {
  timestampMs: number;
  /** Peak envelope reached during the accepted resisted max-effort attempt. */
  value: number;
  /** The submax reference this reading was validated against at capture time. */
  submaxReferenceAtCapture: number;
  /** value / submaxReferenceAtCapture -- kept for later threshold tuning. */
  ratioAchieved: number;
}

/** A max-effort attempt that failed the minimum-ratio sanity check and was NOT stored. */
export interface RejectedMaxEffortAttempt {
  timestampMs: number;
  value: number;
  submaxReferenceAtCapture: number;
  ratioAchieved: number;
  ratioRequired: number;
}

export interface MaxEffortStatus {
  /** The current accepted reading, if the one-time test has been done. Null until then. */
  accepted: MaxEffortRecord | null;
  /** Every rejected attempt, oldest first -- for tuning MAX_EFFORT_MIN_RATIO once real data exists. */
  rejectedAttempts: RejectedMaxEffortAttempt[];
}
