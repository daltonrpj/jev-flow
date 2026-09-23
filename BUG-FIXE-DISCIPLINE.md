# Bug fix log

## 2026-09-23 — catalog certificate changed across operating systems

- **Input:** the four catalog source modules in the Windows checkout; compare the certificate fingerprint with the same files using LF-only line endings as in a normalized Git checkout.
- **State:** `core.autocrlf=true`; `compendium-expanded.mjs` contained both CRLF and LF, and `node-catalog.mjs` contained both CRLF and LF. The original working-tree fingerprint was `7aae809d65fdc4e2f6b135fb17f53a02f8b6a55774c658f886efc2170ac1a73d`; LF-normalized source produced `eb67c5d5014489042e5501cbaa2c3067ce7f875b9e302f93800f428c798bce26`.
- **Cause:** the source fingerprint hashed raw bytes, so Git line-ending normalization changed the digest even when the code was identical.
- **Fix:** decode the catalog modules as UTF-8 and normalize CRLF and lone CR to LF before hashing. Keep relative source labels in the digest.
- **Regression checks:** certify the catalog again, assert equal fingerprints for the current checkout, an alternate source path, and a synthetic LF-only checkout; run the complete `npm test` suite and the CI read-only certificate check.

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

## 2026-09-23 — fixture capture waited for a non-matching exact status label

- **Input:** open the standalone support-triage fixture, press its preview action, then wait for an exact visible `OPERATION COMPLETE` text node.
- **State:** the flow completed all 8 of 8 steps and the result panel reported a deterministic simulated judgment with no input inference, but the headless capture timed out on its exact-text locator.
- **Cause:** the translated success label shares its status row with mode and run details; it is not a standalone exact-text node.
- **Fix:** wait for the visible `.evidence-summary` result panel, bring it into the viewport, and assert both the localized success label and the completed-step count.
- **Regression checks:** the final headless walkthrough capture validates the result card before continuing; no provider call or external action is used.

## 2026-09-23 — Labs modules were missing from the standalone HTTP server

- **Input:** open `/jev/labs`, select Chess or Blast Garden, choose local code mode, and run a move.
- **State:** the Labs document returned HTTP 200, but its UI module imports `/jev/labs/assets/engine.mjs` and `/jev/labs/assets/chess.mjs`; neither route was served. The browser therefore kept the original tab active and the game controls remained hidden.
- **Cause:** only the UI module had an explicit Labs asset route; the engine imports fell through to the 404 handler.
- **Fix:** map both import URLs to their standalone source modules and serve them as JavaScript.
- **Regression checks:** the HTTP smoke now checks all three module routes, content type, and expected source; browser verification switches Chess and executes a local legal move.

## 2026-09-23 — voice samples were not copied into the aligned WAV container

- **Input:** package the twenty Gemini PCM scenes into a single time-aligned narration WAV and mux it with the app capture.
- **State:** every source scene had non-silent PCM, but the aligned WAV payload was all zeroes; the initial WebM carried an effectively silent Opus track.
- **Cause:** the assembler wrote a correct WAV header and data length but omitted copying the concatenated PCM bytes after the 44-byte header.
- **Fix:** copy the concatenated samples into the WAV payload and make the packager reject a silent/corrupt source scene or aligned track.
- **Regression checks:** recheck nonzero sample percentage on the aligned WAV and confirm the final WebM has a decoded Opus track with audible sample energy; inspect browser playback and matching VTT.

## 2026-09-23 — standalone video could not seek and HEAD loaded the full file

- **Input:** request `Range: bytes=1000-1099` and seek the 193.9-second local WebM to 100 seconds.
- **State:** the server returned HTTP 200 without `Content-Range` or `Accept-Ranges`; the browser could play from the start but could not seek. Its static handler also called `readFile` for HEAD requests, loading the whole 17 MB asset just to check availability.
- **Cause:** the static route ignored the request method and range header, and buffered files before responding.
- **Fix:** stat assets for headers, stream videos, return 206 for satisfiable byte ranges and 416 for unsatisfiable ranges; HEAD sends headers only. Restrict byte-range handling to video responses.
- **Regression checks:** HTTP smoke asserts exact single-range and suffix-range bytes, 206/416 headers, and then browser verification seeks and resumes playback.

## 2026-09-23 — captions were doubled in browsers with the caption track enabled

- **Input:** open the public player with its VTT track enabled while the WebM already contains burned-in English subtitles.
- **State:** Edge showed the same line twice at the bottom of the frame because both subtitle layers rendered together.
- **Cause:** the VTT sidecar was marked default despite the permanently visible burned-in captions.
- **Fix:** keep burned-in subtitles visible and make the sidecar VTT an optional track that the viewer can select from player controls.
- **Regression checks:** site tests reject a default VTT track; browser verification confirms the track starts disabled and still loads all 20 cues when selected.

## 2026-09-23 — app-only migration retained the old public-root proxy policy

- **Input:** inspect the old Nginx `location /` and local-server root route while preparing to remove the separate guide. The existing vhost used `auth_basic off` and served `site/` directly.
- **State:** `/jev` and `/api` required Basic Auth, but root and static files were intentionally public. After moving media and examples to root paths, that policy would expose those application assets without authentication.
- **Cause:** the proxy rule was scoped to the earlier site/application split and did not match the new app-only boundary.
- **Fix:** redirect local `/` to Studio, proxy every application path through Nginx `location /` with Basic Auth, retain a public `404` only for the non-disclosing `/api/health` route, and serve assets from narrow root-directory allowlists.
- **Regression checks:** repository contract reads the final Nginx block and verifies the root auth/proxy; HTTP smoke checks the root redirect, new example/media/certificate paths and blocked traversal; `npm test` passed 62/62 and the catalog recertified 388,080 valid unique configurations.

## 2026-09-23 — Nginx contract test matched the HTTP redirect block

- **Input:** run `node --test scripts/repository-contract.test.mjs` after adding the app-only proxy assertion.
- **State:** the test failed although the HTTPS `location /` contained `auth_basic`, because its regex started at the inline HTTP `location / { return 301 ... }` and crossed into later blocks.
- **Cause:** the regex did not require a multiline location opening, so it selected the wrong block.
- **Fix:** require `location / {` followed immediately by a newline before reading the HTTPS block.
- **Regression checks:** the focused repository and server smoke passed 7/7; the complete suite passed 62/62.

## 2026-09-23 — public guide copy lagged behind the completed walkthrough

- **Input:** open the earlier static guide after the final WebM, English VTT, transcript, and six real application captures were present in `media/`.
- **State:** its copy still described the narration script as ready, the video as pending, or the verified asset as missing. That contradicted the repository's completed media and prevented a truthful public presentation.
- **Cause:** site content and its fallback text were not updated when the verified media was completed; the later app-only migration removed the brochure instead of refreshing that presentation boundary.
- **Fix:** restore a separate static guide with the real WebM player, poster, transcript/VTT links, six provenance-labeled captures, pre-run Arena labeling, and the generated-configuration limit beside 388,080. Publish only explicit public files from `site:build`; keep the Node app protected separately.
- **Regression checks:** repository contract rejects the stale phrases in HTML/CSS/JS, checks video/player/caption behavior and image/link sources; isolated build tests prove non-allowlisted server/data/secret files cannot enter `site/dist`. `npm test` passed 65/65, `npm run catalog:certify -- --check` passed at 388,080, and `npm run site:build` produced only 18 allowlisted files at that point.

## 2026-09-23 — guide install section overflowed on narrow screens

- **Input:** open the rebuilt static guide at a 390×844 mobile viewport and inspect document width.
- **State:** `document.documentElement.scrollWidth` was 495 px for a 390 px viewport; the install grid inherited the intrinsic width of its command block and cut content off-screen.
- **Cause:** the single-column grid retained an automatic minimum track size, and the `pre` command block preserved an unbreakable clone URL.
- **Fix:** allow the install grid children and column to shrink to zero, then wrap commands at narrow phone widths; add the project favicon so the guide does not request a missing `/favicon.ico`.
- **Regression checks:** Edge review at 320, 390, 520 and 1440 px measured no horizontal overflow; all six screenshots and the favicon loaded without failed requests, and the WebM played and advanced at 1920×1080 for 193.913 seconds. `npm test` passed 65/65, `npm run catalog:certify -- --check` certified 388,080 unique configurations, `npm run site:build` emitted 19 allowlisted files, and `git diff --check` passed.
