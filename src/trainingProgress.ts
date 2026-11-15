import { addDays, compareWorkoutTime, weekStart, workoutTime } from './dates';
import type { Exercise, ExerciseSet, Movement, TrainingSession, Workout } from './types';

export type ExerciseLog = { workout: Workout; movement: Movement };

export function trainingLog(session: TrainingSession, separate: boolean): Workout {
  const when = session.logTime ?? workoutTime(new Date(session.startedAt));
  return {
    ...when, id: separate ? session.logId : session.plan.id,
    revision: separate ? undefined : session.plan.revision,
    name: session.plan.name, status: 'completed', notes: session.notes.trim(), effort: session.effort, source: session.plan.source,
    exercises: session.plan.exercises.flatMap(({ exerciseId, notes: plannedNotes }) => {
      const notes = (session.exerciseNotes?.[exerciseId] ?? plannedNotes)?.trim();
      const setDetails = session.sets[exerciseId] ?? [];
      return setDetails.length || session.logTime || notes ? [{ exerciseId, ...setDetails[0], sets: setDetails.length, setDetails, ...(notes && { notes }) }] : [];
    }),
  };
}

export function isSavedTrainingLog(session: TrainingSession, workout: Workout) {
  if (workout.id === session.logId) return true;
  if (workout.id !== session.plan.id || workout.status !== 'completed' || workout.revision !== (session.plan.revision ?? 0) + 1) return false;
  const log = trainingLog(session, false);
  return workout.name === log.name && workout.date === log.date && workout.time === log.time && (workout.notes ?? '') === log.notes
    && (workout.effort ?? null) === (log.effort ?? null) && workout.source === log.source
    && workout.exercises.length === log.exercises.length && workout.exercises.every((movement, index) => {
      const match = log.exercises[index];
      return movement.exerciseId === match.exerciseId && movement.notes === match.notes && movement.setDetails?.length === match.setDetails?.length
        && movement.setDetails?.every(({ reps, load }, set) => {
          const expected = match.setDetails?.[set];
          return reps === expected?.reps && load?.unit === expected?.load?.unit && load?.value === expected?.load?.value;
        });
    });
}

export function completedWorkouts(workouts: Workout[], current: Pick<Workout, 'date' | 'time'>, limit = Infinity) {
  // The API and workspace deltas keep workouts sorted by date, time, and ID.
  const completed: Workout[] = [];
  for (let index = workouts.length - 1; index >= 0 && completed.length < limit; index -= 1) {
    const workout = workouts[index];
    if (workout.status === 'completed' && !workout.example && compareWorkoutTime(workout, current) <= 0) completed.push(workout);
  }
  return completed;
}

export function exerciseLogs(workouts: Workout[], exerciseId: string): ExerciseLog[] {
  return workouts.flatMap((workout) => {
    const movement = workout.exercises.find((item) => item.exerciseId === exerciseId);
    return movement ? [{ workout, movement }] : [];
  });
}

export function weeklyActivity(workouts: Workout[], today: string, weeks: number) {
  const monday = weekStart(today);
  const first = addDays(monday, (1 - weeks) * 7);
  const counts = new Map<string, number>();
  for (const workout of workouts) {
    if (workout.date < first) continue;
    const start = weekStart(workout.date);
    counts.set(start, (counts.get(start) ?? 0) + 1);
  }
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(first, index * 7);
    return { start, sessions: counts.get(start) ?? 0 };
  });
}

export function movementSummary(exercise: Pick<Exercise, 'unit'>, { sets, reps, load, setDetails }: Movement) {
  if (setDetails) {
    const label = `${sets} ${sets === 1 ? 'set' : 'sets'}`;
    const counts = setDetails.flatMap(({ reps }) => reps === undefined ? [] : [reps]);
    if (!counts.length) return label;
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const range = min === max ? String(min) : `${min}–${max}`;
    return `${label} · ${range} ${exercise.unit === 'seconds' ? 'sec' : max === 1 ? 'rep' : 'reps'}`;
  }
  return `${sets} × ${reps} ${exercise.unit === 'seconds' ? 'sec' : reps === 1 ? 'rep' : 'reps'}${load ? ` · ${load.value} ${load.unit}` : ''}`;
}

export function performedSetSummary(exercise: Pick<Exercise, 'unit' | 'loadType'> | undefined, { reps, load }: ExerciseSet) {
  const unit = exercise?.unit === 'seconds' ? 'sec' : reps === 1 ? 'rep' : 'reps';
  const loadUnit = exercise?.loadType === 'per-dumbbell' ? ' per dumbbell' : '';
  return [reps === undefined ? '' : `${reps} ${unit}`, load ? `${load.value} ${load.unit}${loadUnit}` : ''].filter(Boolean).join(' · ');
}

export function heaviestLoad(logs: ExerciseLog[]) {
  return logs.reduce<Movement['load']>((best, { movement }) => heavierLoad(best, movementLoad(movement)), undefined);
}

function movementLoad(movement: Movement) {
  return (movement.setDetails ?? [movement]).reduce<Movement['load']>((best, { load }) => heavierLoad(best, load), undefined);
}

function heavierLoad(a: Movement['load'], b: Movement['load']) {
  if (!a || !b) return a ?? b;
  return loadIn(a, 'kg') >= loadIn(b, 'kg') ? a : b;
}

function loadIn(load: NonNullable<Movement['load']>, unit: 'kg' | 'lb') {
  if (load.unit === unit) return load.value;
  return unit === 'kg' ? load.value * 0.45359237 : load.value / 0.45359237;
}

export type ExerciseTrend = { workout: Workout; value: number };

export function exerciseTrend(logs: ExerciseLog[], exercise: Pick<Exercise, 'unit' | 'loadType'>) {
  const recent = logs.slice(0, 8).reverse();
  const loads = recent.map(({ movement }) => movementLoad(movement));
  const weighed = loads.filter((load) => load !== undefined);
  const unit = weighed.at(-1)?.unit;
  if (unit && weighed.length >= 2) {
    const weight = exercise.loadType === 'per-dumbbell' ? 'dumbbell' : 'weight';
    return {
      measurement: `Heaviest ${weight} (${unit})`, unit,
      points: recent.flatMap(({ workout }, index) => {
        const load = loads[index];
        return load ? [{ workout, value: loadIn(load, unit) }] : [];
      }),
    };
  }
  const timed = exercise.unit === 'seconds';
  return {
    measurement: timed ? 'Total hold time' : 'Total reps', unit: timed ? 'sec' : 'reps',
    points: recent.flatMap(({ workout, movement }) => {
      const counts = (movement.setDetails ?? [movement]).map(({ reps }) => reps);
      if (!counts.length || counts.some((reps) => reps === undefined)) return [];
      const total = counts.reduce<number>((sum, reps) => sum + (reps ?? 0), 0);
      return [{ workout, value: movement.setDetails ? total : total * movement.sets }];
    }),
  };
}
