/**
 * The firmware's per-set MDF/ZCR summary, sent as one text line on the LIVE
 * notify characteristic (the path that has been reliable; the indicate()
 * characteristic kept losing the same data):
 *
 *   S,<setId>,<binSeconds>,<activeSamples>,<nBins>,<mdf*10 x nBins>[,<zcr*10 x nBins>]
 *
 * Values are integers (Hz x 10); 0 means "no usable data in that bin". ZCR
 * is omitted when the line wouldn't fit one notify. The firmware sends the
 * line twice about a second apart (no delivery ack to retry on), so
 * SummaryDeduper drops the repeat.
 */
import type { SetSummaryData } from './setSummary';

export const SUMMARY_LINE_PREFIX = 'S,';

/** The firmware sends each summary twice about a second apart; a repeat within this window is dropped. */
const SUMMARY_DUPLICATE_WINDOW_MS = 5_000;

function parseInts(fields: string[]): number[] | null {
  const out: number[] = [];
  for (const f of fields) {
    if (!/^-?\d+$/.test(f.trim())) {
      return null;
    }
    out.push(Number(f));
  }
  return out;
}

/** Null if the line isn't a well-formed summary. */
export function parseSetSummaryLine(line: string): SetSummaryData | null {
  const fields = line.trim().split(',');
  if (fields[0] !== 'S' || fields.length < 5) {
    return null;
  }
  const head = parseInts(fields.slice(1, 5));
  if (!head) {
    return null;
  }
  const [setId, binSeconds, activeSamples, nBins] = head;
  if (setId < 0 || binSeconds <= 0 || activeSamples <= 0 || nBins <= 0 || nBins > 60) {
    return null;
  }
  const values = parseInts(fields.slice(5));
  if (!values || (values.length !== nBins && values.length !== nBins * 2)) {
    return null;
  }
  const toHz = (raw: number): number | null => (raw === 0 ? null : raw / 10);
  return {
    setId,
    binSeconds,
    mdfHz: values.slice(0, nBins).map(toHz),
    zcrHz: values.length === nBins * 2 ? values.slice(nBins).map(toHz) : new Array<number | null>(nBins).fill(null),
    activeSamples,
  };
}

/** Time-based, not "ever seen": setId restarts at 0 when the firmware reboots. */
export class SummaryDeduper {
  private lastAcceptedAtMs = new Map<number, number>();

  accept(setId: number, nowMs: number): boolean {
    const previous = this.lastAcceptedAtMs.get(setId);
    if (previous !== undefined && nowMs - previous < SUMMARY_DUPLICATE_WINDOW_MS) {
      return false;
    }
    this.lastAcceptedAtMs.set(setId, nowMs);
    return true;
  }
}
