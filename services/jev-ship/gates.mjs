// ============================================================================
// Jev Ship Pack — packaged gates based on the shipwithjev.com catalog.
//
// Cada build novo do catálogo vira um gate fino sobre o jevlet publicado no
// Jev Forge: preenche o schema, corta texto, devolve { acao, valores, custo }.
// Padrão do services/jev/integrator.mjs — cliente injetável para testes
// offline; entrada vazia nunca abre transporte.
// ============================================================================

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JevClient, choiceQ, isJevConfigured } from '../jev/client.mjs';
import { invokeJevlet, FORGE_DIR } from '../jev-forge/forge.mjs';
import { journalAppend } from '../jev/journal.mjs';

export const SHIP_JEVLET_DIR = join(dirname(fileURLToPath(import.meta.url)), 'jevlets');

/** Prefere o jevlet publicado (catálogo); cai para a fonte do pacote se ainda não publicou. */
function dirFor(id) {
  return existsSync(join(FORGE_DIR, id, 'jevlet.json')) ? FORGE_DIR : SHIP_JEVLET_DIR;
}

const cortar = (v, n) => String(v ?? '').slice(0, n);

async function invocar(id, state, { client, journal } = {}) {
  if (!client && !isJevConfigured()) {
    const error = new Error('Connect a Jev provider before running this gate');
    error.code = 'JEV_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  const r = await invokeJevlet(id, state, { client: client || new JevClient({ timeoutMs: 8000 }), dir: dirFor(id) });
  r.executionKind = client ? 'injected-test' : r.transportCalled === false ? 'cache' : 'live';
  // Diário de decisões (auditoria): por padrão, só quando o transporte é
  // real — client injetado (teste/simulação) não registra. `journal: true`
  // força o registro quando o chamador usa client próprio de produção
  // (ex.: doctor com timeout estendido).
  if (journal ?? !client) {
    const pergunta = Object.entries(state || {})
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .sort((a, b) => b[1].length - a[1].length)[0]?.[1] || '';
    journalAppend({
      gate: `ship.${id}`,
      pergunta,
      decisao: r.politica?.acao || '(sem ação)',
      score: Number.isFinite(r.valores?.[Object.keys(r.valores || {})[0]]) ? r.valores[Object.keys(r.valores)[0]] : null,
      custoUsd: r.custo_usd_estimado,
      costSource: Number.isFinite(r.custo_usd_estimado) ? 'provider-estimate' : null,
      executionKind: r.executionKind,
      cache: r.cache === 'hit',
    });
  }
  return r;
}

function pacote(gate, jevlet, r, extra = {}) {
  return {
    gate,
    jevlet,
    acao: r.politica.acao,
    explica: r.politica.explica || null,
    escalou_indeciso: Boolean(r.politica.escalou_indeciso),
    indecisos: r.indecisos,
    custo: Number.isFinite(r.custo_usd_estimado) ? r.custo_usd_estimado : null,
    executionKind: r.executionKind,
    cache: r.cache,
    latencia_ms: r.latencia_ms ?? null,
    usage: r.usage ?? null,
    ...extra,
  };
}

const ignorado = (gate, jevlet, motivo) => ({ gate, jevlet, acao: 'ignorado', custo: 0, motivo });

// ---------------------------------------------------------------------------
// AI slop filter — esconde slop de IA do agregador/feed
// ---------------------------------------------------------------------------
export async function filtrarSlop({ titulo = '', texto = '' } = {}, opts = {}) {
  if (!titulo && !texto) return ignorado('filtrarSlop', 'slop-filter', 'sem conteúdo');
  const r = await invocar('slop-filter', { titulo: cortar(titulo, 300), texto: cortar(texto, 4000) }, opts);
  return pacote('filtrarSlop', 'slop-filter', r, { slop: r.valores.slop ?? null, fato_novo: r.valores.fato_novo ?? null, veredito: r.valores.veredito ?? null });
}

// ---------------------------------------------------------------------------
// Hedging detector — aponta evasiva em alegações
// ---------------------------------------------------------------------------
export async function detectarEvasiva({ alegacao = '' } = {}, opts = {}) {
  if (!alegacao) return ignorado('detectarEvasiva', 'evasivo', 'sem alegação');
  const r = await invocar('evasivo', { alegacao: cortar(alegacao, 2000) }, opts);
  return pacote('detectarEvasiva', 'evasivo', r, { evasivo: r.valores.evasivo ?? null, fundamentacao: r.valores.fundamentacao ?? null });
}

// ---------------------------------------------------------------------------
// "Is this input ready?" — barra trabalho caro com entrada meia-pronta
// ---------------------------------------------------------------------------
export async function entradaPronta({ pedido = '', contexto = '' } = {}, opts = {}) {
  if (!pedido) return ignorado('entradaPronta', 'entrada-pronta', 'sem pedido');
  const r = await invocar('entrada-pronta', { pedido: cortar(pedido, 2000), contexto: cortar(contexto, 4000) }, opts);
  return pacote('entradaPronta', 'entrada-pronta', r, { pronto: r.valores.pronto ?? null, o_que_falta: r.valores.o_que_falta ?? null });
}

// ---------------------------------------------------------------------------
// Bug similarity detector — agrupa erros de causa raiz comum
// ---------------------------------------------------------------------------
export async function acharGemeo({ erro_a = '', erro_b = '' } = {}, opts = {}) {
  if (!erro_a || !erro_b) return ignorado('acharGemeo', 'bug-gemeo', 'precisa de dois erros');
  const r = await invocar('bug-gemeo', { erro_a: cortar(erro_a, 1500), erro_b: cortar(erro_b, 1500) }, opts);
  return pacote('acharGemeo', 'bug-gemeo', r, { parentesco: r.valores.parentesco ?? null, ponto_igual: r.valores.ponto_igual ?? null });
}

// ---------------------------------------------------------------------------
// Self-serve support deflection — responde, aponta doc ou escala
// ---------------------------------------------------------------------------
export async function defletirSuporte({ mensagem = '', doc_disponivel = '' } = {}, opts = {}) {
  if (!mensagem) return ignorado('defletirSuporte', 'deflecao-suporte', 'sem mensagem');
  const r = await invocar('deflecao-suporte', { mensagem: cortar(mensagem, 2000), doc_disponivel: cortar(doc_disponivel || 'nenhum artigo cobre este tema', 600) }, opts);
  return pacote('defletirSuporte', 'deflecao-suporte', r, { rota: r.valores.rota ?? null, critico: r.valores.critico ?? null });
}

// ---------------------------------------------------------------------------
// Docs gap finder — acha pergunta que a documentação não responde
// ---------------------------------------------------------------------------
export async function lacunaDocs({ pergunta = '', trecho_doc = '' } = {}, opts = {}) {
  if (!pergunta) return ignorado('lacunaDocs', 'lacuna-docs', 'sem pergunta');
  const r = await invocar('lacuna-docs', { pergunta: cortar(pergunta, 1000), trecho_doc: cortar(trecho_doc || '(nada encontrado na doc)', 3000) }, opts);
  return pacote('lacunaDocs', 'lacuna-docs', r, { respondida: r.valores.respondida ?? null, falha: r.valores.falha ?? null });
}

// ---------------------------------------------------------------------------
// Red flags detector — armadilha em cláusula de contrato/proposta
// ---------------------------------------------------------------------------
export async function sinaisAlerta({ clausula = '' } = {}, opts = {}) {
  if (!clausula) return ignorado('sinaisAlerta', 'sinais-alerta', 'sem cláusula');
  const r = await invocar('sinais-alerta', { clausula: cortar(clausula, 2500) }, opts);
  return pacote('sinaisAlerta', 'sinais-alerta', r, { risco: r.valores.risco ?? null, tema: r.valores.tema ?? null, gravidade: r.valores.gravidade ?? null });
}

// ---------------------------------------------------------------------------
// Spec compliance check — entregável × critério de aceite
// ---------------------------------------------------------------------------
export async function checarSpec({ criterio = '', entregavel = '' } = {}, opts = {}) {
  if (!criterio || !entregavel) return ignorado('checarSpec', 'spec-conformidade', 'precisa de critério e entregável');
  const r = await invocar('spec-conformidade', { criterio: cortar(criterio, 1000), entregavel: cortar(entregavel, 2500) }, opts);
  return pacote('checarSpec', 'spec-conformidade', r, { conformidade: r.valores.conformidade ?? null, evidencia_clara: r.valores.evidencia_clara ?? null });
}

// ---------------------------------------------------------------------------
// Data quality gates — portão de anomalia antes de ingerir
// ---------------------------------------------------------------------------
export async function portaoQualidade({ campo = '', valor = '', serie = '' } = {}, opts = {}) {
  if (!campo || valor === undefined || valor === null || valor === '') return ignorado('portaoQualidade', 'qualidade-dado', 'sem campo/valor');
  const r = await invocar('qualidade-dado', { campo: cortar(campo, 120), valor: cortar(valor, 500), serie: cortar(serie || 'sem série de referência enviada', 800) }, opts);
  return pacote('portaoQualidade', 'qualidade-dado', r, { anomalo: r.valores.anomalo ?? null, natureza: r.valores.natureza ?? null, impacto: r.valores.impacto ?? null });
}

// ---------------------------------------------------------------------------
// Semantic CLI "did you mean" — comando errado vira sugestão
// Com chave: choice do Jev sobre os comandos. Sem chave: Levenshtein
// determinístico (nunca rede, nunca executa o comando sugerido).
// ---------------------------------------------------------------------------
export const COMANDOS_JEV = ['start', 'test', 'certify', 'ship', 'flow', 'suite', 'help'];

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let anterior = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const atual = [i];
    for (let j = 1; j <= n; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return anterior[n];
}

export async function sugerirComando(digitado, { client, candidatos = COMANDOS_JEV, preferirOffline = false, journal } = {}) {
  // runShipGate passa o state como objeto ({digitado}); chamadas diretas
  // passam a string. Aceitar os dois.
  const bruto = (typeof digitado === 'object' && digitado !== null) ? (digitado.digitado ?? '') : digitado;
  const comando = String(bruto || '').trim().toLowerCase();
  if (!comando) return { comando, sugestao: null, metodo: 'nenhum' };
  const ranking = candidatos.map(c => ({ c, d: levenshtein(comando, c) })).sort((x, y) => x.d - y.d);
  const maisProximo = ranking[0];
  const tolerancia = Math.max(2, Math.floor(comando.length / 3));
  const offline = maisProximo.d <= tolerancia ? maisProximo.c : null;

  const { isJevConfigured } = await import('../jev/client.mjs');
  if (preferirOffline || (!client && !isJevConfigured())) {
    return { comando, sugestao: offline, metodo: 'levenshtein', distancia: maisProximo.d };
  }
  try {
    const jev = client || new JevClient({ timeoutMs: 3000 });
    const criteria = Object.fromEntries(candidatos.slice(0, 30).map(c => [c, `comando jev "${c}"`]));
    const res = await jev.ask({
      state: { digitado: comando, comandos_disponiveis: candidatos.slice(0, 30) },
      questions: { mais_proximo: choiceQ('Qual comando o usuário provavelmente quis digitar?', criteria) },
    });
    const semantico = res.answers.mais_proximo?.choice || null;
    if (journal ?? !client) journalAppend({ gate: 'ship.did-you-mean', pergunta: comando,
      decisao: `suggest ${semantico || offline || 'none'} (${semantico ? 'jev' : 'levenshtein'})`,
      custoUsd: res.costEstimateUsd, executionKind: client ? 'injected-test' : 'live', cache: false });
    return { comando, sugestao: semantico || offline, metodo: semantico ? 'jev' : 'levenshtein', distancia: maisProximo.d, custo: res.costEstimateUsd ?? null };
  } catch {
    return { comando, sugestao: offline, metodo: 'levenshtein', distancia: maisProximo.d, aviso: 'julgamento semântico indisponível — fallback determinístico' };
  }
}

// ---------------------------------------------------------------------------
// Phase change detector — mudança estrutural de regime numa métrica
// ---------------------------------------------------------------------------
export async function detectarMudancaFase({ metrica = '', atual = '', serie = '' } = {}, opts = {}) {
  if (!metrica || atual === undefined || atual === null || atual === '') return ignorado('detectarMudancaFase', 'mudanca-fase', 'sem métrica/valor atual');
  const r = await invocar('mudanca-fase', { metrica: cortar(metrica, 120), atual: cortar(atual, 400), serie: cortar(serie || 'sem série de referência enviada', 1500) }, opts);
  return pacote('detectarMudancaFase', 'mudanca-fase', r, { mudou: r.valores.mudou ?? null, direcao: r.valores.direcao ?? null });
}

// ---------------------------------------------------------------------------
// Despachante — usado pela API e pelo CLI
// ---------------------------------------------------------------------------
export const SHIP_GATES = {
  filtrarSlop: { fn: filtrarSlop, jevlet: 'slop-filter', build: 'AI slop filter', campos: ['titulo', 'texto'] },
  detectarEvasiva: { fn: detectarEvasiva, jevlet: 'evasivo', build: 'Hedging detector', campos: ['alegacao'] },
  entradaPronta: { fn: entradaPronta, jevlet: 'entrada-pronta', build: 'Is this input ready?', campos: ['pedido', 'contexto'] },
  acharGemeo: { fn: acharGemeo, jevlet: 'bug-gemeo', build: 'Bug similarity detector', campos: ['erro_a', 'erro_b'] },
  defletirSuporte: { fn: defletirSuporte, jevlet: 'deflecao-suporte', build: 'Self-serve support deflection', campos: ['mensagem', 'doc_disponivel'] },
  lacunaDocs: { fn: lacunaDocs, jevlet: 'lacuna-docs', build: 'Docs gap finder', campos: ['pergunta', 'trecho_doc'] },
  sinaisAlerta: { fn: sinaisAlerta, jevlet: 'sinais-alerta', build: 'Red flags detector', campos: ['clausula'] },
  checarSpec: { fn: checarSpec, jevlet: 'spec-conformidade', build: 'Spec compliance check', campos: ['criterio', 'entregavel'] },
  portaoQualidade: { fn: portaoQualidade, jevlet: 'qualidade-dado', build: 'Data quality gates', campos: ['campo', 'valor', 'serie'] },
  detectarMudancaFase: { fn: detectarMudancaFase, jevlet: 'mudanca-fase', build: 'Phase change detector', campos: ['metrica', 'atual', 'serie'] },
  sugerirComando: { fn: sugerirComando, jevlet: null, build: 'Semantic CLI did-you-mean', campos: ['digitado'] },
};

export async function runShipGate(gate, state = {}, opts = {}) {
  const def = SHIP_GATES[gate];
  if (!def) {
    const e = new Error(`gate desconhecido: ${gate} — use um de: ${Object.keys(SHIP_GATES).join(', ')}`);
    e.code = 'GATE_DESCONHECIDO';
    throw e;
  }
  return def.fn(state, opts);
}
