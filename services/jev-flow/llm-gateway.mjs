let session = {};

function current() {
  const baseUrl = String(session.baseUrl || process.env.JEVFLOW_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/u, '');
  let geminiEndpoint = false;
  try { geminiEndpoint = new URL(baseUrl).hostname === 'generativelanguage.googleapis.com'; } catch {}
  const apiKey = String(session.apiKey || process.env.JEVFLOW_LLM_API_KEY ||
    (geminiEndpoint ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY) || '').trim();
  const model = String(session.model || process.env.JEVFLOW_LLM_MODEL || process.env.OPENAI_MODEL || '').trim();
  return { baseUrl, apiKey, model, providerId: 'openai-compatible' };
}

export function configureLLM({ apiKey, baseUrl, model } = {}) {
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 4096)) throw new TypeError('API key is invalid');
  let nextBaseUrl = session.baseUrl;
  if (baseUrl !== undefined) {
    const url = new URL(String(baseUrl));
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('LLM endpoint must use HTTPS or loopback HTTP');
    }
    nextBaseUrl = url.toString().replace(/\/+$/u, '');
  }
  const prior = current();
  const explicitlySuppliedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (nextBaseUrl && nextBaseUrl !== prior.baseUrl && prior.apiKey && !explicitlySuppliedKey) {
    throw new TypeError('provide the API key again when changing the LLM endpoint');
  }
  if (nextBaseUrl) session.baseUrl = nextBaseUrl;
  if (model !== undefined) {
    const value = String(model).trim();
    if (!value || value.length > 180) throw new TypeError('model is required and must be at most 180 characters');
    session.model = value;
  }
  if (apiKey !== undefined) session.apiKey = apiKey.trim();
  return llmStatus();
}

export function clearLLMConfiguration() { session = {}; return llmStatus(); }

export function llmStatus() {
  const config = current();
  return { configured: Boolean(config.apiKey && config.model), hasApiKey: Boolean(config.apiKey),
    model: config.model || null, provider: config.providerId, endpoint: config.baseUrl,
    storage: 'process environment / memory only', keyReturned: false };
}

export function resolveModel(model) {
  const config = current();
  const value = String(model || config.model || '').trim();
  if (!value || value.length > 180) return null;
  const [providerPrefix, ...rest] = value.split('/');
  const modelId = rest.length ? rest.join('/') : value;
  if (rest.length && providerPrefix !== config.providerId && providerPrefix !== 'openai' && providerPrefix !== 'gemini') return null;
  return { providerId: config.providerId, modelId, model: modelId,
    provider: { id: config.providerId, name: config.providerId === 'openai-compatible' ? 'OpenAI-compatible API' : config.providerId, models: [] } };
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
}

export async function executeChat({ providerId, modelId, messages, temperature, maxTokens, stream = false, signal } = {}) {
  const config = current();
  if (!config.apiKey) throw new Error('LLM_API_KEY is not configured; set JEVFLOW_LLM_API_KEY or OPENAI_API_KEY at runtime');
  if (providerId && providerId !== config.providerId) throw new Error(`unsupported provider: ${providerId}`);
  const selected = resolveModel(modelId || config.model);
  if (!selected) throw new Error('LLM model is required; set JEVFLOW_LLM_MODEL or choose a model');
  if (!Array.isArray(messages) || !messages.length) throw new TypeError('messages must be a non-empty array');
  const request = { model: selected.modelId, messages, temperature, max_tokens: maxTokens, stream };
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST', signal,
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800).replace(/(?:sk-[A-Za-z0-9_-]{8,}|AIza[\w-]{20,})/gu, '[redacted]');
    throw new Error(`LLM provider HTTP ${response.status}: ${detail || response.statusText}`);
  }
  if (stream) return parseSSE(response, selected);
  const data = await response.json();
  const effectiveModelId = String(data.model || selected.modelId);
  return { content: normalizeContent(data.choices?.[0]?.message?.content), usage: data.usage || null,
    providerId: config.providerId, requestedProviderId: config.providerId, effectiveModelId,
    model: effectiveModelId, modelBasis: data.model ? 'response' : 'requested',
    executionKind: 'live' };
}

async function* parseSSE(response, selected) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/u); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { yield { type: 'done', usage, model: selected.modelId, modelBasis: 'requested' }; return; }
        let packet; try { packet = JSON.parse(data); } catch { continue; }
        if (packet.usage) usage = packet.usage;
        const content = packet.choices?.[0]?.delta?.content;
        if (content) yield { type: 'delta', content, providerId: selected.providerId,
          requestedProviderId: selected.providerId, effectiveModelId: packet.model || selected.modelId,
          model: packet.model || selected.modelId, modelBasis: packet.model ? 'response' : 'requested',
          usage: packet.usage || undefined };
        if (packet.choices?.[0]?.finish_reason) yield { type: 'metadata', usage, model: packet.model || selected.modelId };
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
}

export function listConfiguredModels() {
  const status = llmStatus();
  return status.model ? [{ id: status.provider, nome: 'OpenAI-compatible API', modelos: [{ id: status.model, nome: status.model }] }] : [];
}
