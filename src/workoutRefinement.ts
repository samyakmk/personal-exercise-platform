import type { Exercise, Movement, Refinement } from './types';

export function workoutSize(exercises: Movement[]) {
  const sets = exercises.reduce((total, movement) => total + movement.sets, 0);
  return `${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'} · ${sets} ${sets === 1 ? 'set' : 'sets'}`;
}

export function refineWorkout(exercises: Movement[], choice: Refinement, catalog: ReadonlyMap<string, Exercise>) {
  if (choice === 'shorter' && exercises.every(({ sets }) => sets === 1) && exercises.length > 1) {
    return { exercises: exercises.slice(0, -1), message: 'Removed the last exercise to shorten the workout.' };
  }
  const adjusted = exercises.map((movement) => {
    if (choice === 'shorter') return { ...movement, sets: Math.max(1, movement.sets - 1) };
    if (choice === 'longer') return { ...movement, sets: Math.min(3, movement.sets + 1) };
    const seconds = catalog.get(movement.exerciseId)?.unit === 'seconds';
    const step = seconds ? 5 : 1;
    const target = movement.reps ?? (seconds ? 15 : 6);
    return { ...movement, reps: choice === 'harder' ? Math.min(seconds ? 45 : 15, target + step) : Math.max(1, target - step) };
  });
  if (adjusted.every(({ sets, reps }, i) => sets === exercises[i].sets && reps === exercises[i].reps)) {
    return { exercises, message: `This workout is already as ${({ easier: 'easy', harder: 'challenging', shorter: 'short', longer: 'long' })[choice]} as the suggestion allows.` };
  }
  const message = {
    easier: 'Lowered the rep or hold targets.', harder: 'Raised the rep or hold targets.',
    shorter: 'Reduced the number of sets.', longer: 'Added more sets.',
  }[choice];
  return { exercises: adjusted, message };
}
