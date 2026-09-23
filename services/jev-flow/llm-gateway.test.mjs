import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLLMConfiguration, configureLLM, executeChat, llmStatus } from './llm-gateway.mjs';

test('endpoint changes cannot silently carry a previously configured key', () => {
  clearLLMConfiguration();
  configureLLM({ apiKey: 'session-key-marker', baseUrl: 'https://api.openai.com/v1', model: 'demo-model' });
  assert.throws(() => configureLLM({ baseUrl: 'https://attacker.example/v1' }), /provide the API key again/u);
  assert.throws(() => configureLLM({ baseUrl: 'https://attacker.example/v1', apiKey: '' }), /provide the API key again/u);
  assert.throws(() => configureLLM({ baseUrl: 'https://attacker.example/v1', apiKey: '   ' }), /provide the API key again/u);
  assert.equal(configureLLM({}).endpoint, 'https://api.openai.com/v1');
  clearLLMConfiguration();
});

test('blank key cannot redirect an environment credential to a new endpoint', async () => {
  const names = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'JEVFLOW_LLM_API_KEY', 'JEVFLOW_LLM_BASE_URL', 'JEVFLOW_LLM_MODEL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  let captured;
  try {
    for (const name of names) delete process.env[name];
    process.env.JEVFLOW_LLM_API_KEY = 'environment-key-marker';
    process.env.JEVFLOW_LLM_MODEL = 'test-model';
    clearLLMConfiguration();
    assert.throws(() => configureLLM({ baseUrl: 'https://attacker.example/v1', apiKey: '' }), /provide the API key again/u);
    assert.throws(() => configureLLM({ baseUrl: 'https://attacker.example/v1', apiKey: '   ' }), /provide the API key again/u);
    assert.equal(llmStatus().endpoint, 'https://api.openai.com/v1');
    globalThis.fetch = async (url, options) => {
      captured = { url: String(url), authorization: options.headers.authorization };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'test-model' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    await executeChat({ messages: [{ role: 'user', content: 'test' }] });
    assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer environment-key-marker');
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    clearLLMConfiguration();
  }
});

test('default endpoint and environment key stay paired when both vendor keys exist', async () => {
  const names = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'JEVFLOW_LLM_API_KEY', 'JEVFLOW_LLM_BASE_URL', 'JEVFLOW_LLM_MODEL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  let captured;
  try {
    for (const name of names) delete process.env[name];
    process.env.OPENAI_API_KEY = 'openai-key-marker';
    process.env.GEMINI_API_KEY = 'gemini-key-marker';
    process.env.JEVFLOW_LLM_MODEL = 'test-model';
    globalThis.fetch = async (url, options) => {
      captured = { url: String(url), authorization: options.headers.authorization };
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], model: 'test-model' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    await executeChat({ messages: [{ role: 'user', content: 'test' }] });
    assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(captured.authorization, 'Bearer openai-key-marker');
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    clearLLMConfiguration();
  }
});
