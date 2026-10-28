/**
 * Rows the phone asked the device to send again arrive after later rows
 * already did. They are kept aside while recording and merged in here at Stop
 * (or when recovering from disk): ordered by time, `sample` renumbered 1..n,
 * and rep marks re-pointed at the same rows they marked.
 */
import type { RepMark, SensorRow } from '../types';

export function mergeLateRows(
  rows: SensorRow[],
  late: SensorRow[],
  reps: RepMark[],
): { rows: SensorRow[]; reps: RepMark[] } {
  if (late.length === 0) {
    return { rows, reps };
  }
  const sortedLate = [...late].sort((a, b) => a.timeSec - b.timeSec);
  const merged: SensorRow[] = [];
  const oldToNew = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < rows.length || j < sortedLate.length) {
    const takeLate =
      j < sortedLate.length && (i >= rows.length || sortedLate[j].timeSec < rows[i].timeSec);
    if (takeLate) {
      merged.push({ ...sortedLate[j], sample: merged.length + 1 });
      j++;
    } else {
      oldToNew.set(rows[i].sample, merged.length + 1);
      merged.push({ ...rows[i], sample: merged.length + 1 });
      i++;
    }
  }
  const remapped = reps.map(m => ({
    ...m,
    approxSample: m.approxSample === 0 ? 0 : oldToNew.get(m.approxSample) ?? m.approxSample,
  }));
  return { rows: merged, reps: remapped };
}
