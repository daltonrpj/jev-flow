# Jev Flow walkthrough narration

**Language:** English

**Target voice:** Gemini TTS (recording pending)

**Target duration:** about two minutes; timings below are scene guides, not captions.

**Status:** narration draft. Do not describe a fixture as a live provider response.

## 00:00 — What Jev Flow does

Jev Flow is a local studio for workflows that combine typed AI judgments with deterministic code. The model answers a bounded question. Your flow validates that answer, applies policy, and controls what happens next.

## 00:17 — Start locally

Clone the open-source project, install its Node dependencies, and start the app on your own machine. The website is a guide; the Studio and its API run locally. You can explore without provider credentials. Keys entered in the Studio stay in server memory and are cleared when it stops.

## 00:34 — Build and preview a flow

This support example begins with synthetic input, asks a typed question, checks the answer, and routes uncertain cases to review. A fixture preview is deterministic. It tests your workflow logic; it is not a call to Jev. Missing or malformed answers remain visible and cannot silently become a successful action.

## 00:57 — Inspect a real judgment

When you explicitly connect TypeSafe, the run shows the actual model and execution source. The flow checks the typed result before applying its threshold and branch. Latency and provider-reported usage are shown when available. If cost cannot be established, it stays unknown.

## 01:20 — Explore the Compendium

The standalone catalog certifies three hundred eighty-eight thousand and eighty valid configurations. They are generated from reusable dimensions, not separately authored files or individual model runs. Search the catalog, inspect a configuration, and install the pattern that fits your application.

## 01:39 — Compare and experiment

The Battle Arena can compare a real Jev judgment with a configured language model, while keeping each source, response, latency, and available cost explicit. The labs cover spam screening, evidence review, chess, and Blast Garden. In every case, code checks proposed actions before applying them; an illegal move is rejected.

## 02:03 — Make it yours

Use the examples as starting points, then change their schema, questions, thresholds, and review paths for your own needs. Jev helps interpret the input. Your code owns the decision boundary.
