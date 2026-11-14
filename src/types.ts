export type Exercise = {
  id: string;
  name: string;
  muscles: string[];
  equipment: string[];
  level: 'Beginner' | 'Intermediate';
  unit: 'reps' | 'seconds';
  description: string;
  cues: string[];
  demonstration: { videoId: string; creator: string };
};

export type WorkoutStatus = 'planned' | 'completed';

export type DumbbellLoad = { value: number; unit: 'kg' | 'lb' };
export type ExerciseSet = { reps: number; load?: DumbbellLoad };

export type Movement = {
  exerciseId: string;
  sets: number;
  reps: number;
  load?: DumbbellLoad;
  setDetails?: ExerciseSet[];
};

export type Workout = {
  id: string;
  name: string;
  date: string;
  time: string;
  status: WorkoutStatus;
  notes?: string;
  example?: true;
  revision?: number;
  exercises: Movement[];
};

export type TrainingSetDraft = { setNumber: number; reps: string; load: string; unit: DumbbellLoad['unit'] };

export type TrainingSession = {
  plan: Workout;
  logId: string;
  startedAt: number;
  sets: Record<string, ExerciseSet[]>;
  notes: string;
  restDeadline?: number | null;
  activeExercise?: string;
  setDrafts?: Record<string, TrainingSetDraft>;
  hold?: { exerciseId: string; setNumber: number; deadline: number };
};

export type FormFeedback = {
  verdict: 'observations' | 'no_clear_issue' | 'insufficient_visibility' | 'different_exercise';
  summary: string;
  limitations: string;
  observations: { timestamp: number; comparisonTimestamp?: number; kind: 'strength' | 'adjustment'; observation: string; cue: string }[];
  framesReviewed: number;
  version?: number;
  sequence?: number;
  startSeconds?: number;
  windowSeconds: number;
  reviewedAt: string;
};

export type Recommendation = { exerciseId: string; reason: string };

export type ReviewStatus =
  | { state: 'idle'; sequence: number }
  | { state: 'running' | 'complete' | 'cancelled'; sequence: number; startSeconds: number }
  | { state: 'failed'; sequence: number; startSeconds: number; error: string };

export type ClipReview = { review: FormFeedback | null; reviewStatus: ReviewStatus };

export type Clip = {
  id: string;
  exerciseId: string;
  filename: string;
  mime: string;
  size: number;
  uploadedAt: string;
} & ClipReview;

export type Snapshot = {
  equipment: string[] | null;
  bookmarks: string[];
  workouts: Workout[];
  clips: Clip[];
};

export type WorkoutDelta = { workouts: { upsert: Workout[]; remove: string[] } };
export type ClipDelta = { clips: { upsert: Clip[]; remove: string[] } };
export type WorkspaceChange = Snapshot | Pick<Snapshot, 'equipment'> | Pick<Snapshot, 'bookmarks'> | WorkoutDelta | ClipDelta;

export type Workspace = Snapshot & {
  workspaceKey?: string;
  catalog: Exercise[];
  muscles: string[];
  equipmentOptions: string[];
  aiAvailable: boolean;
  reviewVersion: number;
};

export type EquipmentMode = 'all' | 'saved' | 'bodyweight';

export type SelectedVideo = {
  name: string;
  mime: string;
  size: number;
  uri: string;
  read: () => Promise<Blob>;
  dispose: () => void;
};
