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
  fatigueDetected: boolean;
  fatigueStartRep: number | null;
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
}
