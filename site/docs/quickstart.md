# JEV Flow quickstart

JEV Flow is a local Node application for typed AI judgments and code-owned workflows. This page is static documentation; it does not host the application or a provider API.

## 1. Install from the standalone repository

The standalone source is published at [`github.com/daltonrpj/jev-flow`](https://github.com/daltonrpj/jev-flow). Clone and start it locally:

```sh
git clone https://github.com/daltonrpj/jev-flow.git
cd jev-flow
npm ci
npm run catalog:certify
npm start
```

The project requires Node.js 20 or later. No credential is needed to read this site or explore local fixtures and deterministic previews. A clean checkout works without a committed `.env` file or generated data directory.

The Studio route served by the Node application is **`/jev/flows`**. GitHub Pages serves only this site and its local media; it cannot run the Studio.

## 2. Build a first flow

1. Open the local Studio after the server starts.
2. Choose a generic example from the [editable examples](../index.html#examples). Download its JSON and adapt the input schema, questions, thresholds, and review branches to your application.
3. Run a **fixture / deterministic preview** with supplied synthetic answers. It exercises the workflow logic, not a Jev model.
4. Inspect the branch, typed values, validation result, and provenance. Missing or invalid answers must be surfaced visibly.
5. Configure a provider at runtime only when ready to make an explicit live call.

The examples in this site use only `action.log`. They do not approve refunds, transmit tickets, block users, or contact external services.

## 3. Choose a provider deliberately

| Mode | What it establishes |
| --- | --- |
| Fixture / deterministic preview | How the flow routes answers you supplied. No model call or remote cost is implied. |
| Local Laya-compatible inference | A real local adapter call when a compatible endpoint and checkpoint are configured. Inspect checkpoint and calibration status; a calibration record alone does not establish quality. |
| Remote TypeSafe / Jev | A real typed judgment only after you configure a valid runtime credential and explicitly run it. Inspect source, model, measured latency, and usage when returned. |
| Unavailable / failed | Missing keys, network failures, timeouts, and invalid schemas remain errors. No judgment or effect should be inferred. |

Supply credentials through documented runtime configuration in the published application. Do not place keys in a flow JSON, web page, screenshot, repository file, or browser local storage. The static site never asks for credentials.

## 4. Catalog certification

The source catalog reports **388,080 generated configurations**. This count is a Cartesian product of pattern, domain, variant, threshold, complexity, and focus options. It does **not** mean 388,080 hand-authored flows or model-tested runs.

The site reads `site/catalog-certification.json` only if the standalone certification generated a successful record with:

- `scope: "standalone"`, `passed: true`, and `version: "jev-flow-catalog-v3"`;
- `candidateCount`, `validCount`, `uniqueKeys`, and `uniqueIds` all equal to **388080**;
- a 64-character source fingerprint and certification date.

Without that fresh record, the site displays **Pending** and cites 388,080 only as the source catalog reference. Keep the certificate tied to the exact standalone source and manifest; rerun certification after changing the catalog generator or flow engine.

## 5. Inspect, customize, and test

See [example notes](./examples.md) for each starter flow and [architecture](./architecture.md) for the decision boundary. The website's JSON editor checks only that JSON parses and has a basic flow shape. It does **not** run the engine, contact Jev, or certify a flow. Use the local Studio and application tests for actual validation and execution.

## Media and source

- A sanitized capture of the standalone Studio is included at `site/media/studio-screenshot.png`. It shows a synthetic support flow and deterministic fixture preview, not a live provider response.
- The final walkthrough path is `site/media/jev-flow-walkthrough.webm`, with `jev-flow-walkthrough.vtt` captions and a transcript. The video player appears only when all files are present.
- See [media status](../media/README.md).
