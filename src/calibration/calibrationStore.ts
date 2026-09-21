import RNFS from 'react-native-fs';
import type { CalibrationRecord } from './types';

/** One file per profile, so different people's calibration history never mixes. */
function storePath(profileId: string): string {
  return `${RNFS.DocumentDirectoryPath}/calibration_history_${profileId}.json`;
}

/** All saved calibration readings for this profile, oldest first. Empty array if none yet. */
export async function loadCalibrationHistory(profileId: string): Promise<CalibrationRecord[]> {
  try {
    const path = storePath(profileId);
    const exists = await RNFS.exists(path);
    if (!exists) {
      return [];
    }
    const raw = await RNFS.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CalibrationRecord[]) : [];
  } catch {
    // Corrupt or unreadable file -- treat as no history rather than crashing
    // the calibration flow over it.
    return [];
  }
}

/** Appends one record and persists this profile's full history; returns the updated list. */
export async function saveCalibrationRecord(
  profileId: string,
  record: CalibrationRecord,
): Promise<CalibrationRecord[]> {
  const history = await loadCalibrationHistory(profileId);
  const updated = [...history, record].sort((a, b) => a.timestampMs - b.timestampMs);
  await RNFS.writeFile(storePath(profileId), JSON.stringify(updated), 'utf8');
  return updated;
}
