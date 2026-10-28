import RNFS from 'react-native-fs';
import { EQUIPMENT_OPTIONS, EXERCISE_OPTIONS } from './sessionMeta';

/** User-added "Other" names, remembered across sessions (kept apart from sessionMeta.ts so that file stays free of native modules and testable). */
export interface CustomTagOptions {
  exercises: string[];
  equipment: string[];
}

const OPTIONS_PATH = `${RNFS.DocumentDirectoryPath}/session_tag_options.json`;

export async function loadCustomTagOptions(): Promise<CustomTagOptions> {
  try {
    if (!(await RNFS.exists(OPTIONS_PATH))) {
      return { exercises: [], equipment: [] };
    }
    const parsed = JSON.parse(await RNFS.readFile(OPTIONS_PATH, 'utf8'));
    return {
      exercises: Array.isArray(parsed.exercises) ? parsed.exercises : [],
      equipment: Array.isArray(parsed.equipment) ? parsed.equipment : [],
    };
  } catch {
    return { exercises: [], equipment: [] };
  }
}

/** Adds a custom name (case-insensitive de-dupe against built-ins and earlier customs) and returns the new lists. */
export async function addCustomTagOption(
  kind: 'exercises' | 'equipment',
  name: string,
  current: CustomTagOptions,
): Promise<CustomTagOptions> {
  const trimmed = name.trim();
  const builtIn: readonly string[] = kind === 'exercises' ? EXERCISE_OPTIONS : EQUIPMENT_OPTIONS;
  const known = [...builtIn, ...current[kind]].map(s => s.toLowerCase());
  if (!trimmed || known.includes(trimmed.toLowerCase())) {
    return current;
  }
  const next = { ...current, [kind]: [...current[kind], trimmed] };
  try {
    await RNFS.writeFile(OPTIONS_PATH, JSON.stringify(next), 'utf8');
  } catch {
    // Best effort: the name still works for this session.
  }
  return next;
}
