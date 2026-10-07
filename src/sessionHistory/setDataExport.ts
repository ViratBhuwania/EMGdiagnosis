import type { SessionSummaryRecord } from './types';

const bins = (v?: Array<number | null>): string =>
  v && v.length > 0 ? v.map(x => (x === null ? '-' : x.toFixed(1))).join(', ') : 'n/a';
const num = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? 'n/a' : v.toFixed(digits);

/**
 * Plain-text dump of a session's per-set fatigue inputs and the user's own
 * labels -- what gets shared out of the app so the fatigue rule can be
 * re-checked offline. Pure; reads only the saved-record shape so the same
 * text comes out of Session Details and of saved history.
 */
export function formatSessionDataText(record: SessionSummaryRecord): string {
  const lines: string[] = [];
  lines.push(
    `EMG session ${new Date(record.timestampMs).toISOString()}` +
      `${record.exerciseTag ? ` | ${record.exerciseTag}` : ''}` +
      `${record.description ? ` | ${record.description}` : ''}`,
  );
  for (const s of record.sets) {
    lines.push('');
    lines.push(
      `Set ${s.setNumber}${s.label ? ` (${s.label})` : ''} | label: ${
        s.userOutcome === 'failure' ? 'REACHED FAILURE' : s.userOutcome === 'easy' ? 'EASY' : 'not labeled'
      } | hand: ${s.hand ?? 'n/a'}`,
    );
    lines.push(
      `reps ${s.repCount} | duration ${num(s.durationSec, 1)}s | active ${num(s.mdfActiveSec, 1)}s | ` +
        `bin ${s.mdfBinSeconds ?? 'n/a'}s | valid bins ${s.mdfValidBins ?? 'n/a'}/${s.mdfBinsHz?.length ?? 'n/a'} | summaries joined ${s.summaryParts ?? 'n/a'}`,
    );
    lines.push(`MDF Hz: [${bins(s.mdfBinsHz)}]`);
    lines.push(`ZCR Hz: [${bins(s.zcrBinsHz)}]`);
    lines.push(
      `MDF slope ${num(s.mdfSlope)} (r2 ${num(s.mdfR2)}) | MDF change ${num(s.mdfDropPct, 1)}% | ` +
        `area slope ${num(s.areaSlope)} (r2 ${num(s.areaR2)})`,
    );
    lines.push(
      `activation first ${num(s.firstActivationPct, 0)}% last ${num(s.lastActivationPct, 0)}% mean ${num(s.meanActivationPct, 0)}% | ` +
        `mean rep ${num(s.meanDurationSec)}s | mean area ${num(s.meanArea, 1)} | p90 peak ${num(s.p90Peak, 1)}`,
    );
    lines.push(
      `app verdict: ${
        s.fatigueAssessment === 'no-summary'
          ? 'not assessed (no summary)'
          : s.fatigueAssessment === 'too-short'
            ? 'too short to judge'
            : s.fatigueDetected
              ? 'fatigue REACHED'
              : 'fatigue not reached'
      }`,
    );
  }
  return lines.join('\n');
}
