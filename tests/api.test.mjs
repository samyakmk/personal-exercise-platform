import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRepformServer } from '../server/index.mjs';

async function start(t) {
  const server = createRepformServer({ database: ':memory:' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((done) => server.close(done)));
  const root = `http://127.0.0.1:${server.address().port}/api/`;
  async function session() {
    const response = await fetch(root + 'workspace?today=2026-11-12');
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return {
      data: await response.json(),
      call(path, init) {
        return fetch(root + path, { ...init, headers: { cookie, ...init?.headers } });
      },
    };
  }
  return { session };
}

function payload(method, body) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

test('filters require all exercise equipment, match multiple muscles, and persist preferences', async (t) => {
  const { session } = await start(t);
  const browser = await session();
  assert.equal(browser.data.catalog.length, 6);
  assert.equal(browser.data.workouts.length, 5);
  assert.deepEqual(browser.data.catalog.map((exercise) => exercise.demonstration.videoId.length), Array(6).fill(11));
  assert.equal((await browser.call('equipment', payload('PUT', { selected: ['Dumbbells'] }))).status, 200);
  const results = await (await browser.call('exercises?equipment=saved&muscle=Legs&muscle=Chest')).json();
  assert.deepEqual(new Set(results.map((entry) => entry.id)), new Set(['goblet-squat', 'push-up', 'reverse-lunge']));
  assert.deepEqual(await (await browser.call('exercises?equipment=bodyweight&muscle=Back')).json(), []);
  assert.deepEqual((await (await browser.call('workspace')).json()).equipment, ['Dumbbells']);
  assert.equal((await browser.call('exercises?equipment=all&muscle=Unknown')).status, 400);
});

test('workouts validate, create idempotently, convert to completed, and delete within their workspace', async (t) => {
  const { session } = await start(t);
  const owner = await session();
  const visitor = await session();
  const id = randomUUID();
  const workout = {
    id, name: 'Weekend workout', date: '2026-11-14', time: '08:30', status: 'planned',
    exercises: [{ exerciseId: 'goblet-squat', sets: 3, reps: 10 }],
  };
  assert.equal((await owner.call('workouts', payload('POST', { ...workout, date: '2026-02-30' }))).status, 400);
  assert.equal((await owner.call('workouts', payload('POST', { ...workout, exercises: [] }))).status, 400);
  assert.equal((await owner.call('workouts', payload('POST', workout))).status, 200);
  const retry = await (await owner.call('workouts', payload('POST', workout))).json();
  assert.equal(retry.workouts.filter((item) => item.id === id).length, 1);
  const logged = { ...workout, status: 'completed', exercises: [{ exerciseId: 'goblet-squat', sets: 2, reps: 8 }] };
  assert.equal((await visitor.call('workouts/' + id, payload('PUT', logged))).status, 404);
  const saved = await (await owner.call('workouts/' + id, payload('PUT', logged))).json();
  assert.deepEqual(saved.workouts.find((item) => item.id === id), logged);
  assert.equal((await visitor.call('workouts/' + id, { method: 'DELETE' })).status, 200);
  assert.ok((await (await owner.call('workspace')).json()).workouts.some((item) => item.id === id));
  const deleted = await (await owner.call('workouts/' + id, { method: 'DELETE' })).json();
  assert.ok(!deleted.workouts.some((item) => item.id === id));
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
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: new Uint8Array(50 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await owner.call(upload, { method: 'PUT', headers, body: bytes })).status, 200);
  const retry = await (await owner.call(upload, { method: 'PUT', headers, body: bytes })).json();
  assert.equal(retry.clips.length, 1);
  assert.equal(retry.clips[0].filename, 'synthetic.mp4');
  const range = await owner.call(video, { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), `bytes 0-15/${bytes.length}`);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 16));
  assert.equal((await owner.call(video, { headers: { Range: 'bytes=999999-1000000' } })).status, 416);
  assert.equal((await visitor.call(video)).status, 404);
  assert.equal((await visitor.call('clips/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await owner.call(video)).status, 200);
  assert.equal((await owner.call('clips/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await owner.call(video)).status, 404);
});
