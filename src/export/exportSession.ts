import { utils, write } from 'xlsx';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import type { RepMark, SensorRow, SessionEvent } from '../types';
import { APP_VERSION } from '../appInfo';
import { findRowGaps, totalMissing } from './gapReport';
import { hasSessionMeta, sessionMetaFilenameSuffix, type SessionMeta } from '../sessionHistory/sessionMeta';

const EMG_IMU_HEADER = [
  'Sample',
  'Time_s',
  'Signal',
  'Envelope',
  'ax_g',
  'ay_g',
  'az_g',
  'gx_dps',
  'gy_dps',
  'gz_dps',
  'IMU_fresh',
  // Appended last so existing column positions are unchanged. The device's own row number: jumps show rows that never arrived.
  'Device_Seq',
] as const;

const REP_ANNOTATIONS_HEADER = ['Rep', 'ApproxSample', 'Time_s', 'Notes'] as const;

export interface ExportResult {
  filePath: string;
  fileName: string;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** e.g. emg_session_2026-09-12_14-30-05.xlsx */
function timestampedFilename(date: Date, suffix: string = ''): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `emg_session_${y}-${mo}-${d}_${h}-${mi}-${s}${suffix}.xlsx`;
}

function buildEmgImuSheet(rows: SensorRow[]) {
  const data = rows.map(r => ({
    Sample: r.sample,
    Time_s: round(r.timeSec, 5),
    Signal: round(r.signal, 2),
    Envelope: round(r.envelope, 2),
    ax_g: round(r.axG, 4),
    ay_g: round(r.ayG, 4),
    az_g: round(r.azG, 4),
    gx_dps: round(r.gxDps, 3),
    gy_dps: round(r.gyDps, 3),
    gz_dps: round(r.gzDps, 3),
    IMU_fresh: r.imuFresh ? 1 : 0,
    Device_Seq: r.deviceSeq ?? '',
  }));
  return utils.json_to_sheet(data, { header: [...EMG_IMU_HEADER] });
}

function buildRepAnnotationsSheet(reps: RepMark[]) {
  const data = reps.map(r => ({
    Rep: r.repNumber,
    ApproxSample: r.approxSample,
    Time_s: round(r.timeSec, 5),
    Notes: '',
  }));
  return utils.json_to_sheet(data, { header: [...REP_ANNOTATIONS_HEADER] });
}

/** What produced the file, for the validation plan's "lock a version" rule. */
export interface ExportExtra {
  events?: SessionEvent[];
  firmwareVersion?: string | null;
  /** Device offline-buffer size in seconds, if the firmware reported one. */
  bufferSeconds?: number | null;
  /** Phone wall-clock ms when recording started. */
  startedAt?: number | null;
}

function buildSessionInfoSheet(meta: SessionMeta | null, rows: SensorRow[], extra: ExportExtra) {
  const missing = totalMissing(findRowGaps(rows));
  const data: { Field: string; Value: string | number }[] = [
    { Field: 'App_version', Value: APP_VERSION },
    { Field: 'Firmware_version', Value: extra.firmwareVersion ?? 'not reported (firmware without offline buffer)' },
    { Field: 'Device_buffer_seconds', Value: extra.bufferSeconds ?? '' },
    { Field: 'Recording_started', Value: extra.startedAt ? new Date(extra.startedAt).toISOString() : '' },
    { Field: 'Rows_recorded', Value: rows.length },
    { Field: 'Rows_missing', Value: missing.rows },
    { Field: 'Seconds_missing', Value: round(missing.seconds, 2) },
  ];
  if (meta && hasSessionMeta(meta)) {
    data.push(
      { Field: 'Exercise', Value: meta.exercise ?? '' },
      { Field: 'Equipment', Value: meta.equipment ?? '' },
      { Field: 'Weight_kg', Value: meta.weightKg ?? '' },
      { Field: 'True_reps_user_counted', Value: meta.trueReps ?? '' },
      { Field: 'Warmup', Value: meta.isWarmup ? 'yes' : 'no' },
    );
  }
  return utils.json_to_sheet(data, { header: ['Field', 'Value'] });
}

function buildGapsSheet(rows: SensorRow[]) {
  const data = findRowGaps(rows).map(g => ({
    After_sample: g.afterSample,
    Start_s: round(g.startSec, 3),
    End_s: round(g.endSec, 3),
    Missing_s: round(g.durationSec, 3),
    Missing_rows: g.missingRows,
    Basis: g.exact ? 'device row numbers' : g.note ?? 'timestamps (estimate)',
  }));
  return utils.json_to_sheet(data, {
    header: ['After_sample', 'Start_s', 'End_s', 'Missing_s', 'Missing_rows', 'Basis'],
  });
}

function buildEventsSheet(events: SessionEvent[]) {
  const data = events.map(e => ({
    Time_s: round(e.timeSec, 3),
    Event: e.type,
    Detail: e.detail ?? '',
  }));
  return utils.json_to_sheet(data, { header: ['Time_s', 'Event', 'Detail'] });
}

/**
 * Build the workbook (EMG_IMU, RepAnnotations, Session_Info with app/firmware versions + any tags, Gaps, Connection_Events) and write it as one
 * timestamped .xlsx file to the app's Documents directory.
 */
export async function exportSession(
  rows: SensorRow[],
  reps: RepMark[],
  meta: SessionMeta | null = null,
  extra: ExportExtra = {},
): Promise<ExportResult> {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, buildEmgImuSheet(rows), 'EMG_IMU');
  utils.book_append_sheet(
    workbook,
    buildRepAnnotationsSheet(reps),
    'RepAnnotations',
  );
  // Extra sheets come after the first two, so scripts that read those are unaffected.
  utils.book_append_sheet(workbook, buildSessionInfoSheet(meta, rows, extra), 'Session_Info');
  utils.book_append_sheet(workbook, buildGapsSheet(rows), 'Gaps');
  utils.book_append_sheet(workbook, buildEventsSheet(extra.events ?? []), 'Connection_Events');

  const base64 = write(workbook, { type: 'base64', bookType: 'xlsx' }) as string;

  const fileName = timestampedFilename(new Date(), sessionMetaFilenameSuffix(meta));
  const filePath = `${RNFS.DocumentDirectoryPath}/${fileName}`;
  await RNFS.writeFile(filePath, base64, 'base64');

  return { filePath, fileName };
}

/** Present the iOS share sheet (AirDrop, Save to Files, etc.) for an exported file. */
export async function shareExportedSession(result: ExportResult): Promise<void> {
  await Share.open({
    url: `file://${result.filePath}`,
    filename: result.fileName,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    failOnCancel: false,
  });
}
