import { trainerPlusEnv } from './config.mjs';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AiError } from './ai.mjs';

const run = promisify(execFile);

export async function convertQuickTime(bytes, { limit, signal, binary = trainerPlusEnv('FFMPEG') || 'ffmpeg' }) {
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'trainer-plus-quicktime-'));
  const input = join(directory, 'clip.mov');
  const output = join(directory, 'clip.mp4');
  try {
    await writeFile(input, bytes, { mode: 0o600, signal });
    try {
      await run(binary, [
        '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file',
        '-threads', '2', '-f', 'mov', '-i', input, '-map', '0:V:0', '-map', '0:a:0?',
        '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1', '-filter_threads', '1',
        '-vf', "scale='min(iw,1280)':'min(ih,1280)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '22', '-threads', '2', '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart', '-fs', String(limit), output,
      ], { timeout: 40_000, maxBuffer: 64 * 1024, signal, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } });
    } catch (error) {
      signal?.throwIfAborted();
      if (error.code === 'ENOENT') throw new AiError(503, 'Converting a MOV needs FFmpeg on the server.', 'ffmpeg_missing');
      if (error.killed) throw new AiError(422, 'This MOV took too long to convert. Try a shorter clip.');
      throw new AiError(422, 'This MOV could not be converted. Try exporting it as an H.264 MP4.');
    }
    // FFmpeg may stop a little before the file-size limit, depending on its container buffering.
    if ((await stat(output)).size >= limit - 256 * 1024) {
      throw new AiError(413, 'The converted video is too large. Try a shorter clip.');
    }
    return await readFile(output, { signal });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
