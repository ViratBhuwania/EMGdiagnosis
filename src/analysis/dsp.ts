/**
 * Signal-processing primitives needed by the rep-detection pipeline:
 * FFT, autocorrelation (for tempo/period estimation), Welch's method (for
 * median frequency), and a centered rolling mean. Ported from the numpy/
 * scipy calls in the desktop analysis script, since neither is available
 * on-device. Where scipy's exact behavior depends on details irrelevant to
 * the statistics we actually use (e.g. Welch's frequency-bin spacing for a
 * non-power-of-2 segment length), the simpler, well-documented choice is
 * taken rather than reimplementing scipy bit-for-bit — see notes inline.
 */

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of 2. */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len / 2;
    const ang = ((inverse ? 1 : -1) * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const bIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + half] = aRe - bRe;
        im[i + k + half] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Centered rolling mean with min_periods=1 behavior (shrinks at the edges
 * instead of returning NaN) — matches `pandas.Series.rolling(w, center=True)
 * .mean()` closely enough for smoothing purposes. O(n) via prefix sums.
 */
export function rollingMean(sig: number[], window: number): number[] {
  const n = sig.length;
  const w = Math.max(3, Math.round(window));
  const before = Math.floor((w - 1) / 2);
  const after = w - 1 - before;
  const prefix = new Array(n + 1);
  prefix[0] = 0;
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + sig[i];
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - before);
    const end = Math.min(n - 1, i + after);
    out[i] = (prefix[end + 1] - prefix[start]) / (end - start + 1);
  }
  return out;
}

/**
 * Normalized autocorrelation via FFT (Wiener-Khinchin), mirroring
 * `np.fft.irfft(fft * conj(fft))` on the zero-padded, mean-centered signal.
 * Returns the first `sig.length` lags, normalized so acf[0] === 1.
 */
export function autocorrelation(sig: number[]): number[] {
  const n = sig.length;
  const mean = sig.reduce((a, b) => a + b, 0) / n;
  const nfft = nextPowerOfTwo(2 * n);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let i = 0; i < n; i++) {
    re[i] = sig[i] - mean;
  }
  fftInPlace(re, im, false);
  for (let i = 0; i < nfft; i++) {
    const power = re[i] * re[i] + im[i] * im[i];
    re[i] = power;
    im[i] = 0;
  }
  fftInPlace(re, im, true);
  const acf0 = re[0];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = acf0 !== 0 ? re[i] / acf0 : 0;
  }
  return out;
}

export interface AcfPeriodResult {
  periodS: number;
  strength: number;
}

/** Finds the dominant repetition period in `sig` within [minS, maxS] seconds. */
export function acfPeriod(
  sig: number[],
  rate: number,
  minS: number,
  maxS: number,
): AcfPeriodResult {
  const n = sig.length;
  const fallback: AcfPeriodResult = { periodS: (minS + maxS) / 2, strength: 0 };
  if (n < 10) {
    return fallback;
  }
  const acf = autocorrelation(sig);
  const lo = Math.max(1, Math.floor(minS * rate));
  const hi = Math.min(Math.floor(maxS * rate), n - 1);
  if (lo >= hi) {
    return fallback;
  }
  let peakIdx = lo;
  let peakVal = acf[lo];
  for (let i = lo + 1; i < hi; i++) {
    if (acf[i] > peakVal) {
      peakVal = acf[i];
      peakIdx = i;
    }
  }
  return { periodS: peakIdx / rate, strength: peakVal };
}

function hannWindow(n: number): number[] {
  if (n <= 1) {
    return [1];
  }
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

export interface PsdResult {
  freqs: number[];
  psd: number[];
}

/**
 * Welch's method power spectral density estimate: Hann-windowed, 50%
 * overlap, per-segment mean removed, one-sided "density" scaling — matching
 * scipy.signal.welch's defaults. One deliberate deviation: each segment's
 * FFT length is zero-padded up to the next power of two (this FFT only
 * supports power-of-two lengths) rather than scipy's exact segment length,
 * which only changes frequency-bin spacing slightly — irrelevant here since
 * the only thing read from the result (median frequency) is a robust
 * summary statistic, not a specific bin.
 */
export function welchPsd(sig: number[], fs: number, npersegRequested: number): PsdResult {
  const n = sig.length;
  const nperseg = Math.min(npersegRequested, n);
  if (nperseg < 8) {
    return { freqs: [], psd: [] };
  }
  const noverlap = Math.floor(nperseg / 2);
  const step = Math.max(1, nperseg - noverlap);
  const window = hannWindow(nperseg);
  const windowPower = window.reduce((a, b) => a + b * b, 0);
  const nfft = nextPowerOfTwo(nperseg);
  const numFreqBins = nfft / 2 + 1;
  const psdSum = new Array(numFreqBins).fill(0);
  let segmentCount = 0;

  for (let start = 0; start + nperseg <= n; start += step) {
    let mean = 0;
    for (let i = 0; i < nperseg; i++) {
      mean += sig[start + i];
    }
    mean /= nperseg;

    const re = new Float64Array(nfft);
    const im = new Float64Array(nfft);
    for (let i = 0; i < nperseg; i++) {
      re[i] = (sig[start + i] - mean) * window[i];
    }
    fftInPlace(re, im, false);
    for (let k = 0; k < numFreqBins; k++) {
      psdSum[k] += re[k] * re[k] + im[k] * im[k];
    }
    segmentCount += 1;
  }

  if (segmentCount === 0) {
    return { freqs: [], psd: [] };
  }

  const scale = 1 / (fs * windowPower);
  const psd = new Array(numFreqBins);
  const isEvenNfft = nfft % 2 === 0;
  for (let k = 0; k < numFreqBins; k++) {
    let val = (psdSum[k] / segmentCount) * scale;
    const isNyquist = isEvenNfft && k === numFreqBins - 1;
    if (k !== 0 && !isNyquist) {
      val *= 2;
    }
    psd[k] = val;
  }
  const freqs = new Array(numFreqBins);
  for (let k = 0; k < numFreqBins; k++) {
    freqs[k] = (k * fs) / nfft;
  }
  return { freqs, psd };
}

/**
 * Median frequency of `raw` (the band's power-weighted median, 20-250Hz) —
 * the standard sEMG fatigue biomarker: it drops as fatiguing muscle fibers
 * conduct more slowly, independent of amplitude. Null if there isn't enough
 * data for a meaningful spectral estimate.
 */
export function medianFrequency(raw: number[], fs: number): number | null {
  if (raw.length < 64) {
    return null;
  }
  const { freqs, psd } = welchPsd(raw, fs, Math.min(256, raw.length));
  if (freqs.length === 0) {
    return null;
  }
  const bandIdx: number[] = [];
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] >= 20 && freqs[i] <= 250) {
      bandIdx.push(i);
    }
  }
  if (bandIdx.length === 0) {
    return null;
  }
  const bandPsd = bandIdx.map(i => psd[i]);
  const total = bandPsd.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    return null;
  }
  const half = total / 2;
  let cumulative = 0;
  for (let k = 0; k < bandPsd.length; k++) {
    cumulative += bandPsd[k];
    if (cumulative >= half) {
      return freqs[bandIdx[k]];
    }
  }
  return freqs[bandIdx[bandIdx.length - 1]];
}

/** Simple ordinary-least-squares linear regression, mirroring scipy.stats.linregress. */
export function linregress(
  x: number[],
  y: number[],
): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }
  const slope = ssXX !== 0 ? ssXY / ssXX : 0;
  const intercept = meanY - slope * meanX;
  const r = ssXX !== 0 && ssYY !== 0 ? ssXY / Math.sqrt(ssXX * ssYY) : 0;
  return { slope, intercept, r2: r * r };
}

/** Trapezoidal integration, mirroring np.trapezoid(y, dx=dx). */
export function trapezoidalIntegral(y: number[], dx: number): number {
  let sum = 0;
  for (let i = 0; i < y.length - 1; i++) {
    sum += ((y[i] + y[i + 1]) / 2) * dx;
  }
  return sum;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sorted[lo];
  }
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
