import test from 'node:test';
import assert from 'node:assert/strict';
import { TESTES, runArenaTest, scoreBand } from './arena-tests.mjs';

const spam = TESTES.find(item => item.id === 'deteccao-spam');
const twoCases = { ...spam, casos: [spam.casos[0], spam.casos[1]] };
const resolve = () => ({ providerId: 'mock-provider', modelId: 'mock-model' });

test('Score bands use the same fractional boundaries for typed Score and parsed LLM values', () => {
  assert.equal(scoreBand(1.9, 4), 2);
  assert.equal(scoreBand(2.0, 4), 2);
  assert.equal(scoreBand(2.4, 4), 2);
  assert.equal(scoreBand(2.5, 4), 3);
  assert.equal(scoreBand(3.0, 4), 3);
  for (const invalid of [null, NaN, -1, 4.1, '2.4']) assert.equal(scoreBand(invalid, 4), null);
});

test('injected Arena answers stay mocked and cannot declare a winner', async () => {
  const result = await runArenaTest(twoCases, {
    model: 'mock-provider/mock-model', resolve,
    jevClient: { model: 'fixture-jev', ask: async ({ state }) => ({ answers: {
      spam: { noul: state.texto === spam.casos[0].input ? 0.9 : 0.1 },
    } }) },
    chat: async ({ messages }) => ({ content: messages[0].content.includes(spam.casos[0].input) ? 'sim' : 'não' }),
  });
  assert.equal(result.jev.status, 'complete');
  assert.equal(result.llm.status, 'complete');
  assert.equal(result.jev.executionKind, 'mocked-or-partial');
  assert.equal(result.llm.executionKind, 'mocked-or-partial');
  assert.equal(result.eligibleForWinner, false);
  assert.equal(result.jev.custoUsd, null);
  assert.equal(result.llm.custoUsd, null);
});

test('missing typed answer and empty LLM output are partial, with no implied cost or winner', async () => {
  const result = await runArenaTest(twoCases, {
    model: 'mock-provider/mock-model', resolve,
    jevClient: { ask: async () => ({ answers: {} }) },
    chat: async () => ({ content: '' }),
  });
  assert.equal(result.jev.status, 'partial');
  assert.equal(result.llm.status, 'partial');
  assert.equal(result.eligibleForWinner, false);
  assert.equal(result.jev.custoUsd, null);
  assert.equal(result.llm.custoUsd, null);
  assert.ok(result.jev.respostas.every(item => item.erro));
  assert.ok(result.llm.respostas.every(item => item.erro));
});
