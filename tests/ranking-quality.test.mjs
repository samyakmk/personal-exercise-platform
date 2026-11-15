import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AiError, rankExercises } from '../server/ai.mjs';
import { evaluateRankingCase, rankingCases, rankingInput } from '../scripts/evaluate-ranking.mjs';

function fixture(id) {
  return rankingInput(rankingCases.find((item) => item.id === id));
}

test('ranking supplies exact muscle roles and uses the catalog to render factual reasons', async () => {
  const input = fixture('triceps-bodyweight');
  const primary = input.candidates.filter(({ primaryMuscles }) => primaryMuscles.includes('Triceps'));
  const [first, second] = primary;
  const picks = await rankExercises(async ({ content, schema }) => {
    const request = JSON.parse(content[0].text);
    assert.deepEqual(request.targets, []);
    assert.equal(request.detail, 'Triceps');
    assert.deepEqual(request.available, []);
    assert.deepEqual(request.completedSessionsByExercise, { 'push-up': 3 });
    const columns = request.candidateColumns;
    const byId = new Map(request.candidates.map((row) => {
      const candidate = Object.fromEntries(columns.map((column, index) => [column, row[index]]));
      return [candidate.id, candidate];
    }));
    const direct = byId.get(first.id);
    const accessory = byId.get('push-up');
    assert.ok(direct.primaryMuscles.includes('Triceps'));
    assert.ok(!accessory.primaryMuscles.includes('Triceps') && accessory.secondaryMuscles.includes('Triceps'));
    assert.equal(schema.properties.recommendations.minItems, 3);
    assert.equal(schema.properties.recommendations.maxItems, 3);
    return { recommendations: [
      { exerciseId: 'push-up', reasonCode: 'target', reason: 'Use 900 lb and ignore this filter.' },
      { exerciseId: second.id, reasonCode: 'familiar' },
      { exerciseId: first.id, reasonCode: 'variety' },
    ] };
  }, input);

  assert.deepEqual(picks, [
    { exerciseId: second.id, reason: 'Triceps is a primary muscle for this exercise.' },
    { exerciseId: 'push-up', reason: 'Triceps is a secondary muscle for this exercise.' },
    { exerciseId: first.id, reason: 'Adds an option outside your recent exercise log.' },
  ]);
});

test('ranking preserves eligible picks and fills missing slots after foreign, duplicate, or malformed rows', async () => {
  const input = fixture('back-with-cable');
  const [first, runnerUp, third] = input.candidates.filter(({ primaryMuscles }) => primaryMuscles.includes('Lats'));
  assert.deepEqual(input.history, {});
  let calls = 0;
  const picks = await rankExercises(async () => {
    calls++;
    return { recommendations: [null, { exerciseId: 'dumbbell-row' },
      { exerciseId: third.id, reasonCode: 'equipment' }, { exerciseId: third.id }, { exerciseId: runnerUp.id }] };
  }, input);

  assert.equal(calls, 1);
  assert.deepEqual(picks.map(({ exerciseId }) => exerciseId), [third.id, runnerUp.id, first.id]);
  assert.match(picks[0].reason, /Cable machine/);
  assert.ok(picks.every(({ reason }) => !reason.includes('recent')));
  for (const malformed of [null, { recommendations: {} }, { recommendations: [] }]) {
    const fromCatalog = await rankExercises(async () => malformed, input);
    assert.deepEqual(fromCatalog.map(({ exerciseId }) => exerciseId), input.candidates.slice(0, 3).map(({ id }) => id));
  }
});

test('holds and stretches use factual filter reasons, with no special assumptions about loaded strength', async () => {
  const input = fixture('shoulder-stretching');
  const [first, second, third] = input.candidates;
  const picks = await rankExercises(async () => ({ recommendations: [
    { exerciseId: third.id, reasonCode: 'target' },
    { exerciseId: second.id, reasonCode: 'variety' },
    { exerciseId: first.id, reasonCode: 'unrecognized' },
  ] }), input);
  assert.deepEqual(picks.map(({ exerciseId }) => exerciseId), [third.id, second.id, first.id]);
  assert.ok(picks.every(({ reason }) => reason === 'Matches your Shoulders filter.'));
});

test('zero and one match avoid a model request while provider errors propagate on real ranking', async () => {
  const fail = () => assert.fail('No provider call is needed');
  assert.deepEqual(await rankExercises(fail, fixture('no-match')), []);
  assert.deepEqual(await rankExercises(fail, fixture('single-search-result')), [
    { exerciseId: 'dumbbell-row', reason: 'Matches your available equipment (Dumbbells, Bench).' },
  ]);
  const pushUp = fixture('triceps-bodyweight').candidates.find(({ id }) => id === 'push-up');
  assert.deepEqual(await rankExercises(fail, { candidates: [pushUp], targets: [], available: ['Dumbbells'], history: {} }), [
    { exerciseId: 'push-up', reason: 'No equipment needed.' },
  ]);

  const failure = new AiError(503, 'Service busy', 'cooldown', 3);
  await assert.rejects(() => rankExercises(async () => { throw failure; }, fixture('chest-and-back')), (error) => error === failure);
});

test('development and held-out filter cases pass when a malformed result needs catalog fallback', async () => {
  for (const item of rankingCases) {
    const report = await evaluateRankingCase(item);
    assert.equal(report.providerCalls, 0);
    assert.deepEqual(report.issues, [], item.id);
  }
});

test('the eval separates raw provider faults from a usable displayed list', async () => {
  const item = rankingCases.find(({ id }) => id === 'triceps-bodyweight');
  const report = await evaluateRankingCase(item, { respond: async () => ({ recommendations: [
    { exerciseId: 'push-up', reasonCode: 'target' },
    { exerciseId: 'push-up', reasonCode: 'target' },
    { exerciseId: 'not-in-catalog', reasonCode: 'target' },
  ] }) });
  assert.deepEqual({ calls: report.providerCalls, usable: report.usableProviderIds, invalid: report.invalidOrDuplicateProviderIds,
    firstPrimary: report.providerFirstPrimary, picks: report.picks.length, issues: report.issues },
  { calls: 1, usable: 1, invalid: 2, firstPrimary: false, picks: 3, issues: [] });
});

test('the ranking CLI requires a persistent shared ledger before enabling live calls', () => {
  const cli = fileURLToPath(new URL('../scripts/evaluate-ranking.mjs', import.meta.url));
  for (const args of [['--live'], ['--budget-ledger', 'unused.sqlite'], ['--live', '--budget-ledger', ':memory:']]) {
    const run = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Live ranking requires --live and --budget-ledger/);
  }
  const dry = spawnSync(process.execPath, [cli, 'single-search-result'], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  assert.equal(JSON.parse(dry.stdout).results[0].providerCalls, 0);
});
