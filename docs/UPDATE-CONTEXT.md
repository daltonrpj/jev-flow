# Jev Flow update context

This file preserves compact project context across releases and substantial updates. Keep the latest entry first. For every comparable update, record the upstream source, user-visible changes, verification, and actual deployment state. Never record credentials, assume a provider call happened, or describe a fixture as a live result.

## Current release context

- **Product:** standalone open-source Jev Flow repository: <https://github.com/daltonrpj/jev-flow>.
- **Release:** 1.1.0, 2026-09-24. Local `main` was synchronized with `origin/main` at `0ed1384` before this release work.
- **Included product surfaces:** visual Flow Studio; lazily generated, certified Compendium (388,080 valid configurations); Battle Arena; Self-Driving Cart; Jev Ship Pack and its gates/CLI; 52-case synthetic Ship Suite; games/labs; prompt and context tools; webhook, subflow, loop, error-branch, and design-chat support.
- **Branding:** `site/assets/jev-flow-logo-master.png` is the 1254 × 1254 ImageGen master, generated from the user-provided logo reference. The site header and footer use it; `scripts/build-site.mjs` copies it through the explicit public asset allowlist.
- **Product boundary:** only this standalone Jev Flow checkout is published. The public multilingual guide is static. The Node Studio and provider calls run locally or in a separately protected deployment. Never add Atlas workspace files, `.env` files, credentials, or private runtime data.
- **Deployment topology:** follow [`deploy-hostinger.md`](deploy-hostinger.md). The public guide is served from the VPS static site path; the application service is separate and protected. Use immutable release directories and atomic symlink switching; do not expose internal runtime APIs publicly.

## 1.1.0 — 2026-09-24

- Synced against the latest GitHub `main` before release; the complete Jev Flow feature set listed above was already present at `0ed1384`.
- Added the ImageGen logo asset and integrated it into the multilingual static guide.
- Added `CHANGELOG.md`, this persistent context file, and the `AGENTS.md` rule to maintain them on future releases.
- Raised package version to 1.1.0.
- **Verification/deployment:** fill this section with the actual build, repository push/tag, and public deployment checks completed for this release. Do not mark a step complete before observing it.

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
