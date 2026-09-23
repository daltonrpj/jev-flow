# Walkthrough narration helper

The optional helper converts a **plain-text English narration file** to WAV using OpenRouter's [`audio/speech` route](https://openrouter.ai/docs/guides/overview/multimodal/tts), model `google/gemini-3.1-flash-tts-preview`, voice `Charon`. Google's [Gemini model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-tts-preview) identifies the corresponding model as `gemini-3.1-flash-tts-preview`. It reads only `OPENROUTER_API_KEY` from the process environment. It has no alternate model, voice, provider, or fallback. Running this command makes a provider request and may incur a charge; the automated tests use a mock transport and do not call OpenRouter.

```sh
node scripts/generate-walkthrough-tts.mjs --help
node scripts/generate-walkthrough-tts.mjs --input narration.txt --output narration.wav
```

Set the key in your shell or process manager before the second command. Do not put it in a tracked file or command argument. The input must contain only the words to be spoken; scene directions, Markdown headings, and caption timestamps belong in separate production documents. The output is 24 kHz, mono, 16-bit PCM inside a WAV container. The command refuses to overwrite an existing file and reports provider failures without echoing the prompt, response body, or key.

The route returns raw `audio/pcm` bytes for `response_format: "pcm"`; the helper accepts only that media type and wraps it as 24 kHz, mono, 16-bit WAV. Split longer scripts into short scene lines, synthesize each once, and keep the scene timing beside the capture so English captions follow the generated audio. The published walkthrough keeps the WebM, English VTT, and exact transcript together. Tests do not call a paid provider or act as a live model check.
