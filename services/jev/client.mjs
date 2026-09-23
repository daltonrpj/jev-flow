// ============================================================================
// Jev Client — TypeSafe System One (POST https://api.typesafe.ai/v1/systemone)
//
// Jev não gera texto: recebe `state` + perguntas tipadas (choice/noul/score) e
// devolve respostas tipadas com probabilidades calibradas. Este cliente segue
// o padrão do repo (fetch puro, sem SDK) e é injetável para testes offline —
// `fetchImpl` mockado elimina rede, chave e custo.
//
// Contrato (docs.typesafe.ai/api):
//   request : { model, state, questions: { <id>: {type, instructions, criteria} } }
//   response: { model, answers: { <id>: {...} }, usage: {input_tokens, output_tokens} }
//   noul   -> { noul: 0..1 }
//   choice -> { choice: <opção>, probabilities: {..soma 1..}, confidence: 0..1 }
//   score  -> { score: <índice fracionário>, legend, probabilities, confidence }
//   erros  : 401 chave, 422 payload inválido, 429/529 retry com backoff.
// ============================================================================

import { createHash } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

function defaultDataDirectory() {
  if (process.env.JEVFLOW_DATA_DIR) return process.env.JEVFLOW_DATA_DIR;
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'JevFlow');
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'JevFlow');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'jev-flow');
}
export const JEV_DATA_DIR = defaultDataDirectory();
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
let runtimeConfig = {};

export function configureJevRuntime(config = {}) {
  runtimeConfig = { ...runtimeConfig, ...config };
  return { configured: Boolean(runtimeConfig.apiKey) || runtimeConfig.allowAnonymous === true,
    provider: runtimeConfig.provider || null, model: runtimeConfig.model || null, keyReturned: false };
}
export function clearJevRuntime() { runtimeConfig = {}; return { configured: false }; }
export function getJevRuntimeConfig() { return { ...runtimeConfig }; }

/** Normaliza endpoints TypeSafe/OpenJev para o contrato /v1/systemone. */
export function normalizeJevBase(value) {
  const raw = String(value || '').trim().replace(/\/+$/u, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/u, '');
    if (/\/v1$/iu.test(path)) url.pathname = path;
    else if (/\/systemone$/iu.test(path)) url.pathname = path.slice(0, -'/systemone'.length) || '/v1';
    else url.pathname = `${path || ''}/v1`;
    return url.toString().replace(/\/+$/u, '');
  } catch {
    const path = raw.replace(/\/systemone$/iu, '').replace(/\/+$/u, '');
    return /\/v1$/iu.test(path) ? path : `${path}/v1`;
  }
}

export function isLoopbackJevBase(value) {
  try {
    const host = new URL(normalizeJevBase(value)).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost');
  } catch { return false; }
}

/** Resolve the configured backend without making network assumptions. */
export function resolveJevProvider({ apiBase, provider } = {}) {
  const requested = String(provider || runtimeConfig.provider || process.env.JEV_PROVIDER || 'auto').trim().toLowerCase();
  if (['openjev', 'openjev-compatible', 'open-jev'].includes(requested)) return 'openjev-compatible';
  if (['typesafe', 'jev', 'remote'].includes(requested)) return 'typesafe';
  const candidate = apiBase || runtimeConfig.apiBase || process.env.OPENJEV_BASE_URL || '';
  if (process.env.OPENJEV_BASE_URL && !process.env.TYPESAFE_API_BASE) return 'openjev-compatible';
  if (isLoopbackJevBase(candidate)) return 'openjev-compatible';
  return 'typesafe';
}

export function resolveJevConfig({ apiBase, model, provider } = {}) {
  const backend = resolveJevProvider({ apiBase, provider });
  const base = normalizeJevBase(apiBase || runtimeConfig.apiBase || (backend === 'openjev-compatible'
    ? (process.env.OPENJEV_BASE_URL || process.env.TYPESAFE_API_BASE || 'http://127.0.0.1:8080/v1')
    : (process.env.TYPESAFE_API_BASE || process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1')));
  const resolvedModel = model || runtimeConfig.model || (backend === 'openjev-compatible'
    ? (process.env.OPENJEV_MODEL || process.env.JEV_MODEL || 'openjev-latest')
    : (process.env.JEV_MODEL || 'jev-latest'));
  return { backend, apiBase: base, model: resolvedModel };
}

export const JEV_DEFAULT_BASE = resolveJevConfig().apiBase;
export const JEV_DEFAULT_MODEL = resolveJevConfig().model;
// Preço de referência (awesome-jev: US$ 0,042 / 1M tokens de entrada). Env
// permite reajustar sem tocar em código; a saída não é cobrada pelo modelo.
export const JEV_USD_PER_MTOK_IN = Number(process.env.JEV_USD_PER_MTOK_IN || 0.042);

export class JevError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.code = code || (status ? `HTTP_${status}` : 'JEV_ERROR');
  }
}

// --- Construtores de pergunta (thin, sem mágica) ----------------------------

export function noulQ(instructions, criteria) {
  const q = { type: 'noul', instructions };
  if (criteria) q.criteria = criteria;
  return q;
}

export function choiceQ(instructions, criteria) {
  if (!criteria || typeof criteria !== 'object' || Object.keys(criteria).length === 0) {
    throw new JevError('choice exige criteria: { opcao: descricao|null }', { code: 'BAD_QUESTION' });
  }
  return { type: 'choice', instructions, criteria };
}

export function scoreQ(instructions, levels) {
  if (!Array.isArray(levels) || levels.length < 2) {
    throw new JevError('score exige criteria: array com >= 2 níveis ordenados', { code: 'BAD_QUESTION' });
  }
  return { type: 'score', instructions, criteria: levels };
}

// --- Validação estrita de respostas ----------------------------------------

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every(key => Object.hasOwn(value, key))
    && keys.every(key => allowed.has(key));
}

function isUnitNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasExactProbabilityMap(value, expectedKeys) {
  if (!isPlainRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const keys = [...expectedKeys].map(String).sort();
  if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) return false;
  const probabilities = keys.map(key => value[key]);
  return probabilities.every(isUnitNumber)
    && Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) <= 0.02;
}

function validQuestion(question) {
  if (!hasExactKeys(question, ['type', 'instructions'], ['criteria'])
      || typeof question.instructions !== 'string' || !question.instructions.trim()) return false;
  if (question.type === 'noul') return true;
  if (question.type === 'choice') {
    return isPlainRecord(question.criteria) && Object.keys(question.criteria).length > 0;
  }
  if (question.type === 'score') {
    return Array.isArray(question.criteria) && question.criteria.length >= 2;
  }
  return false;
}

export function isValidJevQuestionMap(questions, { maxQuestions = null } = {}) {
  if (!isPlainRecord(questions)) return false;
  const entries = Object.entries(questions);
  if (entries.length === 0 || (maxQuestions != null && entries.length > maxQuestions)) return false;
  return entries.every(([id, question]) => typeof id === 'string' && id.length > 0 && validQuestion(question));
}

function validAnswerForQuestion(answer, question) {
  if (question.type === 'noul') {
    return hasExactKeys(answer, ['noul'], ['type'])
      && (!Object.hasOwn(answer, 'type') || answer.type === 'noul')
      && isUnitNumber(answer.noul);
  }
  if (question.type === 'choice') {
    const options = Object.keys(question.criteria);
    return hasExactKeys(answer, ['choice', 'probabilities', 'confidence'], ['type'])
      && (!Object.hasOwn(answer, 'type') || answer.type === 'choice')
      && typeof answer.choice === 'string' && options.includes(answer.choice)
      && isUnitNumber(answer.confidence)
      && hasExactProbabilityMap(answer.probabilities, options);
  }
  if (question.type === 'score') {
    const levelKeys = question.criteria.map((_, index) => String(index));
    if (!hasExactKeys(answer, ['score', 'legend', 'probabilities', 'confidence'], ['type'])
        || (Object.hasOwn(answer, 'type') && answer.type !== 'score')
        || typeof answer.score !== 'number' || !Number.isFinite(answer.score)
        || answer.score < 0 || answer.score > question.criteria.length - 1
        || !isUnitNumber(answer.confidence)
        || !hasExactProbabilityMap(answer.probabilities, levelKeys)
        || !isPlainRecord(answer.legend)
        || Object.keys(answer.legend).sort().join('|') !== [...levelKeys].sort().join('|')) return false;
    return levelKeys.every((key, index) => answer.legend[key] === question.criteria[index]);
  }
  return false;
}

export function isValidJevResponseForQuestions(response, questions) {
  if (!isValidJevQuestionMap(questions) || !isPlainRecord(response) || !isPlainRecord(response.answers)) return false;
  const questionIds = Object.keys(questions).sort();
  const answerIds = Object.keys(response.answers).sort();
  if (questionIds.length !== answerIds.length || questionIds.some((id, index) => id !== answerIds[index])) return false;
  return questionIds.every(id => validAnswerForQuestion(response.answers[id], questions[id]));
}

// --- Utilitários -------------------------------------------------------------

export function isJevConfigured() {
  const config = resolveJevConfig();
  if (runtimeConfig.apiKey?.trim()) return true;
  const key = config.backend === 'openjev-compatible' ? process.env.OPENJEV_API_KEY : process.env.TYPESAFE_API_KEY;
  if (key && key.trim()) return true;
  return config.backend === 'openjev-compatible'
    && isLoopbackJevBase(config.apiBase)
    && process.env.OPENJEV_ALLOW_NO_KEY !== '0' && runtimeConfig.allowAnonymous !== false;
}

export function estimateCostUsd(usage) {
  if (!usage?.input_tokens) return 0;
  return (usage.input_tokens / 1e6) * JEV_USD_PER_MTOK_IN;
}

export function appendJsonl(path, obj) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(obj) + '\n');
    return true;
  } catch {
    // Log de usage é telemetria best-effort: nunca derruba a decisão.
    return false;
  }
}

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Compactação semântica segura para o envelope de perguntas.
 *
 * Não toca no `state`, nos IDs, nos tipos ou nas opções: apenas normaliza
 * whitespace em instruções e critérios textuais. Isso reduz ruído criado por
 * templates multilinha sem transformar o payload em uma nova linguagem.
 */
export function compactJevText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : value;
}

export function compactJevQuestion(question) {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
  const compacted = { ...question };
  if ('instructions' in compacted) compacted.instructions = compactJevText(compacted.instructions);
  if (Array.isArray(compacted.criteria)) {
    compacted.criteria = compacted.criteria.map(compactJevText);
  } else if (compacted.criteria && typeof compacted.criteria === 'object') {
    compacted.criteria = Object.fromEntries(
      Object.entries(compacted.criteria).map(([key, value]) => [key, compactJevText(value)]),
    );
  }
  return compacted;
}

export function compactJevQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return questions;
  return Object.fromEntries(
    Object.entries(questions).map(([id, question]) => [id, compactJevQuestion(question)]),
  );
}

// --- Cliente ------------------------------------------------------------------

const RETRYABLE = new Set([429, 529]);

export class JevClient {
  constructor({
    apiKey = undefined,
    apiBase = undefined,
    model = undefined,
    provider = undefined,
    allowAnonymous = undefined,
    timeoutMs = 2500,
    maxRetries = 2,
    fetchImpl = fetch,
    dataDir = JEV_DATA_DIR,
    logUsage = true,
    compactQuestions = true,
  } = {}) {
    const resolved = resolveJevConfig({ apiBase, model, provider });
    this.backend = resolved.backend;
    this.provider = resolved.backend;
    this.apiKey = (apiKey ?? runtimeConfig.apiKey ?? (resolved.backend === 'openjev-compatible' ? process.env.OPENJEV_API_KEY : process.env.TYPESAFE_API_KEY) ?? '').trim();
    this.apiBase = resolved.apiBase;
    this.model = resolved.model;
    this.allowAnonymous = allowAnonymous ?? (this.backend === 'openjev-compatible'
      && isLoopbackJevBase(this.apiBase)
      && process.env.OPENJEV_ALLOW_NO_KEY !== '0' && runtimeConfig.allowAnonymous !== false);
    this.timeoutMs = Number(timeoutMs) || 2500;
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.fetchImpl = fetchImpl;
    this.dataDir = dataDir;
    this.logUsageEnabled = logUsage;
    this.compactQuestions = compactQuestions !== false;
  }

  get configured() {
    return this.apiKey.length > 0 || this.allowAnonymous;
  }

  /**
   * Faz uma pergunta (ou várias, em paralelo, sobre o mesmo state) ao Jev.
   * Retorna `{ model, answers, usage, latencyMs, costEstimateUsd, requestMetrics }`.
   * Lança JevError em timeout / 401 / 422 / erro de rede esgotado.
   */
  async ask({ state, questions, model, compactQuestions = this.compactQuestions } = {}) {
    if (!this.configured) {
      const envName = this.backend === 'openjev-compatible' ? 'OPENJEV_API_KEY' : 'TYPESAFE_API_KEY';
      throw new JevError(`${envName} ausente`, { code: 'NO_KEY' });
    }
    if (!questions || typeof questions !== 'object' || Object.keys(questions).length === 0) {
      throw new JevError('questions é obrigatório (mapa id -> pergunta)', { code: 'BAD_REQUEST' });
    }

    const requestQuestions = compactQuestions ? compactJevQuestions(questions) : questions;
    const bodyBeforeCompaction = JSON.stringify({ model: model || this.model, state, questions });
    const body = JSON.stringify({ model: model || this.model, state, questions: requestQuestions });
    const requestMetrics = {
      compacted: Boolean(compactQuestions),
      payload_bytes_before: Buffer.byteLength(bodyBeforeCompaction, 'utf8'),
      payload_bytes: Buffer.byteLength(body, 'utf8'),
      payload_bytes_saved: Buffer.byteLength(bodyBeforeCompaction, 'utf8') - Buffer.byteLength(body, 'utf8'),
    };
    const started = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Backoff exponencial + jitter — educado com 429/529.
        await new Promise(r => setTimeout(r, 300 * 2 ** (attempt - 1) + Math.random() * 200));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = { 'content-type': 'application/json' };
        if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
        const res = await this.fetchImpl(`${this.apiBase}/systemone`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new JevError(`Jev ${res.status} ${res.statusText} ${text}`.trim(), { status: res.status });
          if (RETRYABLE.has(res.status) && attempt < this.maxRetries) { lastError = err; continue; }
          throw err;
        }

        const data = await res.json();
        if (!isValidJevResponseForQuestions(data, requestQuestions)) {
          throw new JevError('Resposta Jev fora do schema System One', { code: 'BAD_RESPONSE' });
        }

        const latencyMs = Date.now() - started;
        const costEstimateUsd = estimateCostUsd(data.usage);
        if (this.logUsageEnabled) {
          appendJsonl(join(this.dataDir, 'usage.jsonl'), {
            ts: new Date().toISOString(),
            model: data.model || model || this.model,
            backend: this.backend,
            questions: Object.keys(questions),
            compacted_questions: requestMetrics.compacted,
            payload_bytes_before: requestMetrics.payload_bytes_before,
            payload_bytes: requestMetrics.payload_bytes,
            payload_bytes_saved: requestMetrics.payload_bytes_saved,
            latency_ms: latencyMs,
            input_tokens: data.usage?.input_tokens ?? null,
            output_tokens: data.usage?.output_tokens ?? null,
            cost_usd_estimate: costEstimateUsd,
          });
        }
        return { ...data, latencyMs, costEstimateUsd, requestMetrics, backend: this.backend, provider: this.provider };
      } catch (err) {
        if (err instanceof JevError) { lastError = err; if (!RETRYABLE.has(err.status)) throw err; continue; }
        if (err?.name === 'AbortError') {
          lastError = new JevError(`Jev timeout após ${this.timeoutMs}ms`, { code: 'TIMEOUT' });
          continue; // timeout também entra no backoff
        }
        throw new JevError(err?.message || 'falha de rede', { code: 'NETWORK' });
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError || new JevError('Jev esgotou tentativas', { code: 'EXHAUSTED' });
  }
}

// --- Fachada para o agente (tool jev_judge) -----------------------------------

function normalizeOptions(options) {
  if (!options) return null;
  if (Array.isArray(options)) {
    // score: níveis; choice: labels sem descrição
    return options.length ? options : null;
  }
  if (typeof options === 'object') return options;
  return null;
}

/**
 * Ponto de entrada único da tool do agente. Normaliza perguntas em formato
 * simples ({id, type, instructions, options}) para o contrato da API e devolve
 * respostas compactas. Sem chave -> erro claro (a tool é opcional).
 */
export async function judgeForAgent({ state, questions } = {}) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: 'questions é obrigatório: [{id, type, instructions, options?}]' };
  }
  const built = {};
  for (const q of questions) {
    if (!q?.id || !q?.instructions || !q?.type) {
      return { error: 'cada pergunta precisa de id, type (noul|choice|score) e instructions' };
    }
    const options = normalizeOptions(q.options);
    if (q.type === 'choice') {
      if (!options || Array.isArray(options)) {
        return { error: `choice "${q.id}" exige options: {label: descrição} (objeto não-vazio)` };
      }
      built[q.id] = choiceQ(q.instructions, options);
    } else if (q.type === 'score') {
      if (!options || !Array.isArray(options)) {
        return { error: `score "${q.id}" exige options: [nível1, nível2, ...] (>=2, ordenado)` };
      }
      built[q.id] = scoreQ(q.instructions, options);
    } else if (q.type === 'noul') {
      built[q.id] = noulQ(q.instructions, options || undefined);
    } else {
      return { error: `type inválido em "${q.id}": use noul, choice ou score` };
    }
  }

  const client = new JevClient();
  if (!client.configured) {
    return { error: 'TYPESAFE_API_KEY is not configured for this server process' };
  }
  try {
    const res = await client.ask({ state, questions: built });
    return {
      ok: true,
      model: res.model,
      answers: res.answers,
      latency_ms: res.latencyMs,
      cost_usd_estimate: res.costEstimateUsd,
      request_metrics: res.requestMetrics,
    };
  } catch (err) {
    return { error: err.message, code: err.code || 'JEV_ERROR' };
  }
}

// --- Mock p/ testes ------------------------------------------------------------

/**
 * Transporte determinístico para testes: `handler({ url, body, headers })`
 * recebe o corpo já parseado e devolve um mapa `{ answers, usage? }` ou
 * `{ status, body }` para simular erro. Sem rede, sem chave.
 */
export function mockJevFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const out = handler({ url, body, headers: init.headers, callIndex: calls.length - 1 });
    if (out && out.status && out.status >= 400) {
      return new Response(JSON.stringify(out.body || { error: 'mock' }), { status: out.status });
    }
    const payload = {
      model: out?.model || body.model,
      answers: out?.answers || {},
      usage: out?.usage || { input_tokens: 100, output_tokens: 10 },
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

export function choiceAnswer(choice, probabilities, confidence = 0.8) {
  return { type: 'choice', choice, probabilities, confidence };
}

export function noulAnswer(noul) {
  return { type: 'noul', noul };
}

export function scoreAnswer(score, levels) {
  const probabilities = {};
  const legend = {};
  levels.forEach((lvl, i) => { probabilities[String(i)] = 0; legend[String(i)] = lvl; });
  const low = Math.min(levels.length - 1, Math.max(0, Math.floor(score)));
  probabilities[String(low)] = 1;
  return { type: 'score', score, legend, probabilities, confidence: 0.8 };
}
