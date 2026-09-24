import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPEECH_MODEL, SPEECH_URL } from './generate-walkthrough-tts.mjs';
import { runDialogueCli } from './generate-dialogue-tts.mjs';

const pcm = Uint8Array.from([0, 0, 0xff, 0x7f]);

async function makeTempDirectory(t) {
  const path = await mkdtemp(join(tmpdir(), 'jev-dialogue-tts-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('dialogue CLI makes one mocked request per turn and saves WAVs plus a text-free manifest', async t => {
  const root = await makeTempDirectory(t);
  const input = join(root, 'dialogue.json');
  const outputDir = join(root, 'audio');
  const turns = [
    { speaker: 'Host', voice: 'Charon', text: 'Welcome to the demo.' },
    { speaker: 'Guest', voice: 'Kore', text: 'Thanks for having me.' },
    { speaker: 'Host', voice: 'Charon', text: 'Let us begin.' },
  ];
  await writeFile(input, JSON.stringify({ turns }));
  const requests = [];
  const messages = [];
  await runDialogueCli(['--input', input, '--output-dir', outputDir], { OPENROUTER_API_KEY: 'mock-secret' }, {
    stdout: { write: message => messages.push(message) },
    fetchImpl: async (url, options) => {
      assert.equal(url, SPEECH_URL);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer mock-secret');
      requests.push(JSON.parse(options.body));
      return new Response(pcm, { status: 200, headers: { 'content-type': 'audio/pcm' } });
    },
  });

  assert.equal(requests.length, turns.length);
  assert.deepEqual(requests.map(({ model, input: text, voice, response_format }) => ({ model, text, voice, response_format })), turns.map(turn => ({
    model: SPEECH_MODEL, text: turn.text, voice: turn.voice, response_format: 'pcm',
  })));
  assert.deepEqual((await readdir(outputDir)).sort(), ['manifest.json', 'turn-001.wav', 'turn-002.wav', 'turn-003.wav']);
  const firstWav = await readFile(join(outputDir, 'turn-001.wav'));
  assert.equal(firstWav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(firstWav.readUInt32LE(24), 24_000);
  const manifestText = await readFile(join(outputDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.turns.map(({ turn, speaker, voice, file }) => ({ turn, speaker, voice, file })), [
    { turn: 1, speaker: 'Host', voice: 'Charon', file: 'turn-001.wav' },
    { turn: 2, speaker: 'Guest', voice: 'Kore', file: 'turn-002.wav' },
    { turn: 3, speaker: 'Host', voice: 'Charon', file: 'turn-003.wav' },
  ]);
  assert.doesNotMatch(manifestText, /Welcome to the demo|Thanks for having me|Let us begin|mock-secret/u);
  assert.equal(messages.join(''), 'Dialogue WAVs and manifest saved.\n');
  assert.doesNotMatch(messages.join(''), /Welcome to the demo|mock-secret/u);
});

test('a provider failure is not retried and removes earlier WAVs from the incomplete batch', async t => {
  const root = await makeTempDirectory(t);
  const input = join(root, 'dialogue.json');
  const outputDir = join(root, 'audio');
  await writeFile(input, JSON.stringify({ turns: [
    { speaker: 'Host', voice: 'Charon', text: 'First line.' },
    { speaker: 'Guest', voice: 'Kore', text: 'Second line.' },
  ] }));
  let calls = 0;
  await assert.rejects(runDialogueCli(['--input', input, '--output-dir', outputDir], { OPENROUTER_API_KEY: 'mock-secret' }, {
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response(pcm, { status: 200, headers: { 'content-type': 'audio/pcm' } })
        : new Response('private response body', { status: 503, headers: { 'content-type': 'text/plain' } });
    },
  }), /HTTP 503/u);
  assert.equal(calls, 2);
  assert.deepEqual(await readdir(outputDir), []);
});

test('invalid voice is rejected before any provider request', async t => {
  const root = await makeTempDirectory(t);
  const input = join(root, 'dialogue.json');
  await writeFile(input, JSON.stringify({ turns: [{ speaker: 'Host', voice: 'Puck', text: 'Hello.' }] }));
  let calls = 0;
  await assert.rejects(runDialogueCli(['--input', input, '--output-dir', join(root, 'audio')], { OPENROUTER_API_KEY: 'mock-secret' }, {
    fetchImpl: async () => { calls++; throw new Error('unexpected request'); },
  }), /voice must be Charon or Kore/u);
  assert.equal(calls, 0);
});
