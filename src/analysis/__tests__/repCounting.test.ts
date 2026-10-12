/**
 * Regression tests for rep counting, run on real gym sessions whose true
 * rep counts the user gave. Each fixture holds only the rows around the
 * detected sets (plus any recorded connection dropout), so the full-length
 * sessions are not needed. If a change to the detector breaks one of these,
 * it re-introduces a miscount seen in real use.
 */
import { analyzeSession } from '../analyzeSession';
import { countWarnings } from '../countWarnings';
import { findDataGaps } from '../dataGaps';
import { detectSampleRate } from '../repDetection';
import type { SetCountInfo } from '../types';
import type { SensorRow } from '../../types';

interface Fixture {
  name: string;
  note: string;
  /** True reps per set as performed; null = no reliable truth (see note). */
  trueRepsPerSet: number[] | null;
  /** [timeSec, signal, envelope, axG, ayG, azG, gxDps, gyDps, gzDps, imuFresh] */
  rows: number[][];
}

const FIXTURES: Fixture[] = [
  require('./fixtures/repCounting/21-21-33.json'),
  require('./fixtures/repCounting/21-24-33.json'),
  require('./fixtures/repCounting/21-33-14.json'),
  require('./fixtures/repCounting/21-37-22.json'),
  require('./fixtures/repCounting/21-40-54.json'),
  require('./fixtures/repCounting/21-49-08.json'),
  require('./fixtures/repCounting/21-52-38.json'),
  require('./fixtures/repCounting/B_09-55-11.json'),
  require('./fixtures/repCounting/C_09-57-43.json'),
];

function toRows(fx: Fixture): SensorRow[] {
  return fx.rows.map((r, i) => ({
    sample: i + 1,
    timeSec: r[0],
    signal: r[1],
    envelope: r[2],
    axG: r[3],
    ayG: r[4],
    azG: r[5],
    gxDps: r[6],
    gyDps: r[7],
    gzDps: r[8],
    imuFresh: r[9] === 1,
    rollDeg: 0,
  }));
}

function analyze(name: string) {
  const fx = FIXTURES.find(f => f.name === name) as Fixture;
  const res = analyzeSession(toRows(fx), null, null, null);
  if (!res.ok) {
    throw new Error(`analysis failed for ${name}: ${res.reason}`);
  }
  return res.analysis;
}

describe('rep counts on real labelled sessions', () => {
  for (const fx of FIXTURES.filter(f => f.trueRepsPerSet !== null)) {
    test(`${fx.name}: ${fx.note}`, () => {
      const analysis = analyze(fx.name);
      const perSet: number[] = [];
      for (const rep of analysis.reps) {
        perSet[rep.setNumber - 1] = (perSet[rep.setNumber - 1] ?? 0) + 1;
      }
      expect(perSet).toEqual(fx.trueRepsPerSet);
    });
  }

  test('21-37-22: the 21 s dropout is flagged on the set it hid reps from', () => {
    const info = analyze('21-37-22').setCountInfo[0];
    expect(info.dataGapCount).toBeGreaterThanOrEqual(1);
    expect(info.dataGapSec).toBeGreaterThan(20);
    expect(countWarnings(info).join(' ')).toMatch(/Connection dropped/);
  });

  test('C_09-57-43: a frozen IMU falls back to EMG-only and says so', () => {
    const info = analyze('C_09-57-43').setCountInfo[0];
    expect(info.imuAlive).toBe(false);
    expect(info.basis).toBe('emg-only');
    expect(countWarnings(info).join(' ')).toMatch(/Motion sensor/);
  });

  test('sets counted from swings report the EMG-only count they replaced', () => {
    const info = analyze('21-21-33').setCountInfo[0];
    expect(info.basis).toBe('imu+emg');
    expect(info.emgOnlyCount).toBeGreaterThan(info.countedCycles);
  });
});

describe('detectSampleRate', () => {
  function rowsAt(times: number[]): SensorRow[] {
    return times.map((t, i) => ({
      sample: i + 1,
      timeSec: t,
      signal: 0,
      envelope: 0,
      axG: 0,
      ayG: 0,
      azG: 0,
      gxDps: 0,
      gyDps: 0,
      gzDps: 0,
      imuFresh: true,
      rollDeg: 0,
    }));
  }

  test('rows arriving in bursts of 2 at 25 packets/s are 50 Hz, not the median-gap "35 Hz"', () => {
    const times: number[] = [];
    for (let p = 0; p < 200; p++) {
      times.push(p * 0.04, p * 0.04);
    }
    expect(detectSampleRate(rowsAt(times))).toBeCloseTo(50, 0);
  });

  test('a connection dropout does not drag the estimate down', () => {
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      times.push(i * 0.02);
    }
    for (let i = 0; i < 300; i++) {
      times.push(6 + 30 + i * 0.02);
    }
    expect(detectSampleRate(rowsAt(times))).toBeCloseTo(50, 0);
  });
});

describe('findDataGaps', () => {
  test('reports only spacings of 2 s or more', () => {
    const rows = [0, 0.02, 0.04, 1.5, 1.52, 5.52, 5.54].map(
      (t, i) => ({ sample: i + 1, timeSec: t }) as SensorRow,
    );
    const gaps = findDataGaps(rows);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationSec).toBeCloseTo(4, 5);
  });
});

describe('countWarnings', () => {
  const base: SetCountInfo = {
    setNumber: 1,
    basis: 'imu+emg',
    imuAlive: true,
    emgOnlyCount: 5,
    cycleCount: 5,
    countedCycles: 5,
    dataGapCount: 0,
    dataGapSec: 0,
  };
  test('nothing to warn about for a clean set', () => {
    expect(countWarnings(base)).toEqual([]);
    expect(countWarnings(undefined)).toEqual([]);
  });
  test('dropout and EMG-only fallback each add a warning', () => {
    expect(countWarnings({ ...base, dataGapCount: 1, dataGapSec: 21.5 })).toHaveLength(1);
    expect(countWarnings({ ...base, basis: 'emg-only', imuAlive: false })).toHaveLength(1);
    expect(
      countWarnings({ ...base, basis: 'emg-only', imuAlive: false, dataGapCount: 1, dataGapSec: 5 }),
    ).toHaveLength(2);
  });
});
