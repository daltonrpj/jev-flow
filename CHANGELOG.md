# Changelog

User-visible releases of Jev Flow are recorded here. See [`docs/UPDATE-CONTEXT.md`](docs/UPDATE-CONTEXT.md) for the longer project and deployment context.

## 1.2.0 — 2026-09-24

- Adds English and Brazilian Portuguese product tours with alternating Gemini TTS voices, synchronized burned-in captions, WebVTT sidecars, exact transcripts, and recorded app scenes.
- Captures one real Arena comparison between TypeSafe Jev and paid OpenAI GPT-4.1 Mini, with the script and transcript identifying it as a demonstration rather than a benchmark.
- Embeds both videos in the multilingual public guide with a narration-language selector; updates GitHub READMEs and the media-production documentation.
- Fixes provider model-ID selection for paid OpenRouter-compatible models and adds regression coverage for dynamic clip rendering.

## 1.1.1 — 2026-09-24

- Rewrites the public guide in plain English and replaces the walkthrough production notes with a short description of the product tour.
- Clarifies how typed Jev answers, code-controlled routes, Arena measurements, cost estimates, and separate Jev/LLM connections work.
- States that the Compendium generates configurations on demand and that its certificate covers all 388,080 validity and unique-ID checks; describes the Ship Suite as 52 cases across 12 scenarios.
- Explains the tic-tac-toe, fictional combat, and city decision demos; updates all four localized pages (pt-BR, es, fr, de).

## 1.1.0 — 2026-09-24

- Consolidates the standalone Jev Flow Studio, generated Compendium, Battle Arena, Self-Driving Cart, Jev Ship Pack and suite, games, prompt/context tools, and webhook/subflow integrations already present on `main`.
- Adds the high-resolution Jev Flow logo based on the supplied reference to the public guide header and footer; the static site build now includes the image in its explicit asset allowlist.
- Records a repeatable release-context log and makes it part of the repository's update process.
- Keeps the public guide static and the Node application separately deployable; no Atlas workspace files, environment files, provider secrets, or private runtime data are included.
