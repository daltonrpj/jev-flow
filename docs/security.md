# Security and data boundaries

## Credentials and user data

- No secrets, `.env` file, provider key, model weight, user flow, run log, or private prompt belongs in this repository.
- Credentials entered in the local Studio are held in process memory and are cleared on restart. Runtime environment variables are optional and are read by the server process; there is no dotenv loader.
- User flows, runs, schedules, rulesets, and usage logs live under the Jev Flow application data directory outside the checkout. `JEVFLOW_DATA_DIR` is the only application-data override.
- Examples and site editor fixtures are synthetic. The site JSON editor validates only a basic shape in the browser and does not send the draft to a provider.

## Local and single-tenant proxy access

The default mode binds to `127.0.0.1` and accepts only loopback Host/Origin pairs for the configured port. It rejects non-loopback binds, cross-origin browser requests, and non-JSON API mutations. A local command-line client may omit `Origin` in this default mode.

A single-tenant Ubuntu/Nginx deployment is an explicit opt-in: set `JEVFLOW_PUBLIC_ORIGIN` to one canonical HTTPS origin (for example `https://flow.example.org`) and bind Node to **exactly** `127.0.0.1`. The server refuses malformed origins and any other bind host. In this mode it requires the HTTP `Host` to match that origin's host exactly, an exact HTTPS `Origin` for every mutation, and a loopback TCP socket peer. It rejects duplicate Host/Origin headers and ignores `Forwarded` and `X-Forwarded-*` as authorization inputs. These checks constrain the request shape; **they do not authenticate a user**.

Nginx must provide valid TLS and HTTP Basic Auth for exact `/jev` and `/api` paths and all their subpaths, while leaving the guide at `/` public. Keep the Node port inaccessible from the network and keep the Basic password hash in `/etc/jev-flow/htpasswd`. Provider secrets belong in a root-owned `/etc/jev-flow/jev-flow.env`; application state belongs in `/var/lib/jev-flow`, not the checkout. Follow the [Hostinger VPS runbook](deploy-hostinger.md) and verify public 200, protected 401, authenticated 200, and the loopback-only socket before announcing an instance.

Basic Auth over HTTPS is a small single-tenant boundary, not per-user authorization, MFA, or a true logout. Browsers may cache its credentials. A local process on the same VPS can reach the loopback port and spoof Host/Origin, bypassing Nginx Basic Auth; do not give untrusted users shell access to this host. Cross-origin checks reduce browser request risk but never replace Nginx authentication or code-owned authorization for effects.

## Decisions and effects

Jev output is typed evidence, not authorization. Code validates the answer and owns the branch. A webhook flow must include explicit budget, verification, and authorization gates; URL policy and DNS checks run before a call. Review the flow and target endpoint before enabling effects. Fixture simulation does not call a provider or trigger webhooks.

## Reporting

Please report vulnerabilities privately to the repository owner. Avoid publishing credentials, personal data, request bodies, or a usable exploit in a public issue.
