import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, copyFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    'media/README.md', 'media/studio-screenshot.png'
  ]) assert.equal(existsSync(join(root, path)), true, path);
  assert.doesNotMatch(html, /<(?:img|script|link)[^>]+(?:src|href)="https?:\/\//i);
  assert.match(html, /media\/studio-screenshot\.png/);
  assert.match(html, /https:\/\/github\.com\/daltonrpj\/jev-flow/);
  const quickstart = readFileSync(join(root, 'docs', 'quickstart.md'), 'utf8');
  assert.match(quickstart, /git clone https:\/\/github\.com\/daltonrpj\/jev-flow\.git/);
  assert.doesNotMatch(quickstart, /standalone-repository-url/);
  assert.match(html, /id="studio"/);
  assert.match(html, /jev-flow-walkthrough\.webm/);
  assert.match(script, /jev-flow-walkthrough\.vtt/);
  assert.match(html, /id="language"/);
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
