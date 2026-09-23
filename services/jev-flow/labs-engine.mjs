// Pure state and policy rules shared by Jev Flow Labs and their browser UI.
export const SPAM_FIXTURES = Object.freeze([
  { id: 'prize', label: 'Prêmio falso', text: 'PARABÉNS! Você ganhou R$50.000. Clique agora e informe sua senha para resgatar.', expected: 'bloquear' },
  { id: 'work', label: 'Mensagem de trabalho', text: 'Oi, consegue revisar o relatório que enviei ontem antes da reunião?', expected: 'permitir' },
  { id: 'invoice', label: 'Cobrança suspeita', text: 'Sua fatura será cancelada hoje. Confirme os dados do cartão no link externo para evitar bloqueio.', expected: 'bloquear' },
  { id: 'newsletter', label: 'Newsletter consentida', text: 'Você se inscreveu na newsletter da loja. Estas são as novidades do mês; cancelar inscrição aqui.', expected: 'permitir' },
  { id: 'ambiguous', label: 'Promoção ambígua', text: 'Oferta exclusiva para clientes antigos. Responda se quiser saber mais sobre o desconto.', expected: 'revisar' },
  { id: 'support', label: 'Suporte legítimo', text: 'Seu chamado 4821 foi atualizado. Acompanhe pelo aplicativo oficial, sem enviar senha por mensagem.', expected: 'permitir' },
]);

export const RESCUE_FIXTURES = Object.freeze([
  { id: 'fire', label: 'Incêndio com pessoas', text: 'Incêndio no prédio da escola. Há pessoas presas no segundo andar e fumaça intensa.', expected: 'emergencia' },
  { id: 'water', label: 'Vazamento controlado', text: 'Vazamento pequeno em uma rua vazia, equipe de manutenção já fechou o registro.', expected: 'rotina' },
  { id: 'power', label: 'Queda de energia', text: 'Hospital perdeu energia de parte da UTI; gerador atende por mais 20 minutos.', expected: 'emergencia' },
  { id: 'tree', label: 'Árvore caída', text: 'Árvore caída bloqueia uma via; não há feridos e o trânsito foi desviado.', expected: 'prioritaria' },
]);

export const EVIDENCE_FIXTURES = Object.freeze([
  { id: 'supported', label: 'Comprovada', claim: 'O serviço ficou fora do ar por 20 minutos.', evidence: 'O registro de disponibilidade mostra indisponibilidade das 14:10 às 14:30.', expected: 'apoiada' },
  { id: 'contradicted', label: 'Contradita', claim: 'O faturamento cresceu 40%.', evidence: 'O relatório financeiro registra crescimento de 8% no período.', expected: 'contradita' },
  { id: 'unknown', label: 'Sem evidência pertinente', claim: 'A API perdeu dados de clientes.', evidence: 'A equipe redesenhou o logotipo na última semana.', expected: 'indeterminada' },
]);

export function spamPolicy(probability, threshold = 0.7, context = {}) {
  if (typeof probability !== 'number' || !Number.isFinite(probability)
      || probability < 0 || probability > 1) {
    return { action: null, reason: 'probabilidade de spam indisponível' };
  }
  const blockAt = Number(threshold);
  if (!Number.isFinite(blockAt) || blockAt < 0.3 || blockAt > 0.95) {
    throw new RangeError('limiar de bloqueio fora de 0,30–0,95');
  }
  const reviewAt = Math.max(0.2, blockAt - 0.15);
  let action = probability >= blockAt ? 'bloquear'
    : probability >= reviewAt ? 'revisar' : 'permitir';
  const suspicious = context?.category === 'golpe' || context?.credential_request >= 0.75;
  if (suspicious && action === 'permitir') action = 'revisar';
  return { action, threshold: blockAt, reviewAt, reason: suspicious
    ? 'categoria golpe ou pedido suspeito de credenciais exige no mínimo revisão'
    : 'política local aplicada ao noul retornado' };
}

export function rescuePolicy(answers) {
  const priority = answers?.priority;
  const team = answers?.team;
  const immediate = answers?.immediate;
  if (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0 || priority > 3
      || !['bombeiros', 'medica', 'infraestrutura', 'defesa_civil'].includes(team)
      || typeof immediate !== 'number' || !Number.isFinite(immediate) || immediate < 0 || immediate > 1) {
    return { action: null, reason: 'julgamentos de resgate incompletos' };
  }
  const queue = priority >= 2.5 || immediate >= 0.75 ? 'emergencia'
    : priority >= 1.5 || immediate >= 0.5 ? 'prioritaria' : 'rotina';
  return { action: { queue, team }, reason: 'fila e equipe derivadas em código' };
}

export function evidencePolicy(answers) {
  const verdict = answers?.verdict;
  const relevance = answers?.relevance;
  if (!['apoiada', 'contradita', 'indeterminada'].includes(verdict)
      || typeof relevance !== 'number' || !Number.isFinite(relevance) || relevance < 0 || relevance > 1) {
    return { action: null, reason: 'veredicto ou pertinência indisponível' };
  }
  const action = relevance < 0.6 ? 'pedir_evidencia' : verdict === 'apoiada' ? 'publicar_com_fonte'
    : verdict === 'contradita' ? 'corrigir_alegacao' : 'pedir_evidencia';
  return { action, reason: relevance < 0.6 ? 'evidência pouco pertinente; decisão conservadora'
    : 'ação editorial derivada em código' };
}

export const BLAST_WIDTH = 11;
export const BLAST_HEIGHT = 9;
const DIRECTIONS = Object.freeze({
  up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0],
});

function seededRandom(seed) {
  let value = (Number(seed) >>> 0) || 1;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const tileKey = (x, y) => x + ',' + y;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < BLAST_WIDTH && y < BLAST_HEIGHT;
const tileAt = (state, x, y) => inBounds(x, y) ? state.grid[y][x] : '#';
const occupiedByBomb = (state, x, y) => state.bombs.some(b => b.x === x && b.y === y);

export function createBlastGame(seed = 20260922) {
  const numericSeed = Number(seed);
  if (!Number.isInteger(numericSeed) || numericSeed < 0 || numericSeed > 4294967295) {
    throw new RangeError('seed inválida');
  }
  const random = seededRandom(numericSeed);
  const rows = [];
  for (let y = 0; y < BLAST_HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < BLAST_WIDTH; x++) {
      const stone = x === 0 || y === 0 || x === BLAST_WIDTH - 1 || y === BLAST_HEIGHT - 1
        || (x % 2 === 0 && y % 2 === 0);
      const clearSpawn = x <= 3 && y <= 3;
      row += stone ? '#' : clearSpawn || random() > 0.34 ? '.' : '+';
    }
    rows.push(row);
  }
  const candidates = [];
  for (let y = 1; y < BLAST_HEIGHT - 1; y++) {
    for (let x = 1; x < BLAST_WIDTH - 1; x++) {
      if (rows[y][x] === '.' && x + y > 5) candidates.push({ x, y });
    }
  }
  const gems = [];
  while (gems.length < 4 && candidates.length) {
    gems.push(candidates.splice(Math.floor(random() * candidates.length), 1)[0]);
  }
  return { seed: numericSeed, version: 0, turn: 0, grid: rows, player: { x: 1, y: 1, hearts: 3 },
    bombs: [], gems, collected: 0, cratesDestroyed: 0, cooldown: 0, blasts: [], history: [],
    status: 'playing', lastEvent: 'Encontre cristais e abra caminho com bombas.' };
}

export function validateBlastGame(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
      || !Array.isArray(state.grid) || state.grid.length !== BLAST_HEIGHT
      || state.grid.some(row => typeof row !== 'string' || row.length !== BLAST_WIDTH || /[^#.+]/.test(row))
      || !state.grid.every((row, y) => row[0] === '#' && row[BLAST_WIDTH - 1] === '#'
        && (y !== 0 && y !== BLAST_HEIGHT - 1 || /^#+$/.test(row)))
      || !Number.isInteger(state.player?.x) || !Number.isInteger(state.player?.y)
      || !inBounds(state.player.x, state.player.y) || tileAt(state, state.player.x, state.player.y) !== '.'
      || !Number.isInteger(state.player.hearts) || state.player.hearts < 0 || state.player.hearts > 3
      || !Array.isArray(state.bombs) || state.bombs.length > 3
      || state.bombs.some(b => !Number.isInteger(b.x) || !Number.isInteger(b.y)
        || !inBounds(b.x, b.y) || !Number.isInteger(b.fuse) || b.fuse < 1 || b.fuse > 3)
      || !Array.isArray(state.gems) || state.gems.length > 12
      || state.gems.some(g => !Number.isInteger(g.x) || !Number.isInteger(g.y)
        || !inBounds(g.x, g.y))
      || !Number.isInteger(state.turn) || state.turn < 0 || state.turn > 200
      || !Array.isArray(state.history) || state.history.length !== state.turn
      || state.history.some(action => !['wait','up','right','down','left','plant'].includes(action))
      || !Number.isInteger(state.version) || state.version < 0 || state.version > 200
      || !Number.isInteger(state.collected) || state.collected < 0 || state.collected > 20
      || !Number.isInteger(state.cratesDestroyed) || state.cratesDestroyed < 0 || state.cratesDestroyed > 80
      || !Number.isInteger(state.cooldown) || state.cooldown < 0 || state.cooldown > 3
      || !['playing', 'won', 'lost'].includes(state.status)) {
    throw new TypeError('estado Blast Garden inválido');
  }
  return state;
}

export function blastLegalActions(state) {
  validateBlastGame(state);
  if (state.status !== 'playing') return [];
  const actions = ['wait'];
  for (const [name, [dx, dy]] of Object.entries(DIRECTIONS)) {
    const x = state.player.x + dx, y = state.player.y + dy;
    if (tileAt(state, x, y) === '.' && !occupiedByBomb(state, x, y)) actions.push(name);
  }
  if (state.cooldown === 0 && state.bombs.length < 2
      && !occupiedByBomb(state, state.player.x, state.player.y)
      && canEscapePlantedBomb(state)) actions.push('plant');
  return actions;
}

function blastCells(state, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of Object.values(DIRECTIONS)) {
    for (let step = 1; step <= 2; step++) {
      const x = bomb.x + dx * step, y = bomb.y + dy * step;
      if (tileAt(state, x, y) === '#') break;
      cells.push({ x, y });
      if (tileAt(state, x, y) === '+') break;
    }
  }
  return cells;
}

function canEscapePlantedBomb(state) {
  const origin = state.player;
  const danger = new Set(blastCells(state, origin).map(cell => tileKey(cell.x, cell.y)));
  let frontier = [{ x: origin.x, y: origin.y }];
  for (let step = 0; step < 2; step++) {
    const next = [];
    for (const point of frontier) for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const x = point.x + dx, y = point.y + dy;
      if (x === origin.x && y === origin.y) continue;
      if (tileAt(state, x, y) !== '.' || occupiedByBomb(state, x, y)) continue;
      next.push({ x, y });
    }
    frontier = next;
  }
  return frontier.some(point => !danger.has(tileKey(point.x, point.y)));
}

export function blastDanger(state) {
  validateBlastGame(state);
  const danger = new Set();
  for (const bomb of state.bombs) {
    if (bomb.fuse <= 1) for (const cell of blastCells(state, bomb)) danger.add(tileKey(cell.x, cell.y));
  }
  return [...danger].map(key => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
}

export function blastObservation(state) {
  validateBlastGame(state);
  return { turn: state.turn, grid: state.grid, player: state.player, bombs: state.bombs,
    gems: state.gems, collected: state.collected, cratesDestroyed: state.cratesDestroyed,
    recentActions: state.history.slice(-5),
    legalActions: blastLegalActions(state), imminentBlast: blastDanger(state),
    mission: 'Colete pelo menos 3 cristais e destrua 2 blocos. Sobreviva.' };
}

function routeTo(state, targetKeys) {
  if (!targetKeys.size) return null;
  const start = state.player;
  const queue = [{ x:start.x, y:start.y, first:null, distance:0 }];
  const seen = new Set([tileKey(start.x,start.y)]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (targetKeys.has(tileKey(current.x,current.y))) return current;
    for (const [action,[dx,dy]] of Object.entries(DIRECTIONS)) {
      const x = current.x + dx, y = current.y + dy, key = tileKey(x,y);
      if (seen.has(key) || tileAt(state,x,y) !== '.' || occupiedByBomb(state,x,y)) continue;
      seen.add(key);
      queue.push({ x, y, first:current.first || action, distance:current.distance + 1 });
    }
  }
  return null;
}

function escapeAction(state) {
  if (!state.bombs.some(bomb => bomb.fuse <= 2)) return null;
  const legal = blastLegalActions(state).filter(action => action !== 'plant');
  let best = null;
  for (const first of legal) {
    const afterFirst = applyBlastAction(state,first);
    if (!afterFirst.accepted) continue;
    const firstState = afterFirst.state;
    if (firstState.player.hearts < state.player.hearts) continue;
    if (!firstState.bombs.some(bomb => bomb.fuse <= 1)) return first;
    for (const second of blastLegalActions(firstState).filter(action => action !== 'plant')) {
      const afterSecond = applyBlastAction(firstState,second);
      if (!afterSecond.accepted) continue;
      if (afterSecond.state.player.hearts === state.player.hearts) {
        const gain = afterSecond.state.collected - state.collected;
        const candidate = { action:first, gain };
        if (!best || candidate.gain > best.gain) best = candidate;
      }
    }
  }
  return best?.action || legal[0] || 'wait';
}

export function deterministicBlastAction(state) {
  const legal = blastLegalActions(state);
  if (!legal.length) return null;
  const escape = escapeAction(state);
  if (escape) return escape;
  if (state.collected < 3) {
    const gemRoute = routeTo(state,new Set(state.gems.map(gem => tileKey(gem.x,gem.y))));
    if (gemRoute?.first) return gemRoute.first;
  }
  const crateTargets = new Set();
  for (let y = 1; y < BLAST_HEIGHT - 1; y++) for (let x = 1; x < BLAST_WIDTH - 1; x++) {
    if (tileAt(state,x,y) !== '.' || occupiedByBomb(state,x,y)) continue;
    const besideCrate = Object.values(DIRECTIONS).some(([dx,dy]) => tileAt(state,x+dx,y+dy) === '+');
    if (besideCrate && canEscapePlantedBomb({ ...state, player:{ ...state.player,x,y } })) {
      crateTargets.add(tileKey(x,y));
    }
  }
  const crateRoute = routeTo(state,crateTargets);
  if (crateRoute) {
    if (crateRoute.first) return crateRoute.first;
    if (legal.includes('plant')) return 'plant';
    return 'wait';
  }
  if (state.collected < 3) {
    const anyGem = routeTo(state,new Set(state.gems.map(gem => tileKey(gem.x,gem.y))));
    if (anyGem?.first) return anyGem.first;
  }
  return legal.find(action => DIRECTIONS[action]) || 'wait';
}

export function applyBlastAction(inputState, action) {
  const state = validateBlastGame(inputState);
  const legal = blastLegalActions(state);
  if (!legal.includes(action)) {
    return { accepted: false, reason: 'ação fora das opções legais', action: null, state };
  }
  const next = structuredClone(state);
  next.version++;
  next.turn++;
  next.history.push(action);
  next.blasts = [];
  next.lastEvent = action === 'wait' ? 'Aguardou um turno.' : action === 'plant' ? 'Bomba plantada.' : 'Moveu para ' + action + '.';
  if (DIRECTIONS[action]) {
    const [dx, dy] = DIRECTIONS[action];
    next.player.x += dx;
    next.player.y += dy;
  } else if (action === 'plant') {
    next.bombs.push({ x: next.player.x, y: next.player.y, fuse: 3 });
    next.cooldown = 2;
  }
  const gemIndex = next.gems.findIndex(g => g.x === next.player.x && g.y === next.player.y);
  if (gemIndex >= 0) {
    next.gems.splice(gemIndex, 1);
    next.collected++;
    next.lastEvent += ' Cristal coletado.';
  }
  const queue = next.bombs.map((bomb, index) => {
    bomb.fuse--;
    return bomb.fuse <= 0 ? index : -1;
  }).filter(index => index >= 0);
  const exploded = new Set();
  const blastMap = new Map();
  while (queue.length) {
    const index = queue.shift();
    if (exploded.has(index)) continue;
    exploded.add(index);
    for (const cell of blastCells(next, next.bombs[index])) {
      blastMap.set(tileKey(cell.x, cell.y), cell);
      const chained = next.bombs.findIndex((bomb, candidate) =>
        !exploded.has(candidate) && bomb.x === cell.x && bomb.y === cell.y);
      if (chained >= 0) queue.push(chained);
      if (tileAt(next, cell.x, cell.y) === '+') {
        const row = next.grid[cell.y];
        next.grid[cell.y] = row.slice(0, cell.x) + '.' + row.slice(cell.x + 1);
        next.cratesDestroyed++;
      }
    }
  }
  if (exploded.size) {
    next.bombs = next.bombs.filter((_, index) => !exploded.has(index));
    next.blasts = [...blastMap.values()];
    next.lastEvent += ' ' + exploded.size + ' bomba(s) explodiram.';
    if (blastMap.has(tileKey(next.player.x, next.player.y))) {
      next.player.hearts--;
      next.lastEvent += ' Explosão atingiu o explorador.';
      if (next.player.hearts > 0) {
        next.player.x = 1;
        next.player.y = 1;
      }
    }
  }
  if (action !== 'plant') next.cooldown = Math.max(0, next.cooldown - 1);
  if (next.player.hearts <= 0 || next.turn >= 80) next.status = 'lost';
  else if (next.collected >= 3 && next.cratesDestroyed >= 2) next.status = 'won';
  return { accepted: true, reason: null, action, state: next };
}
