import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createTrainerPlusServer } from '../server/index.mjs';

const day = '2026-11-16';
const today = '?today=' + day + '&now=12:00';
const exerciseId = 'dumbbell-curl';
const noteText = 'My trainer wants me to avoid bodyweight squats and keep workouts short.';
const result = (overrides) => ({
  intent: 'reply', exerciseId: '', from: '', through: '', reply: 'I can help with that.',
  note: { text: '', kind: 'context', exerciseId: '' }, ...overrides,
});

async function start(t, respond) {
  const server = createTrainerPlusServer({ database: ':memory:', respond, posePool: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((done) => server.close(done)));
  const root = 'http://127.0.0.1:' + server.address().port + '/api/';
  return async function profile(username = 'chat-test') {
    const created = await fetch(root + 'profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }),
    });
    assert.equal(created.status, 201);
    const cookie = created.headers.getSetCookie()[0].split(';')[0];
    const key = (await created.json()).active.workspaceKey;
    const call = (path, method = 'GET', body, expected = key, extra = {}) => fetch(root + path, {
      method, headers: { Cookie: cookie, ...(expected && { 'X-Trainer-Plus-Profile': expected }), ...extra,
        ...(body && { 'Content-Type': 'application/json' }) },
      ...(body && { body: JSON.stringify(body) }),
    });
    return { call, key };
  };
}

test('Chat answers from the full completed log and preserves per-set weights, units and date ranges', async (t) => {
  const seen = [];
  const profile = await start(t, ({ name, content }) => {
    assert.equal(name, 'training_chat');
    const context = JSON.parse(content[0].text);
    seen.push(context);
    const exercise = { exerciseId };
    if (context.message === 'How many sessions last week?') return result({ intent: 'session_count', from: '2026-11-09', through: '2026-11-15' });
    if (context.message === 'What was my heaviest?') return result({ intent: 'heaviest_load', ...exercise });
    return result({ intent: 'latest_load', ...exercise, reply: 'It was 100 kg.' });
  });
  const { call, key } = await profile();
  const add = async (date, status, setDetails) => {
    const response = await call('workouts', 'POST', { id: randomUUID(), name: 'Private synthetic name',
      notes: 'Private synthetic workout note', date, time: '09:00', status,
      exercises: [{ exerciseId, setDetails, notes: 'Private synthetic exercise note' }] });
    assert.equal(response.status, 200);
    await response.json();
  };
  await add('2026-01-01', 'completed', [{ reps: 5, load: { value: 20, unit: 'kg' } }]);
  await add('2026-11-10', 'completed', [{ reps: 10, load: { value: 30, unit: 'lb' } }]);
  await add('2026-11-11', 'completed', [{ reps: 9, load: { value: 22, unit: 'lb' } }]);
  await add('2026-11-12', 'completed', [{ reps: 8, load: { value: 23, unit: 'lb' } }]);
  await add('2026-11-13', 'completed', [{ reps: 8, load: { value: 24, unit: 'lb' } }]);
  await add('2026-11-14', 'completed', [{ reps: 8, load: { value: 25, unit: 'lb' } }]);
  await add('2026-11-15', 'completed', [{ reps: 9, load: { value: 25, unit: 'lb' } }, { reps: 7, load: { value: 12, unit: 'kg' } }, { reps: 6 }]);
  await add(day, 'planned', [{ reps: 10, load: { value: 100, unit: 'kg' } }]);
  await add('2026-11-17', 'completed', [{ reps: 10, load: { value: 200, unit: 'kg' } }]);
  await (await call('workspace/example-workouts', 'POST', { today: day })).json();

  const ask = async (message, history) => {
    const response = await call('chat' + today, 'POST', { message, history }, key);
    assert.equal(response.status, 200);
    return (await response.json()).reply;
  };
  const message = 'What weight did I use last time for dumbbell curls?';
  const latest = await ask(message);
  assert.match(latest, /2026-11-15.*25 lb per dumbbell, 12 kg per dumbbell.*1 of 3 sets/);
  assert.match(await ask('What was my heaviest?', [{ role: 'user', text: message }, { role: 'assistant', text: latest }]),
    /20 kg per dumbbell on 2026-01-01/);
  assert.equal(await ask('How many sessions last week?'), 'You logged 6 completed sessions from 2026-11-09 through 2026-11-15.');
  assert.equal(seen[0].recentLogs.length, 5);
  assert.ok(seen[1].exerciseOptions.some(([id]) => id === exerciseId));
  assert.doesNotMatch(JSON.stringify(seen), /Private synthetic/);
  assert.equal((await call('chat' + today, 'POST', { message }, '')).status, 409);
  assert.equal((await call('chat' + today, 'POST', { message, history: [{ role: 'system', text: 'hi' }] })).status, 400);
  assert.equal((await call('chat' + today, 'POST', { message: 'x'.repeat(1201) })).status, 400);
});

test('Only confirmed notes persist, update suggestions and stay scoped to the active profile', async (t) => {
  const seen = [];
  const profile = await start(t, ({ name, content }) => {
    const input = JSON.parse(content[0].text);
    if (name === 'exercise_recommendations') return { recommendations: [] };
    seen.push(input);
    return result({ note: { text: noteText, kind: 'avoid', exerciseId: 'bodyweight-squat' } });
  });
  const a = await profile();
  const b = await profile('other-chat');
  const get = async (call) => (await call('workspace')).json();
  const response = await a.call('chat' + today, 'POST', { message: noteText });
  const { note } = await response.json();
  assert.deepEqual(note, { text: noteText, kind: 'avoid', exerciseId: 'bodyweight-squat' });
  const baseline = await a.call('workspace');
  const etag = baseline.headers.get('etag');
  assert.deepEqual((await baseline.json()).trainingNotes, []);
  const unquoted = await a.call('chat' + today, 'POST', { message: 'How am I doing?' });
  assert.equal((await unquoted.json()).note, undefined);
  const id = randomUUID();
  assert.equal((await b.call('training-notes/' + id, 'PUT', note, a.key)).status, 409);
  assert.equal((await a.call('training-notes/' + id, 'PUT', { ...note, exerciseId: 'invalid' })).status, 400);
  const saved = await a.call('training-notes/' + id, 'PUT', note);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).trainingNotes.length, 1);
  const duplicate = await a.call('training-notes/' + id, 'PUT', note);
  assert.equal((await duplicate.json()).trainingNotes.length, 1);
  assert.equal((await a.call('training-notes/' + id, 'PUT', { ...note, text: 'Different' })).status, 409);
  const changed = await a.call('workspace', 'GET', undefined, a.key, { 'If-None-Match': etag });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).trainingNotes[0].text, noteText);
  const shorter = await a.call('training-notes/' + randomUUID(), 'PUT', { kind: 'shorter', text: 'I prefer shorter workouts.' });
  assert.equal(shorter.status, 200);
  await shorter.json();
  const suggestion = await (await a.call('workouts/recommendation' + today, 'POST')).json();
  assert.equal(suggestion.exercises.length, 3);
  assert.ok(!suggestion.exercises.some(({ exerciseId: id }) => id === 'bodyweight-squat'));
  await (await a.call('chat' + today, 'POST', { message: 'What do you suggest?' })).json();
  assert.equal(seen.at(-1).trainingNotes.length, 2);
  assert.ok(!seen.at(-1).suggestion.exercises.includes('Bodyweight Squat'));
  await (await b.call('chat' + today, 'POST', { message: 'What do you suggest?' })).json();
  assert.deepEqual(seen.at(-1).trainingNotes, []);
  assert.deepEqual((await get(b.call)).trainingNotes, []);
  assert.equal((await b.call('training-notes/' + id, 'DELETE')).status, 200);
  assert.equal((await get(a.call)).trainingNotes.length, 2);
  assert.equal((await a.call('training-notes/' + id, 'DELETE')).status, 200);
  assert.equal((await get(a.call)).trainingNotes.length, 1);
});

test('A delayed Chat answer is withheld when the active profile changes', async (t) => {
  const { promise: entered, resolve: enteredProvider } = Promise.withResolvers();
  const { promise: resultReady, resolve: releaseProvider } = Promise.withResolvers();
  const profile = await start(t, () => {
    enteredProvider();
    return resultReady;
  });
  const { call } = await profile();
  const pending = call('chat' + today, 'POST', { message: 'How often did I train?' });
  try {
    await entered;
    assert.equal((await call('profiles/logout', 'POST')).status, 200);
  } finally {
    releaseProvider(result({ intent: 'session_count' }));
  }
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reply, undefined);
});
