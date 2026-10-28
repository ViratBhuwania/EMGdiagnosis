import { ACCEL_SCALE, GYRO_SCALE } from './constants';
import type { ParsedSample } from '../types';

/**
 * Upper-arm tilt / roll angle, in degrees, from accelerometer readings in g.
 * Matches the desktop tool: roll_deg = degrees(atan2(ay_g, az_g)).
 */
export function computeRollDeg(ayG: number, azG: number): number {
  return (Math.atan2(ayG, azG) * 180) / Math.PI;
}

/**
 * Parse one raw CSV row received from the TX characteristic notification into a
 * typed, unit-converted ParsedSample. The ESP32 guarantees each notification is
 * one complete row: "signal,envelope,ax,ay,az,gx,gy,gz,imu_fresh[,seq,ms]".
 *
 * Returns null if the row is malformed, so a single corrupt BLE packet can be
 * dropped by the caller instead of crashing the session.
 */
export function parseSensorRow(csv: string): ParsedSample | null {
  const fields = csv.trim().split(',');
  // 9 fields = older firmware; 11 fields = + device row number and clock.
  if (fields.length !== 9 && fields.length !== 11) {
    return null;
  }

  const values = fields.map(f => Number(f));
  if (values.some(v => Number.isNaN(v))) {
    return null;
  }

  const [signal, envelope, ax, ay, az, gx, gy, gz, imuFreshRaw, seqRaw, msRaw] = values;

  const axG = ax / ACCEL_SCALE;
  const ayG = ay / ACCEL_SCALE;
  const azG = az / ACCEL_SCALE;

  const gxDps = gx / GYRO_SCALE;
  const gyDps = gy / GYRO_SCALE;
  const gzDps = gz / GYRO_SCALE;

  return {
    signal,
    envelope,
    axG,
    ayG,
    azG,
    gxDps,
    gyDps,
    gzDps,
    imuFresh: imuFreshRaw === 1,
    rollDeg: computeRollDeg(ayG, azG),
    ...(fields.length === 11 ? { deviceSeq: seqRaw, deviceMs: msRaw } : {}),
  };
}
