import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createTrainerPlusServer } from '../server/index.mjs';
import { googleSessionSeconds } from '../server/google-profiles.mjs';

test('Google accounts use one workspace across browsers and require a new sign-in at seven days', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date() });
  const server = createTrainerPlusServer({
    database: ':memory:',
    respond: null,
    google: {
      clientId: 'test-client',
      verify: async (credential, nonce) => credential === 'verified:' + nonce
        ? { subject: 'test-google-subject', email: 'trainer@example.test', name: 'Test Trainer' }
        : null,
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeConnections();
  }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const request = (path, { body, ...options } = {}) => fetch(origin + '/api/' + path, {
    method: options.method ?? (body ? 'POST' : 'GET'),
    headers: { Origin: origin, ...(body && { 'Content-Type': 'application/json' }), ...options.headers },
    ...(body && { body: JSON.stringify(body) }),
  });
  const challenge = async () => (await (await request('profiles/google-challenge', { method: 'POST' })).json()).nonce;
  const signIn = async (nonce, headers) => request('profiles/google', { body: { nonce, credential: 'verified:' + nonce }, headers });

  assert.equal((await request('profiles', { body: { username: 'Local account' } })).status, 404);
  assert.equal((await request('profiles/login', { body: { username: 'Local account' } })).status, 404);
  assert.equal((await request('workspace')).status, 401);
  const nonce = await challenge();
  assert.equal((await request('profiles/google', { body: { nonce, credential: 'forged' } })).status, 403);
  assert.equal((await signIn(nonce, { Origin: 'https://elsewhere.example' })).status, 403);

  const first = await signIn(nonce);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('set-cookie'), /; HttpOnly; SameSite=Lax; Secure; Max-Age=604800$/);
  const firstCookie = first.headers.get('set-cookie').split(';')[0];
  const firstState = await first.json();
  const key = firstState.active.workspaceKey;
  assert.equal(firstState.active.setupPending, true);
  assert.equal(firstState.google.expiresAt, Date.now() + googleSessionSeconds * 1000);
  assert.equal((await signIn(nonce)).status, 401);
  assert.equal((await request('workspace', { headers: { Cookie: firstCookie } })).status, 200);

  t.mock.timers.tick((googleSessionSeconds - 1) * 1000);
  const resumed = await request('profiles', { headers: { Cookie: firstCookie } });
  assert.equal((await resumed.json()).google.expiresAt, firstState.google.expiresAt);
  assert.equal(resumed.headers.has('set-cookie'), false);
  t.mock.timers.tick(1000);
  assert.equal((await request('workspace', { headers: { Cookie: firstCookie } })).status, 401);
  assert.equal((await (await request('profiles', { headers: { Cookie: firstCookie } })).json()).active, null);

  const second = await signIn(await challenge());
  assert.equal(second.status, 200);
  const secondCookie = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await second.json()).active.workspaceKey, key);
  const third = await signIn(await challenge());
  const thirdCookie = third.headers.get('set-cookie').split(';')[0];
  assert.equal((await third.json()).active.workspaceKey, key);
  const secondHeaders = { Cookie: secondCookie, 'X-Trainer-Plus-Profile': key };
  assert.equal((await request('profiles/logout', { method: 'POST', headers: secondHeaders })).status, 200);
  assert.equal((await request('workspace', { headers: secondHeaders })).status, 401);
  assert.equal((await request('workspace', { headers: { Cookie: thirdCookie } })).status, 200);
  assert.equal((await request('profiles/current', {
    method: 'DELETE', headers: { Cookie: thirdCookie, 'X-Trainer-Plus-Profile': key },
  })).status, 200);
  assert.equal((await request('workspace', { headers: { Cookie: thirdCookie } })).status, 401);
});
