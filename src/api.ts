import * as Crypto from 'expo-crypto';
import { dateKey, workoutTime } from './dates';
import { uploadVideo } from './platform/uploadVideo';
import type { ProfileArchiveSummary, ProfileSetupInput, ReviewRange } from './types';
import type { ChatAnswer, ChatMessage, HistoryLookup, HistoryResult, TrainingNoteInput, TrainingNotesChange, TrainingSessionMovementContext } from './types';
import type { CheckInState, CheckInInput, Clip, ClipReview, Exercise, ExerciseFilters, ExerciseRefinement, FormFeedback, ProfileEdit, ProfileRevision, ProfileState, Recommendation, SelectedVideo, SessionCoachQuestion, Snapshot, Workout, WorkoutDelta, WorkoutSuggestion, Workspace, WorkspaceChange } from './types';

const origin = process.env.EXPO_PUBLIC_API_ORIGIN ?? '';

export function mediaUrl(path: string) {
  return origin + path;
}

export function createId() {
  return Crypto.randomUUID();
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
  }
}

async function requestWithResponse<T>(path: string, init?: RequestInit, timeout = 15_000, allowNotModified = false): Promise<{
  data: T; headers: Headers;
} | { data: null; headers: Headers }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  let response: Response;
  try {
    response = await fetch(mediaUrl('/api/' + path), { credentials: 'include', ...init, signal: controller.signal });
    if (allowNotModified && response.status === 304) return { data: null, headers: response.headers };
    const result = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return null;
    });
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'));
      throw new RequestError(typeof result?.error === 'string' ? result.error : 'Something went wrong. Please try again.',
        response.status, Number.isSafeInteger(retry) && retry > 0 ? retry : undefined);
    }
    if (result === null) throw new RequestError('Trainer Plus received an unreadable response. Try again.', 502);
    return { data: result, headers: response.headers };
  } catch (error) {
    if (init?.signal?.aborted || error instanceof RequestError) throw error;
    if (controller.signal.aborted) throw new RequestError('The request took too long. Try again.', 408);
    throw new Error('Could not connect. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener('abort', abort);
  }
}

async function request<T>(path: string, init?: RequestInit, timeout?: number): Promise<T> {
  const { data } = await requestWithResponse<T>(path, init, timeout);
  if (data === null) throw new RequestError('Trainer Plus received an unreadable response. Try again.', 502);
  return data;
}

function json(method: string, data: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

function exerciseParams({ targets, detail, mode, query, level, category }: ExerciseFilters) {
  const now = workoutTime();
  const params = new URLSearchParams({ equipment: mode, q: query, today: now.date, now: now.time });
  targets.forEach((target) => params.append('muscle', target));
  if (detail) params.set('detail', detail);
  if (level) params.set('level', level);
  if (category) params.set('category', category);
  return params.toString();
}

function forProfile(workspaceKey: string, init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('X-Trainer-Plus-Profile', workspaceKey);
  return { ...init, headers };
}

export const profilesApi = {
  state: () => request<ProfileState>('profiles'),
  create: (username: string) => request<ProfileState>('profiles', json('POST', { username, setup: true })),
  signIn: (username: string) => request<ProfileState>('profiles/login', json('POST', { username })),
  signOut: (key: string) => request<ProfileState>('profiles/logout', forProfile(key, { method: 'POST' })),
  save: (key: string, details: ProfileEdit) => request<ProfileState>('profiles/current', forProfile(key, json('PUT', details))),
  completeSetup: (key: string, details: ProfileSetupInput) => request<ProfileState>('profiles/setup', forProfile(key, json('POST', details))),
  delete: (key: string) => request<ProfileState>('profiles/current', forProfile(key, { method: 'DELETE' })),
};

export function createWorkspaceApi(workspaceKey: string) {
  const scoped = <T>(path: string, init?: RequestInit, timeout?: number) =>
    request<T>(path, forProfile(workspaceKey, init), timeout);
  const scopedResponse = <T>(path: string, init?: RequestInit, timeout?: number, allowNotModified?: boolean) =>
    requestWithResponse<T>(path, forProfile(workspaceKey, init), timeout, allowNotModified);
  // Media elements and downloads use URLs rather than fetch headers.
  const profileUrl = (path: string) => mediaUrl(path + (path.includes('?') ? '&' : '?') + 'profile=' + workspaceKey);

  return {
    async workspace(etag?: string) {
      const headers = new Headers({ 'X-Trainer-Plus-Catalog': 'defer' });
      if (etag) headers.set('If-None-Match', etag);
      const { data, headers: responseHeaders } = await scopedResponse<Workspace>(
        'workspace', { headers }, undefined, Boolean(etag),
      );
      return { workspace: data, etag: responseHeaders.get('ETag') ?? undefined };
    },
    exerciseCatalog: (signal: AbortSignal) => scoped<Required<Pick<Workspace, 'catalog' | 'archivedExercises' | 'catalogVersion'>>>('exercise-catalog', { signal }),
    profileHistory: (signal: AbortSignal) => scoped<ProfileRevision[]>('companion/profile-history', { signal }),
    profileArchiveUrl: (media: string) => profileUrl('/api/workspace/profile-archive?' + new URLSearchParams({ media })),
    restoreProfileArchive: (mode: 'preview' | 'restore', body: BodyInit) => scoped<{ records: ProfileArchiveSummary }>(
      'workspace/profile-archive?' + new URLSearchParams({ mode }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, 100_000,
    ),
    historyLookup(query: HistoryLookup, signal: AbortSignal) {
      const { date, time } = workoutTime();
      return scoped<HistoryResult>('history-lookup?' + new URLSearchParams({ today: date, now: time }),
        { ...json('POST', query), signal });
    },
    chat(message: string, history: ChatMessage[], signal: AbortSignal) {
      const { date, time } = workoutTime();
      return scoped<ChatAnswer>('chat?' + new URLSearchParams({ today: date, now: time }),
        { ...json('POST', { message, history }), signal }, 53_000);
    },
    saveTrainingNote: (id: string, note: TrainingNoteInput) => scoped<TrainingNotesChange>('training-notes/' + id, json('PUT', note)),
    removeTrainingNote: (id: string) => scoped<TrainingNotesChange>('training-notes/' + id, { method: 'DELETE' }),
    checkIns: (day: string, signal: AbortSignal) => scoped<CheckInState>('companion?day=' + day, { signal }),
    saveCheckIn: (day: string, entry: CheckInInput) => scoped<CheckInState>('companion?day=' + day, json('POST', entry)),
    removeCheckIn: (day: string, id: string) => scoped<CheckInState>('companion/' + id + '?day=' + day, { method: 'DELETE' }),
    sessionCoach: (question: SessionCoachQuestion, signal: AbortSignal) => scoped<{ reply: string }>(
      'session-coach', { ...json('POST', question), signal }, 50_000,
    ),
    addExampleWorkouts: () => scoped<Snapshot>('workspace/example-workouts', json('POST', { today: dateKey() })),
    removeExampleWorkouts: () => scoped<Snapshot>('workspace/example-workouts', { method: 'DELETE' }),
    trainingBackupUrl(from = '', before = '') {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (before) params.set('before', before);
      return profileUrl('/api/workspace/training-backup' + (params.size ? '?' + params : ''));
    },
    restoreTrainingBackup: (contents: string) => scoped<{ restore: { added: number; skipped: number; equipmentImported: boolean; savedExercises: number } }>(
      'workspace/training-backup?response=summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: contents }, 35_000,
    ),
    exercises(filters: ExerciseFilters, signal: AbortSignal) {
      return scoped<Exercise[]>('exercises?' + exerciseParams(filters), { signal });
    },
    recommendations: (filters: ExerciseFilters, signal: AbortSignal, refinement?: ExerciseRefinement) => (
      scoped<Recommendation[]>('exercises/recommendations?' + exerciseParams(filters),
        { ...(refinement ? json('POST', refinement) : { method: 'POST' }), signal }, 55_000)
    ),
    workoutRecommendation(context: import('./types').WorkoutSuggestionContext, signal: AbortSignal) {
      const { date, time } = workoutTime();
      const params = new URLSearchParams({ today: date, now: time, date: context.date, time: context.time, minutes: String(context.minutes) });
      if (context.equipment) {
        params.set('gearOverride', '1');
        for (const item of context.equipment) params.append('gear', item);
      }
      return scoped<WorkoutSuggestion>('workouts/recommendation?' + params, { method: 'POST', signal }, 55_000);
    },
    startClipReview: (id: string, { startSeconds, endSeconds }: ReviewRange, refresh = false) => scoped<ClipReview>(
      'clips/' + id + '/review?background=1' + (startSeconds ? '&start=' + startSeconds : '')
        + (endSeconds === undefined ? '' : '&end=' + endSeconds) + (refresh ? '&refresh=1' : ''),
      { method: 'POST' },
    ),
    clipReview: (id: string, signal: AbortSignal) => scoped<ClipReview>('clips/' + id + '/review', { signal }),
    clipReviewHistory: (id: string, signal: AbortSignal) => scoped<{ reviews: FormFeedback[] }>('clips/' + id + '/reviews', { signal }),
    cancelClipReview: (id: string, sequence: number) => scoped<ClipReview>(
      'clips/' + id + '/review?sequence=' + sequence, { method: 'DELETE' },
    ),
    changeClipExercise: (id: string, exerciseId: string, previousExerciseId: string) => scoped<WorkspaceChange>(
      'clips/' + id + '/exercise?response=delta', json('PUT', { exerciseId, previousExerciseId }),
    ),
    setEquipment: (selected: string[] | null) => scoped<WorkspaceChange>('equipment?response=delta', json('PUT', { selected })),
    setExerciseBookmark: (id: string, saved: boolean) => scoped<WorkspaceChange>(
      'exercises/' + id + '/bookmark?response=delta', { method: saved ? 'PUT' : 'DELETE' },
    ),
    saveWorkout: (workout: Workout, existing: boolean, repeatWeeks?: number, operationId?: string) => scoped<WorkoutDelta>(
      (existing ? 'workouts/' + workout.id : 'workouts') + '?response=delta',
      json(existing ? 'PUT' : 'POST', { ...workout, ...(repeatWeeks && repeatWeeks > 1 && { repeatWeeks }), ...(operationId && { operationId }) }),
    ),
    saveWorkoutSeries: (workout: Workout, expected: { id: string; revision: number }[], operationId: string) => scoped<WorkoutDelta>(
      'workouts/' + workout.id + '/series?response=delta', json('PUT', { ...workout, expected, operationId }),
    ),
    deleteWorkout: (id: string, revision?: number) => scoped<WorkspaceChange>(
      'workouts/' + id + '?response=delta' + (revision ? '&revision=' + revision : ''), { method: 'DELETE' },
    ),
    workoutCalendarUrl: (id?: string) => profileUrl('/api/workouts/calendar.ics' + (id ? '?workout=' + id : '')),
    workoutHistoryUrl: () => profileUrl('/api/workouts/history.csv?feedback=1'),
    async uploadClip(id: string, exercise: string, clip: SelectedVideo, signal: AbortSignal, onProgress: (fraction: number) => void,
      trainingContext?: TrainingSessionMovementContext) {
      const body = await clip.read();
      const query = new URLSearchParams();
      if (exercise) query.set('exercise', exercise);
      if (trainingContext) query.set('trainingContext', JSON.stringify(trainingContext));
      query.set('response', 'delta');
      query.set('protectDeleted', '1');
      const url = profileUrl('/api/clips/' + id + '?' + query);
      const { status, data } = await uploadVideo({ url, body, mime: clip.mime, name: clip.name, signal, onProgress });
      if (status < 200 || status >= 300) {
        const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
        throw new RequestError(typeof error === 'string' ? error : 'The video could not be saved. Try again.', status);
      }
      if (!data) throw new RequestError('Trainer Plus received an unreadable response. Try again.', 502);
    },
    deleteClip: (id: string) => scoped<WorkspaceChange>('clips/' + id + '?response=delta', { method: 'DELETE' }),
    clip: (id: string, signal: AbortSignal) => scoped<Clip>('clips/' + id, { signal }),
    clipUrl: (id: string) => profileUrl('/api/clips/' + id + '/video'),
    reviewStillUrl: (id: string, sequence: number) => profileUrl('/api/clips/' + id + '/review-still?sequence=' + sequence),
    clipDownloadUrl: (id: string) => profileUrl('/api/clips/' + id + '/video?download=1'),
  };
}
