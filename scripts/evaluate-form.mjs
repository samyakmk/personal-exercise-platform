import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { AiError, createOpenAi, openAiModel, reviewExercise } from '../server/ai.mjs';
import { hasLocalAssessment, prepareClipReview } from '../server/analyze-clip.mjs';
import { exercisesById } from '../server/catalog.mjs';
import { reviewVersion } from '../server/coaching.mjs';
import { encodeFormClip } from './prepare-form-clips.mjs';

const gradingVersion = 4;
const retryPolicy = 'one-transient-v1';
const transientTransport = new Set(['dns_temporary', 'connect_timeout', 'connection_reset']);
const safeProviderDiagnostics = new Set([
  ...transientTransport, 'dns_not_found', 'tls_validation', 'transport', 'timeout', 'cooldown', 'quota',
  'content_filter', 'output_limit', 'output_validation', 'response_format',
]);
const attributionFields = ['title', 'creator', 'license', 'excerpt'];
const caseName = /^[a-z0-9][a-z0-9_-]*$/i;
const sha256Hex = /^[a-f0-9]{64}$/i;
const reviewVerdicts = ['observations', 'no_clear_issue', 'insufficient_visibility', 'different_exercise'];
const squatChecks = ['squat_short_depth'];
const checksByExercise = new Map([
  ['push-up', ['push_up_hip_sag', 'push_up_raised_hips', 'push_up_shallow_descent']],
  ['bodyweight-squat', squatChecks],
  ['goblet-squat', squatChecks],
  ['dumbbell-shoulder-press', ['shoulder_press_short_descent']],
  ['forearm-plank', ['plank_hip_sag', 'plank_raised_hips']],
  ['dumbbell-curl', ['curl_torso_rocking']],
  ['pull-up', ['pull_up_short_bottom', 'pull_up_repeated_swing']],
  ['glute-bridge', ['glute_bridge_trunk_shift']],
  ['bird-dog', ['bird_dog_pelvis_rotation']],
  ['dumbbell-row', ['dumbbell_row_trunk_turn']],
]);
const visualChecksByExercise = new Map([
  ['dead-bug', ['dead_bug_trunk_shift']],
]);

function caseMode({ mode, group, exercise = 'push-up' }) {
  return mode ?? (group === 'visual' || !hasLocalAssessment(exercise) ? 'visual' : 'measured');
}

function isVerdictOnly({ verdict, check }) {
  return !check && ['insufficient_visibility', 'different_exercise'].includes(verdict);
}

function canScoreLocal(item) {
  return caseMode(item) === 'measured' && (!item.verdict || item.check || item.verdict === 'no_clear_issue');
}

function validateProvenance(provenance, context) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error(`Specify fixture provenance for ${context}.`);
  }
  const { source } = provenance;
  const url = typeof source === 'string' ? URL.parse(source) : null;
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`Use an HTTP or HTTPS source URL for ${context}.`);
  }
  if (Object.keys(provenance).some((key) => key !== 'source' && !attributionFields.includes(key))) {
    throw new Error(`Use source, title, creator, license, or excerpt for the provenance of ${context}.`);
  }
  for (const key of attributionFields) {
    const value = provenance[key];
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      throw new Error(`Use non-empty text for the ${key} of ${context}.`);
    }
  }
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest?.cases) || !manifest.cases.length) {
    throw new Error('The form evaluation manifest needs at least one case.');
  }
  if (manifest.cases.some((item) => item && item.provenance === undefined)) {
    validateProvenance({ source: manifest.source, license: manifest.license }, 'the default dataset');
  }
  const ids = new Set();
  for (const item of manifest.cases) {
    if (typeof item?.id !== 'string' || !caseName.test(item.id) || ids.has(item.id.toLowerCase())) {
      throw new Error('Use a unique neutral ID for each form evaluation clip, using only letters, numbers, hyphens, and underscores.');
    }
    const { id, group, exercise = 'push-up', mode, check, verdict, exploratory, provenance, sourceFamily } = item;
    ids.add(id.toLowerCase());
    if (typeof group !== 'string' || !caseName.test(group)) {
      throw new Error(`Specify a group for ${id} using only letters, numbers, hyphens, and underscores.`);
    }
    if (!exercisesById.has(exercise)) throw new Error(`Use a catalog exercise ID for ${id}.`);
    if (mode !== undefined && !['measured', 'visual'].includes(mode)) {
      throw new Error(`Use measured or visual mode for ${id}.`);
    }
    if (caseMode(item) === 'measured' && !hasLocalAssessment(exercise)) {
      throw new Error(`${exercise} has no local assessment. Use visual mode for ${id}.`);
    }
    if (verdict !== undefined && verdict !== null && !reviewVerdicts.includes(verdict)) {
      throw new Error(`Use one of these verdicts for ${id}: ${reviewVerdicts.join(', ')}.`);
    }
    if ((exploratory !== undefined && typeof exploratory !== 'boolean') || (exploratory && (check || verdict))) {
      throw new Error(`Use exploratory: true without a required check or verdict for ${id}.`);
    }
    if (check !== undefined && check !== null) {
      const mode = caseMode(item);
      if (mode === 'visual' && checksByExercise.get(exercise)?.includes(check)) {
        throw new Error(`Use measured mode for the named check in ${id}.`);
      }
      const allowed = (mode === 'measured' ? checksByExercise : visualChecksByExercise).get(exercise) ?? [];
      if (!allowed.includes(check)) {
        throw new Error(`Invalid check for ${id} (${exercise}). ${allowed.length ? 'Use ' + allowed.join(', ') : 'Use null when this mode has no named checks'}.`);
      }
      if (verdict && verdict !== 'observations') {
        throw new Error(`A case expecting a correction must use observations as its verdict in ${id}, or omit verdict.`);
      }
    }
    if (provenance !== undefined) validateProvenance(provenance, id);
    if (sourceFamily !== undefined && (typeof sourceFamily !== 'string' || !caseName.test(sourceFamily))) {
      throw new Error(`Use a neutral source family name for ${id}.`);
    }
  }
}

function caseProvenance(item, report) {
  return item.provenance ?? { source: report.source, license: report.license };
}

function fixtureMetadata(item, options) {
  return { ...item, mode: caseMode(item), clipFile: item.id + '.mp4', provenance: caseProvenance(item, options) };
}

function fixtureSourceFamilies(item, report) {
  const sourceUrl = URL.parse(caseProvenance(item, report).source);
  sourceUrl.hash = '';
  const source = sourceUrl.href;
  const file = item.preparation?.file;
  const subject = item.subject ?? (typeof file === 'string' ? /^subject_(\d+)_/i.exec(file)?.[1] : undefined);
  const inferred = subject !== undefined ? `${source}#subject=${Number(subject)}`
    : typeof file === 'string' ? `${source}#recording=${file}` : source;
  return item.sourceFamily ? [inferred, `declared:${item.sourceFamily.toLowerCase()}`] : [inferred];
}

function sourceCoverage(results, metadata) {
  const sources = new Set();
  const byFamily = new Map();
  for (const item of results) {
    if (!item.clipSha256) continue;
    const keys = fixtureSourceFamilies(item, metadata);
    const connected = new Set(keys.map((key) => byFamily.get(key)).filter(Boolean));
    const source = { keys: new Set(keys), cases: [item.id] };
    for (const prior of connected) {
      for (const key of prior.keys) source.keys.add(key);
      source.cases.unshift(...prior.cases);
      sources.delete(prior);
    }
    for (const key of source.keys) byFamily.set(key, source);
    sources.add(source);
  }
  return {
    uniqueClipFiles: new Set(results.map(({ clipSha256 }) => clipSha256).filter(Boolean)).size,
    sourceFamilies: sources.size,
    sharedSourceFamilies: [...sources].map(({ cases }) => cases).filter((cases) => cases.length > 1),
  };
}

export function assertDisjointFixtures(reference, candidate) {
  const validFixtures = (report) => Array.isArray(report?.results) && report.results.length > 0
    && report.results.every((item) => typeof item?.id === 'string' && typeof item.clipSha256 === 'string'
      && sha256Hex.test(item.clipSha256) && URL.canParse(caseProvenance(item, report).source));
  if (!validFixtures(reference) || !validFixtures(candidate)) {
    throw new Error('Disjoint evaluation requires reports with verified fingerprints and source URLs for every case.');
  }
  const byId = new Map(reference.results.map((item) => [item.id.toLowerCase(), item]));
  const byBytes = new Map(reference.results.map((item) => [item.clipSha256.toLowerCase(), item]));
  const byFamily = new Map(reference.results.flatMap((item) => fixtureSourceFamilies(item, reference).map((key) => [key, item])));
  const conflicts = candidate.results.flatMap((item) => {
    const match = byId.get(item.id.toLowerCase()) ?? byBytes.get(item.clipSha256.toLowerCase())
      ?? fixtureSourceFamilies(item, candidate).map((key) => byFamily.get(key)).find(Boolean);
    return match ? [`${item.id} with ${match.id}`] : [];
  });
  if (conflicts.length) throw new Error(`Evaluation sets overlap by case ID, clip bytes, or source family: ${conflicts.join(', ')}.`);
}

async function loadClip({ id, subject, label, view = 'side', exercise = 'push-up', movement, provenance }, { clips, dataset }) {
  const clipFile = id + '.mp4';
  const cached = resolve(clips, clipFile);
  try { return await readFile(cached); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (provenance) throw new Error(`Missing ${clipFile}. Place the prepared external clip in --clips under this filename.`);
    if (!dataset) throw new Error(`Missing ${clipFile}. Supply --dataset with the extracted archive directory.`);
  }
  const padded = String(subject).padStart(3, '0');
  const folder = movement ?? (exercise === 'bodyweight-squat' ? 'squat' : 'push_up');
  const source = resolve(dataset, 'Dataset Exercise Quality-wise', folder, label, view,
    `subject_${padded}_${folder}_${label}_${view}.mp4`);
  const temporary = resolve(clips, `${id}.${process.pid}.mp4`);
  await mkdir(clips, { recursive: true, mode: 0o700 });
  try {
    await encodeFormClip(source, temporary, {
      filter: 'scale=720:720:force_original_aspect_ratio=decrease:force_divisible_by=2',
    });
    await rename(temporary, cached);
    return await readFile(cached);
  } finally {
    await rm(temporary, { force: true });
  }
}

const passingOutcomes = new Set(['clear', 'hit', 'expected_verdict']);

export function scoreCase(item, input, review) {
  const observations = review?.observations ?? input.evidence;
  const adjustments = observations.filter(({ kind, check }) => kind === 'adjustment' || check);
  const detected = [...new Set(adjustments.flatMap(({ check }) => check ? [check] : []))];
  const additional = detected.filter((check) => check !== item.check);
  let outcome;
  if (item.exploratory) outcome = 'exploratory';
  else if (!review && !canScoreLocal(item)) outcome = 'review_required';
  else if (review && item.verdict && review.verdict !== item.verdict) outcome = 'unexpected_verdict';
  else if (!review && input.coverage !== 'measured') outcome = 'local_insufficient_evidence';
  else if (!item.verdict && ['insufficient_visibility', 'different_exercise'].includes(review?.verdict)) outcome = 'abstained';
  else if (item.check && !detected.includes(item.check)) outcome = 'miss';
  else if (adjustments.some(({ check }) => !item.check || check !== item.check)) outcome = 'unexpected_adjustment';
  else if (item.check) outcome = 'hit';
  else outcome = review && item.verdict ? 'expected_verdict' : 'clear';
  return { outcome, additional, review };
}

function countOutcomes(items) {
  const totals = {};
  for (const { outcome } of items) totals[outcome] = (totals[outcome] ?? 0) + 1;
  return totals;
}

function duplicateClips(results) {
  const byFingerprint = new Map();
  for (const { id, clipSha256 } of results) {
    if (!clipSha256) continue;
    const caseIds = byFingerprint.get(clipSha256) ?? [];
    caseIds.push(id);
    byFingerprint.set(clipSha256, caseIds);
  }
  return [...byFingerprint].filter(([, caseIds]) => caseIds.length > 1)
    .map(([clipSha256, caseIds]) => ({ clipSha256, caseIds }));
}

function trialsFor(item) {
  return item.trials ?? [item];
}

export function evaluationExitCode(results, strict) {
  const trials = results.flatMap(trialsFor);
  if (trials.some(({ outcome }) => outcome === 'error')) return 1;
  if (strict && trials.some(({ outcome }) => !['review_required', 'exploratory'].includes(outcome) && !passingOutcomes.has(outcome))) return 2;
  return 0;
}

function rubric(item) {
  const { group, exercise = 'push-up', movement, subject, label, view = 'side', check = null, verdict = null, exploratory = false } = item;
  return [group, exercise, movement, subject, label, view, check, verdict, exploratory, caseMode(item)];
}

function outcomeSummary(item) {
  if (!item.trials) return item.outcome;
  const counts = countOutcomes(item.trials);
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
    .map(([outcome, count]) => `${outcome} ×${count}`).join(', ');
}

export function compareReports(baseline, current) {
  if (baseline.mode !== current.mode || (baseline.repeat ?? 1) !== current.repeat) {
    throw new Error('Compare runs with the same mode and trial count.');
  }
  const previous = new Map(baseline.results.map((item) => [item.id, item]));
  if (previous.size !== baseline.results.length || previous.size !== current.results.length
    || new Set(current.results.map(({ id }) => id)).size !== current.results.length
    || current.results.some(({ id }) => !previous.has(id))) {
    throw new Error('Compare runs with the same case IDs.');
  }
  const changes = [];
  let missingFingerprints = 0;
  for (const item of current.results) {
    const prior = previous.get(item.id);
    if ([prior, item].some(({ clipFile }) => clipFile !== undefined && clipFile !== item.id + '.mp4')) {
      throw new Error(`The neutral clip filename changed for ${item.id}.`);
    }
    const priorProvenance = caseProvenance(prior, baseline);
    const currentProvenance = caseProvenance(item, current);
    if (priorProvenance.source !== currentProvenance.source) {
      throw new Error(`Compare runs from the same dataset or external source for ${item.id}.`);
    }
    const inheritedLegacyLicense = !prior.provenance && baseline.license === undefined;
    if (attributionFields.some((key) => !(key === 'license' && inheritedLegacyLicense)
      && priorProvenance[key] !== currentProvenance[key])) {
      throw new Error(`The clip attribution changed for ${item.id}. Use the same fixture provenance for both runs.`);
    }
    if (JSON.stringify(rubric(prior)) !== JSON.stringify(rubric(item))) {
      throw new Error(`The rubric changed for ${item.id}. Run a new baseline for this case.`);
    }
    if (!prior.clipSha256 || !item.clipSha256) missingFingerprints += 1;
    else if (prior.clipSha256 !== item.clipSha256) {
      throw new Error(`The video bytes changed for ${item.id}. Use the same clip files for both runs.`);
    }
    const before = outcomeSummary(prior);
    const after = outcomeSummary(item);
    if (before !== after) changes.push({ id: item.id, before, after });
  }
  return { changes, missingFingerprints };
}

function errorResult(error) {
  const provider = error instanceof AiError;
  const diagnostic = provider && (safeProviderDiagnostics.has(error.diagnostic)
    || (Number.isInteger(error.diagnostic) && error.diagnostic >= 400 && error.diagnostic <= 599)) ? error.diagnostic : undefined;
  return { outcome: 'error', error: provider || !error.code ? error.message : error.code,
    ...(diagnostic !== undefined && { diagnostic }) };
}

async function preflightCases(cases, options) {
  const results = [];
  for (const item of cases) {
    const fixture = fixtureMetadata(item, options);
    try {
      const bytes = await loadClip(item, options);
      const clipSha256 = createHash('sha256').update(bytes).digest('hex');
      results.push({ ...fixture, clipSha256, outcome: 'ready' });
    } catch (error) {
      results.push({ ...fixture, ...errorResult(error) });
    }
  }
  return results;
}

export function transientRetryDelay(error) {
  if (!(error instanceof AiError)) return null;
  const { status, diagnostic, retryAfter } = error;
  const transient = (status === 503 && (diagnostic === 503 || transientTransport.has(diagnostic)))
    || (status === 504 && diagnostic === 'timeout') || (status === 502 && diagnostic === 504);
  if (!transient) return null;
  const wait = Math.max(750, (retryAfter ?? 0) * 1000);
  return wait <= 5000 ? wait : null;
}

export async function evaluateCase(item, options, respond, repeat = 1, retryTransient = false, logger = console) {
  let clipSha256;
  let reviewerInvocations = 0;
  const fixture = fixtureMetadata(item, options);
  const { mode } = fixture;
  try {
    const bytes = await loadClip(item, options);
    clipSha256 = createHash('sha256').update(bytes).digest('hex');
    const expected = options.expectedFingerprints?.get(item.id);
    if (expected && clipSha256 !== expected) throw new Error(`The video bytes changed for ${item.id} after preflight.`);
    const exercise = exercisesById.get(item.exercise ?? 'push-up');
    const input = await prepareClipReview(bytes, { exercise, mime: 'video/mp4' });
    if (mode === 'measured' && input.coverage === 'unavailable'
      && (respond ? !isVerdictOnly(item) : canScoreLocal(item))) {
      throw new Error('MoveNet measurements unavailable. Run npm run setup:pose and retry.');
    }
    const trials = [];
    const invoke = respond && ((request) => {
      reviewerInvocations += 1;
      return respond(request);
    });
    for (let index = 0; index < repeat; index += 1) {
      let retry;
      try {
        const reviewer = retryTransient ? async (request) => {
          try {
            return await invoke(request);
          } catch (error) {
            const wait = transientRetryDelay(error);
            if (wait === null || request.signal?.aborted) throw error;
            retry = { diagnostic: error.diagnostic, delayMs: wait };
            logger.warn(`${item.id} trial ${index + 1}  transient failure (${retry.diagnostic})  retrying once`);
            await delay(wait, undefined, { signal: request.signal });
            return invoke(request);
          }
        } : invoke;
        const scored = scoreCase(item, input, reviewer ? await reviewExercise(reviewer, input) : null);
        trials.push(retry ? { ...scored, retry } : scored);
      } catch (error) {
        const failure = errorResult(error);
        trials.push(retry ? { ...failure, retry } : failure);
        if (repeat > 1) logger.error(`${item.id} trial ${index + 1}  error  ${failure.error}`);
      }
    }
    const counts = countOutcomes(trials);
    const outcomes = Object.keys(counts);
    const outcome = outcomes.length === 1 ? outcomes[0] : 'variable';
    const first = trials[0];
    logger.log(`${item.id}  ${outcome}${repeat > 1 ? '  ' + JSON.stringify(counts)
      : first.error ? '  ' + first.error : first.additional?.length ? '  ' + first.additional.join(', ') : ''}`);
    return {
      ...fixture, ...first, outcome, clipSha256, coverage: input.coverage, localEvidence: input.evidence,
      ...(respond && { reviewerInvocations }),
      ...(repeat > 1 && { trials }),
    };
  } catch (error) {
    const result = errorResult(error);
    logger.error(`${item.id}  error  ${result.error}`);
    return { ...fixture, ...result, clipSha256, ...(respond && { reviewerInvocations }) };
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      manifest: { type: 'string' },
      clips: { type: 'string', default: '.data/form-eval' },
      dataset: { type: 'string' },
      live: { type: 'boolean' },
      'retry-transient': { type: 'boolean' },
      output: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      compare: { type: 'string' },
      preflight: { type: 'boolean' },
      'disjoint-from': { type: 'string' },
      'budget-ledger': { type: 'string' },
      strict: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  const manifestPath = values.manifest ?? new URL('../tests/fixtures/form-eval.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  const requested = new Set(positionals);
  const cases = manifest.cases.filter(({ id, group }) => !requested.size || requested.has(id) || requested.has(group));
  if (!cases.length || positionals.some((name) => !cases.some(({ id, group }) => name === id || group === name))) {
    throw new Error('Select a group or case ID from the form evaluation manifest.');
  }
  const retryTransient = Boolean(values['retry-transient']);
  if (values.preflight && (values.live || values.compare)) throw new Error('Use --preflight as a separate step before a live run or comparison.');
  if (retryTransient && !values.live) throw new Error('Use --retry-transient with --live.');
  if (values['budget-ledger'] !== undefined && !values.live) throw new Error('Use --budget-ledger with --live.');
  const model = values.live ? openAiModel() : undefined;
  const respond = values.live ? createOpenAi({ model }) : null;
  if (values.live && !respond) throw new Error('Live evaluation requires an OpenAI key configured on this machine.');
  const selected = respond || values.preflight ? cases : cases.filter((item) => caseMode(item) === 'measured');
  const skipped = respond || values.preflight ? [] : cases.filter((item) => caseMode(item) === 'visual').map(({ id }) => id);
  if (skipped.length && selected.length) console.log(`Skipped ${skipped.length} visual case(s). Add --live to evaluate them.`);

  const repeat = Number(values.repeat);
  if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 5 || (!respond && repeat !== 1)) {
    throw new Error('Choose between one and five live trials per case. Local measurements use one trial.');
  }

  const { source, license } = manifest;
  const options = { clips: resolve(values.clips), dataset: values.dataset, source, license };
  const mode = values.preflight ? 'preflight' : respond ? 'live' : 'local';
  const metadata = { source, license, mode, repeat, gradingVersion, reviewVersion,
    ...(model && { model: /^[\w.:-]{1,128}$/.test(model) && !/(^|:)sk[-_]/i.test(model) ? model : 'custom' }),
    ...(respond && { retryPolicy: retryTransient ? retryPolicy : 'none' }) };
  let baseline;
  if (values.compare) {
    baseline = JSON.parse(await readFile(resolve(values.compare), 'utf8'));
    const inputs = selected.map((item) => fixtureMetadata(item, options));
    compareReports(baseline, { ...metadata, results: inputs });
  }
  const reference = values['disjoint-from'] ? JSON.parse(await readFile(resolve(values['disjoint-from']), 'utf8')) : null;
  const needsPreflight = respond || values.preflight || baseline || reference;
  const prepared = needsPreflight ? await preflightCases(selected, options) : [];
  const preflightFailed = prepared.some(({ outcome }) => outcome === 'error');
  if (!preflightFailed && baseline) compareReports(baseline, { ...metadata, results: prepared });
  if (!preflightFailed && reference) assertDisjointFixtures(reference, { ...metadata, results: prepared });
  const results = [];
  let budget;
  if (preflightFailed || values.preflight) {
    for (const item of prepared) {
      if (item.error) console.error(`${item.id}  error  ${item.error}`);
      results.push(item);
    }
    if (preflightFailed && respond) console.error('Live evaluation stopped before contacting the provider. Fix the fixture errors and retry.');
  } else {
    const expectedFingerprints = new Map(prepared.map(({ id, clipSha256 }) => [id, clipSha256]));
    let meter;
    try {
      if (values['budget-ledger'] !== undefined) {
        const { openEvalMeter } = await import('./llm-eval-budget.mjs');
        meter = openEvalMeter(resolve(values['budget-ledger']));
      }
      const reviewer = meter ? createOpenAi({ model, fetchImpl: meter.fetch }) : respond;
      for (const item of selected) {
        results.push(await evaluateCase(item, { ...options, expectedFingerprints }, reviewer, repeat, retryTransient));
      }
      if (meter) {
        const { limits, totals } = meter.receipt();
        budget = { limits, totals };
      }
    } finally {
      meter?.close();
    }
  }
  const totals = countOutcomes(results);
  const duplicates = duplicateClips(results);
  const report = {
    ...metadata, totals, results, skipped, duplicateClips: duplicates,
    sourceCoverage: sourceCoverage(results, metadata),
    ...(respond && { reviewerInvocations: results.reduce((sum, item) => sum + (item.reviewerInvocations ?? 0), 0) }),
    ...(budget && { budget }),
  };
  for (const { caseIds } of duplicates) {
    console.warn(`Identical clip bytes for ${caseIds.join(', ')}. Check provenance before counting them as independent clips.`);
  }
  console.log(totals);
  if (baseline && !preflightFailed) {
    const { changes, missingFingerprints } = compareReports(baseline, report);
    if ((baseline.gradingVersion ?? 1) !== gradingVersion) {
      console.warn('Grading rules differ from the baseline. Re-run it to isolate changes in the reviewer.');
    }
    if (baseline.retryPolicy !== undefined && baseline.retryPolicy !== report.retryPolicy) {
      console.warn('Retry policy differs from the baseline. Review transient failures before comparing outcomes.');
    }
    if (report.mode === 'live' && baseline.model !== report.model) {
      console.warn('The configured model differs from the baseline or was not recorded. Output changes may include differences in model behavior.');
    }
    if (missingFingerprints) console.warn(`Comparison could not verify clip bytes for ${missingFingerprints} case(s).`);
    for (const { id, before, after } of changes) console.log(`Changed ${id}  ${before} → ${after}`);
  }
  if (values.output) {
    const destination = resolve(values.output);
    const temporary = destination + '.' + process.pid;
    try {
      await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  process.exitCode = results.length ? evaluationExitCode(results, values.strict && !values.preflight) : 1;
  if (!results.length) console.error('These cases check visual feedback. Add --live to run them.');
  if (process.exitCode === 2) console.error('Strict grading failed. Check the case outcomes above.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
