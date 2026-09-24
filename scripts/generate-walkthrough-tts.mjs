import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech';
export const SPEECH_MODEL = 'google/gemini-3.1-flash-tts-preview';
export const SPEECH_VOICE = 'Charon';
export const SPEECH_VOICES = Object.freeze(['Charon', 'Kore']);
export const SPEECH_SAMPLE_RATE = 24_000;
const MAX_PCM_BYTES = 64 * 1024 * 1024;

export function speechPayload(text, voice = SPEECH_VOICE) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Narration text must be non-empty.');
  if (!SPEECH_VOICES.includes(voice)) throw new Error('Speech voice must be Charon or Kore.');
  return {
    model: SPEECH_MODEL,
    input: text.trim(),
    voice,
    response_format: 'pcm',
  };
}

export function pcmToWav(pcm) {
  const audio = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  if (!audio.byteLength || audio.byteLength % 2 || audio.byteLength > MAX_PCM_BYTES) {
    throw new Error('Speech provider returned invalid PCM audio.');
  }
  const wav = Buffer.alloc(44 + audio.byteLength);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + audio.byteLength, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SPEECH_SAMPLE_RATE, 24);
  wav.writeUInt32LE(SPEECH_SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(audio.byteLength, 40);
  Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).copy(wav, 44);
  return wav;
}

export async function generateSpeech({ text, voice = SPEECH_VOICE, apiKey, fetchImpl = globalThis.fetch, signal = AbortSignal.timeout(90_000) }) {
  const body = speechPayload(text, voice);
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('OPENROUTER_API_KEY is required.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  let response;
  try {
    response = await fetchImpl(SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/pcm',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error('Speech provider request failed or timed out.');
  }
  if (!response?.ok) throw new Error(`Speech provider returned HTTP ${Number(response?.status) || 0}.`);
  const contentType = response.headers?.get?.('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'audio/pcm') {
    throw new Error('Speech provider returned an unexpected content type.');
  }
  let pcm;
  try { pcm = new Uint8Array(await response.arrayBuffer()); }
  catch { throw new Error('Speech provider audio could not be read.'); }
  return pcmToWav(pcm);
}

function parseCli(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return null;
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output' || !args[1] || !args[3]) {
    throw new Error('Usage: node scripts/generate-walkthrough-tts.mjs --input narration.txt --output narration.wav');
  }
  const input = resolve(args[1]);
  const output = resolve(args[3]);
  if (input === output) throw new Error('Input and output paths must differ.');
  if (!output.toLowerCase().endsWith('.wav')) throw new Error('Output must use a .wav extension.');
  return { input, output };
}

export async function runCli(args = process.argv.slice(2), env = process.env) {
  const paths = parseCli(args);
  if (!paths) {
    process.stdout.write('Generate a WAV from a plain-text English narration file.\nUsage: node scripts/generate-walkthrough-tts.mjs --input narration.txt --output narration.wav\n');
    return;
  }
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  const text = await readFile(paths.input, 'utf8');
  const wav = await generateSpeech({ text, apiKey: env.OPENROUTER_API_KEY });
  await writeFile(paths.output, wav, { flag: 'wx' });
  process.stdout.write('Narration WAV saved.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
