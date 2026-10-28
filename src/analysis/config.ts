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

/**
 * Complementary filter blend weight for the gyro/accel angle fusion: how
 * much of each new angle estimate comes from integrating the gyro (vs.
 * snapping to the accelerometer's drift-free-but-noisy angle). Close to 1
 * so short-term motion is gyro-driven and responsive, but not exactly 1 so
 * accelerometer correction keeps leaking in and bounding long-term drift.
 * A starting value -- tune against real recorded sessions once the debug
 * overlay chart shows how it behaves.
 */
export const COMPLEMENTARY_FILTER_ALPHA = 0.98;

/**
 * If the gap between two consecutive fresh IMU rows exceeds this many
 * seconds (a BLE stall/reconnect), the fusion filter re-seeds from the
 * accelerometer instead of integrating the gyro across the gap -- a single
 * huge dt would otherwise inject one wildly wrong angle estimate that the
 * filter's normal (1-alpha) correction is far too slow to recover from.
 */
export const MAX_FUSION_GAP_S = 0.5;

/**
 * IMU-anchored rep counting (imuCycles.ts). A rep is ONE arm-swing cycle
 * (accelerometer principal component) that also contains muscle activity.
 */
/** A set whose gyro never varies by at least this much (dps, std) is treated as "IMU not reading the arm". */
export const IMU_MIN_GYRO_STD_DPS = 3;
/** ...and likewise for the accelerometer (g, std). */
export const IMU_MIN_ACCEL_STD_G = 0.02;
/** Smoothing of the swing signal and of the EMG used to confirm it. */
export const CYCLE_SMOOTH_S = 0.3;
/** A swing must be at least this fraction of the set's typical swing range to be a candidate. */
export const CYCLE_MIN_PROMINENCE_FRAC = 0.3;
/** Two swings closer than this are one swing (a curl takes longer than this). */
export const CYCLE_MIN_SPACING_S = 1.0;
/** How far either side of a swing's peak to look for the muscle burst that drives it. */
export const CYCLE_EMG_WINDOW_S = 0.6;
/** A swing counts only if the EMG around it reaches this fraction of the set's p90 EMG (swinging the arm without working the muscle is not a rep). */
export const CYCLE_MIN_EMG_FRAC = 0.35;
/** A swing smaller than this fraction of the set's typical counted swing is not a rep (e.g. putting the dumbbell down). */
export const CYCLE_MIN_SIZE_FRAC = 0.5;
/** The swing search window extends this far before / after the EMG-detected set span, to catch a weak first or last rep. */
export const CYCLE_SEARCH_PAD_BEFORE_S = 2.5;
export const CYCLE_SEARCH_PAD_AFTER_S = 1.0;

/** A gap between consecutive rows longer than this (seconds) is a connection dropout, not normal jitter. */
export const DATA_GAP_MIN_S = 2.0;
/** Row spacings above this are excluded when estimating the sampling rate (they are dropouts, not sampling). */
export const RATE_MAX_SPACING_S = 0.5;
/** A dropout this close to a set (seconds before its start / after its end) is reported as affecting that set. */
export const DATA_GAP_NEAR_SET_BEFORE_S = 2.0;
export const DATA_GAP_NEAR_SET_AFTER_S = 6.0;

/**
 * A set's first rep can be a one-way move (arm goes from the pre-set posture
 * to the hanging posture with a modest muscle burst, no return swing before
 * the first full curl), so it has no swing peak of its own. It is counted if
 * a burst before the first full swing reaches this fraction of the set's p90
 * EMG AND the arm moved at least this fraction of a typical swing during it.
 */
export const LEAD_IN_MIN_EMG_FRAC = 0.4;
export const LEAD_IN_MIN_MOVE_FRAC = 0.5;

/**
 * Pick-up / put-down filter (imuCycles.ts). The first or last counted swing of
 * a set is dropped if its EMG peak is below END_CYCLE_MAX_EMG_FRAC of the
 * set's median counted EMG peak, or if its swing is below
 * END_CYCLE_WEAK_SIZE_FRAC of the median swing AND its EMG peak is below
 * END_CYCLE_WEAK_EMG_FRAC of the median. Fitted on 9 labelled sets (pick-ups
 * 0.34-0.49x EMG, a put-down 0.69x EMG / 0.6x swing; real end reps >= 0.78x
 * EMG). Needs END_CYCLE_MIN_COUNTED counted swings so the medians mean something.
 */
export const END_CYCLE_MAX_EMG_FRAC = 0.6;
export const END_CYCLE_WEAK_SIZE_FRAC = 0.8;
export const END_CYCLE_WEAK_EMG_FRAC = 0.72;
export const END_CYCLE_MIN_COUNTED = 4;
/** A strong first/last swing (>= this x median swing) is kept even if its EMG burst sits outside the +-0.6 s window. */
export const END_CYCLE_MAX_SWING_FRAC = 0.9;

/**
 * Fragment rule: a split rep shows up as a small, weak swing sitting much
 * closer to a neighbour than the set's typical rep spacing. Dropped when gap
 * < FRAGMENT_MAX_GAP_FRAC x median gap AND swing < FRAGMENT_MAX_SWING_FRAC x
 * median swing AND burst < FRAGMENT_MAX_EMG_FRAC x median burst.
 */
export const FRAGMENT_MAX_GAP_FRAC = 0.6;
export const FRAGMENT_MAX_SWING_FRAC = 0.75;
export const FRAGMENT_MAX_EMG_FRAC = 0.6;
export const FRAGMENT_MIN_COUNTED = 4;
