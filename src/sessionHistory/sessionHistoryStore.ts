import RNFS from 'react-native-fs';
import type { SessionSummaryRecord, SetUserTag } from './types';

/** One file per profile, so different people's session history never mixes. */
function storePath(profileId: string): string {
  return `${RNFS.DocumentDirectoryPath}/session_history_${profileId}.json`;
}

/** All saved session summaries for this profile, oldest first. Empty array if none yet. */
export async function loadSessionHistory(profileId: string): Promise<SessionSummaryRecord[]> {
  try {
    const path = storePath(profileId);
    const exists = await RNFS.exists(path);
    if (!exists) {
      return [];
    }
    const raw = await RNFS.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionSummaryRecord[]) : [];
  } catch {
    // Corrupt or unreadable file -- treat as no history rather than crashing.
    return [];
  }
}

/** Appends one session summary and persists this profile's full history; returns the updated list. */
export async function saveSessionSummary(
  profileId: string,
  record: SessionSummaryRecord,
): Promise<SessionSummaryRecord[]> {
  const history = await loadSessionHistory(profileId);
  const updated = [...history, record].sort((a, b) => a.timestampMs - b.timestampMs);
  await RNFS.writeFile(storePath(profileId), JSON.stringify(updated), 'utf8');
  return updated;
}

/**
 * Removes one set from one saved session and persists the result. If that
 * was the session's last remaining set, the whole (now-empty) session
 * record is dropped instead of being kept as an empty shell. Only touches
 * this profile's session-history file -- deliberately does NOT try to
 * un-fold the deleted set's contribution from the rolling historical peak
 * window (rollingSessionSummaryStore.ts): that store only keeps the
 * already-collapsed 90th-percentile number per session, with no record of
 * which raw rep peaks fed it, so there's nothing left to subtract.
 */
export async function deleteSet(
  profileId: string,
  sessionId: string,
  setNumber: number,
): Promise<SessionSummaryRecord[]> {
  const history = await loadSessionHistory(profileId);
  const updated = history
    .map(record => {
      if (record.id !== sessionId) {
        return record;
      }
      const sets = record.sets.filter(s => s.setNumber !== setNumber);
      const totalReps = sets.reduce((sum, s) => sum + s.repCount, 0);
      const sessionBestPeak = sets.length > 0 ? Math.max(...sets.map(s => s.peakEnvelope ?? 0)) : 0;
      return { ...record, sets, totalReps, sessionBestPeak };
    })
    .filter(record => record.sets.length > 0);
  await RNFS.writeFile(storePath(profileId), JSON.stringify(updated), 'utf8');
  return updated;
}

/** Permanently clears every saved session for this profile. Only this history file -- calibration, max-effort, and the rolling historical peak window are untouched. */
export async function deleteAllSessions(profileId: string): Promise<void> {
  await RNFS.writeFile(storePath(profileId), JSON.stringify([]), 'utf8');
}

/** Sets (or clears) the user's outcome/hand label on one saved set -- lets a set be labeled after it was already saved. */
export async function updateSetUserTag(
  profileId: string,
  sessionId: string,
  setNumber: number,
  tag: SetUserTag,
): Promise<void> {
  const history = await loadSessionHistory(profileId);
  const updated = history.map(record =>
    record.id !== sessionId
      ? record
      : {
          ...record,
          sets: record.sets.map(s =>
            s.setNumber !== setNumber ? s : { ...s, userOutcome: tag.outcome ?? null, hand: tag.hand ?? null },
          ),
        },
  );
  await RNFS.writeFile(storePath(profileId), JSON.stringify(updated), 'utf8');
}
