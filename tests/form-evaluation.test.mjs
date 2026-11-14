import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareReports, evaluationExitCode, scoreCase, transientRetryDelay } from '../scripts/evaluate-form.mjs';
import { AiError, createOpenAi } from '../server/ai.mjs';
import { reviewVersion } from '../server/coaching.mjs';

const measured = { coverage: 'measured', evidence: [] };
const check = 'push_up_hip_sag';
const adjustment = { check };
const extra = { check: 'push_up_raised_hips' };
const script = fileURLToPath(new URL('../scripts/evaluate-form.mjs', import.meta.url));

test('evaluation retries allow only known transient diagnostics with a bounded delay', async () => {
  const input = { name: 'mock', schema: {}, instructions: 'mock', content: [] };
  for (const [code, diagnostic, waits] of [
    ['EAI_AGAIN', 'dns_temporary', true], ['ENOTFOUND', 'dns_not_found', false],
    ['UND_ERR_CONNECT_TIMEOUT', 'connect_timeout', true], ['ECONNRESET', 'connection_reset', true],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_validation', false], ['UNRECOGNIZED_PRIVATE_VALUE', 'transport', false],
  ]) {
    const cause = Object.assign(new Error('sensitive transport cause'), { code });
    const respond = createOpenAi({ key: 'mock-key', fetchImpl: async () => { throw new TypeError('sensitive request', { cause }); } });
    await assert.rejects(respond(input), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.diagnostic, diagnostic);
      assert.doesNotMatch(error.message, /sensitive/);
      assert.equal(transientRetryDelay(error), waits ? 750 : null);
      return true;
    });
  }
  for (const [status, diagnostic, retryAfter, expected] of [
    [503, 503, 2, 2000], [503, 503, 7, null], [502, 504, undefined, 750], [504, 'timeout', undefined, 750],
    [503, 429, 2, null], [503, 'cooldown', 2, null], [503, 'quota', undefined, null], [503, 401, undefined, null],
  ]) assert.equal(transientRetryDelay(new AiError(status, 'test', diagnostic, retryAfter)), expected);
});

test('grades exact, missing, and extra checks without relying on the publisher label', () => {
  const item = { label: 'good', check };
  assert.equal(scoreCase(item, measured).outcome, 'miss');
  assert.equal(scoreCase(item, { ...measured, evidence: [adjustment] }).outcome, 'hit');
  assert.equal(scoreCase(item, { ...measured, evidence: [extra] }).outcome, 'miss');
  const scored = scoreCase(item, { ...measured, evidence: [adjustment, extra, extra] });
  assert.equal(scored.outcome, 'unexpected_adjustment');
  assert.deepEqual(scored.additional, [extra.check]);
});

test('distinguishes visual cues, verdict expectations, and local coverage', () => {
  const review = (verdict, observations = []) => ({ verdict, observations });
  const control = { group: 'visual', check: null };
  assert.equal(scoreCase(control, measured, review('observations', [{ kind: 'strength' }])).outcome, 'clear');
  assert.equal(scoreCase(control, measured, review('observations', [{ kind: 'adjustment' }])).outcome, 'unexpected_adjustment');
  assert.equal(scoreCase(control, measured, review('insufficient_visibility')).outcome, 'abstained');

  const front = { check: null, verdict: 'insufficient_visibility' };
  const limited = { coverage: 'limited', evidence: [] };
  assert.equal(scoreCase(front, measured).outcome, 'review_required');
  assert.equal(scoreCase(front, limited, review('insufficient_visibility')).outcome, 'expected_verdict');
  assert.equal(scoreCase(front, limited, review('different_exercise')).outcome, 'unexpected_verdict');
  assert.equal(scoreCase({ check: null }, limited).outcome, 'local_insufficient_evidence');
});

test('grades measured cues and clear controls locally when the rubric also names a live verdict', () => {
  const fault = { check, verdict: 'observations' };
  const control = { verdict: 'no_clear_issue' };
  const detected = { ...measured, evidence: [adjustment] };
  assert.equal(scoreCase(fault, measured).outcome, 'miss');
  assert.equal(scoreCase(fault, detected).outcome, 'hit');
  assert.equal(scoreCase(control, measured).outcome, 'clear');
  assert.equal(scoreCase(control, detected).outcome, 'unexpected_adjustment');
  assert.equal(scoreCase(control, { coverage: 'limited', evidence: [] }).outcome, 'local_insufficient_evidence');
  assert.equal(scoreCase({ verdict: 'observations' }, measured).outcome, 'review_required');
  assert.equal(scoreCase(fault, detected, { verdict: 'no_clear_issue', observations: [] }).outcome, 'unexpected_verdict');
});

test('strict exit codes distinguish rubric failures from operational errors in any trial', () => {
  const skip = { outcome: 'review_required' };
  assert.equal(evaluationExitCode([{ outcome: 'clear' }, skip], true), 0);
  const miss = { outcome: 'variable', trials: [{ outcome: 'hit' }, { outcome: 'miss' }] };
  assert.equal(evaluationExitCode([miss], false), 0);
  assert.equal(evaluationExitCode([miss], true), 2);
  assert.equal(evaluationExitCode([{ outcome: 'local_insufficient_evidence' }], true), 2);
  const error = { outcome: 'variable', trials: [{ outcome: 'hit' }, { outcome: 'error' }] };
  assert.equal(evaluationExitCode([error, miss], false), 1);
  assert.equal(evaluationExitCode([error, miss], true), 1);
});

test('ambiguous exploratory footage records observations without a strict grade', () => {
  const item = { exploratory: true };
  const review = { verdict: 'observations', observations: [{ ...adjustment, kind: 'adjustment' }] };
  const result = scoreCase(item, measured, review);
  assert.deepEqual(result, { outcome: 'exploratory', additional: [check], review });
  assert.equal(evaluationExitCode([result], true), 0);
  assert.equal(evaluationExitCode([result, { outcome: 'error' }], true), 1);
});

test('compares only matching case inputs and exposes legacy unverified clip bytes', () => {
  const result = { id: 'sample', group: 'test', subject: 1, label: 'bad', check, outcome: 'miss' };
  const baseline = { source: 'dataset', mode: 'local', results: [result] };
  const current = { ...baseline, repeat: 1, results: [{ ...result, outcome: 'hit', clipSha256: 'hash-a' }] };
  assert.deepEqual(compareReports(baseline, current), {
    changes: [{ id: 'sample', before: 'miss', after: 'hit' }],
    missingFingerprints: 1,
  });
  assert.throws(() => compareReports(baseline, { ...current, mode: 'live' }), /same mode and trial count/);
  assert.throws(() => compareReports(baseline, { ...current, repeat: 2 }), /same mode and trial count/);
  assert.throws(() => compareReports(baseline, { ...current, source: 'another dataset' }), /same dataset/);
  assert.throws(() => compareReports(baseline, { ...current, results: [] }), /same case IDs/);
  assert.throws(() => compareReports(baseline, { ...current, results: [{ ...result, view: 'front' }] }), /rubric changed for sample/);
  assert.deepEqual(compareReports(baseline, { ...baseline, repeat: 1, results: [{ ...result, mode: 'measured' }] }).changes, []);
  assert.throws(() => compareReports(baseline, { ...current, results: [{ ...result, mode: 'visual' }] }), /rubric changed for sample/);
  const differentBytes = { ...baseline, results: [{ ...result, clipSha256: 'hash-b' }] };
  assert.throws(() => compareReports(differentBytes, current), /video bytes changed for sample/);
});

test('shows repeat-trial changes even when both runs remain variable', () => {
  const make = (...outcomes) => ({
    source: 'dataset', mode: 'live', repeat: 3, results: [{
      id: 'sample', clipSha256: 'hash-a', outcome: 'variable', trials: outcomes.map((outcome) => ({ outcome })),
    }],
  });
  const baseline = make('hit', 'hit', 'miss');
  assert.deepEqual(compareReports(baseline, make('miss', 'hit', 'hit')), { changes: [], missingFingerprints: 0 });
  assert.deepEqual(compareReports(baseline, make('hit', 'miss', 'miss')).changes, [
    { id: 'sample', before: 'hit ×2, miss ×1', after: 'hit ×1, miss ×2' },
  ]);
});

test('matches per-case provenance independently of the default dataset and allows older inherited attribution', () => {
  const source = 'https://example.com/archive';
  const license = 'CC BY 4.0';
  const override = { source: 'https://example.com/recording', creator: 'Exercise Research', excerpt: '2–10 s' };
  const inherited = { id: 'clip-a', outcome: 'clear', clipSha256: 'hash-a' };
  const external = { id: 'clip-b', outcome: 'hit', clipSha256: 'hash-b', provenance: override };
  const baseline = { source, mode: 'local', repeat: 1, results: [inherited, external] };
  const current = {
    ...baseline,
    source: 'https://example.com/other-archive',
    license,
    results: [
      { ...inherited, clipFile: 'clip-a.mp4', provenance: { source, license } },
      { ...external, clipFile: 'clip-b.mp4' },
    ],
  };
  assert.deepEqual(compareReports(baseline, current), { changes: [], missingFingerprints: 0 });
  const compareExternal = (result) => compareReports(baseline, { ...current, results: [current.results[0], result] });
  assert.throws(() => compareExternal({ ...external, provenance: { ...override, source } }), /same dataset or external source for clip-b/);
  assert.throws(() => compareExternal({ ...external, provenance: { ...override, excerpt: '5–10 s' } }), /clip attribution changed for clip-b/);
  assert.throws(() => compareExternal({ ...external, clipFile: 'source.mp4' }), /neutral clip filename changed for clip-b/);
});

function runCli(args, env = {}, preload) {
  return spawnSync(process.execPath, [...(preload ? ['--import', pathToFileURL(preload).href] : []), script, ...args], {
    encoding: 'utf8', env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env },
  });
}

test('opt-in live retry is visible, bounded to one attempt, and excludes secrets from reports', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-evaluation-retry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = join(directory, 'manifest.json');
  const output = join(directory, 'report.json');
  const ffmpeg = join(directory, 'ffmpeg');
  const preload = join(directory, 'mock-provider.mjs');
  const id = 'fixture-01';
  await writeFile(manifest, JSON.stringify({ source: 'https://example.test/fixture', cases: [
    { id, group: 'visual', exercise: 'incline-push-up', verdict: 'different_exercise' },
  ] }));
  await writeFile(join(directory, id + '.mp4'), 'synthetic clip');
  await writeFile(ffmpeg, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync('source-times.txt', 'pts_time:0');
for (let i = 1; i <= 2; i++) {
  fs.writeFileSync(process.argv.at(-1).replace('%03d', String(i).padStart(3, '0')), 'synthetic image');
}
`, { mode: 0o700 });
  await writeFile(preload, `let count = 0;
globalThis.fetch = async () => {
  count++;
  if (process.env.REPFORM_MOCK_MODE === 'rate') return Response.json({ error: { code: 'rate_limit', message: 'provider-secret' } }, {status: 429});
  if (count === 1 || process.env.REPFORM_MOCK_MODE === 'fail') {
    throw new TypeError('provider-secret', { cause: Object.assign(new Error('endpoint-secret'), { code: 'EAI_AGAIN' }) });
  }
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text:
    JSON.stringify({ verdict: 'different_exercise', summary: 'Mock review.', limitations: 'Mock limitation.', observations: [] })
  }] }], usage: { marker: 'usage-secret' } });
};`);
  const args = ['--manifest', manifest, '--clips', directory, '--output', output, '--live', '--strict'];
  const env = { CHATGPT_API_KEY: 'key-secret', REPFORM_AI_MODEL: 'gpt-5.4-mini-mock', REPFORM_FFMPEG: ffmpeg };
  const defaultRun = runCli(args, env, preload);
  assert.equal(defaultRun.status, 1, defaultRun.stderr);
  assert.doesNotMatch(defaultRun.stderr, /retrying/);
  let report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.retryPolicy, 'none');
  assert.equal(report.results[0].diagnostic, 'dns_temporary');

  const retryArgs = [...args, '--retry-transient'];
  const recovered = runCli(retryArgs, env, preload);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stderr, /fixture-01 trial 1.*dns_temporary.*retrying once/);
  const raw = await readFile(output, 'utf8');
  report = JSON.parse(raw);
  assert.equal(report.model, env.REPFORM_AI_MODEL);
  assert.equal(report.reviewVersion, reviewVersion);
  assert.equal(report.retryPolicy, 'one-transient-v1');
  assert.deepEqual(report.results[0].retry, { diagnostic: 'dns_temporary', delayMs: 750 });
  assert.equal(report.results[0].outcome, 'expected_verdict');
  assert.doesNotMatch(raw + recovered.stdout + recovered.stderr, /key-secret|usage-secret|endpoint-secret|provider-secret/);

  const exhausted = runCli(retryArgs, { ...env, REPFORM_MOCK_MODE: 'fail' }, preload);
  assert.equal(exhausted.status, 1, exhausted.stderr);
  assert.equal(exhausted.stderr.match(/retrying once/g).length, 1);
  report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.results[0].outcome, 'error');
  assert.ok(report.results[0].retry);

  const rateLimited = runCli(retryArgs, { ...env, REPFORM_MOCK_MODE: 'rate' }, preload);
  assert.equal(rateLimited.status, 1, rateLimited.stderr);
  assert.doesNotMatch(rateLimited.stderr, /retrying/);
  report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.results[0].diagnostic, 429);
  assert.equal(report.results[0].retry, undefined);
});

test('CLI writes a report and exits 1 when a fixture is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-evaluation-test-'));
  try {
    const output = join(directory, 'report.json');
    const result = runCli(['--clips', directory, '--strict', '--output', output, 'clip-a']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Missing clip-a\.mp4/);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.mode, 'local');
    assert.equal(report.results[0].outcome, 'error');
    assert.equal(report.results[0].clipFile, 'clip-a.mp4');
    assert.deepEqual(report.results[0].provenance, { source: report.source, license: report.license });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('comparison rejects changed clip bytes before decoding or calling the provider', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-evaluation-comparison-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = 'https://example.test/fixture';
  const item = { id: 'fixture-01', group: 'visual', exercise: 'incline-push-up', verdict: 'different_exercise' };
  const manifest = join(directory, 'manifest.json');
  const baseline = join(directory, 'baseline.json');
  const decoder = join(directory, 'decoder');
  const marker = join(directory, 'started');
  await Promise.all([
    writeFile(manifest, JSON.stringify({ source, cases: [item] })),
    writeFile(baseline, JSON.stringify({ source, mode: 'live', results: [
      { ...item, clipSha256: createHash('sha256').update('original').digest('hex'), outcome: 'expected_verdict' },
    ] })),
    writeFile(join(directory, item.id + '.mp4'), 'edited source'),
    writeFile(decoder, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`, { mode: 0o700 }),
  ]);
  const run = runCli(['--manifest', manifest, '--clips', directory, '--compare', baseline, '--live'], {
    CHATGPT_API_KEY: 'mock-key', REPFORM_FFMPEG: decoder,
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /The video bytes changed for fixture-01/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('reports identical clip bytes under different case IDs without changing strict grades', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-duplicate-evaluation-test-'));
  try {
    const manifestPath = join(directory, 'manifest.json');
    const output = join(directory, 'report.json');
    const ffmpeg = join(directory, 'ffmpeg');
    const source = 'https://example.com/recording';
    const cases = ['clip-a', 'clip-b', 'clip-c'].map((id, index) => ({
      id, group: 'evaluation', verdict: 'insufficient_visibility',
      provenance: { source, excerpt: index === 2 ? '3–5 s' : '0–2 s' },
    }));
    await writeFile(manifestPath, JSON.stringify({ cases }));
    const bytes = Buffer.from('synthetic fixture bytes');
    await Promise.all([
      writeFile(join(directory, 'clip-a.mp4'), bytes),
      writeFile(join(directory, 'clip-b.mp4'), bytes),
      writeFile(join(directory, 'clip-c.mp4'), 'a different excerpt from the same source'),
      writeFile(ffmpeg, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync('source-times.txt', 'pts_time:0');
for (let i = 1; i <= 4; i++) {
  fs.writeFileSync(process.argv.at(-1).replace('%03d', String(i).padStart(3, '0')), 'synthetic image');
}
`, { mode: 0o700 }),
    ]);
    const result = runCli(['--manifest', manifestPath, '--clips', directory, '--output', output, '--strict'], {
      REPFORM_FFMPEG: ffmpeg,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Identical clip bytes for clip-a, clip-b\. Check provenance/);
    assert.doesNotMatch(result.stderr, /Identical clip bytes[^\n]*clip-c/);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(report.duplicateClips, [{
      caseIds: ['clip-a', 'clip-b'], clipSha256: createHash('sha256').update(bytes).digest('hex'),
    }]);
    assert.deepEqual(report.totals, { review_required: 3 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a custom manifest loads external fixtures only by neutral ID and keeps attribution in the report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-external-evaluation-test-'));
  try {
    const manifestPath = join(directory, 'manifest.json');
    const output = join(directory, 'report.json');
    const provenance = {
      source: 'https://example.com/corrective-video',
      title: 'Original title',
      creator: 'Exercise Research',
      license: 'CC BY 4.0',
      excerpt: '2–10 s, audio removed',
    };
    const cases = [
      { id: 'external-01', group: 'external', check: null, provenance },
      { id: 'external-02', group: 'external', check: null, provenance },
    ];
    await writeFile(manifestPath, JSON.stringify({ cases }));
    const bytes = Buffer.from('synthetic fixture bytes');
    await writeFile(join(directory, 'external-02.mp4'), bytes);
    const result = runCli(['--manifest', manifestPath, '--dataset', directory, '--clips', directory, '--output', output], {
      REPFORM_FFMPEG: join(directory, 'missing-ffmpeg'),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Missing external-01\.mp4\. Place the prepared external clip/);
    assert.match(result.stderr, /external-02  error  Video analysis needs FFmpeg/);
    assert.doesNotMatch(result.stderr + result.stdout, /example\.com|Original title/);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(report.results.map(({ clipFile, provenance: source }) => [clipFile, source]), [
      ['external-01.mp4', provenance], ['external-02.mp4', provenance],
    ]);
    assert.equal(report.results[1].clipSha256, createHash('sha256').update(bytes).digest('hex'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects malformed provenance and path-like or colliding fixture IDs before evaluating', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-invalid-evaluation-test-'));
  try {
    const path = join(directory, 'manifest.json');
    const cases = [{ id: 'external-01', group: 'external', provenance: { source: 'https://example.com/video' } }];
    for (const [items, message] of [
      [[{ ...cases[0], id: '../external-01' }], /unique neutral ID/],
      [[cases[0], { ...cases[0], id: 'EXTERNAL-01' }], /unique neutral ID/],
      [[{ ...cases[0], provenance: { source: 'file:///tmp/video.mp4' } }], /HTTP or HTTPS source URL/],
      [[{ ...cases[0], provenance: { ...cases[0].provenance, excerpt: 3 } }], /non-empty text for the excerpt/],
    ]) {
      await writeFile(path, JSON.stringify({ cases: items }));
      const result = runCli(['--manifest', path, '--clips', directory]);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stderr, /Missing .*\.mp4/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unknown or inconsistent group, exercise, mode, check, and verdict values', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-invalid-rubric-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'manifest.json');
  const source = 'https://example.com/video';
  const sample = { id: 'fixture-01', group: 'lunge', exercise: 'reverse-lunge', check: null, provenance: { source } };
  for (const [fields, message] of [
    [{ group: undefined }, /Specify a group for fixture-01/],
    [{ group: 'test fixtures' }, /Specify a group for fixture-01/],
    [{ exercise: 'side-lunge' }, /Use a catalog exercise ID for fixture-01/],
    [{ mode: 'offline' }, /Use measured or visual mode for fixture-01/],
    [{ mode: 'measured' }, /reverse-lunge has no local assessment/],
    [{ check: 'lunge_heel_lift' }, /Use null when this mode has no named checks/],
    [{ exercise: 'push-up', check: 'squat_short_depth' }, /Invalid check for fixture-01 \(push-up\).*push_up_hip_sag/],
    [{ exercise: 'push-up', check, mode: 'visual' }, /Use measured mode for the named check/],
    [{ verdict: 'correct_form' }, /Use one of these verdicts for fixture-01/],
    [{ exploratory: true, verdict: 'no_clear_issue' }, /Use exploratory: true without a required check or verdict/],
    [{ exercise: 'push-up', check, verdict: 'no_clear_issue' }, /A case expecting a correction must use observations/],
  ]) {
    await writeFile(path, JSON.stringify({ cases: [{ ...sample, ...fields }] }));
    const result = runCli(['--manifest', path, '--clips', directory]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, message);
  }
});

test('custom groups and explicit overrides select the right cases offline and with a mocked reviewer', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'repform-evaluation-mode-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = join(directory, 'manifest.json');
  const output = join(directory, 'report.json');
  const ffmpeg = join(directory, 'ffmpeg');
  const preload = join(directory, 'mock-review.mjs');
  const provenance = { source: 'https://example.com/video' };
  const cases = [
    { id: 'fixture-01', group: 'lunge', exercise: 'dumbbell-curl', mode: 'visual', verdict: 'no_clear_issue' },
    { id: 'fixture-02', group: 'visual', exercise: 'dumbbell-shoulder-press', verdict: 'different_exercise' },
    { id: 'fixture-03', group: 'lunge', exercise: 'push-up', mode: 'visual', verdict: 'different_exercise' },
    { id: 'fixture-04', group: 'visual', exercise: 'push-up', mode: 'measured', check },
    { id: 'fixture-05', group: 'mixed', exercise: 'push-up', verdict: 'different_exercise' },
    { id: 'fixture-06', group: 'lunge', exercise: 'reverse-lunge', mode: 'visual', verdict: 'different_exercise' },
  ];
  await writeFile(manifest, JSON.stringify({ cases: cases.map((item) => ({ ...item, provenance })) }));
  for (const { id } of cases) await writeFile(join(directory, id + '.mp4'), 'synthetic clip');
  await writeFile(ffmpeg, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync('source-times.txt', 'pts_time:0');
for (let i = 1; i <= 12; i++) {
  fs.writeFileSync(process.argv.at(-1).replace('%03d', String(i).padStart(3, '0')), 'synthetic image');
}
`, { mode: 0o700 });
  await writeFile(preload, `globalThis.fetch = async (url, { body }) => {
    if (url !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected fetch.');
    const { exercise } = JSON.parse(JSON.parse(body).input[0].content[0].text);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{
      type: 'output_text',
      text: JSON.stringify({
        verdict: exercise === 'Single-Arm Dumbbell Curl' ? 'observations' : 'different_exercise',
        summary: 'Mock review.', limitations: 'Mock limitation.', observations: [],
      }),
    }] }] });
  };`);
  const args = ['--manifest', manifest, '--clips', directory, '--output', output, '--strict'];
  const env = { REPFORM_FFMPEG: ffmpeg, REPFORM_POSE_MODEL: join(directory, 'missing-model') };

  const local = runCli(args, env);
  assert.equal(local.status, 1, local.stderr);
  assert.match(local.stdout, /Skipped 4 visual case\(s\)/);
  const localReport = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(localReport.skipped, ['fixture-01', 'fixture-02', 'fixture-03', 'fixture-06']);
  assert.deepEqual(localReport.results.map(({ id, outcome }) => [id, outcome]), [
    ['fixture-04', 'error'], ['fixture-05', 'review_required'],
  ]);

  const reviewed = runCli([...args, '--live'], { ...env, CHATGPT_API_KEY: 'mock-key' }, preload);
  assert.equal(reviewed.status, 1, reviewed.stderr);
  assert.match(reviewed.stderr, /fixture-04  error  MoveNet measurements unavailable/);
  const liveReport = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(liveReport.results.map(({ mode, outcome }) => [mode, outcome]), [
    ['visual', 'expected_verdict'], ['visual', 'expected_verdict'], ['visual', 'expected_verdict'],
    ['measured', 'error'], ['measured', 'expected_verdict'], ['visual', 'expected_verdict'],
  ]);

  const onlyVisual = runCli([...args, 'lunge'], env);
  assert.equal(onlyVisual.status, 1, onlyVisual.stderr);
  assert.match(onlyVisual.stderr, /Add --live to run them/);
  const skippedReport = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(skippedReport.skipped, ['fixture-01', 'fixture-03', 'fixture-06']);
  assert.deepEqual(skippedReport.results, []);
});
