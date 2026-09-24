// ============================================================================
// Jev Flow Designer — criar um fluxo conversando. O usuário descreve o objetivo em
// português; um LLM do Jev Flow (o mesmo caminho do Jev Forge) desenha o flow
// JSON conforme o menu de nós; o validador mecânico fiscaliza — nunca
// confia, sempre valida. "Fácil de criar" = uma frase vira um fluxo revisável.
// ============================================================================

import { designGuidelinesMarkdown } from '../jev-forge/knowledge.mjs';
import { defaultChatFn } from '../jev-forge/forge.mjs';
import { validateFlow } from './engine.mjs';
import { NODE_CATALOG_VERSION, listNodeDefinitions } from './node-catalog.mjs';
import { projectProviderPayload, projectFlowForProvider } from './public-projection.mjs';

function designerNodeCatalogMarkdown() {
  const lines = listNodeDefinitions().map(node => {
    const flags = [node.group, node.costClass, node.remote ? 'rede' : 'local', `risco:${node.riskClass}`].join(' · ');
    return `- ${node.type} [${flags}] — ${node.description}\n  Entrada: ${JSON.stringify(node.inputs)}\n  Saída: ${JSON.stringify(node.outputs)}\n  Exemplo: ${JSON.stringify(node.example)}`;
  });
  return `Catálogo executável ${NODE_CATALOG_VERSION} (use somente estes tipos):\n${lines.join('\n')}

Princípios do estúdio:
- tente primeiro política local, lookup, extração, skill determinística, compactação ou gate de orçamento; use Jev apenas para ambiguidade real
- políticas/regimentos/SOPs em documento entram via ruleset ingerido (\`jev ruleset ingest <pasta> --id x\`) + nó rules.find — a regra citada sai literal do arquivo, nunca paráfrase do modelo
- regra geral + exceções: "exceto quando Y" vira ramo explícito (else/caso/revisão) ou regra "Exceção:" no ruleset (saída excecao=true desvia ANTES da ação); nunca uma exceção escondida dentro do critério
- "next" fica SEMPRE no NÓ, nunca dentro de pergunta/configuração
- julgamento e verificação produzem evidência; código mantém rota, orçamento, autorização e efeitos
- expressões são {{raiz.caminho}}; raízes: input, vars, flow ou id de nó já executado
- todo next/then/else/case aponta para nó existente; sem ciclos
- logic.subgraph recebe DSL JSON versionada; conflito/unknown/review nunca viram aprovação automática
- action.webhook exige, em TODO caminho: budget.guard → jev.verify → flow.if com "{{verify-id.gate.pass}} == true" (webhook somente no then; else termina em revisão/log)
- referências ao gate, branches false/default/review e posição visual não autorizam efeito; nenhum nó de lógica dispara ação por conta própria
- perguntas Jev são atômicas, critérios concretos e incluem escape quando o mundo é aberto
- use o mínimo de nós que preserve evidência, fallback e auditabilidade`;
}

const MENU_DE_NOS = designerNodeCatalogMarkdown();

const SPEC_SHAPE = `Formato EXATO do JSON de saída (nada fora do JSON):
{
  "id": "slug-do-flow",
  "name": "Nome curto",
  "description": "o que a regra faz, 1 frase",
  "input_schema": { "campo": "string — quem fornece o quê" },
  "fixtures": [{ "id": "fixture-1", "name": "Exemplo", "input": {} }],
  "start": "<primeiro nó>",
  "nodes": { "<no>": { ... }, ... }
}`;

/**
 * Desenha um flow a partir da descrição em português. Retorna
 * { rascunho, validacao, bruto }. chatFn injetável p/ teste (default: LLM
 * do próprio Jev Flow via executor).
 */
export async function designFlow({ intent, exemplos = [], chatFn, metadata = {}, baseFlow = null, historico = [] } = {}) {
  if (!intent || typeof intent !== 'string') throw new Error('descreva o objetivo (intent)');
  const fn = chatFn || defaultChatFn;

  const exemplosTxt = exemplos.length
    ? `\n## Formato dos exemplos de input (valores protegidos)\n${JSON.stringify(projectProviderPayload(exemplos.slice(0, 6), 'fixture'), null, 2)}`
    : '';
  const inputHint = metadata?.input_hint
    ? `\n## Pistas opcionais sobre os dados de entrada (não trate como schema obrigatório)\n${String(metadata.input_hint).slice(0, 4_000)}`
    : '';

  const content = await fn({
    temperature: 0.3,
    maxTokens: 3500,
    messages: [
      {
        role: 'system',
        content: `${designGuidelinesMarkdown()}\n\n---\n# Jev Flow — estúdio visual de decisões e regras com julgamentos Jev\n${MENU_DE_NOS}\n\n---\n${SPEC_SHAPE}\n\nVocê é o Jev Flow Designer do Jev Flow. Receba uma descrição natural e construa a estrutura completa por conta própria: invente um nome curto, um id técnico seguro, o input_schema mínimo, fixtures úteis e os nós necessários. Não peça ao usuário JSON, IDs ou nomes de nós. Preserve a intenção, torne cada etapa explicável e deixe casos ambíguos encaminhados para revisão. Responda APENAS com o JSON do flow.`,
      },
      { role: 'user', content: `Desired flow (current user turn): ${intent}${inputHint}${exemplosTxt}${baseFlow ? `\n\nCurrent flow topology and contracts: ${JSON.stringify(projectFlowForProvider(baseFlow)).slice(0, 12000)}\nUpdate it according to the current request. Preserve unmentioned nodes and the flow id.` : ''}${historico.length ? `\n\nThis is turn ${Math.min(100, historico.length + 1)} of a conversation. The current flow above carries prior edits; do not infer hidden history.` : ''}` },
    ],
  });

  const rascunho = extractJson(content);
  if (!rascunho) {
    return { rascunho: null, validacao: { ok: false, errors: [{ codigo: 'NO_JSON', campo: '', msg: 'LLM não devolveu JSON parseável' }], warnings: [] }, bruto: content };
  }
  if (exemplos.length && !Array.isArray(rascunho.fixtures)) {
    rascunho.fixtures = exemplos.slice(0, 8).map((input, i) => ({
      id: `fixture-${i + 1}`,
      name: `Exemplo ${i + 1}`,
      input,
    }));
  }
  if (metadata && typeof metadata === 'object') {
    if (metadata.id) rascunho.id = String(metadata.id).trim();
    if (metadata.name) rascunho.name = String(metadata.name).trim();
    if (metadata.description) rascunho.description = String(metadata.description).trim();
    if (metadata.input_schema && typeof metadata.input_schema === 'object' && !Array.isArray(metadata.input_schema) && Object.keys(metadata.input_schema).length) rascunho.input_schema = metadata.input_schema;
  }
  const validacao = validateFlow(rascunho);
  return { rascunho, validacao, bruto: content };
}

function extractJson(text) {
  const s = String(text || '');
  const ini = s.indexOf('{');
  const fim = s.lastIndexOf('}');
  if (ini === -1 || fim <= ini) return null;
  try { return JSON.parse(s.slice(ini, fim + 1)); } catch { return null; }
}
