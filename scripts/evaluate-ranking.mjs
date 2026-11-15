import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createOpenAi, openAiModel, recommendationCandidateLimit, rankExercises } from '../server/ai.mjs';
import { recommend } from '../server/catalog.mjs';
import cases from '../tests/fixtures/ranking-evaluation.json' with { type: 'json' };

export const rankingCases = cases;

export function rankingInput({ filters, recent: logged = {} }) {
  const selection = { targets: [], detail: null, available: null, query: '', level: null, category: null, ...filters };
  const recent = new Map(Object.entries(logged));
  const candidates = recommend({ ...selection, recent }).slice(0, recommendationCandidateLimit);
  const history = Object.fromEntries(candidates.filter(({ id }) => recent.has(id)).map(({ id }) => [id, recent.get(id)]));
  return { candidates, history, targets: [...selection.targets].sort(), detail: selection.detail, available: selection.available?.slice().sort() ?? null };
}

export async function evaluateRankingCase(item, { respond, rank = rankExercises } = {}) {
  const input = rankingInput(item);
  const { candidates, detail } = input;
  const eligible = new Map(candidates.map((exercise) => [exercise.id, exercise]));
  const limit = Math.min(3, eligible.size);
  const hasPrimaryMatch = Boolean(detail && candidates.some(({ primaryMuscles }) => primaryMuscles.includes(detail)));
  let requestBytes = 0;
  let providerCalls = 0;
  let usableProviderIds = 0;
  let invalidOrDuplicateProviderIds = 0;
  let providerFirstPrimary = null;
  const issues = [];
  let picks = [];

  try {
    picks = await rank(async (request) => {
      providerCalls += Number(Boolean(respond));
      requestBytes += Buffer.byteLength(JSON.stringify({ schema: request.schema, instructions: request.instructions, content: request.content }));
      // Offline mode exercises the production catalog fallback without loading an API key.
      const result = respond ? await respond(request, item) : { recommendations: [] };
      const rows = Array.isArray(result?.recommendations) ? result.recommendations : [];
      const seen = new Set();
      for (const row of rows) {
        if (eligible.has(row?.exerciseId) && !seen.has(row.exerciseId)) seen.add(row.exerciseId);
        else invalidOrDuplicateProviderIds++;
      }
      usableProviderIds = seen.size;
      if (hasPrimaryMatch && rows.length) providerFirstPrimary = eligible.get(rows[0]?.exerciseId)?.primaryMuscles.includes(detail) ?? false;
      return result;
    }, input);
  } catch (error) {
    // Keep reports portable without saving model output, personal text, or provider error bodies.
    issues.push({ check: 'review', ...(Number.isInteger(error?.status) && { status: error.status }) });
  }

  if (item.exactCount !== undefined && eligible.size !== item.exactCount) issues.push({ check: 'catalog_fixture_size' });
  if (picks.length !== limit) issues.push({ check: 'pick_count' });
  if (picks.some(({ exerciseId }) => !eligible.has(exerciseId))) issues.push({ check: 'eligibility' });
  if (new Set(picks.map(({ exerciseId }) => exerciseId)).size !== picks.length) issues.push({ check: 'uniqueness' });
  if (picks.some(({ reason }) => typeof reason !== 'string' || !reason.trim() || reason.length > 160)) issues.push({ check: 'readable_reason' });
  if (hasPrimaryMatch && !eligible.get(picks[0]?.exerciseId)?.primaryMuscles.includes(detail)) issues.push({ check: 'primary_exact_match_first' });
  for (const group of item.primaryCoverage ?? []) {
    if (!picks.some(({ exerciseId }) => eligible.get(exerciseId)?.primaryMuscles.some((muscle) => group.includes(muscle)))) {
      issues.push({ check: 'primary_group_coverage', muscles: group });
    }
  }

  return { id: item.id, group: item.group, eligibleCandidates: eligible.size, expectedPicks: limit, hasPrimaryMatch, picks,
    providerCalls, requestBytes, usableProviderIds, invalidOrDuplicateProviderIds, providerFirstPrimary, issues };
}

async function main() {
  const { values, positionals: ids } = parseArgs({ options: {
    group: { type: 'string' }, list: { type: 'boolean' }, live: { type: 'boolean' }, 'budget-ledger': { type: 'string' },
  }, allowPositionals: true });
  if ((values.group && !rankingCases.some(({ group }) => group === values.group))
    || ids.some((id) => !rankingCases.some((item) => item.id === id))) throw new Error('Choose a known case ID or group. Use --list to see them.');
  const selected = rankingCases.filter(({ id, group }) => (!ids.length || ids.includes(id)) && (!values.group || group === values.group));
  if (!selected.length) throw new Error('No test cases match this selection.');
  const ledger = values['budget-ledger']?.trim();
  if (Boolean(values.live) !== Boolean(ledger) || (values.live && (ledger === ':memory:' || values.list))) {
    throw new Error('Live ranking requires --live and --budget-ledger with a persistent file path. Use --list separately.');
  }
  if (values.list) {
    for (const { id, group } of selected) console.log(`${group}\t${id}`);
    return;
  }

  let meter;
  try {
    let respond;
    let model;
    if (values.live) {
      const { openEvalMeter } = await import('./llm-eval-budget.mjs');
      meter = openEvalMeter(resolve(ledger));
      model = openAiModel();
      respond = createOpenAi({ model, fetchImpl: meter.fetch });
      if (!respond) throw new Error('Live evaluation requires an OpenAI key configured on this machine.');
    }
    const results = [];
    for (const item of selected) {
      const result = await evaluateRankingCase(item, { respond });
      results.push(result);
      if (result.issues.some(({ check }) => check === 'review')) {
        process.exitCode = 1;
        break;
      }
    }
    const receipt = meter?.receipt();
    console.log(JSON.stringify({ mode: values.live ? 'live' : 'catalog-fallback', model, results,
      ...(results.length < selected.length && { skipped: selected.slice(results.length).map(({ id }) => id) }),
      ...(receipt && { budget: { limits: receipt.limits, totals: receipt.totals } }),
    }, null, 2));
    if (!process.exitCode && results.some(({ issues }) => issues.length)) process.exitCode = 2;
  } finally {
    meter?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
