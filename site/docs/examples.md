# Editable flow examples

The five JSON files in `site/examples/` are generic teaching drafts. The static site's editor loads and downloads them without contacting a provider or running effects. Each includes a synthetic fixture. Adapt input schemas, questions, thresholds, and review branches to your own policy before use.

| Example | Typed judgment | Code-owned route | Boundary |
| --- | --- | --- | --- |
| [Support triage](../examples/support-triage.flow.json) | Choice for queue and Noul for an explicit deadline | Billing, technical, or human review | Logs draft routes; does not send a ticket |
| [Spam screening](../examples/spam-screening.flow.json) | Choice for label and Noul for a credential request | Ordinary label or human review | Does not delete, block, or report content |
| [Anomaly review](../examples/anomaly-review.flow.json) | Ordinal Score for deviation from a supplied baseline | Routine log or human review | Does not claim a statistical anomaly probability |
| [Refund intake](../examples/refund-intake.flow.json) | Choice for intent and Noul for order context | Human policy review or request context | Does not determine entitlement or issue a refund |
| [Interactive Labs](../examples/interactive-labs.flow.json) | Choice for exercise and Noul for stated criterion | Classification, ranking, or clarification | Does not make an external change |

Noul is a probability of **yes** for the stated proposition, not a generic confidence field. Score is an ordinal value; its meaning comes from the question's scale. Choice confidence, when a provider supplies it, describes a distribution over options and is not proof of correctness. A typed answer remains evidence for validation and policy code.

For a real flow, run engine validation in the local Studio. The website's **Inspect structure** button is intentionally limited to JSON parsing and a few shape checks.
