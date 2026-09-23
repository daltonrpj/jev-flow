# Jev Flow: product walkthrough

**Spoken language:** English (United States)

**Voice generation:** Gemini 3.1 Flash TTS Preview (`google/gemini-3.1-flash-tts-preview`), voice `Charon`, requested through OpenRouter's `audio/speech` endpoint. The speech was returned as 24 kHz mono PCM and assembled without another voice or model fallback.

**Captions:** English; synchronized to the rendered narration and available as WebVTT.

**Demo provenance:** All visible sample judgments are deterministic fixtures or local rules. This recording does not claim that a remote Jev or LLM call was made. Live providers require explicit configuration by the user.

## Narration

### 1. Welcome

Welcome to Jev Flow: a standalone, open-source studio for building typed AI workflows with clear, code-owned outcomes.

### 2. The model and the workflow

A model returns structured evidence; your flow validates it, applies explicit rules, and chooses the next step.

### 3. Install locally

Clone the repository, install Node dependencies, and start the local server. No provider key is needed to explore fixtures.

### 4. Studio

Open the Studio to inspect a flow as connected, editable steps. Each node has a visible input and output.

### 5. Typed questions

Ask bounded Choice, Noul, or Score questions, then validate the answer against its declared type before routing.

### 6. Deterministic preview

The preview uses labeled synthetic answers, so you can reproduce branches without calling a model or triggering external actions.

### 7. Live provider runs

For live runs, connect a supported provider explicitly. The trace identifies source and model, and reports measured latency.

### 8. Fail visibly

If credentials are missing or output is invalid, the run stays unavailable or fails validation. Unknown costs stay unknown.

### 9. Compendium

The Compendium generates 388,080 certified configurations on demand from reusable patterns, domains, variants, and thresholds.

### 10. Reuse patterns

Search, inspect, and install a configuration as a starting point; this count is not 388,080 model executions.

### 11. Battle Arena

The Battle Arena puts Jev and a configured language model side by side, with separate answers and provenance.

### 12. Compare fairly

Compare like-for-like results using observed latency and provider-reported usage; inconclusive data does not produce a winner.

### 13. Self-Driving Cart

The Self-Driving Cart is a sandbox for testing lane choices, speed control, hazards, and safety interventions.

### 14. Read the telemetry

Adjust the course and decision interval, then review distance, action traces, latency, and available cost.

### 15. A bounded simulation

The simulation is an engineering exercise, not proof of real-world vehicle safety.

### 16. Labs

Labs include spam screening, evidence review, chess, Blast Garden, and rescue exercises.

### 17. Local rules

In game modes, the local rules engine validates proposed moves before they take effect.

### 18. Make it yours

Use examples to shape your own inputs, schemas, thresholds, fallbacks, and human-review branches.

### 19. Keep control explicit

Jev interprets bounded questions. Your code owns validation, policy, and every consequential action.

### 20. Close

Run locally, inspect every source, and build workflows you can test and explain. This is Jev Flow.
