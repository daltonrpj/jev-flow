# Walkthrough narration helper

The optional helper converts a **plain-text English narration file** to WAV using OpenRouter's [`audio/speech` route](https://openrouter.ai/docs/guides/overview/multimodal/tts), model `google/gemini-3.1-flash-tts-preview`, voice `Charon`. Google's [Gemini model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview) identifies the corresponding model as `gemini-3.1-flash-tts-preview`. It reads only `OPENROUTER_API_KEY` from the process environment. It has no alternate model, voice, provider, or fallback. Running this command makes a provider request and may incur a charge; the automated tests use a mock transport and do not call OpenRouter.

```sh
node scripts/generate-walkthrough-tts.mjs --help
node scripts/generate-walkthrough-tts.mjs --input narration.txt --output narration.wav
```

Set the key in your shell or process manager before the second command. Do not put it in a tracked file or command argument. The input must contain only the words to be spoken; scene directions, Markdown headings, and caption timestamps belong in separate production documents. The output is 24 kHz, mono, 16-bit PCM inside a WAV container. The command refuses to overwrite an existing file and reports provider failures without echoing the prompt, response body, or key.

The route returns raw `audio/pcm` bytes for `response_format: "pcm"`; the helper accepts only that media type and wraps it as 24 kHz, mono, 16-bit WAV. Split longer scripts into short scene lines, synthesize each once, and keep the scene timing beside the capture so English captions follow the generated audio. The published walkthrough keeps the WebM, English VTT, and exact transcript together. Tests do not call a paid provider or act as a live model check.

## Dialogue with two voices

For reusable dialogue production, provide a JSON file with one `speaker`, one Gemini `voice`, and one `text` value per turn. Use `Charon` for the masculine voice and `Kore` for the feminine voice. Each turn is sent separately to `google/gemini-3.1-flash-tts-preview` exactly once; the command does not retry failed calls.

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
```

The output directory receives `turn-001.wav`, `turn-002.wav`, and so on, plus `manifest.json` with the speaker, voice, turn number, file name, model, and WAV format. The manifest deliberately omits spoken text. Existing output files are preserved, and an incomplete batch is cleaned up if a later turn fails. The command prints only a generic success message or a safe error; it does not print dialogue text or the API key. These provider requests may incur a charge. Automated tests use mocked transports and do not call OpenRouter.

## Produce the English Jev Flow explainer

The approved script and exact transcript are [`media/jev-flow-deterministic-ai-explainer-en.json`](../media/jev-flow-deterministic-ai-explainer-en.json) and [`media/jev-flow-deterministic-ai-explainer-en-transcript.md`](../media/jev-flow-deterministic-ai-explainer-en-transcript.md). They alternate Alex (`Charon`) and Maya (`Kore`), and assign one application or diagram scene to every narration turn.

Create a new, empty audio directory outside the repository, then run the one-request-per-line TTS helper and the local browser renderer:

```powershell
$audioDir = Join-Path $env:TEMP ('jev-flow-explainer-audio-' + [guid]::NewGuid().ToString('N'))
node scripts/generate-dialogue-tts.mjs --input media/jev-flow-deterministic-ai-explainer-en.json --output-dir $audioDir
node scripts/render-explainer-webm.mjs --input media/jev-flow-deterministic-ai-explainer-en.json --audio-dir $audioDir --output media/jev-flow-deterministic-ai-explainer-en.webm
```

The renderer uses Playwright with Chromium when installed in the Node environment. It blocks non-loopback browser requests, combines each generated WAV with the matching English scene, burns in the same short captions written to WebVTT, and saves a poster beside the video. It validates the Gemini model manifest, speaker order, WAV format, and one-to-one turn count before rendering. The browser capture is a local preview; this process does not configure or call Jev or any LLM provider.
