# Security and data boundaries

## Credentials and user data

- No secrets, `.env` file, provider key, model weight, user flow, run log, or private prompt belongs in this repository.
- Credentials entered in the local Studio are held in process memory and are cleared on restart. Runtime environment variables are optional and are read by the server process; there is no dotenv loader.
- User flows, runs, schedules, rulesets, and usage logs live under the Jev Flow application data directory outside the checkout. `JEVFLOW_DATA_DIR` is the only application-data override.
- Examples and site editor fixtures are synthetic. The site JSON editor validates only a basic shape in the browser and does not send the draft to a provider.

## Local and remote access

The server binds to `127.0.0.1` by default and refuses non-loopback `HOST` values. Studio pages can render private flow definitions, so API bearer checks alone are insufficient for remote access. The current application has no browser-session authentication and must not be exposed through a public interface or reverse proxy. Local API mutations require same-origin browser requests and JSON content. Requests from another origin are rejected. A command-line client without an `Origin` header is allowed on loopback.

## Decisions and effects

Jev output is typed evidence, not authorization. Code validates the answer and owns the branch. A webhook flow must include explicit budget, verification, and authorization gates; URL policy and DNS checks run before a call. Review the flow and target endpoint before enabling effects. Fixture simulation does not call a provider or trigger webhooks.

## Reporting

Please report vulnerabilities privately to the repository owner. Avoid publishing credentials, personal data, request bodies, or a usable exploit in a public issue.
