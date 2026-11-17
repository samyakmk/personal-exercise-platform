import { trainerPlusEnv } from './config.mjs';
import { resolve } from 'node:path';

const resolution = 256;
const defaultModel = resolve('.data/movenet-thunder.onnx');
let runtime;
let nextAttempt = 0;

async function loadModel() {
  const [ort, jpeg] = await Promise.all([import('onnxruntime-node'), import('jpeg-js')]);
  const session = await ort.InferenceSession.create(trainerPlusEnv('POSE_MODEL') || defaultModel, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 2,
    logSeverityLevel: 3,
  });
  return { ort, jpeg: jpeg.default, session };
}

async function model() {
  if (!runtime && Date.now() >= nextAttempt) {
    runtime = loadModel().catch(() => {
      nextAttempt = Date.now() + 30_000;
      runtime = undefined;
      return null;
    });
  }
  return runtime;
}

function letterbox({ width, height, data }) {
  const scale = resolution / Math.max(width, height);
  const scaledWidth = Math.round(width * scale);
  const scaledHeight = Math.round(height * scale);
  const left = Math.floor((resolution - scaledWidth) / 2);
  const top = Math.floor((resolution - scaledHeight) / 2);
  const rgb = new Int32Array(resolution * resolution * 3);
  for (let y = 0; y < scaledHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < scaledWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) / scale));
      const from = (sourceY * width + sourceX) * 4;
      const to = ((y + top) * resolution + x + left) * 3;
      rgb[to] = data[from];
      rgb[to + 1] = data[from + 1];
      rgb[to + 2] = data[from + 2];
    }
  }
  return { rgb, scale, left, top };
}

export async function estimatePoses(frames, signal) {
  const engine = await model();
  if (!engine) return null;
  const poses = [];
  for (const { image, timestamp } of frames) {
    signal?.throwIfAborted();
    const { rgb, scale, left, top } = letterbox(engine.jpeg.decode(image, { useTArray: true }));
    const result = await engine.session.run({ input: new engine.ort.Tensor('int32', rgb, [1, resolution, resolution, 3]) });
    const output = result.output_0.data;
    const points = Array.from({ length: 17 }, (_, index) => ({
      x: (output[3 * index + 1] * resolution - left) / scale,
      y: (output[3 * index] * resolution - top) / scale,
      confidence: output[3 * index + 2],
    }));
    poses.push({ timestamp, points });
  }
  return poses;
}
