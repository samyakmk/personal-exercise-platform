import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareFormClips, selectPreparations } from '../scripts/prepare-form-clips.mjs';

test('each external manifest has valid local preparations and documented sources', async () => {
  for (const name of ['form-external', 'form-core']) {
    const manifest = JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
    const all = selectPreparations(manifest);
    assert.equal(all.length, manifest.cases.length);
    const [first, second] = all;
    assert.deepEqual(selectPreparations(manifest, [first.id, second.id]), [first, second]);
    assert.throws(() => selectPreparations(manifest, ['absent']), /Unknown/);
    for (const { preparation } of all) {
      const source = manifest.sources[preparation.file];
      assert.ok(source?.download || source?.archiveMember || source?.source);
    }
  }
});

test('clip preparation validates recipes and replaces existing output only after encoding', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trainer-plus-prep-'));
  try {
    const sources = join(root, 'sources');
    const clips = join(root, 'clips');
    await mkdir(sources);
    await mkdir(clips);
    const manifest = { cases: [{ id: 'neutral-01', group: 'sample', preparation: { file: 'original.mp4', duration: 2, filter: 'scale=720:-2' } }] };
    const cases = selectPreparations(manifest);
    const previous = join(clips, 'neutral-01.mp4');
    await writeFile(previous, 'previous clip');
    const outside = join(root, 'outside.mp4');
    await writeFile(outside, 'outside original');
    const source = join(sources, 'original.mp4');
    await symlink(outside, source);
    const encode = async (_, output) => { await writeFile(output, 'new clip'); };
    await assert.rejects(prepareFormClips(cases, sources, clips, { encode }), /inside the local source folder/);
    await rm(source);
    await writeFile(source, 'local original');
    await assert.rejects(prepareFormClips(cases, sources, clips, { encode: async (_, output) => {
      await writeFile(output, 'partial clip');
      throw new Error('codec failed');
    } }), /FFmpeg could not prepare/);
    assert.equal(await readFile(previous, 'utf8'), 'previous clip');
    await prepareFormClips(cases, sources, clips, { encode });
    assert.equal(await readFile(previous, 'utf8'), 'new clip');
    assert.deepEqual(await readdir(clips), ['neutral-01.mp4']);
    manifest.cases[0].preparation.filter = 'scale=720:-2,movie=somewhere.mp4';
    assert.throws(() => selectPreparations(manifest), /valid trim/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
