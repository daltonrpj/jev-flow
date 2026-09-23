import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { buildCompendiumPage } from './compendium-page.mjs';
import { buildCarrinhoPage } from './carrinho-page.mjs';
import { catalogStats, queryCatalog } from './compendium-catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('English Compendium and driving pages retain valid scripts and Portuguese defaults', async () => {
  const compendiumEn = await buildCompendiumPage({ locale: 'en' });
  const compendiumPt = await buildCompendiumPage();
  const drivingEn = buildCarrinhoPage({ locale: 'en', llmModels: ['example/model'] });
  const drivingPt = buildCarrinhoPage({ llmModels: ['example/model'] });
  for (const page of [compendiumEn, drivingEn]) {
    assert.match(page, /<html lang="en">/);
    assert.doesNotMatch(page, /@@MODEL_OPTIONS@@|@@PRNG@@/);
    const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    new Script(script);
  }
  assert.match(compendiumEn, /Search: guardrail, ETL, quality/);
  assert.match(compendiumEn, /Install items on this page/);
  assert.match(compendiumEn, /\/jev\/flows\?lang=en/);
  assert.match(drivingEn, /Live statistics/);
  assert.match(drivingEn, /Waiting for the first decision/);
  assert.match(drivingEn, /<option value="example\/model">example\/model<\/option>/);
  assert.match(compendiumPt, /<html lang="pt-BR">/);
  assert.match(compendiumPt, /Buscar: suporte/);
  assert.match(drivingPt, /<html lang="pt-BR">/);
  assert.match(drivingPt, /Estatísticas ao vivo/);
});

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  if (process.env.JEV_TEST_PLAYWRIGHT_MODULE)
    ({ chromium } = await import(pathToFileURL(process.env.JEV_TEST_PLAYWRIGHT_MODULE).href));
}

test('English Labs translates initial controls and changing chess labels',
  { skip: !chromium && 'Playwright unavailable' }, async () => {
  const assets = new Map([
    ['/jev/labs', ['labs-page.html', 'text/html; charset=utf-8']],
    ['/jev/labs/assets/ui.mjs', ['labs-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/jev/labs/assets/engine.mjs', ['labs-engine.mjs', 'text/javascript; charset=utf-8']],
    ['/jev/labs/assets/chess.mjs', ['labs-chess-engine.mjs', 'text/javascript; charset=utf-8']],
  ]);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/jev/flows/compendium' || pathname === '/jev/carrinho') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(pathname.endsWith('compendium')
        ? await buildCompendiumPage({ locale: url.searchParams.get('lang') })
        : buildCarrinhoPage({ locale: url.searchParams.get('lang') }));
      return;
    }
    if (pathname === '/api/jev/flows/compendium/stats' || pathname === '/api/jev/flows/compendium') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(pathname.endsWith('stats')
        ? catalogStats() : queryCatalog({ limit: 4, offset: 0 })));
      return;
    }
    if (pathname === '/api/jev/decide') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        source: 'deterministic', backend: 'local-code', latencyMs: 1,
        decision: { lane_action: 'keep_lane', speed_action: 'hold' },
        fallbackReason: 'jev: JEV não configurado',
      }));
      return;
    }
    if (pathname === '/api/jev/battle/models' || pathname === '/api/jev/labs/status') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(pathname.endsWith('models') ? '[]' : '{"jevConfigured":false,"remoteUnitsRemaining":120}');
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': asset[1] });
    response.end(await readFile(join(here, asset[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/jev/labs?lang=en');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('h1').innerText(), 'Watch judgment become action.');
    assert.equal(await page.locator('#labTitle').innerText(), 'Spam radar');
    assert.equal(await page.locator('#spamRun').innerText(), '▶ Analyze message');
    assert.equal(await page.locator('.sample').first().innerText(), 'Fake prize');
    await page.locator('.lab-tab[data-lab="chess"]').click();
    assert.equal(await page.locator('#chessBanner').innerText(), 'White to move · game in progress');
    assert.match(await page.locator('[data-square="e2"]').getAttribute('aria-label'), /Square e2 · white pawn/);
    await page.locator('[data-square="e2"]').click();
    assert.match(await page.locator('[data-square="e4"]').getAttribute('aria-label'), /legal destination/);
    await page.locator('[data-square="e4"]').click();
    assert.equal(await page.locator('#chessBanner').innerText(), 'Black to move · game in progress');
    await page.locator('#chessReset').click();
    assert.equal(await page.locator('#chessEvent').innerText(), 'New game.');
    await page.locator('.lab-tab[data-lab="blast"]').click();
    assert.equal(await page.locator('#blastStatus').innerText(), 'PLAYING');
    assert.match(await page.locator('#blastAuto').innerText(), /up to 40 turns/);
    assert.match(await page.locator('#labSubtitle').innerText(), /bombs, damage and victory/);
    assert.equal(await page.locator('#blastEvent').innerText(), 'Find crystals and clear a path with bombs.');
    await page.locator('[data-blast-action="wait"]').click();
    assert.equal(await page.locator('#blastEvent').innerText(), 'Waited one turn.');
    await page.locator('.lab-tab[data-lab="rescue"]').click();
    assert.equal(await page.locator('#rescueRun').innerText(), '▶ Triage incident');
    await page.locator('.lab-tab[data-lab="evidence"]').click();
    assert.equal(await page.locator('#evidenceRun').innerText(), '▶ Verify claim');
    await page.goto('http://127.0.0.1:' + server.address().port + '/jev/flows/compendium?lang=en');
    await page.locator('#rows .desc').first().waitFor();
    assert.match(await page.locator('#rows tr').first().innerText(), /Intelligent Triage · customer support/);
    assert.match(await page.locator('#rows tr .desc').first().innerText(), /Classifies customer support input/);
    assert.doesNotMatch(await page.locator('#rows tr .desc').first().innerText(), /Política|Limiar|orçamento/);
    assert.match(await page.locator('#rows tr').nth(3).innerText(), /customer support \/ complaints/);
    assert.doesNotMatch(await page.locator('#rows tr').nth(3).innerText(), /compinformation accessnts/);
    await page.locator('#f-domain').selectOption('suporte');
    assert.match(await page.locator('#f-focus').innerText(), /complaints/);
    const patternItems = catalogStats().patterns.map(pattern =>
      queryCatalog({ pattern: pattern.id, limit: 1 }).items[0]);
    const descriptions = await page.evaluate(items => items.map(item => catalogDescription(item)), patternItems);
    assert.equal(descriptions.length, 22);
    for (const description of descriptions) {
      assert.match(description, /Policy: Apply the configured rules/);
      assert.match(description, /Input limit for this focus: \d+ tokens\./);
      assert.doesNotMatch(description, /Política:|Limiar |orçamento |composição |Limite de entrada/);
    }
    await page.goto('http://127.0.0.1:' + server.address().port + '/jev/carrinho?lang=en');
    await page.locator('input[value="jev-only"]').check();
    assert.equal(await page.locator('#reset').innerText(), '↻ Restart (R)');
    assert.equal(await page.locator('#answerJ').innerText(), 'Waiting for the first decision.');
    await page.waitForFunction(() => document.querySelector('#answerJ')?.textContent.includes('JEV is not configured'));
    assert.doesNotMatch(await page.locator('#answerJ').innerText(), /não configurado/);
    assert.match(await page.locator('#error').innerText(), /JEV is not configured/);
    assert.match(await page.locator('#log').innerText(), /JEV is not configured/);
    await page.locator('#pause').click();
    assert.equal(await page.locator('#pause').innerText(), 'Resume');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
