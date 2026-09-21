import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivationSummary,
  ParsedSample,
  RepMark,
  SensorRow,
} from '../types';

const STATS_TICK_MS = 200;

export interface SessionSnapshot {
  rows: SensorRow[];
  reps: RepMark[];
}

export interface UseSessionRecorderResult {
  isRecording: boolean;
  reps: RepMark[];
  sampleCount: number;
  elapsedSec: number;
  latestEnvelope: number | null;
  /** Highest peak envelope among reps completed so far this session (0 if none yet). */
  sessionBestPeak: number;
  /**
   * Current envelope reading relative to `sessionBestPeak`, for a live
   * "how does this compare to your best rep so far" gauge. 1.0 = matching
   * your best rep so far; can exceed 1.0 mid-rep if you're about to beat it.
   * Null until at least one rep has been completed (nothing to compare to yet).
   */
  liveActivationRatio: number | null;
  start: () => void;
  stop: () => void;
  /** Feed one live sample in; returns the recorded row, or null while not recording. */
  recordRow: (sample: ParsedSample) => SensorRow | null;
  /** Mark a rep at the most recently recorded sample; returns null while not recording. */
  markRep: () => RepMark | null;
  /** Clear all recorded data and reps, ready for a new session. */
  reset: () => void;
  /** Read the full recorded rows + reps, e.g. for export. */
  getSnapshot: () => SessionSnapshot;
  /**
   * Per-rep activation relative to this session's best rep, plus the average
   * as both a raw percentage and a rounded 1-10 (RPE-style) score. Null if no
   * rep was ever completed (no Mark Rep press, or session still recording).
   */
  getActivationSummary: () => ActivationSummary | null;
}

/**
 * Records the in-memory session used for export: every sensor row between
 * Start and Stop, plus any rep marks the user places along the way. The full
 * row list lives in a ref (not React state) so the ~50Hz sample stream never
 * forces a re-render; a lightweight periodic tick refreshes the small set of
 * numbers the stats bar displays.
 */
export function useSessionRecorder(): UseSessionRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [reps, setReps] = useState<RepMark[]>([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [latestEnvelope, setLatestEnvelope] = useState<number | null>(null);
  const [sessionBestPeak, setSessionBestPeak] = useState(0);
  const [liveActivationRatio, setLiveActivationRatio] = useState<number | null>(
    null,
  );

  const rowsRef = useRef<SensorRow[]>([]);
  const repsRef = useRef<RepMark[]>([]);
  const repPeaksRef = useRef<number[]>([]);
  const sessionBestPeakRef = useRef(0);
  const sampleCounterRef = useRef(0);
  const startTimestampRef = useRef<number | null>(null);
  const latestEnvelopeRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirrors `isRecording` synchronously for recordRow/markRep, which are stable
  // callbacks (empty deps) and would otherwise close over a stale `isRecording`.
  const isRecordingRef = useRef(false);

  const currentElapsedSec = useCallback(() => {
    if (startTimestampRef.current === null) {
      return 0;
    }
    return (Date.now() - startTimestampRef.current) / 1000;
  }, []);

  const clearTick = useCallback(() => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }, []);

  /**
   * Finalizes the rep currently in progress (the span since the last Mark Rep
   * press) by finding its peak envelope and folding it into the session best.
   * Called right before a new mark is added, and once more at Stop to close
   * out whichever rep was still open.
   */
  const closeCurrentRep = useCallback((endSampleInclusive: number) => {
    const marks = repsRef.current;
    if (marks.length === 0) {
      return;
    }
    const startSampleExclusive = marks[marks.length - 1].approxSample;
    let peak = 0;
    for (const row of rowsRef.current) {
      if (row.sample <= startSampleExclusive) {
        continue;
      }
      if (row.sample > endSampleInclusive) {
        break;
      }
      if (row.envelope > peak) {
        peak = row.envelope;
      }
    }
    repPeaksRef.current.push(peak);
    if (peak > sessionBestPeakRef.current) {
      sessionBestPeakRef.current = peak;
      setSessionBestPeak(peak);
    }
  }, []);

  const start = useCallback(() => {
    rowsRef.current = [];
    repsRef.current = [];
    repPeaksRef.current = [];
    sessionBestPeakRef.current = 0;
    sampleCounterRef.current = 0;
    latestEnvelopeRef.current = null;
    startTimestampRef.current = Date.now();
    isRecordingRef.current = true;

    setReps([]);
    setSampleCount(0);
    setElapsedSec(0);
    setLatestEnvelope(null);
    setSessionBestPeak(0);
    setLiveActivationRatio(null);
    setIsRecording(true);

    clearTick();
    tickIntervalRef.current = setInterval(() => {
      setSampleCount(sampleCounterRef.current);
      setElapsedSec(currentElapsedSec());
      setLatestEnvelope(latestEnvelopeRef.current);
      setLiveActivationRatio(
        latestEnvelopeRef.current !== null && sessionBestPeakRef.current > 0
          ? latestEnvelopeRef.current / sessionBestPeakRef.current
          : null,
      );
    }, STATS_TICK_MS);
  }, [clearTick, currentElapsedSec]);

  const stop = useCallback(() => {
    closeCurrentRep(sampleCounterRef.current);
    isRecordingRef.current = false;
    setIsRecording(false);
    clearTick();
    setSampleCount(sampleCounterRef.current);
    setElapsedSec(currentElapsedSec());
    setLatestEnvelope(latestEnvelopeRef.current);
    setLiveActivationRatio(
      latestEnvelopeRef.current !== null && sessionBestPeakRef.current > 0
        ? latestEnvelopeRef.current / sessionBestPeakRef.current
        : null,
    );
  }, [clearTick, closeCurrentRep, currentElapsedSec]);

  const recordRow = useCallback((sample: ParsedSample): SensorRow | null => {
    if (!isRecordingRef.current || startTimestampRef.current === null) {
      return null;
    }
    sampleCounterRef.current += 1;
    latestEnvelopeRef.current = sample.envelope;

    const row: SensorRow = {
      ...sample,
      sample: sampleCounterRef.current,
      timeSec: (Date.now() - startTimestampRef.current) / 1000,
    };
    rowsRef.current.push(row);
    return row;
  }, []);

  const markRep = useCallback((): RepMark | null => {
    if (!isRecordingRef.current || startTimestampRef.current === null) {
      return null;
    }
    // Close out whichever rep was in progress before starting the next one.
    closeCurrentRep(sampleCounterRef.current);

    const mark: RepMark = {
      repNumber: repsRef.current.length + 1,
      approxSample: sampleCounterRef.current,
      timeSec: currentElapsedSec(),
    };
    repsRef.current = [...repsRef.current, mark];
    setReps(repsRef.current);
    return mark;
  }, [closeCurrentRep, currentElapsedSec]);

  const reset = useCallback(() => {
    clearTick();
    rowsRef.current = [];
    repsRef.current = [];
    repPeaksRef.current = [];
    sessionBestPeakRef.current = 0;
    sampleCounterRef.current = 0;
    latestEnvelopeRef.current = null;
    startTimestampRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    setReps([]);
    setSampleCount(0);
    setElapsedSec(0);
    setLatestEnvelope(null);
    setSessionBestPeak(0);
    setLiveActivationRatio(null);
  }, [clearTick]);

  const getSnapshot = useCallback((): SessionSnapshot => {
    return { rows: rowsRef.current, reps: repsRef.current };
  }, []);

  const getActivationSummary = useCallback((): ActivationSummary | null => {
    const peaks = repPeaksRef.current;
    if (peaks.length === 0) {
      return null;
    }
    const bestPeak = sessionBestPeakRef.current;
    const repActivations = peaks.map((peakEnvelope, i) => ({
      repNumber: i + 1,
      peakEnvelope,
      activationPct: bestPeak > 0 ? (peakEnvelope / bestPeak) * 100 : 0,
    }));
    const averagePct =
      repActivations.reduce((sum, r) => sum + r.activationPct, 0) /
      repActivations.length;
    const averageScore10 = Math.min(10, Math.max(1, Math.round(averagePct / 10)));
    return { repActivations, averagePct, averageScore10 };
  }, []);

  useEffect(() => clearTick, [clearTick]);

  return {
    isRecording,
    reps,
    sampleCount,
    elapsedSec,
    latestEnvelope,
    sessionBestPeak,
    liveActivationRatio,
    start,
    stop,
    recordRow,
    markRep,
    reset,
    getSnapshot,
    getActivationSummary,
  };
}
