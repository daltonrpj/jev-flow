// ============================================================================
// Judgment Cache — cache de julgamentos Jev em disco, chaveado por
// sha256(modelo|state|perguntas). Julgamento é função (quase) pura do input:
// o mesmo estado + as mesmas perguntas dão a mesma resposta dentro da janela
// de frescor — repetir a chamada é pagar duas vezes pelo mesmo julgamento.
//
// TTL separa dois usos: curto (minutos) para estados voláteis (mensagens,
// tickets), longo (horas) para conteúdo estático (documentos, códigos).
// Nunca cacheia erro: falha volta a subir para quem chamou.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JEV_DATA_DIR } from './client.mjs';

export const DEFAULT_JUDGMENT_CACHE_PATH = join(JEV_DATA_DIR, 'judgment-cache.json');

export const DEFAULT_TTL = {
  curto: 10 * 60 * 1000,   // estados voláteis (padrão do invoke)
  longo: 6 * 60 * 60 * 1000, // conteúdo estático
};

export const JUDGMENT_CACHE_SCHEMA = 'jev-judgment-cache/3';
export const JUDGMENT_CACHE_META = Symbol.for('jev-flow.judgment-cache-meta');

export function judgmentCacheMetadata(value) {
  return value && (typeof value === 'object' || typeof value === 'function')
    ? value[JUDGMENT_CACHE_META] || null
    : null;
}

function resultWithCallMetadata(value, metadata) {
  if (!value || typeof value !== 'object') return value;
  const copy = Array.isArray(value) ? [...value] : { ...value };
  Object.defineProperty(copy, JUDGMENT_CACHE_META, {
    value: Object.freeze({ ...metadata }), enumerable: false, configurable: false,
  });
  return copy;
}

function errorWithCallMetadata(error, metadata) {
  const wrapped = new Error(String(error?.message || error || 'judgment cache error'), { cause: error });
  wrapped.name = String(error?.name || 'Error');
  for (const key of ['code', 'status', 'statusCode', 'retryable']) {
    if (error && Object.hasOwn(error, key)) wrapped[key] = error[key];
  }
  Object.defineProperty(wrapped, JUDGMENT_CACHE_META, {
    value: Object.freeze({ ...metadata }), enumerable: false, configurable: false,
  });
  return wrapped;
}

/** JSON canônico: a ordem incidental das chaves não pode consumir outro julgamento. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function loadJudgmentCache(path = DEFAULT_JUDGMENT_CACHE_PATH) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function saveJudgmentCache(cache, path = DEFAULT_JUDGMENT_CACHE_PATH) {
  let temporary;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const bytes = JSON.stringify(cache, null, 2);
    temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    try { renameSync(temporary, path); }
    catch {
      // Cache não é autoridade; em filesystems Windows sem replace atômico,
      // uma escrita direta conservadora vale mais que perder persistência.
      writeFileSync(path, bytes);
      try { unlinkSync(temporary); } catch {}
    }
    return true;
  } catch {
    if (temporary) try { unlinkSync(temporary); } catch {}
    return false;
  } // cache best-effort: não derruba a decisão
}

export function judgmentKey({ model, state, questions, policyVersion = 'unversioned', schemaVersion = 'unversioned', evidenceHash = null, systemId = 'legacy', adapterVersion = 'legacy', purpose = 'judgment' }) {
  return createHash('sha256')
    .update(canonicalJson({
      cacheSchema: JUDGMENT_CACHE_SCHEMA,
      policyVersion,
      schemaVersion,
      systemId,
      adapterVersion,
      purpose,
      model: model || 'jev-latest',
      evidenceHash: evidenceHash || createHash('sha256').update(canonicalJson(state)).digest('hex'),
      state,
      questions,
    }))
    .digest('hex');
}

export function cacheGet(cache, key, { ttlMs = DEFAULT_TTL.curto, now = Date.now() } = {}) {
  const hit = cache[key];
  if (!hit) return null;
  if (ttlMs > 0 && now - hit.ts > ttlMs) return null; // fora da janela de frescor
  return hit.value;
}

export function cacheSet(cache, key, value, { now = Date.now() } = {}) {
  cache[key] = { ts: now, value };
}

/** Poda por idade e tamanho — evita crescimento infinito do arquivo. */
export function pruneCache(cache, { ttlMs = 24 * 60 * 60 * 1000, maxEntries = 5000, now = Date.now() } = {}) {
  let entries = Object.entries(cache).filter(([, v]) => ttlMs <= 0 || now - v.ts <= ttlMs);
  if (entries.length > maxEntries) entries = entries.sort((a, b) => b[1].ts - a[1].ts).slice(0, maxEntries);
  return Object.fromEntries(entries);
}

/**
 * Envolve um client Jev com cache transparente: `ask` consulta o cache antes
 * da rede e grava depois (só sucesso). Retorna um proxy com `.ask` e stats.
 * O client injetado continua dono do transporte (auth, retry, timeout).
 */
export function withJudgmentCache(client, {
  path = DEFAULT_JUDGMENT_CACHE_PATH,
  ttlMs = DEFAULT_TTL.curto,
  enabled = true,
  validate = null,
} = {}) {
  const cache = enabled ? loadJudgmentCache(path) : null;
  const stats = {
    hits: 0, misses: 0, coalesced: 0, invalidHits: 0, savedUsd: 0,
    transportCalls: 0, transportErrors: 0,
  };
  const inFlight = new Map();
  let dirty = false;

  const assertValid = (value, args) => {
    if (!validate) return value;
    if (validate(value, args) === false) throw new Error('invalid cached judgment');
    return value;
  };

  return {
    model: client.model,
    configured: client.configured,
    stats,
    async ask({ state, questions, model, policyVersion, schemaVersion, evidenceHash, systemId, adapterVersion, purpose } = {}) {
      const request = { state, questions, model, policyVersion, schemaVersion, evidenceHash, systemId, adapterVersion, purpose };
      const key = judgmentKey({ model: model || client.model, state, questions, policyVersion, schemaVersion, evidenceHash, systemId, adapterVersion, purpose });
      if (cache) {
        const hit = cacheGet(cache, key, { ttlMs });
        if (hit) {
          try {
            assertValid(hit, request);
            stats.hits++;
            stats.savedUsd += hit.costEstimateUsd || 0;
            return resultWithCallMetadata(hit, { cache: 'hit', transportCalled: false, owner: false });
          } catch {
            // Cache é otimização, nunca autoridade. Um registro persistido
            // adulterado ou incompatível é removido antes de consultar a rede.
            delete cache[key];
            stats.invalidHits++;
            saveJudgmentCache(pruneCache(cache), path);
          }
        }
      }
      if (inFlight.has(key)) {
        stats.coalesced++;
        try {
          const value = await inFlight.get(key);
          return resultWithCallMetadata(value, { cache: 'coalesced', transportCalled: false, owner: false });
        } catch (error) {
          throw errorWithCallMetadata(error, { cache: 'coalesced-error', transportCalled: false, owner: false });
        }
      }
      const pending = (async () => {
        stats.transportCalls++;
        try {
          const res = await client.ask({ state, questions, model });
          assertValid(res, request);
          stats.misses++;
          if (cache) {
            cacheSet(cache, key, res);
            // Persiste só sucesso: timeout/schema inválido nunca vira verdade cacheada.
            saveJudgmentCache(pruneCache(cache), path);
            dirty = false;
          }
          return res;
        } catch (error) {
          stats.transportErrors++;
          throw error;
        }
      })();
      inFlight.set(key, pending);
      try {
        const value = await pending;
        return resultWithCallMetadata(value, { cache: 'miss', transportCalled: true, owner: true });
      } catch (error) {
        throw errorWithCallMetadata(error, { cache: 'error', transportCalled: true, owner: true });
      } finally {
        inFlight.delete(key);
      }
    },
    flush() {
      if (cache && dirty) { saveJudgmentCache(pruneCache(cache), path); dirty = false; }
      return true;
    },
  };
}
