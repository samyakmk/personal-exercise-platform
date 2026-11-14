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
  binary = process.env.LIFTMORROW_FFMPEG || 'ffmpeg', mime, signal, sampleRate = 2, startSeconds = 0,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'liftmorrow-frames-'));
  try {
    const input = join(directory, 'clip');
    await pipeline(Readable.from(source, { objectMode: false }), createWriteStream(input, { mode: 0o600 }), { signal });
    const filters = [
      // Capture the actual first decoded presentation time before resetting the sample grid.
      'metadata=mode=add:key=liftmorrow:value=1',
      'metadata=mode=print:key=liftmorrow:file=source-times.txt',
      'setpts=PTS-STARTPTS',
      `trim=duration=${reviewWindowSeconds}`,
      `fps=${sampleRate}:start_time=0`,
      'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
    ].join(',');
    try {
      await run(binary, [
        '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-threads', '2',
        ...(startSeconds ? ['-ss', String(startSeconds)] : []),
        '-f', mime === 'video/webm' ? 'matroska' : 'mov', '-i', input, '-map', '0:V:0',
        '-an', '-sn', '-dn', '-t', String(reviewWindowSeconds),
        '-filter_threads', '1', '-vf', filters,
        '-threads', '1', '-q:v', '4', '-frames:v', String(reviewWindowSeconds * sampleRate),
        join(directory, 'frame-%03d.jpg'),
      ], { cwd: directory, timeout: 18_000, maxBuffer: 64 * 1024, signal, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } });
    } catch (error) {
      if (signal?.aborted) throw new AiError(404, 'Video not found.');
      if (error.code === 'ENOENT') throw new AiError(503, 'Video analysis needs FFmpeg on the server.', 'ffmpeg_missing');
      if (error.killed) throw new AiError(422, 'This clip took too long to decode. Try a shorter or lower-resolution clip.');
      throw new AiError(422, 'Could not extract frames. Try another MP4 or WebM clip.');
    }

    const names = (await readdir(directory)).filter((name) => /^frame-\d{3}\.jpg$/.test(name)).sort();
    if (names.length >= sampleRate) {
      const sourceTimes = await readFile(join(directory, 'source-times.txt'), { encoding: 'utf8', signal });
      const first = Number(sourceTimes.match(/\bpts_time:(\S+)/)?.[1]);
      const offset = Number.isFinite(first) ? Math.round(Math.max(0, first) * 1000) / 1000 : 0;
      const window = names.slice(0, Math.max(0, Math.ceil((reviewWindowSeconds - offset) * sampleRate)));
      if (window.length >= sampleRate) return await Promise.all(window.map(async (name, index) => ({
        timestamp: Math.round((startSeconds + offset + index / sampleRate) * 1000) / 1000,
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
