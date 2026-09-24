import { JevClient, choiceQ, noulQ, scoreQ, isJevConfigured, isValidJevResponseForQuestions } from './client.mjs';
import { redactRemoteState } from './autonomy-policy.mjs';
import { canonicalJson } from './cache.mjs';

const PRIORIDADE_TIPO = Object.freeze({
  sistema: 100, regra: 90, codigo: 80, documento: 60,
  conversa_recente: 50, historico_antigo: 20, ruido: 10,
});
const RELEVANCIA = [
  'Descartavel: nao afeta a tarefa',
  'Marginal: apenas se houver espaco',
  'Util: contribui para a tarefa',
  'Critico: a tarefa falha sem este bloco',
];

function iguais(a, b) {
  try {
    return canonicalJson(a) === canonicalJson(b);
  } catch {
    return false;
  }
}

function custoEstimado(response) {
  return Number.isFinite(response?.costEstimateUsd) ? response.costEstimateUsd : null;
}

function localCache(acao, motivo, { transporte = 'nenhum', custo = 0 } = {}) {
  return { acao, motivo, origem: 'política local', transporte, custo, latencia_ms: null };
}

/**
 * Decide whether a cached answer may be reused. The model provides typed
 * evidence; the thresholds and final action remain in code.
 */
export async function julgarCache({
  pergunta = '', estado_anterior = null, resposta_cacheada = null,
  estado_novo = null, idade_s = 0, custo_fresh_usd = 0,
} = {}, { client } = {}) {
  if (resposta_cacheada == null) return localCache('recalcular', 'sem resposta cacheada');
  const mesmoEstado = iguais(estado_anterior, estado_novo);
  if (mesmoEstado) return localCache('usar_cacheada', 'estados canonicamente identicos');
  if (!client && !isJevConfigured()) return localCache('recalcular', 'estados diferem e Jev nao esta configurado');

  const outbound = redactRemoteState({
    pergunta: String(pergunta),
    estado_anterior,
    estado_novo,
    resposta_cacheada,
    idade_cache_s: Number(idade_s) || 0,
    custo_recalculo_usd: Number(custo_fresh_usd) || 0,
  });
  // Redaction can hide a meaningful difference between two states.
  if (!outbound.remoteSafe || outbound.redacted) {
    return localCache('recalcular', 'estado remoto inseguro ou incompleto');
  }
  const questions = {
    acao: choiceQ('Qual acao cabe para a resposta cacheada diante do estado novo?', {
      usar_cacheada: 'Reutilizar a resposta sem perda relevante',
      recalcular: 'Recalcular porque o estado mudou de modo relevante',
      verificar_depois: 'Usar provisoriamente e agendar verificacao',
    }),
    resposta_aderente: noulQ('A resposta cacheada ainda responde corretamente ao estado novo?'),
    risco_baixo: noulQ('O risco de reutilizar a resposta cacheada e baixo?'),
  };
  const transporte = client ? 'injetado' : 'configurado';
  let response;
  try {
    response = await (client || new JevClient({ timeoutMs: 6000 })).ask({
      state: outbound.state, questions,
    });
  } catch {
    return localCache('recalcular', 'julgamento Jev indisponivel', { transporte, custo: null });
  }
  if (!isValidJevResponseForQuestions(response, questions)) {
    return localCache('recalcular', 'resposta Jev fora do schema', { transporte, custo: custoEstimado(response) });
  }
  const aderente = response.answers.resposta_aderente.noul;
  const risco = 1 - response.answers.risco_baixo.noul;
  const escolha = response.answers.acao.choice;
  const podeCache = aderente >= 0.6 && risco <= 0.4;
  const acao = podeCache && ['usar_cacheada', 'verificar_depois'].includes(escolha)
    ? escolha : 'recalcular';
  return {
    acao,
    motivo: acao === 'recalcular' ? 'limiar de aderencia ou risco nao satisfeito'
      : 'aderencia e risco satisfazem a politica',
    origem: 'jev',
    transporte,
    aderente,
    risco,
    escolha_do_modelo: escolha,
    custo: custoEstimado(response),
    latencia_ms: Number.isFinite(response.latencyMs) ? response.latencyMs : null,
  };
}

function normalizarBlocos(blocos) {
  if (!Array.isArray(blocos) || blocos.length < 1 || blocos.length > 10) {
    throw new RangeError('blocos deve conter de 1 a 10 itens');
  }
  const ids = new Set();
  return blocos.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('bloco invalido');
    const id = String(item.id ?? index);
    if (ids.has(id)) throw new RangeError('ids de blocos devem ser unicos');
    ids.add(id);
    const tipo = Object.hasOwn(PRIORIDADE_TIPO, item.tipo) ? item.tipo : 'documento';
    const conteudo = item.conteudo == null ? null : String(item.conteudo);
    const declared = Number(item.chars);
    const chars = conteudo == null ? (Number.isFinite(declared) ? Math.trunc(declared) : 0) : conteudo.length;
    if (chars < 0 || chars > 200000) throw new RangeError('chars fora do limite');
    const previa = String(item.previa ?? (conteudo ?? '').slice(0, 160)).slice(0, 200);
    return { id, tipo, chars, previa, index };
  });
}

function alocar(ordenados, limite) {
  const manter = [];
  const cortar = [];
  let chars = 0;
  for (const bloco of ordenados) {
    const saida = { id: bloco.id, tipo: bloco.tipo, chars: bloco.chars };
    if (Number.isFinite(bloco.relevancia)) saida.relevancia = bloco.relevancia;
    if (chars + bloco.chars <= limite) {
      manter.push(saida);
      chars += bloco.chars;
    } else {
      cortar.push({ ...saida, motivo: 'estouraria o limite' });
    }
  }
  return { manter, cortar, chars };
}

function planoLocal(blocos, limite, total, motivo, { transporte = 'nenhum', custo = 0 } = {}) {
  const ordenados = [...blocos].sort((a, b) =>
    (PRIORIDADE_TIPO[b.tipo] - PRIORIDADE_TIPO[a.tipo]) || (a.index - b.index));
  const { manter, cortar, chars } = alocar(ordenados, limite);
  return {
    estrategia: 'prioridade-por-tipo', origem: 'política local', transporte, motivo,
    manter, cortar, chars_apos: chars, chars_antes: total,
    economia_chars: total - chars, custo, latencia_ms: null,
  };
}

/**
 * Plan which context blocks fit in a strict character budget.
 * Questions use synthetic indices, never caller supplied text or identifiers.
 */
export async function planejarCompactacao({ blocos = [], limite_chars = 6000 } = {}, { client } = {}) {
  if (!Number.isSafeInteger(limite_chars) || limite_chars < 0 || limite_chars > 2_000_000) {
    throw new RangeError('limite_chars deve ser inteiro entre 0 e 2000000');
  }
  const norm = normalizarBlocos(blocos);
  const total = norm.reduce((sum, bloco) => sum + bloco.chars, 0);
  if (!client && !isJevConfigured()) {
    return planoLocal(norm, limite_chars, total, 'Jev nao configurado');
  }
  const outbound = redactRemoteState({
    limite_chars, total_chars: total,
    blocos: norm.map(({ id, tipo, chars, previa }) => ({ id, tipo, chars, previa })),
  });
  if (!outbound.remoteSafe || outbound.redacted) {
    return planoLocal(norm, limite_chars, total, 'estado remoto inseguro ou incompleto');
  }
  const questions = {
    estrategia: choiceQ('Qual estrategia de compactacao cabe para este contexto?', {
      focada: 'Manter somente o essencial',
      equilibrada: 'Manter o essencial e algum apoio',
      conservadora: 'Preservar o maximo dentro do limite',
    }),
  };
  norm.forEach((_, index) => {
    questions['rel_' + index] = scoreQ(
      'Qual a relevancia do bloco no indice ' + index + ' para o objetivo da conversa?', RELEVANCIA);
  });
  const transporte = client ? 'injetado' : 'configurado';
  let response;
  try {
    response = await (client || new JevClient({ timeoutMs: 8000 })).ask({
      state: outbound.state, questions,
    });
  } catch {
    return planoLocal(norm, limite_chars, total, 'julgamento Jev indisponivel',
      { transporte, custo: null });
  }
  if (!isValidJevResponseForQuestions(response, questions)) {
    return planoLocal(norm, limite_chars, total, 'resposta Jev fora do schema',
      { transporte, custo: custoEstimado(response) });
  }
  const estrategia = response.answers.estrategia.choice;
  const fator = estrategia === 'focada' ? 0.7 : estrategia === 'equilibrada' ? 0.9 : 1;
  const alvo = Math.floor(limite_chars * fator);
  const ordenados = norm.map((bloco, index) => ({
    ...bloco, relevancia: response.answers['rel_' + index].score,
  })).sort((a, b) =>
    (b.relevancia - a.relevancia)
    || (PRIORIDADE_TIPO[b.tipo] - PRIORIDADE_TIPO[a.tipo])
    || (a.index - b.index));
  const { manter, cortar, chars } = alocar(ordenados, alvo);
  return {
    estrategia, origem: 'jev', transporte, manter, cortar,
    chars_apos: chars, chars_antes: total, economia_chars: total - chars,
    custo: custoEstimado(response),
    latencia_ms: Number.isFinite(response.latencyMs) ? response.latencyMs : null,
  };
}
