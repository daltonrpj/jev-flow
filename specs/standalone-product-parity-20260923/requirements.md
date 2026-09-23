# Standalone product parity — requirements

## Scope

Jev Flow is a standalone Node application with Studio, Compendium, Arena, Carrinho, and Labs. This revision removes the separate static site and publication workflow. `/` opens the Studio; examples, media and the catalog certificate live at repository root paths.

## Acceptance

- **R1 — Product map:** README and local quickstart link the five working surfaces. The root route redirects to Studio. No separate site or Pages workflow remains.
- **R2 — Honest execution:** UI and docs distinguish deterministic fixtures, local adapters, and live remote providers. Missing credentials and invalid answers fail visibly. Measured latency, reported usage, and cost provenance retain unknown values where evidence is absent.
- **R3 — Catalog claim:** 388,080 is the certified count of valid, unique, lazily generated configurations for a fingerprinted catalog source. It is not an executed-run count or a quality metric.
- **R4 — Isolation and offline regression:** Tests run from the standalone checkout without importing another workspace, a credential, or a paid network call. Cover each public surface and a representative provenance or schema failure.
- **R5 — Walkthrough media:** The published WebM demonstrates the standalone app in English narration with matching English captions and a source transcript. Narration uses exactly OpenRouter `audio/speech`, model `google/gemini-3.1-flash-tts-preview`, voice `Charon`, and a process environment `OPENROUTER_API_KEY`; there is no model, provider, or voice fallback. Automated helper tests use an injected fetch and make no network request. Media verification checks non-empty video, a playable browser stream, non-silent narration, 1080p metadata, and 20 non-overlapping VTT cues. Real stills for all five surfaces and a short animated teaser accompany the full WebM under `media/`. README Markdown links the GIF to the WebM and makes no inline player claim. The app scenes are labeled fixtures/local rules and do not claim live Jev or LLM inference.
- **R6 — Public boundary:** No private workspace imports, credentials, environment files, user data, or model weights enter this repository. Generic examples stay editable and their synthetic fixture answers are identified as such.
- **R7 — App-only deployment:** Nginx authenticates every application path, including root, APIs, examples, media and docs, and proxies to loopback Node. CI runs tests and checks the catalog certificate without deploying a site.

## Exclusions

No real Jev or LLM provider smoke was run because this environment has no such credentials; the public walkthrough therefore does not claim remote inference. Fixture scenes do not measure model quality, and the driving simulation does not establish real-world vehicle safety.
