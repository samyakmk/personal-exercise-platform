import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createLiftmorrowServer } from '../server/index.mjs';
import { createTestProfile } from './test-profile.mjs';

const webOrigin = 'https://liftmorrow.test';
const condition = (tag) => ({ headers: { 'If-None-Match': tag } });
const payload = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function start(t, options) {
  const server = createLiftmorrowServer({ database: ':memory:', respond: null, webOrigin, ...options });
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
  return (path = 'workspace', cookie, options) => fetch(api + path, {
    ...options, headers: { ...(cookie && { Cookie: cookie }), ...options?.headers },
  });
}

const profileCookie = (call, legacy) => createTestProfile((path, init) => call(path, null, init), legacy);

async function getTag(response) {
  assert.equal(response.status, 200);
  const tag = response.headers.get('etag');
  assert.match(tag, /^W\/"[a-f\d]{64}"$/);
  await response.arrayBuffer();
  return tag;
}

test('workspace validators are private, cookie-scoped and available to configured cross-origin clients', async (t) => {
  const call = await start(t);
  const cookie = await profileCookie(call);
  const tag = await getTag(await call('workspace', cookie));
  const otherCookie = await profileCookie(call);
  const other = await call('workspace', otherCookie, condition(tag));
  const otherTag = await getTag(other);
  assert.notEqual(otherTag, tag);
  assert.equal(await getTag(await call('workspace', otherCookie, condition(tag))), otherTag);
  const fakeCookie = 'liftmorrow_workspace=' + randomUUID();
  const denied = await call('workspace', fakeCookie, condition('*'));
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get('set-cookie'), null);

  const originHeaders = { Origin: webOrigin, 'If-None-Match': '"invalid", ' + tag.slice(2) };
  const matched = await call('workspace', cookie, { headers: originHeaders });
  assert.equal(matched.status, 304);
  assert.equal(await matched.text(), '');
  assert.equal(matched.headers.get('cache-control'), 'private, no-store');
  assert.equal(matched.headers.get('etag'), tag);
  assert.equal(matched.headers.get('set-cookie'), null);
  assert.match(matched.headers.get('vary'), /Cookie/);
  assert.equal(matched.headers.get('access-control-allow-origin'), webOrigin);
  assert.match(matched.headers.get('access-control-expose-headers'), /ETag/);
  const malformed = await call('workspace', cookie, condition(tag + 'anything'));
  assert.equal(await getTag(malformed), tag);
  const preflight = await call('workspace', null, { method: 'OPTIONS', headers: {
    Origin: webOrigin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'If-None-Match',
  } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /If-None-Match/);
});

test('sign-up claims an older workspace without changing its draft key', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-workspace-legacy-profile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'workspace.sqlite');
  const id = randomUUID();
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE workspace (id TEXT PRIMARY KEY, equipment TEXT)');
  db.prepare('INSERT INTO workspace (id, equipment) VALUES (?, ?)').run(id, '["Dumbbells"]');
  db.close();
  const call = await start(t, { database, secureCookies: true });
  const legacy = 'repform_workspace=' + id;
  assert.equal((await (await call('profiles', legacy)).json()).canImportLegacy, true);
  assert.equal((await call('workspace', legacy)).status, 404);
  const signup = await call('profiles', legacy, payload('POST', { username: 'legacy-user' }));
  assert.equal(signup.status, 201);
  const [issued, expired] = signup.headers.getSetCookie();
  assert.match(issued, /^liftmorrow_browser=[a-f0-9]{64};.*HttpOnly.*SameSite=Lax.*Secure/);
  assert.match(expired, /^repform_workspace=;.*Secure.*Max-Age=0$/);
  const cookie = issued.split(';')[0];
  const { active } = await signup.json();
  const adopted = await (await call('workspace', cookie)).json();
  assert.equal(adopted.workspaceKey, createHash('sha256').update('repform-local-drafts:' + id).digest('hex').slice(0, 24));
  assert.equal(active.workspaceKey, adopted.workspaceKey);
  assert.deepEqual(adopted.equipment, ['Dumbbells']);
  assert.equal((await (await call('profiles', legacy)).json()).canImportLegacy, false);
  const otherCookie = await profileCookie(call, legacy);
  assert.deepEqual((await (await call('workspace', otherCookie)).json()).equipment, null);
});

test('a large workspace supports gzip and identity with the same private weak validator', async (t) => {
  const call = await start(t);
  const cookie = await profileCookie(call);
  const sample = { name: 'Synthetic workout', date: '2026-11-13', time: '10:00', status: 'completed',
    notes: 'Keep the same setup. '.repeat(35), exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }] };
  const workouts = Array.from({ length: 16 }, () => ({ ...sample, id: randomUUID() }));
  const restore = await call('workspace/training-backup', cookie,
    payload('POST', { format: 'liftmorrow-training', version: 1, equipment: null, workouts }));
  assert.equal(restore.status, 200);
  await restore.arrayBuffer();

  const identity = await call('workspace', cookie, { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } });
  const coded = await call('workspace', cookie, { headers: { 'Accept-Encoding': 'gzip' } });
  const tag = identity.headers.get('etag');
  assert.equal(identity.headers.get('content-encoding'), null);
  assert.equal(coded.headers.get('content-encoding'), 'gzip');
  assert.equal(coded.headers.get('etag'), tag);
  assert.ok(Number(coded.headers.get('content-length')) < Number(identity.headers.get('content-length')) / 3);
  assert.match(coded.headers.get('vary'), /Accept-Encoding/);
  assert.equal(coded.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await coded.json(), await identity.json());
  const matched = await call('workspace', cookie, { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': tag } });
  assert.equal(matched.status, 304);
  assert.equal(matched.headers.get('content-encoding'), null);
});

test('validators invalidate across SQLite instances for settings, workouts, and review changes or expiry', { timeout: 6000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-workspace-condition-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'workspace.sqlite');
  const server = await start(t, { database });
  const responder = { respond: async ({ signal }) => {
    if (!signal.aborted) await once(signal, 'abort');
    throw signal.reason;
  }, sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }] };
  const writer = await start(t, { database, ...responder });
  const peer = await start(t, { database, ...responder });
  const cookie = await profileCookie(writer);
  let tag = await getTag(await writer('workspace', cookie));
  assert.equal((await peer('workspace', cookie, condition(tag))).status, 304);
  assert.notEqual(await getTag(await server('workspace', cookie, condition(tag))), tag);
  const changed = async (request) => {
    const response = await request;
    assert.ok(response.ok);
    await response.arrayBuffer();
    const next = await getTag(await peer('workspace', cookie, condition(tag)));
    assert.notEqual(next, tag);
    tag = next;
  };
  await changed(writer('equipment', cookie, payload('PUT', { selected: ['Dumbbells'] })));
  await changed(writer('exercises/push-up/bookmark', cookie, { method: 'PUT' }));
  const workout = { id: randomUUID(), name: 'Synthetic workout', date: '2026-11-13', time: '10:00', status: 'completed',
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }] };
  await changed(writer('workouts?response=delta', cookie, payload('POST', workout)));
  await changed(writer('workouts/' + workout.id + '?response=delta', cookie, payload('PUT', { ...workout, name: 'Changed', revision: 1 })));
  await changed(writer('workouts/' + workout.id + '?response=delta&revision=2', cookie, { method: 'DELETE' }));
  const clipId = randomUUID();
  const clip = 'clips/' + clipId;
  await changed(writer(clip + '?exercise=reverse-lunge', cookie, { method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'fixture.mp4' },
    body: await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)),
  }));
  await changed(writer(clip + '/review?background=1', cookie, { method: 'POST' }));
  await changed(writer(clip + '/review', cookie, { method: 'DELETE' }));
  await changed(writer(clip + '/review?background=1', cookie, { method: 'POST' }));

  const db = new DatabaseSync(database);
  try {
    const setExpiry = db.prepare('UPDATE clip_review_attempt SET lease_until = ? WHERE clip_id = ?');
    setExpiry.run(Date.now() + 60_000, clipId);
    assert.equal((await peer('workspace', cookie, condition(tag))).status, 304);
    setExpiry.run(Date.now() - 100, clipId);
    const expired = await peer('workspace', cookie, condition(tag));
    assert.equal(expired.status, 200);
    assert.equal((await expired.json()).clips[0].reviewStatus.state, 'failed');
    assert.notEqual(expired.headers.get('etag'), tag);
    tag = expired.headers.get('etag');
  } finally {
    db.close();
  }
  assert.equal((await peer('workspace', cookie, condition(tag))).status, 304);
  await changed(writer(clip, cookie, { method: 'DELETE' }));
});

test('legacy workspaces receive a durable validator when the database opens', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-workspace-legacy-condition-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'workspace.sqlite');
  const id = randomUUID();
  const db = new DatabaseSync(database);
  try {
    db.exec('CREATE TABLE workspace (id TEXT PRIMARY KEY, equipment TEXT)');
    db.prepare('INSERT INTO workspace (id, equipment) VALUES (?, ?)').run(id, '["Dumbbells"]');
  } finally {
    db.close();
  }
  const call = await start(t, { database });
  const cookie = await profileCookie(call, 'liftmorrow_workspace=' + id);
  const initial = await call('workspace', cookie);
  assert.equal(initial.status, 200);
  const tag = initial.headers.get('etag');
  assert.deepEqual((await initial.json()).equipment, ['Dumbbells']);
  const replacement = await start(t, { database });
  assert.equal((await replacement('workspace', cookie, condition(tag))).status, 304);
});
