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
  assert.equal(existsSync(join(root, '.github', 'workflows', 'pages.yml')), false);
  assert.equal(existsSync(join(root, '.github', 'workflows', 'ci.yml')), true);
  for (const name of [
    'studio-screenshot.png', 'compendium-screenshot.png', 'arena-screenshot.png',
    'carrinho-screenshot.png', 'labs-screenshot.png', 'chess-screenshot.png',
    'jev-flow-walkthrough-teaser.gif', 'jev-flow-walkthrough-transcript.md',
    'jev-flow-walkthrough.vtt', 'jev-flow-walkthrough.webm',
    'jev-flow-deterministic-ai-explainer-en-poster.png', 'jev-flow-deterministic-ai-explainer-en-transcript.md',
    'jev-flow-deterministic-ai-explainer-en.json', 'jev-flow-deterministic-ai-explainer-en.vtt',
    'jev-flow-deterministic-ai-explainer-en.webm',
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
  assert.match(readme, /https:\/\/jevflow\.cloud\//u);

  const explainerVideo = statSync(join(root, 'media', 'jev-flow-deterministic-ai-explainer-en.webm'));
  const explainerPoster = readFileSync(join(root, 'media', 'jev-flow-deterministic-ai-explainer-en-poster.png'));
  const explainer = JSON.parse(readFileSync(join(root, 'media', 'jev-flow-deterministic-ai-explainer-en.json'), 'utf8'));
  const explainerCaptions = readFileSync(join(root, 'media', 'jev-flow-deterministic-ai-explainer-en.vtt'), 'utf8');
  assert.ok(explainerVideo.size > 10_000_000, 'the narrated explainer should contain the rendered app and audio');
  assert.equal(explainerPoster.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.match(explainerCaptions, /^WEBVTT\r?\n/u);
  const spokenCues = explainerCaptions.trim().split(/\r?\n\s*\r?\n/u).slice(1).map(block => {
    const lines = block.split(/\r?\n/u);
    assert.match(lines[1], /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/u);
    assert.ok(lines.slice(2).length > 0 && lines.slice(2).length <= 2);
    return lines.slice(2).join(' ');
  });
  assert.equal(spokenCues.length, 49);
  assert.equal(spokenCues.join(' '), explainer.turns.map(turn => turn.text).join(' '));
  assert.match(readme, /media\/jev-flow-deterministic-ai-explainer-en\.webm/u);
  assert.match(readme, /media\/jev-flow-deterministic-ai-explainer-en\.vtt/u);
});

test('static guide explains Jev Flow, embeds the tour, and keeps media references relative', () => {
  const html = readFileSync(join(root, 'site', 'index.html'), 'utf8');
  const css = readFileSync(join(root, 'site', 'styles.css'), 'utf8');
  const js = readFileSync(join(root, 'site', 'main.js'), 'utf8');
  assert.match(html, /Build AI workflows[\s\S]*?with clear decisions/u);
  assert.match(html, /Jev answers a focused question[\s\S]*?The workflow checks the answer[\s\S]*?An execution trace/u);
  assert.match(html, /<video controls playsinline preload="none" poster="\.\/media\/studio-screenshot\.png"/u);
  assert.match(html, /<source src="\.\/media\/jev-flow-walkthrough\.webm" type="video\/webm"/u);
  assert.doesNotMatch(html, /<track\b/iu);
  assert.match(html, /SEE JEV FLOW IN ACTION[\s\S]*?Follow the flow from input to outcome\./u);
  assert.doesNotMatch(html, /FIELD NOTES|Download WebM|Read English VTT|Transcript &amp; provenance|REAL APP CAPTURE|SYNTHETIC &amp; LOCAL DEMONSTRATIONS|synthetic fixtures/iu);
  assert.match(html, /same text to Jev and a selected language model[\s\S]*?structured answers to specific questions[\s\S]*?cost is labeled as an estimate/u);
  assert.match(html, /id="watch"/u);
  assert.match(html, /id="install"/u);
  assert.match(html, /href="\.\/favicon\.svg"/u);
  assert.match(html, /<img class="brand-symbol" src="\.\/assets\/jev-flow-logo-master\.png"/u);
  assert.match(html, /ARENA \/ COMPARISON SETUP/u);
  assert.doesNotMatch(html, /TYPESAFE UNAVAILABLE|not a count of executed runs/iu);
  assert.match(html, /388,080[\s\S]*?configurations passed validity and unique-ID checks[\s\S]*?certificate records validity and unique IDs for all 388,080/u);
  assert.match(html, /52 repeatable cases across 12 scenarios and compare each answer with its fixed expected result/u);
  assert.match(html, /tic-tac-toe against local minimax[\s\S]*?fictional combat[\s\S]*?city one tick at a time/u);
  assert.match(html, /Jev-compatible backend for typed judgments[\s\S]*?Configure an LLM separately/u);
  assert.match(html, /Change traffic and obstacles[\s\S]*?driving simulation/u);
  assert.match(html, /webhooks, subflows, loops, error routes, and design chat/u);
  assert.match(html, /optional local Laya[\s\S]*?LLM separately for Arena/u);
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
    const source = ['styles.css', 'main.js', 'favicon.svg'].includes(link) || link.startsWith('assets/')
      ? join(root, 'site', link)
      : join(root, link);
    assert.equal(existsSync(source), true, link);
  }
  assert.doesNotMatch(html, /https?:\/\/[^"\s]+\.(?:png|jpe?g|gif|svg|webp|css|js)/iu);
});

test('single-tenant proxy protects app root and media; CI builds without deploying', () => {
  const nginx = readFileSync(join(root, 'deploy', 'nginx-jev-flow.conf'), 'utf8');
  const rootLocation = /location \/ \{\r?\n([\s\S]*?)\r?\n    \}/u.exec(nginx)?.[1] || '';
  assert.match(rootLocation, /auth_basic "JEV Flow"/u);
  assert.match(rootLocation, /include \/etc\/nginx\/snippets\/jev-flow-proxy\.conf/u);
  assert.doesNotMatch(nginx, /root \/opt\/jev-flow\/current\/site|auth_basic off;\s*root/u);
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm test/u);
  assert.match(ci, /catalog:certify -- --check/u);
  assert.match(ci, /npm run site:build/u);
  assert.doesNotMatch(ci, /deploy-pages|upload-pages|pages: write/u);
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
