# Starter examples

The five editable JSON examples in `site/examples/` are deliberately generic and use synthetic inputs and fixture answers. Those answers are test data, not observed provider output. The templates contain no personal data or external actions.

| Example | What it demonstrates | Start here |
| --- | --- | --- |
| Support triage | Typed urgency classification with a review branch | `site/examples/support-triage.flow.json` |
| Refund intake | Gather order context and route an exception for review | `site/examples/refund-intake.flow.json` |
| Spam screening | Separate deterministic checks from uncertain classification | `site/examples/spam-screening.flow.json` |
| Anomaly review | Rank a signal, preserve evidence, and route uncertain cases | `site/examples/anomaly-review.flow.json` |
| Interactive labs | A typed decision lesson about activity selection; the interactive chess and Blast Garden boards are separate pages under `/jev/labs` | `site/examples/interactive-labs.flow.json` |

Import a JSON file in the Studio, review its input schema and branches, then run a deterministic fixture. To use real Jev judgments, configure TypeSafe/OpenJev and explicitly run the flow. A simulation demonstrates routing for supplied answers; it does not prove model accuracy.

The Compendium generates configurations from six dimensions as needed. Its **388,080** certified configurations are not 388,080 hand-authored workflows or live model evaluations. The certification counts valid, unique keys and IDs for the exact catalog source.
