import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createLiftmorrowServer } from '../server/index.mjs';
import { createTestProfile } from './test-profile.mjs';

const endpoint = 'workspace/training-backup';

async function start(t) {
  const server = createLiftmorrowServer({ database: ':memory:', respond: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api/`;
  return async () => {
    const cookie = await createTestProfile((path, init) => fetch(root + path, init));
    return (path, options) => fetch(root + path, { ...options, headers: { Cookie: cookie, ...options?.headers } });
  };
}

function post(backup) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) };
}

function workout(index, date, notes = 'Training 🟩') {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `Session ${index}`, date, time: '12:00',
    status: index % 2 ? 'planned' : 'completed', notes, exercises: [{ exerciseId: 'push-up', sets: 3, reps: 8 }],
  };
}

test('date-filtered v1 backups preserve order, format, settings, and isolation', async (t) => {
  const session = await start(t);
  const owner = await session();
  const other = await session();
  const records = [workout(1, '2026-11-01'), workout(2, '2026-11-02', ''), workout(3, '2026-11-02'), workout(4, '2026-11-03')];
  const fields = { format: 'liftmorrow-training', version: 1, equipment: ['Dumbbells'], bookmarks: ['push-up'] };
  const response = await owner(endpoint + '?response=summary', post({ ...fields, workouts: records.toReversed() }));
  assert.deepEqual(await response.json(), { restore: { added: 4, skipped: 0, equipmentImported: true, savedExercises: 1 } });
  const query = endpoint + '?from=2026-11-02&before=2026-11-03';
  const filtered = await owner(query);
  assert.equal(filtered.headers.get('cache-control'), 'private, no-store');
  assert.match(filtered.headers.get('content-disposition'), /liftmorrow-training-backup.json/);
  const { notes, ...withoutNotes } = records[1];
  assert.equal(await filtered.text(), JSON.stringify({ ...fields, workouts: [withoutNotes, records[2]] }));
  assert.deepEqual((await (await owner(endpoint + '?before=2026-11-02')).json()).workouts, [records[0]]);
  assert.deepEqual((await (await owner(endpoint + '?from=2026-11-03')).json()).workouts, [records[3]]);
  assert.deepEqual((await (await other(query)).json()).workouts, []);
  for (const suffix of ['?from=2026-02-30', '?from=', '?before=2026-11-02&from=2026-11-02']) {
    assert.equal((await owner(endpoint + suffix)).status, 400);
  }
  const restored = await other(endpoint, post({ ...fields, format: 'repform-training', workouts: [withoutNotes, records[2]] }));
  const snapshot = await restored.json();
  assert.deepEqual(snapshot.restore, { added: 2, skipped: 0, equipmentImported: true, savedExercises: 1 });
  assert.deepEqual(snapshot.workouts.map(({ id }) => id), [records[1].id, records[2].id]);
  assert.ok(Array.isArray(snapshot.clips));
  assert.equal((await (await other(endpoint)).json()).format, 'liftmorrow-training');
});

test('oversize histories can be split into v1 files and summary-only replay leaves the workspace unchanged', { timeout: 6000 }, async (t) => {
  const session = await start(t);
  const owner = await session();
  const fields = { format: 'liftmorrow-training', version: 1, equipment: null, bookmarks: [] };
  const notes = '🟩'.repeat(600);
  for (const [start, date] of [[0, '2026-11-01'], [1800, '2026-11-02']]) {
    const records = Array.from({ length: 1800 }, (_, index) => workout(start + index, date, notes));
    const response = await owner(endpoint + '?response=summary', post({ ...fields, workouts: records }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { restore: { added: 1800, skipped: 0, equipmentImported: false, savedExercises: 0 } });
  }
  const tooLarge = await owner(endpoint);
  assert.equal(tooLarge.status, 413);
  assert.match((await tooLarge.json()).error, /narrower date range/);
  const first = await owner(endpoint + '?before=2026-11-02');
  const second = await owner(endpoint + '?from=2026-11-02');
  const parts = await Promise.all([first, second].map(async (part) => {
    assert.equal(part.status, 200);
    assert.ok(Number(part.headers.get('content-length')) < 8 * 1024 * 1024);
    return part.json();
  }));
  assert.deepEqual(parts.map(({ workouts }) => workouts.length), [1800, 1800]);
  const workspace = await owner('workspace');
  const tag = workspace.headers.get('etag');
  await workspace.arrayBuffer();
  const replay = await owner(endpoint + '?response=summary', post(parts[0]));
  assert.deepEqual(await replay.json(), { restore: { added: 0, skipped: 1800, equipmentImported: false, savedExercises: 0 } });
  assert.equal((await owner('workspace', { headers: { 'If-None-Match': tag } })).status, 304);
});
