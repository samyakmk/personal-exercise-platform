import type { Exercise, Movement } from '../src/types';
export function estimatedWorkoutMinutes(movements: readonly Movement[], exerciseById: ReadonlyMap<string, Exercise>): number;
