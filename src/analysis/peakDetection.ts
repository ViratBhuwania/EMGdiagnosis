/**
 * Minimal equivalent of scipy.signal.find_peaks (distance + prominence) and
 * peak_prominences, since scipy isn't available on-device.
 */

/** Local maxima, including the midpoint of any flat-top plateau (matches scipy's convention). */
export function findLocalMaxima(x: number[]): number[] {
  const n = x.length;
  const peaks: number[] = [];
  let i = 1;
  while (i < n - 1) {
    if (x[i - 1] < x[i]) {
      let iAhead = i + 1;
      while (iAhead < n - 1 && x[iAhead] === x[i]) {
        iAhead++;
      }
      if (x[iAhead] < x[i]) {
        peaks.push(Math.floor((i + iAhead - 1) / 2));
        i = iAhead;
        continue;
      }
    }
    i++;
  }
  return peaks;
}

/**
 * Topographic prominence of the peak at `peakIdx`: how far it stands above
 * the higher of the lowest points on either side before the signal rises
 * above the peak's own height again (or the array ends).
 */
export function peakProminence(x: number[], peakIdx: number): number {
  const n = x.length;
  const peakVal = x[peakIdx];

  let leftMin = peakVal;
  for (let i = peakIdx - 1; i >= 0; i--) {
    if (x[i] > peakVal) {
      break;
    }
    if (x[i] < leftMin) {
      leftMin = x[i];
    }
  }

  let rightMin = peakVal;
  for (let i = peakIdx + 1; i < n; i++) {
    if (x[i] > peakVal) {
      break;
    }
    if (x[i] < rightMin) {
      rightMin = x[i];
    }
  }

  return peakVal - Math.max(leftMin, rightMin);
}

export interface FindPeaksOptions {
  /** Minimum sample distance between kept peaks. */
  distance?: number;
  /** Minimum topographic prominence for a peak to be kept. */
  prominence?: number;
}

/** Sorted ascending indices of peaks in `x` passing the distance/prominence filters. */
export function findPeaks(x: number[], options: FindPeaksOptions = {}): number[] {
  let peaks = findLocalMaxima(x);

  const distance = options.distance ?? 1;
  if (distance > 1 && peaks.length > 1) {
    const order = [...peaks].sort((a, b) => x[b] - x[a]);
    const keep = new Set(peaks);
    for (const p of order) {
      if (!keep.has(p)) {
        continue;
      }
      for (const q of peaks) {
        if (q !== p && keep.has(q) && Math.abs(q - p) < distance) {
          keep.delete(q);
        }
      }
    }
    peaks = peaks.filter(p => keep.has(p)).sort((a, b) => a - b);
  }

  const minProminence = options.prominence ?? 0;
  if (minProminence > 0) {
    peaks = peaks.filter(p => peakProminence(x, p) >= minProminence);
  }

  return peaks;
}
