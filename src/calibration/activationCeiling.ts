/**
 * The unified activation ceiling: one rule instead of separate "first-time
 * user" vs. "has history" branches. A rep's activation % is always
 * peakEnvelope / ceiling * 100, where the ceiling is the best of everything
 * known so far for that specific exercise. Cold start falls out of max()
 * naturally -- with no rolling historical peak yet, it's just
 * max(maxEffortReference, currentSessionPeak) -- no separate code path.
 */
import type { SessionSummaryRecord, SetSummaryRecord } from '../sessionHistory/types';

/**
 * rolling_historical_peak itself is no longer built here -- see
 * rollingSessionSummary.ts's computeRollingHistoricalPeakFromSessionSummaries()
 * (the two-layer 90th-percentile version) and rollingSessionSummaryStore.ts
 * for the per-exercise windowed storage it reads from. This file keeps the
 * ceiling formula and the retest trigger, which are unchanged.
 */
function normalizeTag(tag: string | null): string | null {
  return tag?.trim() || null;
}

export interface ActivationCeilingSources {
  maxEffortReference: number | null;
  rollingHistoricalPeak: number | null;
  currentSessionPeak: number;
}

/**
 * ceiling = max(max_effort_reference, rolling_historical_peak, current_session_peak).
 * Strength gains get absorbed automatically: once real working sets start
 * producing peaks above the original max-effort reading, the rolling
 * historical peak overtakes it here with no re-test required.
 */
export function computeActivationCeiling(sources: ActivationCeilingSources): number {
  const candidates = [sources.maxEffortReference, sources.rollingHistoricalPeak, sources.currentSessionPeak].filter(
    (v): v is number => v !== null && v !== undefined && v > 0,
  );
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

/**
 * Tunable starting points, not validated -- see the spec's validation task.
 * N=3 and 95% are guesses at "recent sets keep matching the all-time high,"
 * loose enough to avoid nagging after one lucky set.
 */
export const RETEST_TRIGGER_SET_COUNT = 3;
export const RETEST_TRIGGER_THRESHOLD_FRACTION = 0.95;

interface RecentSet extends SetSummaryRecord {
  sessionTimestampMs: number;
}

/** Every set for this exercise across saved history, most recent first (session recency, then set order within a session). */
function recentSetsForExercise(
  sessionHistory: SessionSummaryRecord[],
  exerciseTag: string | null,
): RecentSet[] {
  const tag = normalizeTag(exerciseTag);
  return [...sessionHistory]
    .filter(s => normalizeTag(s.exerciseTag) === tag)
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .flatMap(s =>
      [...s.sets]
        .sort((a, b) => b.setNumber - a.setNumber)
        .map(set => ({ ...set, sessionTimestampMs: s.timestampMs })),
    );
}

/**
 * Data-driven, opt-in retest signal only -- never fires on a timer or
 * session count. True only when the last N real working sets for this
 * exercise have ALL landed at or above thresholdFraction of the ceiling AS
 * IT STANDS NOW (not the ceiling that happened to be in effect back when
 * each of those sets was recorded), meaning recent performance keeps
 * matching the all-time high closely enough that the stored ceiling might
 * be stale. Never blocks anything -- callers decide how to surface it
 * (a dismissible prompt), and it's always the user's choice to act on it.
 */
export function shouldSuggestMaxEffortRetest(
  sessionHistory: SessionSummaryRecord[],
  exerciseTag: string | null,
  currentCeiling: number,
  n: number = RETEST_TRIGGER_SET_COUNT,
  thresholdFraction: number = RETEST_TRIGGER_THRESHOLD_FRACTION,
): boolean {
  if (currentCeiling <= 0) {
    return false;
  }
  const lastN = recentSetsForExercise(sessionHistory, exerciseTag).slice(0, n);
  if (lastN.length < n) {
    return false;
  }
  return lastN.every(set => set.peakEnvelope / currentCeiling >= thresholdFraction);
}
