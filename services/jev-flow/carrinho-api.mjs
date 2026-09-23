// Contrato do simulador: o modelo julga; o código valida e executa a ação.
const LANE_ACTIONS = new Set(['keep_lane', 'change_left', 'change_right']);
const SPEED_ACTIONS = new Set(['hold', 'slow_down', 'speed_up']);
const HAZARDS = new Set(['barrier', 'cone', 'parked_car', 'traffic_car', 'truck', 'pedestrian']);
const RECOVERY_SPEED_KMH = 24;

function lookaheadMetres(speedKmh) {
  return Math.max(42, Math.min(70, Math.round(speedKmh / 3.6 * 2.5 + 12)));
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boundedError(error) {
  return String(error?.message || error || 'erro desconhecido').slice(0, 240);
}

export function normalizePerception(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('perception inválida');
  const lane = finiteNumber(raw.ego?.lane ?? raw.lane);
  const speedKmh = finiteNumber(raw.ego?.speed_kmh ?? raw.speed_kmh ?? raw.speed);
  const maxSpeedKmh = finiteNumber(raw.ego?.max_speed_kmh ?? 72);
  if (!Number.isInteger(lane) || lane < 0 || lane > 2) throw new RangeError('ego.lane deve ser 0, 1 ou 2');
  if (speedKmh === null || speedKmh < 0 || speedKmh > 180) throw new RangeError('ego.speed_kmh fora de 0–180');
  if (maxSpeedKmh === null || maxSpeedKmh < 10 || maxSpeedKmh > 180) throw new RangeError('ego.max_speed_kmh fora de 10–180');
  if (!Array.isArray(raw.obstacles) || raw.obstacles.length > 80) throw new TypeError('obstacles deve ser lista de até 80 itens');
  const obstacles = raw.obstacles.map((item) => {
    const obstacleLane = finiteNumber(item?.lane);
    const distanceM = finiteNumber(item?.distance_m);
    if (!Number.isInteger(obstacleLane) || obstacleLane < 0 || obstacleLane > 2) throw new TypeError('pista de obstáculo inválida');
    if (distanceM === null || distanceM < -30 || distanceM > 300) throw new TypeError('distância de obstáculo inválida');
    if (!HAZARDS.has(item?.type)) throw new TypeError('tipo de obstáculo inválido');
    return { lane: obstacleLane, distance_m: Math.round(distanceM * 10) / 10, type: item.type };
  });
  const lookaheadM = lookaheadMetres(speedKmh);
  const lanes = [0, 1, 2].map((index) => {
    const objects = obstacles.filter((obstacle) => obstacle.lane === index).sort((a, b) => a.distance_m - b.distance_m);
    const nearestAhead = objects.find((obstacle) => obstacle.distance_m >= 0) || null;
    return {
      lane: index,
      free: !objects.some((obstacle) => obstacle.distance_m >= -10 && obstacle.distance_m <= lookaheadM),
      nearest_distance_m: nearestAhead?.distance_m ?? null,
    };
  });
  const nearest = obstacles
    .filter((obstacle) => obstacle.lane === lane && obstacle.distance_m >= 0)
    .sort((a, b) => a.distance_m - b.distance_m)[0] || null;
  return {
    ego: { lane, speed_kmh: Math.round(speedKmh * 10) / 10, max_speed_kmh: Math.round(maxSpeedKmh * 10) / 10 },
    driving_policy: {
      lookahead_m: lookaheadM,
      recovery_below_kmh: Math.min(RECOVERY_SPEED_KMH, maxSpeedKmh),
      stopped_recovery: 'acelerar quando a pista atual ou a faixa escolhida estiver livre',
    },
    obstacles,
    lanes,
    obstacles_ahead: obstacles.filter((obstacle) => obstacle.lane === lane && obstacle.distance_m >= 0).length,
    nearest,
    nearest_dist: nearest?.distance_m ?? null,
    left_free: lane > 0 && lanes[lane - 1].free,
    right_free: lane < 2 && lanes[lane + 1].free,
  };
}

export function buildJevQuestions() {
  return {
    lane_action: {
      type: 'choice',
      instructions: 'Escolha a ação de pista mais segura. Observe driving_policy.lookahead_m: se houver obstáculo na pista atual dentro desse horizonte, mude antecipadamente para uma faixa adjacente livre. Não mude para faixa bloqueada; não permaneça parado diante de desvio livre.',
      criteria: { keep_lane: 'permanecer na pista', change_left: 'mudar uma pista à esquerda', change_right: 'mudar uma pista à direita' },
    },
    speed_action: {
      type: 'choice',
      instructions: 'Se ego.speed_kmh estiver em zero ou abaixo de driving_policy.recovery_below_kmh e a faixa atual ou a faixa escolhida estiver livre, escolha speed_up para retomar movimento. Se não houver passagem segura, escolha slow_down. Evite keep_lane/hold indefinido em pista livre.',
      criteria: { hold: 'manter velocidade', slow_down: 'reduzir velocidade', speed_up: 'acelerar somente se seguro' },
    },
    hazard: { type: 'noul', instructions: 'Qual o risco imediato de colisão se o ego continuar na pista e velocidade atuais? 0 = sem risco, 1 = colisão iminente.' },
  };
}

function preferredEscapeLane(perception) {
  const lane = perception.ego.lane;
  const candidates = [lane - 1, lane + 1].filter((index) => index >= 0 && index <= 2 && perception.lanes[index].free);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const distanceA = perception.lanes[a].nearest_distance_m ?? Infinity;
    const distanceB = perception.lanes[b].nearest_distance_m ?? Infinity;
    return distanceB - distanceA || a - b;
  });
  return candidates[0];
}

export function deterministicDecision(perception) {
  const p = normalizePerception(perception);
  if (p.nearest_dist !== null && p.nearest_dist <= p.driving_policy.lookahead_m) {
    const escape = preferredEscapeLane(p);
    if (escape !== null) return {
      lane_action: escape < p.ego.lane ? 'change_left' : 'change_right',
      speed_action: p.ego.speed_kmh < p.driving_policy.recovery_below_kmh ? 'speed_up' : 'slow_down',
    };
    return { lane_action: 'keep_lane', speed_action: 'slow_down' };
  }
  return { lane_action: 'keep_lane',
    speed_action: p.ego.speed_kmh < p.driving_policy.recovery_below_kmh ? 'speed_up' : 'hold' };
}

export function validateDecision(raw) {
  const laneAction = raw?.lane_action;
  const speedAction = raw?.speed_action;
  if (!LANE_ACTIONS.has(laneAction) || !SPEED_ACTIONS.has(speedAction)) {
    throw new TypeError('ação fora do schema lane_action/speed_action');
  }
  return { lane_action: laneAction, speed_action: speedAction };
}

export function enforceSafety(rawDecision, perception) {
  const p = normalizePerception(perception);
  const proposed = validateDecision(rawDecision);
  const safe = { ...proposed };
  const reasons = [];
  if (safe.lane_action === 'change_left' && !p.left_free) {
    safe.lane_action = 'keep_lane';
    reasons.push('pista esquerda bloqueada ou inexistente');
  }
  if (safe.lane_action === 'change_right' && !p.right_free) {
    safe.lane_action = 'keep_lane';
    reasons.push('pista direita bloqueada ou inexistente');
  }
  const obstacleAhead = p.nearest_dist !== null && p.nearest_dist <= p.driving_policy.lookahead_m;
  if (obstacleAhead && safe.lane_action === 'keep_lane') {
    const escape = preferredEscapeLane(p);
    if (escape !== null) {
      safe.lane_action = escape < p.ego.lane ? 'change_left' : 'change_right';
      reasons.push('desvio antecipado pelo código: obstáculo dentro do horizonte');
    } else {
      if (safe.speed_action !== 'slow_down') {
        safe.speed_action = 'slow_down';
        reasons.push('freio de emergência: nenhuma faixa adjacente livre');
      }
      if (p.ego.speed_kmh < 1) reasons.push('sem rota segura no estado atual; permanece parado');
    }
  }
  if (safe.lane_action !== 'keep_lane' && p.nearest_dist !== null && p.nearest_dist < 12 && p.ego.speed_kmh >= RECOVERY_SPEED_KMH && safe.speed_action === 'speed_up') {
    safe.speed_action = 'slow_down';
    reasons.push('aceleração insegura junto ao obstáculo');
  }
  const currentLaneClear = !obstacleAhead;
  if (p.ego.speed_kmh < p.driving_policy.recovery_below_kmh &&
      (safe.lane_action !== 'keep_lane' || currentLaneClear) &&
      safe.speed_action !== 'speed_up') {
    safe.speed_action = 'speed_up';
    reasons.push('retomada local: velocidade baixa em faixa livre');
  }
  return { decision: safe, safetyOverride: reasons.length ? reasons : null };
}

function optionalCount(value) {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const inputTokens = optionalCount(raw.input_tokens ?? raw.prompt_tokens);
  const outputTokens = optionalCount(raw.output_tokens ?? raw.completion_tokens);
  if (inputTokens === 0 && outputTokens === 0) return null;
  return inputTokens === null && outputTokens === null ? null : { inputTokens, outputTokens };
}

export function estimateModelCost(usage, modelMeta) {
  if (!usage || usage.inputTokens === null || usage.outputTokens === null) return null;
  const inputRate = finiteNumber(modelMeta?.costPerMTokIn);
  const outputRate = finiteNumber(modelMeta?.costPerMTokOut);
  if (inputRate === null || outputRate === null || inputRate < 0 || outputRate < 0) return null;
  return (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1_000_000;
}

function optionalCost(value) {
  const cost = finiteNumber(value);
  return cost !== null && cost >= 0 ? cost : null;
}

export function parseLlmDecision(text) {
  if (typeof text !== 'string' || text.length > 12_000) throw new TypeError('resposta LLM inválida');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  let parsed;
  try {
    parsed = JSON.parse(fenced ? fenced[1] : text.trim());
  } catch {
    const match = /\{[^{}]*\}/.exec(text);
    if (!match) throw new TypeError('LLM não retornou JSON de decisão');
    parsed = JSON.parse(match[0]);
  }
  return validateDecision(parsed);
}

import { resolveModel as defaultResolveModel, executeChat as defaultExecuteChat } from './llm-gateway.mjs';

async function defaultJevClient() {
  const { JevClient } = await import('../jev/client.mjs');
  return new JevClient({ timeoutMs: 8_000 });
}

function fallbackResult(perception, latencyMs, reason, side = 'jev') {
  const enforced = enforceSafety(deterministicDecision(perception), perception);
  return {
    ok: false,
    source: 'deterministic',
    backend: 'local-code',
    model: null,
    decision: enforced.decision,
    proposedDecision: null,
    answers: null,
    usage: null,
    costUsd: null,
    costBasis: 'unavailable',
    latencyMs,
    safetyOverride: enforced.safetyOverride,
    fallbackReason: `${side}: ${reason}`,
  };
}

export async function handleJevDecision(body, { createJevClient = defaultJevClient, now = () => performance.now() } = {}) {
  const perception = normalizePerception(body?.perception);
  const started = now();
  try {
    const client = await createJevClient();
    if (!client?.configured && client?.configured !== undefined) throw new Error('JEV não configurado');
    const result = await client.ask({ state: perception, questions: buildJevQuestions() });
    const proposed = validateDecision({
      lane_action: result?.answers?.lane_action?.choice,
      speed_action: result?.answers?.speed_action?.choice,
    });
    const safe = enforceSafety(proposed, perception);
    const usage = normalizeUsage(result?.usage);
    return {
      ok: true,
      source: 'jev',
      backend: result?.backend || client?.backend || null,
      model: result?.model || client?.model || 'jev-latest',
      decision: safe.decision,
      proposedDecision: proposed,
      answers: result.answers,
      usage,
      costUsd: (result?.backend || client?.backend) !== 'openjev-compatible' && usage?.inputTokens != null ? optionalCost(result?.costEstimateUsd) : null,
      costBasis: (result?.backend || client?.backend) !== 'openjev-compatible' && usage?.inputTokens != null && optionalCost(result?.costEstimateUsd) !== null ? 'estimated' : 'unavailable',
      latencyMs: Math.max(0, Math.round(now() - started)),
      safetyOverride: safe.safetyOverride,
      fallbackReason: null,
    };
  } catch (error) {
    return fallbackResult(perception, Math.max(0, Math.round(now() - started)), boundedError(error));
  }
}

export async function handleLlmDecision(body, { resolveModel = defaultResolveModel, executeChat = defaultExecuteChat, now = () => performance.now() } = {}) {
  const perception = normalizePerception(body?.perception);
  const model = String(body?.model || '').trim();
  if (!model || model.length > 180) throw new TypeError('model obrigatório');
  const started = now();
  try {
    const resolved = await resolveModel(model);
    if (!resolved) throw new Error(`modelo não encontrado: ${model}`);
    const result = await executeChat({
      providerId: resolved.providerId,
      modelId: resolved.modelId,
      messages: [
        { role: 'system', content: 'You control one car in a simulation. Return exactly one JSON object with two keys, for example {"lane_action":"keep_lane","speed_action":"speed_up"}. lane_action must be keep_lane, change_left or change_right; speed_action must be hold, slow_down or speed_up. If speed_kmh is 0 and the lane is clear, choose speed_up. If an obstacle is within driving_policy.lookahead_m, change to a free adjacent lane early. If no safe route exists, brake. No prose.' },
        { role: 'user', content: JSON.stringify(perception) },
      ],
      maxTokens: 1200,
      temperature: 0,
      stream: false,
      signal: AbortSignal.timeout(12_000),
    });
    const content = result?.content ?? result?.choices?.[0]?.message?.content;
    const proposed = parseLlmDecision(content);
    const safe = enforceSafety(proposed, perception);
    const usage = normalizeUsage(result?.usage);
    const modelMeta = resolved.provider?.models?.find((item) => item.id === resolved.modelId);
    const costReported = optionalCost(result?.usage?.cost_usd ?? result?.usage?.cost ?? result?.costUsd ?? result?.cost_usd);
    const costEstimate = result?.model && result.model !== resolved.modelId
      ? null : estimateModelCost(usage, modelMeta);
    return {
      ok: true,
      source: 'llm',
      backend: result?.backend || result?.providerId || null,
      requestedBackend: resolved.providerId,
      model: typeof result?.model === 'string' && result.model.trim() ? result.model.trim() : `${resolved.providerId}/${resolved.modelId}`,
      modelBasis: typeof result?.model === 'string' && result.model.trim() ? 'executor' : 'requested',
      decision: safe.decision,
      proposedDecision: proposed,
      answers: null,
      usage,
      costUsd: costReported ?? costEstimate,
      costBasis: costReported !== null ? 'reported' : costEstimate !== null ? 'estimated' : 'unavailable',
      latencyMs: Math.max(0, Math.round(now() - started)),
      safetyOverride: safe.safetyOverride,
      fallbackReason: null,
    };
  } catch (error) {
    return fallbackResult(perception, Math.max(0, Math.round(now() - started)), boundedError(error), 'llm');
  }
}
