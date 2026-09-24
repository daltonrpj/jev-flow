# Jev Flow walkthrough and screenshots

- `jev-flow-deterministic-ai-explainer-en.webm` is the 4:53 English explainer, rendered at 1920×1080 with 26 alternating Gemini 3.1 Flash TTS turns, captured application screens, and custom diagrams. The Studio scene is a local synthetic fixture preview; it makes no live Jev or LLM call. The narration covers deterministic workflow design, typed Jev judgments, optional Laya, the Studio, Compendium, Arena, self-driving simulation, and Labs.
- `jev-flow-deterministic-ai-explainer-en.vtt` is the matching WebVTT sidecar; its 49 cues contain only the exact spoken dialogue. Multi-cue turns are timed across each generated WAV in proportion to caption text length; the file is not word-level forced alignment.
- `jev-flow-deterministic-ai-explainer-en-poster.png` is the video poster shown in the repository README. Click it to open the WebM.
- `jev-flow-deterministic-ai-explainer-en-transcript.md` and `jev-flow-deterministic-ai-explainer-en.json` preserve the exact English script, speaker, voice, and scene assignment.
- The six `*-screenshot.png` images are independent browser captures of the real standalone app, each with English UI, loopback-only requests, and no video caption overlay. [`screenshots-manifest.json`](screenshots-manifest.json) records their exact routes, local/fixture states, dimensions, and SHA-256 hashes. The Studio preview uses an English synthetic support-flow fixture; the Arena is before any provider run; the Cart shows a labeled local reflex because Jev is not configured; Blast Garden is before a move; Chess highlights code-computed legal destinations. No screenshot represents a remote model result.
- `jev-flow-walkthrough-teaser.gif` is a short montage extracted from the same walkthrough for the README. It links to the full WebM and is not a separate model run.
- `jev-flow-walkthrough.webm` is the full local-app walkthrough: Studio setup and deterministic preview, Compendium, Battle Arena, Self-Driving Cart, and Labs. The Chess and Blast Garden moves run through their local rules engines. The video makes no remote Jev or LLM call and sends no external action.
- `jev-flow-walkthrough.vtt` contains synchronized English captions. The same captions are burned into the video for clear playback on GitHub.
- `jev-flow-walkthrough-transcript.md` is the exact spoken English narration, with model and demo provenance.

## Voice attribution

The new explainer voice track was generated in 26 short turns through OpenRouter's `audio/speech` route using `google/gemini-3.1-flash-tts-preview`, alternating `Charon` (Alex) and `Kore` (Maya). Each voice is a Gemini TTS output; no voice, model, or provider fallback was used. The raw 24 kHz mono PCM files were combined with the matching scene and encoded as VP9/Opus WebM. The generated WAVs are temporary production inputs and are not stored in this repository.

The voice track was generated in 20 short scenes through OpenRouter's `audio/speech` route with `google/gemini-3.1-flash-tts-preview` (Gemini 3.1 Flash TTS Preview), voice `Charon`, and `response_format: "pcm"`. The raw 24 kHz mono PCM scenes were aligned to the captured app timeline, assembled as WAV, and encoded to Opus for WebM. There was no model, provider, or voice fallback. To generate new narration, use the optional CLI described in [`docs/walkthrough-tts.md`](../docs/walkthrough-tts.md); generation is a real provider request and may incur a charge.

## Reproduce and verify the walkthrough

The source narration is in [`jev-flow-walkthrough-transcript.md`](./jev-flow-walkthrough-transcript.md). The runtime is the Node application in this repository. Run `npm ci`, `npm test`, and `npm start` before capturing a new version. Configure a provider only if the video is intentionally being updated to show a live call; label fixture results separately and regenerate matching English captions. Never put API keys, `.env` files, model weights, or private run data in these media assets.

English captions are burned into the video, and the matching WebVTT sidecar is available as a separate file. The README uses an animated GIF linked to the WebM; Markdown does not provide an inline WebM player.

## Deterministic AI explainer source

- [`jev-flow-deterministic-ai-explainer-en.json`](jev-flow-deterministic-ai-explainer-en.json) is the 26-turn English dialogue for Alex and Maya. Each turn maps to either a real English application capture or an explanatory diagram. [`jev-flow-deterministic-ai-explainer-en-transcript.md`](jev-flow-deterministic-ai-explainer-en-transcript.md) is the exact narration.
- [`jev-flow-explainer-studio-flow-en.png`](jev-flow-explainer-studio-flow-en.png) and [`jev-flow-explainer-studio-input-en.png`](jev-flow-explainer-studio-input-en.png) show the actual standalone Studio before and after editing the synthetic support input. The existing [`studio-screenshot.png`](studio-screenshot.png) shows the completed local fixture trace.
- [`../scripts/render-explainer-webm.mjs`](../scripts/render-explainer-webm.mjs) combines the Gemini TTS WAVs, application captures, scene graphics, and matching English WebVTT captions. It serves only a loopback preview, blocks external requests, validates the audio manifest, and writes the WebM, captions, and poster beside the chosen output path. See [`docs/walkthrough-tts.md`](../docs/walkthrough-tts.md) for production commands and provider-cost boundaries.
- The self-driving narration distinguishes simulation state from image perception: this demo creates obstacles in code and sends their type, lane, and distance with the car's lane and speed. Jev does not train on each frame or inspect camera pixels in this implementation; OpenCV is not used.
