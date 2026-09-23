# Architecture

Jev Flow keeps uncertain interpretation, deterministic policy, and effects in separate steps.

1. A trigger provides an input object.
2. A `jev.ask` node sends typed Choice, Noul, or Score questions to the configured Jev provider. Local fixtures can supply typed answers for simulation.
3. The runtime validates the response schema and records source, model, latency, and usage when the provider returns them.
4. Conditions, limits, verification, and explicit review paths route the validated result.
5. Action nodes record a log or call an approved webhook. Webhooks require the flow's explicit policy gates and URL protections.

The flow engine owns the workflow. Jev judgments are data, not executable instructions. LLM chat is an optional, separate adapter for assist/design tasks and does not replace typed Jev answers. Laya is an optional local provider; the project links upstream and does not bundle weights or claim model quality without compatible validation evidence.

The Compendium creates each candidate from patterns, domains, variants, thresholds, complexity profiles, and focus options. It does not materialize every configuration as a file. A source fingerprint and full validation pass are required before its count is shown as certified.

## Execution and measurement

| Label | Evidence required | What remains unknown |
| --- | --- | --- |
| Fixture or preview | A supplied synthetic answer or deterministic rule | How any provider would answer live. |
| Local | The selected local adapter completed inference against its active model | External API billing and model quality beyond the tested case. |
| Remote | The intended endpoint returned a typed, schema-valid response | Price when no reliable rate metadata exists. |
| Unavailable or invalid | A missing key, timeout, transport error, or invalid typed response | Any unobserved answer, usage, or cost. |

Latency is measured around the observed request, not copied from a fixture. Tokens and usage are displayed when returned by the provider; a cost estimate needs explicit price metadata. A missing value stays unknown. Arena comparisons should only claim a winner for comparable, completed, observed responses with a valid scoring basis. Self-Driving Cart and Labs may use deterministic local game logic, but that logic is labeled separately from model decisions.
