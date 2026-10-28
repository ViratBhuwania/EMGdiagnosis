/**
 * On-disk format of the in-progress recording, one JSON value per line so a
 * half-written last line (app killed mid-write) is simply skipped:
 *
 *   H {startedAt, appVersion, firmwareVersion}
 *   L (same as R) a row the device re-sent later, merged in by time on recovery
 *   R [sample,timeSec,deviceSeq|null,signal,envelope,axG,ayG,azG,gxDps,gyDps,gzDps,imuFresh]
 *   P [repNumber,approxSample,timeSec]
 *   E {timeSec,type,detail?}
 */
import { computeRollDeg } from '../ble/parser';
import { mergeLateRows } from './mergeLateRows';
import type { RepMark, SensorRow, SessionEvent } from '../types';

export interface AutosaveHeader {
  startedAt: number;
  appVersion: string;
  firmwareVersion: string | null;
}

export interface RecoveredSession {
  header: AutosaveHeader;
  rows: SensorRow[];
  reps: RepMark[];
  events: SessionEvent[];
}

const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function headerLine(h: AutosaveHeader): string {
  return `H ${JSON.stringify(h)}\n`;
}

export function rowLine(row: SensorRow, late = false): string {
  return `${late ? 'L' : 'R'} ${JSON.stringify([
    row.sample,
    r(row.timeSec, 5),
    row.deviceSeq ?? null,
    row.signal,
    row.envelope,
    r(row.axG, 5),
    r(row.ayG, 5),
    r(row.azG, 5),
    r(row.gxDps, 4),
    r(row.gyDps, 4),
    r(row.gzDps, 4),
    row.imuFresh ? 1 : 0,
  ])}\n`;
}

export function repLine(m: RepMark): string {
  return `P ${JSON.stringify([m.repNumber, m.approxSample, r(m.timeSec, 5)])}\n`;
}

export function eventLine(e: SessionEvent): string {
  return `E ${JSON.stringify(e)}\n`;
}

export function parseAutosave(text: string): RecoveredSession | null {
  let header: AutosaveHeader | null = null;
  const rows: SensorRow[] = [];
  const lateRows: SensorRow[] = [];
  const reps: RepMark[] = [];
  const events: SessionEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.length < 3) {
      continue;
    }
    let v: unknown;
    try {
      v = JSON.parse(line.slice(2));
    } catch {
      continue; // truncated last line
    }
    const tag = line[0];
    if (tag === 'H' && v && typeof v === 'object') {
      header = v as AutosaveHeader;
    } else if ((tag === 'R' || tag === 'L') && Array.isArray(v) && v.length === 12) {
      const [sample, timeSec, seq, signal, envelope, axG, ayG, azG, gxDps, gyDps, gzDps, fresh] = v as number[];
      (tag === 'L' ? lateRows : rows).push({
        sample,
        timeSec,
        signal,
        envelope,
        axG,
        ayG,
        azG,
        gxDps,
        gyDps,
        gzDps,
        imuFresh: fresh === 1,
        rollDeg: computeRollDeg(ayG, azG),
        ...(seq === null ? {} : { deviceSeq: seq }),
      });
    } else if (tag === 'P' && Array.isArray(v) && v.length === 3) {
      reps.push({ repNumber: v[0] as number, approxSample: v[1] as number, timeSec: v[2] as number });
    } else if (tag === 'E' && v && typeof v === 'object') {
      events.push(v as SessionEvent);
    }
  }
  if (!header || rows.length === 0) {
    return null;
  }
  const merged = mergeLateRows(rows, lateRows, reps);
  return { header, rows: merged.rows, reps: merged.reps, events };
}
