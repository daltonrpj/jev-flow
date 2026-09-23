# Jev Flow quickstart

Jev Flow runs as a local Node.js app. Node.js 20 or later is required; Python is optional for Laya. A [public guide prepared for GitHub Pages](https://daltonrpj.github.io/jev-flow/) is a separate static brochure with real captures and a playable walkthrough; it does not run the application or its APIs.

The public guide has independent pages in [English](https://daltonrpj.github.io/jev-flow/), [Português (Brasil)](https://daltonrpj.github.io/jev-flow/pt-BR/), [Español](https://daltonrpj.github.io/jev-flow/es/), [Français](https://daltonrpj.github.io/jev-flow/fr/), and [Deutsch](https://daltonrpj.github.io/jev-flow/de/). These URLs require a future authorized Pages deployment; this checkout can build them locally with `npm run site:build`.

```sh
git clone https://github.com/daltonrpj/jev-flow.git
cd jev-flow
npm ci
npm start
```

Open `http://127.0.0.1:8723/`. It redirects to the Studio at `/jev/flows`; all product pages and APIs run in this local process. Fixtures and deterministic previews work without provider credentials. Add a credential in the Studio only for a live call. UI-entered keys stay in memory until the process stops.

| Open locally | Use it for |
| --- | --- |
| `http://127.0.0.1:8723/jev/flows` | Design, preview, validate, and run typed flows. |
| `http://127.0.0.1:8723/jev/flows/compendium` | Search, test, and install lazily generated configurations. |
| `http://127.0.0.1:8723/jev/battle` | Inspect Jev and LLM responses with explicit provider selection. |
| `http://127.0.0.1:8723/jev/carrinho` | Run the two-track driving simulation and inspect decisions. |
| `http://127.0.0.1:8723/jev/labs` | Try decision exercises, chess, and Blast Garden. |

The first run needs no API key. Import a generic flow from `examples/`, edit its input schema and policy gates, then use its synthetic fixture to inspect the route. To observe a real model answer, configure the intended provider and choose a live run explicitly. TypeSafe needs `TYPESAFE_API_KEY`; LLM calls need an explicitly configured key, endpoint, and model; Laya is an optional local Python adapter with separately installed weights. A missing provider stays unavailable. See [architecture](architecture.md) for source and cost labels and [examples](examples.md) for the editable templates.

Flow files, run history, schedules, rulesets, and provider usage records go to an operating-system Jev Flow data directory outside the checkout. `JEVFLOW_DATA_DIR` may explicitly choose a different directory. The app does not import data from other applications.

Run the test suite and refresh the Compendium certificate after editing its source:

```sh
npm test
npm run catalog:certify
```

The full walkthrough, English captions, transcript, and real application screenshots are in [`media/`](../media/README.md). The animated GIF in the README links to the full WebM; the separate public guide contains a video player. GitHub's Markdown view and GitHub Pages do not run this repository's Node server; start the local process to use the app.
