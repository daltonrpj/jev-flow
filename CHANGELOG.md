# Changelog

User-visible releases of Jev Flow are recorded here. See [`docs/UPDATE-CONTEXT.md`](docs/UPDATE-CONTEXT.md) for the longer project and deployment context.

## 1.1.0 — 2026-09-24

- Consolidates the standalone Jev Flow Studio, generated Compendium, Battle Arena, Self-Driving Cart, Jev Ship Pack and suite, games, prompt/context tools, and webhook/subflow integrations already present on `main`.
- Adds the high-resolution Jev Flow logo based on the supplied reference to the public guide header and footer; the static site build now includes the image in its explicit asset allowlist.
- Records a repeatable release-context log and makes it part of the repository's update process.
- Keeps the public guide static and the Node application separately deployable; no Atlas workspace files, environment files, provider secrets, or private runtime data are included.
