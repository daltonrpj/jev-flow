# Architecture and provenance

```text
known state → bounded typed question → schema/range validation → code policy → result and audit
```

JEV Flow asks narrow questions. **Choice** selects from a closed set, **Noul** returns a probability of yes for a clear proposition, and **Score** rates a documented ordinal scale. The flow validates returned types and ranges before branch logic consumes them.

The model's answer is not an instruction to run an effect. Code owns thresholds, branching, review routes, and authorization. Missing or malformed answers fail visibly. Unknown cost remains unknown, rather than being reported as zero.

## Sources you may see

- **Preview / fixture:** deterministic, supplied answers. Useful for routing tests; not evidence of a provider's behavior.
- **Local Laya-compatible adapter:** a call to a configured local service. Model/checkpoint identity and calibration eligibility should be exposed. A record on disk alone is not proof of quality.
- **Remote TypeSafe / Jev:** an explicit provider call with runtime credential. Report the provider/model and measured latency; usage and cost only when returned or grounded in an explicit calculation.
- **Unavailable / failure:** missing credential, bad schema, timeout, or transport failure. No successful typed judgment should be implied.

The public static site is a guide and example editor. It does not execute flows, providers, or external actions. Start the Node app and visit `/jev/flows` for the Studio.
