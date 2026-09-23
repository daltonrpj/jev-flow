import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import {
  normalizePerception, deterministicDecision, enforceSafety, handleJevDecision,
  handleLlmDecision, normalizeUsage, estimateModelCost,
} from './carrinho-api.mjs';
import { buildCarrinhoPage, createSeededRandom } from './carrinho-page.mjs';

const state = (lane = 1, obstacles = []) => ({
  ego: { lane, speed_kmh: 42 },
  obstacles,
});

test('percepção deriva distância e pistas livres do mesmo estado', () => {
  const p = normalizePerception(state(1, [
    { lane: 1, distance_m: 12, type: 'barrier' },
    { lane: 0, distance_m: 7, type: 'cone' },
  ]));
  assert.equal(p.nearest_dist, 12);
  assert.equal(p.left_free, false);
  assert.equal(p.right_free, true);
  assert.deepEqual(deterministicDecision(p), { lane_action: 'change_right', speed_action: 'slow_down' });
});

test('segurança rejeita mudança de pista bloqueada e aceleração no obstáculo', () => {
  const p = state(1, [
    { lane: 0, distance_m: 5, type: 'barrier' },
    { lane: 1, distance_m: 8, type: 'barrier' },
  ]);
  const safe = enforceSafety({ lane_action: 'change_left', speed_action: 'speed_up' }, p);
  assert.deepEqual(safe.decision, { lane_action: 'change_right', speed_action: 'slow_down' });
  assert.ok(safe.safetyOverride.length >= 1);
});

test('velocidade zero em pista livre retoma sem apagar proposta JEV real', async () => {
  const response = await handleJevDecision({ perception: { ego: { lane: 1, speed_kmh: 0 }, obstacles: [] } }, {
    createJevClient: async () => ({
      configured: true, model: 'jev-latest',
      async ask({ state, questions }) {
        assert.equal(state.driving_policy.recovery_below_kmh, 24);
        assert.match(questions.speed_action.instructions, /zero/);
        return {
          model: 'jev-latest', backend: 'typesafe',
          answers: {
            lane_action: { type: 'choice', choice: 'keep_lane' },
            speed_action: { type: 'choice', choice: 'hold' },
            hazard: { type: 'noul', noul: 0 },
          },
        };
      },
    }),
  });
  assert.equal(response.source, 'jev');
  assert.deepEqual(response.proposedDecision, { lane_action: 'keep_lane', speed_action: 'hold' });
  assert.deepEqual(response.decision, { lane_action: 'keep_lane', speed_action: 'speed_up' });
  assert.match(response.safetyOverride.join(' '), /retomada local/);
  assert.equal(response.costUsd, null);
});

test('LLM parado em pista livre recebe retomada local com proveniência preservada', async () => {
  const response = await handleLlmDecision({
    perception: { ego: { lane: 1, speed_kmh: 0, max_speed_kmh: 72 }, obstacles: [] }, model: 'mock/v1',
  }, {
    resolveModel: async () => ({ providerId: 'mock', modelId: 'v1', provider: { models: [] } }),
    executeChat: async () => ({ model: 'v1', content: '{"lane_action":"keep_lane","speed_action":"hold"}' }),
  });
  assert.equal(response.source, 'llm');
  assert.deepEqual(response.proposedDecision, { lane_action: 'keep_lane', speed_action: 'hold' });
  assert.equal(response.decision.speed_action, 'speed_up');
  assert.ok(response.safetyOverride);
});

test('corredor alternado muda cedo e retoma; bloqueio total não promete rota', () => {
  const row = (lane, distance_m) => ({ lane, distance_m, type: 'barrier' });
  const first = enforceSafety({ lane_action: 'keep_lane', speed_action: 'hold' }, {
    ego: { lane: 1, speed_kmh: 0 }, obstacles: [row(0, -12), row(1, 31), row(2, 31)],
  });
  assert.deepEqual(first.decision, { lane_action: 'change_left', speed_action: 'speed_up' });
  const afterShift = enforceSafety({ lane_action: 'keep_lane', speed_action: 'hold' }, {
    ego: { lane: 0, speed_kmh: 9 }, obstacles: [row(0, -12), row(1, 31), row(2, 31)],
  });
  assert.deepEqual(afterShift.decision, { lane_action: 'keep_lane', speed_action: 'speed_up' });
  const nextRow = enforceSafety({ lane_action: 'keep_lane', speed_action: 'hold' }, {
    ego: { lane: 0, speed_kmh: 18 }, obstacles: [row(0, 31), row(1, -12), row(2, 31)],
  });
  assert.deepEqual(nextRow.decision, { lane_action: 'change_right', speed_action: 'speed_up' });
  const blocked = enforceSafety({ lane_action: 'keep_lane', speed_action: 'hold' }, {
    ego: { lane: 1, speed_kmh: 0 }, obstacles: [row(0, 10), row(1, 10), row(2, 10)],
  });
  assert.deepEqual(blocked.decision, { lane_action: 'keep_lane', speed_action: 'slow_down' });
  assert.match(blocked.safetyOverride.join(' '), /sem rota segura/);
});

test('JEV real injeta client.ask, preserva respostas e custo estimado com uso informado', async () => {
  let captured;
  const response = await handleJevDecision({ perception: state() }, {
    createJevClient: async () => ({
      configured: true, model: 'jev-latest',
      async ask(request) {
        captured = request;
        return {
          model: 'jev-latest', backend: 'typesafe',
          answers: {
            lane_action: { type: 'choice', choice: 'keep_lane', confidence: 0.91 },
            speed_action: { type: 'choice', choice: 'hold', confidence: 0.83 },
            hazard: { type: 'noul', noul: 0.05 },
          },
          usage: { input_tokens: 120, output_tokens: 16 },
          costEstimateUsd: 0.00008,
        };
      },
    }),
    now: (() => { let t = 100; return () => (t += 25); })(),
  });
  assert.equal(captured.questions.lane_action.type, 'choice');
  assert.equal(response.source, 'jev');
  assert.equal(response.model, 'jev-latest');
  assert.equal(response.answers.hazard.noul, 0.05);
  assert.deepEqual(response.usage, { inputTokens: 120, outputTokens: 16 });
  assert.equal(response.costUsd, 0.00008);
  assert.equal(response.latencyMs, 25);
});

test('JEV indisponível entra em reflexo rotulado e mantém erro visível', async () => {
  const response = await handleJevDecision({ perception: state(1, [{ lane: 1, distance_m: 12, type: 'cone' }]) }, {
    createJevClient: async () => { throw new Error('sem chave'); },
  });
  assert.equal(response.source, 'deterministic');
  assert.match(response.fallbackReason, /sem chave/);
  assert.equal(response.decision.lane_action, 'change_left');
  assert.equal(response.answers, null);
});

test('LLM valida JSON, preserva nome real e calcula custo só com preços registrados', async () => {
  const mockModel = { providerId: 'mock', modelId: 'v1', provider: { models: [{ id: 'v1', costPerMTokIn: 0.2, costPerMTokOut: 0.8 }] } };
  const response = await handleLlmDecision({ perception: state(), model: 'mock/v1' }, {
    resolveModel: async () => mockModel,
    executeChat: async () => ({
      content: '{"lane_action":"keep_lane","speed_action":"hold"}',
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  });
  assert.equal(response.source, 'llm');
  assert.equal(response.model, 'mock/v1');
  assert.equal(response.costBasis, 'estimated');
  assert.equal(response.costUsd, (100 * 0.2 + 20 * 0.8) / 1_000_000);
  assert.equal(estimateModelCost(normalizeUsage({ prompt_tokens: 100 }), mockModel.provider.models[0]), null);
});

test('LLM mostra modelo efetivo e custo reportado pelo executor', async () => {
  const response = await handleLlmDecision({ perception: state(), model: 'mock/v1' }, {
    resolveModel: async () => ({ providerId: 'mock', modelId: 'v1', provider: { models: [] } }),
    executeChat: async () => ({
      model: 'mock/v1.1',
      content: '{"lane_action":"keep_lane","speed_action":"hold"}',
      usage: { prompt_tokens: 100, completion_tokens: 10, cost_usd: 0.000321 },
    }),
  });
  assert.equal(response.model, 'mock/v1.1');
  assert.equal(response.modelBasis, 'executor');
  assert.equal(response.costUsd, 0.000321);
  assert.equal(response.costBasis, 'reported');
});

test('uso zerado e redirecionamento sem preço efetivo ficam como custo desconhecido', async () => {
  const resolveModel = async () => ({ providerId: 'mock', modelId: 'v1', provider: {
    models: [{ id: 'v1', costPerMTokIn: 1, costPerMTokOut: 1 }],
  } });
  const zero = await handleLlmDecision({ perception: state(), model: 'mock/v1' }, {
    resolveModel, executeChat: async () => ({
      content: '{"lane_action":"keep_lane","speed_action":"hold"}',
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }),
  });
  assert.equal(zero.usage, null);
  assert.equal(zero.costUsd, null);
  const redirected = await handleLlmDecision({ perception: state(), model: 'mock/v1' }, {
    resolveModel, executeChat: async () => ({
      model: 'effective-v2', content: '{"lane_action":"keep_lane","speed_action":"hold"}',
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    }),
  });
  assert.equal(redirected.model, 'effective-v2');
  assert.equal(redirected.backend, null);
  assert.equal(redirected.requestedBackend, 'mock');
  assert.equal(redirected.costUsd, null);
});

test('LLM com ação inventada usa reflexo identificado, sem contabilizar custo desconhecido', async () => {
  const response = await handleLlmDecision({ perception: state(), model: 'mock/v1' }, {
    resolveModel: async () => ({ providerId: 'mock', modelId: 'v1', provider: { models: [] } }),
    executeChat: async () => ({ content: '{"lane_action":"teleport","speed_action":"hold"}' }),
  });
  assert.equal(response.source, 'deterministic');
  assert.match(response.fallbackReason, /schema/);
  assert.equal(response.costUsd, null);
});

test('página escapa modelos e entrega script compilável', () => {
  const html = buildCarrinhoPage({ llmModels: ['ok/model', 'x"><img src=x onerror=alert(1)>'] });
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script));
});

test('runtime da página retoma carro parado e desvia no corredor alternado', () => {
  const html = buildCarrinhoPage({ llmModels: ['mock/v1'] });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const augmented = script.replace(
    'reset();updateControls();requestAnimationFrame(tick);',
    'reset();updateControls();globalThis.__probe={cars:cars,setObstacles:function(list){obstacles=list;},applyDecision:applyDecision};requestAnimationFrame(tick);',
  );
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const defaults = { density: '1', maxSpeed: '72', interval: '850', seed: '20260922', course: 'squeeze', model: 'mock/v1' };
      nodes.set(id, {
        id, value: defaults[id] || '', checked: ['autoObjects', 'reflex', 'rays', 'answers'].includes(id),
        textContent: '', children: [], selectedOptions: [{ text: 'Estreitamento' }],
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, replaceChildren() { this.children = []; },
        append(...items) { this.children.push(...items); }, prepend(item) { this.children.unshift(item); },
        getContext() { return {}; },
      });
    }
    return nodes.get(id);
  }
  const document = {
    body: { dataset: {} },
    getElementById: node,
    createElement: () => node('created-' + nodes.size),
    querySelector: () => ({ value: 'compare' }),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const sandbox = { document, requestAnimationFrame() {}, performance: { now: () => 0 }, setTimeout() {}, clearTimeout() {} };
  new Script(augmented).runInNewContext(sandbox);
  const { cars, setObstacles, applyDecision } = sandbox.__probe;
  cars.jev.speed = 0;
  setObstacles([]);
  assert.equal(applyDecision(cars.jev, { lane_action: 'keep_lane', speed_action: 'hold' }).speed_action, 'speed_up');
  assert.equal(cars.jev.speed, 9);
  cars.jev.speed = 0;
  cars.jev.dist = 61;
  setObstacles([
    { lane: 0, distance: 50, type: 'barrier' },
    { lane: 1, distance: 92, type: 'barrier' },
    { lane: 2, distance: 92, type: 'barrier' },
  ]);
  assert.equal(applyDecision(cars.jev, { lane_action: 'keep_lane', speed_action: 'hold' }).lane_action, 'change_left');
  assert.equal(cars.jev.lane, 0);
  assert.equal(cars.jev.speed, 9);
  assert.ok(cars.jev.clientSafetyOverride);
});

test('seed reproduz percurso e botão aleatório após reset', () => {
  const a = createSeededRandom(20260922);
  const b = createSeededRandom(20260922);
  const c = createSeededRandom(20260923);
  const sequence = Array.from({ length: 15 }, () => a());
  assert.deepEqual(sequence, Array.from({ length: 15 }, () => b()));
  assert.notDeepEqual(sequence, Array.from({ length: 15 }, () => c()));
  const html = buildCarrinhoPage();
  assert.match(html, /id="seed"/);
  assert.match(html, /rand=createSeededRandom\(requestedSeed\)/);
  assert.ok(!html.includes('Math.random()'));
});
