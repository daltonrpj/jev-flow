import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captionChunks, formatWebVtt, indexWebmDuration, parseArguments, readWavDuration, readWebmDuration,
  resolveClipPaths, validateProduction,
} from './render-explainer-webm.mjs';

function pcmWav(seconds = 1) {
  const dataBytes = seconds * 48_000;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24_000, 24); wav.writeUInt32LE(48_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

test('render inputs are explicit and output stays a WebM', () => {
  assert.equal(parseArguments(['--help']), null);
  assert.throws(() => parseArguments(['--input', 'dialogue.json', '--audio-dir', 'audio']), /Usage:/u);
  assert.throws(() => parseArguments(['--input', 'dialogue.json', '--audio-dir', 'audio', '--output', 'video.mp4']), /\.webm/u);
  assert.equal(parseArguments(['--input', 'dialogue.json', '--audio-dir', 'audio', '--output', 'video.webm', '--clips-dir', 'clips']).clipsDir.endsWith('clips'), true);
  assert.equal(resolveClipPaths(null).arena, undefined);
  assert.equal(resolveClipPaths('clips').arena.endsWith('clips\\arena.webm'), true);
  assert.equal(resolveClipPaths('clips').cart.endsWith('clips\\cart.webm'), true);
});

test('Portuguese Gemini Flash Lite dialogue validates with its exact two-voice WAV set', () => {
  const turns = [
    { speaker: 'Alex', voice: 'Charon', scene: 'opening', text: 'Uma decisão tipada.' },
    { speaker: 'Maya', voice: 'Kore', scene: 'closing', text: 'O código controla a rota.' },
  ];
  const manifest = { model: 'google/gemini-3.8-flash-lite-tts',
    audio: { sample_rate_hz: 24_000, channels: 1, bits_per_sample: 16 },
    turns: turns.map((turn, index) => ({ turn: index + 1, ...turn, file: `turn-${String(index + 1).padStart(3, '0')}.wav` })) };
  assert.deepEqual(validateProduction({ locale: 'pt-BR', turns }, manifest, [pcmWav(1), pcmWav(2)]), [1, 2]);
});

test('PCM WAV duration and Gemini manifest are validated against every spoken turn', () => {
  const turns = [
    { speaker: 'Alex', voice: 'Charon', scene: 'opening', text: 'Let models judge.' },
    { speaker: 'Maya', voice: 'Kore', scene: 'closing', text: 'Let code route.' },
  ];
  const manifest = {
    model: 'google/gemini-3.1-flash-tts-preview',
    audio: { sample_rate_hz: 24_000, channels: 1, bits_per_sample: 16 },
    turns: turns.map((turn, index) => ({ turn: index + 1, ...turn, file: `turn-${String(index + 1).padStart(3, '0')}.wav` })),
  };
  const wavs = [pcmWav(2), pcmWav(3)];
  assert.equal(readWavDuration(wavs[0]), 2);
  assert.deepEqual(validateProduction({ turns }, manifest, wavs), [2, 3]);
  assert.throws(() => validateProduction({ turns }, { ...manifest, turns: manifest.turns.slice(0, 1) }, wavs), /exactly one WAV/u);
  const repeatedVoice = structuredClone(manifest);
  repeatedVoice.turns[1] = { ...repeatedVoice.turns[1], speaker: 'Alex', voice: 'Charon' };
  assert.throws(() => validateProduction({ turns: [turns[0], { ...turns[1], speaker: 'Alex', voice: 'Charon' }] }, repeatedVoice, wavs), /alternate Alex\/Charon and Maya\/Kore/u);
  assert.throws(() => readWavDuration(Buffer.from('not audio')), /PCM WAV/u);
});

test('renderer indexes the final WebM duration so browsers can seek to recorded scenes', () => {
  const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]);
  const segment = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const info = Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]);
  const source = Buffer.concat([header, segment, info, Buffer.from([0x1f, 0x43, 0xb6, 0x75])]);
  const indexed = indexWebmDuration(source, 12.5);
  assert.equal(indexed.length, source.length + 11);
  assert.ok(Math.abs(readWebmDuration(indexed) - 12.5) < 1e-9);
  const corrected = indexWebmDuration(indexed, 5.25);
  assert.equal(corrected.length, indexed.length);
  assert.ok(Math.abs(readWebmDuration(corrected) - 5.25) < 1e-9);
  assert.equal(readWebmDuration(source), null);
  assert.throws(() => indexWebmDuration(source, 0), /positive, finite/u);
});

test('long narration is split into readable English captions with ordered timings', () => {
  const text = 'Jev supplies a bounded typed judgment while application code validates the schema and confidence threshold before it routes the request into the correct branch. This keeps the workflow inspectable and repeatable.';
  const chunks = captionChunks(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(lines => lines.length <= 2 && lines.every(line => line.length <= 66)));
  assert.equal(chunks.flat().join(' '), text);
  const vtt = formatWebVtt([{ text }], [{ start: 0.5, end: 6.5 }]);
  assert.match(vtt, /^WEBVTT\n/u);
  assert.equal((vtt.match(/ --> /gu) || []).length, chunks.length);
  assert.match(vtt, /00:00:00\.500 --> /u);
  assert.match(vtt, /\nJev supplies a bounded typed judgment/u);
});

test('captions contain spoken words only, never production notes or speaker metadata', () => {
  const spokenLine = 'The simulator creates each obstacle and passes its lane and distance to the workflow.';
  const productionNote = 'The narration gained two English lines, and the video was validated with synthetic audio.';
  const vtt = formatWebVtt([{ speaker: 'Alex', voice: 'Charon', scene: 'cart-data', text: spokenLine }], [{ start: 0, end: 4 }]);
  assert.match(vtt, /The simulator creates each obstacle/u);
  assert.doesNotMatch(vtt, /Alex|Charon|cart-data|narration gained|synthetic audio|providers/iu);
  assert.doesNotMatch(vtt, new RegExp(productionNote.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'));
});
