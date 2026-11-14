import type { WorkoutDraft } from '../components/WorkoutEditor';

export function readWorkoutDraft(_workspace: string, _kind?: 'workout' | 'session'): WorkoutDraft | null { return null; }
export function writeWorkoutDraft(_workspace: string, _draft: WorkoutDraft, _kind?: 'workout' | 'session') {}
export function removeWorkoutDraft(_workspace: string, _kind?: 'workout' | 'session') {}
