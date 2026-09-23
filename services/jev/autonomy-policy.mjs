// Política reutilizável do Jev Flow: fatos e autoridade ficam no código; Jev só
// classifica a zona cinzenta. A resposta Jev nunca conclui missão, amplia
// orçamento, concede permissão nem produz recompensa de RL.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { JevClient, choiceQ, isJevConfigured, noulQ, scoreQ } from './client.mjs';
import { canonicalJson, judgmentCacheMetadata, withJudgmentCache } from './cache.mjs';

export const AUTONOMY_POLICY_VERSION = 'jev-flow-autonomy-policy/1.1.0';
export const AUTONOMY_POLICY_SCHEMA = 'jev-flow-autonomy-facts/2';

export const AUTONOMY_RULES = Object.freeze({
  'AT-003': 'gate determinístico antes de qualquer juiz',
  'AT-005': 'sem prova, conclusão permanece desconhecida',
  'AT-008': 'parada do usuário vence o loop',
  'AT-013': 'fase verify preserva checkpoint e não repete executor',
  'AT-014': 'julgamento vincula política, schema, modelo e hash integral',
  'AT-015': 'timeout, baixa confiança e schema inválido permanecem unknown',
  'AT-016': 'mesma operação usa idempotência e single-flight',
  'AT-017': 'orçamento é reservado e limitado pelo código',
  'AT-018': 'aprendizado só vira regra após replay e regressão',
  'AT-019': 'autoridade e campos proibidos são decididos pelo código',
  'AT-020': 'owner e generation impedem commit tardio',
  'AT-021': 'verificação vincula fingerprint atual do workspace',
  'AT-022': 'prompts carregam receipt compacto e apenas o delta',
  'AT-023': 'ambiguidades compatíveis são julgadas em um único batch Jev',
  'AT-024': 'RL recebe recompensa somente de evidência interna confiável',
  'AT-025': 'indisponibilidade do revisor preserva execução e checkpoint',
  'VF-011': 'aceite forte exige holdout externo ao executor',
  'VF-012': 'receipt liga job, geração, contrato, casos e fingerprint',
  'VF-013': 'testes criados pelo executor são desenvolvimento, não aceite forte',
  'VF-014': 'aprovação perde validade se o workspace mudar',
  'MC-021': 'done exige receipt fresco ligado a sessão, run e observação',
  'SS-011': 'resume continua da fase persistida',
  'SS-012': 'retomada de verify não consome novo orçamento de execução',
});

const STRATEGIES = new Set(['direct', 'inspect-first', 'repair-first']);
const REPAIR_PATTERN = /\b(?:bug|corrij|correç|consert|falh|erro|fix|regress|quebr|crash|defeito)\w*/iu;
const BUILD_PATTERN = /\b(?:implement|cri|adicion|constru|desenvolv|integra|refator|migr|projet|build|feature)\w*/iu;
const FORBIDDEN_AUTHORITY_FIELDS = Object.freeze([
  'acceptanceArtifacts', 'acceptanceManifest', 'acceptanceAuthority', 'acceptanceHash',
  'trustedAcceptanceManifest', 'trustedAcceptanceAuthority', 'trustedAcceptanceHash',
]);

const clip = (value, max) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');

/**
 * Redação conservadora antes de qualquer egress para o provider JEV.
 * O hash integral usado na identidade/cache permanece fora do state enviado;
 * o provider recebe apenas texto sanitizado e metadados não reversíveis.
 */
export function redactAutonomyText(value, max = 1600) {
  // normalizeAutonomyFacts já limita cada campo a no máximo 12 KiB. Redigir o
  // valor inteiro antes do corte remoto impede que uma credencial ou uma chave
  // sem marcador END seja truncada para dentro do payload em claro.
  const original = String(value ?? '').replace(/\0/gu, '').slice(0, 12_000);
  let text = original;
  const categories = new Set();
  const replace = (pattern, replacement, category) => {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      categories.add(category);
      pattern.lastIndex = 0;
      text = text.replace(pattern, replacement);
    }
  };
  replace(/-----BEGIN [^-\r\n]{0,80}PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]{0,80}PRIVATE KEY-----/giu, '[REDACTED:private-key]', 'private-key');
  replace(/-----BEGIN [^-\r\n]{0,80}PRIVATE KEY-----[\s\S]*$/giu, '[REDACTED:private-key]', 'private-key');
  replace(/\b(?:authorization|proxy-authorization)\s*:\s*(?:(?:bearer|basic)\s+)?[^\s,;]+/giu, '[REDACTED:authorization]', 'authorization');
  replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, '[REDACTED:bearer]', 'authorization');
  replace(/\b(?:senha|password|passwd|pwd|passphrase|credential|credencial|token|segredo|secret|chave|key|api[_ -]?key|access[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|account[_ -]?key|connection[_ -]?string|sas[_ -]?token)\b\s+(?:is|was|equals?|é|e|era|vale)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'`,;]+)/giu, '[REDACTED:secret-value]', 'secret-value');
  replace(/\b(?:senha|password|passwd|pwd|passphrase|credential|credencial|token|segredo|secret|chave|key|api[_ -]?key|access[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|account[_ -]?key|connection[_ -]?string|sas[_ -]?token|aws[_ -]?(?:access[_ -]?key[_ -]?id|secret[_ -]?access[_ -]?key|session[_ -]?token))\b\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'`,;]+)/giu, '[REDACTED:secret-value]', 'secret-value');
  replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gu, '[REDACTED:env-value]', 'env-value');
  replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s\/@:]+):([^\s\/@]+)@/giu, '$1[REDACTED:url-credentials]@', 'url-credentials');
  replace(/([?&](?:token|key|api[_-]?key|access[_-]?token|password|secret)=)[^&#\s]+/giu, '$1[REDACTED]', 'url-secret-query');
  replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED:jwt]', 'token');
  replace(/\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/gu, '[REDACTED:aws-access-key]', 'aws-credential');
  replace(/\bAIza[A-Za-z0-9_-]{35}\b/gu, '[REDACTED:google-api-key]', 'google-credential');
  replace(/\bya29\.[A-Za-z0-9._-]{16,}\b/gu, '[REDACTED:google-oauth-token]', 'google-credential');
  replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/gu, '[REDACTED:stripe-key]', 'stripe-credential');
  replace(/\b(?:sk-proj[-_]|sk-ant-api\d{2}[-_]|hf_|npm_)[A-Za-z0-9_-]{16,}\b/giu, '[REDACTED:provider-token]', 'token');
  replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/giu, '[REDACTED:token]', 'token');
  replace(/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/gu, '[REDACTED:sendgrid-key]', 'token');
  replace(/\bSK[0-9a-f]{32}\b/giu, '[REDACTED:twilio-key]', 'token');
  replace(/(["'])(?:[A-Za-z]:[\\/]|\/(?:home|Users|var|etc|opt|srv|root|tmp|mnt|Volumes|workspace|workspaces)\/)[^"'\r\n]+\1/gu, '[REDACTED:absolute-path]', 'absolute-path');
  // Paths Windows/UNC sem aspas podem conter espaços. Consumir
  // conservadoramente até pontuação forte/fim evita expor o sufixo do path.
  replace(/\\\\[A-Za-z0-9._-]+\\[^"'<>|,;\r\n]+/gu, '[REDACTED:absolute-path]', 'absolute-path');
  replace(/\b[A-Za-z]:[\\/][^"'<>|,;\r\n]+/gu, '[REDACTED:absolute-path]', 'absolute-path');
  replace(/\/(?:home|Users|var|etc|opt|srv|root|tmp|mnt|Volumes|workspace|workspaces)\/[^"'`<>?,;\r\n]+/gu, '[REDACTED:absolute-path]', 'absolute-path');
  replace(/(^|[\s("'=,:])\/(?!\/)[A-Za-z0-9._-]+(?:\/[^"'`<>?,;:\r\n]+)+/gu, '$1[REDACTED:absolute-path]', 'absolute-path');
  replace(/\b(?=[A-Za-z0-9_./+=-]{24,}\b)(?=[A-Za-z0-9_./+=-]*[A-Za-z])(?=[A-Za-z0-9_./+=-]*\d)[A-Za-z0-9_./+=-]+\b/gu, '[REDACTED:opaque-value]', 'opaque-value');
  const outbound = clip(text, max);
  const useful = outbound.replace(/\[REDACTED:[^\]]+\]/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');
  return {
    text: outbound,
    redacted: categories.size > 0,
    categories: [...categories].sort(),
    originalLength: original.length,
    remoteSafe: categories.size === 0 || useful.length >= 12,
  };
}

/**
 * Redação estrutural compartilhada para qualquer state que vá ao Jev.
 * Preserva chaves/schema, redige valores e devolve o hash do state integral
 * apenas como identidade não reversível para cache/evidência.
 */
export function redactRemoteState(value, {
  maxChars = 60_000,
  maxStringChars = 12_000,
  maxEntries = 512,
  maxDepth = 8,
} = {}) {
  const categories = new Set();
  let entries = 0;
  let truncated = false;
  const sensitiveKeys = new Set([
    'authorization', 'proxyauthorization', 'password', 'passwd', 'pwd',
    'passphrase', 'credential', 'credencial', 'token', 'segredo', 'secret',
    'key', 'chave', 'apikey', 'accesskey', 'accesstoken', 'refreshtoken',
    'clientsecret', 'accountkey', 'connectionstring', 'sastoken',
  ]);
  const isSensitiveKey = (key) => {
    const normalized = String(key || '').replace(/[^a-z0-9]/giu, '').toLowerCase();
    return sensitiveKeys.has(normalized)
      || /(?:password|passwd|passphrase|credential|token|secret|apikey|accesskey|accountkey|connectionstring)$/u.test(normalized);
  };
  const visit = (current, key = '', depth = 0) => {
    entries++;
    if (entries > maxEntries || depth > maxDepth) {
      truncated = true;
      return '[TRUNCATED:remote-state-limit]';
    }
    if (key && isSensitiveKey(key) && current != null) {
      categories.add('secret-field');
      return '[REDACTED:secret-field]';
    }
    if (typeof current === 'string') {
      const redaction = redactAutonomyText(current, maxStringChars);
      for (const category of redaction.categories || []) categories.add(category);
      return redaction.text;
    }
    if (Array.isArray(current)) return current.map(item => visit(item, '', depth + 1));
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).map(([childKey, child]) => [childKey, visit(child, childKey, depth + 1)]));
    }
    return current;
  };
  const state = visit(value);
  const serialized = canonicalJson(state);
  const valuesOnly = serialized
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"\s*:/gu, '')
    .replace(/\[(?:REDACTED|TRUNCATED):[^\]]+\]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const tooLarge = serialized.length > maxChars;
  return {
    state,
    redacted: categories.size > 0,
    categories: [...categories].sort(),
    remoteSafe: !tooLarge && !truncated && (categories.size === 0 ? serialized.length > 2 : valuesOnly.length >= 12),
    tooLarge,
    truncated,
    outboundChars: serialized.length,
    originalHash: hash(value),
  };
}

function enumValue(value, allowed, fallback = 'unknown') {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

export function normalizeAutonomyFacts(input = {}) {
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const budget = input.budget && typeof input.budget === 'object' ? input.budget : {};
  const checkpoint = input.checkpoint && typeof input.checkpoint === 'object' ? input.checkpoint : {};
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  return {
    systemId: clip(input.systemId || 'legacy', 80) || 'legacy',
    adapterVersion: clip(input.adapterVersion || 'autonomy-policy/legacy', 80) || 'autonomy-policy/legacy',
    purpose: clip(input.purpose || 'route-strategy', 80) || 'route-strategy',
    domain: enumValue(input.domain, ['code', 'computer', 'generic'], 'generic'),
    stage: enumValue(input.stage, ['route', 'completion'], 'route'),
    phase: enumValue(input.phase, ['execute', 'verify'], 'execute'),
    request: clip(input.request, 12_000),
    authorized: input.authorized === true,
    userStopped: input.userStopped === true,
    forbiddenAuthority: input.forbiddenAuthority === true
      || FORBIDDEN_AUTHORITY_FIELDS.some(field => Object.hasOwn(payload, field)),
    budget: {
      used: Math.max(0, Number(budget.used) || 0),
      limit: Number.isFinite(Number(budget.limit)) ? Math.max(0, Number(budget.limit)) : null,
      reserved: Math.max(0, Number(budget.reserved) || 0),
    },
    checkpoint: {
      exists: checkpoint.exists === true,
      generationCurrent: checkpoint.generationCurrent !== false,
      ownerCurrent: checkpoint.ownerCurrent !== false,
    },
    taskType: enumValue(input.taskType, ['repair', 'build', 'tiny', 'unknown']),
    scope: {
      files: Number.isSafeInteger(input.scope?.files) ? Math.max(0, input.scope.files) : null,
      risk: enumValue(input.scope?.risk, ['low', 'medium', 'high']),
    },
    contextDelta: clip(input.contextDelta, 8_000),
    failureText: clip(input.failureText, 4_000),
    evidence: {
      developmentTests: enumValue(evidence.developmentTests, ['passed', 'failed', 'unknown']),
      trustedHoldout: enumValue(evidence.trustedHoldout, ['passed', 'failed', 'missing', 'unavailable', 'unknown']),
      reviewer: enumValue(evidence.reviewer, ['approved', 'rejected', 'unavailable', 'unknown']),
      fingerprint: enumValue(evidence.fingerprint, ['stable', 'changed', 'unknown']),
      completionReceipt: enumValue(evidence.completionReceipt, ['valid', 'invalid', 'missing', 'unknown']),
    },
  };
}

function decision(facts, values) {
  return {
    policyVersion: AUTONOMY_POLICY_VERSION,
    schemaVersion: AUTONOMY_POLICY_SCHEMA,
    domain: facts.domain,
    route: values.route,
    strategy: values.strategy || null,
    completion: values.completion || 'pending',
    reward: values.reward ?? null,
    source: values.source || 'deterministic',
    certainty: values.certainty || 'certain',
    ruleIds: [...new Set(['AT-003', ...(values.ruleIds || [])])],
    needsJev: values.needsJev === true,
    includeContext: values.includeContext !== false,
    contextBudget: values.contextBudget || 2200,
    advisory: values.advisory || null,
    reasonCode: values.reasonCode || null,
    evidenceHash: hash(facts),
  };
}

/** Retorna null somente para estratégia realmente ambígua em phase=execute. */
export function deterministicAutonomyDecision(input = {}) {
  const facts = normalizeAutonomyFacts(input);
  if (facts.userStopped) return decision(facts, { route: 'stop', completion: 'stopped', ruleIds: ['AT-008'], reasonCode: 'USER_STOPPED' });
  if (!facts.authorized || facts.forbiddenAuthority) return decision(facts, {
    route: 'block', completion: 'blocked', ruleIds: ['AT-019'], reasonCode: facts.forbiddenAuthority ? 'FORBIDDEN_AUTHORITY_INPUT' : 'AUTH_REQUIRED',
  });
  if (facts.budget.limit !== null && facts.budget.used + facts.budget.reserved >= facts.budget.limit) return decision(facts, {
    route: 'block', completion: 'blocked', ruleIds: ['AT-001', 'AT-017'], reasonCode: 'BUDGET_EXHAUSTED',
  });
  if (!facts.checkpoint.generationCurrent || !facts.checkpoint.ownerCurrent) return decision(facts, {
    route: 'defer', completion: 'unknown', ruleIds: ['AT-020'], reasonCode: 'STALE_OWNER_OR_GENERATION',
  });

  if (facts.stage === 'completion') {
    if (facts.domain === 'computer') {
      if (facts.evidence.completionReceipt === 'valid') return decision(facts, {
        route: 'complete', completion: 'verified', reward: null, ruleIds: ['MC-010', 'MC-021'], reasonCode: 'FRESH_RECEIPT_VALID',
      });
      return decision(facts, {
        route: 'verify', completion: 'unknown', ruleIds: ['AT-005', 'MC-010', 'MC-021'], reasonCode: 'FRESH_RECEIPT_REQUIRED',
      });
    }
    if (facts.evidence.developmentTests === 'failed') return decision(facts, {
      route: 'repair', strategy: 'repair-first', completion: 'failed', reward: null, ruleIds: ['VF-013'], reasonCode: 'DEVELOPMENT_TESTS_FAILED',
    });
    if (facts.evidence.fingerprint === 'changed') return decision(facts, {
      route: 'verify', completion: 'unknown', reward: null, ruleIds: ['AT-021', 'VF-014'], reasonCode: 'WORKSPACE_CHANGED',
    });
    if (facts.evidence.developmentTests !== 'passed') return decision(facts, {
      route: 'verify', completion: 'unknown', ruleIds: ['AT-005', 'VF-013'], reasonCode: 'DEVELOPMENT_TESTS_REQUIRED',
    });
    if (facts.evidence.trustedHoldout === 'failed') return decision(facts, {
      route: 'repair', strategy: 'repair-first', completion: 'failed', reward: -1, ruleIds: ['VF-011', 'VF-012', 'AT-024'], reasonCode: 'TRUSTED_HOLDOUT_FAILED',
    });
    if (['missing', 'unavailable', 'unknown'].includes(facts.evidence.trustedHoldout)) return decision(facts, {
      route: 'defer', completion: 'unknown', reward: null, ruleIds: ['AT-005', 'AT-015', 'VF-011'], reasonCode: 'TRUSTED_HOLDOUT_REQUIRED',
    });
    if (facts.evidence.fingerprint !== 'stable') return decision(facts, {
      route: 'verify', completion: 'unknown', reward: null, ruleIds: ['AT-021', 'VF-014'], reasonCode: 'FINGERPRINT_REQUIRED',
    });
    if (facts.evidence.reviewer === 'unavailable' || facts.evidence.reviewer === 'unknown') return decision(facts, {
      route: 'defer', completion: 'unknown', reward: null, ruleIds: ['AT-013', 'AT-015', 'AT-025', 'SS-011', 'SS-012'], reasonCode: 'REVIEW_PENDING',
    });
    if (facts.evidence.reviewer === 'rejected') return decision(facts, {
      route: 'repair', strategy: 'repair-first', completion: 'failed', reward: null, ruleIds: ['AT-024'], reasonCode: 'REVIEW_REJECTED',
    });
    return decision(facts, {
      route: 'complete', completion: 'verified', reward: 1, ruleIds: ['VF-011', 'VF-012', 'VF-014', 'AT-024'], reasonCode: 'TRUSTED_ACCEPTANCE_COMPLETE',
    });
  }

  if (facts.phase === 'verify' && facts.checkpoint.exists) return decision(facts, {
    route: 'verify', completion: 'pending', ruleIds: ['AT-013', 'SS-005', 'SS-011', 'SS-012'], reasonCode: 'RESUME_VERIFY_CHECKPOINT',
  });
  if (facts.taskType === 'repair' || REPAIR_PATTERN.test(facts.request) || facts.failureText) return decision(facts, {
    route: 'execute', strategy: 'repair-first', ruleIds: ['DB-001', 'AT-022'], reasonCode: 'REPAIR_SIGNAL',
  });
  if (facts.taskType === 'tiny' && facts.scope.files === 1 && facts.scope.risk === 'low') return decision(facts, {
    route: 'execute', strategy: 'direct', ruleIds: ['AT-022'], reasonCode: 'BOUNDED_TINY_CHANGE', contextBudget: 1200,
  });
  if (facts.taskType === 'build' || BUILD_PATTERN.test(facts.request)) return decision(facts, {
    route: 'execute', strategy: 'inspect-first', ruleIds: ['CD-001', 'AT-022'], reasonCode: 'BUILD_SIGNAL',
  });
  return decision(facts, {
    route: 'execute', strategy: 'inspect-first', source: 'conservative', certainty: 'unknown',
    needsJev: true, ruleIds: ['AT-015', 'AT-023'], reasonCode: 'AMBIGUOUS_STRATEGY',
  });
}

export function compactPolicyState(input = {}) {
  const facts = normalizeAutonomyFacts(input);
  const request = redactAutonomyText(facts.request, 1600);
  const delta = redactAutonomyText(facts.contextDelta, 1200);
  const failure = redactAutonomyText(facts.failureText, 800);
  const redactions = [...new Set([...request.categories, ...delta.categories, ...failure.categories])].sort();
  return {
    systemId: facts.systemId,
    adapterVersion: facts.adapterVersion,
    purpose: facts.purpose,
    d: facts.domain,
    p: facts.phase,
    q: request.text,
    tt: facts.taskType,
    sc: facts.scope,
    delta: delta.text,
    failure: failure.text,
    privacy: {
      redacted: redactions.length > 0,
      categories: redactions,
      remoteSafe: request.remoteSafe && delta.remoteSafe && failure.remoteSafe,
      lengths: { request: request.originalLength, delta: delta.originalLength, failure: failure.originalLength },
    },
  };
}

function readChoice(answer, fallback, allowed = STRATEGIES) {
  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  const selected = String(answer?.choice || '');
  const probabilities = answer?.probabilities && typeof answer.probabilities === 'object'
    ? Object.values(answer.probabilities).map(Number)
    : [];
  const probability = Number(answer?.probabilities?.[selected]);
  const confidence = Number(answer?.confidence);
  const ordered = probabilities.filter(Number.isFinite).sort((a, b) => b - a);
  const sum = probabilities.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  const valid = allowedSet.has(selected)
    && probabilities.length === allowedSet.size
    && Math.abs(sum - 1) <= 0.02
    && probability >= 0.8
    && confidence >= 0.8
    && probability - (ordered[1] ?? 0) >= 0.2;
  return { choice: valid ? selected : fallback, valid };
}

function readScore(answer, levels, fallback = null) {
  const score = Number(answer?.score);
  const selected = Number.isInteger(score) ? String(score) : '';
  const probabilities = answer?.probabilities && typeof answer.probabilities === 'object'
    ? Object.values(answer.probabilities).map(Number)
    : [];
  const probability = Number(answer?.probabilities?.[selected]);
  const confidence = Number(answer?.confidence);
  const ordered = probabilities.filter(Number.isFinite).sort((a, b) => b - a);
  const valid = validScoreAnswer(answer, levels)
    && Number.isInteger(score)
    && probability >= 0.8
    && confidence >= 0.8
    && probability - (ordered[1] ?? 0) >= 0.2;
  return { score: valid ? score : fallback, valid };
}

function validProbabilityMap(value, options) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== options.length || keys.some((key, index) => key !== [...options].sort()[index])) return false;
  const probabilities = keys.map(key => value[key]);
  return probabilities.every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)
    && Math.abs(probabilities.reduce((total, item) => total + item, 0) - 1) <= 0.02;
}

function validScoreAnswer(answer, levels) {
  if (!answer || !Array.isArray(levels) || levels.length < 2) return false;
  const keys = levels.map((_, index) => String(index));
  const legend = answer.legend;
  if (!legend || typeof legend !== 'object' || Array.isArray(legend)) return false;
  if (Object.keys(legend).sort().join('|') !== [...keys].sort().join('|')) return false;
  if (keys.some((key, index) => legend[key] !== levels[index])) return false;
  return typeof answer.score === 'number' && Number.isFinite(answer.score)
    && answer.score >= 0 && answer.score <= levels.length - 1
    && typeof answer.confidence === 'number' && Number.isFinite(answer.confidence)
    && answer.confidence >= 0 && answer.confidence <= 1
    && validProbabilityMap(answer.probabilities, keys);
}

function validateJevResponse(response, args = {}) {
  const answers = response?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('invalid Jev answer schema');
  if (!answers.strategy || !STRATEGIES.has(answers.strategy.choice)
      || !validProbabilityMap(answers.strategy.probabilities, [...STRATEGIES])
      || typeof answers.strategy.confidence !== 'number' || !Number.isFinite(answers.strategy.confidence)
      || answers.strategy.confidence < 0 || answers.strategy.confidence > 1) {
    throw new Error('invalid Jev strategy answer');
  }
  if (!validScoreAnswer(answers.complexity, args.questions?.complexity?.criteria)) {
    throw new Error('invalid Jev complexity answer');
  }
  if (args.questions?.context_relevant && (typeof answers.context_relevant?.noul !== 'number'
      || !Number.isFinite(answers.context_relevant.noul) || answers.context_relevant.noul < 0 || answers.context_relevant.noul > 1)) {
    throw new Error('invalid Jev relevance answer');
  }
  if (args.questions?.failure_kind && (!['semantic', 'infrastructure', 'unknown'].includes(answers.failure_kind?.choice)
      || !validProbabilityMap(answers.failure_kind?.probabilities, ['semantic', 'infrastructure', 'unknown'])
      || typeof answers.failure_kind?.confidence !== 'number' || !Number.isFinite(answers.failure_kind.confidence)
      || answers.failure_kind.confidence < 0 || answers.failure_kind.confidence > 1)) {
    throw new Error('invalid Jev failure answer');
  }
  return true;
}

export function createAutonomyPolicy({ jevClient = null, cachePath = null, ttlMs = 6 * 60 * 60 * 1000 } = {}) {
  const cached = jevClient ? withJudgmentCache(jevClient, {
    path: cachePath || join(process.cwd(), 'data', 'jev', 'autonomy-policy-cache.json'), ttlMs,
    validate: validateJevResponse,
  }) : null;

  async function decide(input = {}) {
    const base = deterministicAutonomyDecision(input);
    if (!base.needsJev) return { ...base, receipt: compactPolicyReceipt(base), jev: { called: false, cache: 'none' } };
    if (!cached) {
      const fallback = { ...base, needsJev: false, source: 'conservative', certainty: 'unknown', reasonCode: 'JEV_UNAVAILABLE' };
      return { ...fallback, receipt: compactPolicyReceipt(fallback), jev: { called: false, cache: 'unavailable' } };
    }

    const state = compactPolicyState(input);
    if (state.privacy.redacted && !state.privacy.remoteSafe) {
      const fallback = { ...base, needsJev: false, source: 'conservative', certainty: 'unknown', reasonCode: 'JEV_SENSITIVE_STATE_REDACTED' };
      return { ...fallback, receipt: compactPolicyReceipt(fallback), jev: { called: false, cache: 'sensitive', redacted: true, redactions: state.privacy.categories } };
    }
    const questions = {
      strategy: choiceQ('Escolha a menor estratégia segura para executar a tarefa; isto não concede autorização nem confirma sucesso.', {
        direct: 'mudança local, explícita e de baixo risco',
        'inspect-first': 'é preciso ler contratos, arquivos ou testes antes de editar',
        'repair-first': 'há falha concreta a reproduzir antes de corrigir',
      }),
      complexity: scoreQ('Estime apenas o volume de contexto útil para orientar a execução.', ['pequeno', 'médio', 'grande']),
    };
    // O contrato do gateway limita cada julgamento a no máximo três perguntas.
    // Falha observada tem precedência sobre relevância de contexto, pois orienta
    // o fallback de reparo sem ampliar autoridade.
    if (state.failure) questions.failure_kind = choiceQ('Classifique a falha somente para priorização; preserve unknown quando a evidência não bastar.', {
      semantic: 'defeito reproduzível no artefato ou requisito',
      infrastructure: 'indisponibilidade externa, rede, credencial ou runtime',
      unknown: 'evidência insuficiente',
    });
    else if (state.delta) questions.context_relevant = noulQ('O delta de contexto fornecido é diretamente relevante para a próxima ação?');

    try {
      const response = await cached.ask({
        state,
        questions,
        policyVersion: AUTONOMY_POLICY_VERSION,
        schemaVersion: AUTONOMY_POLICY_SCHEMA,
        evidenceHash: base.evidenceHash,
        systemId: state.systemId,
        adapterVersion: state.adapterVersion,
        purpose: state.purpose,
      });
      const callMetadata = judgmentCacheMetadata(response) || { cache: 'miss', transportCalled: true };
      const answers = response.answers;
      const strategyAnswer = readChoice(answers.strategy, base.strategy);
      const strategy = strategyAnswer.choice;
      const relevance = Number(answers.context_relevant?.noul);
      const complexityAnswer = readScore(answers.complexity, questions.complexity.criteria);
      const includeContext = Number.isFinite(relevance) && relevance >= 0 && relevance <= 1 ? relevance >= 0.5 : true;
      const contextBudget = complexityAnswer.valid
        ? [1200, 2200, 3600][complexityAnswer.score]
        : base.contextBudget;
      const failureAnswer = questions.failure_kind
        ? readChoice(answers.failure_kind, 'unknown', ['semantic', 'infrastructure', 'unknown'])
        : { choice: 'unknown', valid: false };
      const cache = callMetadata.cache;
      const result = {
        ...base,
        strategy,
        source: strategyAnswer.valid ? cache === 'hit' ? 'cache' : 'jev' : 'conservative',
        certainty: strategyAnswer.valid ? 'bounded-judgment' : 'unknown',
        needsJev: false,
        includeContext,
        contextBudget,
        advisory: {
          failureKind: failureAnswer.valid ? failureAnswer.choice : 'unknown',
        },
        ruleIds: [...new Set([...base.ruleIds, 'AT-014', 'AT-023'])],
      };
      return { ...result, receipt: compactPolicyReceipt(result), jev: { called: callMetadata.transportCalled === true, cache, redacted: state.privacy.redacted, redactions: state.privacy.categories } };
    } catch (error) {
      const callMetadata = judgmentCacheMetadata(error) || { cache: 'error', transportCalled: true };
      const fallback = { ...base, needsJev: false, source: 'conservative', certainty: 'unknown', reasonCode: 'JEV_INVALID_OR_UNAVAILABLE' };
      return {
        ...fallback,
        receipt: compactPolicyReceipt(fallback),
        jev: { called: callMetadata.transportCalled === true, cache: callMetadata.cache, code: clip(error?.code || error?.name, 80) || 'JEV_ERROR', redacted: state.privacy.redacted, redactions: state.privacy.categories },
      };
    }
  }
  return { decide, stats: cached?.stats || { hits: 0, misses: 0, coalesced: 0, invalidHits: 0, savedUsd: 0, transportCalls: 0, transportErrors: 0 } };
}

export function createDefaultAutonomyPolicy({ storageDir = process.cwd() } = {}) {
  const jevClient = isJevConfigured() ? new JevClient({ timeoutMs: 2500, maxRetries: 0 }) : null;
  return createAutonomyPolicy({ jevClient, cachePath: join(storageDir, 'autonomy-policy-cache.json') });
}

export function compactPolicyReceipt(value = {}) {
  return JSON.stringify({
    p: value.policyVersion || AUTONOMY_POLICY_VERSION,
    r: value.route || 'defer',
    s: value.strategy || undefined,
    src: value.source || 'deterministic',
    rules: (value.ruleIds || []).slice(0, 12),
    ev: String(value.evidenceHash || '').slice(0, 16),
  });
}

export function compactVerificationDelta(value = {}, maxChars = 2200) {
  const failedChecks = (value.checks || []).filter(item => item?.passed !== true).slice(0, 8).map(item => ({
    path: clip(item.path, 240), error: clip(item.error, 300) || null,
  }));
  const delta = {
    code: clip(value.code, 100) || null,
    outcome: clip(value.outcome, 60) || null,
    assurance: clip(value.assurance, 100) || null,
    reason: clip(value.reason || value.feedback, 700) || null,
    tests: {
      total: Number.isSafeInteger(value.testCount) ? value.testCount : null,
      passed: Number.isSafeInteger(value.passCount) ? value.passCount : null,
      failures: Number.isSafeInteger(value.failures) ? value.failures : null,
    },
    failedChecks,
    fingerprint: /^[a-f0-9]{64}$/iu.test(value.workspaceHash || '') ? value.workspaceHash : null,
    receipt: /^[a-f0-9]{64}$/iu.test(value.hash || '') ? value.hash : null,
  };
  return JSON.stringify(delta).slice(0, Math.max(300, maxChars));
}

export function buildCompactCodingPrompt({ task, policy, requiredFiles = [], previousVerification = null } = {}) {
  const strategy = policy?.strategy || 'inspect-first';
  const instruction = {
    direct: 'Faça a menor alteração verificável e rode os testes.',
    'inspect-first': 'Leia contratos e testes relevantes, defina pós-condições observáveis e só então edite.',
    'repair-first': 'Reproduza a falha, isole a causa, corrija e reteste o caso original e as regressões.',
  }[strategy];
  const parts = [
    clip(task, 12_000),
    `POLICY_RECEIPT:${policy?.receipt || compactPolicyReceipt(policy)}`,
    `ACTION:${instruction}`,
    'VERIFY: crie/rode testes de desenvolvimento que exerçam os requisitos; zero testes ou testes ignorados não concluem a missão.',
    `ACCEPT:${JSON.stringify((requiredFiles || []).slice(0, 50))}`,
  ];
  if (previousVerification) parts.push(`REPAIR_DELTA:${compactVerificationDelta(previousVerification, policy?.contextBudget || 2200)}`);
  return parts.join('\n');
}
