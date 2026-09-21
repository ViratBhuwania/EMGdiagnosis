/** One completed calibration hold: a fixed known weight, held isometrically. */
export interface CalibrationRecord {
  timestampMs: number;
  weightKg: number;
  /** Mean envelope over the hold's stable middle window. */
  referenceValue: number;
  /** True if this reading was flagged as an outlier vs. the recent trend when captured. */
  wasFlaggedOutlier: boolean;
}

export interface CalibrationStatus {
  history: CalibrationRecord[];
  /** The current best estimate to compare sessions against -- see calibrationTrend.ts. */
  effectiveReference: number | null;
  lastCalibratedAt: number | null;
}
