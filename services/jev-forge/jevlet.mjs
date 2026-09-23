// ============================================================================
// Jevlet — a unidade de julgamento reutilizável do Jev Forge.
//
// Um jevlet é um julgamento Jev completo e versionado: schema do estado,
// perguntas tipadas, política determinística (DSL minúscula em código) e
// bateria de testes com casos negativos obrigatórios (regra herdada do
// Skill Forge: não passa no próprio teste, não entra no catálogo).
//
// Este módulo tem a ESPECIFICAÇÃO e o VALIDADOR mecânico — as regras de
// design do knowledge.mjs viram checagens que um rascunho de LLM (ou
// humano) precisa passar antes de existir.
// ============================================================================

export class JevletError extends Error {
  constructor(message, code) { super(message); this.name = 'JevletError'; this.code = code; }
}

export const PRIMITIVES = new Set(['choice', 'noul', 'score']);

const ID_RE = /^[a-z][a-z0-9_-]{2,40}$/; // id do jevlet aceita hífen; campos internos são snake_case
const FIELD_RE = /^[a-z][a-z0-9_]*$/;

/** Extrai referências `campo.caminho` das instruções (para checar contra o schema). */
export function stateRefs(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(/`([a-zA-Z_][\w.]*)`/g)) {
    out.add(m[1].split('.')[0]);
  }
  return out;
}

/**
 * Valida um jevlet contra a especificação. Retorna
 * { ok, errors: [{codigo, campo, msg}], warnings: [{codigo, msg}] }.
 * errors bloqueiam publicação; warnings só informam.
 */
export function validateJevlet(j) {
  const errors = [];
  const warnings = [];
  const err = (codigo, campo, msg) => errors.push({ codigo, campo, msg });
  const warn = (codigo, msg) => warnings.push({ codigo, msg });

  if (!j || typeof j !== 'object') return { ok: false, errors: [{ codigo: 'JEVLET_INVALIDO', campo: '', msg: 'jevlet deve ser objeto' }], warnings };

  // --- identidade ---
  if (!ID_RE.test(j.id || '')) err('ID_INVALIDO', 'id', 'id deve ser slug minúsculo (letra, depois a-z0-9_), 3–41 chars');
  if (!j.descricao || String(j.descricao).length < 15) err('DESCRICAO_CURTA', 'descricao', 'descreva o que o julgamento decide (>= 15 chars) — é o que aparece no catálogo');
  if (j.version !== undefined && (!Number.isInteger(j.version) || j.version < 1)) err('VERSAO_INVALIDA', 'version', 'version deve ser inteiro >= 1');

  // --- schema do estado ---
  const schemaFields = Object.keys(j.state_schema || {});
  if (!schemaFields.length) err('SEM_STATE', 'state_schema', 'declare os campos do state que o chamador fornece (mesmo que seja um só)');
  for (const f of schemaFields) {
    if (!FIELD_RE.test(f)) err('CAMPO_STATE_INVALIDO', `state_schema.${f}`, 'nome de campo deve ser snake_case');
    if (!String(j.state_schema[f] || '').trim()) err('CAMPO_STATE_SEM_DESCRICAO', `state_schema.${f}`, 'descreva o campo (o desenhista futuro agradece)');
  }

  // --- perguntas ---
  const questionIds = Object.keys(j.questions || {});
  if (!questionIds.length) err('SEM_PERGUNTAS', 'questions', 'pelo menos uma pergunta tipada');
  if (questionIds.length > 12) warn('MUITAS_PERGUNTAS', `${questionIds.length} perguntas — cada uma custa token; confirme que todas são independentes e úteis`);

  for (const [qid, q] of Object.entries(j.questions || {})) {
    if (!FIELD_RE.test(qid)) { err('PERGUNTA_ID_INVALIDA', `questions.${qid}`, 'id de pergunta deve ser snake_case'); continue; }
    if (!PRIMITIVES.has(q?.type)) { err('TIPO_INVALIDO', `questions.${qid}.type`, 'use noul, choice ou score'); continue; }

    const instr = String(q.instructions || '');
    if (instr.length < 20) err('INSTRUCOES_CURTAS', `questions.${qid}.instructions`, 'instruções precisam ser completas (>= 20 chars): o modelo só lê instructions+criteria');
    if ((instr.match(/\?/g) || []).length > 1) err('PERGUNTA_DUPLA', `questions.${qid}.instructions`, 'mais de um "?" numa instrução — divida em perguntas separadas (atomicidade)');
    if (/\be\b\s+.*\s+\be\b\s+/.test(instr.toLowerCase()) && instr.includes('?')) {
      warn('POSSIVEL_NAO_ATOMICA', `questions.${qid}.instructions`, 'instrução parece pedir duas coisas ("X e Y?") — confirme que é um julgamento só');
    }

    // referências de state existem?
    for (const ref of stateRefs(instr)) {
      if (!schemaFields.includes(ref)) err('REF_STATE_DESCONHECIDO', `questions.${qid}.instructions`, `referência \`${ref}\` não existe no state_schema`);
    }

    if (q.type === 'choice') {
      const opts = Object.keys(q.criteria || {});
      if (opts.length < 2) err('CHOICE_MINIMO', `questions.${qid}.criteria`, 'choice precisa de >= 2 opções');
      for (const [opt, desc] of Object.entries(q.criteria || {})) {
        if (desc === null || !String(desc || '').trim()) warn('CHOICE_SEM_DESCRICAO', `questions.${qid}.criteria.${opt}`, 'descreva a opção — descrições concretas separam candidatos parecidos');
      }
      const escapes = opts.filter(o => /^(outr|nao_sei|nenhum|none|outro|ignorado|nao_aplicavel|sem_pro)/i.test(o));
      if (!escapes.length) warn('CHOICE_SEM_ESCAPE', `questions.${qid}.criteria`, 'mundo aberto? considere opção de escape (outro/nao_sei) — o modelo não escolhe o que não existe');
    }

    if (q.type === 'score') {
      const levels = q.criteria;
      if (!Array.isArray(levels) || levels.length < 2) { err('SCORE_MINIMO', `questions.${qid}.criteria`, 'score precisa de array com >= 2 níveis'); continue; }
      if (new Set(levels.map(String)).size !== levels.length) err('NIVEIS_IGUAIS', `questions.${qid}.criteria`, 'níveis duplicados não ordenam nada');
      for (const [i, lvl] of levels.entries()) {
        if (String(lvl || '').trim().length < 8) err('NIVEL_RASO', `questions.${qid}.criteria[${i}]`, 'cada nível descreve uma situação concreta (>= 8 chars) que se sustente sozinha');
      }
    }

    if (q.type === 'noul' && !instr.trim().endsWith('?') && !/^(a|o|as|os|é|ha|existe|deve|pode|esta|está|trata|aplica|comunica|contém|contem|requer|sugere)\b/i.test(instr.trim())) {
      warn('NOUL_NAO_BINARIO', `questions.${qid}.instructions`, 'noul é probabilidade de SIM — a pergunta deve ser afirmativa respondível por sim/não');
    }
  }

  // --- política (opcional, mas se existir tem que fechar) ---
  if (j.politica) {
    if (!j.politica.default) err('POLITICA_SEM_DEFAULT', 'politica.default', 'política precisa de ação default');
    for (const [i, regra] of (j.politica.regras || []).entries()) {
      if (!regra.quando || !regra.acao) { err('REGRA_INCOMPLETA', `politica.regras[${i}]`, 'regra precisa de quando + acao'); continue; }
      try {
        checkConditionFields(regra.quando, questionIds);
      } catch (e) {
        err('POLITICA_INVALIDA', `politica.regras[${i}].quando`, e.message);
      }
    }
  }

  // --- limiares calibrados (opcional; quem publica é a calibração) ---
  if (j.limiares) {
    for (const [qid, lim] of Object.entries(j.limiares)) {
      const q = (j.questions || {})[qid];
      if (!q) { err('LIMIAR_DESCONHECIDO', `limiares.${qid}`, 'limiar referencia pergunta inexistente'); continue; }
      if (q.type === 'choice') {
        if (typeof lim.confianca_min !== 'number' || lim.confianca_min <= 0 || lim.confianca_min >= 1) {
          err('LIMIAR_INVALIDO', `limiares.${qid}`, 'choice usa {confianca_min: 0..1 exclusive} — abaixo disso o invoke escala');
        }
      } else {
        // noul/score: zona morta — decide se prob >= limiar ou <= 1-limiar
        if (typeof lim.limiar !== 'number' || lim.limiar <= 0.5 || lim.limiar >= 1) {
          err('LIMIAR_INVALIDO', `limiares.${qid}`, 'noul/score usa {limiar: 0.5..1 exclusive} — o meio é zona morta e escala');
        }
      }
    }
  }

  // --- testes: >= 2, com negativo obrigatório, esperas válidas ---
  const tests = j.tests || [];
  if (tests.length < 2) err('TESTES_INSUFICIENTES', 'tests', 'mínimo 2 casos de teste (regra do Skill Forge)');
  if (!tests.some(t => t?.tipo === 'negativo')) err('SEM_TESTE_NEGATIVO', 'tests', 'pelo menos 1 caso negativo — o julgamento tem que saber o que NÃO é');
  for (const [i, t] of tests.entries()) {
    if (!t?.nome || !t.state || !t.espera) { err('TESTE_INCOMPLETO', `tests[${i}]`, 'cada teste precisa de nome, state e espera'); continue; }
    const faltando = schemaFields.filter(f => !(f in t.state));
    if (faltando.length) warn('STATE_TESTE_INCOMPLETO', `tests[${i}].state`, `campos do schema ausentes: ${faltando.join(', ')}`);
    for (const [qid, expect] of Object.entries(t.espera || {})) {
      const q = (j.questions || {})[qid];
      if (!q) { err('ESPERA_SEM_PERGUNTA', `tests[${i}].espera.${qid}`, 'espera referencia pergunta inexistente'); continue; }
      if (q.type === 'choice') {
        if (typeof expect !== 'string' || !q.criteria[expect]) err('ESPERA_INVALIDA', `tests[${i}].espera.${qid}`, `espera deve ser uma opção existente (${Object.keys(q.criteria).join('|')})`);
      } else {
        const { min, max } = expect || {};
        const limite = q.type === 'noul' ? 1 : (Array.isArray(q.criteria) ? q.criteria.length - 1 : 1);
        const temMinho = min !== undefined, temMaxo = max !== undefined;
        if (!temMinho && !temMaxo) err('ESPERA_INVALIDA', `tests[${i}].espera.${qid}`, 'use {min} e/ou {max}');
        for (const v of [min, max]) {
          if (v !== undefined && (typeof v !== 'number' || v < 0 || v > limite)) {
            err('ESPERA_INVALIDA', `tests[${i}].espera.${qid}`, `valor fora de [0, ${limite}] para ${q.type}`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// --- DSL de política: "campo op valor && campo op valor" ----------------------

const OPS = /^(==|!=|>=|<=|>|<)$/;

/** Valada sintaxe e campos de uma condição (sem avaliar valores). */
export function checkConditionFields(cond, questionIds) {
  for (const part of String(cond).split('&&')) {
    const m = part.trim().match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (!m) throw new JevletError(`condição ilegível: "${part.trim()}"`, 'BAD_POLICY');
    const campo = m[1].split('.')[0];
    if (!questionIds.includes(campo)) throw new JevletError(`campo "${campo}" não é pergunta do jevlet`, 'BAD_POLICY_FIELD');
  }
  return true;
}

/** Normaliza respostas do Jev em valores consumíveis pela política. */
export function normalizeAnswers(answers = {}) {
  const out = {};
  for (const [id, a] of Object.entries(answers)) {
    if (!a) continue;
    if (a.type === 'choice') out[id] = a.choice;
    else if (a.type === 'noul') out[id] = a.noul;
    else if (a.type === 'score') out[id] = a.score;
  }
  return out;
}

function evalComparison(part, valores) {
  const m = part.trim().match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!m) throw new JevletError(`condição ilegível: "${part.trim()}"`, 'BAD_POLICY');
  const [, campo, op, raw] = m;
  if (!(campo in valores)) throw new JevletError(`campo "${campo}" sem resposta`, 'BAD_POLICY_FIELD');
  const valor = valores[campo];
  const alvo = typeof valor === 'number' ? Number(raw) : String(raw).replace(/^['"]|['"]$/g, '');
  switch (op) {
    case '==': return valor == alvo; // eslint-disable-line eqeqeq
    case '!=': return valor != alvo; // eslint-disable-line eqeqeq
    case '>=': return valor >= alvo;
    case '<=': return valor <= alvo;
    case '>': return valor > alvo;
    case '<': return valor < alvo;
    default: throw new JevletError(`operador desconhecido: ${op}`, 'BAD_POLICY');
  }
}

/** Avalia a política contra respostas normalizadas. Primeira regra que casa
 * ganha. Campo ausente (pergunta indecisa por limiar) NÃO derruba: a regra
 * que depende dele é pulada e, se nenhuma outra casar, o default assume com
 * `escalou_indeciso` marcado. */
export function applyPolicy(jevlet, valores) {
  const politica = jevlet?.politica;
  if (!politica) return { acao: null, regra: null, motivo: 'jevlet sem política — consuma as respostas direto' };
  let escalouIndeciso = false;
  for (const regra of politica.regras || []) {
    const partes = String(regra.quando).split('&&');
    let casou = true;
    for (const parte of partes) {
      try {
        if (!evalComparison(parte, valores)) { casou = false; break; }
      } catch {
        casou = false; escalouIndeciso = true; break; // campo indeciso/ausente: regra não dispara
      }
    }
    if (casou) return { acao: regra.acao, regra: regra.quando, explica: regra.explica || null, indice: regra };
  }
  return { acao: politica.default, regra: 'default', explica: null, escalou_indeciso: escalouIndeciso };
}
