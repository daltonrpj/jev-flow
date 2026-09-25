# Jev Flow update context

Use this file as the durable handoff for later Jev Flow releases. Add one dated entry for each substantial update: goal, changed surfaces, measured evidence, limits, verification, and publication state. Keep credentials, runtime records, and private Atlas workspace details out of this file.

## Current release — 1.2.0 (2026-09-24)

### Product tours

- `media/jev-flow-product-tour-en.*` and `media/jev-flow-product-tour-pt-BR.*` contain the English and Brazilian Portuguese narrated tours, WebVTT sidecars, posters, source dialogues, and exact transcripts.
- Each narration has 14 alternating Alex/Charon and Maya/Kore turns using OpenRouter `google/gemini-3.8-flash-lite-tts`. Raw WAVs and credentials were not added to Git.
- Dynamic scenes were recorded from the standalone Studio, Compendium, Arena, tic-tac-toe, Chess Lab, and Self-Driving Sim. The Arena capture is one actual TypeSafe Jev versus paid OpenAI GPT-4.1 Mini run. Its observed UI latencies were 740 ms and 1,638 ms; this is demonstration evidence, not a benchmark.
- Final renders: English 138.224 s / 47,742,928 bytes, SHA-256 `7429e10423c12ba05873d1d2f3702704159e0f77ec4a6fcd94345731802a22aa`; Portuguese (Brazil) 153.904 s / 53,510,422 bytes, SHA-256 `bf0fd20bc11aa1c644eee04b37e05dbe1941bd1fd404293df1f69afe4dc6e7d1`. Both are 1920×1080 VP9/Opus WebM with finite duration metadata and 19/21 WebVTT cues respectively.
- The Studio result is a labeled fixture. The Compendium's 388,080 value counts generated configurations, not model evaluations. Games validate locally by default. Cart obstacles and lane state are generated structured simulator data; the demo has no camera/OpenCV perception.
- `site/index.html` embeds the English and Portuguese videos in a language selector. `scripts/build-site.mjs` allowlists the selected WebMs, posters, VTT files, and transcripts. Both READMEs link directly to the videos and their text sidecars.
- Final visual review seeks into both videos, checks subtitle tracks, and inspects Arena, Chess, and Cart. The Chess scene shows the real English app board with a selected pawn and code-computed legal destinations.

### Runtime fix and release rules

- `services/jev-flow/llm-gateway.mjs` now accepts a model ID already resolved under the selected provider. The Arena had listed slash-qualified OpenRouter IDs but rejected the provider-specific ID before fetch; a mocked regression test covers routing.
- `scripts/render-explainer-webm.mjs` resolves dynamic clip paths from its `clipsDir` parameter, with an explicit unit test. The first render reproduced an undefined-variable failure; details are in [`BUG-FIXE-DISCIPLINE.md`](../BUG-FIXE-DISCIPLINE.md).
- A production Linux test run exposed a Windows-only path assertion in that renderer contract; the test now uses `node:path.join()` on both platforms. The failed release gate was fixed before changing the active VPS release.
- Verify future updates with `npm test`, `npm run catalog:certify -- --check`, `npm run site:build`, and `git diff --check`. CI builds the public guide but does not deploy it.
- A release or website change does not by itself update `jevflow.cloud`. The static guide's VPS release and the protected Node application's deployment are separate, and must each be verified if the requested scope includes publishing them.
- Release verification on this update: `npm test` (145/145), `npm run catalog:certify -- --check` (388,080/388,080), and `npm run site:build` (29 public files). Run `git diff --check` before committing. Public publishing is a separate action.

## Previous release context

Version 1.1.1 replaced placeholder production notes on the multilingual static guide with a plain-language explanation of Jev Flow, code-owned routing, the Arena, the Compendium, games, and local setup. Version 1.1.0 consolidated the standalone app, the 388,080-configuration Compendium, Ship Pack and suite, interactive games, prompt/context helpers, and webhook/subflow nodes in the Jev Flow repository. The original deterministic-AI explainer and fixture-only walkthrough remain archived media assets; the new bilingual product tours are the current presentation videos.
