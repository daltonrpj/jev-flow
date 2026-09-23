import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateSpeech, pcmToWav, speechPayload, SPEECH_MODEL, SPEECH_URL, SPEECH_VOICE } from './generate-walkthrough-tts.mjs';

const pcm = Uint8Array.from([0, 0, 0xff, 0x7f, 0, 0x80]);

test('fixed OpenRouter Gemini request uses Charon and wraps 24 kHz mono PCM as WAV', async () => {
  let calls = 0;
  const wav = await generateSpeech({
    text: '  A typed decision.  ', apiKey: 'unit-test-key',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, SPEECH_URL);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer unit-test-key');
      assert.deepEqual(JSON.parse(options.body), {
        model: SPEECH_MODEL, input: 'A typed decision.', voice: SPEECH_VOICE, response_format: 'pcm',
      });
      return new Response(pcm, { status: 200, headers: { 'content-type': 'audio/pcm' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(wav.subarray(44), Buffer.from(pcm));
});

test('missing key or empty narration makes no request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('unexpected network'); };
  await assert.rejects(generateSpeech({ text: 'Hello', apiKey: '', fetchImpl }), /OPENROUTER_API_KEY/);
  await assert.rejects(generateSpeech({ text: '  ', apiKey: 'unit-test-key', fetchImpl }), /non-empty/);
  assert.equal(calls, 0);
  assert.throws(() => speechPayload(null), /non-empty/);
});

test('provider failures and non-audio bodies fail without a fallback request', async () => {
  for (const response of [
    new Response('{"error":"denied"}', { status: 401, headers: { 'content-type': 'application/json' } }),
    new Response('{"audio":"missing"}', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response(Buffer.from('ID3\0'), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    new Response(Buffer.from('big-endian PCM'), { status: 200, headers: { 'content-type': 'audio/l16' } }),
    new Response(Uint8Array.of(0), { status: 200, headers: { 'content-type': 'audio/pcm' } }),
  ]) {
    let calls = 0;
    await assert.rejects(generateSpeech({ text: 'Hello', apiKey: 'unit-test-key', fetchImpl: async () => { calls++; return response; } }));
    assert.equal(calls, 1);
  }
  assert.throws(() => pcmToWav(new Uint8Array(0)), /invalid PCM/);
});

test('CLI help is offline and unrelated provider keys never authorize generation', () => {
  const script = fileURLToPath(new URL('./generate-walkthrough-tts.mjs', import.meta.url));
  const env = { ...process.env, OPENROUTER_API_KEY: '', GEMINI_API_KEY: 'unrelated-test-key' };
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /plain-text English narration/u);
  const denied = spawnSync(process.execPath, [script, '--input', 'not-read.txt', '--output', 'not-created.wav'], { env, encoding: 'utf8' });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /OPENROUTER_API_KEY is required/u);
  assert.doesNotMatch(denied.stderr, /unrelated-test-key/u);
});
