import { utils, write } from 'xlsx';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import type { RepMark, SensorRow } from '../types';

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
function timestampedFilename(date: Date): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const s = pad2(date.getSeconds());
  return `emg_session_${y}-${mo}-${d}_${h}-${mi}-${s}.xlsx`;
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

/**
 * Build the two-sheet workbook (EMG_IMU + RepAnnotations) and write it as one
 * timestamped .xlsx file to the app's Documents directory.
 */
export async function exportSession(
  rows: SensorRow[],
  reps: RepMark[],
): Promise<ExportResult> {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, buildEmgImuSheet(rows), 'EMG_IMU');
  utils.book_append_sheet(
    workbook,
    buildRepAnnotationsSheet(reps),
    'RepAnnotations',
  );

  const base64 = write(workbook, { type: 'base64', bookType: 'xlsx' }) as string;

  const fileName = timestampedFilename(new Date());
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
