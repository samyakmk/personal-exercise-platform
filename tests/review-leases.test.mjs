import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { reviewVersion } from '../server/coaching.mjs';
import { createLiftmorrowServer } from '../server/index.mjs';
import { activeWorkspaceId, createTestProfile } from './test-profile.mjs';

const sampleFrames = async () => [{ timestamp: 0, image: Buffer.from('fixture') }];
const feedback = (summary) => ({ verdict: 'insufficient_visibility', summary, limitations: 'One still frame.', observations: [] });

async function sharedDatabase(t) {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-review-lease-'));
  const database = join(directory, 'workspace.sqlite');
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(async (server) => {
      if (server.listening) {
        const closed = once(server, 'close');
        server.close();
        server.closeAllConnections();
        await closed;
      }
      await server.stopCoaching();
    }));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    database,
    async start(options) {
      const server = createLiftmorrowServer({ database, sampleFrames, ...options });
      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const origin = `http://127.0.0.1:${server.address().port}/api/`;
      return {
        server,
        call(path, cookie, options) {
          return fetch(origin + path, { ...options, headers: { ...(cookie && { Cookie: cookie }), ...options?.headers } });
        },
      };
    },
  };
}

function workspace(instance) {
  return createTestProfile((path, options) => instance.call(path, null, options));
}

async function upload(instance, cookie) {
  const id = randomUUID();
  const clip = 'clips/' + id;
  const response = await instance.call(clip + '?exercise=reverse-lunge', cookie, {
    method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'synthetic.mp4' },
    body: await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)),
  });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  return { id, clip, review: clip + '/review' };
}

function begin(instance, cookie, clip, suffix = '') {
  return instance.call(clip.review + '?background=1' + suffix, cookie, { method: 'POST' });
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const value = await check();
    if (value) return value;
    await delay(20);
  }
  assert.fail('Timed out waiting for the expected lease state');
}

function status(instance, cookie, clip, state) {
  return waitFor(async () => {
    const result = await (await instance.call(clip.review, cookie)).json();
    return result.reviewStatus?.state === state && result;
  });
}

test('two instances renew and join one review, with a shared active review limit', { timeout: 6000 }, async (t) => {
  const { database, start } = await sharedDatabase(t);
  const released = Promise.withResolvers();
  const began = Promise.withResolvers();
  let calls = 0;
  const respond = async ({ signal }) => {
    calls += 1;
    began.resolve();
    await Promise.race([released.promise, once(signal, 'abort')]);
    return feedback('Visible result.');
  };
  const first = await start({ respond, reviewLeaseMs: 10_000, reviewHeartbeatMs: 40 });
  const second = await start({ respond });
  const cookie = await workspace(first);
  const clips = [];
  for (let index = 0; index < 4; index += 1) clips.push(await upload(first, cookie));
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  const expiry = db.prepare('SELECT lease_until AS expiry FROM clip_review_attempt WHERE clip_id = ?');
  const [clip] = clips;
  assert.equal((await begin(first, cookie, clip)).status, 202);
  await began.promise;
  const initial = expiry.get(clip.id).expiry;
  await waitFor(() => expiry.get(clip.id).expiry > initial);
  const remote = await begin(second, cookie, clip);
  assert.equal(remote.status, 202);
  assert.deepEqual((await remote.json()).reviewStatus, { state: 'running', sequence: 1, startSeconds: 0 });
  const snapshot = await (await second.call('workspace', cookie)).json();
  const remoteClip = snapshot.clips.find(({ id }) => id === clip.id);
  assert.equal(remoteClip.reviewStatus.state, 'running');
  assert.equal('attempt' in remoteClip, false);
  assert.equal((await begin(second, cookie, clip, '&start=2')).status, 409);
  const relabel = await second.call(clip.clip + '/exercise', cookie, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId: 'push-up', previousExerciseId: 'reverse-lunge' }),
  });
  assert.equal(relabel.status, 409);
  assert.equal((await begin(first, cookie, clips[1])).status, 202);
  assert.equal((await begin(second, cookie, clips[2])).status, 202);
  const busy = await begin(second, cookie, clips[3]);
  assert.equal(busy.status, 429);
  assert.ok(Number(busy.headers.get('retry-after')) > 0);

  const sync = second.call(clip.review, cookie, { method: 'POST' }).then((response) => ({ response }));
  assert.equal(await Promise.race([sync, delay(40, 'waiting')]), 'waiting');
  released.resolve();
  const { response: joined } = await sync;
  assert.equal(joined.status, 200);
  assert.deepEqual(await joined.json(), (await status(first, cookie, clip, 'complete')).review);
  assert.equal(calls, 3);
});

test('remote cancellation and deletion revoke ownership and abort the original worker', { timeout: 6000 }, async (t) => {
  const { start } = await sharedDatabase(t);
  const entered = [Promise.withResolvers(), Promise.withResolvers()];
  let calls = 0;
  const owner = await start({ reviewHeartbeatMs: 30, respond: async ({ signal }) => {
    const call = entered[calls++];
    call.resolve(signal);
    if (!signal.aborted) await once(signal, 'abort');
    return feedback('Stale result.');
  } });
  const peer = await start({ respond: async () => feedback('New result.') });
  const cookie = await workspace(owner);
  const clip = await upload(owner, cookie);
  assert.equal((await begin(owner, cookie, clip)).status, 202);
  const signal = await entered[0].promise;
  const cancelled = await peer.call(clip.review, cookie, { method: 'DELETE' });
  assert.deepEqual((await cancelled.json()).reviewStatus, { state: 'cancelled', sequence: 1, startSeconds: 0 });
  if (!signal.aborted) await once(signal, 'abort');
  assert.equal(signal.reason.status, 409);
  assert.equal((await begin(peer, cookie, clip)).status, 202);
  const done = await status(owner, cookie, clip, 'complete');
  assert.equal(done.reviewStatus.sequence, 2);
  assert.equal(done.review.summary, 'New result.');

  assert.equal((await begin(owner, cookie, clip, '&refresh=1')).status, 202);
  const deletedSignal = await entered[1].promise;
  assert.equal((await peer.call(clip.clip, cookie, { method: 'DELETE' })).status, 200);
  if (!deletedSignal.aborted) await once(deletedSignal, 'abort');
  assert.equal(deletedSignal.reason.status, 404);
  assert.equal((await owner.call(clip.review, cookie)).status, 404);
});

test('a delayed cancellation cannot cancel a newer review on another server', { timeout: 6000 }, async (t) => {
  const { start } = await sharedDatabase(t);
  const began = Promise.withResolvers();
  const first = await start({ respond: async () => feedback('First section.') });
  const second = await start({ respond: async ({ signal }) => {
    began.resolve(signal);
    if (!signal.aborted) await once(signal, 'abort');
    return feedback('The second section was cancelled.');
  } });
  const cookie = await workspace(first);
  const clip = await upload(first, cookie);
  assert.equal((await begin(first, cookie, clip)).status, 202);
  assert.equal((await status(first, cookie, clip, 'complete')).reviewStatus.sequence, 1);
  assert.equal((await begin(second, cookie, clip, '&start=1')).status, 202);
  const signal = await began.promise;
  const cancel = (sequence) => first.call(clip.review + '?sequence=' + sequence, cookie, { method: 'DELETE' });
  for (const invalid of ['', '0', '1.5', '9007199254740992']) {
    assert.equal((await cancel(invalid)).status, 400);
  }
  const stale = await cancel(1);
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /changed before it could be cancelled/);
  assert.equal(signal.aborted, false);
  assert.deepEqual((await status(second, cookie, clip, 'running')).reviewStatus, { state: 'running', sequence: 2, startSeconds: 1 });
  const matched = await cancel(2);
  assert.equal(matched.status, 200);
  const snapshot = await matched.json();
  assert.deepEqual(snapshot.reviewStatus, { state: 'cancelled', sequence: 2, startSeconds: 1 });
  assert.equal(snapshot.review.summary, 'First section.');
});

test('an expired owner cannot publish after takeover and graceful stop releases owned leases', { timeout: 6000 }, async (t) => {
  const { start } = await sharedDatabase(t);
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const owner = await start({ reviewLeaseMs: 250, reviewHeartbeatMs: 1_500, respond: async () => {
    entered.resolve();
    await released.promise;
    return feedback('Stale result.');
  } });
  const peer = await start({ respond: async () => feedback('Replacement result.') });
  const cookie = await workspace(owner);
  const clip = await upload(owner, cookie);
  const previous = owner.call(clip.review, cookie, { method: 'POST' });
  await entered.promise;
  try {
    assert.equal((await status(peer, cookie, clip, 'failed')).reviewStatus.sequence, 1);
    assert.equal((await begin(peer, cookie, clip)).status, 202);
    const result = await status(peer, cookie, clip, 'complete');
    assert.equal(result.reviewStatus.sequence, 2);
    assert.equal(result.review.summary, 'Replacement result.');
  } finally {
    released.resolve();
  }
  assert.equal((await previous).status, 409);
  assert.equal((await status(owner, cookie, clip, 'complete')).review.summary, 'Replacement result.');

  const blocked = await start({ respond: async ({ signal }) => {
    if (!signal.aborted) await once(signal, 'abort');
    return feedback('Shut down.');
  } });
  assert.equal((await begin(blocked, cookie, clip, '&refresh=1')).status, 202);
  await blocked.server.stopCoaching();
  const failed = await status(peer, cookie, clip, 'failed');
  assert.equal(failed.reviewStatus.sequence, 3);
  assert.match(failed.reviewStatus.error, /interrupted/);
  assert.equal(failed.review.summary, 'Replacement result.');
});

test('an attempt row created before lease support stays available to retry', { timeout: 6000 }, async (t) => {
  const { database, start } = await sharedDatabase(t);
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE clip_review_attempt (
    workspace_id TEXT NOT NULL, clip_id TEXT NOT NULL, version INTEGER NOT NULL, sequence INTEGER NOT NULL,
    start_seconds INTEGER NOT NULL DEFAULT 0, error TEXT, PRIMARY KEY (workspace_id, clip_id),
    FOREIGN KEY (workspace_id, clip_id) REFERENCES clip(workspace_id, id) ON DELETE CASCADE
  )`);
  const peer = await start({ respond: async () => feedback('Retry result.') });
  const cookie = await workspace(peer);
  const clip = await upload(peer, cookie);
  db.prepare('INSERT INTO clip_review_attempt (workspace_id, clip_id, version, sequence) VALUES (?, ?, ?, 4)')
    .run(activeWorkspaceId(db, cookie), clip.id, reviewVersion);
  db.close();
  const failed = await status(peer, cookie, clip, 'failed');
  assert.equal(failed.reviewStatus.sequence, 4);
  assert.equal((await begin(peer, cookie, clip)).status, 202);
  assert.equal((await status(peer, cookie, clip, 'complete')).reviewStatus.sequence, 5);
});
