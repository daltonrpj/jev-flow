import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFlow, validateFlow } from './engine.mjs';

const question = { type: 'noul', instructions: 'Is the synthetic input present?', criteria: { true: 'Present', false: 'Absent' } };
const ask = (next = null) => ({ type: 'jev.ask', questions: { present: question }, ...(next ? { next } : {}) });
const log = (texto = 'done') => ({ type: 'action.log', texto });
const flow = (id, nodes, start, extra = {}) => ({
  id, name: `Test ${id}`, input_schema: { message: 'synthetic message' }, start, nodes, ...extra,
});
const store = (dir, ...flows) => {
  for (const item of flows) writeFileSync(join(dir, `${item.id}.flow.json`), JSON.stringify(item));
};
const fixtureDir = t => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-flow-n8n-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const client = (calls, callback = () => ({ type: 'noul', noul: 0.9 })) => ({
  async ask(request) {
    calls.push(request);
    return {
      answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, callback(request, id)])),
      usage: { input_tokens: 7, output_tokens: 2 }, latencyMs: 1, costEstimateUsd: null,
    };
  },
});
const run = (item, input, options = {}) => runFlow(item, input, { gravar: false, useCache: false, ...options });

test('webhook trigger validates metadata; sticky notes never execute', async t => {
  const dir = fixtureDir(t);
  const item = flow('hook-test', {
    hook: { type: 'trigger.webhook', path: 'tickets', secret: 'JEVFLOW_HOOK_TICKETS', response: 'resumo', next: 'done' },
    done: log(),
    note: { type: 'note.sticky', texto: 'Only an editor annotation' },
  }, 'hook');
  assert.equal(validateFlow(item).ok, true);
  const result = await run(item, { message: 'hello' }, { dir });
  assert.deepEqual(result.path, ['hook', 'done']);
  assert.equal(result.outputs.hook.remoteCalled, false);
  assert.equal(result.ok, true);
  for (const [field, value, code] of [
    ['path', '../outside', 'TRIGGER_PATH_INVALIDO'],
    ['secret', 'X-Flow-Secret', 'TRIGGER_SECRET_INVALIDO'],
    ['response', 'raw', 'TRIGGER_RESPONSE_INVALIDA'],
  ]) {
    const invalid = structuredClone(item);
    invalid.nodes.hook[field] = value;
    assert.ok(validateFlow(invalid).errors.some(error => error.codigo === code), field);
  }
  const noSecret = structuredClone(item);
  delete noSecret.nodes.hook.secret;
  assert.ok(validateFlow(noSecret).errors.some(error => error.codigo === 'TRIGGER_SECRET_INVALIDO'));
  const executableNote = structuredClone(item);
  executableNote.nodes.hook.next = 'note';
  assert.ok(validateFlow(executableNote).errors.some(error => error.codigo === 'NOTA_EXECUTAVEL'));
});

test('flow.call keeps lineage private and aggregates child counters', async t => {
  const dir = fixtureDir(t);
  const calls = [];
  const child = flow('child-call', {
    judge: ask('assign'),
    assign: { type: 'action.set', values: { result: '{{judge.valores.present}}' } },
  }, 'judge');
  store(dir, child);
  const parent = flow('parent-call', {
    hook: { type: 'trigger.webhook', secret: 'JEVFLOW_HOOK_PARENT', next: 'call' },
    call: { type: 'flow.call', flow: child.id, input: { message: '{{input.message}}' }, next: 'done' },
    done: log(),
  }, 'hook');
  const result = await run(parent, { message: 'synthetic request' }, { dir, client: client(calls) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.path, ['hook', 'call', 'done']);
  assert.equal(result.outputs.call.vars.result, '0.9');
  assert.equal(result.usage.jevCalls, 1);
  assert.equal(result.usage.childSteps, 2);
  assert.equal(result.usage.steps, 3);
  assert.equal(result.usage.inputTokensBudgeted > 0, true);
  assert.equal(calls.length, 1);
  assert.equal('__callDepth' in calls[0].state, false);
  assert.equal('__callDepth' in result.input, false);
});

test('flow.call rejects indirect recursion and depth beyond two nested calls', async t => {
  const dir = fixtureDir(t);
  const one = flow('flow-one', { call: { type: 'flow.call', flow: 'flow-two', next: 'done' }, done: log() }, 'call');
  const two = flow('flow-two', { call: { type: 'flow.call', flow: 'flow-one', next: 'done' }, done: log() }, 'call');
  store(dir, one, two);
  const cyclic = await run(one, { message: 'synthetic' }, { dir });
  assert.equal(cyclic.ok, false);
  assert.equal(cyclic.outputs.call.code, 'CALL_RECURSIVO');

  const alpha = flow('flow-alpha', { call: { type: 'flow.call', flow: 'flow-beta', next: 'done' }, done: log() }, 'call');
  const beta = flow('flow-beta', { call: { type: 'flow.call', flow: 'flow-gamma', next: 'done' }, done: log() }, 'call');
  const gamma = flow('flow-gamma', { call: { type: 'flow.call', flow: 'flow-delta', next: 'done' }, done: log() }, 'call');
  const delta = flow('flow-delta', { done: log() }, 'done');
  store(dir, alpha, beta, gamma, delta);
  const deep = await run(alpha, { message: 'synthetic' }, { dir });
  assert.equal(deep.ok, false);
  assert.equal(deep.outputs.call.code, 'CALL_DEPTH');
});

test('child Jev calls share parent maxJevCalls and fail before the second transport', async t => {
  const dir = fixtureDir(t);
  const calls = [];
  const child = flow('child-asks', { first: ask('second'), second: ask() }, 'first');
  store(dir, child);
  const parent = flow('parent-budget', {
    call: { type: 'flow.call', flow: child.id, onError: { next: 'handled' }, next: 'done' },
    handled: log('must not route budget failure'), done: log(),
  }, 'call', { limits: { maxJevCalls: 1 } });
  const result = await run(parent, { message: 'synthetic input' }, { dir, client: client(calls) });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'aborted');
  assert.equal(result.outputs.call.code, 'FLOW_BUDGET_JEV_CALLS');
  assert.deepEqual(result.path, ['call']);
  assert.equal(result.usage.jevCalls, 1);
  assert.equal(calls.length, 1);
});

test('a later child budget failure takes precedence over an earlier ordinary error', async t => {
  const dir = fixtureDir(t);
  const child = flow('mixed-child', { first: ask('second'), second: ask() }, 'first');
  store(dir, child);
  const parent = flow('mixed-parent', {
    call: { type: 'flow.call', flow: child.id, next: 'done', onError: { next: 'handled' } },
    handled: log('must not route'), done: log(),
  }, 'call', { limits: { maxJevCalls: 1 } });
  let attempts = 0;
  const result = await run(parent, { message: 'synthetic' }, {
    dir, client: { async ask() { attempts++; throw Object.assign(new Error('synthetic transport error'), { code: 'TEST_ERROR' }); } },
  });
  assert.equal(attempts, 1);
  assert.equal(result.outputs.call.code, 'FLOW_BUDGET_JEV_CALLS');
  assert.deepEqual(result.path, ['call']);
});

test('jev.verify in a child cannot bypass the parent Jev budget', async t => {
  const dir = fixtureDir(t);
  const calls = [];
  let verifications = 0;
  const child = flow('verify-child', {
    first: ask('verify'),
    verify: { type: 'jev.verify', claim: 'A synthetic claim.', evidence: 'A synthetic evidence.', next: 'done' },
    done: log(),
  }, 'first');
  store(dir, child);
  const parent = flow('verify-parent', {
    call: { type: 'flow.call', flow: child.id, next: 'done' }, done: log(),
  }, 'call', { limits: { maxJevCalls: 1 } });
  const result = await run(parent, { message: 'synthetic' }, {
    dir, client: client(calls),
    verifyExecutor: async () => { verifications++; return { veredito: 'suportada', apoio: 0.9 }; },
  });
  assert.equal(result.outputs.call.code, 'FLOW_BUDGET_JEV_CALLS');
  assert.equal(result.usage.jevCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(verifications, 0);
});

test('an injected pruner cannot call Jev after the parent budget is spent', async t => {
  const dir = fixtureDir(t);
  const calls = [];
  let pruneCalls = 0;
  const child = flow('prune-child', {
    first: ask('prune'),
    prune: { type: 'context.prune', messages: [{ role: 'tool', content: 'Synthetic text.' }] },
  }, 'first');
  store(dir, child);
  const parent = flow('prune-parent', {
    call: { type: 'flow.call', flow: child.id, next: 'done' }, done: log(),
  }, 'call', { limits: { maxJevCalls: 1 } });
  const result = await run(parent, { message: 'synthetic' }, {
    dir, client: client(calls),
    pruner: async messages => {
      pruneCalls++;
      return { messages, meta: { transportCalled: true } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(pruneCalls, 0);
  assert.equal(result.outputs.call.usage.jevCalls, 1);
  assert.equal(result.usage.jevCalls, 1);
});

test('child input-token reservations share the parent ceiling', async t => {
  const dir = fixtureDir(t);
  const input = { message: 'synthetic input for a measured budget' };
  const oneAsk = flow('single-ask', { first: ask() }, 'first');
  const measured = await run(oneAsk, input, { client: client([]) });
  const ceiling = measured.usage.inputTokensBudgeted;
  assert.ok(ceiling > 0);
  const child = flow('token-child', { first: ask('second'), second: ask() }, 'first');
  store(dir, child);
  const calls = [];
  const parent = flow('token-parent', {
    call: { type: 'flow.call', flow: child.id, next: 'done' }, done: log(),
  }, 'call', { limits: { maxInputTokens: ceiling } });
  const result = await run(parent, input, { dir, client: client(calls) });
  assert.equal(result.ok, false);
  assert.equal(result.outputs.call.code, 'FLOW_BUDGET_INPUT_TOKENS');
  assert.equal(result.usage.inputTokensBudgeted, ceiling);
  assert.equal(calls.length, 1);
});

test('parent maxSteps counts child steps and prevents the following action', async t => {
  const dir = fixtureDir(t);
  const child = flow('step-child', { first: log('one'), second: log('two') }, 'first');
  child.nodes.first.next = 'second';
  store(dir, child);
  const parent = flow('step-parent', {
    call: { type: 'flow.call', flow: child.id, next: 'after' },
    after: { type: 'action.set', values: { effect: 'must not happen' } },
  }, 'call', { limits: { maxSteps: 3 } });
  await assert.rejects(run(parent, { message: 'synthetic' }, { dir }), error => {
    assert.equal(error.code, 'FLOW_BUDGET_STEPS');
    assert.equal(error.checkpoint.usage.steps, 1);
    assert.equal(error.checkpoint.usage.childSteps, 2);
    assert.equal(error.checkpoint.context.vars.effect, undefined);
    return true;
  });
});

test('subflow filename cannot substitute a different embedded flow id', async t => {
  const dir = fixtureDir(t);
  const wrong = flow('actual-flow', { done: log() }, 'done');
  writeFileSync(join(dir, 'requested-flow.flow.json'), JSON.stringify(wrong));
  const parent = flow('parent-id', {
    call: { type: 'flow.call', flow: 'requested-flow', next: 'done' }, done: log(),
  }, 'call');
  const result = await run(parent, { message: 'synthetic' }, { dir });
  assert.equal(result.outputs.call.code, 'CALL_FLOW_ID_MISMATCH');
  assert.equal(result.ok, false);
});

test('flow.each carries item context and aggregates successful children', async t => {
  const dir = fixtureDir(t);
  const child = flow('each-child', { assign: { type: 'action.set', values: { value: '{{input.item}}' } } }, 'assign');
  store(dir, child);
  const parent = flow('each-parent', {
    each: { type: 'flow.each', list: '{{input.items}}', flow: child.id, next: 'done' }, done: log(),
  }, 'each', { input_schema: { items: { type: 'array', required: true } } });
  const result = await run(parent, { items: ['a', 'b', 'c'] }, { dir });
  assert.equal(result.ok, true);
  assert.deepEqual(result.outputs.each.resultados.map(item => item.vars.value), ['a', 'b', 'c']);
  assert.equal(result.usage.childSteps, 3);
  assert.deepEqual(result.path, ['each', 'done']);
});

test('flow.each reports partial item failure and uses explicit onError branch', async t => {
  const dir = fixtureDir(t);
  const child = flow('partial-child', { judge: ask() }, 'judge');
  store(dir, child);
  const calls = [];
  const parent = flow('partial-parent', {
    each: { type: 'flow.each', list: '{{input.items}}', flow: child.id, onError: { next: 'handled' }, next: 'done' },
    handled: log('review'), done: log('success'),
  }, 'each', { input_schema: { items: { type: 'array', required: true } } });
  const mocked = client(calls);
  const askOriginal = mocked.ask;
  mocked.ask = async request => {
    if (request.state.item === 'bad') throw Object.assign(new Error('synthetic failure'), { code: 'MOCK_FAILURE' });
    return askOriginal(request);
  };
  const result = await run(parent, { items: ['good', 'bad', 'good'] }, { dir, client: mocked });
  assert.equal(result.ok, false);
  assert.deepEqual(result.path, ['each', 'handled']);
  assert.equal(result.outputs.each.code, 'EACH_PARTIAL_FAILURE');
  assert.equal(result.outputs.each.ok_count, 2);
  assert.deepEqual(result.outputs.each.resultados.map(item => item.ok), [true, false, true]);
});

test('flow.each stops on aggregate Jev budget and does not route budget errors', async t => {
  const dir = fixtureDir(t);
  const calls = [];
  const child = flow('bounded-child', { judge: ask() }, 'judge');
  store(dir, child);
  const parent = flow('bounded-parent', {
    each: { type: 'flow.each', list: '{{input.items}}', flow: child.id, onError: { next: 'handled' }, next: 'done' },
    handled: log('must not run'), done: log(),
  }, 'each', { input_schema: { items: { type: 'array', required: true } }, limits: { maxJevCalls: 2 } });
  const result = await run(parent, { items: ['a', 'b', 'c', 'd'] }, { dir, client: client(calls) });
  assert.equal(result.status, 'aborted');
  assert.deepEqual(result.path, ['each']);
  assert.equal(result.outputs.each.code, 'FLOW_BUDGET_JEV_CALLS');
  assert.equal(result.outputs.each.ok_count, 2);
  assert.equal(result.outputs.each.orçamento_esgotado, true);
  assert.equal(result.usage.jevCalls, 2);
  assert.equal(calls.length, 2);
});
