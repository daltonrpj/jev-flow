import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jev-ship-test-'));
process.env.JEVFLOW_DATA_DIR = dataDir;
const [{ shipStatus }, { runShipGate }, { journalAppend, JOURNAL_PATH },
  { shipReport }, { runSuite, suiteHistory, setBaseline, RUNS_PATH, BASELINE_PATH }] = await Promise.all([
  import('../services/jev-ship/catalog.mjs'), import('../services/jev-ship/gates.mjs'),
  import('../services/jev/journal.mjs'), import('../services/jev-ship/report.mjs'),
  import('../services/jev-flow/suite-runs.mjs'),
]);
test.after(() => rmSync(dataDir, { recursive: true, force: true }));

test('ten packaged Jevlets and eleven gates are available without installation', () => {
  const status = shipStatus();
  assert.equal(status.totalGates, 11);
  assert.equal(status.packagedJevlets, 10);
  assert.equal(status.registeredJevlets, 0);
  assert.ok(status.novos.every(item => item.certification !== 'live certified'));
});

test('empty gate does not use transport; injected judgment keeps unknown cost unknown', async () => {
  let calls = 0;
  const client = { ask: async ({ questions }) => {
    calls++;
    return { answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id,
      question.type === 'choice' ? { type: 'choice', choice: Object.keys(question.criteria)[0], confidence: 0.9 }
        : { type: 'noul', noul: id === 'fato_novo' ? 0.1 : 0.9 }])),
      latencyMs: 2, costEstimateUsd: null };
  } };
  const empty = await runShipGate('filtrarSlop', {}, { client });
  assert.equal(empty.acao, 'ignorado'); assert.equal(calls, 0);
  const result = await runShipGate('filtrarSlop', { titulo: 'Synthetic title', texto: 'Generic filler' }, { client });
  assert.equal(calls, 1);
  assert.equal(result.executionKind, 'injected-test');
  assert.equal(result.custo, null);
  const suggestion = await runShipGate('sugerirComando', { digitado: 'sutie' }, { client });
  assert.equal(calls, 2);
  assert.equal(suggestion.custo, null);
  assert.equal(existsSync(JOURNAL_PATH), false);
});

test('journal does not persist raw support text; report preserves unknown costs', () => {
  const secret = 'private.person@example.test API_KEY_SENTINEL';
  journalAppend({ gate: 'ship.deflecao-suporte', pergunta: secret, decisao: 'escalar_humano', custoUsd: null });
  const raw = readFileSync(JOURNAL_PATH, 'utf8');
  assert.doesNotMatch(raw, /private\.person|API_KEY_SENTINEL/);
  assert.match(raw, /inputHash/);
  const report = shipReport({ journalPath: JOURNAL_PATH });
  assert.equal(report.total.decisions, 1);
  assert.equal(report.total.costUsd, null);
  assert.equal(report.total.unknownCostCount, 1);
});

test('an injected suite cannot establish or overwrite a live baseline', async () => {
  const client = { ask: async ({ questions }) => ({
    answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id,
      question.type === 'choice' ? { type: 'choice', choice: Object.keys(question.criteria)[0], confidence: 0.9 }
        : question.type === 'score' ? { type: 'score', score: 1 }
          : { type: 'noul', noul: 0.8 }])),
    latencyMs: 1, costEstimateUsd: null,
  }) };
  const result = await runSuite({ ids: ['slop-deteccao'], jevClient: client, persistir: true });
  assert.equal(result.executionKind, 'injected-test');
  assert.equal(result.custo_usd, null);
  assert.equal(result.veredito, 'uncompared');
  assert.equal(existsSync(RUNS_PATH), false);
  assert.equal(existsSync(BASELINE_PATH), false);
});

test('operator selects a complete live run as baseline explicitly', () => {
  const recorded = { ts: new Date().toISOString(), executionKind: 'live', status: 'complete',
    cenarios: 12, total: 52, acertos: 49, acuracia: 49 / 52, model: 'synthetic-jev' };
  appendFileSync(RUNS_PATH, `${JSON.stringify(recorded)}\n`);
  assert.equal(suiteHistory().baseline, null);
  const chosen = setBaseline();
  assert.equal(chosen.acertos, 49);
  assert.equal(suiteHistory().baseline.acertos, 49);
});
