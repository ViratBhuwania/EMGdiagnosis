/** Remembers the last device the user connected to, so the app can reconnect without a new scan. */
import RNFS from 'react-native-fs';

const PATH = `${RNFS.DocumentDirectoryPath}/last_device_id.txt`;

export async function saveLastDeviceId(id: string): Promise<void> {
  try {
    await RNFS.writeFile(PATH, id, 'utf8');
  } catch {
    // best effort
  }
}

export async function loadLastDeviceId(): Promise<string | null> {
  try {
    if (!(await RNFS.exists(PATH))) {
      return null;
    }
    const id = (await RNFS.readFile(PATH, 'utf8')).trim();
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
