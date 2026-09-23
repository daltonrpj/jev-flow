import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoPage, buildFlowsIndexPage, simulatePreviewFlow, simularBateria } from './services/jev-flow/demo-page.mjs';
import { buildBattlePage } from './services/jev-flow/battle-page.mjs';
import { buildCarrinhoPage } from './services/jev-flow/carrinho-page.mjs';
import { buildCompendiumPage } from './services/jev-flow/compendium-page.mjs';
import { listBattleModels, runBattle, runBattleStream } from './services/jev-flow/battle.mjs';
import { listArenaTests, TESTES, runArenaTest } from './services/jev-flow/arena-tests.mjs';
import { runArenaRace } from './services/jev-flow/race.mjs';
import { runLabStep, LAB_DESCRIPTIONS } from './services/jev-flow/labs-api.mjs';
import { handleJevDecision, handleLlmDecision } from './services/jev-flow/carrinho-api.mjs';
import { validateFlow, saveFlow, loadFlow, listFlows, deleteFlow, listRuns, runFlow, flowPath,
  scheduleFlow, schedulesInfo, executarAgendado } from './services/jev-flow/engine.mjs';
import { designFlow } from './services/jev-flow/design.mjs';
import { assistFlow } from './services/jev-flow/assist.mjs';
import { queryCatalog, catalogStats, getCatalogItem } from './services/jev-flow/compendium-catalog.mjs';
import { configureLLM, llmStatus, resolveModel } from './services/jev-flow/llm-gateway.mjs';
import { JevClient, isJevConfigured, resolveJevConfig } from './services/jev/client.mjs';
import { connectJev, disconnectJev, estadoConexao } from './services/jev/connection.mjs';
import { descobrirLaya, aquecerLaya } from './services/jev/laya-local.mjs';
import { listRulesets, loadRuleset, extrairRegrasDeConteudo, RULESETS_DIR } from './services/jev-flow/ruleset.mjs';
import { setScheduleRunner } from './services/jev-flow/scheduler.mjs';
import { JEV_DATA_DIR } from './services/jev/client.mjs';
import { parsePublicOrigin, authorizeIncomingRequest } from './services/security/request-access.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const LIMIT_BODY = 1_000_000;
const labsWindow = { startedAt: Date.now(), used: 0, units: 120 };
const PORT = Number(process.env.PORT ?? 8723);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be an integer from 1 to 65535');
const HOST = process.env.HOST || '127.0.0.1';
const loopback = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
if (!loopback) throw new Error('Refusing non-loopback bind: browser pages can render private user flows. Use HOST=127.0.0.1.');
const PUBLIC_ORIGIN = parsePublicOrigin(Object.hasOwn(process.env, 'JEVFLOW_PUBLIC_ORIGIN') ? process.env.JEVFLOW_PUBLIC_ORIGIN : undefined);
if (PUBLIC_ORIGIN && HOST !== '127.0.0.1') throw new Error('JEVFLOW_PUBLIC_ORIGIN requires HOST=127.0.0.1');

const send = (res, status, data, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
};
function byteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(String(value || '').trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start >= size || end < start) return null;
  return { start, end };
}
function serveStatic(req, res, pathname, size, type) {
  const isVideo = type.startsWith('video/');
  const headers = {
    'content-type': type,
    'content-length': String(size),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (isVideo) headers['accept-ranges'] = 'bytes';
  const rangeHeader = isVideo && req.method === 'GET' ? req.headers.range : undefined;
  const range = rangeHeader ? byteRange(rangeHeader, size) : undefined;
  if (rangeHeader && !range) {
    res.writeHead(416, { ...headers, 'content-length': '0', 'content-range': `bytes */${size}` });
    return res.end();
  }
  let status = 200;
  let options;
  if (range) {
    status = 206;
    options = { start: range.start, end: range.end };
    headers['content-length'] = String(range.end - range.start + 1);
    headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
  }
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();
  const stream = createReadStream(pathname, options);
  stream.once('error', error => {
    if (res.headersSent) res.destroy(error);
    else send(res, 500, { error: 'static asset could not be read' });
  });
  return stream.pipe(res);
}
const json = (res, data, status = 200) => send(res, status, data);
function errorBody(error) { return { error: String(error?.message || error).slice(0, 600), code: error?.code || 'REQUEST_FAILED' }; }
async function bodyOf(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > LIMIT_BODY) throw Object.assign(new Error('request body exceeds 1 MB'), { status: 413 }); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('request body must be valid JSON'), { status: 400 }); }
}
function authorizeLocalRequest(req) {
  authorizeIncomingRequest({ host: req.headers.host, origin: req.headers.origin,
    method: req.method || 'GET', remoteAddress: req.socket.remoteAddress, port: PORT,
    publicOrigin: PUBLIC_ORIGIN, rawHeaders: req.rawHeaders });
}
function authorizeApiRequest(req) {
  const method = req.method || 'GET';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw Object.assign(new Error('API mutations require Content-Type: application/json'), { status: 415 });
  }
  if (method === 'OPTIONS') throw Object.assign(new Error('CORS is disabled; use the same origin'), { status: 405 });
}
function persistFlow(flow) {
  const validation = validateFlow(flow);
  if (!validation.ok) return { ok: false, status: 422, validation };
  const target = flowPath(flow.id);
  if (existsSync(target)) return { ok: false, status: 409, error: `flow id already exists: ${flow.id}` };
  const result = saveFlow(flow);
  return result.salvo ? { ok: true, flow } : { ok: false, status: 422, validation: result.validacao };
}
function catalogParts(source) {
  return Object.fromEntries(['pattern','domain','variant','limiar','complexity','focus'].map(key => [key, source?.[key] || '']));
}
function requireCatalogItem(source) {
  const item = getCatalogItem(catalogParts(source));
  if (!item) throw Object.assign(new Error('catalog configuration does not resolve to one valid flow'), { status: 404 });
  return item;
}
function normalizeInput(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function unitsRemaining() {
  if (Date.now() - labsWindow.startedAt >= 30 * 60_000) { labsWindow.startedAt = Date.now(); labsWindow.used = 0; }
  return Math.max(0, labsWindow.units - labsWindow.used);
}
function debitLabs(body) {
  const units = body.mode === 'code' ? 0 : body.mode === 'compare' ? 2 : 1;
  if (units > unitsRemaining()) throw Object.assign(new Error('remote lab budget exhausted; resets every 30 minutes'), { status: 429 });
  labsWindow.used += units;
}
async function translate(texts, to, from = 'en') {
  const model = resolveModel();
  if (!model) throw Object.assign(new Error('configure the LLM endpoint and model before translating'), { status: 503 });
  const { executeChat } = await import('./services/jev-flow/llm-gateway.mjs');
  const source = texts.map((text, i) => `${i + 1}. ${String(text).slice(0, 2400)}`).join('\n');
  const result = await executeChat({ providerId: model.providerId, modelId: model.modelId,
    messages: [{ role: 'system', content: `Translate each numbered item from ${from} to ${to}. Preserve code, placeholders, IDs and order. Return only a JSON array of strings.` },
      { role: 'user', content: source }], temperature: 0, maxTokens: Math.min(8000, 250 + texts.length * 300) });
  const raw = result.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== texts.length || parsed.some(item => typeof item !== 'string')) {
    throw new Error('translation model returned a response outside the expected array schema');
  }
  return parsed;
}

async function servePage(pathname, query, req, res) {
  if (pathname === '/') { res.writeHead(302, { location: '/jev/flows', 'cache-control': 'no-store' }); return res.end(); }
  if (pathname === '/jev' || pathname === '/jev/') { res.writeHead(302, { location: '/jev/flows' }); return res.end(); }
  if (pathname === '/jev/flows') return send(res, 200, await buildFlowsIndexPage({ locale: query.get('lang') }), 'text/html; charset=utf-8');
  if (pathname === '/jev/flows/compendium') return send(res, 200, await buildCompendiumPage({ locale: query.get('lang') }), 'text/html; charset=utf-8');
  if (pathname === '/jev/flows/compendium/test') {
    const item = requireCatalogItem(Object.fromEntries(query.entries()));
    const page = await buildDemoPage(item.id, { flow: item.flow, catalogPreview: true, catalogKey: catalogParts(Object.fromEntries(query.entries())), locale: query.get('lang') });
    return send(res, 200, page.html, 'text/html; charset=utf-8');
  }
  const flowMatch = pathname.match(/^\/jev\/flows\/([a-z][a-z0-9_-]{2,40})(?:\/demo)?$/u);
  if (flowMatch) {
    const page = await buildDemoPage(flowMatch[1], { locale: query.get('lang') });
    return send(res, 200, page.html, 'text/html; charset=utf-8');
  }
  if (pathname === '/jev/battle') return send(res, 200, await buildBattlePage(), 'text/html; charset=utf-8');
  if (pathname === '/jev/carrinho') {
    const models = (await listBattleModels()).flatMap(p => p.modelos.map(m => m.id));
    return send(res, 200, buildCarrinhoPage({ llmModels: models, locale: query.get('lang') }), 'text/html; charset=utf-8');
  }
  if (pathname === '/jev/labs') {
    const page = await readFile(join(ROOT, 'services/jev-flow/labs-page.html'), 'utf8');
    return send(res, 200, query.get('lang') === 'en' ? page.replace('<html lang="pt-BR">', '<html lang="en">') : page, 'text/html; charset=utf-8');
  }
  if (pathname === '/jev/labs/assets/engine.mjs') return send(res, 200, await readFile(join(ROOT, 'services/jev-flow/labs-engine.mjs'), 'utf8'), 'text/javascript; charset=utf-8');
  if (pathname === '/jev/labs/assets/chess.mjs') return send(res, 200, await readFile(join(ROOT, 'services/jev-flow/labs-chess-engine.mjs'), 'utf8'), 'text/javascript; charset=utf-8');
  if (pathname === '/jev/labs/assets/ui.mjs') return send(res, 200, await readFile(join(ROOT, 'services/jev-flow/labs-ui.mjs'), 'utf8'), 'text/javascript; charset=utf-8');
  if (pathname === '/favicon.svg' || pathname === '/logo.svg') return send(res, 200, await readFile(join(ROOT, 'assets', 'mark.svg'), 'utf8'), 'image/svg+xml');
  const docs = pathname.match(/^\/docs\/(quickstart|architecture|security|examples|deploy-hostinger|walkthrough-tts)\.md$/u);
  if (docs) return send(res, 200, await readFile(join(ROOT, 'docs', `${docs[1]}.md`), 'utf8'), 'text/markdown; charset=utf-8');
  if (pathname === '/catalog-certification.json') return json(res, JSON.parse(await readFile(join(ROOT, 'catalog-certification.json'), 'utf8')));
  const publicFile = /^\/(assets|examples|media)\/(.+)$/u.exec(pathname);
  if (publicFile) {
    const [, directory, encodedName] = publicFile;
    const base = resolve(ROOT, directory);
    const target = resolve(base, decodeURIComponent(encodedName));
    const relativeTarget = relative(base, target);
    if (!relativeTarget || relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) throw Object.assign(new Error('path traversal'), { status: 400 });
    const extension = extname(target).toLowerCase();
    const allowed = { assets: ['.svg'], examples: ['.json'], media: ['.webm', '.vtt', '.md', '.png', '.gif'] }[directory];
    if (!allowed.includes(extension)) throw Object.assign(new Error('asset type not available'), { status: 404 });
    if (!existsSync(target)) throw Object.assign(new Error('static asset not found'), { status: 404 });
    const type = { '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.webm':'video/webm','.vtt':'text/vtt; charset=utf-8','.md':'text/markdown; charset=utf-8' }[extension];
    const file = await stat(target);
    if (!file.isFile()) throw Object.assign(new Error('static asset not found'), { status: 404 });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, target, file.size, type);
    return send(res, 405, { error: 'method not allowed' });
  }
  if (pathname === '/api/jev/docs/laya') return send(res, 200, '<!doctype html><meta charset="utf-8"><title>Optional Laya setup</title><h1>Optional local Laya integration</h1><p>Install Python 3.11+ and the Laya package in a dedicated environment. The project never downloads weights or installs packages automatically.</p><pre>python -m pip install laya\npython scripts/laya_bridge.py --warmup</pre><p><a href="https://github.com/NandhaKishorM/laya/releases/latest" rel="noopener">Official Laya releases</a></p>', 'text/html; charset=utf-8');
  throw Object.assign(new Error('page not found'), { status: 404 });
}

async function route(req, res) {
  authorizeLocalRequest(req);
  const requestHost = HOST.includes(':') ? `[${HOST}]` : HOST;
  const url = new URL(req.url, `http://${requestHost}:${PORT}`);
  const p = url.pathname;
  const method = req.method || 'GET';
  if (p.startsWith('/api/')) authorizeApiRequest(req);
  if (method === 'GET' || method === 'HEAD') {
    if (p === '/api/health') return json(res, { ok: true, name: 'Jev Flow', mode: 'standalone', dependencies: 'project-local' });
    if (p === '/api/jev/flows') return json(res, { flows: listFlows(), schedules: schedulesInfo() });
    if (p === '/api/translate/languages') return json(res, { languages: languageList });
    if (p === '/api/jev/schedules') return json(res, schedulesInfo());
    if (p === '/api/jev/rulesets') return json(res, { rulesets: listRulesets() });
    if (p.startsWith('/api/jev/rulesets/')) return json(res, loadRuleset(decodeURIComponent(p.split('/').at(-1))));
    if (p === '/api/jev/flows/compendium/stats') return json(res, catalogStats());
    if (p === '/api/jev/flows/compendium') return json(res, queryCatalog(Object.fromEntries(url.searchParams.entries())));
    if (p === '/api/jev/flows/compendium/item') return json(res, requireCatalogItem(Object.fromEntries(url.searchParams.entries())).flow);
    if (p === '/api/jev/battle/models') return json(res, await listBattleModels());
    if (p === '/api/jev/battle/tests') return json(res, listArenaTests());
    if (p === '/api/jev/battle/status') {
      let laya = { disponivel: false, estado: 'unavailable', error: 'not checked' };
      try { laya = await descubrirLaya(); } catch (error) { laya = { disponivel: false, estado: 'unavailable', error: String(error.message).slice(0,160) }; }
      return json(res, { typesafe: { available: isJevConfigured(), reason: isJevConfigured() ? 'configured · provider has not been called' : 'configure TypeSafe System One at runtime' }, laya });
    }
    if (p === '/api/jev/labs/status') return json(res, { jevConfigured: isJevConfigured(), llmConfigured: llmStatus().configured,
      remoteUnitsRemaining: unitsRemaining(), labDescriptions: LAB_DESCRIPTIONS, resetAt: labsWindow.startedAt + 30 * 60_000 });
    if (p === '/api/jev/llm/status') return json(res, llmStatus());
    if (p === '/api/jev/connect/status') return json(res, estadoConexao());
    if (p === '/api/jev/laya/status') return json(res, await descubrirLaya());
    const oneFlow = p.match(/^\/api\/jev\/flows\/([a-z][a-z0-9_-]{2,40})$/u);
    if (oneFlow) return json(res, loadFlow(oneFlow[1]));
    const runs = p.match(/^\/api\/jev\/flows\/([a-z][a-z0-9_-]{2,40})\/runs$/u);
    if (runs) return json(res, { runs: listRuns(runs[1], { limit: Number(url.searchParams.get('limit')) || 20 }) });
    const exportFlow = p.match(/^\/api\/jev\/flows\/([a-z][a-z0-9_-]{2,40})\/export$/u);
    if (exportFlow) return json(res, loadFlow(exportFlow[1]));
    const runFile = p.match(/^\/api\/jev\/flows\/([a-z][a-z0-9_-]{2,40})\/runs\/([A-Za-z0-9_.-]+)$/u);
    if (runFile) {
      if (!runFile[2].endsWith('.json') || runFile[2].includes('..')) throw Object.assign(new Error('run not found'), { status: 404 });
      try { return json(res, JSON.parse(await readFile(join(JEV_DATA_DIR, 'flows', 'runs', runFile[1], runFile[2]), 'utf8'))); }
      catch { throw Object.assign(new Error('run not found'), { status: 404 }); }
    }
    return servePage(p, url.searchParams, req, res);
  }
  const body = await bodyOf(req);
  if (p === '/api/jev/connect' && method === 'POST') {
    const provider = body.provider === 'openjev' ? 'openjev-compatible' : body.provider || 'typesafe';
    const apiBase = body.apiBase || undefined;
    const key = String(body.key || '').trim();
    if (provider === 'typesafe' && key && apiBase && !/^https:\/\/api\.typesafe\.ai(?:\/|$)/iu.test(apiBase)) throw Object.assign(new Error('TypeSafe connections must use api.typesafe.ai over HTTPS'), { status: 400 });
    if (provider === 'openjev-compatible' && apiBase && !/^https:\/\//iu.test(apiBase) && !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu.test(apiBase)) throw Object.assign(new Error('OpenJev endpoint must use HTTPS or loopback HTTP'), { status: 400 });
    const client = new JevClient({ apiKey: key, apiBase, model: body.model, provider, allowAnonymous: body.allowAnonymous === true, timeoutMs: 8_000, maxRetries: 0 });
    const started = performance.now();
    const probe = { ping: { type: 'noul', instructions: 'Does the state contain a connection check? Return a probability.' } };
    const result = await client.ask({ state: { check: 'Jev Flow connection check. No sensitive information.' }, questions: probe });
    const config = connectJev({ apiKey: key, apiBase, model: result.model || body.model, provider, allowAnonymous: body.allowAnonymous === true });
    return json(res, { ...config, modelo: result.model || body.model, latencia_ms: Math.round(performance.now()-started) });
  }
  if (p === '/api/jev/disconnect' && method === 'POST') return json(res, disconnectJev());
  if (p === '/api/jev/llm/connect' && method === 'POST') return json(res, configureLLM({ apiKey: body.apiKey, baseUrl: body.baseUrl, model: body.model }));
  if (p === '/api/jev/laya/warmup' && method === 'POST') return json(res, await aquecerLaya());
  if (p === '/api/translate' && method === 'POST') {
    const texts = [String(body.text || '')];
    if (!texts[0]) throw Object.assign(new Error('text is required'), { status: 400 });
    return json(res, { translation: (await translate(texts, String(body.to || 'pt-BR'), String(body.from || 'auto')))[0] });
  }
  if (p === '/api/translate/batch' && method === 'POST') {
    if (!Array.isArray(body.texts) || body.texts.length > 100) throw Object.assign(new Error('texts must be an array of up to 100 strings'), { status: 400 });
    return json(res, { translations: await translate(body.texts, String(body.to || 'en'), String(body.from || 'auto')) });
  }
  if (p === '/api/jev/rulesets' && method === 'POST') {
    const id = String(body.id || '').trim();
    const content = String(body.content || '');
    if (!/^[a-z][a-z0-9_-]{2,40}$/u.test(id) || !content || content.length > 100_000) throw Object.assign(new Error('provide a safe id and source text (max 100 KB)'), { status: 400 });
    const rules = extrairRegrasDeConteudo(body.filename || 'policy.md', content).slice(0,250).map((rule, index) => ({ id: `rule-${index+1}`, ...rule }));
    if (!rules.length) throw Object.assign(new Error('no rules found in source text'), { status: 400 });
    mkdirSync(RULESETS_DIR, { recursive: true });
    const ruleset = { schema: 'jev-ruleset/1', id, nome: String(body.name || id), origem: body.filename || 'policy.md',
      criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), stats: { arquivos: 1, regras: rules.length, caracteres: rules.reduce((sum, rule) => sum + rule.texto.length, 0) }, regras };
    const { createHash } = await import('node:crypto'); ruleset.hash = createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0,16);
    writeFileSync(joinPath(RULESETS_DIR, `${id}.ruleset.json`), JSON.stringify(ruleset,null,2));
    return json(res, { ruleset }, 201);
  }
  if (p === '/api/jev/flows' && method === 'POST') {
    const flow = body.flow || body;
    const validation = validateFlow(flow);
    if (!validation.ok) return json(res, { validacao: validation }, 422);
    const stored = persistFlow(flow);
    if (!stored.ok) return json(res, stored, stored.status);
    return json(res, { flow, validacao: validation }, 201);
  }
  if (p === '/api/jev/flows/import' && method === 'POST') {
    const flow = body.flow;
    const validation = validateFlow(flow);
    if (!validation.ok) return json(res, { validacao: validation }, 422);
    const stored = persistFlow(flow);
    if (!stored.ok) return json(res, stored, stored.status);
    return json(res, { flow, validacao: validation }, 201);
  }
  const catalogRoute = p.match(/^\/api\/jev\/flows\/compendium\/(install|validate|simulate|simulate-batch|duplicate)$/u);
  if (catalogRoute) {
    if (catalogRoute[1] === 'install' && method === 'POST') {
      const item = requireCatalogItem(body); const stored = persistFlow(item.flow); if (!stored.ok) return json(res, stored, stored.status); return json(res, { id: item.flow.id, name: item.flow.name, flow: item.flow }, 201);
    }
    if (catalogRoute[1] === 'validate' && method === 'POST') { const item=requireCatalogItem(body); return json(res,{ok:item.validacao.ok,nodeCount:item.nodeCount,errors:item.validacao.errors}); }
    if (catalogRoute[1] === 'simulate' && method === 'POST') { const item=requireCatalogItem(body); return json(res,await simulatePreviewFlow(item.flow,body.input,body.answers)); }
    if (catalogRoute[1] === 'simulate-batch' && method === 'POST') { const item=requireCatalogItem(body); return json(res,await simularBateria(item.flow,{inputs:body.inputs})); }
    if (catalogRoute[1] === 'duplicate' && method === 'POST') { const item=requireCatalogItem(body); const flow=structuredClone(item.flow); flow.id=String(body.newId||`${flow.id}-copy`).slice(0,40); flow.name=`${flow.name} copy`; const stored=persistFlow(flow); if(!stored.ok)return json(res,stored,stored.status); return json(res,{flow},201); }
  }
  if (p === '/api/jev/flows/compendium/install-bulk' && method === 'POST') {
    if (!Array.isArray(body.items) || body.items.length > 200) throw Object.assign(new Error('items must contain at most 200 configurations'), { status: 400 });
    let installed=0; const skipped=[],errors=[];
    for (const key of body.items) try { const item=requireCatalogItem(key); if (existsSync(join(JEV_DATA_DIR,'flows',`${item.id}.flow.json`))) skipped.push(item.id); else { const stored=persistFlow(item.flow); if(stored.ok)installed++; else errors.push({key,error:stored.error||'flow failed validation'}); } } catch(e) { errors.push({key,error:e.message}); }
    return json(res,{installed,skipped,errors});
  }
  if (p === '/api/jev/flows/design' && method === 'POST') return json(res, await designFlow(body));
  const flowRoute = p.match(/^\/api\/jev\/flows\/([a-z][a-z0-9_-]{2,40})(?:\/(.*))?$/u);
  if (flowRoute) {
    const id=flowRoute[1], action=flowRoute[2]||'';
    if (method==='GET' && !action) return json(res,loadFlow(id));
    if (method==='PUT' && !action) { const flow=body.flow || body; flow.id=id; const validation=validateFlow(flow); if(!validation.ok)return json(res,{validacao:validation},422); const result=saveFlow(flow); if(!result.salvo)return json(res,{validacao:result.validacao},422); return json(res,{flow,validacao:validation}); }
    if (method==='DELETE' && !action) return json(res,{deleted:deleteFlow(id)});
    if (method==='POST' && action==='validate') { const flow=body.flow||loadFlow(id); return json(res,validateFlow(flow)); }
    if (method==='POST' && action==='run') { const flow=loadFlow(id); const isSimulation=body.mode==='simulate'||body.simulate===true; return json(res,isSimulation?await simulatePreviewFlow(flow,normalizeInput(body.input),body.answers):await runFlow(flow,normalizeInput(body.input),{gravar:true})); }
    if (method==='POST' && action==='simulate') { const flow=loadFlow(id); return json(res,await simularBateria(flow,{inputs:body.inputs})); }
    if (method==='POST' && action==='assist') return json(res,await assistFlow({flow:body.flow||loadFlow(id),message:body.message}));
    if (method==='POST' && action==='schedule') return json(res,await scheduleFlow({flowId:id,schedule:body.schedule,input:body.input,ativo:body.ativo!==false}));
    if (method==='POST' && action==='duplicate') { const flow=structuredClone(loadFlow(id)); const base=String(body.newId||`${id}-copy`).slice(0,34); flow.id=base; let suffix=2; while(existsSync(flowPath(flow.id)) && suffix<10000){flow.id=`${base.slice(0,40-String(suffix).length-1)}-${suffix++}`;} flow.name=`${flow.name} copy`; const stored=persistFlow(flow); if(!stored.ok)return json(res,stored,stored.status); return json(res,{flow},201); }
    if (method==='GET' && action==='runs') return json(res,{runs:listRuns(id,{limit:Number(url.searchParams.get('limit'))||20})});
  }
  if (p === '/api/jev/flows/validate' && method === 'POST') return json(res,validateFlow(body.flow||body));
  if (p === '/api/jev/battle/race' && method === 'POST') return json(res,await runArenaRace(body));
  if (p === '/api/jev/battle/test-run' && method === 'POST') {
    const test=TESTES.find(entry=>entry.id===body.testId||entry.id===body.id);
    if(!test) throw Object.assign(new Error('arena test not found'),{status:404});
    return json(res,await runArenaTest(test,{model:body.model,jevEngine:body.jevEngine||'typesafe',jevAvailable:isJevConfigured}));
  }
  if (p === '/api/jev/battle/stream' && method === 'POST') {
    res.writeHead(200,{ 'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive' });
    const controller=new AbortController(); res.on('close',()=>controller.abort());
    const event=(name,data)=>{ if(!res.destroyed)res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); };
    try { await runBattleStream({...body,signal:controller.signal,onJevJudgment:d=>event('jev_judgment',d),onJevDone:d=>event('jev_done',d),onLlmToken:d=>event('llm_token',{text:d}),onLlmDone:d=>event('llm_done',d),onComparativo:d=>event('comparativo',d)}); event('complete',{ok:true}); }
    catch(error){event('error',errorBody(error));}
    res.end(); return;
  }
  if (p === '/api/jev/battle' && method === 'POST') return json(res,await runBattle(body));
  if (p === '/api/jev/labs/step' && method === 'POST') { debitLabs(body); return json(res,await runLabStep(body)); }
  if (p === '/api/jev/decide' && method === 'POST') return json(res,await handleJevDecision(body));
  if (p === '/api/jev/llm-decide' && method === 'POST') return json(res,await handleLlmDecision(body));
  throw Object.assign(new Error('API route not found'), { status: 404 });
}

const languageList = [
  ['en','English','English'],['pt-BR','Português (Brasil)','Português (Brasil)'],['es','Spanish','Español'],['fr','French','Français'],
  ['de','German','Deutsch'],['it','Italian','Italiano'],['ja','Japanese','日本語'],['ko','Korean','한국어'],['zh-CN','Chinese (Simplified)','简体中文'],
  ['zh-TW','Chinese (Traditional)','繁體中文'],['ar','Arabic','العربية'],['hi','Hindi','हिन्दी'],['ru','Russian','Русский'],['nl','Dutch','Nederlands'],
  ['pl','Polish','Polski'],['tr','Turkish','Türkçe'],['uk','Ukrainian','Українська'],['id','Indonesian','Bahasa Indonesia'],
  ['sv','Swedish','Svenska'],['vi','Vietnamese','Tiếng Việt'],['th','Thai','ไทย'],['he','Hebrew','עברית'],['fa','Persian','فارسی'],
].map(([code,name,native])=>({code,name,native}));

const server = createServer((req,res)=>{
  route(req,res).catch(error=>{ if(!res.headersSent)json(res,errorBody(error),error.status || (error.code === 'NOT_FOUND' ? 404 : 500)); else res.end(); });
});
setScheduleRunner(async task=>{ if(task.kind==='jev_flow') await executarAgendado(task.params); });
const displayHost = HOST.includes(':') ? `[${HOST}]` : HOST;
server.listen(PORT,HOST,()=>process.stdout.write(`Jev Flow standalone listening at http://${displayHost}:${PORT}\nData directory: ${JEV_DATA_DIR}\n`));
