import assert from 'node:assert/strict';
import { parentPort } from 'node:worker_threads';

assert.deepEqual(process.execArgv, []);
assert.deepEqual({ ...process.env }, { REPFORM_POSE_MODEL: 'synthetic-model-path' });

parentPort.on('message', ({ id, frames }) => {
  if (!frames) {
    parentPort.postMessage({ id, failed: true });
    return;
  }
  const [{ timestamp }] = frames;
  if (timestamp === -1) process.exit(1);
  if (timestamp < 0) return;
  parentPort.postMessage({ id, poses: [{ timestamp, points: [] }] });
});
