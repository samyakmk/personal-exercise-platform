import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import jpeg from 'jpeg-js';
import { createTrainerPlusServer } from '../server/index.mjs';
import { createTestProfile } from './test-profile.mjs';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const still = jpeg.encode({ width: 2, height: 2, data: Buffer.from(Array(4).fill([60, 100, 145, 255]).flat()) }).data;

async function openServer(t, options = {}) {
  const server = createTrainerPlusServer({ database: ':memory:', respond: null, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await server.stopCoaching();
  });
  const api = `http://127.0.0.1:${server.address().port}/api/`;
  async function profile() {
    const cookie = await createTestProfile((path, init) => fetch(api + path, init));
    const state = await (await fetch(api + 'profiles', { headers: { Cookie: cookie } })).json();
    const key = state.active.workspaceKey;
    return {
      key,
      call: (path, init) => fetch(api + path, { ...init, headers: { Cookie: cookie, 'X-Trainer-Plus-Profile': key, ...init?.headers } }),
    };
  }
  return profile;
}

async function ok(response) {
  assert.ok(response.ok, `${response.status}: ${await response.clone().text()}`);
  return response.json();
}

test('profile archive previews conflicts, keeps review timestamps and restores optional media in a separate workspace', async (t) => {
  const video = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const profile = await openServer(t, {
    convertVideo: async () => video,
    sampleFrames: async (_, { startSeconds }) => [{ timestamp: startSeconds, image: still }, { timestamp: startSeconds + 0.5, image: still }],
    respond: async (request) => request.name === 'exercise_reference_match' ? { reference: 1 } : {
      verdict: 'observations', summary: '', observations: [{ frame: 2, comparisonFrame: 1, kind: 'adjustment',
        observation: 'The weights drift toward your face at the bottom.', cue: 'Stack your wrists over your elbows.' }],
    },
  });
  const owner = await profile();
  const target = await profile();
  const day = '2026-11-16';
  const workout = { id: randomUUID(), name: 'Trainer practice', date: day, time: '09:00', status: 'completed',
    source: 'trainer', effort: 5, skippedExerciseIds: ['push-up'],
    exercises: [{ exerciseId: 'dumbbell-bench-press', sets: 1, reps: 6, load: { value: 8, unit: 'kg' } }] };
  const saved = {
    displayName: 'Practice profile', trainingGoal: 'Remember the setup',
    trainingPreferences: { intake: 'completed', trainerNotes: 'Trainer message', experience: '', priorities: [], preferred: [], excluded: [],
      instructions: [{ id: randomUUID(), kind: 'cue', exerciseId: 'dumbbell-bench-press', text: 'Keep the setup consistent.' }] },
  };
  await ok(await owner.call('profiles/current', json('PUT', saved)));
  await ok(await owner.call('workouts', json('POST', workout)));
  await ok(await target.call('workouts', json('POST', { ...workout, name: 'Target revision' })));
  await ok(await owner.call('training-notes/' + randomUUID(), json('PUT', { kind: 'shorter', text: 'Shorter sessions this week' })));
  await ok(await owner.call('companion?day=' + day, json('POST', { id: randomUUID(), time: '10:00', text: 'Private check-in', adjustment: 'easier', wantsReply: false })));
  const clip = `clips/${randomUUID()}`;
  const original = await readFile(new URL('./fixtures/synthetic.mov', import.meta.url));
  const context = { sessionId: randomUUID(), workoutId: workout.id, exerciseId: 'dumbbell-bench-press', setNumber: 1 };
  await ok(await owner.call(`${clip}?exercise=dumbbell-bench-press&trainingContext=${encodeURIComponent(JSON.stringify(context))}`, {
    method: 'PUT', headers: { 'Content-Type': 'video/quicktime', 'X-Clip-Name': 'practice.mov' }, body: original,
  }));
  const reviews = [];
  for (const start of [0, 1]) {
    await ok(await owner.call(`${clip}/review?background=1&start=${start}`, { method: 'POST' }));
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = await ok(await owner.call(clip + '/review'));
      if (state.reviewStatus.state === 'complete') {
        reviews.push(state.review);
        break;
      }
      assert.equal(state.reviewStatus.state, 'running');
      await delay(10);
    }
  }
  assert.equal(reviews.length, 2);
  const archivePath = 'workspace/profile-archive';
  const metadata = await ok(await owner.call(archivePath));
  assert.equal(metadata.clips[0].history.length, 1);
  assert.equal(metadata.clips[0].data, undefined);
  assert.deepEqual(metadata.profile, saved);
  assert.equal((await target.call(archivePath, { headers: { 'X-Trainer-Plus-Profile': owner.key } })).status, 409);

  const restore = (mode, body) => target.call(archivePath + '?mode=' + mode, json('POST', body)).then(ok);
  const preview = (await restore('preview', metadata)).records;
  assert.equal(preview.workouts.conflict, 1);
  assert.equal(preview.checkIns.add, 1);
  assert.equal(preview.clips.add, 1);
  assert.equal(preview.videos.add, 0);
  assert.deepEqual((await ok(await target.call('workspace'))).clips, []);
  const malformed = structuredClone(metadata);
  malformed.clips[0].review.observationFrame = { reference: { ...malformed.clips[0].review.observationFrame.reference, source: 'javascript:alert(1)' } };
  assert.equal((await target.call(archivePath + '?mode=restore', json('POST', malformed))).status, 400);

  assert.deepEqual((await restore('restore', metadata)).records, preview);
  assert.equal((await ok(await target.call('workspace'))).workouts[0].name, 'Target revision');
  assert.deepEqual((await ok(await target.call('profiles'))).active.details, saved);
  assert.deepEqual((await ok(await target.call(clip + '/reviews'))).reviews, reviews.toReversed());
  assert.equal((await target.call(clip + '/video')).status, 404);
  assert.deepEqual(Buffer.from(await (await target.call(`${clip}/review-still?sequence=${reviews[0].sequence}`)).arrayBuffer()), still);

  const full = await ok(await owner.call(archivePath + '?media=all'));
  assert.deepEqual(full.clips[0].trainingContext, context);
  assert.equal((await restore('restore', full)).records.videos.add, 1);
  assert.deepEqual(Buffer.from(await (await target.call(clip + '/video')).arrayBuffer()), video);
  assert.equal((await restore('restore', full)).records.videos.same, 1);
  assert.equal((await restore('preview', full)).records.clips.same, 1);
});

test('workspace bootstrap includes the current plan and referenced exercises and versions the separate catalog', async (t) => {
  const createProfile = await openServer(t);
  const profile = await createProfile();
  const headers = { 'X-Trainer-Plus-Catalog': 'defer' };
  const response = await profile.call('workspace', { headers });
  const bootstrap = await ok(response);
  const full = await ok(await profile.call('exercise-catalog'));
  assert.equal(bootstrap.catalogVersion, full.catalogVersion);
  assert.ok(full.catalog.length > bootstrap.catalog.length * 10);
  assert.ok(bootstrap.catalog.some(({ id }) => id === 'bodyweight-squat'));
  const workout = { id: randomUUID(), name: 'Planned with another movement', date: '2026-11-30', time: '09:00', status: 'planned',
    exercises: [{ exerciseId: full.catalog.find(({ id }) => !bootstrap.catalog.some((item) => item.id === id)).id, sets: 3, reps: 10 }] };
  await ok(await profile.call('workouts', json('POST', workout)));
  const changed = await ok(await profile.call('workspace', { headers: { ...headers, 'If-None-Match': response.headers.get('etag') } }));
  assert.ok(changed.catalog.some(({ id }) => id === workout.exercises[0].exerciseId));
  const unchanged = await profile.call('workspace', { headers: { ...headers, 'If-None-Match': (await profile.call('workspace', { headers })).headers.get('etag') } });
  assert.equal(unchanged.status, 304);
});
