# Bug fix log

## 2026-09-23 — catalog certificate changed across operating systems

- **Input:** the four catalog source modules in the Windows checkout; compare the certificate fingerprint with the same files using LF-only line endings as in a normalized Git checkout.
- **State:** `core.autocrlf=true`; `compendium-expanded.mjs` contained both CRLF and LF, and `node-catalog.mjs` contained both CRLF and LF. The original working-tree fingerprint was `7aae809d65fdc4e2f6b135fb17f53a02f8b6a55774c658f886efc2170ac1a73d`; LF-normalized source produced `eb67c5d5014489042e5501cbaa2c3067ce7f875b9e302f93800f428c798bce26`.
- **Cause:** the source fingerprint hashed raw bytes, so Git line-ending normalization changed the digest even when the code was identical.
- **Fix:** decode the catalog modules as UTF-8 and normalize CRLF and lone CR to LF before hashing. Keep relative source labels in the digest.
- **Regression checks:** certify the catalog again, assert equal fingerprints for the current checkout, an alternate source path, and a synthetic LF-only checkout; run the complete `npm test` suite and the GitHub Pages certificate check.

## 2026-09-23 — Studio index inline script had a syntax error

- **Input:** render `/jev/flows?lang=en` from an isolated data directory and compile every inline JavaScript block.
- **State:** the page returned HTTP 200, but the first inline block failed to parse at `refreshCapabilityJev Flow`; because the browser rejects the whole block, Studio controls did not initialize.
- **Cause:** a display-name replacement inserted a space into an identifier and its two references.
- **Fix:** rename the function and both references to `refreshCapabilityIndex`.
- **Regression checks:** the server smoke test renders the actual route and parses each inline JavaScript block with `node:vm`; `npm test` verifies this alongside the HTTP response contract.

## 2026-09-23 — untrusted connection values could break out of the Studio script

- **Input:** render `/jev/flows` with a model and endpoint containing `</script><script>window.__jevflowPwned=true</script>`.
- **State:** before the fix, `JSON.stringify(conn)` preserved the literal closing script tag in the rendered HTML, where the browser would treat the rest as a new executable script.
- **Cause:** JSON encoding alone does not escape HTML's script terminator; the connection model and endpoint are untrusted strings.
- **Fix:** serialize the connection object with the existing `serializeForInlineScript`, which escapes `<`, `>`, `&`, and JavaScript line separators.
- **Regression checks:** server smoke renders the page with hostile model and API-base values and asserts neither value can terminate its script; the full suite parses the generated scripts.
