import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivationSummary,
  ParsedSample,
  RepMark,
  SensorRow,
  SessionEvent,
} from '../types';
import { APP_VERSION } from '../appInfo';
import { AutosaveWriter } from '../session/autosaveStore';
import { mergeLateRows } from '../session/mergeLateRows';
import { findRowGaps, totalMissing } from '../export/gapReport';
import type { RecoveredSession } from '../session/autosaveFormat';

const STATS_TICK_MS = 200;

export interface SessionSnapshot {
  rows: SensorRow[];
  reps: RepMark[];
  events: SessionEvent[];
  /** Phone wall-clock ms when Start was pressed (null if nothing recorded). */
  startedAt: number | null;
}

/** A device row number this far below the last one means the device restarted (re-sends after a drop only go back ~150 rows). */
const DEVICE_RESET_SEQ_DROP = 400;
const ROW_PERIOD_S = 0.02;
/** How long to wait for requested rows before asking again, and how many times to ask before giving up on them. */
const RESEND_RETRY_MS = 2500;
const RESEND_MAX_TRIES = 3;
/** Ranges per request command. */
const RESEND_RANGES_PER_REQUEST = 4;
/** After Stop, wait this long at most for data the device was still holding. */
const FINISH_MAX_WAIT_MS = 25_000;
/** At Stop, the newest row being this far behind the clock means the device is holding data for us. */
const FINISH_LAG_S = 1.0;

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
  /**
   * Called when rows the device skipped should be asked for again. Return false if nothing could be
   * sent (e.g. not connected), so the attempt is not counted. Set once by the screen.
   */
  setResendHandler: (handler: ((ranges: Array<[number, number]>) => Promise<boolean>) | null) => void;
  /** Rows the device never delivered (its buffer overflowed, or the link lost them), counted from its own row numbers. */
  lostRows: number;
  /** `firmwareVersion` is stamped into the autosave file and, via the export, every exported workbook. */
  start: (firmwareVersion?: string | null) => void;
  /**
   * Stop recording. If the device is still holding data from before the Stop press (a dropped link,
   * or catching up), waits for it first (`finishing` is set meanwhile; press Stop again or call
   * skipFinishing to give up). Rows measured after the Stop press are dropped. Resolves once the
   * recording is final.
   */
  stop: () => Promise<void>;
  /** True while Stop is waiting for the device's held data. */
  finishing: { pendingRows: number; behindSec: number } | null;
  /** Finish now with what has arrived. */
  skipFinishing: () => void;
  /** Note something that happened (link drop, app backgrounded, ...); saved with the recording and exported. */
  addEvent: (type: string, detail?: string) => void;
  /** Load a recording recovered from disk; leaves the recorder stopped, ready to analyse/export. */
  loadRecovered: (rec: RecoveredSession) => void;
  /** Feed one live sample in; returns the recorded row, or null while not recording. */
  recordRow: (sample: ParsedSample) => SensorRow | null;
  /** Mark a rep at the most recently recorded sample; returns null while not recording. */
  markRep: () => RepMark | null;
  /** Clear all recorded data and reps, ready for a new session. */
  reset: () => void;
  /** Read the full recorded rows + reps, e.g. for export. */
  getSnapshot: () => SessionSnapshot;
  /**
   * Precise elapsed seconds right now (unlike `elapsedSec`, which only
   * updates every STATS_TICK_MS).
   */
  nowElapsedSec: () => number;
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
  const [lostRows, setLostRows] = useState(0);
  const [finishing, setFinishing] = useState<{ pendingRows: number; behindSec: number } | null>(null);
  const finishingRef = useRef(false);
  const stopTimeSecRef = useRef(0);
  const finishStartedMsRef = useRef(0);
  const lastSeenTimeSecRef = useRef(0);
  const finishWaitersRef = useRef<Array<() => void>>([]);

  const eventsRef = useRef<SessionEvent[]>([]);
  const lostRowsRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const autosaveRef = useRef<AutosaveWriter | null>(null);
  /** Maps device clock to recording time; reset on first row and after a device restart. */
  const anchorRef = useRef<{ seq: number; ms: number; timeSec: number } | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  /** Device row numbers seen skipped and not yet received, with how often they've been asked for. */
  const missingRef = useRef<Map<number, { tries: number; lastAskMs: number }>>(new Map());
  const lateRowsRef = useRef<SensorRow[]>([]);
  const resendHandlerRef = useRef<((ranges: Array<[number, number]>) => Promise<boolean>) | null>(null);
  const resendBusyRef = useRef(false);

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

  // While Stop is waiting: done once nothing is missing and the device has caught up to the Stop time.
  const finalizeRef = useRef<() => void>(() => {});
  const checkFinishing = useCallback(() => {
    const behind = Math.max(0, stopTimeSecRef.current - lastSeenTimeSecRef.current);
    const pending = missingRef.current.size;
    if (
      (pending === 0 && behind <= 0.05) ||
      Date.now() - finishStartedMsRef.current > FINISH_MAX_WAIT_MS
    ) {
      finalizeRef.current();
      return;
    }
    setFinishing({ pendingRows: pending, behindSec: behind });
  }, []);

  // Ask the device again for rows it skipped; give up on a row after RESEND_MAX_TRIES asks.
  const pumpResend = useCallback(() => {
    const handler = resendHandlerRef.current;
    const miss = missingRef.current;
    if (!handler || miss.size === 0 || resendBusyRef.current) {
      return;
    }
    const now = Date.now();
    const due: number[] = [];
    for (const [seq, m] of miss) {
      if (now - m.lastAskMs < RESEND_RETRY_MS) {
        continue;
      }
      if (m.tries >= RESEND_MAX_TRIES) {
        miss.delete(seq); // asked enough times; those rows are gone (device buffer was overwritten)
      } else {
        due.push(seq);
      }
    }
    if (due.length === 0) {
      return;
    }
    due.sort((a, b) => a - b);
    const ranges: Array<[number, number]> = [];
    for (const seq of due) {
      const last = ranges[ranges.length - 1];
      if (last && seq === last[1] + 1) {
        last[1] = seq;
      } else if (ranges.length < RESEND_RANGES_PER_REQUEST) {
        ranges.push([seq, seq]);
      } else {
        break;
      }
    }
    resendBusyRef.current = true;
    handler(ranges)
      .then(sent => {
        if (!sent) {
          return;
        }
        const t = Date.now();
        for (const [a, b] of ranges) {
          for (let q = a; q <= b; q++) {
            const m = miss.get(q);
            if (m) {
              m.tries += 1;
              m.lastAskMs = t;
            }
          }
        }
      })
      .catch(() => {})
      .then(() => {
        resendBusyRef.current = false;
      });
  }, []);

  const setResendHandler = useCallback(
    (handler: ((ranges: Array<[number, number]>) => Promise<boolean>) | null) => {
      resendHandlerRef.current = handler;
    },
    [],
  );

  const start = useCallback((firmwareVersion: string | null = null) => {
    autosaveRef.current?.close();
    rowsRef.current = [];
    eventsRef.current = [];
    lostRowsRef.current = 0;
    anchorRef.current = null;
    lastSeqRef.current = null;
    missingRef.current = new Map();
    lateRowsRef.current = [];
    finishingRef.current = false;
    lastSeenTimeSecRef.current = 0;
    setFinishing(null);
    setLostRows(0);
    repsRef.current = [];
    repPeaksRef.current = [];
    sessionBestPeakRef.current = 0;
    sampleCounterRef.current = 0;
    latestEnvelopeRef.current = null;
    startTimestampRef.current = Date.now();
    startedAtRef.current = startTimestampRef.current;
    autosaveRef.current = new AutosaveWriter({
      startedAt: startTimestampRef.current,
      appVersion: APP_VERSION,
      firmwareVersion,
    });
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
      pumpResend();
      if (finishingRef.current) {
        checkFinishing();
      }
      setSampleCount(sampleCounterRef.current);
      setLostRows(lostRowsRef.current);
      setElapsedSec(currentElapsedSec());
      setLatestEnvelope(latestEnvelopeRef.current);
      setLiveActivationRatio(
        latestEnvelopeRef.current !== null && sessionBestPeakRef.current > 0
          ? latestEnvelopeRef.current / sessionBestPeakRef.current
          : null,
      );
    }, STATS_TICK_MS);
  }, [clearTick, currentElapsedSec, pumpResend, checkFinishing]);

  const finalizeStop = useCallback(() => {
    finishingRef.current = false;
    setFinishing(null);
    closeCurrentRep(sampleCounterRef.current);
    isRecordingRef.current = false;
    setIsRecording(false);
    clearTick();
    autosaveRef.current?.close();
    // Rows the device re-sent late go into their place in time now.
    if (lateRowsRef.current.length > 0) {
      const merged = mergeLateRows(rowsRef.current, lateRowsRef.current, repsRef.current);
      rowsRef.current = merged.rows;
      repsRef.current = merged.reps;
      sampleCounterRef.current = merged.rows.length;
      lateRowsRef.current = [];
      setReps(merged.reps);
    }
    missingRef.current = new Map();
    setLostRows(lostRowsRef.current);
    setSampleCount(sampleCounterRef.current);
    setElapsedSec(currentElapsedSec());
    setLatestEnvelope(latestEnvelopeRef.current);
    setLiveActivationRatio(
      latestEnvelopeRef.current !== null && sessionBestPeakRef.current > 0
        ? latestEnvelopeRef.current / sessionBestPeakRef.current
        : null,
    );
    const waiters = finishWaitersRef.current;
    finishWaitersRef.current = [];
    waiters.forEach(w => w());
  }, [clearTick, closeCurrentRep, currentElapsedSec]);

  const stop = useCallback((): Promise<void> => {
    if (!isRecordingRef.current) {
      return Promise.resolve();
    }
    const promise = new Promise<void>(resolve => finishWaitersRef.current.push(resolve));
    if (finishingRef.current) {
      finalizeStop(); // pressed again while waiting: give up waiting
      return promise;
    }
    const stopTime = currentElapsedSec();
    // Only worth waiting if the device keeps a buffer (it sends row numbers) and is behind or we know rows are missing.
    const deviceBuffers = anchorRef.current !== null;
    const behind = stopTime - lastSeenTimeSecRef.current > FINISH_LAG_S;
    if (deviceBuffers && (behind || missingRef.current.size > 0)) {
      finishingRef.current = true;
      stopTimeSecRef.current = stopTime;
      finishStartedMsRef.current = Date.now();
      setFinishing({
        pendingRows: missingRef.current.size,
        behindSec: Math.max(0, stopTime - lastSeenTimeSecRef.current),
      });
      return promise;
    }
    finalizeStop();
    return promise;
  }, [currentElapsedSec, finalizeStop]);

  finalizeRef.current = finalizeStop;

  const skipFinishing = useCallback(() => {
    if (finishingRef.current) {
      finalizeStop();
    }
  }, [finalizeStop]);

  const recordRow = useCallback((sample: ParsedSample): SensorRow | null => {
    if (!isRecordingRef.current || startTimestampRef.current === null) {
      return null;
    }
    const phoneSec = (Date.now() - startTimestampRef.current) / 1000;
    let timeSec = phoneSec;

    if (sample.deviceSeq !== undefined && sample.deviceMs !== undefined) {
      const seq = sample.deviceSeq;
      const lastSeq = lastSeqRef.current;
      if (lastSeq !== null && seq <= lastSeq) {
        if (lastSeq - seq <= DEVICE_RESET_SEQ_DROP) {
          const anchor = anchorRef.current;
          if (missingRef.current.has(seq) && anchor) {
            // A row we asked for: keep it aside; it is merged into place at Stop.
            missingRef.current.delete(seq);
            lostRowsRef.current = Math.max(0, lostRowsRef.current - 1);
            const lateRow: SensorRow = {
              ...sample,
              sample: 0,
              timeSec: anchor.timeSec + ((sample.deviceMs - anchor.ms) / 1000),
            };
            lateRowsRef.current.push(lateRow);
            autosaveRef.current?.addRow(lateRow, true);
          }
          return null; // late or duplicate row: never appended to the live stream
        }
        // Device restarted: its counter and clock began again. Continue the timeline from here.
        const prevRow = rowsRef.current[rowsRef.current.length - 1];
        if (prevRow) {
          lostRowsRef.current += Math.max(0, Math.round((phoneSec - prevRow.timeSec) / ROW_PERIOD_S) - 1);
        }
        missingRef.current = new Map(); // rows from before the restart are gone from the device
        anchorRef.current = null;
        lastSeqRef.current = null;
        eventsRef.current.push({ timeSec: phoneSec, type: 'device_restarted' });
        autosaveRef.current?.addEvent(eventsRef.current[eventsRef.current.length - 1]);
      }
      if (anchorRef.current !== null) {
        const t = anchorRef.current.timeSec + (sample.deviceMs - anchorRef.current.ms) / 1000;
        if (t > lastSeenTimeSecRef.current) {
          lastSeenTimeSecRef.current = t;
        }
        if (finishingRef.current && t > stopTimeSecRef.current) {
          return null; // measured after the Stop press: not part of this recording
        }
      }
      if (anchorRef.current === null) {
        anchorRef.current = { seq, ms: sample.deviceMs, timeSec: phoneSec };
        lastSeenTimeSecRef.current = phoneSec;
      } else if (lastSeqRef.current !== null && seq > lastSeqRef.current + 1) {
        for (let q = lastSeqRef.current + 1; q < seq; q++) {
          missingRef.current.set(q, { tries: 0, lastAskMs: 0 });
        }
        lostRowsRef.current += seq - lastSeqRef.current - 1;
      }
      timeSec =
        anchorRef.current.timeSec + (sample.deviceMs - anchorRef.current.ms) / 1000;
      lastSeqRef.current = seq;
    }

    sampleCounterRef.current += 1;
    latestEnvelopeRef.current = sample.envelope;

    const row: SensorRow = {
      ...sample,
      sample: sampleCounterRef.current,
      timeSec,
    };
    rowsRef.current.push(row);
    autosaveRef.current?.addRow(row);
    return row;
  }, []);

  const addEvent = useCallback((type: string, detail?: string) => {
    if (!isRecordingRef.current || startTimestampRef.current === null) {
      return;
    }
    const e: SessionEvent = {
      timeSec: (Date.now() - startTimestampRef.current) / 1000,
      type,
      ...(detail ? { detail } : {}),
    };
    eventsRef.current.push(e);
    autosaveRef.current?.addEvent(e);
  }, []);

  const markRep = useCallback((): RepMark | null => {
    if (!isRecordingRef.current || finishingRef.current || startTimestampRef.current === null) {
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
    autosaveRef.current?.addRep(mark);
    setReps(repsRef.current);
    return mark;
  }, [closeCurrentRep, currentElapsedSec]);

  const reset = useCallback(() => {
    clearTick();
    finishingRef.current = false;
    finishWaitersRef.current.forEach(w => w());
    finishWaitersRef.current = [];
    setFinishing(null);
    autosaveRef.current?.close();
    eventsRef.current = [];
    lostRowsRef.current = 0;
    anchorRef.current = null;
    lastSeqRef.current = null;
    missingRef.current = new Map();
    lateRowsRef.current = [];
    startedAtRef.current = null;
    setLostRows(0);
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
    return {
      rows: rowsRef.current,
      reps: repsRef.current,
      events: eventsRef.current,
      startedAt: startedAtRef.current,
    };
  }, []);

  const loadRecovered = useCallback((rec: RecoveredSession) => {
    clearTick();
    autosaveRef.current?.close();
    autosaveRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    rowsRef.current = rec.rows;
    repsRef.current = rec.reps;
    eventsRef.current = rec.events;
    startedAtRef.current = rec.header.startedAt;
    startTimestampRef.current = rec.header.startedAt;
    sampleCounterRef.current = rec.rows.length;
    repPeaksRef.current = [];
    sessionBestPeakRef.current = 0;
    // Rebuild per-rep peaks (each rep spans from its mark to the next one).
    const marks = rec.reps;
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i].approxSample;
      const to = i + 1 < marks.length ? marks[i + 1].approxSample : rec.rows[rec.rows.length - 1].sample;
      let peak = 0;
      for (const row of rec.rows) {
        if (row.sample > from && row.sample <= to && row.envelope > peak) {
          peak = row.envelope;
        }
      }
      repPeaksRef.current.push(peak);
      if (peak > sessionBestPeakRef.current) {
        sessionBestPeakRef.current = peak;
      }
    }
    const lost = totalMissing(findRowGaps(rec.rows)).rows;
    lostRowsRef.current = lost;
    setLostRows(lost);
    setReps(rec.reps);
    setSampleCount(rec.rows.length);
    setElapsedSec(rec.rows[rec.rows.length - 1].timeSec);
    setLatestEnvelope(null);
    setSessionBestPeak(sessionBestPeakRef.current);
    setLiveActivationRatio(null);
  }, [clearTick]);

  const nowElapsedSec = useCallback((): number => currentElapsedSec(), [currentElapsedSec]);

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
    lostRows,
    finishing,
    skipFinishing,
    setResendHandler,
    start,
    stop,
    addEvent,
    loadRecovered,
    recordRow,
    markRep,
    reset,
    getSnapshot,
    getActivationSummary,
    nowElapsedSec,
  };
}
