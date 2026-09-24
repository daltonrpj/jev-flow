# Ship Pack, live suite, and workflow integrations

Jev Flow includes ten packaged Jevlet definitions and eleven gates inspired by the public [Ship with Jev catalog](https://www.shipwithjev.com/). A Jevlet describes typed questions and a deterministic policy. A gate fills the Jevlet's input schema, checks the provider response, and returns the policy outcome. The command suggestion gate has a local edit-distance fallback. Packaged definitions are available in a clean checkout; they are **not** a claim that the currently connected provider has passed certification.

Open `/jev/ship` to inspect the gates, their required fields, a synthetic example, a deliberate live run, and an activity report. CLI equivalents:

```sh
node bin/jev-flow.mjs ship list
node bin/jev-flow.mjs ship doctor
node bin/jev-flow.mjs ship report 7
# Explicit provider calls and publication, after configuring TypeSafe:
node bin/jev-flow.mjs ship doctor --live
node bin/jev-flow.mjs ship install --live
```

`ship install --live` validates all ten definitions, tests every fixture against the connected Jev provider, requires a full pass for each, and only then registers them under `JEVFLOW_DATA_DIR/jevlets`. Static validation and injected tests do not create a live certification. The activity journal is stored under `JEVFLOW_DATA_DIR/decisions.jsonl`; it records an input hash and outcome metadata, not raw support messages or clauses. Unknown cost and savings remain unknown.

## Ship Test Suite

`/jev/suite` contains **12 synthetic scenarios with 52 fixed cases**. The Arena at `/jev/battle` exposes these alongside its earlier fixed-case tests, totaling **27 visible scenarios with 164 cases**. A separate dynamic game test is available through its game surface. The score measures agreement with each fixture's expected answer; it is not a general model accuracy estimate. A full suite run sends at most 52 Jev requests and can incur provider charges; the browser asks for confirmation before sending them. The server also reserves request units in its 30-minute window. These controls cap the call count, not the provider's USD charge. It does not run automatically when the page opens.

```sh
node bin/jev-flow.mjs suite history
node bin/jev-flow.mjs suite run --live
node bin/jev-flow.mjs suite baseline set
```

A baseline is set explicitly by the operator from the latest complete 52-case live run, through the page or `suite baseline set`. Partial, unavailable, and injected test runs cannot become the baseline. Subsequent full live runs are compared to it with a two-percentage-point tolerance. The API returns the actual model and an estimated cost only when supported by usage and a price basis; a missing cost is `null`.

## Conversational design and prompt/context tools

The Studio's **Create a flow by chatting** drawer produces a draft, shows its validation result, accepts refinements over the current flow, and saves only after the user clicks **Save and open canvas**. Up to two repair passes use validator errors when an LLM draft is invalid. Flow topology may be sent to the configured LLM, but secrets and fixture values are projected out first. The current draft stays in the browser until saved. No LLM call occurs without a configured endpoint or an explicit action.

The APIs `POST /api/jev/prompt/compose`, `/api/jev/context/cache`, and `/api/jev/context/compact` expose the 16-pattern prompt composer, semantic cache judgment, and bounded context selection. Each returns its actual source: configured Jev, injected test client, or conservative local policy. See [`services/jev-prompt/README.md`](../services/jev-prompt/README.md) for programmatic examples.

## Webhook, subflows, and error branches

The engine supports `trigger.webhook`, `flow.call`, `flow.each`, `note.sticky`, and `onError: { "next": "node-id" }`:

| Node | Role | Limit |
| --- | --- | --- |
| `trigger.webhook` | Starts one independent run for `POST /api/jev/flows/<id>/hook` | Must be the start node; `path` is display metadata, not a second endpoint. |
| `flow.call` | Calls a saved subflow by ID | Parent and child share step, Jev-call, and token ceilings; recursive calls are rejected. |
| `flow.each` | Calls a subflow once for each item | Sequential, at most 25 items; preserves partial results on failure. |
| `note.sticky` | Documents the graph | Never participates in execution. |
| `onError` | Routes ordinary node failure to an explicit branch | Budget exhaustion and aborts terminate instead of bypassing safety limits. |

A webhook must name an environment variable such as `JEVFLOW_HOOK_SUPPORT` in its `secret` field. The variable's **value** stays outside the flow file. Every caller, including the same-origin Studio, must send that value in `x-jev-webhook-token`. Requests still require the exact Host, loopback proxy peer, JSON body (up to 1 MB), and the server's request budget. On an authenticated public deployment, the reverse proxy's Basic Auth also applies. An absent or unconfigured token is rejected. Never put the token value in a flow or URL.

Three shipped examples show support deflection, a data-quality gate, and contract-clause review under `services/jev-flow/examples/`. They use packaged Jevlets and synthetic fixtures. Run their local fixtures before connecting a provider; a fixture demonstrates routing, not a live judgment.

## Games

`/jev/games` adds Tic-Tac-Toe, a fictional combat judge, and JevFlow City. Local mode is deterministic and uses no provider. Each page has an explicit **Use live Jev** control; City batches its citizen judgments into one typed request per tick. Game scores and probabilities are scoped to those inputs and the chosen mode. A failed live call does not silently become a local result.
