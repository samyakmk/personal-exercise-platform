import { parentPort } from 'node:worker_threads';
import { estimatePoses } from './pose.mjs';

let active;
parentPort.on('message', async ({ id, frames }) => {
  if (!frames) {
    if (active?.id === id) active.controller.abort();
    return;
  }
  const controller = new AbortController();
  active = { id, controller };
  try {
    const poses = await estimatePoses(frames, controller.signal);
    parentPort.postMessage({ id, poses });
  } catch {
    parentPort.postMessage({ id, failed: true });
  } finally {
    active = undefined;
  }
});
