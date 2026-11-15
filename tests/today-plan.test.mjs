import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalog } from '../server/catalog.mjs';
import { buildTodayPlan, checkInReply } from '../shared/today-plan.mjs';
import { loggedMuscleWork } from '../shared/muscle-work.mjs';

const current = { date: '2026-11-15', time: '08:00' };
const lookup = new Map(catalog.map((exercise) => [exercise.id, exercise]));
const movement = (exerciseId, sets = 3, reps = 9) => ({ exerciseId, sets, reps });
const session = (changes = {}) => ({
  id: '1', name: 'Strength log', status: 'completed', date: '2026-11-14', time: '12:00', exercises: [movement('bodyweight-squat')], ...changes,
});
const plan = (changes = {}) => buildTodayPlan({ current, catalog, equipment: [], workouts: [], ...changes });

test('no setup is needed and incomplete, sample, and future records cannot change the suggestion', () => {
  const starting = plan();
  assert.equal(starting.kind, 'train');
  assert.ok(starting.exercises.length >= 3);
  assert.ok(starting.exercises.every(({ exerciseId, sets, load }) => !lookup.get(exerciseId).equipment.length && sets <= 2 && !load));
  assert.deepEqual(plan({ workouts: [
    session({ status: 'planned' }), session({ example: true }), session({ date: current.date, time: '12:00' }),
    session({ exercises: [{ exerciseId: 'bodyweight-squat', sets: 0, setDetails: [], notes: 'Skipped' }] }),
  ] }), starting);
});

test('trainer days, accumulated work and check-ins can lighten the plan or offer rest', () => {
  const yesterday = session({ source: 'trainer', effort: 8 });
  const next = plan({ workouts: [yesterday] });
  assert.equal(next.kind, 'train');
  assert.ok(next.exercises.every(({ exerciseId, sets }) => sets === 1 && !lookup.get(exerciseId).primaryMuscles.includes('Quadriceps')));
  assert.equal(plan({ workouts: [{ ...yesterday, effort: 9 }] }).kind, 'rest');
  assert.equal(plan({ workouts: [session({ ...current })] }).kind, 'rest');
  assert.equal(plan({ adjustment: 'rest' }).kind, 'rest');
  assert.ok(plan({ adjustment: 'easier' }).exercises.every(({ sets }) => sets === 1));
  assert.deepEqual(plan({ adjustment: 'usual' }), plan());
});

test('gear, priorities, preferences and exclusions change the lineup without guessing weights', () => {
  const preferences = { priorities: ['Biceps'], preferred: ['dumbbell-curl'], excluded: ['bodyweight-squat'] };
  const withGear = plan({ preferences, equipment: ['Dumbbells'] });
  assert.equal(withGear.exercises[0].exerciseId, 'dumbbell-curl');
  assert.ok(withGear.exercises.every(({ exerciseId, load }) => exerciseId !== 'bodyweight-squat' && !load));
  assert.ok(!plan({ preferences }).exercises.some(({ exerciseId }) => exerciseId === 'dumbbell-curl'));
  assert.equal(plan({ preferences: { excluded: catalog.map(({ id }) => id) } }).kind, 'rest');
});

test('familiar targets use actual effort, move by at most one rep, and need a logged performance', () => {
  const workout = session({ date: '2026-11-11', exercises: [movement('dumbbell-curl')] });
  const suggest = (effort) => plan({
    equipment: ['Dumbbells'], preferences: { priorities: ['Biceps'], preferred: ['dumbbell-curl'] },
    workouts: [{ ...workout, effort }],
  }).exercises.find(({ exerciseId }) => exerciseId === 'dumbbell-curl');
  assert.equal(suggest(undefined).reps, 9);
  assert.equal(suggest(3).reps, 10);
  assert.equal(suggest(8).reps, 8);
  assert.equal(suggest(8).sets, 1);
});

test('replies use the same plan and distinguish a safety cue from a coaching preference', () => {
  const names = new Map(catalog.map(({ id, name }) => [id, name]));
  assert.match(checkInReply('What is my plan?', plan({ adjustment: 'rest' }), names), /recover/);
  assert.match(checkInReply('What does RPE mean?', plan(), names), /1 means very easy/);
  assert.match(checkInReply('My coach would prefer I skip that exercise.', plan(), names), /excluded/);
  assert.match(checkInReply('I felt pain', plan(), names), /stop and check/);
});

test('muscle exposure increases within a session, resets between sessions and responds to effort', () => {
  const squats = movement('bodyweight-squat', 1);
  const lunges = movement('reverse-lunge', 1);
  const points = (workouts, muscle) => loggedMuscleWork(workouts, lookup).get(muscle) ?? 0;
  const split = [session({ exercises: [squats] }), session({ exercises: [lunges] })];
  const both = session({ exercises: [squats, lunges, { ...squats, setDetails: [] }] });
  assert.equal(points(split, 'Quadriceps'), 2);
  assert.equal(points([both], 'Quadriceps'), 2.08);
  assert.ok(points([{ ...both, effort: 9 }], 'Quadriceps') > points([both], 'Quadriceps'));
  assert.ok(points([{ ...both, effort: 2 }], 'Quadriceps') < points([both], 'Quadriceps'));
  assert.ok(points([both], 'Hamstrings') < points([both], 'Quadriceps'));
  assert.equal(points([{ ...both, example: true }, { ...both, status: 'planned' }], 'Quadriceps'), 0);
});
