import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDemoPage, buildFlowsIndexPage } from './demo-page.mjs';

const flow = JSON.parse(await readFile(new URL('../../examples/support-triage.flow.json', import.meta.url), 'utf8'));

test('Studio English demo localizes presentation without changing the fixture or route', async () => {
  const english = (await buildDemoPage(flow.id, { flow, catalogPreview: true, locale: 'en' })).html;
  const portuguese = (await buildDemoPage(flow.id, { flow, catalogPreview: true, locale: 'pt-BR' })).html;
  assert.match(english, /<html lang="en"/);
  assert.match(english, /Jev judgment|JEV JUDGMENT/);
  assert.match(english, /typed judgments/);
  assert.match(english, /guarded typed condition/);
  assert.match(english, /steps · \d+ edges/);
  assert.doesNotMatch(english, /steps · \d+ edges · ≈\$/);
  assert.match(english, /no inference from input/);
  assert.match(english, /data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(english, /\d+ passos · \d+ arestas/);
  assert.match(portuguese, /<html lang="pt-BR"/);
  assert.match(portuguese, /\d+ passos · \d+ arestas/);
  assert.deepEqual(flow.fixtures[0].input, { message: 'Example: I see a duplicate charge on my invoice.' });
});

test('English Studio exposes an explicit local fixture mode with typed answers', async () => {
  const { html } = await buildDemoPage(flow.id, { flow, locale: 'en' });
  assert.match(html, /<option value="simulate">Local fixture simulation<\/option>/u);
  assert.match(html, /<option value="live">Live Jev call<\/option>/u);
  assert.match(html, /id="gAnswers"/u);
  assert.match(html, /Typed fixture answers \(JSON\)/u);
  assert.match(html, /The input changed: enter typed answers/u);
  assert.match(html, /deterministic fixture simulation · no Jev call/u);
  assert.match(html, /Edit input/u);
  assert.match(html, /Local fixture simulation/u);
});

test('Studio exposes only the exact shipped public fixture input', async () => {
  const shipped = (await buildDemoPage(flow.id, { flow, locale: 'en' })).html;
  assert.match(shipped, /Example: I see a duplicate charge on my invoice\./);
  assert.doesNotMatch(shipped, /\[REDACTED:\s*input-value\]/);

  const edited = structuredClone(flow);
  edited.fixtures[0].input.message = 'PRIVATE_CUSTOMER_REFERENCE_4821';
  const privatePage = (await buildDemoPage(edited.id, { flow: edited, locale: 'en' })).html;
  assert.doesNotMatch(privatePage, /PRIVATE_CUSTOMER_REFERENCE_4821/);
  assert.match(privatePage, /\[REDACTED:\s*input-value\]/);
});

test('Studio pages do not request font files missing from the standalone package', async () => {
  const [canvas, index] = await Promise.all([
    buildDemoPage(flow.id, { flow, locale: 'en' }).then(result => result.html),
    buildFlowsIndexPage({ locale: 'en' }),
  ]);
  for (const html of [canvas, index]) {
    assert.doesNotMatch(html, /\/synap-(?:instrument|fraunces)\.woff2/u);
    assert.doesNotMatch(html, /font-family:\s*['"]Jev Flow (?:Instrument|Editorial)['"]/u);
  }
});
