# Jev Flow walkthrough and screenshots

- The six `*-screenshot.png` images are independent browser captures of the real standalone app, each with English UI, loopback-only requests, and no video caption overlay. [`screenshots-manifest.json`](screenshots-manifest.json) records their exact routes, local/fixture states, dimensions, and SHA-256 hashes. The Studio preview uses an English synthetic support-flow fixture; the Arena is before any provider run; the Cart shows a labeled local reflex because Jev is not configured; Blast Garden is before a move; Chess highlights code-computed legal destinations. No screenshot represents a remote model result.
- `jev-flow-walkthrough-teaser.gif` is a short montage extracted from the same walkthrough for the README. It links to the full WebM and is not a separate model run.
- `jev-flow-walkthrough.webm` is the full local-app walkthrough: Studio setup and deterministic preview, Compendium, Battle Arena, Self-Driving Cart, and Labs. The Chess and Blast Garden moves run through their local rules engines. The video makes no remote Jev or LLM call and sends no external action.
- `jev-flow-walkthrough.vtt` contains synchronized English captions. The same captions are burned into the video for clear playback on GitHub.
- `jev-flow-walkthrough-transcript.md` is the exact spoken English narration, with model and demo provenance.

## Voice attribution

The voice track was generated in 20 short scenes through OpenRouter's `audio/speech` route with `google/gemini-3.1-flash-tts-preview` (Gemini 3.1 Flash TTS Preview), voice `Charon`, and `response_format: "pcm"`. The raw 24 kHz mono PCM scenes were aligned to the captured app timeline, assembled as WAV, and encoded to Opus for WebM. There was no model, provider, or voice fallback. To generate new narration, use the optional CLI described in [`docs/walkthrough-tts.md`](../docs/walkthrough-tts.md); generation is a real provider request and may incur a charge.

## Reproduce and verify the walkthrough

The source narration is in [`jev-flow-walkthrough-transcript.md`](./jev-flow-walkthrough-transcript.md). The runtime is the Node application in this repository. Run `npm ci`, `npm test`, and `npm start` before capturing a new version. Configure a provider only if the video is intentionally being updated to show a live call; label fixture results separately and regenerate matching English captions. Never put API keys, `.env` files, model weights, or private run data in these media assets.

English captions are burned into the video, and the matching WebVTT sidecar is available as a separate file. The README uses an animated GIF linked to the WebM; Markdown does not provide an inline WebM player.
