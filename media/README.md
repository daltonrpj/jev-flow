# Jev Flow walkthrough and screenshots

- `studio-screenshot.png` is a real 1440×950 capture of the standalone Studio using a synthetic support-flow fixture. It contains no user data or provider credentials.
- `compendium-screenshot.png`, `arena-screenshot.png`, `carrinho-screenshot.png`, and `labs-screenshot.png` are 1920×1080 stills extracted from the local-app walkthrough. The Arena still shows the form before any provider request; its empty answer panes are intentional.
- `chess-screenshot.png` is a full-page capture of the real local Chess Lab with a selected pawn and legal destinations. It uses the rules engine without a provider call.
- `jev-flow-walkthrough-teaser.gif` is a short montage extracted from the same walkthrough for the README. It links to the full WebM and is not a separate model run.
- `jev-flow-walkthrough.webm` is the full local-app walkthrough: Studio setup and deterministic preview, Compendium, Battle Arena, Self-Driving Cart, and Labs. The Chess and Blast Garden moves run through their local rules engines. The video makes no remote Jev or LLM call and sends no external action.
- `jev-flow-walkthrough.vtt` contains synchronized English captions. The same captions are burned into the video for clear playback on GitHub.
- `jev-flow-walkthrough-transcript.md` is the exact spoken English narration, with model and demo provenance.

## Voice attribution

The voice track was generated in 20 short scenes through OpenRouter's `audio/speech` route with `google/gemini-3.1-flash-tts-preview` (Gemini 3.1 Flash TTS Preview), voice `Charon`, and `response_format: "pcm"`. The raw 24 kHz mono PCM scenes were aligned to the captured app timeline, assembled as WAV, and encoded to Opus for WebM. There was no model, provider, or voice fallback. To generate new narration, use the optional CLI described in [`docs/walkthrough-tts.md`](../docs/walkthrough-tts.md); generation is a real provider request and may incur a charge.

## Reproduce and verify the walkthrough

The source narration is in [`jev-flow-walkthrough-transcript.md`](./jev-flow-walkthrough-transcript.md). The runtime is the Node application in this repository. Run `npm ci`, `npm test`, and `npm start` before capturing a new version. Configure a provider only if the video is intentionally being updated to show a live call; label fixture results separately and regenerate matching English captions. Never put API keys, `.env` files, model weights, or private run data in these media assets.

English captions are burned into the video, and the matching WebVTT sidecar is available as a separate file. The README uses an animated GIF linked to the WebM; Markdown does not provide an inline WebM player.
