import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createTrainerPlusServer } from '../server/index.mjs';
import { activeWorkspaceId } from './test-profile.mjs';

const profileHeader = (key) => ({ 'X-Trainer-Plus-Profile': key });
const json = (method, body, headers) => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

async function setup(t, options) {
  const directory = await mkdtemp(join(tmpdir(), 'trainer-plus-profiles-'));
  const database = join(directory, 'test.sqlite');
  const server = createTrainerPlusServer({ database, respond: null, ...options });
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await server.stopCoaching();
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}/api/`;
  const browser = () => {
    let cookie;
    return {
      get cookie() { return cookie; },
      async call(path, init) {
        const response = await fetch(root + path, {
          ...init, headers: { ...(cookie && { Cookie: cookie }), ...init?.headers },
        });
        if (response.headers.has('set-cookie')) cookie = response.headers.getSetCookie()[0].split(';')[0];
        return response;
      },
    };
  };
  return { database, browser };
}

const signup = (browser, username) => browser.call('profiles', json('POST', { username }));
const login = (browser, username) => browser.call('profiles/login', json('POST', { username }));
const logout = (browser, key) => browser.call('profiles/logout', { method: 'POST', headers: profileHeader(key) });
const activeKey = async (response, status) => {
  assert.equal(response.status, status);
  const { active } = await response.json();
  return active.workspaceKey;
};

test('existing browser profiles carry over to the new cookie and accept either profile header', async (t) => {
  const { browser } = await setup(t, { secureCookies: true });
  const original = browser();
  const alice = await activeKey(await signup(original, 'Alice'), 201);
  const previousCookie = original.cookie.replace('trainer_plus_browser=', 'liftmorrow_browser=');
  const upgraded = browser();
  const response = await upgraded.call('profiles', { headers: { Cookie: previousCookie } });
  assert.equal(await activeKey(response, 200), alice);
  assert.deepEqual(response.headers.getSetCookie(), [
    `${original.cookie}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=31536000`,
    'liftmorrow_browser=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
  ]);
  assert.equal((await upgraded.call('workspace', { headers: profileHeader(alice) })).status, 200);
  assert.equal((await upgraded.call('profiles/logout', { method: 'POST', headers: { 'X-Liftmorrow-Profile': alice } })).status, 200);
  assert.equal(await activeKey(await login(upgraded, 'Alice'), 200), alice);
});

test('browser profiles isolate training data, scope stale requests, and cascade account deletion', { timeout: 10_000 }, async (t) => {
  const reviewing = Promise.withResolvers();
  const reviewStopped = Promise.withResolvers();
  const { database, browser } = await setup(t, {
    sampleFrames: async () => [{ timestamp: 0, image: Buffer.from('fixture') }],
    respond: async ({ signal }) => {
      reviewing.resolve();
      if (!signal.aborted) await once(signal, 'abort');
      reviewStopped.resolve();
      throw signal.reason;
    },
  });
  const local = browser();
  const visitor = browser();
  assert.deepEqual(await (await local.call('profiles')).json(), { active: null, profiles: [], canImportLegacy: false });
  assert.equal((await local.call('workspace')).status, 404);
  assert.equal((await signup(local, 'a b')).status, 400);

  const alice = await activeKey(await signup(local, 'Alice'), 201);
  assert.equal((await login(visitor, 'Alice')).status, 404);
  assert.equal((await signup(local, 'Bob')).status, 409);
  const aliceHeaders = profileHeader(alice);
  assert.equal((await local.call('profiles/current', json('PUT', { displayName: 'Alice A.', trainingGoal: 'Build strength' }, aliceHeaders))).status, 200);
  const id = randomUUID();
  const session = { id, name: 'Alice’s private session', date: '2026-11-14', time: '12:00', status: 'completed',
    exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }] };
  assert.equal((await local.call('workouts', json('POST', session, aliceHeaders))).status, 200);
  assert.equal((await local.call('equipment', json('PUT', { selected: ['Dumbbells'] }, aliceHeaders))).status, 200);
  assert.equal((await local.call('exercises/push-up/bookmark', { method: 'PUT', headers: aliceHeaders })).status, 200);
  const clipId = randomUUID();
  const clip = 'clips/' + clipId;
  const bytes = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
  assert.equal((await local.call(clip + '?exercise=push-up', { method: 'PUT', body: bytes,
    headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'fixture.mp4', ...aliceHeaders },
  })).status, 200);
  const db = new DatabaseSync(database);
  t.after(() => db.close());
  const aliceWorkspace = activeWorkspaceId(db, local.cookie);

  const signedOut = await (await logout(local, alice)).json();
  assert.equal(signedOut.active, null);
  assert.deepEqual(signedOut.profiles, [{ username: 'Alice', workspaceKey: alice }]);
  assert.equal((await local.call('workspace')).status, 404);
  assert.equal((await signup(local, 'alice')).status, 409);
  const bob = await activeKey(await signup(local, 'Bob'), 201);
  assert.notEqual(alice, bob);
  const bobHeaders = profileHeader(bob);
  const bobWorkspace = await (await local.call('workspace', { headers: bobHeaders })).json();
  assert.deepEqual([bobWorkspace.workouts, bobWorkspace.clips, bobWorkspace.bookmarks, bobWorkspace.equipment], [[], [], [], null]);
  assert.equal((await local.call(clip + '/video')).status, 404);
  assert.equal((await local.call(clip + '/reviews')).status, 404);
  assert.equal((await local.call('workouts/' + id, json('PUT', session, bobHeaders))).status, 404);
  assert.deepEqual((await (await local.call('workspace/training-backup')).json()).workouts, []);
  assert.equal((await local.call('workouts', json('POST', { ...session, id: randomUUID() }, aliceHeaders))).status, 409);
  assert.equal((await local.call('profiles/current', { method: 'DELETE', headers: aliceHeaders })).status, 409);
  assert.equal((await local.call('workouts', json('POST', { ...session, name: 'Bob’s session' }, bobHeaders))).status, 200);

  assert.equal((await logout(local, bob)).status, 200);
  assert.equal(await activeKey(await login(local, 'alice'), 200), alice);
  const active = (await (await local.call('profiles')).json()).active;
  assert.deepEqual(active.details, { displayName: 'Alice A.', trainingGoal: 'Build strength' });
  assert.deepEqual((await (await local.call('workspace')).json()).workouts.map(({ name }) => name), [session.name]);
  const video = await local.call(clip + '/video?profile=' + alice);
  assert.deepEqual(Buffer.from(await video.arrayBuffer()), bytes);
  assert.ok(db.prepare('SELECT count(*) AS n FROM clip_payload WHERE workspace_id = ?').get(aliceWorkspace).n > 0);

  assert.equal((await local.call(clip + '/review?background=1', { method: 'POST', headers: aliceHeaders })).status, 202);
  await reviewing.promise;
  const deleted = await (await local.call('profiles/current', { method: 'DELETE', headers: aliceHeaders })).json();
  assert.equal(deleted.active, null);
  assert.deepEqual(deleted.profiles.map(({ username }) => username), ['Bob']);
  await reviewStopped.promise;
  assert.equal((await login(local, 'Alice')).status, 404);
  for (const table of ['workout', 'exercise_bookmark', 'clip', 'clip_payload', 'clip_review_attempt', 'local_profile']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE workspace_id = ?`).get(aliceWorkspace).n, 0);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM workspace WHERE id = ?').get(aliceWorkspace).n, 0);
  assert.equal(await activeKey(await login(local, 'Bob'), 200), bob);
  assert.equal((await (await local.call('workspace')).json()).workouts[0].name, 'Bob’s session');
});

test('a converted upload cannot finish in the old or new workspace after switching profiles', { timeout: 10_000 }, async (t) => {
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { browser } = await setup(t, { convertVideo: () => { started.resolve(); return finish.promise; } });
  const local = browser();
  const first = await activeKey(await signup(local, 'first'), 201);
  const clip = 'clips/' + randomUUID();
  const uploading = local.call(clip + '?exercise=push-up', {
    method: 'PUT', headers: { ...profileHeader(first), 'Content-Type': 'video/quicktime', 'X-Clip-Name': 'fixture.mov' },
    body: await readFile(new URL('./fixtures/synthetic.mov', import.meta.url)),
  });
  try {
    await Promise.race([started.promise, uploading.then((response) => assert.fail('Upload stopped early: ' + response.status))]);
    assert.equal((await logout(local, first)).status, 200);
    const second = await activeKey(await signup(local, 'second'), 201);
    finish.resolve(await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)));
    assert.equal((await uploading).status, 409);
    assert.equal((await local.call(clip)).status, 404);
    assert.equal((await logout(local, second)).status, 200);
    assert.equal((await login(local, 'first')).status, 200);
    assert.equal((await local.call(clip)).status, 404);
  } finally {
    finish.resolve(Buffer.alloc(0));
  }
});

test('training intake history and check-ins are private, retryable, and deleted with the account', async (t) => {
  const { database, browser } = await setup(t);
  const local = browser();
  const first = await activeKey(await signup(local, 'Companion'), 201);
  const headers = profileHeader(first);
  const preferences = { intake: 'completed', trainerNotes: 'Keep rows controlled.', experience: 'regular',
    preferred: ['dumbbell-row'], excluded: ['push-up'], priorities: ['Upper body'] };
  const details = { displayName: 'Companion', trainingGoal: 'Upper body strength', trainingPreferences: preferences };
  const save = (profile) => local.call('profiles/current', json('PUT', profile, headers));
  assert.equal((await save({ ...details, trainingPreferences: { ...preferences, excluded: preferences.preferred } })).status, 400);
  assert.equal((await save(details)).status, 200);
  assert.equal((await save(details)).status, 200);
  assert.equal((await save({ displayName: 'Companion', trainingGoal: 'New goal' })).status, 200);
  const path = 'companion/profile-history';
  assert.equal((await local.call(path)).status, 409);
  const history = await (await local.call(path, { headers })).json();
  assert.deepEqual(history.map(({ details }) => details.trainingGoal), ['New goal', 'Upper body strength']);
  assert.deepEqual(history[0].details.trainingPreferences, preferences);

  const day = '2026-11-15';
  const list = 'companion?day=' + day;
  const entry = { id: randomUUID(), time: '10:20', text: 'Not up for lifting.', adjustment: 'rest', wantsReply: false };
  const post = (record) => local.call(list, json('POST', record, headers));
  const logged = await (await post(entry)).json();
  assert.equal(logged.adjustment, 'rest');
  assert.notEqual(logged.entries[0].savedAt, undefined);
  assert.equal(logged.entries[0].reply, undefined);
  assert.deepEqual(await (await post(entry)).json(), logged);
  assert.equal((await post({ ...entry, text: 'Changed text' })).status, 409);
  const question = { id: randomUUID(), time: '10:22', text: 'What does RPE mean?', wantsReply: true };
  const answered = await (await post(question)).json();
  assert.match(answered.entries[0].reply, /very easy/);
  assert.equal(answered.adjustment, 'rest');
  const tomorrow = await (await local.call('companion?day=2026-11-16', { headers })).json();
  assert.equal(tomorrow.adjustment, null);
  assert.equal(tomorrow.entries.length, 2);
  const reset = { ...entry, id: randomUUID(), text: '', adjustment: 'usual', wantsReply: true };
  const cleared = await (await post(reset)).json();
  assert.equal(cleared.adjustment, 'usual');
  assert.match(cleared.entries[0].reply, /adjustment for today is cleared/);
  const removed = await (await local.call('companion/' + entry.id + '?day=' + day, { method: 'DELETE', headers })).json();
  assert.ok(!removed.entries.some(({ id }) => id === entry.id));

  const db = new DatabaseSync(database);
  t.after(() => db.close());
  const workspace = activeWorkspaceId(db, local.cookie);
  assert.equal((await logout(local, first)).status, 200);
  const other = await activeKey(await signup(local, 'Another'), 201);
  assert.equal((await post({ ...entry, id: randomUUID() })).status, 409);
  assert.deepEqual((await (await local.call(list, { headers: profileHeader(other) })).json()).entries, []);
  assert.equal((await logout(local, other)).status, 200);
  assert.equal(await activeKey(await login(local, 'Companion'), 200), first);
  assert.equal((await local.call('profiles/current', { method: 'DELETE', headers })).status, 200);
  for (const table of ['training_check_in', 'profile_revision']) {
    assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table} WHERE workspace_id = ?`).get(workspace).count, 0);
  }
});
