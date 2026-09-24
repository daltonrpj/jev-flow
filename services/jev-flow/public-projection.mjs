// Boundary projection for everything that leaves the Jev Flow runtime and
// reaches a browser, export or persisted history. Runtime objects remain rich;
// public objects are deliberately lossy and safe to render.
import { redactAutonomyText } from '../jev/autonomy-policy.mjs';

export const PUBLIC_REDACTION = Object.freeze({
  secret: '[REDACTED:secret-field]',
  header: '[REDACTED:header-value]',
  body: '[REDACTED:body-value]',
  url: '[REDACTED:url]',
  fixture: '[REDACTED:fixture-value]',
  input: '[REDACTED:input-value]',
  output: '[REDACTED:output-value]',
  variable: '[REDACTED:variable-value]',
  log: '[REDACTED:log-value]',
  claim: '[REDACTED:claim-value]',
  evidence: '[REDACTED:evidence-value]',
  condition: '[REDACTED:condition-value]',
  selector: '[REDACTED:selector-value]',
  rule: '[REDACTED:rule-value]',
  message: '[REDACTED:message-value]',
  event: '[REDACTED:event-value]',
});

// Treat both snake_case and camelCase extensions as sensitive. The previous
// suffix-only matcher missed `secretValue`, `tokenValue` and `passwordReset`.
const SECRET_KEY = /(?:^|_)(?:authorization|proxy_authorization|cookie|password|passwd|pwd|passphrase|credential|credencial|token|segredo|secret|api_key|access_key|access_token|refresh_token|client_secret|private_key|account_key|connection_string|sas_token|key)(?:_|$)/iu;

function normalizedKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^a-z0-9]+/giu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase();
}

function safeText(value, max = 4_000) {
  return redactAutonomyText(String(value ?? ''), max).text;
}

function redactShape(value, marker, depth = 0) {
  if (depth > 8) return marker;
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactShape(item, marker, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, child]) => [
      key,
      SECRET_KEY.test(normalizedKey(key)) ? PUBLIC_REDACTION.secret : redactShape(child, marker, depth + 1),
    ]));
  }
  return marker;
}

function safeGeneric(value, key = '', depth = 0) {
  if (depth > 10) return '[TRUNCATED:public-depth]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (SECRET_KEY.test(normalizedKey(key))) return PUBLIC_REDACTION.secret;
  if (typeof value === 'string') return safeText(value);
  if (Array.isArray(value)) return value.slice(0, 200).map(item => safeGeneric(item, '', depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 500).map(([childKey, child]) => [
      childKey,
      safeGeneric(child, childKey, depth + 1),
    ]));
  }
  return String(value);
}

function projectHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return PUBLIC_REDACTION.header;
  return Object.fromEntries(Object.keys(headers).slice(0, 100).map(key => [key, PUBLIC_REDACTION.header]));
}

function projectFixture(fixture) {
  if (!fixture || typeof fixture !== 'object') return { value: PUBLIC_REDACTION.fixture };
  const projected = {};
  if (fixture.id != null) projected.id = safeText(fixture.id, 160);
  if (fixture.name != null) projected.name = safeText(fixture.name, 240);
  if (Object.hasOwn(fixture, 'input')) projected.input = redactShape(fixture.input, PUBLIC_REDACTION.fixture);
  return projected;
}

function projectNode(node) {
  const projected = safeGeneric(node);
  if (!projected || typeof projected !== 'object' || Array.isArray(projected)) return projected;

  if (Object.hasOwn(node, 'headers')) projected.headers = projectHeaders(node.headers);
  if (Object.hasOwn(node, 'body')) projected.body = redactShape(node.body, PUBLIC_REDACTION.body);
  if (Object.hasOwn(node, 'payload')) projected.payload = redactShape(node.payload, PUBLIC_REDACTION.body);
  if (Object.hasOwn(node, 'input')) projected.input = redactShape(node.input, PUBLIC_REDACTION.input);
  if (Object.hasOwn(node, 'values')) projected.values = redactShape(node.values, PUBLIC_REDACTION.variable);
  if (Object.hasOwn(node, 'output')) projected.output = redactShape(node.output, PUBLIC_REDACTION.output);
  if (Object.hasOwn(node, 'url')) projected.url = PUBLIC_REDACTION.url;
  if (node.type === 'action.log' && Object.hasOwn(node, 'texto')) projected.texto = PUBLIC_REDACTION.log;
  if (node.type === 'flow.if' && Object.hasOwn(node, 'when')) projected.when = PUBLIC_REDACTION.condition;
  if (node.type === 'flow.switch' && Object.hasOwn(node, 'on')) projected.on = PUBLIC_REDACTION.selector;
  if (node.type === 'rule.match') {
    if (Object.hasOwn(node, 'value')) projected.value = PUBLIC_REDACTION.rule;
    if (Object.hasOwn(node, 'expected')) projected.expected = redactShape(node.expected, PUBLIC_REDACTION.rule);
    if (Object.hasOwn(node, 'pattern')) projected.pattern = PUBLIC_REDACTION.rule;
  }
  if (node.type === 'rule.extract' && Object.hasOwn(node, 'paths')) {
    projected.paths = Object.fromEntries(Object.keys(node.paths || {}).slice(0, 200).map(key => [key, PUBLIC_REDACTION.rule]));
  }
  if (node.type === 'rule.lookup') {
    if (Object.hasOwn(node, 'key')) projected.key = PUBLIC_REDACTION.rule;
    if (Object.hasOwn(node, 'table')) projected.table = redactShape(node.table, PUBLIC_REDACTION.rule);
    if (Object.hasOwn(node, 'default')) projected.default = redactShape(node.default, PUBLIC_REDACTION.rule);
  }
  if (node.type === 'context.compact' && Object.hasOwn(node, 'text')) projected.text = PUBLIC_REDACTION.input;
  if (node.type === 'context.prune') {
    if (Object.hasOwn(node, 'messages')) projected.messages = redactShape(node.messages, PUBLIC_REDACTION.message);
    if (Object.hasOwn(node, 'options')) projected.options = redactShape(node.options, PUBLIC_REDACTION.message);
  }
  if (node.type === 'jev.verify') {
    if (Object.hasOwn(node, 'claim')) projected.claim = PUBLIC_REDACTION.claim;
    if (Object.hasOwn(node, 'evidence')) projected.evidence = PUBLIC_REDACTION.evidence;
  }
  if (node.type === 'metrics.emit' && Object.hasOwn(node, 'event')) {
    projected.event = redactShape(node.event, PUBLIC_REDACTION.event);
  }

  return projected;
}

/**
 * Browser/export-safe representation of a Flow definition.
 * It preserves topology and contracts, but never exposes effect credentials,
 * request bodies, fixture values or action.log contents.
 */
export function projectFlowForPublic(flow) {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) return flow;
  const projected = safeGeneric(flow);
  projected.nodes = Object.fromEntries(Object.entries(flow.nodes || {}).map(([id, node]) => [id, projectNode(node)]));
  if (Array.isArray(flow.fixtures)) projected.fixtures = flow.fixtures.map(projectFixture);
  if (Object.hasOwn(flow, 'input')) projected.input = redactShape(flow.input, PUBLIC_REDACTION.input);
  return projected;
}

/** Provider-facing boundary: topology and contracts survive, payloads do not. */
export function projectFlowForProvider(flow) {
  const projected = projectFlowForPublic(flow);
  for (const node of Object.values(projected?.nodes || {})) {
    if (node?.type === 'note.sticky' && Object.hasOwn(node, 'texto')) {
      node.texto = PUBLIC_REDACTION.message;
    }
  }
  return projected;
}

/** Redacts arbitrary examples/state before they enter a provider prompt. */
export function projectProviderPayload(value, kind = 'input') {
  const marker = PUBLIC_REDACTION[kind] || PUBLIC_REDACTION.input;
  return redactShape(value, marker);
}

function isRedactionMarker(value) {
  return typeof value === 'string' && /^\[(?:REDACTED|TRUNCATED):[^\]]+\]$/u.test(value);
}

function restoreMarkers(projected, original) {
  if (isRedactionMarker(projected)) return structuredClone(original);
  if (Array.isArray(projected)) {
    const source = Array.isArray(original) ? original : [];
    return projected.map((item, index) => restoreMarkers(item, source[index]));
  }
  if (projected && typeof projected === 'object') {
    const source = original && typeof original === 'object' && !Array.isArray(original) ? original : {};
    return Object.fromEntries(Object.entries(projected).map(([key, child]) => [key, restoreMarkers(child, source[key])]));
  }
  return projected;
}

/**
 * Restores server-held values represented by redaction sentinels in an editor
 * draft. Omitted properties stay omitted, so deleting a field is still an
 * intentional edit; only an unchanged sentinel recovers the stored value.
 */
export function restoreRedactedFlowSecrets(projectedFlow, storedFlow) {
  if (!projectedFlow || typeof projectedFlow !== 'object' || Array.isArray(projectedFlow)) return projectedFlow;
  return restoreMarkers(projectedFlow, storedFlow || {});
}

function projectAnswers(answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return undefined;
  return Object.fromEntries(Object.entries(answers).slice(0, 100).map(([key, answer]) => {
    const confidence = Number(answer?.confidence);
    return [key, Number.isFinite(confidence) ? { confidence } : {}];
  }));
}

const PUBLIC_FACT_STATES = new Set(['true', 'false', 'unknown', 'controversial']);
const PUBLIC_EVIDENCE_STATES = new Set(['present', 'supports', 'against', 'supported', 'refuted', 'unknown', 'controversial']);

function projectLogicStates(states, allowed) {
  if (!states || typeof states !== 'object' || Array.isArray(states)) return {};
  return Object.fromEntries(Object.entries(states).slice(0, 500).map(([id, raw]) => {
    const state = String(raw ?? '').toLowerCase();
    return [safeText(id, 200), allowed.has(state) ? state : 'unknown'];
  }));
}

function projectLogicOutput(output) {
  const conclusions = Array.isArray(output?.conclusions) ? output.conclusions.map(item => ({
    id: safeText(item?.id, 200),
    state: safeText(item?.state, 40),
    rule: item?.rule == null ? null : safeText(item.rule, 200),
    priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 0,
    review: item?.review === true,
    burden: item?.burden == null ? null : safeText(item.burden, 80),
    defeatedBy: Array.isArray(item?.defeatedBy) ? item.defeatedBy.map(id => safeText(id, 200)) : [],
    conflicts: Array.isArray(item?.conflicts) ? item.conflicts.map(id => safeText(id, 200)) : [],
  })) : [];
  const conclusionById = Object.fromEntries(conclusions.map(item => [item.id, item]));
  const audit = Array.isArray(output?.audit) ? output.audit.map(entry => ({
    id: safeText(entry?.id, 200),
    condition: safeText(entry?.condition, 40),
    fired: entry?.fired === true,
    conclusion: entry?.conclusion == null ? null : safeText(entry.conclusion, 200),
    priority: Number.isFinite(Number(entry?.priority)) ? Number(entry.priority) : 0,
    review: entry?.review === true,
    defeatedBy: Array.isArray(entry?.defeatedBy) ? entry.defeatedBy.map(id => safeText(id, 200)) : [],
  })) : [];
  return {
    factStates: projectLogicStates(output?.factStates, PUBLIC_FACT_STATES),
    evidenceStates: projectLogicStates(output?.evidenceStates, PUBLIC_EVIDENCE_STATES),
    conclusions,
    conclusionById,
    audit,
    unknown: safeGeneric(Array.isArray(output?.unknown) ? output.unknown : []),
    conflicts: safeGeneric(Array.isArray(output?.conflicts) ? output.conflicts : []),
    errors: safeGeneric(Array.isArray(output?.errors) ? output.errors : []),
  };
}

function projectOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return redactShape(output, PUBLIC_REDACTION.output);
  const projected = {};
  const scalarKeys = [
    'tipo', 'status', 'ok', 'code', 'erro', 'cache', 'remoteCalled', 'measurement',
    'matched', 'operator', 'acao', 'custo_usd_estimado', 'latencia_ms', 'tokens_in', 'tokens_out',
    'veredicto', 'regra', 'existe', 'confianca', 'probabilidade', 'ruleset',
  ];
  for (const key of scalarKeys) {
    if (Object.hasOwn(output, key)) projected[key] = safeGeneric(output[key], key);
  }
  if (Object.hasOwn(output, 'thresholds')) projected.thresholds = safeGeneric(output.thresholds);
  if (Object.hasOwn(output, 'citacao')) projected.citacao = redactShape(output.citacao, PUBLIC_REDACTION.body);
  if (Object.hasOwn(output, 'redaction')) projected.redaction = safeGeneric(output.redaction);
  if (Object.hasOwn(output, 'gate')) projected.gate = safeGeneric(output.gate);
  if (Object.hasOwn(output, 'ausentes')) projected.ausentes = safeGeneric(output.ausentes);
  if (Object.hasOwn(output, 'respostas')) projected.respostas = projectAnswers(output.respostas);
  if (Object.hasOwn(output, 'valores')) projected.valores = redactShape(output.valores, PUBLIC_REDACTION.output);
  if (Object.hasOwn(output, 'valor')) projected.valor = PUBLIC_REDACTION.output;
  if (Object.hasOwn(output, 'linha')) projected.linha = PUBLIC_REDACTION.log;
  if (Object.hasOwn(output, 'url')) projected.url = PUBLIC_REDACTION.url;
  if (Object.hasOwn(output, 'body')) projected.body = redactShape(output.body, PUBLIC_REDACTION.body);
  if (Object.hasOwn(output, 'event')) projected.event = redactShape(output.event, PUBLIC_REDACTION.output);
  if (output.tipo === 'logic.subgraph' || output.tipo === 'logic.graph' || Array.isArray(output.conclusions)) {
    Object.assign(projected, projectLogicOutput(output));
  }
  return projected;
}

function projectReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  const allowed = ['source', 'costClass', 'riskClass', 'remote', 'remoteCalled', 'jev', 'generator', 'backend', 'measurement', 'ok', 'error'];
  return Object.fromEntries(allowed.filter(key => Object.hasOwn(receipt, key)).map(key => [key, safeGeneric(receipt[key], key)]));
}

/** Public/history-safe representation of a runtime receipt. */
export function projectRunForPublic(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return run;
  const outputs = Object.fromEntries(Object.entries(run.outputs || {}).map(([id, output]) => [id, projectOutput(output)]));
  const steps = Array.isArray(run.steps) ? run.steps.map(step => ({
    no: safeText(step?.no, 200),
    tipo: safeText(step?.tipo, 100),
    ok: step?.ok === true,
    erro: step?.erro == null ? null : safeText(step.erro, 300),
    ms: Number.isFinite(Number(step?.ms)) ? Number(step.ms) : 0,
    resumo: step?.ok === true ? 'concluído · valores redigidos' : safeText(step?.erro || 'falha', 300),
    receipt: projectReceipt(step?.receipt),
  })) : [];
  return {
    flow: safeText(run.flow, 200),
    flowFingerprint: safeText(run.flowFingerprint, 128),
    runId: safeText(run.runId, 200),
    status: safeText(run.status, 80),
    executado_em: safeText(run.executado_em, 80),
    input: redactShape(run.input, PUBLIC_REDACTION.input),
    steps,
    path: Array.isArray(run.path) ? run.path.map(id => safeText(id, 200)) : steps.map(step => step.no),
    outputs,
    receipts: steps.map(step => step.receipt).filter(Boolean),
    vars: redactShape(run.vars, PUBLIC_REDACTION.variable),
    abortou: run.abortou === true,
    nextNode: run.nextNode == null ? null : safeText(run.nextNode, 200),
    limits: safeGeneric(run.limits || {}),
    usage: safeGeneric(run.usage || {}),
    ok: run.ok === true,
    redaction: { applied: true, schema: 'jev-flow-public/1' },
  };
}

export function projectWebhookCallsForPublic(calls) {
  if (!Array.isArray(calls)) return [];
  return calls.map(call => ({
    method: call?.method == null ? undefined : safeText(call.method, 20),
    url: PUBLIC_REDACTION.url,
    status: Number.isFinite(Number(call?.status)) ? Number(call.status) : undefined,
    ok: call?.ok === true,
    headers: Object.hasOwn(call || {}, 'headers') ? projectHeaders(call.headers) : undefined,
    body: Object.hasOwn(call || {}, 'body') ? redactShape(call.body, PUBLIC_REDACTION.body) : undefined,
  }));
}

/**
 * JSON for a classic script context. Escaping `<` is what prevents a value
 * containing `</script>` from terminating the surrounding script element.
 */
export function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/&/gu, '\\u0026')
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}
