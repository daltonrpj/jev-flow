# Jev Flow

Jev Flow is a standalone Node.js application for building and testing workflows with typed Jev judgments and code-owned decisions. The repository includes the Studio, generated Compendium, Battle Arena, Self-Driving Cart simulation, decision Labs, local examples, tests, and an English narrated walkthrough. It does not require another application or a hosted product website.

[![A short animated preview of the real Jev Flow application](media/jev-flow-walkthrough-teaser.gif)](media/jev-flow-walkthrough.webm)

The GIF is a short preview. [Watch or download the full WebM](media/jev-flow-walkthrough.webm), [read the English captions](media/jev-flow-walkthrough.vtt), or [inspect the transcript and demo provenance](media/jev-flow-walkthrough-transcript.md). Repository Markdown links to the video; it does not claim to provide an inline WebM player. The recording uses synthetic fixtures and local rules. It does not claim a live remote Jev or LLM run.

## Run locally

Requirements: Node.js 20 or later. Python is optional and is used only for a separately installed local Laya adapter.

```sh
git clone https://github.com/daltonrpj/jev-flow.git
cd jev-flow
npm ci
npm start
```

Open **http://127.0.0.1:8723/**. The root redirects to the Studio. You can import an editable flow from [`examples/`](examples/), run its synthetic fixture, and inspect routing without a credential or model call. User flows, history, schedules, rulesets, and usage logs live in the operating system's Jev Flow data directory outside this checkout. Set `JEVFLOW_DATA_DIR` to move it. See the [quickstart](docs/quickstart.md) for the routes and first run.

| Surface | Local route | What it shows | Limit |
| --- | --- | --- | --- |
| Studio | `/jev/flows` | Editable typed flows, input schema, deterministic preview, trace, and explicit live runs | A fixture demonstrates routing for supplied answers, not model accuracy. |
| Compendium | `/jev/flows/compendium` | Search, test, and install lazily generated configurations | 388,080 is a certified configuration count, not executed model runs. |
| Battle Arena | `/jev/battle` | Jev and LLM questions, answers, source, measured latency, and reported usage | Comparison claims require comparable, observed answers. |
| Self-Driving Cart | `/jev/carrinho` | Two simulated tracks, decisions, safety interventions, and provenance | The simulation is not evidence of real-world driving safety. |
| Labs | `/jev/labs` | Spam, evidence, rescue, chess, and Blast Garden exercises | Local rules and model proposals are identified separately. |

## Real application captures

These captures show the local application with synthetic data or local rules; unavailable providers remain visibly unavailable. The Compendium, Arena, Cart, and Blast Garden stills come from the walkthrough. Studio and Chess are separate local-app captures. No credential or private input appears in them.

**Studio —** a synthetic fixture exercises a flow and displays the resulting path.

![Studio flow editor and deterministic trace](media/studio-screenshot.png)

**Compendium —** generated configurations with search, filters, and install/test actions.

![Compendium configuration browser](media/compendium-screenshot.png)

**Battle Arena —** the 27-question comparison form before a provider run. Empty answer panes indicate that no response has been observed.

![Battle Arena before provider execution](media/arena-screenshot.png)

**Self-Driving Cart —** a two-track local simulation with a labeled fallback when Jev is not configured.

![Self-Driving Cart simulation and live stats](media/carrinho-screenshot.png)

**Labs —** Blast Garden uses local game rules to validate the next action.

![Blast Garden inside Jev Labs](media/labs-screenshot.png)

**Chess Lab —** legal moves are calculated by the local chess engine. This capture shows a selected pawn and its legal destinations; no provider answered.

![Chess board with a selected pawn and legal destinations](media/chess-screenshot.png)

## Providers and provenance

Configure a provider only for an explicit live run. `TYPESAFE_API_KEY` selects the TypeSafe System One API for real typed judgments. The LLM adapter uses `JEVFLOW_LLM_API_KEY` or `OPENAI_API_KEY` with an explicitly selected endpoint and model. For Gemini, pair `GEMINI_API_KEY` with `JEVFLOW_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`. Keys entered in the Studio stay in process memory and clear on restart. The optional local Laya adapter requires its own Python installation and checkpoint; Jev Flow does not bundle weights or install it on click.

| Source label | Meaning | Measurement limit |
| --- | --- | --- |
| Fixture / preview | Synthetic answer supplied for a deterministic test; no provider request | No provider latency, tokens, or remote cost. |
| Local adapter | A compatible local model actually ran | Remote billing does not apply; compute cost is not inferred. |
| Remote provider | The configured endpoint returned a schema-valid answer | Usage and price-backed cost appear only when evidence is available. |
| Unavailable / invalid | Missing key, transport failure, timeout, or malformed answer | Unknown answers and costs remain unknown; no silent provider switch. |

Jev answers are structured evidence. Flow validation and policy code own every branch and external effect. Read the [architecture](docs/architecture.md), [examples](docs/examples.md), and [security boundary](docs/security.md) before enabling webhooks.

## Catalog and tests

The Compendium combines 22 patterns, 42 unique domains, 7 variants, 4 thresholds, 3 complexity profiles, and 5 focus options into **388,080 valid generated configurations**. The total is certified against the current catalog source fingerprint and unique IDs/keys. It is not a count of hand-authored flow files or separately executed model evaluations. The certificate is in [`catalog-certification.json`](catalog-certification.json).

```sh
npm test
npm run catalog:certify -- --check
```

After changing catalog source, run `npm run catalog:certify` to regenerate the manifest and root certificate. The repository CI runs tests and verifies the certificate without provider calls or page deployment.

## Deployment and media

The server binds to loopback by default. A single-tenant Ubuntu/Nginx installation may set an exact HTTPS `JEVFLOW_PUBLIC_ORIGIN` while keeping Node bound to `127.0.0.1`; Nginx must protect the **entire app**, including `/`, APIs, examples, docs, and media, with HTTP Basic Auth. The server checks the exact Host/Origin and loopback socket peer and ignores forwarded headers as authorization evidence. See the [deployment runbook](docs/deploy-hostinger.md). Do not expose the Node port publicly.

The walkthrough media and capture notes are in [`media/README.md`](media/README.md). The optional fixed-route Gemini TTS helper is documented in [`docs/walkthrough-tts.md`](docs/walkthrough-tts.md); running it requires an operator-supplied key and may incur a charge. Tests use injected transports and make no paid provider calls.
