import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  if (process.env.JEV_TEST_PLAYWRIGHT_MODULE)
    ({ chromium } = await import(pathToFileURL(process.env.JEV_TEST_PLAYWRIGHT_MODULE).href));
}

const here = dirname(fileURLToPath(import.meta.url));

async function readAsset(localName) { return readFile(join(here, localName)); }

test('chess board exposes legal state, keyboard controls and responsive piece art',
  { skip: !chromium && 'Playwright não instalado; defina JEV_TEST_PLAYWRIGHT_MODULE para o index.mjs' }, async () => {
  const assets = new Map([
    ['/jev/labs', ['labs-page.html', 'text/html; charset=utf-8']],
    ['/jev/labs/assets/ui.mjs', ['labs-ui.mjs', 'text/javascript; charset=utf-8']],
    ['/jev/labs/assets/engine.mjs', ['labs-engine.mjs', 'text/javascript; charset=utf-8']],
    ['/jev/labs/assets/chess.mjs', ['labs-chess-engine.mjs', 'text/javascript; charset=utf-8']]
  ]);
  const server = createServer(async (request, response) => {
    const path = request.url?.split('?')[0];
    if (path === '/api/jev/battle/models' || path === '/api/jev/labs/status') {
      response.writeHead(200, {'Content-Type':'application/json'});
      response.end(path.endsWith('models') ? '[]' : '{"jevConfigured":false}');
      return;
    }
    const entry = assets.get(path);
    if (!entry) { response.writeHead(404); response.end(); return; }
    try {
      const [file, type] = entry;
      response.writeHead(200, {'Content-Type':type});
      response.end(await readAsset(file));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:920}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port + '/jev/labs');
    await page.locator('.lab-tab[data-lab="chess"]').click();
    const board = page.locator('#chessBoard');
    assert.equal(await board.locator('.square').count(), 64);
    assert.equal(await board.locator('.piece-svg').count(), 32);
    assert.equal(await board.locator('.coord-file').count(), 8);
    assert.equal(await board.locator('.coord-rank').count(), 8);
    assert.match(await page.locator('#chessBanner').innerText(), /Brancas jogam/);
    await board.locator('[data-square="e2"]').click();
    assert.equal(await board.locator('.square.selected').count(), 1);
    assert.equal(await board.locator('.square.legal').count(), 2);
    assert.match(await board.locator('[data-square="e4"]').getAttribute('aria-label'), /destino legal/);
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.square), 'e3');
    await page.keyboard.press('Escape');
    assert.equal(await board.locator('.square.selected').count(), 0);
    await board.locator('[data-square="e2"]').click();
    await board.locator('[data-square="e4"]').click();
    assert.equal(await board.locator('.square.last-from').getAttribute('data-square'), 'e2');
    assert.equal(await board.locator('.square.last-to').getAttribute('data-square'), 'e4');
    assert.match(await page.locator('#chessLastMove').innerText(), /e2 → e4/);
    assert.match(await page.locator('#chessHistory').innerText(), /e2 → e4/);
    assert.match(await page.locator('#chessBanner').innerText(), /Pretas jogam/);
    await page.locator('#chessFlip').click();
    assert.equal(await board.locator('.square').first().getAttribute('data-square'), 'h1');
    assert.equal(await page.locator('#chessFlip').getAttribute('aria-pressed'), 'true');
    await page.locator('#chessReset').click();
    assert.equal(await board.locator('.square.last-to').count(), 0);
    assert.equal(await page.locator('#chessLastMove').innerText(), '—');
    for (const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']]) {
      await board.locator('[data-square="' + from + '"]').click();
      await board.locator('[data-square="' + to + '"]').click();
    }
    assert.match(await page.locator('#chessBanner').innerText(), /Xeque-mate · Pretas vencem/);
    assert.equal(await board.locator('.square.check').getAttribute('data-square'), 'e1');
    assert.equal(await page.locator('#chessStep').isDisabled(), true);
    await page.setViewportSize({width:390,height:844});
    const width = await board.evaluate(element => element.getBoundingClientRect().width);
    assert.ok(width > 280 && width < 390, 'board fits narrow viewport: ' + width);
    if (process.env.CHESS_SCREENSHOT) await page.screenshot({path:process.env.CHESS_SCREENSHOT,fullPage:true});
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
});
