import RNFS from 'react-native-fs';

/**
 * Separate file from calibrationStore.ts/maxEffortStore.ts -- additive
 * alongside them, same one-file-per-profile convention. Unlike those two,
 * this one is keyed by exercise internally, since rolling_historical_peak
 * is tracked per exercise, not once per person.
 *
 * Pure storage only -- the "is this Start/Stop recording part of the same
 * session as the last one, or a new one" decision lives in
 * rollingSessionSummary.ts, which reads/writes this shape.
 */
function storePath(profileId: string): string {
  return `${RNFS.DocumentDirectoryPath}/rolling_session_summary_${profileId}.json`;
}

/** JSON object keys must be strings; null/blank exerciseTag maps to this fixed sentinel. */
const UNTAGGED_KEY = '__untagged__';

function tagKey(exerciseTag: string | null): string {
  const trimmed = exerciseTag?.trim();
  return trimmed ? trimmed : UNTAGGED_KEY;
}

/** A Start/Stop recording still within the same-session idle gap of the last one -- not yet finalized into the window. */
export interface PendingSession {
  lastActivityMs: number;
  /** Every rep peak from every Start/Stop recording folded into this still-open session so far. */
  repPeaks: number[];
}

export interface ExerciseRollingState {
  /** Up to MAX_ROLLING_WINDOW_SESSIONS finalized session_summary_values, oldest first. */
  finalizedWindow: number[];
  /** The in-progress session, if its idle gap hasn't elapsed yet. Null if none. */
  pending: PendingSession | null;
}

const EMPTY_STATE: ExerciseRollingState = { finalizedWindow: [], pending: null };

type StateByExercise = Record<string, ExerciseRollingState>;

async function loadAll(profileId: string): Promise<StateByExercise> {
  try {
    const path = storePath(profileId);
    if (!(await RNFS.exists(path))) {
      return {};
    }
    const raw = await RNFS.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Corrupt or unreadable file -- treat as "no state yet" rather than crashing.
    return {};
  }
}

async function persistAll(profileId: string, data: StateByExercise): Promise<void> {
  await RNFS.writeFile(storePath(profileId), JSON.stringify(data), 'utf8');
}

export async function loadExerciseRollingState(
  profileId: string,
  exerciseTag: string | null,
): Promise<ExerciseRollingState> {
  const all = await loadAll(profileId);
  return all[tagKey(exerciseTag)] ?? EMPTY_STATE;
}

export async function saveExerciseRollingState(
  profileId: string,
  exerciseTag: string | null,
  state: ExerciseRollingState,
): Promise<void> {
  const all = await loadAll(profileId);
  await persistAll(profileId, { ...all, [tagKey(exerciseTag)]: state });
}
