import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createTrainerPlusServer } from '../server/index.mjs';
import { createTestProfile } from './test-profile.mjs';

const upcomingSet = {
  exerciseId: 'dumbbell-shoulder-press', phase: 'setup', setNumber: 2,
  target: { reps: 8, load: { value: 10, unit: 'lb' } },
  question: 'What’s my target?',
};

async function startCoach(t, respond) {
  const server = createTrainerPlusServer({ database: ':memory:', respond, posePool: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((done) => server.close(done)));
  const root = `http://127.0.0.1:${server.address().port}/api/`;
  const request = (path, options) => fetch(root + path, options);
  const cookie = await createTestProfile(request);
  const { workspaceKey } = await (await request('workspace', { headers: { cookie } })).json();
  const ask = (body = upcomingSet, headers = {}, signal) => request('session-coach', {
    method: 'POST', signal, body: JSON.stringify(body),
    headers: { cookie, 'X-Trainer-Plus-Profile': workspaceKey, 'Content-Type': 'application/json', ...headers },
  });
  return { ask, request, cookie, workspaceKey };
}

test('session coach validates workspace and context and returns only catalog-grounded text', async (t) => {
  const calls = [];
  const { ask } = await startCoach(t, async (input) => {
    calls.push(input);
    return { choice: calls.length === 1 ? 'target' : 'constructor', reply: 'Use twice the weight.' };
  });
  assert.equal((await ask(upcomingSet, { cookie: '' })).status, 404);
  assert.equal((await ask(upcomingSet, { 'X-Trainer-Plus-Profile': 'other-profile' })).status, 409);
  assert.equal((await ask(upcomingSet, { Origin: 'https://other.example' })).status, 403);
  for (const invalid of [
    { exerciseId: 'unknown' }, { phase: 'unknown' }, { setNumber: 0 }, { question: '' }, { question: 'q'.repeat(281) },
    { target: null }, { target: { reps: 601 } }, { target: { load: { value: 10, unit: 'unknown' } } },
  ]) {
    assert.equal((await ask({ ...upcomingSet, ...invalid })).status, 400);
  }
  assert.equal(calls.length, 0);

  const response = await ask({ ...upcomingSet, question: '  What’s my target?  ', privateNotes: 'Omit my note' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { reply: 'Set 2 is planned for 8 reps at 10 lb per dumbbell.' });
  assert.equal(calls[0].name, 'session_coach');
  const prompt = JSON.parse(calls[0].content[0].text);
  assert.deepEqual(Object.keys(prompt), ['exercise', 'phase', 'setNumber', 'question', 'replies']);
  assert.equal(prompt.question, upcomingSet.question);
  assert.match(prompt.replies.cue_2, /ribs over your pelvis/);
  assert.equal((await ask()).status, 502);
});

test('session coach offers an immediate safety reply when the AI provider is unavailable', async (t) => {
  const { ask } = await startCoach(t, null);
  const urgent = await ask({ ...upcomingSet, question: 'I’m feeling chest pressure.' });
  assert.equal(urgent.status, 200);
  assert.match((await urgent.json()).reply, /local emergency number/);
  const pain = await ask({ ...upcomingSet, question: 'My shoulder hurts.' });
  assert.equal(pain.status, 200);
  assert.match((await pain.json()).reply, /pause the workout/);
  assert.equal((await ask()).status, 503);
  assert.equal((await ask({ ...upcomingSet, question: 'Where should I feel the exercise?' })).status, 503);
});

test('session coach allows one question at a time and aborts a disconnected request', async (t) => {
  const started = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  let count = 0;
  const { ask } = await startCoach(t, ({ signal }) => {
    if (++count > 1) return { choice: 'cue_2' };
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason);
        stopped.resolve();
      }, { once: true });
      started.resolve();
    });
  });
  const controller = new AbortController();
  const pending = ask(upcomingSet, {}, controller.signal);
  try {
    await started.promise;
    const busy = await ask();
    assert.equal(busy.status, 429);
    assert.equal(busy.headers.get('Retry-After'), '2');
  } finally {
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await stopped.promise;
  }
  const next = await ask();
  assert.equal(next.status, 200);
  assert.match((await next.json()).reply, /ribs over your pelvis/);
});
