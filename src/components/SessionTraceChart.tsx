import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Line, Path, Rect } from '@shopify/react-native-skia';
import type { RepFeatures } from '../analysis/types';
import { setColor } from './setColors';

interface SessionTraceChartProps {
  title: string;
  timesSec: number[];
  values: number[];
  setSpansSec: [number, number][];
  reps: RepFeatures[];
  height?: number;
}

const TARGET_POINTS = 1000;

/** Local-max decimation so peaks survive downsampling, unlike a naive stride sample. */
function downsample(times: number[], values: number[], targetPoints: number) {
  const n = values.length;
  if (n <= targetPoints) {
    return { times, values };
  }
  const bucketSize = n / targetPoints;
  const outTimes: number[] = [];
  const outValues: number[] = [];
  for (let i = 0; i < targetPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(n, Math.floor((i + 1) * bucketSize));
    let maxV = -Infinity;
    let maxIdx = start;
    for (let j = start; j < end; j++) {
      if (values[j] > maxV) {
        maxV = values[j];
        maxIdx = j;
      }
    }
    outTimes.push(times[maxIdx]);
    outValues.push(maxV);
  }
  return { times: outTimes, values: outValues };
}

/**
 * A static (non-scrolling), full-session trace: the smoothed EMG signal
 * with detected set spans, rep spans, and rep peaks overlaid -- the mobile
 * equivalent of the desktop script's top diagnostic panel. Rendered once
 * from props (no live updates), so none of LiveChart's imperative-ref/RAF
 * machinery is needed here.
 */
function SessionTraceChart({
  title,
  timesSec,
  values,
  setSpansSec,
  reps,
  height = 180,
}: SessionTraceChartProps) {
  const [width, setWidth] = useState(0);

  const { pathD, minTime, maxTime } = useMemo(() => {
    if (width === 0 || values.length === 0) {
      return { pathD: '', minTime: 0, maxTime: 1 };
    }
    const { times: dTimes, values: dValues } = downsample(timesSec, values, TARGET_POINTS);
    const lo = Math.min(...dValues);
    const hi = Math.max(...dValues);
    const pad = (hi - lo) * 0.1 || 1;
    const yLo = lo - pad;
    const yHi = hi + pad;
    const tMin = dTimes[0];
    const tMax = dTimes[dTimes.length - 1] || 1;

    const xOf = (t: number) => ((t - tMin) / (tMax - tMin || 1)) * width;
    const yOf = (v: number) => height - ((v - yLo) / (yHi - yLo || 1)) * height;

    let d = `M${xOf(dTimes[0]).toFixed(1)},${yOf(dValues[0]).toFixed(1)}`;
    for (let i = 1; i < dTimes.length; i++) {
      d += ` L${xOf(dTimes[i]).toFixed(1)},${yOf(dValues[i]).toFixed(1)}`;
    }
    return { pathD: d, minTime: tMin, maxTime: tMax };
  }, [width, height, timesSec, values]);

  const xOf = (t: number) => ((t - minTime) / (maxTime - minTime || 1)) * width;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={{ height }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Canvas style={{ width, height }}>
            {setSpansSec.map(([s, e], i) => (
              <Rect
                key={`set-${i}`}
                x={xOf(s)}
                y={0}
                width={Math.max(1, xOf(e) - xOf(s))}
                height={height}
                color="#2F6FED"
                opacity={0.08}
              />
            ))}
            {reps.map(rep => (
              <Rect
                key={`rep-${rep.repNumber}`}
                x={xOf(rep.startSec)}
                y={0}
                width={Math.max(1, xOf(rep.endSec) - xOf(rep.startSec))}
                height={height}
                color={setColor(rep.setNumber)}
                opacity={0.22}
              />
            ))}
            {pathD ? <Path path={pathD} style="stroke" strokeWidth={1.5} color="#E6E8EB" /> : null}
            {reps.map(rep => (
              <Line
                key={`peak-${rep.repNumber}`}
                p1={{ x: xOf(rep.peakSec), y: 0 }}
                p2={{ x: xOf(rep.peakSec), y: height }}
                color={setColor(rep.setNumber)}
                strokeWidth={1}
              />
            ))}
          </Canvas>
        )}
      </View>
      <Text style={styles.caption}>
        Shaded bands = detected sets · colored spans/lines = individual reps &amp; peaks
      </Text>
    </View>
  );
}

/**
 * Memoized so an unrelated ancestor re-render (e.g. LiveSessionScreen's
 * ~5Hz stats-bar tick while recording) doesn't re-render this Skia canvas
 * when its own props (all sourced from one stable `analysis` object)
 * haven't actually changed -- every prop here is a plain value/array, so
 * the default shallow comparison is sufficient.
 */
export default React.memo(SessionTraceChart);

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
  caption: {
    color: '#8A8F98',
    fontSize: 10,
    marginTop: 6,
  },
});
