// ============================================================================
// Jev Ruleset — transforme uma PASTA de documentos (políticas, SOPs, normas,
// regimentos) em um índice determinístico que o Jev consulta com CITAÇÃO
// LITERAL. Padrão do cookbook oficial "line-by-line search": o documento
// entra no state linha a linha com IDs curtos (R001| texto), o Jev responde
// qual regra se aplica (choice sobre IDs) e SE existe regra aplicável (noul).
// O texto citado vem SEMPRE do arquivo indexado — o modelo escolhe o ID,
// o código devolve a frase. Anti-alucinação por construção.
//
// Ingestão 100% determinística: mesmos arquivos ⇒ mesmos IDs, sempre.
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, extname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { JEV_DATA_DIR, choiceQ, noulQ } from '../jev/client.mjs';
import { canonicalJson, judgmentCacheMetadata } from '../jev/cache.mjs';

export const RULESET_SCHEMA = 'jev-ruleset/1';
export const RULESETS_DIR = join(JEV_DATA_DIR, 'rulesets');
export const EXAMPLES_RULESETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'examples', 'rulesets');

// O choice da API aceita até 255 opções; reservamos 1 para o escape `nenhuma`.
export const MAX_RULES = 250;
export const MAX_RULE_CHARS = 1_200;
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 500_000;
// Limitares do cookbook oficial (calibrar no seu domínio antes de produção).
export const FOUND_THRESHOLD = 0.7;
export const ABSENT_THRESHOLD = 0.35;

const ID_RE = /^[a-z][a-z0-9_-]{2,40}$/;
const RULESET_EXTS = new Set(['.md', '.markdown', '.txt', '.json']);
const IGNORE = /[\\/](node_modules|\.git|dist|build|coverage|vendor)[\\/]/;

export class RulesetError extends Error {
  constructor(message, code) { super(message); this.name = 'RulesetError'; this.code = code; }
}

function ruleId(index) { return `R${String(index + 1).padStart(3, '0')}`; }

/** Bloco de texto vira regra: normaliza espaços, preserva o texto verbatim. */
function normalizarTexto(bruto) {
  const texto = String(bruto).replace(/\s+/gu, ' ').trim();
  if (texto.length <= MAX_RULE_CHARS) return { texto, truncado: false };
  return { texto: `${texto.slice(0, MAX_RULE_CHARS)}[…truncado deterministicamente…]`, truncado: true };
}

// "Exceção:", "Exceto:", "Exceção —" (com ou sem acento, maiúsculas livres)
const EXCECAO_RE = /^(?:exce[çc][ãa]o|exceto)\s*[:—-]?\s*/iu;

/**
 * Extrai regras do conteúdo de UM arquivo, de forma determinística e
 * documentada:
 *  - Markdown: headings viram seção (contexto, não regra); itens de lista e
 *    parágrafos não-vazios viram regras.
 *  - Texto puro: linha curta terminando em ":" vira seção; as demais linhas
 *    não-vazias viram regras.
 *  - JSON: array (de strings ou objetos {id?, texto|text|rule|descricao}) ou
 *    {regras|rules: [...]}.
 */
export function extrairRegrasDeConteudo(nomeArquivo, conteudo) {
  const ext = extname(nomeArquivo).toLowerCase();
  const fonte = (linha) => `${nomeArquivo}:${linha}`;
  const regras = [];
  const push = (bruto, secao, linha) => {
    const excecao = EXCECAO_RE.test(String(bruto).trim());
    const { texto, truncado } = normalizarTexto(bruto);
    if (!texto) return;
    regras.push({ texto, ...(secao ? { secao } : {}), ...(linha ? { fonte: fonte(linha) } : {}), ...(excecao ? { excecao: true } : {}), ...(truncado ? { truncado: true } : {}) });
  };

  if (ext === '.json') {
    let dados;
    try { dados = JSON.parse(String(conteudo)); } catch (e) { throw new RulesetError(`JSON inválido em ${nomeArquivo}: ${e.message}`, 'JSON_INVALIDO'); }
    const lista = Array.isArray(dados) ? dados : Array.isArray(dados?.regras) ? dados.regras : Array.isArray(dados?.rules) ? dados.rules : null;
    if (!lista) throw new RulesetError(`JSON em ${nomeArquivo} deve ser array ou {regras:[...]}`, 'JSON_FORMATO_INVALIDO');
    for (const item of lista) {
      if (item == null) continue;
      if (typeof item === 'string') { push(item, null, null); continue; }
      if (typeof item === 'object') {
        const texto = item.texto ?? item.text ?? item.rule ?? item.descricao ?? item.description;
        if (typeof texto === 'string' && texto.trim()) push(texto, typeof item.secao === 'string' ? item.secao : null, null);
      }
    }
    return regras;
  }

  const linhas = String(conteudo).split(/\r?\n/);
  let secao = '';
  let emComentario = false;
  linhas.forEach((linha, i) => {
    const t = linha.trim();
    if (!t) return;
    // comentários HTML (<!-- ... -->) são nota de rodapé do autor, não regra
    if (emComentario) {
      if (/-->/.test(t)) emComentario = false; // o resto da linha fecha o comentário
      return;
    }
    if (/^<!--/.test(t) && !/-->/.test(t)) { emComentario = true; return; }
    if (/^<!--/.test(t)) return; // comentário de linha única
    if (ext === '.md' || ext === '.markdown') {
      const heading = t.match(/^#{1,6}\s+(.+)$/);
      if (heading) { secao = normalizarTexto(heading[1]).texto; return; }
      const item = t.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
      push(item ? item[1] : t, secao, i + 1);
      return;
    }
    // texto puro
    if (t.length <= 80 && /[:：]$/.test(t)) { secao = normalizarTexto(t.replace(/[:：]$/, '')).texto; return; }
    push(t, secao, i + 1);
  });
  return regras;
}

function listarArquivos(root) {
  const out = [];
  (function walk(dir) {
    if (out.length >= MAX_FILES) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, e.name);
      if (IGNORE.test(full)) continue;
      if (e.isDirectory()) { walk(full); continue; }
      if (RULESET_EXTS.has(extname(e.name).toLowerCase())) out.push(full);
    }
  })(root);
  return out;
}

/**
 * Ingeste uma pasta ou arquivo e salva o ruleset em data/jev/rulesets/.
 * Retorna { ruleset, salvo_em, aviso }. Determinístico: rerodar com os
 * mesmos arquivos gera os mesmos IDs.
 */
export function ingestRuleset({ pasta, id, nome }, { dir = RULESETS_DIR } = {}) {
  const alvo = String(pasta || '').trim();
  if (!id || !ID_RE.test(id)) throw new RulesetError(`id inválido: use slug minúsculo (ex: politica-reembolso)`, 'ID_INVALIDO');
  if (!alvo || !existsSync(alvo)) throw new RulesetError(`caminho inexistente: ${alvo}`, 'CAMINHO_INVALIDO');
  const stat = statSync(alvo);
  const raiz = stat.isDirectory() ? alvo : dirname(alvo);
  // *.ruleset.json é o NOSSO formato de saída: nunca é fonte de regras
  // (senão o re-ingest de uma pasta index duplificaria as regras).
  const arquivos = (stat.isDirectory() ? listarArquivos(raiz) : [alvo])
    .filter(arq => !arq.endsWith('.ruleset.json'));

  const brutas = [];
  for (const arq of arquivos) {
    if (statSync(arq).size > MAX_FILE_BYTES) continue;
    const rel = relative(raiz, arq).replace(/\\/g, '/');
    const extraidas = extrairRegrasDeConteudo(rel, readFileSync(arq, 'utf8'));
    brutas.push(...extraidas);
  }
  if (!brutas.length) throw new RulesetError('nenhuma regra encontrada (arquivos .md/.txt/.json com linhas não-vazias)', 'SEM_REGRAS');

  let aviso = null;
  const regras = brutas.slice(0, MAX_RULES).map((r, i) => ({ id: ruleId(i), ...r }));
  if (brutas.length > MAX_RULES) aviso = `${brutas.length} regras encontradas; mantidas as ${MAX_RULES} primeiras (limite do choice: 255 opções). Divida a política em rulesets menores.`;

  const anteriorPath = join(dir, `${id}.ruleset.json`);
  let anterior = null;
  try { anterior = JSON.parse(readFileSync(anteriorPath, 'utf8')); } catch { /* primeiro ingest */ }

  const ruleset = {
    schema: RULESET_SCHEMA,
    id,
    nome: nome || id,
    origem: isAbsolute(alvo) ? alvo : alvo,
    ...(anterior?.criado_em ? { criado_em: anterior.criado_em } : { criado_em: new Date().toISOString() }),
    atualizado_em: new Date().toISOString(),
    stats: { arquivos: arquivos.length, regras: regras.length, caracteres: regras.reduce((s, r) => s + r.texto.length, 0) },
    regras,
  };
  ruleset.hash = createHash('sha256').update(canonicalJson({ regras })).digest('hex').slice(0, 16);

  mkdirSync(dir, { recursive: true });
  const salvo_em = join(dir, `${id}.ruleset.json`);
  writeFileSync(salvo_em, JSON.stringify(ruleset, null, 2));
  return { ruleset, salvo_em, aviso };
}

/** Carrega por id (data/jev/rulesets + examples) ou caminho .json absoluto. */
export function loadRuleset(idOrPath, { dir = RULESETS_DIR } = {}) {
  const pedido = String(idOrPath || '').trim();
  const caminhos = isAbsolute(pedido) && pedido.endsWith('.json')
    ? [pedido]
    : ID_RE.test(pedido)
      ? [join(dir, `${pedido}.ruleset.json`), join(EXAMPLES_RULESETS_DIR, `${pedido}.ruleset.json`)]
      : [];
  for (const c of caminhos) {
    try {
      const rs = JSON.parse(readFileSync(c, 'utf8'));
      if (rs?.schema !== RULESET_SCHEMA || !Array.isArray(rs.regras)) throw new RulesetError(`ruleset incompatível: ${c}`, 'SCHEMA_INVALIDO');
      return rs;
    } catch (e) { if (e instanceof RulesetError) throw e; /* tenta o próximo */ }
  }
  throw new RulesetError(`ruleset não encontrado: ${pedido}`, ID_RE.test(pedido) ? 'NOT_FOUND' : 'ID_INVALIDO');
}

/** Lista rulesets do usuário; exemplos shipped vêm marcados. */
export function listRulesets({ dir = RULESETS_DIR } = {}) {
  const out = [];
  const add = (rs, exemplo) => out.push({ id: rs.id, nome: rs.nome, regras: rs.regras.length, arquivos: rs.stats?.arquivos ?? null, atualizado_em: rs.atualizado_em ?? null, exemplo });
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.ruleset.json')).sort()) {
      try { add(JSON.parse(readFileSync(join(dir, f), 'utf8')), false); } catch { /* corrompido fica fora */ }
    }
  }
  if (existsSync(EXAMPLES_RULESETS_DIR)) {
    for (const f of readdirSync(EXAMPLES_RULESETS_DIR).filter(f => f.endsWith('.ruleset.json')).sort()) {
      try {
        const rs = JSON.parse(readFileSync(join(EXAMPLES_RULESETS_DIR, f), 'utf8'));
        if (!out.some(o => o.id === rs.id)) add(rs, true);
      } catch { /* corrompido fica fora */ }
    }
  }
  return out;
}

/**
 * Monta o state + perguntas do padrão line-search. O documento entra com IDs
 * inline ("R001| texto") e a pergunta choice usa os mesmos IDs — descrições
 * null porque o texto já está no state (cookbook oficial).
 */
export function buildFindRequest(ruleset, pergunta) {
  // ids estáveis também para regras inline/extraídas sem id explícito
  const regras = (ruleset?.regras || []).slice(0, MAX_RULES)
    .map((r, i) => (r?.id ? r : { ...r, id: ruleId(i) }));
  if (!regras.length) throw new RulesetError('ruleset sem regras', 'SEM_REGRAS');
  const documento = regras
    .map(r => `${r.id}| ${r.excecao ? '[EXCEÇÃO] ' : ''}${r.secao ? `[${r.secao}] ` : ''}${r.texto}`)
    .join('\n');
  const criteria = Object.fromEntries(regras.map(r => [r.id, null]));
  criteria.nenhuma = 'Nenhuma regra listada na política se aplica à situação.';
  return {
    state: { situacao: String(pergunta), politica: documento },
    questions: {
      qual_regra: choiceQ('Qual regra da `politica` se aplica à `situacao`? Escolha pelo ID da linha. Linhas marcadas [EXCEÇÃO] valem mais que as regras gerais quando a situação as atende. Se nenhuma se aplicar, escolha `nenhuma`.', criteria),
      existe_regra: noulQ('Existe na `politica` pelo menos uma regra (inclusive exceção marcada) que se aplica à `situacao`?', {
        true: 'Pelo menos uma linha da `politica` — regra geral ou exceção — se aplica diretamente à `situacao`.',
        false: 'Nenhuma linha da `politica` se aplica à `situacao`.',
      }),
    },
    regras,
  };
}

/**
 * Converte as respostas (qual_regra + existe_regra) em veredicto com citação
 * LITERAL. O texto citado sai da regra indexada — nunca do modelo.
 * Veredictos: aplicavel | parcial | sem_regra | conflito (distribuição e
 * existência divergem ⇒ revisão) | erro.
 */
export function verdictFromAnswers(regras, answers, { rulesetId = '', found = FOUND_THRESHOLD, absent = ABSENT_THRESHOLD } = {}) {
  const foundT = Math.min(1, Math.max(0.5, Number(found) || FOUND_THRESHOLD));
  const absentT = Math.max(0, Math.min(0.5, Number(absent) || ABSENT_THRESHOLD));
  const escolha = answers?.qual_regra;
  const existe = Number(answers?.existe_regra?.noul);
  const regraId = escolha?.type === 'choice' ? escolha.choice : null;
  const regra = regraId && regraId !== 'nenhuma' ? regras.find(r => r.id === regraId) || null : null;

  let veredicto;
  if (!Number.isFinite(existe)) veredicto = 'erro';
  else if (existe >= foundT) veredicto = regra ? 'aplicavel' : 'conflito';
  else if (existe <= absentT) veredicto = 'sem_regra';
  else veredicto = 'parcial';

  return {
    veredicto,
    regra: regra?.id ?? null,
    excecao: regra?.excecao === true,
    existe: Number.isFinite(existe) ? existe : null,
    probabilidade: escolha?.probabilities?.[regraId] ?? null,
    confianca: escolha?.confidence ?? null,
    citacao: regra
      ? { id: regra.id, texto: regra.texto, ...(regra.secao ? { secao: regra.secao } : {}), ...(regra.excecao ? { excecao: true } : {}), fonte: regra.fonte || rulesetId || null }
      : null,
    thresholds: { found: foundT, absent: absentT },
  };
}

/**
 * Julgamento com citação: retorna o veredicto e a citação LITERAL da regra
 * escolhida. O texto nunca sai do modelo — sai do arquivo indexado.
 */
export async function findRule({ ruleset, pergunta, client, foundThreshold = FOUND_THRESHOLD, absentThreshold = ABSENT_THRESHOLD }) {
  if (!client) throw new RulesetError('client Jev obrigatório', 'CLIENT_AUSENTE');
  if (!String(pergunta || '').trim()) throw new RulesetError('pergunta obrigatória', 'PERGUNTA_AUSENTE');
  const { state, questions, regras } = buildFindRequest(ruleset, pergunta);

  const res = await client.ask({ state, questions });
  const cacheMeta = judgmentCacheMetadata(res);
  const verdict = verdictFromAnswers(regras, res.answers, { rulesetId: ruleset?.id, found: foundThreshold, absent: absentThreshold });
  return {
    ...verdict,
    usage: res.usage || null,
    latencia_ms: res.latencyMs ?? null,
    custo_usd_estimado: res.costEstimateUsd ?? null,
    cache: cacheMeta?.cache ?? null,
    remoteCalled: cacheMeta?.transportCalled !== false,
  };
}
