/**
 * On-device port of the desktop script's set/rep detection: preprocessing,
 * set boundary detection, and the adaptive period-guided rep detector
 * (local tempo tracking, locally-normalized peak prominence, gated gap
 * recovery, and the merge-split pass). Ported function-for-function from
 * rep_detector_emg_primary_v2.py so behavior stays traceable to the
 * original; see that file's comments for the reasoning behind each pass.
 *
 * One deliberate deviation: the original's `preprocess_emg` computed a
 * percentile-based `session_peak` used as everyone's activation-%
 * denominator. That's dropped here — see analyzeSession.ts for why, and
 * for the session's-own-best-rep replacement used instead.
 */
import type { SensorRow } from '../types';
import {
  acfPeriod,
  median,
  percentile,
  rollingMean,
} from './dsp';
import { findPeaks, peakProminence } from './peakDetection';
import {
  ACF_MAX_PERIOD_S,
  ACF_MIN_PERIOD_S,
  ENABLE_GAP_RECOVERY,
  GAP_MIN_DURATION_FRAC,
  GAP_MIN_PEAK_FRAC,
  GYRO_CONFIRM_FRAC,
  GYRO_WINDOW_S,
  IMU_RATE_FALLBACK,
  LOCAL_PROM_WINDOW_MULT,
  LOCAL_STEP_FRAC,
  LOCAL_WINDOW_MULT,
  MERGE_SUSPECT_DURATION_MULT,
  MIN_PEAK_PROMINENCE_FRAC,
  MIN_REST_BETWEEN_SETS_S,
  N_SMOOTH_LEVELS,
  ONSET_THRESHOLD_K,
  REST_WINDOW_S,
  SET_ACTIVITY_THRESHOLD_K,
  SMOOTH_FRACTION,
  SPLIT_PROMINENCE_FRAC,
  SPLIT_SMOOTH_FRACTION,
} from './config';
import type { DetectedRep, GyroEnergyTrack, SetBoundary } from './types';

/** Effective sample rate from the session's own timestamps -- BLE throughput varies run to run. */
export function detectSampleRate(rows: SensorRow[]): number {
  if (rows.length < 2) {
    return 50;
  }
  const diffs: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    diffs.push(rows[i].timeSec - rows[i - 1].timeSec);
  }
  const dt = median(diffs);
  return dt > 0 ? 1 / dt : 50;
}

export interface PreprocessResult {
  smoothDet: number[];
  noiseFloor: number;
  /** Dynamic-range estimate used only to scale detection thresholds -- not an activation-% ceiling. */
  sigRangeForThresholds: number;
}

/** 80ms-smoothed envelope, plus a noise floor and range for adaptive thresholding. */
export function preprocessEmg(rawEnvelope: number[], sampleRate: number): PreprocessResult {
  const detWin = Math.max(3, Math.floor(0.08 * sampleRate));
  const smoothDet = rollingMean(rawEnvelope, detWin);

  const skipN = Math.floor(0.5 * sampleRate);
  const restN = Math.min(
    Math.floor(REST_WINDOW_S * sampleRate) + skipN,
    Math.floor(smoothDet.length / 6),
  );

  if (restN - skipN < Math.floor(0.5 * sampleRate)) {
    // Too little data for the usual "first few seconds are rest" baseline
    // window (a very short recording). Fall back to a coarser split rather
    // than failing -- this runs on real captured sessions, not arbitrary
    // uploaded files, so there's no "check your config" fix to point at.
    const mid = Math.max(1, Math.floor(smoothDet.length / 2));
    const noiseFloor = median(smoothDet.slice(0, mid));
    const tail = smoothDet.slice(mid);
    const peak = percentile(tail.length > 0 ? tail : smoothDet, 99);
    return { smoothDet, noiseFloor, sigRangeForThresholds: Math.max(peak - noiseFloor, 1) };
  }

  const noiseFloor = median(smoothDet.slice(skipN, restN));
  const sessionPeakForThresholds = percentile(smoothDet.slice(restN), 99);
  return {
    smoothDet,
    noiseFloor,
    sigRangeForThresholds: Math.max(sessionPeakForThresholds - noiseFloor, 1),
  };
}

/** Dominant-axis gyro RMS energy, computed only from freshly-read IMU rows. */
export function computeGyroEnergy(rows: SensorRow[]): GyroEnergyTrack | null {
  const imuRows = rows.filter(r => r.imuFresh);
  if (imuRows.length < 10) {
    return null;
  }

  const gx = imuRows.map(r => r.gxDps);
  const gy = imuRows.map(r => r.gyDps);
  const gz = imuRows.map(r => r.gzDps);
  const variance = (arr: number[]) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
  };
  const vx = variance(gx);
  const vy = variance(gy);
  const vz = variance(gz);
  let dominant: number[];
  if (vy >= vx && vy >= vz) {
    dominant = gy;
  } else if (vz >= vx) {
    dominant = gz;
  } else {
    dominant = gx;
  }

  const timesSec = imuRows.map(r => r.timeSec);
  const diffs: number[] = [];
  for (let i = 1; i < timesSec.length; i++) {
    diffs.push(timesSec[i] - timesSec[i - 1]);
  }
  const dt = median(diffs);
  const imuRate = dt > 0 ? 1 / dt : IMU_RATE_FALLBACK;

  const win = Math.max(3, Math.floor(GYRO_WINDOW_S * imuRate));
  const squared = dominant.map(v => v * v);
  const smoothedSquared = rollingMean(squared, win);
  const energy = smoothedSquared.map(v => Math.sqrt(Math.max(v, 0)));

  return { energy, timesSec };
}

function meanEnergyInRange(
  track: GyroEnergyTrack | null,
  startSec: number,
  endSec: number,
): number | null {
  if (!track) {
    return null;
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i < track.timesSec.length; i++) {
    if (track.timesSec[i] >= startSec && track.timesSec[i] <= endSec) {
      sum += track.energy[i];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

function percentileEnergyInRange(
  track: GyroEnergyTrack | null,
  startSec: number,
  endSec: number,
  p: number,
): number | null {
  if (!track) {
    return null;
  }
  const vals: number[] = [];
  for (let i = 0; i < track.timesSec.length; i++) {
    if (track.timesSec[i] >= startSec && track.timesSec[i] <= endSec) {
      vals.push(track.energy[i]);
    }
  }
  return vals.length > 0 ? percentile(vals, p) : null;
}

/** Detects "set" spans -- sustained activity above a noise-relative threshold. */
export function detectSets(
  sig: number[],
  noiseFloor: number,
  sigRangeForThresholds: number,
  sampleRate: number,
): { boundaries: SetBoundary[]; threshold: number } {
  const n = sig.length;
  const thr = noiseFloor + SET_ACTIVITY_THRESHOLD_K * sigRangeForThresholds;
  const ls = rollingMean(sig, 2.0 * sampleRate);
  const act = ls.map(v => v > thr);

  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = act[i - 1] ? 1 : 0;
    const cur = act[i] ? 1 : 0;
    if (cur - prev === 1) {
      starts.push(i);
    }
    if (cur - prev === -1) {
      ends.push(i);
    }
  }
  if (starts.length === 0 || ends.length === 0) {
    return { boundaries: [], threshold: thr };
  }
  if (act[0]) {
    starts.unshift(0);
  }
  if (act[n - 1]) {
    ends.push(n - 1);
  }
  const count = Math.min(starts.length, ends.length);
  const sts = starts.slice(0, count);
  const eds = ends.slice(0, count);

  const gap = MIN_REST_BETWEEN_SETS_S * sampleRate;
  const merged: [number, number][] = [];
  let cs = sts[0];
  let ce = eds[0];
  for (let i = 1; i < count; i++) {
    const s = sts[i];
    const e = eds[i];
    if (s - ce < gap) {
      ce = e;
    } else {
      merged.push([cs, ce]);
      cs = s;
      ce = e;
    }
  }
  merged.push([cs, ce]);

  const buf = Math.floor(0.5 * sampleRate);
  const tight: SetBoundary[] = [];
  for (const [segCs, segCe] of merged) {
    if (segCe - segCs < 5.0 * sampleRate) {
      continue;
    }
    const window = sig.slice(segCs, segCe);
    const activeIdx: number[] = [];
    for (let i = 0; i < window.length; i++) {
      if (window[i] > thr) {
        activeIdx.push(i);
      }
    }
    if (activeIdx.length === 0) {
      continue;
    }
    const ts = segCs + Math.max(0, activeIdx[0] - buf);
    const te = segCs + Math.min(window.length - 1, activeIdx[activeIdx.length - 1] + buf);
    tight.push({ startIdx: ts, endIdx: te });
  }
  return { boundaries: tight, threshold: thr };
}

function linearInterp(centres: number[], values: number[], n: number): number[] {
  const out = new Array(n);
  if (centres.length === 1) {
    return new Array(n).fill(values[0]);
  }
  for (let idx = 0; idx < n; idx++) {
    if (idx <= centres[0]) {
      out[idx] = values[0];
      continue;
    }
    if (idx >= centres[centres.length - 1]) {
      out[idx] = values[values.length - 1];
      continue;
    }
    let lo = 0;
    while (lo < centres.length - 1 && centres[lo + 1] < idx) {
      lo++;
    }
    const hi = lo + 1;
    const x0 = centres[lo];
    const x1 = centres[hi];
    const y0 = values[lo];
    const y1 = values[hi];
    const t = (idx - x0) / (x1 - x0);
    out[idx] = y0 + t * (y1 - y0);
  }
  return out;
}

/** Per-sample local repetition period, tracked via a sliding-window ACF. */
export function localPeriodTrack(
  seg: number[],
  rate: number,
  globalPeriod: number,
  minS: number,
  maxS: number,
): number[] {
  const n = seg.length;
  let winLen = Math.max(Math.floor(rate), Math.floor(LOCAL_WINDOW_MULT * globalPeriod * rate));
  winLen = Math.min(winLen, n);
  const step = Math.max(1, Math.floor(winLen * LOCAL_STEP_FRAC));

  const centres: number[] = [];
  const periods: number[] = [];
  let i = 0;
  while (i < n) {
    const j = Math.min(i + winLen, n);
    if (j - i < Math.floor(minS * rate) * 2) {
      break;
    }
    const localSeg = seg.slice(i, j);
    const { periodS, strength } = acfPeriod(localSeg, rate, minS, Math.min(maxS, (j - i) / rate / 2));
    periods.push(strength < 0.15 ? globalPeriod : periodS);
    centres.push((i + j) / 2);
    if (j === n) {
      break;
    }
    i += step;
  }

  if (centres.length === 0) {
    return new Array(n).fill(globalPeriod);
  }
  return linearInterp(centres, periods, n);
}

/** Blends a handful of fixed-window smoothed versions to approximate a per-sample varying window. */
export function variableWindowSmooth(
  seg: number[],
  periodPerSample: number[],
  smoothFraction: number,
  rate: number,
  nLevels: number = N_SMOOTH_LEVELS,
): number[] {
  const n = seg.length;
  const desiredWin = periodPerSample.map(p => Math.max(3, p * smoothFraction * rate));
  const wMin = Math.min(...desiredWin);
  const wMax = Math.max(...desiredWin);

  if (wMax / Math.max(wMin, 1) < 1.15) {
    return rollingMean(seg, Math.round((wMin + wMax) / 2));
  }

  const levels: number[] = [];
  for (let k = 0; k < nLevels; k++) {
    const t = k / (nLevels - 1);
    levels.push(wMin * Math.pow(wMax / wMin, t));
  }
  const smoothedLevels = levels.map(w => rollingMean(seg, Math.round(w)));
  const logLevels = levels.map(v => Math.log(v));

  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const logDesired = Math.log(desiredWin[i]);
    let idx = logLevels.findIndex(v => v >= logDesired);
    if (idx === -1) {
      idx = logLevels.length;
    }
    const levelIdx = Math.min(Math.max(idx - 1, 0), nLevels - 2);

    const loVal = logLevels[levelIdx];
    const hiVal = logLevels[levelIdx + 1];
    const frac = hiVal > loVal ? (logDesired - loVal) / (hiVal - loVal) : 0;
    out[i] = smoothedLevels[levelIdx][i] * (1 - frac) + smoothedLevels[levelIdx + 1][i] * frac;
  }
  return out;
}

/**
 * The adaptive period-guided rep detector: main peak pass (locally-
 * normalized prominence + gyro confirmation), gated gap recovery, then the
 * merge-split pass for anomalously long confirmed reps.
 */
export function detectRepsAdaptive(
  smoothDet: number[],
  timesSec: number[],
  setBoundaries: SetBoundary[],
  noiseFloor: number,
  sigRangeForThresholds: number,
  gyroTrack: GyroEnergyTrack | null,
  sampleRate: number,
): DetectedRep[] {
  const onsetThr = noiseFloor + ONSET_THRESHOLD_K * sigRangeForThresholds;
  let allReps: DetectedRep[] = [];

  for (let setIdx = 0; setIdx < setBoundaries.length; setIdx++) {
    const setNumber = setIdx + 1;
    const { startIdx: ss, endIdx: se } = setBoundaries[setIdx];
    const setStartSec = timesSec[ss];
    const setEndSec = timesSec[Math.min(se, timesSec.length - 1)];
    const setDurSec = setEndSec - setStartSec;
    const seg = smoothDet.slice(ss, se);
    if (seg.length < 10) {
      continue;
    }

    const { periodS: globalPeriod } = acfPeriod(
      seg,
      sampleRate,
      ACF_MIN_PERIOD_S,
      Math.min(ACF_MAX_PERIOD_S, setDurSec / 2),
    );

    const periodPerSample = localPeriodTrack(
      seg,
      sampleRate,
      globalPeriod,
      ACF_MIN_PERIOD_S,
      ACF_MAX_PERIOD_S,
    );
    const segSmooth = variableWindowSmooth(seg, periodPerSample, SMOOTH_FRACTION, sampleRate);

    const minPeriodInSeg = Math.min(...periodPerSample);
    const minDist = Math.max(3, Math.floor(0.55 * minPeriodInSeg * sampleRate));

    const rawPeaks = findPeaks(segSmooth, { distance: minDist, prominence: 1e-6 });
    if (rawPeaks.length === 0) {
      continue;
    }

    const keptPeaks: number[] = [];
    for (const pk of rawPeaks) {
      const prom = peakProminence(segSmooth, pk);
      const localPeriod = periodPerSample[pk];
      const w = Math.floor(LOCAL_PROM_WINDOW_MULT * localPeriod * sampleRate);
      const lo = Math.max(0, pk - w);
      const hi = Math.min(segSmooth.length, pk + w);
      const windowSlice = segSmooth.slice(lo, hi);
      const localRange = Math.max(...windowSlice) - Math.min(...windowSlice);
      const required = MIN_PEAK_PROMINENCE_FRAC * Math.max(localRange, 1e-6);
      if (prom >= required) {
        keptPeaks.push(pk);
      }
    }
    if (keptPeaks.length === 0) {
      continue;
    }

    const setGmax = gyroTrack ? percentileEnergyInRange(gyroTrack, setStartSec, setEndSec, 90) : null;

    for (let i = 0; i < keptPeaks.length; i++) {
      const pk = keptPeaks[i];
      const peakAbs = ss + pk;
      const leftLimit = i > 0 ? ss + Math.floor((keptPeaks[i - 1] + pk) / 2) : ss;
      const rightLimit =
        i < keptPeaks.length - 1 ? ss + Math.floor((pk + keptPeaks[i + 1]) / 2) : se;

      let onset = leftLimit;
      for (let j = peakAbs; j > leftLimit; j--) {
        if (j >= 0 && j < smoothDet.length && smoothDet[j] < onsetThr) {
          onset = j;
          break;
        }
      }
      let offset = rightLimit;
      for (let j = peakAbs; j < rightLimit; j++) {
        if (j >= 0 && j < smoothDet.length && smoothDet[j] < onsetThr) {
          offset = j;
          break;
        }
      }
      if (offset - onset < Math.floor(0.3 * sampleRate)) {
        onset = leftLimit;
        offset = rightLimit;
      }

      if (gyroTrack && setGmax && setGmax > 0) {
        const sT = timesSec[Math.min(onset, timesSec.length - 1)];
        const eT = timesSec[Math.min(offset, timesSec.length - 1)];
        const meanG = meanEnergyInRange(gyroTrack, sT, eT);
        if (meanG !== null && meanG < GYRO_CONFIRM_FRAC * setGmax) {
          continue;
        }
      }

      allReps.push({ setNumber, onsetIdx: onset, offsetIdx: offset, peakIdx: peakAbs });
    }

    if (ENABLE_GAP_RECOVERY) {
      const setReps = allReps
        .filter(r => r.setNumber === setNumber)
        .sort((a, b) => a.onsetIdx - b.onsetIdx);

      let medDur: number | null = null;
      let medPeak: number | null = null;
      if (setReps.length >= 2) {
        medDur = median(setReps.map(r => (r.offsetIdx - r.onsetIdx) / sampleRate));
        medPeak = median(setReps.map(r => smoothDet[r.peakIdx]));
      }

      for (let i = 0; i < setReps.length - 1; i++) {
        const gapLo = setReps[i].offsetIdx;
        const gapHi = setReps[i + 1].onsetIdx;
        if (gapHi - gapLo < Math.floor(0.3 * sampleRate)) {
          continue;
        }
        const gapSig = smoothDet.slice(gapLo, gapHi);
        const gapMax = Math.max(...gapSig);
        if (gapMax < onsetThr) {
          continue;
        }
        const candAbs = gapLo + gapSig.indexOf(gapMax);

        let onset = gapLo;
        for (let j = candAbs; j > gapLo; j--) {
          if (smoothDet[j] < onsetThr) {
            onset = j;
            break;
          }
        }
        let offset = gapHi;
        for (let j = candAbs; j < gapHi; j++) {
          if (smoothDet[j] < onsetThr) {
            offset = j;
            break;
          }
        }
        if (offset - onset < Math.floor(0.3 * sampleRate)) {
          continue;
        }

        if (medDur !== null && medPeak !== null) {
          const candDur = (offset - onset) / sampleRate;
          const candPeak = smoothDet[candAbs];
          if (candDur < GAP_MIN_DURATION_FRAC * medDur) {
            continue;
          }
          if (candPeak < GAP_MIN_PEAK_FRAC * medPeak) {
            continue;
          }
        }

        let ok = true;
        if (gyroTrack && setGmax && setGmax > 0) {
          const sT = timesSec[onset];
          const eT = timesSec[Math.min(offset, timesSec.length - 1)];
          const meanG = meanEnergyInRange(gyroTrack, sT, eT);
          ok = meanG !== null ? meanG >= GYRO_CONFIRM_FRAC * setGmax : true;
        }
        if (!ok) {
          continue;
        }

        allReps.push({
          setNumber,
          onsetIdx: onset,
          offsetIdx: offset,
          peakIdx: candAbs,
          recovered: true,
        });
      }
    }

    const setRepsForSplit = allReps
      .filter(r => r.setNumber === setNumber)
      .sort((a, b) => a.onsetIdx - b.onsetIdx);
    if (setRepsForSplit.length >= 3) {
      const medDur = median(setRepsForSplit.map(r => (r.offsetIdx - r.onsetIdx) / sampleRate));

      for (const rep of [...setRepsForSplit]) {
        const dur = (rep.offsetIdx - rep.onsetIdx) / sampleRate;
        if (dur < MERGE_SUSPECT_DURATION_MULT * medDur) {
          continue;
        }
        const s = rep.onsetIdx;
        const e = rep.offsetIdx;
        const subSeg = smoothDet.slice(s, e);
        const relStart = Math.max(0, s - ss);
        const relEnd = Math.max(1, e - ss);
        const periodSlice =
          relStart < periodPerSample.length ? periodPerSample.slice(relStart, relEnd) : [];
        const localPeriod =
          periodSlice.length > 0
            ? periodSlice.reduce((a, b) => a + b, 0) / periodSlice.length
            : globalPeriod;

        const subWin = Math.max(3, Math.floor(SPLIT_SMOOTH_FRACTION * localPeriod * sampleRate));
        const subSmooth = rollingMean(subSeg, subWin);
        const subDist = Math.max(3, Math.floor(0.4 * localPeriod * sampleRate));
        const subRange = Math.max(...subSmooth) - Math.min(...subSmooth);
        const subProm = SPLIT_PROMINENCE_FRAC * Math.max(subRange, 1e-6);
        const subPeaks = findPeaks(subSmooth, { distance: subDist, prominence: subProm });

        if (subPeaks.length < 2) {
          continue;
        }

        const newReps: DetectedRep[] = [];
        for (let k = 0; k < subPeaks.length; k++) {
          const spk = subPeaks[k];
          const absPk = s + spk;
          const leftB = k > 0 ? s + Math.floor((subPeaks[k - 1] + spk) / 2) : s;
          const rightB = k < subPeaks.length - 1 ? s + Math.floor((spk + subPeaks[k + 1]) / 2) : e;

          let o = leftB;
          for (let j = absPk; j > leftB; j--) {
            if (smoothDet[j] < onsetThr) {
              o = j;
              break;
            }
          }
          let off = rightB;
          for (let j = absPk; j < rightB; j++) {
            if (smoothDet[j] < onsetThr) {
              off = j;
              break;
            }
          }
          if (off - o < Math.floor(0.3 * sampleRate)) {
            o = leftB;
            off = rightB;
          }
          newReps.push({ setNumber, onsetIdx: o, offsetIdx: off, peakIdx: absPk, splitFromMerge: true });
        }

        allReps = allReps.filter(r => r !== rep);
        allReps.push(...newReps);
      }
    }
  }

  allReps.sort((a, b) => a.setNumber - b.setNumber || a.onsetIdx - b.onsetIdx);
  return allReps;
}
