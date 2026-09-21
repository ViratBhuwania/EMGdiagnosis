import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { Canvas, Path, Line, Text, matchFont } from '@shopify/react-native-skia';
import type { RepMark } from '../types';
import { SAMPLE_WINDOW_SIZE } from '../ble/constants';

export interface ChartSeriesDef {
  key: string;
  label: string;
  color: string;
}

export interface LiveChartHandle {
  /** Push one new point per configured series, tagged with its absolute sample number. */
  push: (values: number[], sampleNumber: number) => void;
  /** Record a rep marker to be drawn once it scrolls into (and out of) the visible window. */
  addRepMarker: (mark: RepMark) => void;
  /** Clear all buffered points and rep markers (e.g. when a new session starts). */
  clear: () => void;
}

interface LiveChartProps {
  title: string;
  series: ChartSeriesDef[];
  height?: number;
  /** Fixed Y-axis range [min, max]. If omitted, auto-scales to the visible buffer each frame. */
  yDomain?: [number, number];
  windowSize?: number;
}

const AXIS_LABEL_WIDTH = 44;
const MARKER_COLOR = '#F5A623';

/**
 * A lightweight, Skia-based scrolling line chart for the last `windowSize`
 * samples. Data is pushed imperatively via a ref handle rather than through
 * React props/state, so a ~50Hz BLE stream never triggers React re-renders on
 * ancestor components — only this component redraws, throttled to one
 * repaint per animation frame.
 */
const LiveChart = forwardRef<LiveChartHandle, LiveChartProps>(
  ({ title, series, height = 150, yDomain, windowSize = SAMPLE_WINDOW_SIZE }, ref) => {
    const [canvasWidth, setCanvasWidth] = useState(0);
    const [tick, setTick] = useState(0);

    const font = useMemo(
      () => matchFont({ fontFamily: 'System', fontSize: 11, fontWeight: 'normal' }),
      [],
    );
    const markerFont = useMemo(
      () => matchFont({ fontFamily: 'System', fontSize: 11, fontWeight: 'bold' }),
      [],
    );

    const buffersRef = useRef<number[][]>(series.map(() => []));
    const sampleNumbersRef = useRef<number[]>([]);
    const repMarkersRef = useRef<RepMark[]>([]);
    const rafScheduledRef = useRef(false);

    const requestRedraw = useCallback(() => {
      if (rafScheduledRef.current) {
        return;
      }
      rafScheduledRef.current = true;
      requestAnimationFrame(() => {
        rafScheduledRef.current = false;
        setTick(t => t + 1);
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        push: (values, sampleNumber) => {
          const buffers = buffersRef.current;
          for (let i = 0; i < buffers.length; i++) {
            buffers[i].push(values[i]);
            if (buffers[i].length > windowSize) {
              buffers[i].shift();
            }
          }
          sampleNumbersRef.current.push(sampleNumber);
          if (sampleNumbersRef.current.length > windowSize) {
            sampleNumbersRef.current.shift();
          }
          requestRedraw();
        },
        addRepMarker: mark => {
          repMarkersRef.current = [...repMarkersRef.current, mark];
          requestRedraw();
        },
        clear: () => {
          buffersRef.current = series.map(() => []);
          sampleNumbersRef.current = [];
          repMarkersRef.current = [];
          requestRedraw();
        },
      }),
      [requestRedraw, series, windowSize],
    );

    const plotWidth = Math.max(canvasWidth - AXIS_LABEL_WIDTH, 0);
    const dx = windowSize > 1 ? plotWidth / (windowSize - 1) : plotWidth;

    const { paths, min, max, markers } = useMemo(() => {
      const buffers = buffersRef.current;
      const sampleNumbers = sampleNumbersRef.current;

      let lo = yDomain ? yDomain[0] : Infinity;
      let hi = yDomain ? yDomain[1] : -Infinity;
      if (!yDomain) {
        for (const buf of buffers) {
          for (const v of buf) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          lo = -1;
          hi = 1;
        } else if (lo === hi) {
          lo -= 1;
          hi += 1;
        } else {
          const pad = (hi - lo) * 0.1;
          lo -= pad;
          hi += pad;
        }
      }

      const valueToY = (v: number) => {
        const clamped = Math.min(Math.max(v, lo), hi);
        return height - ((clamped - lo) / (hi - lo)) * height;
      };

      const builtPaths = buffers.map(buf => {
        if (buf.length === 0) {
          return '';
        }
        let d = `M${AXIS_LABEL_WIDTH},${valueToY(buf[0]).toFixed(2)}`;
        for (let i = 1; i < buf.length; i++) {
          d += ` L${(AXIS_LABEL_WIDTH + i * dx).toFixed(2)},${valueToY(buf[i]).toFixed(2)}`;
        }
        return d;
      });

      const oldestSample = sampleNumbers.length > 0 ? sampleNumbers[0] : null;
      const visibleMarkers =
        oldestSample === null
          ? []
          : repMarkersRef.current
              .map(mark => ({
                mark,
                index: mark.approxSample - oldestSample,
              }))
              .filter(({ index }) => index >= 0 && index < sampleNumbers.length);

      return { paths: builtPaths, min: lo, max: hi, markers: visibleMarkers };
      // `tick` is the actual trigger for recomputation: it changes every time
      // push()/addRepMarker()/clear() mutate the refs above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick, canvasWidth, dx, height, yDomain, series.length]);

    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <RNText style={styles.title}>{title}</RNText>
          <View style={styles.legendRow}>
            {series.map(s => (
              <View key={s.key} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: s.color }]} />
                <RNText style={styles.legendLabel}>{s.label}</RNText>
              </View>
            ))}
          </View>
        </View>
        <View
          style={{ height }}
          onLayout={e => setCanvasWidth(e.nativeEvent.layout.width)}
        >
          {canvasWidth > 0 && (
            <Canvas style={{ width: canvasWidth, height }}>
              {font && (
                <>
                  <Text x={2} y={12} text={max.toFixed(1)} font={font} color="#8A8F98" />
                  <Text
                    x={2}
                    y={height - 4}
                    text={min.toFixed(1)}
                    font={font}
                    color="#8A8F98"
                  />
                </>
              )}
              <Line
                p1={{ x: AXIS_LABEL_WIDTH, y: 0 }}
                p2={{ x: AXIS_LABEL_WIDTH, y: height }}
                color="#3A3F4B"
                strokeWidth={1}
              />
              {paths.map((d, i) =>
                d ? (
                  <Path
                    key={series[i].key}
                    path={d}
                    style="stroke"
                    strokeWidth={2}
                    color={series[i].color}
                  />
                ) : null,
              )}
              {markers.map(({ mark, index }) => {
                const x = AXIS_LABEL_WIDTH + index * dx;
                return (
                  <React.Fragment key={mark.repNumber}>
                    <Line
                      p1={{ x, y: 0 }}
                      p2={{ x, y: height }}
                      color={MARKER_COLOR}
                      strokeWidth={1.5}
                    />
                    {markerFont && (
                      <Text
                        x={x + 3}
                        y={12}
                        text={`R${mark.repNumber}`}
                        font={markerFont}
                        color={MARKER_COLOR}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </Canvas>
          )}
        </View>
      </View>
    );
  },
);

LiveChart.displayName = 'LiveChart';

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#E6E8EB',
    fontSize: 13,
    fontWeight: '600',
  },
  legendRow: {
    flexDirection: 'row',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendLabel: {
    color: '#8A8F98',
    fontSize: 11,
  },
});

export default LiveChart;
