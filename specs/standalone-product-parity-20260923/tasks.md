# Standalone product parity — tasks

- [x] Add repository guidance and this requirements/design/tasks record.
- [x] Update README and Markdown docs with the five surfaces, provider/source map, cost limits, and local setup.
- [x] Correct generic example wording so synthetic fixture answers are explicit.
- [x] Add an offline, fixed-route Gemini 3.1 Flash TTS helper with injected-fetch regressions.
- [x] Add focused standalone runtime and certification smoke coverage without external calls.
- [x] Integrate the English Gemini 3.1 Flash TTS narration, standalone-app capture, WebM, synchronized English VTT and transcript. Verify browser playback, 20 subtitle cues, 1920×1080 video metadata, and non-silent final audio.
- [x] Move five editable examples to root `examples/`, media to root `media/`, and the catalog certificate to root.
- [x] Retain the real Studio still, extract Compendium, Arena, Cart and Labs frames from the walkthrough, capture Chess in the local app, and create a short GIF teaser linked to the full WebM.
- [x] Keep the Node runtime and its Nginx deployment protected; app CI stays separate from Pages publication.
- [x] Restore a public static guide in `site/` with real captures, a playable WebM, relative assets, honest provenance, and a preserved `#install` anchor.
- [x] Add `site:build` with an explicit public asset allowlist and tests that reject accidental checkout publication.
- [x] Add a separate Pages workflow that runs offline tests and certification, builds `site/dist`, and uploads only that directory.
- [x] Run the prior complete local suite (`npm test`: 62/62), catalog certification (`npm run catalog:certify`: 388,080 valid/unique IDs and keys, fingerprint `dfa4bee0686e1e1dae5a88d5a702ecd24d8a52ce234c1be54`), and read-only CI certificate check (`npm run catalog:certify -- --check`: passed).
- [x] Re-run the suite (`npm test`: 65/65), read-only certificate check (388,080 valid/unique configurations), and isolated `site:build` (19 allowlisted public files) after restoring the public guide.
- [x] Browser-review the guide at 320, 390, 520 and 1440 px widths; verify all six screenshots, the favicon, no failed requests, and local WebM playback at 1920×1080 for 193.913 s.
- [ ] Run a remote-provider smoke and verify its reported source, usage, and cost separately from fixture tests. Blocked in this environment because no TypeSafe/Jev or LLM provider credentials are configured; the walkthrough labels fixtures and local rules and makes no remote inference claim.
