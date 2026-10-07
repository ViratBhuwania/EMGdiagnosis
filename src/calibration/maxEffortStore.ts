import RNFS from 'react-native-fs';
import type { MaxEffortRecord, MaxEffortStatus, RejectedMaxEffortAttempt } from './maxEffortTypes';

/**
 * Separate file from the submax calibration history (calibrationStore.ts)
 * -- this is additive alongside it, not a change to how the submax hold is
 * stored. One file per profile, same convention as everything else here.
 */
function storePath(profileId: string): string {
  return `${RNFS.DocumentDirectoryPath}/max_effort_${profileId}.json`;
}

const EMPTY_STATUS: MaxEffortStatus = { accepted: null, rejectedAttempts: [] };

export async function loadMaxEffortStatus(profileId: string): Promise<MaxEffortStatus> {
  try {
    const path = storePath(profileId);
    const exists = await RNFS.exists(path);
    if (!exists) {
      return EMPTY_STATUS;
    }
    const raw = await RNFS.readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      accepted: parsed?.accepted ?? null,
      rejectedAttempts: Array.isArray(parsed?.rejectedAttempts) ? parsed.rejectedAttempts : [],
    };
  } catch {
    // Corrupt or unreadable file -- treat as "not captured yet" rather than crashing.
    return EMPTY_STATUS;
  }
}

async function persist(profileId: string, status: MaxEffortStatus): Promise<void> {
  await RNFS.writeFile(storePath(profileId), JSON.stringify(status), 'utf8');
}

/** Stores the accepted max-effort reading, replacing any previous one -- this is captured once, but redoing it (e.g. after the opt-in retest prompt) should overwrite, not accumulate a history the way submax readings do. */
export async function saveAcceptedMaxEffort(
  profileId: string,
  record: MaxEffortRecord,
): Promise<MaxEffortStatus> {
  const current = await loadMaxEffortStatus(profileId);
  const updated: MaxEffortStatus = { ...current, accepted: record };
  await persist(profileId, updated);
  return updated;
}

/** Logs a rejected attempt without accepting it -- kept for tuning MAX_EFFORT_MIN_RATIO against real data later. */
export async function logRejectedMaxEffortAttempt(
  profileId: string,
  attempt: RejectedMaxEffortAttempt,
): Promise<MaxEffortStatus> {
  const current = await loadMaxEffortStatus(profileId);
  const updated: MaxEffortStatus = {
    ...current,
    rejectedAttempts: [...current.rejectedAttempts, attempt],
  };
  await persist(profileId, updated);
  return updated;
}
