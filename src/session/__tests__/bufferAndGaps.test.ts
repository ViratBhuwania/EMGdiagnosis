import { parseSensorRow } from '../../ble/parser';
import { parseFirmwareInfoLine, bufferSeconds } from '../../ble/firmwareInfo';
import { findRowGaps, totalMissing } from '../../export/gapReport';
import { headerLine, parseAutosave, repLine, rowLine, eventLine } from '../autosaveFormat';
import type { SensorRow } from '../../types';

function row(sample: number, timeSec: number, seq?: number): SensorRow {
  return {
    sample, timeSec, signal: 5, envelope: 10, axG: 0.1, ayG: 0.2, azG: 0.9,
    gxDps: 1, gyDps: 2, gzDps: 3, imuFresh: true, rollDeg: 12.5,
    ...(seq === undefined ? {} : { deviceSeq: seq }),
  };
}

describe('parser', () => {
  it('still accepts the 9-field row (older firmware)', () => {
    const s = parseSensorRow('1,2,16384,0,0,131,0,0,1');
    expect(s?.axG).toBe(1);
    expect(s?.deviceSeq).toBeUndefined();
  });
  it('reads device seq and ms from the 11-field row', () => {
    const s = parseSensorRow('1,2,0,0,16384,0,0,0,1,1234,56780');
    expect(s?.deviceSeq).toBe(1234);
    expect(s?.deviceMs).toBe(56780);
  });
  it('rejects 10 fields', () => {
    expect(parseSensorRow('1,2,3,4,5,6,7,8,9,10')).toBeNull();
  });
});

describe('firmware info line', () => {
  it('parses version and buffer size', () => {
    const i = parseFirmwareInfoLine('FWINFO,2026-10-25-buf1,2600,0');
    expect(i).toEqual({ version: '2026-10-25-buf1', bufferRows: 2600, lostRowsOnDevice: 0 });
    expect(bufferSeconds(i)).toBe(52);
  });
  it('rejects junk', () => {
    expect(parseFirmwareInfoLine('FWINFO,x')).toBeNull();
    expect(parseFirmwareInfoLine('1,2,3')).toBeNull();
  });
});

describe('gap report', () => {
  it('counts exact missing rows from device numbers', () => {
    const rows = [row(1, 0, 10), row(2, 0.02, 11), row(3, 1.02, 61), row(4, 1.04, 62)];
    const g = findRowGaps(rows);
    expect(g).toHaveLength(1);
    expect(g[0].missingRows).toBe(49);
    expect(g[0].exact).toBe(true);
    expect(totalMissing(g).rows).toBe(49);
  });
  it('reports no gap for a backfilled, complete stream', () => {
    const rows = [row(1, 0, 0), row(2, 0.02, 1), row(3, 0.04, 2)];
    expect(findRowGaps(rows)).toHaveLength(0);
  });
  it('estimates from time on old firmware, including short gaps', () => {
    const rows = [row(1, 0), row(2, 0.02), row(3, 0.9)];
    const g = findRowGaps(rows);
    expect(g).toHaveLength(1);
    expect(g[0].exact).toBe(false);
    expect(g[0].missingRows).toBeGreaterThan(40);
  });
});

describe('autosave format', () => {
  const text =
    headerLine({ startedAt: 1000, appVersion: '0.0.1', firmwareVersion: 'fw' }) +
    rowLine(row(1, 0, 5)) + rowLine(row(2, 0.02)) +
    repLine({ repNumber: 1, approxSample: 2, timeSec: 0.02 }) +
    eventLine({ timeSec: 0.5, type: 'disconnected' });

  it('round-trips rows, reps and events', () => {
    const rec = parseAutosave(text)!;
    expect(rec.rows).toHaveLength(2);
    expect(rec.rows[0].deviceSeq).toBe(5);
    expect(rec.rows[1].deviceSeq).toBeUndefined();
    expect(rec.rows[0].rollDeg).toBeCloseTo(12.5, 0);
    expect(rec.reps[0].repNumber).toBe(1);
    expect(rec.events[0].type).toBe('disconnected');
    expect(rec.header.firmwareVersion).toBe('fw');
  });
  it('survives a half-written last line', () => {
    const rec = parseAutosave(text + 'R [3,0.04,6,5,10,0.1,0.2');
    expect(rec?.rows).toHaveLength(2);
  });
  it('returns null with no rows', () => {
    expect(parseAutosave(headerLine({ startedAt: 1, appVersion: 'x', firmwareVersion: null }))).toBeNull();
  });
});

import { mergeLateRows } from '../mergeLateRows';

describe('device restart in the gap report', () => {
  it('reports the time hole when the row number goes backwards', () => {
    const rows = [row(1, 5.0, 900), row(2, 5.02, 901), row(3, 12.3, 170), row(4, 12.32, 171)];
    const g = findRowGaps(rows);
    expect(g).toHaveLength(1);
    expect(g[0].exact).toBe(false);
    expect(g[0].note).toMatch(/restarted/);
    expect(g[0].durationSec).toBeCloseTo(7.28, 1);
    expect(totalMissing(g).rows).toBeGreaterThan(300);
  });
});

describe('mergeLateRows', () => {
  it('puts re-sent rows in time order, renumbers, and keeps rep marks on the same rows', () => {
    const rows = [row(1, 0.0, 0), row(2, 0.02, 1), row(3, 0.08, 4), row(4, 0.10, 5)];
    const late = [row(0, 0.06, 3), row(0, 0.04, 2)];
    const reps = [{ repNumber: 1, approxSample: 3, timeSec: 0.08 }];
    const m = mergeLateRows(rows, late, reps);
    expect(m.rows.map(r => r.deviceSeq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(m.rows.map(r => r.sample)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(m.reps[0].approxSample).toBe(5); // still the row at 0.08 s
    expect(findRowGaps(m.rows)).toHaveLength(0);
  });
  it('is a no-op without late rows', () => {
    const rows = [row(1, 0, 0)];
    expect(mergeLateRows(rows, [], []).rows).toBe(rows);
  });
  it('autosave recovery merges L lines', () => {
    const text =
      headerLine({ startedAt: 1, appVersion: 'x', firmwareVersion: null }) +
      rowLine(row(1, 0, 0)) + rowLine(row(2, 0.06, 3)) + rowLine(row(0, 0.02, 1), true) + rowLine(row(0, 0.04, 2), true);
    const rec = parseAutosave(text)!;
    expect(rec.rows.map(r => r.deviceSeq)).toEqual([0, 1, 2, 3]);
  });
});
