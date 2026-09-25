# Jev Flow update context

This file preserves compact project context across releases and substantial updates. Keep the latest entry first. For every comparable update, record the upstream source, user-visible changes, verification, and actual deployment state. Never record credentials, assume a provider call happened, or describe a fixture as a live result.

## 1.1.1 — 2026-09-24

- **Upstream:** standalone repository `main`; guide changes were committed as `c75c8fb560c8f249f9367b9a0fddbe44b1e0956d` on top of the prior `v1.1.0` state `8b6a31a`.
- **Changes:** replaced the field-note walkthrough block with a concise product-tour description and embedded player; explained Jev's structured answers and code-controlled routing in plain English; clarified Arena timing, token availability, and estimated costs; separated Jev-compatible backends, local Laya, and LLM use; corrected the Compendium certificate and Ship Suite descriptions; explained the games; translated the revised copy into pt-BR, es, fr, and de.
- **Files:** `site/index.html`, `site/translations.mjs`, `scripts/site-build.test.mjs`, `scripts/repository-contract.test.mjs`, package metadata, `CHANGELOG.md`, and this context record.
- **Verification:** local `npm run site:build` emitted 24 allowlisted public files; focused site tests passed 9/9; full `npm test` passed 138/138; `npm run catalog:certify -- --check` validated 388,080/388,080 configurations. On the VPS, `npm test` passed 136/136 with 2 Playwright-only checks skipped because Playwright is not installed there; catalog certification passed 388,080/388,080 and the site build emitted 24 files. No remote model provider was called.
- **Release:** commit [`c75c8fb`](https://github.com/daltonrpj/jev-flow/commit/c75c8fb560c8f249f9367b9a0fddbe44b1e0956d) is on `main`; annotated tag [`v1.1.1`](https://github.com/daltonrpj/jev-flow/tree/v1.1.1) points to this deployment record commit.
- **Deployment:** static site release `/srv/jev-flow-site/releases/c75c8fb560c8` is active at `https://jevflow.cloud/`; rollback target `/srv/jev-flow-site/releases/e1658374dd2b` is preserved. Root, pt-BR, es, fr, and de pages returned 200; the embedded WebM returned 200 `video/webm`; public `/api/health` returned the expected 404. The Node application service was not restarted or changed.
- **Open items:** none for this guide update. The two Playwright-only checks were covered by the full local test run.

## Prior release context — 1.1.0

- **Product:** standalone open-source Jev Flow repository: <https://github.com/daltonrpj/jev-flow>.
- **Release:** 1.1.0, 2026-09-24. Local `main` was synchronized with `origin/main` at `0ed1384` before this release work; the complete product update is commit `e1658374dd2b`.
- **Included product surfaces:** visual Flow Studio; lazily generated, certified Compendium (388,080 valid configurations); Battle Arena; Self-Driving Cart; Jev Ship Pack and its gates/CLI; 52-case synthetic Ship Suite; games/labs; prompt and context tools; webhook, subflow, loop, error-branch, and design-chat support.
- **Branding:** `site/assets/jev-flow-logo-master.png` is the 1254 × 1254 ImageGen master, generated from the user-provided logo reference. The site header and footer use it; `scripts/build-site.mjs` copies it through the explicit public asset allowlist.
- **Product boundary:** only this standalone Jev Flow checkout is published. The public multilingual guide is static. The Node Studio and provider calls run locally or in a separately protected deployment. Never add Atlas workspace files, `.env` files, credentials, or private runtime data.
- **Deployment topology:** follow [`deploy-hostinger.md`](deploy-hostinger.md). The public guide is served from the VPS static site path; the application service is separate and protected. Use immutable release directories and atomic symlink switching; do not expose internal runtime APIs publicly.

## 1.1.0 — 2026-09-24

- Synced against the latest GitHub `main` before release; the complete Jev Flow feature set listed above was already present at `0ed1384`.
- Added the ImageGen logo asset and integrated it into the multilingual static guide.
- Added `CHANGELOG.md`, this persistent context file, and the `AGENTS.md` rule to maintain them on future releases.
- Raised package version to 1.1.0.
- **Verification:** Windows `npm test` passed 138/138; VPS `npm test` passed 136 with 2 Playwright checks skipped because Playwright is not installed on the host. GitHub Actions for tag `v1.1.0` passed in 44 seconds. `npm run catalog:certify -- --check` validated 388,080/388,080 configurations, and `npm run site:build` emitted 24 allowlisted files. No paid or remote model call was made. No tracked environment or runtime-data paths were included.
- **Release:** pushed `main` through `e1658374dd2b`; annotated tag [`v1.1.0`](https://github.com/daltonrpj/jev-flow/tree/v1.1.0) points to the deployed source commit.
- **Deployment:** VPS app and static guide now point to `/opt/jev-flow/releases/e1658374dd2b` and `/srv/jev-flow-site/releases/e1658374dd2b`. `jev-flow` and `nginx` are active; loopback `/api/health` returned 200 and the service process loaded the new app release. Public English and pt-BR pages returned 200; the logo returned 200 `image/png` (937,122 bytes); public `/api/health` returned the expected 404 because the app API is not exposed.
- **Backup/rollback:** `/var/backups/jev-flow-pre-e1658374dd2b.tar.gz` was created with mode 0600 and verified readable. The previous app and site releases remain pointed to by their `previous` symlinks.
- **Open items:** the two Playwright-only checks were not run on the VPS host; both passed as part of the Windows test suite. Live Jev/LLM benchmark runs remain deliberately out of scope for this release verification.

## Future update entry template

```md
## X.Y.Z — YYYY-MM-DD

- **Upstream:** remote/branch and source commit synchronized.
- **Changes:** concise product and documentation changes, with important counts qualified.
- **Files:** key paths added or changed.
- **Verification:** exact build/check commands and outcomes; state whether any remote provider was called.
- **Release:** commit and tag URLs after publishing.
- **Deployment:** target and externally observed status codes/version, or `not deployed` with the reason.
- **Open items:** only confirmed follow-up work.
```
