/**
 * The firmware announces itself a few times after each connect with one text
 * line on the live characteristic:
 *
 *   FWINFO,<firmware version>,<offline buffer rows>,<rows lost so far>
 *
 * Firmware without the offline buffer never sends it, which is how the app
 * knows the device cannot hold data while disconnected.
 */
export const FWINFO_PREFIX = 'FWINFO,';

/** Rows per second the firmware streams (SAMPLE_RATE / BLE_NOTIFY_DIVIDER). */
export const DEVICE_ROWS_PER_SEC = 50;

export interface FirmwareInfo {
  version: string;
  /** How many live rows the device can hold while disconnected. */
  bufferRows: number;
  lostRowsOnDevice: number;
}

export function parseFirmwareInfoLine(line: string): FirmwareInfo | null {
  if (!line.startsWith(FWINFO_PREFIX)) {
    return null;
  }
  const f = line.trim().split(',');
  if (f.length < 4) {
    return null;
  }
  const bufferRows = Number(f[2]);
  const lost = Number(f[3]);
  if (!f[1] || !Number.isFinite(bufferRows) || !Number.isFinite(lost)) {
    return null;
  }
  return { version: f[1], bufferRows, lostRowsOnDevice: lost };
}

export function bufferSeconds(info: FirmwareInfo | null): number | null {
  return info ? info.bufferRows / DEVICE_ROWS_PER_SEC : null;
}
