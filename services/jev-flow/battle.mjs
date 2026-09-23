// ============================================================================
// JEV Battle Arena — JEV vs LLM, lado a lado, mesmíssima pergunta.
//
// O JEV não gera texto: julga tipado (choice/noul/score) em milissegundos por
// µ-dólares. O LLM gera texto em segundos por centavos. A Arena prova o trade
// em tempo real: mesma entrada, dois motores em PARALELO, cronômetro vivo.
//
// Sem TYPESAFE_API_KEY: o lado JEV degrada com honestidade (erro claro dizendo
// o que configurar) — a Arena nunca inventa vitória.
// ============================================================================

import { JevClient } from '../jev/client.mjs';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LayaClient, descobrirLaya, modeloLayaPadrao } from '../jev/laya-local.mjs';
import { jevCost, llmCost, readUsage } from './metrics.mjs';
import { executeChat, resolveModel, listConfiguredModels } from './llm-gateway.mjs';
import { JEV_DATA_DIR } from '../jev/client.mjs';

const LLM_TIMEOUT_MS = 45_000;
const JEV_TIMEOUT_MS = 12_000;
const ARENA_TRACE_PATH = join(JEV_DATA_DIR, 'arena-runs.jsonl');

/** Server-side metadata only: never persists prompts, input text, or raw model output. */
export function recordArenaTrace({ runId, mode, startedAt, jev, llm, quality = null,
  questionCount = null, questionSetHash = null, cancelled = false, injected = false } = {},
  { append = appendFileSync, ensure = mkdirSync } = {}) {
  if (injected) return { recorded: false };
  try {
    const endedAt = new Date().toISOString();
    const side = value => ({ status: value?.ok ? 'complete' : value?.cancelled ? 'cancelled' : 'failed',
      errorCode: value?.ok ? null : value?.status || value?.executionKind || 'failed',
      source: value?.source || null, engine: value?.engine || null, backend: value?.backend || null,
      requestedBackend: value?.requestedBackend || null, model: value?.model || null,
      modelBasis: value?.modelBasis || null, executionKind: value?.executionKind || null,
      latencyMs: value?.latencyMs ?? null, inputTokens: value?.inputTokens ?? null,
      outputTokens: value?.outputTokens ?? null, costUsd: value?.costUsd ?? null,
      costSource: value?.costSource || null });
    const record = { runId, mode, startedAt, endedAt, questionCount, questionSetHash, cancelled,
      events: [{ phase: 'started', at: startedAt },
        { phase: 'jev-ended', at: jev?.completedAt || endedAt, status: jev?.ok ? 'complete' : 'failed' },
        { phase: 'llm-ended', at: llm?.completedAt || endedAt, status: llm?.ok ? 'complete' : 'failed' },
        ...(quality ? [{ phase: 'quality-ended', at: quality.completedAt || endedAt,
          status: quality.status || 'unknown' }] : []),
        { phase: cancelled ? 'cancelled' : 'ended', at: endedAt }],
      jev: side(jev), llm: side(llm), quality: quality ? side(quality) : null };
    ensure(dirname(ARENA_TRACE_PATH), { recursive: true });
    append(ARENA_TRACE_PATH, JSON.stringify(record) + '\n');
    return { recorded: true };
  } catch { return { recorded: false }; }
}

export function validateJevEngine(value) {
  const engine = value || 'typesafe';
  if (!['typesafe', 'laya-local'].includes(engine)) throw new Error('jevEngine deve ser typesafe ou laya-local');
  return engine;
}

/** Selects only the requested engine; missing TypeSafe credentials never select Laya. */
export async function createArenaJevClient(jevEngine, { client = null, discoverLaya = descobrirLaya } = {}) {
  const engine = validateJevEngine(jevEngine);
  if (client) return { client, engine, source: 'mock', executionKind: 'mocked', model: client.model || null, calibration: null };
  if (engine === 'typesafe') {
    if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error('TYPESAFE_API_KEY ausente; TypeSafe indisponível');
    const selected = new JevClient({ provider: 'typesafe', timeoutMs: JEV_TIMEOUT_MS, maxRetries: 0 });
    return { client: selected, engine, source: 'typesafe', executionKind: 'live', model: selected.model || null, calibration: null };
  }
  const status = await discoverLaya();
  if (!status?.disponivel) throw new Error('Laya local indisponível; configure LAYA_PYTHON e instale laya no Python selecionado');
  const model = status.modelo || modeloLayaPadrao();
  return { client: new LayaClient({ model, timeoutMs: 60_000 }), engine, source: 'laya-local',
    executionKind: 'live', model, calibration: { calibrated: status.calibrado === true,
      state: status.estado || 'unknown', caveat: 'A calibração é específica do checkpoint e das perguntas; valide casos novos com gabarito.' } };
}

export function arenaCost(result, context) {
  return context.engine === 'laya-local'
    ? { costUsd: null, costSource: 'local-compute-unmeasured' }
    : jevCost(result);
}

function buildRawJev(questions, res) {
  const raw = {};
  for (const [qid, q] of Object.entries(questions)) {
    const a = res?.answers?.[qid];
    if (!a) continue;
    if (q.type === 'choice') raw[qid] = { choice: a.choice, confidence: a.confidence ?? null, probabilities: a.probabilities ?? null };
    else if (q.type === 'noul') raw[qid] = { noul: a.noul, type: 'noul' };
    else if (q.type === 'score') raw[qid] = { score: a.score, confidence: a.confidence ?? null, legend: a.legend ?? null };
  }
  return raw;
}

// ── Avaliação de qualidade da resposta do LLM pelo JEV ──────────────────────
// O JEV atua como JUIZ da resposta do LLM em 5 dimensões calibradas.
// Cada dimensão recebe um noul (0..1) com probabilidade calibrada.
// O score composto é a média ponderada (relevância e precisão pesam mais).

const QUALITY_DIMENSIONS = [
  { id: 'relevancia', peso: 0.5, instructions: 'Does state.resposta_llm directly address state.pergunta?' },
  { id: 'clareza', peso: 0.5, instructions: 'Is state.resposta_llm clear and understandable as written?' },
];

export async function evaluateLLMQuality(questao, llmResposta, { client = null, jevEngine = 'typesafe', signal = null } = {}) {
  const started = performance.now();
  let context = null;
  try {
    if (!String(questao || '').trim() || !String(llmResposta || '').trim()) throw new Error('question and answer are required');
    if (signal?.aborted) return { ok: false, status: 'cancelled', error: 'request cancelled before quality call',
      costUsd: null, custoUsd: null, latencyMs: Math.round(performance.now() - started), additionalJevCall: false };
    context = await createArenaJevClient(jevEngine, { client });
    const jev = context.client;
    const questions = {};
    for (const dim of QUALITY_DIMENSIONS) {
      questions[dim.id] = { type: 'noul', instructions: dim.instructions };
    }
    const res = await jev.ask({
      state: {
        pergunta: String(questao).slice(0, 800),
        resposta_llm: String(llmResposta).slice(0, 3000),
      },
      questions,
      signal,
    });
    if (signal?.aborted) return { ok: false, status: 'cancelled', error: 'request cancelled during quality call',
      source: context.source, backend: context.source, model: res.model || context.model,
      latencyMs: Math.round(performance.now() - started), ...readUsage(res), ...arenaCost(res, context),
      jevInFlightNotCancelable: true };
    const dimensoes = {};
    let scoreComposto = 0;
    let pesoTotal = 0;
    for (const dim of QUALITY_DIMENSIONS) {
      const noul = res.answers?.[dim.id]?.noul;
      if (!Number.isFinite(noul) || noul < 0 || noul > 1) throw new Error(`invalid Noul answer: ${dim.id}`);
      dimensoes[dim.id] = { score: noul, peso: dim.peso, descricao: dim.instructions };
      scoreComposto += noul * dim.peso;
      pesoTotal += dim.peso;
    }
    const final = pesoTotal > 0 ? scoreComposto / pesoTotal : 0;
    const cost = arenaCost(res, context);
    return {
      ok: true, status: 'complete', latencyMs: Math.round(performance.now() - started), completedAt: new Date().toISOString(),
      source: context.source, backend: context.source, model: res.model || context.model,
      modelBasis: res.model ? 'response' : 'selected', ...readUsage(res),
      dimensoes,
      scoreComposto: Math.round(final * 1000) / 1000,
      veredito: 'Text relevance and clarity only; factual accuracy was not verified.',
      scope: 'text-only; no independent evidence supplied',
      costUsd: cost.costUsd, custoUsd: cost.costUsd, costSource: cost.costSource,
    };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300);
    const status = /TYPESAFE_API_KEY ausente|Laya local indisponível/i.test(message) ? 'unavailable'
      : /timeout|timed out|abort/i.test(message) ? 'timeout'
        : /invalid Noul|schema|fora do schema/i.test(message) ? 'invalid-response' : 'error';
    return { ok: false, status, error: message, completedAt: new Date().toISOString(),
      source: context?.source || validateJevEngine(jevEngine),
      backend: context?.source || null, model: context?.model || null,
      modelBasis: context?.model ? 'selected' : null, latencyMs: Math.round(performance.now() - started),
      inputTokens: null, outputTokens: null, costUsd: null, custoUsd: null, costSource: 'unavailable' };
  }
}

/**
 * Perguntas JEV padrão derivadas da entrada do usuário — cobre os tipos
 * primitivos (choice, noul, score) para mostrar o repertório completo.
 */
export function defaultBattleQuestions(questao) {
  return {
    relevancia: { type: 'noul', instructions: 'Is state.texto a meaningful request or question?' },
    complexidade: { type: 'choice', instructions: 'How much effort does the request in state.texto require?', criteria: { simples: 'direct answer', media: 'some context or steps', complexa: 'extended reasoning or tools' } },
    tom: { type: 'choice', instructions: 'What tone is expressed in state.texto?', criteria: { neutro: 'informative', urgente: 'time-sensitive', emocional: 'emotional', hostil: 'hostile' } },
    contexto_suficiente: { type: 'noul', instructions: 'Does state.texto contain enough context to attempt an answer without asking a follow-up?' },
    prioridade: { type: 'score', instructions: 'How urgent is the request in state.texto?', criteria: ['low', 'normal', 'high', 'urgent', 'critical'] },
  };
}

/**
 * Roda a batalha: JEV e LLM em paralelo sobre a mesma entrada.
 * Cada lado resolve independentemente — o mais lento nunca bloqueia o mais
 * rápido de aparecer. Retorna { jev, llm } com timing/custo/erro de cada.
 */

function battleComparison(jev, llm) {
  return { velocidadeVantagem: null, custoVantagem: null,
    jevLatencyMs: jev.latencyMs ?? null, llmLatencyMs: llm.latencyMs ?? null,
    jevCostUsd: jev.costUsd ?? null, llmCostUsd: llm.costUsd ?? null,
    veredicto: 'Jev typed judgments and LLM text generation are different operations. Raw latency and cost are shown; no winner or ratio is assigned.' };
}

function validateArenaQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)
      || !Object.keys(questions).length) throw new Error('invalid questions: non-empty map required');
  for (const [id, question] of Object.entries(questions)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(id) || !question ||
        !['noul', 'choice', 'score'].includes(question.type) ||
        typeof question.instructions !== 'string' || !question.instructions.trim())
      throw new Error(`invalid question: ${id}`);
    if (question.type === 'choice' && (!question.criteria || typeof question.criteria !== 'object'
        || Array.isArray(question.criteria) || Object.keys(question.criteria).length < 2))
      throw new Error(`invalid choice criteria: ${id}`);
    if (question.type === 'score' && (!Array.isArray(question.criteria) || question.criteria.length < 2))
      throw new Error(`invalid score criteria: ${id}`);
  }
}

function validateBattleAnswers(questions, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers))
    throw new Error('invalid Jev response: answers missing');
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer || typeof answer !== 'object') throw new Error(`invalid Jev response: missing ${id}`);
    if (question.type === 'noul' && (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1))
      throw new Error(`invalid Jev response: Noul ${id}`);
    if (question.type === 'choice' && (!Object.hasOwn(question.criteria, answer.choice)
        || answer.confidence != null && (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)))
      throw new Error(`invalid Jev response: Choice ${id}`);
    if (question.type === 'score' && (!Number.isFinite(answer.score) || answer.score < 0
        || answer.score > question.criteria.length - 1))
      throw new Error(`invalid Jev response: Score ${id}`);
  }
}

function sessionTotals(jev, llm, quality, latencyMs) {
  const costs = [jev.costUsd, llm.costUsd, ...(quality ? [quality.costUsd] : [])];
  const knownCostUsd = costs.filter(value => typeof value === 'number' && Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  return { sessionLatencyMs: Math.round(latencyMs), knownCostUsd,
    totalCostUsd: costs.every(value => typeof value === 'number' && Number.isFinite(value))
      ? knownCostUsd : null };
}

async function battleJev(question, questions, jevEngine, { client = null, discoverLaya = descobrirLaya,
  runId = null, signal = null, onJudgment = () => {}, onDone = () => {}, now = () => performance.now() } = {}) {
  const started = now();
  const engine = validateJevEngine(jevEngine);
  let callStarted = false;
  let requestValidated = false;
  try {
    validateArenaQuestions(questions);
    requestValidated = true;
    const context = await createArenaJevClient(engine, { client, discoverLaya });
    if (signal?.aborted) throw new Error('Battle request cancelled');
    callStarted = true;
    const res = await context.client.ask({ state: { texto: question.slice(0, 2000) }, questions, signal });
    if (signal?.aborted) throw new Error('Battle request cancelled after Jev call');
    validateBattleAnswers(questions, res?.answers);
    const respostas = {};
    for (const [id, q] of Object.entries(questions)) {
      const answer = res.answers?.[id];
      if (q.type === 'choice') respostas[id] = { tipo: 'choice', valor: answer.choice,
        confianca: answer.confidence ?? null, probabilidades: answer.probabilities ?? null };
      else if (q.type === 'noul') respostas[id] = { tipo: 'noul', valor: answer.noul };
      else respostas[id] = { tipo: 'score', valor: answer.score, confianca: answer.confidence ?? null };
      onJudgment(id, respostas[id]);
    }
    const cost = arenaCost(res, context);
    const data = { ok: true, runId, source: context.source, engine, executionKind: context.executionKind,
      backend: context.source, model: res.model || context.model, modelBasis: res.model ? 'response' : 'selected',
      calibration: context.calibration, input: question, questions, respostas, rawJev: buildRawJev(questions, res),
      latencyMs: Math.round(now() - started), completedAt: new Date().toISOString(),
      ...readUsage(res), ...cost, custoUsd: cost.costUsd };
    onDone(data); return data;
  } catch (error) {
    const invalidResponse = /invalid Jev response/.test(String(error?.message || error));
    const data = { ok: false, runId, source: engine, engine,
      status: invalidResponse ? 'invalid-response' : 'failed',
      executionKind: !requestValidated ? 'invalid-request' : client ? 'mocked'
        : callStarted ? 'attempted-unconfirmed' : 'unavailable',
      cancelled: signal?.aborted === true, jevInFlightNotCancelable: signal?.aborted === true && callStarted,
      error: String(error?.message || error).slice(0, 300), latencyMs: Math.round(now() - started),
      completedAt: new Date().toISOString(),
      costUsd: null, custoUsd: null, costSource: 'unavailable', inputTokens: null, outputTokens: null };
    onDone(data); return data;
  }
}

async function battleLlm(question, model, system, { chat = executeChat, resolve = resolveModel,
  runId = null, stream = false, signal = null, onToken = () => {}, onDone = () => {}, now = () => performance.now() } = {}) {
  const started = now();
  const resolved = model ? resolve(model) : null;
  if (!resolved) {
    const data = { ok: false, runId, source: 'llm', executionKind: 'unavailable',
      error: 'modelo "' + model + '" não encontrado',
      latencyMs: 0, completedAt: new Date().toISOString(), costUsd: null,
      costSource: 'unavailable', model: model || null, modelBasis: 'requested' };
    onDone(data); return data;
  }
  try {
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(LLM_TIMEOUT_MS)])
      : AbortSignal.timeout(LLM_TIMEOUT_MS);
    if (requestSignal.aborted) throw new Error('Battle request cancelled');
    const res = await chat({ providerId: resolved.providerId, modelId: resolved.modelId,
      messages: [{ role: 'system', content: system || 'Answer the user concisely.' },
        { role: 'user', content: question }],
      maxTokens: 600, temperature: 0.5, stream, signal: requestSignal });
    let text = '', metadata = res, streamKind = 'complete';
    if (stream && res && typeof res[Symbol.asyncIterator] === 'function') {
      streamKind = 'deltas'; metadata = { requestedProviderId: res.requestedProviderId,
        providerId: res.providerId, effectiveModelId: res.effectiveModelId };
      for await (const event of res) {
        if (requestSignal.aborted) throw new Error('Battle request cancelled');
        if (event?.type === 'delta' && typeof event.content === 'string') {
          text += event.content; onToken(event.content);
        }
        if (event?.model && (event.modelBasis === 'response' || metadata.modelBasis !== 'response'))
          metadata.model = event.model;
        if (event?.modelBasis === 'response' || !metadata.modelBasis && event?.modelBasis)
          metadata.modelBasis = event.modelBasis;
        if (event?.usage) metadata.usage = event.usage;
        if (event?.costUsd != null) metadata.costUsd = event.costUsd;
      }
    } else text = String(res?.content ?? res?.choices?.[0]?.message?.content ?? '');
    if (!text.trim()) throw new Error('LLM returned an empty response');
    const usage = readUsage(metadata);
    const cost = llmCost(metadata, resolved);
    const latencyMs = Math.round(now() - started);
    const effectiveProviderId = metadata?.providerId || null;
    const effectiveModelId = metadata?.effectiveModelId || null;
    const data = { ok: true, runId, source: 'llm', executionKind: chat === executeChat ? 'live' : 'mocked',
      provider: effectiveProviderId, backend: effectiveProviderId,
      requestedProviderId: metadata?.requestedProviderId || resolved.providerId,
      requestedBackend: metadata?.requestedProviderId || resolved.providerId,
      effectiveModelId, providerRouteBasis: effectiveProviderId ? 'executor-confirmed' : 'unconfirmed',
      model: metadata?.model || effectiveModelId || resolved.modelId,
      modelBasis: metadata?.modelBasis || (effectiveModelId ? 'executor-route'
        : metadata?.model ? 'adapter-unverified' : 'requested'), input: question, resposta: text,
      latencyMs, completedAt: new Date().toISOString(), streamKind, ...usage, ...cost, custoUsd: cost.costUsd,
      tokensPerSecond: latencyMs > 0 && usage.outputTokens != null
        ? Math.round(usage.outputTokens * 10000 / latencyMs) / 10 : null };
    onDone(data); return data;
  } catch (error) {
    const data = { ok: false, runId, source: 'llm',
      executionKind: chat === executeChat ? 'attempted-unconfirmed' : 'mocked',
      error: String(error?.message || error).slice(0, 300),
      latencyMs: Math.round(now() - started), completedAt: new Date().toISOString(),
      model: resolved.modelId, modelBasis: 'requested',
      costUsd: null, custoUsd: null, costSource: 'unavailable' };
    onDone(data); return data;
  }
}

export async function runBattle({ questao, model = '', questions = null, system = '',
  jevEngine = 'typesafe', quality = false } = {}, { jevClient = null, chat = executeChat,
  resolve = resolveModel, discoverLaya = descobrirLaya, now = () => performance.now() } = {}) {
  const question = String(questao || '').trim();
  if (!question) throw new Error('questao é obrigatória');
  validateJevEngine(jevEngine);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = now();
  const [jev, llm] = await Promise.all([
    battleJev(question, questions || defaultBattleQuestions(), jevEngine,
      { client: jevClient, discoverLaya, now, runId }),
    battleLlm(question, model, system, { chat, resolve, now, runId }),
  ]);
  const qualidade = quality && jev.ok && llm.ok
    ? await evaluateLLMQuality(question, llm.resposta, { client: jevClient, jevEngine }) : null;
  recordArenaTrace({ runId, mode: 'battle', startedAt, jev, llm, quality: qualidade,
    questionCount: Object.keys(questions || defaultBattleQuestions()).length,
    injected: Boolean(jevClient || chat !== executeChat) });
  return { runId, questao: question, jev, llm, comparativo: battleComparison(jev, llm), qualidade,
    ...sessionTotals(jev, llm, qualidade, now() - started),
    qualityRequested: quality, qualityCall: quality ? qualidade
      ? { ...qualidade, additionalJevCall: true }
      : { additionalJevCall: false, costUsd: null, status: 'skipped' } : null };
}

export async function runBattleStream({ questao, model = '', system = '', jevEngine = 'typesafe',
  quality = false, signal = null, onJevJudgment = () => {}, onJevDone = () => {}, onLlmToken = () => {},
  onLlmDone = () => {}, onComparativo = () => {} } = {}, { jevClient = null,
  chat = executeChat, resolve = resolveModel, discoverLaya = descobrirLaya,
  now = () => performance.now() } = {}) {
  const question = String(questao || '').trim();
  if (!question) throw new Error('questao é obrigatória');
  validateJevEngine(jevEngine);
  if (signal?.aborted) throw new Error('Battle request cancelled');
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const started = now();
  const [jev, llm] = await Promise.all([
    battleJev(question, defaultBattleQuestions(), jevEngine,
      { client: jevClient, discoverLaya, signal, onJudgment: onJevJudgment, onDone: onJevDone, now, runId }),
    battleLlm(question, model, system,
      { chat, resolve, stream: true, signal, onToken: onLlmToken, onDone: onLlmDone, now, runId }),
  ]);
  if (signal?.aborted) {
    recordArenaTrace({ runId, mode: 'battle-stream', startedAt, jev, llm, cancelled: true,
      questionCount: Object.keys(defaultBattleQuestions()).length,
      injected: Boolean(jevClient || chat !== executeChat) });
    return { runId, jev, llm, comparativo: null,
    cancelled: true, jevInFlightNotCancelable: jev.jevInFlightNotCancelable === true,
    qualidade: null, qualityRequested: quality, qualityCall: { additionalJevCall: false,
      costUsd: null, status: 'skipped-cancelled' }, ...sessionTotals(jev, llm, null, now() - started) };
  }
  const comparativo = battleComparison(jev, llm);
  onComparativo(comparativo);
  let qualidade = null;
  if (quality && jev.ok && llm.ok) {
    qualidade = await evaluateLLMQuality(question, llm.resposta, { client: jevClient, jevEngine, signal });
    if (!signal?.aborted) onComparativo({ qualidade, qualityCall: { ...qualidade, additionalJevCall: true } });
  }
  if (signal?.aborted) {
    recordArenaTrace({ runId, mode: 'battle-stream', startedAt, jev, llm, quality: qualidade,
      cancelled: true, questionCount: Object.keys(defaultBattleQuestions()).length,
      injected: Boolean(jevClient || chat !== executeChat) });
    return { runId, jev, llm, comparativo, qualidade,
    cancelled: true, jevInFlightNotCancelable: qualidade?.jevInFlightNotCancelable === true,
    qualityRequested: quality, qualityCall: qualidade ? { ...qualidade, additionalJevCall: true }
      : { additionalJevCall: false, status: 'skipped-cancelled', costUsd: null },
    ...sessionTotals(jev, llm, qualidade, now() - started) };
  }
  recordArenaTrace({ runId, mode: 'battle-stream', startedAt, jev, llm, quality: qualidade,
    questionCount: Object.keys(defaultBattleQuestions()).length,
    injected: Boolean(jevClient || chat !== executeChat) });
  return { runId, jev, llm, comparativo, qualidade, qualityRequested: quality,
    ...sessionTotals(jev, llm, qualidade, now() - started),
    qualityCall: quality ? qualidade ? { ...qualidade, additionalJevCall: true }
      : { additionalJevCall: false, costUsd: null, status: 'skipped' } : null };
}

/** Lista de modelos disponíveis para o seletor da arena. */
export async function listBattleModels() {
  return listConfiguredModels();
}
