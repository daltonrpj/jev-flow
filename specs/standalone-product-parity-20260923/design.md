# Standalone product parity — design

The local Node server is the execution boundary. `/` redirects to `/jev/flows`; `/jev/flows/compendium`, `/jev/battle`, `/jev/carrinho`, and `/jev/labs` are local runtime pages. Provider adapters must preserve the execution source in responses. Typed Jev answers are validated, then code routes them; previews use labeled synthetic answers. A field that cannot be measured or priced remains `null` or visibly unknown.

The Compendium derives candidates on request from six dimensions. Its certification checks valid unique IDs and keys against a source fingerprint. Public copy gives the count and its limitation together.

The narration helper is a separate offline-testable CLI. Importing it has no side effects. The CLI accepts a plain-text narration file and an output WAV path, reads only `OPENROUTER_API_KEY` for authentication, and posts the fixed OpenRouter request. The expected PCM L16 mono 24 kHz response is checked and wrapped in a WAV header. Non-audio responses, missing key, invalid input, timeout, and provider failures stop with a generic error; no alternate endpoint or voice is tried. Unit tests inject `fetch` to inspect the exact request and audio conversion. The final capture, WebM, VTT, transcript, stills and GIF live under `media/`.

The README and Markdown docs map surfaces and provider modes. Root `examples/`, `media/`, `assets/` and the certificate are served by narrow allowlisted routes. A single Nginx proxy policy authenticates every path in an HTTPS deployment. CI tests the app and checks the catalog certificate; it has no publication job.
