# Jev Flow quickstart

Jev Flow runs as a local Node.js app. Node.js 20 or later is required; Python is optional for Laya.

```sh
git clone https://github.com/daltonrpj/jev-flow.git
cd jev-flow
npm ci
npm start
```

Open `http://127.0.0.1:8723/jev/flows`. The landing page at `/` is a guide; the Studio and API run in this local process. Fixtures and deterministic previews work without provider credentials. Add a credential in the Studio only for a live call. UI-entered keys stay in memory until the process stops.

Flow files, run history, schedules, rulesets, and provider usage records go to an operating-system Jev Flow data directory outside the checkout. `JEVFLOW_DATA_DIR` may explicitly choose a different directory. The app does not import data from other applications.

Run the test suite and refresh the Compendium certificate after editing its source:

```sh
npm test
npm run catalog:certify
```

GitHub Pages hosts only the static guide in `site/`; it does not host the Node server, provider credentials, flows, or API.
