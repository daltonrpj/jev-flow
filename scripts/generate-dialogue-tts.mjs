import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateSpeech,
  SPEECH_MODEL,
  SPEECH_MODELS,
  SPEECH_SAMPLE_RATE,
  SPEECH_VOICES,
} from './generate-walkthrough-tts.mjs';

const OUTPUT_MANIFEST = 'manifest.json';

function parseCli(args) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) return null;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--input', '--output-dir', '--model', '--style'].includes(key) || !args[index + 1] || options[key]) {
      throw new Error('Usage: node scripts/generate-dialogue-tts.mjs --input dialogue.json --output-dir audio [--model model-id] [--style direction]');
    }
    options[key] = args[index + 1];
  }
  if (!options['--input'] || !options['--output-dir']) {
    throw new Error('Usage: node scripts/generate-dialogue-tts.mjs --input dialogue.json --output-dir audio [--model model-id] [--style direction]');
  }
  const model = options['--model'] || SPEECH_MODEL;
  if (!SPEECH_MODELS.includes(model)) throw new Error('Speech model is not in the supported allowlist.');
  const style = options['--style'] || '';
  if (style.length > 500) throw new Error('Speech style must be at most 500 characters.');
  return { input: resolve(options['--input']), outputDir: resolve(options['--output-dir']), model, style };
}

export function parseDialogue(input) {
  let parsed;
  try { parsed = JSON.parse(input); }
  catch { throw new Error('Dialogue input must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.turns) || !parsed.turns.length) {
    throw new Error('Dialogue input must contain a non-empty turns array.');
  }
  return parsed.turns.map((turn, index) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      throw new Error(`Dialogue turn ${index + 1} must be an object.`);
    }
    if (typeof turn.speaker !== 'string' || !turn.speaker.trim()) {
      throw new Error(`Dialogue turn ${index + 1} needs a speaker.`);
    }
    if (!SPEECH_VOICES.includes(turn.voice)) {
      throw new Error(`Dialogue turn ${index + 1} voice must be Charon or Kore.`);
    }
    if (typeof turn.text !== 'string' || !turn.text.trim()) {
      throw new Error(`Dialogue turn ${index + 1} needs non-empty text.`);
    }
    if (turn.style !== undefined && (typeof turn.style !== 'string' || turn.style.length > 500)) {
      throw new Error(`Dialogue turn ${index + 1} style must be a string of at most 500 characters.`);
    }
    return { speaker: turn.speaker.trim(), voice: turn.voice, text: turn.text.trim(),
      ...(turn.style ? { style: turn.style.trim() } : {}) };
  });
}

async function ensureAbsent(path) {
  let exists = false;
  try { await access(path); exists = true; }
  catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('Output directory is unavailable.');
  }
  if (exists) throw new Error('An output file already exists.');
}

function createManifest(turns, model) {
  return {
    model,
    audio: { container: 'wav', sample_rate_hz: SPEECH_SAMPLE_RATE, channels: 1, bits_per_sample: 16 },
    turns: turns.map((turn, index) => ({
      turn: index + 1,
      speaker: turn.speaker,
      voice: turn.voice,
      file: `turn-${String(index + 1).padStart(3, '0')}.wav`,
    })),
  };
}

export async function generateDialogue({ turns, outputDir, apiKey, model = SPEECH_MODEL, style = '', fetchImpl = globalThis.fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('OPENROUTER_API_KEY is required.');
  if (!SPEECH_MODELS.includes(model)) throw new Error('Speech model is not in the supported allowlist.');
  const manifest = createManifest(turns, model);
  const outputPaths = manifest.turns.map(turn => resolve(outputDir, turn.file));
  const manifestPath = resolve(outputDir, OUTPUT_MANIFEST);
  try { await mkdir(outputDir, { recursive: true }); }
  catch { throw new Error('Output directory could not be prepared.'); }
  for (const path of [...outputPaths, manifestPath]) await ensureAbsent(path);

  const savedPaths = [];
  try {
    for (let index = 0; index < turns.length; index++) {
      const wav = await generateSpeech({
        text: turns[index].text,
        voice: turns[index].voice,
        model,
        style: turns[index].style || style,
        apiKey,
        fetchImpl,
      });
      try { await writeFile(outputPaths[index], wav, { flag: 'wx' }); }
      catch { throw new Error('A dialogue WAV could not be saved.'); }
      savedPaths.push(outputPaths[index]);
    }
    try { await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }); }
    catch { throw new Error('Dialogue manifest could not be saved.'); }
    savedPaths.push(manifestPath);
  } catch (error) {
    await Promise.all(savedPaths.map(path => rm(path, { force: true }).catch(() => {})));
    throw error;
  }
  return manifest;
}

export async function runDialogueCli(args = process.argv.slice(2), env = process.env, { fetchImpl = globalThis.fetch, stdout = process.stdout } = {}) {
  const paths = parseCli(args);
  if (!paths) {
    stdout.write('Generate one WAV per dialogue turn using OpenRouter Gemini TTS.\nUsage: node scripts/generate-dialogue-tts.mjs --input dialogue.json --output-dir audio [--model model-id] [--style direction]\n');
    return;
  }
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required.');
  let source;
  try { source = await readFile(paths.input, 'utf8'); }
  catch { throw new Error('Dialogue input file could not be read.'); }
  const turns = parseDialogue(source);
  await generateDialogue({ turns, outputDir: paths.outputDir, apiKey: env.OPENROUTER_API_KEY,
    model: paths.model, style: paths.style, fetchImpl });
  stdout.write('Dialogue WAVs and manifest saved.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDialogueCli().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
