import RNFS from 'react-native-fs';
import type { SessionSummaryRecord } from './types';

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
