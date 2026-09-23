import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('six clean local-app screenshots match documented routes, dimensions and hashes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../media/screenshots-manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.capture.locale, 'en');
  assert.equal(manifest.screenshots.length, 6);
  assert.deepEqual(new Set(manifest.screenshots.map(item => item.file)), new Set([
    'studio-screenshot.png', 'compendium-screenshot.png', 'arena-screenshot.png',
    'carrinho-screenshot.png', 'labs-screenshot.png', 'chess-screenshot.png',
  ]));
  for (const item of manifest.screenshots) {
    assert.match(item.route, /^\/jev\//);
    assert.match(item.state, /./);
    const png = await readFile(new URL(`../media/${item.file}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), item.width);
    assert.equal(png.readUInt32BE(20), item.height);
    assert.equal(createHash('sha256').update(png).digest('hex'), item.sha256);
  }
});
