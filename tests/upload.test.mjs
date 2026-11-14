import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createLiftmorrowServer } from '../server/index.mjs';

async function start(t, options) {
  const server = createLiftmorrowServer({ database: ':memory:', respond: null, ...options });
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/api/`;
}

async function workspace(api) {
  const response = await fetch(api + 'workspace');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  await response.arrayBuffer();
  return cookie;
}

const clipHeaders = (cookie, mime = 'video/mp4') => ({
  Cookie: cookie, 'Content-Type': mime, 'X-Clip-Name': mime === 'video/mp4' ? 'exercise.mp4' : 'exercise.mov',
});

test('an idle upload returns 408, releases its slot, and can be retried', { timeout: 6000 }, async (t) => {
  const api = await start(t, { uploadIdleTimeoutMs: 1_000 });
  const bytes = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const cookie = await workspace(api);
  const clip = api + 'clips/' + randomUUID();
  const url = clip + '?exercise=push-up';
  const headers = clipHeaders(cookie);
  const stalled = request(url, { method: 'PUT', headers: { ...headers, 'Content-Length': bytes.length } });
  t.after(() => stalled.destroy());
  const timeout = once(stalled, 'response');
  stalled.write(bytes.subarray(0, 1));

  let retryAfter = 0;
  for (let attempt = 0; attempt < 20 && !retryAfter; attempt += 1) {
    const probe = await fetch(url, { method: 'PUT', headers, body: new Uint8Array([0]) });
    if (probe.status === 429) retryAfter = Number(probe.headers.get('retry-after'));
    else assert.equal(probe.status, 415);
    await probe.arrayBuffer();
    if (!retryAfter) await setTimeout(10);
  }
  assert.ok(retryAfter > 0);

  const [response] = await timeout;
  assert.equal(response.statusCode, 408);
  assert.equal(response.headers.connection, 'close');
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  assert.match(JSON.parse(Buffer.concat(chunks)).error, /stopped sending data/);
  const missing = await fetch(clip + '/video', { headers: { Cookie: cookie } });
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  const retried = await fetch(url, { method: 'PUT', headers, body: bytes });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).clips.length, 1);
});

test('new workspace databases use private permissions and deleted clip payload is scrubbed on checkpoint', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-clip-delete-'));
  const database = join(directory, 'workspace.sqlite');
  const api = await start(t, { database });
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal((await stat(database)).mode & 0o777, 0o600);
  const fixture = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const marker = Buffer.from(randomUUID());
  const extra = Buffer.alloc(1024 * 1024, marker);
  extra.writeUInt32BE(extra.length);
  extra.write('free', 4, 'ascii');
  const cookie = await workspace(api);
  const path = api + 'clips/' + randomUUID();
  const upload = await fetch(path + '?exercise=push-up', { method: 'PUT', headers: clipHeaders(cookie), body: Buffer.concat([fixture, extra]) });
  assert.equal(upload.status, 200);
  await upload.arrayBuffer();
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.ok((await readFile(database)).includes(marker));
    const removed = await fetch(path, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(removed.status, 200);
    await removed.arrayBuffer();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    assert.equal((await readFile(database)).includes(marker), false);
  } finally { db.close(); }
});

test('simultaneous uploads on separate server instances verify the winning bytes', { timeout: 6000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'liftmorrow-upload-race-'));
  const database = join(root, 'workspace.sqlite');
  const playable = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  const source = Buffer.from(playable);
  source.write('qt  ', source.indexOf('ftyp') + 4, 'ascii');
  const changed = Buffer.from(source);
  changed[changed.indexOf('mdat') + 5] ^= 1;
  let conversions;
  const serve = async (index) => start(t, { database, convertVideo: async () => {
    const { arrived, released } = conversions[index];
    arrived.resolve();
    await released.promise;
    return playable;
  } });
  const servers = [await serve(0), await serve(1)];
  t.after(() => rm(root, { recursive: true, force: true }));
  const cookie = await workspace(servers[0]);
  const headers = clipHeaders(cookie, 'video/quicktime');

  for (const [bytes, exercise, status, message] of [
    [source, 'push-up', 200],
    [changed, 'push-up', 409, /already used/],
    [source, 'goblet-squat', 409, /different details/],
  ]) {
    conversions = Array.from({ length: 2 }, () => ({ arrived: Promise.withResolvers(), released: Promise.withResolvers() }));
    const clip = 'clips/' + randomUUID();
    const upload = (index, body, exerciseId) => fetch(servers[index] + clip + '?response=delta&exercise=' + exerciseId,
      { method: 'PUT', headers, body });
    const first = upload(0, source, 'push-up');
    const second = upload(1, bytes, exercise);
    try {
      await Promise.all(conversions.map(({ arrived }) => arrived.promise));
      conversions[0].released.resolve();
      const winner = await first;
      assert.equal(winner.status, 200);
      const winningDelta = await winner.json();
      assert.deepEqual(Object.keys(winningDelta), ['clips']);
      assert.deepEqual(winningDelta.clips.remove, []);
      assert.equal(winningDelta.clips.upsert.length, 1);
      assert.equal(winningDelta.clips.upsert[0].exerciseId, 'push-up');
      conversions[1].released.resolve();
      const loser = await second;
      assert.equal(loser.status, status);
      if (message) assert.match((await loser.json()).error, message);
      else assert.deepEqual(await loser.json(), winningDelta);
    } finally {
      for (const { released } of conversions) released.resolve();
    }
  }
});
