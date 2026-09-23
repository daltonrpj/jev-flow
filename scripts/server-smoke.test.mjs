import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let child;
let baseUrl;
let dataDirectory;
let isolatedEnv;
let output = '';

async function freePort(host = '127.0.0.1') {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, host, resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function statusWithHost(baseUrl, path, host) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, baseUrl), { headers: { host } }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  dataDirectory = mkdtempSync(join(tmpdir(), 'jev-flow-smoke-'));
  isolatedEnv = { ...process.env, HOST: '127.0.0.1', PORT: String(port), JEVFLOW_DATA_DIR: dataDirectory,
    TYPESAFE_API_KEY: '', OPENJEV_API_KEY: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
    JEVFLOW_LLM_API_KEY: '', JEVFLOW_LLM_BASE_URL: '', JEVFLOW_LLM_MODEL: '' };
  delete isolatedEnv.JEVFLOW_PUBLIC_ORIGIN;
  child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: isolatedEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before health check: ${output}`);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`server health timeout: ${output}`);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
  if (dataDirectory?.startsWith(tmpdir()) && dataDirectory.includes('jev-flow-smoke-')) {
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('standalone server opens the Studio, protects local mutations and fulfills runtime contracts', async () => {
  const remoteAttempt = spawnSync(process.execPath, ['server.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...isolatedEnv, HOST: '0.0.0.0', PORT: '18723', JEVFLOW_SERVER_TOKEN: 'test-only-token' },
  });
  assert.notEqual(remoteAttempt.status, 0, 'private Studio pages must not be exposed on a remote bind');
  assert.match(remoteAttempt.stderr || remoteAttempt.stdout, /Refusing non-loopback bind/u);
  const rootResponse = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.get('location'), '/jev/flows');
  for (const path of ['/assets/mark.svg', '/examples/support-triage.flow.json', '/catalog-certification.json', '/docs/quickstart.md', '/media/studio-screenshot.png']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
  }
  assert.equal((await fetch(`${baseUrl}/site/index.html`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/media/..%2Fserver.mjs`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/assets/.env`)).status, 404);
  const certificate = await (await fetch(`${baseUrl}/catalog-certification.json`)).json();
  assert.equal(certificate.validCount, 388080);
  const studioResponse = await fetch(`${baseUrl}/jev/flows?lang=en`);
  assert.equal(studioResponse.status, 200);
  const studioHtml = await studioResponse.text();
  const inlineScripts = [...studioHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter(([, attributes]) => !/\bsrc\s*=|\btype\s*=\s*["'](?:application\/(?:json|ld\+json)|importmap)["']/iu.test(attributes));
  assert.ok(inlineScripts.length > 0, 'Studio page should contain client behaviour');
  for (const [index, match] of inlineScripts.entries()) {
    assert.doesNotThrow(() => new Script(match[2], { filename: `jev-flow-studio-inline-${index}.js` }), `Studio inline script ${index} parses`);
  }
  const maliciousModel = '</script><script>window.__jevflowPwned=true</script>';
  const maliciousApiBase = 'https://example.invalid/</script><script>window.__jevflowApiPwned=true</script>';
  const previousDataDir = process.env.JEVFLOW_DATA_DIR;
  process.env.JEVFLOW_DATA_DIR = dataDirectory;
  try {
    const [{ buildFlowsIndexPage }, { connectJev, disconnectJev }] = await Promise.all([
      import('../services/jev-flow/demo-page.mjs'), import('../services/jev/connection.mjs'),
    ]);
    connectJev({ apiKey: 'smoke-test-key', apiBase: maliciousApiBase, model: maliciousModel });
    const hostileConnectionHtml = await buildFlowsIndexPage({ locale: 'en' });
    assert.equal(hostileConnectionHtml.includes(maliciousModel), false, 'untrusted model text cannot terminate the Studio script element');
    assert.equal(hostileConnectionHtml.includes(maliciousApiBase), false, 'untrusted endpoint text cannot terminate the Studio script element');
    assert.doesNotMatch(hostileConnectionHtml, /<\/script><script>window\.__jevflow(?:Api)?Pwned=true/iu);
    disconnectJev();
  } finally {
    if (previousDataDir === undefined) delete process.env.JEVFLOW_DATA_DIR;
    else process.env.JEVFLOW_DATA_DIR = previousDataDir;
  }
  const media = await fetch(`${baseUrl}/media/jev-flow-walkthrough.webm`, { method: 'HEAD' });
  assert.equal(media.status, 200, 'the final walkthrough must be included in the standalone checkout');
  assert.match(media.headers.get('content-type') || '', /^video\/webm/u);
  const videoBytes = readFileSync(join(root, 'media', 'jev-flow-walkthrough.webm'));
  const range = await fetch(`${baseUrl}/media/jev-flow-walkthrough.webm`, { headers: { range: 'bytes=1000-1099' } });
  assert.equal(range.status, 206, 'video seek requests should return a partial response');
  assert.equal(range.headers.get('accept-ranges'), 'bytes');
  assert.equal(range.headers.get('content-range'), `bytes 1000-1099/${videoBytes.length}`);
  assert.equal(range.headers.get('content-length'), '100');
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), videoBytes.subarray(1000, 1100));
  const suffix = await fetch(`${baseUrl}/media/jev-flow-walkthrough.webm`, { headers: { range: 'bytes=-64' } });
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get('content-range'), `bytes ${videoBytes.length - 64}-${videoBytes.length - 1}/${videoBytes.length}`);
  assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), videoBytes.subarray(-64));
  const invalidRange = await fetch(`${baseUrl}/media/jev-flow-walkthrough.webm`, { headers: { range: `bytes=${videoBytes.length}-` } });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('content-range'), `bytes */${videoBytes.length}`);
  const transcript = await fetch(`${baseUrl}/media/jev-flow-walkthrough-transcript.md`, { method: 'HEAD' });
  assert.equal(transcript.status, 200);
  assert.match(transcript.headers.get('content-type') || '', /^text\/markdown(?:;|$)/u);
  const captions = await fetch(`${baseUrl}/media/jev-flow-walkthrough.vtt`, { method: 'HEAD' });
  assert.equal(captions.status, 200);
  assert.match(captions.headers.get('content-type') || '', /^text\/vtt/u);
  assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
  const languageResponse = await fetch(`${baseUrl}/api/translate/languages`);
  const languageBody = await languageResponse.json();
  assert.ok(languageBody.languages.some(language => language.code === 'en'));

  const statsResponse = await fetch(`${baseUrl}/api/jev/flows/compendium/stats`);
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.total, 388080);
  assert.equal((await fetch(`${baseUrl}/jev/flows/compendium?lang=en`)).status, 200);

  const fixture = JSON.parse(readFileSync(join(root, 'examples', 'spam-screening.flow.json'), 'utf8'));
  fixture.id = 'smoke-flow';
  fixture.name = 'HTTP smoke flow';
  const malicious = await fetch(`${baseUrl}/api/jev/flows`, {
    method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify(fixture),
  });
  assert.equal(malicious.status, 403);
  const plainText = await fetch(`${baseUrl}/api/jev/flows`, {
    method: 'POST', headers: { origin: baseUrl, 'content-type': 'text/plain' }, body: JSON.stringify(fixture),
  });
  assert.equal(plainText.status, 415);

  const headers = { origin: baseUrl, 'content-type': 'application/json' };
  const created = await fetch(`${baseUrl}/api/jev/flows`, { method: 'POST', headers, body: JSON.stringify(fixture) });
  const createdPayload = await created.json();
  if (created.status !== 201) throw new Error(`flow create failed: ${JSON.stringify(createdPayload)}`);
  assert.equal(createdPayload.flow.id, 'smoke-flow');
  for (const path of ['/', '/jev/flows/smoke-flow/demo']) {
    const status = await statusWithHost(baseUrl, path, `evil.example:${new URL(baseUrl).port}`);
    assert.equal(status, 403, `reject DNS-rebinding Host on ${path}`);
  }
  const duplicateOne = await fetch(`${baseUrl}/api/jev/flows/smoke-flow/duplicate`, { method: 'POST', headers, body: '{}' });
  const duplicateTwo = await fetch(`${baseUrl}/api/jev/flows/smoke-flow/duplicate`, { method: 'POST', headers, body: '{}' });
  const duplicateOnePayload = await duplicateOne.json();
  const duplicateTwoPayload = await duplicateTwo.json();
  if (duplicateOne.status !== 201 || duplicateTwo.status !== 201) throw new Error(`flow duplicate failed: ${JSON.stringify([duplicateOnePayload, duplicateTwoPayload])}`);
  assert.equal(duplicateOnePayload.flow.id, 'smoke-flow-copy');
  assert.equal(duplicateTwoPayload.flow.id, 'smoke-flow-copy-2');

  const page = await (await fetch(`${baseUrl}/api/jev/flows/compendium?limit=1`)).json();
  const item = page.items[0];
  assert.ok(item?.id);
  const install = await fetch(`${baseUrl}/api/jev/flows/compendium/install`, {
    method: 'POST', headers, body: JSON.stringify(item),
  });
  assert.equal(install.status, 201, JSON.stringify(await install.clone().json()));
  assert.equal((await install.json()).flow.id, item.id);
  const installAgain = await fetch(`${baseUrl}/api/jev/flows/compendium/install`, {
    method: 'POST', headers, body: JSON.stringify(item),
  });
  assert.equal(installAgain.status, 409);
  assert.equal((await fetch(`${baseUrl}/api/jev/flows/missing-flow`)).status, 404);
});

test('all five product surfaces and read-only status contracts work without provider keys', async () => {
  for (const path of ['/jev/flows', '/jev/flows/compendium', '/jev/battle', '/jev/carrinho', '/jev/labs']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /^text\/html/u, path);
  }
  for (const [path, expectedSource] of [
    ['/jev/labs/assets/ui.mjs', "from '/jev/labs/assets/engine.mjs'"],
    ['/jev/labs/assets/engine.mjs', 'export function spamPolicy'],
    ['/jev/labs/assets/chess.mjs', 'export function createChessGame'],
  ]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') || '', /^text\/javascript/u, path);
    assert.ok((await response.text()).includes(expectedSource), path);
  }
  const labs = await (await fetch(`${baseUrl}/api/jev/labs/status`)).json();
  assert.equal(labs.jevConfigured, false);
  assert.equal(labs.llmConfigured, false);
  const tests = await (await fetch(`${baseUrl}/api/jev/battle/tests`)).json();
  assert.ok(Array.isArray(tests) && tests.length > 0);
  const catalog = await (await fetch(`${baseUrl}/api/jev/flows/compendium/stats`)).json();
  assert.equal(catalog.total, 388080);
});

test('IPv6 loopback requests use a valid bracketed authority', async t => {
  let port;
  try { port = await freePort('::1'); }
  catch { return t.skip('IPv6 loopback is unavailable on this host'); }
  const ipv6Base = `http://[::1]:${port}`;
  const ipv6Child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, windowsHide: true,
    env: { ...isolatedEnv, HOST: '::1', PORT: String(port), JEVFLOW_DATA_DIR: join(dataDirectory, 'ipv6') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  ipv6Child.stderr.setEncoding('utf8');
  let stderr = '';
  ipv6Child.stderr.on('data', chunk => stderr += chunk);
  try {
    let response;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (ipv6Child.exitCode !== null) throw new Error(`IPv6 server exited: ${stderr}`);
      try { response = await fetch(`${ipv6Base}/api/health`); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 125));
    }
    assert.equal(response?.status, 200);
    const rootPage = await fetch(`${ipv6Base}/`, { redirect: 'manual' });
    assert.equal(rootPage.status, 302);
    assert.equal(rootPage.headers.get('location'), '/jev/flows');
    assert.equal((await fetch(`${ipv6Base}/jev/flows`)).status, 200);
  } finally {
    if (ipv6Child.exitCode === null) {
      ipv6Child.kill();
      await new Promise(resolve => ipv6Child.once('exit', resolve));
    }
  }
});
