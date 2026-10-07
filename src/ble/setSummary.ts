/**
 * The firmware's per-set fatigue summary: median frequency (MDF) and
 * zero-crossing rate (ZCR) per time bin, computed on the ESP32 from its own
 * 500 Hz buffer and sent as a text line on the live channel (see
 * ble/summaryLine.ts for the wire format and parsing).
 */
export const FIRMWARE_SAMPLE_RATE_HZ = 500;

export interface SetSummaryData {
  setId: number;
  binSeconds: number;
  /** Median frequency per time bin, Hz. null = the bin had no usable (active) data. */
  mdfHz: Array<number | null>;
  /** Zero-crossing rate per time bin, Hz-equivalent. null = no usable data. */
  zcrHz: Array<number | null>;
  /** Active (above-threshold) samples in the set at 500Hz -- the set's real duration, used to pair it with a detected set. */
  activeSamples: number;
}
