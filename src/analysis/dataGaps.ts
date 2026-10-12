/**
 * Connection dropouts. The live stream is notify-only, so when the BLE link
 * drops mid-set the rows for that stretch are simply never recorded -- reps
 * performed during it can't be counted. We can't recover them, but we can
 * say so instead of showing a confidently wrong count.
 */
import type { SensorRow } from '../types';
import {
  DATA_GAP_MIN_S,
  DATA_GAP_NEAR_SET_AFTER_S,
  DATA_GAP_NEAR_SET_BEFORE_S,
} from './config';

export interface DataGap {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export function findDataGaps(rows: SensorRow[]): DataGap[] {
  const gaps: DataGap[] = [];
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].timeSec - rows[i - 1].timeSec;
    if (d >= DATA_GAP_MIN_S) {
      gaps.push({ startSec: rows[i - 1].timeSec, endSec: rows[i].timeSec, durationSec: d });
    }
  }
  return gaps;
}

/** Dropouts that overlap, or sit right next to, a set's [start, end] span. */
export function gapsTouchingSet(gaps: DataGap[], setStartSec: number, setEndSec: number): DataGap[] {
  const lo = setStartSec - DATA_GAP_NEAR_SET_BEFORE_S;
  const hi = setEndSec + DATA_GAP_NEAR_SET_AFTER_S;
  return gaps.filter(g => g.endSec >= lo && g.startSec <= hi);
}
