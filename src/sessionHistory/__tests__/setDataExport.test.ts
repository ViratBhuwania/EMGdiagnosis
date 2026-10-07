import { formatSessionDataText } from '../setDataExport';
import type { SessionSummaryRecord } from '../types';

function record(sets: SessionSummaryRecord['sets']): SessionSummaryRecord {
  return {
    id: '1',
    timestampMs: Date.UTC(2026, 9, 6, 4, 0, 0),
    sampleRateHz: 50,
    totalReps: 20,
    sets,
    exerciseTag: 'Bicep Curl',
    description: null,
    sessionBestPeak: 100,
    calibrationReferenceAtTime: null,
    calibrationRelativePct: null,
    maxEffortReferenceAtTime: null,
    rollingHistoricalPeakAtTime: null,
    activationCeilingAtTime: 100,
  };
}

const baseSet = {
  setNumber: 1,
  label: null,
  repCount: 20,
  meanActivationPct: 60,
  meanArea: 12.34,
  peakEnvelope: 90,
  p90Peak: 80,
  firstRepStartSec: 1,
  fatigueDetected: true,
  fatigueStartRep: null,
};

describe('formatSessionDataText', () => {
  test('includes the per-bin MDF/ZCR, the user label and the verdict', () => {
    const text = formatSessionDataText(
      record([
        {
          ...baseSet,
          userOutcome: 'failure',
          hand: 'L',
          durationSec: 41.3,
          fatigueAssessment: 'assessed',
          mdfBinSeconds: 4,
          mdfBinsHz: [55.1, 60.4, null],
          zcrBinsHz: [46.9, 47.7, 33.1],
          mdfActiveSec: 36.9,
          mdfValidBins: 2,
          summaryParts: 1,
          mdfSlope: -0.6,
          mdfR2: 0.18,
          mdfDropPct: -12.3,
          areaSlope: 56.17,
          areaR2: 0.33,
        },
      ]),
    );
    expect(text).toContain('REACHED FAILURE');
    expect(text).toContain('hand: L');
    expect(text).toContain('MDF Hz: [55.1, 60.4, -]');
    expect(text).toContain('ZCR Hz: [46.9, 47.7, 33.1]');
    expect(text).toContain('MDF change -12.3%');
    expect(text).toContain('app verdict: fatigue REACHED');
  });

  test('an old record without the new fields still formats (n/a, not a crash)', () => {
    const text = formatSessionDataText(record([{ ...baseSet, fatigueDetected: false }]));
    expect(text).toContain('not labeled');
    expect(text).toContain('MDF Hz: [n/a]');
    expect(text).toContain('fatigue not reached');
  });

  test('no-summary and too-short are reported as not judged', () => {
    const text = formatSessionDataText(
      record([
        { ...baseSet, fatigueDetected: false, fatigueAssessment: 'no-summary' },
        { ...baseSet, setNumber: 2, fatigueDetected: false, fatigueAssessment: 'too-short' },
      ]),
    );
    expect(text).toContain('not assessed (no summary)');
    expect(text).toContain('too short to judge');
  });
});
