import { createHash, randomUUID } from 'node:crypto';
import { executeChat, resolveModel } from './llm-gateway.mjs';
import { llmCost, measuredComparison, readUsage } from './metrics.mjs';
import { arenaCost, createArenaJevClient, recordArenaTrace, validateJevEngine } from './battle.mjs';

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const noul = instructions => ({ type: 'noul', instructions });
const score = (instructions, criteria) => ({ type: 'score', instructions, criteria });

// Same 27 questions and order for both engines. The incident text is editable.
export const RACE_QUESTIONS = Object.freeze({
  revenue_impacted: noul('Does the incident currently affect revenue? Judge from the incident in state.incident.'),
  business_impact: choice('What is the main business impact in state.incident?', { degraded: 'service works with reduced quality', blocked: 'a critical workflow is unavailable', financial: 'direct money loss or incorrect charges', unknown: 'not established' }),
  integration_issue: noul('Is an external or internal integration failing in state.incident?'),
  account_health: choice('What is the customer account health indicated by state.incident?', { healthy: 'no account risk shown', watch: 'possible account risk', at_risk: 'explicit churn or severe disruption', unknown: 'not established' }),
  incident_scope: choice('How broad is the incident in state.incident?', { single_account: 'one account', multiple_accounts: 'several accounts', platform_wide: 'most or all customers', unknown: 'not established' }),
  security_concern: noul('Is a security concern reported in state.incident?'),
  duplicate_charge: noul('Does state.incident report a duplicate charge?'),
  churn_likelihood: score('How strong is the evidence of customer churn in state.incident?', ['none', 'weak', 'moderate', 'strong']),
  scope_certainty: score('How certain is the reported scope in state.incident?', ['unknown', 'tentative', 'supported', 'confirmed']),
  human_attention: noul('Does state.incident require human attention now?'),
  security_risk: score('How severe is the security risk supported by state.incident?', ['none', 'low', 'medium', 'high']),
  feature_request: noul('Is the primary request in state.incident a new feature?'),
  partner_launch: noul('Is a partner launch endangered according to state.incident?'),
  credible_churn: noul('Does state.incident contain a credible threat or signal of customer churn?'),
  production_down: noul('Is a production capability unavailable according to state.incident?'),
  customer_data_exposed: noul('Does state.incident report exposure of customer data?'),
  server_error: noul('Does state.incident report a server error?'),
  financial_impact: score('How large is the supported financial impact in state.incident?', ['none', 'minor', 'material', 'critical']),
  response_deadline: choice('When is a response required according to state.incident?', { now: 'immediately', today: 'before end of today', scheduled: 'a later explicit date', unspecified: 'no deadline stated' }),
  repeated_failures: noul('Does state.incident report repeated production failures?'),
  primary_department: choice('Which team should primarily own the response to state.incident?', { technical: 'engineering or incident response', billing: 'billing or finance', security: 'security or privacy', support: 'general customer support' }),
  requested_resolution: choice('What resolution is requested in state.incident?', { restore_service: 'restore a failing service', refund: 'refund or correct a charge', investigate: 'investigate and explain', new_feature: 'build a new feature', unspecified: 'no specific resolution requested' }),
  threatening_language: noul('Does state.incident use personally threatening language?'),
  concrete_deadline: noul('Does state.incident state a concrete deadline?'),
  issue_category: choice('What is the main issue category in state.incident?', { integration_failure: 'an integration fails', payment_issue: 'billing or payment error', security_issue: 'security or privacy concern', product_bug: 'other product failure', feature_request: 'request for a new capability', other: 'none of these' }),
  technical_specificity: score('How technically specific is state.incident?', ['none', 'general', 'specific', 'reproducible']),
  resolution_complexity: score('How complex is the likely resolution supported by state.incident?', ['simple', 'moderate', 'complex', 'unknown']),
});
export const RACE_QUESTION_SET_HASH = createHash('sha256').update(JSON.stringify(RACE_QUESTIONS)).digest('hex');

export const RACE_EXAMPLE = 'An enterprise customer reports repeated 500 errors in the production CRM integration. Their launch is tomorrow at 09:00 and checkout is blocked for one account. They ask engineering to restore service today. No exposed data or duplicate charge has been reported.';

export function validateRaceInput({ incident, questions = RACE_QUESTIONS, model, jevEngine = 'typesafe' } = {}) {
  const text = String(incident || '').trim();
  if (!text || text.length > 4000) throw new Error('incidente obrigatório (até 4000 caracteres)');
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) throw new Error('perguntas devem ser um objeto');
  const entries = Object.entries(questions);
  if (entries.length < 1 || entries.length > 27 || JSON.stringify(questions).length > 30000) throw new Error('use de 1 a 27 perguntas (até 30 KB)');
  for (const [id, q] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(id) || !q || typeof q !== 'object'
        || !['noul', 'choice', 'score'].includes(q.type)
        || typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 350) {
      throw new Error(`pergunta inválida: ${id}`);
    }
    if (q.type === 'choice' && (!q.criteria || Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 8)) throw new Error(`choice inválida: ${id}`);
    if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 8)) throw new Error(`score inválido: ${id}`);
    if (q.type === 'choice' && Object.entries(q.criteria).some(([key, description]) =>
      !/^[a-z][a-z0-9_]{0,63}$/i.test(key) || typeof description !== 'string' || !description.trim() || description.length > 180)) {
      throw new Error(`opções inválidas: ${id}`);
    }
    if (q.type === 'score' && q.criteria.some(level => typeof level !== 'string' || !level.trim() || level.length > 180)) {
      throw new Error(`níveis inválidos: ${id}`);
    }
  }
  if (!String(model || '').trim() || String(model).length > 180) throw new Error('selecione um modelo LLM válido');
  return { incident: text, questions: Object.fromEntries(entries), model: String(model).trim(),
    jevEngine: validateJevEngine(jevEngine) };
}

function llmPrompt(incident, questions) {
  const specs = Object.entries(questions).map(([id, q]) => ({ id, type: q.type, instructions: q.instructions, criteria: q.criteria ?? null }));
  return `Analyze the incident below. Answer every question in the exact listed order. Return only JSON in the shape {"answers":{"question_id": value}}. For noul use a probability 0..1; for choice use one criteria key; for score use a number from 0 to the last level index. Preserve IDs exactly.\n\nINCIDENT:\n${incident}\n\nQUESTIONS:\n${JSON.stringify(specs)}`;
}

function parseJson(text) {
  const source = String(text || '').trim();
  try { return JSON.parse(source); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const first = source.indexOf('{'), last = source.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(source.slice(first, last + 1)); } catch {} }
  return null;
}

export function normalizeRaceAnswers(raw, questions) {
  const answers = raw?.answers || raw;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return { answers: {}, errors: ['JSON de respostas ausente'] };
  const normalized = {}, errors = [];
  for (const [id, q] of Object.entries(questions)) {
    const source = answers[id];
    const value = source && typeof source === 'object' ? source[q.type] : source;
    if (q.type === 'choice') {
      if (typeof value !== 'string' || !Object.hasOwn(q.criteria, value)) errors.push(`choice inválida: ${id}`);
      else normalized[id] = value;
    } else if (q.type === 'noul') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) errors.push(`noul inválido: ${id}`);
      else normalized[id] = value;
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > q.criteria.length - 1) errors.push(`score inválido: ${id}`);
    else normalized[id] = value;
  }
  return { answers: normalized, errors };
}

export async function runArenaRace(input, { jevClient = null, chat = executeChat, resolve = resolveModel,
  discoverLaya, now = () => performance.now() } = {}) {
  const { incident, questions, model, jevEngine } = validateRaceInput(input);
  const resolved = resolve(model);
  if (!resolved) throw new Error(`modelo não encontrado: ${model}`);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const questionSetHash = createHash('sha256').update(JSON.stringify(questions)).digest('hex');
  const jevPromise = (async () => {
    const start = now();
    let callStarted = false;
    try {
      const context = await createArenaJevClient(jevEngine, { client: jevClient, discoverLaya });
      callStarted = true;
      const result = await context.client.ask({ state: { incident }, questions });
      const normalized = normalizeRaceAnswers(result?.answers, questions);
      const usage = readUsage(result);
      const cost = arenaCost(result, context);
      return { ok: normalized.errors.length === 0, error: normalized.errors.join('; ') || null,
        source: context.source, engine: jevEngine, executionKind: context.executionKind,
        backend: context.source, model: result?.model || context.model,
        modelBasis: result?.model ? 'response' : 'selected', calibration: context.calibration,
        latencyMs: Math.round(now() - start), ...usage, ...cost, raw: result?.answers || null,
        answers: normalized.answers, answered: Object.keys(normalized.answers).length,
        completedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300), source: jevEngine,
        engine: jevEngine, executionKind: jevClient ? 'mocked' : callStarted ? 'attempted-unconfirmed' : 'unavailable', backend: null,
        model: jevClient?.model || null, latencyMs: Math.round(now() - start), inputTokens: null, outputTokens: null,
        costUsd: null, costSource: 'unavailable', raw: null, answers: {}, answered: 0,
        completedAt: new Date().toISOString() };
    }
  })();
  const llmPromise = (async () => {
    const start = now();
    try {
      const result = await chat({ providerId: resolved.providerId, modelId: resolved.modelId,
        messages: [{ role: 'user', content: llmPrompt(incident, questions) }], maxTokens: 1800,
        temperature: 0, stream: false, signal: AbortSignal.timeout(45000) });
      const text = result?.content ?? result?.choices?.[0]?.message?.content ?? '';
      const raw = parseJson(text);
      const normalized = normalizeRaceAnswers(raw, questions);
      const usage = readUsage(result);
      const cost = llmCost(result, resolved);
      return { ok: normalized.errors.length === 0, error: normalized.errors.join('; ') || null,
        source: 'llm', executionKind: chat === executeChat ? 'live' : 'mocked',
        backend: result?.providerId || null,
        requestedBackend: result?.requestedProviderId || resolved.providerId,
        providerRouteBasis: result?.providerId && chat === executeChat ? 'executor-confirmed' : 'unconfirmed',
        effectiveModelId: result?.effectiveModelId || null,
        model: result?.model || result?.effectiveModelId || resolved.modelId,
        modelBasis: result?.modelBasis || (result?.effectiveModelId ? 'executor-route' : 'requested'),
        latencyMs: Math.round(now() - start), ...usage, ...cost, raw: raw || String(text).slice(0, 12000),
        answers: normalized.answers, answered: Object.keys(normalized.answers).length,
        completedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300), source: 'llm', backend: null,
        requestedBackend: resolved.providerId, model: resolved.modelId, modelBasis: 'requested',
        latencyMs: Math.round(now() - start), inputTokens: null, outputTokens: null,
        costUsd: null, costSource: 'unavailable', raw: null, answers: {}, answered: 0,
        completedAt: new Date().toISOString() };
    }
  })();
  const [jev, llm] = await Promise.all([jevPromise, llmPromise]);
  const comparison = raceComparison(jev, llm, { questionCount: Object.keys(questions).length, questionSetHash });
  recordArenaTrace({ runId, mode: 'race', startedAt, jev, llm,
    questionCount: Object.keys(questions).length, questionSetHash,
    injected: Boolean(jevClient || chat !== executeChat) });
  return { runId, questionSetVersion: 'race-27-v1', questionSetHash,
    questionCount: Object.keys(questions).length, questionOrder: Object.keys(questions),
    questions, incident, jevEngine, jev, llm,
    comparison };
}

/** Pure benchmark eligibility policy. Executor route is identified separately from provider metadata. */
export function raceComparison(jev, llm, { questionCount, questionSetHash } = {}) {
  const comparable = questionCount === 27 && questionSetHash === RACE_QUESTION_SET_HASH
    && jev?.ok === true && llm?.ok === true
    && jev.executionKind === 'live' && llm.executionKind === 'live'
    && ['typesafe', 'laya-local'].includes(jev.source) && jev.backend === jev.source
    && Boolean(jev.model) && (jev.modelBasis === 'response'
      || jev.source === 'laya-local' && jev.modelBasis === 'selected')
    && Boolean(llm.backend && llm.requestedBackend && llm.effectiveModelId && llm.model)
    && llm.providerRouteBasis === 'executor-confirmed'
    && ['response', 'executor-route'].includes(llm.modelBasis)
    && jev.answered === 27 && llm.answered === 27;
  const measured = comparable ? measuredComparison(jev, llm) : { speedRatio: null, costRatio: null };
  return { comparable,
    reason: comparable ? 'fixed-27-live-complete-with-confirmed-backend'
      : 'requires fixed 27 questions, complete live answers and effective backend/model reported by both engines',
    speedRatio: measured.speedRatio, costRatio: measured.costRatio };
}
