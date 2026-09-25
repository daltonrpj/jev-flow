import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('both published dialogue videos keep the exact script, two voices, and matching WebVTT captions', async () => {
  for (const locale of ['en', 'pt-BR']) {
    const stem = `jev-flow-product-tour-${locale}`;
    const [scriptText, transcript, captions] = await Promise.all([
      readFile(join(root, 'media', `${stem}.json`), 'utf8'),
      readFile(join(root, 'media', `${stem}-transcript.md`), 'utf8'),
      readFile(join(root, 'media', `${stem}.vtt`), 'utf8'),
    ]);
    const script = JSON.parse(scriptText);
    assert.equal(script.locale, locale);
    assert.equal(script.turns.length, 14);
    assert.equal(script.turns.filter(turn => turn.scene === 'arena').length, 2);
    assert.deepEqual(script.turns.map(turn => [turn.speaker, turn.voice]),
      script.turns.map((_, index) => index % 2 ? ['Maya', 'Kore'] : ['Alex', 'Charon']));
    assert.ok(script.turns.every(turn => typeof turn.style === 'string' && turn.style.length > 20));
    for (const turn of script.turns) assert.ok(transcript.includes(`**${turn.speaker}:** ${turn.text}`), turn.text);
    assert.match(transcript, /## Notas de produção \(não narradas\)|## Production notes \(not spoken\)/u);
    assert.match(captions, /^WEBVTT\r?\n/u);
    assert.doesNotMatch(captions, /production notes|not spoken|voz(es)?:|Charon|Kore/iu);
    const spoken = captions.trim().split(/\r?\n\s*\r?\n/u).slice(1)
      .map(block => block.split(/\r?\n/u).slice(2).join(' ')).join(' ').replace(/\s+/gu, ' ').trim();
    assert.equal(spoken, script.turns.map(turn => turn.text).join(' '));
  }
});

test('the English tour makes no Portuguese claim; both scripts identify fixture, catalog, live-run, and Cart limits', async () => {
  const english = JSON.parse(await readFile(join(root, 'media', 'jev-flow-product-tour-en.json'), 'utf8'));
  const portuguese = JSON.parse(await readFile(join(root, 'media', 'jev-flow-product-tour-pt-BR.json'), 'utf8'));
  const en = english.turns.map(turn => turn.text).join(' ');
  const pt = portuguese.turns.map(turn => turn.text).join(' ');
  assert.doesNotMatch(en, /\b(?:uma|não|português|xadrez|câmera)\b/iu);
  assert.match(en, /labeled fixture/u);
  assert.match(en, /not model evaluations/u);
  assert.match(en, /One run is a demonstration, not a benchmark/u);
  assert.match(en, /no camera vision or OpenCV/u);
  assert.match(pt, /simulação identificada/u);
  assert.match(pt, /não avaliações de modelos/u);
  assert.match(pt, /É uma demonstração, não um benchmark/u);
  assert.match(pt, /não usa câmera, visão computacional nem OpenCV/u);
});
