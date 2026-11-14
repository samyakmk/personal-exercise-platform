import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const caseId = /^[a-z0-9][a-z0-9_-]*$/i;
const fields = new Set(['file', 'start', 'duration', 'filter']);
const videoFilter = /^(?:crop|scale|setsar|fps)=[a-z0-9:=+*/_.()-]+$/i;
const overlayMask = /^drawbox=x=\d{1,4}:y=\d{1,4}:w=\d{1,4}:h=\d{1,4}:color=0x[0-9a-f]{6}:t=fill$/i;

function isSourcePath(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9 _./-]*\.(?:mp4|mov|mkv|webm|m4v)$/i.test(value)
    && !value.split('/').some((part) => !part || part === '.' || part === '..');
}

function validateRecipe(recipe, id) {
  if (!recipe || !isSourcePath(recipe.file) || Object.keys(recipe).some((key) => !fields.has(key))) {
    throw new Error(`Provide a local video source and supported preparation fields for ${id}.`);
  }
  const { start, duration, filter } = recipe;
  if ((start !== undefined && (!Number.isFinite(start) || start < 0))
    || (duration !== undefined && (!Number.isFinite(duration) || duration <= 0))
    || (filter !== undefined && (typeof filter !== 'string' || filter.length > 300
      || !filter.split(',').every((part) => videoFilter.test(part) || overlayMask.test(part))))) {
    throw new Error(`Use valid trim, crop, scale, aspect ratio, frame-rate, or overlay-mask options for ${id}.`);
  }
}

export function selectPreparations(manifest, selectors = []) {
  if (!Array.isArray(manifest?.cases) || !manifest.cases.length) {
    throw new Error('The form evaluation manifest needs at least one case.');
  }
  const ids = new Set();
  for (const entry of manifest.cases) {
    if (typeof entry?.id !== 'string' || !caseId.test(entry.id) || ids.has(entry.id.toLowerCase())) {
      throw new Error('Use unique neutral case IDs containing letters, numbers, hyphens, and underscores.');
    }
    ids.add(entry.id.toLowerCase());
  }
  for (const selector of selectors) {
    if (!manifest.cases.some(({ id, group }) => selector === id || selector === group)) {
      throw new Error(`Unknown form evaluation case or group: ${selector}`);
    }
  }
  const cases = selectors.length
    ? manifest.cases.filter(({ id, group }) => selectors.includes(id) || selectors.includes(group))
    : manifest.cases;
  for (const { id, preparation } of cases) validateRecipe(preparation, id);
  return cases;
}

export async function encodeFormClip(source, destination, recipe = {}) {
  const { start, duration, filter } = recipe;
  await run(process.env.LIFTMORROW_FFMPEG || 'ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-protocol_whitelist', 'file',
    ...(start === undefined ? [] : ['-ss', String(start)]),
    '-i', source,
    ...(duration === undefined ? [] : ['-t', String(duration)]),
    '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-map_chapters', '-1',
    ...(filter === undefined ? [] : ['-vf', filter]),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', destination,
  ], { timeout: 120_000, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } });
}

async function resolveSource(root, { id, preparation }) {
  let source;
  try {
    source = await realpath(resolve(root, preparation.file));
    if (!(await stat(source)).isFile()) throw new Error('Expected a video file.');
  } catch {
    throw new Error(`Add ${preparation.file} to the local source folder to prepare ${id}.`);
  }
  const path = relative(root, source);
  if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) {
    throw new Error(`Keep the video source for ${id} inside the local source folder.`);
  }
  return source;
}

export async function prepareFormClips(cases, sources, clips, { encode = encodeFormClip, progress = () => {} } = {}) {
  const sourceRoot = await realpath(sources);
  const sourceFiles = await Promise.all(cases.map((entry) => resolveSource(sourceRoot, entry)));
  await mkdir(clips, { recursive: true, mode: 0o700 });
  const clipRoot = await realpath(clips);
  const destinations = cases.map(({ id }) => join(clipRoot, id + '.mp4'));
  if (destinations.some((destination) => sourceFiles.includes(destination))) {
    throw new Error('Choose a prepared-clip folder that does not overwrite any source videos.');
  }
  const temporary = await mkdtemp(join(clipRoot, '.prepare-'));
  try {
    for (const [index, { id, preparation }] of cases.entries()) {
      const output = join(temporary, id + '.mp4');
      try {
        await encode(sourceFiles[index], output, preparation);
        if (!(await stat(output)).size) throw new Error('The encoded video is empty.');
      } catch {
        throw new Error(`FFmpeg could not prepare ${id}. Check FFmpeg and the video source ${preparation.file}.`);
      }
      await rename(output, destinations[index]);
      progress(id);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { manifest: { type: 'string' }, sources: { type: 'string' }, clips: { type: 'string' } },
    allowPositionals: true,
  });
  if (!values.manifest || !values.sources || !values.clips) {
    throw new Error('Use --manifest, --sources, and --clips. Optionally add case IDs or groups.');
  }
  const manifest = JSON.parse(await readFile(values.manifest, 'utf8'));
  await prepareFormClips(selectPreparations(manifest, positionals), values.sources, values.clips, {
    progress: (id) => console.log(`Prepared ${id}.mp4`),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
