// ============================================================================
// Jev Flow — UI premium do estúdio de decisões, servida no Jev Flow Desktop (/jev/flows).
//
// Canvas com nós arrastáveis, conexões bézier rotuladas, zoom/pan, e a
// EXECUÇÃO animada: cada passo acende o nó, um pulso percorre a aresta e o
// painel de dados mostra input/output de cada etapa. A fonte é honesta:
// run REAL gravado → execução REAL agora → motor REAL com julgamento e rede
// SIMULADOS (sempre declarado no selo).
// ============================================================================

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JevClient, choiceAnswer, noulAnswer, scoreAnswer, isJevConfigured } from '../jev/client.mjs';
import { loadFlow, runFlow, validateInput, listFlows, listRuns, schedulesInfo, flowPath, flowFingerprint, FLOWS_DIR, EXAMPLES_DIR } from './engine.mjs';
import { NODE_CATALOG_VERSION, getNodeDefinition, listNodeDefinitions } from './node-catalog.mjs';
import { loadRuleset } from './ruleset.mjs';
import {
  projectFlowForPublic,
  projectRunForPublic,
  projectWebhookCallsForPublic,
  serializeForInlineScript,
} from './public-projection.mjs';
import { getLocalePack, listLocales } from './i18n.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const NODE_DEFINITIONS = listNodeDefinitions();
const GROUP_UI = Object.freeze({
  judgment: { classe: 'judgment', rotulo: 'Jev · julgamento' },
  deterministic: { classe: 'deterministic', rotulo: 'Determinístico · local' },
  context: { classe: 'context', rotulo: 'Contexto · seleção' },
  logic: { classe: 'logic', rotulo: 'Lógica · inferência' },
  control: { classe: 'control', rotulo: 'Controle · rota' },
  action: { classe: 'action', rotulo: 'Ação · efeito' },
  observability: { classe: 'observability', rotulo: 'Observabilidade' },
});
const TYPE_LABELS_PT = Object.freeze({
  'jev.ask': 'Julgamento Jev', 'jev.jevlet': 'Jevlet publicado', 'jev.verify': 'Verificar evidência',
  'flow.if': 'Condição IF', 'flow.switch': 'Roteador Switch', 'budget.guard': 'Gate de orçamento',
  'rule.match': 'Comparar condição', 'rule.extract': 'Extrair campos', 'rule.lookup': 'Consultar tabela',
  'context.compact': 'Compactar contexto', 'context.prune': 'Podar saída', 'det.skill': 'Skill determinística',
  'metrics.emit': 'Emitir métrica', 'action.webhook': 'Webhook seguro', 'action.log': 'Registrar log',
  'action.set': 'Definir variáveis', 'logic.subgraph': 'Grafo de Raciocínio', 'rules.find': 'Encontrar regra',
});
const TYPE_LABELS_EN = Object.freeze({
  'jev.ask': 'Jev judgment', 'jev.jevlet': 'Published Jevlet', 'jev.verify': 'Verify evidence',
  'flow.if': 'IF condition', 'flow.switch': 'Switch route', 'budget.guard': 'Budget gate',
  'rule.match': 'Match condition', 'rule.extract': 'Extract fields', 'rule.lookup': 'Table lookup',
  'context.compact': 'Compact context', 'context.prune': 'Prune output', 'det.skill': 'Deterministic skill',
  'metrics.emit': 'Emit metric', 'action.webhook': 'Guarded webhook', 'action.log': 'Write log',
  'action.set': 'Set variables', 'logic.subgraph': 'Reasoning graph', 'rules.find': 'Find rule',
});

function loadFlowLogoDataUri() {
  try {
    const svg = readFileSync(join(MODULE_DIR, '..', '..', 'assets', 'mark.svg'));
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch {
    return '';
  }
}

const JEV_FLOW_MARK_DATA_URI = loadFlowLogoDataUri();

function nodeDisplayDefinition(type) {
  const definition = getNodeDefinition(type);
  if (!definition) return { icone: '··', classe: 'action', rotulo: type || 'Nó', group: 'action' };
  const group = GROUP_UI[definition.group] || GROUP_UI.action;
  return {
    icone: definition.glyph,
    classe: definition.type === 'det.skill' ? 'skill' : group.classe,
    rotulo: TYPE_LABELS_PT[definition.type] || definition.label,
    group: definition.group,
    costClass: definition.costClass,
    riskClass: definition.riskClass,
    remote: definition.remote,
  };
}

// ---------------------------------------------------------------------------
// execução (fonte dos dados da página)
// ---------------------------------------------------------------------------

/** Executa um flow para a API/UI: REAL com chave; senão motor real + simulação rotulada. */
export async function executarFlow(flow, { input, answers, simulado = false } = {}) {
  if (isJevConfigured() && input && !simulado) {
    const run = await runFlow(flow, input, { gravar: true });
    return { run, origem: 'execução REAL (Jev ao vivo)', simulado: false, chamadasWebhook: [] };
  }
  return executar(flow, { answers, input, forceSimulado: simulado || answers != null });
}

export async function simularFlow(flow, { input, answers, dir = FLOWS_DIR } = {}) {
  return executar(flow, { answers, input, dir, forceSimulado: true });
}

// ---------------------------------------------------------------------------
// Simulador — bateria de cenários (padrão dos harnesses de avaliação: cada
// fixture com `esperado` vira TESTE; sem esperado, é só observação). A
// simulação é sempre determinística (sem chave, sem rede, sem gravar).
// ---------------------------------------------------------------------------

export const SIMULADOR_MAX_CENARIOS = 12;

/** Extrai o julgamento dominante de uma run (primeiro nó com veredicto/regra). */
function julgamentoDaRun(run) {
  for (const step of run.steps || []) {
    const out = run.outputs?.[step.no];
    if (out && (out.veredicto != null || out.regra != null)) {
      return { no: step.no, veredicto: out.veredicto ?? null, regra: out.regra ?? null, excecao: out.excecao === true };
    }
  }
  return { no: null, veredicto: null, regra: null, excecao: false };
}

function passouPorWebhook(flow, run) {
  const tipos = new Map(Object.entries(flow.nodes || {}).map(([id, n]) => [id, n?.type]));
  return (run.path || []).some(id => tipos.get(id) === 'action.webhook');
}

/**
 * Avalia o `esperado` declarado do cenário contra a run. Campos aceitos
 * (todos opcionais): veredicto, regra, excecao (bool), status (vars.status),
 * webhook (bool), pathIncludes (nó ou lista de nós). Sem esperado ⇒ passou null.
 */
export function avaliarEsperado(esperado, flow, run) {
  if (!esperado || typeof esperado !== 'object') return { passou: null, checagens: [] };
  const julg = julgamentoDaRun(run);
  const statusFinal = run.vars?.status ?? null;
  const checagens = [];
  const add = (campo, esperadoVal, obtido) => checagens.push({ campo, esperado: esperadoVal, obtido, ok: obtido === esperadoVal });
  if ('veredicto' in esperado) add('veredicto', esperado.veredicto, julg.veredicto);
  if ('regra' in esperado) add('regra', esperado.regra, julg.regra);
  if ('excecao' in esperado) add('excecao', esperado.excecao === true, julg.excecao);
  if ('status' in esperado) add('status', esperado.status, statusFinal);
  if ('webhook' in esperado) add('webhook', esperado.webhook === true, passouPorWebhook(flow, run));
  if ('pathIncludes' in esperado) {
    const nodes = Array.isArray(esperado.pathIncludes) ? esperado.pathIncludes : [esperado.pathIncludes];
    checagens.push({ campo:'pathIncludes', esperado:esperado.pathIncludes, obtido:run.path || [],
      ok:nodes.length > 0 && nodes.every(id => typeof id === 'string' && (run.path || []).includes(id)) });
  }
  return { passou: checagens.length ? checagens.every(c => c.ok) : null, checagens };
}

/**
 * Roda a bateria: fixtures do flow (com answers/esperado que tiverem) e/ou
 * cenários extras. Devolve resumo por cenário + contagem de aprovados.
 */
export async function simularBateria(flow, { inputs = null, dir = FLOWS_DIR } = {}) {
  const deFixtures = (flow.fixtures || []).map(f => ({
    nome: f.name || f.id || 'cenário',
    input: f.input || {},
    answers: f.answers || (flow.id.startsWith('cmp3-') ? sugerirRespostas(flow, true) : null),
    esperado: f.esperado || null,
  }));
  let cenarios;
  if (Array.isArray(inputs) && inputs.length) {
    cenarios = inputs.slice(0, SIMULADOR_MAX_CENARIOS).map((c, i) => ({
      nome: c?.nome || c?.name || `cenário ${i + 1}`,
      input: c?.input && typeof c.input === 'object' ? c.input : {},
      answers: c?.answers || null,
      esperado: c?.esperado || null,
    }));
  } else {
    cenarios = deFixtures.slice(0, SIMULADOR_MAX_CENARIOS);
    if (!cenarios.length) cenarios = [{ nome: 'exemplo', input: buildExampleInput(flow),
      answers: flow.id.startsWith('cmp3-') ? sugerirRespostas(flow, true) : null, esperado: null }];
  }

  const resultados = [];
  for (const c of cenarios) {
    try {
      if (flow.id.startsWith('cmp3-') && (!c.answers || typeof c.answers !== 'object' || !Object.keys(c.answers).length))
        throw new Error('respostas tipadas simuladas são necessárias para este cenário');
      const { run } = await simularFlow(flow, { input: c.input, answers: c.answers, ...(dir !== FLOWS_DIR ? { dir } : {}) });
      const julg = julgamentoDaRun(run);
      const avaliacao = avaliarEsperado(c.esperado, flow, run);
      resultados.push({
        cenario: c.nome,
        input: c.input,
        ok: run.ok === true,
        caminho: run.path || [],
        passos: `${(run.steps || []).filter(s => s.ok).length}/${(run.steps || []).length}`,
        status: run.vars?.status ?? null,
        veredicto: julg.veredicto,
        regra: julg.regra,
        excecao: julg.excecao,
        webhook: passouPorWebhook(flow, run),
        custo_usd_estimado: (run.steps || []).reduce((s, st) => s + (run.outputs?.[st.no]?.custo_usd_estimado || 0), 0),
        julgamentos_jev: run.usage?.jevCalls ?? null,
        passou: avaliacao.passou,
        checagens: avaliacao.checagens,
      });
    } catch (e) {
      resultados.push({ cenario: c.nome, input: c.input, ok: false, erro: String(e?.message || e).slice(0, 200), passou: null, checagens: [] });
    }
  }
  return {
    simulacao: 'determinística · sem rede · sem gravar',
    total: resultados.length,
    aprovados: resultados.filter(r => r.passou === true).length,
    reprovados: resultados.filter(r => r.passou === false).length,
    sem_esperado: resultados.filter(r => r.ok && r.passou === null).length,
    falhas_simulacao: resultados.filter(r => !r.ok).length,
    resultados,
  };
}

async function executar(flow, { answers, input, dir = FLOWS_DIR, forceSimulado = false } = {}) {
  // 1) run real gravado — MAS só quando ninguém pediu execução explícita:
  // `answers`/`input` são intenção de VER/RODAR aquele caso agora; a run
  // gravada (ex.: agendamento que falhou sem a chave) não pode sequestrar a
  // tela. Sem os dois: a mais recente vence (mostra o que de fato rodou).
  if (!answers && !input) {
    const runsDir = join(dir, 'runs', flow.id);
    if (existsSync(runsDir)) {
      const fingerprintAtual = flowFingerprint(flow);
      const arquivos = readdirSync(runsDir).filter(f => f.endsWith('.json')).sort().reverse();
      for (const arquivo of arquivos) {
        try {
          const gravado = JSON.parse(readFileSync(join(runsDir, arquivo), 'utf8'));
          if (gravado.flowFingerprint !== fingerprintAtual) continue;
          return { run: gravado, origem: `execução REAL gravada em ${gravado.executado_em}`, simulado: false };
        } catch { /* histórico inválido não sequestra a visualização atual */ }
      }
    }
  }

  const inputExemplo = input ? { ...input } : buildExampleInput(flow);

  if (!forceSimulado && isJevConfigured()) {
    // Uma tentativa real que falha continua sendo falha real. Nunca converta
    // indisponibilidade, schema inválido ou erro de rede em um verde simulado.
    const tentativa = await runFlow(flow, inputExemplo, { gravar: true });
    return {
      run: tentativa,
      origem: tentativa.ok ? 'execução REAL agora (Jev ao vivo)' : 'execução REAL falhou (Jev ao vivo)',
      simulado: false,
      chamadasWebhook: [],
    };
  }

  const respostas = flow.id.startsWith('cmp3-') ? { ...(answers || {}) }
    : { ...sugerirRespostas(flow), ...(answers || {}) };
  const chamadasWebhook = [];
  const fetchSimulado = async (url, init = {}) => {
    let body = null;
    try { body = JSON.parse(init.body); } catch { body = init.body; }
    chamadasWebhook.push({ url, method: init.method || 'POST', body });
    return new Response(JSON.stringify({ ok: true, simulado: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const mock = new JevClient({
    apiKey: 'demo', logUsage: false, maxRetries: 0,
    fetchImpl: async (_url, init = {}) => {
      const body = JSON.parse(init.body);
      const ans = {};
      for (const [qid, q] of Object.entries(body.questions)) {
        const v = respostas[qid];
        if (q.type === 'choice') {
          const probs = {}; for (const k of Object.keys(q.criteria || {})) probs[k] = k === v ? 1 : 0;
          ans[qid] = choiceAnswer(v, probs, 0.85);
        } else if (q.type === 'score') ans[qid] = scoreAnswer(Number(v), q.criteria);
        else ans[qid] = noulAnswer(Number(v));
      }
      return new Response(JSON.stringify({ model: 'jev-simulado', answers: ans, usage: { input_tokens: 100, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const apoioVerificacao = Number.isFinite(Number(respostas.verificacao_apoio))
    ? Math.max(0, Math.min(1, Number(respostas.verificacao_apoio)))
    : 0.95;
  const verifySimulado = async () => ({
    veredito: apoioVerificacao >= 0.6 ? 'suportada' : 'nao_verificavel',
    apoio: apoioVerificacao,
    contradicao: 0,
    confianca: 0.9,
    degradado: false,
  });
  // useCache:false — senão o 1º cenário fica congelado no judgment-cache
  const run = await runFlow(flow, inputExemplo, {
    client: mock,
    fetchImpl: fetchSimulado,
    verifyExecutor: verifySimulado,
    gravar: false,
    useCache: false,
    enforceUrlPolicy: false,
    ...(dir ? { dir } : {}),
  });
  return {
    run,
    origem: 'motor REAL · julgamento SIMULADO (sem TYPESAFE_API_KEY) · rede SIMULADA',
    simulado: true,
    chamadasWebhook,
  };
}

function buildExampleInput(flow) {
  const fixtureInput = Array.isArray(flow.fixtures)
    ? flow.fixtures.find(fixture => fixture?.input && typeof fixture.input === 'object')?.input
    : null;
  const example = fixtureInput ? { ...fixtureInput } : {};
  for (const [field, raw] of Object.entries(flow.input_schema || {})) {
    if (field in example) continue;
    const spec = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : { type: String(raw || '').split(/[ —-]/)[0] };
    if (Object.prototype.hasOwnProperty.call(spec, 'example')) { example[field] = spec.example; continue; }
    if (Object.prototype.hasOwnProperty.call(spec, 'default')) { example[field] = spec.default; continue; }
    if (Array.isArray(spec.enum) && spec.enum.length) { example[field] = spec.enum[0]; continue; }
    const type = String(spec.type || 'string').toLowerCase();
    example[field] = type === 'boolean' ? false
      : type === 'number' ? 0
        : type === 'array' ? []
          : type === 'object' ? {}
            : `[${field} de exemplo]`;
  }
  return example;
}

function sugerirRespostas(fl, conservative = false) {
  const out = {};
  for (const node of Object.values(fl.nodes || {})) {
    if (node.type === 'rules.find') {
      // simulação honesta: primeira regra do ruleset como cenário padrão
      try {
        const rs = node.ruleset ? loadRuleset(node.ruleset) : { regras: node.rules || [] };
        out.qual_regra = rs.regras?.[0]?.id || 'nenhuma';
      } catch { out.qual_regra = 'nenhuma'; }
      out.existe_regra = 0.9;
    }
    if (node.type === 'jev.rerank') {
      // simulação honesta: scores descendentes (primeiro candidato é o mais relevante)
      for (let i = 0; i < 10; i++) out['rel_' + i] = conservative ? 0 : Math.max(0.05, 0.95 - i * 0.12);
    }
    for (const [qid, q] of Object.entries(node.questions || {})) {
      if (q.type === 'choice') {
        const opcoes = Object.keys(q.criteria || {}).filter(k => !/^(outr|nao_sei|nenhum|outro|ignorado)/i.test(k));
        out[qid] = conservative
          ? (['incerto', 'desconhecido', 'revisar', 'diretor'].find(value => Object.hasOwn(q.criteria || {}, value)) || opcoes[0])
          : opcoes[0];
      } else if (q.type === 'score') out[qid] = conservative ? 0 : q.criteria.length - 1;
      else out[qid] = conservative ? 0 : 0.85;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// layout do grafo (auto-arranjo por profundidade, com leitura editorial)
// ---------------------------------------------------------------------------

const TIPO_UI = Object.freeze(Object.fromEntries(NODE_DEFINITIONS.map(definition => [definition.type, nodeDisplayDefinition(definition.type)])));

function subtitulo(node) {
  if (node.questions) return `${Object.keys(node.questions).length} julgamento(s) tipado(s)`;
  if (node.jevlet) return 'jevlet catalogado';
  if (node.when) return 'condição tipada protegida';
  if (node.on) return 'seletor tipado protegido';
  if (node.url) return 'endpoint protegido';
  if (node.texto) return 'mensagem protegida';
  if (node.values) return `${Object.keys(node.values).length} variável(is)`;
  if (node.skill) return 'skill determinística registrada';
  if (node.claim) return 'alegação e evidência protegidas';
  if (node.operator) return `comparação ${node.operator}`;
  if (node.paths) return `${Object.keys(node.paths).length} extração(ões)`;
  if (node.table) return `${Object.keys(node.table).length} entrada(s) catalogada(s)`;
  if (node.event) return 'evento redigido';
  if (node.budget) return `${Object.keys(node.budget).length} limite(s) reservado(s)`;
  if (node.messages) return 'mensagens protegidas · fail-open';
  if (node.pergunta && (node.ruleset || node.rules)) return `${node.ruleset || 'inline'} · citação literal`;
  if (node.graph && typeof node.graph === 'object') return `${Object.keys(node.graph.facts || {}).length} fatos · ${(node.graph.rules || []).length} políticas`;
  return '';
}

function layout(flow) {
  const nodes = [];
  const edges = [];
  const depth = {};
  const calcular = (id, d) => {
    if ((depth[id] ?? -1) >= d) return;
    depth[id] = d;
    const n = flow.nodes[id];
    if (!n) return;
    if (n.next) { edges.push({ from: id, to: n.next, label: '' }); calcular(n.next, d + 1); }
    if (n.type === 'flow.if') {
      if (n.then) { edges.push({ from: id, to: n.then, label: 'sim' }); calcular(n.then, d + 1); }
      if (n.else) { edges.push({ from: id, to: n.else, label: 'não' }); calcular(n.else, d + 1); }
    }
    if (n.type === 'flow.switch') {
      let caseIndex = 0;
      for (const [caso, alvo] of Object.entries(n.cases || {})) {
        const destino = Array.isArray(alvo) ? alvo[0] : alvo;
        caseIndex += 1;
        if (destino) { edges.push({ from: id, to: destino, label: caso === '_default' ? 'padrão' : `caso ${caseIndex}` }); calcular(destino, d + 1); }
      }
    }
  };
  calcular(flow.start, 0);

  const porColuna = {};
  for (const id of Object.keys(depth)) (porColuna[depth[id]] ||= []).push(id);
  for (const [col, ids] of Object.entries(porColuna)) {
    ids.forEach((id, i) => {
      const n = flow.nodes[id];
      const ui = TIPO_UI[n?.type] || { icone: '··', classe: 'action', rotulo: n?.type || '' };
      nodes.push({
        id, tipo: n.type, classe: ui.classe, icone: ui.icone, rotulo: ui.rotulo, sub: subtitulo(n),
        x: 100 + Number(col) * 324, y: 92 + i * 176, inicio: id === flow.start,
        group: ui.group, costClass: ui.costClass, riskClass: ui.riskClass, remote: ui.remote,
      });
    });
  }
  return { nodes, edges };
}

function menorConfianca(output) {
  const respostas = Object.values(output?.respostas || {});
  const valores = respostas
    .map((answer) => Number(answer?.confidence))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  return valores.length ? Math.min(...valores) : null;
}

function logicSnapshot(output, type) {
  if (!['logic.subgraph', 'logic.graph'].includes(type) || !output) return null;
  return {
    factStates: output.factStates && typeof output.factStates === 'object' ? output.factStates : {},
    evidenceStates: output.evidenceStates && typeof output.evidenceStates === 'object' ? output.evidenceStates : {},
    conclusions: Array.isArray(output.conclusions) ? output.conclusions : [],
    audit: Array.isArray(output.audit) ? output.audit : [],
    unknown: Array.isArray(output.unknown) ? output.unknown : [],
    conflicts: Array.isArray(output.conflicts) ? output.conflicts : [],
    errors: Array.isArray(output.errors) ? output.errors : [],
  };
}

// ---------------------------------------------------------------------------
// página do canvas
// ---------------------------------------------------------------------------

export async function simulatePreviewFlow(flow, input, answers) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, validacao: { ok: false, errors: [{ campo: 'input', codigo: 'INPUT_TIPO', msg: 'input deve ser objeto JSON' }] } };
  }
  const validacao = validateInput(flow, input);
  if (!validacao.ok) return { ok: false, validacao };
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || !Object.keys(answers).length) {
    return { ok: false, validacao: { ok: false, errors: [{ campo: 'answers', codigo: 'RESPOSTAS_SIMULADAS_OBRIGATORIAS',
      msg: 'informe respostas tipadas para simular; o input não é analisado pelo Jev nesta rota' }] } };
  }
  const { run } = await executar(flow, { input, answers, forceSimulado: true });
  const visibleRun = projectRunForPublic(run);
  // This endpoint only receives certified, locally generated catalog flows.
  // Their simulated judgments contain no provider secrets and are the point
  // of the tester, so retain typed outputs while keeping the generic boundary.
  visibleRun.outputs = structuredClone(run.outputs || {});
  visibleRun.redaction = { applied: false, scope: 'certified-catalog-local-simulation' };
  return { ...visibleRun, origem: 'simulação determinística · sem chamada Jev',
    mode: 'simulation', simulado: true, validacao };
}

function englishStudioSubtitle(value) {
  return String(value || '')
    .replace(/^(\d+) julgamento\(s\) tipado\(s\)$/u, '$1 typed judgments')
    .replace(/^condição tipada protegida$/u, 'guarded typed condition')
    .replace(/^seletor tipado protegido$/u, 'guarded typed selector')
    .replace(/^mensagem protegida$/u, 'guarded message')
    .replace(/^endpoint protegido$/u, 'guarded endpoint');
}

function shippedPublicFixture(flow) {
  if (!/^[a-z][a-z0-9_-]{2,40}$/u.test(String(flow?.id || ''))) return null;
  const path = join(MODULE_DIR, '..', '..', 'examples', `${flow.id}.flow.json`);
  if (!existsSync(path)) return null;
  try {
    const shipped = JSON.parse(readFileSync(path, 'utf8'));
    if (flowFingerprint(flow) !== flowFingerprint(shipped)) return null;
    return shipped.fixtures?.find(item => item?.input && item?.answers) || null;
  } catch { return null; }
}

export async function buildDemoPage(flowId, { answers, dir, locale, flow: catalogFlow, catalogPreview = false, catalogKey = null } = {}) {
  const i18n = getLocalePack(locale);
  const flow = catalogFlow || loadFlow(flowId, ...(dir ? [{ dir }] : []));
  const flowDir = dir || FLOWS_DIR;
  const publicFixture = !catalogPreview && answers == null ? shippedPublicFixture(flow) : null;
  const readonlyExample = catalogPreview || existsSync(join(EXAMPLES_DIR, `${flow.id}.flow.json`))
    && !existsSync(flowPath(flow.id, { dir: flowDir }));
  // GET da visualização nunca pode disparar webhook/efeito externo. Se não
  // houver uma run gravada, o canvas usa somente o simulador determinístico.
  const { run, origem, simulado, chamadasWebhook } = await executar(flow, {
    answers: catalogPreview ? { ...sugerirRespostas(flow, true), ...(answers || {}) } : publicFixture?.answers || answers,
    input: catalogPreview ? buildExampleInput(flow) : publicFixture?.input,
    forceSimulado: true, ...(dir ? { dir } : {}),
  });
  const publicFlow = catalogPreview ? structuredClone(flow) : projectFlowForPublic(flow);
  const { nodes, edges } = layout(publicFlow);
  if (i18n.locale === 'en') {
    for (const node of nodes) {
      node.rotulo = TYPE_LABELS_EN[node.tipo] || node.rotulo;
      node.sub = englishStudioSubtitle(node.sub);
    }
    for (const edge of edges) edge.label = ({ sim: 'yes', 'não': 'no', padrão: 'default' })[edge.label] || edge.label.replace(/^caso (\d+)$/u, 'case $1');
  }
  const custo = run.steps.reduce((s, st) => s + (run.outputs[st.no]?.custo_usd_estimado || 0), 0);
  const publicRun = projectRunForPublic(run);
  if (catalogPreview) {
    publicRun.input = buildExampleInput(flow);
    publicRun.outputs = structuredClone(run.outputs || {});
  } else if (publicFixture) {
    publicRun.input = structuredClone(publicFixture.input);
  }

  const payload = {
    flow: { id: publicFlow.id, name: publicFlow.name, description: publicFlow.description || '', input_schema: publicFlow.input_schema },
    flow_completo: publicFlow,
    nodes, edges,
    steps: publicRun.steps.map(s => {
      const output = publicRun.outputs[s.no];
      return {
        no: s.no, tipo: s.tipo, ok: s.ok, ms: s.ms, erro: s.erro || null, resumo: s.resumo,
        valores: output?.valores ?? null,
        confianca: menorConfianca(output),
        linha: output?.linha ?? null,
        acao: output?.acao ?? null,
        status: output?.status ?? null,
        url: output?.url ?? null,
        veredicto: output?.veredicto ?? null,
        regra: output?.regra ?? null,
        existe: output?.existe ?? null,
        logic: logicSnapshot(output, s.tipo),
      };
    }),
    input: publicRun.input,
    chamadas: projectWebhookCallsForPublic(chamadasWebhook || []),
    meta: { origem, simulado, custo: catalogPreview ? 0 : custo,
      caminho: publicRun.path, catalogVersion: NODE_CATALOG_VERSION },
    catalog: NODE_DEFINITIONS.map(definition => ({ ...definition, display: {
      ...nodeDisplayDefinition(definition.type),
      ...(i18n.locale === 'en' ? { rotulo: TYPE_LABELS_EN[definition.type] || definition.label } : {}),
    } })),
    logoDataUri: JEV_FLOW_MARK_DATA_URI,
    locale: i18n,
    readonly: readonlyExample,
    catalogPreview,
    catalogKey,
    sampleAnswers: catalogPreview ? { ...sugerirRespostas(flow, true), ...(answers || {}) } : publicFixture?.answers || null,
  };

  return { html: CANVAS_HTML(payload), origem, simulado };
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const GROUP_LABELS_PT = Object.freeze({
  judgment: 'Julgamento Jev', deterministic: 'Determinístico', context: 'Contexto',
  control: 'Controle', logic: 'Grafo de Raciocínio', action: 'Ações', observability: 'Observabilidade',
});

function costLabel(costClass) {
  return ({ free: '$0 · local', jev: 'Jev · tipado', 'jev-conditional': 'Jev · condicional', external: 'efeito externo' })[costClass] || costClass;
}

function riskLabel(riskClass) {
  return ({ low: 'baixo risco', medium: 'risco médio', high: 'alto controle' })[riskClass] || riskClass;
}

function renderNodePalette() {
  const cards = NODE_DEFINITIONS.map(definition => {
    const display = nodeDisplayDefinition(definition.type);
    const search = `${definition.type} ${display.rotulo} ${definition.description} ${definition.group}`.toLowerCase();
    return `<button class="pn node-library-item" data-t="${esc(definition.type)}" data-type="${esc(definition.type)}" data-group="${esc(definition.group)}" data-cost="${esc(definition.costClass)}" data-remote="${definition.remote ? '1' : '0'}" data-search="${esc(search)}">
      <span class="pn-glyph ${esc(display.classe)}">${esc(definition.glyph)}</span>
      <span class="pn-copy"><b>${esc(display.rotulo)}</b><small>${esc(definition.description)}</small><span class="pn-meta"><i>${esc(costLabel(definition.costClass))}</i><i>${definition.remote ? 'rede' : 'sem rede'}</i></span></span>
    </button>`;
  }).join('');
  return `<div class="palette-heading"><div><span class="section-index">01</span><h4>Biblioteca de capacidades</h4></div><code>${esc(NODE_CATALOG_VERSION.replace('jev-flow-node-catalog/', 'v'))}</code></div>
    <label class="node-search-wrap" for="nodeSearch"><span>BUSCAR</span><input id="nodeSearch" type="search" placeholder="padrão, skill, custo, contexto…" autocomplete="off"/></label>
    <div class="node-filters" role="group" aria-label="Filtrar biblioteca de nós">
      <button class="catalog-filter on" data-filter="all">todos</button>
      <button class="catalog-filter" data-filter="free">$0 local</button>
      <button class="catalog-filter" data-filter="jev">Jev</button>
      <button class="catalog-filter" data-filter="no-network">sem rede</button>
    </div>
    <div class="palette-list" id="nodePaletteList">${cards}</div>
    <div class="palette-empty" id="nodePaletteEmpty" hidden>Nenhuma capacidade corresponde a este filtro.</div>
    <div class="dica">Selecione um nó no canvas e adicione a próxima capacidade. O contrato e o exemplo aparecem em <b>Entender</b> antes de salvar.</div>`;
}

function renderCapabilityIndex() {
  const groups = Object.entries(Object.groupBy
    ? Object.groupBy(NODE_DEFINITIONS, definition => definition.group)
    : NODE_DEFINITIONS.reduce((all, definition) => ((all[definition.group] ||= []).push(definition), all), {}));
  return groups.map(([group, definitions], groupIndex) => `<section class="cap-group" data-cap-group="${esc(group)}">
    <div class="cap-group-head"><span class="section-index">${String(groupIndex + 1).padStart(2, '0')}</span><div><h3>${esc(GROUP_LABELS_PT[group] || group)}</h3><p>${definitions.length} capacidades com contrato fechado</p></div></div>
    <div class="cap-list">${definitions.map(definition => {
      const display = nodeDisplayDefinition(definition.type);
      const search = `${definition.type} ${display.rotulo} ${definition.description} ${definition.what} ${group}`.toLowerCase();
      const inputs = Object.entries(definition.inputs || {}).map(([name, description]) => `<li><code>${esc(name)}</code><span>${esc(description)}</span></li>`).join('');
      const outputs = Object.entries(definition.outputs || {}).map(([name, description]) => `<li><code>${esc(name)}</code><span>${esc(description)}</span></li>`).join('');
      return `<details class="cap-node" data-cap-search="${esc(search)}" data-cap-cost="${esc(definition.costClass)}" data-cap-remote="${definition.remote ? '1' : '0'}">
        <summary><span class="cap-glyph ${esc(display.classe)}">${esc(definition.glyph)}</span><span class="cap-title"><b>${esc(display.rotulo)}</b><code>${esc(definition.type)}</code></span><span class="cap-badges"><i>${esc(costLabel(definition.costClass))}</i><i>${definition.remote ? 'rede' : 'local'}</i></span><span class="cap-open" aria-hidden="true">＋</span></summary>
        <div class="cap-detail"><p class="cap-description">${esc(definition.description)}</p><p>${esc(definition.what)}</p>
          <div class="contract-grid"><div><h4>ENTRA</h4><ul>${inputs || '<li><span>sem configuração obrigatória</span></li>'}</ul></div><div><h4>SAI</h4><ul>${outputs || '<li><span>sem payload adicional</span></li>'}</ul></div></div>
          <div class="cap-policy"><span>RISCO · ${esc(riskLabel(definition.riskClass))}</span><span>CACHE · ${definition.cache ? 'sim' : 'não'}</span><span>GERADOR · ${definition.generator ? 'sim' : 'não'}</span></div>
          <div class="cap-fallback"><b>Se algo der errado</b>${esc(definition.fallback)}</div>
          <pre>${esc(JSON.stringify(definition.example, null, 2))}</pre>
        </div>
      </details>`;
    }).join('')}</div>
  </section>`).join('');
}

function CANVAS_HTML(p) {
  const english = p.locale?.locale === 'en';
  const passosOk = p.steps.filter(s => s.ok).length;
  const tempoTotal = p.steps.reduce((s, step) => s + (Number(step.ms) || 0), 0);
  const confiancas = p.steps.map(s => s.confianca).filter(v => Number.isFinite(v));
  const confiancaMin = confiancas.length ? Math.min(...confiancas) : null;
  const operacaoOk = passosOk === p.steps.length;
  return `<!DOCTYPE html>
<html lang="${esc(p.locale?.locale || 'pt-BR')}" data-locale="${esc(p.locale?.locale || 'pt-BR')}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(p.flow.name)} · Jev Flow · Jev Flow</title>
<style>
  :root {
    --bg: #0c0c11; --panel: rgba(22,22,31,.82); --line: rgba(255,255,255,.08);
    --txt: #e7e7ef; --dim: #a0a0b8; --accent: #7c5cff; --accent2: #ff5c8a;
    --ok: #2ecc71; --warn: #e3a008; --err: #ff5252;
  }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body { font-family: 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif; background:
    radial-gradient(1200px 600px at 80% -10%, rgba(124,92,255,.14), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgba(255,92,138,.08), transparent 55%),
    var(--bg); color: var(--txt); overflow: hidden; }

  /* ── barra superior ─────────────────────────────────────────── */
  header { height: 58px; display: flex; align-items: center; gap: 14px; padding: 0 18px;
    background: var(--panel); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); z-index: 20; }
  .logo { display: flex; align-items: center; gap: 9px; font-weight: 600; letter-spacing: .2px; }
  .logo .mark { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 4px 14px rgba(124,92,255,.45); }
  .crumb { color: var(--dim); font-size: 12.5px; }
  .crumb a { color: var(--dim); text-decoration: none; } .crumb a:hover { color: var(--txt); }
  .sep { width: 1px; height: 22px; background: var(--line); }
  h1 { min-width: 0; max-width: 30vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14.5px; font-weight: 600; }
  .pill { font-size: 10.5px; padding: 3px 10px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
  .pill.sim { color: var(--warn); border-color: rgba(227,160,8,.5); background: rgba(227,160,8,.08); }
  .pill.real { color: var(--ok); border-color: rgba(46,204,113,.5); background: rgba(46,204,113,.08); }
  .pill.dim { color: var(--dim); border-color: var(--line); }
  .canvas-locale { display:flex; align-items:center; gap:4px; border:1px solid var(--line); border-radius:8px; padding:6px 8px; color:var(--dim); font-size:10px; }
  .canvas-locale select { appearance:none; border:0; background:transparent; color:var(--txt); font:600 10px inherit; cursor:pointer; }
  .canvas-locale option { background:#14141c; color:#fff; }
  .spacer { flex: 1; }
  .save-cluster { display: flex; align-items: center; gap: 9px; }
  header:has(#btnDuplicar) #btnSalvar { display:none; }
  .save-status { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 132px;
    min-height: 30px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px;
    background: rgba(255,255,255,.03); color: var(--dim); font-size: 10.5px; white-space: nowrap;
    transition: color .2s, border-color .2s, background .2s; }
  .save-status span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
  .save-status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #7c8194; flex: none; }
  .save-status.unsaved { color: #ffd18a; border-color: rgba(227,160,8,.45); background: rgba(227,160,8,.1); }
  .save-status.unsaved::before { background: var(--warn); box-shadow: 0 0 9px rgba(227,160,8,.7); }
  .save-status.saving { color: #d8ccff; border-color: rgba(124,92,255,.5); background: rgba(124,92,255,.1); }
  .save-status.saving::before { background: var(--accent); animation: savePulse 1.1s ease-in-out infinite; }
  .save-status.saved { color: #b8e6c9; border-color: rgba(46,204,113,.4); background: rgba(46,204,113,.08); }
  .save-status.saved::before { background: var(--ok); box-shadow: 0 0 8px rgba(46,204,113,.55); }
  .save-status.readonly { color: #ffd18a; border-color: rgba(227,160,8,.45); background: rgba(227,160,8,.09); }
  .save-status.readonly::before { background: var(--warn); box-shadow: 0 0 8px rgba(227,160,8,.65); }
  .save-status.error { color: #ffb0b0; border-color: rgba(255,82,82,.5); background: rgba(255,82,82,.1); }
  .save-status.error::before { background: var(--err); box-shadow: 0 0 8px rgba(255,82,82,.6); }
  @keyframes savePulse { 50% { opacity: .45; transform: scale(.75); } }
  button.run { display: flex; align-items: center; gap: 7px; border: 0; cursor: pointer; font-weight: 600; font-size: 12.5px;
    padding: 8px 16px; border-radius: 9px; color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 6px 18px rgba(124,92,255,.4); transition: transform .15s; }
  button.run:hover { transform: translateY(-1px); }
  button.run:focus-visible { outline: 2px solid var(--accent2); outline-offset: 3px; }
  button.run:disabled { cursor: wait; opacity: .78; transform: none; }
  button.run.save:disabled { cursor: not-allowed; opacity: .72; box-shadow: none; }
  button.run.duplicate { background: linear-gradient(135deg, #7c5cff, #5d43d6); box-shadow: 0 6px 18px rgba(124,92,255,.28); }
  button.run.save.is-dirty { box-shadow: 0 0 0 3px rgba(227,160,8,.25), 0 6px 18px rgba(46,204,113,.35); }

  /* ── layout geral ───────────────────────────────────────────── */
  main { display: flex; height: calc(100% - 58px); }

  /* ── canvas ─────────────────────────────────────────────────── */
  #viewport { flex: 1; position: relative; overflow: clip; cursor: grab; background-image:
    radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px); background-size: 26px 26px; }
  #viewport::after { content: ''; position: absolute; inset: 0; pointer-events: none;
    box-shadow: inset 0 0 120px rgba(0,0,0,.45); }
  #viewport.panning { cursor: grabbing; }
  #world { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  svg.wires { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
  svg.wires path { fill: none; stroke: rgba(255,255,255,.28); stroke-width: 2.2;
    stroke-linecap: round; stroke-dasharray: 5 7; animation: fluir 1.6s linear infinite;
    transition: opacity .25s, stroke-width .2s; }
  @keyframes fluir { to { stroke-dashoffset: -12; } }
  svg.wires path.glow { opacity: .22; stroke-width: 9; stroke-linecap: round; stroke-dasharray: none; animation: none; }
  svg.wires path.hot { stroke: var(--accent); stroke-width: 3; stroke-dasharray: none; animation: none; }
  svg.wires path.done { stroke: rgba(46,204,113,.7); stroke-width: 2.6; stroke-dasharray: none; animation: none; }
  svg.wires path.dim { opacity: .12; }
  svg.wires path.hl { stroke: var(--accent); stroke-width: 3; opacity: 1; stroke-dasharray: none; animation: none; }
  svg.wires text { fill: var(--dim); font-size: 10px; font-family: 'Segoe UI', sans-serif; }
  svg.wires .labrect { fill: #17171f; stroke: var(--line); rx: 6; }
  .node.sel { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(129,140,248,.25), 0 14px 40px rgba(0,0,0,.5), 0 0 26px rgba(129,140,248,.28); }
  .node:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); box-shadow: 0 16px 38px rgba(0,0,0,.55), 0 0 18px rgba(129,140,248,.18); }
  .node .ico { border-radius: 9px; background: linear-gradient(140deg, rgba(129,140,248,.24), rgba(192,132,252,.16)); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
  .node.running { box-shadow: 0 0 0 2px var(--accent), 0 0 18px rgba(129,140,248,.45); }
  .node.dimmed { opacity: .3; filter: saturate(.4); }
  #minimap { position: absolute; right: 14px; bottom: 14px; width: 176px; height: 118px; background: rgba(11,11,18,.86);
    border: 1px solid var(--bdr2); border-radius: 10px; z-index: 6; cursor: crosshair; overflow: hidden; }
  #minimap .mm-dot { position: absolute; border-radius: 2px; }
  #minimap .mm-view { position: absolute; border: 1px solid var(--accent); background: rgba(129,140,248,.12); pointer-events: none; }
  .layout-switch { position: absolute; left: 64px; top: 14px; z-index: 6; display: flex; gap: 4px; background: rgba(11,11,18,.85); border: 1px solid var(--bdr2); border-radius: 10px; padding: 3px; }
  .layout-switch button { font: 700 10px var(--mono, monospace); padding: 5px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--tx2); cursor: pointer; }
  .layout-switch button.on { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--tx); }

  .node { position: absolute; width: 210px; background: linear-gradient(160deg, rgba(30,30,42,.92), rgba(18,18,26,.9));
    backdrop-filter: blur(10px); border: 1px solid var(--line); border-radius: 13px; padding: 11px 12px 10px; cursor: grab;
    box-shadow: 0 10px 28px rgba(0,0,0,.45); transition: border-color .2s, box-shadow .2s; user-select: none;
    animation: surgirNo .45s ease both; }
  @keyframes surgirNo { from { opacity:0; transform:translateY(10px) scale(.97); } to { opacity:1; transform:none; } }
  .node.ask { border-left: 3px solid var(--accent); }
  .node.jevlet { border-left: 3px solid #8250df; }
  .node.rota { border-left: 3px solid #e3a008; }
  .node.hook { border-left: 3px solid #12b5cb; }
  .node.acao { border-left: 3px solid #64748b; }
  .node:hover { border-color: rgba(124,92,255,.5); box-shadow: 0 10px 28px rgba(0,0,0,.45), 0 0 0 3px rgba(124,92,255,.14); }
  .node.running { border-color: var(--warn); box-shadow: 0 0 0 3px rgba(227,160,8,.25), 0 10px 30px rgba(0,0,0,.5); }
  .node.done { border-color: rgba(46,204,113,.55); }
  .node.fail { border-color: var(--err); }
  .node .head { display: flex; align-items: center; gap: 8px; }
  .node .ico { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 13px; flex: none; }
  .node.ask .ico { background: rgba(124,92,255,.2); } .node.jevlet .ico { background: rgba(130,80,223,.22); }
  .node.rota .ico { background: rgba(227,160,8,.18); } .node.hook .ico { background: rgba(18,181,203,.18); }
  .node.acao .ico { background: rgba(100,116,139,.25); }
  .node .tt { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node .kind { font-size: 9.5px; color: var(--dim); letter-spacing: .4px; text-transform: uppercase; }
  .node .sub { margin-top: 7px; font-size: 10.5px; color: var(--dim); font-family: ui-monospace, Consolas, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pin { position: absolute; top: 50%; width: 9px; height: 9px; border-radius: 50%; background: #0c0c11; border: 2px solid rgba(255,255,255,.35); }
  .pin.in { left: -5px; } .pin.out { right: -5px; }
  .node.start .pin.in { border-color: var(--accent); }
  .stdot { position: absolute; top: 9px; right: 9px; width: 8px; height: 8px; border-radius: 50%; background: #3a3a46; }
  .node.done .stdot { background: var(--ok); } .node.fail .stdot { background: var(--err); }
  .node.running .stdot { background: var(--warn); animation: pulse 1s infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(227,160,8,.18); } }

  .zoomer { position: absolute; left: 14px; bottom: 14px; display: flex; gap: 6px; z-index: 10; }
  .zoomer button { width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--line); color: var(--txt);
    background: var(--panel); backdrop-filter: blur(8px); cursor: pointer; font-size: 15px; }
  .zoomer button:hover { border-color: rgba(255,255,255,.3); }

  /* ── rail de ferramentas do estúdio ─────────────────────────── */
  .rail { position: absolute; left: 12px; top: 12px; display: flex; flex-direction: column; gap: 6px; z-index: 12; }
  .rail button { width: 40px; height: 40px; border-radius: 11px; border: 1px solid var(--line); color: var(--txt);
    background: var(--panel); backdrop-filter: blur(10px); cursor: pointer; font-size: 16px; position: relative;
    transition: border-color .15s, transform .15s; }
  .rail button:hover { border-color: rgba(124,92,255,.7); transform: translateY(-1px); }
  .rail button.on { border-color: var(--accent); background: rgba(124,92,255,.18); }
  .rail .sujinho { position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%;
    background: var(--accent2); box-shadow: 0 0 8px var(--accent2); display: none; }
  .rail.sujo .sujinho { display: block; }
  .rail[hidden] { display:none; }

  /* ── paleta de nós ──────────────────────────────────────────── */
  .paleta { position: absolute; left: 62px; top: 12px; width: 240px; z-index: 12; display: none;
    background: var(--panel); backdrop-filter: blur(14px); border: 1px solid var(--line); border-radius: 13px;
    padding: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.55); }
  .paleta.on { display: block; animation: surgirNo .25s ease; }
  .paleta h4 { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .8px; margin-bottom: 9px; }
  .paleta .pn { display: flex; gap: 9px; align-items: center; width: 100%; text-align: left; border: 1px solid var(--line);
    background: rgba(255,255,255,.03); color: var(--txt); border-radius: 10px; padding: 8px 10px; margin-bottom: 6px;
    cursor: pointer; font-size: 12px; }
  .paleta .pn:hover { border-color: rgba(124,92,255,.7); background: rgba(124,92,255,.1); }
  .paleta .pn small { display: block; color: var(--dim); font-size: 10px; }
  .paleta .dica { font-size: 10.5px; color: var(--dim); margin-top: 8px; line-height: 1.5; }

  /* ── excluir nó ─────────────────────────────────────────────── */
  .node .del { position: absolute; top: -9px; right: -9px; width: 20px; height: 20px; border-radius: 50%;
    border: 1px solid rgba(255,82,82,.6); background: #2d1416; color: #ff8a8a; font-size: 10px; cursor: pointer;
    display: none; z-index: 5; }
  .node:hover .del { display: block; }
  .node .edit { position: absolute; top: -9px; right: 15px; width: 20px; height: 20px; border-radius: 50%;
    border: 1px solid rgba(124,92,255,.7); background: #211b3a; color: #cfc5ff; font-size: 11px; cursor: pointer;
    display: none; place-items: center; z-index: 5; }
  .node:hover .edit, .node:focus-within .edit, .node.sel .edit { display: grid; }
  .node:focus-visible { outline: 2px solid var(--accent2); outline-offset: 4px; }
  .node.sel { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,92,255,.2), 0 10px 28px rgba(0,0,0,.45); }

  /* ── gaveta de testes e conexões ────────────────────────────── */
  .gaveta { position: absolute; left: 0; right: 0; bottom: 0; z-index: 14; display: none; flex-direction: column;
    background: rgba(13,13,19,.94); backdrop-filter: blur(16px); border-top: 1px solid var(--line);
    box-shadow: 0 -18px 50px rgba(0,0,0,.5); max-height: 46%; }
  .gaveta.on { display: flex; animation: subirG .25s ease; }
  @keyframes subirG { from { transform: translateY(18px); opacity: 0; } }
  .gaveta .gt { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--line); }
  .gaveta .gt .tabs2 { display: flex; gap: 4px; }
  .gaveta .gt .tabs2 div { font-size: 11.5px; color: var(--dim); padding: 5px 12px; border-radius: 8px; cursor: pointer; }
  .gaveta .gt .tabs2 div.on { color: var(--txt); background: rgba(124,92,255,.16); }
  .gaveta .gb { flex: 1; overflow: auto; padding: 12px 14px; font-size: 12px; }
  .gaveta .gact { display: flex; gap: 8px; margin-left: auto; }
  .gaveta .gact button { border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--txt);
    border-radius: 8px; padding: 6px 12px; font-size: 11.5px; cursor: pointer; }
  .gaveta .gact button.p { background: linear-gradient(135deg, var(--accent), var(--accent2)); border: 0; font-weight: 600; }
  .fixture-panel { border: 1px solid rgba(124,92,255,.28); border-radius: 12px; padding: 11px 12px; margin-bottom: 10px;
    background: linear-gradient(145deg, rgba(124,92,255,.09), rgba(255,255,255,.025)); }
  .fixture-panel.targeted { border-color: rgba(18,181,203,.72); box-shadow: 0 0 0 3px rgba(18,181,203,.12); }
  .fixture-head { display:flex; align-items:flex-start; gap:10px; margin-bottom:9px; }
  .fixture-head h4 { font-size:12px; color:var(--txt); }
  .fixture-head p { margin-top:3px; color:var(--dim); font-size:10.5px; line-height:1.4; }
  .fixture-state { margin-left:auto; max-width:44%; color:var(--dim); font-size:10px; text-align:right; }
  .fixture-state[ data-state="ok"] { color:#9be2b5; }
  .fixture-state[ data-state="error"] { color:#ffb2b2; }
  .fixture-grid { display:grid; grid-template-columns:minmax(170px,.75fr) minmax(220px,1.25fr); gap:9px; }
  .fixture-field label { display:block; color:var(--dim); font-size:10px; margin:0 0 4px; }
  .fixture-field input, .fixture-field select { width:100%; background:#0c0c11; color:var(--txt); border:1px solid var(--line);
    border-radius:8px; padding:8px 9px; font-size:11px; }
  .fixture-actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:8px; }
  .fixture-actions button { border:1px solid var(--line); background:rgba(255,255,255,.05); color:var(--txt);
    border-radius:7px; padding:6px 9px; font-size:10.5px; cursor:pointer; }
  .fixture-actions button.primary { background:rgba(124,92,255,.18); border-color:rgba(124,92,255,.55); }
  .fixture-actions button.danger { color:#ffb2b2; border-color:rgba(255,82,82,.4); }
  .fixture-actions button:disabled { opacity:.45; cursor:not-allowed; }
  .fixture-note { margin-top:8px; color:#ffd18a; font-size:10.5px; line-height:1.45; }
  .fixture-note[hidden] { display:none; }
  @media (max-width:600px) { .fixture-grid { grid-template-columns:1fr; } .fixture-state { max-width:52%; } }
  .tpasso { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
  .tpasso .th { display: flex; gap: 8px; align-items: center; padding: 8px 11px; cursor: pointer; background: rgba(255,255,255,.02); }
  .tpasso .th b { color: #9db4ff; font-size: 12px; }
  .tpasso .th .k { color: var(--dim); font-size: 10.5px; }
  .tpasso pre { display: none; margin: 0; padding: 10px 12px; border-top: 1px solid var(--line);
    font-size: 10.5px; color: #d2a8ff; white-space: pre-wrap; word-break: break-all; background: rgba(0,0,0,.25); }
  .tpasso.aberto pre { display: block; }
  .copiar { border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--txt); border-radius: 7px;
    padding: 4px 10px; font-size: 11px; cursor: pointer; margin-left: 8px; }

  /* ── copiloto (chat do Jev Flow) ───────────────────────────────── */
  /* ── editor de propriedades do nó (painel lateral) ─────────── */
  .editor-no { background: rgba(15,15,22,.97); backdrop-filter: blur(18px); display: flex; flex-direction: column; }
  .editor-no .eh { padding: 13px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 9px; }
  .editor-no .eh b { font-size: 13px; }
  .editor-no .eh small { color: var(--dim); font-size: 10.5px; display: block; }
  .editor-no .eb { flex: 1; overflow: auto; padding: 14px; }
  .editor-no label { font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .6px;
    display: block; margin: 12px 0 4px; }
  .editor-no input, .editor-no select, .editor-no textarea { width: 100%; background: #0c0c11; color: var(--txt);
    border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 12px;
    font-family: ui-monospace, monospace; }
  .editor-no textarea { min-height: 54px; resize: vertical; }
  .editor-no .ef { padding: 12px 14px; border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: flex-end; }
  .editor-no .mbtn { border: 0; border-radius: 8px; padding: 8px 16px; font-size: 12px; cursor: pointer; font-weight: 600; }
  .editor-no .mbtn.p { background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; }
  .editor-no .mbtn.g { background: rgba(255,255,255,.06); color: var(--txt); border: 1px solid var(--line); }
  .editor-no .qblock { border: 1px solid var(--line); border-radius: 10px; padding: 10px; margin-bottom: 10px; }
  .editor-no .qblock h5 { font-size: 11px; color: #9db4ff; margin: 0 0 6px; display: flex; justify-content: space-between; }
  .editor-no .qblock button.del-q { background: none; border: 0; color: #ff8a8a; cursor: pointer; font-size: 13px; padding: 0 4px; }

  .copiloto { position: fixed; top: 58px; right: -400px; bottom: 0; width: 380px; z-index: 30;
    background: rgba(15,15,22,.97); backdrop-filter: blur(18px); border-left: 1px solid var(--line);
    display: flex; flex-direction: column; transition: right .28s ease; box-shadow: -20px 0 60px rgba(0,0,0,.5); }
  .copiloto.on { right: 0; }
  .copiloto .ch { padding: 13px 16px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 9px; }
  .copiloto .ch b { font-size: 13px; }
  .copiloto .ch small { color: var(--dim); font-size: 10.5px; display: block; }
  .copiloto .msgs { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .bmsg { max-width: 88%; border-radius: 12px; padding: 9px 12px; font-size: 12.5px; line-height: 1.5; }
  .bmsg.u { align-self: flex-end; background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; }
  .bmsg.a { align-self: flex-start; background: rgba(255,255,255,.05); border: 1px solid var(--line); }
  .bmsg.a .res { color: var(--dim); font-size: 11px; margin-top: 5px; }
  .bmsg .mud { color: #b8e6c9; font-size: 11px; margin-top: 5px; }
  .bmsg .acts { display: flex; gap: 7px; margin-top: 8px; }
  .bmsg .acts button { border-radius: 8px; border: 0; padding: 6px 12px; font-size: 11px; cursor: pointer; font-weight: 600; }
  .bmsg .acts .ap { background: linear-gradient(135deg, #2ecc71, #1fa663); color: #fff; }
  .bmsg .acts .ig { background: rgba(255,255,255,.08); color: var(--dim); border: 1px solid var(--line); }
  .bmsg.err { border-color: rgba(255,82,82,.5); }
  .sugs { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
  .sugs button { border: 1px solid var(--line); background: rgba(255,255,255,.04); color: var(--dim);
    border-radius: 999px; padding: 5px 11px; font-size: 10.5px; cursor: pointer; }
  .sugs button:hover { color: var(--txt); border-color: rgba(124,92,255,.6); }
  .copiloto .in { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--line); }
  .copiloto .in textarea { flex: 1; min-height: 42px; max-height: 110px; background: #0c0c11; color: var(--txt);
    border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; font-size: 12.5px; resize: none; }
  .copiloto .in button { border: 0; border-radius: 10px; padding: 0 16px; cursor: pointer; font-size: 15px;
    background: linear-gradient(135deg, var(--accent), var(--accent2)); color: #fff; }
  .legenda { position: absolute; right: 14px; bottom: 14px; z-index: 10; font-size: 10.5px; color: var(--dim);
    background: var(--panel); backdrop-filter: blur(8px); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
  .legenda b { color: var(--txt); font-weight: 600; }

  /* ── painel de dados (direita) ──────────────────────────────── */
  aside { width: 360px; border-left: 1px solid var(--line); background: var(--panel); backdrop-filter: blur(16px);
    display: flex; flex-direction: column; z-index: 15; }
  aside .tabs { display: flex; border-bottom: 1px solid var(--line); }
  aside .tabs div { flex: 1; text-align: center; padding: 11px 0; font-size: 12px; color: var(--dim); cursor: pointer; border-bottom: 2px solid transparent; }
  aside .tabs div.on { color: var(--txt); border-bottom-color: var(--accent); }
  .tabbody { flex: 1; overflow: auto; padding: 14px; display: none; }
  .tabbody.on { display: block; }
  aside .editor-no.tabbody { padding: 0; border: 0; box-shadow: none; }
  aside .editor-no.tabbody.on { display: flex; flex-direction: column; }
  .evidence-summary { border: 1px solid rgba(255,255,255,.11); border-radius: 12px; padding: 12px; margin-bottom: 13px;
    background: linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.02)); }
  .evidence-summary.ok { border-color: rgba(46,204,113,.32); background: linear-gradient(145deg,rgba(46,204,113,.10),rgba(255,255,255,.02)); }
  .evidence-summary.fail { border-color: rgba(255,82,82,.38); background: linear-gradient(145deg,rgba(255,82,82,.10),rgba(255,255,255,.02)); }
  .evidence-kicker { display:flex; align-items:center; gap:7px; color:var(--txt); font:700 10px ui-monospace,Consolas,monospace; letter-spacing:.12em; text-transform:uppercase; }
  .evidence-dot { width:7px; height:7px; border-radius:50%; background:var(--ok); box-shadow:0 0 0 4px rgba(46,204,113,.12); }
  .evidence-summary.fail .evidence-dot { background:var(--err); box-shadow:0 0 0 4px rgba(255,82,82,.12); }
  .evidence-mode { margin-left:auto; color:var(--dim); font-size:9px; letter-spacing:.08em; }
  .evidence-metrics { display:flex; gap:16px; margin-top:12px; color:var(--dim); font-size:10.5px; }
  .evidence-metrics b { color:#fff; font-size:15px; margin-right:3px; font-variant-numeric:tabular-nums; }
  .evidence-note { margin-top:10px; padding-top:9px; border-top:1px solid rgba(255,255,255,.08); color:var(--dim); font-size:10.5px; line-height:1.45; }
  .evidence-note b { color:#fff; font-variant-numeric:tabular-nums; }
  .evidence-note.warn b { color:#ffd18a; }
  .card { border: 1px solid var(--line); border-left: 3px solid var(--line); background: rgba(12,12,17,.6);
    border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; opacity: 0; transform: translateY(6px); transition: all .3s; }
  .card.on { opacity: 1; transform: none; }
  .card.ok { border-left-color: var(--ok); } .card.fail { border-left-color: var(--err); }
  .card b { color: #9db4ff; }
  .card .k { color: var(--dim); font-size: 10.5px; }
  .confidence { display:inline-flex; margin-left:7px; padding:2px 6px; border:1px solid rgba(46,204,113,.28); border-radius:999px; color:#9be2b5; font-size:9.5px; font-variant-numeric:tabular-nums; }
  .confidence.warn { color:#ffd18a; border-color:rgba(227,160,8,.4); background:rgba(227,160,8,.08); }
  .card pre { margin-top: 6px; font-size: 10.5px; color: #d2a8ff; white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, Consolas, monospace; }
  .info-linha { font-size: 11.5px; color: var(--dim); margin: 4px 0 12px; }
  .info-linha code { color: #d2a8ff; }
  .banner { margin-top: 6px; padding: 11px; border-radius: 10px; font-size: 12px; display: none; }
  .banner.ok { display: block; background: rgba(46,204,113,.1); border: 1px solid rgba(46,204,113,.4); }
  .banner.fail { display: block; background: rgba(255,82,82,.1); border: 1px solid rgba(255,82,82,.4); }
  #viewport { touch-action: none; }
  .tabs div:focus-visible { outline: 2px solid var(--accent2); outline-offset: -2px; }
  @media (min-width: 901px) {
    main { min-width: 0; min-height: 0; }
    #viewport { min-width: 0; min-height: 0; }
    aside { min-width: 0; min-height: 0; }
    aside .tabs { flex: 0 0 auto; min-width: 0; }
    .tabbody { min-width: 0; min-height: 0; }
    .tabbody[data-t="exec"] { overflow-x: hidden; overflow-y: auto; scrollbar-gutter: stable; }
  }
  @media (min-width: 901px) and (max-width: 1440px) {
    aside .tabs div { padding: 8px 4px; font-size: 11px; }
    .tabbody { padding: 10px 11px; }
    .evidence-summary { padding: 9px 10px; margin-bottom: 9px; }
    .evidence-kicker { gap: 5px; font-size: 9px; letter-spacing: .08em; }
    .evidence-mode { font-size: 8.5px; letter-spacing: .05em; }
    .evidence-metrics { gap: 8px; margin-top: 8px; font-size: 10px; }
    .evidence-metrics b { font-size: 13px; }
    .evidence-note { margin-top: 7px; padding-top: 7px; font-size: 10px; }
    .info-linha { font-size: 10.5px; margin: 3px 0 8px; }
    .card { padding: 8px 9px; margin-bottom: 7px; font-size: 11px; }
    .card .k { font-size: 10px; }
    .card pre { margin-top: 4px; font-size: 10px; }
  }
  @media (max-width: 900px) {
    header { height:auto; min-height:58px; padding:9px 12px; flex-wrap:wrap; }
    header h1 { max-width:42vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    header .spacer { display:none; }
    header button.run { margin-left:auto; }
    main { height:calc(100vh - 76px); }
    aside { width:min(40vw,360px); }
  }
  @media (max-width: 680px) {
    body { overflow:auto; }
    header { display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; grid-template-areas:
      "logo title mode mode"
      "test save execute execute"
      "meta saved duplicate speed"; gap:8px 10px; padding:8px 12px; align-items:center; }
    header .crumb, header .sep { display:none; }
    header .logo { grid-area:logo; }
    header h1 { grid-area:title; min-width:0; max-width:none; font-size:13px; }
    header .pill.sim, header .pill.real { grid-area:mode; max-width:84px; overflow:hidden; text-overflow:ellipsis; font-size:9.5px; padding:3px 7px; }
    header .pill.dim { grid-area:meta; min-width:0; max-width:142px; overflow:hidden; text-overflow:ellipsis; font-size:9px; padding:3px 7px; opacity:.78; }
    header button.run { font-size:11px; padding:8px 10px; justify-content:center; white-space:nowrap; }
    header #btnTeste { grid-area:test; }
    header #btnSalvar { grid-area:save; }
    header #btnDuplicar { grid-area:duplicate; }
    header #play { grid-area:execute; }
    header:has(#btnDuplicar) #btnSalvar { display:none; }
    header:has(#btnDuplicar) #btnDuplicar { grid-area:save; }
    header .save-cluster { display:contents; }
    header .save-status { grid-area:saved; min-width:0; width:100%; min-height:28px; padding:4px 8px; gap:5px; font-size:9.5px; overflow:hidden; text-overflow:ellipsis; }
    header select { grid-area:speed; width:58px; min-width:58px; padding:5px 4px; font-size:11px; }
    main { display:flex; flex-direction:column; height:auto; min-height:calc(100vh - 74px); }
    #viewport { height:58vh; min-height:380px; flex:none; overflow-x:hidden; overflow-y:auto; touch-action:pan-y; }
    aside { width:100%; min-height:380px; height:42vh; border-left:0; border-top:1px solid var(--line); }
    .legenda { display:none; }
    .node { width:var(--mobile-node-width,220px); max-width:none; }
    .node .pin.in { left:50%; top:-5px; }
    .node .pin.out { right:auto; left:50%; top:auto; bottom:-5px; }
  }
  /* ── Jev Flow Decision Studio · precision instrument pass ─────── */
  @font-face { font-family:'Jev Flow Instrument'; src:url('/synap-instrument.woff2') format('woff2'); font-display:swap; }
  @font-face { font-family:'Jev Flow Editorial'; src:url('/synap-fraunces.woff2') format('woff2'); font-display:swap; }
  :root {
    --bg:#080d12; --panel:#101820; --panel-solid:#111a23; --panel-2:#16212b; --line:rgba(218,229,238,.12);
    --line-strong:rgba(218,229,238,.22); --txt:#eef2ef; --dim:#93a1ad; --accent:#9a83ff; --accent2:#48c7da;
    --ok:#55c88a; --warn:#e3b45d; --err:#ef6c78; --det:#57c99b; --ctx:#5ba8e8; --control:#d7a95c;
    --judgment:#9a83ff; --skill:#f08d63; --action:#e06f78; --observe:#7e91a4;
  }
  body { font-family:'Jev Flow Instrument','Segoe UI Variable','Segoe UI',system-ui,sans-serif; background:var(--bg); color:var(--txt); }
  body:before { content:''; position:fixed; inset:0; pointer-events:none; opacity:.12; background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px); background-size:100% 8px; }
  header { height:66px; padding:0 20px; gap:12px; background:rgba(8,13,18,.96); border-bottom-color:var(--line-strong); backdrop-filter:blur(18px); }
  .logo { gap:10px; letter-spacing:.01em; }
  .brand-mark { width:29px; height:29px; display:block; object-fit:contain; filter:drop-shadow(0 5px 12px rgba(94,97,255,.22)); }
  .brand-word { display:grid; line-height:1.05; }
  .brand-word b { font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
  .brand-word small { margin-top:3px; color:var(--dim); font:8px ui-monospace,Consolas,monospace; letter-spacing:.16em; text-transform:uppercase; }
  .crumb { font:10px ui-monospace,Consolas,monospace; letter-spacing:.04em; }
  header h1 { font-size:13px; letter-spacing:.01em; }
  .pill { border-radius:6px; font-family:ui-monospace,Consolas,monospace; letter-spacing:.04em; text-transform:uppercase; }
  button.run { min-height:38px; border:1px solid var(--line-strong); border-radius:7px; background:#202b36!important; box-shadow:none!important; color:var(--txt); letter-spacing:.01em; }
  button.run.primary { background:#7864d8!important; border-color:#9a83ff; }
  button.run:hover { border-color:var(--accent); background:#283644!important; }
  .save-status { border-radius:6px; background:#0c131a; }
  main { height:calc(100% - 66px); }
  #viewport { background-color:#0a1016; background-image:radial-gradient(rgba(185,205,219,.13) .75px,transparent .75px); background-size:24px 24px; }
  #viewport::after { box-shadow:inset 0 0 100px rgba(0,0,0,.24); }
  svg.wires path { stroke:rgba(176,198,214,.3); stroke-dasharray:none; }
  svg.wires path.hot { stroke:var(--accent2); }
  svg.wires .labrect { fill:#111a23; stroke:var(--line-strong); }
  svg.wires text { fill:#b9c5cd; font-family:ui-monospace,Consolas,monospace; font-weight:700; }
  .node { width:252px; min-height:108px; padding:13px 14px 11px; border-radius:9px; background:#111a23; border-color:var(--line-strong); box-shadow:0 14px 32px rgba(0,0,0,.34); }
  .node:before { content:''; position:absolute; left:-1px; top:14px; bottom:14px; width:3px; border-radius:0 3px 3px 0; background:var(--node-color,var(--observe)); }
  .node.judgment { --node-color:var(--judgment); } .node.deterministic { --node-color:var(--det); }
  .node.context { --node-color:var(--ctx); } .node.control { --node-color:var(--control); }
  .node.logic { --node-color:var(--accent2); }
  .node.skill { --node-color:var(--skill); } .node.action { --node-color:var(--action); }
  .node.observability { --node-color:var(--observe); }
  .node.ask,.node.jevlet,.node.rota,.node.hook,.node.acao { border-left-width:1px; }
  .node:hover,.node.sel { border-color:color-mix(in srgb,var(--node-color) 62%,white 8%); box-shadow:0 14px 32px rgba(0,0,0,.34),0 0 0 3px color-mix(in srgb,var(--node-color) 16%,transparent); }
  .node .head { align-items:flex-start; }
  .node .ico { width:34px; height:34px; border-radius:7px; border:1px solid color-mix(in srgb,var(--node-color) 45%,transparent); background:color-mix(in srgb,var(--node-color) 13%,transparent)!important; color:#f6f4ff; font:700 10px/1 ui-monospace,Consolas,monospace; letter-spacing:-.03em; }
  .node .tt { font-size:12.5px; line-height:1.25; }
  .node .kind { margin-top:3px; color:#9eabb6; font:8.5px ui-monospace,Consolas,monospace; letter-spacing:.1em; }
  .node .sub { margin-top:10px; color:#aeb9c1; font-size:10px; }
  .node-badges { display:flex; gap:5px; flex-wrap:wrap; margin-top:9px; }
  .node-badges span { padding:3px 5px; border:1px solid var(--line); border-radius:4px; color:#98a6b0; font:7.5px ui-monospace,Consolas,monospace; letter-spacing:.07em; text-transform:uppercase; }
  .node-badges .zero { color:#80d9b0; border-color:rgba(87,201,155,.28); }
  .node-badges .risk-high { color:#f39ca4; border-color:rgba(239,108,120,.32); }
  .pin { background:#0a1016; border-color:var(--node-color,var(--observe)); }
  .rail { left:14px; top:14px; }
  .rail button,.zoomer button { border-radius:7px; background:#111a23; border-color:var(--line-strong); min-width:40px; min-height:40px; }
  .rail button:hover,.rail button.on { border-color:var(--accent); background:#1b2530; }
  .canvas-mode-switch { position:absolute; top:14px; right:14px; z-index:13; display:flex; gap:3px; padding:3px; border:1px solid var(--line-strong); border-radius:7px; background:#0d151c; box-shadow:0 8px 24px rgba(0,0,0,.25); }
  .canvas-mode-switch button { min-height:32px; padding:6px 11px; border:0; border-radius:4px; background:transparent; color:#86949e; font:700 9px ui-monospace,Consolas,monospace; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
  .canvas-mode-switch button.on { background:#25313e; color:#f4f1ff; box-shadow:inset 0 0 0 1px rgba(154,131,255,.34); }
  .reasoning-surface { position:absolute; inset:0; z-index:11; overflow:auto; background:#091017; }
  .reasoning-surface[hidden] { display:none; }
  .reasoning-surface:before { content:''; position:fixed; inset:66px 420px 0 0; pointer-events:none; opacity:.24; background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px); background-size:32px 32px; }
  .reasoning-shell { position:relative; width:min(1120px,100%); margin:0 auto; padding:76px 32px 52px; }
  .reasoning-head { display:flex; align-items:flex-start; justify-content:space-between; gap:24px; padding-bottom:18px; border-bottom:1px solid var(--line-strong); }
  .reasoning-head h2 { margin-top:7px; font:600 clamp(23px,3vw,34px) 'Jev Flow Editorial',Georgia,serif; letter-spacing:-.025em; }
  .reasoning-head p { margin-top:7px; max-width:650px; color:#9fadb7; font-size:12px; line-height:1.55; }
  .reasoning-proof { flex:none; padding:5px 7px; border:1px solid rgba(87,201,155,.32); border-radius:4px; color:#7fd9b0; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.09em; }
  .reasoning-intro { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0; }
  .reasoning-intro span { padding:5px 7px; border:1px solid var(--line); border-radius:4px; color:#96a4ae; background:#0d161e; font:8px ui-monospace,Consolas,monospace; text-transform:uppercase; }
  .reasoning-chain { display:grid; grid-template-columns:repeat(4,minmax(170px,1fr)); gap:34px; margin-top:26px; align-items:start; }
  .reasoning-stage { position:relative; min-width:0; }
  .reasoning-stage:not(:last-child):after { content:'→'; position:absolute; top:38px; right:-25px; color:#52616d; font:18px ui-monospace,Consolas,monospace; }
  .reasoning-stage>h3 { display:flex; gap:7px; align-items:center; margin-bottom:10px; color:#7f8d98; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.12em; text-transform:uppercase; }
  .reasoning-stage>h3 span { color:var(--accent2); }
  .reason-card { position:relative; margin-bottom:8px; padding:11px; border:1px solid var(--line-strong); border-radius:7px; background:#111a23; }
  .reason-card:before { content:''; position:absolute; left:-1px; top:9px; bottom:9px; width:2px; background:var(--reason-color,var(--observe)); }
  .reason-card.premise { --reason-color:var(--det); } .reason-card.evaluation { --reason-color:var(--judgment); }
  .reason-card.inference { --reason-color:var(--control); } .reason-card.consequence { --reason-color:var(--action); }
  .reason-card b { display:block; color:#edf1ee; font-size:11px; line-height:1.3; }
  .reason-card code { display:block; margin-top:4px; color:#7f8e99; font-size:8px; word-break:break-word; }
  .reason-card p { margin-top:8px; color:#9faeb8; font-size:9.5px; line-height:1.45; }
  .reason-card .reason-state { display:inline-flex; margin-top:8px; padding:3px 5px; border:1px solid var(--line); border-radius:4px; color:#90a0aa; font:7.5px ui-monospace,Consolas,monospace; text-transform:uppercase; }
  .logic-board { display:grid; grid-template-columns:minmax(190px,.9fr) minmax(230px,1.1fr) minmax(190px,.9fr); gap:38px; margin-top:26px; align-items:start; }
  .logic-column { position:relative; }
  .logic-column:not(:last-child):after { content:'→'; position:absolute; top:48px; right:-27px; color:#52616d; font-size:18px; }
  .logic-column>h3 { margin-bottom:9px; color:#7f8d98; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.12em; text-transform:uppercase; }
  .logic-card { margin-bottom:8px; padding:11px; border:1px solid var(--line-strong); border-radius:7px; background:#111a23; }
  .logic-card b { display:block; font-size:11px; word-break:break-word; }
  .logic-card code { display:block; margin-top:4px; color:#82919c; font-size:8px; }
  .logic-card p { margin-top:7px; color:#9fadb7; font-size:9.5px; line-height:1.45; }
  .logic-card .truth { display:inline-flex; margin-top:8px; padding:3px 5px; border:1px solid var(--line); border-radius:4px; color:#b3bec6; font:7.5px ui-monospace,Consolas,monospace; text-transform:uppercase; }
  .logic-card .truth.true,.logic-card .truth.affirmed,.logic-card .truth.supported { color:#78d6ab; border-color:rgba(87,201,155,.35); }
  .logic-card .truth.false,.logic-card .truth.denied,.logic-card .truth.defeated { color:#f0939b; border-color:rgba(239,108,120,.35); }
  .logic-card .truth.unknown,.logic-card .truth.controversial,.logic-card .truth.contested { color:#e5bd70; border-color:rgba(227,180,93,.35); }
  .logic-audit-note { margin-top:18px; padding:12px 14px; border:1px solid rgba(91,168,232,.25); border-radius:7px; background:rgba(91,168,232,.06); color:#a9b8c2; font-size:10px; line-height:1.5; }
  .paleta { left:66px; top:14px; width:420px; max-height:calc(100% - 28px); overflow:hidden; padding:0; border-radius:10px; background:#0f171f; border-color:var(--line-strong); box-shadow:0 24px 64px rgba(0,0,0,.48); }
  .palette-heading { display:flex; align-items:center; justify-content:space-between; padding:15px 16px 12px; border-bottom:1px solid var(--line); }
  .palette-heading>div { display:flex; align-items:center; gap:9px; }
  .palette-heading h4 { margin:0; color:var(--txt); font-size:11px; letter-spacing:.08em; }
  .palette-heading code { color:#85939f; font-size:9px; }
  .section-index { color:var(--accent2); font:700 9px ui-monospace,Consolas,monospace; }
  .node-search-wrap { display:block; margin:12px 14px 8px; position:relative; }
  .node-search-wrap>span { position:absolute; left:10px; top:10px; color:#6f7d88; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.09em; pointer-events:none; }
  .node-search-wrap input { width:100%; height:34px; padding:7px 10px 7px 62px; border:1px solid var(--line); border-radius:6px; background:#0a1117; color:var(--txt); font:11px inherit; }
  .node-search-wrap input:focus { border-color:var(--accent); outline:0; box-shadow:0 0 0 3px rgba(154,131,255,.13); }
  .node-filters { display:flex; gap:5px; padding:0 14px 10px; overflow-x:auto; }
  .catalog-filter { flex:none; padding:5px 8px; border:1px solid var(--line); border-radius:5px; background:transparent; color:var(--dim); font:9px ui-monospace,Consolas,monospace; cursor:pointer; }
  .catalog-filter.on,.catalog-filter:hover { color:#f3efff; border-color:rgba(154,131,255,.55); background:rgba(154,131,255,.1); }
  .palette-list { max-height:calc(100vh - 285px); overflow:auto; padding:0 10px 8px; }
  .paleta .pn { min-height:66px; margin-bottom:6px; padding:9px; border-radius:7px; background:#121c25; align-items:flex-start; }
  .paleta .pn:hover,.paleta .pn:focus-visible { border-color:rgba(154,131,255,.55); background:#18232d; }
  .pn-glyph { width:34px; height:34px; display:grid; place-items:center; flex:none; border:1px solid var(--line-strong); border-radius:6px; color:#f5f2ff; font:700 9px ui-monospace,Consolas,monospace; }
  .cap-glyph { width:34px; height:34px; display:grid; place-items:center; flex:none; border:1px solid var(--line-strong); border-radius:6px; color:#f5f2ff; background:#17212a; font:700 9px ui-monospace,Consolas,monospace; }
  .cap-glyph.judgment,.pn-glyph.judgment { border-color:rgba(154,131,255,.45); background:rgba(154,131,255,.11); }
  .cap-glyph.deterministic,.pn-glyph.deterministic { border-color:rgba(87,201,155,.42); background:rgba(87,201,155,.1); }
  .cap-glyph.context,.pn-glyph.context { border-color:rgba(91,168,232,.42); background:rgba(91,168,232,.1); }
  .cap-glyph.logic,.pn-glyph.logic { border-color:rgba(72,199,218,.48); background:rgba(72,199,218,.1); }
  .cap-glyph.control,.pn-glyph.control { border-color:rgba(215,169,92,.42); background:rgba(215,169,92,.1); }
  .cap-glyph.skill,.pn-glyph.skill { border-color:rgba(240,141,99,.42); background:rgba(240,141,99,.1); }
  .cap-glyph.action,.pn-glyph.action { border-color:rgba(224,111,120,.42); background:rgba(224,111,120,.1); }
  .pn-copy { min-width:0; display:block; flex:1; }
  .pn-copy b { display:block; color:var(--txt); font-size:11.5px; }
  .paleta .pn .pn-copy small { margin-top:3px; line-height:1.35; white-space:normal; color:#93a1ad; }
  .pn-meta { display:flex; gap:5px; margin-top:6px; }
  .pn-meta i { padding:2px 5px; border:1px solid var(--line); border-radius:4px; color:#8695a0; font:normal 7.5px ui-monospace,Consolas,monospace; text-transform:uppercase; }
  .palette-empty { margin:4px 14px 10px; padding:12px; border:1px dashed var(--line-strong); color:var(--dim); font-size:11px; text-align:center; }
  .paleta .dica { margin:0; padding:10px 14px 13px; border-top:1px solid var(--line); background:#0c1319; }
  aside { width:420px; background:#0d151c; border-left-color:var(--line-strong); backdrop-filter:none; }
  aside .tabs { min-height:46px; overflow-x:auto; scrollbar-width:none; }
  aside .tabs::-webkit-scrollbar { display:none; }
  aside .tabs div { flex:0 0 auto; min-width:78px; padding:15px 12px 11px; color:#83919c; font:700 9px ui-monospace,Consolas,monospace; letter-spacing:.08em; text-transform:uppercase; }
  aside .tabs div.on { color:#f2efff; border-bottom-color:var(--accent); }
  .tabbody { padding:16px; }
  .evidence-summary,.card { border-radius:7px; background:#111a23; }
  .guide-hero { padding:15px; border:1px solid var(--line-strong); border-radius:8px; background:#111a23; }
  .guide-kicker { display:flex; align-items:center; gap:8px; color:var(--accent2); font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.12em; text-transform:uppercase; }
  .guide-title { display:flex; gap:11px; align-items:center; margin-top:11px; }
  .guide-title .cap-glyph { width:38px; height:38px; }
  .guide-title h3 { font:600 18px 'Jev Flow Editorial',Georgia,serif; letter-spacing:-.02em; }
  .guide-title code { display:block; margin-top:3px; color:#84939e; font-size:9px; }
  .guide-copy { margin-top:12px; color:#bdc7ce; font-size:12px; line-height:1.55; }
  .guide-badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
  .guide-badges span { padding:4px 6px; border:1px solid var(--line); border-radius:4px; color:#aab6bf; font:8px ui-monospace,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase; }
  .guide-section { margin-top:15px; }
  .guide-section h4 { margin-bottom:7px; color:#7f8e99; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.13em; text-transform:uppercase; }
  .contract-list { display:grid; gap:5px; list-style:none; padding:0; }
  .contract-list li { display:grid; grid-template-columns:minmax(76px,.65fr) 1.5fr; gap:8px; padding:7px 8px; border:1px solid var(--line); border-radius:5px; background:#0a1117; }
  .contract-list code { color:#c4b7ff; font-size:9px; word-break:break-word; }
  .contract-list span { color:#aeb9c1; font-size:10px; line-height:1.35; }
  .guide-example { margin:0; padding:10px; border:1px solid var(--line); border-radius:6px; background:#080e13; color:#b9c7d1; font-size:9.5px; white-space:pre-wrap; overflow:auto; }
  .flow-explain { margin-top:18px; }
  .flow-explain-head { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; margin-bottom:8px; }
  .flow-explain-head h3 { font-size:13px; }
  .flow-explain-head span { color:var(--dim); font:8px ui-monospace,Consolas,monospace; text-transform:uppercase; }
  .flow-timeline { list-style:none; padding:0; counter-reset:flow-step; }
  .flow-timeline li { counter-increment:flow-step; display:grid; grid-template-columns:25px 1fr; gap:9px; position:relative; padding:7px 0; }
  .flow-timeline li:before { content:counter(flow-step,decimal-leading-zero); color:var(--accent2); font:700 9px ui-monospace,Consolas,monospace; padding-top:2px; }
  .flow-timeline li:not(:last-child):after { content:''; position:absolute; left:11px; top:25px; bottom:-5px; width:1px; background:var(--line-strong); }
  .flow-step-copy { padding:9px 10px; border:1px solid var(--line); border-radius:6px; background:#101921; }
  .flow-step-copy b { display:block; color:#edf1ee; font-size:11px; }
  .flow-step-copy code { margin-left:5px; color:#82919c; font-size:8.5px; }
  .flow-step-copy p { margin-top:4px; color:#98a6b0; font-size:10px; line-height:1.4; }
  .editor-no input,.editor-no select,.editor-no textarea { background:#080f14; border-radius:6px; }
  .editor-doc { margin:-1px -1px 13px; padding:11px 12px; border:1px solid var(--line); border-radius:7px; background:#111b24; }
  .editor-doc b { display:block; font-size:11px; }
  .editor-doc p { margin-top:4px; color:var(--dim); font-size:10px; line-height:1.45; }
  .config-error { display:none; margin-top:7px; color:#f29aa3; font-size:10px; }
  .config-error.on { display:block; }
  :focus-visible { outline:2px solid var(--accent2)!important; outline-offset:3px!important; }
  @media (max-width:900px) { aside { width:min(44vw,420px); } }
  @media (min-width:681px) and (max-width:1200px) {
    header { display:grid; height:auto; min-height:102px; padding:10px 14px;
      grid-template-columns:auto minmax(0,1fr) auto auto auto;
      grid-template-areas:"logo title title title mode" "test save speed replay locale"; gap:8px 10px; }
    header .logo { grid-area:logo; }
    header .crumb, header .sep, header .spacer, header .pill.dim { display:none; }
    header h1 { grid-area:title; min-width:0; max-width:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    header .pill.sim, header .pill.real { grid-area:mode; white-space:nowrap; }
    header #btnTeste { grid-area:test; }
    header .save-cluster { grid-area:save; min-width:0; }
    header #vel { grid-area:speed; }
    header #play { grid-area:replay; }
    header .locale-picker { grid-area:locale; }
    main { height:calc(100vh - 102px); }
  }
  @media (min-width:1201px) and (max-width:1600px) {
    header .pill.dim + .pill.dim { display:none; }
  }
  @media (max-width:680px) {
    header { min-height:128px; grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:"logo title mode" "test save execute" "saved saved speed"; }
    header .brand-word small { display:none; }
    header .pill.dim { display:none; }
    main { min-height:calc(100vh - 128px); }
    #viewport { height:54vh; }
    aside { width:100%; height:auto; min-height:520px; }
    .paleta { position:fixed; left:10px; right:10px; top:138px; width:auto; max-height:calc(100vh - 148px); }
    .palette-list { max-height:calc(100vh - 410px); }
    .node { width:var(--mobile-node-width,252px); }
    .canvas-mode-switch { top:9px; right:9px; }
    .reasoning-surface:before { inset:128px 0 0; }
    .reasoning-shell { padding:64px 14px 34px; }
    .reasoning-head { display:block; }
    .reasoning-proof { display:inline-flex; margin-top:12px; }
    .reasoning-chain,.logic-board { grid-template-columns:1fr; gap:18px; }
    .reasoning-stage:not(:last-child):after,.logic-column:not(:last-child):after { content:'↓'; top:auto; right:50%; bottom:-17px; }
  }
  @media (prefers-reduced-motion:reduce) { *,*:before,*:after { animation-duration:.01ms!important; animation-iteration-count:1!important; scroll-behavior:auto!important; transition-duration:.01ms!important; } }
</style>
</head>
<body>
<header>
  <div class="logo"><img class="brand-mark" src="${esc(p.logoDataUri)}" alt=""/><span class="brand-word"><b>Jev Flow</b><small>Decision Studio</small></span></div>
  <div class="crumb">/ <a href="/">dashboard</a> / <a href="/jev/flows">jev flow</a></div>
  <div class="sep"></div>
  <h1>${esc(p.flow.name)}</h1>
  <span class="pill ${p.meta.simulado ? 'sim' : 'real'}">${esc(p.meta.simulado ? 'julgamento simulado' : 'execução real')}</span>
  ${p.catalogPreview ? '<span class="pill dim">cenário sintético · sem chamada Jev</span>' : ''}
  <span class="pill dim">${p.steps.length} ${english ? 'steps' : 'passos'} · ${p.edges.length} ${english ? 'edges' : 'arestas'}${!p.meta.simulado && p.meta.custo ? ' · ≈$' + p.meta.custo.toFixed(6) : ''}</span>
  <div class="spacer"></div>
  <button class="run" id="btnTeste">${esc(p.locale?.execution || 'Testar')}</button>
  <div class="save-cluster">
    <button class="run save" id="btnSalvar" aria-describedby="saveStatus" aria-label="${p.readonly ? 'Salvar desabilitado: exemplo shipped somente leitura' : 'Salvar flow'}"${p.readonly ? ' disabled' : ''}>${p.readonly ? 'Somente leitura' : 'Salvar'}</button>
    <div class="save-status ${p.readonly ? 'readonly' : 'saved'}" id="saveStatus" role="status" aria-live="polite" aria-atomic="true"${p.readonly ? ' aria-label="Somente leitura; duplique para editar"' : ''}><span id="saveStatusText">${p.catalogPreview ? 'Prévia do catálogo · somente leitura' : p.readonly ? 'Exemplo somente leitura' : english ? 'All changes saved' : 'Tudo salvo'}</span></div>
    ${p.readonly ? '<button class="run duplicate" id="btnDuplicar" type="button" aria-describedby="saveStatus">Duplicar para editar</button>' : ''}
  </div>
  <select id="vel" title="velocidade do replay" style="background:#17171f;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12px;cursor:pointer">
    <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="1.6">1.6×</option>
  </select>
  <button class="run primary" id="play">${p.catalogPreview ? 'Reproduzir amostra' : 'Executar'}</button>
  <label class="locale-picker canvas-locale" title="Idioma"><span aria-hidden="true">◎</span><select id="canvasLocale" aria-label="Idioma"><option value="pt-BR"${p.locale?.locale === 'pt-BR' ? ' selected' : ''}>Português (Brasil)</option><option value="en"${p.locale?.locale === 'en' ? ' selected' : ''}>English</option><option value="es"${p.locale?.locale === 'es' ? ' selected' : ''}>Español</option></select></label>
</header>
<main>
  <div id="viewport">
    <div id="world">
      <svg class="wires" id="wires"></svg>
      <div id="nodes"></div>
    </div>
    <div class="layout-switch" id="layoutSwitch" role="group" aria-label="Layout do grafo">
      <button class="on" data-layout="timeline" aria-pressed="true">⇄ ${english ? 'Flow' : 'Fluxo'}</button>
      <button data-layout="camadas" aria-pressed="false">⇊ ${english ? 'Layers' : 'Camadas'}</button>
      <button data-layout="radial" aria-pressed="false">◎ Radial</button>
    </div>
    <div id="minimap" title="minimapa — clique para navegar"></div>
    <div class="canvas-mode-switch" role="group" aria-label="Modo de representação">
      <button class="on" data-canvas-mode="flow" aria-pressed="true">Fluxo</button>
      <button data-canvas-mode="reasoning" aria-pressed="false">Raciocínio</button>
    </div>
    <section class="reasoning-surface" id="reasoningSurface" aria-label="Grafo de Raciocínio" hidden>
      <div class="reasoning-shell">
        <div class="reasoning-head"><div><span class="section-index">02</span><h2>Grafo de Raciocínio</h2><p>Premissas, avaliações, políticas e conclusões — com incerteza e derrotadores explícitos.</p></div><span class="reasoning-proof">EXPLICAÇÃO DETERMINÍSTICA</span></div>
        <div id="reasoningGraph"></div>
      </div>
    </section>
    <div class="legenda">${english ? '<b>click ✎</b> to edit · <b>drag</b> nodes · <b>scroll</b> to zoom · <b>drag the background</b> to pan' : '<b>clique no ✎</b> editar · <b>arraste</b> nós · <b>scroll</b> zoom · <b>arraste o fundo</b> pan'}</div>
    <div class="zoomer">
      <button id="zin">+</button><button id="zout">−</button><button id="zfit" title="enquadrar">⤢</button><button id="ztour" title="tour explicado para leigos">🎓</button>
    </div>
    <div id="tourPanel" style="display:none;position:absolute;left:64px;bottom:18px;z-index:9;width:min(430px,calc(100% - 84px));background:rgba(14,14,26,.97);border:1px solid #27273a;border-radius:14px;padding:14px 16px;box-shadow:0 18px 50px rgba(0,0,0,.55)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font:800 10px 'JetBrains Mono',monospace;letter-spacing:.12em;color:#c084fc">🎓 TOUR PARA LEIGOS</span>
        <span id="tourPos" style="margin-left:auto;font:700 10px 'JetBrains Mono',monospace;color:#5c5c72"></span>
        <button id="tourClose" style="border:0;background:transparent;color:#7d7d96;cursor:pointer;font-size:14px">✕</button>
      </div>
      <div id="tourTitulo" style="font-weight:800;font-size:13px;margin-bottom:6px"></div>
      <div id="tourTexto" style="font-size:12px;line-height:1.65;color:#bdbdd4;min-height:44px"></div>
      <div style="display:flex;gap:6px;margin-top:10px">
        <button id="tourPrev" style="flex:1;padding:7px;border-radius:8px;border:1px solid #27273a;background:transparent;color:#7d7d96;cursor:pointer">← anterior</button>
        <button id="tourNext" style="flex:1;padding:7px;border-radius:8px;border:0;background:linear-gradient(135deg,#818cf8,#c084fc);color:#0b0b14;font-weight:800;cursor:pointer">próximo →</button>
      </div>
    </div>

    <div class="rail" id="rail">
      <button id="rbPaleta" title="adicionar capacidade" aria-label="Abrir biblioteca de capacidades" aria-expanded="false" aria-controls="paleta">＋</button>
      <button id="rbCopiloto" title="copiloto do Jev Flow" aria-label="Abrir copiloto do Jev Flow" aria-expanded="false" aria-controls="copiloto">A</button>
      <button id="rbGaveta" title="testes e conexões" aria-label="Abrir testes e conexões" aria-expanded="false" aria-controls="gaveta">T</button>
    </div>
    <div class="paleta" id="paleta">
      ${renderNodePalette()}
    </div>

    <div class="gaveta" id="gaveta">
      <div class="gt">
    <div class="tabs2" role="tablist" aria-label="Ferramentas do flow">
          <div class="on" data-g="teste" role="tab" tabindex="0" aria-selected="true">Teste</div>
          <div data-g="simulador" role="tab" tabindex="0" aria-selected="false">🧪 Simulador</div>
          <div data-g="conex" role="tab" tabindex="0" aria-selected="false">Conexões</div>
        </div>
        <div class="gact">
          <button id="gInputBtn">editar input</button>
          <button class="p" id="gRodar">▶ rodar</button>
        </div>
      </div>
      <div class="gb" data-g="teste">
        <section class="fixture-panel" id="fixturePanel" aria-labelledby="fixtureTitle">
          <div class="fixture-head">
            <div><h4 id="fixtureTitle">Fixtures reproduzíveis</h4><p>Salve entradas nomeadas no rascunho para repetir um teste sem alterar histórico.</p></div>
            <div class="fixture-state" id="gFixtureState" role="status" aria-live="polite" aria-atomic="true" data-state="idle">nenhuma fixture selecionada</div>
          </div>
          <div class="fixture-grid">
            <div class="fixture-field">
              <label for="gFixtureSelect">fixture selecionada</label>
              <select id="gFixtureSelect" aria-describedby="gFixtureHelp"><option value="">nova fixture</option></select>
              <div class="fixture-actions"><button id="gFixtureNew" type="button">＋ nova</button><button id="gFixtureRemove" class="danger" type="button" disabled>remover</button></div>
            </div>
            <div class="fixture-field">
              <label for="gFixtureName">nome</label>
              <input id="gFixtureName" type="text" maxlength="80" placeholder="ex.: cobrança urgente" autocomplete="off" />
              <div class="fixture-actions"><button id="gFixtureSave" class="primary" type="button">Salvar fixture</button></div>
            </div>
          </div>
          <p id="gFixtureHelp" class="fixture-note" hidden></p>
          <pre id="gFixtureExpected" class="fixture-note" hidden></pre>
        </section>
        <textarea id="gInput" style="display:none;width:100%;min-height:64px;background:#0c0c11;color:#d2a8ff;border:1px solid var(--line);border-radius:10px;padding:9px;font-size:11.5px;font-family:ui-monospace,monospace"></textarea>
        ${p.catalogPreview ? '<label for="gAnswers" style="display:block;color:var(--dim);font-size:11px;margin-top:10px">Respostas Jev simuladas (JSON) — cenário fixo de exemplo. O input não é analisado por Jev. Se editar a entrada, informe também as respostas tipadas do caso.</label><textarea id="gAnswers" spellcheck="false" style="display:block;width:100%;min-height:86px;background:#0c0c11;color:#d2a8ff;border:1px solid var(--line);border-radius:10px;padding:9px;font-size:11.5px;font-family:ui-monospace,monospace"></textarea>' : ''}
        <div id="gResultado" data-state="idle" role="status" aria-live="polite" aria-atomic="true" style="margin-top:8px"><span style="color:var(--dim)"><b style="color:var(--txt)">pronto para testar</b> — edite o input se necessário e rode o flow; sem chave Jev, a simulação é determinística e não grava histórico.</span></div>
      </div>
      <div class="gb" data-g="simulador" style="display:none">
        <p style="color:var(--dim);font-size:11.5px;line-height:1.6;margin-bottom:10px">
          <b style="color:var(--txt)">Bateria de cenários</b> — roda TODAS as fixtures de uma vez em simulação determinística (sem rede, sem custo, sem gravar). Fixtures com <code>esperado</code> viram <b>testes</b>: veredicto, regra, exceção, status final e se o webhook pode disparar.</p>
        <div class="gact" style="margin-bottom:8px">
          <button class="p" id="simRodar">▶ rodar bateria</button>
          <span id="simResumo" style="color:var(--dim);font-size:11px"></span>
        </div>
        <textarea id="simExtras" placeholder="cenários extras (opcional) — um JSON por linha: {&quot;nome&quot;:&quot;caso novo&quot;,&quot;input&quot;:{…},&quot;answers&quot;:{…},&quot;esperado&quot;:{…}}" style="width:100%;min-height:44px;background:#0c0c11;color:#d2a8ff;border:1px solid var(--line);border-radius:10px;padding:9px;font-size:11px;font-family:ui-monospace,monospace;margin-bottom:8px"></textarea>
        <div id="simResultado" role="status" aria-live="polite" aria-atomic="true"></div>

        <p style="color:var(--dim);font-size:11.5px;line-height:1.6;margin:16px 0 8px">
          <b style="color:var(--txt)">Forçar julgamentos</b> — escolha a resposta de cada pergunta e reaplicar no replay (o canvas refaz o caminho com esses valores, sem custo):</p>
        <div id="simPerguntas" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px"></div>
        <div class="gact"><button id="simAplicar">aplicar no replay</button><button id="simLimpar">limpar</button></div>

        <p style="color:var(--dim);font-size:11.5px;line-height:1.6;margin:16px 0 8px">
          <b style="color:var(--txt)">Flow design</b> — describe a workflow goal. A configured chat model returns a draft Flow JSON; the local validator checks it before you import or edit it:</p>
        <textarea id="omniTarefa" placeholder="ex.: revisar os 20 PRs abertos e comentar apenas os riscos reais" style="width:100%;min-height:44px;background:#0c0c11;color:#d2a8ff;border:1px solid var(--line);border-radius:10px;padding:9px;font-size:11.5px"></textarea>
        <div class="gact" style="margin-top:8px"><button class="p" id="omniRodar">design a draft</button></div>
        <div id="omniResultado" role="status" aria-live="polite" aria-atomic="true" style="margin-top:8px"></div>
      </div>
      <div class="gb" data-g="conex" style="display:none">
        <p style="color:var(--dim);font-size:11.5px;line-height:1.6;margin-bottom:10px">
          ${p.catalogPreview ? '<b style="color:var(--txt)">Prévia local</b> — este fluxo ainda não foi instalado. A rota abaixo só simula, sem Jev e sem gravar.' : '<b style="color:var(--txt)">Gatilho para qualquer app</b> — dispare este flow de fora (Zapier, Telegram bot, cron, curl ou seu próprio serviço):'}</p>
        <div style="background:#0c0c11;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-family:ui-monospace,monospace;font-size:10.5px;color:#d2a8ff;word-break:break-all">
          ${p.catalogPreview ? '<span id="gUrl"></span> · POST JSON com chave canônica e input tipado' : 'curl -X POST <span id="gUrl"></span> \\<br/>&nbsp;&nbsp;-H "content-type: application/json" \\<br/>&nbsp;&nbsp;-d \'{"input": {…campos do input_schema…}}\''}
        </div><button class="copiar" id="gCopiar">${p.catalogPreview ? 'copiar pedido JSON' : 'copiar comando'}</button>
        <p style="color:var(--dim);font-size:11.5px;line-height:1.6;margin-top:12px">
          ${p.catalogPreview ? 'Duplique para editar e instale uma cópia antes de usar um gatilho externo.' : '<b style="color:var(--txt)">Saída para apps</b> — nós webhook chamam a URL que você configurar; em teste (sem chave Jev) a chamada é interceptada e exibida na aba Teste, sem sair da sua máquina.'}</p>
      </div>
    </div>
  </div>
  <aside>
    <div class="tabs" role="tablist" aria-label="Evidências da execução">
      <div class="on" data-t="exec" role="tab" tabindex="0" aria-selected="true">Execução</div>
      <div data-t="guide" role="tab" tabindex="0" aria-selected="false">Entender</div>
      <div data-t="dados" role="tab" tabindex="0" aria-selected="false">Dados</div>
      <div data-t="flow" role="tab" tabindex="0" aria-selected="false">Flow</div>
      <div id="editorTab" data-t="edit" role="tab" tabindex="0" aria-selected="false">Editar</div>
    </div>
    <div class="tabbody" data-t="guide">
      <div id="nodeGuide" class="guide-hero">
        <div class="guide-kicker"><span class="section-index">NÓ</span> contrato didático</div>
        <div class="guide-copy">Selecione qualquer bloco do canvas. Aqui você verá o que entra, o que sai, custo, risco, rede, cache, fallback e um exemplo pronto.</div>
      </div>
      <section class="flow-explain" aria-labelledby="flowExplainTitle">
        <div class="flow-explain-head"><h3 id="flowExplainTitle">Explicar flow</h3><span>gerado sem LLM</span></div>
        <ol class="flow-timeline" id="flowTimeline"></ol>
      </section>
    </div>
    <div class="tabbody on" data-t="exec">
      <div class="evidence-summary ${operacaoOk ? 'ok' : 'fail'}" role="status" aria-live="polite">
        <div class="evidence-kicker"><span class="evidence-dot"></span>${operacaoOk ? 'operação concluída' : 'operação com falha'}<span class="evidence-mode">${p.meta.simulado ? 'SIMULAÇÃO' : 'EXECUÇÃO REAL'}</span></div>
        <div class="evidence-metrics"><span><b>${passosOk}/${p.steps.length}</b> ${english ? 'steps' : 'passos'}</span><span><b>${tempoTotal}ms</b> ${english ? 'duration' : 'duração'}</span><span><b>${p.meta.caminho.length}</b> ${english ? 'path nodes' : 'caminho'}</span></div>
        ${confiancaMin == null ? '' : '<div class="evidence-note ' + (confiancaMin < 0.65 ? 'warn' : '') + '">' + (p.meta.simulado ? (english ? 'simulated scenario confidence ' : 'confiança do cenário simulado ') : (english ? 'lowest Jev confidence ' : 'menor confiança Jev ')) + '<b>' + Math.round(confiancaMin * 100) + '%</b>' + (p.meta.simulado ? (english ? ' · no inference from input' : ' · sem inferência do input') : confiancaMin < 0.65 ? (english ? ' · review before automation' : ' · revisar antes de automatizar') : (english ? ' · evidence within operational threshold' : ' · evidência dentro do limiar operacional')) + '</div>'}
      </div>
      <div class="info-linha">input: <code>${esc(JSON.stringify(p.input))}</code></div>
      <div id="cards"></div>
      <div class="banner" id="banner"></div>
    </div>
    <div class="tabbody" data-t="dados">
      <div class="info-linha">Saídas por nó desta execução.</div>
      <div id="dados"></div>
    </div>
    <div class="tabbody" data-t="flow">
      <div class="info-linha">${esc(p.flow.description)}</div>
      <div class="card on ok"><b>input_schema</b><pre>${esc(JSON.stringify(p.flow.input_schema, null, 1))}</pre></div>
      <div class="card on ok"><b>caminho executado</b><pre>${esc(p.meta.caminho.join(' → '))}</pre></div>
      <div class="card on ok"><b>fonte</b><pre>${esc(p.meta.origem)}</pre></div>
    </div>
    <div class="tabbody editor-no" id="editorNo" data-t="edit" role="tabpanel" aria-labelledby="editorTab">
      <div class="eh">
        <div id="enIcone" class="cap-glyph judgment">Jv</div>
        <div><b id="enId">nó</b> <small id="enTipo">tipo</small></div>
        <div style="flex:1"></div>
        <button class="copiar" id="enFechar">fechar</button>
      </div>
      <div class="eb" id="enCorpo"><div class="info-linha">Selecione um nó no grafo para editar suas propriedades.</div></div>
      <div class="ef">
        <button class="mbtn g" id="enCancelar">cancelar</button>
        <button class="mbtn p" id="enSalvar">✔ Aplicar no rascunho</button>
      </div>
    </div>
  </aside>
</main>

<div class="copiloto" id="copiloto">
  <div class="ch">
    <img class="brand-mark" src="${esc(p.logoDataUri)}" alt=""/>
    <div><b>Copiloto do Jev Flow</b><small>edite o flow conversando — o validador fiscaliza cada patch</small></div>
    <div style="flex:1"></div>
    <button class="copiar" id="cpFechar">fechar</button>
  </div>
  <div class="msgs" id="cpMsgs"></div>
  <div class="sugs">
    <button data-s="adicione um aviso por webhook quando o julgamento for crítico">➕ aviso quando crítico</button>
    <button data-s="adicione um caso de erro no switch que registre no log e não pare o flow">➕ tratamento de erro</button>
    <button data-s="resuma o propósito de cada nó em descrições curtas">✨ clareza</button>
  </div>
  <div class="in">
    <textarea id="cpInput" placeholder="ex.: adiciona um e-mail para o time quando urgente…"></textarea>
    <button id="cpEnviar">➤</button>
  </div>
</div>

<script>
  var D = ${serializeForInlineScript(p)};
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var canvasLocale = document.getElementById('canvasLocale');
  if (canvasLocale) canvasLocale.onchange = function () { var u = new URL(location.href); u.searchParams.set('lang', canvasLocale.value); location.href = u.toString(); };
  var world = document.getElementById('world'), vp = document.getElementById('viewport');
  var wires = document.getElementById('wires'), nodesEl = document.getElementById('nodes');
  function applyStaticLocale(pack) {
    var map = pack && pack.staticCopy || {};
    if (!Object.keys(map).length) return;
    var blocked = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, INPUT: 1 };
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), textNodes = [], current;
    while ((current = walker.nextNode())) textNodes.push(current);
    textNodes.forEach(function (node) {
      if (blocked[node.parentElement && node.parentElement.tagName]) return;
      var raw = node.nodeValue || '', trimmed = raw.trim();
      if (map[trimmed]) node.nodeValue = raw.replace(trimmed, map[trimmed]);
    });
    document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(function (el) {
      ['title', 'aria-label', 'placeholder'].forEach(function (attr) { var value = el.getAttribute(attr); if (value && map[value]) el.setAttribute(attr, map[value]); });
    });
  }
  applyStaticLocale(D.locale);
  var pos = {}, desktopPos = {};
  D.nodes.forEach(function (n) { pos[n.id] = { x: n.x, y: n.y }; desktopPos[n.id] = { x: n.x, y: n.y }; });
  var zoom = 1, panX = 0, panY = 0, W = 252, H = 108;
  function isMobileGraph() { return window.matchMedia('(max-width: 680px)').matches; }

  function apply() {
    world.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + zoom + ')';
    drawWires();
    if (typeof syncMinimap === 'function') syncMinimap();
  }
  function nodeEl(id) { return nodesEl.querySelector('[data-id="' + id + '"]'); }

  // nós (criação reutilizável — paleta/exclusão remontam com a mesma política)
  var CATALOG_BY_TYPE = Object.create(null), TIPOS_UI = Object.create(null);
  (D.catalog || []).forEach(function (definition) {
    CATALOG_BY_TYPE[definition.type] = definition;
    var display = definition.display || {};
    TIPOS_UI[definition.type] = [definition.glyph || '··', display.classe || definition.group || 'action', display.rotulo || definition.label || definition.type];
  });
  function costLabelUi(cost) {
    return ({ free: '$0 local', jev: 'Jev', 'jev-conditional': 'Jev cond.', external: 'externo' })[cost] || cost || 'custo n/d';
  }
  function subtituloNo(n) {
    if (n.questions) return Object.keys(n.questions).length + ' julgamento(s) tipado(s)';
    if (n.jevlet) return 'jevlet catalogado';
    if (n.when) return 'condição tipada protegida';
    if (n.on) return 'seletor tipado protegido';
    if (n.url) return 'endpoint protegido';
    if (n.texto) return 'mensagem protegida';
    if (n.values) return Object.keys(n.values).length + ' variável(is)';
    if (n.skill) return 'skill determinística registrada';
    if (n.claim) return 'alegação e evidência protegidas';
    if (n.operator) return 'comparação ' + n.operator;
    if (n.paths) return Object.keys(n.paths).length + ' extração(ões)';
    if (n.table) return Object.keys(n.table).length + ' entrada(s) catalogada(s)';
    if (n.event) return 'evento redigido';
    if (n.budget) return Object.keys(n.budget).length + ' limite(s) reservado(s)';
    if (n.messages) return 'mensagens protegidas · fail-open';
    if (n.graph && typeof n.graph === 'object') return Object.keys(n.graph.facts || {}).length + ' fatos · ' + (n.graph.rules || []).length + ' políticas';
    return '';
  }
  var idxNo = 0;
  function criarNo(n) {
    var ui = TIPOS_UI[n.tipo] || ['··', 'action', n.tipo];
    var definition = CATALOG_BY_TYPE[n.tipo] || {};
    var el = document.createElement('div');
    el.className = 'node ' + (n.classe || ui[1]) + (n.inicio ? ' start' : '') + (SEL === n.id ? ' sel' : '');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', n.id + ' · ' + (n.rotulo || ui[2]) + ' · pressione Enter para editar');
    el.dataset.id = n.id;
    el.style.left = pos[n.id].x + 'px'; el.style.top = pos[n.id].y + 'px';
    el.style.animationDelay = (idxNo++ * 0.05) + 's';
    var sub = n.sub !== undefined ? n.sub : subtituloNo(n);
    el.innerHTML = '<button class="edit" title="editar nó ' + esc(n.id) + '" aria-label="editar nó ' + esc(n.id) + '">✎</button><button class="del" title="excluir nó ' + esc(n.id) + '" aria-label="excluir nó ' + esc(n.id) + '">✖</button><div class="stdot"></div><div class="pin in"></div><div class="pin out"></div>' +
      '<div class="head"><div class="ico">' + esc(n.icone || ui[0]) + '</div><div style="min-width:0"><div class="tt">' + esc(n.id) + (n.inicio ? ' ▶' : '') +
      '</div><div class="kind">' + esc(n.rotulo || ui[2]) + '</div></div></div>' +
      (sub ? '<div class="sub" title="' + esc(sub) + '">' + esc(sub) + '</div>' : '') +
      '<div class="node-badges"><span class="' + (definition.costClass === 'free' ? 'zero' : '') + '">' + esc(costLabelUi(definition.costClass)) + '</span><span class="risk-' + esc(definition.riskClass || 'unknown') + '">' + esc(definition.riskClass || 'risco n/d') + '</span><span>' + (definition.remote ? 'rede' : 'local') + '</span></div>';
    nodesEl.appendChild(el);

    el.addEventListener('click', function () { highlightSelection(n.id); });
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('.del, .edit')) return;
      e.stopPropagation();
      var sx = e.clientX / zoom - pos[n.id].x, sy = e.clientY / zoom - pos[n.id].y;
      function mv(ev) {
        pos[n.id].x = Math.max(0, ev.clientX / zoom - sx);
        pos[n.id].y = Math.max(0, ev.clientY / zoom - sy);
        if (!isMobileGraph()) desktopPos[n.id] = { x: pos[n.id].x, y: pos[n.id].y };
        el.style.left = pos[n.id].x + 'px'; el.style.top = pos[n.id].y + 'px';
        drawWires();
      }
      function up() { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    return el;
  }
  function remontarNos() { nodesEl.innerHTML = ''; idxNo = 0; D.nodes.forEach(criarNo); applyStaticLocale(D.locale); }
  remontarNos();

  var mobileNodeWidth = 252, mobileGraphPadding = 28, mobileGraphGap = 58;
  function mobileGraphOrder() {
    var ids = (D.nodes || []).map(function (n) { return n.id; }), known = Object.create(null);
    var indegree = Object.create(null), next = Object.create(null);
    ids.forEach(function (id) { known[id] = true; indegree[id] = 0; next[id] = []; });
    (D.edges || []).forEach(function (e) {
      if (!known[e.from] || !known[e.to] || next[e.from].indexOf(e.to) >= 0) return;
      next[e.from].push(e.to); indegree[e.to]++;
    });
    var queue = ids.filter(function (id) { return indegree[id] === 0; }), order = [];
    while (queue.length) {
      var id = queue.shift(); order.push(id);
      next[id].forEach(function (to) { indegree[to]--; if (indegree[to] === 0) queue.push(to); });
    }
    // Um flow válido é DAG; o fallback mantém nós órfãos/cíclicos visíveis em
    // vez de os deixar fora do canvas enquanto a validação explica o problema.
    ids.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    return order;
  }
  function arrangeMobileGraph() {
    var order = mobileGraphOrder();
    mobileNodeWidth = Math.min(252, Math.max(0, vp.clientWidth - 32));
    document.documentElement.style.setProperty('--mobile-node-width', mobileNodeWidth + 'px');
    var x = Math.max(0, (vp.clientWidth - mobileNodeWidth) / 2);
    order.forEach(function (id, i) { pos[id] = { x: x, y: mobileGraphPadding + i * (H + mobileGraphGap) }; });
    world.style.width = vp.clientWidth + 'px';
    var graphHeight = order.length
      ? mobileGraphPadding + (order.length - 1) * (H + mobileGraphGap) + H + mobileGraphPadding
      : vp.clientHeight;
    world.style.height = Math.max(vp.clientHeight, graphHeight) + 'px';
    D.nodes.forEach(function (n) {
      var el = nodeEl(n.id);
      if (el && pos[n.id]) { el.style.left = pos[n.id].x + 'px'; el.style.top = pos[n.id].y + 'px'; }
    });
  }

  // ---- Round 11: layouts alternativos (camadas/radial) ----
  var LAYOUT = 'timeline';
  function topoRanks() {
    var ids = (D.nodes || []).map(function (n) { return n.id; });
    var indegree = {}, adj = {};
    ids.forEach(function (id) { indegree[id] = 0; adj[id] = []; });
    (D.edges || []).forEach(function (e) {
      if (indegree[e.to] === undefined || indegree[e.from] === undefined || adj[e.from].indexOf(e.to) >= 0) return;
      adj[e.from].push(e.to); indegree[e.to]++;
    });
    var rank = {}, queue = ids.filter(function (id) { return indegree[id] === 0; });
    queue.forEach(function (id) { rank[id] = 0; });
    while (queue.length) {
      var id = queue.shift();
      adj[id].forEach(function (to) {
        rank[to] = Math.max(rank[to] || 0, (rank[id] || 0) + 1);
        indegree[to]--;
        if (indegree[to] === 0) queue.push(to);
      });
    }
    ids.forEach(function (id) { if (rank[id] === undefined) rank[id] = 0; });
    return rank;
  }
  function applyPositions() {
    D.nodes.forEach(function (n) {
      desktopPos[n.id] = { x: pos[n.id].x, y: pos[n.id].y };
      var el = nodeEl(n.id);
      if (el) { el.style.left = pos[n.id].x + 'px'; el.style.top = pos[n.id].y + 'px'; }
    });
    drawWires();
  }
  function arrangeCamadas() {
    var rank = topoRanks();
    var rows = {};
    (D.nodes || []).forEach(function (n) { (rows[rank[n.id]] = rows[rank[n.id]] || []).push(n.id); });
    var y = 56;
    Object.keys(rows).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rk) {
      var row = rows[rk];
      row.forEach(function (id, i) { pos[id] = { x: 80 + i * (W + 46), y: y }; });
      y += H + 74;
    });
    applyPositions();
    world.style.width = ''; world.style.height = '';
    fit();
  }
  function arrangeRadial() {
    var rank = topoRanks();
    var rings = {};
    (D.nodes || []).forEach(function (n) { (rings[rank[n.id]] = rings[rank[n.id]] || []).push(n.id); });
    var cx = 980, cy = 560;
    Object.keys(rings).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rk) {
      var ring = rings[rk], raio = rk === 0 ? 0 : 250 + rk * 210;
      ring.forEach(function (id, i) {
        var ang = (i / ring.length) * Math.PI * 2 - Math.PI / 2 + rk * 0.35;
        pos[id] = { x: Math.max(10, cx + raio * Math.cos(ang) - W / 2), y: Math.max(10, cy + raio * Math.sin(ang) - H / 2) };
      });
    });
    applyPositions();
    world.style.width = ''; world.style.height = '';
    fit();
  }
  function setLayout(l) {
    LAYOUT = l;
    document.querySelectorAll('#layoutSwitch button').forEach(function (b) {
      var on = b.dataset.layout === l;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (l === 'camadas') arrangeCamadas();
    else if (l === 'radial') arrangeRadial();
    else fit();
    syncMinimap();
  }
  document.querySelectorAll('#layoutSwitch button').forEach(function (b) {
    b.addEventListener('click', function () { setLayout(b.dataset.layout); });
  });

  // ---- Round 11: minimapa ----
  var minimapEl = document.getElementById('minimap');
  function syncMinimap() {
    if (!minimapEl || isMobileGraph()) { if (minimapEl) minimapEl.innerHTML = ''; return; }
    var nodes = D.nodes || [];
    if (!nodes.length) { minimapEl.innerHTML = ''; return; }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    nodes.forEach(function (n) {
      if (!pos[n.id]) return;
      minX = Math.min(minX, pos[n.id].x); minY = Math.min(minY, pos[n.id].y);
      maxX = Math.max(maxX, pos[n.id].x + W); maxY = Math.max(maxY, pos[n.id].y + H);
    });
    if (minX === 1e9) return;
    var w = minimapEl.clientWidth || 176, h = minimapEl.clientHeight || 118, pad = 8;
    var sc = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad) / Math.max(1, maxY - minY));
    var ox = (w - (maxX - minX) * sc) / 2, oy = (h - (maxY - minY) * sc) / 2;
    var html = nodes.map(function (n) {
      if (!pos[n.id]) return '';
      return '<div class="mm-dot" style="left:' + ((pos[n.id].x - minX) * sc + ox) + 'px;top:' + ((pos[n.id].y - minY) * sc + oy) + 'px;width:' + Math.max(3, W * sc) + 'px;height:' + Math.max(2, H * sc) + 'px;background:' + groupColorOf(n.id) + ';opacity:.8"></div>';
    }).join('');
    var vx = -panX / zoom, vy = -panY / zoom, vw = vp.clientWidth / zoom, vh = vp.clientHeight / zoom;
    html += '<div class="mm-view" style="left:' + ((vx - minX) * sc + ox) + 'px;top:' + ((vy - minY) * sc + oy) + 'px;width:' + (vw * sc) + 'px;height:' + (vh * sc) + 'px"></div>';
    minimapEl.innerHTML = html;
    minimapEl.dataset.minx = String(minX); minimapEl.dataset.miny = String(minY); minimapEl.dataset.sc = String(sc);
  }
  if (minimapEl) {
    minimapEl.addEventListener('click', function (e) {
      var r = minimapEl.getBoundingClientRect();
      var minX = Number(minimapEl.dataset.minx || 0), minY = Number(minimapEl.dataset.miny || 0), sc = Number(minimapEl.dataset.sc || 1);
      var wx = (e.clientX - r.left - 8) / sc + minX, wy = (e.clientY - r.top - 8) / sc + minY;
      panX = vp.clientWidth / 2 - wx * zoom; panY = vp.clientHeight / 2 - wy * zoom;
      apply();
    });
  }

  // ---- Round 11: efeitos de seleção ----
  function highlightSelection(id) {
    edgeEls.forEach(function (x) {
      var toca = x.edge.from === id || x.edge.to === id;
      x.el.classList.toggle('hl', toca);
      x.el.classList.toggle('dim', !toca);
    });
    var conectados = {};
    (D.edges || []).forEach(function (e) { if (e.from === id || e.to === id) { conectados[e.from] = 1; conectados[e.to] = 1; } });
    conectados[id] = 1;
    (D.nodes || []).forEach(function (n) {
      var el = nodeEl(n.id);
      if (el) el.classList.toggle('dimmed', !conectados[n.id]);
    });
  }
  function clearHighlight() {
    edgeEls.forEach(function (x) { x.el.classList.remove('hl'); x.el.classList.remove('dim'); });
    (D.nodes || []).forEach(function (n) { var el = nodeEl(n.id); if (el) el.classList.remove('dimmed'); });
  }

  function pathBetween(a, b) {
    if (isMobileGraph()) {
      var mx1 = pos[a].x + mobileNodeWidth / 2, my1 = pos[a].y + H;
      var mx2 = pos[b].x + mobileNodeWidth / 2, my2 = pos[b].y;
      var direction = my2 >= my1 ? 1 : -1;
      var dy = Math.max(32, Math.abs(my2 - my1) / 2);
      return 'M' + mx1 + ',' + my1 + ' C' + mx1 + ',' + (my1 + dy * direction) + ' ' + mx2 + ',' + (my2 - dy * direction) + ' ' + mx2 + ',' + my2;
    }
    var x1 = pos[a].x + W, y1 = pos[a].y + H / 2, x2 = pos[b].x, y2 = pos[b].y + H / 2;
    var dx = Math.max(46, Math.abs(x2 - x1) / 2);
    return 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2;
  }

  var edgeEls = [];
  var GROUP_COLOR = { judgment: '#8b8ff8', control: '#e3a008', deterministic: '#34d399', action: '#f87171', context: '#22d3ee', logic: '#c084fc', observability: '#94a3b8', default: 'rgba(255,255,255,.28)' };
  function groupColorOf(nodeId) {
    var n = (D.nodes || []).find(function (x) { return x.id === nodeId; });
    var def = n && CATALOG_BY_TYPE[n.tipo];
    return GROUP_COLOR[(def && def.group) || 'default'] || GROUP_COLOR.default;
  }
  function drawWires() {
    wires.innerHTML = ''; edgeEls = [];
    wires.setAttribute('width', isMobileGraph() ? Math.max(vp.clientWidth, mobileNodeWidth + 32) : 4000);
    wires.setAttribute('height', isMobileGraph() ? Math.max(vp.clientHeight, Number.parseFloat(world.style.height) || 2600) : 2600);
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<filter id="wireGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>';
    var cores = {};
    D.edges.forEach(function (e) { cores[groupColorOf(e.from)] = 1; });
    Object.keys(cores).forEach(function (cor, ci) {
      var mk = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      mk.setAttribute('id', 'seta-' + ci); mk.setAttribute('viewBox', '0 0 10 10');
      mk.setAttribute('refX', '8'); mk.setAttribute('refY', '5'); mk.setAttribute('markerWidth', '7'); mk.setAttribute('markerHeight', '7');
      mk.setAttribute('orient', 'auto-start-reverse');
      mk.innerHTML = '<path d="M0,0 L10,5 L0,10 z" fill="' + cor + '"/>';
      defs.appendChild(mk); cores[cor] = 'seta-' + ci;
    });
    wires.appendChild(defs);
    D.edges.forEach(function (e) {
      if (!pos[e.from] || !pos[e.to]) return;
      var dPath = pathBetween(e.from, e.to);
      var cor = groupColorOf(e.from);
      var fromNode = (D.nodes || []).find(function (x) { return x.id === e.from; }) || {};
      if (String(fromNode.tipo || '').indexOf('jev.') === 0) {
        var glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        glow.setAttribute('d', dPath); glow.setAttribute('class', 'glow');
        glow.setAttribute('stroke', cor);
        wires.appendChild(glow);
      }
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', dPath);
      path.setAttribute('stroke', cor);
      if (cores[cor]) path.setAttribute('marker-end', 'url(#' + cores[cor] + ')');
      wires.appendChild(path);
      edgeEls.push({ el: path, edge: e });
      if (e.label) {
        var mid = path.getPointAtLength(path.getTotalLength() / 2);
        var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('x', mid.x - 24); r.setAttribute('y', mid.y - 9);
        r.setAttribute('width', 48); r.setAttribute('height', 17); r.setAttribute('rx', 6);
        r.setAttribute('class', 'labrect');
        var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', mid.x); t.setAttribute('y', mid.y + 3.5); t.setAttribute('text-anchor', 'middle');
        t.textContent = e.label;
        g.appendChild(r); g.appendChild(t); wires.appendChild(g);
      }
    });
  }

  // pan / zoom
  vp.addEventListener('mousedown', function (e) {
    if (e.target !== vp && e.target !== world) return;
    if (isMobileGraph()) return;
    vp.classList.add('panning');
    var sx = e.clientX - panX, sy = e.clientY - panY;
    function mv(ev) { panX = ev.clientX - sx; panY = ev.clientY - sy; apply(); }
    function up() { vp.classList.remove('panning'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  vp.addEventListener('mousedown', function (e) {
    if (e.target === vp || e.target === world || e.target === wires) clearHighlight();
  });
  vp.addEventListener('wheel', function (e) {
    if (isMobileGraph() && !e.ctrlKey && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return;
    e.preventDefault();
    var f = e.deltaY < 0 ? 1.12 : 0.89;
    var nz = Math.min(1.7, Math.max(0.4, zoom * f));
    panX = e.clientX - (e.clientX - panX) * (nz / zoom);
    panY = e.clientY - (e.clientY - panY) * (nz / zoom);
    zoom = nz; apply();
  }, { passive: false });
  function fit() {
    if (isMobileGraph()) {
      arrangeMobileGraph();
      zoom = 1; panX = 0; panY = 0;
      apply();
      return;
    }
    world.style.width = ''; world.style.height = '';
    D.nodes.forEach(function (n) {
      if (desktopPos[n.id]) pos[n.id] = { x: desktopPos[n.id].x, y: desktopPos[n.id].y };
      else desktopPos[n.id] = { x: pos[n.id].x, y: pos[n.id].y };
    });
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    D.nodes.forEach(function (n) {
      minX = Math.min(minX, pos[n.id].x); minY = Math.min(minY, pos[n.id].y);
      maxX = Math.max(maxX, pos[n.id].x + W); maxY = Math.max(maxY, pos[n.id].y + H);
    });
    // O padding realista deixa os nós maiores sem encostar no perímetro.
    var pad = 24;
    zoom = Math.max(0.52, Math.min(1.25, Math.min((vp.clientWidth - 40) / (maxX - minX + pad * 2), (vp.clientHeight - 40) / (maxY - minY + pad * 2))));
    panX = pad - minX * zoom + (vp.clientWidth - (maxX - minX) * zoom - pad * 2) / 2;
    panY = pad - minY * zoom;
    D.nodes.forEach(function (n) {
      var el = nodeEl(n.id);
      if (el && pos[n.id]) { el.style.left = pos[n.id].x + 'px'; el.style.top = pos[n.id].y + 'px'; }
    });
    apply();
  }
  // ---- Round 13: tour didático (linguagem simples, nó a nó) ----
  var tourIdx = -1, tourSteps = [];
  var tourEl = document.getElementById('tourPanel');
  function tourOpen() {
    var order = mobileGraphOrder();
    var nodesById = {};
    (D.nodes || []).forEach(function (n) { nodesById[n.id] = n; });
    tourSteps = [{ titulo: '🎯 O que este fluxo faz', texto: (D.description || D.name || 'Uma sequência de decisões guiadas por julgamentos Jev.') + ' A seguir, cada cartão do grafo é explicado em palavras simples.' }].concat(order.map(function (id, i) {
      var n = nodesById[id] || {};
      var def = CATALOG_BY_TYPE[n.tipo] || {};
      return { id: id, titulo: 'Passo ' + (i + 1) + ' · ' + (n.rotulo || def.label || n.tipo), texto: nodeExplanation(n, def) || def.description || 'Executa esta etapa do fluxo.' };
    }));
    tourIdx = 0;
    tourEl.style.display = 'block';
    tourRender();
  }
  function tourRender() {
    var passo = tourSteps[tourIdx] || { titulo: 'Fim do tour', texto: 'Agora você conhece cada etapa. Use ▶ rodar para ver acontecer de verdade.' };
    document.getElementById('tourTitulo').textContent = passo.titulo;
    document.getElementById('tourTexto').textContent = passo.texto;
    document.getElementById('tourPos').textContent = (tourIdx + 1) + ' / ' + tourSteps.length;
    document.getElementById('tourPrev').style.opacity = tourIdx === 0 ? '.4' : '1';
    document.getElementById('tourNext').textContent = tourIdx >= tourSteps.length - 1 ? 'fechar ✓' : 'próximo →';
    if (tourIdx > 0 && passo.id && pos[passo.id]) {
      highlightSelection(passo.id);
      panX = vp.clientWidth / 2 - (pos[passo.id].x + W / 2) * zoom;
      panY = vp.clientHeight / 2 - (pos[passo.id].y + H / 2) * zoom;
      apply();
    }
  }
  document.getElementById('ztour').onclick = function () { tourOpen(); };
  document.getElementById('tourClose').onclick = function () { tourEl.style.display = 'none'; clearHighlight(); };
  document.getElementById('tourPrev').onclick = function () { tourIdx = Math.max(0, tourIdx - 1); tourRender(); };
  document.getElementById('tourNext').onclick = function () {
    if (tourIdx >= tourSteps.length - 1) { tourEl.style.display = 'none'; clearHighlight(); return; }
    tourIdx = Math.min(tourSteps.length - 1, tourIdx + 1);
    tourRender();
  };
  document.getElementById('zin').onclick = function () { zoom = Math.min(1.7, zoom * 1.15); apply(); };
  document.getElementById('zout').onclick = function () { zoom = Math.max(0.4, zoom / 1.15); apply(); };
  document.getElementById('zfit').onclick = fit;
  window.addEventListener('resize', fit);

  // tabs
  function ativarAba(tipo) {
    var tab = document.querySelector('.tabs div[data-t="' + tipo + '"]');
    var body = document.querySelector('.tabbody[data-t="' + tipo + '"]');
    if (!tab || !body) return;
    document.querySelectorAll('.tabs div').forEach(function (x) { x.classList.toggle('on', x === tab); x.setAttribute('aria-selected', x === tab ? 'true' : 'false'); });
    document.querySelectorAll('.tabbody').forEach(function (x) { x.classList.toggle('on', x === body); });
  }
  document.querySelectorAll('.tabs div').forEach(function (t) {
    t.onclick = function () { ativarAba(t.dataset.t); };
    t.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ativarAba(t.dataset.t); } };
  });

  function contractRows(values) {
    var entries = Object.entries(values || {});
    if (!entries.length) return '<li><span>sem campos adicionais</span></li>';
    return entries.map(function (entry) { return '<li><code>' + esc(entry[0]) + '</code><span>' + esc(entry[1]) + '</span></li>'; }).join('');
  }
  function nodeExplanation(node, definition) {
    if (!node) return '';
    if (node.type === 'rule.match') return 'Compara um valor local usando ' + esc(node.operator || 'operador fechado') + '; não consulta Jev nem rede.';
    if (node.type === 'rule.extract') return 'Seleciona apenas os campos declarados para reduzir contexto e tornar a próxima decisão auditável.';
    if (node.type === 'rule.lookup') return 'Converte uma chave em valor pela tabela explícita do flow; ausência segue o fallback declarado.';
    if (node.type === 'jev.ask') return 'Envia ' + Object.keys(node.questions || {}).length + ' pergunta(s) tipada(s) sobre o mesmo estado redigido; confiança apenas orienta a rota.';
    if (node.type === 'jev.verify') return 'Compara uma alegação com evidência fornecida. O resultado é evidence gate, nunca autorização.';
    if (node.type === 'det.skill') return 'Executa a skill registrada ' + esc(node.skill || 'não definida') + ' localmente, sem modelo gerador.';
    if (node.type === 'budget.guard') return 'Reserva e verifica orçamento antes do próximo despacho; não consegue ampliar os limites do run.';
    if (node.type === 'context.prune') return 'Reduz saída extensa preservando o original em qualquer incerteza ou formato protegido.';
    if (node.type === 'logic.subgraph' || node.type === 'logic.graph') return 'Executa um subgrafo puro de fatos, provas, políticas e derrotadores; conflito e insuficiência permanecem explícitos.';
    if (node.type === 'action.webhook') return 'Produz efeito externo somente depois da política de URL e dos gates do Flow.';
    return esc((definition && definition.what) || 'Executa esta capacidade conforme o contrato versionado do catálogo.');
  }
  function logicGraphSummary(node) {
    var graph = node && (node.graph_inline || (node.graph && typeof node.graph === 'object' ? node.graph : null));
    if (!graph) return '';
    var facts = graph.facts ? Object.keys(graph.facts).length : 0;
    var evidence = graph.evidence ? Object.keys(graph.evidence).length : 0;
    var rules = Array.isArray(graph.rules) ? graph.rules.length : 0;
    return '<div class="guide-section"><h4>SUBGRAFO LÓGICO</h4><div class="guide-badges"><span>' + facts + ' fatos</span><span>' + evidence + ' provas</span><span>' + rules + ' políticas</span><span>revisável</span></div></div>';
  }
  function mostrarGuiaNo(id) {
    var source = (typeof DRAFT !== 'undefined' && DRAFT && DRAFT.nodes) ? DRAFT.nodes : ((D.flow_completo || {}).nodes || {});
    var node = source[id];
    if (!node) return;
    var definition = CATALOG_BY_TYPE[node.type] || {};
    var display = definition.display || {};
    var incoming = (D.edges || []).filter(function (edge) { return edge.to === id; }).map(function (edge) { return edge.from; });
    var outgoing = (D.edges || []).filter(function (edge) { return edge.from === id; }).map(function (edge) { return edge.to; });
    var badges = [costLabelUi(definition.costClass), definition.riskClass || 'risco n/d', definition.remote ? 'usa rede' : 'local', definition.cache ? 'cacheável' : 'sem cache', definition.generator ? 'gerador' : 'não gera texto'];
    var guide = document.getElementById('nodeGuide');
    guide.innerHTML = '<div class="guide-kicker"><span class="section-index">NÓ</span>' + esc(definition.group || 'capacidade') + '</div>' +
      '<div class="guide-title"><span class="cap-glyph ' + esc(display.classe || definition.group || 'action') + '">' + esc(definition.glyph || '··') + '</span><div><h3>' + esc(display.rotulo || definition.label || id) + '</h3><code>' + esc(id) + ' · ' + esc(node.type) + '</code></div></div>' +
      '<p class="guide-copy">' + nodeExplanation(node, definition) + '</p>' +
      '<div class="guide-badges">' + badges.map(function (badge) { return '<span>' + esc(badge) + '</span>'; }).join('') + '</div>' +
      '<div class="guide-section"><h4>ENTRA</h4><ul class="contract-list">' + contractRows(definition.inputs) + '</ul></div>' +
      '<div class="guide-section"><h4>SAI</h4><ul class="contract-list">' + contractRows(definition.outputs) + '</ul></div>' +
      '<div class="guide-section"><h4>POSIÇÃO NO FLOW</h4><ul class="contract-list"><li><code>antes</code><span>' + esc(incoming.join(', ') || 'início ou órfão') + '</span></li><li><code>depois</code><span>' + esc(outgoing.join(', ') || 'fim') + '</span></li></ul></div>' +
      logicGraphSummary(node) +
      '<div class="guide-section"><h4>FALLBACK</h4><p class="guide-copy">' + esc(definition.fallback || 'falha explícita e conservadora') + '</p></div>' +
      '<div class="guide-section"><h4>EXEMPLO</h4><pre class="guide-example">' + esc(JSON.stringify(definition.example || { type: node.type }, null, 2)) + '</pre></div>';
  }
  function flowOrder() {
    var ids = Object.keys((typeof DRAFT !== 'undefined' && DRAFT.nodes) || {});
    var known = Object.create(null), indegree = Object.create(null), next = Object.create(null);
    ids.forEach(function (id) { known[id] = true; indegree[id] = 0; next[id] = []; });
    (D.edges || []).forEach(function (edge) {
      if (!known[edge.from] || !known[edge.to] || next[edge.from].indexOf(edge.to) >= 0) return;
      next[edge.from].push(edge.to); indegree[edge.to]++;
    });
    var queue = ids.filter(function (id) { return indegree[id] === 0; }), order = [];
    while (queue.length) { var id = queue.shift(); order.push(id); next[id].forEach(function (to) { indegree[to]--; if (indegree[to] === 0) queue.push(to); }); }
    ids.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    return order;
  }
  function renderFlowGuide() {
    var timeline = document.getElementById('flowTimeline');
    if (!timeline || typeof DRAFT === 'undefined') return;
    timeline.innerHTML = flowOrder().map(function (id) {
      var node = DRAFT.nodes[id], definition = CATALOG_BY_TYPE[node.type] || {}, display = definition.display || {};
      return '<li><div class="flow-step-copy"><b>' + esc(display.rotulo || definition.label || id) + '<code>' + esc(id) + '</code></b><p>' + nodeExplanation(node, definition) + '</p></div></li>';
    }).join('');
  }
  function resolveRuntimePath(path) {
    var parts = String(path || '').split('.'), root = parts.shift(), current;
    if (root === 'input') current = D.input;
    else current = (D.steps || []).find(function (step) { return step.no === root; });
    for (var i = 0; i < parts.length; i++) {
      if (current == null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, parts[i])) return undefined;
      current = current[parts[i]];
    }
    return current;
  }
  function resolveRuntimeValue(value) {
    if (typeof value !== 'string') return value;
    var trimmed = value.trim();
    if (!trimmed.startsWith('{{') || !trimmed.endsWith('}}')) return value;
    var path = trimmed.slice(2, -2).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*(?:[.][A-Za-z0-9_-]+)*$/.test(path)) return value;
    var resolved = resolveRuntimePath(path);
    return resolved === undefined ? value : resolved;
  }
  function truthFromFact(value) {
    var raw = value;
    if (value && typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, 'status')) raw = value.status;
      else if (Object.prototype.hasOwnProperty.call(value, 'state')) raw = value.state;
      else if (Object.prototype.hasOwnProperty.call(value, 'value')) raw = value.value;
    }
    raw = resolveRuntimeValue(raw);
    if (raw === true) return 'affirmed';
    if (raw === false) return 'denied';
    var state = String(raw == null ? '' : raw).toLowerCase();
    if (state === 'true' || state === 'affirmed' || state === 'supported') return 'affirmed';
    if (state === 'false' || state === 'denied' || state === 'refuted' || state === 'defeated') return 'denied';
    if (state === 'controversial' || state === 'contested' || state === 'conflicted') return 'contested';
    if (state === 'not_proven') return 'not_proven';
    return 'unknown';
  }
  function renderLogicGraph(node, graph, observed) {
    var facts = Object.entries(graph.facts || {});
    var evidence = Object.entries(graph.evidence || {});
    var rules = Array.isArray(graph.rules) ? graph.rules : Object.entries(graph.rules || {}).map(function (entry) { return Object.assign({ id: entry[0] }, entry[1]); });
    var configuredConclusions = Array.isArray(graph.conclusions) ? graph.conclusions : rules.map(function (rule) {
      var then = rule.then || {};
      return { id: then.assert || then.conclusion || rule.conclusion || rule.id, status: 'provisional', source: rule.id };
    }).filter(function (item) { return item.id; });
    var conclusions = observed && Array.isArray(observed.conclusions) && observed.conclusions.length ? observed.conclusions : configuredConclusions;
    var observedFactStates = (observed && observed.factStates) || {};
    var observedEvidenceStates = (observed && observed.evidenceStates) || {};
    var auditById = Object.create(null);
    ((observed && observed.audit) || []).forEach(function (record) { if (record && record.id) auditById[record.id] = record; });
    var factCards = facts.map(function (entry) {
      var id = entry[0], fact = entry[1];
      var truth = Object.prototype.hasOwnProperty.call(observedFactStates, id) ? truthFromFact({ state: observedFactStates[id] }) : truthFromFact(fact);
      var evidenceRefs = fact && typeof fact === 'object' ? (fact.evidence || fact.provenance || []) : [];
      var rawValue = fact && typeof fact === 'object' && Object.prototype.hasOwnProperty.call(fact, 'value') ? resolveRuntimeValue(fact.value) : undefined;
      var protectedValue = typeof rawValue === 'string' && /^\\[(?:REDACTED|TRUNCATED):/.test(rawValue);
      var valueLine = rawValue === undefined ? '' : '<p>valor observado: <b>' + (protectedValue ? 'protegido' : esc(typeof rawValue === 'object' ? JSON.stringify(rawValue) : rawValue)) + '</b></p>';
      return '<div class="logic-card"><b>' + esc(id) + '</b><code>fato · ' + esc(Array.isArray(evidenceRefs) ? evidenceRefs.join(', ') : evidenceRefs) + '</code>' + valueLine + '<span class="truth ' + esc(truth) + '">' + esc(truth) + '</span></div>';
    }).join('');
    var evidenceCards = evidence.map(function (entry) {
      var id = entry[0], item = entry[1] || {};
      var state = Object.prototype.hasOwnProperty.call(observedEvidenceStates, id) ? observedEvidenceStates[id] : 'unknown';
      var truth = state === 'present' || state === 'supports' || state === 'supported' ? 'affirmed' : state === 'against' || state === 'refuted' ? 'denied' : truthFromFact({ state: state });
      return '<div class="logic-card"><b>' + esc(item.label || id) + '</b><code>prova · ' + esc(item.kind || 'evidence') + '</code><p>integridade: ' + esc(item.integrity || 'não declarada') + '</p><span class="truth ' + esc(truth) + '">' + esc(state) + '</span></div>';
    }).join('');
    var ruleCards = rules.map(function (rule, index) {
       var id = rule.id || ('politica-' + (index + 1));
      var all = rule.all || (rule.when && rule.when.all) || [];
      var any = rule.any || (rule.when && rule.when.any) || [];
      var unlessCount = Array.isArray(rule.unless) ? rule.unless.length : (rule.unless ? 1 : 0);
      var target = (rule.then && (rule.then.assert || rule.then.conclusion)) || rule.conclusion || 'conclusão';
      var audit = auditById[id];
      var auditTruth = audit ? (audit.fired ? 'affirmed' : audit.condition === 'unknown' || audit.condition === 'controversial' ? 'unknown' : 'denied') : 'unknown';
       var auditLabel = audit ? (audit.fired ? 'condição satisfeita' : 'condição não satisfeita · ' + (audit.condition || 'unknown')) : 'ainda não observada';
      return '<div class="logic-card"><b>' + esc(id) + '</b><code>' + (all.length ? 'E · ' + all.length : any.length ? 'OU · ' + any.length : 'implicação') + ' → ' + esc(target) + '</code><p>' + (unlessCount ? unlessCount + ' derrotador(es) · ' : '') + 'prioridade ' + esc(rule.priority && typeof rule.priority === 'object' ? rule.priority.level : (rule.priority ?? 'padrão')) + '</p><span class="truth ' + esc(auditTruth) + '">' + esc(auditLabel) + '</span></div>';
    }).join('');
    var conclusionCards = conclusions.map(function (item) {
      var id = typeof item === 'string' ? item : (item.id || item.assert || item.conclusion || 'conclusão');
      var rawStatus = typeof item === 'object' ? (item.state || item.status || item.truth || 'provisional') : 'provisional';
      var truth = truthFromFact({ state: rawStatus });
      var detail = typeof item === 'object' ? [item.reason, item.burden ? 'ônus ' + item.burden : '', item.responsible ? 'responsável ' + item.responsible : ''].filter(Boolean).join(' · ') : '';
      return '<div class="logic-card"><b>' + esc(id) + '</b><code>conclusão revisável</code>' + (detail ? '<p>' + esc(detail) + '</p>' : '') + '<span class="truth ' + esc(truth) + '">' + esc(rawStatus) + '</span></div>';
    }).join('');
    return '<div class="reasoning-intro"><span>subgrafo executável</span><span>' + facts.length + ' fatos</span><span>' + evidence.length + ' provas</span><span>' + rules.length + ' políticas</span><span>' + (observed ? 'resultado observado' : 'prévia estrutural') + '</span><span>sem side effects</span></div>' +
      '<div class="logic-board"><section class="logic-column"><h3>Fatos e provas</h3>' + (factCards || '<div class="logic-card"><b>Nenhum fato embutido</b></div>') + evidenceCards + '</section>' +
      '<section class="logic-column"><h3>Políticas e derrotadores</h3>' + (ruleCards || '<div class="logic-card"><b>Grafo referenciado</b><p>' + esc(typeof node.graph === 'string' ? node.graph : 'carregado no runtime') + '</p></div>') + '</section>' +
      '<section class="logic-column"><h3>Conclusões</h3>' + (conclusionCards || '<div class="logic-card"><b>Conclusão calculada no run</b><span class="truth unknown">unknown até executar</span></div>') + '</section></div>' +
      '<div class="logic-audit-note"><b>Trilha preservada.</b> Ausência de prova não vira falsidade; conflito, baixa confiança e exceção não resolvida seguem para revisão. Uma nova evidência reexecuta o grafo e pode derrotar a conclusão anterior sem apagá-la.</div>';
  }
  function reasoningStage(node, definition) {
    if (node.type === 'logic.subgraph' || node.type === 'logic.graph') return 'inference';
    if (definition.group === 'judgment') return 'evaluation';
    if (definition.group === 'control') return 'inference';
    if (definition.group === 'action' || definition.group === 'observability') return 'consequence';
    return 'premise';
  }
  function renderReasoningSurface() {
    var target = document.getElementById('reasoningGraph');
    if (!target || typeof DRAFT === 'undefined') return;
    var logicEntry = Object.entries(DRAFT.nodes || {}).find(function (entry) { return entry[1].type === 'logic.subgraph' || entry[1].type === 'logic.graph'; });
    if (logicEntry) {
      var logicId = logicEntry[0], logicNode = logicEntry[1];
      var graph = logicNode.graph_inline || (logicNode.graph && typeof logicNode.graph === 'object' ? logicNode.graph : { id: logicNode.graph });
      var observedStep = (D.steps || []).find(function (step) { return step.no === logicId; });
      target.innerHTML = renderLogicGraph(logicNode, graph || {}, observedStep && observedStep.logic);
      return;
    }
    var buckets = { premise: [], evaluation: [], inference: [], consequence: [] };
    flowOrder().forEach(function (id) {
      var node = DRAFT.nodes[id], definition = CATALOG_BY_TYPE[node.type] || {}, display = definition.display || {};
      var stage = reasoningStage(node, definition);
      var step = (D.steps || []).find(function (candidate) { return candidate.no === id; });
      buckets[stage].push('<div class="reason-card ' + stage + '"><b>' + esc(display.rotulo || definition.label || id) + '</b><code>' + esc(id) + ' · ' + esc(node.type) + '</code><p>' + nodeExplanation(node, definition) + '</p><span class="reason-state">' + (step ? (step.ok ? 'observado · ok' : 'observado · falha') : 'não executado') + '</span></div>');
    });
    var stages = [
      ['premise', '01', 'Premissas locais'], ['evaluation', '02', 'Avaliações incertas'],
      ['inference', '03', 'Inferência e gates'], ['consequence', '04', 'Consequências'],
    ];
    target.innerHTML = '<div class="reasoning-intro"><span>projeção do flow</span><span>Jev não autoriza</span><span>código decide a rota</span><span>unknown preservado</span></div><div class="reasoning-chain">' + stages.map(function (stage) {
      return '<section class="reasoning-stage"><h3><span>' + stage[1] + '</span>' + stage[2] + '</h3>' + (buckets[stage[0]].join('') || '<div class="reason-card ' + stage[0] + '"><b>Nenhuma capacidade</b><p>Adicione pelo catálogo ou abra um subgrafo lógico.</p></div>') + '</section>';
    }).join('') + '</div><div class="logic-audit-note">Esta é uma projeção didática do workflow. Adicione <code>logic.subgraph</code> para fatos, provas, conectivos, exceções, prioridade, vigência, ônus, conflito e conclusões revisáveis com provenance nativa.</div>';
  }
  document.querySelectorAll('[data-canvas-mode]').forEach(function (button) {
    button.onclick = function () {
      var reasoning = button.dataset.canvasMode === 'reasoning';
      document.querySelectorAll('[data-canvas-mode]').forEach(function (candidate) { var active = candidate === button; candidate.classList.toggle('on', active); candidate.setAttribute('aria-pressed', active ? 'true' : 'false'); });
      world.hidden = reasoning;
      document.getElementById('reasoningSurface').hidden = !reasoning;
      document.querySelector('.rail').hidden = reasoning;
      document.querySelector('.zoomer').hidden = reasoning;
      document.querySelector('.legenda').hidden = reasoning;
      if (reasoning) renderReasoningSurface(); else fit();
    };
  });

  // cartões de execução
  var cardsEl = document.getElementById('cards'), dadosEl = document.getElementById('dados'), banner = document.getElementById('banner');
  D.steps.forEach(function (s) {
    var c = document.createElement('div');
    c.className = 'card ' + (s.ok ? 'ok' : 'fail');
    var confianca = Number.isFinite(s.confianca) ? '<span class="confidence ' + (s.confianca < 0.65 ? 'warn' : '') + '">confiança ' + Math.round(s.confianca * 100) + '%</span>' : '';
    var det = '';
    if (s.valores) det = JSON.stringify(s.valores);
    else if (s.linha) det = s.linha;
    else if (s.acao) det = 'ação: ' + s.acao;
    else if (s.status) det = 'HTTP ' + s.status + ' → ' + s.url;
    if (s.erro) det = 'erro: ' + s.erro + (det ? '\\n' + det : '');
    c.innerHTML = (s.ok ? '✔' : '✖') + ' <b>' + esc(s.no) + '</b> <span class="k">· ' + esc(s.tipo) + ' · ' + esc(s.ms) + 'ms</span>' + confianca +
      (s.resumo ? '<div class="k" style="margin-top:4px">' + esc(s.resumo) + '</div>' : '') +
      (det ? '<pre>' + esc(det) + '</pre>' : '');
    cardsEl.appendChild(c);

    var d = document.createElement('div');
    d.className = 'card on ' + (s.ok ? 'ok' : 'fail');
    d.innerHTML = '<b>' + esc(s.no) + '</b>' + (confianca ? '<div class="k" style="margin-top:4px">' + confianca + '</div>' : '') + (s.regra ? '<div class="k" style="margin-top:4px">regra ' + esc(s.regra) + ' · ' + esc(s.veredicto || '') + (s.existe != null ? ' · existe ' + esc(Number(s.existe).toFixed(2)) : '') + '</div>' : '') + '<pre>' + esc(JSON.stringify({ valores: s.valores, confianca: s.confianca, veredicto: s.veredicto, regra: s.regra, existe: s.existe, linha: s.linha, acao: s.acao, status: s.status, erro: s.erro }, null, 1)) + '</pre>';
    dadosEl.appendChild(d);
  });
  D.chamadas.forEach(function (w) {
    var d = document.createElement('div');
    d.className = 'card on ok';
    d.innerHTML = '<b>HTTP · ' + esc(w.method) + ' ' + esc(String(w.url).slice(0, 60)) + '</b> <span class="k">(rede simulada)</span><pre>' + esc(JSON.stringify(w.body)) + '</pre>';
    dadosEl.appendChild(d);
  });

  // replay da execução
  function vel() { return parseFloat(document.getElementById('vel').value) || 1; }
  function edgeDe(a, b) { return edgeEls.find(function (x) { return x.edge.from === a && x.edge.to === b; }); }
  function pulse(edge, cb) {
    var path = edge.el, len = path.getTotalLength(), t0 = performance.now(), dur = 420 / vel();
    path.classList.add('hot');
    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', 5); dot.setAttribute('fill', '#e3a008'); dot.style.filter = 'drop-shadow(0 0 6px #e3a008)';
    wires.appendChild(dot);
    function frame(t) {
      var k = Math.min(1, (t - t0) / dur), pt = path.getPointAtLength(k * len);
      dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      if (k < 1) requestAnimationFrame(frame); else { dot.remove(); path.classList.remove('hot'); path.classList.add('done'); if (cb) cb(); }
    }
    requestAnimationFrame(frame);
  }
  var replayToken = 0;
  function play() {
    var token = ++replayToken;
    var playButton = document.getElementById('play');
    playButton.disabled = true;
    document.querySelectorAll('.node').forEach(function (n) { n.classList.remove('running', 'done', 'fail'); });
    document.querySelectorAll('#cards .card').forEach(function (c) { c.classList.remove('on'); });
    banner.className = 'banner';
    edgeEls.forEach(function (x) { x.el.classList.remove('hot', 'done'); });
    var i = -1;
    function advance() {
      if (token !== replayToken) return;
      i++;
      if (i >= D.steps.length) {
        var ok = D.steps.every(function (s) { return s.ok; });
        banner.className = 'banner ' + (ok ? 'ok' : 'fail');
        banner.innerHTML = (D.catalogPreview ? 'Amostra inicial · ' : '') + (ok ? '✅ operação concluída' : '❌ operação com falha') + ' — <code style="color:#d2a8ff">' + esc(D.steps.map(function (s) { return s.no; }).join(' → ')) + '</code>' + (D.catalogPreview ? '<div>O último teste e suas evidências estão no painel Teste.</div>' : '');
        playButton.disabled = false;
        return;
      }
      var s = D.steps[i];
      var el = nodeEl(s.no);
      if (el) { el.classList.remove('running'); el.classList.add(s.ok ? 'done' : 'fail'); }
      var card = cardsEl.children[i]; if (card) card.classList.add('on');
      var prox = D.steps[i + 1];
      if (!prox) { setTimeout(advance, 250 / vel()); return; }
      var e = edgeDe(s.no, prox.no);
      var next = function () {
        var ne = nodeEl(prox.no); if (ne) ne.classList.add('running');
        setTimeout(advance, 300 / vel());
      };
      if (e) pulse(e, next); else next();
    }
    var first = nodeEl(D.steps[0].no);
    if (first) first.classList.add('running');
    setTimeout(advance, 700 / vel());
  }
  document.getElementById('play').onclick = play;
  drawWires(); fit(); setTimeout(play, 500);

  // ═══════════ ESTÚDIO: rascunho, paleta, teste em preview, copiloto ═══════════
  var DRAFT = JSON.parse(JSON.stringify(D.flow_completo || D.flow));
  if (!Array.isArray(DRAFT.fixtures)) DRAFT.fixtures = [];
  DRAFT.fixtures = DRAFT.fixtures.map(function (fixture, index) {
    var value = fixture && typeof fixture === 'object' ? fixture : {};
    return { id: String(value.id || ('fixture-' + (index + 1))), name: String(value.name || ('Fixture ' + (index + 1))),
      input: value.input && typeof value.input === 'object' && !Array.isArray(value.input) ? value.input : {},
      answers: value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) ? value.answers : null,
      esperado: value.esperado && typeof value.esperado === 'object' && !Array.isArray(value.esperado) ? value.esperado : null };
  });
  var SUJO = false, SEL = null, EDITOR_SNAPSHOT = null, EDITOR_ID = null;
  var FIXTURE_ID = null;
  var rail = document.getElementById('rail'), paleta = document.getElementById('paleta');
  var gaveta = document.getElementById('gaveta'), copiloto = document.getElementById('copiloto');
  var saveBtn = document.getElementById('btnSalvar');
  var saveStatus = document.getElementById('saveStatus');
  var saveStatusText = document.getElementById('saveStatusText');
  var saveStatusTimer = null;
  var SOMENTE_LEITURA = Boolean(D.readonly);
  var duplicateBtn = document.getElementById('btnDuplicar');
  renderFlowGuide();
  renderReasoningSurface();

  function setSaveStatus(state, text, detail) {
    if (saveStatusTimer) { clearTimeout(saveStatusTimer); saveStatusTimer = null; }
    saveStatus.className = 'save-status ' + state;
    saveStatusText.textContent = text;
    saveStatus.setAttribute('aria-label', detail || text);
    if (detail) saveStatus.title = detail; else saveStatus.removeAttribute('title');
  }
  function marcarSujo() {
    if (D.catalogPreview) { setSaveStatus('readonly', 'Prévia do catálogo', 'Duplique o fluxo para modificar sua estrutura.'); return; }
    SUJO = true;
    rail.classList.add('sujo');
    saveBtn.classList.add('is-dirty');
    if (SOMENTE_LEITURA) {
      saveBtn.setAttribute('aria-label', 'Salvar desabilitado: exemplo shipped somente leitura');
      setSaveStatus('readonly', 'Rascunho local alterado', 'Este exemplo shipped é somente leitura; duplique para editar e salvar.');
      return;
    }
    saveBtn.setAttribute('aria-label', 'Salvar alterações não salvas');
    if (!saveBtn.disabled) saveBtn.textContent = 'Salvar';
    setSaveStatus('unsaved', 'Alterações não salvas');
  }
  function marcarSalvo(text) {
    if (SOMENTE_LEITURA) {
      setSaveStatus('readonly', 'Exemplo shipped · somente leitura', 'Duplique para editar e salvar uma cópia.');
      return;
    }
    SUJO = false;
    rail.classList.remove('sujo');
    saveBtn.classList.remove('is-dirty');
    saveBtn.setAttribute('aria-label', 'Salvar flow');
    setSaveStatus('saved', text || 'Tudo salvo');
  }
  function apiJev(path, opts) {
    return fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }).catch(function () { return { status: r.status, body: {} }; }); });
  }

  // ── salvar rascunho (valida no servidor antes de gravar) ──
  function resumoErroSalvar(body) {
    if (body && body.validacao && body.validacao.errors) {
      return body.validacao.errors.map(function (e) { return (e.codigo || 'erro') + ': ' + (e.msg || e.error || ''); }).join(' · ');
    }
    return (body && (body.error || body.message)) || 'resposta inesperada do servidor';
  }
  saveBtn.onclick = async function () {
    var b = this;
    if (SOMENTE_LEITURA) {
      setSaveStatus('readonly', 'Exemplo shipped · somente leitura', 'Duplique para editar e salvar uma cópia.');
      return;
    }
    if (!SUJO) { b.textContent = 'Salvar'; setSaveStatus('saved', 'Tudo salvo'); return; }
    var snapshot = JSON.stringify(DRAFT);
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    b.textContent = '⏳ Salvando…';
    setSaveStatus('saving', 'Salvando…');
    try {
      var r = await apiJev('/api/jev/flows/' + D.flow.id, { method: 'PUT', body: JSON.stringify({ flow: JSON.parse(snapshot) }) });
      if (r.status !== 200) throw new Error(resumoErroSalvar(r.body));
      b.disabled = false;
      b.removeAttribute('aria-busy');
      if (JSON.stringify(DRAFT) === snapshot) {
        marcarSalvo('Salvo agora');
        b.textContent = '✓ Salvo';
        saveStatusTimer = setTimeout(function () { if (!SUJO) { setSaveStatus('saved', 'Tudo salvo'); b.textContent = 'Salvar'; } }, 2400);
      } else {
        b.textContent = 'Salvar';
        setSaveStatus('unsaved', 'Alterações não salvas', 'O salvamento terminou, mas há novas alterações pendentes.');
      }
    } catch (e) {
      b.disabled = false;
      b.removeAttribute('aria-busy');
      b.textContent = 'Tentar novamente';
      var detalhe = String((e && e.message) || e || 'falha desconhecida').replace(/\\s+/g, ' ').trim();
      setSaveStatus('error', 'Falha ao salvar', detalhe + ' · as alterações continuam não salvas');
    }
  };

  async function duplicarParaEditar() {
    if (!duplicateBtn || duplicateBtn.disabled) return;
    duplicateBtn.disabled = true;
    duplicateBtn.setAttribute('aria-busy', 'true');
    duplicateBtn.textContent = '⏳ Duplicando…';
    setSaveStatus('saving', 'Duplicando para editar…');
    try {
      var duplicateEndpoint = D.catalogPreview ? '/api/jev/flows/compendium/duplicate'
        : '/api/jev/flows/' + encodeURIComponent(D.flow.id) + '/duplicate';
      var r = await apiJev(duplicateEndpoint, { method: 'POST', body: JSON.stringify(D.catalogPreview ? D.catalogKey : {}) });
      var copyId = r.body && r.body.flow && r.body.flow.id;
      if (r.status !== 201 || !copyId) throw new Error(resumoErroSalvar(r.body));
      setSaveStatus('saved', 'Cópia criada · abrindo editor…');
      location.href = '/jev/flows/' + encodeURIComponent(copyId) + '/demo';
    } catch (e) {
      duplicateBtn.disabled = false;
      duplicateBtn.removeAttribute('aria-busy');
      duplicateBtn.textContent = '↻ Tentar duplicar';
      var detalhe = String((e && e.message) || e || 'falha desconhecida').replace(/\s+/g, ' ').trim();
      setSaveStatus('error', 'Não foi possível duplicar', detalhe + ' · tente novamente');
    }
  }
  if (duplicateBtn) duplicateBtn.onclick = duplicarParaEditar;

  // ── seleção e edição de nós ──
  function selecionarNo(id) {
    document.querySelectorAll('.node.sel').forEach(function (x) { x.classList.remove('sel'); });
    var el = nodeEl(id);
    if (el) el.classList.add('sel');
    SEL = id;
    mostrarGuiaNo(id);
  }
  nodesEl.addEventListener('click', function (e) {
    var edit = e.target.closest('.edit');
    var del = e.target.closest('.del');
    var no = e.target.closest('.node');
    if (edit && no) { e.stopPropagation(); selecionarNo(no.dataset.id); abrirEditor(no.dataset.id); return; }
    if (del && no) { e.stopPropagation(); if (confirm('excluir o nó "' + no.dataset.id + '"?')) { excluirNo(no.dataset.id); } return; }
    if (no) {
      selecionarNo(no.dataset.id);
      ativarAba('guide');
    }
  });
  nodesEl.addEventListener('focusin', function (e) {
    var no = e.target.closest('.node');
    if (no) selecionarNo(no.dataset.id);
  });
  nodesEl.addEventListener('keydown', function (e) {
    var no = e.target.closest('.node');
    if (!no || e.target.closest('button')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionarNo(no.dataset.id); abrirEditor(no.dataset.id); }
  });
  // duplo-clique abre o EDITOR de propriedades
  nodesEl.addEventListener('dblclick', function (e) {
    var no = e.target.closest('.node');
    if (no) { e.stopPropagation(); abrirEditor(no.dataset.id); }
  });
  function abrirEditor(id) {
    if (D.catalogPreview) {
      setSaveStatus('readonly', 'Prévia do catálogo', 'Duplique este fluxo para editar nós.');
      return;
    }
    var n = DRAFT.nodes[id];
    if (!n) return;
    var editorEl = document.getElementById('editorNo');
    var reabrindoMesmo = editorEl.classList.contains('on') && EDITOR_ID === id;
    if (!reabrindoMesmo) { EDITOR_SNAPSHOT = JSON.parse(JSON.stringify(n)); EDITOR_ID = id; }
    document.getElementById('enId').textContent = id;
    document.getElementById('enTipo').textContent = n.type;
    var definition = CATALOG_BY_TYPE[n.type] || {};
    var icon = document.getElementById('enIcone');
    icon.textContent = definition.glyph || '··';
    icon.className = 'cap-glyph ' + ((definition.display && definition.display.classe) || definition.group || 'action');
    var corpo = document.getElementById('enCorpo');
    var html = '<div class="editor-doc"><b>' + esc((definition.display && definition.display.rotulo) || definition.label || n.type) + '</b><p>' + esc(definition.description || 'Capacidade validada pelo runtime.') + '</p></div>';

    if (n.type === 'jev.ask' && n.questions) {
      html += '<label>Configurações · perguntas tipadas</label>';
      Object.entries(n.questions).forEach(function (par) {
        var qid = par[0], q = par[1];
        html += '<div class="qblock" data-q="' + qid + '"><h5><span>' + qid + ' · ' + q.type + '</span><button class="del-q" title="remover pergunta">✖</button></h5>';
        html += '<label>Instruções</label><textarea data-f="instructions">' + String(q.instructions || '').replace(/</g, '&lt;') + '</textarea>';
        if (q.type === 'choice' && q.criteria) {
          html += '<label>Opções (uma por linha: chave = descrição)</label><textarea data-f="criteria" style="min-height:80px">' + Object.entries(q.criteria).map(function (c) { return c[0] + ' = ' + (c[1] || ''); }).join('\\n') + '</textarea>';
        } else if (q.type === 'score' && Array.isArray(q.criteria)) {
          html += '<label>Níveis (um por linha, ordenado)</label><textarea data-f="criteria" style="min-height:70px">' + q.criteria.join('\\n') + '</textarea>';
        }
        html += '</div>';
      });
      html += '<button class="mbtn g" style="width:100%;margin-top:4px" id="enAddQ">＋ pergunta</button>';
    } else if (n.type === 'jev.jevlet') {
      html += '<label>Jevlet do catálogo</label><input data-f="jevlet" value="' + String(n.jevlet || '') + '" placeholder="id do jevlet">';
    } else if (n.type === 'flow.if') {
      html += '<label>Condição (when)</label><input data-f="when" value="' + String(n.when || '') + '" placeholder="{{no.valores.x}} >= 0.7">';
      html += '<label>Então (then)</label><input data-f="then" value="' + String(n.then || '') + '">';
      html += '<label>Senão (else)</label><input data-f="else" value="' + String(n.else || '') + '">';
    } else if (n.type === 'flow.switch') {
      html += '<label>Expressão (on)</label><input data-f="on" value="' + String(n.on || '') + '" placeholder="{{no.valores.area}}">';
      html += '<label>Casos (um por linha: valor = alvo)</label><textarea data-f="cases" style="min-height:90px">' + Object.entries(n.cases || {}).map(function (c) { return c[0] + ' = ' + (Array.isArray(c[1]) ? c[1][0] : c[1]); }).join('\\n') + '</textarea>';
    } else if (n.type === 'action.webhook') {
      html += '<label>URL</label><input data-f="url" value="' + String(n.url || '').replace(/"/g, '&quot;') + '" placeholder="https://app.example.com/hook">';
      html += '<label>Método</label><select data-f="method"><option' + (n.method === 'GET' ? ' selected' : '') + '>POST</option><option' + (n.method === 'GET' ? ' selected' : '') + '>GET</option><option' + (n.method === 'PUT' ? ' selected' : '') + '>PUT</option></select>';
      html += '<label>Corpo (JSON, com {{interpolação}})</label><textarea data-f="body" style="min-height:80px">' + JSON.stringify(n.body || {}, null, 2).replace(/</g, '&lt;') + '</textarea>';
    } else if (n.type === 'action.log') {
      html += '<label>Texto (com {{interpolação}})</label><textarea data-f="texto">' + String(n.texto || '').replace(/</g, '&lt;') + '</textarea>';
    } else if (n.type === 'action.set') {
      html += '<label>Variáveis (uma por linha: chave = valor)</label><textarea data-f="values" style="min-height:70px">' + Object.entries(n.values || {}).map(function (v) { return v[0] + ' = ' + v[1]; }).join('\\n') + '</textarea>';
    } else {
      var editableNode = JSON.parse(JSON.stringify(n));
      delete editableNode.type; delete editableNode.next;
      html += '<label>Configuração do contrato (JSON)</label><textarea data-f="nodeJson" style="min-height:230px">' + esc(JSON.stringify(editableNode, null, 2)) + '</textarea>';
      html += '<div class="field-hint">O tipo, custo, risco e capacidade vêm do catálogo e não podem ser reduzidos aqui.</div><div class="config-error" id="enConfigError" role="alert"></div>';
    }
    html += '<label>Próximo nó (next)</label><input data-f="next" value="' + String(n.next || '') + '" placeholder="deixe vazio para fim">';

    corpo.innerHTML = html;

    // remover pergunta
    corpo.querySelectorAll('.del-q').forEach(function (b) {
      b.onclick = function () {
        var qb = b.closest('.qblock');
        var qid = qb.dataset.q;
        delete DRAFT.nodes[id].questions[qid];
        qb.remove(); marcarSujo();
      };
    });
    // adicionar pergunta
    var addBtn = corpo.querySelector('#enAddQ');
    if (addBtn) {
      addBtn.onclick = function () {
        var qid = 'pergunta_' + Date.now().toString(36).slice(-3);
        if (!DRAFT.nodes[id].questions) DRAFT.nodes[id].questions = {};
        DRAFT.nodes[id].questions[qid] = { type: 'noul', instructions: 'Pergunta nova — formule com base no input' };
        marcarSujo(); abrirEditor(id); // re-render
      };
    }

    document.getElementById('enSalvar').onclick = function () { salvarEditor(id); };
    selecionarNo(id);
    ativarAba('edit');
    editorEl.classList.add('on');
  }

  function salvarEditor(id) {
    var n = DRAFT.nodes[id];
    if (!n) return;
    var corpo = document.getElementById('enCorpo');

    if (n.type === 'jev.ask' && n.questions) {
      corpo.querySelectorAll('.qblock').forEach(function (qb) {
        var qid = qb.dataset.q;
        var q = n.questions[qid];
        if (!q) return;
        var instr = qb.querySelector('[data-f="instructions"]');
        if (instr) q.instructions = instr.value.trim();
        var crit = qb.querySelector('[data-f="criteria"]');
        if (crit && q.type === 'choice') {
          var linhas = crit.value.split('\\n').filter(function (l) { return l.trim(); });
          var novo = {};
          linhas.forEach(function (l) {
            var eq = l.indexOf('=');
            if (eq > 0) novo[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
            else novo[l.trim()] = null;
          });
          q.criteria = novo;
        } else if (crit && q.type === 'score') {
          q.criteria = crit.value.split('\\n').filter(function (l) { return l.trim(); });
        }
      });
    } else if (n.type === 'action.webhook') {
      var url = corpo.querySelector('[data-f="url"]');
      if (url) n.url = url.value.trim();
      var met = corpo.querySelector('[data-f="method"]');
      if (met) n.method = met.value;
      var bod = corpo.querySelector('[data-f="body"]');
      if (bod) { try { n.body = JSON.parse(bod.value); } catch (e) { void e; } }
    } else if (corpo.querySelector('[data-f="nodeJson"]')) {
      var jsonField = corpo.querySelector('[data-f="nodeJson"]');
      try {
        var nodeConfig = JSON.parse(jsonField.value || '{}');
        if (!nodeConfig || typeof nodeConfig !== 'object' || Array.isArray(nodeConfig)) throw new Error('use um objeto JSON');
        delete nodeConfig.type; delete nodeConfig.next;
        var oldNext = n.next;
        DRAFT.nodes[id] = Object.assign({ type: n.type }, nodeConfig);
        if (oldNext) DRAFT.nodes[id].next = oldNext;
        n = DRAFT.nodes[id];
      } catch (error) {
        var configError = corpo.querySelector('#enConfigError');
        if (configError) { configError.textContent = 'JSON inválido: ' + error.message; configError.classList.add('on'); }
        return;
      }
    } else {
      ['jevlet', 'when', 'then', 'else', 'on', 'texto'].forEach(function (f) {
        var el = corpo.querySelector('[data-f="' + f + '"]');
        if (el) n[f] = el.value.trim() || undefined;
      });
      var casesEl = corpo.querySelector('[data-f="cases"]');
      if (casesEl) {
        var novo = {};
        casesEl.value.split('\\n').forEach(function (l) {
          var eq = l.indexOf('=');
          if (eq > 0) novo[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
          else if (l.trim()) novo[l.trim()] = '';
        });
        n.cases = novo;
      }
      var valEl = corpo.querySelector('[data-f="values"]');
      if (valEl) {
        var nv = {};
        valEl.value.split('\\n').forEach(function (l) {
          var eq = l.indexOf('=');
          if (eq > 0) nv[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
        });
        n.values = nv;
      }
    }
    var nextEl = corpo.querySelector('[data-f="next"]');
    if (nextEl) { if (nextEl.value.trim()) n.next = nextEl.value.trim(); else delete n.next; }

    marcarSujo();
    aplicarVisual();
    document.getElementById('editorNo').classList.remove('on');
    ativarAba('exec');
    EDITOR_SNAPSHOT = null; EDITOR_ID = null;
  }
  function cancelarEditor() {
    if (EDITOR_SNAPSHOT && EDITOR_ID) {
      DRAFT.nodes[EDITOR_ID] = EDITOR_SNAPSHOT;
      aplicarVisual();
    }
    document.getElementById('editorNo').classList.remove('on');
    ativarAba('exec');
    EDITOR_SNAPSHOT = null; EDITOR_ID = null;
  }
  document.getElementById('enFechar').onclick = document.getElementById('enCancelar').onclick = cancelarEditor;
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (document.getElementById('editorNo').classList.contains('on')) cancelarEditor();
    [[paleta, 'rbPaleta'], [copiloto, 'rbCopiloto'], [gaveta, 'rbGaveta']].forEach(function (par) {
      if (par[0].classList.contains('on')) { par[0].classList.remove('on'); document.getElementById(par[1]).classList.remove('on'); document.getElementById(par[1]).setAttribute('aria-expanded', 'false'); }
    });
  });

  function excluirNo(id) {
    if (D.catalogPreview) { setSaveStatus('readonly', 'Prévia do catálogo', 'Duplique este fluxo para excluir nós.'); return; }
    delete DRAFT.nodes[id];
    Object.keys(DRAFT.nodes).forEach(function (k) {
      var n = DRAFT.nodes[k];
      if (n.next === id) delete n.next;
      if (n.then === id) delete n.then;
      if (n.else === id) delete n.else;
      if (n.cases) Object.keys(n.cases).forEach(function (c) {
        var a = n.cases[c]; var arr = Array.isArray(a) ? a : [a];
        if (arr.indexOf(id) >= 0) delete n.cases[c];
      });
    });
    if (DRAFT.start === id) DRAFT.start = Object.keys(DRAFT.nodes)[0];
    aplicarVisual(); marcarSujo();
  }

  // ── paleta: adicionar nó (conecta a partir do selecionado) ──
  var PADROES = Object.create(null);
  (D.catalog || []).forEach(function (definition) {
    PADROES[definition.type] = JSON.parse(JSON.stringify(definition.example || { type: definition.type }));
  });
  function addNo(tipo) {
    if (D.catalogPreview) { setSaveStatus('readonly', 'Prévia do catálogo', 'Duplique este fluxo para adicionar nós.'); return; }
    var orig = SEL && DRAFT.nodes[SEL];
    if (!orig) {
      alert('Selecione um nó do grafo antes de adicionar outro — o novo nó precisa de uma conexão explícita.');
      return;
    }
    var id = tipo.replace(/[._]/g, '_') + '_' + Date.now().toString(36).slice(-3);
    var novo = JSON.parse(JSON.stringify(PADROES[tipo] || { type: tipo }));
    if (orig.type === 'flow.switch') {
      orig.cases = orig.cases || {};
      orig.cases['novo_' + id] = id;
    } else if (orig.type === 'flow.if') {
      if (!orig.then) orig.then = id;
      else if (!orig.else) orig.else = id;
      else { alert('Este IF já tem then e else. Selecione outro nó ou edite os ramos existentes.'); return; }
    } else if (!orig.next) {
      orig.next = id;
    } else {
      novo.next = orig.next;
      orig.next = id;
    }
    DRAFT.nodes[id] = novo;
    aplicarVisual(); marcarSujo(); paleta.classList.remove('on');
  }
  document.querySelectorAll('.pn').forEach(function (b) { b.onclick = function () { addNo(b.dataset.t); }; });
  var paletteFilter = 'all';
  function filterNodePalette() {
    var query = String(document.getElementById('nodeSearch').value || '').trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll('.node-library-item').forEach(function (item) {
      var filterOk = paletteFilter === 'all'
        || (paletteFilter === 'free' && item.dataset.cost === 'free')
        || (paletteFilter === 'jev' && String(item.dataset.cost).indexOf('jev') === 0)
        || (paletteFilter === 'no-network' && item.dataset.remote === '0');
      var searchOk = !query || String(item.dataset.search || '').indexOf(query) >= 0;
      item.hidden = !(filterOk && searchOk);
      if (!item.hidden) visible++;
    });
    document.getElementById('nodePaletteEmpty').hidden = visible !== 0;
  }
  document.getElementById('nodeSearch').addEventListener('input', filterNodePalette);
  document.querySelectorAll('.catalog-filter').forEach(function (button) {
    button.onclick = function () {
      paletteFilter = button.dataset.filter;
      document.querySelectorAll('.catalog-filter').forEach(function (candidate) { candidate.classList.toggle('on', candidate === button); });
      filterNodePalette();
    };
  });

  // ── re-derivar grafo do rascunho (posições novas ganham layout) ──
  function aplicarVisual() {
    var edges = [], prof = {};
    (function calc(id, d) {
      if ((prof[id] === undefined ? -1 : prof[id]) >= d) return;
      prof[id] = d;
      var n = DRAFT.nodes[id]; if (!n) return;
      var alvos = [];
      if (n.next) alvos.push([n.next, '']);
      if (n.type === 'flow.if') { if (n.then) alvos.push([n.then, 'sim']); if (n.else) alvos.push([n.else, 'não']); }
      if (n.type === 'flow.switch') Object.keys(n.cases || {}).forEach(function (c, index) {
        var a = n.cases[c]; if (a) alvos.push([Array.isArray(a) ? a[0] : a, c === '_default' ? 'padrão' : 'caso ' + (index + 1)]);
      });
      alvos.forEach(function (par) { if (!par[0] || !DRAFT.nodes[par[0]]) return; edges.push({ from: id, to: par[0], label: par[1] }); calc(par[0], d + 1); });
    })(DRAFT.start, 0);
    var col = {};
    Object.keys(DRAFT.nodes).forEach(function (id) {
      if (pos[id]) return;
      if (prof[id] === undefined) prof[id] = 0;
      (col[prof[id]] = col[prof[id]] || []).push(id);
    });
    Object.keys(col).forEach(function (cp) { col[cp].forEach(function (id, j) { pos[id] = { x: 100 + Number(cp) * 324, y: 92 + j * 176 }; }); });
    var novos = [];
    Object.keys(DRAFT.nodes).forEach(function (id) {
      var n = DRAFT.nodes[id];
      var ui = TIPOS_UI[n.type] || ['··', 'action', n.type];
      var definition = CATALOG_BY_TYPE[n.type] || {};
      novos.push({ id: id, tipo: n.type, classe: ui[1], icone: ui[0], rotulo: ui[2], sub: subtituloNo(n), inicio: id === DRAFT.start,
        group: definition.group, costClass: definition.costClass, riskClass: definition.riskClass, remote: definition.remote });
    });
    D.nodes = novos; D.edges = edges;
    remontarNos();
    if (isMobileGraph()) fit(); else drawWires();
    renderFlowGuide();
    renderReasoningSurface();
    if (SEL && DRAFT.nodes[SEL]) mostrarGuiaNo(SEL);
  }

  // ── rail + gaveta (testes e conexões) ──
  document.getElementById('rbPaleta').onclick = function () { var aberto = paleta.classList.toggle('on'); this.classList.toggle('on', aberto); this.setAttribute('aria-expanded', aberto ? 'true' : 'false'); };
  document.getElementById('rbCopiloto').onclick = function () { var aberto = copiloto.classList.toggle('on'); this.classList.toggle('on', aberto); this.setAttribute('aria-expanded', aberto ? 'true' : 'false'); };
  document.getElementById('rbGaveta').onclick = function () {
    if (gaveta.classList.contains('on')) { gaveta.classList.remove('on'); this.classList.remove('on'); this.setAttribute('aria-expanded', 'false'); }
    else { abrirGaveta('teste'); this.classList.add('on'); this.setAttribute('aria-expanded', 'true'); }
  };
  document.getElementById('btnTeste').onclick = function () { abrirGaveta('teste'); document.getElementById('rbGaveta').setAttribute('aria-expanded', 'true'); };
  function abrirGaveta(aba) {
    gaveta.classList.add('on');
    document.getElementById('rbGaveta').classList.add('on'); document.getElementById('rbGaveta').setAttribute('aria-expanded', 'true');
    document.querySelectorAll('.tabs2 div').forEach(function (t) { var ativo = t.dataset.g === aba; t.classList.toggle('on', ativo); t.setAttribute('aria-selected', ativo ? 'true' : 'false'); });
    document.querySelectorAll('.gb').forEach(function (g) { g.style.display = g.dataset.g === aba ? 'block' : 'none'; });
    if (aba === 'conex') document.getElementById('gUrl').textContent = location.origin +
      (D.catalogPreview ? '/api/jev/flows/compendium/simulate' : '/api/jev/flows/' + D.flow.id + '/run');
  }
  document.querySelectorAll('.tabs2 div').forEach(function (t) { t.onclick = function () { abrirGaveta(t.dataset.g); }; t.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); } }; });
  document.getElementById('gCopiar').onclick = async function () {
    var cmd = D.catalogPreview ? JSON.stringify({ method: 'POST',
      url: location.origin + '/api/jev/flows/compendium/simulate',
      body: { ...D.catalogKey, input: D.input, answers: D.sampleAnswers } }, null, 2)
      : 'curl -X POST ' + location.origin + '/api/jev/flows/' + D.flow.id + "/run -H 'content-type: application/json' -d '{\\\"input\\\":{}}'";
    var b = this;
    try {
      if (!navigator.clipboard) throw new Error('clipboard indisponível');
      await navigator.clipboard.writeText(cmd);
      b.textContent = 'copiado ✓';
    } catch (e) {
      b.textContent = 'não copiado — selecione o comando';
      b.title = cmd;
    }
    setTimeout(function () { b.textContent = D.catalogPreview ? 'copiar pedido JSON' : 'copiar comando'; }, 1800);
  };

  // ── teste em preview (roda o RASCUNHO sem salvar) ──
  var gInput = document.getElementById('gInput');
  gInput.value = JSON.stringify(D.input && Object.keys(D.input).length ? D.input : exemploDeInput(), null, 1);
  var gAnswers = document.getElementById('gAnswers');
  if (gAnswers) gAnswers.value = JSON.stringify(D.sampleAnswers || {}, null, 2);
  if (gAnswers) gInput.addEventListener('input', function () {
    gAnswers.value = '{}';
    gAnswers.title = 'A entrada mudou: informe respostas tipadas para este cenário antes de simular.';
  });
  if (D.catalogPreview) document.getElementById('gRodar').textContent = '▶ simular';
  var gFixtureSelect = document.getElementById('gFixtureSelect');
  var gFixtureName = document.getElementById('gFixtureName');
  var gFixtureSave = document.getElementById('gFixtureSave');
  var gFixtureRemove = document.getElementById('gFixtureRemove');
  var gFixtureNew = document.getElementById('gFixtureNew');
  var gFixtureState = document.getElementById('gFixtureState');
  var gFixtureHelp = document.getElementById('gFixtureHelp');
  var gFixtureExpected = document.getElementById('gFixtureExpected');
  var fixturePanel = document.getElementById('fixturePanel');
  function fixtureState(state, text) {
    gFixtureState.dataset.state = state || 'idle';
    gFixtureState.textContent = text;
  }
  function fixtureById(id) { return DRAFT.fixtures.find(function (fixture) { return fixture.id === id; }) || null; }
  function fixtureNextId() {
    var i = DRAFT.fixtures.length + 1;
    while (fixtureById('fixture-' + i)) i++;
    return 'fixture-' + i;
  }
  function renderFixtures() {
    gFixtureSelect.innerHTML = '<option value="">nova fixture</option>' + DRAFT.fixtures.map(function (fixture) {
      return '<option value="' + esc(fixture.id) + '">' + esc(fixture.name) + '</option>';
    }).join('');
    gFixtureSelect.value = FIXTURE_ID || '';
    var fixture = fixtureById(FIXTURE_ID);
    gFixtureName.value = fixture ? fixture.name : '';
    gFixtureRemove.disabled = SOMENTE_LEITURA || !fixture;
    gFixtureSave.disabled = SOMENTE_LEITURA;
    gFixtureNew.disabled = SOMENTE_LEITURA;
    if (SOMENTE_LEITURA) {
      gFixtureHelp.hidden = false;
      gFixtureHelp.textContent = 'Exemplo shipped somente leitura: selecione e edite o input para testar, depois use “Duplicar para editar” para salvar fixtures.';
    } else {
      gFixtureHelp.hidden = true;
      gFixtureHelp.textContent = '';
    }
    if (fixture) fixtureState('ok', 'selecionada: ' + fixture.name);
    else fixtureState('idle', DRAFT.fixtures.length ? 'selecione ou crie uma fixture' : 'nenhuma fixture salva');
  }
  function selecionarFixture(id) {
    FIXTURE_ID = id || null;
    var fixture = fixtureById(FIXTURE_ID);
    if (fixture) {
      gInput.value = JSON.stringify(fixture.input || {}, null, 1);
      if (gAnswers) {
        gAnswers.value = JSON.stringify(fixture.answers || {}, null, 2);
        gAnswers.title = fixture.answers ? 'Respostas tipadas desta fixture.' : 'Fixture sem respostas tipadas: informe-as antes de simular.';
      }
      gFixtureExpected.hidden = !fixture.esperado;
      gFixtureExpected.textContent = fixture.esperado ? 'Resultado esperado: ' + JSON.stringify(fixture.esperado) : '';
      gInput.style.display = 'block';
      document.getElementById('gInputBtn').textContent = 'ocultar input';
      document.getElementById('gInputBtn').setAttribute('aria-expanded', 'true');
      fixtureState('ok', 'selecionada: ' + fixture.name);
    } else {
      if (gAnswers) { gAnswers.value = '{}'; gAnswers.title = 'Informe respostas tipadas para este cenário antes de simular.'; }
      gFixtureExpected.hidden = true;
      gFixtureExpected.textContent = '';
      fixtureState('idle', 'nova fixture — edite o input e salve');
    }
    renderFixtures();
  }
  gFixtureSelect.onchange = function () { selecionarFixture(gFixtureSelect.value); };
  gFixtureNew.onclick = function () { selecionarFixture(''); gFixtureName.focus(); };
  gFixtureSave.onclick = function () {
    if (SOMENTE_LEITURA) return;
    var name = gFixtureName.value.trim();
    if (!name) { fixtureState('error', 'informe um nome'); gFixtureName.focus(); return; }
    var input;
    try { input = JSON.parse(gInput.value); } catch (error) { fixtureState('error', 'input inválido: ' + textoTeste(error && error.message, 'JSON inválido')); gInput.style.display = 'block'; gInput.focus(); return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) { fixtureState('error', 'o input deve ser um objeto JSON'); gInput.focus(); return; }
    var answers = null;
    if (gAnswers) {
      try { answers = JSON.parse(gAnswers.value); }
      catch (error) { fixtureState('error', 'respostas inválidas: ' + textoTeste(error && error.message, 'JSON inválido')); gAnswers.focus(); return; }
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) { fixtureState('error', 'respostas devem ser objeto JSON'); gAnswers.focus(); return; }
      if (!Object.keys(answers).length) answers = null;
    }
    var fixture = fixtureById(FIXTURE_ID);
    if (fixture) { fixture.name = name; fixture.input = input; if (gAnswers) fixture.answers = answers; }
    else { fixture = { id: fixtureNextId(), name: name, input: input, answers: answers, esperado: null }; DRAFT.fixtures.push(fixture); FIXTURE_ID = fixture.id; }
    renderFixtures();
    fixtureState('ok', 'fixture salva — há alterações não salvas no flow');
    marcarSujo();
  };
  gFixtureRemove.onclick = function () {
    if (SOMENTE_LEITURA || !FIXTURE_ID) return;
    var fixture = fixtureById(FIXTURE_ID);
    if (!fixture || !window.confirm('Remover a fixture "' + fixture.name + '"?')) return;
    DRAFT.fixtures = DRAFT.fixtures.filter(function (item) { return item.id !== FIXTURE_ID; });
    FIXTURE_ID = null;
    renderFixtures();
    fixtureState('ok', 'fixture removida — há alterações não salvas no flow');
    marcarSujo();
  };
  renderFixtures();
  function exemploDeInput() {
    var ex = {};
    Object.entries(D.flow.input_schema || {}).forEach(function (entry) {
      var k = entry[0], raw = entry[1];
      var spec = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw : { type: String(raw || '').split(/[ —-]/)[0] };
      if (Object.prototype.hasOwnProperty.call(spec, 'example')) ex[k] = spec.example;
      else if (Object.prototype.hasOwnProperty.call(spec, 'default')) ex[k] = spec.default;
      else if (Array.isArray(spec.enum) && spec.enum.length) ex[k] = spec.enum[0];
      else {
        var type = String(spec.type || 'string').toLowerCase();
        ex[k] = type === 'array' ? [] : type === 'object' ? {}
          : type === 'number' ? 0 : type === 'boolean' ? false : 'exemplo de ' + k;
      }
    });
    return ex;
  }
  document.getElementById('gInputBtn').onclick = function () {
    gInput.style.display = gInput.style.display === 'none' ? 'block' : 'none';
    this.textContent = gInput.style.display === 'none' ? 'editar input' : 'ocultar input';
    this.setAttribute('aria-expanded', gInput.style.display === 'none' ? 'false' : 'true');
  };
  if (location.hash === '#fixtures') {
    abrirGaveta('teste');
    fixturePanel.classList.add('targeted');
    setTimeout(function () { gFixtureSelect.focus(); }, 0);
  }
  if (location.hash === '#testador' || D.catalogPreview) {
    abrirGaveta('teste');
    gInput.style.display = 'block';
    document.getElementById('gInputBtn').textContent = 'ocultar input';
    document.getElementById('gInputBtn').setAttribute('aria-expanded', 'true');
    setTimeout(function () { gaveta.scrollIntoView({ block: 'nearest' }); gInput.focus(); }, 0);
  }
  var testeRodando = false;
  function textoTeste(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === '') return fallback;
    var text = String(value);
    return /\bundefined\b/i.test(text) ? fallback : text;
  }
  function normalizarTesteResposta(body) {
    var rawSteps = body && Array.isArray(body.steps) ? body.steps : [];
    var steps = rawSteps.map(function (step, index) {
      return {
        no: textoTeste(step && step.no, 'passo ' + (index + 1)),
        tipo: textoTeste(step && step.tipo, 'tipo não informado'),
        ok: step && step.ok === true,
        ms: Number.isFinite(Number(step && step.ms)) ? Number(step.ms) : null,
        resumo: textoTeste(step && step.resumo, ''),
        erro: textoTeste(step && step.erro, 'falha sem detalhe'),
      };
    });
    var path = body && Array.isArray(body.path) ? body.path.map(function (node, index) { return textoTeste(node, 'passo ' + (index + 1)); }) : [];
    var failed = steps.find(function (step) { return !step.ok; });
    var rawError = body && (body.error || body.message) || (failed && failed.erro);
    return {
      ok: body && body.ok === true,
      origem: textoTeste(body && body.origem, body && body.ok === true ? 'execução concluída' : 'execução com falha'),
      path: path,
      steps: steps,
      outputs: body && body.outputs && typeof body.outputs === 'object' ? body.outputs : {},
      usage: body && body.usage && typeof body.usage === 'object' ? body.usage : {},
      mode: body && body.mode || null,
      duration: steps.reduce(function (total, step) { return total + (step.ms || 0); }, 0),
      erro: textoTeste(rawError, 'a execução falhou; revise o input e tente novamente'),
    };
  }
  function setTesteAcoes(disabled) {
    document.getElementById('gRodar').disabled = disabled;
    document.getElementById('gInputBtn').disabled = disabled;
  }
  function renderTesteLoading() {
    var res = document.getElementById('gResultado');
    res.dataset.state = 'loading'; res.setAttribute('aria-busy', 'true');
    res.innerHTML = '<span class="spin" style="border-color:rgba(124,92,255,.4);border-top-color:#fff"></span> ' +
      (D.catalogPreview ? 'simulando' : 'executando') + (SUJO ? ' o RASCUNHO (não salvo)' : '') + '…';
  }
  function renderTesteFalha(message) {
    var res = document.getElementById('gResultado');
    var safeMessage = textoTeste(message, 'a execução falhou; revise o input e tente novamente');
    res.dataset.state = 'failure'; res.setAttribute('aria-busy', 'false');
    res.innerHTML = '<div role="alert" style="color:#ff8a8a"><b>✖ falha</b><div style="margin-top:5px">status: falha · ' + esc(safeMessage) + '</div>' +
      '<div style="margin-top:7px;color:var(--dim)">ação: revise o input ou o rascunho e tente novamente.</div>' +
      '<button id="gRetry" type="button" style="margin-top:9px;border:1px solid rgba(255,138,138,.45);background:rgba(255,82,82,.08);color:#ffb2b2;border-radius:7px;padding:5px 10px;font-size:11px;cursor:pointer">↻ tentar novamente</button></div>';
    document.getElementById('gRetry').onclick = rodarTeste;
    if (D.catalogPreview) {
      banner.className = 'banner fail';
      banner.textContent = 'Último teste: falha. O canvas mostra a amostra inicial; detalhes no painel Teste.';
    }
  }
  function renderTesteSucesso(result) {
    var res = document.getElementById('gResultado');
    var okSteps = result.steps.filter(function (step) { return step.ok; }).length;
    var caminho = result.path.length ? result.path.join(' → ') : 'caminho não informado';
    var html = '<div style="margin-bottom:9px;font-size:11px;color:#2ecc71"><b>✔ sucesso</b> · ' + esc(result.origem) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:9px;color:var(--dim);font-size:10.5px">' +
      '<span><b style="color:var(--txt)">status:</b> sucesso</span>' +
      '<span><b style="color:var(--txt)">caminho:</b> <span style="font-family:ui-monospace">' + esc(caminho) + '</span></span>' +
      '<span><b style="color:var(--txt)">passos:</b> ' + okSteps + '/' + result.steps.length + '</span>' +
      '<span><b style="color:var(--txt)">' + (result.mode === 'simulation' ? 'duração da simulação local:' : 'duração:') + '</b> ' + result.duration + ' ms</span>' +
      '<span><b style="color:var(--txt)">julgamentos:</b> ' + esc(result.usage.jevCalls ?? '—') + (result.mode === 'simulation' ? ' simulados' : '') + '</span>' +
      '<span><b style="color:var(--txt)">tokens de entrada:</b> ' + esc(result.usage.inputTokensBudgeted ?? '—') + (result.mode === 'simulation' ? ' estimados' : '') + '</span>' +
      (result.mode === 'simulation' ? '<span><b style="color:var(--txt)">custo real:</b> US$0 · sem chamada Jev</span>' : '') + '</div>';
    result.steps.forEach(function (step, index) {
      var out = result.outputs[step.no];
      var resumo = step.ok ? step.resumo : step.erro;
      html += '<div class="tpasso"><div class="th" data-i="' + index + '">' + (step.ok ? '✔' : '✖') +
        ' <b>' + esc(step.no) + '</b> <span class="k">· ' + esc(step.tipo) + ' · ' + (step.ms == null ? 'duração indisponível' : esc(step.ms + 'ms')) + (resumo ? ' · ' + esc(resumo.slice(0, 60)) : '') + '</span></div>' +
        '<pre>' + esc(out === undefined ? 'saída não informada' : JSON.stringify(out, null, 1)) + '</pre></div>';
    });
    if (!result.steps.length) html += '<div style="color:var(--dim)">nenhum passo retornado pela execução.</div>';
    res.dataset.state = 'success'; res.setAttribute('aria-busy', 'false'); res.innerHTML = html;
    res.querySelectorAll('.th').forEach(function (th) { th.onclick = function () { th.parentElement.classList.toggle('aberto'); }; });
    if (D.catalogPreview) {
      banner.className = 'banner ok';
      banner.textContent = 'Último teste: ' + caminho + '. O canvas mostra a amostra inicial; detalhes no painel Teste.';
    }
  }
  async function rodarTeste() {
    if (testeRodando) return;
    testeRodando = true;
    setTesteAcoes(true);
    try { await rodarTesteInterno(); }
    catch (error) { renderTesteFalha(error && error.message); }
    finally { testeRodando = false; setTesteAcoes(false); }
  }
  async function rodarTesteInterno() {
    var res = document.getElementById('gResultado');
    var input;
    try { input = JSON.parse(gInput.value); }
    catch (e) { renderTesteFalha('input inválido: ' + textoTeste(e && e.message, 'JSON inválido')); return; }
    renderTesteLoading();
    var body = D.catalogPreview ? { ...D.catalogKey, input: input } : { input: input };
    if (D.catalogPreview) {
      try {
        body.answers = JSON.parse(gAnswers.value);
        if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers) || !Object.keys(body.answers).length) throw new Error('informe respostas tipadas para o input atual');
      } catch (error) { renderTesteFalha('respostas simuladas inválidas: ' + textoTeste(error && error.message, 'JSON inválido')); gAnswers.focus(); return; }
    }
    if (SUJO && !D.catalogPreview) body.flow = DRAFT;
    var endpoint = D.catalogPreview ? '/api/jev/flows/compendium/simulate'
      : '/api/jev/flows/' + D.flow.id + '/run';
    var r = await apiJev(endpoint, { method: 'POST', body: JSON.stringify(body) });
    if (r.status !== 200) {
      var errors = r.body && r.body.validacao && Array.isArray(r.body.validacao.errors) ? r.body.validacao.errors : [];
      renderTesteFalha(errors.map(function (e) { return (e.codigo || 'erro') + ': ' + (e.msg || e.error || 'verifique o campo'); }).join(' · ') || (r.body && (r.body.error || r.body.message)));
      return;
    }
    var result = normalizarTesteResposta(r.body);
    if (!result.ok) { renderTesteFalha(result.erro); return; }
    renderTesteSucesso(result);
  }
  document.getElementById('gRodar').onclick = rodarTeste;

  // ── 🧪 SIMULADOR: bateria · força de julgamentos · orquestração ──
  var simPerguntasEl = document.getElementById('simPerguntas');
  var simControles = [];
  function montarPerguntasSimulador() {
    simControles = [];
    var linhas = [];
    Object.keys(D.flow.nodes || {}).forEach(function (nid) {
      var n = D.flow.nodes[nid];
      if (n.type === 'jev.ask' && n.questions) {
        Object.keys(n.questions).forEach(function (qid) {
          var q = n.questions[qid];
          var id = 'simQ_' + nid + '_' + qid;
          if (q.type === 'choice') {
            var ops = Object.keys(q.criteria || {}).map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + '</option>'; }).join('');
            linhas.push('<label style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dim)"><span style="min-width:150px">' + esc(nid + ' · ' + qid) + ' <b style="color:var(--txt)">choice</b></span><select id="' + id + '" style="flex:1;background:#17171f;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:4px 8px"><option value="">—</option>' + ops + '</select></label>');
          } else if (q.type === 'score') {
            linhas.push('<label style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dim)"><span style="min-width:150px">' + esc(nid + ' · ' + qid) + ' <b style="color:var(--txt)">score</b></span><input id="' + id + '" type="number" min="0" step="0.5" placeholder="—" style="flex:1;background:#17171f;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:4px 8px"></label>');
          } else {
            linhas.push('<label style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dim)"><span style="min-width:150px">' + esc(nid + ' · ' + qid) + ' <b style="color:var(--txt)">noul 0–1</b></span><input id="' + id + '" type="number" min="0" max="1" step="0.05" placeholder="—" style="flex:1;background:#17171f;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:4px 8px"></label>');
          }
          simControles.push({ tipo: 'ask', qid: qid, tipoPergunta: q.type, el: id });
        });
      }
      if (n.type === 'rules.find') {
        var idR = 'simR_' + nid + '_qual_regra';
        var idE = 'simR_' + nid + '_existe_regra';
        var regrasOpts = '<option value="">—</option>';
        linhas.push('<label style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dim)"><span style="min-width:150px">' + esc(nid + ' · regra') + ' <b style="color:var(--txt)">' + esc(n.ruleset || 'inline') + '</b></span><select id="' + idR + '" style="flex:1;background:#17171f;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:4px 8px">' + regrasOpts + '</select></label>');
        linhas.push('<label style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--dim)"><span style="min-width:150px">' + esc(nid + ' · existe regra?') + ' <b style="color:var(--txt)">noul 0–1</b></span><input id="' + idE + '" type="number" min="0" max="1" step="0.05" placeholder="—" style="flex:1;background:#17171f;color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:4px 8px"></label>');
        simControles.push({ tipo: 'rules', qid: 'qual_regra', el: idR });
        simControles.push({ tipo: 'rules', qid: 'existe_regra', el: idE });
        // popula as regras do ruleset (IDs estáveis R001…)
        if (n.ruleset) {
          apiJev('/api/jev/rulesets/' + encodeURIComponent(n.ruleset)).then(function (r) {
            if (r.status !== 200) return;
            var sel = document.getElementById(idR);
            if (!sel) return;
            sel.innerHTML = '<option value="">—</option><option value="nenhuma">nenhuma</option>' +
              (r.body.regras || []).map(function (rg) { return '<option value="' + esc(rg.id) + '">' + esc(rg.id + (rg.excecao ? ' · EXCEÇÃO' : '') + ' · ' + String(rg.texto).slice(0, 60)) + '</option>'; }).join('');
          }).catch(function () {});
        }
      }
    });
    simPerguntasEl.innerHTML = linhas.length ? linhas.join('') : '<div style="color:var(--dim);font-size:11px">este flow não tem julgamentos forcíveis (só nós determinísticos)</div>';
  }
  montarPerguntasSimulador();
  document.getElementById('simLimpar').onclick = function () {
    simControles.forEach(function (c) { var el = document.getElementById(c.el); if (el) el.value = ''; });
  };
  document.getElementById('simAplicar').onclick = function () {
    var answers = {};
    var usados = 0;
    simControles.forEach(function (c) {
      var el = document.getElementById(c.el);
      if (!el || el.value === '' || el.value == null) return;
      var v = el.value;
      if (c.tipoPergunta === 'noul' || c.qid === 'existe_regra') v = Math.max(0, Math.min(1, Number(v)));
      else if (c.tipoPergunta === 'score') v = Number(v);
      answers[c.qid] = v;
      usados++;
    });
    if (!usados) return;
    var replayUrl = new URL(location.href);
    replayUrl.searchParams.set('answers', JSON.stringify(answers));
    location.href = replayUrl.toString();
  };
  document.getElementById('simRodar').onclick = async function () {
    var btn = this, res = document.getElementById('simResultado'), resumo = document.getElementById('simResumo');
    var extras = [];
    var linhasInvalidas = [];
    document.getElementById('simExtras').value.split(/\\n+/).forEach(function (linha, index) {
      if (!linha.trim()) return;
      try { extras.push(JSON.parse(linha)); }
      catch (e) { linhasInvalidas.push(index + 1); }
    });
    if (linhasInvalidas.length) {
      resumo.textContent = '';
      res.innerHTML = '<div role="alert" style="color:#ff8a8a;font-size:11px">✖ JSON inválido na linha ' + esc(linhasInvalidas.join(', ')) + '. Nenhum cenário foi executado.</div>';
      return;
    }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> simulando…';
    res.innerHTML = '<span style="color:var(--dim);font-size:11px">rodando cenários em simulação determinística…</span>';
    try {
      var body = D.catalogPreview ? { ...D.catalogKey, inputs: extras.length ? extras : undefined }
        : { inputs: extras.length ? extras : undefined };
      if (SUJO && !D.catalogPreview) body.flow = DRAFT;
      var batchEndpoint = D.catalogPreview ? '/api/jev/flows/compendium/simulate-batch'
        : '/api/jev/flows/' + D.flow.id + '/simulate';
      var r = await apiJev(batchEndpoint, { method: 'POST', body: JSON.stringify(body) });
      if (r.status !== 200) throw new Error(r.body.error || 'falhou');
      var b = r.body;
      resumo.textContent = b.total + ' cenários · ' + b.aprovados + ' aprovados · ' + b.reprovados + ' reprovados · ' + b.sem_esperado + ' sem esperado · ' + (b.falhas_simulacao || 0) + ' falhas de simulação';
      var html = b.resultados.map(function (c) {
        var selo = !c.ok ? '<b style="color:#ff5252">✖ falha de simulação</b>' : c.passou === true ? '<b style="color:#2ecc71">✔ passou</b>' : c.passou === false ? '<b style="color:#ff5252">✖ reprovado</b>' : '<b style="color:var(--dim)">— observação</b>';
        var falhas = (c.checagens || []).filter(function (ch) { return !ch.ok; })
          .map(function (ch) { return esc(ch.campo) + ': esperado ' + esc(JSON.stringify(ch.esperado)) + ' · obtido ' + esc(JSON.stringify(ch.obtido)); }).join(' · ');
        return '<div class="tpasso"><div class="th">' + selo + ' <b>' + esc(c.cenario) + '</b> <span class="k">· veredicto ' + esc(c.veredicto || '—') + ' · regra ' + esc(c.regra || '—') + (c.excecao ? ' · EXCEÇÃO' : '') + ' · status ' + esc(c.status || '—') + ' · webhook ' + (c.webhook ? 'sim' : 'não') + ' · ' + esc(c.passos || '—') + ' passos</span></div>' +
          (c.erro ? '<pre>' + esc(c.erro) + '</pre>' : falhas ? '<pre>' + falhas + '</pre>' : '<pre>' + esc(JSON.stringify(c.input)) + '</pre>') + '</div>';
      }).join('');
      res.innerHTML = html || '<div style="color:var(--dim);font-size:11px">nenhum cenário</div>';
      res.querySelectorAll('.th').forEach(function (th) { th.onclick = function () { th.parentElement.classList.toggle('aberto'); }; });
    } catch (e) { resumo.textContent = ''; res.innerHTML = '<div style="color:#ff8a8a;font-size:11px">✖ ' + esc(String(e.message)) + '</div>'; }
    btn.disabled = false; btn.textContent = '▶ rodar bateria';
  };
  document.getElementById('omniRodar').onclick = async function () {
    var btn = this, out = document.getElementById('omniResultado');
    var tarefa = document.getElementById('omniTarefa').value.trim();
    if (!tarefa) { out.innerHTML = '<div style="color:var(--dim);font-size:11px">describe the workflow goal above</div>'; return; }
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> designing…';
    try {
      var r = await apiJev('/api/jev/flows/design', { method: 'POST', body: JSON.stringify({ intent: tarefa }) });
      if (r.status !== 200) throw new Error((r.body && (r.body.error || r.body.message)) || 'design failed');
      var draft = r.body.rascunho || {}, valid = r.body.validacao || {};
      var errors = valid.errors || [];
      out.innerHTML = '<div style="font-size:11px;color:var(--dim);margin-bottom:6px">' + (valid.ok ? '✓ valid draft' : '⚠ draft needs review') + ' · ' + esc(draft.name || draft.id || 'untitled flow') + '</div><pre style="white-space:pre-wrap;max-height:280px;overflow:auto">' + esc(JSON.stringify(draft, null, 2)) + '</pre>' + (errors.length ? '<div style="color:#ff8a8a;font-size:11px">' + esc(errors.map(function(e){return e.codigo+': '+e.msg;}).join(' · ')) + '</div>' : '');
    } catch (e) { out.innerHTML = '<div style="color:#ff8a8a;font-size:11px">✖ ' + esc(String(e.message)) + '</div>'; }
    btn.disabled = false; btn.textContent = 'design a draft';
  };

  // ── copiloto: o chat do Jev Flow edita o flow ──
  var cpMsgs = document.getElementById('cpMsgs'), cpInput = document.getElementById('cpInput');
  function bolha(cls, html) {
    var d = document.createElement('div'); d.className = 'bmsg ' + cls; d.innerHTML = html;
    cpMsgs.appendChild(d); cpMsgs.scrollTop = cpMsgs.scrollHeight; return d;
  }
  bolha('a', 'Olá! Descreva a mudança que você quer no flow (<b>' + esc(D.flow.name) + '</b>) — eu redesenho o grafo, o validador confere e você aplica com um clique.');
  document.getElementById('cpFechar').onclick = function () { copiloto.classList.remove('on'); };
  document.querySelectorAll('.sugs button').forEach(function (b) { b.onclick = function () { cpInput.value = b.dataset.s; enviarCopiloto(); }; });
  async function enviarCopiloto() {
    if (D.catalogPreview) { bolha('a err', 'Duplique o fluxo para pedir alterações ao copiloto.'); return; }
    var msg = cpInput.value.trim(); if (!msg) return;
    cpInput.value = '';
    bolha('u', msg.replace(/</g, '&lt;'));
    var pensando = bolha('a', '<span class="spin" style="border-color:rgba(124,92,255,.4);border-top-color:#fff"></span> pensando com o Jev Flow…');
    try {
      var r = await apiJev('/api/jev/flows/' + D.flow.id + '/assist', { method: 'POST', body: JSON.stringify({ message: msg, flow: DRAFT }) });
      pensando.remove();
      if (r.status !== 200) throw new Error(r.body.error || 'falha');
      var b = r.body;
      var html = '<b>' + (b.resumo || 'patch pronto') + '</b>';
      if ((b.mudancas || []).length) html += '<div class="mud">' + b.mudancas.map(function (m) { return '· ' + String(m).replace(/</g, '&lt;'); }).join('<br/>') + '</div>';
      if (!b.validacao.ok) html += '<div class="res" style="color:#ff8a8a">validador: ' + b.validacao.errors.map(function (e) { return e.codigo; }).join(', ') + ' — peça para corrigir</div>';
      var d = bolha('a' + (b.validacao.ok ? '' : ' err'), html);
      if (b.flow_novo && b.validacao.ok) {
        var acts = document.createElement('div'); acts.className = 'acts';
        var ap = document.createElement('button'); ap.className = 'ap'; ap.textContent = '✔ Aplicar no rascunho';
        ap.onclick = function () {
          DRAFT = b.flow_novo; aplicarVisual(); marcarSujo();
          d.querySelector('.acts').innerHTML = '<span style="color:#2ecc71;font-size:11px">aplicado — salve para gravar</span>';
        };
        var ig = document.createElement('button'); ig.className = 'ig'; ig.textContent = 'ignorar';
        ig.onclick = function () { d.querySelector('.acts').innerHTML = '<span style="color:var(--dim);font-size:11px">ignorado</span>'; };
        acts.appendChild(ap); acts.appendChild(ig); d.appendChild(acts);
      }
    } catch (e) { pensando.remove(); bolha('a err', '⚠ ' + e.message); }
  }
  document.getElementById('cpEnviar').onclick = enviarCopiloto;
  cpInput.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarCopiloto(); } });
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// índice de fluxos (visão geral do estúdio)
// ---------------------------------------------------------------------------

function ultimoRunStatus(id) {
  const runsDir = join(FLOWS_DIR, 'runs', id);
  try {
    const ultimo = readdirSync(runsDir).filter(f => f.endsWith('.json')).sort().at(-1);
    if (!ultimo) return null;
    const r = JSON.parse(readFileSync(join(runsDir, ultimo), 'utf8'));
    return { ok: r.ok, quando: r.executado_em, ms: Array.isArray(r.steps) ? r.steps.reduce((s, x) => s + (Number(x.ms) || 0), 0) : 0 };
  } catch { return null; }
}

export async function buildFlowsIndexPage({ locale } = {}) {
  const i18n = getLocalePack(locale);
  const flows = [...listFlows()];
  if (existsSync(EXAMPLES_DIR)) {
    for (const f of readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.flow.json'))) {
      try {
        const fl = JSON.parse(readFileSync(join(EXAMPLES_DIR, f), 'utf8'));
        if (!flows.find(x => x.id === fl.id)) flows.push({
          id: fl.id,
          name: fl.name,
          nos: Object.keys(fl.nodes || {}).length,
          fields: Object.keys(fl.input_schema || {}).length,
          fixtures: Array.isArray(fl.fixtures) ? fl.fixtures.length : 0,
          description: fl.description || '',
          exemplo: true,
        });
      } catch { /* fora */ }
    }
  }
  const chave = isJevConfigured();
  const { estadoConexao } = await import('../jev/connection.mjs');
  const conn = estadoConexao();
  const connectionLabel = chave
    ? `${conn.provedor === 'openjev-compatible' ? 'OpenJev' : 'Jev'} ao vivo · ${conn.chave || 'loopback'}`
    : 'conectar um motor →';
  const agendamentos = schedulesInfo();
  const agendadasAtivas = Object.values(agendamentos).filter(a => a.ativo).length;
  const execucoesGravadas = flows.reduce((s, f) => s + listRuns(f.id, { limit: 20 }).length, 0);
  const runsPorFlow = new Map(flows.map(f => [f.id, ultimoRunStatus(f.id)]));
  const flowsComFalha = flows.filter(f => runsPorFlow.get(f.id)?.ok === false).length;
  const flowsNaoVerificados = flows.filter(f => !runsPorFlow.get(f.id)).length;
  const flowsEmAtencao = flowsComFalha + flowsNaoVerificados;
  const flowsSemFixture = flows.filter(f => !f.fixtures).length;
  const ultimosRuns = flows.map(f => ({ flow: f, run: runsPorFlow.get(f.id) }))
    .filter(x => x.run)
    .sort((a, b) => String(b.run.quando || '').localeCompare(String(a.run.quando || '')))
    .slice(0, 3);
  const proximaAcao = !flows.length ? 'Crie seu primeiro flow'
    : flowsComFalha ? `Revise ${flowsComFalha} flow${flowsComFalha === 1 ? '' : 's'} com falha`
    : flowsNaoVerificados ? `Valide ${flowsNaoVerificados} flow${flowsNaoVerificados === 1 ? '' : 's'} ainda não testado${flowsNaoVerificados === 1 ? '' : 's'}`
    : flowsSemFixture ? `Adicione fixtures a ${flowsSemFixture} flow${flowsSemFixture === 1 ? '' : 's'}`
    : 'Rode uma simulação antes do live';
  const proximaAcaoSub = !flows.length ? 'Descreva um objetivo em português e veja o grafo nascer.'
    : flowsComFalha ? 'O histórico preserva o caminho e o motivo de cada falha.'
    : flowsNaoVerificados ? 'O filtro de atenção reúne falhas e flows sem execução registrada.'
    : flowsSemFixture ? 'Fixtures tornam o teste reproduzível para o time inteiro.'
    : 'O motor simulado não dispara efeitos externos nem grava histórico.';
  const capabilityIndex = renderCapabilityIndex();
  const localeOptions = listLocales().map(item => `<option value="${esc(item.locale)}"${item.locale === i18n.locale ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
  const localCapabilities = NODE_DEFINITIONS.filter(definition => !definition.remote).length;
  const zeroCostCapabilities = NODE_DEFINITIONS.filter(definition => definition.costClass === 'free').length;
  const judgmentCapabilities = NODE_DEFINITIONS.filter(definition => String(definition.costClass).startsWith('jev')).length;
  const formatRunQuando = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
  };
  const cards = flows.map(f => {
    const run = runsPorFlow.get(f.id);
    const quando = run ? formatRunQuando(run.quando) : '';
    const st = !run ? '<span class="st stale"></span>não verificado'
      : run.ok ? `<span class="st ok"></span>saudável · ${esc(quando)}${run.ms ? ` · ${run.ms}ms` : ''}`
      : `<span class="st bad"></span>falhou · ${esc(quando)}${run.ms ? ` · ${run.ms}ms` : ''}`;
    const ag = agendamentos[f.id];
    const badgeAg = ag ? `<span class="badge-ag${ag.ativo ? '' : ' off'}" title="agendado no cron do Jev Flow">SCHED · ${esc(ag.schedule)}${ag.ativo ? '' : ' · pausado'}</span>` : '';
    const readonly = f.exemplo ? ' data-ro="1"' : '';
    const health = !run ? 'stale' : run.ok ? 'ok' : 'bad';
    const searchable = `${f.name} ${f.id} ${f.description || ''}`.toLowerCase();
    return `<div class="wf"${readonly} data-id="${esc(f.id)}" data-search="${esc(searchable)}" data-scheduled="${ag?.ativo ? '1' : '0'}" data-status="${health}">
      <a class="wf-open" href="/jev/flows/${esc(f.id)}/demo">
        <div class="wf-top"><div class="wf-ico"><img src="${esc(JEV_FLOW_MARK_DATA_URI)}" alt=""/></div>
          <div style="min-width:0"><div class="wf-name">${esc(f.name)} ${badgeAg}</div>
          <div class="wf-id">${esc(f.id)} · ${f.nos} nós · ${f.fields || 0} entradas${f.exemplo ? ' · exemplo somente leitura' : ''}</div></div>
          <div class="wf-go">→</div></div>
        <div class="wf-desc">${esc(f.description || '')}</div>
        <div class="wf-st">${st}</div>
        <div class="wf-metrics"><span>↳ ${f.nos} nós</span><span>⌁ ${f.fixtures || 0} fixtures</span><span>${health === 'ok' ? 'saudável' : health === 'bad' ? 'falhou' : 'não verificado'}</span></div>
      </a>
      <div class="wf-acts">
        <button class="b b-primary" data-act="run" title="abrir o modal de execução">▶ <span>executar</span></button>
        <button class="b b-secondary" data-act="fixtures" title="abrir a área de fixtures"><span>fixtures</span></button>
        <button class="b b-secondary" data-act="hist" title="ver histórico de execuções">⌁ <span>histórico</span></button>
        <details class="wf-more">
          <summary class="more-trigger" aria-label="Mais ações" title="mais ações">•••</summary>
          <div class="more-menu" role="menu">
            <button class="b" data-act="sched" title="agendar no cron do Jev Flow">agendar</button>
            <button class="b" data-act="duplicate" title="duplicar como novo flow">＋ duplicar</button>
            <button class="b" data-act="export" title="exportar JSON">⇧ exportar</button>
            <button class="b" data-act="edit" title="editar JSON">{ } editar</button>
            <button class="b danger" data-act="del" title="excluir"${f.exemplo ? ' disabled title="exemplo pronto é somente leitura"' : ''}>✖ excluir</button>
          </div>
        </details>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${esc(i18n.locale)}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Jev Flow · Jev Flow</title>
<style>
  :root { --bg:#0c0c11; --line:rgba(255,255,255,.10); --txt:#e7e7ef; --dim:#a0a0b8; --accent:#7c5cff; --accent2:#ff5c8a; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:'Segoe UI Variable','Segoe UI',system-ui,sans-serif; color:var(--txt); min-height:100vh;
    background: radial-gradient(1100px 500px at 85% -10%, rgba(124,92,255,.16), transparent 60%),
    radial-gradient(800px 400px at -5% 110%, rgba(255,92,138,.09), transparent 55%), var(--bg); padding: 0 0 60px; }
  header { height:58px; display:flex; align-items:center; gap:14px; padding:0 20px; position:sticky; top:0; z-index:10;
    background:rgba(12,12,17,.8); backdrop-filter:blur(14px); border-bottom:1px solid var(--line); }
  .logo { display:flex; align-items:center; gap:9px; font-weight:600; }
  .logo .mark { width:26px; height:26px; border-radius:8px; display:grid; place-items:center; font-size:14px;
    background:linear-gradient(135deg,var(--accent),var(--accent2)); box-shadow:0 4px 14px rgba(124,92,255,.45); }
  .crumb { color:var(--dim); font-size:12.5px; } .crumb a { color:var(--dim); text-decoration:none; } .crumb a:hover { color:var(--txt); }
  .sep { width:1px; height:22px; background:var(--line); }
  .pill { font-size:12.5px; padding:7px 16px; border-radius:999px; border:1px solid; cursor:pointer; transition:transform .15s; }
  .pill:hover { transform:translateY(-1px); }
  .pill.sim { color:#e3a008; border-color:rgba(227,160,8,.5); background:rgba(227,160,8,.08); }
  .pill.real { color:#2ecc71; border-color:rgba(46,204,113,.5); background:rgba(46,204,113,.08); }
  .pill.dim { color:#a0a0b8; border-color:rgba(255,255,255,.15); }
  .hero { padding:44px 24px 8px; max-width:1080px; margin:0 auto; display:flex; gap:20px; align-items:flex-end; flex-wrap:wrap; position:relative; z-index:1; }
  h1 { font-size:32px; font-weight:800; letter-spacing:-.6px;
    background:linear-gradient(92deg,#fff 20%,#c9b8ff 55%,#ffb3c9 90%);
    -webkit-background-clip:text; background-clip:text; color:transparent; }
  .hero p { color:#b8b8cc; font-size:14.5px; margin-top:10px; max-width:640px; line-height:1.65; }
  @keyframes surgir { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
  .hero > * { animation:surgir .5s ease both; }
  .hero > div:last-child { animation-delay:.08s; }
  button.criar { animation:surgir .5s .15s ease both; }
  button.criar { margin-left:auto; display:flex; align-items:center; gap:8px; border:0; cursor:pointer; font-weight:600; font-size:13px;
    padding:11px 20px; border-radius:10px; color:#fff; background:linear-gradient(135deg,var(--accent),var(--accent2));
    box-shadow:0 8px 22px rgba(124,92,255,.45); transition:transform .15s; }
  button.criar:hover { transform:translateY(-1px); }
  .grid { max-width:1080px; margin:26px auto 0; padding:0 24px; display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:14px; align-items:stretch; position:relative; z-index:1; }
  .grid > .wf { animation:surgir .55s ease both; }
  .grid > .wf:nth-child(1) { animation-delay:.05s; } .grid > .wf:nth-child(2) { animation-delay:.12s; }
  .grid > .wf:nth-child(3) { animation-delay:.19s; } .grid > .wf:nth-child(n+4) { animation-delay:.26s; }
  .orbs { position:fixed; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
  .orbs i { position:absolute; border-radius:50%; filter:blur(90px); opacity:.5; animation:flutuar 26s ease-in-out infinite; }
  .orbs i:nth-child(1) { width:420px; height:420px; left:-120px; top:12%; background:rgba(124,92,255,.22); }
  .orbs i:nth-child(2) { width:360px; height:360px; right:-90px; top:52%; background:rgba(255,92,138,.14); animation-delay:-9s; }
  .orbs i:nth-child(3) { width:300px; height:300px; left:38%; bottom:-120px; background:rgba(18,181,203,.12); animation-delay:-17s; }
  @keyframes flutuar { 0%,100% { transform:translate(0,0) scale(1); } 33% { transform:translate(60px,-40px) scale(1.08); } 66% { transform:translate(-40px,50px) scale(.94); } }
  .stats { max-width:1080px; margin:20px auto 0; padding:0 24px; display:flex; gap:14px; flex-wrap:wrap; position:relative; z-index:1;
    animation:surgir .5s .12s ease both; }
  .stat { border:1px solid rgba(255,255,255,.12); border-radius:14px; background:rgba(22,22,31,.75); backdrop-filter:blur(10px);
    padding:16px 22px; min-width:150px; flex:1; }
  .stat b { display:block; font-size:28px; letter-spacing:-.5px; font-variant-numeric:tabular-nums; color:#fff; }
  .stat span { color:#a0a0b8; font-size:12px; text-transform:uppercase; letter-spacing:.8px; margin-top:4px; display:block; }
  .stat.ok b { color:#3fb950; } .stat.warn b { color:#e3a008; }
  .wf { border:1px solid var(--line); border-radius:14px; background:rgba(22,22,31,.7); backdrop-filter:blur(10px);
    overflow:visible; position:relative; display:flex; flex-direction:column; transition:transform .15s, border-color .2s, box-shadow .2s; }
  .wf::before { content:''; position:absolute; inset:0 0 auto 0; height:2px; border-radius:14px 14px 0 0;
    background:linear-gradient(90deg, transparent, rgba(124,92,255,.55), rgba(255,92,138,.45), transparent);
    opacity:0; transition:opacity .25s; }
  .wf:hover { transform:translateY(-3px); border-color:rgba(124,92,255,.55); box-shadow:0 16px 40px rgba(0,0,0,.5), 0 0 0 3px rgba(124,92,255,.1); }
  .wf:hover::before { opacity:1; }
  .wf-open { display:block; flex:1; text-decoration:none; color:var(--txt); padding:18px 18px 12px; }
  .wf-top { display:flex; gap:12px; align-items:center; }
  .wf-ico { width:42px; height:42px; border-radius:12px; display:grid; place-items:center; font-size:19px; background:rgba(124,92,255,.18); flex:none; }
  .wf-name { font-weight:700; font-size:15px; color:#fff; }
  .wf-id { color:#a0a0b8; font-size:12px; margin-top:3px; }
  .badge-ag { font-size:10px; color:#7ee2a8; border:1px solid rgba(46,204,113,.4); background:rgba(46,204,113,.08);
    padding:2px 8px; border-radius:999px; margin-left:6px; vertical-align:1px; font-family:ui-monospace,monospace; }
  .badge-ag.off { color:#a0a0b8; border-color:rgba(255,255,255,.12); background:transparent; }
  .wf-go { margin-left:auto; color:var(--dim); font-size:18px; transition:transform .15s,color .15s; }
  .wf:hover .wf-go { transform:translateX(3px); color:var(--accent); }
  .wf-desc { color:#b8b8cc; font-size:13px; margin-top:12px; line-height:1.55; min-height:36px; }
  .wf-st { margin-top:10px; font-size:12px; color:#a0a0b8; display:flex; align-items:center; gap:6px; }
  .st { width:7px; height:7px; border-radius:50%; }
  .st.none { background:#3a3a46; } .st.stale { background:#fbbf24; } .st.ok { background:#2ecc71; } .st.bad { background:#ff5252; }
  .wf-acts { display:flex; gap:8px; margin-top:auto; padding:10px 16px 14px; border-top:1px solid var(--line); }
  .b { border:1px solid var(--line); background:rgba(255,255,255,.03); color:var(--txt); font-size:11.5px; padding:6px 11px;
    border-radius:8px; cursor:pointer; transition:border-color .15s; }
  .b:hover { border-color:rgba(124,92,255,.6); }
  .b.danger:hover { border-color:rgba(255,82,82,.7); color:#ff8a8a; }
  .b:disabled { opacity:.35; cursor:not-allowed; }
  .b[aria-busy="true"], .mbtn[aria-busy="true"] { cursor:wait; opacity:.78; }
  .catalog-feedback { max-width:1200px; margin:14px auto -8px; padding:11px 16px; display:flex; align-items:center; gap:9px;
    border:1px solid rgba(255,255,255,.13); border-radius:11px; background:rgba(255,255,255,.035); color:var(--dim);
    font-size:12px; position:relative; z-index:1; }
  .catalog-feedback[hidden] { display:none; }
  .catalog-feedback.loading { border-color:rgba(139,108,255,.45); background:rgba(139,108,255,.08); color:#d9d0ff; }
  .catalog-feedback.error { border-color:rgba(255,82,82,.45); background:rgba(255,82,82,.09); color:#ffb2b2; }
  .catalog-feedback .feedback-copy { flex:1; min-width:0; }
  .catalog-feedback .feedback-retry { flex:none; }
  .more-trigger { list-style:none; border:1px solid var(--line); background:rgba(255,255,255,.03); color:var(--txt); font-size:11.5px; padding:6px 10px;
    border-radius:8px; cursor:pointer; transition:border-color .15s,background .15s; user-select:none; }
  .more-trigger::-webkit-details-marker { display:none; }
  .more-trigger:hover,.wf-more[open] .more-trigger { border-color:rgba(124,92,255,.6); background:rgba(124,92,255,.1); }
  .wf-more { position:relative; margin-left:auto; }
  .more-menu { position:absolute; right:0; bottom:calc(100% + 8px); z-index:8; min-width:164px; display:grid; gap:4px; padding:6px;
    border:1px solid rgba(255,255,255,.13); border-radius:12px; background:rgba(21,21,30,.98); box-shadow:0 18px 38px rgba(0,0,0,.5); backdrop-filter:blur(16px); }
  .more-menu .b { width:100%; text-align:left; white-space:nowrap; }
  .filter-empty { grid-column:1/-1; display:none; border:1px dashed rgba(139,108,255,.42); border-radius:16px; padding:28px 20px; text-align:center; background:rgba(139,108,255,.045); color:var(--muted); }
  .filter-empty.on { display:block; }
  .filter-empty b { display:block; color:var(--ink); margin-bottom:6px; }
  .filter-empty button { margin-top:14px; }
  footer { max-width:1080px; margin:30px auto 0; padding:0 24px; color:var(--dim); font-size:11.5px; line-height:1.8; }
  code { color:#d2a8ff; background:rgba(255,255,255,.05); padding:1px 6px; border-radius:5px; }

  /* modais */
  .ov { position:fixed; inset:0; background:rgba(5,5,9,.7); backdrop-filter:blur(6px); display:none; place-items:center; z-index:50; padding:20px; }
  .ov.on { display:grid; }
  .modal { width:min(680px,100%); max-height:88vh; overflow:auto; background:#14141c; border:1px solid var(--line);
    border-radius:16px; padding:22px; box-shadow:0 30px 80px rgba(0,0,0,.6); }
  .modal h2 { font-size:16px; margin-bottom:4px; }
  .modal .sub { color:var(--dim); font-size:12px; margin-bottom:14px; }
  .modal label { font-size:11px; color:var(--dim); display:block; margin:12px 0 5px; text-transform:uppercase; letter-spacing:.5px; }
  textarea { width:100%; min-height:110px; background:#0c0c11; color:#d2a8ff; border:1px solid var(--line); border-radius:10px;
    padding:11px; font-family:ui-monospace,Consolas,monospace; font-size:12px; resize:vertical; }
  textarea.plano { color:var(--txt); font-family:inherit; font-size:13px; }
  .macts { display:flex; gap:10px; justify-content:flex-end; margin-top:16px; }
  .mbtn { border:0; cursor:pointer; font-weight:600; font-size:12.5px; padding:9px 16px; border-radius:9px; }
  .mbtn.p { color:#fff; background:linear-gradient(135deg,var(--accent),var(--accent2)); }
  .mbtn.g { background:rgba(255,255,255,.06); color:var(--txt); border:1px solid var(--line); }
  .mbtn.d { background:rgba(255,82,82,.15); color:#ff8a8a; border:1px solid rgba(255,82,82,.4); }
  .msg { margin-top:12px; font-size:12px; border-radius:9px; padding:10px 12px; display:none; }
  .msg.err { display:block; background:rgba(255,82,82,.1); border:1px solid rgba(255,82,82,.4); color:#ff8a8a; white-space:pre-wrap; }
  .msg.ok { display:block; background:rgba(46,204,113,.1); border:1px solid rgba(46,204,113,.4); color:#7ee2a8; }
  .res { margin-top:12px; font-size:11px; color:var(--dim); }
  .res pre { color:#d2a8ff; white-space:pre-wrap; word-break:break-all; }
  .spin { display:inline-block; width:13px; height:13px; border:2px solid rgba(255,255,255,.25); border-top-color:#fff;
    border-radius:50%; animation:girar .7s linear infinite; vertical-align:-2px; margin-right:6px; }
  @keyframes girar { to { transform:rotate(360deg); } }
  .presets { display:flex; gap:8px; flex-wrap:wrap; }
  .pre { border:1px solid var(--line); background:rgba(255,255,255,.03); color:var(--txt); font-size:11.5px;
    padding:7px 12px; border-radius:999px; cursor:pointer; }
  .pre:hover, .pre.on { border-color:rgba(124,92,255,.7); background:rgba(124,92,255,.12); }
  .hitem { display:flex; gap:10px; align-items:center; border:1px solid var(--line); border-radius:10px;
    padding:9px 12px; margin-bottom:8px; font-size:12px; }
  .hitem .d { color:var(--dim); font-size:10.5px; font-family:ui-monospace,monospace; }
  /* ── Jev Flow control-room pass ───────────────────────────── */
  :root { --ink:#f7f7fb; --muted:#9ea0b7; --panel:#15151e; --panel-2:#1b1b27; --violet:#8b6cff; --pink:#ff6d9d; --green:#4ade80; --amber:#fbbf24; }
  body { background:radial-gradient(900px 500px at 88% -12%,rgba(139,108,255,.2),transparent 62%),radial-gradient(720px 460px at -12% 86%,rgba(255,109,157,.1),transparent 62%),#0b0b10; }
  header { padding:0 max(20px,calc((100vw - 1200px)/2)); gap:12px; }
  .header-tools { display:flex; align-items:center; gap:8px; overflow:visible; padding:4px 0; scrollbar-width:none; }
  .header-tools::-webkit-scrollbar { display:none; }
  .tools-cluster { position:relative; flex:none; }
  .tools-trigger { display:flex; align-items:center; gap:7px; }
  .tools-trigger .chevron { color:#777a91; font-size:12px; transition:transform .15s; }
  .tools-cluster:has(.tools-popover.on) .chevron { transform:rotate(180deg); }
  .tools-popover { display:none; position:absolute; right:0; top:calc(100% + 10px); z-index:30; min-width:190px; padding:7px; gap:5px;
    border:1px solid rgba(255,255,255,.14); border-radius:13px; background:rgba(20,20,29,.97); box-shadow:0 20px 46px rgba(0,0,0,.55); backdrop-filter:blur(18px); }
  .tools-popover.on { display:grid; }
  .tools-popover .pill { width:100%; border-radius:9px; text-align:left; white-space:nowrap; }
  .tools-popover .pill:hover { transform:none; background:rgba(139,108,255,.1); border-color:rgba(139,108,255,.5); }
  .hero,.stats,.grid,footer,.flow-toolbar { max-width:1200px; }
  .hero { padding:56px 28px 4px; align-items:stretch; grid-template-columns:minmax(0,1fr) minmax(290px,390px); display:grid; }
  .hero-copy { min-width:0; }
  .eyebrow { color:#a99aff; font:700 10px ui-monospace,Consolas,monospace; letter-spacing:.16em; text-transform:uppercase; }
  .hero h1 { font-size:clamp(32px,4vw,48px); letter-spacing:-1.4px; margin-top:8px; }
  .hero p { max-width:720px; font-size:15px; color:#b9bbce; }
  .hero-actions { display:flex; gap:10px; align-items:center; margin-top:22px; flex-wrap:wrap; justify-content:flex-start; }
  .signal-card { min-height:190px; border:1px solid rgba(139,108,255,.28); border-radius:18px; padding:17px 18px; background:linear-gradient(145deg,rgba(139,108,255,.13),rgba(255,109,157,.045) 62%,rgba(20,20,29,.82)); box-shadow:0 18px 45px rgba(0,0,0,.24); }
  .signal-kicker { display:flex; align-items:center; gap:7px; color:#a99aff; font:700 9px ui-monospace,Consolas,monospace; letter-spacing:.14em; text-transform:uppercase; }
  .signal-dot { width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px rgba(74,222,128,.12); }
  .signal-dot.sim { background:var(--amber); box-shadow:0 0 0 4px rgba(251,191,36,.12); }
  .signal-mode { margin-left:auto; color:#b9bbce; letter-spacing:.08em; }
  .signal-card h3 { margin-top:17px; font-size:18px; letter-spacing:-.35px; color:#fff; }
  .signal-card p { margin-top:6px; color:#b8b9cb; font-size:11.5px; line-height:1.5; }
  .signal-meta { display:flex; gap:18px; margin-top:16px; padding-top:12px; border-top:1px solid rgba(255,255,255,.1); color:var(--muted); font-size:10.5px; }
  .signal-meta b { color:#fff; font-size:15px; margin-right:3px; }
  .signal-runs { display:grid; gap:6px; margin-top:13px; }
  .signal-run { display:flex; align-items:center; gap:7px; min-width:0; color:#c7c8d6; font-size:10.5px; }
  .signal-run .st { flex:none; } .signal-run-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .signal-run time { margin-left:auto; color:#85879b; font:10px ui-monospace,Consolas,monospace; white-space:nowrap; }
  .signal-empty { color:#85879b; font-size:10.5px; margin-top:3px; }
  button.criar,.action-soft { white-space:nowrap; }
  .action-soft { border:1px solid rgba(255,255,255,.13); background:rgba(255,255,255,.045); color:var(--txt); cursor:pointer; font:600 12px inherit; padding:10px 15px; border-radius:10px; }
  .action-soft:hover { border-color:rgba(139,108,255,.7); background:rgba(139,108,255,.1); }
  .jevificar-banner { max-width:1200px!important; }
  .jevificar-banner>div { border-color:rgba(139,108,255,.32)!important; background:linear-gradient(120deg,rgba(139,108,255,.14),rgba(255,109,157,.06)),rgba(20,20,29,.82)!important; }
  .stats { gap:12px; }
  .stat { min-width:0; padding:15px 18px; background:linear-gradient(145deg,rgba(27,27,39,.88),rgba(16,16,24,.82)); }
  .stat b { font-size:25px; }
  .flow-toolbar { margin:22px auto 0; padding:12px 28px; display:flex; align-items:flex-end; justify-content:space-between; gap:18px; position:sticky; top:58px; z-index:8; background:rgba(11,11,16,.92); backdrop-filter:blur(14px); border-bottom:1px solid rgba(255,255,255,.08); }
  .flow-toolbar h2 { font-size:19px; margin-top:6px; letter-spacing:-.3px; }
  .flow-toolbar-copy { min-width:0; }
  .flow-toolbar-copy>p { color:var(--dim); font-size:12px; margin-top:4px; }
  .flow-controls { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
  .flow-search { width:min(260px,42vw); min-width:180px; padding:10px 12px 10px 34px; border:1px solid rgba(255,255,255,.13); border-radius:10px; background:rgba(15,15,23,.82); color:var(--txt); font:12px inherit; outline:none; }
  .flow-search:focus { border-color:var(--violet); box-shadow:0 0 0 3px rgba(139,108,255,.16); }
  .search-wrap { position:relative; }
  .search-wrap:before { content:'⌕'; position:absolute; left:12px; top:7px; color:var(--dim); font-size:17px; pointer-events:none; }
  .filter-btn { border:1px solid rgba(255,255,255,.12); border-radius:999px; padding:8px 11px; background:rgba(255,255,255,.035); color:var(--dim); cursor:pointer; font:600 11px inherit; }
  .filter-btn:hover,.filter-btn.on { border-color:rgba(139,108,255,.65); color:#e9e5ff; background:rgba(139,108,255,.12); }
  .grid { margin-top:16px; padding:0 28px; grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr)); gap:16px; align-items:stretch; }
  .wf { background:linear-gradient(145deg,rgba(24,24,35,.9),rgba(14,14,22,.88)); border-radius:16px; }
  .wf-open { padding:20px 20px 14px; }
  .wf-ico { background:linear-gradient(135deg,rgba(139,108,255,.24),rgba(255,109,157,.18)); box-shadow:inset 0 1px 0 rgba(255,255,255,.07); }
  .wf-name { font-size:15.5px; }
  .wf-id { color:#8e90a6; }
  .wf-desc { min-height:52px; color:#c2c3d1; }
  .wf-metrics { display:flex; gap:7px; flex-wrap:wrap; margin-top:13px; }
  .wf-metrics span { border:1px solid rgba(255,255,255,.1); border-radius:999px; padding:4px 8px; color:#a8a9bc; font:10px ui-monospace,Consolas,monospace; background:rgba(255,255,255,.025); }
  .wf-acts { flex-wrap:wrap; align-items:center; padding:11px 16px 15px; gap:7px; background:rgba(0,0,0,.12); border-radius:0 0 16px 16px; }
  .b { padding:7px 10px; font-size:11px; }
  .b-primary { border-color:rgba(139,108,255,.48); background:rgba(139,108,255,.13); color:#efeaff; }
  .b-primary:hover { background:rgba(139,108,255,.24); }
  .b-secondary { color:#c8c9d7; background:rgba(255,255,255,.045); }
  .empty-state { grid-column:1/-1; border:1px dashed rgba(255,255,255,.16); border-radius:16px; padding:40px 20px; text-align:center; color:var(--dim); background:rgba(255,255,255,.02); }
  .empty-state b { display:block; color:var(--txt); font-size:16px; margin-bottom:6px; }
  .hidden-filter { display:none!important; }
  .mode-tabs { display:flex; gap:6px; margin:18px 0 14px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,.09); }
  .mode-tab { border:1px solid transparent; border-radius:8px; padding:8px 11px; background:transparent; color:var(--dim); cursor:pointer; font:600 11.5px inherit; }
  .mode-tab:hover,.mode-tab.on { color:var(--txt); border-color:rgba(139,108,255,.5); background:rgba(139,108,255,.12); }
  .create-panel { display:none; }
  .create-panel.on { display:block; }
  .template-row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin:9px 0 2px; color:var(--dim); font-size:10px; }
  .template-chip { border:1px solid rgba(255,255,255,.12); border-radius:999px; padding:5px 9px; background:rgba(255,255,255,.035); color:var(--txt); cursor:pointer; font-size:10px; }
  .template-chip:hover { border-color:rgba(139,108,255,.6); background:rgba(139,108,255,.1); }
  .natural-hint { display:flex; align-items:center; gap:8px; margin-top:12px; padding:10px 12px; border:1px solid rgba(74,222,128,.18); border-radius:9px; background:rgba(74,222,128,.055); color:#b9c8bf; font-size:11px; line-height:1.45; }
  .natural-hint .signal-dot { flex:none; width:6px; height:6px; background:var(--green); box-shadow:0 0 0 3px rgba(74,222,128,.1); }
  .advanced-create { margin-top:14px; border-top:1px solid rgba(255,255,255,.09); padding-top:11px; }
  .advanced-create summary { cursor:pointer; list-style:none; color:#a7a9bb; font-size:11px; font-weight:600; }
  .advanced-create summary::-webkit-details-marker { display:none; }
  .advanced-create summary:before { content:'＋'; display:inline-block; margin-right:6px; color:#a99aff; transition:transform .15s; }
  .advanced-create[open] summary:before { transform:rotate(45deg); }
  .provider-switch { display:flex; gap:6px; flex-wrap:wrap; margin:14px 0 10px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,.09); }
  .provider-tab { border:1px solid rgba(255,255,255,.12); border-radius:9px; padding:8px 11px; background:rgba(255,255,255,.035); color:#a7a9bb; cursor:pointer; font:600 11px inherit; }
  .provider-tab:hover,.provider-tab.on { border-color:rgba(139,108,255,.65); color:#efeaff; background:rgba(139,108,255,.12); }
  .provider-copy { color:#b8b9cb; font-size:11.5px; line-height:1.55; padding:10px 12px; border:1px solid rgba(139,108,255,.2); border-radius:9px; background:rgba(139,108,255,.055); }
  .provider-copy a { color:#cfc5ff; }
  .setup-steps { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:7px; margin:13px 0 10px; }
  .setup-steps>div { border:1px solid rgba(255,255,255,.1); border-radius:9px; padding:9px; background:rgba(255,255,255,.025); min-width:0; }
  .setup-steps b { display:block; color:#dcd8ff; font-size:10px; letter-spacing:.04em; }
  .setup-steps span { display:block; color:#a7a9bb; font-size:10px; line-height:1.35; min-height:28px; margin-top:5px; }
  .setup-steps code { display:block; margin-top:7px; color:#b8e6c9; font-size:9px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .setup-actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:11px 0; }
  .setup-status { min-height:28px; color:#a7a9bb; font-size:11px; line-height:1.45; }
  @media (max-width:700px) { .setup-steps { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  .json-tall { min-height:250px; }
  .field-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .field-grid label { margin-top:0; }
  .field-hint { margin-top:8px; color:var(--dim); font-size:11px; line-height:1.5; }
  .fixture-select { width:100%; background:#0c0c11; border:1px solid var(--line); color:var(--txt); border-radius:9px; padding:10px; font:12px inherit; }
  .check-row { display:flex!important; align-items:center; gap:8px; text-transform:none!important; letter-spacing:0!important; color:#c7c8d6!important; cursor:pointer; }
  .check-row input { accent-color:var(--violet); }
  .hitem { align-items:flex-start; }
  .hitem .hcopy { flex:1; min-width:0; }
  .hdetail { border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:var(--txt); border-radius:7px; padding:5px 8px; cursor:pointer; font-size:10px; white-space:nowrap; }
  .hdetail:hover { border-color:rgba(139,108,255,.6); }
  .hitem pre { margin:9px 0 0; padding:10px; border-radius:8px; background:#0b0b10; color:#d7d8e8; white-space:pre-wrap; max-height:220px; overflow:auto; font-size:10px; }
  .history-state { display:flex; align-items:center; gap:9px; border:1px dashed rgba(255,255,255,.14); border-radius:10px; padding:13px 14px; color:var(--dim); font-size:12px; }
  .history-state.error { border-color:rgba(255,82,82,.42); background:rgba(255,82,82,.07); color:#ffb2b2; }
  .history-state .feedback-copy { flex:1; min-width:0; }
  .pill { appearance:none; -webkit-appearance:none; white-space:nowrap; font:600 11px/1.1 inherit; background:rgba(255,255,255,.035); transition:transform .15s,border-color .15s,background .15s; }
  .pill.dim { color:#b8b8cc; border-color:rgba(255,255,255,.13); background:rgba(255,255,255,.035); }
  .pill.dim:hover { color:var(--txt); border-color:rgba(139,108,255,.65); background:rgba(139,108,255,.1); }
  .locale-picker { display:flex; align-items:center; gap:5px; color:#9ea0b7; font-size:11px; border:1px solid rgba(255,255,255,.13); background:rgba(255,255,255,.035); border-radius:999px; padding:5px 8px; }
  .locale-picker select { appearance:none; border:0; background:transparent; color:#d8d9e5; font:600 10.5px inherit; cursor:pointer; outline:none; }
  .locale-picker option { background:#14141c; color:#fff; }
  .pill.sim,.pill.real { font-size:11px; }
  :focus-visible { outline:2px solid var(--pink); outline-offset:3px; }
  @media (min-width:901px) {
    .hero { padding-top:24px; padding-bottom:0; }
    .hero h1 { font-size:clamp(30px,3.4vw,42px); }
    .hero p { margin-top:7px; font-size:14px; line-height:1.45; }
    .hero-actions { margin-top:14px; }
    .signal-card { min-height:0; padding:13px 15px; }
    .signal-card h3 { margin-top:11px; font-size:17px; }
    .signal-card p { margin-top:4px; line-height:1.4; }
    .signal-meta { margin-top:10px; padding-top:9px; }
    .signal-runs { gap:4px; margin-top:8px; }
    .stats { gap:10px; margin-top:12px; }
    .stat { padding:11px 16px; }
    .stat b { font-size:23px; }
    .flow-toolbar { margin-top:10px; padding-top:8px; padding-bottom:8px; }
    .flow-toolbar h2 { margin-top:4px; font-size:18px; }
    .flow-toolbar-copy>p { margin-top:2px; }
    .flow-search { padding-top:8px; padding-bottom:8px; }
    .filter-btn { padding-top:7px; padding-bottom:7px; }
    .grid { margin-top:8px; }
  }
  @media (min-width:901px) and (max-width:1280px) {
    .hero { padding-top:12px; padding-bottom:0; }
    .signal-card { padding:9px 13px; }
    .signal-card h3 { margin-top:7px; font-size:16px; }
    .signal-card p { margin-top:3px; line-height:1.35; }
    .signal-meta { margin-top:7px; padding-top:6px; }
    .signal-runs { gap:3px; margin-top:6px; }
    .stats { margin-top:8px; gap:8px; }
    .stat { padding:8px 12px; }
    .stat b { font-size:21px; }
    .flow-toolbar { margin-top:6px; padding-top:5px; padding-bottom:5px; gap:12px; }
    .flow-toolbar h2 { margin-top:2px; font-size:17px; }
    .flow-toolbar-copy>p { margin-top:1px; }
    .flow-search { padding-top:6px; padding-bottom:6px; min-width:170px; }
    .filter-btn { padding-top:5px; padding-bottom:5px; }
    .grid { margin-top:6px; gap:12px; }
    .wf-open { padding:12px 14px 7px; }
    .wf-ico { width:36px; height:36px; border-radius:10px; font-size:17px; }
    .wf-top { gap:9px; }
    .wf-name { font-size:14px; }
    .wf-id { font-size:11px; }
    .wf-desc { margin-top:7px; min-height:42px; line-height:1.4; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .wf-st { margin-top:6px; }
    .wf-metrics { margin-top:6px; gap:5px; }
    .wf-metrics span { padding:3px 6px; }
    .wf-acts { padding:6px 12px 7px; gap:5px; }
    .b { padding:5px 8px; font-size:10.5px; }
    .more-trigger { padding:5px 8px; }
  }
  @media (max-width:900px) { header { padding:10px 16px; height:auto; min-height:58px; flex-wrap:wrap; } header .header-tools { order:3; flex-basis:100%; overflow:visible; } .hero { padding-top:34px; grid-template-columns:1fr; } .signal-card { min-height:0; } .hero-actions { margin-left:0; width:100%; justify-content:flex-start; } .flow-toolbar { position:relative; top:auto; align-items:stretch; flex-direction:column; } .flow-controls { justify-content:flex-start; } .flow-search { width:min(100%,360px); } }
  @media (max-width:600px) {
    body { overflow-x:hidden; }
    header { display:grid; grid-template-columns:auto minmax(0,1fr); grid-template-areas:"logo title" "tools tools"; gap:8px 10px; min-width:0; overflow:visible; }
    header .logo { grid-area:logo; }
    header > b { grid-area:title; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; align-self:center; }
    header > .crumb, header > .sep, header > .header-spacer { display:none; }
    header .header-tools { grid-area:tools; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; width:100%; max-width:100%; min-width:0; padding:0; order:initial; flex-basis:auto; }
    header .header-tools #btnConn { grid-column:1/-1; }
    header .header-tools .pill, header .header-tools .tools-cluster, header .header-tools .tools-trigger { width:100%; min-width:0; }
    header .header-tools .pill { padding:7px 8px; font-size:10.5px; overflow:hidden; text-overflow:ellipsis; }
    header .header-tools .tools-trigger { justify-content:center; gap:3px; }
    header .header-tools .tools-trigger .chevron { flex:none; }
    .tools-popover { left:auto; right:0; max-width:calc(100vw - 32px); }
    .hero,.stats,.grid,.flow-toolbar,footer { padding-left:16px; padding-right:16px; }
    .hero h1 { font-size:34px; } .hero p { font-size:13px; }
    .stats { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
    .stat { min-width:0; } .stat b { font-size:22px; }
    .grid { grid-template-columns:1fr; }
    .wf-acts .b { flex:1 1 auto; } .wf-acts .wf-more { flex:0 0 auto; }
    .more-menu { right:0; }
    .jevificar-banner { padding-left:16px!important; padding-right:16px!important; }
    .jevificar-banner>div>div>div:nth-child(2) { min-width:0; }
    .modal { padding:18px; } .field-grid { grid-template-columns:1fr; }
  }
  /* ── Jev Flow Decision Studio · index precision pass ──────────── */
  @font-face { font-family:'Jev Flow Instrument'; src:url('/synap-instrument.woff2') format('woff2'); font-display:swap; }
  @font-face { font-family:'Jev Flow Editorial'; src:url('/synap-fraunces.woff2') format('woff2'); font-display:swap; }
  :root { --bg:#080d12; --surface:#101820; --line:rgba(218,229,238,.12); --line-strong:rgba(218,229,238,.22); --txt:#eef2ef; --dim:#93a1ad; --accent:#9a83ff; --accent2:#48c7da; --ok:#55c88a; --warn:#e3b45d; --err:#ef6c78; }
  body { font-family:'Jev Flow Instrument','Segoe UI Variable','Segoe UI',system-ui,sans-serif; color:var(--txt); background:var(--bg); }
  body:before { content:''; position:fixed; inset:0; pointer-events:none; opacity:.11; background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px); background-size:100% 8px; }
  header { height:66px; padding:0 max(20px,calc((100vw - 1240px)/2)); background:rgba(8,13,18,.96); border-bottom-color:var(--line-strong); backdrop-filter:blur(18px); }
  .logo { gap:10px; }.brand-mark { width:29px; height:29px; display:block; object-fit:contain; filter:drop-shadow(0 5px 12px rgba(94,97,255,.22)); }
  .brand-word { display:grid; line-height:1.05; }.brand-word b { font-size:12px; letter-spacing:.08em; text-transform:uppercase; }.brand-word small { margin-top:3px; color:var(--dim); font:8px ui-monospace,Consolas,monospace; letter-spacing:.16em; text-transform:uppercase; }
  .crumb { font:10px ui-monospace,Consolas,monospace; letter-spacing:.04em; }
  .header-tools .pill { min-height:32px; border-radius:6px; background:#111922; border-color:var(--line-strong); color:#9daab4; font:700 9px ui-monospace,Consolas,monospace; letter-spacing:.04em; text-transform:uppercase; }
  .header-tools .pill:hover { transform:none; background:#18232d; border-color:var(--accent); color:#f4f1ff; }.tools-popover { background:#0f171f; border-color:var(--line-strong); border-radius:8px; }
  .hero,.stats,.grid,.flow-toolbar,footer,.capability-index,.jevificar-banner { max-width:1240px; }
  .hero { padding:60px 28px 12px; grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr); gap:36px; align-items:start; }
  .eyebrow { color:var(--accent2); font:700 9px ui-monospace,Consolas,monospace; letter-spacing:.16em; }
  .hero h1 { margin-top:13px; color:#f3f4ef; background:none; font:600 clamp(44px,6vw,76px)/.96 'Jev Flow Editorial',Georgia,serif; letter-spacing:-.045em; }
  .hero p { margin-top:18px; max-width:700px; color:#aeb9c1; font-size:15px; line-height:1.6; }
  .hero-principles { display:flex; flex-wrap:wrap; gap:6px; margin-top:15px; }
  .hero-nav { display:flex; gap:8px; margin-top:14px; flex-wrap:wrap; }
  .hero-nav a { transition: border-color .2s, transform .15s; }
  .hero-nav a:hover { border-color: var(--accent) !important; transform: translateY(-1px); }.hero-principles span { padding:5px 7px; border:1px solid var(--line); border-radius:4px; color:#8696a1; font:8px ui-monospace,Consolas,monospace; letter-spacing:.05em; text-transform:uppercase; }
  button.criar,.mbtn.p { border:1px solid #947fff; border-radius:6px; background:#7864d8!important; box-shadow:none; }.action-soft { min-height:39px; border-radius:6px; background:#121b24; border-color:var(--line-strong); }
  .signal-card { min-height:224px; border-radius:9px; border-color:var(--line-strong); background:#101820; box-shadow:0 18px 48px rgba(0,0,0,.24); }.signal-card h3 { font:600 20px 'Jev Flow Editorial',Georgia,serif; }.signal-kicker,.signal-mode { color:#8f9da7; }
  .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); margin-top:22px; padding:0 28px; gap:1px; border:1px solid var(--line-strong); border-radius:8px; overflow:hidden; background:var(--line); }
  .stat { border:0; border-radius:0; background:#0e161e; backdrop-filter:none; padding:15px 17px; }.stat b { font-size:24px; color:#f0f2ee; }.stat span { color:#7f8e99; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.11em; }
  .capability-index { position:relative; z-index:1; scroll-margin-top:150px; margin:28px auto 0; padding:28px; border-top:1px solid var(--line-strong); border-bottom:1px solid var(--line-strong); }
  .capability-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:30px; align-items:end; }.capability-head h2 { margin-top:8px; color:#eff2ee; font:600 clamp(24px,3vw,38px) 'Jev Flow Editorial',Georgia,serif; letter-spacing:-.025em; }.capability-head p { max-width:700px; margin-top:9px; color:#98a6b0; font-size:12px; line-height:1.55; }
  .capability-totals { display:grid; grid-template-columns:repeat(2,minmax(96px,1fr)); gap:1px; border:1px solid var(--line); border-radius:7px; overflow:hidden; background:var(--line); }.capability-totals span { min-width:110px; padding:10px 11px; background:#0c141b; color:#778690; font:8px ui-monospace,Consolas,monospace; text-transform:uppercase; }.capability-totals b { display:block; margin-bottom:3px; color:#f1f3ef; font-size:16px; }
  .capability-controls { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-top:22px; padding:10px; border:1px solid var(--line); border-radius:7px; background:#0c141b; }.capability-controls label { position:relative; flex:1; max-width:520px; }.capability-controls label>span { position:absolute; left:10px; top:10px; color:#657580; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.09em; pointer-events:none; }.capability-controls input { width:100%; height:34px; padding:7px 10px 7px 126px; border:1px solid var(--line); border-radius:5px; background:#080f15; color:var(--txt); font:11px inherit; }
  .capability-filters { display:flex; gap:5px; }.capability-filters button { min-height:30px; padding:5px 9px; border:1px solid var(--line); border-radius:4px; background:transparent; color:#82919c; font:8px ui-monospace,Consolas,monospace; text-transform:uppercase; cursor:pointer; }.capability-filters button.on,.capability-filters button:hover { color:#f1edff; border-color:rgba(154,131,255,.52); background:rgba(154,131,255,.09); }
  .cap-groups { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-top:14px; }.cap-group { min-width:0; border:1px solid var(--line); border-radius:7px; background:#0d151c; overflow:hidden; }.cap-group[hidden],.cap-node[hidden] { display:none; }.cap-group-head { display:flex; gap:9px; align-items:flex-start; padding:12px 13px; border-bottom:1px solid var(--line); }.section-index { color:var(--accent2); font:700 9px ui-monospace,Consolas,monospace; }.cap-group-head h3 { color:#e9eeea; font-size:12px; }.cap-group-head p { margin-top:3px; color:#75848e; font:8px ui-monospace,Consolas,monospace; text-transform:uppercase; }
  .cap-list { padding:6px; }.cap-node { border-bottom:1px solid var(--line); }.cap-node:last-child { border-bottom:0; }.cap-node summary { display:flex; align-items:center; gap:9px; min-height:58px; padding:8px; cursor:pointer; list-style:none; }.cap-node summary::-webkit-details-marker { display:none; }.cap-node summary:hover { background:#121c25; }
  .cap-glyph { width:32px; height:32px; display:grid; place-items:center; flex:none; border:1px solid var(--line-strong); border-radius:5px; color:#f5f2ff; font:700 8.5px ui-monospace,Consolas,monospace; }.cap-glyph.judgment { border-color:rgba(154,131,255,.45); background:rgba(154,131,255,.1); }.cap-glyph.deterministic { border-color:rgba(87,201,155,.4); background:rgba(87,201,155,.09); }.cap-glyph.context { border-color:rgba(91,168,232,.4); background:rgba(91,168,232,.09); }.cap-glyph.logic { border-color:rgba(72,199,218,.48); background:rgba(72,199,218,.1); }.cap-glyph.control { border-color:rgba(215,169,92,.4); background:rgba(215,169,92,.09); }.cap-glyph.skill { border-color:rgba(240,141,99,.4); background:rgba(240,141,99,.09); }.cap-glyph.action { border-color:rgba(224,111,120,.4); background:rgba(224,111,120,.09); }
  .cap-title { min-width:0; flex:1; }.cap-title b { display:block; color:#e9eeea; font-size:10.5px; }.cap-title code { display:block; margin-top:3px; color:#73828d; background:none; padding:0; font-size:8px; }.cap-badges { display:flex; gap:4px; }.cap-badges i { padding:3px 4px; border:1px solid var(--line); border-radius:3px; color:#788791; font:normal 7px ui-monospace,Consolas,monospace; text-transform:uppercase; }.cap-open { color:#64737e; font-size:14px; }.cap-node[open] .cap-open { transform:rotate(45deg); }
  .cap-detail { padding:0 10px 12px 51px; }.cap-detail>p { color:#9aa8b2; font-size:9.5px; line-height:1.48; }.cap-description { color:#d1d8dc!important; margin-bottom:5px; }.contract-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-top:10px; }.contract-grid h4 { margin-bottom:5px; color:#6f7f89; font:700 7px ui-monospace,Consolas,monospace; letter-spacing:.1em; }.contract-grid ul { display:grid; gap:3px; list-style:none; padding:0; }.contract-grid li { padding:5px; border:1px solid var(--line); border-radius:4px; background:#091017; }.contract-grid li code { display:block; padding:0; background:none; color:#c1b4ff; font-size:7.5px; }.contract-grid li span { display:block; margin-top:2px; color:#8897a1; font-size:8px; line-height:1.35; }
  .cap-policy { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }.cap-policy span { padding:3px 4px; border:1px solid var(--line); border-radius:3px; color:#7f8e99; font:7px ui-monospace,Consolas,monospace; }.cap-fallback { margin-top:8px; padding:7px; border-left:2px solid var(--warn); background:rgba(227,180,93,.05); color:#929fa8; font-size:8.5px; line-height:1.4; }.cap-fallback b { display:block; margin-bottom:2px; color:#d8bd83; }.cap-detail pre { margin-top:8px; max-height:150px; overflow:auto; padding:7px; border:1px solid var(--line); border-radius:4px; background:#070d12; color:#aebac2; font-size:7.5px; white-space:pre-wrap; }.cap-empty { margin-top:12px; padding:20px; border:1px dashed var(--line-strong); border-radius:7px; color:var(--dim); text-align:center; font-size:11px; }
  .flow-toolbar { top:66px; margin-top:24px; padding:11px 28px; background:rgba(8,13,18,.96); border-bottom-color:var(--line-strong); }.flow-toolbar h2 { font:600 22px 'Jev Flow Editorial',Georgia,serif; }.grid { margin-top:12px; }.wf { border-radius:8px; background:#101820; backdrop-filter:none; box-shadow:none; }.wf:before { display:none; }.wf:hover { transform:translateY(-2px); border-color:rgba(154,131,255,.48); box-shadow:0 16px 36px rgba(0,0,0,.28); }.wf-ico { border-radius:6px; background:#131d27; box-shadow:none; border:1px solid var(--line); }.wf-ico img { width:25px; height:25px; object-fit:contain; }.wf-name { color:#edf1ed; }.wf-desc { color:#a4b0b8; }.wf-metrics span { border-radius:4px; background:#0c141b; }.wf-acts { border-radius:0 0 8px 8px; background:#0c141b; }.b,.more-trigger { border-radius:5px; background:#111a23; }
  .jevificar-banner { margin:18px auto 0; padding:0 28px; position:relative; z-index:1; }.discovery-card { width:100%; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:16px; padding:16px 18px; border:1px solid var(--line-strong); border-radius:8px; background:#0e171f; color:var(--txt); text-align:left; cursor:pointer; }.discovery-card:hover { border-color:rgba(154,131,255,.48); background:#121d26; }.discovery-index { color:var(--accent2); font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.09em; }.discovery-copy b { display:block; font-size:12px; }.discovery-copy small { display:block; margin-top:4px; color:#8f9da7; font-size:10px; line-height:1.4; }.discovery-arrow { color:var(--accent); }.modal { border-radius:9px; background:#0f171f; border-color:var(--line-strong); }textarea,.fixture-select { background:#080f15; border-radius:6px; }
  @media (min-width:901px) and (max-height:800px) { .hero { padding-top:24px; padding-bottom:0; }.stats { margin-top:12px; }.flow-toolbar { margin-top:10px; padding-top:0; padding-bottom:0; }.grid { margin-top:0; }.wf-open { padding:5px 16px 1px; }.wf-desc { min-height:22px; } }
  :focus-visible { outline:2px solid var(--accent2)!important; outline-offset:3px!important; }
  @media (max-width:960px) { .hero { grid-template-columns:1fr; }.capability-head { grid-template-columns:1fr; }.capability-totals { justify-self:stretch; }.cap-groups { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media (max-width:600px) { header { min-height:0; padding:10px 14px; }.brand-word small { display:none; }.hero,.grid,.flow-toolbar,footer,.capability-index,.jevificar-banner { padding-left:14px; padding-right:14px; }.hero { padding-top:36px; }.hero h1 { font-size:52px; }.stats { grid-template-columns:repeat(2,minmax(0,1fr)); margin-left:14px; margin-right:14px; padding:0; }.capability-index { padding-top:24px; padding-bottom:24px; }.capability-controls { align-items:stretch; flex-direction:column; }.capability-controls label { max-width:none; }.capability-filters { overflow-x:auto; }.cap-groups { grid-template-columns:1fr; }.cap-badges { display:none; }.cap-detail { padding-left:10px; }.contract-grid { grid-template-columns:1fr; }.discovery-card { grid-template-columns:1fr auto; }.discovery-index { grid-column:1/-1; } }
  @media (min-width:961px) and (max-height:950px) {
    .hero { padding-top:30px; padding-bottom:4px; gap:24px; }
    .hero h1 { margin-top:8px; font-size:56px; line-height:.95; }
    .hero p { margin-top:10px; font-size:13.5px; line-height:1.4; }
    .hero-principles { margin-top:8px; }.hero-actions { margin-top:12px; }
    .signal-card { min-height:0; padding:14px 15px; }.signal-card h3 { margin-top:9px; font-size:17px; }.signal-card p { margin-top:4px; line-height:1.35; }
    .signal-meta { margin-top:9px; padding-top:8px; }.signal-runs { margin-top:7px; }
    .stats { margin-top:12px; }.stat { padding:9px 13px; }.stat b { font-size:21px; }
    .flow-toolbar { margin-top:10px; padding-top:7px; padding-bottom:7px; }.flow-toolbar h2 { font-size:19px; }.flow-toolbar-copy>p { margin-top:2px; }
    .grid { margin-top:7px; }.wf-open { padding:13px 16px 8px; }.wf-name { margin-top:8px; }.wf-desc { min-height:38px; margin-top:7px; line-height:1.35; }
    .wf-metrics { margin-top:8px; }.wf-st { margin-top:6px; }.wf-acts { padding-top:8px; padding-bottom:9px; }
  }
  /* Janela desktop baixa: mantém o catálogo e a primeira ação na dobra sem
     alterar a densidade do mobile ou remover informação da superfície. */
  @media (min-width:1200px) and (max-height:960px) {
    .hero { padding-top:24px; padding-bottom:0; gap:22px; }
    .hero h1 { margin-top:6px; font-size:52px; }
    .hero p { margin-top:8px; line-height:1.35; }
    .hero-principles { margin-top:6px; }
    .signal-card { padding:11px 14px; }
    .signal-card h3 { margin-top:7px; font-size:16px; }
    .signal-card p { margin-top:3px; line-height:1.3; }
    .signal-meta { margin-top:7px; padding-top:6px; }
    .signal-runs { margin-top:5px; }
    .stats { margin-top:8px; }
    .stat { padding:7px 12px; }
    .stat b { font-size:20px; }
    .flow-toolbar { margin-top:7px; padding-top:5px; padding-bottom:5px; }
    .flow-toolbar h2 { font-size:18px; }
    .flow-toolbar-copy>p { margin-top:1px; }
  }
  @media (min-width:961px) and (max-height:760px) {
    .hero { padding-top:8px; padding-bottom:0; gap:14px; }
    .hero h1 { margin-top:3px; font-size:40px; line-height:.95; }
    .hero p { margin-top:5px; font-size:11.5px; line-height:1.28; }
    .hero-principles { margin-top:4px; gap:4px; }.hero-principles span { padding:2px 4px; font-size:7px; }
    .hero-actions { margin-top:6px; }.hero-actions .b { padding-top:6px; padding-bottom:6px; }
    .signal-card { min-height:0; padding:8px 10px; }
    .signal-card h3 { margin-top:4px; font-size:14px; }.signal-card p { margin-top:2px; font-size:10.5px; line-height:1.25; }
    .signal-meta { margin-top:4px; padding-top:4px; }.signal-runs { gap:2px; margin-top:3px; }
    .stats { margin-top:4px; }.stat { padding:5px 9px; }.stat b { font-size:17px; }.stat small { margin-top:1px; }
    .flow-toolbar { top:58px; margin-top:4px; padding-top:4px; padding-bottom:4px; }
    .flow-toolbar h2 { font-size:16px; }.flow-toolbar-copy>p { margin-top:0; }.flow-search { padding-top:5px; padding-bottom:5px; }.filter-btn { padding-top:4px; padding-bottom:4px; }
    .grid { margin-top:4px; gap:10px; }.wf-open { padding:8px 14px 5px; }.wf-ico { width:36px; height:36px; }.wf-name { margin-top:6px; }.wf-desc { min-height:28px; margin-top:4px; -webkit-line-clamp:2; line-height:1.25; }
    .wf-metrics { margin-top:5px; gap:4px; }.wf-metrics span { padding:3px 5px; }.wf-st { margin-top:4px; padding-top:4px; }.wf-acts { padding-top:5px; padding-bottom:6px; }
  }
  @media (prefers-reduced-motion:reduce) { *,*:before,*:after { animation-duration:.01ms!important; animation-iteration-count:1!important; scroll-behavior:auto!important; transition-duration:.01ms!important; } }
</style></head><body>
<header>
  <div class="logo"><img class="brand-mark" src="${esc(JEV_FLOW_MARK_DATA_URI)}" alt=""/><span class="brand-word"><b>Jev Flow</b><small>Decision Studio</small></span></div>
  <div class="crumb">/ <a href="/">dashboard</a> / jev flow</div>
  <div class="sep"></div>
  <b style="font-size:13.5px" data-i18n="flow">${esc(i18n.flow)}</b>
  <div class="header-spacer" style="flex:1"></div>
  <div class="header-tools">
    <button class="pill ${chave ? 'real' : 'sim'}" id="btnConn" style="cursor:pointer" title="conexão com um motor Jev">${esc(connectionLabel)}</button>
    <button class="pill dim" id="btnImport" style="cursor:pointer" title="importar um fluxo JSON" data-i18n="import">${esc(i18n.import)}</button>
    <button class="pill dim" id="btnExportAll" style="cursor:pointer" title="exportar o catálogo local" data-i18n="export">${esc(i18n.export)}</button>
    <div class="tools-cluster">
      <button class="pill dim tools-trigger" id="btnTools" aria-expanded="false" aria-controls="toolsPopover" title="abrir ferramentas do Jev Flow">⋯ <span data-i18n="tools">${esc(i18n.tools)}</span> <span class="chevron" aria-hidden="true">⌄</span></button>
      <div class="tools-popover" id="toolsPopover" role="menu" aria-label="Ferramentas do Jev Flow">
        <a class="pill dim" href="/jev/battle" title="comparar julgamentos reais">Battle Arena</a>
        <a class="pill dim" href="/jev/labs" title="testar decisões tipadas em cenários">Decision Labs</a>
        <button class="pill dim" id="btnRulesets" style="cursor:pointer" title="suas políticas indexadas com citação literal">políticas</button>
        <a class="pill dim" href="/jev/flows/compendium">Compendium</a>
      </div>
    </div>
    <button class="pill dim" id="btnTranslate" style="cursor:pointer" title="traduzir texto para português" data-i18n="translate">${esc(i18n.translate)}</button>
    <label class="locale-picker" title="${esc(i18n.languageLabel)}"><span aria-hidden="true">◎</span><select id="localePicker" aria-label="${esc(i18n.languageLabel)}">${localeOptions}</select></label>
  </div>
</header>
<div class="hero">
  <div class="hero-copy"><div class="eyebrow">DECISION SYSTEMS · FLOW + REASONING</div><h1>Jev Flow</h1>
  <p data-i18n="intro">Construa fluxos operacionais e grafos de raciocínio executáveis. Capacidades locais fazem o que é exato; Jev avalia o que é incerto; evidência, orçamento e revisão continuam visíveis do início ao fim.</p>
  <div class="hero-principles"><span>Fluxo · o que acontece</span><span>Raciocínio · por que concluiu</span><span>Auditoria · o que sustentou</span></div>
  <div class="hero-actions"><button class="action-soft" id="btnImportHero">⇩ importar JSON</button><button class="criar" id="btnCriar" data-i18n="create">${esc(i18n.create)}</button></div>
<div class="flow-toolbar">
  <div class="flow-toolbar-copy"><div class="eyebrow" data-i18n="operationalCatalog">${esc(i18n.operationalCatalog)}</div><h2 data-i18n="yourFlows">${esc(i18n.yourFlows)}</h2><p><span id="flowCount">${flows.length}</span> flows · filtre por nome, saúde ou agendamento</p></div>
  <div class="flow-controls"><div class="search-wrap"><input id="flowSearch" class="flow-search" type="search" placeholder="Buscar flow, id ou descrição" aria-label="Buscar flows"/></div><button class="filter-btn on" data-filter="all">todos</button><button class="filter-btn" data-filter="scheduled">agendados</button><button class="filter-btn" data-filter="attention">atenção</button></div>
</div>
<div class="catalog-feedback" id="catalogFeedback" role="status" aria-live="polite" aria-atomic="true" hidden></div>
<div class="grid" id="flowGrid">${cards || '<div class="empty-state"><b>Nenhum fluxo ainda</b><span>Comece descrevendo uma regra em português ou importe um flow JSON.</span></div>'}</div><div class="filter-empty" id="filterEmpty" hidden><b>Nenhum flow combina com este recorte</b><span>Tente outro termo ou limpe os filtros para voltar ao catálogo completo.</span><br/><button class="action-soft" id="clearFlowFilters">limpar filtros</button></div></div>
<div class="flow-discovery-banner" id="flowDiscoveryBanner">
  <button class="discovery-card" type="button" onclick="document.getElementById('btnRulesets').click()">
    <span class="discovery-index">FLOW / POLICY</span><span class="discovery-copy"><b>Index your own policies</b><small>Upload a policy file and create stable rule IDs. The flow cites literal source text, with exceptions marked for review.</small></span><span class="discovery-arrow">→</span>
  </button>
</div>
<section class="capability-index" id="capabilityIndex" aria-labelledby="capabilityTitle">
  <div class="capability-head"><div><div class="eyebrow">FLOW CAPABILITIES · ${esc(NODE_CATALOG_VERSION)}</div><h2 id="capabilityTitle">Tudo que o Jev Flow sabe orquestrar</h2><p>Cada bloco possui contrato, custo, risco, rede, cache, fallback e exemplo. Abra uma capacidade para ver exatamente o que entra e o que sai.</p></div>
    <div class="capability-totals"><span><b>${NODE_DEFINITIONS.length}</b> capacidades</span><span><b>${zeroCostCapabilities}</b> custo $0</span><span><b>${localCapabilities}</b> locais</span><span><b>${judgmentCapabilities}</b> Jev</span></div></div>
  <div class="capability-controls"><label for="capSearch"><span>BUSCAR CAPACIDADE</span><input id="capSearch" type="search" placeholder="fato, padrão, skill, evidência, orçamento…"/></label><div class="capability-filters" role="group" aria-label="Filtrar capacidades"><button class="on" data-cap-filter="all">todas</button><button data-cap-filter="free">$0</button><button data-cap-filter="jev">Jev</button><button data-cap-filter="local">sem rede</button></div></div>
  <div class="cap-groups" id="capGroups">${capabilityIndex}</div>
  <div class="cap-empty" id="capEmpty" hidden>Nenhuma capacidade combina com este recorte.</div>
</section>
<footer>
  Criar e testar pela UI acima · guia: <a href="https://github.com/daltonrpj/jev-flow/blob/main/docs/quickstart.md">quickstart</a> ·
  arquitetura: <a href="https://github.com/daltonrpj/jev-flow/blob/main/docs/architecture.md">como o Jev Flow funciona</a>
</footer>

<div class="ov" id="ovCriar"><div class="modal">
  <h2 data-i18n="create">${esc(i18n.create)}</h2>
  <div class="sub" data-i18n="createIntro">${esc(i18n.createIntro)}</div>
  <div class="mode-tabs" role="tablist" aria-label="Modo de criação"><button class="mode-tab on" data-create-mode="describe" role="tab" aria-selected="true" data-i18n="describe">${esc(i18n.describe)}</button><button class="mode-tab" data-create-mode="json" role="tab" aria-selected="false" data-i18n="buildJson">${esc(i18n.buildJson)}</button><button class="mode-tab" data-create-mode="import" role="tab" aria-selected="false" data-i18n="importMode">${esc(i18n.importMode)}</button></div>
  <div class="create-panel on" data-create-panel="describe">
    <label for="cIntent" data-i18n="naturalTitle">${esc(i18n.naturalTitle)}</label>
    <textarea id="cIntent" class="plano" placeholder="Ex.: reembolso integral em até 7 dias quando houver defeito — exceto pedidos acima de R$ 2.000, que vão para revisão antifraude; dúvida vira atendimento humano.&#10;&#10;Escreva a regra geral, as exceções ("exceto quando…") e o que fazer com casos ambíguos."></textarea>
    <div class="natural-hint"><span class="signal-dot"></span><span data-i18n="naturalHint">${esc(i18n.naturalHint)}</span></div>
    <div class="template-row"><span>Ou comece com uma intenção</span><button class="template-chip" data-template="ticket">triagem de mensagens</button><button class="template-chip" data-template="content">classificar conteúdo</button><button class="template-chip" data-template="gate">verificar evidência</button><button class="template-chip" data-template="rules">regra com exceções</button></div>
    <label for="cRuleset" style="margin-top:10px">Política indexada <span class="field-hint">opcional; o flow citará a regra literal deste ruleset</span></label>
    <select id="cRuleset" class="fixture-select"><option value="">nenhuma — regra descrita no texto</option></select>
    <details class="advanced-create"><summary data-i18n="advanced">${esc(i18n.advanced)}</summary>
      <div class="field-grid">
        <div><label for="cNome">Nome sugerido <span class="field-hint">se vazio, o Jev Flow cria</span></label><input id="cNome" placeholder="Triagem de mensagens"></div>
        <div><label for="cId">ID técnico <span class="field-hint">se vazio, o Jev Flow cria</span></label><input id="cId" placeholder="triagem-mensagens"></div>
      </div>
      <label for="cSchema">Campos de entrada conhecidos <span class="field-hint">opcional; descreva ou cole JSON</span></label>
      <textarea id="cSchema" placeholder='Ex.: mensagem (texto obrigatório), conta (texto opcional)'></textarea>
      <label for="cExemplos">Exemplos reais de entrada <span class="field-hint">opcional; você pode descrevê-los no texto principal</span></label>
      <textarea id="cExemplos" placeholder='Ex.: “Fui cobrado duas vezes hoje”, conta business'></textarea>
    </details>
  </div>
  <div class="create-panel" data-create-panel="json">
    <label for="cManual">Flow JSON</label>
    <textarea id="cManual" class="json-tall" placeholder='{"id":"meu-flow","name":"Meu flow","input_schema":{"texto":"string"},"start":"julgar","nodes":{}}'></textarea>
    <div class="field-hint">O JSON é validado e importado como um novo flow; o ID recebe um sufixo se já existir.</div>
  </div>
  <div class="create-panel" data-create-panel="import">
    <label for="cImport">Arquivo ou JSON exportado</label>
    <textarea id="cImport" class="json-tall" placeholder="Cole aqui um flow JSON exportado pelo Jev Flow ou selecione um arquivo."></textarea>
    <button class="action-soft" id="cPickFile" type="button">Escolher arquivo .json</button>
    <div class="field-hint">Importação não sobrescreve flows existentes; uma cópia nova é criada com slug seguro.</div>
  </div>
  <div class="msg" id="cMsg"></div>
  <div class="res" id="cRes"></div>
  <div class="macts">
    <button class="mbtn g" data-fechar>cancelar</button>
    <button class="mbtn p" id="cDesenhar" data-i18n="draw">${esc(i18n.draw)}</button>
    <button class="mbtn p" id="cSalvar" style="display:none">Salvar e abrir</button>
    <button class="mbtn p" id="cSalvarManual" style="display:none">Validar e importar</button>
    <button class="mbtn p" id="cImportar" style="display:none">Importar e abrir</button>
  </div>
</div></div>

<div class="ov" id="ovEdit"><div class="modal">
  <h2 id="eTitulo">{ } Editar flow</h2>
  <div class="sub">JSON do flow — o validador confere antes de salvar (alvos, ciclos, expressões).</div>
  <textarea id="eJson" style="min-height:280px"></textarea>
  <div class="msg" id="eMsg"></div>
  <div class="macts">
    <button class="mbtn g" data-fechar>cancelar</button>
    <button class="mbtn g" id="eUndo">↶ desfazer última</button>
    <button class="mbtn p" id="eSalvar">Salvar</button>
  </div>
</div></div>

<div class="ov" id="ovRun"><div class="modal">
  <h2 id="rTitulo">▶ Executar</h2>
  <div class="sub" id="rSub">Informe o input (campos do input_schema) e rode — execução real com a chave Jev, simulada e rotulada sem ela.</div>
  <label for="rFixture">Fixture salvo (opcional)</label>
  <select id="rFixture" class="fixture-select"><option value="">entrada manual</option></select>
  <label>Input (JSON)</label>
  <textarea id="rInput"></textarea>
  <label class="check-row"><input type="checkbox" id="rSimulado" checked/> simulação determinística · não dispara webhooks nem grava histórico</label>
  <div class="msg" id="rMsg" role="status" aria-live="polite" aria-atomic="true"></div>
  <div class="res" id="rRes"></div>
  <div class="macts">
    <button class="mbtn g" data-fechar>fechar</button>
    <button class="mbtn p" id="rGo">Rodar simulação</button>
  </div>
</div></div>

<div class="ov" id="ovDel"><div class="modal" style="width:min(440px,100%)">
  <h2>✖ Excluir flow</h2>
  <div class="sub" id="dSub"></div>
  <div class="macts" style="justify-content:flex-end">
    <button class="mbtn g" data-fechar>cancelar</button>
    <button class="mbtn d" id="dGo">Excluir</button>
  </div>
</div></div>

<div class="ov" id="ovSched"><div class="modal">
  <h2 id="scTitulo">Agendar</h2>
  <div class="sub">O flow passa a rodar sozinho pelo <b>cron do próprio Jev Flow</b> (kind <code>jev_flow</code>) — com watchdog de falhas e histórico.</div>
  <label>Periodicidade</label>
  <div class="presets">
    <button class="pre" data-s="interval:5m">a cada 5 min</button>
    <button class="pre" data-s="interval:10m">a cada 10 min</button>
    <button class="pre" data-s="interval:1h">a cada hora</button>
    <button class="pre" data-s="cron:0 9 * * *">diário 09:00</button>
  </div>
  <label>ou expressão customizada</label>
  <textarea id="scCron" placeholder="interval:30m · cron:*/10 * * * * · at:2026-12-25T09:00:00" style="min-height:44px"></textarea>
  <label>Input fixo do agendamento (JSON, opcional)</label>
  <textarea id="scInput" style="min-height:60px" placeholder='{"manchete":"[deixar vazio p/ usar o exemplo]"}'></textarea>
  <div class="msg" id="scMsg"></div>
  <div class="macts">
    <button class="mbtn g" id="scRemover">Remover agendamento</button>
    <button class="mbtn g" data-fechar>cancelar</button>
    <button class="mbtn p" id="scGo">Agendar</button>
  </div>
</div></div>

<div class="ov" id="ovHist"><div class="modal">
  <h2 id="hTitulo">Histórico</h2>
  <div class="sub">Execuções gravadas deste flow (o canvas sempre mostra a mais recente).</div>
  <div id="hLista" aria-live="polite" aria-atomic="true"><div class="history-state loading"><span class="spin"></span>carregando histórico…</div></div>
  <div class="macts"><button class="mbtn g" data-fechar>fechar</button></div>
</div></div>

<div class="ov" id="ovRulesets"><div class="modal" style="width:min(860px,100%);max-height:92vh">
  <h2>Suas políticas indexadas</h2>
  <div class="sub">Cada política ingerida vira um índice determinístico (R001…). O nó <code>rules.find</code> acha a regra aplicável e devolve o texto LITERAL do arquivo com fonte — linhas "Exceção:" entram marcadas e podem desviar o fluxo para revisão.</div>
  <div id="rsLista" style="max-height:34vh;overflow:auto;margin-bottom:14px"><div class="sub">carregando…</div></div>
  <label for="rsFile">Upload a policy file (.md, .txt, or .json; up to 100 KB)</label>
  <input id="rsFile" type="file" accept=".md,.txt,.json,text/plain,application/json">
  <div class="field-grid" style="margin-top:8px">
    <div><label for="rsId">ID do ruleset <span class="field-hint">slug, ex.: politica-reembolso</span></label><input id="rsId" placeholder="minha-politica"></div>
    <div><label for="rsNome">Nome <span class="field-hint">opcional</span></label><input id="rsNome" placeholder="Política de Reembolso"></div>
  </div>
  <div class="msg" id="rsMsg" role="status" aria-live="polite" aria-atomic="true"></div>
  <div class="res" id="rsRes"></div>
  <div class="macts">
    <button class="mbtn g" data-fechar>cancelar</button>
    <button class="mbtn p" id="rsGo">Indexar regras</button>
  </div>
</div></div>

<div class="ov" id="ovConn"><div class="modal" style="width:min(680px,100%)">
  <h2>Conectar um motor de julgamento</h2>
  <div class="sub">Escolha a origem. O Jev Flow valida o protocolo com uma pergunta mínima, mantém a chave apenas em memória e mostra a origem em cada execução.</div>
  <div class="provider-switch" role="tablist" aria-label="Origem do motor">
    <button class="provider-tab on" data-provider="typesafe" role="tab">TypeSafe remoto</button>
    <button class="provider-tab" data-provider="openjev" role="tab">OpenJev compatível</button>
    <button class="provider-tab" data-provider="laya" role="tab">Laya local</button>
  </div>
  <div class="provider-copy" data-provider-copy="typesafe">Use uma chave do console.typesafe.ai. A chamada é tipada e a chave só aparece mascarada no status.</div>
  <div class="provider-copy" data-provider-copy="openjev" hidden>OpenJev fala o mesmo <code>/v1/systemone</code>. Em <code>127.0.0.1</code> a chave é opcional; hosts remotos exigem autenticação. <a href="https://github.com/razorback16/openjev" target="_blank" rel="noreferrer">ver documentação</a></div>
  <div class="provider-copy" data-provider-copy="laya" hidden>O Laya é local e offline. O Jev Flow não instala nada sozinho: siga os passos abaixo, verifique o ambiente e aqueça o sidecar quando estiver pronto.</div>
  <div id="remoteFields">
    <label for="kKey">Chave da API <span class="field-hint">opcional apenas em OpenJev local</span></label>
    <textarea id="kKey" style="min-height:48px" placeholder="ts-… ou chave do seu endpoint compatível"></textarea>
    <div class="field-grid">
      <div><label for="kBase">Endpoint /v1</label><input id="kBase" placeholder="https://api.typesafe.ai/v1 ou http://127.0.0.1:8080/v1" /></div>
      <div><label for="kModel">Modelo <span class="field-hint">opcional</span></label><input id="kModel" placeholder="jev-latest / openjev-latest" /></div>
    </div>
  </div>
  <div id="layaSetup" hidden>
    <div class="setup-steps"><div><b>01 · Python</b><span>Python 3.11 + venv isolado</span><code>python --version</code></div><div><b>02 · Pacote</b><span>instale no venv ativo</span><code>python -m pip install laya</code></div><div><b>03 · Ambiente</b><span>ponte e modelo ficam explícitos</span><code>LAYA_LOCAL=auto</code></div><div><b>04 · Aquecer</b><span>carregue o modelo uma vez</span><code>python scripts/laya_bridge.py --warmup</code></div><div><b>05 · Qualidade</b><span>sem holdout compatível, qualidade fica não verificada</span><code>see Laya calibration docs</code></div></div>
    <div class="setup-actions"><button class="mbtn g" id="layaCheck">Verificar ambiente</button><button class="mbtn p" id="layaWarm">Aquecer Laya</button><a class="action-soft" href="/api/jev/docs/laya" target="_blank">guia completo</a></div>
    <div class="setup-status" id="layaStatus"></div>
  </div>
  <div class="msg" id="kMsg"></div>
  <div class="macts">
    <button class="mbtn g" data-fechar>cancelar</button>
    <button class="mbtn p" id="kGo">Testar e conectar</button>
  </div>
</div></div>

<div class="ov" id="ovTranslate"><div class="modal" style="width:min(760px,100%)">
  <h2 data-i18n="translate">${esc(i18n.translate)}</h2>
  <div class="sub">Cole uma descrição, instrução ou conteúdo de capacidade. Identificadores, URLs e blocos de código são preservados pelo tradutor do Jev Flow.</div>
  <label for="trFrom">Idioma de origem</label>
  <select id="trFrom" class="fixture-select"><option value="auto">detectar automaticamente</option><option value="en">English</option><option value="es">Español</option><option value="pt-BR">Português (Brasil)</option></select>
  <label for="trText">Texto</label><textarea id="trText" class="plano" style="min-height:160px" placeholder="Cole aqui o texto que deseja traduzir…"></textarea>
  <div class="msg" id="trMsg"></div><label for="trOut">Resultado</label><textarea id="trOut" class="plano" style="min-height:140px" readonly></textarea>
  <div class="macts"><button class="mbtn g" data-fechar>fechar</button><button class="mbtn p" id="trGo" data-i18n="translate">${esc(i18n.translate)}</button></div>
</div></div>

<input id="flowFileInput" type="file" accept="application/json,.json" hidden />
<script>
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var JEV_FLOW_I18N = ${serializeForInlineScript(i18n)};
  function applyLocalePack() {
    document.documentElement.lang = JEV_FLOW_I18N.locale || 'pt-BR';
    document.querySelectorAll('[data-i18n]').forEach(function (el) { var key = el.dataset.i18n; if (JEV_FLOW_I18N[key]) el.textContent = JEV_FLOW_I18N[key]; });
    var hint = document.querySelector('.natural-hint span:last-child'); if (hint && JEV_FLOW_I18N.naturalHint) hint.textContent = JEV_FLOW_I18N.naturalHint;
    var naturalLabel = document.querySelector('label[for="cIntent"]'); if (naturalLabel && JEV_FLOW_I18N.naturalTitle) naturalLabel.textContent = JEV_FLOW_I18N.naturalTitle;
    var advanced = document.querySelector('.advanced-create summary'); if (advanced && JEV_FLOW_I18N.advanced) advanced.textContent = JEV_FLOW_I18N.advanced;
    var draw = ov('cDesenhar'); if (draw && JEV_FLOW_I18N.draw) draw.textContent = JEV_FLOW_I18N.draw;
    var map = JEV_FLOW_I18N.staticCopy || {};
    if (Object.keys(map).length) {
      var blocked = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, INPUT: 1 };
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), textNodes = [], current;
      while ((current = walker.nextNode())) textNodes.push(current);
      textNodes.forEach(function (node) { if (blocked[node.parentElement && node.parentElement.tagName]) return; var raw = node.nodeValue || '', trimmed = raw.trim(); if (map[trimmed]) node.nodeValue = raw.replace(trimmed, map[trimmed]); });
      document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(function (el) { ['title', 'aria-label', 'placeholder'].forEach(function (attr) { var value = el.getAttribute(attr); if (value && map[value]) el.setAttribute(attr, map[value]); }); });
    }
  }
  function selectLocale(next) {
    var url = new URL(location.href); url.searchParams.set('lang', next); localStorage.setItem('jev-flow-locale', next); location.href = url.toString();
  }
  var chaveJev = ${JSON.stringify(chave)};
  var connInfo = ${serializeForInlineScript(conn)};
  function ov(id) { return document.getElementById(id); }
  if (ov('localePicker')) ov('localePicker').onchange = function () { selectLocale(this.value); };
  applyLocalePack();
  var activeCapabilityFilter = 'all';
  function refreshCapabilityIndex() {
    var query = String((ov('capSearch') && ov('capSearch').value) || '').trim().toLowerCase();
    var visible = 0;
    document.querySelectorAll('.cap-node').forEach(function (node) {
      var filterOk = activeCapabilityFilter === 'all'
        || (activeCapabilityFilter === 'free' && node.dataset.capCost === 'free')
        || (activeCapabilityFilter === 'jev' && String(node.dataset.capCost || '').indexOf('jev') === 0)
        || (activeCapabilityFilter === 'local' && node.dataset.capRemote === '0');
      var searchOk = !query || String(node.dataset.capSearch || '').indexOf(query) >= 0;
      node.hidden = !(filterOk && searchOk);
      if (!node.hidden) visible++;
    });
    document.querySelectorAll('.cap-group').forEach(function (group) {
      group.hidden = !Array.from(group.querySelectorAll('.cap-node')).some(function (node) { return !node.hidden; });
    });
    if (ov('capEmpty')) ov('capEmpty').hidden = visible !== 0;
  }
  if (ov('capSearch')) ov('capSearch').addEventListener('input', refreshCapabilityIndex);
  document.querySelectorAll('[data-cap-filter]').forEach(function (button) {
    button.onclick = function () {
      activeCapabilityFilter = button.dataset.capFilter;
      document.querySelectorAll('[data-cap-filter]').forEach(function (candidate) { candidate.classList.toggle('on', candidate === button); });
      refreshCapabilityIndex();
    };
  });
  var ultimoFoco = null;
  function fecharTudo() {
    document.querySelectorAll('.ov').forEach(function (o) { o.classList.remove('on'); });
    if (ultimoFoco && typeof ultimoFoco.focus === 'function') ultimoFoco.focus();
    ultimoFoco = null;
  }
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.onclick = fecharTudo; });
  document.querySelectorAll('.ov').forEach(function (o) { o.addEventListener('mousedown', function (e) { if (e.target === o) fecharTudo(); }); });
  var toolsPopover = null;
  var toolsTrigger = null;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (toolsPopover && toolsPopover.classList.contains('on')) { toolsPopover.classList.remove('on'); if (toolsTrigger) { toolsTrigger.setAttribute('aria-expanded', 'false'); toolsTrigger.focus(); } return; }
      fecharTudo(); return;
    }
    if (e.key !== 'Tab') return;
    var modal = document.querySelector('.ov.on .modal');
    if (!modal) return;
    var focusables = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')).filter(function (el) { return el.offsetParent !== null; });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.querySelectorAll('.modal').forEach(function (m) { m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); });
  function msg(el, txt, tipo) { el.className = 'msg ' + (tipo || 'err'); el.textContent = txt; }
  function apiMessage(body, fallback) {
    var validacao = body && body.validacao && Array.isArray(body.validacao.errors) ? body.validacao.errors : [];
    var detalhes = validacao.map(function (e) { return (e.codigo || 'erro') + ': ' + (e.msg || e.error || ''); }).filter(Boolean);
    var bruto = body && (body.userMessage || body.error || body.message || body.motivo);
    var texto = bruto ? String(bruto) : detalhes.join(' · ');
    if (!texto && fallback !== undefined) texto = fallback;
    return String(texto || 'resposta inesperada do servidor').replace(/\s+/g, ' ').trim();
  }
  function recoverableMessage(acao, source) {
    var detalhe = apiMessage(source, '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
    if (/^não foi possível\b/i.test(detalhe)) return detalhe + (/tente novamente$/i.test(detalhe) ? '.' : '. Tente novamente.');
    return 'não foi possível ' + acao + (detalhe ? ': ' + detalhe : '') + '. Tente novamente.';
  }

  async function api(path, opts) {
    try {
      var r = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts || {}));
      var j = null; try { j = await r.json(); } catch (e) {}
      return { status: r.status, body: j };
    } catch (e) {
      var erro = new Error('não foi possível conectar ao servidor. Tente novamente.');
      erro.cause = e;
      throw erro;
    }
  }

  toolsPopover = ov('toolsPopover'); toolsTrigger = ov('btnTools');
  function fecharFerramentas() { if (!toolsPopover) return; toolsPopover.classList.remove('on'); if (toolsTrigger) toolsTrigger.setAttribute('aria-expanded', 'false'); }
  toolsTrigger.onclick = function (e) { e.stopPropagation(); var aberto = !toolsPopover.classList.contains('on'); toolsPopover.classList.toggle('on', aberto); toolsTrigger.setAttribute('aria-expanded', aberto ? 'true' : 'false'); };
  document.addEventListener('click', function (e) { if (!e.target.closest('.tools-cluster') || e.target.closest('.tools-popover')) fecharFerramentas(); });

  // ── catálogo e criação ──────────────────────────────────
  var rascunho = null, rascunhoDraftId = null;
  var createMode = 'describe';
  var templates = {
    ticket: { intent: 'ao chegar um ticket, julgue área e urgência; billing urgente dispara webhook; técnico registra issue; resto vai para triagem humana', exemplos: '[{"mensagem":"Fui cobrado duas vezes hoje","conta":"business"}]' },
    content: { intent: 'classifique cada texto por relevância e risco; encaminhe somente itens relevantes para revisão humana e registre o restante', exemplos: '[{"texto":"Novo modelo de IA lançado","canal":"tech"}]' },
    gate: { intent: 'verifique se a alegação tem fonte suficiente e se a causa de decidir é compatível; sem evidência, bloqueie e registre o motivo', exemplos: '[{"alegacao":"tese citada","fonte":"trecho oficial"}]' },
    rules: { intent: 'política de reembolso: regra geral aprova estorno automático em até 7 dias por defeito comprovado e confiança alta; EXCETO pedidos acima de R$ 2.000 (revisão antifraude) e clientes com 3+ reembolsos em 30 dias (revisão manual); sem regra aplicável ou dúvida vai para humano — use o ruleset politica-reembolso com citação literal', exemplos: '[{"pedido":"produto chegou quebrado há 3 dias","valor":899.9,"canal":"site"}]' },
  };
  function setCreateMode(mode) {
    createMode = mode;
    document.querySelectorAll('[data-create-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.createMode === mode); b.setAttribute('aria-selected', b.dataset.createMode === mode ? 'true' : 'false'); });
    document.querySelectorAll('[data-create-panel]').forEach(function (p) { p.classList.toggle('on', p.dataset.createPanel === mode); });
    ov('cDesenhar').style.display = mode === 'describe' ? 'inline-block' : 'none';
    ov('cSalvar').style.display = mode === 'describe' && rascunho ? 'inline-block' : 'none';
    ov('cSalvarManual').style.display = mode === 'json' ? 'inline-block' : 'none';
    ov('cImportar').style.display = mode === 'import' ? 'inline-block' : 'none';
  }
  var rulesetsCreate = null;
  async function popularRulesetsCriacao() {
    try {
      var r = await api('/api/jev/rulesets');
      var lista = (r.body && r.body.rulesets) || [];
      rulesetsCreate = lista;
      var sel = ov('cRuleset');
      sel.innerHTML = '<option value="">nenhuma — regra descrita no texto</option>' +
        lista.map(function (rs) { return '<option value="' + esc(rs.id) + '">' + esc(rs.nome || rs.id) + ' · ' + rs.regras + ' regras' + (rs.exemplo ? ' (exemplo)' : '') + '</option>'; }).join('');
    } catch (e) { rulesetsCreate = null; }
  }
  function openCreate(mode) {
    ultimoFoco = document.activeElement;
    rascunho = null; rascunhoDraftId = null; ov('cMsg').className = 'msg'; ov('cRes').textContent = ''; ov('cIntent').value = ''; ov('cNome').value = ''; ov('cId').value = ''; ov('cSchema').value = ''; ov('cExemplos').value = '';
    ov('cManual').value = ''; ov('cImport').value = ''; setCreateMode(mode || 'describe'); ov('ovCriar').classList.add('on');
    if (ov('cRuleset')) { ov('cRuleset').value = ''; popularRulesetsCriacao(); }
    setTimeout(function(){ (mode === 'import' ? ov('cImport') : mode === 'json' ? ov('cManual') : ov('cIntent')).focus(); }, 50);
  }
  ov('btnCriar').onclick = function () { openCreate('describe'); };
  document.querySelectorAll('[data-create-mode]').forEach(function (b) { b.onclick = function () { setCreateMode(b.dataset.createMode); }; });
  document.querySelectorAll('[data-template]').forEach(function (b) { b.onclick = function () { var t = templates[b.dataset.template]; if (!t) return; setCreateMode('describe'); ov('cIntent').value = t.intent; ov('cExemplos').value = t.exemplos; ov('cIntent').focus(); }; });
  function downloadJson(filename, value) {
    var blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 800);
  }
  async function importFlowText(text) {
    var flow; try { flow = JSON.parse(text); } catch (e) { return msg(ov('cMsg'), 'JSON inválido: ' + e.message); }
    ov('cImportar').disabled = true; ov('cImportar').innerHTML = '<span class="spin"></span>validando…';
    try {
      var r = await api('/api/jev/flows/import', { method: 'POST', body: JSON.stringify({ flow: flow }) });
      if (r.status !== 201) throw new Error((r.body && (r.body.error || r.body.validacao?.errors?.map(function (e) { return e.msg; }).join('; '))) || 'importação recusada');
      location.href = '/jev/flows/' + r.body.flow.id + '/demo';
    } catch (e) { msg(ov('cMsg'), String(e.message)); }
    ov('cImportar').disabled = false; ov('cImportar').textContent = 'Importar e abrir';
  }
  ov('cPickFile').onclick = function () { ov('flowFileInput').click(); };
  ov('flowFileInput').onchange = function () { var file = ov('flowFileInput').files && ov('flowFileInput').files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function () { setCreateMode('import'); ov('cImport').value = reader.result; }; reader.readAsText(file); };
  ov('btnImport').onclick = function () { openCreate('import'); };
  ov('btnImportHero').onclick = function () { openCreate('import'); };
  ov('btnExportAll').onclick = async function () {
    try { var r = await api('/api/jev/flows'); downloadJson('jev-flow-catalog.json', { version: 1, exported_at: new Date().toISOString(), flows: r.body?.flows || [] }); }
    catch (e) { alert('falha ao exportar catálogo: ' + e.message); }
  };
  ov('cDesenhar').onclick = async function () {
    var intent = ov('cIntent').value.trim();
    if (!intent) return msg(ov('cMsg'), 'descreva o objetivo em linguagem natural');
    var exemplos = [];
    var pistasEntrada = [];
    var exemplosTexto = ov('cExemplos').value.trim();
    if (exemplosTexto) {
      try {
        var exemplosLidos = JSON.parse(exemplosTexto);
        exemplos = Array.isArray(exemplosLidos) ? exemplosLidos : [exemplosLidos];
      } catch (e) {
        exemplos = [{ descricao: exemplosTexto }];
      }
    }
    var input_schema = {};
    var schemaTexto = ov('cSchema').value.trim();
    if (schemaTexto) {
      try {
        var schemaLido = JSON.parse(schemaTexto);
        if (schemaLido && typeof schemaLido === 'object' && !Array.isArray(schemaLido)) input_schema = schemaLido;
        else pistasEntrada.push(schemaTexto);
      } catch (e) {
        pistasEntrada.push(schemaTexto);
      }
    }
    // política indexada escolhida: instrui o designer a usar rules.find com citação
    var rulesetId = ov('cRuleset') ? ov('cRuleset').value.trim() : '';
    if (rulesetId && intent.indexOf(rulesetId) === -1) {
      intent += '\\n\\nUse o ruleset "' + rulesetId + '" com o nó rules.find (ruleset + pergunta): a regra aplicável sai com citação literal do arquivo, veredicto e excecao; ramifique pelo veredicto e desvie exceções para revisão antes de qualquer ação.';
    }
    ov('cDesenhar').disabled = true;
    ov('cDesenhar').innerHTML = '<span class="spin"></span>desenhando com o Jev Flow…';
    msg(ov('cMsg'), ''); ov('cMsg').className = 'msg';
    try {
      var r = await api('/api/jev/flows/design', { method: 'POST', body: JSON.stringify({ intent: intent, exemplos: exemplos, metadata: { name: ov('cNome').value.trim(), id: ov('cId').value.trim(), input_schema: input_schema, input_hint: pistasEntrada.join('\\n') } }) });
      if (!r.body || !r.body.rascunho) throw new Error((r.body && r.body.error) || 'falha no design');
      rascunho = r.body.rascunho;
      rascunhoDraftId = r.body.draft_id || null;
      var v = r.body.validacao || {};
      if (v.ok) {
        msg(ov('cMsg'), '✔ rascunho válido: "' + rascunho.name + '" (' + Object.keys(rascunho.nodes).length + ' nós)', 'ok');
        ov('cSalvar').style.display = 'inline-block';
      } else {
        msg(ov('cMsg'), 'rascunho bloqueado pelo validador:\\n' + (v.errors || []).map(function (e) { return '· ' + e.codigo + ': ' + e.msg; }).join('\\n'));
        ov('cSalvar').style.display = 'none';
      }
      ov('cRes').innerHTML = '<pre>' + JSON.stringify(rascunho, null, 1).replace(/</g, '&lt;').slice(0, 2600) + (JSON.stringify(rascunho).length > 2600 ? '\\n…' : '') + '</pre>';
    } catch (e) { msg(ov('cMsg'), String(e.message)); }
    ov('cDesenhar').disabled = false; ov('cDesenhar').textContent = '✦ Desenhar com o Jev Flow';
  };
  ov('cSalvar').onclick = async function () {
    if (!rascunho) return;
    var r = await api('/api/jev/flows', { method: 'POST', body: JSON.stringify({ flow: rascunho, draft_id: rascunhoDraftId }) });
    if (r.status === 201) location.href = '/jev/flows/' + rascunho.id + '/demo';
    else msg(ov('cMsg'), 'não salvou: ' + JSON.stringify(r.body));
  };
  ov('cSalvarManual').onclick = function () { importFlowText(ov('cManual').value.trim()); };
  ov('cImportar').onclick = function () { importFlowText(ov('cImport').value.trim()); };
  var activeFilter = 'all';
  function refreshFlowFilters() {
    var query = (ov('flowSearch').value || '').trim().toLowerCase(); var visible = 0;
    var cardsNoGrid = document.querySelectorAll('#flowGrid .wf');
    cardsNoGrid.forEach(function (card) {
      var matchText = !query || (card.dataset.search || '').indexOf(query) >= 0;
      var matchFilter = activeFilter === 'all' || (activeFilter === 'scheduled' && card.dataset.scheduled === '1') || (activeFilter === 'attention' && (card.dataset.status === 'bad' || card.dataset.status === 'stale'));
      card.classList.toggle('hidden-filter', !(matchText && matchFilter)); if (matchText && matchFilter) visible++;
    });
    ov('flowCount').textContent = visible;
    var semResultado = cardsNoGrid.length > 0 && visible === 0;
    ov('filterEmpty').hidden = !semResultado;
    ov('filterEmpty').classList.toggle('on', semResultado);
  }
  ov('flowSearch').addEventListener('input', refreshFlowFilters);
  document.querySelectorAll('[data-filter]').forEach(function (b) { b.onclick = function () { activeFilter = b.dataset.filter; document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('on', x === b); }); refreshFlowFilters(); }; });
  ov('clearFlowFilters').onclick = function () { activeFilter = 'all'; ov('flowSearch').value = ''; document.querySelectorAll('[data-filter]').forEach(function (x) { x.classList.toggle('on', x.dataset.filter === 'all'); }); refreshFlowFilters(); ov('flowSearch').focus(); };

  // ── ações nos cards ──────────────────────────────────────
  var alvo = null;
  var catalogFeedback = ov('catalogFeedback');
  var catalogFlights = new Set();
  var historyFlights = new Set();
  var detailFlights = new Set();
  var actionNames = {
    duplicate: 'duplicar o flow', export: 'exportar o flow', edit: 'abrir a edição',
    fixtures: 'abrir a área de fixtures', run: 'abrir a execução', sched: 'carregar o agendamento', hist: 'carregar o histórico', del: 'abrir a exclusão',
  };
  var actionBusyLabels = {
    duplicate: 'duplicando…', export: 'preparando…', edit: 'carregando edição…',
    fixtures: 'abrindo fixtures…', run: 'carregando execução…', sched: 'carregando agendamento…', hist: 'carregando histórico…', del: 'abrindo…',
  };

  function clearCatalogFeedback() {
    if (!catalogFeedback) return;
    catalogFeedback.hidden = true;
    catalogFeedback.className = 'catalog-feedback';
    catalogFeedback.innerHTML = '';
    catalogFeedback.setAttribute('aria-busy', 'false');
  }
  function setCatalogFeedback(state, text, retry) {
    if (!catalogFeedback) return;
    catalogFeedback.hidden = false;
    catalogFeedback.className = 'catalog-feedback ' + state;
    catalogFeedback.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    var icon = state === 'loading' ? '<span class="spin"></span>' : '<span aria-hidden="true">⚠</span>';
    catalogFeedback.innerHTML = icon + '<span class="feedback-copy">' + esc(text) + '</span>';
    if (retry) {
      var retryButton = document.createElement('button');
      retryButton.className = 'b feedback-retry';
      retryButton.type = 'button';
      retryButton.textContent = 'tentar novamente';
      retryButton.onclick = function () {
        retryButton.disabled = true;
        retryButton.innerHTML = '<span class="spin"></span>tentando…';
        try { retry(); } catch (e) { setCatalogFeedback('error', recoverableMessage('repetir a ação', e), retry); }
      };
      catalogFeedback.appendChild(retryButton);
    }
  }
  async function withCatalogFlight(key, button, busyLabel, task) {
    if (catalogFlights.has(key)) return;
    catalogFlights.add(key);
    var idle = button ? button.innerHTML : '';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = '<span class="spin"></span>' + busyLabel;
    }
    try { return await task(); }
    finally {
      catalogFlights.delete(key);
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.innerHTML = idle;
      }
    }
  }
  function historicoAtual(flowId) {
    return ov('ovHist').classList.contains('on') && ov('ovHist').dataset.flow === flowId;
  }
  function renderHistoricoLoading(flowId) {
    if (historicoAtual(flowId)) ov('hLista').innerHTML = '<div class="history-state loading"><span class="spin"></span>carregando histórico…</div>';
  }
  function renderHistoricoError(flowId, error) {
    if (!historicoAtual(flowId)) return;
    ov('hLista').innerHTML = '<div class="history-state error"><span class="feedback-copy">' + esc(recoverableMessage('carregar o histórico', error)) + '</span>' +
      '<button class="b feedback-retry" type="button" data-history-retry="' + esc(flowId) + '">tentar novamente</button></div>';
  }
  async function carregarHistorico(flowId) {
    if (historyFlights.has(flowId)) return false;
    historyFlights.add(flowId);
    renderHistoricoLoading(flowId);
    try {
      var h = await api('/api/jev/flows/' + flowId + '/runs?limit=15');
      if (h.status !== 200) throw new Error(apiMessage(h.body, 'histórico indisponível'));
      var itens = (h.body && h.body.runs) || [];
      if (!historicoAtual(flowId)) return true;
      ov('hLista').innerHTML = itens.length ? itens.map(function (r) {
        var caminho = Array.isArray(r.path) ? r.path.join(' → ') : String(r.path || '');
        return '<div class="hitem"><span class="st ' + (r.ok ? 'ok' : 'bad') + '"></span>' +
          '<div class="hcopy"><b>' + (r.ok ? 'concluída' : 'com falha') + '</b> · ' + esc(r.passos) + ' passos · ' + esc(r.ms) + 'ms' +
          '<div class="d">' + esc(r.quando) + ' — ' + esc(caminho) + '</div><div class="run-detail"></div></div>' +
          '<button class="hdetail" type="button" aria-expanded="false" aria-label="ver detalhes da execução" data-run-file="' + esc(r.arquivo || '') + '">ver detalhes</button></div>';
      }).join('') : '<div class="sub">nenhuma execução gravada ainda — execute o flow ou agende uma execução.</div>';
      return true;
    } catch (e) {
      renderHistoricoError(flowId, e);
      return false;
    } finally { historyFlights.delete(flowId); }
  }
  ov('hLista').onclick = async function (e) {
    var retry = e.target.closest('[data-history-retry]');
    if (retry) { carregarHistorico(retry.dataset.historyRetry); return; }
    var btn = e.target.closest('[data-run-file]');
    if (!btn || btn.disabled) return;
    var row = btn.closest('.hitem'), box = row && row.querySelector('.run-detail');
    if (!row || !box) return;
    if (box.dataset.open === '1') {
      box.innerHTML = ''; box.dataset.open = '0';
      btn.innerHTML = 'ver detalhes'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'ver detalhes da execução');
      return;
    }
    var flowId = ov('ovHist').dataset.flow || alvo;
    var runFile = btn.dataset.runFile || '';
    var key = flowId + '::' + runFile;
    if (detailFlights.has(key)) return;
    detailFlights.add(key);
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-label', 'carregando detalhes da execução');
    btn.innerHTML = '<span class="spin"></span>carregando…';
    box.dataset.open = 'loading'; box.innerHTML = '<div class="history-state loading"><span class="spin"></span>carregando detalhes…</div>';
    try {
      var d = await api('/api/jev/flows/' + flowId + '/runs/' + encodeURIComponent(runFile));
      if (d.status !== 200) throw new Error(apiMessage(d.body, 'execução não encontrada'));
      if (!document.body.contains(row) || !historicoAtual(flowId)) return;
      box.dataset.open = '1'; box.innerHTML = '<pre>' + esc(JSON.stringify((d.body && d.body.run) || d.body || {}, null, 2)) + '</pre>';
      btn.innerHTML = 'ocultar detalhes'; btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-label', 'ocultar detalhes da execução');
    } catch (e) {
      if (!document.body.contains(row) || !historicoAtual(flowId)) return;
      box.dataset.open = '0'; box.innerHTML = '<div class="history-state error"><span class="feedback-copy">' + esc(recoverableMessage('carregar os detalhes', e)) + '</span></div>';
      btn.innerHTML = 'ver detalhes'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'tentar carregar os detalhes da execução');
    } finally {
      detailFlights.delete(key);
      if (document.body.contains(btn)) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
  };
  async function executarAcaoCatalogo(button, card, act) {
    alvo = card.dataset.id;
    ultimoFoco = document.activeElement;
    var menu = button.closest('.wf-more'); if (menu) menu.open = false;
    if (act !== 'hist') setCatalogFeedback('loading', actionBusyLabels[act] || 'carregando…');
    try {
      if (act === 'duplicate') {
        var copy = await api('/api/jev/flows/' + alvo + '/duplicate', { method: 'POST', body: JSON.stringify({}) });
        if (copy.status !== 201) throw new Error(apiMessage(copy.body, 'duplicação recusada'));
        clearCatalogFeedback(); location.href = '/jev/flows/' + copy.body.flow.id + '/demo';
      } else if (act === 'fixtures') {
        clearCatalogFeedback(); location.href = '/jev/flows/' + encodeURIComponent(alvo) + '/demo#fixtures';
      } else if (act === 'export') {
        clearCatalogFeedback(); location.href = '/api/jev/flows/' + alvo + '/export';
      } else if (act === 'edit') {
        if (card.dataset.ro === '1') { clearCatalogFeedback(); return alert('Este exemplo é somente leitura. Use “＋ duplicar” para criar uma cópia editável.'); }
        var r = await api('/api/jev/flows/' + alvo);
        if (r.status !== 200) throw new Error(apiMessage(r.body, 'flow não encontrado'));
        ov('eTitulo').textContent = '{ } Editar: ' + alvo;
        ov('eJson').value = JSON.stringify(r.body, null, 2);
        ov('eJson').dataset.original = ov('eJson').value;
        ov('eMsg').className = 'msg';
        ov('ovEdit').classList.add('on');
        clearCatalogFeedback();
      } else if (act === 'run') {
        var f = await api('/api/jev/flows/' + alvo);
        if (f.status !== 200) throw new Error(apiMessage(f.body, 'flow não encontrado'));
        var ex = {}; Object.keys((f.body && f.body.input_schema) || {}).forEach(function (k) { ex[k] = ''; });
        ov('rTitulo').textContent = '▶ Executar: ' + alvo;
        ov('ovRun').dataset.flow = alvo;
        var fixtures = Array.isArray(f.body.fixtures) ? f.body.fixtures : [];
        ov('rFixture').innerHTML = '<option value="">entrada manual</option>' + fixtures.map(function (x, i) { return '<option value="' + i + '">' + esc(x.name || x.id || ('fixture ' + (i + 1))) + '</option>'; }).join('');
        ov('rFixture').onchange = function () { var x = fixtures[Number(ov('rFixture').value)]; if (x) ov('rInput').value = JSON.stringify(x.input || {}, null, 2); };
        ov('rInput').value = JSON.stringify(fixtures[0]?.input || ex, null, 2); ov('rFixture').value = fixtures.length ? '0' : '';
        ov('rSimulado').checked = true; ov('rGo').textContent = 'Rodar simulação';
        ov('rMsg').className = 'msg'; ov('rRes').textContent = '';
        ov('ovRun').classList.add('on');
        clearCatalogFeedback();
      } else if (act === 'sched') {
        var ag = await api('/api/jev/schedules');
        if (ag.status !== 200) throw new Error(apiMessage(ag.body, 'agendamentos indisponíveis'));
        var meu = (ag.body && ag.body.agendamentos) || {};
        meu = meu[alvo];
        ov('scTitulo').textContent = 'Agendar: ' + alvo;
        ov('scCron').value = meu ? meu.schedule : '';
        ov('scInput').value = '';
        ov('scMsg').className = 'msg';
        document.querySelectorAll('.pre').forEach(function (p) { p.classList.toggle('on', p.dataset.s === (meu && meu.schedule)); });
        ov('ovSched').classList.add('on');
        clearCatalogFeedback();
      } else if (act === 'hist') {
        ov('hTitulo').textContent = 'Histórico: ' + alvo;
        ov('ovHist').dataset.flow = alvo;
        ov('ovHist').classList.add('on');
        await carregarHistorico(alvo);
      } else if (act === 'del') {
        ov('dSub').textContent = 'Excluir "' + alvo + '"? Runs e desenhos vão junto. Não dá para desfazer.';
        ov('ovDel').classList.add('on');
        clearCatalogFeedback();
      } else clearCatalogFeedback();
    } catch (e) {
      setCatalogFeedback('error', recoverableMessage(actionNames[act] || 'concluir a ação', e), function () { button.click(); });
    }
  }
  document.querySelectorAll('.wf-acts button.b').forEach(function (b) {
    b.onclick = function () {
      var card = b.closest('.wf');
      var act = b.dataset.act;
      return withCatalogFlight(card.dataset.id + ':' + act, b, actionBusyLabels[act] || 'carregando…', function () { return executarAcaoCatalogo(b, card, act); });
    };
  });
  ov('eSalvar').onclick = async function () {
    var flow; try { flow = JSON.parse(ov('eJson').value); } catch (e) { return msg(ov('eMsg'), 'JSON inválido: ' + e.message); }
    var r = await api('/api/jev/flows/' + alvo, { method: 'PUT', body: JSON.stringify({ flow: flow }) });
    if (r.status === 200) location.reload();
    else msg(ov('eMsg'), (r.body.validacao ? (r.body.validacao.errors || []).map(function (e) { return '· ' + e.codigo + ': ' + e.msg; }).join('\\n') : r.body.error));
  };
  ov('eUndo').onclick = function () {
    var original = ov('eJson').dataset.original;
    if (!original) return msg(ov('eMsg'), 'nenhuma versão original disponível');
    ov('eJson').value = original;
    msg(ov('eMsg'), 'restored the version opened in this editor; save to keep it', 'ok');
  };
  var runInFlight = false;
  ov('rGo').onclick = async function () {
    if (runInFlight) return;
    var input; try { input = JSON.parse(ov('rInput').value); } catch (e) { return msg(ov('rMsg'), 'input inválido: ' + e.message); }
    var simulate = ov('rSimulado').checked;
    var runFlowId = ov('ovRun').dataset.flow || alvo;
    var button = ov('rGo');
    runInFlight = true;
    button.disabled = true; button.setAttribute('aria-busy', 'true'); button.innerHTML = '<span class="spin"></span>executando…';
    try {
      var r = await api('/api/jev/flows/' + runFlowId + '/run', { method: 'POST', body: JSON.stringify({ input: input, mode: simulate ? 'simulate' : 'execute' }) });
      var b = r.body || {};
      if (r.status !== 200) throw new Error(apiMessage(b, 'execução recusada'));
      msg(ov('rMsg'), b.ok ? '✔ ' + (b.origem || 'execução concluída') : '✖ ' + (b.origem || 'execução com falha') + ' — revise os detalhes e tente novamente', b.ok ? 'ok' : 'err');
      ov('rRes').innerHTML = '<pre>' + JSON.stringify({ modo: b.simulado ? 'simulação' : 'execução', caminho: b.path, chamadas: b.chamadas || [], passos: (b.steps || []).map(function (s) { return { no: s.no, ok: s.ok, erro: s.erro, resumo: s.resumo }; }) }, null, 1).replace(/</g, '&lt;') + '</pre>';
    } catch (e) {
      msg(ov('rMsg'), recoverableMessage(simulate ? 'rodar a simulação' : 'executar o flow', e));
      ov('rRes').textContent = '';
    } finally {
      runInFlight = false;
      button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = ov('rSimulado').checked ? 'Rodar simulação' : 'Executar agora';
    }
  };
  ov('rSimulado').onchange = function () { if (!runInFlight) ov('rGo').textContent = ov('rSimulado').checked ? 'Rodar simulação' : 'Executar agora'; };
  // ── rulesets: políticas indexadas com citação literal ─────
  function rsLinha(r) {
    return '<div class="card on" style="margin-top:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<b style="font-size:13px">' + esc(r.nome || r.id) + '</b>' +
      '<span class="k">' + esc(r.id) + ' · ' + r.regras + ' regras' + (r.arquivos ? ' · ' + r.arquivos + ' arquivo(s)' : '') + (r.exemplo ? ' · exemplo 🔒' : '') + '</span>' +
      '<span style="flex:1"></span>' +
      '<button class="action-soft" data-rs-show="' + esc(r.id) + '">ver regras</button>' +
      '<button class="action-soft" data-rs-copy="' + esc(r.id) + '">copiar nó</button>' +
      '</div>';
  }
  async function rsCarregar() {
    try {
      var r = await api('/api/jev/rulesets');
      var lista = (r.body && r.body.rulesets) || [];
      ov('rsLista').innerHTML = lista.length
        ? lista.map(rsLinha).join('')
        : '<div class="sub">nenhuma política indexada ainda — comece pelo exemplo <b>politica-reembolso</b> (flow reembolso-loja) ou ingira a sua abaixo.</div>';
      document.querySelectorAll('[data-rs-show]').forEach(function (b) {
        b.onclick = async function () {
          try {
            var rr = await api('/api/jev/rulesets/' + encodeURIComponent(b.dataset.rsShow));
            if (rr.status !== 200) throw new Error(rr.body.error || 'falhou');
            var rs = rr.body;
            ov('rsRes').innerHTML = '<b>' + esc(rs.nome || rs.id) + '</b> <span class="k">' + rs.stats.regras + ' regras · ' + rs.stats.arquivos + ' arquivo(s)</span>' +
              rs.regras.map(function (rg) {
                return '<div class="card on" style="margin-top:6px"><b>' + esc(rg.id) + '</b>' +
                  (rg.excecao ? ' <span class="k">EXCEÇÃO</span>' : '') + (rg.secao ? ' <span class="k">[' + esc(rg.secao) + ']</span>' : '') +
                  '<div class="detalhe">' + esc(rg.texto) + (rg.fonte ? '<br><span class="k">' + esc(rg.fonte) + '</span>' : '') + '</div></div>';
              }).join('');
          } catch (e) { msg(ov('rsMsg'), String(e.message)); }
        };
      });
      document.querySelectorAll('[data-rs-copy]').forEach(function (b) {
        b.onclick = function () {
          var snippet = '{"type":"rules.find","ruleset":"' + b.dataset.rsCopy + '","pergunta":"{{input.caso}}"}';
          try { navigator.clipboard.writeText(snippet); msg(ov('rsMsg'), '✔ nó rules.find copiado — cole no editor JSON do flow', 'ok'); }
          catch (e) { ov('rsRes').innerHTML = '<div class="card on"><div class="detalhe">' + esc(snippet) + '</div></div>'; }
        };
      });
    } catch (e) { ov('rsLista').innerHTML = '<div class="sub">falha ao carregar: ' + esc(String(e.message)) + '</div>'; }
  }
  ov('btnRulesets').onclick = function () {
    ov('rsMsg').className = 'msg'; ov('rsRes').textContent = '';
    ov('rsFile').value = ''; ov('rsId').value = ''; ov('rsNome').value = '';
    ov('ovRulesets').classList.add('on');
    rsCarregar();
  };
  ov('rsGo').onclick = async function () {
    var file = ov('rsFile').files[0], id = ov('rsId').value.trim(), nome = ov('rsNome').value.trim();
    if (!file || !id) return msg(ov('rsMsg'), 'choose a policy file and enter its id');
    if (file.size > 100000) return msg(ov('rsMsg'), 'file exceeds the 100 KB limit');
    ov('rsGo').disabled = true; ov('rsGo').innerHTML = '<span class="spin"></span>indexando…';
    try {
      var r = await api('/api/jev/rulesets', { method: 'POST', body: JSON.stringify({ id: id, name: nome || undefined, filename: file.name, content: await file.text() }) });
      if (r.status !== 200 && r.status !== 201) throw new Error(r.body.error || 'falhou');
      var ruleset = r.body.ruleset || {}, s = ruleset.stats || {};
      msg(ov('rsMsg'), '✔ ' + s.regras + ' rules indexed — stable R001… IDs', 'ok');
      ov('rsRes').innerHTML = '<div class="card on ok"><b>' + esc(ruleset.nome || ruleset.id) + '</b><div class="detalhe">Use a rules.find node with ruleset "' + esc(ruleset.id) + '". Matched source text stays literal.</div></div>';
      rsCarregar();
    } catch (e) { msg(ov('rsMsg'), String(e.message)); }
    ov('rsGo').disabled = false; ov('rsGo').textContent = 'Indexar regras';
  };

  // ── conexão: TypeSafe, OpenJev compatível ou Laya local ──────
  var providerAtual = 'typesafe';
  function selecionarProvedor(provider) {
    providerAtual = provider;
    document.querySelectorAll('.provider-tab').forEach(function (tab) { tab.classList.toggle('on', tab.dataset.provider === provider); tab.setAttribute('aria-selected', tab.dataset.provider === provider ? 'true' : 'false'); });
    document.querySelectorAll('[data-provider-copy]').forEach(function (copy) { copy.hidden = copy.dataset.providerCopy !== provider; });
    ov('remoteFields').hidden = provider === 'laya';
    ov('layaSetup').hidden = provider !== 'laya';
    ov('kGo').hidden = provider === 'laya';
    if (provider === 'openjev') { ov('kBase').value = ov('kBase').value || 'http://127.0.0.1:8080/v1'; ov('kKey').placeholder = 'opcional em loopback'; ov('kGo').textContent = 'Testar OpenJev'; }
    else if (provider === 'typesafe') { ov('kKey').placeholder = 'ts-… (Bearer da API System One)'; ov('kGo').textContent = 'Testar TypeSafe'; }
  }
  document.querySelectorAll('.provider-tab').forEach(function (tab) { tab.onclick = function () { selecionarProvedor(tab.dataset.provider); }; });
  ov('btnConn').onclick = function () {
    ov('kMsg').className = 'msg'; ov('kKey').value = ''; ov('kBase').value = ''; ov('kModel').value = '';
    selecionarProvedor(connInfo.provedor === 'openjev-compatible' ? 'openjev' : 'typesafe');
    if (connInfo.conectado) msg(ov('kMsg'), 'já conectado (' + (connInfo.chave || 'loopback') + ' · ' + connInfo.modelo + ') — uma nova conexão substitui a atual', 'ok');
    ov('ovConn').classList.add('on');
    setTimeout(function () { ov(providerAtual === 'laya' ? 'layaCheck' : 'kKey').focus(); }, 50);
  };
  ov('kGo').onclick = async function () {
    var key = ov('kKey').value.trim();
    var apiBase = ov('kBase').value.trim() || undefined;
    var model = ov('kModel').value.trim() || undefined;
    if (providerAtual === 'typesafe' && !key) return msg(ov('kMsg'), 'cole a chave TypeSafe');
    if (providerAtual === 'openjev' && !key && !/^https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?(?:\\/|$)/i.test(apiBase || '')) return msg(ov('kMsg'), 'informe uma chave para um OpenJev remoto ou use 127.0.0.1');
    ov('kGo').disabled = true; ov('kGo').innerHTML = '<span class="spin"></span>validando protocolo…';
    try {
      var r = await api('/api/jev/connect', { method: 'POST', body: JSON.stringify({ key: key, apiBase: apiBase, model: model, provider: providerAtual, allowAnonymous: providerAtual === 'openjev' && !key }) });
      if (r.status !== 200) throw new Error(r.body.error || 'falha');
      msg(ov('kMsg'), '✔ ' + (providerAtual === 'openjev' ? 'OpenJev compatível' : 'TypeSafe') + ' conectado · ' + (r.body.modelo || model || '') + ' · ' + r.body.latencia_ms + 'ms · chave mantida apenas em memória até reiniciar o servidor — recarregando…', 'ok');
      setTimeout(function () { location.reload(); }, 1200);
    } catch (e) { msg(ov('kMsg'), String(e.message)); }
    ov('kGo').disabled = false; selecionarProvedor(providerAtual);
  };
  async function diagnosticoLaya(warmup) {
    var button = warmup ? ov('layaWarm') : ov('layaCheck');
    button.disabled = true; button.innerHTML = '<span class="spin"></span>' + (warmup ? 'aquecendo…' : 'verificando…');
    try {
      var r = await api('/api/jev/laya/' + (warmup ? 'warmup' : 'status'), { method: warmup ? 'POST' : 'GET', body: warmup ? JSON.stringify({}) : undefined });
      if (r.status !== 200) throw new Error(apiMessage(r.body, 'Laya indisponível'));
      var b = r.body || {}; ov('layaStatus').innerHTML = '<b>' + esc(b.estado || 'unknown') + '</b> · ' + esc(b.python || (b.python_configurado ? 'Python configurado' : 'Python não encontrado')) + ' · modelo ' + esc(b.modelo || '—') + (b.calibrado ? ' · calibrado' : ' · calibração pendente');
    } catch (e) { ov('layaStatus').textContent = String(e.message); }
    button.disabled = false; button.textContent = warmup ? 'Aquecer Laya' : 'Verificar ambiente';
  }
  ov('layaCheck').onclick = function () { diagnosticoLaya(false); };
  ov('layaWarm').onclick = function () { diagnosticoLaya(true); };

  // ── tradução assistida para português ─────────────────────
  ov('btnTranslate').onclick = function () { ov('trMsg').className = 'msg'; ov('trText').focus(); ov('ovTranslate').classList.add('on'); };
  ov('trGo').onclick = async function () {
    var text = ov('trText').value.trim(); if (!text) return msg(ov('trMsg'), 'cole um texto para traduzir');
    ov('trGo').disabled = true; ov('trGo').innerHTML = '<span class="spin"></span>traduzindo…';
    try { var r = await api('/api/translate', { method: 'POST', body: JSON.stringify({ text: text, from: ov('trFrom').value, to: 'pt-BR', preserve_formatting: true }) }); if (r.status !== 200) throw new Error(apiMessage(r.body, 'tradução indisponível')); ov('trOut').value = r.body.translation || r.body.text || r.body.content || ''; msg(ov('trMsg'), '✔ tradução concluída', 'ok'); }
    catch (e) { msg(ov('trMsg'), String(e.message)); }
    ov('trGo').disabled = false; ov('trGo').textContent = 'Traduzir para português';
  };
  document.querySelectorAll('.pre').forEach(function (p) {
    p.onclick = function () {
      document.querySelectorAll('.pre').forEach(function (x) { x.classList.remove('on'); });
      p.classList.add('on'); ov('scCron').value = p.dataset.s;
    };
  });
  ov('scGo').onclick = async function () {
    var schedule = ov('scCron').value.trim();
    if (!schedule) return msg(ov('scMsg'), 'escolha uma periodicidade');
    var input = null;
    if (ov('scInput').value.trim()) {
      try { input = JSON.parse(ov('scInput').value); } catch (e) { return msg(ov('scMsg'), 'input inválido: ' + e.message); }
    }
    ov('scGo').disabled = true; ov('scGo').innerHTML = '<span class="spin"></span>agendando…';
    try {
      var r = await api('/api/jev/flows/' + alvo + '/schedule', { method: 'POST', body: JSON.stringify({ schedule: schedule, input: input, ativo: true }) });
      if (r.status !== 200) throw new Error(r.body.error || 'falha');
      msg(ov('scMsg'), '✔ agendado no cron do Jev Flow: ' + r.body.task.schedule + ' — vai rodar sozinho; histórico disponível', 'ok');
      setTimeout(function () { location.reload(); }, 900);
    } catch (e) { msg(ov('scMsg'), String(e.message)); ov('scGo').disabled = false; ov('scGo').textContent = 'Agendar'; }
  };
  ov('scRemover').onclick = async function () {
    var r = await api('/api/jev/flows/' + alvo + '/schedule', { method: 'POST', body: JSON.stringify({ ativo: false }) });
    if (r.status === 200) { fecharTudo(); location.reload(); }
    else msg(ov('scMsg'), r.body.error || 'não havia agendamento');
  };
  ov('dGo').onclick = async function () {
    var r = await api('/api/jev/flows/' + alvo, { method: 'DELETE' });
    if (r.status === 200) location.reload();
    else { fecharTudo(); alert((r.body && r.body.error) || 'falha ao excluir'); }
  };
</script>
</body></html>`;
}
