/** Internal types for the on-device rep-detection/analysis pipeline. */
import type { GyroAxis } from './imuAxis';

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

export interface FusedAngleTrack {
  timesSec: number[];
  accelAngleDeg: number[];
  gyroIntegratedAngleDeg: number[];
  fusedAngleDeg: number[];
  axis: GyroAxis;
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
  /** Highest single-rep peak in this set -- used to check a set against the *current* activation ceiling later, since the ceiling can grow after this set was recorded. */
  peakEnvelope: number;
  /** 90th percentile of this set's own rep peaks -- a more robust "typical high effort" figure than the single max, used for set-to-set comparison. */
  p90Peak: number;
  fatigueSlopeArea: number | null;
  fatigueSlopeAreaR2: number | null;
  fatigueSlopeMdf: number | null;
  fatigueSlopeMdfR2: number | null;
  /**
   * Set only when fatigueSlopeMdf came from the firmware's per-set summary
   * (summaryMdf.ts): then the slope is Hz per time bin of this many
   * seconds, not Hz per rep. Undefined when no summary was paired.
   */
  mdfBinSeconds?: number;
  /**
   * Summary path only: % change of the MDF from the average of the first
   * third to the last third of the set's valid bins (negative = falling).
   */
  mdfDropPct?: number;
  /**
   * Summary path only. 'assessed': fatigueDetected came from the set's MDF
   * summary. 'too-short': too few valid MDF bins to judge. 'no-summary': no
   * summary has been paired with this set (yet). In the last two cases
   * fatigueDetected is false but means "not judged", not "not reached".
   */
  fatigueAssessment?: 'assessed' | 'too-short' | 'no-summary';
  /** Summary path only: the firmware's per-bin MDF (Hz) for this set, null = unusable bin. Kept so the raw material of the verdict is saved/shareable. */
  mdfBinsHz?: Array<number | null>;
  /** Summary path only: per-bin ZCR (Hz-equivalent), same bins as mdfBinsHz. */
  zcrBinsHz?: Array<number | null>;
  /** Summary path only: seconds of real (above-threshold) activity in the set. */
  mdfActiveSec?: number;
  /** Summary path only: how many bins had a usable MDF. */
  mdfValidBins?: number;
  /** Summary path only: how many firmware summaries were joined (>1 = set longer than the firmware buffer). */
  summaryParts?: number;
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
  /** Highest peak among all detected reps this session. */
  sessionBestPeak: number;
  /**
   * The denominator actually used for every rep's activationPct this
   * session: max(max-effort reference, rolling historical peak for this
   * exercise, sessionBestPeak). Exposed so a caller can show what ceiling
   * was used, or cheaply recompute activationPct against a new ceiling
   * (see recomputeActivationCeiling.ts) once a better one becomes known
   * (e.g. the exercise tag is entered after Stop).
   */
  activationCeiling: number;
  /** The max-effort/rolling-historical-peak inputs that fed activationCeiling, kept alongside it for debug/audit display -- see SessionHistoryScreen's debug view. Null if that source wasn't available. */
  maxEffortReferenceUsed: number | null;
  rollingHistoricalPeakUsed: number | null;
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
  /**
   * The gyro/accel complementary-filter output -- the foundation for future
   * ROM/tempo/swing features. Null if there wasn't enough fresh IMU data,
   * or the dominant rotation axis came out as yaw (not observable from the
   * accelerometer). Testing/debug display only for now; nothing reads the
   * angle values yet.
   */
  fusedAngle: FusedAngleTrack | null;
}
