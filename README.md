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

See [`docs/quickstart.md`](docs/quickstart.md), [`docs/architecture.md`](docs/architecture.md), [`docs/security.md`](docs/security.md), and [`docs/examples.md`](docs/examples.md).
