import type { WorkoutDraft } from '../components/WorkoutEditor';

type DraftEntry = WorkoutDraft['entries'][number];

function hasSetFields(value: unknown): value is Pick<DraftEntry, 'reps' | 'load' | 'unit'> {
  if (!value || typeof value !== 'object') return false;
  const set = value as Partial<DraftEntry>;
  return typeof set.reps === 'string' && typeof set.load === 'string' && (set.unit === 'kg' || set.unit === 'lb');
}

function isEntry(entry: DraftEntry | null) {
  return entry && typeof entry.exerciseId === 'string' && typeof entry.sets === 'string' && hasSetFields(entry)
    && (entry.details === undefined || Array.isArray(entry.details) && entry.details.length >= 1 && entry.details.length <= 30
      && entry.details.every((detail) => detail && typeof detail.id === 'string' && hasSetFields(detail)));
}

function key(workspace: string) {
  return 'repform-workout-draft:' + workspace;
}

export function readWorkoutDraft(workspace: string): WorkoutDraft | null {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key(workspace)) ?? 'null') as WorkoutDraft | null;
    if (!draft || ![draft.id, draft.name, draft.day, draft.time].every((value) => typeof value === 'string')
      || !['planned', 'completed'].includes(draft.status) || !Array.isArray(draft.entries)
      || !draft.entries.every(isEntry) || (draft.notes !== undefined && typeof draft.notes !== 'string')
      || (draft.repeatWeeks !== undefined && (!Number.isInteger(draft.repeatWeeks) || draft.repeatWeeks < 1 || draft.repeatWeeks > 12))) return null;
    return draft;
  } catch {
    return null;
  }
}

export function writeWorkoutDraft(workspace: string, draft: WorkoutDraft) {
  try { sessionStorage.setItem(key(workspace), JSON.stringify(draft)); } catch {}
}

export function removeWorkoutDraft(workspace: string) {
  try { sessionStorage.removeItem(key(workspace)); } catch {}
}
