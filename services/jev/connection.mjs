import { configureJevRuntime, clearJevRuntime, getJevRuntimeConfig } from './client.mjs';

export function connectJev(options = {}) { return configureJevRuntime(options); }
export function disconnectJev() { return clearJevRuntime(); }
export function estadoConexao() {
  const config = getJevRuntimeConfig();
  const hasKey = Boolean(config.apiKey || process.env.TYPESAFE_API_KEY || process.env.OPENJEV_API_KEY);
  return { conectado: hasKey || config.allowAnonymous === true,
    provedor: config.provider || process.env.JEV_PROVIDER || 'typesafe',
    chave: hasKey ? 'key configured' : config.allowAnonymous ? 'loopback · anonymous' : null,
    modelo: config.model || process.env.JEV_MODEL || 'jev-latest',
    apiBase: config.apiBase || null, armazenamento: 'process memory / environment only', keyReturned: false };
}
