import test from 'node:test';
import assert from 'node:assert/strict';
import { JevClient, estimateCostUsd, noulQ } from './client.mjs';

test('provider response without usage never invents zero cost', async () => {
  const client = new JevClient({
    apiKey: 'synthetic-test-key', provider: 'typesafe', logUsage: false, maxRetries: 0,
    fetchImpl: async () => ({ ok: true, json: async () => ({
      model: 'synthetic-jev', answers: { relevant: { noul: 0.75 } },
    }) }),
  });
  const result = await client.ask({ state: 'Synthetic input',
    questions: { relevant: noulQ('Is this relevant?') } });
  assert.equal(result.costEstimateUsd, null);
  assert.equal(estimateCostUsd({ input_tokens: 0 }), 0);
  assert.equal(estimateCostUsd({ input_tokens: -1 }), null);
});

test('unpriced compatible backend keeps cost unknown even with token usage', () => {
  if (!Object.hasOwn(process.env, 'JEV_USD_PER_MTOK_IN')) {
    assert.equal(estimateCostUsd({ input_tokens: 100 }, 'openjev-compatible'), null);
  }
});
