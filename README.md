# Jev Flow

Jev Flow is a standalone visual studio for building, testing and running workflows that combine typed Jev judgments with deterministic code. It includes a flow editor, local simulation, a generated catalogue of certified configurations, Battle Arena, the self-driving cart, and decision labs for spam, evidence review, chess and Blast Garden.

The public product guide is [daltonrpj.github.io/jev-flow](https://daltonrpj.github.io/jev-flow/) and its source is in [`site/`](site/index.html). The runtime is a Node.js application; GitHub Pages hosts only the static guide, not the local API server.

## Quick start

Requirements: Node.js 20 or later. Python is optional and is used only for the separate Laya local adapter.

```sh
npm ci
npm start
```

Open `http://127.0.0.1:8723/jev/flows`. User flows, execution history, rulesets and provider usage logs are stored under the operating system's Jev Flow data directory, outside this repository. Set `JEVFLOW_DATA_DIR` to move that directory.

## What runs here

| Surface | Local route | What you can inspect | Limit |
| --- | --- | --- | --- |
| Studio | `/jev/flows` | Editable typed flows, schemas, fixture preview, run traces and explicit live execution | A fixture proves routing for supplied answers, not provider accuracy. |
| Compendium | `/jev/flows/compendium` | Search, preview, test and install generated flow configurations | 388,080 counts certified configurations, not live model runs. |
| Battle Arena | `/jev/battle` | Jev and LLM answers, source, measured latency and usage where available | Comparisons depend on compatible tasks and observed provider responses. |
| Self-Driving Cart | `/jev/carrinho` | Two simulated tracks, decisions, safety interventions and source labels | Track physics and fallback decisions are a simulation, not a driving safety claim. |
| Labs | `/jev/labs` | Typed decision exercises, chess and Blast Garden | Local game rules are deterministic; model decisions require a selected provider. |

The public guide at `/` documents these surfaces. It cannot execute the Studio from GitHub Pages. See the [quickstart](docs/quickstart.md), [architecture](docs/architecture.md), [examples](docs/examples.md), and [walkthrough narration helper](docs/walkthrough-tts.md).

| Execution source | What it means | Cost display |
| --- | --- | --- |
| Fixture or preview | Synthetic answers supplied for deterministic testing; no provider request | No remote-provider cost. |
| Local adapter | A compatible local model and checkpoint actually ran | Provider billing does not apply; compute cost is not inferred. |
| Remote provider | An explicitly configured provider returned a validated answer | Report provider usage and price-backed cost only when available; otherwise show unknown. |
| Unavailable or invalid | Missing key, failed transport, or malformed response | Keep the error visible and cost unknown. |

## Connect real providers

Set keys in the server process environment, or use the in-app connection form. Keys entered in the UI are kept in server memory and are cleared when the process restarts. They are never written into a project file.

```sh
TYPESAFE_API_KEY=... JEVFLOW_LLM_API_KEY=... JEVFLOW_LLM_MODEL=your-model npm start
```

`TYPESAFE_API_KEY` calls TypeSafe System One for real typed judgments. `JEVFLOW_LLM_API_KEY` or `OPENAI_API_KEY` calls the default OpenAI-compatible endpoint. For Gemini, explicitly pair `GEMINI_API_KEY` with `JEVFLOW_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`. Endpoint and key are never inferred from whichever provider key happens to be present. Missing providers stay unavailable; fixtures and local rules are not presented as remote model answers.

The application intentionally binds only to loopback. Without `JEVFLOW_PUBLIC_ORIGIN`, it accepts local Host/Origin pairs and is not a remotely hosted Studio. For a **single-tenant Ubuntu/Nginx VPS**, set an exact HTTPS `JEVFLOW_PUBLIC_ORIGIN`, keep `HOST=127.0.0.1`, and put HTTP Basic Auth on `/jev` and `/api` at Nginx. The guide at `/` can remain public. The app requires the configured Host/Origin and a loopback socket peer; it never treats forwarded headers as proof of origin. See the [Hostinger deployment runbook](docs/deploy-hostinger.md) and [security boundary](docs/security.md). GitHub Pages remains a static guide with no Studio API.

## The catalogue

The Compendium generates configurations on demand from 22 patterns, 42 unique domains, 7 variants, 4 thresholds, 3 complexity profiles and 5 focus options: **388,080 valid configurations**. They are not 388,080 separately authored files or separately executed model runs. Each generated candidate is mechanically validated by the catalogue engine. Rebuild the certificate after changing its sources:

```sh
npm run catalog:certify
```

## Local Laya (optional)

Jev Flow links to the upstream Laya project; it does not bundle model weights or install Python packages automatically. Follow the Laya setup links from the Battle Arena and then set `LAYA_PYTHON` to the Python environment where Laya is installed.

## Project boundaries

- The runtime is a focused Jev Flow application with its own provider adapter and user data directory. It does not require a workspace monolith or its data store.
- Preview and local game logic are labeled simulation. TypeSafe, LLM and Laya results report their actual execution source and model.
- Webhook flows are validated for explicit budget and verification gates and use URL/DNS protections. Review a flow before enabling external effects.
- Personalized examples are generic templates. Edit their input schemas and fixtures for your own workflow.
- Costs remain unknown if the provider does not return usage/pricing or the model has no declared price metadata.

## Development

```sh
npm test
```

The optional narration CLI is documented in [`docs/walkthrough-tts.md`](docs/walkthrough-tts.md). It requires an explicit operator run; tests never call a paid provider.

## Walkthrough

Watch the [English Jev Flow walkthrough](site/media/jev-flow-walkthrough.webm), use the [English captions](site/media/jev-flow-walkthrough.vtt), or read the [narration and demo provenance](site/media/jev-flow-walkthrough-transcript.md). It shows the standalone application using labeled fixtures and local game rules; it does not claim a live remote model call.
