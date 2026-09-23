import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function status(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(path, base), { method, headers }, res => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.end(body);
  });
}

test('HTTPS reverse proxy mode requires canonical origin, exact Host/Origin and loopback bind', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'jev-flow-proxy-'));
  const publicOrigin = 'https://flow.example.org';
  const publicHost = 'flow.example.org';
  const safeEnv = { ...process.env, HOST: '127.0.0.1', PORT: String(await freePort()),
    JEVFLOW_DATA_DIR: dataDir, TYPESAFE_API_KEY: '', OPENJEV_API_KEY: '',
    OPENAI_API_KEY: '', GEMINI_API_KEY: '', JEVFLOW_LLM_API_KEY: '',
    JEVFLOW_LLM_BASE_URL: '', JEVFLOW_LLM_MODEL: '' };
  delete safeEnv.JEVFLOW_PUBLIC_ORIGIN;
  for (const overrides of [
    { JEVFLOW_PUBLIC_ORIGIN: 'http://flow.example.org' },
    { JEVFLOW_PUBLIC_ORIGIN: publicOrigin, HOST: 'localhost' },
  ]) {
    const result = spawnSync(process.execPath, ['server.mjs'], {
      cwd: root, env: { ...safeEnv, ...overrides }, encoding: 'utf8', timeout: 10_000,
    });
    assert.notEqual(result.status, 0, 'invalid public proxy configuration must refuse startup');
    assert.match(result.stderr || result.stdout, /JEVFLOW_PUBLIC_ORIGIN/u);
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: root, env: { ...safeEnv, PORT: String(port), JEVFLOW_PUBLIC_ORIGIN: publicOrigin },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => output += chunk);
  child.stderr.on('data', chunk => output += chunk);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('proxy-mode server exited: ' + output);
      try {
        ready = (await status(base, '/api/health', { headers: { host: publicHost } })) === 200;
        if (ready) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'proxy-mode server did not start: ' + output);
    assert.equal(await status(base, '/', { headers: { host: publicHost } }), 200);
    assert.equal(await status(base, '/styles.css', { headers: { host: publicHost } }), 200);
    assert.equal(await status(base, '/jev/flows', { headers: { host: publicHost } }), 200);
    assert.equal(await status(base, '/api/health', { headers: {
      host: 'evil.example.org', 'x-forwarded-host': publicHost, 'x-forwarded-proto': 'https'
    } }), 403);
    assert.equal(await status(base, '/api/health', { headers: { host: `127.0.0.1:${port}` } }), 403);
    assert.equal(await status(base, '/api/health', { headers: { host: publicHost, origin: 'http://flow.example.org' } }), 403);
    assert.equal(await status(base, '/api/health', { headers: { host: publicHost, origin: 'https://other.example.org' } }), 403);
    const mutation = { method: 'POST', body: '{}',
      headers: { host: publicHost, origin: publicOrigin, 'content-type': 'application/json' } };
    assert.equal(await status(base, '/api/jev/flows', mutation), 422);
    assert.equal(await status(base, '/api/jev/flows', {
      ...mutation, headers: { host: publicHost, 'content-type': 'application/json' }
    }), 403, 'public mutations without Origin are rejected');
    assert.equal(await status(base, '/api/jev/flows', {
      ...mutation, headers: { ...mutation.headers, origin: 'https://other.example.org' }
    }), 403);
    assert.equal(await status(base, '/api/jev/flows', {
      ...mutation, headers: { ...mutation.headers, 'x-forwarded-host': 'evil.example.org',
        'x-forwarded-proto': 'http' }
    }), 422, 'forwarded headers do not affect authorization');
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
