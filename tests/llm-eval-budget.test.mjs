import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hardInputLimit, openEvalMeter } from '../scripts/llm-eval-budget.mjs';

const root = 'https://api.openai.com/v1/responses';
const params = { method: 'POST', body: JSON.stringify({ model: 'gpt-5.4-mini', store: false, instructions: 'test only',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'synthetic' }] }],
  text: { format: { name: 'exercise_recommendations', type: 'json_schema' } } }) };
const count = (n) => Response.json({ input_tokens: n });
const completed = (n) => Response.json({ model: 'gpt-5.4-mini-2026-03-17',
  usage: { input_tokens: n, output_tokens: 10, input_tokens_details: { cached_tokens: 1 } } });

test('both endpoints use the same payload inputs and usage is accounted across runs', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'liftmorrow-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const options = { targetInput: 100, maxPreflights: 2, fetchImpl: async (url, { body }) => {
    calls.push([url, JSON.parse(body)]);
    return url.endsWith('input_tokens') ? count(25) : completed(25);
  } };
  const path = join(dir, 'study.sqlite');
  let meter = openEvalMeter(path, options);
  assert.ok((await meter.fetch(root, params)).ok);
  meter.close();
  meter = openEvalMeter(path, options);
  try {
    assert.ok((await meter.fetch(root, params)).ok);
    await assert.rejects(meter.fetch(root, params), /stopped additional/);
    assert.equal(calls.length, 4);
    for (const key of ['model', 'instructions', 'input', 'text']) assert.deepEqual(calls[0][1][key], calls[1][1][key]);
    const { totals, requests } = meter.receipt();
    assert.equal(totals.input, 50);
    assert.equal(totals.preflightInput, 50);
    assert.equal(totals.targetReserved, 100);
    assert.equal(totals.output, 20);
    assert.equal(requests[0].actualModel, 'gpt-5.4-mini-2026-03-17');
  } finally { meter.close(); }
});

test('invalid count or budget refusal never reaches generation and exposes no provider body', async () => {
  for (const [result, matcher] of [[count(100), /exceeds/], [Response.json({ error: 'suppressed' }, { status: 403 }), /preflight failed/]]) {
    const calls = [];
    const meter = openEvalMeter(':memory:', { targetInput: 100, fetchImpl: async (url) => { calls.push(url); return result; } });
    try {
      await assert.rejects(meter.fetch(root, params), matcher);
      assert.deepEqual(calls, [root + '/input_tokens']);
    } finally { meter.close(); }
  }
});

test('uncertain or inconsistent billed usage stops the study and cannot be retried', async () => {
  for (const modelResult of [Response.json({ status: 'completed' }), completed(26), new Response(null, { status: 503 })]) {
    const calls = [];
    const meter = openEvalMeter(':memory:', { fetchImpl: async (url) => {
      calls.push(url);
      return calls.length === 1 ? count(25) : modelResult;
    } });
    try {
      await meter.fetch(root, params);
      assert.equal(meter.receipt().totals.unresolvedResponses, 1);
      await assert.rejects(meter.fetch(root, params), /stopped additional/);
      assert.equal(calls.length, 2);
    } finally { meter.close(); }
  }
});

test('an unverified model or other endpoint is rejected before any network request', async () => {
  const meter = openEvalMeter(':memory:', { fetchImpl: async () => assert.fail('network should not be reached') });
  try {
    await assert.rejects(meter.fetch('https://example.invalid', params), /only send metered/);
    await assert.rejects(meter.fetch(root, { ...params, body: params.body.replace('gpt-5.4-mini', 'other-model') }), /bounded/);
  } finally { meter.close(); }
});

test('unknown preflight usage remains reserved and enforces the absolute cap', async () => {
  const calls = [];
  const meter = openEvalMeter(':memory:', {
    targetInput: hardInputLimit, maxPreflights: 100,
    fetchImpl: async (url) => { calls.push(url); throw Error('unconfirmed network outcome'); },
  });
  try {
    for (let index = 0; index < 9; index++) {
      await assert.rejects(meter.fetch(root, params), /preflight failed/);
    }
    await assert.rejects(meter.fetch(root, params), /stopped additional/);
    assert.equal(calls.length, 9);
    assert.ok(calls.every((url) => url.endsWith('input_tokens')));
    assert.equal(meter.receipt().totals.hardReserved, 3_600_000);
  } finally { meter.close(); }
});

test('a still-running preflight may not dispatch after another response loses its usage receipt', async () => {
  const calls = [];
  const slow = Promise.withResolvers();
  const meter = openEvalMeter(':memory:', { targetInput: hardInputLimit, fetchImpl: async (url) => {
    calls.push(url);
    if (calls.length === 1) return slow.promise;
    return url.endsWith('input_tokens') ? count(25) : new Response(null, { status: 503 });
  } });
  try {
    const first = meter.fetch(root, params);
    const check = assert.rejects(first, /unresolved usage/);
    assert.equal((await meter.fetch(root, params)).status, 503);
    slow.resolve(count(25));
    await check;
    assert.deepEqual(calls, [root + '/input_tokens', root + '/input_tokens', root]);
    assert.equal(meter.receipt().requests[0].phase, 'counted_only');
  } finally { meter.close(); }
});
