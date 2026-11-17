import type { WorkoutDraft } from '../components/WorkoutEditor';
import { readSessionValue, removeSessionValue, writeSessionValue } from './sessionStorageMigration.web';

type DraftEntry = WorkoutDraft['entries'][number];

function hasSetFields(value: unknown): value is Pick<DraftEntry, 'reps' | 'load' | 'unit'> {
  if (!value || typeof value !== 'object') return false;
  const set = value as Partial<DraftEntry>;
  return typeof set.reps === 'string' && typeof set.load === 'string' && (set.unit === 'kg' || set.unit === 'lb');
}

function isEntry(entry: DraftEntry | null) {
  return entry && typeof entry.exerciseId === 'string' && typeof entry.sets === 'string' && hasSetFields(entry)
    && (entry.replacesExerciseId === undefined || typeof entry.replacesExerciseId === 'string')
    && (entry.notes === undefined || typeof entry.notes === 'string' && entry.notes.length <= 500)
    && (entry.details === undefined || Array.isArray(entry.details) && entry.details.length >= 1 && entry.details.length <= 30
      && entry.details.every((detail) => detail && typeof detail.id === 'string' && hasSetFields(detail)));
}

function suffix(workspace: string, kind: 'workout' | 'session') {
  return `${kind}-draft:` + workspace;
}

export function readWorkoutDraft(workspace: string, kind: 'workout' | 'session' = 'workout'): WorkoutDraft | null {
  try {
    const draft = JSON.parse(readSessionValue(suffix(workspace, kind)) ?? 'null') as WorkoutDraft | null;
    if (!draft || ![draft.id, draft.name, draft.day, draft.time].every((value) => typeof value === 'string')
      || !['planned', 'completed'].includes(draft.status) || !Array.isArray(draft.entries)
      || (draft.revision !== undefined && (!Number.isSafeInteger(draft.revision) || draft.revision < 1))
      || !draft.entries.every(isEntry) || (draft.notes !== undefined && typeof draft.notes !== 'string')
      || draft.effort != null && (!Number.isInteger(draft.effort) || draft.effort < 1 || draft.effort > 10)
      || draft.source !== undefined && !['manual', 'trainer', 'recommended'].includes(draft.source)
      || draft.suggestionSetup !== undefined && (!draft.suggestionSetup
        || ![10, 15, 20, 30, 45, 60].includes(draft.suggestionSetup.minutes)
        || (draft.suggestionSetup.equipment !== undefined
          && (!Array.isArray(draft.suggestionSetup.equipment) || draft.suggestionSetup.equipment.some((item) => typeof item !== 'string'))))
      || (draft.repeatWeeks !== undefined && (!Number.isInteger(draft.repeatWeeks) || draft.repeatWeeks < 1 || draft.repeatWeeks > 12))) return null;
    return draft;
  } catch {
    return null;
  }
}

export function writeWorkoutDraft(workspace: string, draft: WorkoutDraft, kind: 'workout' | 'session' = 'workout') {
  try { writeSessionValue(suffix(workspace, kind), JSON.stringify(draft)); } catch {}
}

export function removeWorkoutDraft(workspace: string, kind: 'workout' | 'session' = 'workout') {
  try { removeSessionValue(suffix(workspace, kind)); } catch {}
}
