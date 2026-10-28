/**
 * Writes the recording to disk while it happens (flushed about once a second),
 * so closing or losing the app mid-recording no longer loses it. At most the
 * last second is lost. Kept after Stop until the file is exported (or a new
 * recording starts), so the next launch can offer to recover it.
 */
import RNFS from 'react-native-fs';
import {
  eventLine,
  headerLine,
  parseAutosave,
  repLine,
  rowLine,
  type AutosaveHeader,
  type RecoveredSession,
} from './autosaveFormat';
import type { RepMark, SensorRow, SessionEvent } from '../types';

const AUTOSAVE_PATH = `${RNFS.DocumentDirectoryPath}/autosave_current_recording.log`;
const FLUSH_MS = 1000;

export class AutosaveWriter {
  private pending: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(header: AutosaveHeader) {
    // A new recording replaces whatever was left from the last one.
    this.chain = RNFS.writeFile(AUTOSAVE_PATH, headerLine(header), 'utf8').catch(() => {});
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
  }

  addRow(row: SensorRow, late = false) {
    this.pending.push(rowLine(row, late));
  }
  addRep(mark: RepMark) {
    this.pending.push(repLine(mark));
  }
  addEvent(event: SessionEvent) {
    this.pending.push(eventLine(event));
  }

  flush(): Promise<void> {
    if (this.pending.length > 0) {
      const text = this.pending.join('');
      this.pending = [];
      this.chain = this.chain
        .then(() => RNFS.appendFile(AUTOSAVE_PATH, text, 'utf8'))
        .catch(() => {});
    }
    return this.chain;
  }

  /** Flush what's left and stop the timer; the file stays on disk. */
  close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.flush();
  }
}

export async function loadAutosave(): Promise<RecoveredSession | null> {
  try {
    if (!(await RNFS.exists(AUTOSAVE_PATH))) {
      return null;
    }
    return parseAutosave(await RNFS.readFile(AUTOSAVE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    if (await RNFS.exists(AUTOSAVE_PATH)) {
      await RNFS.unlink(AUTOSAVE_PATH);
    }
  } catch {
    // best effort
  }
}
