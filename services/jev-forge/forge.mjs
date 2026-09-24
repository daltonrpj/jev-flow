// ============================================================================
// Jev Forge — o criador de Jevs do Jev Flow.
//
// Ciclo (herdado do Skill Forge: não passa no próprio teste, não entra):
//   design -> validate -> test -> publish -> invoke
//
//   design : LLM do próprio Jev Flow desenha um rascunho de jevlet usando o
//            knowledge.mjs como regra; a máquina valida (nunca confia).
//   validate: regras de design viram checagem mecânica (jevlet.mjs).
//   test   : bateria com casos negativos roda contra o Jev REAL (ou mock
//            injetado); pass_rate 100% exigido.
//   publish: só com validação limpa + testes aprovados -> catálogo em
//            data/jev/jevlets/ com version e knowledge version.
//   invoke : execução com política determinística em código.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JevClient, JEV_DATA_DIR } from '../jev/client.mjs';
import { judgmentCacheMetadata, withJudgmentCache } from '../jev/cache.mjs';
import { redactRemoteState } from '../jev/autonomy-policy.mjs';
import { KNOWLEDGE_VERSION, designGuidelinesMarkdown } from './knowledge.mjs';
import { validateJevlet, normalizeAnswers, applyPolicy, JevletError } from './jevlet.mjs';

export const FORGE_DIR = join(JEV_DATA_DIR, 'jevlets');
export const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'examples');
export const SHIP_PACK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'jev-ship', 'jevlets');

// ---------------------------------------------------------------------------
// design — o LLM desenha, o validador fiscaliza
// ---------------------------------------------------------------------------

const SPEC_SHAPE = `Formato EXATO do JSON de saída (sem texto fora do JSON):
{
  "id": "slug_minúsculo",
  "descricao": "o que este julgamento decide, em 1 frase",
  "categoria": "suporte|moderacao|pesquisa|roteramento|verificacao|outro",
  "state_schema": { "campo": "string — o que contém e quem fornece" },
  "questions": {
    "id_pergunta": { "type": "noul|choice|score", "instructions": "pergunta completinha referenciando \`campo\` entre crases", "criteria": {} }
  },
  "politica": {
    "regras": [ { "quando": "id_pergunta == 'opcao' && outra >= 0.7", "acao": "acao_em_codigo", "explica": "por quê" } ],
    "default": "acao_quando_nenhuma_regra_casa"
  },
  "tests": [
    { "nome": "caso típico", "state": { "campo": "..." }, "espera": { "id_pergunta": "opcao_ou_{min,max}" } },
    { "nome": "caso negativo — o que NÃO é", "tipo": "negativo", "state": {}, "espera": {} }
  ]
}
Regras de ouro: >= 2 testes com pelo menos 1 "tipo": "negativo"; toda pergunta
autorreferente e com um único julgamento; referências de campo entre crases
existem no state_schema; política compara apenas ids de perguntas.`;

/**
 * Desenha um rascunho de jevlet. `chatFn` injetável (tests); default usa o
 * próprio roteamento do Jev Flow via executeChat. Retorna { rascunho, validacao }.
 */
export async function designJevlet({ intent, exemplos = [], chatFn } = {}) {
  if (!intent || typeof intent !== 'string') throw new JevletError('descreva o julgamento que você quer (intent)', 'NO_INTENT');
  const fn = chatFn || defaultChatFn;

  const exemplosTxt = exemplos.length
    ? `\n## Exemplos de entrada (state real que o chamador vai mandar)\n${JSON.stringify(exemplos.slice(0, 8), null, 2)}`
    : '';

  const content = await fn({
    temperature: 0.3,
    maxTokens: 3000,
    messages: [
      {
        role: 'system',
        content: `${designGuidelinesMarkdown()}\n\n---\n${SPEC_SHAPE}\n\nVocê é o Jev Forge do Jev Flow. Responda APENAS com o JSON do jevlet, nada mais.`,
      },
      { role: 'user', content: `Julgamento desejado: ${intent}${exemplosTxt}` },
    ],
  });

  const rascunho = extractJson(content);
  if (!rascunho) throw new JevletError('LLM não devolveu JSON parseável — tente de novo ou refine o intent', 'NO_JSON');
  const validacao = validateJevlet(rascunho);
  return { rascunho, validacao, bruto: content };
}

function extractJson(text) {
  const s = String(text || '');
  const ini = s.indexOf('{');
  const fim = s.lastIndexOf('}');
  if (ini === -1 || fim <= ini) return null;
  try { return JSON.parse(s.slice(ini, fim + 1)); } catch { return null; }
}

/** Uses the project's explicitly configured OpenAI-compatible LLM endpoint. */
export async function defaultChatFn({ messages, temperature = 0.3, maxTokens = 3000 } = {}) {
  const { executeChat, resolveModel } = await import('../jev-flow/llm-gateway.mjs');
  const selected = resolveModel(process.env.JEVFLOW_LLM_MODEL || process.env.OPENAI_MODEL);
  if (!selected) throw new JevletError('configure JEVFLOW_LLM_API_KEY and JEVFLOW_LLM_MODEL at runtime to design Jevlets', 'NO_LLM');
  const result = await executeChat({ providerId: selected.providerId, modelId: selected.modelId, messages, temperature, maxTokens });
  return result?.content ?? result?.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// test — bateria contra o Jev real (client injetável p/ offline)
// ---------------------------------------------------------------------------

function checkEspera(espera, valores) {
  const falhas = [];
  for (const [qid, expect] of Object.entries(espera || {})) {
    const obtido = valores[qid];
    if (typeof expect === 'string') {
      if (obtido !== expect) falhas.push(`${qid}: esperado "${expect}", obtido "${obtido}"`);
    } else {
      const { min, max } = expect || {};
      if (min !== undefined && !(obtido >= min)) falhas.push(`${qid}: obtido ${obtido} < min ${min}`);
      if (max !== undefined && !(obtido <= max)) falhas.push(`${qid}: obtido ${obtido} > max ${max}`);
    }
  }
  return falhas;
}

function requireRemoteSafe(value, label) {
  const redaction = redactRemoteState(value);
  if (!redaction.remoteSafe) {
    const reason = redaction.tooLarge
      ? `${label} excede o limite remoto seguro`
      : `${label} ficou vazio, truncado ou inseguro após redação`;
    throw new JevletError(reason, 'REMOTE_STATE_UNSAFE');
  }
  return redaction;
}

/**
 * Roda a bateria de testes do jevlet. Retorna { aprovado, pass_rate, detalhes }.
 * aprovado exige 100% (regra do Skill Forge — sem 90% "quase").
 */
export async function testJevlet(jevlet, { client } = {}) {
  const jev = client || new JevClient({ timeoutMs: 6000 });
  const detalhes = [];

  for (const t of jevlet.tests || []) {
    try {
      const statePolicy = requireRemoteSafe(t.state, `teste ${t.nome || 'sem nome'}`);
      const questionsPolicy = requireRemoteSafe(jevlet.questions, 'questions do jevlet');
      const res = await jev.ask({
        state: statePolicy.state,
        questions: questionsPolicy.state,
        policyVersion: `jevlet-test/${jevlet.version || 1}`,
        schemaVersion: 'jevlet-test/1',
        evidenceHash: statePolicy.originalHash,
        systemId: jevlet.id,
        adapterVersion: 'jev-client-v1',
        purpose: `jevlet-test:${t.nome || 'unnamed'}`,
      });
      const valores = normalizeAnswers(res.answers);
      const falhas = checkEspera(t.espera, valores);
      detalhes.push({ nome: t.nome, tipo: t.tipo || 'positivo', ok: falhas.length === 0, falhas, obtido: valores,
        latencia_ms: res.latencyMs, custo_usd: res.costEstimateUsd ?? null, model: res.model || null });
    } catch (err) {
      detalhes.push({ nome: t.nome, tipo: t.tipo || 'positivo', ok: false, falhas: [`erro: ${err.message}`], obtido: null });
    }
  }

  const pass = detalhes.filter(d => d.ok).length;
  return {
    aprovado: detalhes.length > 0 && pass === detalhes.length,
    pass_rate: detalhes.length ? pass / detalhes.length : 0,
    total: detalhes.length,
    detalhes,
    knowledge_version: KNOWLEDGE_VERSION,
    executado_em: new Date().toISOString(),
    executionKind: client ? 'injected-test' : 'live',
  };
}

// ---------------------------------------------------------------------------
// publish / list / invoke — catálogo em data/jev/jevlets/
// ---------------------------------------------------------------------------

export function jevletPath(id, { dir = FORGE_DIR } = {}) {
  return join(dir, id, 'jevlet.json');
}

export function loadJevlet(idOrPath, { dir = FORGE_DIR } = {}) {
  const caminhos = idOrPath.endsWith('.json') ? [idOrPath] : [jevletPath(idOrPath, { dir }),
    join(EXAMPLES_DIR, `${idOrPath}.jevlet.json`), join(SHIP_PACK_DIR, `${idOrPath}.jevlet.json`)];
  for (const c of caminhos) {
    try { return JSON.parse(readFileSync(c, 'utf8')); } catch { /* tenta o próximo */ }
  }
  throw new JevletError(`jevlet não encontrado: ${idOrPath} (nem no catálogo ${dir} nem em examples/)`, 'NOT_FOUND');
}

/**
 * Publica no catálogo. Exige: validação sem erros + teste aprovado (o teste
 * é passado por quem chamou — normalmente recém-executado com client real).
 * Re-publicação versiona: perguntas iguais renovam o registro (mesma
 * version); perguntas diferentes bumpam version e preservam o histórico.
 */
export function registerJevlet(jevlet, { teste, dir = FORGE_DIR } = {}) {
  const validacao = validateJevlet(jevlet);
  if (!validacao.ok) {
    return { publicado: false, motivo: 'validação com erros', validacao };
  }
  if (!teste?.aprovado) {
    return { publicado: false, motivo: 'bateria de testes não aprovada (100% exigido)', validacao, teste };
  }

  // Versão: compara as perguntas (o julgamento em si) com o registro anterior
  let anterior = null;
  try { anterior = JSON.parse(readFileSync(jevletPath(jevlet.id, { dir }), 'utf8')); } catch { /* primeira publicação */ }
  const mudouJulgamento = anterior && JSON.stringify(anterior.questions) !== JSON.stringify(jevlet.questions);
  const version = anterior
    ? (mudouJulgamento ? (anterior.version || 1) + 1 : (anterior.version || 1))
    : (jevlet.version || 1);
  const historico = [
    ...((anterior && anterior.historico) || []),
    ...(anterior ? [{
      version: anterior.version || 1,
      registrado_em: anterior.registrado_em,
      pass_rate: anterior.resultado_teste?.pass_rate ?? null,
      knowledge_version: anterior.knowledge_version || null,
      mudou_julgamento: Boolean(mudouJulgamento),
    }] : []),
  ].slice(-20); // histórico compacto: as 20 gerações passadas bastam

  const registro = {
    ...jevlet,
    version,
    historico,
    knowledge_version: KNOWLEDGE_VERSION,
    registrado_em: new Date().toISOString(),
    resultado_teste: { aprovado: teste.aprovado, pass_rate: teste.pass_rate, total: teste.total,
      executado_em: teste.executado_em, executionKind: teste.executionKind || 'unknown' },
  };
  const path = jevletPath(jevlet.id, { dir });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(registro, null, 2));

  // índice do catálogo
  const indexPath = join(dir, '_index.json');
  let index = { jevlets: [] };
  try { index = JSON.parse(readFileSync(indexPath, 'utf8')); } catch { /* primeiro */ }
  const entrada = { id: registro.id, version: registro.version || 1, descricao: registro.descricao,
    categoria: registro.categoria || 'outro', pass_rate: teste.pass_rate,
    executionKind: teste.executionKind || 'unknown', knowledge_version: registro.knowledge_version,
    atualizado: registro.registrado_em };
  index.jevlets = index.jevlets.filter(e => e.id !== registro.id).concat(entrada).sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  return { publicado: true, path, validacao, entrada };
}

export function listJevlets({ dir = FORGE_DIR } = {}) {
  const comDrift = (e) => (e.knowledge_version && e.knowledge_version !== KNOWLEDGE_VERSION)
    ? { ...e, conhecimento_desatualizado: true }
    : e;
  const indexPath = join(dir, '_index.json');
  if (existsSync(indexPath)) {
    try { return (JSON.parse(readFileSync(indexPath, 'utf8')).jevlets || []).map(comDrift); } catch { /* reconstroi abaixo */ }
  }
  const lista = [];
  if (existsSync(dir)) {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      try {
        const j = JSON.parse(readFileSync(join(dir, d.name, 'jevlet.json'), 'utf8'));
        lista.push({ id: j.id, version: j.version || 1, descricao: j.descricao, categoria: j.categoria || 'outro', pass_rate: j.resultado_teste?.pass_rate ?? null, atualizado: j.registrado_em || null, conhecimento_desatualizado: j.knowledge_version !== KNOWLEDGE_VERSION });
      } catch { /* entrada corrompida fica fora da listagem */ }
    }
  }
  return lista;
}

/**
 * Executa um jevlet publicado: valida state contra o schema, pergunta ao Jev,
 * normaliza e aplica a política determinística. Retorna o pacote completo
 * (respostas cruas + valores + ação da política + custo).
 *
 * Refinamentos: cache de julgamento (mesmo state+perguntas dentro do TTL não
 * paga API de novo) e aviso de drift quando o conhecimento que embasou o
 * jevlet não é o corrente (lição do janus check: base que mudou invalida a
 * medição antiga — re-teste antes de confiar).
 */
export async function invokeJevlet(idOrPath, state, {
  client, dir = FORGE_DIR, useCache = true, cachePath, ttlMs, requestMeta = {},
} = {}) {
  const jevlet = loadJevlet(idOrPath, { dir });

  const faltando = Object.keys(jevlet.state_schema || {}).filter(f => !(f in (state || {})));
  if (faltando.length) {
    throw new JevletError(`state incompleto — faltam: ${faltando.join(', ')}`, 'STATE_INCOMPLETO');
  }

  const bruto = client || new JevClient({ timeoutMs: 6000 });
  const jev = useCache
    ? withJudgmentCache(bruto, { ...(cachePath ? { path: cachePath } : {}), ...(ttlMs ? { ttlMs } : {}) })
    : bruto;
  const statePolicy = requireRemoteSafe(state, 'state do jevlet');
  const questionsPolicy = requireRemoteSafe(jevlet.questions, 'questions do jevlet');
  const safeRequestMeta = {
    policyVersion: `jevlet/${jevlet.version || 1}`,
    schemaVersion: 'jevlet-invoke/1',
    evidenceHash: statePolicy.originalHash,
    systemId: jevlet.id,
    adapterVersion: 'jev-client-v1',
    purpose: `jevlet:${jevlet.id}`,
    ...requestMeta,
  };
  // Metadados são extensíveis, mas nunca podem sobrescrever o state/perguntas
  // já validados pelo chamador e pelo jevlet publicado.
  const res = await jev.ask({ ...safeRequestMeta, state: statePolicy.state, questions: questionsPolicy.state });
  if (useCache && typeof jev.flush === 'function') jev.flush();
  const cacheMeta = judgmentCacheMetadata(res);

  // Limiares calibrados: abaixo do limiar a pergunta fica INDECISA — vira
  // abstenção, não chute. Regras de política que dependem de indeciso são
  // puladas; se nenhuma casar, default + escala (calibração executada).
  const limiares = jevlet.limiares || {};
  const porPergunta = {};
  const valores = {};
  let indecisos = 0;
  for (const [qid, answer] of Object.entries(res.answers || {})) {
    if (!answer) continue;
    const lim = limiares[qid];
    let decisivo = true;
    let motivo = null;
    if (answer.type === 'noul' || answer.type === 'score') {
      const t = lim?.limiar;
      if (typeof t === 'number') {
        let prob = answer.noul;
        if (answer.type === 'score') {
          const n = Math.max(1, (jevlet.questions?.[qid]?.criteria?.length || 2) - 1);
          prob = answer.score / n;
        }
        if (!(prob >= t || prob <= 1 - t)) {
          decisivo = false;
          indecisos++;
          motivo = `zona morta: prob ${prob.toFixed(2)} em (${(1 - t).toFixed(2)}, ${t.toFixed(2)})`;
        }
      }
    } else if (answer.type === 'choice' && lim?.confianca_min !== undefined) {
      const conf = answer.confidence ?? 0;
      if (conf < lim.confianca_min) {
        decisivo = false;
        indecisos++;
        motivo = `confiança ${conf.toFixed(2)} < mínimo ${lim.confianca_min}`;
      }
    }
    porPergunta[qid] = {
      tipo: answer.type,
      valor: answer.type === 'choice' ? answer.choice : answer.type === 'noul' ? answer.noul : answer.score,
      confianca: answer.confidence ?? null,
      decisivo,
      motivo,
    };
    if (decisivo) valores[qid] = porPergunta[qid].valor;
  }
  const politica = applyPolicy(jevlet, valores);

  return {
    jevlet: jevlet.id,
    versao: jevlet.version || 1,
    respostas: res.answers,
    valores,
    por_pergunta: porPergunta,
    indecisos,
    politica,
    cache: cacheMeta?.cache || (useCache ? 'miss' : 'off'),
    transportCalled: cacheMeta?.transportCalled ?? true,
    usage: res.usage || null,
    redaction: { applied: statePolicy.redacted || questionsPolicy.redacted, categories: [...new Set([...statePolicy.categories, ...questionsPolicy.categories])].sort() },
    conhecimento_desatualizado: jevlet.knowledge_version && jevlet.knowledge_version !== KNOWLEDGE_VERSION
      ? { registrado: jevlet.knowledge_version, atual: KNOWLEDGE_VERSION, dica: 're-teste e re-publice: o julgamento foi certificado sob conhecimento anterior' }
      : null,
    latencia_ms: res.latencyMs,
    custo_usd_estimado: res.costEstimateUsd,
  };
}

/**
 * Lote: executa o mesmo jevlet sobre vários states com concorrência
 * limitada. Item com erro não derruba o lote — volta como {erro, code}.
 */
export async function invokeJevletBatch(idOrPath, states = [], {
  client, dir = FORGE_DIR, concurrency = 3, useCache = true, cachePath, ttlMs,
} = {}) {
  if (!Array.isArray(states)) throw new JevletError('states deve ser array', 'BAD_BATCH');
  const bruto = client || new JevClient({ timeoutMs: 6000 });
  const resultados = new Array(states.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < states.length) {
      const i = cursor++;
      try {
        resultados[i] = await invokeJevlet(idOrPath, states[i], { client: bruto, dir, useCache, cachePath, ttlMs });
      } catch (err) {
        resultados[i] = { erro: String(err?.message || err).slice(0, 300), code: err?.code || 'FORGE_ERROR' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, states.length) }, worker));
  return resultados;
}
