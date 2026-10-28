/** User-facing warnings about how trustworthy a set's rep count is. Empty array = nothing to warn about. */
import type { SetCountInfo } from './types';

export function countWarnings(info: SetCountInfo | undefined): string[] {
  if (!info) {
    return [];
  }
  const out: string[] = [];
  if (info.dataGapSec > 0) {
    out.push(
      `Connection dropped for ${info.dataGapSec.toFixed(0)}s around this set — reps made during it were not recorded, so the count may be low.`,
    );
  }
  if (info.lightEffort) {
    out.push(
      `Muscle effort was only ${info.lightEffortPct ?? 0}% of your reference — treated as a warm-up, so its reps were not counted.`,
    );
  }
  if (info.basis === 'emg-only') {
    out.push(
      `Motion sensor ${
        info.imuAlive ? 'found too few arm swings' : "wasn't reading"
      } — reps were counted from the muscle signal alone, so the count is less reliable.`,
    );
  }
  return out;
}
