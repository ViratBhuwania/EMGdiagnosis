/**
 * Turns a history of individual calibration readings into (a) the current
 * best reference to compare a session against, and (b) a same-day outlier
 * check. Deliberately NOT a flat rolling average: strength is expected to
 * trend upward over weeks of training, and a flat average would smear that
 * real trend away exactly like it smears away noise -- see the session's
 * design discussion. A short linear trend fit (an EWMA would also work;
 * this is simpler and equally adequate for a handful of points) tracks the
 * genuine drift while median-absolute-deviation still catches a single
 * off day.
 */
import { linregress, median } from '../analysis/dsp';
import type { CalibrationRecord } from './types';

const MIN_HISTORY_FOR_TREND = 3;
const OUTLIER_MAD_MULTIPLIER = 3;
const TREND_WINDOW = 10;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

interface TrendFit {
  slope: number;
  intercept: number;
  baseTimestampMs: number;
}

function fitTrend(history: CalibrationRecord[]): TrendFit | null {
  const recent = history.slice(-TREND_WINDOW);
  if (recent.length < MIN_HISTORY_FOR_TREND) {
    return null;
  }
  const baseTimestampMs = recent[0].timestampMs;
  const x = recent.map(r => (r.timestampMs - baseTimestampMs) / MS_PER_DAY);
  const y = recent.map(r => r.referenceValue);
  const { slope, intercept } = linregress(x, y);
  return { slope, intercept, baseTimestampMs };
}

function predictAt(fit: TrendFit, timestampMs: number): number {
  const days = (timestampMs - fit.baseTimestampMs) / MS_PER_DAY;
  return fit.intercept + fit.slope * days;
}

/**
 * The value to compare a session's own peak against. With fewer than
 * MIN_HISTORY_FOR_TREND readings there's not enough history to fit a trend,
 * so the latest raw reading is used directly (the cold-start case). Once
 * there's enough, the trend line evaluated at the most recent calibration
 * date is used instead of the raw value, smoothing a single noisy day
 * without suppressing a genuine multi-week drift.
 */
export function computeEffectiveReference(history: CalibrationRecord[]): number | null {
  if (history.length === 0) {
    return null;
  }
  if (history.length < MIN_HISTORY_FOR_TREND) {
    return history[history.length - 1].referenceValue;
  }
  const fit = fitTrend(history);
  const latest = history[history.length - 1];
  return fit ? predictAt(fit, latest.timestampMs) : latest.referenceValue;
}

/**
 * Whether a freshly-captured reading (not yet saved) looks like an outlier
 * against the trend fit from EXISTING history -- checked before it's added,
 * so a bad reading can't skew the very check meant to catch it.
 */
export function isLikelyOutlier(
  history: CalibrationRecord[],
  candidateValue: number,
  candidateTimestampMs: number,
): boolean {
  if (history.length < MIN_HISTORY_FOR_TREND) {
    return false;
  }
  const fit = fitTrend(history);
  if (!fit) {
    return false;
  }

  const recent = history.slice(-TREND_WINDOW);
  const residuals = recent.map(r => Math.abs(r.referenceValue - predictAt(fit, r.timestampMs)));
  const madBase = median(residuals);
  if (madBase === 0) {
    return false;
  }

  const candidateResidual = Math.abs(candidateValue - predictAt(fit, candidateTimestampMs));
  return candidateResidual > OUTLIER_MAD_MULTIPLIER * madBase;
}

export function daysSince(timestampMs: number): number {
  return (Date.now() - timestampMs) / MS_PER_DAY;
}
