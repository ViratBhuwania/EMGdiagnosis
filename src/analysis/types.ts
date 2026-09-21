/** Internal types for the on-device rep-detection/analysis pipeline. */

export interface SetBoundary {
  /** Index into the session's row array (inclusive). */
  startIdx: number;
  /** Index into the session's row array (exclusive), matching Python slice semantics. */
  endIdx: number;
}

export interface DetectedRep {
  setNumber: number;
  onsetIdx: number;
  offsetIdx: number;
  peakIdx: number;
  recovered?: boolean;
  splitFromMerge?: boolean;
}

export interface GyroEnergyTrack {
  energy: number[];
  timesSec: number[];
}

/** Per-rep features, mirroring the desktop script's extract_features() output. */
export interface RepFeatures {
  repNumber: number;
  setNumber: number;
  startSec: number;
  endSec: number;
  peakSec: number;
  durationSec: number;
  peakRaw: number;
  meanRaw: number;
  /** Percentage of the session's own best rep -- see analyzeSession.ts for why. */
  activationPct: number;
  riseTimeSec: number;
  fallTimeSec: number;
  contractionSymmetry: number;
  area: number;
  mdfHz: number | null;
}

/** Per-set fatigue summary, mirroring the desktop script's extract_set_fatigue(). */
export interface SetFatigue {
  setNumber: number;
  repCount: number;
  meanActivationPct: number;
  firstActivationPct: number;
  lastActivationPct: number;
  meanArea: number;
  meanDurationSec: number;
  fatigueSlopeArea: number | null;
  fatigueSlopeAreaR2: number | null;
  fatigueSlopeMdf: number | null;
  fatigueSlopeMdfR2: number | null;
  /**
   * True if this set showed the standard sEMG fatigue signature: rising
   * amplitude (Area) together with falling median frequency. Amplitude
   * alone can rise from increased effort; paired with a falling MDF it's
   * specifically fatigue.
   */
  fatigueDetected: boolean;
  /**
   * The set-local rep number (1-indexed within this set) at which the
   * fatigue signature first appears, found by re-running the same check on
   * an expanding window of reps 1..N. Null if fatigue wasn't detected in
   * this set. Testing/diagnostic only -- the shipped UI should show a
   * plain badge, not a specific rep number (rep-boundary detection isn't
   * perfect, and a wrong number here would read as "the app is broken").
   */
  fatigueStartRep: number | null;
}

export interface SessionAnalysis {
  sampleRateHz: number;
  sets: SetFatigue[];
  reps: RepFeatures[];
  /** Highest peak among all detected reps this session -- the activation-% denominator. */
  sessionBestPeak: number;
  /** The 80ms-smoothed EMG trace used for detection, for the full-session visual review. */
  smoothDet: number[];
  /** Elapsed-time timestamps parallel to `smoothDet`. */
  timesSec: number[];
  /** Detected set spans, in seconds, for shading the trace. */
  setSpansSec: [number, number][];
  /**
   * True if `sessionBestPeak` came in well below the calibration reference
   * -- session-local activation % alone can't catch "this whole session was
   * low-quality" (it only measures consistency within itself), so this uses
   * the externally-anchored calibration reading as an absolute sanity floor
   * instead. Always false if no calibration reference was available.
   */
  lowActivationWarning: boolean;
}
