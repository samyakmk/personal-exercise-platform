export { loggedMuscleWork } from '../shared/muscle-work.mjs';

export const muscleNames = [
  'Abdominals', 'Abductors', 'Adductors', 'Biceps', 'Calves', 'Chest',
  'Forearms', 'Glutes', 'Hamstrings', 'Lats', 'Lower back', 'Mid-back',
  'Neck', 'Quadriceps', 'Shoulders', 'Traps', 'Triceps',
] as const;

export type Muscle = (typeof muscleNames)[number];
