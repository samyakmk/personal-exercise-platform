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

export type Movement = {
  exerciseId: string;
  sets: number;
  reps: number;
};

export type Workout = {
  id: string;
  name: string;
  date: string;
  time: string;
  status: WorkoutStatus;
  exercises: Movement[];
};

export type Clip = {
  id: string;
  exerciseId: string;
  filename: string;
  mime: string;
  size: number;
  uploadedAt: string;
};

export type Snapshot = {
  equipment: string[] | null;
  workouts: Workout[];
  clips: Clip[];
};

export type Workspace = Snapshot & {
  catalog: Exercise[];
  muscles: string[];
  equipmentOptions: string[];
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
