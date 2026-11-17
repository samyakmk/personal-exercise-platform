import { exercisesById } from './catalog.mjs';

const idPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export function normalizeClipTrainingContext(value) {
  if (!value || typeof value !== 'object') return null;
  const { sessionId, exerciseId, setNumber, workoutId } = value;
  if (typeof sessionId !== 'string' || !idPattern.test(sessionId) || !exercisesById.has(exerciseId)
    || !Number.isInteger(setNumber) || setNumber < 1 || setNumber > 30
    || (workoutId !== undefined && (typeof workoutId !== 'string' || !idPattern.test(workoutId)))) return null;
  return { sessionId, exerciseId, setNumber, ...(workoutId && { workoutId }) };
}
