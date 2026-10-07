/**
 * Uses the firmware's per-set MDF summary (ble/setSummary.ts's SetSummaryData,
 * received as the live-channel "S," line) to decide whether a set reached
 * fatigue.
 *
 * Pairing summaries with the batch pipeline's detected sets can't rely on a
 * shared clock (no shared clock between the two BLE paths), so it goes by order
 * plus a duration check -- with two wrinkles:
 *  - the firmware can emit a summary for a burst of activity the phone
 *    doesn't treat as a set (e.g. a 6-second flex), which under strict
 *    Nth-to-Nth pairing would shift every later set onto the wrong summary.
 *    So for each detected set, in order, this takes the first not-yet-used
 *    summary whose duration is within MAX_DURATION_MISMATCH_FRAC and skips
 *    past the rest.
 *  - a set longer than the firmware's buffer (FIRMWARE_MAX_SET_SEC) is cut
 *    into consecutive summaries; consecutive summaries whose parts (all but
 *    the last) are buffer-sized are joined and matched as one set.
 */
import { linregress } from './dsp';
import { MAX_DURATION_MISMATCH_FRAC } from './setPairing';
import type { DetectedSetSpan } from './setPairing';
import { FIRMWARE_SAMPLE_RATE_HZ } from '../ble/setSummary';
import type { SetSummaryData } from '../ble/setSummary';
import type { SessionAnalysis } from './types';

/**
 * Fewer valid MDF bins than this (5 x 4 s = ~20 s of real activity) and a
 * trend isn't meaningful -- bin-to-bin jitter is ~4-9 Hz, as large as the
 * drops being looked for. Such a set gets no fatigue verdict.
 */
export const MIN_MDF_BINS = 5;

/**
 * Fatigue needs the MDF to fall by at least this many percent between the
 * average of the first third and the average of the last third of the set's
 * valid bins, AND the fall has to be a steady trend (r² of the per-bin fit).
 * Chosen from the labeled sets collected so far (easy sets: -6.6% at worst,
 * r² <= 0.37; to-failure sets: -24% and -30%, r² 0.77-0.83) -- provisional,
 * re-check as more labeled sets come in.
 */
export const MDF_DROP_FATIGUE_PCT = 10;
export const MDF_MIN_R2 = 0.5;

/** The firmware's capture buffer (MAX_SET_SECONDS) -- a longer set is flushed in pieces of this size. */
const FIRMWARE_MAX_SET_SEC = 60;
/** A piece counts as "cut off by the buffer" if it is at least this fraction of FIRMWARE_MAX_SET_SEC. */
const NEAR_FULL_PART_FRAC = 0.95;
const MAX_JOIN_PARTS = 4;

export interface AlignedSummaryPair {
  summary: SetSummaryData;
  detectedSetNumber: number;
  summaryDurationSec: number;
  detectedDurationSec: number;
  mismatchFrac: number;
  /** How many consecutive firmware summaries were joined into `summary` (1 = not joined). */
  joinedParts?: number;
}

export interface SummaryAlignmentResult {
  paired: AlignedSummaryPair[];
  /** Summaries that matched no detected set -- e.g. a flex the phone didn't treat as a set. */
  unmatchedSummaries: SetSummaryData[];
  /** Detected sets with no matching summary -- e.g. the summary never arrived. */
  unmatchedDetectedSets: DetectedSetSpan[];
}

function durationSec(s: SetSummaryData): number {
  return s.activeSamples / FIRMWARE_SAMPLE_RATE_HZ;
}

function mismatchFrac(summaryDurationSec: number, detectedDurationSec: number): number {
  return detectedDurationSec > 0 ? Math.abs(summaryDurationSec - detectedDurationSec) / detectedDurationSec : Infinity;
}

function joinSummaries(parts: SetSummaryData[]): SetSummaryData {
  return {
    setId: parts[0].setId,
    binSeconds: parts[0].binSeconds,
    mdfHz: parts.flatMap(p => p.mdfHz),
    zcrHz: parts.flatMap(p => p.zcrHz),
    activeSamples: parts.reduce((a, p) => a + p.activeSamples, 0),
  };
}

/** How many summaries starting at index `j` match a detected set of this length (1 = the single summary, >1 = joined), or null. */
function matchAt(
  summaries: SetSummaryData[],
  j: number,
  detectedDurationSec: number,
): { count: number; frac: number } | null {
  const single = mismatchFrac(durationSec(summaries[j]), detectedDurationSec);
  if (single <= MAX_DURATION_MISMATCH_FRAC) {
    return { count: 1, frac: single };
  }
  let total = durationSec(summaries[j]);
  for (let len = 2; len <= MAX_JOIN_PARTS && j + len - 1 < summaries.length; len++) {
    const previous = summaries[j + len - 2];
    const current = summaries[j + len - 1];
    // Only a piece the firmware cut off at its buffer limit can continue into the next summary.
    if (durationSec(previous) < NEAR_FULL_PART_FRAC * FIRMWARE_MAX_SET_SEC || previous.binSeconds !== current.binSeconds) {
      break;
    }
    total += durationSec(current);
    const frac = mismatchFrac(total, detectedDurationSec);
    if (frac <= MAX_DURATION_MISMATCH_FRAC) {
      return { count: len, frac };
    }
  }
  return null;
}

/** `summaries` in arrival order; `detectedSpans` in ascending setNumber order. */
export function alignSummariesWithDetectedSets(
  summaries: SetSummaryData[],
  detectedSpans: DetectedSetSpan[],
): SummaryAlignmentResult {
  const paired: AlignedSummaryPair[] = [];
  const unmatchedDetectedSets: DetectedSetSpan[] = [];
  const skipped: SetSummaryData[] = [];
  let next = 0;

  for (const span of detectedSpans) {
    const detectedDurationSec = span.endSec - span.startSec;
    let found = -1;
    let match: { count: number; frac: number } | null = null;
    for (let j = next; j < summaries.length; j++) {
      match = matchAt(summaries, j, detectedDurationSec);
      if (match) {
        found = j;
        break;
      }
    }
    if (found === -1 || !match) {
      unmatchedDetectedSets.push(span);
      continue;
    }
    skipped.push(...summaries.slice(next, found));
    const parts = summaries.slice(found, found + match.count);
    const joined = match.count === 1 ? parts[0] : joinSummaries(parts);
    paired.push({
      summary: joined,
      detectedSetNumber: span.setNumber,
      summaryDurationSec: durationSec(joined),
      detectedDurationSec,
      mismatchFrac: match.frac,
      joinedParts: match.count,
    });
    next = found + match.count;
  }

  return { paired, unmatchedSummaries: [...skipped, ...summaries.slice(next)], unmatchedDetectedSets };
}

export function logSummaryAlignment(result: SummaryAlignmentResult): void {
  for (const pair of result.paired) {
    console.log(
      `[summaryAlign] summary ${pair.summary.setId}${pair.joinedParts && pair.joinedParts > 1 ? ` (+${pair.joinedParts - 1} joined part(s))` : ''} ` +
        `<-> detected set ${pair.detectedSetNumber}: ` +
        `${pair.summaryDurationSec.toFixed(2)}s vs ${pair.detectedDurationSec.toFixed(2)}s ` +
        `(${(pair.mismatchFrac * 100).toFixed(1)}% diff) -- OK`,
    );
  }
  for (const summary of result.unmatchedSummaries) {
    console.warn(
      `[summaryAlign] summary ${summary.setId} (${durationSec(summary).toFixed(1)}s) ` +
        `matched no detected set -- ignored (a flex/pose the phone didn't count as a set?)`,
    );
  }
  for (const span of result.unmatchedDetectedSets) {
    console.warn(`[summaryAlign] detected set ${span.setNumber} has no matching summary -- no fatigue verdict for it`);
  }
}

/**
 * For each paired set, decides fatigue from the set's valid MDF bins:
 *   area slope rising  AND  MDF fell >= MDF_DROP_FATIGUE_PCT (first third ->
 *   last third)  AND  the fall is a steady trend (r² >= MDF_MIN_R2).
 * The slope (Hz per bin), its r², and the drop % are stored for display. A
 * set with fewer than MIN_MDF_BINS valid bins is marked 'too-short' and gets
 * no fatigue verdict. fatigueStartRep is always null here: the per-set MDF has
 * no per-rep resolution, and the amplitude-only rep number only marks where
 * the area trend first turned positive.
 */
function summaryFields(pair: AlignedSummaryPair, validBins: number) {
  return {
    mdfBinSeconds: pair.summary.binSeconds,
    mdfBinsHz: pair.summary.mdfHz,
    zcrBinsHz: pair.summary.zcrHz,
    mdfActiveSec: pair.summary.activeSamples / FIRMWARE_SAMPLE_RATE_HZ,
    mdfValidBins: validBins,
    summaryParts: pair.joinedParts ?? 1,
  };
}

export function applySummaryMdf(analysis: SessionAnalysis, pairs: AlignedSummaryPair[]): SessionAnalysis {
  if (pairs.length === 0) {
    return analysis;
  }
  const pairBySetNumber = new Map(pairs.map(p => [p.detectedSetNumber, p]));

  const sets = analysis.sets.map(set => {
    const pair = pairBySetNumber.get(set.setNumber);
    if (!pair) {
      return set;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    pair.summary.mdfHz.forEach((v, i) => {
      if (v !== null) {
        xs.push(i);
        ys.push(v);
      }
    });
    if (xs.length < MIN_MDF_BINS) {
      console.warn(
        `[summaryMdf] set ${set.setNumber}: only ${xs.length} usable MDF bin(s) (need ${MIN_MDF_BINS}) -- set too short to judge fatigue`,
      );
      return {
        ...set,
        ...summaryFields(pair, xs.length),
        fatigueDetected: false,
        fatigueStartRep: null,
        fatigueAssessment: 'too-short' as const,
      };
    }
    const fit = linregress(xs, ys);
    const k = Math.max(1, Math.round(ys.length / 3));
    const early = ys.slice(0, k).reduce((a, v) => a + v, 0) / k;
    const late = ys.slice(-k).reduce((a, v) => a + v, 0) / k;
    const dropPct = early > 0 ? (100 * (late - early)) / early : 0;
    const fatigueDetected =
      set.fatigueSlopeArea !== null &&
      set.fatigueSlopeArea > 0 &&
      dropPct <= -MDF_DROP_FATIGUE_PCT &&
      fit.slope < 0 &&
      fit.r2 >= MDF_MIN_R2;
    console.log(
      `[summaryMdf] set ${set.setNumber}: MDF bins [${pair.summary.mdfHz.map(v => (v === null ? '-' : v.toFixed(1))).join(', ')}] ` +
        `slope ${fit.slope.toFixed(2)} Hz/${pair.summary.binSeconds}s (r²=${fit.r2.toFixed(2)}), ` +
        `MDF change ${dropPct.toFixed(1)}% (first->last third, need <= -${MDF_DROP_FATIGUE_PCT}% and r² >= ${MDF_MIN_R2}), ` +
        `area slope ${set.fatigueSlopeArea === null ? 'n/a' : set.fatigueSlopeArea.toFixed(2)} -> fatigue ${fatigueDetected ? 'REACHED' : 'not reached'}`,
    );
    return {
      ...set,
      fatigueSlopeMdf: fit.slope,
      fatigueSlopeMdfR2: fit.r2,
      ...summaryFields(pair, xs.length),
      mdfDropPct: dropPct,
      fatigueDetected,
      fatigueStartRep: null,
      fatigueAssessment: 'assessed' as const,
    };
  });

  return { ...analysis, sets };
}

/**
 * Pairs `summaries` with the detected sets and applies the verdicts. A set with
 * no summary (yet) gets NO fatigue claim -- the amplitude-only fallback used to
 * call fatigue on any rising area trend. Safe to call again whenever more
 * summaries arrive: it only reads each set's amplitude fields, which it never
 * changes, so re-running on its own output just fills in newly paired sets.
 */
export function applySummaryVerdicts(
  analysis: SessionAnalysis,
  summaries: SetSummaryData[],
  detectedSpans: DetectedSetSpan[],
  log = false,
): SessionAnalysis {
  const alignment = alignSummariesWithDetectedSets(summaries, detectedSpans);
  if (log) {
    logSummaryAlignment(alignment);
  }
  const withPairs = applySummaryMdf(analysis, alignment.paired);
  const pairedSetNumbers = new Set(alignment.paired.map(p => p.detectedSetNumber));
  if (withPairs.sets.every(s => pairedSetNumbers.has(s.setNumber))) {
    return withPairs;
  }
  return {
    ...withPairs,
    sets: withPairs.sets.map(s =>
      pairedSetNumbers.has(s.setNumber)
        ? s
        : { ...s, fatigueDetected: false, fatigueStartRep: null, fatigueAssessment: 'no-summary' as const },
    ),
  };
}
