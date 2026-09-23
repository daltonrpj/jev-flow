# Standalone product parity — tasks

- [x] Add repository guidance and this requirements/design/tasks record.
- [x] Update README and Markdown docs with the five surfaces, provider/source map, cost limits, and local setup.
- [x] Correct generic example wording so synthetic fixture answers are explicit.
- [x] Add an offline, fixed-route Gemini 3.1 Flash TTS helper with injected-fetch regressions.
- [x] Add focused standalone runtime and certification smoke coverage without external calls.
- [x] Integrate the English Gemini 3.1 Flash TTS narration, standalone-app capture, WebM, synchronized English VTT and transcript. Verify browser playback, 20 subtitle cues, 1920×1080 video metadata, and non-silent final audio.
- [x] Move five editable examples to root `examples/`, media to root `media/`, and the catalog certificate to root.
- [x] Retain the real Studio still, extract Compendium, Arena, Cart and Labs frames from the walkthrough, capture Chess in the local app, and create a short GIF teaser linked to the full WebM.
- [x] Remove the site tree and Pages workflow, add app-only CI, and update Nginx, server, docs, and tests.
- [x] Run the complete local suite (`npm test`: 62/62), catalog certification (`npm run catalog:certify`: 388,080 valid/unique IDs and keys, fingerprint `dfa4bee0686e1e1dae5a88d5a702ecd24cee0285a19dcc24d8a52ce234c1be54`), and read-only CI certificate check (`npm run catalog:certify -- --check`: passed).
- [ ] Run a remote-provider smoke and verify its reported source, usage, and cost separately from fixture tests. Blocked in this environment because no TypeSafe/Jev or LLM provider credentials are configured; the walkthrough labels fixtures and local rules and makes no remote inference claim.
