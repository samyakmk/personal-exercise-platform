import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve('.data');
const destination = resolve(directory, 'movenet-thunder.onnx');
const temporary = resolve(directory, `movenet-thunder.${process.pid}.download`);
const url = 'https://huggingface.co/Xenova/movenet-singlepose-thunder/resolve/bf87836467d0c9988f3d76b96b2fe9f4262b0394/onnx/model.onnx';
const checksum = '3dca9f6e5f8a64dc9935a5be06fd8bf81bf01e696c9c05c6f2a650e0a401b763';
const valid = (bytes) => bytes && createHash('sha256').update(bytes).digest('hex') === checksum;

if (!valid(await readFile(destination).catch(() => null))) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error('MoveNet download failed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('MoveNet download checksum did not match.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
console.log('MoveNet Thunder is ready for local form review.');
