import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { AiError } from '../server/ai.mjs';
import { reviewVersion } from '../server/coaching.mjs';
import { createLiftmorrowServer } from '../server/index.mjs';

const feedback = (summary) => ({ verdict: 'insufficient_visibility', summary, limitations: 'Single frame.', observations: [] });

async function setup(t, respond, database = ':memory:') {
  const server = createLiftmorrowServer({ database, respond, sampleFrames: async (_, { startSeconds }) => [
    { timestamp: startSeconds, image: Buffer.from('synthetic') },
  ] });
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await server.stopCoaching();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}/api/`;
  async function workspace() {
    const response = await fetch(api + 'workspace');
    const cookie = response.headers.get('set-cookie').split(';')[0];
    await response.arrayBuffer();
    return { cookie, call: (path, options) => fetch(api + path, { ...options, headers: { Cookie: cookie, ...options?.headers } }) };
  }
  const owner = await workspace();
  const id = randomUUID();
  const clip = 'clips/' + id;
  const review = clip + '/review';
  const history = clip + '/reviews';
  const uploaded = await owner.call(clip + '?exercise=reverse-lunge', { method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'synthetic.mp4' },
    body: await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)),
  });
  assert.equal(uploaded.status, 200);
  await uploaded.arrayBuffer();
  return { owner, workspace, id, clip, review, history, api, server };
}

async function startReview(owner, path, startSeconds, refresh = false) {
  const response = await owner.call(path + '?background=1&start=' + startSeconds + (refresh ? '&refresh=1' : ''), { method: 'POST' });
  assert.equal(response.status, 202);
  return (await response.json()).reviewStatus.sequence;
}

async function waitForStatus(owner, path, state) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await (await owner.call(path)).json();
    if (result.reviewStatus?.state === state) return result;
    await delay(15);
  }
  assert.fail('Review never reached ' + state);
}

async function reviews(owner, path) {
  const response = await owner.call(path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return (await response.json()).reviews;
}

test('review history replaces the same section and preserves successful sections through failures and cancellation', async (t) => {
  let mode = 'complete';
  let call = 0;
  const { owner, workspace, clip, review, history, api } = await setup(t, async ({ signal }) => {
    call += 1;
    if (mode === 'fail') throw new AiError(503, 'Temporary model failure.');
    if (mode === 'hold' && !signal.aborted) await once(signal, 'abort');
    return feedback('Successful call ' + call);
  });
  const other = await workspace();
  assert.deepEqual(await reviews(owner, history), []);
  assert.equal((await other.call(history)).status, 404);
  assert.equal((await fetch(api + history)).status, 404);

  assert.equal(await startReview(owner, review, 0), 1);
  const first = (await waitForStatus(owner, review, 'complete')).review;
  assert.equal(await startReview(owner, review, 10), 2);
  const second = (await waitForStatus(owner, review, 'complete')).review;
  assert.deepEqual(await reviews(owner, history), [second, first]);
  assert.equal(await startReview(owner, review, 0, true), 3);
  const latest = (await waitForStatus(owner, review, 'complete')).review;
  assert.deepEqual(await reviews(owner, history), [latest, second]);
  assert.equal(latest.startSeconds, 0);

  mode = 'fail';
  assert.equal(await startReview(owner, review, 10, true), 4);
  assert.deepEqual((await waitForStatus(owner, review, 'failed')).review, latest);
  assert.deepEqual(await reviews(owner, history), [latest, second]);
  mode = 'hold';
  assert.equal(await startReview(owner, review, 10, true), 5);
  const cancelled = await owner.call(review, { method: 'DELETE' });
  assert.equal((await cancelled.json()).reviewStatus.state, 'cancelled');
  assert.deepEqual(await reviews(owner, history), [latest, second]);

  const changed = await owner.call(clip + '/exercise', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId: 'push-up', previousExerciseId: 'reverse-lunge' }),
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(await reviews(owner, history), []);
  assert.deepEqual((await (await owner.call(review)).json()).reviewStatus, { state: 'idle', sequence: 6 });
});

test('review history includes a pre-migration review, stores only ten sections, and is deleted with the clip', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-legacy-review-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'workspace.sqlite');
  const old = new DatabaseSync(database);
  old.exec(`CREATE TABLE clip_review (workspace_id TEXT NOT NULL, clip_id TEXT NOT NULL, review TEXT NOT NULL,
    PRIMARY KEY (workspace_id, clip_id), FOREIGN KEY (workspace_id, clip_id) REFERENCES clip(workspace_id, id) ON DELETE CASCADE)`);
  old.close();
  const { owner, id, clip, review, history } = await setup(t, async () => feedback('Visible section.'), database);
  const legacy = { ...feedback('Pre-migration result.'), framesReviewed: 1, windowSeconds: 20, reviewedAt: '2026-11-13T00:00:00Z', version: reviewVersion - 1 };
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  const workspaceId = owner.cookie.split('=')[1];
  db.prepare('INSERT INTO clip_review VALUES (?, ?, ?)').run(workspaceId, id, JSON.stringify(legacy));
  assert.deepEqual(await reviews(owner, history), [legacy]);
  for (let offset = 1; offset <= 6; offset += 1) {
    await startReview(owner, review, offset);
    await waitForStatus(owner, review, 'complete');
  }
  assert.equal((await reviews(owner, history)).at(-1).summary, legacy.summary);
  const peer = await setup(t, async () => feedback('Visible section.'), database);
  const sameWorkspace = { call: (path, options) => fetch(peer.api + path, { ...options, headers: { Cookie: owner.cookie, ...options?.headers } }) };
  for (let offset = 7; offset <= 11; offset += 1) {
    await startReview(sameWorkspace, review, offset);
    await waitForStatus(sameWorkspace, review, 'complete');
  }
  assert.deepEqual((await reviews(owner, history)).map(({ startSeconds }) => startSeconds), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const archived = db.prepare('SELECT count(*) AS size FROM clip_review_history WHERE clip_id = ?');
  assert.equal(archived.get(id).size, 9);
  assert.equal((await owner.call(clip, { method: 'DELETE' })).status, 200);
  assert.equal((await sameWorkspace.call(history)).status, 404);
  assert.equal(archived.get(id).size, 0);
});
