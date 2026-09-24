import test from 'node:test';
import assert from 'node:assert/strict';
import { designChat } from './design-chat.mjs';
import { designFlow } from './design.mjs';

test('conversation repairs an invalid first draft and keeps the current flow', async () => {
  const calls = [];
  const design = async args => {
    calls.push(args);
    return calls.length === 1
      ? { rascunho: { id: 'sample-flow', name: 'Draft', nodes: {} },
        validacao: { ok: false, errors: [{ codigo: 'START_MISSING', msg: 'Start node missing' }] } }
      : { rascunho: { id: 'sample-flow', name: 'Repaired', nodes: { start: { type: 'flow.start' } } },
        validacao: { ok: true, errors: [] } };
  };
  const response = await designChat({ mensagens: [{ role: 'user', content: 'Create a support triage flow' }],
    base_flow: { id: 'sample-flow', nodes: { old: { type: 'action.log' } } } }, { design });
  assert.equal(response.validacao.ok, true);
  assert.equal(response.repairs, 1);
  assert.equal(calls[1].baseFlow.name, 'Draft');
  assert.match(calls[1].intent, /START_MISSING/);
});

test('conversation stops after two repair attempts', async () => {
  let count = 0;
  const response = await designChat({ mensagens: [{ role: 'user', content: 'Create a flow' }] }, {
    design: async () => { count++; return { rascunho: {}, validacao: { ok: false,
      errors: [{ codigo: 'INVALID', msg: 'Invalid flow' }] } }; },
  });
  assert.equal(count, 3);
  assert.equal(response.validacao.ok, false);
  assert.equal(response.repairs, 2);
});

test('current flow secrets and fixture values do not reach designer prompt', async () => {
  let prompt = '';
  await designFlow({ intent: 'Improve this existing support triage flow',
    baseFlow: { id: 'sample-flow', start: 'hook', nodes: { hook: {
      type: 'trigger.webhook', secret: 'SECRET_SENTINEL_4821', next: 'end' },
      note: { type: 'note.sticky', texto: 'Private account note: alice@example.test' },
      end: { type: 'flow.end' } },
      fixtures: [{ id: 'one', input: { customerEmail: 'private@example.test' } }] },
    chatFn: async ({ messages }) => { prompt = messages.map(item => item.content).join('\n'); return '{}'; },
  });
  assert.doesNotMatch(prompt, /SECRET_SENTINEL_4821|private@example\.test|alice@example\.test/);
  assert.match(prompt, /trigger\.webhook/);
});
