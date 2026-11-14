import { isWorkoutDate } from '../dates';
import type { ExerciseSet, TrainingSession, TrainingSetDraft } from '../types';
import { readSessionValue, removeSessionValue } from './sessionStorageMigration.web';

function isSet(set: ExerciseSet | null, optionalReps = false) {
  return set && (set.reps !== undefined && Number.isInteger(set.reps) && set.reps >= 1 && set.reps <= 600
    || optionalReps && set.reps === undefined && set.load !== undefined)
    && (set.load === undefined || (set.load && ['kg', 'lb'].includes(set.load.unit)
      && Number.isFinite(set.load.value) && set.load.value > 0 && set.load.value <= 1000));
}

function isDraft(draft: TrainingSetDraft | null, next: number) {
  return draft && next <= 30 && draft.setNumber === next
    && typeof draft.reps === 'string' && draft.reps.length <= 3
    && typeof draft.load === 'string' && draft.load.length <= 8 && ['lb', 'kg'].includes(draft.unit);
}

export function readTrainingSession(workspace: string): TrainingSession | null {
  try {
    const suffix = 'training:' + workspace;
    const session = JSON.parse(readSessionValue('liftmorrow-' + suffix, suffix) ?? 'null') as
      (TrainingSession & { setDraft?: TrainingSetDraft & { exerciseId: string } }) | null;
    if (!session || typeof session.logId !== 'string' || !Number.isFinite(session.startedAt)
      || typeof session.plan?.id !== 'string' || typeof session.plan.name !== 'string'
      || session.plan.status !== 'planned' || !Array.isArray(session.plan.exercises)
      || (!session.adHoc && !session.plan.exercises.length)
      || (session.logTime !== undefined && (!session.adHoc || !isWorkoutDate(session.logTime.date)
        || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(session.logTime.time)))
      || !session.plan.exercises.every((item) => isSet(item) && typeof item.exerciseId === 'string'
        && Number.isInteger(item.sets) && item.sets >= 1 && item.sets <= 30
        && (item.setDetails === undefined || Array.isArray(item.setDetails) && item.setDetails.length === item.sets && item.setDetails.every((set) => isSet(set))))
      || typeof session.notes !== 'string' || session.notes.length > 1200
      || !session.sets || typeof session.sets !== 'object' || Array.isArray(session.sets)
      || !Object.values(session.sets).every((sets) => Array.isArray(sets) && sets.length <= 30 && sets.every((set) => isSet(set, Boolean(session.adHoc))))) return null;
    const { setDraft, ...saved } = session;
    const setDrafts = Object.fromEntries(session.plan.exercises.flatMap(({ exerciseId }) => {
      const draft = session.setDrafts?.[exerciseId] ?? (setDraft?.exerciseId === exerciseId ? setDraft : null);
      return draft && isDraft(draft, (session.sets[exerciseId]?.length ?? 0) + 1) ? [[exerciseId, draft]] : [];
    }));
    const requested = session.activeExercise ?? setDraft?.exerciseId;
    const activeExercise = session.plan.exercises.find(({ exerciseId }) => exerciseId === requested)?.exerciseId;
    const now = Date.now();
    const restDeadline = Number.isFinite(session.restDeadline) && (session.restDeadline ?? 0) <= now + 90_000
      ? session.restDeadline : null;
    const hold = session.hold && session.plan.exercises.some(({ exerciseId }) => exerciseId === session.hold?.exerciseId)
      && session.hold.setNumber === (session.sets[session.hold.exerciseId]?.length ?? 0) + 1
      && Number.isFinite(session.hold.deadline) && session.hold.deadline <= now + 600_000 ? session.hold : undefined;
    return { ...saved, restDeadline, activeExercise, setDrafts, hold };
  } catch {
    return null;
  }
}

export function writeTrainingSession(workspace: string, session: TrainingSession | null) {
  try {
    const suffix = 'training:' + workspace;
    const key = 'liftmorrow-' + suffix;
    if (session) sessionStorage.setItem(key, JSON.stringify(session));
    else removeSessionValue(key, suffix);
  } catch {}
}
