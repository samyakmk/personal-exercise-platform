import type { Exercise, Workout } from '../src/types';

export function loggedMuscleWork(workouts: readonly Workout[], catalog: ReadonlyMap<string, Exercise>): Map<string, number>;
