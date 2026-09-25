# Walkthrough narration helper

The optional helper converts a **plain-text narration file** to WAV using OpenRouter's [`audio/speech` route](https://openrouter.ai/docs/guides/overview/multimodal/tts). The default is `google/gemini-3.1-flash-tts-preview`, voice `Charon`; the allowlist also supports `google/gemini-3.8-flash-lite-tts`. Google's [Gemini model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview) documents the legacy 3.1 model used by the earlier English explainer. Generation reads only `OPENROUTER_API_KEY` from the process environment. A provider request may incur a charge; automated tests use a mock transport and do not call OpenRouter.

```sh
node scripts/generate-walkthrough-tts.mjs --help
node scripts/generate-walkthrough-tts.mjs --input narration.txt --output narration.wav
```

Set the key in your shell or process manager before the second command. Do not put it in a tracked file or command argument. The input must contain only the words to be spoken; scene directions, Markdown headings, and caption timestamps belong in separate production documents. The output is 24 kHz, mono, 16-bit PCM inside a WAV container. The command refuses to overwrite an existing file and reports provider failures without echoing the prompt, response body, or key.

The route returns raw `audio/pcm` bytes for `response_format: "pcm"`; the helper accepts only that media type and wraps it as 24 kHz, mono, 16-bit WAV. Split longer scripts into short scene lines, synthesize each once, and keep the scene timing beside the capture so English captions follow the generated audio. The published walkthrough keeps the WebM, English VTT, and exact transcript together. Tests do not call a paid provider or act as a live model check.

## Dialogue with two voices

For reusable dialogue production, provide a JSON file with one `speaker`, one Gemini `voice`, and one `text` value per turn. Use `Charon` for the masculine voice and `Kore` for the feminine voice. Each turn is sent separately exactly once; the command does not retry failed calls. Per-turn `style` text can direct the language and delivery using Gemini's provider metadata.

```json
{
  "turns": [
    { "speaker": "Host", "voice": "Charon", "text": "Welcome to the demo." },
    { "speaker": "Guest", "voice": "Kore", "text": "Thanks for having me." }
  ]
}
```

Run the command after setting `OPENROUTER_API_KEY` in the shell or process manager:

```sh
node scripts/generate-dialogue-tts.mjs --help
node scripts/generate-dialogue-tts.mjs --input dialogue.json --output-dir dialogue-audio
node scripts/generate-dialogue-tts.mjs --input dialogue.json --output-dir dialogue-audio --model google/gemini-3.8-flash-lite-tts
```

The output directory receives `turn-001.wav`, `turn-002.wav`, and so on, plus `manifest.json` with the speaker, voice, turn number, file name, model, and WAV format. The manifest deliberately omits spoken text. Existing output files are preserved, and an incomplete batch is cleaned up if a later turn fails. The command prints only a generic success message or a safe error; it does not print dialogue text or the API key. These provider requests may incur a charge. Automated tests use mocked transports and do not call OpenRouter.

## Bilingual Jev Flow product tour

The source scripts are [`jev-flow-product-tour-en.json`](../media/jev-flow-product-tour-en.json) and [`jev-flow-product-tour-pt-BR.json`](../media/jev-flow-product-tour-pt-BR.json). They use 14 alternating two-voice turns per language. Keep the exact spoken words in JSON; production notes live only in each transcript Markdown and never enter the captions.

Generate each language once into a new temporary audio directory, then render with the matching local application clips. A single run to the Battle Arena uses the TypeSafe API and the configured paid GPT-4.1 Mini route; it is recorded as one demonstration and is not repeated for a benchmark.

```powershell
$audioDir = Join-Path $env:TEMP ('jev-flow-tour-audio-' + [guid]::NewGuid().ToString('N'))
node scripts/generate-dialogue-tts.mjs --input media/jev-flow-product-tour-en.json --output-dir $audioDir --model google/gemini-3.8-flash-lite-tts
node scripts/render-explainer-webm.mjs --input media/jev-flow-product-tour-en.json --audio-dir $audioDir --clips-dir clips --output media/jev-flow-product-tour-en.webm
```

Repeat with the Portuguese script, a **new empty audio directory**, and the Portuguese output name. The renderer blocks non-loopback page requests, validates every WAV and voice turn, burns matching captions into the video, and writes a separate WebVTT file and poster. Never commit temporary audio, provider credentials, or private run data.

## Earlier English Jev Flow explainer

The approved script and exact transcript are [`media/jev-flow-deterministic-ai-explainer-en.json`](../media/jev-flow-deterministic-ai-explainer-en.json) and [`media/jev-flow-deterministic-ai-explainer-en-transcript.md`](../media/jev-flow-deterministic-ai-explainer-en-transcript.md). They alternate Alex (`Charon`) and Maya (`Kore`), and assign one application or diagram scene to every narration turn.

Create a new, empty audio directory outside the repository, then run the one-request-per-line TTS helper and the local browser renderer:

```powershell
$audioDir = Join-Path $env:TEMP ('jev-flow-explainer-audio-' + [guid]::NewGuid().ToString('N'))
node scripts/generate-dialogue-tts.mjs --input media/jev-flow-deterministic-ai-explainer-en.json --output-dir $audioDir
node scripts/render-explainer-webm.mjs --input media/jev-flow-deterministic-ai-explainer-en.json --audio-dir $audioDir --output media/jev-flow-deterministic-ai-explainer-en.webm
```

The renderer uses Playwright with Chromium when installed in the Node environment. It blocks non-loopback browser requests, combines each generated WAV with the matching English scene, burns in the same short captions written to WebVTT, and saves a poster beside the video. It validates the Gemini model manifest, speaker order, WAV format, and one-to-one turn count before rendering. The browser capture is a local preview; this process does not configure or call Jev or any LLM provider.
