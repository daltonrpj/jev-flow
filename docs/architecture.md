# Architecture

Jev Flow keeps uncertain interpretation, deterministic policy, and effects in separate steps.

1. A trigger provides an input object.
2. A `jev.ask` node sends typed Choice, Noul, or Score questions to the configured Jev provider. Local fixtures can supply typed answers for simulation.
3. The runtime validates the response schema and records source, model, latency, and usage when the provider returns them.
4. Conditions, limits, verification, and explicit review paths route the validated result.
5. Action nodes record a log or call an approved webhook. Webhooks require the flow's explicit policy gates and URL protections.

The flow engine owns the workflow. Jev judgments are data, not executable instructions. LLM chat is an optional, separate adapter for assist/design tasks and does not replace typed Jev answers. Laya is an optional local provider; the project links upstream and does not bundle weights or claim model quality without compatible validation evidence.

The Compendium creates each candidate from patterns, domains, variants, thresholds, complexity profiles, and focus options. It does not materialize every configuration as a file. A source fingerprint and full validation pass are required before its count is shown as certified.
