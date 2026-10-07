/** The user's own judgement of a set, entered in Session Details -- the ground truth for tuning the fatigue rule. */
export type SetOutcome = 'failure' | 'easy';
export type SetHand = 'L' | 'R';
export interface SetUserTag {
  outcome?: SetOutcome | null;
  hand?: SetHand | null;
}

/** Per-set slice of a saved session summary -- enough to show a history list, not full detail. */
export interface SetSummaryRecord {
  setNumber: number;
  /** User-entered exercise name for this set (e.g. "Hammer Curl"), or null if never labeled. */
  label: string | null;
  repCount: number;
  /** Session-local activation % (relative to that session's own best rep) -- NOT comparable across sessions. */
  meanActivationPct: number;
  /** Total work done in this set -- meaningful alongside activation % when comparing sets. */
  meanArea: number;
  /** Highest single-rep peak in this set -- used by the max-effort retest trigger to check against the *current* ceiling, since the ceiling can grow after this set was recorded. */
  peakEnvelope: number;
  /** 90th percentile of THIS SET's own rep peaks (not the whole session's) -- debug/comparison value, distinct from the session-wide session_summary_value fed into the rolling window. */
  p90Peak: number;
  /** Elapsed seconds into the recording when this set's first rep started -- for showing sets in order within a session; not a wall-clock timestamp (the session's own timestampMs is roughly "when Save was tapped," not each set's actual moment). */
  firstRepStartSec: number;
  fatigueDetected: boolean;
  fatigueStartRep: number | null;
  /** The user's label for this set: did they reach failure, or was it an easy/stopped-early set. Null/absent = not labeled. */
  userOutcome?: SetOutcome | null;
  /** Which arm the set was done with. */
  hand?: SetHand | null;
  /** First rep start to last rep end, seconds. */
  durationSec?: number;
  /** Everything below is the raw material of the fatigue verdict (summary path); absent on older records. */
  fatigueAssessment?: 'assessed' | 'too-short' | 'no-summary';
  mdfBinSeconds?: number;
  mdfBinsHz?: Array<number | null>;
  zcrBinsHz?: Array<number | null>;
  mdfActiveSec?: number;
  mdfValidBins?: number;
  summaryParts?: number;
  mdfSlope?: number | null;
  mdfR2?: number | null;
  mdfDropPct?: number;
  areaSlope?: number | null;
  areaR2?: number | null;
  meanDurationSec?: number;
  firstActivationPct?: number;
  lastActivationPct?: number;
}

/**
 * One completed, successfully-analyzed session, saved automatically after
 * Stop so it can be compared against other days. Deliberately does NOT
 * store the raw sensor rows or full per-rep detail -- that's what the XLSX
 * export is for; this is just enough to power a history/trend view.
 */
export interface SessionSummaryRecord {
  id: string;
  timestampMs: number;
  sampleRateHz: number;
  totalReps: number;
  sets: SetSummaryRecord[];
  /**
   * Short, session-level exercise name (e.g. "Bicep Curl") used to group
   * sessions for a fair across-day comparison -- unlike the per-set labels
   * (which distinguish different exercises tried back to back in one
   * session), this identifies what the WHOLE session was for, so e.g. all
   * "Bicep Curl" sessions can be compared to each other over time.
   */
  exerciseTag: string | null;
  /** Freeform notes for the user's own memory (e.g. "used the rod/barbell today"), not used for grouping. */
  description: string | null;
  /** Highest peak among all detected reps -- the session-local activation-% denominator. */
  sessionBestPeak: number;
  /** The calibration reference in effect at the time, if any had been captured yet. */
  calibrationReferenceAtTime: number | null;
  /**
   * sessionBestPeak as a percentage of calibrationReferenceAtTime -- the
   * one number in this record that's actually meaningful to compare across
   * different days' sessions, since it's anchored to an external reference
   * rather than to each session's own (different) best rep. Null if no
   * calibration reference was available when this session was analyzed.
   */
  calibrationRelativePct: number | null;
  /**
   * The three inputs to the activation ceiling as they stood when this
   * session was saved, plus the resulting max -- debug/audit fields for
   * seeing which source (the one-time max-effort test, the rolling
   * historical peak, or this session's own peak) is actually governing
   * activationPct, and why. Not shown in the regular history view.
   */
  maxEffortReferenceAtTime: number | null;
  rollingHistoricalPeakAtTime: number | null;
  activationCeilingAtTime: number;
}
