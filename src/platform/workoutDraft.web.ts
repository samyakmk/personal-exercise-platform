import type { WorkoutDraft } from '../components/WorkoutEditor';
import { readSessionValue, removeSessionValue } from './sessionStorageMigration.web';

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

function suffix(workspace: string, kind: 'workout' | 'session') {
  return `${kind}-draft:` + workspace;
}

export function readWorkoutDraft(workspace: string, kind: 'workout' | 'session' = 'workout'): WorkoutDraft | null {
  try {
    const storageSuffix = suffix(workspace, kind);
    const draft = JSON.parse(readSessionValue('liftmorrow-' + storageSuffix, storageSuffix) ?? 'null') as WorkoutDraft | null;
    if (!draft || ![draft.id, draft.name, draft.day, draft.time].every((value) => typeof value === 'string')
      || !['planned', 'completed'].includes(draft.status) || !Array.isArray(draft.entries)
      || (draft.revision !== undefined && (!Number.isSafeInteger(draft.revision) || draft.revision < 1))
      || !draft.entries.every(isEntry) || (draft.notes !== undefined && typeof draft.notes !== 'string')
      || (draft.repeatWeeks !== undefined && (!Number.isInteger(draft.repeatWeeks) || draft.repeatWeeks < 1 || draft.repeatWeeks > 12))) return null;
    return draft;
  } catch {
    return null;
  }
}

export function writeWorkoutDraft(workspace: string, draft: WorkoutDraft, kind: 'workout' | 'session' = 'workout') {
  try { sessionStorage.setItem('liftmorrow-' + suffix(workspace, kind), JSON.stringify(draft)); } catch {}
}

export function removeWorkoutDraft(workspace: string, kind: 'workout' | 'session' = 'workout') {
  try {
    const storageSuffix = suffix(workspace, kind);
    removeSessionValue('liftmorrow-' + storageSuffix, storageSuffix);
  } catch {}
}
