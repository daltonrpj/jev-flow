# Standalone product parity — tasks

- [x] Add repository guidance and this requirements/design/tasks record.
- [x] Update README and public docs with the five surfaces, provider/source map, cost limits, and local setup.
- [x] Correct generic example wording so synthetic fixture answers are explicit.
- [x] Add an offline, fixed-route Gemini 3.1 Flash TTS helper with injected-fetch regressions.
- [x] Add focused standalone runtime and certification smoke coverage without external calls.
- [x] Run focused tests (10/10) and the complete local test suite (62/62). Existing site tests verified the Compendium certificate and source fingerprint.
- [x] Integrate the English Gemini 3.1 Flash TTS narration, standalone-app capture, WebM, synchronized English VTT, transcript, and player state. Verify browser playback, 20 subtitle cues, 1920×1080 video metadata, and non-silent final audio.
- [ ] Run a remote-provider smoke and verify its reported source, usage, and cost separately from fixture tests. Blocked in this environment because no TypeSafe/Jev or LLM provider credentials are configured; the walkthrough labels fixtures and local rules and makes no remote inference claim.
