// An eval-only fetch wrapper. All live trials in a study share one private ledger.
import { closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const responsesUrl = 'https://api.openai.com/v1/responses';
const countUrl = responsesUrl + '/input_tokens';
export const hardInputLimit = 4_000_000;
const contextLimits = new Map([
  ['gpt-5.4-mini', 400_000],
  ['gpt-5.4-mini-2026-03-17', 400_000],
]);
const workflows = new Set(['exercise_recommendations', 'exercise_form_review']);

export class EvalBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvalBudgetError';
  }
}

export function openEvalMeter(path, { targetInput = 120_000, maxPreflights = 24, fetchImpl = fetch } = {}) {
  if (!Number.isSafeInteger(targetInput) || targetInput < 1 || targetInput > hardInputLimit
    || !Number.isSafeInteger(maxPreflights) || maxPreflights < 1 || maxPreflights > 100) {
    throw new EvalBudgetError('Choose a positive evaluation input and request limit.');
  }
  if (path !== ':memory:') {
    try { closeSync(openSync(path, 'wx', 0o600)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), target INTEGER NOT NULL, preflights INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY, workflow TEXT NOT NULL, started_at TEXT NOT NULL, model TEXT NOT NULL,
      phase TEXT NOT NULL, reserved INTEGER NOT NULL, projected INTEGER NOT NULL,
      preflight_input INTEGER, input INTEGER, cached INTEGER, output INTEGER, http INTEGER, actual_model TEXT
    );
  `);
  db.prepare('INSERT OR IGNORE INTO settings VALUES (1, ?, ?)').run(targetInput, maxPreflights);
  const settings = db.prepare('SELECT target, preflights FROM settings WHERE id = 1').get();
  if (settings.target !== targetInput || settings.preflights !== maxPreflights) {
    db.close();
    throw new EvalBudgetError('Keep the original limits when reusing this evaluation ledger.');
  }
  const totals = db.prepare(`SELECT count(*) AS attempts, coalesce(sum(reserved), 0) AS hardReserved,
    coalesce(sum(projected), 0) AS targetReserved, coalesce(sum(preflight_input), 0) AS preflightInput,
    coalesce(sum(input), 0) AS input, coalesce(sum(cached), 0) AS cached, coalesce(sum(output), 0) AS output,
    count(CASE WHEN input IS NOT NULL THEN 1 END) AS meteredResponses,
    count(CASE WHEN phase IN ('dispatch', 'usage_unknown', 'usage_unexpected') THEN 1 END) AS unresolvedResponses
    FROM attempts WHERE id != ?`);
  const insert = db.prepare(`INSERT INTO attempts (workflow, started_at, model, phase, reserved, projected)
    VALUES (?, ?, ?, 'preflight', ?, ?)`);
  const countResult = db.prepare('UPDATE attempts SET phase = ?, reserved = ?, projected = ?, preflight_input = ?, http = ? WHERE id = ?');
  const generationResult = db.prepare('UPDATE attempts SET phase = ?, reserved = ?, projected = ?, input = ?, cached = ?, output = ?, http = ?, actual_model = ? WHERE id = ?');
  const list = db.prepare(`SELECT id, workflow, model, phase, started_at AS startedAt, preflight_input AS preflightInput,
    input, cached, output, http, actual_model AS actualModel FROM attempts ORDER BY id`);

  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = operation();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const validUsage = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  function receipt() {
    return { limits: { hardInputLimit, targetInput, maxPreflights }, totals: totals.get(0), requests: list.all() };
  }

  async function meteredFetch(url, options) {
    if (url !== responsesUrl || options?.method !== 'POST' || typeof options.body !== 'string') {
      throw new EvalBudgetError('Evaluation may only send metered Responses API requests.');
    }
    const request = JSON.parse(options.body);
    const { model, instructions, input, text, reasoning } = request;
    const workflow = text?.format?.name;
    const upper = contextLimits.get(model);
    if (!upper || !workflows.has(workflow) || request.store !== false || request.stream || request.tools) {
      throw new EvalBudgetError('Only the configured bounded Trainer Plus eval requests are allowed.');
    }
    options.signal?.throwIfAborted();
    const { lastInsertRowid: id } = transaction(() => {
      const used = totals.get(0);
      if (used.attempts >= maxPreflights || used.hardReserved + 2 * upper > hardInputLimit
        || used.targetReserved >= targetInput || used.unresolvedResponses > 0) {
        throw new EvalBudgetError('Evaluation budget stopped additional requests.');
      }
      // Even if the process dies or the provider fails to return usage, reserve the documented
      // full model context for both the preflight and generation before sending anything.
      return insert.run(workflow, new Date().toISOString(), model, 2 * upper, 2 * upper);
    });

    let preflight;
    let count;
    try {
      preflight = await fetchImpl(countUrl, { ...options, body: JSON.stringify({ model, instructions, input, text, reasoning }) });
      if (preflight.ok) count = (await preflight.json()).input_tokens;
      else await preflight.body?.cancel().catch(() => {});
    } catch {
      // Do not retry unknown transport outcomes or log provider error bodies.
    }
    if (!validUsage(count, upper) || count === 0) {
      countResult.run('preflight_failed', upper, upper, null, preflight?.status ?? null, id);
      throw new EvalBudgetError('Token preflight failed; no model response was requested.');
    }
    const dispatch = transaction(() => {
      const used = totals.get(id);
      const allowed = !options.signal?.aborted && used.unresolvedResponses === 0 && used.targetReserved + 2 * count <= targetInput;
      countResult.run(allowed ? 'dispatch' : 'counted_only', allowed ? count + upper : count,
        allowed ? 2 * count : count, count, null, id);
      return { allowed, unresolved: used.unresolvedResponses > 0 };
    });
    if (!dispatch.allowed) {
      options.signal?.throwIfAborted();
      throw new EvalBudgetError(dispatch.unresolved
        ? 'Another evaluation request has unresolved usage. No new response was requested.'
        : 'Estimated input exceeds the remaining evaluation budget.');
    }

    let response;
    try { response = await fetchImpl(responsesUrl, options); }
    catch (error) {
      generationResult.run('usage_unknown', count + upper, count + upper, null, null, null, null, null, id);
      throw error;
    }
    let payload;
    if (response.ok) {
      try { payload = await response.clone().json(); } catch { /* Keep the reservation. */ }
    }
    const actual = payload?.usage?.input_tokens;
    if (!validUsage(actual, upper) || actual === 0) {
      generationResult.run('usage_unknown', count + upper, count + upper, null, null, null, response.status, null, id);
    } else {
      const cached = payload.usage.input_tokens_details?.cached_tokens;
      const output = payload.usage.output_tokens;
      const actualModel = contextLimits.has(payload.model) ? payload.model : null;
      generationResult.run(actual === count ? 'complete' : 'usage_unexpected', count + actual, count + actual,
        actual, validUsage(cached, actual) ? cached : null, validUsage(output, upper) ? output : null, response.status, actualModel, id);
    }
    return response;
  }
  return { fetch: meteredFetch, receipt, close: () => db.close() };
}
