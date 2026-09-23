import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, copyFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { validateFlow } from '../services/jev-flow/engine.mjs';
import { catalogSourceFingerprint } from '../services/jev-flow/compendium-catalog.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = readFileSync(join(root, 'main.js'), 'utf8');

test('all site copy keys have Portuguese text', () => {
  const keys = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map(match => match[1]);
  const pt = script.slice(script.indexOf('const pt ='), script.indexOf('const message ='));
  const missing = [...new Set(keys)].filter(key => !new RegExp('\\b' + key + ':').test(pt));
  assert.deepEqual(missing, []);
  assert.ok(keys.length >= 100);
});

test('generic examples validate and cannot trigger an external effect', () => {
  const names = readdirSync(join(root, 'examples')).filter(name => name.endsWith('.flow.json'));
  assert.deepEqual(names.sort(), [
    'anomaly-review.flow.json', 'interactive-labs.flow.json', 'refund-intake.flow.json',
    'spam-screening.flow.json', 'support-triage.flow.json'
  ]);
  for (const name of names) {
    const flow = JSON.parse(readFileSync(join(root, 'examples', name), 'utf8'));
    const validation = validateFlow(flow);
    assert.equal(validation.ok, true, name + ': ' + JSON.stringify(validation.errors));
    assert.ok(flow.fixtures?.length > 0, name + ' needs a synthetic fixture');
    for (const node of Object.values(flow.nodes)) {
      if (node.type.startsWith('action.')) assert.equal(node.type, 'action.log', name);
    }
  }
});

test('site assets and public guide links are local and present', () => {
  for (const path of [
    'styles.css', 'main.js', 'assets/favicon.svg', 'assets/mark.svg', 'assets/editor-preview.svg',
    'assets/architecture.svg', 'assets/video-poster.svg',
    'docs/index.html', 'docs/quickstart.md', 'docs/examples.md', 'docs/architecture.md', 'docs/project.md',
    'media/README.md', 'media/studio-screenshot.png', 'media/jev-flow-walkthrough-transcript.md',
    'media/jev-flow-walkthrough.webm', 'media/jev-flow-walkthrough.vtt'
  ]) assert.equal(existsSync(join(root, path)), true, path);
  assert.doesNotMatch(html, /<(?:img|script|link)[^>]+(?:src|href)="https?:\/\//i);
  assert.match(html, /media\/studio-screenshot\.png/);
  assert.match(html, /https:\/\/github\.com\/daltonrpj\/jev-flow/);
  const quickstart = readFileSync(join(root, 'docs', 'quickstart.md'), 'utf8');
  assert.match(quickstart, /git clone https:\/\/github\.com\/daltonrpj\/jev-flow\.git/);
  assert.doesNotMatch(quickstart, /standalone-repository-url/);
  assert.match(html, /id="studio"/);
  assert.match(script, /jev-flow-walkthrough\.webm/);
  assert.match(script, /jev-flow-walkthrough\.vtt/);
  assert.match(script, /track\.default\s*=\s*false/u, 'the WebM already has English captions, so the VTT track must be opt-in to avoid duplicate captions');
  assert.match(html, /Read the narration script/);
  assert.match(html, /id="language"/);
  const walkthroughVideo = statSync(join(root, 'media', 'jev-flow-walkthrough.webm'));
  assert.ok(walkthroughVideo.size > 100_000, 'published walkthrough must not be an empty placeholder');
  const captions = readFileSync(join(root, 'media', 'jev-flow-walkthrough.vtt'), 'utf8');
  assert.match(captions, /^WEBVTT\r?\n/u);
  assert.match(captions, /Gemini|Welcome to Jev Flow/u);
  assert.doesNotMatch(captions, /\[music\]|\[unintelligible\]/iu);
  const cues = captions.trim().split(/\r?\n\s*\r?\n/u).slice(1).map(block => {
    const lines = block.split(/\r?\n/u);
    assert.match(lines[1], /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/u);
    const [, from, to] = lines[1].match(/^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/u);
    const seconds = time => {
      const [hours, minutes, rest] = time.split(':');
      return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest);
    };
    const textLines = lines.slice(2);
    assert.ok(textLines.length > 0 && textLines.length <= 2, 'captions should fit in at most two lines');
    assert.ok(textLines.every(line => line.length <= 70), 'caption lines should remain readable');
    return { start: seconds(from), end: seconds(to), text: textLines.join(' ') };
  });
  assert.equal(cues.length, 20, 'the full English walkthrough should have one caption per scene');
  for (let index = 0; index < cues.length; index += 1) {
    assert.ok(cues[index].end > cues[index].start, `cue ${index + 1} should have a positive duration`);
    if (index > 0) assert.ok(cues[index].start >= cues[index - 1].end, `cue ${index + 1} should not overlap`);
  }
  assert.match(cues.map(cue => cue.text).join(' '), /Compendium|Battle Arena|Self-Driving Cart|Labs/u);
  const docs = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
  for (const route of ['/jev/flows', '/jev/flows/compendium', '/jev/battle', '/jev/carrinho', '/jev/labs']) {
    assert.ok(docs.includes(`href="http://127.0.0.1:8723${route}"`), route);
  }
});

test('public catalog certificate matches the landing page schema', () => {
  const certificate = JSON.parse(readFileSync(join(root, 'catalog-certification.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, '..', 'services', 'jev-flow', 'compendium-catalog.manifest.json'), 'utf8'));
  assert.equal(certificate.scope, 'standalone');
  assert.equal(certificate.version, 'jev-flow-catalog-v3');
  assert.equal(certificate.passed, true);
  for (const key of ['candidateCount', 'validCount', 'uniqueKeys', 'uniqueIds']) assert.equal(certificate[key], 388080);
  assert.match(certificate.sourceFingerprint, /^[a-f0-9]{64}$/i);
  assert.equal(certificate.sourceFingerprint, catalogSourceFingerprint());
  assert.equal(manifest.sourceFingerprint, certificate.sourceFingerprint);
  const sourceNames = ['compendium-catalog.mjs', 'compendium-expanded.mjs', 'engine.mjs', 'node-catalog.mjs'];
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'jev-flow-fingerprint-'));
  const lfCheckout = join(temporaryDirectory, 'lf-checkout');
  try {
    mkdirSync(lfCheckout);
    const sourceDirectory = join(root, '..', 'services', 'jev-flow');
    for (const name of sourceNames) {
      const source = readFileSync(join(sourceDirectory, name), 'utf8');
      copyFileSync(join(sourceDirectory, name), join(temporaryDirectory, name));
      writeFileSync(join(lfCheckout, name), source.replace(/\r\n?/gu, '\n'));
    }
    const alternateRoot = pathToFileURL(`${temporaryDirectory}${sep}`);
    assert.equal(catalogSourceFingerprint(alternateRoot), certificate.sourceFingerprint, 'fingerprint is stable across checkout paths');
    assert.equal(catalogSourceFingerprint(pathToFileURL(`${lfCheckout}${sep}`)), certificate.sourceFingerprint, 'fingerprint is stable when Git normalizes source line endings to LF');
  } finally {
    if (temporaryDirectory.startsWith(tmpdir()) && temporaryDirectory.includes('jev-flow-fingerprint-')) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
});
