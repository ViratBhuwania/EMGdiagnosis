/**
 * Orchestrates the ported pipeline end to end: preprocess -> detect sets ->
 * detect reps -> extract features -> per-set fatigue. Runs once, on-device,
 * right after Stop -- this is what replaces exporting the session and
 * running the desktop script by hand.
 *
 * Activation % here is deliberately NOT the desktop script's percentile-of-
 * whole-session ceiling (which clustered many reps at 100% -- a session's
 * own peak reps naturally sit near a whole-session percentile). Instead
 * it's a percentage of THIS session's own best detected rep, uncapped: only
 * one rep can BE the best, so the rest spread out meaningfully, and a rep
 * that's genuinely your hardest of the session is allowed to show as such
 * rather than being flattened to the same 100% as several others.
 */
import type { SensorRow } from '../types';
import type { RepFeatures, SessionAnalysis } from './types';
import type { DetectedRep } from './types';
import {
  computeGyroEnergy,
  detectRepsAdaptive,
  detectSampleRate,
  detectSets,
  preprocessEmg,
} from './repDetection';
import { extractRepFeatures, extractSetFatigue } from './featureExtraction';

export type AnalysisFailureReason = 'no_sets_detected' | 'no_reps_detected' | 'too_few_samples';

/** Below this fraction of the calibration reference, flag the session as low-engagement. */
const LOW_ACTIVATION_FLOOR_FRAC = 0.35;

export type AnalysisResult =
  | { ok: true; analysis: SessionAnalysis }
  | { ok: false; reason: AnalysisFailureReason };

function computeRepPeak(rows: SensorRow[], rep: DetectedRep): number {
  const n = rows.length;
  const s = Math.max(0, Math.min(rep.onsetIdx, n - 1));
  const e = Math.max(s + 1, Math.min(rep.offsetIdx, n));
  let peak = -Infinity;
  for (let i = s; i < e; i++) {
    if (rows[i].envelope > peak) {
      peak = rows[i].envelope;
    }
  }
  return peak;
}

/**
 * Runs the full detection + feature-extraction pipeline over one completed
 * session. `calibrationReference`, if available, enables the low-activation
 * sanity check (see `lowActivationWarning` on the result) -- it plays no
 * part in the session-local activation % itself.
 */
export function analyzeSession(
  rows: SensorRow[],
  calibrationReference: number | null = null,
): AnalysisResult {
  if (rows.length < 100) {
    return { ok: false, reason: 'too_few_samples' };
  }

  const sampleRateHz = detectSampleRate(rows);
  const rawEnvelope = rows.map(r => r.envelope);
  const timesSec = rows.map(r => r.timeSec);

  const { smoothDet, noiseFloor, sigRangeForThresholds } = preprocessEmg(rawEnvelope, sampleRateHz);
  const gyroTrack = computeGyroEnergy(rows);

  const { boundaries } = detectSets(smoothDet, noiseFloor, sigRangeForThresholds, sampleRateHz);
  const setSpansSec: [number, number][] = boundaries.map(b => [
    timesSec[b.startIdx],
    timesSec[Math.min(b.endIdx, timesSec.length - 1)],
  ]);
  if (boundaries.length === 0) {
    return { ok: false, reason: 'no_sets_detected' };
  }

  const detectedReps = detectRepsAdaptive(
    smoothDet,
    timesSec,
    boundaries,
    noiseFloor,
    sigRangeForThresholds,
    gyroTrack,
    sampleRateHz,
  );
  if (detectedReps.length === 0) {
    return { ok: false, reason: 'no_reps_detected' };
  }

  const sessionBestPeak = Math.max(...detectedReps.map(rep => computeRepPeak(rows, rep)));
  const reps: RepFeatures[] = extractRepFeatures(
    rows,
    detectedReps,
    noiseFloor,
    sampleRateHz,
    sessionBestPeak,
  );
  const sets = extractSetFatigue(reps);

  const lowActivationWarning =
    calibrationReference !== null &&
    calibrationReference > 0 &&
    sessionBestPeak < LOW_ACTIVATION_FLOOR_FRAC * calibrationReference;

  return {
    ok: true,
    analysis: {
      sampleRateHz,
      sets,
      reps,
      sessionBestPeak,
      lowActivationWarning,
      smoothDet,
      timesSec,
      setSpansSec,
    },
  };
}
