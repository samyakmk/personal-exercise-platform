import { isWorkoutDate } from '../dates';
import type { ExerciseSet, PendingTrainingLog, SessionCoachState, TrainingSession, TrainingSetDraft } from '../types';
import { readSessionValue, removeSessionValue, writeSessionValue } from './sessionStorageMigration.web';

const sessionKey = (workspace: string) => 'trainer-plus-active-session:' + workspace;
const pendingPrefix = (workspace: string) => 'trainer-plus-pending-log:' + workspace + ':';

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
  const suffix = 'training:' + workspace;
  try {
    const saved = localStorage.getItem(sessionKey(workspace));
    if (saved !== null) return parseSession(saved);
  } catch {}
  try {
    const previous = readSessionValue(suffix);
    const session = previous === null ? null : parseSession(previous);
    if (session) writeTrainingSession(workspace, session);
    return session;
  } catch {
    return null;
  }
}

function parseSession(value: string): TrainingSession | null {
  try {
    const session = JSON.parse(value) as
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
      || session.plan.source !== undefined && !['manual', 'trainer', 'recommended'].includes(session.plan.source)
      || session.effort != null && (!Number.isInteger(session.effort) || session.effort < 1 || session.effort > 10)
      || session.exerciseNotes !== undefined && (session.exerciseNotes === null || typeof session.exerciseNotes !== 'object'
        || Array.isArray(session.exerciseNotes) || Object.entries(session.exerciseNotes).some(([id, notes]) =>
          typeof notes !== 'string' || notes.length > 500 || !session.plan.exercises.some(({ exerciseId }) => exerciseId === id)))
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
    const restDeadline = Number.isSafeInteger(session.restDeadline) && (session.restDeadline ?? 0) > 0
      ? session.restDeadline : null;
    const hold = session.hold && session.plan.exercises.some(({ exerciseId }) => exerciseId === session.hold?.exerciseId)
      && session.hold.setNumber === (session.sets[session.hold.exerciseId]?.length ?? 0) + 1
      && Number.isFinite(session.hold.deadline) && session.hold.deadline <= now + 600_000 ? session.hold : undefined;
    const coach = readCoach(session, now);
    const skippedExerciseIds = Array.isArray(session.skippedExerciseIds) ? [...new Set(session.skippedExerciseIds)]
      .filter((id) => session.plan.exercises.some(({ exerciseId }) => exerciseId === id)) : undefined;
    const restSeconds = Number.isSafeInteger(session.restSeconds) && (session.restSeconds ?? -1) >= 0
      && (session.restSeconds ?? 0) <= 300 ? session.restSeconds : undefined;
    const cue = session.formCue;
    const formCue = cue && typeof cue.text === 'string' && cue.text.length > 0 && cue.text.length <= 600
      && typeof cue.clipId === 'string' && Number.isFinite(cue.startSeconds) && cue.startSeconds >= 0
      && Number.isFinite(cue.timestamp) && cue.timestamp >= 0
      && session.plan.exercises.some(({ exerciseId }) => exerciseId === cue.exerciseId) ? cue : undefined;
    return { ...saved, restDeadline, restSeconds, activeExercise, setDrafts, hold, coach, formCue, skippedExerciseIds };
  } catch {
    return null;
  }
}

function readCoach({ coach, plan }: TrainingSession, now: number): SessionCoachState | undefined {
  if (!coach || !['setup', 'set', 'rest'].includes(coach.stage)) return undefined;
  const skipped = Array.isArray(coach.skipped)
    ? plan.exercises.map(({ exerciseId }) => exerciseId).filter((id) => coach.skipped?.includes(id)) : undefined;
  const validRest = typeof coach.restUntil === 'number' && Number.isSafeInteger(coach.restUntil)
    && coach.restUntil > 0 && coach.restUntil <= now + 300_000;
  return { stage: coach.stage === 'rest' && !validRest ? 'set' : coach.stage, skipped,
    restUntil: coach.stage === 'rest' && validRest ? coach.restUntil : undefined };
}

export function writeTrainingSession(workspace: string, session: TrainingSession | null): boolean {
  const suffix = 'training:' + workspace;
  let persistent = false;
  try {
    if (session) localStorage.setItem(sessionKey(workspace), JSON.stringify(session));
    else localStorage.removeItem(sessionKey(workspace));
    persistent = true;
  } catch {}
  try {
    if (!session || persistent) removeSessionValue(suffix);
    else writeSessionValue(suffix, JSON.stringify(session));
  } catch {}
  return persistent;
}

export function readPendingTrainingLogs(workspace: string): PendingTrainingLog[] {
  try {
    const prefix = pendingPrefix(workspace);
    return Object.keys(localStorage).flatMap((key) => {
      if (!key.startsWith(prefix)) return [];
      try {
        const pending = JSON.parse(localStorage.getItem(key) ?? 'null');
        const session = pending && parseSession(JSON.stringify(pending.session));
        return session && key === prefix + session.logId && typeof pending.separate === 'boolean'
          ? [{ session, separate: pending.separate }] : [];
      } catch {
        return [];
      }
    }).sort((a, b) => a.session.startedAt - b.session.startedAt);
  } catch {
    return [];
  }
}

export function writePendingTrainingLog(workspace: string, pending: PendingTrainingLog) {
  try {
    localStorage.setItem(pendingPrefix(workspace) + pending.session.logId, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function removePendingTrainingLog(workspace: string, logId: string) {
  try { localStorage.removeItem(pendingPrefix(workspace) + logId); } catch {}
}

export function removeTrainingSessionData(workspace: string) {
  writeTrainingSession(workspace, null);
  try {
    const prefix = pendingPrefix(workspace);
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {}
}

export function watchTrainingSession(workspace: string, onSession: () => void, onQueue: () => void, onOnline: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === sessionKey(workspace) || event.key === null) onSession();
    if (event.key === null || event.key.startsWith(pendingPrefix(workspace))) onQueue();
  }
  function onVisible() {
    if (document.visibilityState === 'visible') onOnline();
  }
  window.addEventListener('storage', onStorage);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export function trainingServerMayBeReachable() {
  return navigator.onLine;
}
