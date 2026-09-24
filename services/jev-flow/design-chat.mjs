import { designFlow } from './design.mjs';

/** A conversational edit is a new, validated draft; no draft is persisted here. */
export async function designChat(body = {}, { design = designFlow } = {}) {
  const messages = Array.isArray(body.mensagens) ? body.mensagens.slice(-10) : [];
  const latest = [...messages].reverse().find(item => item?.role === 'user' && typeof item.content === 'string');
  const intent = latest?.content?.trim().slice(0, 4_000);
  if (!intent) {
    const error = new Error('Send a user message describing the flow');
    error.status = 400; throw error;
  }
  const examples = Array.isArray(body.exemplos) ? body.exemplos.slice(0, 6) : [];
  const previous = body.base_flow && typeof body.base_flow === 'object' && !Array.isArray(body.base_flow)
    ? body.base_flow : null;
  let result = await design({ intent, exemplos: examples, baseFlow: previous, historico: messages.slice(0, -1) });
  let repairs = 0;
  while (!result.validacao?.ok && repairs < 2) {
    repairs++;
    const errors = (result.validacao?.errors || []).slice(0, 6)
      .map(item => `${String(item.codigo || 'INVALID').slice(0, 80)}: ${String(item.msg || '').slice(0, 180)}`);
    const feedback = errors.length ? errors.join('\n') : 'Return exactly one valid flow JSON object.';
    result = await design({
      intent: `${intent}\n\nValidator feedback from the previous draft; repair the flow:\n${feedback}`,
      exemplos: examples, baseFlow: result.rascunho || previous,
      historico: messages.slice(0, -1),
    });
  }
  const flow = result.rascunho;
  const valid = result.validacao?.ok === true;
  const message = !flow ? 'I could not produce a valid flow. Describe the input, decision, and final action.'
    : valid ? `${previous ? 'Flow updated' : 'Draft ready'}: ${flow.name || flow.id}, ${Object.keys(flow.nodes || {}).length} nodes. Review and save it when ready.`
      : `The draft needs changes: ${(result.validacao?.errors || []).slice(0, 3).map(item => item.codigo).join(', ')}.`;
  return { fala: message, rascunho: flow || null, validacao: result.validacao,
    repairs, executionKind: 'llm-design' };
}
