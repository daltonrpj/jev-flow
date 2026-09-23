// ============================================================================
// Jev Assist — o copiloto do estúdio: o chat do Jev Flow DENTRO do Jev Flow.
//
// O usuário conversa ("adiciona um aviso por e-mail quando for urgente"), o
// LLM do próprio Jev Flow devolve o flow COMPLETO revisado + resumo das
// mudanças, e o validador mecânico fiscaliza antes de sequer sugerir aplicar.
// Sem confiança cega: patch inválido chega marcado como inválido na UI.
// ============================================================================

import { defaultChatFn } from '../jev-forge/forge.mjs';
import { validateFlow } from './engine.mjs';
import { projectFlowForProvider, restoreRedactedFlowSecrets } from './public-projection.mjs';

const MENU = `Menu de nós: jev.ask (julgamento inline: questions {qid:{type choice|noul|score, instructions, criteria}}),
jev.jevlet (catálogo do Forge: {jevlet:"id"}), rules.find ({ruleset:"id ingerido" OU rules:[{id?,texto}], pergunta:"{{input.caso}}" —
acha a regra aplicável de uma política com CITAÇÃO LITERAL; saída: veredicto aplicavel|parcial|sem_regra|conflito, regra, citacao{id,texto,fonte}, existe, excecao),
flow.if ({when:"{{no.valores.qid}} >= 0.7", then, else}),
flow.switch ({on:"{{no.valores.qid}}", cases:{caso:"noAlvo", _default:"noAlvo"}}),
budget.guard ({budget:{steps,jevCalls,inputTokens}}), jev.verify ({claim,evidence,minSupport}),
action.webhook ({url, body:{...interpolado {{input.x}} / {{no.valores.y}}}, onError:"abortar" opcional}),
action.log ({texto}), action.set ({values:{k:"{{...}}"}}).
Políticas de segurança: "next" no NÓ, nunca dentro de pergunta; DAG sem ciclos; todo alvo existe;
todo caminho a action.webhook contém budget.guard → jev.verify → flow.if com
"{{verify-id.gate.pass}} == true"; somente o then chega ao webhook e o else vai a revisão/log;
expressões {{raiz.caminho}} com raiz input|vars|flow|nó existente; mínimo de nós.`;

const SHAPE = `Responda APENAS com JSON:
{
  "flow": { ...o flow COMPLETO revisado (id e input_schema preservados)... },
  "resumo": "uma frase do que mudou",
  "mudancas": ["mudança 1", "mudança 2"]
}`;

/**
 * Uma rodada de assistência: recebe o flow atual + o pedido em português e
 * devolve { flow_novo, resumo, mudancas, validacao }. chatFn injetável.
 */
export async function assistFlow({ flow, message, chatFn } = {}) {
  if (!flow || typeof flow !== 'object') throw new Error('flow atual é obrigatório');
  if (!message || !String(message).trim()) throw new Error('descreva o que quer mudar');
  const fn = chatFn || defaultChatFn;
  const providerFlow = projectFlowForProvider(flow);

  const content = await fn({
    temperature: 0.25,
    maxTokens: 3800,
    messages: [
      {
        role: 'system',
        content: `Você é o copiloto do Jev Flow do Jev Flow (fluxos visuais de regras e decisões com julgamentos Jev/TypeSafe).
Sua função é EDITAR o flow que o usuário mandou conforme o pedido — devolvendo o JSON COMPLETO do novo flow.
${MENU}

Regras e exceções: quando o usuário disser "sempre X" ou "regra geral", crie o caminho padrão; quando disser
"exceto quando Y", "menos quando Y" ou "a não ser que Y", transforme a exceção em ramo EXPLÍCITO (else/caso
próprio indo para revisão ou log) — nunca esconda a exceção dentro de um critério. Se a exceção vier de política
escrita, prefira regra "Exceção:" no ruleset (o nó rules.find devolve excecao=true e o flow desvia com
flow.if "{{no.excecao}} == true" ANTES de qualquer ação).

${SHAPE}

Não remova nós existentes além do pedido. Perguntas novas seguem o conhecimento Jev: atômicas, critérios
concretos, escape em choice de mundo aberto. Ações externas usam action.webhook (o usuário pluga a URL do
app que quiser — e-mail, Telegram, Jira, Zapier ou um serviço próprio. Sem inventar campos fora do menu.`,
      },
      { role: 'user', content: `FLOW ATUAL (valores sensíveis protegidos por sentinelas; preserve-os):\n${JSON.stringify(providerFlow, null, 1)}\n\nPEDIDO: ${String(message).trim()}` },
    ],
  });

  const parsed = extractJson(content);
  if (!parsed?.flow) {
    return { flow_novo: null, resumo: null, mudancas: [], validacao: { ok: false, errors: [{ codigo: 'NO_JSON', campo: '', msg: 'o copiloto não devolveu um flow parseável' }], warnings: [] } };
  }
  const flowNovo = restoreRedactedFlowSecrets(parsed.flow, flow);
  flowNovo.id = flow.id; // a URL manda no id
  if (!flowNovo.input_schema) flowNovo.input_schema = flow.input_schema;
  return {
    flow_novo: flowNovo,
    resumo: String(parsed.resumo || 'flow revisado'),
    mudancas: Array.isArray(parsed.mudancas) ? parsed.mudancas.map(String).slice(0, 8) : [],
    validacao: validateFlow(flowNovo),
  };
}

function extractJson(text) {
  const s = String(text || '');
  const ini = s.indexOf('{');
  const fim = s.lastIndexOf('}');
  if (ini === -1 || fim <= ini) return null;
  try { return JSON.parse(s.slice(ini, fim + 1)); } catch { return null; }
}
