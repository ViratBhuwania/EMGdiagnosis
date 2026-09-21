/**
 * Tunable constants for the rep-detection pipeline, ported 1:1 from the
 * desktop analysis script's CONFIG section (values unchanged — these were
 * tuned against real annotated sessions there). File-specific settings from
 * the original script (INPUT_FILE, ANNOT_FILE, SAVE_*) don't apply on-device
 * and are omitted.
 */

export const REST_WINDOW_S = 5.0;

export const MIN_REST_BETWEEN_SETS_S = 8.0;
export const SET_ACTIVITY_THRESHOLD_K = 0.1;

export const ACF_MIN_PERIOD_S = 0.8;
export const ACF_MAX_PERIOD_S = 10.0;

export const LOCAL_WINDOW_MULT = 4.0;
export const LOCAL_STEP_FRAC = 0.5;
export const N_SMOOTH_LEVELS = 6;

export const SMOOTH_FRACTION = 0.4;
export const MIN_PEAK_PROMINENCE_FRAC = 0.3;
export const ONSET_THRESHOLD_K = 0.12;

export const LOCAL_PROM_WINDOW_MULT = 3.0;

export const ENABLE_GAP_RECOVERY = true;
export const GAP_MIN_DURATION_FRAC = 0.4;
export const GAP_MIN_PEAK_FRAC = 0.4;

export const MERGE_SUSPECT_DURATION_MULT = 1.6;
export const SPLIT_SMOOTH_FRACTION = 0.2;
export const SPLIT_PROMINENCE_FRAC = 0.18;

export const GYRO_WINDOW_S = 0.4;
export const GYRO_CONFIRM_FRAC = 0.25;
/** Nominal IMU rate, used only as a fallback if the real rate can't be measured. */
export const IMU_RATE_FALLBACK = 100;
