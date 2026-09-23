// Only report money when the provider supplies it or the selected model has
// explicit prices in the local registry. Missing usage/prices stay unknown.
function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function readUsage(result) {
  const usage = result?.usage || {};
  const inputTokens = finiteNonNegative(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = finiteNonNegative(usage.completion_tokens ?? usage.output_tokens);
  // Some adapters replace absent usage with 0/0. That is not evidence of a free call.
  if (inputTokens === 0 && outputTokens === 0) return { inputTokens: null, outputTokens: null };
  return {
    inputTokens,
    outputTokens,
  };
}

export function llmCost(result, resolved) {
  const { inputTokens, outputTokens } = readUsage(result);
  const billed = finiteNonNegative(result?.usage?.cost_usd ?? result?.usage?.cost ?? result?.costUsd ?? result?.cost_usd);
  if (billed !== null) return { costUsd: billed, costSource: 'provider' };
  const model = resolved?.provider?.models?.find(item => item.id === resolved.modelId);
  const inputRate = finiteNonNegative(model?.costPerMTokIn);
  const outputRate = finiteNonNegative(model?.costPerMTokOut);
  if (inputTokens === null || outputTokens === null || inputRate === null || outputRate === null
      || (result?.model && result.model !== resolved.modelId)) {
    return { costUsd: null, costSource: 'unavailable' };
  }
  return { costUsd: (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000, costSource: 'catalog-estimate' };
}

export function jevCost(result) {
  const { inputTokens } = readUsage(result);
  const estimate = finiteNonNegative(result?.costEstimateUsd);
  return result?.backend !== 'openjev-compatible' && inputTokens !== null && estimate !== null
    ? { costUsd: estimate, costSource: 'typesafe-estimate' }
    : { costUsd: null, costSource: 'unavailable' };
}

export function measuredComparison(jev, llm) {
  if (!jev?.ok || !llm?.ok || jev.backend === 'fallback' || String(jev.backend || '').startsWith('fallback/')) {
    return { speedRatio: null, costRatio: null };
  }
  const speedRatio = jev.latencyMs > 0 && llm.latencyMs > 0 ? llm.latencyMs / jev.latencyMs : null;
  const costRatio = jev.costUsd > 0 && llm.costUsd > 0 ? llm.costUsd / jev.costUsd : null;
  return { speedRatio, costRatio };
}
