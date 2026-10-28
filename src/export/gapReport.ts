/**
 * Where the recording is missing rows. With 11-field firmware every row
 * carries the device's own row number, so a jump in it is an exact count of
 * rows that never arrived (the exported `Sample` column is numbered by the app
 * and cannot show this). Older firmware has no counter, so gaps are estimated
 * from timestamps.
 */
import type { SensorRow } from '../types';

export const DEVICE_ROW_PERIOD_S = 0.02;
/** Without a device counter, a step bigger than this between rows counts as a gap. */
const TIME_GAP_THRESHOLD_S = 0.1;

export interface RowGap {
  /** App sample number of the last row before the gap. */
  afterSample: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  missingRows: number;
  exact: boolean;
  /** Why the estimate is an estimate, when it is. */
  note?: string;
}

export function findRowGaps(rows: SensorRow[]): RowGap[] {
  const gaps: RowGap[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.deviceSeq !== undefined && b.deviceSeq !== undefined && b.deviceSeq > a.deviceSeq) {
      const missing = b.deviceSeq - a.deviceSeq - 1;
      if (missing > 0) {
        gaps.push({
          afterSample: a.sample,
          startSec: a.timeSec,
          endSec: b.timeSec,
          durationSec: missing * DEVICE_ROW_PERIOD_S,
          missingRows: missing,
          exact: true,
        });
      }
    } else {
      // No device numbers (older firmware), or the device restarted (its row number went backwards):
      // fall back to the time between rows.
      const d = b.timeSec - a.timeSec;
      if (d >= TIME_GAP_THRESHOLD_S) {
        gaps.push({
          afterSample: a.sample,
          startSec: a.timeSec,
          endSec: b.timeSec,
          durationSec: d,
          missingRows: Math.max(1, Math.round(d / DEVICE_ROW_PERIOD_S) - 1),
          exact: false,
          note:
            a.deviceSeq !== undefined && b.deviceSeq !== undefined
              ? 'device restarted (row numbers began again)'
              : undefined,
        });
      }
    }
  }
  return gaps;
}

export function totalMissing(gaps: RowGap[]): { rows: number; seconds: number } {
  return {
    rows: gaps.reduce((s, g) => s + g.missingRows, 0),
    seconds: gaps.reduce((s, g) => s + g.durationSec, 0),
  };
}
