/**
 * Shared types for the EMG/IMU BLE session app.
 */

/**
 * One notification's worth of physical sensor data, parsed and unit-converted,
 * before it's assigned a session sample number / elapsed time.
 */
export interface ParsedSample {
  /** Raw filtered EMG signal (ADC-scale integer, can be negative). */
  signal: number;
  /** EMG envelope (moving-average of |signal|, ADC-scale integer). */
  envelope: number;

  /** Accelerometer, converted to g. */
  axG: number;
  ayG: number;
  azG: number;

  /** Gyroscope, converted to degrees/second. */
  gxDps: number;
  gyDps: number;
  gzDps: number;

  /** True if this row carried a freshly-read IMU sample (vs. a repeated one). */
  imuFresh: boolean;

  /** Upper-arm tilt / roll angle in degrees, derived from ayG/azG. */
  rollDeg: number;
}

/** One fully parsed row of sensor data, as recorded during a session. */
export interface SensorRow extends ParsedSample {
  /** 1-based sample index within the current recording. */
  sample: number;
  /** Elapsed recording time in seconds at the moment this row was received. */
  timeSec: number;
}

/** A user-marked repetition during a live session. */
export interface RepMark {
  /** 1-based rep number in the order marked (R1, R2, R3, ...). */
  repNumber: number;
  /** The `sample` value of the most recently recorded row at mark time. */
  approxSample: number;
  /** Elapsed session time in seconds at mark time. */
  timeSec: number;
}

/** Connection lifecycle state for the BLE device. */
export type BleConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

/** State of the phone's Bluetooth radio, as reported by react-native-ble-plx. */
export type BluetoothPowerState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn';

/** A discovered BLE peripheral advertising the expected service UUID. */
export interface DiscoveredDevice {
  id: string;
  name: string | null;
  rssi: number | null;
}

/**
 * One completed rep's activation, as a percentage of the session's best rep.
 * "A rep" here is the span between one Mark Rep press and the next (or Stop
 * for the last one) — the app has no auto rep-detection, so this is anchored
 * to the same manual marks used everywhere else in the session.
 */
export interface RepActivation {
  repNumber: number;
  /** Highest envelope value recorded during this rep's span. */
  peakEnvelope: number;
  /** peakEnvelope as a percentage of the session's overall best rep (0-100+). */
  activationPct: number;
}

/** Session-end activation summary, e.g. for a post-session summary panel. */
export interface ActivationSummary {
  repActivations: RepActivation[];
  averagePct: number;
  /** averagePct rounded to a 1-10 scale, matching an RPE-style readout. */
  averageScore10: number;
}
