import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createLiftmorrowServer } from '../server/index.mjs';
import { activeWorkspaceId, createTestProfile } from './test-profile.mjs';

test('legacy reads honor byte ranges, buffer limits, and deletion while backpressured', { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'liftmorrow-legacy-video-'));
  const database = join(root, 'test.sqlite');
  const size = 8 * 1024 * 1024;
  const server = createLiftmorrowServer({ database, respond: null, legacyReadBudgetBytes: size });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}/api/`;
  try {
    const cookie = await createTestProfile((path, init) => fetch(origin + path, init));
    const headers = { Cookie: cookie };
    const id = randomUUID();
    const clip = origin + 'clips/' + id;
    const video = clip + '/video';
    const fixture = await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url));
    const bytes = Buffer.alloc(size, 0x35);
    fixture.copy(bytes);
    bytes.writeUInt32BE(size - fixture.length, fixture.length);
    bytes.write('free', fixture.length + 4);
    const db = new DatabaseSync(database);
    try {
      db.prepare(`INSERT INTO clip (workspace_id,id,exerciseId,filename,mime,size,uploadedAt,bytes,representation)
        VALUES (?,?,'push-up','legacy.mp4','video/mp4',?,?,?,?)`)
        .run(activeWorkspaceId(db, cookie), id, bytes.length, new Date().toISOString(), bytes, 'legacy-test-token');
    } finally {
      db.close();
    }

    const range = await fetch(video, { headers: { ...headers, Range: 'bytes=262140-262160' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), `bytes 262140-262160/${size}`);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(262140, 262161));

    const stalled = get(video, { headers });
    const [paused] = await once(stalled, 'response');
    paused.on('error', () => {});
    paused.pause();
    assert.equal(paused.statusCode, 200);
    const head = await fetch(video, { method: 'HEAD', headers });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), size);
    const rejected = await fetch(video, { headers: { ...headers, Range: 'bytes=0-0' } });
    assert.equal(rejected.status, 429);
    assert.ok(Number(rejected.headers.get('retry-after')) > 0);
    await rejected.arrayBuffer();

    paused.destroy();
    let reopened;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      reopened = await fetch(video, { headers: { ...headers, Range: 'bytes=-16' } });
      if (reopened.status !== 429) break;
      await reopened.arrayBuffer();
      await delay(10);
    }
    assert.equal(reopened.status, 206);
    assert.deepEqual(Buffer.from(await reopened.arrayBuffer()), bytes.subarray(size - 16));

    const pending = get(video, { headers });
    const [old] = await once(pending, 'response');
    old.on('error', () => {});
    old.pause();
    const oldClosed = once(old, 'close').catch(() => {});
    assert.equal(old.statusCode, 200);
    const removed = await fetch(clip + '?response=delta', { method: 'DELETE', headers });
    assert.equal(removed.status, 200);
    await removed.arrayBuffer();
    const uploaded = await fetch(clip + '?exercise=push-up&response=delta', {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'video/mp4', 'X-Clip-Name': 'new.mp4' }, body: fixture,
    });
    assert.equal(uploaded.status, 200);
    await uploaded.arrayBuffer();
    let sent = 0;
    old.on('data', (chunk) => { sent += chunk.length; });
    old.resume();
    await oldClosed;
    assert.equal(old.complete, false);
    assert.ok(sent < size);
    const latest = await fetch(video, { headers });
    assert.deepEqual(Buffer.from(await latest.arrayBuffer()), fixture);
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await server.stopCoaching();
    await rm(root, { recursive: true, force: true });
  }
});
