/**
 * Which gyro axis is actually doing the rotating this session, picked by
 * variance rather than assumed from a fixed mounting convention -- so the
 * fusion filter and the gyro-confirmation gate keep working if the strap
 * orientation shifts slightly between sessions, without a hand-calibrated
 * axis constant.
 */
import type { SensorRow } from '../types';
import { variance } from './dsp';

export type GyroAxis = 'gx' | 'gy' | 'gz';

/** `imuRows` must already be filtered to `imuFresh` rows. */
export function selectDominantGyroAxis(imuRows: SensorRow[]): GyroAxis {
  const vx = variance(imuRows.map(r => r.gxDps));
  const vy = variance(imuRows.map(r => r.gyDps));
  const vz = variance(imuRows.map(r => r.gzDps));
  if (vy >= vx && vy >= vz) {
    return 'gy';
  }
  if (vz >= vx) {
    return 'gz';
  }
  return 'gx';
}
