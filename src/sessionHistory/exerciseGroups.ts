/**
 * Groups a workout's sets by exercise so the summary compares like with like
 * (3 sets of dumbbell curl against each other, not against a hammer curl).
 * A set's exercise is the name typed for that set if any, otherwise the
 * recording's picked exercise + equipment; with neither it goes under
 * "Unlabelled". Names are matched ignoring case and extra spaces. Different
 * weights of the same exercise stay in one group (the weight is shown per set).
 */
import type { SetSummaryRecord } from './types';

export const UNLABELLED = 'Unlabelled';

export interface GroupedSet {
  set: SetSummaryRecord;
  /** Position in the whole workout (0-based), used for colours and "Set n" numbering. */
  workoutIndex: number;
}

export interface ExerciseGroup {
  key: string;
  title: string;
  items: GroupedSet[];
}

export function exerciseNameOf(set: SetSummaryRecord): string | null {
  const label = set.label?.trim();
  if (label) {
    return label;
  }
  const parts = [set.exercise, set.equipment].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function keyOf(name: string | null): string {
  return name ? name.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

/** Groups in order of first appearance; sets keep workout order inside each group. */
export function groupSetsByExercise(sets: SetSummaryRecord[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = [];
  const byKey = new Map<string, ExerciseGroup>();
  sets.forEach((set, workoutIndex) => {
    const name = exerciseNameOf(set);
    const key = keyOf(name);
    let g = byKey.get(key);
    if (!g) {
      g = { key, title: name ? name.trim().replace(/\s+/g, ' ') : UNLABELLED, items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push({ set, workoutIndex });
  });
  return groups;
}
