/**
 * Complementary filter fusing the gyro's responsive-but-drifting integrated
 * angle with the accelerometer's drift-free-but-noisy tilt angle, into a
 * single angle track that later features (ROM, tempo, swing detection) can
 * read from directly instead of each re-deriving their own noisy version.
 *
 * Runs once, post-session, over the full row array -- same pattern as
 * computeGyroEnergy in repDetection.ts, and for the same reason: everything
 * downstream of Stop already works this way, and a running filter with real
 * per-sample dt doesn't need to be live to be correct.
 */
import type { SensorRow } from '../types';
import { COMPLEMENTARY_FILTER_ALPHA, MAX_FUSION_GAP_S } from './config';
import { selectDominantGyroAxis, type GyroAxis } from './imuAxis';
import type { FusedAngleTrack } from './types';

/**
 * The accelerometer only sees gravity's direction, so it can only measure
 * tilt around axes that change gravity's projection -- roll (about X) and
 * pitch (about Y). Yaw (about Z, the vertical) leaves gravity's direction
 * unchanged, so there's nothing to derive an accel angle from at all.
 */
function accelAngleDegFor(axis: GyroAxis, row: SensorRow): number | null {
  if (axis === 'gx') {
    return (Math.atan2(row.ayG, row.azG) * 180) / Math.PI;
  }
  if (axis === 'gy') {
    return (Math.atan2(-row.axG, Math.sqrt(row.ayG * row.ayG + row.azG * row.azG)) * 180) / Math.PI;
  }
  return null;
}

function gyroDpsFor(axis: GyroAxis, row: SensorRow): number {
  if (axis === 'gx') {
    return row.gxDps;
  }
  if (axis === 'gy') {
    return row.gyDps;
  }
  return row.gzDps;
}

/**
 * Null if there's not enough fresh IMU data, or if the dominant rotation
 * axis turns out to be yaw -- which shouldn't happen for a forearm mount
 * tracking elbow flexion (that motion tilts the forearm relative to
 * gravity, landing on roll or pitch), but is guarded rather than assumed.
 */
export function computeFusedAngle(rows: SensorRow[]): FusedAngleTrack | null {
  const imuRows = rows.filter(r => r.imuFresh);
  if (imuRows.length < 10) {
    return null;
  }

  const axis = selectDominantGyroAxis(imuRows);
  if (axis === 'gz') {
    return null;
  }

  const n = imuRows.length;
  const timesSec = imuRows.map(r => r.timeSec);
  const accelAngleDeg = new Array<number>(n);
  const gyroIntegratedAngleDeg = new Array<number>(n);
  const fusedAngleDeg = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const row = imuRows[i];
    const accelAngle = accelAngleDegFor(axis, row) as number;
    accelAngleDeg[i] = accelAngle;

    if (i === 0) {
      gyroIntegratedAngleDeg[i] = accelAngle;
      fusedAngleDeg[i] = accelAngle;
      continue;
    }

    const dt = timesSec[i] - timesSec[i - 1];
    if (dt <= 0 || dt > MAX_FUSION_GAP_S) {
      // A stall/reconnect gap -- re-seed from the accelerometer rather than
      // integrating the gyro across an unknown span of missed motion.
      gyroIntegratedAngleDeg[i] = accelAngle;
      fusedAngleDeg[i] = accelAngle;
      continue;
    }

    const gyroRate = gyroDpsFor(axis, row);
    gyroIntegratedAngleDeg[i] = gyroIntegratedAngleDeg[i - 1] + gyroRate * dt;

    const predicted = fusedAngleDeg[i - 1] + gyroRate * dt;
    fusedAngleDeg[i] = COMPLEMENTARY_FILTER_ALPHA * predicted + (1 - COMPLEMENTARY_FILTER_ALPHA) * accelAngle;
  }

  return { timesSec, accelAngleDeg, gyroIntegratedAngleDeg, fusedAngleDeg, axis };
}
