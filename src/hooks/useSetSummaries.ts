import { useCallback, useState } from 'react';
import type { SetSummaryData } from '../ble/setSummary';

export interface UseSetSummariesResult {
  /** Every per-set MDF/ZCR summary received this session, in arrival order. */
  summaries: SetSummaryData[];
  /** Adds one summary (the live-channel text line, see ble/summaryLine.ts). */
  addSummary: (summary: SetSummaryData) => void;
  /** Clears the collected summaries -- call on Start, matching the live recorder's per-session reset. */
  reset: () => void;
}

export function useSetSummaries(): UseSetSummariesResult {
  const [summaries, setSummaries] = useState<SetSummaryData[]>([]);
  const addSummary = useCallback((summary: SetSummaryData) => {
    setSummaries(prev => [...prev, summary]);
  }, []);
  const reset = useCallback(() => {
    setSummaries([]);
  }, []);
  return { summaries, addSummary, reset };
}
