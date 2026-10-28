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
  require('./fixtures/repCounting/E_16-06-27.json'),
  require('./fixtures/repCounting/E_16-08-23.json'),
  require('./fixtures/repCounting/E_16-10-16.json'),
  require('./fixtures/repCounting/E_16-13-09.json'),
  require('./fixtures/repCounting/E_16-14-51.json'),
  require('./fixtures/repCounting/E_16-16-51.json'),
  require('./fixtures/repCounting/E_16-20-10.json'),
  require('./fixtures/repCounting/E_16-22-24.json'),
  require('./fixtures/repCounting/E_16-24-36.json'),
  require('./fixtures/repCounting/F_14-20-45_warmup.json'),
  require('./fixtures/repCounting/F_14-23-35.json'),
  require('./fixtures/repCounting/F_14-27-19.json'),
  require('./fixtures/repCounting/F_14-33-01.json'),
  require('./fixtures/repCounting/F_14-35-48.json'),
  require('./fixtures/repCounting/F_15-00-35.json'),
  require('./fixtures/repCounting/F_15-01-59.json'),
  require('./fixtures/repCounting/F_15-04-03.json'),
];

/**
 * KNOWN LIMITATION: on hammer curls the dumbbell pick-up is indistinguishable
 * from a genuine weak one-way first move ("lead-in", see LEAD_IN_* in
 * config.ts): pick-up EMG is 0.33-0.35x the set median, the real lead-ins in
 * 21-49-08 / 21-52-38 are 0.39-0.41x. That margin is too thin to separate
 * safely, so these three still count 9 instead of the true 8. If the
 * lead-in rule is ever tightened, change this expectation to 8.
 */
const HAMMER_PICKUP_NAMES = ['E_16-13-09', 'E_16-14-51', 'E_16-16-51'];

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
  for (const fx of FIXTURES.filter(f => f.trueRepsPerSet !== null && !HAMMER_PICKUP_NAMES.includes(f.name))) {
    test(`${fx.name}: ${fx.note}`, () => {
      const analysis = analyze(fx.name);
      const perSet: number[] = [];
      for (const rep of analysis.reps) {
        perSet[rep.setNumber - 1] = (perSet[rep.setNumber - 1] ?? 0) + 1;
      }
      expect(perSet).toEqual(fx.trueRepsPerSet);
    });
  }

  for (const name of HAMMER_PICKUP_NAMES) {
    test(`${name}: hammer-curl pick-up still counts as a lead-in rep (9 vs true 8, known limitation)`, () => {
      const perSet: number[] = [];
      for (const rep of analyze(name).reps) {
        perSet[rep.setNumber - 1] = (perSet[rep.setNumber - 1] ?? 0) + 1;
      }
      expect(perSet).toEqual([9]);
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

describe('17 Oct gym test: fragment, strong first rep and warm-up', () => {
  function rowsOf(name: string) {
    return toRows(FIXTURES.find(f => f.name === name) as Fixture);
  }

  test('without any reference (cold start) the warm-up is still counted -- nothing to compare against', () => {
    const res = analyzeSession(rowsOf('F_14-20-45_warmup'), null, null, null);
    expect(res.ok).toBe(true);
  });

  test('warm-up is rejected as too light when a rolling historical peak exists', () => {
    const res = analyzeSession(rowsOf('F_14-20-45_warmup'), null, null, 4000);
    expect(res).toEqual({ ok: false, reason: 'too_light' });
  });

  test('warm-up is rejected as too light against a calibration hold reference', () => {
    const res = analyzeSession(rowsOf('F_14-20-45_warmup'), 4000, null, null);
    expect(res).toEqual({ ok: false, reason: 'too_light' });
  });

  test('real working sets are not flagged light against the same references', () => {
    for (const name of ['F_14-23-35', 'F_14-27-19', 'F_14-33-01', 'F_14-35-48']) {
      const res = analyzeSession(rowsOf(name), 4000, null, 4000);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.analysis.setCountInfo.some(i => i.lightEffort)).toBe(false);
      }
    }
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
  test('a light-effort set warns that it was treated as a warm-up', () => {
    expect(countWarnings({ ...base, lightEffort: true, lightEffortPct: 6 }).join(' ')).toMatch(/warm-up/);
  });
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
