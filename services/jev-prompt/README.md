# Prompt and context primitives

These modules expose three JavaScript functions. They do not install server
routes or make a provider call unless Jev is configured or a client is
injected. The prompt catalog contains 16 deterministic templates; Jev only
selects typed options. Code builds the final prompt and applies all thresholds.

## Example

Run from the repository root with Node 20 or newer:

~~~js
import { composePrompt } from './services/jev-prompt/composer.mjs';
import { julgarCache, planejarCompactacao } from './services/jev/context.mjs';

const composed = await composePrompt({
  objetivo: 'Explain the API error contract to a new developer',
  dominio: 'software',
  exemplos: ['A 422 response includes a stable error code'],
});
console.log(composed.prompt);

const cache = await julgarCache({
  pergunta: 'Can the previous explanation be reused?',
  estado_anterior: { schemaVersion: 1 },
  resposta_cacheada: 'The previous explanation',
  estado_novo: { schemaVersion: 2 },
});
if (cache.acao === 'recalcular') {
  // Refresh through the caller's own workflow.
}

const plan = await planejarCompactacao({
  limite_chars: 1200,
  blocos: [
    { id: 'policy', tipo: 'sistema', conteudo: 'Required behavior...' },
    { id: 'history', tipo: 'historico_antigo', conteudo: 'Earlier discussion...' },
  ],
});
console.log(plan.manter.map(block => block.id));
~~~

Each function also accepts a second argument, { client }. The client must
implement ask({ state, questions }) and return typed answers that pass
isValidJevResponseForQuestions. This supports offline fixtures and tests.
Without a client, isJevConfigured() decides whether to construct a JevClient.

## Result contract

| Function | Main fields | Conservative behavior |
| --- | --- | --- |
| composePrompt | prompt, padroes_aplicados, padroes_rejeitados, tom, formato, complexidade | Uses deterministic catalog candidates when Jev is absent, unsafe, invalid, or unavailable. |
| julgarCache | acao, motivo, aderente, risco | Reuses only exact canonical states locally; otherwise recalculates unless a valid typed judgment passes both thresholds. |
| planejarCompactacao | estrategia, manter, cortar, chars_antes, chars_apos | Sorts by declared block type when Jev is absent, unsafe, invalid, or unavailable. The character limit is always hard. |

All three report origem and transporte. An origem value of jev means a valid
typed answer was consumed; a transporte value of injetado identifies a caller
supplied client, which may be a mock. A transporte value of configurado
identifies the configured Jev client. Local decisions use política local or
heurística local as origem. The custo field is an estimate when supplied by
the client, 0 when no request was attempted, and null when an attempted
request has no reliable estimate. latencia_ms is null unless supplied by Jev.

julgarCache requires adherence at least 0.6 and reuse risk at most 0.4
to allow usar_cacheada or verificar_depois. planejarCompactacao accepts
1–10 blocks with unique IDs and a nonnegative integer limite_chars. If
conteudo is present, its actual string length determines chars.

Caller data is placed only in Jev state, never in question instructions.
redactRemoteState checks the outbound state before any request. If it
redacts data or cannot preserve the full state safely, these functions take a
local route. The composer has no process global previous prompt or implicit
cross-request cache; its cache.decisao remains null. Callers own cache
storage and can invoke julgarCache explicitly.

Run the focused checks with:

~~~sh
node --test scripts/jev-prompt-context.test.mjs
~~~
