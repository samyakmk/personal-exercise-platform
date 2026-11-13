import * as Crypto from 'expo-crypto';
import { dateKey } from './dates';
import type { EquipmentMode, Exercise, SelectedVideo, Snapshot, Workout, Workspace } from './types';

const origin = process.env.EXPO_PUBLIC_API_ORIGIN ?? '';

export function mediaUrl(path: string) {
  return origin + path;
}

export function createId() {
  return Crypto.randomUUID();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(mediaUrl('/api/' + path), { credentials: 'include', ...init });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error('Could not connect. Check your connection and try again.');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error ?? 'Something went wrong. Please try again.');
  }
  return response.json();
}

function json(method: string, data: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export const api = {
  workspace: () => request<Workspace>('workspace?today=' + dateKey()),
  exercises(targets: string[], mode: EquipmentMode, query: string, signal: AbortSignal) {
    const params = new URLSearchParams({ equipment: mode, q: query });
    targets.forEach((target) => params.append('muscle', target));
    return request<Exercise[]>('exercises?' + params.toString(), { signal });
  },
  setEquipment: (selected: string[] | null) => request<Snapshot>('equipment', json('PUT', { selected })),
  saveWorkout: (workout: Workout, existing: boolean) => request<Snapshot>(
    existing ? 'workouts/' + workout.id : 'workouts',
    json(existing ? 'PUT' : 'POST', workout),
  ),
  deleteWorkout: (id: string) => request<Snapshot>('workouts/' + id, { method: 'DELETE' }),
  async uploadClip(id: string, exercise: string, clip: SelectedVideo) {
    const body = await clip.read();
    return request<Snapshot>('clips/' + id + '?exercise=' + encodeURIComponent(exercise), {
      method: 'PUT',
      headers: { 'Content-Type': clip.mime, 'X-Clip-Name': encodeURIComponent(clip.name) },
      body,
    });
  },
  deleteClip: (id: string) => request<Snapshot>('clips/' + id, { method: 'DELETE' }),
  clipUrl: (id: string) => mediaUrl('/api/clips/' + id + '/video'),
};
