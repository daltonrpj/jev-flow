import { applyBlastAction, blastLegalActions, blastObservation, deterministicBlastAction,
  createBlastGame, evidencePolicy, rescuePolicy, spamPolicy, validateBlastGame } from './labs-engine.mjs';

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const noul = instructions => ({ type: 'noul', instructions });
const score = (instructions, criteria) => ({ type: 'score', instructions, criteria });

export const LAB_DESCRIPTIONS = Object.freeze({
  spam: { title: 'Radar de spam', subtitle: 'Uma probabilidade tipada vira permitir, revisar ou bloquear por uma regra ajustável.' },
  blast: { title: 'Blast Garden', subtitle: 'Jev escolhe uma ação legal a cada turno; o motor do jogo controla física, dano e vitória.' },
  chess: { title: 'Xadrez de decisões', subtitle: 'O motor calcula lances legais; Jev escolhe entre candidatos e o código executa.' },
  rescue: { title: 'Central de resgate', subtitle: 'Urgência e equipe são julgamentos tipados; a fila é calculada em código.' },
  evidence: { title: 'Mesa de evidências', subtitle: 'Uma alegação é confrontada com a evidência fornecida antes de uma ação editorial.' },
});

function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 16_000) {
    throw new TypeError('requisição inválida ou grande demais');
  }
  const lab = String(body.lab || '');
  if (!Object.hasOwn(LAB_DESCRIPTIONS, lab)) throw new TypeError('laboratório desconhecido');
  const mode = String(body.mode || 'jev');
  if (!['jev', 'llm', 'compare', 'code'].includes(mode)) throw new TypeError('modo inválido');
  if (mode === 'code' && !['blast', 'chess'].includes(lab)) throw new TypeError('modo código disponível apenas nos jogos');
  const driver = mode === 'llm' ? 'llm' : mode === 'code' ? 'code' : mode === 'compare' && body.driver === 'llm' ? 'llm' : 'jev';
  if (mode === 'compare' && !['jev', 'llm'].includes(body.driver || 'jev')) throw new TypeError('driver inválido');
  const model = String(body.model || '').trim();
  if ((mode === 'llm' || mode === 'compare') && (!model || model.length > 180)) throw new TypeError('modelo LLM obrigatório');
  return { lab, mode, driver, model, runId: String(body.runId || '').slice(0, 64) };
}

function verifyBlastReplay(state) {
  let replay = createBlastGame(state.seed);
  for (const action of state.history) {
    const result = applyBlastAction(replay, action);
    if (!result.accepted) throw new TypeError('histórico Blast Garden contém ação ilegal');
    replay = result.state;
  }
  for (const key of ['seed','version','turn','grid','player','bombs','gems','collected',
    'cratesDestroyed','cooldown','blasts','history','status','lastEvent']) {
    if (JSON.stringify(replay[key]) !== JSON.stringify(state[key])) {
      throw new TypeError('estado Blast Garden diverge do replay determinístico');
    }
  }
}

function verifyChessReplay(state, chess) {
  let replay = chess.createChessGame();
  for (const move of state.history || []) replay = chess.applyChessMove(replay, move.id);
  for (const key of ['fen','version','history','positions']) {
    if (JSON.stringify(replay[key]) !== JSON.stringify(state[key])) {
      throw new TypeError('estado do xadrez diverge do replay legal');
    }
  }
}

function buildScenario(lab, body) {
  if (lab === 'spam') {
    const message = String(body.message || '').trim();
    if (!message || message.length > 2000) throw new TypeError('mensagem obrigatória (até 2.000 caracteres)');
    const threshold = Number(body.threshold ?? 0.7);
    spamPolicy(0, threshold);
    return { state: { message }, questions: {
      spam: noul('Qual a probabilidade de esta mensagem ser spam, golpe ou divulgação não solicitada? Considere apenas state.message.'),
      credential_request: noul('A mensagem solicita senha, código, pagamento ou dados sensíveis de maneira suspeita?'),
      category: choice('Qual a categoria predominante da mensagem?', { pessoal: 'conversa pessoal ou profissional', transacional: 'aviso legítimo de serviço', promocional: 'oferta ou marketing', golpe: 'tentativa de fraude ou phishing' }),
    }, threshold };
  }
  if (lab === 'rescue') {
    const incident = String(body.incident || '').trim();
    if (!incident || incident.length > 2000) throw new TypeError('incidente obrigatório (até 2.000 caracteres)');
    return { state: { incident }, questions: {
      priority: score('Qual a gravidade sustentada pelo incidente?', ['rotina', 'atenção', 'prioritário', 'emergência']),
      immediate: noul('Há risco imediato a vidas ou infraestrutura essencial?'),
      team: choice('Qual equipe é mais adequada para a resposta inicial?', { bombeiros: 'incêndio, resgate ou acidente', medica: 'atendimento clínico', infraestrutura: 'energia, água ou via pública', defesa_civil: 'riscos naturais ou proteção coletiva' }),
    } };
  }
  if (lab === 'evidence') {
    const claim = String(body.claim || '').trim();
    const evidence = String(body.evidence || '').trim();
    if (!claim || !evidence || claim.length > 1500 || evidence.length > 2500) throw new TypeError('alegação e evidência obrigatórias (até 1.500 e 2.500 caracteres)');
    return { state: { claim, evidence }, questions: {
      verdict: choice('A evidência apresentada sustenta, contradiz ou não permite decidir a alegação? Use apenas state.claim e state.evidence.', { apoiada: 'evidência sustenta a alegação', contradita: 'evidência contradiz a alegação', indeterminada: 'evidência insuficiente ou não relacionada' }),
      relevance: noul('Qual a probabilidade de a evidência ser pertinente à alegação?'),
    } };
  }
  if (lab === 'blast') {
    const state = validateBlastGame(body.state);
    verifyBlastReplay(state);
    if (body.expectedVersion !== state.version) throw new TypeError('versão do jogo mudou; descarte esta resposta e atualize o tabuleiro');
    if (state.status !== 'playing') throw new TypeError('partida encerrada');
    const observation = blastObservation(state);
    return { state: observation, game: state, questions: {
      action: choice('Escolha uma ação para buscar cristais, destruir blocos e sobreviver. Use somente state.legalActions. O código só permite plantar se houver fuga segura em dois movimentos. Bombas explodem após dois turnos adicionais.', Object.fromEntries(observation.legalActions.map(action => [action, {
        up: 'andar para cima', right: 'andar para a direita', down: 'andar para baixo', left: 'andar para a esquerda', plant: 'plantar bomba na posição atual', wait: 'aguardar um turno',
      }[action]]))),
      danger: noul('Qual o risco de a próxima ação expor o jogador a uma explosão?'),
    } };
  }
  const state = body.state;
  if (!state || typeof state !== 'object' || body.expectedVersion !== state.version) throw new TypeError('estado ou versão do xadrez inválidos');
  return { state, game: state, questions: null, chess: true };
}

function normalizeAnswers(raw, questions) {
  const source = raw?.answers || raw;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return { answers: {}, errors: ['respostas ausentes'] };
  const answers = {}, errors = [];
  for (const [id, q] of Object.entries(questions)) {
    const candidate = source[id];
    const value = candidate && typeof candidate === 'object' ? candidate[q.type] : candidate;
    if (q.type === 'choice') {
      if (typeof value === 'string' && Object.hasOwn(q.criteria, value)) answers[id] = value;
      else errors.push('choice inválida: ' + id);
    } else if (q.type === 'noul') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) answers[id] = value;
      else errors.push('noul inválido: ' + id);
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= q.criteria.length - 1) answers[id] = value;
    else errors.push('score inválido: ' + id);
  }
  return { answers, errors };
}

function parseJson(text) {
  const source = String(text || '').trim();
  try { return JSON.parse(source); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  return null;
}

async function defaultDependencies(signal) {
  const [{ JevClient }, gateway, metrics] = await Promise.all([
    import('../jev/client.mjs'), import('./llm-gateway.mjs'), import('./metrics.mjs'),
  ]);
  const client = new JevClient({ timeoutMs: 12000, maxRetries: 0,
    fetchImpl: (url, options) => fetch(url, { ...options,
      signal: signal ? AbortSignal.any([options.signal, signal]) : options.signal }) });
  return { ask: request => client.ask(request), chat: gateway.executeChat, resolve: gateway.resolveModel,
    jevMeta: result => ({ backend: result?.backend || client.backend || null, model: result?.model || client.model || null,
      modelBasis: result?.model ? 'provider' : 'requested',
      ...metrics.readUsage(result), ...metrics.jevCost(result) }),
    llmMeta: (result, resolved) => ({ backend: result?.backend || result?.providerId || null,
      requestedBackend: resolved.providerId, model: result?.model || resolved.modelId,
      modelBasis: result?.model ? 'executor' : 'requested',
      ...metrics.readUsage(result), ...metrics.llmCost(result, resolved) }) };
}

function boundedError(error) { return String(error?.message || error).slice(0, 260); }

async function runJev(state, questions, deps) {
  const start = performance.now();
  try {
    deps.onRemoteStart?.('jev');
    const result = await deps.ask({ state, questions });
    const normalized = normalizeAnswers(result?.answers, questions);
    return { ok: !normalized.errors.length, source: 'jev', error: normalized.errors.join('; ') || null,
      latencyMs: Math.round(performance.now() - start), raw: result?.answers ?? null,
      answers: normalized.answers, ...(deps.jevMeta?.(result) || { backend: result?.backend || null, model: result?.model || null,
        inputTokens: null, outputTokens: null, costUsd: null, costSource: 'unavailable' }) };
  } catch (error) {
    return { ok: false, source: 'jev', error: boundedError(error), latencyMs: Math.round(performance.now() - start),
      raw: null, answers: {}, backend: null, model: null, inputTokens: null, outputTokens: null, costUsd: null, costSource: 'unavailable' };
  }
}

async function runLlm(state, questions, model, deps) {
  const start = performance.now();
  let resolved;
  try {
    resolved = await deps.resolve(model);
    if (!resolved) throw new Error('modelo LLM não encontrado');
    deps.onRemoteStart?.('llm');
    const result = await deps.chat({ providerId: resolved.providerId, modelId: resolved.modelId,
      messages: [{ role: 'system', content: 'Answer each typed judgment in JSON only: {"answers":{"id":value}}. For choice use one criteria key; for noul a number 0..1; for score a number from 0 to the last index. No prose.' },
        { role: 'user', content: JSON.stringify({ state, questions }) }], temperature: 0, maxTokens: 500,
      stream: false, signal: deps.signal ? AbortSignal.any([AbortSignal.timeout(45000),deps.signal])
        : AbortSignal.timeout(45000) });
    const text = result?.content ?? result?.choices?.[0]?.message?.content ?? '';
    const raw = parseJson(text);
    const normalized = normalizeAnswers(raw, questions);
    return { ok: !normalized.errors.length, source: 'llm', error: normalized.errors.join('; ') || null,
      latencyMs: Math.round(performance.now() - start), raw: raw || String(text).slice(0, 4000),
      answers: normalized.answers, ...(deps.llmMeta?.(result, resolved) || { backend: result?.backend || result?.providerId || null,
        requestedBackend: resolved.providerId, model: result?.model || resolved.modelId,
        modelBasis: result?.model ? 'executor' : 'requested',
        inputTokens: null, outputTokens: null, costUsd: null, costSource: 'unavailable' }) };
  } catch (error) {
    return { ok: false, source: 'llm', error: boundedError(error), latencyMs: Math.round(performance.now() - start),
      raw: null, answers: {}, backend: null, model: resolved?.modelId || model, modelBasis: 'requested',
      inputTokens: null, outputTokens: null, costUsd: null, costSource: 'unavailable' };
  }
}

export async function runLabStep(body, injected = {}) {
  const input = validateInput(body);
  const scenario = buildScenario(input.lab, body);
  if (scenario.game && input.mode !== 'code' && scenario.game.version >= 40) {
    throw new RangeError('julgamento remoto disponível até o turno 40 da partida');
  }
  if (scenario.chess) {
    const chess = await import('./labs-chess-engine.mjs');
    verifyChessReplay(scenario.game, chess);
    chess.getChessStatus(scenario.game);
    const candidates = chess.chessCandidates(scenario.game, 8);
    if (!Array.isArray(candidates.candidates) || !candidates.candidates.length) throw new TypeError('xadrez sem lances disponíveis');
    scenario.candidates = candidates;
    scenario.state = { fen: scenario.game.fen, sideToMove: chess.getChessStatus(scenario.game).turn,
      history: scenario.game.history?.slice(-8), candidates: candidates.candidates,
      excluded: candidates.excluded, totalLegal: candidates.totalLegal, criterion: candidates.criterion };
    scenario.questions = { move: choice('Escolha o melhor lance legal entre os candidatos de state.candidates. Responda com o ID UCI exato.',
      Object.fromEntries(candidates.candidates.map(item => [typeof item === 'string' ? item : item.id,
        typeof item === 'string' ? 'lance legal ' + item : item.label || item.id]))) };
  }
  const needsRemote = input.mode !== 'code';
  const supplied = typeof injected.ask === 'function' && typeof injected.chat === 'function'
    && typeof injected.resolve === 'function';
  const deps = needsRemote && !supplied ? { ...(await defaultDependencies(injected.signal)), ...injected } : injected;
  const [jev, llm] = await Promise.all([
    input.mode === 'jev' || input.mode === 'compare' ? runJev(scenario.state, scenario.questions, deps) : Promise.resolve(null),
    input.mode === 'llm' || input.mode === 'compare' ? runLlm(scenario.state, scenario.questions, input.model, deps) : Promise.resolve(null),
  ]);
  const selected = input.driver === 'jev' ? jev : input.driver === 'llm' ? llm : null;
  let proposed = null, applied = null, nextState = null, policy = null;
  if (input.mode === 'code' && input.lab === 'blast') {
    proposed = deterministicBlastAction(scenario.game);
  } else if (input.mode === 'code' && input.lab === 'chess') {
    proposed = typeof scenario.candidates.candidates[0] === 'string'
      ? scenario.candidates.candidates[0] : scenario.candidates.candidates[0].id;
  } else if (selected?.ok) {
    if (input.lab === 'spam') { policy = spamPolicy(selected.answers.spam, scenario.threshold, selected.answers); proposed = policy.action; }
    else if (input.lab === 'rescue') { policy = rescuePolicy(selected.answers); proposed = policy.action; }
    else if (input.lab === 'evidence') { policy = evidencePolicy(selected.answers); proposed = policy.action; }
    else proposed = selected.answers[input.lab === 'chess' ? 'move' : 'action'];
  }
  if (input.lab === 'blast' && proposed) {
    const result = applyBlastAction(scenario.game, proposed);
    if (result.accepted) { applied = result.action; nextState = result.state; }
    else policy = { action: null, reason: result.reason };
  } else if (input.lab === 'chess' && proposed) {
    const chess = await import('./labs-chess-engine.mjs');
    if (chess.getLegalMoves(scenario.game).some(move => (move.id || move) === proposed)) {
      nextState = chess.applyChessMove(scenario.game, proposed);
      applied = proposed;
    } else policy = { action: null, reason: 'lance fora das opções legais' };
  } else if (proposed) applied = proposed;
  return { runId: input.runId, lab: input.lab, mode: input.mode, driver: input.driver,
    stateVersion: scenario.game?.version ?? null, state: scenario.state, questions: scenario.questions,
    candidates: scenario.candidates || null, jev, llm, proposed, applied, policy,
    nextState, status: applied ? 'applied' : 'unknown' };
}
