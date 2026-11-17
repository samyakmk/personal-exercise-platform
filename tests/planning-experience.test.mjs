import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { catalog, recommend } from '../server/catalog.mjs';
import { suggestWorkout } from '../server/recommendations.mjs';
import { createStore } from '../server/store.mjs';
import { seriesWorkoutId } from '../server/workout-series.mjs';
import { estimatedWorkoutMinutes } from '../shared/workout-duration.mjs';

const sets = (exerciseId) => [{ exerciseId, sets: 3, reps: 8 }];

test('exercise aliases and canonical names outrank description matches while respecting equipment', () => {
  const find = (query, available = null) => recommend({ query, available, targets: [], detail: null, recent: new Map() });
  for (const [query, name] of [
    ['pushup', 'Push-Up'], ['pull-up', 'Pull-Up'], ['pullup', 'Pull-Up'], ['chinup', 'Chin-Up'],
    ['RDL', 'Dumbbell Romanian Deadlift'], ['db bench', 'Dumbbell Bench Press'], ['one-arm row', 'Single-Arm Dumbbell Row'],
  ]) assert.equal(find(query)[0]?.name, name, query);
  assert.ok(find('db press').some(({ id }) => id === 'dumbbell-shoulder-press'));
  assert.deepEqual(find('db bench', []), []);
});

test('date-specific suggestions honor nearby sessions, available gear, and the time budget', async () => {
  const current = { date: '2026-11-16', time: '12:00' };
  const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  const saved = { id: randomUUID(), name: 'Leg day', date: '2026-11-24', time: '12:00', status: 'planned',
    exercises: sets('bodyweight-squat') };
  const input = { current, scheduled: { date: '2026-11-25', time: '12:00' }, minutes: 5,
    available: [], history: new Map(), workouts: [saved] };
  const adjacent = await suggestWorkout(input);
  const openDay = await suggestWorkout({ ...input, scheduled: { date: '2026-11-30', time: '12:00' } });
  assert.ok(openDay.exercises.some(({ exerciseId }) => exerciseId === 'bodyweight-squat'));
  assert.ok(adjacent.exercises.length > 0);
  for (const { exerciseId } of adjacent.exercises) {
    assert.equal(byId.get(exerciseId).equipment.length, 0);
    assert.ok(!byId.get(exerciseId).primaryMuscles.includes('Quadriceps'));
  }
  assert.ok(estimatedWorkoutMinutes(adjacent.exercises, byId) <= 5);
  assert.deepEqual(input.workouts, [saved]);
});

test('series updates reject stale edits, preserve a skipped occurrence, and leave completed logs alone', (t) => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const browser = randomUUID();
  assert.equal(store.profiles.create(browser, 'series-test'), 'created');
  const workspace = store.profiles.active(browser);
  const seriesId = randomUUID();
  const series = Array.from({ length: 4 }, (_, index) => ({
    id: seriesWorkoutId(seriesId, index), date: `2026-11-${String(2 + index * 7).padStart(2, '0')}`,
    time: '12:00', name: 'Weekly strength', status: 'planned', exercises: sets('bodyweight-squat'),
  }));
  assert.equal(store.insertWorkoutSeries(workspace, series), true);
  const before = store.workouts(workspace);
  assert.deepEqual(before.map(({ seriesId: id, seriesIndex }) => [id, seriesIndex]), [0, 1, 2, 3].map((index) => [seriesId, index]));
  const [first, anchor, skip, last] = before;
  assert.equal(store.updateWorkout(workspace, first.id, { ...first, status: 'completed', skippedExerciseIds: ['push-up'] }, first.revision), 'saved');
  assert.equal(store.removeWorkout(workspace, skip.id, skip.revision).changes, 1);
  const expected = [anchor, last].map(({ id, revision }) => ({ id, revision }));
  const kept = { ...last, date: '2026-11-24' };
  assert.equal(store.updateWorkout(workspace, last.id, kept, last.revision), 'saved');
  const update = { ...anchor, date: '2026-11-10', time: '10:00', exercises: sets('push-up') };
  const operation = randomUUID();
  assert.deepEqual(store.updateWorkoutSeries(workspace, anchor.id, update, expected, operation), { error: 'conflict' });
  assert.equal(store.workoutChanges(workspace, [anchor.id]).upsert[0].date, anchor.date);
  expected[1].revision += 1;
  const saved = { ids: [anchor.id, last.id] };
  assert.deepEqual(store.updateWorkoutSeries(workspace, anchor.id, update, expected, operation), saved);
  assert.deepEqual(store.updateWorkoutSeries(workspace, anchor.id, update, expected, operation), saved);
  const after = store.workouts(workspace);
  assert.deepEqual(after.map(({ date, time, seriesIndex }) => [date, time, seriesIndex]), [
    ['2026-11-02', '12:00', 0], ['2026-11-10', '10:00', 1], ['2026-11-25', '10:00', 3],
  ]);
  assert.deepEqual(after[0].skippedExerciseIds, ['push-up']);
  const backup = JSON.parse(store.trainingBackup(workspace, { from: '2026-01-01', before: '2027-01-01', maxBytes: 100_000, maxWorkouts: 10 }));
  assert.deepEqual(backup.workouts.map(({ seriesId: id, seriesIndex }) => [id, seriesIndex]), [0, 1, 3].map((index) => [seriesId, index]));
  assert.deepEqual(backup.workouts[0].skippedExerciseIds, ['push-up']);
});
