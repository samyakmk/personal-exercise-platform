import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createWorkspaceApi, RequestError } from './api';
import { compareWorkoutTime, workoutTime } from './dates';
import { signalWorkspaceUpdate, watchWorkspaceUpdates } from './platform/workspaceUpdates';
import { completedWorkouts } from './trainingProgress';
import type { Clip, ClipReview, Exercise, Snapshot, Workspace, WorkspaceChange } from './types';
import { useLocalClock } from './useLocalClock';

type WorkspaceState = {
  api: ReturnType<typeof createWorkspaceApi>;
  data: Workspace | null;
  exerciseRecords: ReadonlyMap<string, Exercise>;
  error: string;
  reload: () => void;
  mutate: (operation: () => Promise<WorkspaceChange>) => Promise<void>;
  transferClip: (id: string, signal: AbortSignal, operation: () => Promise<void>) => Promise<boolean>;
  refreshAfterRestore: (changed: boolean) => void;
  recommendationContext: string;
  startReview: (id: string, startSeconds: number, refresh?: boolean) => Promise<void>;
  cancelReview: (id: string, sequence: number) => Promise<void>;
  notice: string;
  announce: (message: string) => void;
};

const Context = createContext<WorkspaceState | null>(null);

const reviewStateOrder = { idle: 0, running: 1, failed: 2, cancelled: 2, complete: 3 };

function newerReview(current: ClipReview, incoming: ClipReview): ClipReview {
  const a = current.reviewStatus;
  const b = incoming.reviewStatus;
  const stale = b.sequence < a.sequence ||
    (b.sequence === a.sequence && reviewStateOrder[b.state] < reviewStateOrder[a.state]);
  const latest = stale ? current : incoming;
  return { review: latest.review, reviewStatus: latest.reviewStatus };
}

function mergeClips(current: Clip[], incoming: Clip[]) {
  const byId = new Map(current.map((clip) => [clip.id, clip]));
  return incoming.map((clip) => {
    const previous = byId.get(clip.id);
    return previous ? { ...clip, ...newerReview(previous, clip) } : clip;
  });
}

function isSnapshot(change: WorkspaceChange): change is Snapshot {
  return 'clips' in change && Array.isArray(change.clips);
}

function applyWorkspaceChange(current: Workspace, change: WorkspaceChange): Workspace {
  if (isSnapshot(change)) return { ...current, ...change, clips: mergeClips(current.clips, change.clips) };
  if ('clips' in change) {
    const clips = new Map(current.clips.map((clip) => [clip.id, clip]));
    for (const id of change.clips.remove) clips.delete(id);
    for (const clip of mergeClips(current.clips, change.clips.upsert)) clips.set(clip.id, clip);
    return { ...current, clips: [...clips.values()].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.id.localeCompare(a.id)) };
  }
  if ('equipment' in change) return { ...current, equipment: change.equipment };
  if ('bookmarks' in change) return { ...current, bookmarks: change.bookmarks };
  if ('trainingNotes' in change) return { ...current, trainingNotes: change.trainingNotes };

  const workouts = new Map(current.workouts.map((workout) => [workout.id, workout]));
  for (const id of change.workouts.remove) workouts.delete(id);
  for (const workout of change.workouts.upsert) workouts.set(workout.id, workout);
  return { ...current, workouts: [...workouts.values()].sort((a, b) => compareWorkoutTime(a, b)
    || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1)) };
}

export function WorkspaceProvider({ workspaceKey, refreshProfile, children }: {
  workspaceKey: string;
  refreshProfile: () => void;
  children: ReactNode;
}) {
  const api = useMemo(() => createWorkspaceApi(workspaceKey), [workspaceKey]);
  const now = useLocalClock();
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ message: string }>();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const snapshotTag = useRef<string | undefined>(undefined);
  const reviewGeneration = useRef(0);
  const refreshing = useRef(false);
  const shouldRefresh = useRef(false);

  const reload = useCallback(() => {
    shouldRefresh.current = true;
    if (refreshing.current) return;
    refreshing.current = true;
    const refresh = queue.current.then(async () => {
      while (shouldRefresh.current) {
        shouldRefresh.current = false;
        try {
          const generation = reviewGeneration.current;
          const { workspace, etag } = await api.workspace(snapshotTag.current);
          setError('');
          if (!workspace) continue;
          if (workspace.workspaceKey !== workspaceKey) {
            setData(null);
            refreshProfile();
            continue;
          }
          snapshotTag.current = generation === reviewGeneration.current ? etag : undefined;
          setData((current) => current && current.workspaceKey === workspace.workspaceKey
            ? { ...workspace, clips: mergeClips(current.clips, workspace.clips) }
            : workspace);
        } catch (failure) {
          if (failure instanceof RequestError && [404, 409].includes(failure.status)) {
            setData(null);
            snapshotTag.current = undefined;
            refreshProfile();
          }
          setError((failure as Error).message);
        }
      }
    }).finally(() => { refreshing.current = false; });
    queue.current = refresh;
  }, [api, refreshProfile, workspaceKey]);

  useEffect(() => {
    reload();
    return watchWorkspaceUpdates(reload);
  }, [reload]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((current) => current === notice ? undefined : current), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const announce = useCallback((message: string) => setNotice({ message }), []);

  const mutate = useCallback((operation: () => Promise<WorkspaceChange>) => {
    const update = queue.current.then(async () => {
      const change = await operation();
      snapshotTag.current = undefined;
      setData((current) => current && applyWorkspaceChange(current, change));
      signalWorkspaceUpdate();
    });
    queue.current = update.catch(() => {});
    return update;
  }, []);

  const transferClip = useCallback(async (id: string, signal: AbortSignal, operation: () => Promise<void>) => {
    await operation();
    // The transfer runs outside the workspace queue. A delayed response can
    // arrive after another tab has changed or deleted the committed clip.
    let missing = false;
    await mutate(async () => {
      try {
        const clip = await api.clip(id, signal);
        return { clips: { upsert: [clip], remove: [] } };
      } catch (error) {
        if (!(error instanceof RequestError) || error.status !== 404) throw error;
        missing = true;
        return { clips: { upsert: [], remove: [id] } };
      }
    });
    return !missing;
  }, [api, mutate]);

  const refreshAfterRestore = useCallback((changed: boolean) => {
    reload();
    if (changed) signalWorkspaceUpdate();
  }, [reload]);

  const updateReview = useCallback((id: string, incoming: ClipReview) => {
    reviewGeneration.current += 1;
    snapshotTag.current = undefined;
    setData((current) => current && {
      ...current,
      clips: current.clips.map((clip) => clip.id === id ? { ...clip, ...newerReview(clip, incoming) } : clip),
    });
  }, []);

  const startReview = useCallback(async (id: string, startSeconds: number, refresh?: boolean) => {
    try {
      updateReview(id, await api.startClipReview(id, startSeconds, refresh));
      signalWorkspaceUpdate();
    } catch (failure) {
      if (!(failure instanceof RequestError) || [404, 408, 409].includes(failure.status)) reload();
      throw failure;
    }
  }, [api, reload, updateReview]);

  const cancelReview = useCallback(async (id: string, sequence: number) => {
    try {
      updateReview(id, await api.cancelClipReview(id, sequence));
      signalWorkspaceUpdate();
    } catch (failure) {
      if (!(failure instanceof RequestError) || [404, 408, 409].includes(failure.status)) reload();
      throw failure;
    }
  }, [api, reload, updateReview]);

  const running = data?.clips.filter(({ reviewStatus }) => reviewStatus.state === 'running').map(({ id }) => id).join(',') ?? '';
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const ids = running.split(',');
    let timer: ReturnType<typeof setTimeout>;
    let consecutiveFailures = 0;
    async function poll() {
      let reachedServer = false;
      await Promise.all(ids.map(async (id) => {
        try {
          const status = await api.clipReview(id, controller.signal);
          reachedServer = true;
          if (!controller.signal.aborted) updateReview(id, status);
        } catch (failure) {
          if (!controller.signal.aborted && failure instanceof RequestError && failure.status === 404) {
            reachedServer = true;
            reload();
          }
        }
      }));
      consecutiveFailures = reachedServer ? 0 : consecutiveFailures + 1;
      if (!controller.signal.aborted) timer = setTimeout(poll, 1600 * 2 ** Math.min(3, consecutiveFailures));
    }
    timer = setTimeout(poll, 900);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, running, reload, updateReview]);

  const recommendationContext = useMemo(() => {
    const recent = data && completedWorkouts(data.workouts, workoutTime(now), 5)
      .map((workout) => workout.exercises.map(({ exerciseId }) => exerciseId));
    return JSON.stringify([data?.equipment, recent, data?.catalog.map(({ id }) => id)]);
  }, [data?.equipment, data?.workouts, data?.catalog, now]);

  const catalog = data?.catalog;
  const archivedExercises = data?.archivedExercises;
  const exerciseRecords = useMemo(() => new Map(
    [...(catalog ?? []), ...(archivedExercises ?? [])].map((exercise) => [exercise.id, exercise]),
  ), [catalog, archivedExercises]);
  const value = useMemo(() => ({
    api, data, exerciseRecords, error, reload, mutate, transferClip, refreshAfterRestore, recommendationContext, startReview, cancelReview,
    notice: notice?.message ?? '', announce,
  }), [api, data, exerciseRecords, error, reload, mutate, transferClip, refreshAfterRestore, recommendationContext, startReview, cancelReview, notice, announce]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace provider is missing.');
  return value;
}
