import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, copyFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { validateFlow } from '../services/jev-flow/engine.mjs';
import { catalogSourceFingerprint } from '../services/jev-flow/compendium-catalog.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('five root examples validate, contain fixtures, and cannot trigger external effects', () => {
  const names = readdirSync(join(root, 'examples')).filter(name => name.endsWith('.flow.json'));
  assert.deepEqual(names.sort(), [
    'anomaly-review.flow.json', 'interactive-labs.flow.json', 'refund-intake.flow.json',
    'spam-screening.flow.json', 'support-triage.flow.json',
  ]);
  for (const name of names) {
    const flow = JSON.parse(readFileSync(join(root, 'examples', name), 'utf8'));
    const validation = validateFlow(flow);
    assert.equal(validation.ok, true, `${name}: ${JSON.stringify(validation.errors)}`);
    assert.ok(flow.fixtures?.length > 0, `${name} needs a synthetic fixture`);
    for (const node of Object.values(flow.nodes)) {
      if (node.type.startsWith('action.')) assert.equal(node.type, 'action.log', name);
    }
  }
});

test('public guide and protected app retain the real walkthrough, English captions and readable source links', () => {
  assert.equal(existsSync(join(root, 'site', 'index.html')), true);
  assert.equal(existsSync(join(root, '.github', 'workflows', 'pages.yml')), true);
  assert.equal(existsSync(join(root, '.github', 'workflows', 'ci.yml')), true);
  for (const name of [
    'studio-screenshot.png', 'compendium-screenshot.png', 'arena-screenshot.png',
    'carrinho-screenshot.png', 'labs-screenshot.png', 'chess-screenshot.png',
    'jev-flow-walkthrough-teaser.gif', 'jev-flow-walkthrough-transcript.md',
    'jev-flow-walkthrough.vtt', 'jev-flow-walkthrough.webm',
  ]) {
    assert.equal(existsSync(join(root, 'media', name)), true, name);
  }
  assert.ok(statSync(join(root, 'media', 'jev-flow-walkthrough.webm')).size > 100_000);
  const gif = readFileSync(join(root, 'media', 'jev-flow-walkthrough-teaser.gif'));
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(gif.length > 100_000 && gif.length < 3_000_000, 'teaser should be substantial but small enough for README');
  for (const name of ['studio', 'compendium', 'arena', 'carrinho', 'labs', 'chess']) {
    assert.ok(statSync(join(root, 'media', `${name}-screenshot.png`)).size > 20_000, name);
  }
  const captions = readFileSync(join(root, 'media', 'jev-flow-walkthrough.vtt'), 'utf8');
  assert.match(captions, /^WEBVTT\r?\n/u);
  assert.doesNotMatch(captions, /\[music\]|\[unintelligible\]/iu);
  const cues = captions.trim().split(/\r?\n\s*\r?\n/u).slice(1).map(block => {
    const lines = block.split(/\r?\n/u);
    assert.match(lines[1], /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/u);
    assert.ok(lines.slice(2).length > 0 && lines.slice(2).length <= 2);
    assert.ok(lines.slice(2).every(line => line.length <= 70));
    return lines[1];
  });
  assert.equal(cues.length, 20);
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /media\/jev-flow-walkthrough\.webm/u);
  assert.match(readme, /media\/jev-flow-walkthrough-teaser\.gif/u);
  assert.match(readme, /GitHub Pages/u);
  assert.match(readme, /https:\/\/daltonrpj\.github\.io\/jev-flow\//u);
});

test('static guide uses real relative media, labels pre-run evidence, and never enables duplicate captions', () => {
  const html = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  const css = readFileSync(join(root, 'site', 'styles.css'), 'utf8');
  const js = readFileSync(join(root, 'site', 'main.js'), 'utf8');
  assert.match(html, /The decision[\s\S]*?boundary[\s\S]*?is visible/u);
  assert.match(html, /<video controls playsinline preload="none" poster="\.\/media\/studio-screenshot\.png"/u);
  assert.match(html, /<source src="\.\/media\/jev-flow-walkthrough\.webm" type="video\/webm"/u);
  assert.doesNotMatch(html, /<track\b/iu);
  assert.match(html, /href="\.\/media\/jev-flow-walkthrough\.vtt"/u);
  assert.match(html, /href="\.\/media\/jev-flow-walkthrough-transcript\.md"/u);
  assert.match(html, /id="watch"/u);
  assert.match(html, /id="install"/u);
  assert.match(html, /href="\.\/favicon\.svg"/u);
  assert.match(html, /ARENA \/ PRE-RUN[\s\S]*?TYPESAFE UNAVAILABLE/u);
  assert.match(html, /388,080[\s\S]*?not a count of authored flows, executed model runs/u);
  assert.match(css, /\.install-copy,\.install-workbench\{min-width:0\}/u);
  assert.match(css, /\.install\{grid-template-columns:minmax\(0,1fr\)\}/u);
  assert.match(css, /\.install-workbench pre\{white-space:pre-wrap;overflow-wrap:anywhere\}/u);
  for (const name of ['studio', 'compendium', 'arena', 'carrinho', 'labs', 'chess']) {
    assert.match(html, new RegExp(`src="\\./media/${name}-screenshot\\.png"`, 'u'));
  }
  for (const text of [html, css, js]) {
    assert.doesNotMatch(text, /English narration script is ready|video pending|verified asset not included/iu);
  }
  const links = [...html.matchAll(/(?:href|src)="\.\/([^"#?]+)"/gu)].map(match => match[1]);
  for (const link of links) {
    if (link.endsWith('/')) continue; // Locale routes are generated by site:build.
    const source = ['styles.css', 'main.js', 'favicon.svg'].includes(link) ? join(root, 'site', link) : join(root, link);
    assert.equal(existsSync(source), true, link);
  }
  assert.doesNotMatch(html, /https?:\/\/[^"\s]+\.(?:png|jpe?g|gif|svg|webp|css|js)/iu);
});

test('single-tenant proxy protects app root and media; CI and Pages jobs stay separate', () => {
  const nginx = readFileSync(join(root, 'deploy', 'nginx-jev-flow.conf'), 'utf8');
  const rootLocation = /location \/ \{\r?\n([\s\S]*?)\r?\n    \}/u.exec(nginx)?.[1] || '';
  assert.match(rootLocation, /auth_basic "JEV Flow"/u);
  assert.match(rootLocation, /include \/etc\/nginx\/snippets\/jev-flow-proxy\.conf/u);
  assert.doesNotMatch(nginx, /root \/opt\/jev-flow\/current\/site|auth_basic off;\s*root/u);
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm test/u);
  assert.match(ci, /catalog:certify -- --check/u);
  assert.doesNotMatch(ci, /deploy-pages|upload-pages|pages: write/u);
  const pages = readFileSync(join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(pages, /npm test/u);
  assert.match(pages, /catalog:certify -- --check/u);
  assert.match(pages, /npm run site:build/u);
  assert.match(pages, /upload-pages-artifact@v3[\s\S]*?path: site\/dist/u);
  assert.match(pages, /deploy-pages@v4/u);
});

test('root catalog certificate matches the generator and manifest, including across LF checkouts', () => {
  const certificate = JSON.parse(readFileSync(join(root, 'catalog-certification.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'services', 'jev-flow', 'compendium-catalog.manifest.json'), 'utf8'));
  assert.equal(certificate.scope, 'standalone');
  assert.equal(certificate.version, 'jev-flow-catalog-v3');
  assert.equal(certificate.passed, true);
  for (const key of ['candidateCount', 'validCount', 'uniqueKeys', 'uniqueIds']) assert.equal(certificate[key], 388080);
  assert.match(certificate.sourceFingerprint, /^[a-f0-9]{64}$/iu);
  assert.equal(certificate.sourceFingerprint, catalogSourceFingerprint());
  assert.equal(manifest.sourceFingerprint, certificate.sourceFingerprint);
  const sourceNames = ['compendium-catalog.mjs', 'compendium-expanded.mjs', 'engine.mjs', 'node-catalog.mjs'];
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'jev-flow-fingerprint-'));
  const lfCheckout = join(temporaryDirectory, 'lf-checkout');
  try {
    mkdirSync(lfCheckout);
    const sourceDirectory = join(root, 'services', 'jev-flow');
    for (const name of sourceNames) {
      const source = readFileSync(join(sourceDirectory, name), 'utf8');
      copyFileSync(join(sourceDirectory, name), join(temporaryDirectory, name));
      writeFileSync(join(lfCheckout, name), source.replace(/\r\n?/gu, '\n'));
    }
    assert.equal(catalogSourceFingerprint(pathToFileURL(`${temporaryDirectory}${sep}`)), certificate.sourceFingerprint);
    assert.equal(catalogSourceFingerprint(pathToFileURL(`${lfCheckout}${sep}`)), certificate.sourceFingerprint);
  } finally {
    if (temporaryDirectory.startsWith(tmpdir()) && temporaryDirectory.includes('jev-flow-fingerprint-')) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
});
