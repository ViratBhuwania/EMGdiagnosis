import { parseSetSummaryLine, SummaryDeduper } from '../summaryLine';

describe('parseSetSummaryLine', () => {
  test('parses MDF and ZCR bins, x10 integers to Hz, 0 to null', () => {
    expect(parseSetSummaryLine('S,3,4,14000,3,1101,0,651,935,929,0')).toEqual({
      setId: 3,
      binSeconds: 4,
      activeSamples: 14000,
      mdfHz: [110.1, null, 65.1],
      zcrHz: [93.5, 92.9, null],
    });
  });

  test('accepts an MDF-only line (ZCR dropped by the firmware when too long)', () => {
    const s = parseSetSummaryLine('S,0,4,10507,2,440,477');
    expect(s?.mdfHz).toEqual([44, 47.7]);
    expect(s?.zcrHz).toEqual([null, null]);
  });

  test('rejects wrong value counts, non-numeric fields, and non-summary lines', () => {
    expect(parseSetSummaryLine('S,3,4,14000,3,1101,0')).toBeNull();
    expect(parseSetSummaryLine('S,3,4,14000,3,11x1,0,651')).toBeNull();
    expect(parseSetSummaryLine('S,3,0,14000,1,500')).toBeNull();
    expect(parseSetSummaryLine('12,34,5,6,7,8,9,10,1')).toBeNull();
  });
});

describe('SummaryDeduper', () => {
  test('drops the firmware repeat within the window but accepts a later set with the same id', () => {
    const d = new SummaryDeduper();
    expect(d.accept(0, 1_000)).toBe(true);
    expect(d.accept(0, 2_000)).toBe(false);
    expect(d.accept(1, 2_000)).toBe(true);
    expect(d.accept(0, 60_000)).toBe(true);
  });
});
