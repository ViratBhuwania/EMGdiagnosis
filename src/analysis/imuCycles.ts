/**
 * Arm-swing cycles from the accelerometer, used to decide what IS a rep.
 *
 * Why this exists: the EMG envelope alone over-counts (the lowering phase of
 * a curl produces a second, smaller burst; one burst can be split in two;
 * putting the dumbbell down looks like a rep) and under-counts (a weak first
 * rep gets smoothed into the next one). An arm that really curls moves
 * through exactly one big swing per rep, so a rep is defined as: ONE
 * accelerometer swing cycle that also contains muscle activity. Several EMG
 * bursts inside one swing are one rep; a swing with no muscle activity (just
 * swinging the arm) is not a rep; muscle activity with no swing (an
 * isometric squeeze, fidgeting) is not a rep.
 *
 * If the IMU is dead or silent the caller falls back to EMG-only counting
 * and says so -- see `assessImuHealth`.
 */
import type { SensorRow } from '../types';
import {
  CYCLE_EMG_WINDOW_S,
  CYCLE_MIN_EMG_FRAC,
  CYCLE_MIN_PROMINENCE_FRAC,
  CYCLE_MIN_SIZE_FRAC,
  CYCLE_MIN_SPACING_S,
  CYCLE_SEARCH_PAD_AFTER_S,
  CYCLE_SEARCH_PAD_BEFORE_S,
  CYCLE_SMOOTH_S,
  END_CYCLE_MAX_EMG_FRAC,
  END_CYCLE_MAX_SWING_FRAC,
  FRAGMENT_MAX_GAP_FRAC,
  FRAGMENT_MAX_SWING_FRAC,
  FRAGMENT_MAX_EMG_FRAC,
  FRAGMENT_MIN_COUNTED,
  END_CYCLE_WEAK_EMG_FRAC,
  END_CYCLE_WEAK_SIZE_FRAC,
  END_CYCLE_MIN_COUNTED,
  IMU_MIN_ACCEL_STD_G,
  IMU_MIN_GYRO_STD_DPS,
  LEAD_IN_MIN_EMG_FRAC,
  LEAD_IN_MIN_MOVE_FRAC,
} from './config';
import { median, percentile, rollingMean } from './dsp';
import { findPeaks, peakProminence } from './peakDetection';

export interface ImuHealth {
  alive: boolean;
  gyroStdDps: number;
  accelStdG: number;
}

function stdOf(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let acc = 0;
  for (const v of values) {
    acc += (v - mean) * (v - mean);
  }
  return Math.sqrt(acc / values.length);
}

/**
 * An IMU whose axes barely vary during an active set is not reading the arm
 * (seen once: a frozen sensor reporting the same value on every axis while
 * still flagged "fresh"). Judge it on the active span only.
 */
export function assessImuHealth(rows: SensorRow[], startIdx: number, endIdx: number): ImuHealth {
  const slice = rows.slice(Math.max(0, startIdx), Math.min(rows.length, endIdx)).filter(r => r.imuFresh);
  if (slice.length < 20) {
    return { alive: false, gyroStdDps: 0, accelStdG: 0 };
  }
  const gyroStdDps = Math.max(
    stdOf(slice.map(r => r.gxDps)),
    stdOf(slice.map(r => r.gyDps)),
    stdOf(slice.map(r => r.gzDps)),
  );
  const accelStdG = Math.max(
    stdOf(slice.map(r => r.axG)),
    stdOf(slice.map(r => r.ayG)),
    stdOf(slice.map(r => r.azG)),
  );
  return {
    alive: gyroStdDps >= IMU_MIN_GYRO_STD_DPS && accelStdG >= IMU_MIN_ACCEL_STD_G,
    gyroStdDps,
    accelStdG,
  };
}

/** First principal component of the (mean-removed) 3-axis accelerometer: the direction the arm mostly swings along. */
function principalAccelComponent(rows: SensorRow[], startIdx: number, endIdx: number): number[] {
  const n = endIdx - startIdx;
  const ax = new Array<number>(n);
  const ay = new Array<number>(n);
  const az = new Array<number>(n);
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[startIdx + i];
    ax[i] = r.axG;
    ay[i] = r.ayG;
    az[i] = r.azG;
    mx += r.axG;
    my += r.ayG;
    mz += r.azG;
  }
  mx /= n;
  my /= n;
  mz /= n;
  let cxx = 0;
  let cxy = 0;
  let cxz = 0;
  let cyy = 0;
  let cyz = 0;
  let czz = 0;
  for (let i = 0; i < n; i++) {
    const x = ax[i] - mx;
    const y = ay[i] - my;
    const z = az[i] - mz;
    cxx += x * x;
    cxy += x * y;
    cxz += x * z;
    cyy += y * y;
    cyz += y * z;
    czz += z * z;
  }
  // Power iteration for the dominant eigenvector of the 3x3 covariance.
  let vx = 1;
  let vy = 1;
  let vz = 1;
  for (let it = 0; it < 60; it++) {
    const nx = cxx * vx + cxy * vy + cxz * vz;
    const ny = cxy * vx + cyy * vy + cyz * vz;
    const nz = cxz * vx + cyz * vy + czz * vz;
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    vx = nx / norm;
    vy = ny / norm;
    vz = nz / norm;
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = (ax[i] - mx) * vx + (ay[i] - my) * vy + (az[i] - mz) * vz;
  }
  return out;
}

export interface ImuCycle {
  /** Row index (into the session's rows) of the swing's peak. */
  peakIdx: number;
  /** Swing size (accelerometer PC1 prominence, g). */
  prominence: number;
  /** Largest smoothed EMG around the swing. */
  emgPeak: number;
  /** True if this swing is counted as a rep. */
  counted: boolean;
}

export interface ImuCycleResult {
  health: ImuHealth;
  cycles: ImuCycle[];
}

/**
 * Finds the arm-swing cycles of one set and marks which of them count as
 * reps. `startIdx`/`endIdx` are the set's EMG-detected span; the search
 * window is padded a little before it because a weak first rep can start
 * moving before the EMG crosses the set threshold.
 */
export function findImuCycles(
  rows: SensorRow[],
  smoothDet: number[],
  startIdx: number,
  endIdx: number,
  sampleRate: number,
): ImuCycleResult {
  const health = assessImuHealth(rows, startIdx, endIdx);
  if (!health.alive) {
    return { health, cycles: [] };
  }

  const winStart = Math.max(0, startIdx - Math.floor(CYCLE_SEARCH_PAD_BEFORE_S * sampleRate));
  const winEnd = Math.min(rows.length, endIdx + Math.floor(CYCLE_SEARCH_PAD_AFTER_S * sampleRate));
  if (winEnd - winStart < Math.floor(2 * sampleRate)) {
    return { health, cycles: [] };
  }

  const pc = principalAccelComponent(rows, winStart, winEnd);
  const pcs = rollingMean(pc, Math.max(3, Math.round(CYCLE_SMOOTH_S * sampleRate)));
  const envSm = rollingMean(
    smoothDet.slice(winStart, winEnd),
    Math.max(3, Math.round(CYCLE_SMOOTH_S * sampleRate)),
  );

  const setLo = startIdx - winStart;
  const setHi = Math.min(pcs.length, endIdx - winStart);
  const inSet = pcs.slice(setLo, setHi);
  const range = percentile(inSet, 95) - percentile(inSet, 5);
  if (!(range > 0)) {
    return { health, cycles: [] };
  }
  const env90 = percentile(envSm.slice(setLo, setHi), 90);
  const distance = Math.max(2, Math.round(CYCLE_MIN_SPACING_S * sampleRate));
  const emgHalf = Math.max(1, Math.round(CYCLE_EMG_WINDOW_S * sampleRate));

  // The accelerometer's sign is arbitrary. Take the polarity whose swing peaks line up with the most muscle activity.
  let best: { score: number; peaks: number[]; sign: 1 | -1 } | null = null;
  for (const sign of [1, -1] as const) {
    const sig = pcs.map(v => sign * v);
    const peaks = findPeaks(sig, { distance, prominence: CYCLE_MIN_PROMINENCE_FRAC * range });
    if (peaks.length === 0) {
      continue;
    }
    let total = 0;
    for (const p of peaks) {
      total += Math.max(...envSm.slice(Math.max(0, p - emgHalf), Math.min(envSm.length, p + emgHalf + 1)));
    }
    const score = total / peaks.length;
    if (best === null || score > best.score) {
      best = { score, peaks, sign };
    }
  }
  if (best === null) {
    return { health, cycles: [] };
  }

  const sig = pcs.map(v => best!.sign * v);
  const raw = best.peaks.map(p => ({
    peakIdx: winStart + p,
    prominence: peakProminence(sig, p),
    emgPeak: Math.max(...envSm.slice(Math.max(0, p - emgHalf), Math.min(envSm.length, p + emgHalf + 1))),
  }));

  const withEmg = raw.filter(c => c.emgPeak >= CYCLE_MIN_EMG_FRAC * env90);
  const typicalSize = withEmg.length > 0 ? median(withEmg.map(c => c.prominence)) : 0;
  const cycles: ImuCycle[] = raw.map(c => ({
    ...c,
    counted: c.emgPeak >= CYCLE_MIN_EMG_FRAC * env90 && c.prominence >= CYCLE_MIN_SIZE_FRAC * typicalSize,
  }));

  let leadIn: ImuCycle | null = null;
  // Lead-in rep: a one-way first move before the first full swing (see LEAD_IN_* in config.ts).
  const counted = cycles.filter(c => c.counted).sort((a, b) => a.peakIdx - b.peakIdx);
  if (counted.length >= 2) {
    const firstRel = counted[0].peakIdx - winStart;
    const searchEnd = firstRel - 2 * emgHalf;
    if (searchEnd > 2) {
      let burstRel = 0;
      let burstVal = -Infinity;
      for (let j = 0; j < searchEnd; j++) {
        if (envSm[j] > burstVal) {
          burstVal = envSm[j];
          burstRel = j;
        }
      }
      const isEdge = burstRel <= 1 || burstRel >= searchEnd - 1;
      if (!isEdge && burstVal >= LEAD_IN_MIN_EMG_FRAC * env90) {
        const lo = Math.max(0, burstRel - Math.round(0.8 * sampleRate));
        const hi = Math.min(pcs.length, burstRel + Math.round(0.8 * sampleRate) + 1);
        let mn = Infinity;
        let mx = -Infinity;
        for (let j = lo; j < hi; j++) {
          mn = Math.min(mn, pcs[j]);
          mx = Math.max(mx, pcs[j]);
        }
        const move = mx - mn;
        if (move >= LEAD_IN_MIN_MOVE_FRAC * typicalSize) {
          leadIn = { peakIdx: winStart + burstRel, prominence: move, emgPeak: burstVal, counted: true };
          cycles.push(leadIn);
          cycles.sort((a, b) => a.peakIdx - b.peakIdx);
        }
      }
    }
  }

  // Pick-up / put-down filter. The lead-in is a genuine weak one-way first move, so it is never a candidate.
  dropFragmentCycles(cycles, leadIn);
  dropWeakEndCycles(cycles, leadIn);
  return { health, cycles };
}

/**
 * Picking the dumbbell up / putting it down produces a ragged "rep" at the
 * very start or end of a set. Only the first and last counted cycle are ever
 * considered (interior reps are never touched), and either of two signs
 * drops one:
 *  - its muscle burst is far below the set's median (pick-ups measured
 *    0.34-0.49x; real end reps were never below 0.69x); or
 *  - it is BOTH a clearly smaller swing AND a somewhat lower burst
 *    (put-down: swing ~0.6x, burst ~0.69x; real end reps were >= 0.78x).
 * Mutates `cycles`.
 */
function dropWeakEndCycles(cycles: ImuCycle[], exclude: ImuCycle | null): void {
  const counted = cycles.filter(c => c.counted && c !== exclude).sort((a, b) => a.peakIdx - b.peakIdx);
  if (counted.length < END_CYCLE_MIN_COUNTED) {
    return;
  }
  const medEmg = median(counted.map(c => c.emgPeak));
  const medSwing = median(counted.map(c => c.prominence));
  const isWeak = (c: ImuCycle): boolean =>
    (c.emgPeak < END_CYCLE_MAX_EMG_FRAC * medEmg && c.prominence < END_CYCLE_MAX_SWING_FRAC * medSwing) ||
    (c.prominence < END_CYCLE_WEAK_SIZE_FRAC * medSwing && c.emgPeak < END_CYCLE_WEAK_EMG_FRAC * medEmg);
  // Decide both ends against the original medians before dropping either.
  const dropFirst = isWeak(counted[0]);
  const dropLast = isWeak(counted[counted.length - 1]);
  if (dropFirst) {
    counted[0].counted = false;
  }
  if (dropLast) {
    counted[counted.length - 1].counted = false;
  }
}

/**
 * Drops split-rep fragments: a small, weak swing that sits much closer to a
 * neighbour than the set's typical rep spacing. Mutates `cycles`.
 */
function dropFragmentCycles(cycles: ImuCycle[], exclude: ImuCycle | null): void {
  const counted = cycles.filter(c => c.counted && c !== exclude).sort((a, b) => a.peakIdx - b.peakIdx);
  if (counted.length < FRAGMENT_MIN_COUNTED) {
    return;
  }
  const medEmg = median(counted.map(c => c.emgPeak));
  const medSwing = median(counted.map(c => c.prominence));
  const medGap = median(counted.slice(1).map((c, i) => c.peakIdx - counted[i].peakIdx));
  const fragments = counted.filter((c, i) => {
    const gapPrev = i > 0 ? c.peakIdx - counted[i - 1].peakIdx : Infinity;
    const gapNext = i < counted.length - 1 ? counted[i + 1].peakIdx - c.peakIdx : Infinity;
    return (
      Math.min(gapPrev, gapNext) < FRAGMENT_MAX_GAP_FRAC * medGap &&
      c.prominence < FRAGMENT_MAX_SWING_FRAC * medSwing &&
      c.emgPeak < FRAGMENT_MAX_EMG_FRAC * medEmg
    );
  });
  for (const c of fragments) {
    c.counted = false;
  }
}
