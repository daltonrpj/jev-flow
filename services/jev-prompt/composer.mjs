import {
  JevClient, choiceQ, noulQ, scoreQ, isJevConfigured, isValidJevResponseForQuestions,
} from '../jev/client.mjs';
import { redactRemoteState } from '../jev/autonomy-policy.mjs';
import { PATTERN_BY_ID, candidatosHeuristicos, PADRAO_VERSION } from './patterns.mjs';

const TONS = {
  especialista_senior: { persona: 'uma especialista senior', desc: 'rigor tecnico e explicacao dos trade-offs' },
  didatico: { persona: 'um professor didatico', desc: 'explicacoes e exemplos concretos' },
  critico_revisor: { persona: 'um revisor cetico', desc: 'verificacao de falhas e evidencias' },
  executor_direto: { persona: 'um executor pragmatico', desc: 'artefatos objetivos e acionaveis' },
};
const FORMATOS = {
  markdown: 'Markdown com secoes',
  json: 'JSON estrito valido',
  tabela: 'tabela Markdown',
  texto_corrido: 'texto corrido curto',
  codigo: 'bloco de codigo executavel',
};

function textoExemplo(example) {
  return typeof example === 'string' ? example : JSON.stringify(example);
}

function montarPrompt({ objetivo, dominio, ton, formato, aplicados, contexto_incluso, exemplos }) {
  const partes = [];
  const tonDef = TONS[ton] || TONS.executor_direto;
  const persona = tonDef.persona + (dominio ? ' atuando em ' + dominio : '');
  const role = aplicados.includes('persona')
    ? PATTERN_BY_ID.persona.template
      .replace('{persona}', tonDef.persona)
      .replace('{anos}', '15')
      .replace('{dominio}', dominio || 'este dominio')
    : 'Voce e ' + persona + ' — ' + tonDef.desc + '.';
  partes.push('# Papel\n' + role);
  if (aplicados.includes('audience_persona')) {
    partes.push('# Publico\n' + PATTERN_BY_ID.audience_persona.template
      .replace('{publico}', dominio || 'o publico-alvo indicado no objetivo'));
  }
  if (contexto_incluso) {
    partes.push('# Contexto\n' + (aplicados.includes('context_control')
      ? PATTERN_BY_ID.context_control.template.replace('{contexto_incluso}', contexto_incluso)
      : contexto_incluso));
  }
  if (aplicados.includes('meta_language')) partes.push('# Notacao\n' + PATTERN_BY_ID.meta_language.template);
  partes.push('# Objetivo\n' + objetivo);
  if (exemplos.length) partes.push('# Exemplos\n' + exemplos.map((example, i) =>
    String(i + 1) + '. ' + example).join('\n'));
  const secoes = [
    ['question_refinement', 'Antes de comecar'],
    ['flipped_interaction', 'Informacao faltante'],
    ['prompt_reification', 'Forma'],
    ['recipe', 'Sequencia'],
    ['alternative_approaches', 'Caminhos'],
    ['cognitive_verifier', 'Verificacao'],
    ['output_automater', 'Artefato'],
    ['visualization_variable', 'Visual'],
    ['refusal_breaker', 'Se travar'],
    ['ask_for_input', 'Ritmo'],
    ['infinite_generation', 'Continuidade'],
  ];
  for (const [id, titulo] of secoes) {
    if (aplicados.includes(id)) partes.push('# ' + titulo + '\n' + PATTERN_BY_ID[id].template);
  }
  const formatDescription = FORMATOS[formato] || FORMATOS.markdown;
  partes.push('# Formato de saida\n' + (aplicados.includes('template')
    ? PATTERN_BY_ID.template.template.replace('{formato}', formatDescription)
    : formatDescription));
  return partes.join('\n\n');
}

function localResult(input, candidatos, motivo, { transporte = 'nenhum', custo = 0 } = {}) {
  return {
    prompt: montarPrompt({
      ...input, ton: 'executor_direto', formato: 'markdown', aplicados: candidatos,
    }),
    origem: 'heurística local',
    transporte,
    motivo,
    catalogo: PADRAO_VERSION,
    padroes_aplicados: candidatos,
    padroes_rejeitados: [],
    tom: 'executor_direto',
    formato: 'markdown',
    complexidade: null,
    custo,
    latencia_ms: null,
    cache: { decisao: null },
  };
}

/**
 * Compose a deterministic prompt from typed Jev judgments. Caller data is
 * never interpolated into question instructions; unsafe state stays local.
 */
export async function composePrompt({
  objetivo = '', dominio = '', contexto_incluso = '', exemplos = [],
} = {}, { client } = {}) {
  const obj = String(objetivo).trim();
  if (obj.length < 8) throw new RangeError('objetivo deve ter ao menos 8 caracteres');
  const domain = String(dominio).trim();
  const context = String(contexto_incluso);
  if (!Array.isArray(exemplos) || exemplos.length > 3) {
    throw new RangeError('exemplos deve conter no maximo 3 itens');
  }
  const examples = exemplos.map(textoExemplo);
  const input = {
    objetivo: obj, dominio: domain, contexto_incluso: context, exemplos: examples,
  };
  const candidatos = candidatosHeuristicos(obj, domain)
    .filter(id => id !== 'context_control' || Boolean(context));
  if (!client && !isJevConfigured()) {
    return localResult(input, candidatos, 'Jev nao configurado');
  }
  const outbound = redactRemoteState(input);
  if (!outbound.remoteSafe || outbound.redacted) {
    return localResult(input, candidatos, 'estado remoto inseguro ou incompleto');
  }
  const questions = {
    complexidade: scoreQ('Qual a complexidade do objetivo?', [
      'Simples: resposta direta',
      'Media: organiza ideias',
      'Alta: varias etapas ou risco',
      'Critica: exige verificacao e evidencia',
    ]),
    tom: choiceQ('Qual tom produz a melhor resposta?', Object.fromEntries(
      Object.entries(TONS).map(([id, value]) => [id, value.desc]))),
    formato_saida: choiceQ('Qual formato de saida serve melhor o consumidor?', FORMATOS),
  };
  for (const id of candidatos) {
    const pattern = PATTERN_BY_ID[id];
    questions['aplicar_' + id] = noulQ(
      'O padrao ' + pattern.nome + ' melhora o resultado para o objetivo no state?');
  }
  const transporte = client ? 'injetado' : 'configurado';
  let response;
  try {
    response = await (client || new JevClient({ timeoutMs: 9000 })).ask({
      state: outbound.state, questions,
    });
  } catch {
    return localResult(input, candidatos, 'julgamento Jev indisponivel',
      { transporte, custo: null });
  }
  if (!isValidJevResponseForQuestions(response, questions)) {
    return localResult(input, candidatos, 'resposta Jev fora do schema',
      { transporte, custo: Number.isFinite(response?.costEstimateUsd) ? response.costEstimateUsd : null });
  }
  const aplicados = candidatos.filter(id => response.answers['aplicar_' + id].noul >= 0.6);
  const rejeitados = candidatos.filter(id => !aplicados.includes(id));
  const ton = response.answers.tom.choice;
  const formato = response.answers.formato_saida.choice;
  return {
    prompt: montarPrompt({
      ...input, ton, formato, aplicados,
    }),
    origem: 'jev',
    transporte,
    catalogo: PADRAO_VERSION,
    padroes_aplicados: aplicados,
    padroes_rejeitados: rejeitados,
    tom: ton,
    formato,
    complexidade: response.answers.complexidade.score,
    custo: Number.isFinite(response.costEstimateUsd) ? response.costEstimateUsd : null,
    latencia_ms: Number.isFinite(response.latencyMs) ? response.latencyMs : null,
    cache: { decisao: null },
  };
}
