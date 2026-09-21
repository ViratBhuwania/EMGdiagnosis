/**
 * BLE protocol constants for the ESP32 EMG/IMU wearable.
 * This side of the protocol is fixed by the firmware — do not change these values
 * without also changing the ESP32 sketch.
 */

/** Advertised device name of the ESP32 peripheral. */
export const DEVICE_NAME = 'EMG-IMU-ESP32';

/** Nordic UART Service (NUS) UUID advertised by the ESP32. */
export const SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';

/** Notify characteristic: ESP32 -> phone, one CSV row per notification. */
export const TX_CHARACTERISTIC_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

/** Write characteristic: phone -> ESP32. Not used by this app. */
export const RX_CHARACTERISTIC_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

/** Accelerometer raw-count -> g conversion, for a +/-2g range. */
export const ACCEL_SCALE = 16384.0;

/** Gyroscope raw-count -> deg/s conversion, for a +/-250 deg/s range. */
export const GYRO_SCALE = 131.0;

/** Number of most-recent samples kept on screen by the live scrolling charts. */
export const SAMPLE_WINDOW_SIZE = 500;

/** How long to scan for peripherals before giving up, in milliseconds. */
export const SCAN_TIMEOUT_MS = 15000;

/** How long to wait for an automatic reconnect before prompting the user, in milliseconds. */
export const RECONNECT_TIMEOUT_MS = 8000;
