# Contributing

Keep changes focused on Jev Flow. Do not add unrelated application code, user data, secrets, `.env` files, credentials, private prompts, model weights, or generated run logs.

Before submitting a change, run `npm test`; after modifying Compendium source, run `npm run catalog:certify` and include its updated manifest. Add deterministic tests for changed behavior. Label fixtures and simulations accurately and never present them as live provider judgments. Webhook and other external effects must remain behind explicit code-owned validation and authorization.
