import { alignSummariesWithDetectedSets, applySummaryMdf, applySummaryVerdicts, MIN_MDF_BINS } from '../summaryMdf';
import type { AlignedSummaryPair } from '../summaryMdf';
import { extractSetFatigue } from '../featureExtraction';
import type { SetSummaryData } from '../../ble/setSummary';
import type { RepFeatures, SessionAnalysis } from '../types';

function rep(setNumber: number, repNumber: number, area: number): RepFeatures {
  return {
    repNumber,
    setNumber,
    startSec: repNumber,
    endSec: repNumber + 0.8,
    peakSec: repNumber + 0.4,
    durationSec: 0.8,
    peakRaw: 100,
    meanRaw: 50,
    activationPct: 50,
    riseTimeSec: 0.1,
    fallTimeSec: 0.1,
    contractionSymmetry: 0.5,
    area,
    mdfHz: null,
  };
}

/** One set whose area rises rep to rep (the amplitude half of the fatigue signature). */
function analysisWithRisingArea(): SessionAnalysis {
  const reps = [1, 2, 3, 4, 5].map(n => rep(1, n, 10 + 2 * n));
  return {
    sampleRateHz: 33,
    sets: extractSetFatigue(reps),
    reps,
    sessionBestPeak: 100,
    activationCeiling: 100,
    maxEffortReferenceUsed: null,
    rollingHistoricalPeakUsed: null,
    smoothDet: [],
    timesSec: [],
    setSpansSec: [[0, 20]],
    lowActivationWarning: false,
    fusedAngle: null,
  };
}

function summary(setId: number, seconds: number, mdfHz: Array<number | null>): SetSummaryData {
  return { setId, binSeconds: 4, mdfHz, zcrHz: mdfHz.map(() => null), activeSamples: Math.round(seconds * 500) };
}

function pairFor(s: SetSummaryData, setNumber = 1): AlignedSummaryPair {
  return { summary: s, detectedSetNumber: setNumber, summaryDurationSec: s.activeSamples / 500, detectedDurationSec: s.activeSamples / 500, mismatchFrac: 0 };
}

/** Same shape as analysisWithRisingArea() but the area falls rep to rep (no amplitude half of the signature). */
function analysisWithFallingArea(): SessionAnalysis {
  const reps = [1, 2, 3, 4, 5].map(n => rep(1, n, 40 - 2 * n));
  return { ...analysisWithRisingArea(), sets: extractSetFatigue(reps), reps };
}

function verdictFor(mdfHz: Array<number | null>, analysis = analysisWithRisingArea()) {
  return applySummaryMdf(analysis, [pairFor(summary(0, 20, mdfHz))]).sets[0];
}

describe('applySummaryMdf', () => {
  test('rising area + a steady >=10% MDF fall -> fatigue reached, stats stored', () => {
    const analysis = analysisWithRisingArea();
    expect(analysis.sets[0].fatigueSlopeArea).toBeGreaterThan(0);

    const set = verdictFor([110, 106, 99, 92, 85]);

    expect(set.fatigueSlopeMdf as number).toBeLessThan(0);
    expect(set.mdfBinSeconds).toBe(4);
    expect(set.mdfDropPct as number).toBeLessThan(-10);
    expect(set.fatigueAssessment).toBe('assessed');
    expect(set.fatigueDetected).toBe(true);
    expect(set.fatigueStartRep).toBeNull();
  });

  test('keeps the per-bin MDF/ZCR and set facts for saving/sharing', () => {
    const set = verdictFor([110, 106, 99, 92, 85]);
    expect(set.mdfBinsHz).toEqual([110, 106, 99, 92, 85]);
    expect(set.zcrBinsHz).toBeDefined();
    expect(set.mdfValidBins).toBe(5);
    expect(set.summaryParts).toBe(1);
    expect(set.mdfActiveSec as number).toBeGreaterThan(0);
  });

  test('rising area but MDF not falling -> vetoed ("tried harder", not fatigue)', () => {
    const set = verdictFor([100, 101, 99, 102, 103]);
    expect(set.fatigueDetected).toBe(false);
    expect(set.fatigueStartRep).toBeNull();
  });

  test('falling area -> no fatigue even with a clear MDF fall', () => {
    expect(verdictFor([110, 106, 99, 92, 85], analysisWithFallingArea()).fatigueDetected).toBe(false);
  });

  // The labeled sets this rule was chosen from (MDF bins in Hz, valid bins only).
  test.each([
    ['to-failure 48 s', [55.1, 60.4, 60.1, 57.1, 56.1, 56.4, 55.7, 49.8, 51.2, 40.8, 42.5, 41.8], true],
    ['to-failure 44 s', [56.3, 56.0, 57.4, 58.0, 54.3, 55.4, 43.0, 41.8, 41.8, 40.4, 35.3], true],
    ['easy 19 s (-6.6%, noisy)', [66.1, 71.3, 65.5, 61.7, 66.7], false],
    ['easy 20 s', [56.1, 60.7, 56.9, 60.5, 54.6], false],
    ['easy long 37 s', [44.5, 54.7, 46.7, 52.3, 47.5, 55.2, 60.2, 52.5, 52.4], false],
    ['easy long 37 s (b)', [44.4, 40.7, 43.3, 55.0, 60.0, 52.8, 43.4, 56.2, 52.9], false],
    ['easy slow 41 s', [52.0, 52.0, 55.7, 40.5, 56.0, 60.8, 56.7, 62.3, 57.6, 61.5], false],
  ])('labeled set: %s', (_name, bins, expected) => {
    expect(verdictFor(bins as number[]).fatigueDetected).toBe(expected);
  });

  test('a drop of >=10% that is noisy (r² < 0.5) is not enough', () => {
    const set = verdictFor([100, 60, 105, 70, 95, 80, 99, 82, 98, 75]);
    expect(set.mdfDropPct as number).toBeLessThan(-0);
    expect(set.fatigueDetected).toBe(false);
  });

  test(`fewer than ${MIN_MDF_BINS} usable bins -> "too short to judge", no fatigue claim`, () => {
    const set = verdictFor([100, null, 90, null, null]);
    expect(set.fatigueAssessment).toBe('too-short');
    expect(set.fatigueDetected).toBe(false);
    expect(set.fatigueStartRep).toBeNull();
  });

  test('no pairs returns the analysis unchanged', () => {
    const analysis = analysisWithRisingArea();
    expect(applySummaryMdf(analysis, [])).toBe(analysis);
  });
});

describe('applySummaryVerdicts', () => {
  const spans = [{ setNumber: 1, startSec: 0, endSec: 20 }];

  test('a set with no summary gets no fatigue claim and no rep number', () => {
    const result = applySummaryVerdicts(analysisWithRisingArea(), [], spans);
    expect(result.sets[0].fatigueAssessment).toBe('no-summary');
    expect(result.sets[0].fatigueDetected).toBe(false);
    expect(result.sets[0].fatigueStartRep).toBeNull();
  });

  test('re-running once the summary arrives fills the verdict in', () => {
    const first = applySummaryVerdicts(analysisWithRisingArea(), [], spans);
    const later = applySummaryVerdicts(first, [summary(0, 20, [110, 106, 99, 92, 85])], spans);
    expect(later.sets[0].fatigueAssessment).toBe('assessed');
    expect(later.sets[0].fatigueDetected).toBe(true);
  });
});

describe('alignSummariesWithDetectedSets', () => {
  const spans = [
    { setNumber: 1, startSec: 0, endSec: 20 },
    { setNumber: 2, startSec: 60, endSec: 78 },
  ];

  test('pairs in order when counts agree', () => {
    const r = alignSummariesWithDetectedSets([summary(0, 20, [1]), summary(1, 18, [1])], spans);
    expect(r.paired.map(p => [p.summary.setId, p.detectedSetNumber])).toEqual([[0, 1], [1, 2]]);
    expect(r.unmatchedSummaries).toHaveLength(0);
    expect(r.unmatchedDetectedSets).toHaveLength(0);
  });

  test('a firmware-only summary (e.g. a 6s flex) does not shift later pairings', () => {
    const flex = summary(0, 6, [1]);
    const r = alignSummariesWithDetectedSets([flex, summary(1, 20, [1]), summary(2, 18, [1])], spans);
    expect(r.paired.map(p => [p.summary.setId, p.detectedSetNumber])).toEqual([[1, 1], [2, 2]]);
    expect(r.unmatchedSummaries).toEqual([flex]);
  });

  test('a detected set whose summary never arrived is reported, not mis-paired', () => {
    const r = alignSummariesWithDetectedSets([summary(0, 20, [1])], spans);
    expect(r.paired).toHaveLength(1);
    expect(r.unmatchedDetectedSets.map(s => s.setNumber)).toEqual([2]);
  });
});

describe('alignSummariesWithDetectedSets -- sets longer than the firmware buffer', () => {
  test('joins a 60 s piece and its continuation into one set', () => {
    const first = summary(4, 60, [1, 2, 3]);
    const second = summary(5, 39.9, [4, 5]);
    const r = alignSummariesWithDetectedSets([first, second], [{ setNumber: 1, startSec: 0, endSec: 100 }]);
    expect(r.paired).toHaveLength(1);
    expect(r.paired[0].joinedParts).toBe(2);
    expect(r.paired[0].summary.mdfHz).toEqual([1, 2, 3, 4, 5]);
    expect(r.paired[0].summary.activeSamples).toBe(first.activeSamples + second.activeSamples);
    expect(r.unmatchedSummaries).toHaveLength(0);
  });

  test('does not join pieces when the first was not cut off by the buffer', () => {
    const r = alignSummariesWithDetectedSets(
      [summary(0, 40, [1]), summary(1, 40, [2])],
      [{ setNumber: 1, startSec: 0, endSec: 80 }],
    );
    expect(r.paired).toHaveLength(0);
    expect(r.unmatchedDetectedSets).toHaveLength(1);
  });

  test('a single matching summary is still preferred over joining', () => {
    const r = alignSummariesWithDetectedSets([summary(0, 60, [1])], [{ setNumber: 1, startSec: 0, endSec: 60 }]);
    expect(r.paired[0].joinedParts).toBe(1);
  });
});
