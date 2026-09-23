// Núcleo puro e conservador para pequenos grafos de raciocínio declarativos.
// A DSL é JSON-only: não há eval, import dinâmico, rede ou efeitos externos.

export const LOGIC_GRAPH_VERSION = 'logic.graph/1';
export const REASONING_GRAPH_VERSION = LOGIC_GRAPH_VERSION;
export const FACT_STATES = Object.freeze(['true', 'false', 'unknown', 'controversial']);

const ID_RE = /^[a-z][a-z0-9_.:-]{0,80}$/u;
const UNKNOWN_REASONS = new Set(['absence_of_evidence', 'unknown_fact', 'outside_temporal_validity', 'unsupported_condition']);

const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const clip = (value, max = 240) => String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);

function canonical(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function firstNonJson(value, seen = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'non-finite-number';
  if (typeof value !== 'object' || depth > 20) return typeof value === 'object' ? 'depth-limit' : 'non-json-value';
  if (seen.has(value)) return 'cycle';
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const error = firstNonJson(child, seen, depth + 1);
    if (error) return error;
  }
  seen.delete(value);
  return null;
}

export function normalizeFactState(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  const state = String(value ?? '').toLowerCase().trim();
  if (state === 'true' || state === 'false' || state === 'unknown' || state === 'controversial') return state;
  return null;
}

function normalizeCollection(value, prefix) {
  if (Array.isArray(value)) return value.map((item, index) => [String(item?.id || `${prefix}-${index + 1}`), item]);
  if (value && typeof value === 'object') return Object.entries(value).map(([id, item]) => [id, item]);
  return [];
}

function collectEvidenceRefs(value, refs = new Set(), seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return refs;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['evidence', 'evidenceId', 'evidenceIds', 'proof', 'proofs'].includes(key)) {
      for (const id of asArray(child)) if (typeof id === 'string') refs.add(id);
    }
    if (child && typeof child === 'object') collectEvidenceRefs(child, refs, seen);
  }
  seen.delete(value);
  return refs;
}

function collectInvalidDates(value, path = '', errors = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return errors;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (['validFrom', 'validUntil', 'validAt', 'at'].includes(key) && child != null && child !== '') {
      const values = typeof child === 'object' && !Array.isArray(child) ? Object.values(child) : [child];
      for (const date of values) if (typeof date === 'string' && Number.isNaN(dateValue(date))) errors.push({ code: 'GRAPH_DATE_INVALID', field: childPath, message: `data inválida em ${childPath}` });
    }
    if (key === 'during' && child && typeof child === 'object') {
      for (const [rangeKey, date] of Object.entries(child)) if (['from', 'to', 'validFrom', 'validUntil', 'at'].includes(rangeKey) && typeof date === 'string' && Number.isNaN(dateValue(date))) errors.push({ code: 'GRAPH_DATE_INVALID', field: `${childPath}.${rangeKey}`, message: `data inválida em ${childPath}.${rangeKey}` });
    }
    if (child && typeof child === 'object') collectInvalidDates(child, childPath, errors, seen);
  }
  seen.delete(value);
  return errors;
}

function conclusionIdSet(graph) {
  const ids = new Set(normalizeCollection(graph.conclusions, 'conclusion').map(([id]) => id));
  for (const [, rule] of normalizeCollection(graph.rules, 'rule')) {
    const id = ruleConclusion(rule && typeof rule === 'object' ? rule : {}).id;
    if (id) ids.add(id);
  }
  return ids;
}

function collectIncompatibilityRefs(graph, refs = []) {
  for (const [id, definitionValue] of normalizeCollection(graph.conclusions, 'conclusion')) {
    for (const other of asArray(definitionValue?.incompatibleWith ?? definitionValue?.incompatible_with)) refs.push({ from: id, to: String(other) });
  }
  if (graph.incompatibleWith && typeof graph.incompatibleWith === 'object' && !Array.isArray(graph.incompatibleWith)) {
    for (const [id, others] of Object.entries(graph.incompatibleWith)) for (const other of asArray(others)) refs.push({ from: id, to: String(other) });
  }
  for (const conflict of asArray(graph.conflicts)) {
    const ids = conflict?.between ?? conflict?.conclusions ?? conflict?.ids;
    if (Array.isArray(ids) && ids.length === 2) refs.push({ from: String(ids[0]), to: String(ids[1]) });
  }
  return refs;
}

function incompatibilityPairs(graph) {
  const pairs = new Set();
  const add = (left, right) => {
    const ids = [String(left), String(right)].sort();
    if (ids[0] !== ids[1]) pairs.add(ids.join('\u0000'));
  };
  for (const ref of collectIncompatibilityRefs(graph)) add(ref.from, ref.to);
  const groups = new Map();
  for (const [id, definitionValue] of normalizeCollection(graph.conclusions, 'conclusion')) {
    const group = definitionValue?.conclusionGroup ?? definitionValue?.group;
    if (group) groups.set(String(group), [...(groups.get(String(group)) || []), id]);
  }
  for (const [, rule] of normalizeCollection(graph.rules, 'rule')) {
    const target = ruleConclusion(rule && typeof rule === 'object' ? rule : {});
    const group = target.payload?.conclusionGroup ?? target.payload?.group ?? rule?.conclusionGroup ?? rule?.group;
    if (group && target.id) groups.set(String(group), [...(groups.get(String(group)) || []), target.id]);
  }
  if (graph.conclusionGroups && typeof graph.conclusionGroups === 'object') {
    for (const [group, ids] of Object.entries(graph.conclusionGroups)) groups.set(group, [...(groups.get(group) || []), ...asArray(ids).map(String)]);
  }
  for (const ids of groups.values()) for (let index = 0; index < ids.length; index++) for (let next = index + 1; next < ids.length; next++) add(ids[index], ids[next]);
  return [...pairs].map(pair => pair.split('\u0000'));
}

function normalizeFact(id, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : { value: raw };
  const explicit = normalizeFactState(source.state ?? source.status);
  const valueState = normalizeFactState(source.value);
  const state = explicit || valueState || (source.value !== undefined ? 'true' : 'unknown');
  return {
    id,
    state,
    value: source.value,
    evidence: asArray(source.evidence ?? source.evidenceIds).map(String),
    validFrom: source.validFrom ?? source.valid_from ?? source.validity?.from ?? null,
    validUntil: source.validUntil ?? source.valid_until ?? source.validity?.until ?? null,
    source: source.source ?? source.responsible ?? null,
    confidence: finite(source.confidence) ? source.confidence : null,
    raw: source,
  };
}

function normalizeEvidence(id, raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : { value: raw };
  return {
    id,
    state: String(source.state ?? source.status ?? (source.supports ? 'supports' : source.against ? 'against' : 'present')).toLowerCase(),
    supports: asArray(source.supports ?? source.supportsFacts).map(String),
    against: asArray(source.against ?? source.contradicts).map(String),
    value: source.value,
    source: source.source ?? source.responsible ?? null,
    strength: finite(source.strength) ? source.strength : finite(source.confidence) ? source.confidence : null,
    validFrom: source.validFrom ?? source.valid_from ?? source.validity?.from ?? null,
    validUntil: source.validUntil ?? source.valid_until ?? source.validity?.until ?? null,
    raw: source,
  };
}

function dateValue(value) {
  if (value == null || value === '') return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : Number.NaN;
}

function activeAt(item, now) {
  const at = dateValue(now);
  if (Number.isNaN(at)) return { active: false, reason: 'invalid_date' };
  const from = dateValue(item?.validFrom);
  const until = dateValue(item?.validUntil);
  if (Number.isNaN(from) || Number.isNaN(until)) return { active: false, reason: 'invalid_date' };
  if (from != null && at < from) return { active: false, reason: 'outside_temporal_validity' };
  if (until != null && at > until) return { active: false, reason: 'outside_temporal_validity' };
  return { active: true, reason: null };
}

function resolvePath(value, path) {
  let current = value;
  for (const part of String(path || '').split('.')) {
    if (!part) continue;
    if (current == null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function operand(value, facts, state) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.fact === 'string') {
      const fact = facts.get(value.fact);
      if (!fact) return { missing: true, value: undefined, state: 'unknown', reason: 'absence_of_evidence', fact: value.fact };
      return { value: value.path ? resolvePath(fact, value.path) : fact.value, state: fact.state, fact: value.fact };
    }
    if (typeof value.path === 'string') return { value: resolvePath(state, value.path), state: 'true' };
    if (Object.hasOwn(value, 'literal')) return { value: value.literal, state: 'true' };
  }
  return { value, state: 'true' };
}

function combine(states, mode) {
  if (!states.length) return 'unknown';
  if (mode === 'all') {
    if (states.includes('false')) return 'false';
    if (states.includes('controversial')) return 'controversial';
    if (states.includes('unknown')) return 'unknown';
    return 'true';
  }
  if (states.includes('true')) return 'true';
  if (states.includes('controversial')) return 'controversial';
  if (states.includes('unknown')) return 'unknown';
  return 'false';
}

function conditionResult(state, reason, extra = {}) {
  return { state, reason: reason || null, premises: extra.premises || [], proofs: extra.proofs || [], trace: extra.trace || [] };
}

function compare(left, operator, right) {
  if (operator === '==' || operator === '===') return canonical(left) === canonical(right);
  if (operator === '!=' || operator === '!==') return canonical(left) !== canonical(right);
  if (['>', '>=', '<', '<='].includes(operator)) {
    if (!finite(left) || !finite(right)) return null;
    if (operator === '>') return left > right;
    if (operator === '>=') return left >= right;
    if (operator === '<') return left < right;
    return left <= right;
  }
  return null;
}

function mergeChildren(results, mode, expression) {
  const state = combine(results.map(result => result.state), mode);
  const reasons = results.map(result => result.reason).filter(Boolean);
  return conditionResult(state, reasons[0] || null, {
    premises: results.flatMap(result => result.premises),
    proofs: results.flatMap(result => result.proofs),
    trace: [{ kind: 'condition', operator: mode, expression: clip(canonical(expression)), state }, ...results.flatMap(result => result.trace)],
  });
}

function evaluateCondition(condition, facts, evidence, state, now, depth = 0) {
  if (depth > 12) return conditionResult('unknown', 'unsupported_condition', { trace: [{ kind: 'condition', state: 'unknown', reason: 'unsupported_condition' }] });
  if (condition === true) return conditionResult('true');
  if (condition === false) return conditionResult('false');
  if (typeof condition === 'string') return evaluateCondition({ fact: condition }, facts, evidence, state, now, depth + 1);
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return conditionResult('unknown', 'unsupported_condition');
  if (Array.isArray(condition.all)) return mergeChildren(condition.all.map(item => evaluateCondition(item, facts, evidence, state, now, depth + 1)), 'all', condition);
  if (Array.isArray(condition.any)) return mergeChildren(condition.any.map(item => evaluateCondition(item, facts, evidence, state, now, depth + 1)), 'any', condition);
  if (condition.not !== undefined) {
    const child = evaluateCondition(condition.not, facts, evidence, state, now, depth + 1);
    const inverted = child.state === 'true' ? 'false' : child.state === 'false' ? 'true' : child.state;
    return conditionResult(inverted, child.reason, { premises: child.premises, proofs: child.proofs, trace: [{ kind: 'condition', operator: 'not', state: inverted }, ...child.trace] });
  }
  if (condition.compare || condition.comparison) {
    const spec = condition.compare || condition.comparison;
    const left = operand(spec.left, facts, state);
    const right = operand(spec.right, facts, state);
    if (left.state !== 'true' || right.state !== 'true' || left.missing || right.missing) {
      return conditionResult('unknown', left.reason || right.reason || 'unknown_fact', { premises: [left.fact, right.fact].filter(Boolean), trace: [{ kind: 'comparison', state: 'unknown', reason: left.reason || right.reason || 'unknown_fact' }] });
    }
    const operator = spec.operator || spec.op;
    const matched = compare(left.value, operator, right.value);
    if (matched == null) return conditionResult('unknown', ['>', '>=', '<', '<='].includes(operator) ? 'comparison_invalid_numbers' : 'unsupported_condition', { premises: [left.fact, right.fact].filter(Boolean), trace: [{ kind: 'comparison', operator, left: left.value, right: right.value, state: 'unknown', reason: 'comparison_invalid_numbers' }] });
    return conditionResult(matched ? 'true' : 'false', null, { premises: [left.fact, right.fact].filter(Boolean), trace: [{ kind: 'comparison', operator, left: left.value, right: right.value, state: matched ? 'true' : 'false' }] });
  }
  if (condition.evidence !== undefined) {
    const id = String(condition.evidence);
    const item = evidence.get(id);
    if (!item) return conditionResult('unknown', 'absence_of_evidence', { proofs: [id], trace: [{ kind: 'evidence', id, state: 'unknown', reason: 'absence_of_evidence' }] });
    const expected = String(condition.is ?? condition.state ?? condition.status ?? 'present').toLowerCase();
    const target = condition.supports || condition.for;
    const targetMatch = target == null || item.supports.includes(String(target));
    const matched = expected === 'present' ? true : expected === item.state;
    const finalState = targetMatch && matched ? 'true' : 'false';
    return conditionResult(finalState, null, { proofs: [id], trace: [{ kind: 'evidence', id, state: finalState }] });
  }
  if (condition.fact !== undefined) {
    const id = String(condition.fact);
    const fact = facts.get(id);
    if (!fact) return conditionResult('unknown', 'absence_of_evidence', { premises: [id], trace: [{ kind: 'fact', id, state: 'unknown', reason: 'absence_of_evidence' }] });
    const active = activeAt(fact, now);
    if (!active.active) return conditionResult('unknown', active.reason, { premises: [id], proofs: fact.evidence, trace: [{ kind: 'fact', id, state: 'unknown', reason: active.reason }] });
    const expectedState = normalizeFactState(condition.is ?? condition.state ?? condition.status);
    let matched = expectedState ? fact.state === expectedState : fact.state === 'true';
    if (condition.exists === true) matched = true;
    if (condition.operator || condition.op) {
      const operator = condition.operator || condition.op;
      const comparison = compare(fact.value, operator, condition.value ?? condition.expected);
      if (comparison == null) return conditionResult('unknown', ['>', '>=', '<', '<='].includes(operator) ? 'comparison_invalid_numbers' : 'unsupported_condition', { premises: [id], proofs: fact.evidence, trace: [{ kind: 'comparison', operator, state: 'unknown', reason: 'comparison_invalid_numbers' }] });
      matched = comparison === true;
    } else if (condition.equals !== undefined) matched = canonical(fact.value) === canonical(condition.equals);
    const finalState = condition.exists === true ? 'true' : expectedState ? (matched ? 'true' : fact.state === 'unknown' || fact.state === 'controversial' ? fact.state : 'false') : fact.state;
    return conditionResult(finalState, finalState === 'unknown' ? 'unknown_fact' : null, { premises: [id], proofs: fact.evidence, trace: [{ kind: 'fact', id, state: finalState, value: fact.value }] });
  }
  if (condition.validAt || condition.during) {
    const range = condition.validAt || condition.during;
    const at = dateValue(condition.at || now);
    const from = dateValue(typeof range === 'string' ? range : range?.from ?? range?.validFrom ?? range?.at);
    const until = dateValue(typeof range === 'string' ? range : range?.to ?? range?.validUntil);
    if ([at, from, until].some(value => Number.isNaN(value))) return conditionResult('unknown', 'invalid_date');
    const matched = at != null && (from == null || at >= from) && (until == null || at <= until);
    return conditionResult(matched ? 'true' : 'false', matched ? null : 'outside_temporal_validity');
  }
  return conditionResult('unknown', 'unsupported_condition');
}

function ruleConclusion(rule) {
  const then = rule.then && typeof rule.then === 'object' ? rule.then : {};
  const raw = rule.conclusion ?? then.conclusion ?? then.id;
  const id = typeof raw === 'string' ? raw : raw?.id;
  const payload = raw && typeof raw === 'object' ? raw : then;
  return { id: id ? String(id) : null, payload };
}

function evidenceFor(rule, conditionResultValue, facts, evidence) {
  const proofs = [...new Set([
    ...asArray(rule.evidence ?? rule.proof ?? rule.proofs).map(String),
    ...conditionResultValue.proofs,
    ...conditionResultValue.premises.flatMap(id => facts.get(id)?.evidence || []),
  ])];
  return { proofs, missingProofs: proofs.filter(id => !evidence.has(id)) };
}

function gateFor(conclusion, graph, facts, evidence, state, now) {
  const gates = asArray(graph.gates).filter(gate => gate && String(gate.conclusion ?? gate.for) === conclusion.id);
  const checks = [];
  for (const gate of gates) {
    const threshold = finite(gate.threshold) ? gate.threshold : 0.6;
    const ref = gate.value ?? gate.probability ?? gate.score;
    const resolved = operand(ref, facts, state);
    const observed = finite(resolved.value) ? resolved.value : null;
    const condition = gate.when || gate.condition;
    const conditionResultValue = condition ? evaluateCondition(condition, facts, evidence, state, now) : null;
    const pass = conditionResultValue ? conditionResultValue.state === 'true' : observed != null && observed >= threshold;
    checks.push({ id: gate.id || null, threshold, observed, pass, state: conditionResultValue?.state || (observed == null ? 'unknown' : pass ? 'true' : 'false') });
  }
  return checks;
}

export function validateReasoningGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return [{ code: 'GRAPH_INVALID', message: 'logic.graph exige objeto JSON' }];
  if (graph.version !== LOGIC_GRAPH_VERSION) errors.push({ code: 'GRAPH_VERSION_INVALID', message: `version deve ser ${LOGIC_GRAPH_VERSION}` });
  for (const [kind, collection] of [['facts', graph.facts], ['evidence', graph.evidence], ['rules', graph.rules], ['conclusions', graph.conclusions]]) {
    if (collection != null && typeof collection !== 'object') errors.push({ code: 'GRAPH_COLLECTION_INVALID', field: kind, message: `${kind} deve ser array ou objeto` });
  }
  const jsonError = firstNonJson(graph);
  if (jsonError) errors.push({ code: 'GRAPH_NOT_JSON', message: `DSL deve ser JSON-only (${jsonError})` });
  for (const [id] of normalizeCollection(graph.facts, 'fact')) if (!ID_RE.test(id)) errors.push({ code: 'GRAPH_ID_INVALID', field: `facts.${id}`, message: 'id inválido' });
  for (const [id] of normalizeCollection(graph.rules, 'rule')) if (!ID_RE.test(id)) errors.push({ code: 'GRAPH_ID_INVALID', field: `rules.${id}`, message: 'id inválido' });
  const evidenceIds = new Set(normalizeCollection(graph.evidence, 'evidence').map(([id]) => id));
  const evidenceRefs = new Set();
  for (const [, item] of normalizeCollection(graph.facts, 'fact')) collectEvidenceRefs(item, evidenceRefs);
  for (const [, item] of normalizeCollection(graph.rules, 'rule')) collectEvidenceRefs(item, evidenceRefs);
  for (const [, item] of normalizeCollection(graph.conclusions, 'conclusion')) collectEvidenceRefs(item, evidenceRefs);
  for (const [, item] of normalizeCollection(graph.gates, 'gate')) collectEvidenceRefs(item, evidenceRefs);
  for (const id of evidenceRefs) if (!evidenceIds.has(id)) errors.push({ code: 'GRAPH_EVIDENCE_REF_INVALID', field: `evidence.${id}`, message: `evidência ausente: ${id}` });
  errors.push(...collectInvalidDates(graph));
  const conclusionIds = conclusionIdSet(graph);
  if (graph.conflicts != null && !Array.isArray(graph.conflicts) && (typeof graph.conflicts !== 'object' || graph.conflicts === null)) errors.push({ code: 'GRAPH_CONFLICTS_INVALID', field: 'conflicts', message: 'conflicts deve ser array JSON' });
  if (graph.incompatibleWith != null && (typeof graph.incompatibleWith !== 'object' || Array.isArray(graph.incompatibleWith))) errors.push({ code: 'GRAPH_INCOMPATIBLE_INVALID', field: 'incompatibleWith', message: 'incompatibleWith deve ser mapa JSON' });
  for (const [index, conflict] of asArray(graph.conflicts).entries()) {
    const ids = conflict?.between ?? conflict?.conclusions ?? conflict?.ids;
    if (!Array.isArray(ids) || ids.length !== 2) errors.push({ code: 'GRAPH_CONFLICT_INVALID', field: `conflicts.${index}`, message: 'cada conflito exige exatamente dois ids' });
  }
  for (const ref of collectIncompatibilityRefs(graph)) {
    if (!conclusionIds.has(ref.from) || !conclusionIds.has(ref.to) || ref.from === ref.to) {
      errors.push({ code: 'GRAPH_INCOMPATIBLE_REF_INVALID', field: `incompatibleWith.${ref.from}`, message: `incompatibilidade inválida: ${ref.from} ↔ ${ref.to}` });
    }
  }
  if (graph.conclusionGroups && typeof graph.conclusionGroups === 'object' && !Array.isArray(graph.conclusionGroups)) {
    for (const [group, ids] of Object.entries(graph.conclusionGroups)) {
      if (!Array.isArray(ids) || ids.length < 2) errors.push({ code: 'GRAPH_GROUP_INVALID', field: `conclusionGroups.${group}`, message: 'grupo incompatível exige ao menos dois ids' });
      for (const id of asArray(ids)) if (!conclusionIds.has(String(id))) errors.push({ code: 'GRAPH_INCOMPATIBLE_REF_INVALID', field: `conclusionGroups.${group}`, message: `conclusão ausente no grupo: ${id}` });
    }
  }
  return errors;
}

export function evaluateReasoningGraph(graph, { facts: factOverride, evidence: evidenceOverride, state = {}, now = new Date().toISOString() } = {}) {
  const errors = validateReasoningGraph(graph);
  const fatalErrors = errors.filter(error => !['GRAPH_EVIDENCE_REF_INVALID', 'GRAPH_DATE_INVALID', 'GRAPH_INCOMPATIBLE_REF_INVALID'].includes(error.code));
  if (fatalErrors.length) return { version: LOGIC_GRAPH_VERSION, factStates: {}, evidenceStates: {}, conclusions: [], conclusionById: {}, audit: [], unknown: [{ reason: fatalErrors[0].code }], conflicts: [], errors };
  const factEntries = normalizeCollection(factOverride ?? graph.facts, 'fact');
  const evidenceEntries = normalizeCollection(evidenceOverride ?? graph.evidence, 'evidence');
  const facts = new Map(factEntries.map(([id, value]) => [id, normalizeFact(id, value)]));
  const evidence = new Map(evidenceEntries.map(([id, value]) => [id, normalizeEvidence(id, value)]));
  // Snapshot sem valores: suficiente para explicar o resultado na UI sem
  // transportar input, prova ou payload potencialmente sigiloso.
  const factStates = Object.fromEntries([...facts].map(([id, fact]) => [id, fact.state]));
  const evidenceStates = Object.fromEntries([...evidence].map(([id, item]) => [id, item.state]));
  const audit = [];
  const unknown = errors.filter(error => ['GRAPH_EVIDENCE_REF_INVALID', 'GRAPH_DATE_INVALID', 'GRAPH_INCOMPATIBLE_REF_INVALID'].includes(error.code))
    .map(error => ({ kind: 'graph', reason: error.code, field: error.field || null }));
  const candidates = [];
  const rules = normalizeCollection(graph.rules, 'rule').map(([id, rule]) => [id, rule && typeof rule === 'object' ? rule : {}])
    .sort((a, b) => (Number(b[1].priority) || 0) - (Number(a[1].priority) || 0));
  for (const [ruleId, rule] of rules) {
    const temporal = activeAt({ validFrom: rule.validFrom ?? rule.validity?.from, validUntil: rule.validUntil ?? rule.validity?.until }, now);
    const condition = evaluateCondition(rule.when ?? rule.if ?? rule.condition, facts, evidence, state, now);
    const unlesses = asArray(rule.unless ?? rule.defeater ?? rule.defeaters);
    const unlessResults = unlesses.map(item => evaluateCondition(item, facts, evidence, state, now));
    const defeated = unlessResults.some(result => result.state === 'true');
    const uncertainDefeat = !defeated && unlessResults.some(result => result.state === 'unknown' || result.state === 'controversial');
    const target = ruleConclusion(rule);
    const fired = temporal.active && (condition.state === 'true' || condition.state === 'controversial') && !defeated && !uncertainDefeat && Boolean(target.id);
    const proofInfo = evidenceFor(rule, condition, facts, evidence);
    const proofs = proofInfo.proofs;
    const missingProofs = proofInfo.missingProofs;
    const auditEntry = {
      kind: 'rule', id: ruleId, priority: Number(rule.priority) || 0, fired,
      condition: condition.state, premises: condition.premises, proofs,
      defeated, uncertainDefeat, responsible: rule.responsible ?? rule.owner ?? null,
      burden: rule.burden ?? null, threshold: rule.threshold ?? null, missingProofs,
      temporal: temporal.active ? 'active' : temporal.reason,
      trace: condition.trace,
    };
    audit.push(auditEntry);
    if (condition.state === 'unknown' || condition.state === 'controversial' || uncertainDefeat || !temporal.active || missingProofs.length) {
      unknown.push({ kind: 'rule', id: ruleId, reason: condition.reason || temporal.reason || (missingProofs.length ? 'absence_of_evidence' : uncertainDefeat ? 'defeater_uncertain' : condition.state), premises: condition.premises });
    }
    if (fired) {
      const payload = target.payload || {};
      candidates.push({
        id: target.id, state: condition.state === 'controversial' ? 'controversial' : normalizeFactState(payload.state ?? payload.status ?? rule.state) || 'true',
        value: payload.value ?? rule.value, confidence: finite(payload.confidence) ? payload.confidence : finite(rule.confidence) ? rule.confidence : null,
        probability: finite(payload.probability) ? payload.probability : finite(rule.probability) ? rule.probability : null,
        priority: Number(rule.priority) || 0, proofs, responsible: rule.responsible ?? rule.owner ?? payload.responsible ?? null,
        burden: payload.burden ?? rule.burden ?? null, threshold: payload.threshold ?? rule.threshold ?? null,
        missingProofs, ruleId, premises: condition.premises,
      });
    }
  }
  const conclusionDefinitions = new Map(normalizeCollection(graph.conclusions, 'conclusion').map(([id, value]) => [id, value && typeof value === 'object' ? value : {}]));
  const ruleConclusionIds = new Set(rules.map(([, rule]) => ruleConclusion(rule).id).filter(Boolean));
  for (const [id] of conclusionDefinitions) if (!candidates.some(candidate => candidate.id === id)) unknown.push({ kind: 'conclusion', id, reason: 'absence_of_evidence' });
  const conflicts = [];
  const conclusions = [];
  const ids = new Set([...conclusionDefinitions.keys(), ...ruleConclusionIds, ...candidates.map(candidate => candidate.id)]);
  for (const id of ids) {
    const definitionValue = conclusionDefinitions.get(id) || {};
    const group = candidates.filter(candidate => candidate.id === id).sort((a, b) => b.priority - a.priority);
    if (!group.length) {
      conclusions.push({ id, state: 'unknown', reason: 'absence_of_evidence', burden: definitionValue.burden ?? null, responsible: definitionValue.responsible ?? definitionValue.owner ?? null, proofs: [], review: false });
      continue;
    }
    const topPriority = group[0].priority;
    const top = group.filter(candidate => candidate.priority === topPriority);
    const states = [...new Set(top.map(candidate => candidate.state))];
    const allStates = [...new Set(group.map(candidate => candidate.state))];
    if (allStates.length > 1) conflicts.push({ conclusion: id, type: states.length > 1 ? 'priority-tie' : 'priority-resolved', candidates: group.map(candidate => ({ ruleId: candidate.ruleId, state: candidate.state, priority: candidate.priority })) });
    const winner = top[0];
    const gateChecks = gateFor({ id }, graph, facts, evidence, state, now);
    const threshold = winner.threshold ?? definitionValue.threshold ?? null;
    const probability = winner.probability ?? winner.confidence;
    const thresholdReview = threshold != null && (probability == null || probability < Number(threshold));
    const burden = winner.burden ?? definitionValue.burden ?? null;
    const burdenReview = (burden === 'high' || burden?.level === 'high') && (winner.proofs.length === 0 || winner.missingProofs.length > 0);
    const missingProofReview = winner.missingProofs.length > 0;
    const gateReview = gateChecks.some(check => !check.pass);
    const review = thresholdReview || burdenReview || missingProofReview || gateReview || states.length > 1;
    const finalState = states.length > 1 ? 'controversial' : review && winner.state === 'true' ? 'review' : winner.state;
    if (states.length > 1) unknown.push({ kind: 'conclusion', id, reason: 'conflict', premises: top.flatMap(candidate => candidate.premises) });
    if (review) unknown.push({ kind: 'conclusion', id, reason: thresholdReview ? 'probability_gate' : missingProofReview ? 'absence_of_evidence' : burdenReview ? 'burden_not_met' : gateReview ? 'gate_not_met' : 'conflict' });
    conclusions.push({ id, state: finalState, value: winner.value, confidence: winner.confidence, probability, priority: winner.priority, burden, responsible: winner.responsible ?? definitionValue.responsible ?? definitionValue.owner ?? null, proofs: winner.proofs, premises: winner.premises, review, gates: gateChecks, rules: group.map(candidate => candidate.ruleId) });
  }
  const conclusionById = Object.fromEntries(conclusions.map(conclusion => [conclusion.id, conclusion]));
  for (const [left, right] of incompatibilityPairs(graph)) {
    const leftConclusion = conclusionById[left];
    const rightConclusion = conclusionById[right];
    if (!leftConclusion || !rightConclusion || leftConclusion.state !== 'true' || rightConclusion.state !== 'true') continue;
    conflicts.push({ type: 'incompatible-conclusions', conclusions: [left, right] });
    for (const conclusion of [leftConclusion, rightConclusion]) {
      conclusion.state = 'review';
      conclusion.review = true;
    }
    unknown.push({ kind: 'conclusion', id: left, reason: 'incompatible_conclusions' });
    unknown.push({ kind: 'conclusion', id: right, reason: 'incompatible_conclusions' });
  }
  return { version: LOGIC_GRAPH_VERSION, now, factStates, evidenceStates, conclusions, conclusionById, audit, unknown, conflicts, errors };
}

export const deterministicReasoningEvaluator = evaluateReasoningGraph;
export const evaluateLogicGraph = evaluateReasoningGraph;
export const validateLogicGraph = validateReasoningGraph;
