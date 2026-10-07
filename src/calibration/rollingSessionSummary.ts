/**
 * Two-layer percentile construction of rolling_historical_peak, built from
 * the last 8 SESSIONS (not sets, not individual reps) for a given exercise.
 * Both layers use the 90th percentile for the same reason the submax hold
 * already does: robustness against a single outlier -- one freak rep, or
 * one anomalous session -- permanently distorting the reference.
 *
 * Named distinctly from activationCeiling.ts's old computeRollingHistoricalPeak
 * (removed -- was an all-time max over every saved session's sessionBestPeak)
 * so this two-layer replacement was never confused with it while both existed.
 *
 * "A session" here is explicit, not time-based: the app has a Start
 * Workout / End Workout button (separate from the per-set Start/Stop
 * recording controls) that marks the boundary directly, rather than
 * guessing it from an idle gap between recordings. Every Start/Stop
 * recording saved while a workout is open merges its rep peaks into the
 * same pending session; End Workout is what finalizes it into the window.
 */
import { percentile } from '../analysis/dsp';
import type { ExerciseRollingState } from './rollingSessionSummaryStore';

/** How many past sessions' summary values feed rolling_historical_peak. */
export const MAX_ROLLING_WINDOW_SESSIONS = 8;

/**
 * Layer 1, computed once per session: the 90th percentile of that
 * session's own rep peaks (every rep, across every set and every Start/Stop
 * recording folded into it, for this one exercise). Null if there are no
 * rep peaks to summarize.
 */
export function computeSessionSummaryValue(repPeaks: number[]): number | null {
  if (repPeaks.length === 0) {
    return null;
  }
  return percentile(repPeaks, 90);
}

/**
 * Layer 2, computed on demand: the 90th percentile of whatever
 * session_summary_values are in the window (up to the last 8 sessions for
 * this exercise). Null if the window is empty -- callers feeding this into
 * the ceiling's max() should treat null as "not a candidate," matching how
 * the existing ceiling code already treats a missing rolling_historical_peak.
 */
export function computeRollingHistoricalPeakFromSessionSummaries(
  sessionSummaryWindow: number[],
): number | null {
  if (sessionSummaryWindow.length === 0) {
    return null;
  }
  return percentile(sessionSummaryWindow, 90);
}

/**
 * Folds one Start/Stop recording's rep peaks into the exercise's still-open
 * pending session, creating one if none exists. Never finalizes anything --
 * that only happens via finalizePendingSession(), called from the explicit
 * End Workout action. This runs unconditionally on every saved recording,
 * whether or not the user remembered to press Start Workout first, so a
 * forgotten button press never loses data -- it just leaves the session
 * open until the next explicit End Workout (or the next Start Workout's
 * safety-net finalize, see LiveSessionScreen.tsx).
 */
export function mergeRecordingIntoPendingSession(
  state: ExerciseRollingState,
  repPeaks: number[],
  nowMs: number = Date.now(),
): ExerciseRollingState {
  return {
    finalizedWindow: state.finalizedWindow,
    pending: {
      lastActivityMs: nowMs,
      repPeaks: [...(state.pending?.repPeaks ?? []), ...repPeaks],
    },
  };
}

/**
 * Explicitly closes out the current pending session (if any): its
 * accumulated rep peaks collapse into one session_summary_value, pushed
 * onto the finalized window (oldest dropped past MAX_ROLLING_WINDOW_SESSIONS).
 * Called from the End Workout button, and as a safety-net first step of
 * Start Workout in case a previous session was never explicitly closed.
 * A no-op (returns state unchanged) if there's no pending session.
 */
export function finalizePendingSession(state: ExerciseRollingState): ExerciseRollingState {
  if (!state.pending) {
    return state;
  }
  const summaryValue = computeSessionSummaryValue(state.pending.repPeaks);
  const finalizedWindow =
    summaryValue !== null
      ? [...state.finalizedWindow, summaryValue].slice(-MAX_ROLLING_WINDOW_SESSIONS)
      : state.finalizedWindow;
  return { finalizedWindow, pending: null };
}

/**
 * The window to actually feed Layer 2 right now: the finalized past
 * sessions, PLUS the still-open pending session's own progress so far --
 * real data from sets you've already done today, just not "finalized" yet
 * since you might still be mid-workout. Doesn't mutate storage; the
 * pending session only becomes a permanent window entry once it goes idle
 * (see applyRecordingToRollingState).
 */
export function currentRollingWindow(state: ExerciseRollingState): number[] {
  if (!state.pending) {
    return state.finalizedWindow;
  }
  const pendingSummary = computeSessionSummaryValue(state.pending.repPeaks);
  if (pendingSummary === null) {
    return state.finalizedWindow;
  }
  return [...state.finalizedWindow, pendingSummary].slice(-MAX_ROLLING_WINDOW_SESSIONS);
}
