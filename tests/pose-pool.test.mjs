import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { estimatePoses } from '../server/pose.mjs';
import { createPosePool } from '../server/pose-pool.mjs';
import { createLiftmorrowServer } from '../server/index.mjs';

const testWorker = new URL('./fixtures/pose-worker-stub.mjs', import.meta.url);
const modelPath = 'synthetic-model-path';
const frame = (timestamp) => [{ timestamp, image: Buffer.from('synthetic') }];

test('pose worker rejects outstanding jobs when it exits and restarts on the next batch', async (t) => {
  const pool = createPosePool({ workerUrl: testWorker, modelPath });
  t.after(() => pool.stop());
  const active = pool.estimate(frame(-1));
  const queued = pool.estimate(frame(2));
  await Promise.all([assert.rejects(active, /worker stopped/), assert.rejects(queued, /worker stopped/)]);
  assert.deepEqual(await pool.estimate(frame(3)), [{ timestamp: 3, points: [] }]);

  const invalidPool = createPosePool({ workerUrl: new URL('./missing-pose-worker.mjs', import.meta.url), modelPath });
  t.after(() => invalidPool.stop());
  await assert.rejects(invalidPool.estimate(frame(4)), /worker stopped/);
});

test('queued cancellation frees capacity and running cancellation releases its slot on acknowledgment', async (t) => {
  const pool = createPosePool({ workerUrl: testWorker, modelPath });
  t.after(() => pool.stop());
  const running = new AbortController();
  const pending = new AbortController();
  const active = pool.estimate(frame(-2), running.signal);
  const cancelled = pool.estimate(frame(-3), pending.signal);
  const next = pool.estimate(frame(2));
  await assert.rejects(pool.estimate(frame(3)), /worker is busy/);
  pending.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  const last = pool.estimate(frame(4));
  running.abort();
  await assert.rejects(active, { name: 'AbortError' });
  assert.deepEqual(await next, [{ timestamp: 2, points: [] }]);
  assert.deepEqual(await last, [{ timestamp: 4, points: [] }]);
});

test('stopping a pose pool settles active and queued batches and is idempotent', async () => {
  const pool = createPosePool({ workerUrl: testWorker, modelPath });
  const active = pool.estimate(frame(-2));
  const queued = pool.estimate(frame(-3));
  const stopped = pool.stop();
  assert.equal(pool.stop(), stopped);
  await Promise.all([assert.rejects(active, /worker is stopping/), assert.rejects(queued, /worker is stopping/), stopped]);
  await assert.rejects(pool.estimate(frame(5)), /worker is busy/);
});

test('closing the server aborts frame extraction before stopping its pose worker', async () => {
  const entered = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  const order = [];
  const server = createLiftmorrowServer({
    database: ':memory:',
    respond: () => assert.fail('Provider should not run after cancelling frame extraction.'),
    sampleFrames: async (_, { signal }) => {
      entered.resolve();
      await once(signal, 'abort');
      order.push('frames aborted');
      throw signal.reason;
    },
    posePool: {
      estimate: () => assert.fail('Pose worker should not receive an aborted preparation.'),
      stop() { order.push('worker stopped'); stopped.resolve(); },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}/api/`;
  try {
    const workspace = await fetch(api + 'workspace');
    const cookie = workspace.headers.get('set-cookie').split(';')[0];
    await workspace.arrayBuffer();
    const clip = 'clips/' + randomUUID();
    const uploaded = await fetch(api + clip + '?exercise=push-up', {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'video/mp4', 'X-Clip-Name': 'fixture.mp4' },
      body: await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)),
    });
    assert.equal(uploaded.status, 200);
    await uploaded.arrayBuffer();
    const review = await fetch(api + clip + '/review?background=1', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(review.status, 202);
    await review.arrayBuffer();
    await entered.promise;
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await stopped.promise;
  }
  assert.deepEqual(order, ['frames aborted', 'worker stopped']);
});

const installedModel = process.env.LIFTMORROW_POSE_MODEL || new URL('../.data/movenet-thunder.onnx', import.meta.url);
test('worker produces exactly the same MoveNet points and preserves the source JPEG', {
  skip: !existsSync(installedModel) && 'Run npm run setup:pose to install the local model.',
}, async (t) => {
  const image = await readFile(new URL('./fixtures/synthetic-pose.jpg', import.meta.url));
  const original = Buffer.from(image);
  const frames = [{ image, timestamp: 0.5 }];
  const pool = createPosePool();
  t.after(() => pool.stop());
  const direct = await estimatePoses(frames);
  assert.equal(direct?.[0].points.length, 17);
  assert.deepEqual(await pool.estimate(frames), direct);
  assert.deepEqual(image, original);
});
