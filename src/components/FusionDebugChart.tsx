import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Path } from '@shopify/react-native-skia';
import type { FusedAngleTrack } from '../analysis/types';

interface FusionDebugChartProps {
  track: FusedAngleTrack;
  height?: number;
}

const TARGET_POINTS = 600;
const ACCEL_COLOR = '#8A8F98';
const GYRO_COLOR = '#C62828';
const FUSED_COLOR = '#33C481';

function buildPath(
  times: number[],
  values: number[],
  indices: number[],
  xOf: (t: number) => number,
  yOf: (v: number) => number,
): string {
  if (indices.length === 0) {
    return '';
  }
  let d = `M${xOf(times[indices[0]]).toFixed(1)},${yOf(values[indices[0]]).toFixed(1)}`;
  for (let k = 1; k < indices.length; k++) {
    const i = indices[k];
    d += ` L${xOf(times[i]).toFixed(1)},${yOf(values[i]).toFixed(1)}`;
  }
  return d;
}

/**
 * Testing-only overlay: raw accelerometer angle, raw gyro-integrated angle,
 * and the complementary-filter output on the same axes, so the fusion can
 * be visually sanity-checked -- the fused line should hug the gyro's
 * short-term shape while staying pinned near the accelerometer's long-term
 * average instead of drifting away like pure integration does.
 */
function FusionDebugChart({ track, height = 160 }: FusionDebugChartProps) {
  const [width, setWidth] = useState(0);

  const { accelPath, gyroPath, fusedPath } = useMemo(() => {
    const n = track.timesSec.length;
    if (width === 0 || n === 0) {
      return { accelPath: '', gyroPath: '', fusedPath: '' };
    }
    const stride = Math.max(1, Math.floor(n / TARGET_POINTS));
    const indices: number[] = [];
    for (let i = 0; i < n; i += stride) {
      indices.push(i);
    }
    if (indices[indices.length - 1] !== n - 1) {
      indices.push(n - 1);
    }

    const all = [...track.accelAngleDeg, ...track.gyroIntegratedAngleDeg, ...track.fusedAngleDeg];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.1 || 1;
    const yLo = lo - pad;
    const yHi = hi + pad;
    const tMin = track.timesSec[0];
    const tMax = track.timesSec[n - 1] || 1;

    const xOf = (t: number) => ((t - tMin) / (tMax - tMin || 1)) * width;
    const yOf = (v: number) => height - ((v - yLo) / (yHi - yLo || 1)) * height;

    return {
      accelPath: buildPath(track.timesSec, track.accelAngleDeg, indices, xOf, yOf),
      gyroPath: buildPath(track.timesSec, track.gyroIntegratedAngleDeg, indices, xOf, yOf),
      fusedPath: buildPath(track.timesSec, track.fusedAngleDeg, indices, xOf, yOf),
    };
  }, [width, height, track]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sensor Fusion (debug) — axis: {track.axis}</Text>
      <View style={{ height }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Canvas style={{ width, height }}>
            {accelPath ? <Path path={accelPath} style="stroke" strokeWidth={1} color={ACCEL_COLOR} /> : null}
            {gyroPath ? <Path path={gyroPath} style="stroke" strokeWidth={1} color={GYRO_COLOR} /> : null}
            {fusedPath ? <Path path={fusedPath} style="stroke" strokeWidth={2} color={FUSED_COLOR} /> : null}
          </Canvas>
        )}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: ACCEL_COLOR }]} />
          <Text style={styles.legendLabel}>Accel angle (noisy, no drift)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: GYRO_COLOR }]} />
          <Text style={styles.legendLabel}>Gyro integrated (smooth, drifts)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: FUSED_COLOR }]} />
          <Text style={styles.legendLabel}>Fused</Text>
        </View>
      </View>
      <Text style={styles.caption}>
        Testing only. Fused (green) should track the gyro's shape short-term without drifting
        away from the accelerometer's long-term average the way the red line does.
      </Text>
    </View>
  );
}

/** Memoized for the same reason as SessionTraceChart -- see its comment. */
export default React.memo(FusionDebugChart);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  title: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendLabel: {
    color: '#8A8F98',
    fontSize: 10,
  },
  caption: {
    color: '#5B6270',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 8,
  },
});
