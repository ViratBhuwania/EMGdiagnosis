import { groupSetsByExercise, exerciseNameOf, UNLABELLED } from '../exerciseGroups';
import type { SetSummaryRecord } from '../types';

function set(over: Partial<SetSummaryRecord>): SetSummaryRecord {
  return {
    setNumber: 1, label: null, repCount: 10, meanActivationPct: 50, meanArea: 1,
    peakEnvelope: 100, p90Peak: 90, firstRepStartSec: 0, fatigueDetected: false, fatigueStartRep: null,
    ...over,
  };
}

describe('groupSetsByExercise', () => {
  it('keeps 3 curls together and the hammer curl apart, in workout order', () => {
    const sets = [
      set({ exercise: 'Bicep Curl', equipment: 'Dumbbell', weightKg: 7.5 }),
      set({ exercise: 'Bicep Curl', equipment: 'Dumbbell', weightKg: 10 }),
      set({ exercise: 'Hammer Curl', equipment: 'Dumbbell', weightKg: 10 }),
      set({ exercise: 'Bicep Curl', equipment: 'Dumbbell', weightKg: 12.5 }),
    ];
    const g = groupSetsByExercise(sets);
    expect(g.map(x => x.title)).toEqual(['Bicep Curl · Dumbbell', 'Hammer Curl · Dumbbell']);
    expect(g[0].items.map(i => i.workoutIndex)).toEqual([0, 1, 3]);
    expect(g[1].items.map(i => i.workoutIndex)).toEqual([2]);
  });
  it('a typed label wins and is matched ignoring case and spacing', () => {
    const g = groupSetsByExercise([
      set({ label: 'Hammer Curl', exercise: 'Bicep Curl' }),
      set({ label: ' hammer  curl ' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].items).toHaveLength(2);
  });
  it('older sets with nothing go under Unlabelled', () => {
    const g = groupSetsByExercise([set({}), set({})]);
    expect(g[0].title).toBe(UNLABELLED);
    expect(exerciseNameOf(set({}))).toBeNull();
  });
  it('same exercise at different weights stays in one group', () => {
    const g = groupSetsByExercise([set({ exercise: 'Bicep Curl', weightKg: 5 }), set({ exercise: 'Bicep Curl', weightKg: 15 })]);
    expect(g).toHaveLength(1);
  });
});
