import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import jpeg from 'jpeg-js';
import { createTrainerPlusServer } from '../server/index.mjs';
import { createTestProfile } from './test-profile.mjs';

const still = (red) => jpeg.encode({ width: 2, height: 2, data: Buffer.from(Array(4).fill([red, 60, 100, 255]).flat()) }).data;

test('review stills use the cited sample and remain private with saved sections', async (t) => {
  const chosen = still(95);
  const later = still(145);
  const sampleFrames = async (_, { startSeconds }) => [
    { timestamp: startSeconds, image: still(25) },
    { timestamp: startSeconds + 0.5, image: startSeconds === 0 ? chosen : later },
  ];
  const requests = [];
  const server = createTrainerPlusServer({
    database: ':memory:', sampleFrames,
    respond: async (request) => {
      requests.push(request);
      if (request.name === 'exercise_reference_match') {
        return { reference: requests.length === 2 ? 1 : 99 };
      }
      return { verdict: 'observations', summary: '', observations: [{
        frame: 2, comparisonFrame: 1, kind: 'adjustment',
        observation: 'The weights drift toward your face at the bottom.', cue: 'Stack your wrists over your elbows as the weights come down.',
      }] };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    await server.stopCoaching();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  async function profile() {
    const cookie = await createTestProfile((path, init) => fetch(base + path, init));
    const call = (path, init) => fetch(base + path, { ...init, headers: { Cookie: cookie, ...init?.headers } });
    return { call, key: (await (await call('profiles')).json()).active.workspaceKey };
  }
  const owner = await profile();
  const other = await profile();
  const clip = 'clips/' + randomUUID();
  const uploaded = await owner.call(clip + '?exercise=dumbbell-bench-press', {
    method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'X-Clip-Name': 'synthetic.mp4' },
    body: await readFile(new URL('./fixtures/synthetic.mp4', import.meta.url)),
  });
  assert.equal(uploaded.status, 200);
  await uploaded.arrayBuffer();
  const reviewPath = clip + '/review';
  const imagePath = (sequence) => clip + '/review-still?sequence=' + sequence;

  async function start(startSeconds) {
    const started = await owner.call(`${reviewPath}?background=1&start=${startSeconds}`, { method: 'POST' });
    assert.equal(started.status, 202);
    await started.arrayBuffer();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { review, reviewStatus } = await (await owner.call(reviewPath)).json();
      if (reviewStatus.state === 'complete') return review;
      assert.equal(reviewStatus.state, 'running');
      await delay(15);
    }
    assert.fail('Timed out waiting for the review.');
  }

  const first = await start(0);
  assert.equal(first.observations[0].timestamp, 0.5);
  assert.equal(first.observationFrame.reference.phase, 'Dumbbells lowered');
  assert.equal(requests[1].content[1].image_url, 'data:image/jpeg;base64,' + chosen.toString('base64'));
  assert.equal(requests[1].content.filter(({ type }) => type === 'input_image').length, 3);
  const second = await start(1);
  assert.equal(second.observations[0].timestamp, 1.5);
  assert.deepEqual(second.observationFrame, {});
  const secondStill = await owner.call(imagePath(second.sequence) + '&profile=' + owner.key);
  assert.deepEqual(Buffer.from(await secondStill.arrayBuffer()), later);
  const { reviews } = await (await owner.call(clip + '/reviews')).json();
  assert.deepEqual(reviews, [second, first]);
  const workspace = await (await owner.call('workspace')).json();
  assert.equal(workspace.clips[0].review.reviewStill, undefined);
  assert.ok(reviews.every((review) => !('reviewStill' in review)));

  const path = imagePath(first.sequence);
  const response = await owner.call(path + '&profile=' + owner.key);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), chosen);
  assert.equal((await owner.call(path)).status, 409);
  assert.equal((await other.call(path + '&profile=' + other.key)).status, 404);

  const changed = await owner.call(clip + '/exercise', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId: 'push-up', previousExerciseId: 'dumbbell-bench-press' }),
  });
  assert.equal(changed.status, 200);
  assert.equal((await owner.call(path + '&profile=' + owner.key)).status, 404);
});
