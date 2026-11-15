import { useRef } from 'react';
import { createId } from './api';
import type { Workout } from './types';
import { useWorkspace } from './workspace';

export function useSaveWorkout() {
  const { api, data, mutate } = useWorkspace();
  const pendingEdit = useRef<{ key: string; id: string } | null>(null);

  return async function saveWorkout(workout: Workout, existing: boolean, repeatWeeks?: number) {
    if (!existing || !workout.revision) return mutate(() => api.saveWorkout(workout, existing, repeatWeeks));
    const key = JSON.stringify([data?.workspaceKey, workout]);
    const edit = pendingEdit.current?.key === key ? pendingEdit.current : { key, id: createId() };
    pendingEdit.current = edit;
    await mutate(() => api.saveWorkout(workout, existing, repeatWeeks, edit.id));
    if (pendingEdit.current === edit) pendingEdit.current = null;
  };
}
