import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { JEV_DATA_DIR, isJevConfigured } from '../jev/client.mjs';
import { SHIP_TESTES } from './ship-tests.mjs';
import { runArenaTest } from './arena-tests.mjs';
import { journalAppend } from '../jev/journal.mjs';

const DIR = JEV_DATA_DIR;
export const RUNS_PATH = join(DIR, 'suite-runs.jsonl');
export const BASELINE_PATH = join(DIR, 'suite-baseline.json');
const TOLERANCE_PP = 2;
const FULL_CASE_COUNT = SHIP_TESTES.reduce((sum, test) => sum + test.casos.length, 0);

function readRuns(limit = 30) {
  if (!existsSync(RUNS_PATH)) return [];
  return readFileSync(RUNS_PATH, 'utf8').split('\n').filter(Boolean).slice(-limit)
    .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}
function readBaseline() {
  try { return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); } catch { return null; }
}
function eligible(run) {
  return run.executionKind === 'live' && run.status === 'complete'
    && run.cenarios === SHIP_TESTES.length && run.total === FULL_CASE_COUNT;
}

/** Runs the synthetic fixture suite. An injected client is explicitly marked as a test run. */
export async function runSuite({ ids = null, jevClient = null, persistir = true } = {}) {
  if (!jevClient && !isJevConfigured()) {
    const error = new Error('Connect a Jev provider before running the live suite');
    error.code = 'JEV_UNAVAILABLE'; error.status = 503; throw error;
  }
  const selected = Array.isArray(ids) && ids.length ? SHIP_TESTES.filter(test => ids.includes(test.id)) : SHIP_TESTES;
  if (!selected.length) throw new TypeError('No suite scenarios selected');
  const perScenario = {};
  let hits = 0, total = 0, cost = 0, knownCost = true, latency = 0, measured = 0;
  let complete = true, allLive = !jevClient;
  const models = new Set();
  for (const test of selected) {
    const result = await runArenaTest(test, { model: '', jevClient,
      jevAvailable: () => Boolean(jevClient || isJevConfigured()) });
    const side = result.jev || {};
    hits += Number(side.acertos) || 0;
    total += Number(side.total) || 0;
    if (side.custoUsd == null) knownCost = false; else cost += side.custoUsd;
    complete &&= side.status === 'complete' && side.total === test.casos.length;
    allLive &&= side.executionKind === 'live';
    if (side.model) models.add(side.model);
    for (const answer of side.respostas || []) {
      if (Number.isFinite(answer.latencyMs)) { latency += answer.latencyMs; measured++; }
    }
    perScenario[test.id] = { acertos: side.acertos ?? 0, total: side.total ?? 0,
      status: side.status || 'unavailable', executionKind: side.executionKind || 'unavailable',
      model: side.model || null, custoUsd: side.custoUsd ?? null,
      respostas: (side.respostas || []).map(item => ({ score: item.score ?? 0,
        latencyMs: item.latencyMs ?? null, erro: item.erro || null })) };
  }
  const run = {
    ts: new Date().toISOString(), cenarios: selected.length, acertos: hits, total,
    acuracia: total ? Number((hits / total).toFixed(4)) : null,
    custo_usd: knownCost && total ? Number(cost.toFixed(8)) : null,
    latencia_media_ms: measured ? Math.round(latency / measured) : null,
    por_cenario: perScenario, model: models.size === 1 ? [...models][0] : null,
    executionKind: allLive && complete ? 'live' : jevClient ? 'injected-test' : 'partial',
    status: complete ? 'complete' : 'partial',
  };
  const baseline = eligible(run) ? readBaseline() : null;
  const delta = baseline ? Math.round((run.acuracia - baseline.acuracia) * 10000) / 100 : null;
  run.baseline = baseline ? { ts: baseline.ts, acuracia: baseline.acuracia, model: baseline.model } : null;
  run.delta_pp = delta;
  run.veredito = delta == null ? 'uncompared' : delta > TOLERANCE_PP ? 'improved'
    : delta < -TOLERANCE_PP ? 'regressed' : 'stable';
  if (persistir && eligible(run)) {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(RUNS_PATH, `${JSON.stringify(run)}\n`, { mode: 0o600 });
    journalAppend({ gate: 'ship.suite', decisao: run.veredito, score: run.acuracia,
      custoUsd: run.custo_usd, executionKind: 'live' });
  }
  return run;
}

export function setBaseline(run = null) {
  const target = run || readRuns(1).at(-1);
  if (!target || !eligible(target)) throw Object.assign(
    new Error('A complete live 52-case run is required for baseline'), { status: 400 });
  const baseline = { ts: target.ts, acuracia: target.acuracia, acertos: target.acertos,
    total: target.total, cenarios: target.cenarios, model: target.model, executionKind: 'live' };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), { mode: 0o600 });
  return baseline;
}

export function suiteHistory({ limit = 12 } = {}) {
  const runs = readRuns(limit).filter(eligible);
  const first = runs[0], last = runs.at(-1);
  return { baseline: readBaseline(), runs,
    runs_total_exibidas: runs.length,
    tendencia_pp: first && last && runs.length > 1 ? Math.round((last.acuracia - first.acuracia) * 10000) / 100 : null };
}
