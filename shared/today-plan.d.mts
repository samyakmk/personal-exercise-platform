import type { CheckInChoice, Exercise, Movement, TrainingNote, TrainingPreferences, Workout } from '../src/types';

export type TodayPlan = {
  kind: 'train' | 'rest';
  readiness: 'usual' | 'lighter' | 'rest';
  name: string;
  summary: string;
  reasons: string[];
  exercises: Movement[];
};
export const broadPriorities: readonly string[];
export const starterExerciseIds: readonly string[];
export function isPlannableExercise(exercise: Exercise): boolean;
export function buildTodayPlan(input: {
  current: Pick<Workout, 'date' | 'time'>;
  catalog: readonly Exercise[];
  equipment: readonly string[] | null;
  preferences?: TrainingPreferences;
  workouts: readonly Workout[];
  adjustment?: CheckInChoice | null;
  trainingNotes?: readonly TrainingNote[];
}): TodayPlan;
export function checkInReply(text: string, plan: TodayPlan, names: ReadonlyMap<string, string>, adjustment?: CheckInChoice | null): string;
