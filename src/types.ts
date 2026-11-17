export type TrainerInstruction = {
  id: string;
  exerciseId: string;
  kind: 'cue' | 'prefer' | 'avoid';
  text: string;
};

export type TrainingPreferences = {
  intake: 'completed' | 'skipped';
  trainerNotes: string;
  experience: 'new' | 'regular' | '';
  priorities: string[];
  preferred: string[];
  excluded: string[];
  instructions?: TrainerInstruction[];
};
export type ProfileDetails = { displayName?: string; trainingGoal?: string; trainingPreferences?: TrainingPreferences };
export type ProfileEdit = Required<Pick<ProfileDetails, 'displayName' | 'trainingGoal'>> & Pick<ProfileDetails, 'trainingPreferences'>;
export type ProfileSetupInput = ProfileEdit & { equipment?: string[] | null };
export type ProfileRevision = { id: number; savedAt: string; details: ProfileDetails };
export type CheckInChoice = 'easier' | 'rest' | 'usual';
export type TrainingCheckIn = {
  id: string;
  day: string;
  text: string;
  adjustment?: CheckInChoice;
  reply?: string;
  savedAt: string;
};
export type CheckInState = { entries: TrainingCheckIn[]; day: string; adjustment: CheckInChoice | null };
export type CheckInInput = Pick<TrainingCheckIn, 'id' | 'text' | 'adjustment'> & { time: string; wantsReply: boolean };
export type ProfileSummary = { username: string; workspaceKey: string };
export type Profile = ProfileSummary & { details: ProfileDetails; setupPending?: true };
export type ProfileState = { active: Profile | null; profiles: ProfileSummary[]; canImportLegacy: boolean;
  google?: { clientId: string; expiresAt: number | null };
};
export type ProfileArchiveSummary = Record<'profile' | 'revisions' | 'equipment' | 'bookmarks' | 'workouts' |
  'trainingNotes' | 'checkIns' | 'clips' | 'videos', { add: number; same: number; conflict: number }>;
export type TrainingNoteInput = {
  text: string;
  kind: 'context' | 'prefer' | 'avoid' | 'shorter';
  exerciseId: string | null;
};
export type TrainingNote = TrainingNoteInput & { id: string; savedAt: string };
export type ChatMessage = { role: 'user' | 'assistant'; text: string };
export type ChatAnswer = { reply: string; note?: TrainingNoteInput };

export type ExerciseDemonstration = {
  videoId: string;
  creator: string;
  provider?: 'youtube' | 'vimeo';
  source?: string;
  thumbnailUrl?: string;
};

export type Exercise = {
  id: string;
  name: string;
  muscles: string[];
  equipment: string[];
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  unit: 'reps' | 'seconds';
  description: string;
  cues: string[];
  category: string;
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  demonstration?: ExerciseDemonstration;
  technique?: { do: string; avoid: string };
  loadType?: 'per-dumbbell' | 'weight';
};

export type WorkoutStatus = 'planned' | 'completed';
export type WorkoutSource = 'manual' | 'trainer' | 'recommended';

export type ExerciseLoad = { value: number; unit: 'kg' | 'lb' };
export type ExerciseSet = { reps?: number; load?: ExerciseLoad };

export type Movement = {
  exerciseId: string;
  replacesExerciseId?: string;
  sets: number;
  reps?: number;
  load?: ExerciseLoad;
  setDetails?: ExerciseSet[];
  notes?: string;
};

export type Workout = {
  id: string;
  name: string;
  date: string;
  time: string;
  status: WorkoutStatus;
  notes?: string;
  effort?: number | null;
  source?: WorkoutSource;
  example?: true;
  revision?: number;
  seriesId?: string;
  seriesIndex?: number;
  skippedExerciseIds?: string[];
  exercises: Movement[];
};

export type TrainingSetDraft = { setNumber: number; reps: string; load: string; unit: ExerciseLoad['unit'] };

export type TrainingSessionMovementContext = {
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  workoutId?: string;
};

export type FormCue = {
  exerciseId: string;
  text: string;
  clipId: string;
  startSeconds: number;
  timestamp: number;
};

export type SessionCoachState = {
  stage: 'setup' | 'set' | 'rest';
  restUntil?: number;
  skipped?: string[];
};

export type SessionCoachQuestion = {
  exerciseId: string;
  phase: SessionCoachState['stage'] | 'complete';
  setNumber: number;
  target?: ExerciseSet;
  question: string;
};

export type TrainingSession = {
  plan: Workout;
  logId: string;
  startedAt: number;
  adHoc?: true;
  logTime?: Pick<Workout, 'date' | 'time'>;
  suggestedExercise?: string;
  sets: Record<string, ExerciseSet[]>;
  notes: string;
  effort?: number | null;
  exerciseNotes?: Record<string, string>;
  restDeadline?: number | null;
  restSeconds?: number;
  coach?: SessionCoachState;
  formCue?: FormCue;
  skippedExerciseIds?: string[];
  activeExercise?: string;
  setDrafts?: Record<string, TrainingSetDraft>;
  hold?: { exerciseId: string; setNumber: number; deadline: number };
};

export type PendingTrainingLog = { session: TrainingSession; separate: boolean };

export type HistoryLookup = { kind: 'week'; week: 'this' | 'last' }
  | { kind: 'weight'; weight: 'latest' | 'heaviest'; exerciseId: string };

export type HistoryResult = { reply: string; sources: Pick<Workout, 'id' | 'name' | 'date' | 'time'>[]; week?: string };

export type ReviewRange = { startSeconds: number; endSeconds?: number };

export type FormFeedback = {
  verdict: 'observations' | 'no_clear_issue' | 'insufficient_visibility' | 'different_exercise';
  summary: string;
  limitations: string;
  observations: { timestamp: number; comparisonTimestamp?: number; kind: 'strength' | 'adjustment'; observation: string; cue: string }[];
  observationFrame?: { reference?: { path: string; phase: string; source: string; credit: string; time?: number } };
  framesReviewed: number;
  version?: number;
  sequence?: number;
  startSeconds?: number;
  endSeconds?: number;
  windowSeconds: number;
  reviewedAt: string;
  detectedExerciseId?: string;
  coverage?: { source: 'measured' | 'visual' | 'combined'; assessed: string[]; limits: string[]; next?: string };
  modelConfiguration?: { critique: string; detection: string; reference: string };
};

export type Recommendation = { exerciseId: string; reason: string };
export type Refinement = 'easier' | 'harder' | 'shorter' | 'longer';
export type ExerciseRefinement = { adjustment: Refinement; previous: string[] };
export type WorkoutSuggestion = Pick<Workout, 'name' | 'exercises'> & { source: 'ai' | 'catalog' };
export type WorkoutSuggestionContext = Pick<Workout, 'date' | 'time'> & { minutes: number; equipment?: string[] };

export type ReviewStatus =
  | { state: 'idle'; sequence: number }
  | ({ state: 'running' | 'complete' | 'cancelled'; sequence: number } & ReviewRange)
  | ({ state: 'failed'; sequence: number; error: string } & ReviewRange);

export type ClipReview = { review: FormFeedback | null; reviewStatus: ReviewStatus };

export type Clip = {
  id: string;
  exerciseId: string;
  filename: string;
  mime: string;
  size: number;
  uploadedAt: string;
  trainingContext?: TrainingSessionMovementContext;
} & ClipReview;

export type Snapshot = {
  equipment: string[] | null;
  bookmarks: string[];
  workouts: Workout[];
  clips: Clip[];
};

export type WorkoutDelta = { workouts: { upsert: Workout[]; remove: string[] } };
export type ClipDelta = { clips: { upsert: Clip[]; remove: string[] } };
export type TrainingNotesChange = { trainingNotes: TrainingNote[] };
export type WorkspaceChange = Snapshot | Pick<Snapshot, 'equipment'> | Pick<Snapshot, 'bookmarks'> | WorkoutDelta | ClipDelta | TrainingNotesChange;

export type Workspace = Snapshot & TrainingNotesChange & {
  workspaceKey?: string;
  catalog: Exercise[];
  catalogVersion?: string;
  archivedExercises?: Exercise[];
  muscles: string[];
  equipmentOptions: string[];
  exerciseCategories?: string[];
  aiAvailable: boolean;
  reviewVersion: number;
};

export type EquipmentMode = 'all' | 'saved' | 'bodyweight';

export type ExerciseFilters = {
  targets: string[];
  detail: string | null;
  mode: EquipmentMode;
  query: string;
  level: Exercise['level'] | null;
  category: string | null;
};

export type SelectedVideo = {
  name: string;
  mime: string;
  size: number;
  uri: string;
  recorded?: boolean;
  read: () => Promise<Blob>;
  dispose: () => void;
};
