// Synthetic Ship Pack fixtures. Scenario IDs, question keys, choice IDs,
// expected answers, and scoring weights are stable runner contracts.
function readField(text, name) {
  const match = new RegExp('(?:^|[|\\n])\\s*' + name + '\\s*:\\s*([^|\\n]+)', 'i').exec(String(text ?? ''));
  return match ? match[1].trim().toLowerCase().replace(/[.!]$/, '') : null;
}

function parseValue(text, name, options) {
  const value = readField(text, name);
  if (options === 'score') return value !== null && /^[0-3]$/.test(value) ? Number(value) : null;
  if (options) return value && Object.hasOwn(options, value) ? options[value] : null;
  return value === 'yes' ? true : value === 'no' ? false : null;
}

function suite({ llmPrompt, llmFields, ...definition }) {
  return {
    ...definition,
    promptLLM: input => llmPrompt + '\n\nInput:\n' + input,
    parseLLM: text => Object.fromEntries(Object.entries(llmFields).map(([key, [name, options]]) =>
      [key, parseValue(text, name, options)])),
  };
}

const pairScore = (first, second) => (response, expected) =>
  (response[first] === expected[first] ? 0.5 : 0) + (response[second] === expected[second] ? 0.5 : 0);

export const SHIP_TESTES = [
  suite({
    id: 'clausulas-red-flag', nome: '📜 Contract Red Flags', categoria: 'legal',
    descricao: 'Six synthetic contract clauses: identify the material risk area and whether a real imbalance exists.',
    perguntas: {
      tema: { type: 'choice', instructions: 'Which area carries the greatest MATERIAL risk in the clause? Choose the no-risk option when there is no material imbalance. Standard governing law, jurisdiction, formalities, and a capped annual adjustment are not material risks by themselves.', criteria: { nenhum: 'No material risk; standard contract language', prazo: 'Disproportionate automatic renewal or lock-in period', rescisao: 'Asymmetric termination right or penalty', sigilo: 'Overbroad confidentiality obligation or assignment of rights', pagamento: 'Abusive price increase, charge, or withholding' } },
      risco: { type: 'noul', instructions: 'Does accepting this clause create a material imbalance of obligations for the accepting party?' },
    },
    casos: [
      { input: 'The contractor may terminate at any time without penalty; the customer must pay 100% of the remaining balance if terminating before 24 months.', esperado: { tema: 'rescisao', risco: true } },
      { input: 'The plan renews automatically for successive 12-month periods and requires 90 days of advance notice to cancel.', esperado: { tema: 'prazo', risco: true }, rotulo: 'borderline · automatic renewal' },
      { input: 'This agreement is governed by Brazilian law, and the parties elect the courts of São Paulo as the forum.', esperado: { tema: 'nenhum', risco: false } },
      { input: 'The customer assigns all moral rights in the materials produced, without geographic limit and without additional payment.', esperado: { tema: 'sigilo', risco: true }, rotulo: 'borderline · broad rights assignment' },
      { input: 'The price adjusts annually by the IGP-M index, capped at 8% per year.', esperado: { tema: 'nenhum', risco: false }, rotulo: 'borderline · capped adjustment' },
      { input: 'The provider may retain all amounts paid upon termination, regardless of work already completed and approved.', esperado: { tema: 'pagamento', risco: true } },
    ],
    llmPrompt: 'Assess the clause for material imbalance. Governing law and forum alone do not count. Reply exactly: risk_area: none|term|termination|rights|payment | material_risk: yes|no.',
    llmFields: { tema: ['risk_area', { none: 'nenhum', term: 'prazo', termination: 'rescisao', rights: 'sigilo', payment: 'pagamento' }], risco: ['material_risk'] },
    scorer: pairScore('tema', 'risco'),
  }),
  suite({
    id: 'slop-deteccao', nome: '🧻 AI Slop Detection', categoria: 'quality',
    descricao: 'Five texts: distinguish generic filler from actionable information with checkable facts.',
    perguntas: {
      slop: { type: 'noul', instructions: 'Is the text inflated, generic filler with no checkable fact, figure, method, or example?' },
      util: { type: 'noul', instructions: 'Does the text provide actionable information or an instruction supported by a fact, figure, method, or data? Motivational slogans do not count.' },
    },
    casos: [
      { input: 'A journey of a thousand miles begins with a single step. Every day is a chance to start again. With focus and discipline, results will inevitably follow.', esperado: { slop: true, util: false } },
      { input: 'We measured a 214 ms cold start in Express versus 63 ms in Hono on Lambda arm64 with the same middleware; the method and repository are public.', esperado: { slop: false, util: true } },
      { input: 'Five productivity secrets nobody tells you. Number three will surprise you. Read on!', esperado: { slop: true, util: false } },
      { input: 'The report shows 12% fewer deployment failures after the deterministic gate was introduced, with weekly data in Appendix B.', esperado: { slop: false, util: true } },
      { input: 'Innovation means transforming tomorrow. Together we are stronger. The future starts now.', esperado: { slop: true, util: false }, rotulo: 'borderline · empty corporate copy' },
    ],
    llmPrompt: 'Is this generic, inflated filler without checkable facts? Does it offer actionable information? Reply exactly: slop: yes|no | useful: yes|no.',
    llmFields: { slop: ['slop'], util: ['useful'] },
    scorer: pairScore('slop', 'util'),
  }),
  suite({
    id: 'hedging-evasiva', nome: '🌀 Hedging and Evasion', categoria: 'quality',
    descricao: 'Four claims: separate vague hedging from a claim backed by a specific checkable figure or source.',
    perguntas: {
      evasiva: { type: 'noul', instructions: 'Does the claim hedge or evade instead of asserting a concrete, checkable fact?' },
      fundamentada: { type: 'noul', instructions: 'Does the claim include a specific, checkable figure, datum, or source?' },
    },
    casos: [
      { input: 'Studies suggest there might possibly be some impact in certain situations.', esperado: { evasiva: true, fundamentada: false } },
      { input: 'The migration reduced monthly cost from BRL 4,100 to BRL 2,700, according to the attached October spreadsheet.', esperado: { evasiva: false, fundamentada: true } },
      { input: 'Some experts believe the trend could eventually reverse.', esperado: { evasiva: true, fundamentada: false } },
      { input: 'The load test passed in three of three runs with p95 below 400 ms (CI logs #4821).', esperado: { evasiva: false, fundamentada: true } },
    ],
    llmPrompt: 'Is the claim evasive or overly hedged? Does it contain a specific checkable figure or source? Reply exactly: evasive: yes|no | grounded: yes|no.',
    llmFields: { evasiva: ['evasive'], fundamentada: ['grounded'] },
    scorer: pairScore('evasiva', 'fundamentada'),
  }),
  suite({
    id: 'deflexao-suporte', nome: '🎧 Support Routing', categoria: 'support',
    descricao: 'Five requests: choose the lowest-cost safe route while escalating real loss or deadlines to a person.',
    perguntas: {
      rota: { type: 'choice', instructions: 'Which route can address the request at the lowest cost with acceptable risk? A real loss of money, data, or a deadline requires a human.', criteria: { auto: 'A short, known factual answer resolves it', doc: 'An existing step-by-step guide resolves it', humano: 'Human judgment, intervention, or empathy is needed' } },
      critico: { type: 'noul', instructions: 'Does the request involve real loss of the user’s money, data, or time-sensitive rights?' },
    },
    casos: [
      { input: 'Context: no article covers restoration. Request: I imported the wrong spreadsheet and deleted 300 CRM customers; I need this fixed today.', esperado: { rota: 'humano', critico: true } },
      { input: 'Context: the “Change email and password” article has the steps. Request: how do I change my account email?', esperado: { rota: 'doc', critico: false } },
      { input: 'Context: service hours are in the FAQ. Request: what are your support hours?', esperado: { rota: 'auto', critico: false } },
      { input: 'Context: no relevant guide exists. Request: I received a court notice with a five-day deadline; what should I do?', esperado: { rota: 'humano', critico: true } },
      { input: 'Context: the “Find your invoice” article has the steps. Request: where can I find the invoice for my March purchase?', esperado: { rota: 'doc', critico: false }, rotulo: 'borderline · self-service' },
    ],
    llmPrompt: 'Choose the safe route. Real loss or a deadline requires a person. Reply exactly: route: auto|docs|human | critical: yes|no.',
    llmFields: { rota: ['route', { auto: 'auto', docs: 'doc', human: 'humano' }], critico: ['critical'] },
    scorer: (r, e) => (e.critico ? (r.rota === 'humano' ? 0.5 : 0) : (r.rota === e.rota ? 0.5 : 0)) + (r.critico === e.critico ? 0.5 : 0),
  }),
  suite({
    id: 'bug-gemeo-rastreio', nome: '🐛 Shared-Root Bug Triage', categoria: 'production',
    descricao: 'Four error pairs: distinguish the same root cause, related failures, and independent issues.',
    perguntas: {
      gemeo: { type: 'noul', instructions: 'Do both error traces share the same root cause, so fixing one cause resolves both?' },
      independentes: { type: 'noul', instructions: 'Are these two errors independent problems?' },
    },
    casos: [
      { input: 'Error A: TypeError: Cannot read properties of undefined (reading id) at parseWebhookEvent:88. Error B: the same TypeError at parseWebhookEvent:88 when the payload lacks event.', esperado: { gemeo: true, independentes: false } },
      { input: 'Error A: PostgreSQL client gets ECONNREFUSED immediately after a database deployment. Error B: menu CSS breaks at 320 px in Safari.', esperado: { gemeo: false, independentes: true } },
      { input: 'Error A: a 30-second timeout at /export. Error B: TypeError: x is not a function in the export module.', esperado: { gemeo: false, independentes: false }, rotulo: 'borderline · related, distinct causes' },
      { input: 'Error A: 500 “null pointer” when saving an order without a coupon. Error B: 500 “null pointer” in the same handler with a missing expired coupon.', esperado: { gemeo: true, independentes: false } },
    ],
    llmPrompt: 'Do the errors share one root cause? Are they independent problems? Reply exactly: same_root: yes|no | independent: yes|no.',
    llmFields: { gemeo: ['same_root'], independentes: ['independent'] },
    scorer: pairScore('gemeo', 'independentes'),
  }),
  suite({
    id: 'qualidade-dado-portao', nome: '🚧 Data Quality Gate', categoria: 'quality',
    descricao: 'Four observed values: identify anomalies and distinguish collection errors from plausible real events.',
    perguntas: {
      anomalo: { type: 'noul', instructions: 'Is the observed value anomalous relative to the stated reference series?' },
      erro_coleta: { type: 'noul', instructions: 'If anomalous, does the value look like a collection, parsing, or unit error rather than a real event?' },
    },
    casos: [
      { input: 'Field: price_usd. Observed: 0.0000012. Series: 30-day minimum 28,000, median 31,500, maximum 34,000; no market event.', esperado: { anomalo: true, erro_coleta: true } },
      { input: 'Field: volume_btc_usd. Observed: 18.4 billion. Series: 8.2–15.5 billion over 30 days; today a halving and liquidation cascade appeared in market feeds.', esperado: { anomalo: true, erro_coleta: false }, rotulo: 'borderline · rare real event' },
      { input: 'Field: p95_latency_ms. Observed: 412. Series: seven-day minimum 320, median 405, maximum 480.', esperado: { anomalo: false, erro_coleta: false } },
      { input: 'Field: registration_date. Observed: 2020-01-01. Series: all records fall between August and September 2026.', esperado: { anomalo: true, erro_coleta: true } },
    ],
    llmPrompt: 'Is the value anomalous against the series? If so, does it look like a collection or parsing error rather than a real event? Reply exactly: anomaly: yes|no | collection_error: yes|no.',
    llmFields: { anomalo: ['anomaly'], erro_coleta: ['collection_error'] },
    scorer: pairScore('anomalo', 'erro_coleta'),
  }),
  suite({
    id: 'lacuna-docs', nome: '🕳️ Documentation Gap', categoria: 'docs',
    descricao: 'Four questions against document excerpts: decide whether the excerpt answers or is stale.',
    perguntas: {
      responde: { type: 'noul', instructions: 'Does the supplied documentation excerpt answer the question usefully without an external search?' },
      desatualizada: { type: 'noul', instructions: 'Is the excerpt outdated or contradictory relative to the stated current reference?' },
    },
    casos: [
      { input: 'Question: how do I export runs as Parquet? Excerpt: “Runs are stored as JSON in the configured data directory, including path, outputs, and cost metadata.”', esperado: { responde: false, desatualizada: false } },
      { input: 'Question: how do I schedule a flow daily at 9 a.m.? Excerpt: “Use POST /api/jev/flows/:id/schedule with cron 0 9 * * *, or select the daily 09:00 preset.”', esperado: { responde: true, desatualizada: false } },
      { input: 'Question: what is the default server port? Excerpt: “The server listens on port 8723 by default (PORT=8723).”', esperado: { responde: true, desatualizada: false } },
      { input: 'Question: how do I cancel a schedule? Excerpt: “DELETE /api/jev/schedules/{id} removes it.” Current reference: POST /api/jev/flows/:id/schedule with active=false.', esperado: { responde: false, desatualizada: true }, rotulo: 'borderline · stale documentation' },
    ],
    llmPrompt: 'Does the excerpt answer the question? Is it outdated against the supplied current reference? Reply exactly: answers: yes|no | outdated: yes|no.',
    llmFields: { responde: ['answers'], desatualizada: ['outdated'] },
    scorer: pairScore('responde', 'desatualizada'),
  }),
  suite({
    id: 'cache-decisao-semantica', nome: '💾 Semantic Decision Cache', categoria: 'cache',
    descricao: 'Four reuse decisions: distinguish cosmetic input changes from changes that alter the decision.',
    perguntas: {
      aderente: { type: 'noul', instructions: 'Does the cached answer still apply correctly to the new state?' },
      mudou_o_importa: { type: 'noul', instructions: 'Does the new state change a decision-relevant variable, such as time, amount, or destination?' },
    },
    casos: [
      { input: 'Decision: refund urgency. Cached for: “Charged twice; I need a refund TODAY” → escalated (0.91). New state: “Charged twice; I need a refund tomorrow.”', esperado: { aderente: false, mudou_o_importa: true } },
      { input: 'Decision: ticket category. Cached for: “The app will not open on Android” → technical. New state: “The app will not open on Android!” (same sentence plus exclamation mark).', esperado: { aderente: true, mudou_o_importa: false } },
      { input: 'Decision: approve a BRL 120 refund. Cached for: “BRL 120 claim with receipt” → approved. New state: “BRL 1,200 claim with receipt.”', esperado: { aderente: false, mudou_o_importa: true }, rotulo: 'borderline · amount ×10' },
      { input: 'Decision: support route. Cached for: “How do I change my email?” → link to guide. New state: “How can I update my email address?” (same request paraphrased).', esperado: { aderente: true, mudou_o_importa: false } },
    ],
    llmPrompt: 'Does the cached answer still apply? Did any decision-relevant variable change? Reply exactly: reusable: yes|no | material_change: yes|no.',
    llmFields: { aderente: ['reusable'], mudou_o_importa: ['material_change'] },
    scorer: pairScore('aderente', 'mudou_o_importa'),
  }),
  suite({
    id: 'compactacao-contexto', nome: '📦 Context Compaction', categoria: 'context',
    descricao: 'Four pairs of context blocks: rate which block is essential to the stated goal.',
    perguntas: {
      bloco_a: { type: 'score', instructions: 'How relevant is BLOCK A to the goal (0 disposable, 1 marginal support, 2 useful, 3 essential)?', criteria: ['Disposable for the goal', 'Marginal support', 'Useful if space allows', 'Essential; the task fails without it'] },
      bloco_b: { type: 'score', instructions: 'How relevant is BLOCK B to the goal (0 disposable, 1 marginal support, 2 useful, 3 essential)?', criteria: ['Disposable for the goal', 'Marginal support', 'Useful if space allows', 'Essential; the task fails without it'] },
    },
    casos: [
      { input: 'Goal: fix the interest-calculation bug. BLOCK A: the faulty calculateInterest function. BLOCK B: yesterday’s access logs.', esperado: { bloco_a: 3, bloco_b: 0 } },
      { input: 'Goal: draft the quarterly email. BLOCK A: the spreadsheet with quarterly figures. BLOCK B: an unrelated chat about coffee.', esperado: { bloco_a: 3, bloco_b: 0 } },
      { input: 'Goal: fix the interest-calculation bug. BLOCK A: the faulty calculateInterest function. BLOCK B: a test that reproduces the bug.', esperado: { bloco_a: 3, bloco_b: 3 }, rotulo: 'borderline · both essential' },
      { input: 'Goal: answer “What are your support hours?” BLOCK A: the support-hours FAQ. BLOCK B: a detailed service-level agreement.', esperado: { bloco_a: 3, bloco_b: 0 }, rotulo: 'borderline · tempting SLA' },
    ],
    llmPrompt: 'Rate each block against the goal: 0 disposable, 1 marginal, 2 useful, 3 essential. Reply exactly: block_a: 0|1|2|3 | block_b: 0|1|2|3.',
    llmFields: { bloco_a: ['block_a', 'score'], bloco_b: ['block_b', 'score'] },
    scorer: (r, e) => {
      const near = (value, target) => value !== null && Math.abs(value - target) <= 1;
      return (near(r.bloco_a, e.bloco_a) ? 0.5 : 0) + (near(r.bloco_b, e.bloco_b) ? 0.5 : 0);
    },
  }),
  suite({
    id: 'especificidade-entrada', nome: '🎯 Request Specificity', categoria: 'context',
    descricao: 'Four requests: decide whether the scope is actionable without inventing missing details.',
    perguntas: {
      especifico: { type: 'noul', instructions: 'Is the request specific enough to have a clear goal, bounded scope, and checkable result rather than being vague or sprawling?' },
      precisa_perguntar: { type: 'noul', instructions: 'Would a competent executor need to ask clarifying questions before acting on this request?' },
    },
    casos: [
      { input: 'Request: improve the app. (This is the entire description; no other details were supplied.)', esperado: { especifico: false, precisa_perguntar: true } },
      { input: 'Request: fix issue 42: a comma in a field breaks CSV rows. The exporter lacks escaping. Escape quotation marks and commas.', esperado: { especifico: true, precisa_perguntar: false } },
      { input: 'Request: refactor everything so it is better.', esperado: { especifico: false, precisa_perguntar: true } },
      { input: 'Request: survey the state of the art in Portuguese-language RAG. (The research topic and scope are stated.)', esperado: { especifico: true, precisa_perguntar: false }, rotulo: 'borderline · open question with a scope' },
    ],
    llmPrompt: 'Is the request specific enough to act on? Is clarification required before execution? Reply exactly: specific: yes|no | needs_clarification: yes|no.',
    llmFields: { especifico: ['specific'], precisa_perguntar: ['needs_clarification'] },
    scorer: pairScore('especifico', 'precisa_perguntar'),
  }),
  suite({
    id: 'mudanca-fase-regime', nome: '📉 Metric Regime Shift', categoria: 'production',
    descricao: 'Four series: separate a structural shift from normal variation and determine its direction.',
    perguntas: {
      mudou: { type: 'noul', instructions: 'Has the metric shifted structurally away from its historical regime rather than fluctuating within it?' },
      piorou: { type: 'noul', instructions: 'Is the observed change worse than the historical regime?' },
    },
    casos: [
      { input: 'Metric: daily accuracy. Today: 31%. Previous 14 days: 58, 57, 60, 56, 59, 58, 61, 57, 59, 58, 60, 57, 59, 58%.', esperado: { mudou: true, piorou: true } },
      { input: 'Metric: daily accuracy. Today: 57%. Previous 14 days: 58, 57, 60, 56, 59, 58, 61, 57, 59, 58, 60, 57, 59, 58%.', esperado: { mudou: false, piorou: false } },
      { input: 'Metric: p95 latency. Today: 9.2 seconds. Previous 14 days: stable at 380–450 ms, with no deployment in the window.', esperado: { mudou: true, piorou: true } },
      { input: 'Metric: daily revenue. Today: BRL 9,400. Previous 14 days: fluctuating between BRL 8,900 and 9,800.', esperado: { mudou: false, piorou: false }, rotulo: 'borderline · within the band' },
    ],
    llmPrompt: 'Is there a structural metric regime shift? Is the shift worse? Reply exactly: shift: yes|no | worse: yes|no.',
    llmFields: { mudou: ['shift'], piorou: ['worse'] },
    scorer: pairScore('mudou', 'piorou'),
  }),
  suite({
    id: 'conformidade-spec', nome: '✅ Specification Compliance', categoria: 'production',
    descricao: 'Four deliverables against acceptance criteria: promises are not evidence, and partial delivery remains partial.',
    perguntas: {
      conformidade: { type: 'choice', instructions: 'Does the delivered work satisfy the criterion? A plan or promise of future work counts as absent, not partial.', criteria: { conforme: 'Concrete evidence covers the full criterion', parcial: 'Some work is complete, but a required part is missing', ausente: 'No delivered work addresses the criterion; a promise is absent' } },
      evidencia: { type: 'noul', instructions: 'Does the delivery report cite concrete evidence such as a test, file, figure, or specific output?' },
    },
    casos: [
      { input: 'Criterion: a daily backup can be restored within one hour. Delivery: we plan to add the routine next sprint, with fast restoration.', esperado: { conformidade: 'ausente', evidencia: false } },
      { input: 'Criterion: CSV export escapes commas and line breaks. Delivery: PR 118 adds escapeCsv() with tests for commas, quotation marks, and embedded line breaks; coverage is 96%.', esperado: { conformidade: 'conforme', evidencia: true } },
      { input: 'Criterion: API p95 is below 500 ms. Delivery: three main queries fell from 900 to 420 ms, but the report endpoint remains at 800 ms.', esperado: { conformidade: 'parcial', evidencia: true }, rotulo: 'borderline · partial with figures' },
      { input: 'Criterion: structured JSON logs. Delivery: logs are not mentioned anywhere.', esperado: { conformidade: 'ausente', evidencia: false } },
    ],
    llmPrompt: 'Does delivered work satisfy the criterion? A future promise is absent. Is concrete evidence cited? Reply exactly: status: complete|partial|absent | evidence: yes|no.',
    llmFields: { conformidade: ['status', { complete: 'conforme', partial: 'parcial', absent: 'ausente' }], evidencia: ['evidence'] },
    scorer: (r, e) => (r.conformidade === e.conformidade ? 0.6 : 0) + (r.evidencia === e.evidencia ? 0.4 : 0),
  }),
];
