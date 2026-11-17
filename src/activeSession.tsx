import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createId, RequestError } from './api';
import {
  readPendingTrainingLogs, readTrainingSession, removePendingTrainingLog, trainingServerMayBeReachable,
  watchTrainingSession, writePendingTrainingLog, writeTrainingSession,
} from './platform/trainingSession';
import { isSavedTrainingLog, trainingLog } from './trainingProgress';
import type { FormCue, PendingTrainingLog, TrainingSession, TrainingSessionMovementContext, Workout } from './types';
import { useWorkspace } from './workspace';

export function newTrainingSession(plan: Workout, adHoc = false): TrainingSession {
  return {
    plan, ...(adHoc && { adHoc: true }), logId: createId(), startedAt: Date.now(), sets: {}, notes: plan.notes ?? '',
    ...(plan.exercises.length > 0 && { coach: { stage: 'setup' } }),
  };
}

const Context = createContext<{
  session: TrainingSession | null;
  keepSession: (value: TrainingSession | null) => void;
  applyFormCue: (context: TrainingSessionMovementContext, cue: FormCue) => boolean;
  saveSession: (session: TrainingSession, separate: boolean) => Promise<{ workout: Workout; sync: 'synced' | 'queued' }>;
  pendingCount: number;
  syncError: string;
  storageError: boolean;
  syncPending: () => void;
} | null>(null);

export function ActiveSessionProvider({ children }: { children: ReactNode }) {
  const { api, data, mutate, announce } = useWorkspace();
  const workspace = data?.workspaceKey;
  const [stored, setStored] = useState<{ workspace?: string; session: TrainingSession | null }>();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState('');
  const [retryAt, setRetryAt] = useState<number>();
  const [storageError, setStorageError] = useState(false);
  const currentSession = useRef<TrainingSession | null>(null);
  const syncing = useRef(false);
  const saving = useRef(false);
  const activeWorkspace = useRef(workspace);
  activeWorkspace.current = workspace;
  const saved = stored?.workspace === workspace ? stored?.session ?? null : null;
  const session = saved && !data?.workouts.some((workout) => isSavedTrainingLog(saved, workout)) ? saved : null;

  const reloadSession = useCallback(() => {
    let session = workspace ? readTrainingSession(workspace) : null;
    if (workspace && session && readPendingTrainingLogs(workspace).some((item) => item.session.logId === session?.logId)) {
      writeTrainingSession(workspace, null);
      session = null;
    }
    currentSession.current = session;
    setStored({ workspace, session });
  }, [workspace]);

  const keepSession = useCallback((value: TrainingSession | null) => {
    if (workspace) setStorageError(!writeTrainingSession(workspace, value));
    currentSession.current = value;
    setStored({ workspace, session: value });
  }, [workspace]);

  const persist = useCallback(async ({ session, separate }: PendingTrainingLog) => {
    const workout = trainingLog(session, separate);
    await mutate(() => api.saveWorkout(workout, !separate, undefined, !separate && workout.revision ? session.logId : undefined));
    return workout;
  }, [api, mutate]);

  const syncFailed = useCallback((failure: unknown) => {
    setSyncError(failure instanceof Error ? failure.message : 'Could not sync this workout.');
    const retryAfter = failure instanceof RequestError ? failure.retryAfter : undefined;
    setRetryAt(retryable(failure) ? Date.now() + Math.max(15, retryAfter ?? 0) * 1000 : undefined);
  }, []);

  const syncPending = useCallback(() => {
    if (!workspace || syncing.current || saving.current || !trainingServerMayBeReachable()) return;
    const pending = readPendingTrainingLogs(workspace);
    setPendingCount(pending.length);
    setRetryAt(undefined);
    if (!pending.length) { setSyncError(''); return; }
    syncing.current = true;
    setSyncError('');
    void (async () => {
      let synced = 0;
      let separated = false;
      for (const log of pending) {
        if (activeWorkspace.current !== workspace) break;
        try {
          try { await persist(log); }
          catch (failure) {
            if (log.separate || !workoutChanged(failure)) throw failure;
            const separate = { ...log, separate: true };
            if (!writePendingTrainingLog(workspace, separate)) throw failure;
            await persist(separate);
            separated = true;
          }
          removePendingTrainingLog(workspace, log.session.logId);
          if (readTrainingSession(workspace)?.logId === log.session.logId) writeTrainingSession(workspace, null);
          if (currentSession.current?.logId === log.session.logId && activeWorkspace.current === workspace) reloadSession();
          synced++;
        } catch (failure) {
          if (activeWorkspace.current === workspace) syncFailed(failure);
          break;
        }
      }
      if (activeWorkspace.current === workspace) {
        setPendingCount(readPendingTrainingLogs(workspace).length);
        if (separated) announce('The scheduled workout changed. Your recorded sets synced as a separate session.');
        else if (synced) announce(synced === 1 ? 'Workout synced.' : `${synced} workouts synced.`);
      }
    })().finally(() => { syncing.current = false; });
  }, [announce, persist, reloadSession, syncFailed, workspace]);

  useEffect(() => {
    if (!workspace) return;
    reloadSession();
    const refreshQueue = () => { setPendingCount(readPendingTrainingLogs(workspace).length); };
    refreshQueue();
    syncPending();
    return watchTrainingSession(workspace, reloadSession, refreshQueue, syncPending);
  }, [reloadSession, syncPending, workspace]);

  useEffect(() => {
    if (retryAt === undefined) return;
    const timer = setTimeout(syncPending, Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt, syncPending]);

  async function saveSession(session: TrainingSession, separate: boolean) {
    if (!workspace) throw new Error('Open your profile before saving this workout.');
    const log = { session, separate };
    saving.current = true;
    const local = writePendingTrainingLog(workspace, log);
    try {
      if (trainingServerMayBeReachable()) {
        try {
          const workout = await persist(log);
          if (local) removePendingTrainingLog(workspace, session.logId);
          if (activeWorkspace.current === workspace && currentSession.current?.logId === session.logId) keepSession(null);
          return { workout, sync: 'synced' as const };
        } catch (failure) {
          if (!local || !retryable(failure)) {
            if (local) removePendingTrainingLog(workspace, session.logId);
            throw failure;
          }
          if (activeWorkspace.current === workspace) syncFailed(failure);
        }
      } else if (!local) {
        throw new Error('Device storage is unavailable. Keep this workout open and reconnect to save.');
      }
      if (activeWorkspace.current === workspace) {
        setPendingCount(readPendingTrainingLogs(workspace).length);
        if (currentSession.current?.logId === session.logId) keepSession(null);
      }
      return { workout: trainingLog(session, separate), sync: 'queued' as const };
    } finally {
      saving.current = false;
    }
  }

  useEffect(() => {
    if (saved && !session && currentSession.current?.logId === saved.logId) keepSession(null);
  }, [saved, session, keepSession]);

  function applyFormCue(context: TrainingSessionMovementContext, cue: FormCue) {
    const active = currentSession.current;
    if (!active || active.logId !== context.sessionId || cue.exerciseId !== context.exerciseId
      || !active.plan.exercises.some(({ exerciseId }) => exerciseId === context.exerciseId)) return false;
    keepSession({ ...active, formCue: cue });
    return true;
  }

  return <Context.Provider value={{ session, keepSession, applyFormCue, saveSession,
    pendingCount, syncError, storageError, syncPending }}>{children}</Context.Provider>;
}

function retryable(failure: unknown) {
  return !(failure instanceof RequestError) || failure.status === 408 || failure.status === 429 || failure.status >= 500;
}

function workoutChanged(failure: unknown) {
  return failure instanceof RequestError && (failure.status === 404 && failure.message === 'Workout not found.'
    || failure.status === 409 && failure.message.startsWith('This workout changed'));
}

export function useActiveSession() {
  const context = useContext(Context);
  if (!context) throw new Error('ActiveSessionProvider is missing');
  return context;
}
