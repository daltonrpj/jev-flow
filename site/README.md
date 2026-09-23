# Static JEV Flow product site

`index.html` is an English-primary, Portuguese-localized static page. Styles, scripts, diagrams, examples, and the verified Studio screenshot are local. The planned walkthrough media remains separate. The guide runs independently of provider credentials and can be hosted by GitHub Pages.

For a local preview, serve the repository root or this directory over HTTP, then open `site/index.html` or `/` respectively. File URLs can block `fetch` for the editable examples.

The website does not run JEV Flow. The actual Studio is served by the Node application at `/jev/flows`. Its setup guide is [docs/quickstart.md](./docs/quickstart.md).

## Catalog count display

The source catalog reference is 388,080 generated configurations. The page shows a verified standalone count only if `catalog-certification.json` exists and matches the contract documented in [quickstart](./docs/quickstart.md#4-catalog-certification). Do not hand-write or copy a certificate from another tree. Generate it during standalone certification from the exact source being published.

## Media

See [media/README.md](./media/README.md) for the real Studio screenshot and the planned video, captions, and transcript paths. The default SVGs are diagrams with visible illustration labels.

## Deployment

A Pages workflow publishes `site/` only after a clean dependency install, the test suite, and a source-fingerprint check confirm the committed catalog certificate matches the current generator and validator. GitHub Pages does not run the Node server. Keep provider credentials and local runtime data outside the published artifact.
