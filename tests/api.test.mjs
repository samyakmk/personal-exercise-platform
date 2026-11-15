import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { AiError, createOpenAi } from '../server/ai.mjs';
import { createLiftmorrowServer } from '../server/index.mjs';
import { createTestProfile } from './test-profile.mjs';

async function start(t, options = {}) {
  const server = createLiftmorrowServer({ database: ':memory:', respond: null, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((done) => server.close(done)));
  const root = `http://127.0.0.1:${server.address().port}/api/`;
  async function session(previousCookie) {
    const cookie = previousCookie?.startsWith('liftmorrow_browser=') ? previousCookie
      : await createTestProfile((path, init) => fetch(root + path, init), previousCookie);
    const response = await fetch(root + 'workspace?today=2026-11-12', { headers: { cookie } });
    return {
      cookie,
      data: await response.json(),
      call(path, init) {
        return fetch(root + path, { ...init, headers: { cookie, ...init?.headers } });
      },
    };
  }
  return { session, url: new URL(root).origin, close: () => new Promise((done) => server.close(done)) };
}

function payload(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

test('filters require all exercise equipment, match multiple muscles, and persist preferences', async (t) => {
  const { session } = await start(t);
  const browser = await session();
  assert.equal(browser.data.catalog.length, 689);
  assert.equal(browser.data.archivedExercises.length, 191);
  assert.equal(new Set(browser.data.catalog.map(({ id }) => id)).size, browser.data.catalog.length);
  assert.ok(browser.data.catalog.every(({ primaryMuscles, category, cues }) =>
    primaryMuscles.length > 0 && browser.data.exerciseCategories.includes(category) && cues.length > 0));
  assert.equal(browser.data.aiAvailable, false);
  assert.equal((await browser.call('exercises/recommendations?equipment=all', { method: 'POST' })).status, 503);
  assert.equal(browser.data.workouts.length, 0);
  assert.equal((await browser.call('equipment', payload('PUT', { selected: ['Dumbbells'] }))).status, 200);
  const results = await (await browser.call('exercises?equipment=saved&muscle=Legs&muscle=Chest')).json();
  assert.ok(results.some(({ id }) => id === 'goblet-squat'));
  assert.ok(results.some(({ id }) => id === 'fedb-dumbbell-lunges'));
  assert.ok(results.every(({ muscles, equipment }) => muscles.some((muscle) => ['Legs', 'Chest'].includes(muscle))
    && equipment.every((item) => item === 'Dumbbells')));
  for (const id of ['dumbbell-bench-press', 'fedb-barbell-squat', 'fedb-dumbbell-bench-press-with-neutral-grip']) {
    assert.ok(!results.some((exercise) => exercise.id === id));
  }
  const bodyweightBack = await (await browser.call('exercises?equipment=bodyweight&muscle=Back')).json();
  assert.ok(bodyweightBack.some(({ id }) => id === 'bird-dog'));
  assert.ok(bodyweightBack.every(({ equipment }) => equipment.length === 0));
  const incline = await (await browser.call('exercises?equipment=all&muscle=Chest&level=Beginner&q=incline')).json();
  assert.ok(incline.some(({ id }) => id === 'incline-push-up'));
  assert.ok(incline.every(({ muscles, level }) => muscles.includes('Chest') && level === 'Beginner'));
  const shoulderPress = await (await browser.call('exercises?equipment=all&q=shoulders%20dumbbell%20press')).json();
  for (const id of ['dumbbell-bench-press', 'dumbbell-shoulder-press', 'fedb-dumbbell-shoulder-press']) {
    assert.ok(shoulderPress.some((exercise) => exercise.id === id));
  }
  const advanced = await (await browser.call('exercises?equipment=all&level=Advanced')).json();
  assert.ok(advanced.some(({ id }) => id === 'fedb-handstand-push-ups'));
  assert.ok(advanced.every(({ level }) => level === 'Advanced'));
  assert.equal((await browser.call('equipment', payload('PUT', { selected: ['Pull-up bar'] }))).status, 200);
  const withBar = await (await browser.call('exercises?equipment=saved&muscle=Back')).json();
  assert.ok(withBar.some(({ id }) => id === 'fedb-chin-up'));
  assert.ok(withBar.some(({ id }) => id === 'pull-up'));
  assert.ok(!bodyweightBack.some(({ id }) => id === 'fedb-chin-up'));
  assert.equal((await browser.call('equipment', payload('PUT', { selected: ['Dumbbells'] }))).status, 200);
  assert.equal((await browser.call('exercises?equipment=all&level=unknown')).status, 400);
  assert.deepEqual((await (await browser.call('workspace')).json()).equipment, ['Dumbbells']);
  assert.equal((await browser.call('exercises?equipment=all&muscle=Unknown')).status, 400);
});

test('a heat map muscle matches exact primary or secondary catalog tags', async (t) => {
  const { session } = await start(t);
  const browser = await session();
  for (const muscle of new Set(browser.data.catalog.flatMap(({ primaryMuscles, secondaryMuscles }) =>
    [...primaryMuscles, ...secondaryMuscles]))) {
    const response = await browser.call('exercises?' + new URLSearchParams({ equipment: 'all', detail: muscle }));
    assert.equal(response.status, 200);
    const matches = await response.json();
    assert.deepEqual(new Set(matches.map(({ id }) => id)), new Set(browser.data.catalog
      .filter(({ primaryMuscles, secondaryMuscles }) => primaryMuscles.includes(muscle) || secondaryMuscles.includes(muscle))
      .map(({ id }) => id)));
  }
  const filtered = await (await browser.call('exercises?equipment=bodyweight&muscle=Chest&detail=Triceps&q=push')).json();
  assert.ok(filtered.some(({ id }) => id === 'push-up'));
  assert.ok(filtered.every(({ muscles, equipment }) => muscles.includes('Chest') && equipment.length === 0));
  assert.equal((await browser.call('exercises?equipment=all&detail=Unknown')).status, 400);
});

test('exercise types, detailed muscles, and demonstration availability can be searched together', async (t) => {
  const { session } = await start(t);
  const browser = await session();
  const videos = browser.data.catalog.filter(({ demonstration }) => demonstration);
  assert.equal(videos.length, browser.data.catalog.length);
  assert.equal(new Set(videos.map(({ demonstration }) => demonstration.videoId)).size, videos.length);
  assert.ok(videos.every(({ demonstration }) => demonstration.creator !== 'Bodymaster'));
  assert.ok(videos.some(({ id }) => id === 'fedb-arm-circles'));
  assert.ok(videos.some(({ id }) => id === 'fedb-side-jackknife'));
  assert.ok(videos.every(({ demonstration }) => demonstration.videoId !== 'e3IN2_QYcQA'));
  for (const { id, demonstration } of videos) {
    if (demonstration.provider === 'vimeo') {
      assert.match(demonstration.videoId, /^\d+$/);
      assert.equal(new URL(demonstration.thumbnailUrl).hostname, 'i.vimeocdn.com');
    } else {
      assert.match(demonstration.videoId, /^[\w-]{11}$/);
    }
    if (id.startsWith('fedb-')) {
      assert.equal(new URL(demonstration.source).protocol, 'https:');
      assert.ok(demonstration.creator);
    }
  }
  const matches = await (await browser.call('exercises?equipment=all&category=Strength&video=1&q=quadriceps')).json();
  assert.ok(matches.some(({ id }) => id === 'fedb-barbell-squat'));
  assert.ok(matches.every(({ category, demonstration }) => category === 'Strength' && demonstration));
  const stretches = await (await browser.call('exercises?equipment=all&category=Stretching')).json();
  assert.ok(stretches.length > 0 && stretches.every(({ demonstration }) => demonstration));
  assert.ok(browser.data.archivedExercises.some(({ id }) => id === 'fedb-all-fours-quad-stretch'));
  const all = await (await browser.call('exercises?equipment=all')).json();
  assert.deepEqual(new Set(all.map(({ id }) => id)), new Set(videos.map(({ id }) => id)));
  assert.equal((await browser.call('exercises?equipment=all&category=unknown')).status, 400);
  assert.equal((await browser.call('exercises?equipment=all&video=true')).status, 400);
});

test('workouts validate, create idempotently, convert to completed, and delete within their workspace', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const visitor = await session();
  const id = randomUUID();
  const workout = {
    id, name: 'Weekend workout', date: '2026-11-14', time: '08:30', status: 'planned',
    exercises: [{ exerciseId: 'goblet-squat', sets: 3, reps: 10, load: { value: 12.5, unit: 'kg' } }],
  };
  assert.equal((await owner.call('workouts', payload('POST', { ...workout, date: '2026-02-30' }))).status, 400);
  assert.equal((await owner.call('workouts', payload('POST', { ...workout, exercises: [] }))).status, 400);
  assert.equal((await owner.call('workouts', payload('POST', { ...workout,
    exercises: [{ ...workout.exercises[0], exerciseId: 'push-up' }],
  }))).status, 400);
  assert.equal((await owner.call('workouts', payload('POST', { ...workout,
    exercises: [{ ...workout.exercises[0], load: { value: 12.555, unit: 'kg' } }],
  }))).status, 400);
  assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  const retry = await (await owner.call('workouts', payload('POST', workout))).json();
  assert.equal(retry.workouts.filter((item) => item.id === id).length, 1);
  assert.deepEqual(retry.workouts.find((item) => item.id === id), { ...workout, revision: 1 });
  assert.equal((await owner.call('workouts', payload('POST', { ...workout, name: 'Different retry' }))).status, 409);
  const logged = { ...workout, status: 'completed', exercises: [{ exerciseId: 'goblet-squat', sets: 2, reps: 8 }] };
  assert.equal((await visitor.call('workouts/' + id, payload('PUT', logged))).status, 404);
  const saved = await (await owner.call('workouts/' + id, payload('PUT', logged))).json();
  assert.deepEqual(saved.workouts.find((item) => item.id === id), { ...logged, revision: 2 });
  assert.equal((await owner.call('workouts/' + id, payload('PUT', { ...logged, revision: 1 }))).status, 409);
  assert.equal((await owner.call('workouts/' + id + '?revision=1', { method: 'DELETE' })).status, 409);
  assert.equal((await visitor.call('workouts/' + id, { method: 'DELETE' })).status, 200);
  assert.ok((await (await owner.call('workspace')).json()).workouts.some((item) => item.id === id));
  const deleted = await (await owner.call('workouts/' + id, { method: 'DELETE' })).json();
  assert.ok(!deleted.workouts.some((item) => item.id === id));
});

test('examples are opt-in, idempotent, and removable without deleting a saved workout', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const other = await session();
  const path = 'workspace/example-workouts';
  const load = () => owner.call(path, payload('POST', { today: '2026-11-12' }));
  const [first, second] = await Promise.all([load(), load()]);
  const examples = (await first.json()).workouts;
  assert.equal(examples.length, 5);
  assert.ok(examples.every((item) => item.example));
  assert.deepEqual((await second.json()).workouts, examples);
  assert.equal((await (await other.call('workspace')).json()).workouts.length, 0);
  const saved = { ...examples[0], name: 'My workout', status: 'completed' };
  assert.equal((await owner.call('workouts/' + saved.id, payload('PUT', saved))).status, 200);
  const remaining = (await (await owner.call(path, { method: 'DELETE' })).json()).workouts;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].name, 'My workout');
  assert.equal(remaining[0].example, undefined);
  assert.equal((await (await load()).json()).workouts.length, 1);
});

test('workout edit receipts survive parallel retries, later edits, and deletion', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-edit-receipt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'workspace.sqlite');
  const first = await start(t, { database });
  const second = await start(t, { database });
  const owner = await first.session();
  const peer = await second.session(owner.cookie);
  const guest = await first.session();
  const id = randomUUID();
  const workout = { id, name: 'Original', date: '2026-11-14', time: '08:30', status: 'planned',
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }] };
  const path = 'workouts/' + id + '?response=delta';
  assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  const edit = { ...workout, name: 'Updated', revision: 1, operationId: randomUUID() };
  const save = (client, body = edit) => client.call(path, payload('PUT', body));
  assert.equal((await save(guest)).status, 404);
  const parallel = await Promise.all([save(owner), save(peer)]);
  for (const response of parallel) {
    assert.equal(response.status, 200);
    const { upsert } = (await response.json()).workouts;
    assert.deepEqual(upsert, [{ ...workout, name: edit.name, revision: 2 }]);
  }
  assert.equal((await save(owner, { ...edit, notes: 'different request' })).status, 409);
  assert.equal((await save(owner, { ...edit, operationId: randomUUID() })).status, 409);
  assert.equal((await save(peer, { ...edit, revision: 2, operationId: randomUUID(), name: 'Later edit' })).status, 200);
  const replay = (await (await save(owner)).json()).workouts.upsert[0];
  assert.equal(replay.revision, 3);
  assert.equal(replay.name, 'Later edit');
  assert.equal((await peer.call(path + '&revision=3', { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await save(owner)).json(), { workouts: { upsert: [], remove: [id] } });
});

test('weekly scheduling is atomic and retries preserve subsequent edits and deletions', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const visitor = await session();
  const workout = {
    id: randomUUID(), name: 'Friday strength', date: '2026-12-25', time: '15:30', status: 'planned',
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }], notes: 'Use a side view if recording.', repeatWeeks: 3,
  };
  const save = (fields = {}) => owner.call('workouts', payload('POST', { ...workout, ...fields }));
  assert.equal((await save({ repeatWeeks: 13 })).status, 400);
  assert.equal((await save({ status: 'completed' })).status, 400);
  assert.equal((await save({ date: '2199-12-24' })).status, 400);
  const result = await save();
  assert.equal(result.status, 200);
  const { workouts } = await result.json();
  assert.deepEqual(workouts.map(({ date }) => date), ['2026-12-25', '2027-01-01', '2027-01-08']);
  assert.ok(workouts.every(({ time, status, notes }) => time === workout.time && status === 'planned' && notes === workout.notes));
  assert.deepEqual((await (await save()).json()).workouts, workouts);
  assert.equal((await save({ repeatWeeks: 4 })).status, 409);
  assert.equal((await save({ repeatWeeks: 1 })).status, 409);
  assert.equal((await owner.call('workouts/' + workout.id, { method: 'DELETE' })).status, 200);
  const second = { ...workouts[1], name: 'Edited session' };
  assert.equal((await owner.call('workouts/' + second.id, payload('PUT', second))).status, 200);
  assert.deepEqual((await (await save()).json()).workouts.map(({ name }) => name), ['Edited session', workout.name]);
  assert.equal((await (await visitor.call('workspace')).json()).workouts.length, 0);
  const calendar = await (await owner.call('workouts/calendar.ics')).text();
  assert.match(calendar, /DTSTART:20270101T153000/);
  assert.match(calendar, /DTSTART:20270108T153000/);
  assert.doesNotMatch(calendar, /DTSTART:20261225/);
});

test('opt-in equipment and workout mutations return only authoritative changes', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const visitor = await session();
  const delta = '?response=delta';
  const workout = {
    id: randomUUID(), name: '  Log strength  ', date: '2026-11-12', time: '09:00', status: 'completed',
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }], notes: 'Record the last set.',
  };
  const unrelated = { ...workout, id: randomUUID(), name: 'Unrelated workout' };
  assert.equal((await owner.call('workouts', payload('POST', unrelated))).status, 200);
  assert.deepEqual(await (await owner.call('equipment' + delta, payload('PUT', { selected: ['Dumbbells'] }))).json(),
    { equipment: ['Dumbbells'] });
  const create = () => owner.call('workouts' + delta, payload('POST', workout));
  const first = await create();
  assert.equal(first.status, 200);
  const saved = { ...workout, name: 'Log strength', revision: 1 };
  assert.deepEqual(await first.json(), { workouts: { upsert: [saved], remove: [] } });
  assert.deepEqual(await (await create()).json(), { workouts: { upsert: [saved], remove: [] } });
  const full = await (await owner.call('workspace')).json();
  assert.deepEqual(full.workouts.find(({ id }) => id === workout.id), saved);
  assert.equal(full.workouts.length, 2);

  const path = 'workouts/' + workout.id;
  const { notes, ...withoutNotes } = saved;
  const edited = { ...withoutNotes, name: 'Strength revised' };
  assert.equal((await visitor.call(path + delta, payload('PUT', edited))).status, 404);
  assert.deepEqual(await (await owner.call(path + delta, payload('PUT', edited))).json(),
    { workouts: { upsert: [{ ...edited, notes, revision: 2 }], remove: [] } });
  assert.equal((await owner.call(path + delta, payload('PUT', edited))).status, 409);
  assert.equal((await owner.call(path + delta + '&revision=1', { method: 'DELETE' })).status, 409);
  const remove = (browser, revision) => browser.call(path + delta + '&revision=' + revision, { method: 'DELETE' });
  const deleted = { workouts: { upsert: [], remove: [workout.id] } };
  assert.deepEqual(await (await remove(visitor, 2)).json(), deleted);
  assert.deepEqual(await (await remove(owner, 2)).json(), deleted);
  assert.deepEqual(await (await remove(owner, 2)).json(), deleted);
  assert.deepEqual((await (await owner.call('workspace')).json()).workouts.map(({ id }) => id), [unrelated.id]);
});

test('bookmark mutation deltas return the authoritative private list and keep full responses opt-in compatible', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const other = await session();
  const path = (id) => 'exercises/' + id + '/bookmark';
  const put = { method: 'PUT' };
  const remove = { method: 'DELETE' };
  const legacy = await (await owner.call(path('push-up'), put)).json();
  assert.deepEqual(legacy.bookmarks, ['push-up']);
  assert.ok(Array.isArray(legacy.workouts) && Array.isArray(legacy.clips));
  const delta = '?response=delta';
  const add = () => owner.call(path('bird-dog') + delta, put);
  assert.deepEqual(await (await add()).json(), { bookmarks: ['bird-dog', 'push-up'] });
  assert.deepEqual(await (await add()).json(), { bookmarks: ['bird-dog', 'push-up'] });
  assert.deepEqual(await (await other.call(path('bird-dog') + delta, remove)).json(), { bookmarks: [] });
  assert.deepEqual(await (await owner.call(path('push-up') + delta, remove)).json(), { bookmarks: ['bird-dog'] });
  assert.deepEqual((await (await owner.call('workspace')).json()).bookmarks, ['bird-dog']);
  assert.equal((await owner.call(path('unknown') + delta, put)).status, 404);
});

test('weekly workout delta replay reports surviving authoritative edits and deleted IDs', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const path = 'workouts?response=delta';
  const workout = {
    id: randomUUID(), name: 'Friday strength', date: '2026-12-25', time: '15:30', status: 'planned', repeatWeeks: 3,
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }],
  };
  const save = () => owner.call(path, payload('POST', workout));
  const first = (await (await save()).json()).workouts;
  assert.equal(first.upsert.length, 3);
  assert.deepEqual(first.remove, []);
  const [initial, second, third] = first.upsert;
  const edit = { ...second, name: 'Edited occurrence', notes: 'A new cue.', date: '2027-01-16' };
  assert.equal((await owner.call('workouts/' + second.id, payload('PUT', edit))).status, 200);
  assert.equal((await owner.call('workouts/' + initial.id, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await save()).json(), {
    workouts: { upsert: [third, { ...edit, revision: 2 }], remove: [initial.id] },
  });
});

test('training backups restore only missing personal workouts and preserve saved equipment', async (t) => {
  const { session } = await start(t);
  const source = await session();
  const destination = await session();
  const separate = await session();
  const path = 'workspace/training-backup';
  const workout = {
    id: randomUUID(), name: 'Saved weights', date: '2026-11-12', time: '09:00', status: 'completed',
    notes: 'Regular session', exercises: [{ exerciseId: 'dumbbell-curl', sets: 1, reps: 8,
      setDetails: [{ reps: 8, load: { value: 12.5, unit: 'kg' } }] }],
  };
  await source.call('workspace/example-workouts', payload('POST', { today: workout.date }));
  await source.call('equipment', payload('PUT', { selected: ['Dumbbells'] }));
  assert.equal((await source.call('exercises/push-up/bookmark', { method: 'PUT' })).status, 200);
  assert.equal((await source.call('exercises/push-up/bookmark', { method: 'PUT' })).status, 200);
  assert.equal((await source.call('exercises/unknown/bookmark', { method: 'PUT' })).status, 404);
  await source.call('workouts', payload('POST', workout));
  await uploadFixture(source, randomUUID(), 'push-up');
  const response = await source.call(path);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /liftmorrow-training-backup.json/);
  const backup = await response.json();
  assert.deepEqual(Object.keys(backup), ['format', 'version', 'equipment', 'bookmarks', 'workouts']);
  assert.deepEqual(backup.bookmarks, ['push-up']);
  assert.equal(backup.workouts.length, 1);
  assert.equal(backup.workouts[0].revision, undefined);
  assert.equal(backup.workouts[0].notes, workout.notes);
  assert.deepEqual((await (await destination.call(path)).json()).workouts, []);
  const invalid = { ...backup, workouts: [...backup.workouts, { ...backup.workouts[0], id: randomUUID(), date: '2026-02-30' }] };
  assert.equal((await destination.call(path, payload('POST', invalid))).status, 400);
  assert.deepEqual((await (await destination.call(path)).json()).workouts, []);

  const restored = await (await destination.call(path, payload('POST', backup))).json();
  assert.deepEqual(restored.restore, { added: 1, skipped: 0, equipmentImported: true, savedExercises: 1 });
  assert.deepEqual(restored.bookmarks, ['push-up']);
  assert.deepEqual(restored.equipment, ['Dumbbells']);
  assert.equal(restored.clips.length, 0);
  assert.deepEqual(restored.workouts[0].exercises, backup.workouts[0].exercises);
  await destination.call('equipment', payload('PUT', { selected: [] }));
  await destination.call('workouts/' + workout.id, payload('PUT', { ...restored.workouts[0], name: 'Local edit' }));
  const repeated = await (await destination.call(path, payload('POST', backup))).json();
  assert.deepEqual(repeated.restore, { added: 0, skipped: 1, equipmentImported: false, savedExercises: 0 });
  assert.equal(repeated.workouts[0].name, 'Local edit');
  assert.deepEqual(repeated.equipment, []);
  assert.equal((await (await separate.call(path)).json()).workouts.length, 0);
  assert.deepEqual((await (await separate.call(path)).json()).bookmarks, []);
});

test('per-set workout data persists and exports all actual reps and weights', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const id = randomUUID();
  const workout = { id, name: 'Individual set log', date: '2026-11-10', time: '16:30', status: 'completed', notes: 'Keep the same setup.' };
  const exerciseId = 'dumbbell-curl';
  const setDetails = [{ reps: 12, load: { value: 20, unit: 'lb' } }, { reps: 9, load: { value: 12.5, unit: 'kg' } }];
  const save = (exercise) => owner.call('workouts', payload('POST', { ...workout, exercises: [exercise] }));
  assert.equal((await save({ exerciseId, setDetails: [...setDetails, { reps: 0 }] })).status, 400);
  assert.equal((await save({ exerciseId: 'push-up', setDetails })).status, 400);
  assert.equal((await save({ exerciseId, sets: 99, reps: 2, setDetails })).status, 200);
  const saved = (await (await owner.call('workspace')).json()).workouts[0].exercises[0];
  assert.deepEqual(saved, { exerciseId, sets: 2, ...setDetails[0], setDetails });
  const csv = await (await owner.call('workouts/history.csv')).text();
  assert.match(csv, /Single-Arm Dumbbell Curl,1,12,reps,20,lb,1,Keep the same setup\.\r\n/);
  assert.match(csv, /Single-Arm Dumbbell Curl,1,9,reps,12.5,kg,2,Keep the same setup\.\r\n/);
  const { notes, ...withoutNotes } = workout;
  const legacyEdit = await owner.call('workouts/' + id, payload('PUT', { ...withoutNotes, exercises: [saved] }));
  assert.equal((await legacyEdit.json()).workouts[0].notes, notes);
  const cleared = await owner.call('workouts/' + id, payload('PUT', { ...workout, notes: '', exercises: [saved] }));
  assert.equal((await cleared.json()).workouts[0].notes, undefined);
});

test('completed sessions can save metadata, add exercises without sets, and export optional measurements', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const destination = await session();
  const workout = { id: randomUUID(), name: 'Morning session', date: '2026-11-12', time: '08:30', status: 'completed', exercises: [] };
  assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  assert.match(await (await owner.call('workouts/history.csv')).text(), /2026-11-12,08:30,Morning session,,,,,,,,\r\n/);

  const setDetails = [{ load: { value: 20, unit: 'lb' } }, { reps: 12 }];
  const exercises = [{ exerciseId: 'dumbbell-bench-press', setDetails }, { exerciseId: 'forearm-plank', setDetails: [] }];
  const update = (changed) => owner.call('workouts/' + workout.id, payload('PUT', { ...workout, exercises, revision: 1, ...changed }));
  assert.equal((await update({ status: 'planned' })).status, 400);
  assert.equal((await update({ exercises: [{ exerciseId: 'dumbbell-bench-press', setDetails: [{}] }] })).status, 400);
  const saved = await update({});
  assert.equal(saved.status, 200);
  const { workouts } = await saved.json();
  assert.deepEqual(workouts[0].exercises, [
    { exerciseId: 'dumbbell-bench-press', sets: 2, load: { value: 20, unit: 'lb' }, setDetails },
    { exerciseId: 'forearm-plank', sets: 0, setDetails: [] },
  ]);
  assert.equal((await update({})).status, 409);
  const csv = await (await owner.call('workouts/history.csv')).text();
  assert.match(csv, /Dumbbell Bench Press,1,,reps,20,lb,1,/);
  assert.match(csv, /Dumbbell Bench Press,1,12,reps,,,2,/);
  const path = 'workspace/training-backup';
  const backup = await (await owner.call(path)).json();
  const imported = await destination.call(path, payload('POST', backup));
  assert.equal(imported.status, 200);
  assert.deepEqual((await imported.json()).workouts[0].exercises, workouts[0].exercises);
});

test('calendar and history exports contain only the requested private personal records', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const other = await session();
  const planned = {
    id: randomUUID(), name: 'Plan, back \\ core; ' + '🟩'.repeat(20), date: '2026-11-15', time: '18:15',
    status: 'planned', exercises: [{ exerciseId: 'dead-bug', sets: 3, reps: 10 }],
  };
  const done = {
    id: randomUUID(), name: '=Formula("x")', date: '2026-11-12', time: '08:05',
    status: 'completed', exercises: [{ exerciseId: 'dumbbell-rdl', sets: 3, reps: 8, load: { value: 12.5, unit: 'kg' } }],
  };
  await owner.call('workspace/example-workouts', payload('POST', { today: '2026-11-12' }));
  for (const workout of [planned, done]) assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  const calendar = await owner.call('workouts/calendar.ics');
  assert.equal(calendar.headers.get('cache-control'), 'private, no-store');
  assert.match(calendar.headers.get('content-disposition'), /liftmorrow-calendar\.ics/);
  const body = await calendar.text();
  assert.ok(body.split('\r\n').every((line) => Buffer.byteLength(line) <= 75));
  const unfolded = body.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`UID:${planned.id}@liftmorrow.local\r\n`));
  assert.match(unfolded, /DTSTART:20261115T181500\r\n/);
  assert.ok(unfolded.includes('SUMMARY:Plan\\, back \\\\ core\\; ' + '🟩'.repeat(20)));
  assert.match(unfolded, /DESCRIPTION:Dead Bug · 3 × 10 reps/);
  assert.equal(unfolded.match(/BEGIN:VEVENT/g).length, 1);
  assert.equal((await owner.call('workouts/calendar.ics?workout=' + planned.id)).status, 200);
  assert.equal((await other.call('workouts/calendar.ics?workout=' + planned.id)).status, 404);
  assert.equal((await owner.call('workouts/calendar.ics?workout=' + done.id)).status, 404);
  const csv = await owner.call('workouts/history.csv');
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  const rows = (await csv.text()).trimEnd().split('\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1], '2026-11-12,08:05,"\'=Formula(""x"")",Dumbbell Romanian Deadlift,3,8,reps,12.5,kg,,');
  assert.equal((await (await other.call('workouts/history.csv')).text()).trimEnd().split('\r\n').length, 1);
});

test('workout exports preserve byte format and date, time, and ID ordering', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const other = await session();
  const sessionRecord = (number, date, time, status) => ({
    id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    name: `Training #${number} 🟩`, date, time, status, notes: 'Cue, then lower.\nKeep control.',
    exercises: [{ exerciseId: 'dumbbell-rdl', sets: 2, reps: 8, load: { value: 12, unit: 'kg' } }],
  });
  const planned = [
    sessionRecord(1, '2026-11-12', '07:15', 'planned'), sessionRecord(2, '2026-11-12', '07:15', 'planned'),
    sessionRecord(3, '2026-11-12', '09:00', 'planned'), sessionRecord(4, '2026-11-13', '06:45', 'planned'),
  ];
  const completed = [
    sessionRecord(5, '2026-11-12', '07:15', 'completed'), sessionRecord(6, '2026-11-12', '07:15', 'completed'),
    sessionRecord(7, '2026-11-12', '09:00', 'completed'), sessionRecord(8, '2026-11-13', '06:45', 'completed'),
  ];
  await owner.call('workspace/example-workouts', payload('POST', { today: '2026-11-12' }));
  await other.call('workouts', payload('POST', sessionRecord(9, '2026-11-12', '07:15', 'planned')));
  for (const workout of [...planned, ...completed].reverse()) {
    assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  }
  const calendar = await (await owner.call('workouts/calendar.ics')).text();
  assert.deepEqual([...calendar.matchAll(/^UID:(.+)@liftmorrow\.local\r$/gm)].map(([, id]) => id), planned.map(({ id }) => id));
  const single = (await (await owner.call('workouts/calendar.ics?workout=' + planned[2].id)).text())
    .replace(/DTSTAMP:[^\r\n]+/g, 'DTSTAMP:fixed');
  const event = calendar.split('BEGIN:VEVENT\r\n')[3].split('END:VEVENT\r\n')[0].replace(/DTSTAMP:[^\r\n]+/g, 'DTSTAMP:fixed');
  assert.equal(single, 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Liftmorrow//Workouts//EN\r\nBEGIN:VEVENT\r\n'
    + event + 'END:VEVENT\r\nEND:VCALENDAR\r\n');
  const csv = await (await owner.call('workouts/history.csv')).arrayBuffer();
  const header = '\uFEFFDate,Time,Workout,Exercise,Sets,Reps or seconds,Measurement,Weight per dumbbell,Weight unit,Set number,Workout notes';
  const csvRows = completed.reverse().map(({ date, time, name }) =>
    `${date},${time},${name},Dumbbell Romanian Deadlift,2,8,reps,12,kg,,"Cue, then lower.\nKeep control."`);
  assert.deepEqual(Buffer.from(csv), Buffer.from([header, ...csvRows, ''].join('\r\n')));
});

test('video upload validates type and size, survives retries, supports ranges, and stays private', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const visitor = await session();
  const id = randomUUID();
  const upload = 'clips/' + id + '?exercise=push-up';
  const video = 'clips/' + id + '/video';
  const bytes = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const headers = { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'synthetic.mp4' };
  assert.equal((await owner.call(upload, { method: 'PUT', headers: { ...headers, 'Content-Type': 'text/html' }, body: '<html>' })).status, 415);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: '<html>' })).status, 415);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: '1234ftyp12345678' })).status, 415);
  assert.equal((await owner.call(upload, { method: 'PUT', headers: { ...headers, 'Content-Type': 'video/webm' },
    body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) })).status, 415);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: new Uint8Array(50 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: bytes })).status, 200);
  const retry = await (await owner.call(upload, { method: 'PUT', headers, body: bytes })).json();
  assert.equal(retry.clips.length, 1);
  assert.equal(retry.clips[0].filename, 'synthetic.mp4');
  assert.equal((await owner.call(upload.replace('push-up', 'goblet-squat'), { method: 'PUT', headers, body: bytes })).status, 409);
  const altered = Buffer.from(bytes);
  altered[altered.indexOf('mdat') + 5] ^= 1;
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: altered })).status, 409);
  const range = await owner.call(video, { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-15/${bytes.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
  const suffix = await owner.call(video, { headers: { Range: 'BYTES=-16' } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-16));
  const ignored = await owner.call(video, { headers: { Range: 'frames=0-15' } });
  assert.equal(ignored.status, 200);
  assert.deepEqual(Buffer.from(await ignored.arrayBuffer()), bytes);
  const tag = range.headers.get('etag');
  assert.match(tag, /^"[a-f\d]{32}"$/);
  const matching = await owner.call(video, { headers: { Range: 'bytes=4-8', 'If-Range': tag } });
  assert.equal(matching.status, 206);
  assert.equal(matching.headers.get('etag'), tag);
  assert.equal(matching.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await matching.arrayBuffer()), bytes.subarray(4, 9));
  for (const validator of ['"different"', 'W/' + tag, new Date().toUTCString()]) {
    const fallback = await owner.call(video, { headers: { Range: 'bytes=999999-', 'If-Range': validator } });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.headers.get('content-range'), null);
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), bytes);
  }
  const idLarge = randomUUID();
  const larger = Buffer.concat([bytes, Buffer.alloc(400_000, 0x35)]);
  larger.writeUInt32BE(400_000, bytes.length);
  larger.write('free', bytes.length + 4);
  assert.equal((await owner.call('clips/' + idLarge + '?exercise=push-up', { method: 'PUT', headers, body: larger })).status, 200);
  const crossing = await owner.call('clips/' + idLarge + '/video', { headers: { Range: 'bytes=262140-262150' } });
  assert.equal(crossing.status, 206);
  assert.deepEqual(Buffer.from(await crossing.arrayBuffer()), larger.subarray(262140, 262151));
  const full = await owner.call('clips/' + idLarge + '/video');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), larger);
  const download = await owner.call(video + '?download=1', { method: 'HEAD', headers: { Range: 'bytes=0-1', 'If-Range': tag } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('etag'), tag);
  assert.equal(download.headers.get('content-range'), null);
  assert.match(download.headers.get('content-disposition'), /^attachment; filename="synthetic\.mp4"/);
  assert.equal(download.headers.get('content-length'), String(bytes.length));
  assert.equal((await visitor.call(video + '?download=1')).status, 404);
  assert.equal((await owner.call(video, { headers: { Range: 'bytes=999999-1000000' } })).status, 416);
  assert.equal((await visitor.call(video)).status, 404);
  const foreign = await visitor.call(video, { headers: { Range: 'bytes=0-3', 'If-Range': tag } });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.headers.get('etag'), null);
  assert.equal((await visitor.call('clips/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await owner.call(video)).status, 200);
  assert.equal((await owner.call('clips/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await owner.call(video)).status, 404);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: altered })).status, 200);
  const replacement = await owner.call(video, { headers: { Range: 'bytes=0-15', 'If-Range': tag } });
  assert.equal(replacement.status, 200);
  assert.notEqual(replacement.headers.get('etag'), tag);
  assert.deepEqual(Buffer.from(await replacement.arrayBuffer()), altered);
});

test('existing SQLite workspaces retain workouts and older unchunked videos', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'liftmorrow-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const database = join(root, 'old.sqlite');
  const db = new DatabaseSync(database);
  const workspace = randomUUID();
  const id = randomUUID();
  const bytes = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  db.exec(`
    CREATE TABLE workspace (id TEXT PRIMARY KEY, equipment TEXT);
    CREATE TABLE workout (workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL, name TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, status TEXT NOT NULL,
      exercises TEXT NOT NULL, PRIMARY KEY (workspace_id, id));
    CREATE TABLE clip (workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
      id TEXT NOT NULL, exerciseId TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER NOT NULL, uploadedAt TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (workspace_id, id));
  `);
  db.prepare('INSERT INTO workspace VALUES (?, ?)').run(workspace, '["Dumbbells"]');
  db.prepare('INSERT INTO workout VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    workspace, randomUUID(), 'Older workout', '2026-11-02', '17:30', 'completed', '[{"exerciseId":"push-up","sets":3,"reps":10}]',
  );
  db.prepare('INSERT INTO clip VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    workspace, id, 'push-up', 'synthetic.mp4', 'video/mp4', bytes.length, new Date().toISOString(), bytes,
  );
  db.close();
  const { session } = await start(t, { database });
  const owner = await session('liftmorrow_workspace=' + workspace);
  assert.deepEqual(owner.data.equipment, ['Dumbbells']);
  assert.equal(owner.data.workouts[0].revision, 1);
  const video = await owner.call('clips/' + id + '/video', { headers: { Range: 'bytes=0-20' } });
  assert.match(video.headers.get('etag'), /^"[a-f\d]{32}"$/);
  assert.equal(video.status, 206);
  assert.deepEqual(Buffer.from(await video.arrayBuffer()), bytes.subarray(0, 21));
  await uploadFixture(owner, id);
});

test('WebM upload accepts a real video track and rejects audio-only WebM', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const id = randomUUID();
  const upload = 'clips/' + id + '?exercise=push-up';
  const [video, audio] = await Promise.all(['synthetic.webm', 'audio-only.webm']
    .map((file) => readFile(new URL('./fixtures/' + file, import.meta.url))));
  const headers = { 'Content-Type': 'video/webm', 'X-Clip-Name': 'video.webm' };
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: audio })).status, 415);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: video })).status, 200);
  const saved = await owner.call('clips/' + id + '/video');
  assert.equal(saved.headers.get('content-type'), 'video/webm');
  assert.deepEqual(Buffer.from(await saved.arrayBuffer()), video);
});

test('MOV uploads store a playable MP4 and retry the same source without reconverting', async (t) => {
  const mp4 = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const source = Buffer.from(mp4);
  source.write('qt  ', source.indexOf('ftyp') + 4, 'ascii');
  let conversions = 0;
  const { session } = await start(t, { convertVideo: async (bytes) => {
    assert.deepEqual(bytes, source);
    conversions += 1;
    if (conversions === 1) throw new AiError(422, 'Conversion failed.');
    return mp4;
  } });
  const owner = await session();
  const id = randomUUID();
  const path = 'clips/' + id;
  const headers = { 'Content-Type': 'video/quicktime', 'X-Clip-Name': 'lifting.MOV' };
  const upload = () => owner.call(path + '?exercise=push-up', { method: 'PUT', headers, body: source });
  assert.equal((await upload()).status, 422);
  assert.equal((await owner.call(path + '/video')).status, 404);
  const response = await upload();
  assert.equal(response.status, 200);
  const { clips } = await response.json();
  assert.equal(clips[0].mime, 'video/mp4');
  assert.equal(clips[0].filename, 'lifting.mp4');
  assert.equal((await upload()).status, 200);
  assert.equal(conversions, 2);
  const playable = await owner.call(path + '/video');
  assert.equal(playable.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await playable.arrayBuffer()), mp4);
});

test('disconnecting during an upload releases its slot and leaves no partial video', async (t) => {
  const { session, url } = await start(t);
  const owner = await session();
  const id = randomUUID();
  const upload = 'clips/' + id + '?exercise=push-up';
  const body = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const headers = { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'video.mp4' };
  const interrupted = httpRequest(url + '/api/' + upload, {
    method: 'PUT', headers: { ...headers, Cookie: owner.cookie, 'Content-Length': body.length },
  });
  interrupted.on('error', () => {});
  t.after(() => interrupted.destroy());
  const connected = once(interrupted, 'socket');
  interrupted.write(body.subarray(0, 20));
  await connected;

  // Observe the lock before disconnecting so this exercises an in-flight upload.
  let busy = false;
  for (let index = 0; index < 15 && !busy; index += 1) {
    const probe = await owner.call('clips/' + randomUUID() + '?exercise=push-up',
      { method: 'PUT', headers, body: new Uint8Array([0]) });
    busy = probe.status === 429;
    await probe.arrayBuffer();
  }
  assert.ok(busy);
  interrupted.destroy();
  assert.equal((await owner.call('clips/' + id + '/video')).status, 404);
  let saved;
  for (let index = 0; index < 15; index += 1) {
    saved = await owner.call(upload, { method: 'PUT', headers, body });
    if (saved.status !== 429) break;
    await saved.arrayBuffer();
  }
  assert.equal(saved.status, 200);
});

test('AI recommendations use only filtered catalog IDs and omit workout names', async (t) => {
  let request;
  let calls = 0;
  function readCandidates({ candidates, candidateColumns }) {
    return candidates.map((row) => Object.fromEntries(candidateColumns.map((column, index) => [column, row[index]])));
  }
  const { session } = await start(t, { respond: async (input) => {
    calls += 1;
    request = input;
    const payload = JSON.parse(input.content[0].text);
    return { recommendations: readCandidates(payload).slice(0, payload.limit).map(({ id }) => ({ exerciseId: id, reasonCode: 'target' })) };
  } });
  const browser = await session();
  assert.equal(browser.data.aiAvailable, true);
  await browser.call('workspace/example-workouts', payload('POST', { today: '2026-11-12' }));
  const post = { method: 'POST' };
  assert.deepEqual(await (await browser.call('exercises/recommendations?equipment=bodyweight&muscle=Back&q=deadlift', post)).json(), []);
  const single = await browser.call('exercises/recommendations?equipment=all&q=single+arm+dumbbell+row', post);
  assert.equal(single.status, 200);
  assert.deepEqual((await single.json()).map(({ exerciseId }) => exerciseId), ['dumbbell-row']);
  assert.equal(calls, 0);
  const result = await browser.call('exercises/recommendations?equipment=bodyweight&muscle=Chest', post);
  assert.equal(result.status, 200);
  assert.equal((await result.json())[0].exerciseId, 'push-up');
  const input = JSON.parse(request.content[0].text);
  assert.ok(input.candidates.length > 3);
  assert.ok(readCandidates(input).every(({ equipment, muscles }) => equipment.length === 0 && muscles.includes('Chest')));
  assert.equal(input.completedSessionsByExercise['push-up'], undefined);
  assert.ok(!request.content[0].text.includes('Full Body Foundations'));
  for (const [time, name] of [['07:15', 'Before now'], ['20:30', 'Later today']]) {
    const added = await browser.call('workouts', payload('POST', {
      id: randomUUID(), name, date: '2026-11-12', time, status: 'completed',
      notes: 'Private session note',
      exercises: [{ exerciseId: 'push-up', sets: 2, reps: 8, notes: 'Private exercise note' },
        { exerciseId: 'fedb-push-up-wide', setDetails: [] }],
    }));
    assert.equal(added.status, 200);
  }
  const withHistory = await browser.call('exercises/recommendations?equipment=bodyweight&muscle=Chest&today=2026-11-12&now=10:00', post);
  assert.equal(withHistory.status, 200);
  assert.equal(JSON.parse(request.content[0].text).completedSessionsByExercise['push-up'], 1);
  assert.equal(JSON.parse(request.content[0].text).completedSessionsByExercise['fedb-push-up-wide'], undefined);
  assert.ok(!request.content[0].text.includes('Before now'));
  assert.ok(!request.content[0].text.includes('Private session note'));
  assert.ok(!request.content[0].text.includes('Private exercise note'));
  assert.equal(calls, 2);
  assert.equal((await browser.call('exercises/recommendations?equipment=bodyweight&muscle=Chest&today=2026-11-12&now=10:01', post)).status, 200);
  assert.equal(calls, 2);
  const broad = await browser.call('exercises/recommendations?equipment=all', post);
  assert.equal(broad.status, 200);
  assert.equal(JSON.parse(request.content[0].text).candidates.length, 50);
  const exact = await browser.call('exercises/recommendations?equipment=bodyweight&muscle=Arms&detail=Triceps', post);
  assert.equal(exact.status, 200);
  const exactInput = JSON.parse(request.content[0].text);
  assert.deepEqual(exactInput.targets, ['Arms']);
  assert.equal(exactInput.detail, 'Triceps');
  assert.ok(readCandidates(exactInput)[0].primaryMuscles.includes('Triceps'));
});

test('OpenAI responses request disables storage and upstream errors do not expose the provider body', async () => {
  let request;
  const respond = createOpenAi({ key: 'test-only-token', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'error');
    request = JSON.parse(init.body);
    return Response.json({ error: { message: 'Internal provider details' } }, { status: 401 });
  } });
  await assert.rejects(() => respond({
    name: 'test', schema: {}, instructions: '', content: [],
  }), (error) => error instanceof AiError && error.status === 503 && !error.message.includes('Internal provider details'));
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
});

test('OpenAI cooldown respects Retry-After and handles quota and filtered output separately', async () => {
  const input = { name: 'test', schema: {}, instructions: '', content: [] };
  let calls = 0;
  const limited = createOpenAi({ key: 'test-only-token', fetchImpl: async () => {
    calls += 1;
    return Response.json({ error: { code: 'slow_down', message: 'Private upstream text' } }, {
      status: 429, headers: { 'Retry-After': '7' },
    });
  } });
  await assert.rejects(() => limited(input), (error) => error.status === 503 && error.retryAfter === 7);
  await assert.rejects(() => limited(input), (error) => error.diagnostic === 'cooldown' && error.retryAfter > 0);
  assert.equal(calls, 1);
  const quota = createOpenAi({ key: 'test-only-token', fetchImpl: async () =>
    Response.json({ error: { code: 'insufficient_quota', message: 'Private upstream text' } }, { status: 429 }) });
  await assert.rejects(() => quota(input), (error) => error.diagnostic === 'quota' && !error.message.includes('Private'));
  const filtered = createOpenAi({ key: 'test-only-token', fetchImpl: async () =>
    Response.json({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }) });
  await assert.rejects(() => filtered(input), (error) => error.status === 422 && error.diagnostic === 'content_filter');
});

test('form reviews coalesce concurrent requests, persist, and enforce clip ownership', async (t) => {
  let complete;
  const wait = new Promise((resolve) => { complete = resolve; });
  let entered;
  const began = new Promise((resolve) => { entered = resolve; });
  let calls = 0;
  const { session } = await start(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('first') }, { timestamp: 0.5, image: Buffer.from('second') }],
    respond: async ({ content }) => {
      calls += 1;
      assert.equal(content.filter((part) => part.type === 'input_image').length, 2);
      entered();
      await wait;
      return {
        verdict: 'observations', summary: 'The exercise is visible.', limitations: 'The camera shows one side.',
        observations: [{ frame: 2, comparisonFrame: 1, kind: 'strength', observation: 'The body looks aligned.', cue: 'Keep the same position.' }],
      };
    },
  });
  t.after(complete);
  const browser = await session();
  const visitor = await session();
  const id = randomUUID();
  await uploadFixture(browser, id, 'incline-push-up');
  const path = 'clips/' + id + '/review';
  const post = { method: 'POST' };
  assert.equal((await visitor.call(path, post)).status, 404);
  assert.equal(calls, 0);
  const first = browser.call(path, post);
  await began;
  const duplicate = browser.call(path, post);
  complete();
  const results = await Promise.all([first, duplicate]);
  assert.deepEqual(results.map((response) => response.status), [200, 200]);
  const feedback = await results[0].json();
  assert.equal(feedback.observations[0].timestamp, 0.5);
  assert.equal(feedback.observations[0].comparisonTimestamp, 0);
  assert.deepEqual(await results[1].json(), feedback);
  assert.deepEqual((await (await browser.call('workspace')).json()).clips[0].review, feedback);
  assert.deepEqual(await (await browser.call(path, post)).json(), feedback);
  assert.equal(calls, 1);
  await browser.call('clips/' + id, { method: 'DELETE' });
  assert.equal((await browser.call(path, post)).status, 404);
});

test('a failed review can retry and deleting a clip cancels the in-flight review', async (t) => {
  let entered;
  const began = new Promise((resolve) => { entered = resolve; });
  let calls = 0;
  const { session } = await start(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: async ({ signal }) => {
      calls += 1;
      if (calls === 1) throw new AiError(503, 'Temporary model error.');
      entered();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      return { verdict: 'insufficient_visibility', summary: 'No person visible.', limitations: 'One still frame.', observations: [] };
    },
  });
  const browser = await session();
  const id = randomUUID();
  await uploadFixture(browser, id);
  const path = 'clips/' + id + '/review';
  assert.equal((await browser.call(path, { method: 'POST' })).status, 503);
  const retry = browser.call(path, { method: 'POST' });
  await began;
  await browser.call('clips/' + id, { method: 'DELETE' });
  assert.equal((await retry).status, 404);
  assert.equal((await (await browser.call('workspace')).json()).clips.length, 0);
});

test('background review state survives requests, exposes failures, and retries by sequence', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const { session } = await start(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: async () => {
      calls += 1;
      if (calls === 1) {
        await gate;
        throw new AiError(503, 'Temporary model error.');
      }
      return { verdict: 'insufficient_visibility', summary: 'No person visible.', limitations: 'One still frame.', observations: [] };
    },
  });
  t.after(release);
  const browser = await session();
  const visitor = await session();
  const id = randomUUID();
  await uploadFixture(browser, id);
  const path = 'clips/' + id + '/review';
  const background = () => browser.call(path + '?background=1', { method: 'POST' });
  const status = async () => (await browser.call(path)).json();
  assert.deepEqual((await status()).reviewStatus, { state: 'idle', sequence: 0 });
  assert.equal((await visitor.call(path)).status, 404);
  const accepted = await background();
  assert.equal(accepted.status, 202);
  assert.deepEqual((await accepted.json()).reviewStatus, { state: 'running', sequence: 1, startSeconds: 0 });
  assert.deepEqual((await (await background()).json()).reviewStatus, { state: 'running', sequence: 1, startSeconds: 0 });
  assert.deepEqual((await (await browser.call('workspace')).json()).clips[0].reviewStatus, { state: 'running', sequence: 1, startSeconds: 0 });
  release();
  const failed = await waitForState(status, 'failed');
  assert.deepEqual(failed.reviewStatus, { state: 'failed', sequence: 1, startSeconds: 0, error: 'Temporary model error.' });
  assert.equal((await background()).status, 202);
  const done = await waitForState(status, 'complete');
  assert.equal(done.reviewStatus.sequence, 2);
  assert.equal(done.review.verdict, 'insufficient_visibility');
  assert.equal((await background()).status, 200);
  assert.equal(calls, 2);
  const refreshed = await browser.call(path + '?background=1&refresh=1', { method: 'POST' });
  assert.equal(refreshed.status, 202);
  const next = await waitForState(status, 'complete');
  assert.equal(next.reviewStatus.sequence, 3);
  assert.equal(calls, 3);
});

test('reviewing another video segment preserves the earlier result until the new one succeeds', async (t) => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let startTimes = [];
  const { session } = await start(t, {
    sampleFrames: async (bytes, { startSeconds }) => {
      startTimes.push(startSeconds);
      if (startSeconds === 10) await wait;
      return [0.5, 1.25].map((time) => ({ timestamp: startSeconds + time, image: Buffer.from('fixture') }));
    },
    respond: async () => ({
      verdict: 'observations', summary: 'The exercise is visible.', limitations: 'Only one side.',
      observations: [{ frame: 1, comparisonFrame: 2, kind: 'strength', observation: 'Your elbows are extended at the top.', cue: 'Keep the same finish.' }],
    }),
  });
  t.after(release);
  const browser = await session();
  const id = randomUUID();
  await uploadFixture(browser, id, 'incline-push-up');
  const path = 'clips/' + id + '/review';
  const begin = (start) => browser.call(path + '?background=1&start=' + start, { method: 'POST' });
  const status = async () => (await browser.call(path)).json();
  assert.equal((await begin('-1')).status, 400);
  assert.equal((await begin('1.5')).status, 400);
  assert.equal((await begin('0')).status, 202);
  const first = await waitForState(status, 'complete');
  assert.equal(first.review.observations[0].timestamp, 0.5);
  const second = await begin('10');
  assert.equal(second.status, 202);
  const running = await second.json();
  assert.equal(running.review.startSeconds, 0);
  assert.deepEqual(running.reviewStatus, { state: 'running', sequence: 2, startSeconds: 10 });
  assert.equal((await begin('0')).status, 409);
  release();
  const updated = await waitForState(status, 'complete');
  assert.equal(updated.review.observations[0].timestamp, 10.5);
  assert.equal(updated.review.observations[0].comparisonTimestamp, 11.25);
  assert.equal(updated.review.startSeconds, 10);
  assert.equal((await begin('10')).status, 200);
  assert.deepEqual(startTimes, [0, 10]);
});

test('changing a saved clip exercise preserves media and invalidates prior review state', async (t) => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const { session } = await start(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: async () => {
      await wait;
      return { verdict: 'different_exercise', summary: 'An incline push-up is visible.', limitations: 'Side view.', observations: [] };
    },
  });
  t.after(release);
  const owner = await session();
  const visitor = await session();
  const id = randomUUID();
  await uploadFixture(owner, id, 'push-up');
  const path = 'clips/' + id;
  const update = (exerciseId, previousExerciseId) => payload('PUT', { exerciseId, previousExerciseId });
  const correct = update('incline-push-up', 'push-up');
  assert.equal((await visitor.call(path + '/exercise', correct)).status, 404);
  assert.equal((await owner.call(path + '/review?background=1', { method: 'POST' })).status, 202);
  assert.equal((await owner.call(path + '/exercise', correct)).status, 409);
  release();
  const status = async () => (await owner.call(path + '/review')).json();
  const prior = await waitForState(status, 'complete');
  const before = await (await owner.call(path + '/video')).arrayBuffer();
  const changed = await owner.call(path + '/exercise', correct);
  assert.equal(changed.status, 200);
  const [clip] = (await changed.json()).clips;
  assert.equal(clip.exerciseId, 'incline-push-up');
  assert.equal(clip.review, null);
  assert.deepEqual(clip.reviewStatus, { state: 'idle', sequence: prior.reviewStatus.sequence + 1 });
  assert.deepEqual(await (await owner.call(path + '/video')).arrayBuffer(), before);
  assert.equal((await owner.call(path + '/exercise', update('reverse-lunge', 'push-up'))).status, 409);
  assert.deepEqual((await (await owner.call(path + '/exercise', correct)).json()).clips[0].reviewStatus, clip.reviewStatus);
  assert.equal((await owner.call(path + '/review?background=1', { method: 'POST' })).status, 202);
  assert.equal((await waitForState(status, 'complete')).reviewStatus.sequence, clip.reviewStatus.sequence + 1);
});

test('clip mutation deltas include the public review state and leave unrelated private data out', async (t) => {
  const { session } = await start(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: async () => ({ verdict: 'insufficient_visibility', summary: 'No person visible.', limitations: 'One frame.', observations: [] }),
  });
  const owner = await session();
  const visitor = await session();
  const id = randomUUID();
  const path = 'clips/' + id;
  const fixture = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const options = { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'synthetic.mp4' }, body: fixture };
  const upload = () => owner.call(path + '?exercise=push-up&response=delta', options);
  await uploadFixture(owner, randomUUID());
  const inserted = await upload();
  assert.equal(inserted.status, 200);
  const [initial] = (await (await owner.call('workspace')).json()).clips.filter((clip) => clip.id === id);
  assert.deepEqual(initial.reviewStatus, { state: 'idle', sequence: 0 });
  assert.deepEqual(await inserted.json(), { clips: { upsert: [initial], remove: [] } });
  assert.deepEqual(await (await owner.call(path)).json(), initial);
  assert.equal((await visitor.call(path)).status, 404);
  assert.equal((await owner.call(path + '/review?background=1', { method: 'POST' })).status, 202);
  const done = await waitForState(async () => (await owner.call(path + '/review')).json(), 'complete');
  assert.deepEqual(await (await upload()).json(), { clips: { upsert: [{ ...initial, ...done }], remove: [] } });

  const relabel = path + '/exercise?response=delta';
  const change = payload('PUT', { exerciseId: 'incline-push-up', previousExerciseId: 'push-up' });
  assert.equal((await visitor.call(relabel, change)).status, 404);
  const updated = { ...initial, exerciseId: 'incline-push-up', review: null, reviewStatus: { state: 'idle', sequence: 2 } };
  assert.deepEqual(await (await owner.call(relabel, change)).json(), { clips: { upsert: [updated], remove: [] } });
  assert.deepEqual(await (await owner.call(relabel, change)).json(), { clips: { upsert: [updated], remove: [] } });
  assert.equal((await upload()).status, 409);
  const remove = { method: 'DELETE' };
  const deleted = { clips: { upsert: [], remove: [id] } };
  assert.deepEqual(await (await visitor.call(path + '?response=delta', remove)).json(), deleted);
  assert.equal((await owner.call(path + '/video')).status, 200);
  assert.deepEqual(await (await owner.call(path + '?response=delta', remove)).json(), deleted);
  assert.deepEqual(await (await owner.call(path + '?response=delta', remove)).json(), deleted);
  assert.equal((await owner.call(path + '/video')).status, 404);
  assert.equal((await owner.call(path)).status, 404);
  const replay = await owner.call(path + '?exercise=push-up&response=delta&protectDeleted=1', options);
  assert.equal(replay.status, 410);
  assert.match((await replay.json()).error, /removed in another tab/);
  assert.equal((await owner.call(path)).status, 404);
  assert.equal((await (await owner.call('workspace')).json()).clips.length, 1);
});

test('a server restart leaves an interrupted background review available to retry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-api-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'workspace.sqlite');
  const initial = await start(t, {
    database,
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: ({ signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  const browser = await initial.session();
  const id = randomUUID();
  await uploadFixture(browser, id);
  const path = 'clips/' + id + '/review';
  assert.equal((await browser.call(path + '?background=1', { method: 'POST' })).status, 202);
  await initial.close();

  const replacement = await start(t, { database });
  const reopened = await replacement.session(browser.cookie);
  assert.equal(reopened.data.clips[0].reviewStatus.state, 'failed');
  assert.match(reopened.data.clips[0].reviewStatus.error, /interrupted/);
});

test('cancelling a review preserves the video and allows a new analysis', async (t) => {
  let calls = 0;
  let aborted;
  const stopped = new Promise((resolve) => { aborted = resolve; });
  const { session } = await start(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: async ({ signal }) => {
      calls += 1;
      if (calls === 1) {
        await new Promise((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', resolve, { once: true });
        });
        aborted();
        throw signal.reason;
      }
      return { verdict: 'insufficient_visibility', summary: 'No person visible.', limitations: 'One still.', observations: [] };
    },
  });
  const owner = await session();
  const visitor = await session();
  const id = randomUUID();
  await uploadFixture(owner, id);
  const path = 'clips/' + id + '/review';
  const background = () => owner.call(path + '?background=1', { method: 'POST' });
  assert.equal((await background()).status, 202);
  assert.equal((await visitor.call(path, { method: 'DELETE' })).status, 404);
  const status = await (await owner.call(path, { method: 'DELETE' })).json();
  assert.deepEqual(status.reviewStatus, { state: 'cancelled', sequence: 1, startSeconds: 0 });
  await stopped;
  assert.equal((await owner.call('clips/' + id + '/video')).status, 200);
  assert.equal((await background()).status, 202);
  const done = await waitForState(async () => (await owner.call(path)).json(), 'complete');
  assert.equal(done.reviewStatus.sequence, 2);
});

async function waitForState(status, expected) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const data = await status();
    if (data.reviewStatus.state === expected) return data;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Review did not reach ' + expected);
}

async function uploadFixture(browser, id, exercise = 'push-up') {
  const response = await browser.call('clips/' + id + '?exercise=' + exercise, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'synthetic.mp4' },
    body: await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)),
  });
  assert.equal(response.status, 200);
}


test('static serving rejects environment-file and other hidden paths', async (t) => {
  const { url } = await start(t);
  for (const path of ['/.env', '/%2eenv', '/assets/.hidden']) {
    assert.equal((await fetch(url + path, { method: 'HEAD' })).status, 404);
  }
});

test('the local server rejects unconfigured hosts before accepting sign-up', async (t) => {
  const { url } = await start(t);
  const target = url + '/api/profiles';
  const init = payload('POST', { username: 'test-user' });
  const response = await new Promise((resolve, reject) => {
    httpRequest(target, {
      method: 'POST', headers: { ...init.headers, Host: 'rebound.example', Origin: 'http://rebound.example' },
    }, (result) => { result.resume(); resolve(result); }).on('error', reject).end(init.body);
  });
  assert.equal(response.statusCode, 421);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  assert.equal((await fetch(target, { ...init, headers: { ...init.headers, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(target, init)).status, 201);
});

test('the web server contains symlinks, validates shell freshness, and compresses fingerprinted assets', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'liftmorrow-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  await mkdir(dist);
  const body = 'console.log("liftmorrow");\n'.repeat(600);
  const asset = 'entry-0123456789abcdef0123456789abcdef.js';
  await Promise.all([
    writeFile(join(dist, 'index.html'), '<!doctype html><title>Liftmorrow</title>'),
    writeFile(join(dist, asset), body),
    writeFile(join(root, 'canary.txt'), 'should not be served'),
  ]);
  await symlink(join(root, 'canary.txt'), join(dist, 'download.txt'));
  const { url } = await start(t, { dist });
  assert.equal((await fetch(url + '/download.txt')).status, 404);
  assert.equal((await fetch(url + '/missing-route')).status, 404);
  const shell = await fetch(url + '/form-review/');
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-security-policy'), /frame-src https:\/\/www\.youtube-nocookie\.com/);
  assert.equal((await fetch(url + '/progress?exercise=push-up')).status, 200);
  assert.equal(shell.headers.get('cache-control'), 'no-cache');
  const checked = await fetch(url + '/', { headers: { 'If-None-Match': shell.headers.get('etag') } });
  assert.equal(checked.status, 304);
  assert.equal(await checked.text(), '');

  const assetUrl = url + '/' + asset;
  const compressed = await fetch(assetUrl, { headers: { 'Accept-Encoding': 'gzip;q=0.2, br' } });
  assert.equal(compressed.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  assert.equal(compressed.headers.get('content-encoding'), 'br');
  assert.ok(Number(compressed.headers.get('content-length')) < Buffer.byteLength(body));
  assert.equal(await compressed.text(), body);
  const gzipHead = await fetch(assetUrl, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip, br;q=0' } });
  assert.equal(gzipHead.headers.get('content-encoding'), 'gzip');
  assert.equal(await gzipHead.text(), '');
  const raw = await fetch(assetUrl, { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0' } });
  assert.equal(raw.headers.get('content-encoding'), null);
  assert.notEqual(raw.headers.get('etag'), compressed.headers.get('etag'));
  assert.equal(await raw.text(), body);
});

test('exercise notes, effort and trainer origin survive retries and training backup restore', async (t) => {
  const { session } = await start(t);
  const author = await session();
  const destination = await session();
  const delta = 'workouts?response=delta';
  const workout = { id: randomUUID(), name: 'Coach session', date: '2026-11-14', time: '10:00', status: 'completed',
    effort: 8, source: 'trainer', notes: 'Review technique.',
    exercises: [{ exerciseId: 'reverse-lunge', sets: 2, reps: 6, notes: 'Use a steady tempo.' }] };
  for (const patch of [{ effort: '8' }, { effort: 0 }, { effort: 10.5 }, { effort: 11 }, { status: 'planned' }, { source: 'unknown' },
    { exercises: [{ ...workout.exercises[0], notes: 'x'.repeat(501) }] }]) {
    assert.equal((await author.call(delta, payload('POST', { ...workout, ...patch }))).status, 400);
  }
  const save = () => author.call(delta, payload('POST', workout));
  const saved = (await (await save()).json()).workouts.upsert[0];
  assert.deepEqual(saved, { ...workout, revision: 1 });
  assert.equal((await save()).status, 200);
  const csv = await (await author.call('workouts/history.csv?feedback=1')).text();
  assert.match(csv, /Session source,Perceived effort \(1–10\),Exercise notes/);
  assert.match(csv, /Review technique\.,trainer,8,Use a steady tempo\./);
  const backup = await (await author.call('workspace/training-backup')).json();
  const restored = await (await destination.call('workspace/training-backup', payload('POST', backup))).json();
  assert.deepEqual(restored.workouts[0], saved);
  const editPath = 'workouts/' + workout.id + '?response=delta';
  const edit = { ...saved, effort: null, operationId: randomUUID() };
  const request = () => author.call(editPath, payload('PUT', edit));
  const cleared = (await (await request()).json()).workouts.upsert[0];
  assert.equal(cleared.effort, undefined);
  assert.equal(cleared.source, 'trainer');
  assert.equal(cleared.revision, 2);
  assert.equal((await request()).status, 200);
});
