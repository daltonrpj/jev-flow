// ============================================================================
// Jev Flow — orquestração visual onde os NÓS são julgamentos Jev.
//
// Um flow é um grafo acíclico declarativo (JSON): gatilho manual/cron/agent
// dispara, nós `jev.ask` (perguntas inline) ou `jev.jevlet` (catálogo do
// Forge) julgam, `flow.if`/`flow.switch` roteiam PELO RESULTADO TIPADO
// (choice/noul/score/política), e nós de ação executam (webhook/log/vars).
// Expressões `{{caminho}}` interpolam o contexto — sem eval, sem código
// arbitrário: a regra É o JSON, o motor É este arquivo.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, rmSync, renameSync } from 'node:fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JevClient, JEV_DATA_DIR, noulQ, choiceQ, scoreQ } from '../jev/client.mjs';
import { canonicalJson, judgmentCacheMetadata, withJudgmentCache } from '../jev/cache.mjs';
import { invokeJevlet, FORGE_DIR as JEVLET_DIR } from '../jev-forge/forge.mjs';
import { redactRemoteState, redactAutonomyText } from '../jev/autonomy-policy.mjs';
import { inspectUrlPolicy } from '../security/url-policy.mjs';
import { createSafeDnsDispatcher } from './safe-dns-dispatcher.mjs';
import { executeDeterministicSkill as executeRegisteredSkill, pruneMessages } from './local-adapters.mjs';
import { verifyClaim, gateResult } from '../jev/verify.mjs';
import { getNodeDefinition, normalizeNodeType, NODE_TYPES as CATALOG_NODE_TYPES, validateNodeContract } from './node-catalog.mjs';
import { evaluateReasoningGraph } from './reasoning-graph.mjs';
import { projectRunForPublic } from './public-projection.mjs';
import { loadRuleset, buildFindRequest, verdictFromAnswers } from './ruleset.mjs';
import * as scheduler from './scheduler.mjs';

export const FLOWS_DIR = join(JEV_DATA_DIR, 'flows');
export const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'examples');
const ROOT_EXAMPLES_DIR = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'examples');
function shippedExamplePaths(id) {
  return [join(EXAMPLES_DIR, `${id}.flow.json`), join(ROOT_EXAMPLES_DIR, `${id}.flow.json`)];
}

export const NODE_TYPES = new Set(CATALOG_NODE_TYPES);

export class FlowError extends Error {
  constructor(message, code) { super(message); this.name = 'FlowError'; this.code = code; }
}

const ID_RE = /^[a-z][a-z0-9_-]{2,40}$/;
const PATH_PATTERN = String.raw`[A-Za-z_][\w-]*(?:\.[\w-]+)*`;
const EXPR_RE = new RegExp(String.raw`\{\{\s*(${PATH_PATTERN})\s*\}\}`, 'g');
const EXACT_EXPR_RE = new RegExp(String.raw`^\{\{\s*(${PATH_PATTERN})\s*\}\}$`);
// One comparison with one scalar. Compound expressions must use explicit
// flow.if nodes so the validator cannot silently interpret a tail as a string.
const WHEN_VALUE_PATTERN = String.raw`(?:true|false|null|-?(?:\d+\.?\d*|\.\d+)|"[^"]*"|'[^']*'|[A-Za-z_][\w-]*)`;
const WHEN_RE = new RegExp(String.raw`^\{\{\s*(${PATH_PATTERN})\s*\}\}\s*(==|!=|>=|<=|>|<)\s*(${WHEN_VALUE_PATTERN})$`);
const MAX_NODES = 25;
const MAX_STEPS = 25;
const MAX_JEV_CALLS = 25;
const MAX_INPUT_TOKENS = 250_000;
const DEFAULT_MAX_INPUT_TOKENS = 80_000;
const RESUMABLE_STATUSES = new Set(['running', 'paused']);
const FLOW_CHECKPOINT_SCHEMA = 'jev-flow-checkpoint/2';
const FLOW_CHECKPOINT_ENVELOPE_SCHEMA = 'jev-flow-checkpoint-encrypted/1';
const FLOW_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const FLOW_LIMITS = Object.freeze({
  hard: Object.freeze({ maxSteps: MAX_STEPS, maxJevCalls: MAX_JEV_CALLS, maxInputTokens: MAX_INPUT_TOKENS }),
  defaults: Object.freeze({ maxSteps: MAX_STEPS, maxJevCalls: MAX_JEV_CALLS, maxInputTokens: DEFAULT_MAX_INPUT_TOKENS }),
});

export function isFlowId(value) { return ID_RE.test(String(value || '')); }

function assertFlowId(value) {
  if (!isFlowId(value)) throw new FlowError(`id de flow inválido: ${value}`, 'ID_INVALIDO');
  return String(value);
}

function authorizedIfExpression(expression, verifySources) {
  const text = String(expression || '').replace(/\s+/gu, '').toLowerCase();
  return [...verifySources].some(id => [
    `{{${id}.gate.pass}}==true`,
    `{{${id}.gate.exitcode}}==0`,
    `{{${id}.verification.veredito}}==suportada`,
    `{{${id}.verification.veredito}}=="suportada"`,
    `{{${id}.verification.veredito}}=='suportada'`,
  ].includes(text));
}

function verifiedSwitchSelector(expression, verifySources) {
  const text = String(expression || '').replace(/\s+/gu, '').toLowerCase();
  for (const id of verifySources) {
    if (text === `{{${id}.gate.pass}}`) return 'pass';
    if (text === `{{${id}.gate.exitcode}}`) return 'exitCode';
    if (text === `{{${id}.verification.veredito}}`) return 'verdict';
  }
  return null;
}

function switchCaseAuthorizes(selector, caseValue) {
  const value = String(caseValue).trim().toLowerCase();
  if (selector === 'pass') return value === 'true';
  if (selector === 'exitCode') return value === '0';
  if (selector === 'verdict') return value === 'suportada';
  return false;
}

function validateWebhookGates(flow, alvosDe) {
  const errors = [];
  const seen = new Set();
  const visit = (id, state, path) => {
    const node = flow.nodes?.[id];
    if (!node) return;
    const key = `${id}|${state.budget ? 'b' : '-'}|${state.authorized ? 'a' : '-'}|${[...state.verifySources].sort().join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const nextState = {
      budget: state.budget || node.type === 'budget.guard',
      authorized: state.authorized,
      verifySources: new Set(state.verifySources),
    };
    if (node.type === 'jev.verify') nextState.verifySources.add(id);
    if (node.type === 'action.webhook') {
      if (!state.budget || !state.authorized) {
        errors.push({ codigo: 'WEBHOOK_GATE_AUSENTE', campo: `nodes.${id}`, msg: `action.webhook alcançável sem budget.guard e gate explícito jev.verify autorizado (${path.concat(id).join(' → ')})` });
      }
      return;
    }
    if (node.type === 'flow.if') {
      const verified = authorizedIfExpression(node.when, nextState.verifySources);
      if (node.then) visit(node.then, { ...nextState, authorized: nextState.authorized || verified }, path.concat(id));
      if (node.else) visit(node.else, { ...nextState, authorized: nextState.authorized }, path.concat(id));
      return;
    }
    if (node.type === 'flow.switch') {
      const selector = verifiedSwitchSelector(node.on, nextState.verifySources);
      for (const [caseValue, target] of Object.entries(node.cases || {})) {
        const targets = Array.isArray(target) ? target : [target];
        const safeCase = switchCaseAuthorizes(selector, caseValue);
        for (const child of targets.filter(Boolean)) visit(child, { ...nextState, authorized: nextState.authorized || safeCase }, path.concat(id));
      }
      return;
    }
    for (const child of alvosDe(id).filter(Boolean)) visit(child, nextState, path.concat(id));
  };
  visit(flow.start, { budget: false, authorized: false, verifySources: new Set() }, []);
  for (const [id, node] of Object.entries(flow.nodes || {})) {
    if (node?.type === 'action.webhook' && ![...seen].some(key => key.startsWith(`${id}|`))) {
      errors.push({ codigo: 'WEBHOOK_ORFAO', campo: `nodes.${id}`, msg: 'action.webhook órfão não possui caminho verificável desde start' });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// expressões: {{raiz.caminho}} — raiz ∈ {input, vars, flow} | id de nó
// ---------------------------------------------------------------------------

export function expressionPaths(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(EXPR_RE)) out.add(m[1]);
  return out;
}

export function resolvePath(path, context) {
  let cur = context;
  for (const p of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function interpolate(text, context) {
  return String(text ?? '').replace(EXPR_RE, (_, path) => {
    const v = resolvePath(path, context);
    return v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
}

export function validateInput(flow, input) {
  const errors = [];
  const schema = flow?.input_schema && typeof flow.input_schema === 'object' ? flow.input_schema : {};
  const value = input && typeof input === 'object' ? input : {};
  for (const [field, raw] of Object.entries(schema)) {
    const spec = raw && typeof raw === 'object' ? raw : { type: String(raw || '').split(/[ —-]/)[0] };
    const required = spec.required === true;
    if (!(field in value) || value[field] === '' || value[field] == null) {
      if (required) errors.push({ campo: field, codigo: 'INPUT_AUSENTE', msg: `campo obrigatório ausente: ${field}` });
      continue;
    }
    const type = String(spec.type || '').toLowerCase();
    const actual = Array.isArray(value[field]) ? 'array' : typeof value[field];
    if (type && ['string', 'number', 'boolean', 'object', 'array'].includes(type) && actual !== type) {
      errors.push({ campo: field, codigo: 'INPUT_TIPO', msg: `${field} deve ser ${type}, recebido ${actual}` });
      continue;
    }
    // precisão declarada no schema: enum, faixa numérica, tamanho e padrão
    if (Array.isArray(spec.enum) && spec.enum.length && !spec.enum.some(opcao => canonicalJson(opcao) === canonicalJson(value[field]))) {
      errors.push({ campo: field, codigo: 'INPUT_ENUM', msg: `${field} deve ser um de: ${spec.enum.map(String).join(' | ')}` });
    }
    if (actual === 'number') {
      if (spec.minimum != null && value[field] < spec.minimum) errors.push({ campo: field, codigo: 'INPUT_MINIMO', msg: `${field} deve ser >= ${spec.minimum}` });
      if (spec.maximum != null && value[field] > spec.maximum) errors.push({ campo: field, codigo: 'INPUT_MAXIMO', msg: `${field} deve ser <= ${spec.maximum}` });
    }
    if (actual === 'string') {
      if (spec.minLength != null && value[field].length < spec.minLength) errors.push({ campo: field, codigo: 'INPUT_TAMANHO', msg: `${field} deve ter pelo menos ${spec.minLength} caracteres` });
      if (spec.maxLength != null && value[field].length > spec.maxLength) errors.push({ campo: field, codigo: 'INPUT_TAMANHO', msg: `${field} deve ter no máximo ${spec.maxLength} caracteres` });
      if (spec.pattern) {
        try { if (!new RegExp(spec.pattern, 'u').test(value[field])) errors.push({ campo: field, codigo: 'INPUT_PADRAO', msg: `${field} não corresponde ao padrão exigido (${spec.pattern})` }); }
        catch { errors.push({ campo: field, codigo: 'INPUT_PADRAO', msg: `padrão inválido declarado para ${field}` }); }
      }
    }
    if (actual === 'array') {
      if (spec.minItems != null && value[field].length < spec.minItems) errors.push({ campo: field, codigo: 'INPUT_TAMANHO', msg: `${field} deve ter pelo menos ${spec.minItems} item(ns)` });
      if (spec.maxItems != null && value[field].length > spec.maxItems) errors.push({ campo: field, codigo: 'INPUT_TAMANHO', msg: `${field} deve ter no máximo ${spec.maxItems} item(ns)` });
      if (spec.itemMaxChars != null && (spec.maxItems == null || value[field].length <= spec.maxItems)) {
        value[field].forEach((item, index) => {
          let serialized;
          try { serialized = typeof item === 'string' ? item : canonicalJson(item); } catch { serialized = null; }
          if (typeof serialized !== 'string') errors.push({ campo: `${field}[${index}]`, codigo: 'INPUT_TIPO', msg: `${field}[${index}] deve ser serializável` });
          else if (serialized.length > spec.itemMaxChars) errors.push({ campo: `${field}[${index}]`, codigo: 'INPUT_TAMANHO', msg: `${field}[${index}] deve ter no máximo ${spec.itemMaxChars} caracteres serializados` });
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// validador — a regra só roda se fechar: alvos existem, DAG, expressões ok
// ---------------------------------------------------------------------------

export function validateFlow(flow) {
  const errors = [];
  const warnings = [];
  const err = (codigo, campo, msg) => errors.push({ codigo, campo, msg });
  const warn = (codigo, msg) => warnings.push({ codigo, msg });

  if (!flow || typeof flow !== 'object') return { ok: false, errors: [{ codigo: 'FLOW_INVALIDO', campo: '', msg: 'flow deve ser objeto' }], warnings };
  if (!ID_RE.test(flow.id || '')) err('ID_INVALIDO', 'id', 'slug minúsculo, 3–41 chars');
  if (!flow.name || String(flow.name).length < 3) err('NOME_CURTO', 'name', 'dê um nome ao flow (>= 3 chars)');
  if (!flow.input_schema || !Object.keys(flow.input_schema).length) err('SEM_INPUT', 'input_schema', 'declare os campos que o gatilho fornece');
  for (const [campo, spec] of Object.entries(flow.input_schema || {})) {
    if (!spec || typeof spec === 'string') continue;
    if (typeof spec !== 'object' || Array.isArray(spec)) { err('INPUT_SCHEMA_INVALIDO', `input_schema.${campo}`, 'use texto descritivo ou objeto {type, required, description}'); continue; }
    if (spec.type && !['string', 'number', 'boolean', 'object', 'array'].includes(String(spec.type).toLowerCase())) err('INPUT_SCHEMA_TIPO', `input_schema.${campo}.type`, 'tipo deve ser string, number, boolean, object ou array');
    if (spec.required != null && typeof spec.required !== 'boolean') err('INPUT_SCHEMA_REQUIRED', `input_schema.${campo}.required`, 'required deve ser boolean');
    // precisão declarada: o validador confere a declaração antes de rodar
    if (spec.enum != null && (!Array.isArray(spec.enum) || spec.enum.length === 0 || spec.enum.length > 50)) err('INPUT_SCHEMA_ENUM', `input_schema.${campo}.enum`, 'enum deve ser array com 1–50 valores permitidos');
    if (spec.minimum != null && !Number.isFinite(Number(spec.minimum))) err('INPUT_SCHEMA_MINIMO', `input_schema.${campo}.minimum`, 'minimum deve ser número');
    if (spec.maximum != null && !Number.isFinite(Number(spec.maximum))) err('INPUT_SCHEMA_MAXIMO', `input_schema.${campo}.maximum`, 'maximum deve ser número');
    if (Number.isFinite(Number(spec.minimum)) && Number.isFinite(Number(spec.maximum)) && Number(spec.minimum) > Number(spec.maximum)) err('INPUT_SCHEMA_FAIXA', `input_schema.${campo}`, 'minimum não pode exceder maximum');
    for (const lado of ['minLength', 'maxLength']) {
      if (spec[lado] != null && (!Number.isInteger(spec[lado]) || spec[lado] < 0 || spec[lado] > 100_000)) err('INPUT_SCHEMA_TAMANHO', `input_schema.${campo}.${lado}`, `${lado} deve ser inteiro entre 0 e 100000`);
    }
    if (Number.isFinite(spec.minLength) && Number.isFinite(spec.maxLength) && spec.minLength > spec.maxLength) err('INPUT_SCHEMA_FAIXA', `input_schema.${campo}`, 'minLength não pode exceder maxLength');
    for (const lado of ['minItems', 'maxItems']) {
      if (spec[lado] != null && (!Number.isInteger(spec[lado]) || spec[lado] < 0 || spec[lado] > 100_000)) err('INPUT_SCHEMA_TAMANHO', `input_schema.${campo}.${lado}`, `${lado} deve ser inteiro entre 0 e 100000`);
    }
    if (Number.isFinite(spec.minItems) && Number.isFinite(spec.maxItems) && spec.minItems > spec.maxItems) err('INPUT_SCHEMA_FAIXA', `input_schema.${campo}`, 'minItems não pode exceder maxItems');
    if (spec.itemMaxChars != null && (!Number.isInteger(spec.itemMaxChars) || spec.itemMaxChars < 1 || spec.itemMaxChars > 100_000)) err('INPUT_SCHEMA_TAMANHO', `input_schema.${campo}.itemMaxChars`, 'itemMaxChars deve ser inteiro entre 1 e 100000');
    if (spec.pattern != null) {
      if (typeof spec.pattern !== 'string' || !spec.pattern || spec.pattern.length > 200) err('INPUT_SCHEMA_PADRAO', `input_schema.${campo}.pattern`, 'pattern deve ser regex de até 200 caracteres');
      else { try { new RegExp(spec.pattern, 'u'); } catch { err('INPUT_SCHEMA_PADRAO', `input_schema.${campo}.pattern`, 'pattern deve ser regex válida'); } }
    }
  }
  if (flow.limits != null && (typeof flow.limits !== 'object' || Array.isArray(flow.limits))) {
    err('LIMITS_INVALIDO', 'limits', 'limits deve ser objeto');
  } else {
    const hardLimits = FLOW_LIMITS.hard;
    for (const [key, value] of Object.entries(flow.limits || {})) {
      if (!Object.hasOwn(hardLimits, key)) {
        err('LIMIT_DESCONHECIDO', `limits.${key}`, `limite desconhecido: ${key}`);
        continue;
      }
      if (!Number.isInteger(value) || value <= 0 || value > hardLimits[key]) {
        err('LIMIT_INVALIDO', `limits.${key}`, `${key} deve ser inteiro entre 1 e ${hardLimits[key]}`);
      }
    }
  }
  if (!flow.nodes || !Object.keys(flow.nodes).length) { err('SEM_NOS', 'nodes', 'pelo menos um nó'); return { ok: false, errors, warnings }; }
  if (Object.keys(flow.nodes).length > MAX_NODES) err('MUITOS_NOS', 'nodes', `máximo ${MAX_NODES} nós`);

  const ids = Object.keys(flow.nodes);
  if (!flow.start || !ids.includes(flow.start)) err('START_INVALIDO', 'start', 'start deve ser um id de nó existente');

  const alvosDe = (nodeId) => {
    const n = flow.nodes[nodeId];
    if (!n) return [];
    const alvos = [];
    if (n.next) alvos.push(n.next);
    if (n.type === 'flow.if') { if (n.then) alvos.push(n.then); if (n.else) alvos.push(n.else); }
    if (n.type === 'flow.switch') for (const t of Object.values(n.cases || {})) alvos.push(...(Array.isArray(t) ? t : [t]));
    return alvos;
  };

  for (const [id, node] of Object.entries(flow.nodes)) {
    if (!ID_RE.test(id)) err('NO_ID_INVALIDO', `nodes.${id}`, 'id de nó deve ser slug');
    const canonicalType = normalizeNodeType(node?.type);
    if (!NODE_TYPES.has(canonicalType)) { err('TIPO_INVALIDO', `nodes.${id}.type`, `use: ${[...NODE_TYPES].join(' | ')}`); continue; }
    for (const contractError of validateNodeContract(canonicalType, node)) {
      err(contractError.code, `nodes.${id}.${contractError.field || 'type'}`, contractError.message);
    }

    for (const alvo of alvosDe(id)) {
      if (!ids.includes(alvo)) err('ALVO_INEXISTENTE', `nodes.${id}`, `aponta para nó inexistente "${alvo}"`);
    }

    if (node.type === 'jev.ask') {
      if (!node.jevlet && !node.questions) err('ASK_VAZIO', `nodes.${id}`, 'informe questions (inline) ou jevlet (catálogo)');
      if (node.state != null && (typeof node.state !== 'object' || Array.isArray(node.state)))
        err('ASK_STATE_INVALIDO', `nodes.${id}.state`, 'state deve ser objeto de campos explícitos');
      if (node.jevlet && node.questions) warn('ASK_DUPLA', `nodes.${id}.jevlet`, 'jevlet tem precedência; questions inline serão ignoradas');
      // next pertence ao NÓ — dentro de questions é beco sem saída silencioso
      for (const [qid, q] of Object.entries(node.questions || {})) {
        if (q && typeof q === 'object' && 'next' in q) err('NEXT_MAL_POSICIONADO', `nodes.${id}.questions.${qid}`, '"next" dentro da pergunta não roteia nada — mova para o nó');
      }
    }
    if (node.type.startsWith('jev.') || node.type.startsWith('rules.') || node.type.startsWith('flow.') || node.type.startsWith('rule.') || ['context.compact', 'context.prune', 'budget.guard', 'det.skill', 'metrics.emit', 'logic.subgraph', 'logic.graph'].includes(normalizeNodeType(node.type))) {
      if (alvosDe(id).length === 0) warn('NO_SEM_SAIDA', `nodes.${id}`, 'nó de julgamento/roteamento sem saída — o flow termina aqui por acidente?');
    }
    if (node.type === 'rules.find' && typeof node.ruleset === 'string' && !EXPR_RE.test(node.ruleset) && !ID_RE.test(node.ruleset)) {
      err('RULESET_ID_INVALIDO', `nodes.${id}.ruleset`, 'ruleset deve ser slug (ingerido via `jev ruleset ingest`) ou expressão {{...}} que resolva slug');
    }
    if (node.type === 'jev.jevlet' && !node.jevlet) err('JEVLET_FALTANDO', `nodes.${id}.jevlet`, 'informe o id do jevlet do catálogo');
    if (node.type === 'flow.if' && !node.when) err('IF_SEM_QUANDO', `nodes.${id}.when`, 'flow.if precisa de when ("{{no.valores.x}} >= 0.7")');
    if (node.type === 'flow.if' && (!node.then || !node.else)) err('IF_SEM_RAMOS', `nodes.${id}`, 'flow.if precisa de then e else explícitos para não terminar silenciosamente');
    if (node.type === 'flow.if' && node.onInvalid != null && node.onInvalid !== 'else') err('IF_INVALIDO_SEM_ROTA', `nodes.${id}.onInvalid`, 'onInvalid deve ser else');
    if (node.type === 'flow.switch') {
      if (node.onInvalid != null && node.onInvalid !== 'default') err('SWITCH_INVALIDO_SEM_ROTA', `nodes.${id}.onInvalid`, 'onInvalid deve ser default');
      if (!node.on) err('SWITCH_SEM_ON', `nodes.${id}.on`, 'flow.switch precisa de on ("{{no.valores.area}}")');
      else if (!EXACT_EXPR_RE.test(String(node.on))) err('ON_INVALIDO', `nodes.${id}.on`, 'on deve ser UMA expressão {{caminho}}');
      if (!node.cases || !Object.keys(node.cases).length) err('SWITCH_SEM_CASES', `nodes.${id}.cases`, 'pelo menos um caso (+ _default opcional)');
      else if (!Object.prototype.hasOwnProperty.call(node.cases, '_default')) err('SWITCH_SEM_DEFAULT', `nodes.${id}.cases`, 'inclua _default para tratar valores sem correspondência');
    }
    if (node.type === 'jev.classify') {
      if (node.texto == null) err('CLASSIFY_TEXTO_FALTANDO', `nodes.${id}.texto`, 'jev.classify precisa de texto ({{caminho}} ou literal)');
      if ((!Array.isArray(node.categorias) && typeof node.categorias !== 'string') || (Array.isArray(node.categorias) && (node.categorias.length < 2 || node.categorias.length > 8))) err('CLASSIFY_CATEGORIAS_INVALIDAS', `nodes.${id}.categorias`, 'categorias deve ser array de 2 a 8 opções');
      if (node.subcategorias != null && (!Array.isArray(node.subcategorias) || node.subcategorias.length < 2 || node.subcategorias.length > 8)) err('CLASSIFY_SUBCATEGORIAS_INVALIDAS', `nodes.${id}.subcategorias`, 'subcategorias deve ser array de 2 a 8 opções');
    }
    if (node.type === 'jev.rerank') {
      if (!Array.isArray(node.items) && typeof node.items !== 'string') err('RERANK_ITENS_INVALIDOS', `nodes.${id}.items`, 'jev.rerank precisa de items (array ou "{{caminho}}" para array do contexto)');
      if (!node.question || typeof node.question !== 'string') err('RERANK_PERGUNTA_FALTANDO', `nodes.${id}.question`, 'jev.rerank precisa de question (critério de relevância)');
      if (node.maxItems != null && (!Number.isInteger(node.maxItems) || node.maxItems < 1 || node.maxItems > 10)) err('RERANK_LIMITE_INVALIDO', `nodes.${id}.maxItems`, 'maxItems deve ser inteiro entre 1 e 10');
    }
    if (node.type === 'flow.ensemble') {
      if (!Array.isArray(node.scores) || !node.scores.length) err('ENSEMBLE_SCORES_INVALIDOS', `nodes.${id}.scores`, 'flow.ensemble precisa de scores (array de "{{caminhos}}" numéricos)');
      if (node.policy != null && !['media', 'maioria', 'conservador'].includes(node.policy)) err('ENSEMBLE_POLITICA_INVALIDA', `nodes.${id}.policy`, 'policy deve ser media, maioria ou conservador');
      if (node.threshold != null && (!Number.isFinite(Number(node.threshold)) || Number(node.threshold) < 0 || Number(node.threshold) > 1)) err('ENSEMBLE_THRESHOLD_INVALIDO', `nodes.${id}.threshold`, 'threshold deve ser número entre 0 e 1');
    }
    if (node.type === 'action.webhook' && !node.url) err('WEBHOOK_SEM_URL', `nodes.${id}.url`, 'action.webhook precisa de url');
    if (node.type === 'action.set' && (!node.values || !Object.keys(node.values).length)) err('SET_VAZIO', `nodes.${id}.values`, 'action.set precisa de values');
    if (node.type === 'rule.match') {
      if (node.value == null) err('RULE_VALUE_FALTANDO', `nodes.${id}.value`, 'rule.match precisa de value');
      if (!['equals', 'includes', 'regex', 'exists', 'in'].includes(node.operator)) err('RULE_OPERATOR_INVALIDO', `nodes.${id}.operator`, 'use equals | includes | regex | exists | in');
      if (node.operator === 'regex' && !regexIsSafe(node.pattern)) err('RULE_REGEX_INVALIDA', `nodes.${id}.pattern`, 'pattern deve ser válido, seguro e ter 1–200 caracteres');
      if (node.flags != null && (typeof node.flags !== 'string' || !/^(?!.*(.).*\1)[imu]*$/u.test(node.flags))) err('RULE_FLAGS_INVALIDAS', `nodes.${id}.flags`, 'flags aceitas: i, m, u sem repetição');
      if (node.operator === 'in' && !Array.isArray(node.expected)) err('RULE_EXPECTED_INVALIDO', `nodes.${id}.expected`, 'operator in exige expected array');
    }
    if (node.type === 'rule.extract' && (!node.paths || typeof node.paths !== 'object' || Array.isArray(node.paths) || !Object.keys(node.paths).length)) {
      err('RULE_PATHS_INVALIDO', `nodes.${id}.paths`, 'rule.extract precisa de paths { campo: "{{caminho}}" }');
    }
    if (node.type === 'rule.lookup') {
      if (node.key == null) err('RULE_KEY_FALTANDO', `nodes.${id}.key`, 'rule.lookup precisa de key');
      if (!node.table || typeof node.table !== 'object' || Array.isArray(node.table)) err('RULE_TABLE_INVALIDA', `nodes.${id}.table`, 'rule.lookup precisa de table objeto');
    }
    if (node.type === 'context.compact') {
      if (node.text == null) err('COMPACT_TEXT_FALTANDO', `nodes.${id}.text`, 'context.compact precisa de text');
      if (node.maxChars != null && (!Number.isInteger(node.maxChars) || node.maxChars < 256 || node.maxChars > 50_000)) err('COMPACT_LIMIT_INVALIDO', `nodes.${id}.maxChars`, 'maxChars deve ser inteiro entre 256 e 50000');
    }
    if (node.when && !WHEN_RE.test(String(node.when))) {
      err('QUANDO_INVALIDO', `nodes.${id}.when`, 'formato: "{{no.valores.x}} >= 0.7" (uma comparação)');
    }

    // expressões: raízes válidas = input | vars | flow | nó existente
    const textos = [
      node.when,
      node.on,
      node.url,
      node.body ? JSON.stringify(node.body) : null,
      node.texto,
      node.values ? JSON.stringify(node.values) : null,
      node.value,
      node.expected,
      node.key,
      node.text,
      node.paths ? JSON.stringify(node.paths) : null,
      node.skill,
      node.claim,
      node.evidence,
      node.pergunta,
      node.ruleset,
      node.messages ? JSON.stringify(node.messages) : null,
      node.state ? JSON.stringify(node.state) : null,
      node.event ? JSON.stringify(node.event) : null,
      node.graph ? JSON.stringify(node.graph) : null,
      node.facts ? JSON.stringify(node.facts) : null,
      node.evidence ? JSON.stringify(node.evidence) : null,
    ].filter(value => typeof value === 'string' && value);
    for (const texto of textos) {
      for (const path of expressionPaths(texto)) {
        const raiz = path.split('.')[0];
        if (!['input', 'vars', 'flow'].includes(raiz) && !ids.includes(raiz)) {
          err('EXPR_RAIZ_INVALIDA', `nodes.${id}`, `expressão {{${path}}} aponta para raiz desconhecida "${raiz}"`);
        }
      }
    }
  }

  for (const gateError of validateWebhookGates(flow, alvosDe)) errors.push(gateError);

  // ciclos: o grafo tem que ser um DAG
  if (!errors.some(e => ['START_INVALIDO', 'TIPO_INVALIDO', 'SEM_NOS'].includes(e.codigo))) {
    const estado = {};
    const visitar = (id) => {
      if (estado[id] === 1) { err('CICLO', 'nodes', `ciclo detectado passando por "${id}"`); return; }
      if (estado[id] === 2 || !flow.nodes[id]) return;
      estado[id] = 1;
      for (const a of alvosDe(id)) visitar(a);
      estado[id] = 2;
    };
    visitar(flow.start);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// store: data/jev/flows/<id>.flow.json + runs/<id>/<ts>.json (cap 20)
// ---------------------------------------------------------------------------

export function flowPath(id, { dir = FLOWS_DIR } = {}) { return join(dir, `${assertFlowId(id)}.flow.json`); }

export function saveFlow(flow, { dir = FLOWS_DIR } = {}) {
  const validacao = validateFlow(flow);
  if (!validacao.ok) return { salvo: false, validacao };
  mkdirSync(dir, { recursive: true });
  writeFileSync(flowPath(flow.id, { dir }), JSON.stringify(flow, null, 2));
  return { salvo: true, path: flowPath(flow.id, { dir }), validacao };
}

export function loadFlow(idOrPath, { dir = FLOWS_DIR } = {}) {
  const requested = String(idOrPath || '');
  const caminhos = isAbsolute(requested) && requested.endsWith('.json')
    ? [requested]
    : isFlowId(requested)
      ? [flowPath(requested, { dir }), ...shippedExamplePaths(requested)]
      : [];
  for (const c of caminhos) {
    try { return JSON.parse(readFileSync(c, 'utf8')); } catch { /* próximo */ }
  }
  throw new FlowError(`flow não encontrado: ${idOrPath} (nem em ${dir} nem em examples/)`, isFlowId(requested) ? 'NOT_FOUND' : 'ID_INVALIDO');
}

export function listFlows({ dir = FLOWS_DIR } = {}) {
  const lista = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.flow.json'))) {
      try {
        const fl = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        lista.push({
          id: fl.id,
          name: fl.name,
          nos: Object.keys(fl.nodes || {}).length,
          fields: Object.keys(fl.input_schema || {}).length,
          fixtures: Array.isArray(fl.fixtures) ? fl.fixtures.length : 0,
          updated_at: fl.updated_at || null,
          description: fl.description || '',
        });
      } catch { /* corrompido fica fora */ }
    }
  }
  return lista;
}

/**
 * Remove um flow do catálogo (data/jev/flows/): apaga o .flow.json, os runs
 * e os artefatos de desenho. Exemplos shipped (services/jev-flow/examples/)
 * são somente-leitura — são código do repo, não estado do usuário.
 */
export function deleteFlow(id, { dir = FLOWS_DIR } = {}) {
  const path = flowPath(id, { dir });
  if (!existsSync(path)) {
    const ehExemplo = shippedExamplePaths(id).some(existsSync);
    throw new FlowError(
      ehExemplo ? `"${id}" é um exemplo shipped (services/jev-flow/examples/) — somente leitura; duplique para editar` : `flow não encontrado: ${id}`,
      ehExemplo ? 'READONLY_EXEMPLO' : 'NOT_FOUND',
    );
  }
  unlinkSync(path);
  for (const extra of [join(dir, 'runs', id), join(dir, `${id}.demo.html`), join(dir, `${id}.mmd`), join(dir, `${id}.html`)]) {
    try { unlinkSync(extra); } catch {
      try { rmSync(extra, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  return { ok: true, removido: path };
}

// ---------------------------------------------------------------------------
// histórico de execuções
// ---------------------------------------------------------------------------

/** Últimos runs gravados de um flow (mais recente primeiro). */
export function listRuns(id, { dir = FLOWS_DIR, limit = 20 } = {}) {
  if (!isFlowId(id)) return [];
  const runsDir = join(dir, 'runs', id);
  if (!existsSync(runsDir)) return [];
  try {
    return readdirSync(runsDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit)
      .map(f => {
        try {
          const r = JSON.parse(readFileSync(join(runsDir, f), 'utf8'));
          return { quando: r.executado_em, ok: r.ok, path: r.path, passos: r.steps?.length ?? 0, ms: r.steps?.reduce((s, x) => s + (x.ms || 0), 0) ?? 0, arquivo: f };
        } catch { return null; }
      }).filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// standalone scheduler — only the project runtime executes scheduled flows.
// ---------------------------------------------------------------------------

export const CRON_TASK_PREFIX = 'jev-flow-';

export function cronTaskId(flowId) { return `${CRON_TASK_PREFIX}${flowId}`; }

/**
 * Adds a flow to the standalone scheduler. schedule: "interval:10m", a five-field cron, or "at:ISO"
 * (5 campos, sem a barra-e-dez escrita em doc p/ não fechar o comentário) ou
 * "at:ISO". deps injetáveis p/ teste.
 */
export async function scheduleFlow({ flowId, schedule, input, ativo = true }, { upsert, remove, list } = {}) {
  const flow = loadFlow(flowId); // agenda só o que existe e é válido
  const cron = { upsert: upsert || scheduler.upsertTask, remove: remove || scheduler.deleteTask, list: list || scheduler.listTasks };
  if (ativo === false) {
    const existing = cron.list().find(t => t.id === cronTaskId(flowId));
    if (!existing) return { agendado: false, motivo: 'não havia agendamento' };
    cron.remove(cronTaskId(flowId));
    return { agendado: false, removido: cronTaskId(flowId) };
  }
  const task = cron.upsert({
    id: cronTaskId(flowId),
    name: `Jev Flow · ${flow.name}`,
    kind: 'jev_flow',
    schedule,
    params: { flowId, input: input || null },
    enabled: true,
  });
  return { agendado: true, task: { id: task.id, schedule: task.schedule, enabled: task.enabled, proximo: task.nextRunAt || null } };
}

/** Estado do agendamento de todos os flows (para badges na UI). */
export function schedulesInfo({ list } = {}) {
  const listar = typeof list === 'function' ? list : scheduler.listTasks;
  const out = {};
  for (const t of listar()) {
    if (t.kind !== 'jev_flow' || !t.params?.flowId) continue;
    out[t.params.flowId] = { schedule: t.schedule, ativo: !!t.enabled, task: t.id, ultima: t.lastRunAt, status: t.lastStatus };
  }
  return out;
}

/** Executor for a standalone scheduled flow. */
export async function executarAgendado(params = {}, { client, dir } = {}) {
  const flow = loadFlow(params.flowId, ...(dir ? [{ dir }] : []));
  return runFlow(flow, params.input || {}, { gravar: true, ...(client ? { client } : {}), ...(dir ? { dir } : {}) });
}

// ---------------------------------------------------------------------------
// executor
// ---------------------------------------------------------------------------

function buildQuestions(specQuestions) {
  const questions = {};
  for (const [qid, q] of Object.entries(specQuestions || {})) {
    if (q.type === 'choice') questions[qid] = choiceQ(q.instructions, q.criteria);
    else if (q.type === 'score') questions[qid] = scoreQ(q.instructions, q.criteria);
    else questions[qid] = noulQ(q.instructions, q.criteria);
  }
  return questions;
}

function normalizeInline(answers) {
  const out = {};
  for (const [id, a] of Object.entries(answers || {})) {
    if (!a) continue;
    if (a.type === 'choice') out[id] = a.choice;
    else if (a.type === 'noul') out[id] = a.noul;
    else if (a.type === 'score') out[id] = a.score;
  }
  return out;
}

function evalWhen(when, context, onInvalid = null) {
  const m = String(when).match(WHEN_RE);
  if (!m) throw new FlowError(`when ilegível: ${when}`, 'QUANDO_INVALIDO');
  const valor = resolvePath(m[1], context);
  if (onInvalid === 'else' && (typeof valor !== 'number' || !Number.isFinite(valor))) return false;
  if (valor === undefined) throw new FlowError(`expressão resolveu undefined: ${m[1]}`, 'EXPRESSAO_INDEFINIDA');
  const alvoBruto = m[3].trim();
  let comparavel;
  if ((alvoBruto.startsWith('"') && alvoBruto.endsWith('"')) || (alvoBruto.startsWith("'") && alvoBruto.endsWith("'"))) {
    comparavel = alvoBruto.slice(1, -1);
  } else if (alvoBruto === 'true') comparavel = true;
  else if (alvoBruto === 'false') comparavel = false;
  else if (alvoBruto === 'null') comparavel = null;
  else if (/^-?(?:\d+\.?\d*|\.\d+)$/u.test(alvoBruto) && Number.isFinite(Number(alvoBruto))) comparavel = Number(alvoBruto);
  else comparavel = alvoBruto;
  switch (m[2]) {
    case '==': return valor === comparavel;
    case '!=': return valor !== comparavel;
    case '>=': return valor >= comparavel;
    case '<=': return valor <= comparavel;
    case '>': return valor > comparavel;
    case '<': return valor < comparavel;
    default: throw new FlowError(`operador inválido: ${m[2]}`, 'QUANDO_INVALIDO');
  }
}

function proximoDo(node, context) {
  if (node.type === 'flow.if') return evalWhen(node.when, context, node.onInvalid) ? node.then : node.else;
  if (node.type === 'flow.switch') {
    const m = String(node.on).match(EXACT_EXPR_RE);
    if (!m) throw new FlowError(`on ilegível: ${node.on}`, 'ON_INVALIDO');
    const chave = resolvePath(m[1], context);
    if (node.onInvalid === 'default' && (chave == null || typeof chave === 'number' && !Number.isFinite(chave))) {
      const fallback = node.cases?._default;
      return Array.isArray(fallback) ? fallback[0] : fallback || null;
    }
    if (chave === undefined) throw new FlowError(`expressão resolveu undefined: ${m[1]}`, 'EXPRESSAO_INDEFINIDA');
    const casos = node.cases || {};
    for (const [caso, alvo] of Object.entries(casos)) {
      if (caso === '_default') continue;
      if (String(caso) === String(chave)) return Array.isArray(alvo) ? alvo[0] : alvo;
    }
    const def = casos._default;
    return def ? (Array.isArray(def) ? def[0] : def) : null;
  }
  return node.next || null;
}

const DETERMINISTIC_NODE_TYPES = new Set([
  'flow.if', 'flow.switch', 'flow.ensemble', 'rule.match', 'rule.extract', 'rule.lookup',
  'context.compact', 'action.log', 'action.set', 'det.skill', 'budget.guard', 'metrics.emit', 'logic.subgraph',
]);
const BUDGET_ERROR_CODES = new Set(['FLOW_BUDGET_JEV_CALLS', 'FLOW_BUDGET_INPUT_TOKENS', 'JEV_REMOTE_STATE_UNSAFE']);

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function flowFingerprint(flow) {
  return digest(flow);
}

function flowTargets(node) {
  const targets = [];
  if (node?.next) targets.push(node.next);
  if (node?.type === 'flow.if') targets.push(node.then, node.else);
  if (node?.type === 'flow.switch') {
    for (const target of Object.values(node.cases || {})) targets.push(...(Array.isArray(target) ? target : [target]));
  }
  return targets.filter(Boolean);
}

function reachableFlowNodes(flow) {
  const reachable = new Set();
  const pending = [flow.start];
  while (pending.length) {
    const id = pending.pop();
    if (!id || reachable.has(id) || !flow.nodes?.[id]) continue;
    reachable.add(id);
    pending.push(...flowTargets(flow.nodes[id]));
  }
  return reachable;
}

function checkpointBody(checkpoint) {
  const { integrity: _integrity, ...body } = checkpoint || {};
  return body;
}

export function sealFlowCheckpoint(checkpoint) {
  const body = checkpointBody(checkpoint);
  return {
    ...body,
    integrity: { algorithm: 'sha256', digest: digest(body) },
  };
}

function assertCheckpointIntegrity(checkpoint, flow = null) {
  if (!checkpoint || checkpoint.schema !== FLOW_CHECKPOINT_SCHEMA) {
    throw new FlowError('schema de checkpoint incompatível', 'CHECKPOINT_INVALIDO');
  }
  const expected = digest(checkpointBody(checkpoint));
  if (checkpoint.integrity?.algorithm !== 'sha256' || checkpoint.integrity?.digest !== expected) {
    throw new FlowError('integridade do checkpoint não confere', 'CHECKPOINT_INTEGRIDADE_INVALIDA');
  }
  if (!Array.isArray(checkpoint.steps) || !checkpoint.outputs || typeof checkpoint.outputs !== 'object' || !checkpoint.usage || typeof checkpoint.usage !== 'object') {
    throw new FlowError('ledger do checkpoint é inválido', 'CHECKPOINT_LEDGER_INVALIDO');
  }
  if (checkpoint.steps.length !== Number(checkpoint.usage.steps)) {
    throw new FlowError('contador de passos diverge do ledger', 'CHECKPOINT_LEDGER_INVALIDO');
  }
  const completed = new Set();
  for (const step of checkpoint.steps) {
    if (!step?.no || completed.has(step.no) || !Object.hasOwn(checkpoint.outputs, step.no)) {
      throw new FlowError('passos e outputs do checkpoint divergem', 'CHECKPOINT_LEDGER_INVALIDO');
    }
    completed.add(step.no);
    if (digest(checkpoint.outputs[step.no]) !== digest(checkpoint.context?.[step.no])) {
      throw new FlowError('contexto e outputs do checkpoint divergem', 'CHECKPOINT_LEDGER_INVALIDO');
    }
  }
  const usageKeys = ['steps', 'jevCalls', 'jevTransportCalls', 'remoteCalls', 'generatorCalls', 'inputTokensBudgeted', 'inputTokensObserved', 'inputTokensEstimated', 'outputTokensObserved', 'outputTokensEstimated', 'deterministicNodes', 'cacheHits', 'tokensAvoidedEstimated', 'bytesSaved'];
  for (const key of usageKeys) {
    const value = checkpoint.usage[key] ?? 0;
    if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new FlowError(`usage.${key} inválido`, 'CHECKPOINT_LEDGER_INVALIDO');
  }
  if (flow) {
    const reachable = reachableFlowNodes(flow);
    for (const id of completed) if (!reachable.has(id)) throw new FlowError(`passo inalcançável no checkpoint: ${id}`, 'CHECKPOINT_LEDGER_INVALIDO');
    for (const id of [checkpoint.nextNode, checkpoint.pendingNode].filter(Boolean)) {
      if (!reachable.has(id)) throw new FlowError(`ponteiro inalcançável no checkpoint: ${id}`, 'CHECKPOINT_LEDGER_INVALIDO');
    }
  }
  return checkpoint;
}

function assertCheckpointFresh(checkpoint) {
  if (checkpoint?.expiresAt == null) return checkpoint; // legado: migra ao carregar
  const expiresAt = Date.parse(checkpoint.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new FlowError('expiração do checkpoint inválida', 'CHECKPOINT_INVALIDO');
  if (expiresAt <= Date.now()) throw new FlowError('checkpoint expirado', 'CHECKPOINT_EXPIRED');
  return checkpoint;
}

function normalizedLimits(flow) {
  return {
    maxSteps: flow?.limits?.maxSteps ?? FLOW_LIMITS.defaults.maxSteps,
    maxJevCalls: flow?.limits?.maxJevCalls ?? FLOW_LIMITS.defaults.maxJevCalls,
    maxInputTokens: flow?.limits?.maxInputTokens ?? FLOW_LIMITS.defaults.maxInputTokens,
  };
}

function estimatedTokens(value) {
  return Math.max(1, Math.ceil(canonicalJson(value).length / 4));
}

function exactTemplateValue(value, context) {
  if (typeof value !== 'string') return value;
  const exact = value.match(EXACT_EXPR_RE);
  return exact ? resolvePath(exact[1], context) : interpolate(value, context);
}

function regexIsSafe(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 200) return false;
  // Dialeto deliberadamente fechado: sem grupos, alternância, intervalos
  // quantificados ou backreferences. Isso elimina as famílias conhecidas de
  // backtracking exponencial; regex avançada deve virar regra de código.
  if (/[(){}|]/u.test(pattern)) return false;
  if (/\\(?:[1-9]|k<)/u.test(pattern)) return false;
  const quantifiers = pattern.match(/(?<!\\)[+*?]/gu) || [];
  if (quantifiers.length > 8) return false;
  try { new RegExp(pattern, 'u'); return true; } catch { return false; }
}

function executeDeterministicNode(node, context) {
  if (node.type === 'rule.match') {
    const value = exactTemplateValue(node.value, context);
    const expected = exactTemplateValue(node.expected, context);
    let matched = false;
    if (node.operator === 'exists') matched = value !== undefined && value !== null;
    else if (node.operator === 'equals') matched = canonicalJson(value) === canonicalJson(expected);
    else if (node.operator === 'includes') matched = String(value ?? '').includes(String(expected ?? ''));
    else if (node.operator === 'in') matched = node.expected.some(item => canonicalJson(value) === canonicalJson(exactTemplateValue(item, context)));
    else if (node.operator === 'regex') {
      if (!regexIsSafe(node.pattern)) throw new FlowError('regex insegura ou inválida', 'RULE_REGEX_INVALIDA');
      const flags = typeof node.flags === 'string' && /^(?!.*(.).*\1)[imu]*$/u.test(node.flags) ? node.flags : 'u';
      matched = new RegExp(node.pattern, flags).test(String(value ?? '').slice(0, 5_000));
    }
    return { tipo: 'rule.match', matched, operator: node.operator, valor: value ?? null };
  }
  if (node.type === 'rule.extract') {
    const valores = {};
    const ausentes = [];
    for (const [key, path] of Object.entries(node.paths || {})) {
      const value = exactTemplateValue(path, context);
      if (value === undefined) ausentes.push(key);
      valores[key] = value ?? null;
    }
    return { tipo: 'rule.extract', valores, ausentes };
  }
  if (node.type === 'rule.lookup') {
    const key = exactTemplateValue(node.key, context);
    const lookupKey = String(key ?? '');
    const found = Object.hasOwn(node.table || {}, lookupKey);
    return {
      tipo: 'rule.lookup',
      chave: key ?? null,
      found,
      valor: found ? node.table[lookupKey] : (Object.hasOwn(node, 'default') ? node.default : null),
    };
  }
  if (node.type === 'flow.ensemble') {
    const rawScores = (Array.isArray(node.scores) ? node.scores : []).map((sc) => Number(exactTemplateValue(sc, context)));
    const scores = rawScores.filter((n) => Number.isFinite(n)).map((n) => Math.min(1, Math.max(0, n)));
    if (!scores.length) throw new FlowError('flow.ensemble sem scores numéricos resolvíveis no contexto', 'ENSEMBLE_SEM_SCORES');
    const threshold = Math.min(1, Math.max(0, node.threshold != null ? Number(node.threshold) : 0.6));
    const policy = ['media', 'maioria', 'conservador'].includes(node.policy) ? node.policy : 'media';
    const acima = scores.filter((x) => x >= threshold).length;
    let score;
    let approved;
    if (policy === 'maioria') {
      score = acima / scores.length;
      approved = score >= 0.5;
    } else if (policy === 'conservador') {
      score = Math.min(...scores);
      approved = score >= threshold;
    } else {
      score = scores.reduce((acc, x) => acc + x, 0) / scores.length;
      approved = score >= threshold;
    }
    return {
      tipo: 'flow.ensemble',
      policy,
      approved,
      score: Math.round(score * 1000) / 1000,
      votes: { acima, total: scores.length },
      threshold,
    };
  }
  if (node.type === 'context.compact') {
    const raw = exactTemplateValue(node.text, context);
    const text = typeof raw === 'string' ? raw : (canonicalJson(raw) ?? '');
    const maxChars = node.maxChars || 4_000;
    if (text.length <= maxChars) return { tipo: 'context.compact', texto: text, compacted: false, charsSaved: 0 };
    const markerBudget = 100;
    const available = Math.max(64, maxChars - markerBudget);
    const headChars = Math.ceil(available * 0.65);
    const tailChars = Math.max(1, available - headChars);
    const omitted = Math.max(0, text.length - headChars - tailChars);
    const compacted = `${text.slice(0, headChars)}\n[… ${omitted} caracteres omitidos deterministicamente …]\n${text.slice(-tailChars)}`;
    return { tipo: 'context.compact', texto: compacted, compacted: true, originalChars: text.length, compactedChars: compacted.length, charsSaved: Math.max(0, text.length - compacted.length) };
  }
  return null;
}

function exactTemplateDeep(value, context, depth = 0) {
  if (depth > 12) return value;
  if (typeof value === 'string') return exactTemplateValue(value, context);
  if (Array.isArray(value)) return value.map(item => exactTemplateDeep(item, context, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, exactTemplateDeep(child, context, depth + 1)]));
  return value;
}

const METRIC_DENY_KEY = /(?:secret|token|password|authorization|credential|api.?key|private.?key|content|text|body|prompt|evidence|claim|input|output|stack|path|file|directory|cwd|root)/iu;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|Users|var|etc|opt|srv|root|tmp|mnt|Volumes|workspace)(?:\/|$))/u;

function sanitizeMetricValue(value, key = '', depth = 0) {
  if (METRIC_DENY_KEY.test(key)) return undefined;
  if (depth > 3) return '[REDACTED:depth]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (ABSOLUTE_PATH.test(value) || value.length > 160) return '[REDACTED:unsafe-string]';
    const redaction = redactAutonomyText(value, 160);
    if (redaction.categories?.length) return '[REDACTED:unsafe-string]';
    return redaction.text;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeMetricValue(item, '', depth + 1)).filter(item => item !== undefined);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).flatMap(([childKey, child]) => {
      const safe = sanitizeMetricValue(child, childKey, depth + 1);
      return safe === undefined ? [] : [[childKey, safe]];
    }));
  }
  return undefined;
}

function executeBudgetGuard(node, usage, limits) {
  const requested = node.budget || {};
  const checks = [
    ['steps', limits.maxSteps, usage.steps, requested.steps],
    ['jevCalls', limits.maxJevCalls, usage.jevCalls, requested.jevCalls],
    ['inputTokens', limits.maxInputTokens, usage.inputTokensBudgeted, requested.inputTokens ?? requested.inputTokensBudgeted],
  ];
  const remaining = {};
  for (const [key, limit, used, reserve] of checks) {
    const amount = Number(reserve) || 0;
    if (amount < 0 || used + amount > limit) {
      throw new FlowError(`budget.guard bloqueou antes do despacho: ${key}`, `FLOW_BUDGET_GUARD_${String(key).toUpperCase()}`);
    }
    remaining[key] = Math.max(0, limit - used - amount);
  }
  return { tipo: 'budget.guard', allowed: true, reserved: requested, remaining, measurement: 'observed' };
}

async function executeExtendedNode(node, context, runtime) {
  if (normalizeNodeType(node.type) === 'logic.subgraph') {
    const graph = exactTemplateDeep(node.graph, context);
    const facts = node.facts === undefined ? undefined : exactTemplateDeep(node.facts, context);
    const evidence = node.evidence === undefined ? undefined : exactTemplateDeep(node.evidence, context);
    const result = await runtime.logicEvaluator({
      ...(graph || {}),
      ...(facts === undefined ? {} : { facts }),
      ...(evidence === undefined ? {} : { evidence }),
    }, { state: context, now: node.now ? exactTemplateValue(node.now, context) : undefined });
    return { tipo: 'logic.subgraph', ...result, source: 'deterministic-reasoning-graph', remoteCalled: false, measurement: 'observed' };
  }
  if (node.type === 'det.skill') {
    const skill = exactTemplateValue(node.skill, context);
    const input = exactTemplateValue(node.input || {}, context) || {};
    const result = await runtime.skillExecutor(skill, input);
    if (result?.execution_mode !== 'deterministic') {
      throw new FlowError(`skill não determinística: ${skill}`, 'DET_SKILL_NOT_DETERMINISTIC');
    }
    return { tipo: 'det.skill', skill, result, execution_mode: 'deterministic', source: 'deterministic-registry', measurement: 'observed' };
  }
  if (node.type === 'budget.guard') return executeBudgetGuard(node, runtime.usage, runtime.limits);
  if (node.type === 'context.prune') {
    const messages = exactTemplateValue(node.messages, context);
    const options = exactTemplateValue(node.options || {}, context) || {};
    if (!Array.isArray(messages)) return { tipo: 'context.prune', messages, meta: { applied: false, failOpen: true, reason: 'messages-not-array', measurement: 'estimated' }, measurement: 'estimated' };
    try {
      const result = await runtime.pruner(messages, options);
      return { tipo: 'context.prune', ...result, remoteCalled: result?.meta?.transportCalled === true, measurement: result?.meta?.measurement || 'estimated' };
    } catch (error) {
      return { tipo: 'context.prune', messages, meta: { applied: false, failOpen: true, reason: 'adapter-error', errorCode: error?.code || 'PRUNER_ERROR', measurement: 'estimated' }, measurement: 'estimated' };
    }
  }
  if (node.type === 'jev.verify') {
    const claimRedaction = redactAutonomyText(exactTemplateValue(node.claim, context), 12_000);
    const evidenceRedaction = redactAutonomyText(exactTemplateValue(node.evidence, context), 12_000);
    if (!claimRedaction.remoteSafe || !evidenceRedaction.remoteSafe) throw new FlowError('jev.verify bloqueado: claim/evidence não são seguros para egress', 'JEV_VERIFY_REMOTE_STATE_UNSAFE');
    let verification;
    try {
      verification = await runtime.verifyExecutor({ claim: claimRedaction.text, evidence: evidenceRedaction.text, client: runtime.jevClient });
    } catch (error) {
      verification = { veredito: 'erro', erro: String(error?.message || error).slice(0, 200) };
    }
    const gate = runtime.gateExecutor(verification, { minSupport: Number(node.minSupport) || 0.6 });
    return { tipo: 'jev.verify', verification, gate, remoteCalled: true, redaction: { applied: claimRedaction.redacted || evidenceRedaction.redacted, categories: [...new Set([...(claimRedaction.categories || []), ...(evidenceRedaction.categories || [])])].sort() }, measurement: verification?.cost_usd_estimate != null ? 'estimated' : 'observed' };
  }
  if (node.type === 'metrics.emit') {
    const event = exactTemplateValue(node.event, context);
    const metric = sanitizeMetricValue(event);
    if (!metric || typeof metric !== 'object' || Array.isArray(metric)) throw new FlowError('metrics.emit exige evento redigível', 'METRICS_EVENT_UNSAFE');
    const receipt = { source: 'jev-flow', event: metric, measurement: 'observed' };
    try { await runtime.metricsEmitter(receipt); } catch { /* observabilidade nunca derruba o flow */ }
    return { tipo: 'metrics.emit', receipt, measurement: 'observed' };
  }
  if (node.type === 'rules.find') {
    const pergunta = interpolate(String(node.pergunta), context);
    const ruleset = node.ruleset
      ? loadRuleset(String(exactTemplateValue(node.ruleset, context) || ''))
      : { id: 'inline', nome: 'regras inline', regras: exactTemplateDeep(node.rules, context) };
    const req = buildFindRequest(ruleset, pergunta);
    // orçamento ANTES do egress — mesma régua do jev.ask
    if (runtime.usage.jevCalls + 1 > runtime.limits.maxJevCalls) {
      throw new FlowError(`flow excedeu orçamento de ${runtime.limits.maxJevCalls} julgamentos Jev`, 'FLOW_BUDGET_JEV_CALLS');
    }
    const reservedInputTokens = estimatedTokens({ state: req.state, questions: req.questions });
    if (runtime.usage.inputTokensBudgeted + reservedInputTokens > runtime.limits.maxInputTokens) {
      throw new FlowError(`flow excedeu orçamento de ${runtime.limits.maxInputTokens} tokens de input`, 'FLOW_BUDGET_INPUT_TOKENS');
    }
    const redaction = redactRemoteState(req.state);
    if (!redaction.remoteSafe) {
      throw new FlowError(redaction.tooLarge ? 'state do ruleset excede limite seguro' : 'state do ruleset ficou vazio ou inseguro após redação', 'JEV_REMOTE_STATE_UNSAFE');
    }
    const client = runtime.jevCached || runtime.jevClient;
    const res = await client.ask({ state: redaction.state, questions: req.questions });
    const cacheMeta = judgmentCacheMetadata(res);
    const cacheHit = cacheMeta?.transportCalled === false;
    runtime.usage.jevCalls++;
    runtime.usage.inputTokensBudgeted += reservedInputTokens;
    if (cacheHit) {
      runtime.usage.cacheHits++;
      runtime.usage.tokensAvoidedEstimated += reservedInputTokens;
    } else {
      runtime.usage.jevTransportCalls++;
      const observedInput = Number(res.usage?.input_tokens);
      if (Number.isFinite(observedInput)) runtime.usage.inputTokensObserved += observedInput;
      else runtime.usage.inputTokensEstimated += reservedInputTokens;
      const observedOutput = Number(res.usage?.output_tokens);
      if (Number.isFinite(observedOutput)) runtime.usage.outputTokensObserved += observedOutput;
    }
    const verdict = verdictFromAnswers(req.regras, res.answers, {
      rulesetId: ruleset.id,
      found: node.foundThreshold,
      absent: node.absentThreshold,
    });
    return {
      tipo: 'rules.find',
      ruleset: ruleset.id,
      ...verdict,
      usage: res.usage || null,
      latencia_ms: res.latencyMs ?? null,
      custo_usd_estimado: res.costEstimateUsd ?? null,
      cache: cacheMeta?.cache ?? (cacheHit ? 'hit' : null),
      remoteCalled: !cacheHit,
      redaction: { applied: redaction.redacted, categories: redaction.categories },
      measurement: res.costEstimateUsd != null ? 'estimated' : 'observed',
    };
  }
  return null;
}

function nodeReceipt(node, output, ok, error) {
  const canonicalType = normalizeNodeType(node.type);
  const definition = getNodeDefinition(canonicalType);
  const measurement = output?.measurement || output?.meta?.measurement || (definition?.remote ? 'estimated' : 'observed');
  return {
    source: `node-catalog:${canonicalType}`,
    costClass: definition?.costClass || 'unknown',
    riskClass: definition?.riskClass || 'unknown',
    remote: definition?.remote === true,
    remoteCalled: output?.remoteCalled === true || output?.meta?.transportCalled === true,
    jev: definition?.remote === true && (node.type.startsWith('jev.') || node.type === 'context.prune' || node.type === 'rules.find'),
    generator: definition?.generator === true,
    backend: output?.backend || output?.provider || null,
    measurement,
    ok,
    error: error || null,
  };
}

function makeRunId(flow) {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return `${timestamp}-${digest({ id: flow.id, timestamp, pid: process.pid }).slice(0, 8)}`;
}

export function flowCheckpointPath(flowId, runId, { dir = FLOWS_DIR } = {}) {
  assertFlowId(flowId);
  if (!/^[A-Za-z0-9_-]{8,100}$/u.test(String(runId || ''))) throw new FlowError('runId inválido', 'RUN_ID_INVALIDO');
  return join(dir, 'runs', flowId, `${runId}.checkpoint`);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  try {
    renameSync(temporary, path);
  } catch {
    writeFileSync(path, JSON.stringify(value, null, 2));
    try { unlinkSync(temporary); } catch { /* best-effort */ }
  }
}

function checkpointKey({ dir, path } = {}) {
  const configured = String(process.env.JEV_FLOW_CHECKPOINT_KEY || '').trim();
  if (configured) return createHash('sha256').update(configured, 'utf8').digest();
  const root = dir || (path ? dirname(dirname(dirname(path))) : FLOWS_DIR);
  const keyPath = join(root, '.checkpoint.key');
  mkdirSync(root, { recursive: true });
  if (!existsSync(keyPath)) {
    try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  const material = readFileSync(keyPath);
  if (material.length < 32) throw new FlowError('chave local de checkpoint inválida', 'CHECKPOINT_KEY_INVALIDA');
  return createHash('sha256').update(material).digest();
}

function encryptFlowCheckpoint(checkpoint, options = {}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', checkpointKey(options), iv);
  cipher.setAAD(Buffer.from(FLOW_CHECKPOINT_ENVELOPE_SCHEMA));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(checkpoint), 'utf8'), cipher.final()]);
  return {
    schema: FLOW_CHECKPOINT_ENVELOPE_SCHEMA,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptFlowCheckpoint(envelope, options = {}) {
  if (envelope?.schema !== FLOW_CHECKPOINT_ENVELOPE_SCHEMA || envelope?.algorithm !== 'aes-256-gcm') {
    throw new FlowError('envelope de checkpoint incompatível', 'CHECKPOINT_INVALIDO');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', checkpointKey(options), Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(FLOW_CHECKPOINT_ENVELOPE_SCHEMA));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError('checkpoint não pôde ser autenticado/descriptografado', 'CHECKPOINT_DECRYPT_FAILED');
  }
}

export function loadFlowCheckpoint(path) {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    const encrypted = stored?.schema === FLOW_CHECKPOINT_ENVELOPE_SCHEMA;
    const checkpoint = encrypted ? decryptFlowCheckpoint(stored, { path }) : stored;
    const valid = assertCheckpointIntegrity(checkpoint);
    try { assertCheckpointFresh(valid); }
    catch (error) {
      if (error?.code === 'CHECKPOINT_EXPIRED') try { unlinkSync(path); } catch { /* expiração continua válida sem remoção */ }
      throw error;
    }
    // Upgrade transparente de checkpoints legados em claro ao primeiro uso.
    if (!encrypted) writeJsonAtomic(path, encryptFlowCheckpoint(valid, { path }));
    return valid;
  } catch (error) {
    if (error instanceof FlowError) throw error;
    throw new FlowError(`checkpoint inválido: ${error?.message || error}`, 'CHECKPOINT_INVALIDO');
  }
}

function hasRuntimeWebhookAuthorization(steps, outputs) {
  let budgetAllowed = false;
  let verificationPassed = false;
  for (const step of steps) {
    if (!step?.ok) continue;
    const output = outputs?.[step.no];
    if (step.tipo === 'budget.guard' && output?.allowed === true) budgetAllowed = true;
    if (step.tipo === 'jev.verify' && output?.gate?.pass === true) verificationPassed = true;
  }
  return budgetAllowed && verificationPassed;
}

/**
 * Executa um flow. `input` alimenta {{input.*}}; jev.ask/jev.jevlet usam o
 * client (injetável p/ teste); action.webhook usa fetchImpl. Falha de nó
 * não derruba o run (fica registrada) a menos que o nó tenha onError:
 * "abortar". Runs persistem em data/jev/flows/runs/<id>/ (cap 20).
 */
export async function runFlow(flow, input = {}, {
  client,
  fetchImpl = fetch,
  dir = FLOWS_DIR,
  jevletDir = JEVLET_DIR,
  useCache = true,
  gravar = true,
  enforceUrlPolicy = true,
  resume = null,
  pauseAfterSteps = null,
  signal = null,
  skillExecutor = executeRegisteredSkill,
  pruner = null,
  verifyExecutor = verifyClaim,
  gateExecutor = gateResult,
  metricsEmitter = async () => {},
  logicEvaluator = evaluateReasoningGraph,
} = {}) {
  const validacao = validateFlow(flow);
  if (!validacao.ok) throw new FlowError(`flow inválido: ${validacao.errors[0]?.codigo} (${validacao.errors[0]?.msg})`, 'FLOW_INVALIDO');
  const inputValidacao = validateInput(flow, input);
  if (!inputValidacao.ok) throw new FlowError(`input inválido: ${inputValidacao.errors[0]?.codigo} (${inputValidacao.errors[0]?.msg})`, 'INPUT_INVALIDO');

  const limits = normalizedLimits(flow);
  const currentFlowFingerprint = flowFingerprint(flow);
  const currentInputFingerprint = digest(input);
  const resumeCheckpoint = typeof resume === 'string' ? loadFlowCheckpoint(resume) : resume;
  if (resumeCheckpoint) {
    if (!RESUMABLE_STATUSES.has(resumeCheckpoint.status)) throw new FlowError(`checkpoint não retomável: ${resumeCheckpoint.status}`, 'CHECKPOINT_NAO_RETOMAVEL');
    if (resumeCheckpoint.flowId !== flow.id || resumeCheckpoint.flowFingerprint !== currentFlowFingerprint) throw new FlowError('flow mudou desde o checkpoint', 'CHECKPOINT_FLOW_DIVERGIU');
    if (resumeCheckpoint.inputFingerprint !== currentInputFingerprint) throw new FlowError('input mudou desde o checkpoint', 'CHECKPOINT_INPUT_DIVERGIU');
    assertCheckpointIntegrity(resumeCheckpoint, flow);
    assertCheckpointFresh(resumeCheckpoint);
    if (resumeCheckpoint.pendingNode && flow.nodes?.[resumeCheckpoint.pendingNode]?.type === 'action.webhook') {
      throw new FlowError('efeito externo ficou incerto; observe/reconcilie antes de retomar', 'CHECKPOINT_EXTERNAL_EFFECT_UNKNOWN');
    }
    if (resumeCheckpoint.pendingNode && ['jev.ask', 'jev.jevlet'].includes(flow.nodes?.[resumeCheckpoint.pendingNode]?.type)) {
      throw new FlowError('julgamento Jev ficou incerto; reconcilie o receipt/cache antes de retomar', 'CHECKPOINT_JEV_EFFECT_UNKNOWN');
    }
  }

  const clone = value => JSON.parse(JSON.stringify(value));
  const context = resumeCheckpoint
    ? clone(resumeCheckpoint.context)
    : { input, vars: {}, flow: { id: flow.id, name: flow.name } };
  const steps = resumeCheckpoint ? clone(resumeCheckpoint.steps || []) : [];
  const outputs = resumeCheckpoint ? clone(resumeCheckpoint.outputs || {}) : {};
  let atual = resumeCheckpoint?.nextNode ?? flow.start;
  let abortou = false;
  let paused = false;
  let pauseReason = null;
  let executedThisCall = 0;
  const runId = resumeCheckpoint?.runId || makeRunId(flow);
  const createdAt = resumeCheckpoint?.createdAt || new Date().toISOString();
  const usage = {
    steps: Number(resumeCheckpoint?.usage?.steps) || steps.length,
    jevCalls: Number(resumeCheckpoint?.usage?.jevCalls) || 0,
    jevTransportCalls: Number(resumeCheckpoint?.usage?.jevTransportCalls) || 0,
    remoteCalls: Number(resumeCheckpoint?.usage?.remoteCalls) || 0,
    generatorCalls: Number(resumeCheckpoint?.usage?.generatorCalls) || 0,
    measurements: resumeCheckpoint?.usage?.measurements && typeof resumeCheckpoint.usage.measurements === 'object'
      ? { ...resumeCheckpoint.usage.measurements } : {},
    inputTokensBudgeted: Number(resumeCheckpoint?.usage?.inputTokensBudgeted) || 0,
    inputTokensObserved: Number(resumeCheckpoint?.usage?.inputTokensObserved) || 0,
    inputTokensEstimated: Number(resumeCheckpoint?.usage?.inputTokensEstimated) || 0,
    outputTokensObserved: Number(resumeCheckpoint?.usage?.outputTokensObserved) || 0,
    outputTokensEstimated: Number(resumeCheckpoint?.usage?.outputTokensEstimated) || 0,
    deterministicNodes: Number(resumeCheckpoint?.usage?.deterministicNodes) || 0,
    cacheHits: Number(resumeCheckpoint?.usage?.cacheHits) || 0,
    tokensAvoidedEstimated: Number(resumeCheckpoint?.usage?.tokensAvoidedEstimated) || 0,
    bytesSaved: Number(resumeCheckpoint?.usage?.bytesSaved) || 0,
  };

  const checkpointSnapshot = (status, extra = {}) => sealFlowCheckpoint({
    schema: FLOW_CHECKPOINT_SCHEMA,
    flowId: flow.id,
    flowFingerprint: currentFlowFingerprint,
    runId,
    input,
    inputFingerprint: currentInputFingerprint,
    status,
    nextNode: atual,
    context,
    steps,
    outputs,
    limits,
    usage,
    createdAt,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + FLOW_CHECKPOINT_TTL_MS).toISOString(),
    ...extra,
  });
  const persistCheckpoint = (status = 'running', extra = {}) => {
    const checkpoint = checkpointSnapshot(status, extra);
    if (gravar) writeJsonAtomic(flowCheckpointPath(flow.id, runId, { dir }), encryptFlowCheckpoint(checkpoint, { dir }));
    return checkpoint;
  };

  const jevBruto = client || new JevClient({ timeoutMs: 8000 });
  const jev = useCache ? withJudgmentCache(jevBruto, { ttlMs: 10 * 60 * 1000 }) : jevBruto;
  const runtime = {
    skillExecutor,
    pruner: pruner || pruneMessages,
    verifyExecutor,
    gateExecutor,
    metricsEmitter,
    logicEvaluator,
    usage,
    limits,
    jevClient: jevBruto,
    jevCached: jev,
  };

  while (atual) {
    if (signal?.aborted) {
      paused = true;
      pauseReason = 'signal-aborted';
      break;
    }
    if (usage.steps >= limits.maxSteps) {
      const checkpoint = persistCheckpoint('paused', { stopReason: 'max-steps' });
      const error = new FlowError(`flow excedeu orçamento de ${limits.maxSteps} passos`, 'FLOW_BUDGET_STEPS');
      error.checkpoint = checkpoint;
      throw error;
    }
    const node = flow.nodes[atual];
    if (!node) throw new FlowError(`nó "${atual}" não existe`, 'NO_INEXISTENTE');
    // Um crash entre o despacho e o receipt deixa o efeito explicitamente
    // pendente. Resume nunca repete webhook sem reconciliação humana/código.
    persistCheckpoint('running', { pendingNode: atual });

    const t0 = Date.now();
    let saida = {};
    let ok = true;
    let erro = null;
    let transportAttempted = false;

    try {
      if (node.type === 'jev.ask' || node.type === 'jev.jevlet') {
        if (usage.jevCalls + 1 > limits.maxJevCalls) throw new FlowError(`flow excedeu orçamento de ${limits.maxJevCalls} julgamentos Jev`, 'FLOW_BUDGET_JEV_CALLS');
        const questions = node.jevlet || node.type === 'jev.jevlet' ? null : buildQuestions(node.questions);
        const judgmentState = node.state == null ? input : exactTemplateDeep(node.state, context);
        const redaction = redactRemoteState(judgmentState);
        if (!redaction.remoteSafe) {
          throw new FlowError(redaction.tooLarge ? 'state remoto excede limite seguro' : 'state ficou vazio ou inseguro após redação', 'JEV_REMOTE_STATE_UNSAFE');
        }
        const remoteState = redaction.state;
        const reservedInputTokens = estimatedTokens(questions ? { state: remoteState, questions } : { state: remoteState, jevlet: node.jevlet }) + (questions ? 0 : 512);
        if (usage.inputTokensBudgeted + reservedInputTokens > limits.maxInputTokens) throw new FlowError(`flow excedeu orçamento de ${limits.maxInputTokens} tokens de input`, 'FLOW_BUDGET_INPUT_TOKENS');
        usage.jevCalls++;
        usage.inputTokensBudgeted += reservedInputTokens;
        if (node.jevlet || node.type === 'jev.jevlet') {
          const r = await invokeJevlet(node.jevlet, remoteState, {
            client: jevBruto,
            dir: jevletDir,
            useCache,
            requestMeta: {
              policyVersion: `jev-flow/${flow.version || 1}`,
              schemaVersion: 'jev-flow-jevlet/1',
              evidenceHash: currentInputFingerprint,
              systemId: flow.id,
              adapterVersion: 'jev-client-v1',
              purpose: `flow:${atual}`,
            },
          });
          saida = { tipo: 'jevlet', jevlet: node.jevlet, valores: r.valores, acao: r.politica?.acao ?? null, politica: r.politica, cache: r.cache, remoteCalled: r.transportCalled !== false, redaction: { applied: redaction.redacted, categories: redaction.categories } };
          if (r.transportCalled === false) {
            usage.cacheHits++;
            usage.tokensAvoidedEstimated += reservedInputTokens;
          } else {
            usage.jevTransportCalls++;
            const observedInput = Number(r.usage?.input_tokens);
            const observedOutput = Number(r.usage?.output_tokens);
            if (Number.isFinite(observedInput)) usage.inputTokensObserved += observedInput;
            else usage.inputTokensEstimated += reservedInputTokens;
            if (Number.isFinite(observedOutput)) usage.outputTokensObserved += observedOutput;
            else usage.outputTokensEstimated += estimatedTokens(r.respostas || r.valores || {});
          }
        } else {
          const res = await jev.ask({
            state: remoteState,
            questions,
            policyVersion: `jev-flow/${flow.version || 1}`,
            schemaVersion: 'jev-flow-node/1',
            evidenceHash: currentInputFingerprint,
            systemId: flow.id,
            adapterVersion: 'jev-client-v1',
            purpose: `flow:${atual}`,
          });
          if (useCache && typeof jev.flush === 'function') jev.flush();
          const cacheMeta = judgmentCacheMetadata(res);
          const cacheHit = cacheMeta?.transportCalled === false;
          if (cacheHit) {
            usage.cacheHits++;
            usage.tokensAvoidedEstimated += reservedInputTokens;
          } else {
            usage.jevTransportCalls++;
            const observedInput = Number(res.usage?.input_tokens);
            const observedOutput = Number(res.usage?.output_tokens);
            if (Number.isFinite(observedInput)) usage.inputTokensObserved += observedInput;
            else usage.inputTokensEstimated += reservedInputTokens;
            if (Number.isFinite(observedOutput)) usage.outputTokensObserved += observedOutput;
            else usage.outputTokensEstimated += estimatedTokens(res.answers || {});
          }
          saida = { tipo: 'ask', valores: normalizeInline(res.answers), respostas: res.answers, custo_usd_estimado: res.costEstimateUsd, latencia_ms: res.latencyMs, backend: res.backend || res.provider || null, cache: cacheMeta?.cache || (useCache ? 'miss' : 'off'), remoteCalled: !cacheHit, redaction: { applied: redaction.redacted, categories: redaction.categories } };
        }
      } else if (node.type === 'jev.classify') {
        if (usage.jevCalls + 1 > limits.maxJevCalls) throw new FlowError(`${limits.maxJevCalls} julgamentos Jev excedem o orçamento`, 'FLOW_BUDGET_JEV_CALLS');
        const textoClass = String(interpolate(String(node.texto ?? ''), context)).slice(0, 2000);
        const rawTaxonomia = exactTemplateValue(node.categorias, context);
        const taxonomia = (Array.isArray(rawTaxonomia) ? rawTaxonomia : []).map((cat) => String(cat));
        const subtaxonomia = Array.isArray(node.subcategorias) ? node.subcategorias.map((cat) => String(cat)) : null;
        if (!taxonomia.length) throw new FlowError('jev.classify sem categorias resolvíveis', 'CLASSIFY_CATEGORIAS_VAZIAS');
        const questions = {
          primaria: { type: 'choice', instructions: `Qual categoria descreve MELHOR o texto? Julgue somente pelo texto no state. Opções: ${taxonomia.join(', ')}.`, options: Object.fromEntries(taxonomia.map((cat) => [cat, cat])) },
        };
        if (subtaxonomia) questions.secundaria = { type: 'choice', instructions: `Qual subcategoria refina a classificação? Opções: ${subtaxonomia.join(', ')}.`, options: Object.fromEntries(subtaxonomia.map((cat) => [cat, cat])) };
        const redaction = redactRemoteState({ texto: textoClass });
        if (!redaction.remoteSafe) throw new FlowError('state do classify não é seguro para egress', 'JEV_REMOTE_STATE_UNSAFE');
        const reservedInputTokens = estimatedTokens({ state: redaction.state, questions });
        if (usage.inputTokensBudgeted + reservedInputTokens > limits.maxInputTokens) throw new FlowError(`${limits.maxInputTokens} tokens de input excedem o orçamento`, 'FLOW_BUDGET_INPUT_TOKENS');
        usage.jevCalls++;
        usage.inputTokensBudgeted += reservedInputTokens;
        const res = await jev.ask({ state: redaction.state, questions, policyVersion: `jev-flow/${flow.version || 1}`, schemaVersion: 'jev-flow-classify/1', evidenceHash: currentInputFingerprint, systemId: flow.id, adapterVersion: 'jev-client-v1', purpose: `flow:${atual}` });
        if (useCache && typeof jev.flush === 'function') jev.flush();
        const cacheMeta = judgmentCacheMetadata(res);
        const cacheHit = cacheMeta?.transportCalled === false;
        if (cacheHit) { usage.cacheHits++; usage.tokensAvoidedEstimated += reservedInputTokens; }
        else { usage.jevTransportCalls++; const observedInput = Number(res.usage?.input_tokens); if (Number.isFinite(observedInput)) usage.inputTokensObserved += observedInput; else usage.inputTokensEstimated += reservedInputTokens; }
        const categoriasResp = res.answers?.primaria;
        const categoria = taxonomia.includes(categoriasResp?.choice) ? categoriasResp.choice : null;
        const rawConfidence = categoriasResp?.confidence;
        const confianca = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence) && rawConfidence >= 0 && rawConfidence <= 1 ? rawConfidence : null;
        const subcategoria = subtaxonomia?.includes(res.answers?.secundaria?.choice) ? res.answers.secundaria.choice : null;
        saida = { tipo: 'classify', categoria, subcategoria, confianca,
          confiancaTipo: 'concentracao-da-distribuicao',
          confiancaAviso: 'Concentração da distribuição Choice; não é probabilidade de acerto.',
          probabilidades: categoriasResp?.probabilities ?? null,
          precisa_revisao: categoria === null || confianca === null || confianca < 0.5,
          custo_usd_estimado: res.costEstimateUsd, cache: cacheMeta?.cache || (useCache ? 'miss' : 'off'), redaction: { applied: redaction.redacted, categories: redaction.categories } };
      } else if (node.type === 'jev.rerank') {
        if (usage.jevCalls + 1 > limits.maxJevCalls) throw new FlowError(`flow excedeu orçamento de ${limits.maxJevCalls} julgamentos Jev`, 'FLOW_BUDGET_JEV_CALLS');
        const rawItems = exactTemplateValue(node.items, context);
        const items = Array.isArray(rawItems) ? rawItems : [];
        const maxItems = Math.min(10, Math.max(1, Number(node.maxItems) || 10));
        if (items.length > maxItems)
          throw new FlowError(`jev.rerank recebeu ${items.length} itens; máximo ${maxItems}`, 'RERANK_ITEMS_EXCEDENTES');
        const slice = items.slice(0, maxItems).map((it, i) => {
          const item = typeof it === 'string' ? it : canonicalJson(it);
          if (typeof item !== 'string' || item.length > 300)
            throw new FlowError(`jev.rerank item ${i} não é serializável ou excede 300 caracteres`, 'RERANK_ITEM_INVALIDO');
          return { n: i, item };
        });
        if (!slice.length) throw new FlowError('jev.rerank sem itens resolvíveis no contexto', 'RERANK_ITEMS_VAZIOS');
        const pergunta = interpolate(node.question, context).trim().slice(0, 300);
        if (!pergunta) throw new FlowError('jev.rerank requer pergunta não vazia', 'RERANK_PERGUNTA_VAZIA');
        const questions = {};
        for (const it of slice) questions[`rel_${it.n}`] = { type: 'noul', instructions: `O item ${it.n} contém informação diretamente pertinente à pergunta no state? Julgue somente o conteúdo deste item; não presuma resposta ausente.` };
        const redaction = redactRemoteState({ pergunta, itens: slice });
        if (!redaction.remoteSafe) throw new FlowError(redaction.tooLarge ? 'state do rerank excede limite seguro' : 'state do rerank ficou vazio ou inseguro após redação', 'JEV_REMOTE_STATE_UNSAFE');
        const reservedInputTokens = estimatedTokens({ state: redaction.state, questions });
        if (usage.inputTokensBudgeted + reservedInputTokens > limits.maxInputTokens) throw new FlowError(`flow excedeu orçamento de ${limits.maxInputTokens} tokens de input`, 'FLOW_BUDGET_INPUT_TOKENS');
        usage.jevCalls++;
        usage.inputTokensBudgeted += reservedInputTokens;
        const res = await jev.ask({
          state: redaction.state,
          questions,
          policyVersion: `jev-flow/${flow.version || 1}`,
          schemaVersion: 'jev-flow-rerank/1',
          evidenceHash: currentInputFingerprint,
          systemId: flow.id,
          adapterVersion: 'jev-client-v1',
          purpose: `flow:${atual}`,
        });
        if (useCache && typeof jev.flush === 'function') jev.flush();
        const cacheMeta = judgmentCacheMetadata(res);
        const cacheHit = cacheMeta?.transportCalled === false;
        if (cacheHit) {
          usage.cacheHits++;
          usage.tokensAvoidedEstimated += reservedInputTokens;
        } else {
          usage.jevTransportCalls++;
          const observedInput = Number(res.usage?.input_tokens);
          if (Number.isFinite(observedInput)) usage.inputTokensObserved += observedInput;
          else usage.inputTokensEstimated += reservedInputTokens;
        }
        const scored = slice.map(it => {
          const score = res.answers?.[`rel_${it.n}`]?.noul;
          if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1)
            throw new FlowError(`julgamento rerank rel_${it.n} ausente ou inválido`, 'RERANK_JULGAMENTO_INVALIDO');
          return { item: items[it.n], index: it.n, score };
        });
        scored.sort((a, b) => b.score - a.score);
        saida = {
          tipo: 'rerank',
          ranked: scored,
          top: scored[0]?.item ?? null,
          topScore: scored[0]?.score ?? 0,
          scores: Object.fromEntries(scored.map(sc => [String(sc.index), sc.score])),
          itensAvaliados: slice.length,
          custo_usd_estimado: res.costEstimateUsd,
          cache: cacheMeta?.cache || (useCache ? 'miss' : 'off'),
          redaction: { applied: redaction.redacted, categories: redaction.categories },
        };
      } else if (node.type.startsWith('rule.') || node.type === 'context.compact' || node.type === 'flow.ensemble') {
        saida = executeDeterministicNode(node, context);
        usage.bytesSaved += Number(saida?.charsSaved) || 0;
      } else if (['det.skill', 'context.prune', 'budget.guard', 'jev.verify', 'metrics.emit', 'rules.find', 'logic.subgraph', 'logic.graph'].includes(normalizeNodeType(node.type))) {
        saida = await executeExtendedNode(node, context, runtime);
        if (node.type === 'context.prune') {
          usage.bytesSaved += Number(saida?.meta?.bytesSaved || saida?.meta?.candidateBytesSaved || 0) || 0;
          if (saida?.meta?.transportCalled === true) { usage.jevCalls++; usage.jevTransportCalls++; }
          if (saida?.meta?.cacheHit === true) usage.cacheHits++;
        }
        if (node.type === 'jev.verify') {
          usage.jevCalls++;
          usage.jevTransportCalls++;
        }
      } else if (node.type === 'action.webhook') {
        if (!hasRuntimeWebhookAuthorization(steps, outputs)) {
          throw new FlowError('action.webhook bloqueado: receipts de budget.guard e jev.verify aprovado ausentes', 'WEBHOOK_AUTORIZACAO_RUNTIME_AUSENTE');
        }
        const url = interpolate(node.url, context);
        const policy = enforceUrlPolicy
          ? await inspectUrlPolicy(url)
          : { ok: true, url: new URL(url), privateAllowed: true };
        if (!policy.ok) {
          const error = new Error(`${policy.code}: ${policy.reason}`);
          error.code = policy.code;
          error.profileId = policy.profileId;
          throw error;
        }
        const outboundUrl = policy.url;
        const body = JSON.parse(interpolate(JSON.stringify(node.body ?? {}), context));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), node.timeoutMs || 8000);
        const nativeFetch = fetchImpl === globalThis.fetch;
        const dispatcher = enforceUrlPolicy && nativeFetch && policy.privateAllowed !== true
          ? createSafeDnsDispatcher()
          : null;
        let resp;
        try {
          const fetchOptions = {
            method: node.method || 'POST',
            headers: { 'content-type': 'application/json', ...(node.headers || {}) },
            body: JSON.stringify(body),
            signal: controller.signal,
            redirect: 'error',
          };
          if (dispatcher) fetchOptions.dispatcher = dispatcher;
          transportAttempted = true;
          resp = await fetchImpl(outboundUrl, fetchOptions);
          saida = { tipo: 'webhook', url: outboundUrl.href, status: resp.status, ok: resp.ok, remoteCalled: true, measurement: 'observed' };
          if (!resp.ok) { ok = false; erro = `webhook ${resp.status}`; }
        } finally {
          clearTimeout(timer);
          try { await resp?.body?.cancel(); } catch { /* best-effort body drain */ }
          try { await dispatcher?.close(); } catch { /* best-effort pool close */ }
        }
      } else if (node.type === 'action.log') {
        saida = { tipo: 'log', linha: interpolate(node.texto ?? `flow ${flow.id}`, context) };
      } else if (node.type === 'action.set') {
        const valores = {};
        for (const [k, v] of Object.entries(node.values || {})) valores[k] = interpolate(String(v), context);
        Object.assign(context.vars, valores);
        saida = { tipo: 'set', valores };
      } else if (node.type === 'flow.if' || node.type === 'flow.switch') {
        saida = { tipo: node.type };
      } else {
        throw new FlowError(`tipo não executável: ${node.type}`, 'TIPO_INVALIDO');
      }
    } catch (e) {
      ok = false;
      erro = String(e?.message || e).slice(0, 300);
      saida = {
        tipo: node.type,
        erro,
        code: e?.code || null,
        ...(transportAttempted ? { remoteCalled: true, measurement: 'observed' } : {}),
      };
    }

    if (DETERMINISTIC_NODE_TYPES.has(normalizeNodeType(node.type))) usage.deterministicNodes++;
    outputs[atual] = saida;
    context[atual] = saida; // nós executados ficam visíveis nas expressões seguintes
    const receipt = nodeReceipt(node, saida, ok, erro);
    if (receipt.remoteCalled) usage.remoteCalls++;
    if (receipt.generator) usage.generatorCalls++;
    usage.measurements[receipt.measurement] = (usage.measurements[receipt.measurement] || 0) + 1;
    steps.push({ no: atual, tipo: node.type, ok, erro, ms: Date.now() - t0, resumo: resumir(saida), receipt });
    usage.steps = steps.length;
    executedThisCall++;

    if (!ok && (node.onError === 'abortar' || BUDGET_ERROR_CODES.has(saida.code) || String(saida.code || '').startsWith('FLOW_BUDGET_GUARD_'))) {
      abortou = true;
      atual = null;
      break;
    }
    try {
      atual = proximoDo(node, context);
    } catch (e) {
      const step = steps[steps.length - 1];
      step.ok = false;
      step.erro = String(e?.message || e).slice(0, 300);
      step.resumo = `roteamento: ${step.erro}`;
      outputs[atual] = { ...outputs[atual], erro: step.erro, code: e?.code || 'ROTEAMENTO_INVALIDO' };
      abortou = true;
      atual = null;
    }
    persistCheckpoint('running');
    if (Number.isInteger(pauseAfterSteps) && pauseAfterSteps > 0 && executedThisCall >= pauseAfterSteps && atual) {
      paused = true;
      pauseReason = 'pause-after-steps';
      break;
    }
  }

  const status = paused ? 'paused' : abortou ? 'aborted' : 'completed';
  const finalCheckpoint = paused ? persistCheckpoint('paused', { stopReason: pauseReason }) : null;
  const run = {
    flow: flow.id,
    flowFingerprint: currentFlowFingerprint,
    runId,
    status,
    executado_em: new Date().toISOString(),
    input,
    steps,
    path: steps.map(s => s.no),
    outputs,
    receipts: steps.map(step => step.receipt),
    vars: context.vars,
    abortou,
    nextNode: atual,
    limits,
    usage,
    checkpoint: finalCheckpoint,
    ok: status === 'completed' && steps.every(s => s.ok),
  };

  if (gravar && status !== 'paused') {
    const runsDir = join(dir, 'runs', flow.id);
    try {
      mkdirSync(runsDir, { recursive: true });
      const arquivos = readdirSync(runsDir).filter(f => f.endsWith('.json')).sort();
      if (arquivos.length >= 20) {
        for (const f of arquivos.slice(0, arquivos.length - 19)) {
          try { unlinkSync(join(runsDir, f)); } catch { /* ok */ }
        }
      }
      writeJsonAtomic(join(runsDir, `${runId}.json`), projectRunForPublic(run));
      try { unlinkSync(flowCheckpointPath(flow.id, runId, { dir })); } catch { /* já removido */ }
    } catch { /* persistência best-effort */ }
  }

  return run;
}

/** Retoma exatamente do próximo nó persistido, sem repetir os já concluídos. */
export async function resumeFlow(flow, checkpointOrPath, options = {}) {
  const checkpoint = typeof checkpointOrPath === 'string'
    ? loadFlowCheckpoint(checkpointOrPath)
    : checkpointOrPath;
  if (!checkpoint || typeof checkpoint !== 'object') throw new FlowError('checkpoint ausente', 'CHECKPOINT_INVALIDO');
  return runFlow(flow, checkpoint.input, { ...options, resume: checkpoint });
}

function resumir(saida) {
  if (!saida || typeof saida !== 'object') return '';
  if (saida.tipo === 'ask' || saida.tipo === 'jevlet') {
    const vals = Object.entries(saida.valores || {}).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(' ');
    return saida.tipo === 'jevlet' ? `acao=${saida.acao} ${vals}` : vals;
  }
  if (saida.tipo === 'webhook') return `${saida.status} ${saida.url}`;
  if (saida.tipo === 'rules.find') return `regra=${saida.regra || '—'} existe=${saida.existe?.toFixed(2) ?? '—'} ${saida.veredicto}`;
  if (saida.tipo === 'log') return String(saida.linha).slice(0, 120);
  if (saida.tipo === 'set') return Object.keys(saida.valores || {}).join(',');
  return saida.tipo || '';
}
