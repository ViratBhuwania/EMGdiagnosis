/**
 * Ported from extract_features()/extract_set_fatigue() in the desktop
 * script. One deliberate change: activation % is computed against the
 * session's own best detected rep (no clip at 100%), not the script's
 * percentile-based `session_peak` -- see analyzeSession.ts for why.
 */
import type { SensorRow } from '../types';
import { linregress, medianFrequency, percentile, trapezoidalIntegral } from './dsp';
import type { DetectedRep, RepFeatures, SetFatigue } from './types';

/** Per-rep features for every detected rep, activation % relative to `activationCeiling`. */
export function extractRepFeatures(
  rows: SensorRow[],
  detectedReps: DetectedRep[],
  noiseFloor: number,
  sampleRate: number,
  activationCeiling: number,
): RepFeatures[] {
  const envelope = rows.map(r => r.envelope);
  const raw = rows.map(r => r.signal);
  const timesSec = rows.map(r => r.timeSec);
  const n = envelope.length;

  return detectedReps.map((rep, i) => {
    const s = Math.max(0, Math.min(rep.onsetIdx, n - 1));
    const e = Math.max(s + 1, Math.min(rep.offsetIdx, n));
    const pk = Math.max(0, Math.min(rep.peakIdx, n - 1));

    const seg = envelope.slice(s, e);
    const durationSec = (e - s) / sampleRate;
    const peakRaw = Math.max(...seg);
    const meanRaw = seg.reduce((a, b) => a + b, 0) / seg.length;
    const area = trapezoidalIntegral(
      seg.map(v => Math.max(v - noiseFloor, 0)),
      1 / sampleRate,
    );
    const activationPct = activationCeiling > 0 ? (peakRaw / activationCeiling) * 100 : 0;

    const half = 0.5 * peakRaw;
    let pkL = 0;
    for (let j = 1; j < seg.length; j++) {
      if (seg[j] > seg[pkL]) {
        pkL = j;
      }
    }
    let riseS = 0;
    for (let j = 0; j < pkL; j++) {
      if (seg[j] > half) {
        riseS = j;
        break;
      }
    }
    const riseTimeSec = (pkL - riseS) / sampleRate;

    let lastFallRel = -1;
    for (let j = pkL; j < seg.length; j++) {
      if (seg[j] > half) {
        lastFallRel = j - pkL;
      }
    }
    const fallTimeSec = lastFallRel >= 0 ? lastFallRel / sampleRate : 0;

    const symDenom = riseTimeSec + fallTimeSec;
    const contractionSymmetry = symDenom > 0 ? riseTimeSec / symDenom : 0.5;

    const rawSeg = raw.slice(s, e);
    const mdfHz = rawSeg.length >= 64 ? medianFrequency(rawSeg, sampleRate) : null;

    return {
      repNumber: i + 1,
      setNumber: rep.setNumber,
      startSec: timesSec[s],
      endSec: timesSec[e - 1],
      peakSec: timesSec[pk],
      durationSec,
      peakRaw,
      meanRaw,
      activationPct,
      riseTimeSec,
      fallTimeSec,
      contractionSymmetry,
      area,
      mdfHz,
    };
  });
}

/**
 * Re-runs the fatigue check on an expanding window (reps 1..i, 1..i+1, ...)
 * to find the first rep at which the fatigue signature already holds.
 * Testing/diagnostic use only -- see the `fatigueStartRep` doc comment.
 */
function findFatigueStartRep(sub: RepFeatures[]): number | null {
  for (let i = 3; i <= sub.length; i++) {
    const windowReps = sub.slice(0, i);
    const x = windowReps.map((_, idx) => idx);
    const areaFit = linregress(x, windowReps.map(r => r.area));
    if (areaFit.slope <= 0) {
      continue;
    }
    // MDF confirms only when available -- see the fatigueDetected comment
    // in extractSetFatigue for why it can't be required.
    const mdfValues = windowReps.map(r => r.mdfHz).filter((v): v is number => v !== null);
    if (mdfValues.length >= 3) {
      const mdfFit = linregress(
        mdfValues.map((_, idx) => idx),
        mdfValues,
      );
      if (mdfFit.slope >= 0) {
        continue;
      }
    }
    return i;
  }
  return null;
}

/** Per-set fatigue trend: activation/area/MDF trajectory across a set's reps. */
export function extractSetFatigue(repFeatures: RepFeatures[]): SetFatigue[] {
  const setNumbers = [...new Set(repFeatures.map(r => r.setNumber))].sort((a, b) => a - b);

  return setNumbers.map(setNumber => {
    const sub = repFeatures.filter(r => r.setNumber === setNumber);
    const n = sub.length;

    const meanActivationPct = sub.reduce((a, r) => a + r.activationPct, 0) / n;
    const meanArea = sub.reduce((a, r) => a + r.area, 0) / n;
    const meanDurationSec = sub.reduce((a, r) => a + r.durationSec, 0) / n;
    const peakEnvelope = Math.max(...sub.map(r => r.peakRaw));
    const p90Peak = percentile(sub.map(r => r.peakRaw), 90);

    let fatigueSlopeArea: number | null = null;
    let fatigueSlopeAreaR2: number | null = null;
    let fatigueSlopeMdf: number | null = null;
    let fatigueSlopeMdfR2: number | null = null;

    if (n >= 3) {
      const x = sub.map((_, i) => i);
      const areaFit = linregress(x, sub.map(r => r.area));
      fatigueSlopeArea = areaFit.slope;
      fatigueSlopeAreaR2 = areaFit.r2;

      const mdfValues = sub.map(r => r.mdfHz).filter((v): v is number => v !== null);
      if (mdfValues.length >= 3) {
        const mdfFit = linregress(mdfValues.map((_, i) => i), mdfValues);
        fatigueSlopeMdf = mdfFit.slope;
        fatigueSlopeMdfR2 = mdfFit.r2;
      }
    }

    // Rising amplitude AND falling median frequency together would be the
    // ideal sEMG fatigue signature -- amplitude alone can just mean "tried
    // harder." But MDF needs 20-250Hz content in the raw signal, which
    // needs a true sample rate above 500Hz to resolve at all; this app's
    // BLE stream runs at ~30-50Hz (connection-interval limited), whose
    // Nyquist frequency sits entirely below that band. medianFrequency()
    // therefore returns null for every rep here, always -- not sometimes,
    // not depending on effort. Requiring it would mean fatigue could never
    // be detected regardless of how hard a set actually was. So: amplitude
    // trend alone is treated as sufficient, and MDF is used to confirm
    // only when it happens to be available (e.g. if BLE throughput ever
    // improves enough to make it computable).
    const fatigueDetected =
      fatigueSlopeArea !== null &&
      fatigueSlopeArea > 0 &&
      (fatigueSlopeMdf === null || fatigueSlopeMdf < 0);
    const fatigueStartRep = fatigueDetected ? findFatigueStartRep(sub) : null;

    return {
      setNumber,
      repCount: n,
      meanActivationPct,
      firstActivationPct: sub[0].activationPct,
      lastActivationPct: sub[n - 1].activationPct,
      meanArea,
      meanDurationSec,
      peakEnvelope,
      p90Peak,
      fatigueSlopeArea,
      fatigueSlopeAreaR2,
      fatigueSlopeMdf,
      fatigueSlopeMdfR2,
      fatigueDetected,
      fatigueStartRep,
    };
  });
}
