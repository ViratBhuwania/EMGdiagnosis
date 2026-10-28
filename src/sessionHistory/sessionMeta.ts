/**
 * What the user was actually doing in a recording. One recording = one
 * exercise/equipment/weight, so this lives on the whole session. Kept apart
 * from `exerciseTag` on purpose: that string keys the rolling-peak bucket, and
 * switching it to a picker value would split existing history into a new bucket.
 */
export interface SessionMeta {
  exercise: string | null;
  equipment: string | null;
  weightKg: number | null;
  /** The reps the user actually counted, for checking the app's count. */
  trueReps: number | null;
  /** Warm-up recordings are saved but kept out of the rolling effort reference. */
  isWarmup: boolean;
}

export const EMPTY_SESSION_META: SessionMeta = {
  exercise: null,
  equipment: null,
  weightKg: null,
  trueReps: null,
  isWarmup: false,
};

export const EXERCISE_OPTIONS = [
  'Bicep Curl',
  'Incline Dumbbell Curl',
  'Hammer Curl',
  'Preacher Curl',
  'Concentration Curl',
  'Cable Curl',
  'Reverse Curl',
  'Warm-up',
] as const;

export const EQUIPMENT_OPTIONS = [
  'Dumbbell',
  'Straight bar',
  'Curl bar',
  'Rope',
  'Kettlebell',
  'Cable handle',
  'Bodyweight',
] as const;

export function hasSessionMeta(meta: SessionMeta | null | undefined): boolean {
  return (
    !!meta &&
    (meta.exercise !== null ||
      meta.equipment !== null ||
      meta.weightKg !== null ||
      meta.trueReps !== null ||
      meta.isWarmup)
  );
}

/** e.g. "Hammer Curl · Rope · 12.5 kg" -- for history and text exports. */
export function describeSessionMeta(meta: SessionMeta | null | undefined): string {
  if (!meta) {
    return '';
  }
  const parts: string[] = [];
  if (meta.exercise) {
    parts.push(meta.exercise);
  }
  if (meta.equipment) {
    parts.push(meta.equipment);
  }
  if (meta.weightKg !== null) {
    parts.push(`${meta.weightKg} kg`);
  }
  if (meta.isWarmup) {
    parts.push('warm-up');
  }
  return parts.join(' · ');
}

/** Filename-safe suffix, e.g. "_hammer-curl_rope_12.5kg". Empty when nothing is set. */
export function sessionMetaFilenameSuffix(meta: SessionMeta | null | undefined): string {
  if (!meta) {
    return '';
  }
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const parts: string[] = [];
  if (meta.isWarmup) {
    parts.push('warmup');
  }
  if (meta.exercise) {
    parts.push(slug(meta.exercise));
  }
  if (meta.equipment) {
    parts.push(slug(meta.equipment));
  }
  if (meta.weightKg !== null) {
    parts.push(`${meta.weightKg}kg`);
  }
  const joined = parts.filter(Boolean).join('_');
  return joined ? `_${joined}` : '';
}

/** Parses a weight/reps text field; returns null for empty or invalid input. */
export function parsePositiveNumber(text: string): number | null {
  const n = Number(text.replace(',', '.').trim());
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
}
