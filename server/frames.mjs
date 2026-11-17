import { trainerPlusEnv } from './config.mjs';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { AiError } from './ai.mjs';

const run = promisify(execFile);
export const reviewWindowSeconds = 20;
export const maxReviewFrames = 8;

export async function extractFrames(source, {
  binary = trainerPlusEnv('FFMPEG') || 'ffmpeg', mime, signal, sampleRate = 2, startSeconds = 0, endSeconds,
} = {}) {
  const duration = endSeconds === undefined ? reviewWindowSeconds : endSeconds - startSeconds;
  const frameLimit = Math.min(duration, reviewWindowSeconds) * sampleRate;
  const fps = frameLimit / duration;
  const directory = await mkdtemp(join(tmpdir(), 'trainer-plus-frames-'));
  try {
    const input = join(directory, 'clip');
    await pipeline(Readable.from(source, { objectMode: false }), createWriteStream(input, { mode: 0o600 }), { signal });
    const filters = [
      ...(endSeconds === undefined ? [] : [`trim=end=${duration}`]),
      // Capture the actual first decoded presentation time before resetting the sample grid.
      'metadata=mode=add:key=trainer-plus:value=1',
      'metadata=mode=print:key=trainer-plus:file=source-times.txt',
      'setpts=PTS-STARTPTS',
      `trim=duration=${duration}`,
      `fps=${duration > reviewWindowSeconds ? frameLimit + '/' + duration : sampleRate}:start_time=0`,
      'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
    ].join(',');
    try {
      await run(binary, [
        '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-threads', '2',
        ...(startSeconds ? ['-ss', String(startSeconds)] : []),
        '-f', mime === 'video/webm' ? 'matroska' : 'mov', '-i', input, '-map', '0:V:0',
        '-an', '-sn', '-dn', '-t', String(duration),
        '-filter_threads', '1', '-vf', filters,
        '-threads', '1', '-q:v', '4', '-frames:v', String(frameLimit),
        join(directory, 'frame-%03d.jpg'),
      ], { cwd: directory, timeout: 18_000, maxBuffer: 64 * 1024, signal, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } });
    } catch (error) {
      if (signal?.aborted) throw new AiError(404, 'Video not found.');
      if (error.code === 'ENOENT') throw new AiError(503, 'Video analysis needs FFmpeg on the server.', 'ffmpeg_missing');
      if (error.killed) throw new AiError(422, 'This clip took too long to decode. Try a shorter or lower-resolution clip.');
      throw new AiError(422, 'Could not extract frames. Try another MP4 or WebM clip.');
    }

    const names = (await readdir(directory)).filter((name) => /^frame-\d{3}\.jpg$/.test(name)).sort();
    const minimumFrames = Math.ceil(fps);
    if (names.length >= minimumFrames) {
      const sourceTimes = await readFile(join(directory, 'source-times.txt'), { encoding: 'utf8', signal });
      const first = Number(sourceTimes.match(/\bpts_time:(\S+)/)?.[1]);
      const offset = Number.isFinite(first) ? Math.round(Math.max(0, first) * 1000) / 1000 : 0;
      const window = names.slice(0, Math.max(0, Math.ceil((duration - offset) * fps)));
      if (window.length >= minimumFrames) return await Promise.all(window.map(async (name, index) => ({
        timestamp: Math.round((startSeconds + offset + index / fps) * 1000) / 1000,
        image: await readFile(join(directory, name), { signal }),
      })));
    }
    throw new AiError(422, 'Choose a starting point with at least one second of exercise footage remaining.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}


export function selectReviewFrames(frames, evidence = []) {
  if (frames.length <= maxReviewFrames) return frames;
  const byTime = new Map(frames.map((frame) => [frame.timestamp, frame]));
  const selected = new Set();
  for (const { timestamp, comparisonTimestamp } of evidence) {
    for (const time of [timestamp, comparisonTimestamp]) {
      if (selected.size === maxReviewFrames) break;
      const frame = byTime.get(time);
      if (frame) selected.add(frame);
    }
  }
  const slots = maxReviewFrames - selected.size;
  // Short adjacent bursts reduce the chance of sampling the same phase of every repetition.
  const groups = Math.ceil(slots / 2);
  const indices = [];
  for (let index = 0; index < groups; index += 1) {
    const center = Math.round((index + 0.5) * (frames.length - 1) / groups);
    const step = Math.max(1, Math.round(0.55 / (frames[1].timestamp - frames[0].timestamp)));
    indices.push(Math.max(0, center - step), Math.min(frames.length - 1, center + step));
  }
  for (const index of indices) {
    if (selected.size < maxReviewFrames) selected.add(frames[index]);
  }
  for (let index = 0; index < frames.length && selected.size < maxReviewFrames; index += 1) {
    selected.add(frames[index]);
  }
  return [...selected].sort((a, b) => a.timestamp - b.timestamp);
}

// Use projected joint extension to find distinct positions for inspection.
// Camera angle affects this estimate, so it is only used to choose images.
export function movementPhaseTimes(poses, joints) {
  const positions = poses.flatMap(({ timestamp, points }) => {
    const extensions = [0, 1].flatMap((side) => {
      const [start, joint, end] = joints.map((index) => points[index + side]);
      if (Math.min(start.confidence, joint.confidence, end.confidence) < 0.35) return [];
      const first = Math.hypot(start.x - joint.x, start.y - joint.y);
      const second = Math.hypot(joint.x - end.x, joint.y - end.y);
      if (Math.min(first, second) < 12) return [];
      return [Math.hypot(start.x - end.x, start.y - end.y) / (first + second)];
    });
    return extensions.length ? [{ timestamp, extension: extensions.reduce((sum, value) => sum + value, 0) / extensions.length }] : [];
  });
  if (positions.length < 2) return [];
  const midpoint = (positions[0].timestamp + positions.at(-1).timestamp) / 2;
  const windows = [positions.filter(({ timestamp }) => timestamp < midpoint), positions.filter(({ timestamp }) => timestamp >= midpoint)];
  return windows.flatMap((window) => {
    let maximum = 0.09;
    let pair = [];
    for (const [index, from] of window.entries()) {
      for (let next = index + 1; next < window.length; next += 1) {
        const to = window[next];
        const elapsed = to.timestamp - from.timestamp;
        if (elapsed > 2) break;
        const change = Math.abs(to.extension - from.extension);
        if (elapsed < 0.5 || change <= maximum) continue;
        maximum = change;
        pair = [from.timestamp, to.timestamp];
      }
    }
    return pair;
  });
}
