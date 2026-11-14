import { Worker } from 'node:worker_threads';

const workerScript = new URL('./pose-worker.mjs', import.meta.url);
const maxQueued = 2;

export function createPosePool({ workerUrl = workerScript, modelPath = process.env.REPFORM_POSE_MODEL } = {}) {
  let worker;
  let active;
  let nextId = 0;
  let stopping;
  const queue = [];

  function finish(job, error, poses) {
    job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error);
    else job.resolve(poses);
  }

  function unavailable(current) {
    if (worker !== current) return;
    worker = undefined;
    const error = new Error('The local pose worker stopped.');
    if (active) finish(active, error);
    active = undefined;
    for (const job of queue.splice(0)) finish(job, error);
  }

  function startWorker() {
    const current = new Worker(workerUrl, {
      env: modelPath ? { REPFORM_POSE_MODEL: modelPath } : {},
      execArgv: [],
    });
    worker = current;
    current.on('message', ({ id, poses, failed }) => {
      if (worker !== current || active?.id !== id) return;
      const completed = active;
      active = undefined;
      finish(completed, failed ? new Error('The local pose worker could not estimate keypoints.') : null, poses);
      drain();
    });
    current.once('error', () => unavailable(current));
    current.once('exit', () => unavailable(current));
    return current;
  }

  function drain() {
    if (stopping || active) return;
    const job = queue.shift();
    if (!job) {
      worker?.unref();
      return;
    }
    try {
      const current = worker ?? startWorker();
      active = job;
      current.ref();
      // The original JPEGs are still used by the main thread for visual review.
      const frames = job.frames.map(({ timestamp, image }) => ({ timestamp, image: Uint8Array.from(image) }));
      current.postMessage({ id: job.id, frames }, frames.map(({ image }) => image.buffer));
      job.frames = undefined;
    } catch (error) {
      active = undefined;
      finish(job, error);
      drain();
    }
  }

  return {
    async estimate(frames, signal) {
      signal?.throwIfAborted();
      if (stopping || queue.length >= maxQueued) throw new Error('The local pose worker is busy.');
      return new Promise((resolve, reject) => {
        const job = { id: ++nextId, frames, signal, resolve, reject, abort: () => {
          if (active === job) {
            // Release the slot only after the worker has stopped the in-flight inference batch.
            try { worker.postMessage({ id: job.id }); }
            catch { unavailable(worker); }
          } else {
            const index = queue.indexOf(job);
            if (index !== -1) queue.splice(index, 1);
          }
          finish(job, signal.reason);
        } };
        signal?.addEventListener('abort', job.abort, { once: true });
        queue.push(job);
        drain();
      });
    },
    stop() {
      if (stopping) return stopping;
      const current = worker;
      const error = new Error('The local pose worker is stopping.');
      worker = undefined;
      if (active) finish(active, error);
      active = undefined;
      for (const job of queue.splice(0)) finish(job, error);
      stopping = current ? current.terminate() : Promise.resolve();
      return stopping;
    },
  };
}
