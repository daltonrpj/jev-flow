// ============================================================================
// Tic-tac-toe. Local minimax is deterministic; a live Jev judgment is opt-in.
// ============================================================================
import { JevClient, choiceQ, noulQ, isJevConfigured } from '../jev/client.mjs';

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const POS_NAMES = ['top left', 'top middle', 'top right', 'middle left', 'CENTER', 'middle right', 'bottom left', 'bottom middle', 'bottom right'];

export function normalizeBoard(raw) {
  if (!Array.isArray(raw) || raw.length !== 9 || raw.some(c => c !== '' && c !== 'X' && c !== 'O')) {
    throw new TypeError('board must contain exactly nine empty, X, or O cells');
  }
  return raw.slice();
}

export function winner(board) {
  for (const [a, b, c] of LINES) if (board[a] && board[a] === board[b] && board[b] === board[c]) return { who: board[a], line: [a, b, c] };
  return board.every(c => c) ? { who: 'draw', line: null } : null;
}

function freeCells(board) { return board.map((c, i) => (!c ? i : -1)).filter(i => i >= 0); }

/** Deterministic perfect-play auditor. */
export function bestMove(board, me = 'O') {
  const foe = me === 'O' ? 'X' : 'O';
  function score(b, turn, depth) {
    const w = winner(b);
    if (w) return w.who === me ? 10 - depth : w.who === foe ? depth - 10 : 0;
    const moves = freeCells(b).map(i => {
      const nb = b.slice(); nb[i] = turn;
      return { i, s: score(nb, turn === me ? foe : me, depth + 1) };
    });
    moves.sort((x, y) => (turn === me ? y.s - x.s : x.s - y.s));
    return moves[0].s;
  }
  const moves = freeCells(board).map(i => {
    const nb = board.slice(); nb[i] = me;
    return { i, s: score(nb, foe, 0) };
  });
  moves.sort((x, y) => y.s - x.s);
  return moves[0]?.i ?? -1;
}

function cellDescription(board, i, me) {
  const strategic = i === 4 ? 'center controls four lines' :
    [0, 2, 6, 8].includes(i) ? 'corner belongs to three lines' : 'edge belongs to two lines';
  const lines = LINES.filter(l => l.includes(i));
  const myTwo = lines.some(l => l.filter(x => board[x] === me).length === 2 && l.every(x => board[x] !== (me === 'O' ? 'X' : 'O')));
  const foeTwo = lines.some(l => l.filter(x => board[x] === (me === 'O' ? 'X' : 'O')).length === 2 && l.every(x => board[x] !== me));
  const note = myTwo ? ' — WINS NOW' : foeTwo ? ' — BLOCKS an immediate opponent win' : '';
  return 'cell ' + POS_NAMES[i] + ' (' + strategic + ')' + note;
}

function validUnit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function knownCost(res) {
  return Number.isFinite(res?.usage?.input_tokens) && res.usage.input_tokens >= 0
    && Number.isFinite(res?.costEstimateUsd) && res.costEstimateUsd >= 0
    ? res.costEstimateUsd : null;
}

/**
 * O's move. `live:true` explicitly enables a configured Jev call. An injected
 * client is only for offline contract tests and is treated as live.
 */
export async function jevVelhaMove({ board, live = false } = {}, { client } = {}) {
  const b = normalizeBoard(board);
  const xCount = b.filter(c => c === 'X').length;
  const oCount = b.filter(c => c === 'O').length;
  if (xCount !== oCount + 1) throw new RangeError('it must be O’s turn after one X move');
  if (winner(b)) throw new RangeError('game already finished');
  const livres = freeCells(b);
  const criteria = Object.fromEntries(livres.map(i => ['c' + i, cellDescription(b, i, 'O')]));

  if (!live && !client) {
    const move = bestMove(b, 'O');
    return { move, source: 'local', probabilities: null, audit: { minimax: true }, cost_usd_estimate: 0, latency_ms: null };
  }
  if (!client && !isJevConfigured()) throw new Error('Jev is unavailable; select local play or configure a provider');
  const jev = client || new JevClient({ timeoutMs: 6000 });
  let res;
  try { res = await jev.ask({
      state: { board_rows: [b.slice(0, 3), b.slice(3, 6), b.slice(6, 9)], you_play: 'O', opponent: 'X', free_cells: livres.map(i => POS_NAMES[i]) },
      questions: {
        melhor: choiceQ('Which cell should O play to win or avoid losing?', criteria),
        ha_vitoria_imediata: noulQ('Can O win immediately on this turn?'),
      },
    }); } catch { throw new Error('Jev request failed'); }
  const answer = res?.answers?.melhor;
  const escolha = answer?.choice;
  const move = /^c\d+$/u.test(escolha || '') && livres.includes(Number(escolha.slice(1))) ? Number(escolha.slice(1)) : null;
  const probabilities = answer?.probabilities;
  if (move === null || !probabilities || Object.keys(probabilities).length !== livres.length
    || livres.some(i => !validUnit(probabilities['c' + i]))
    || Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.02
    || !validUnit(answer?.confidence) || !validUnit(res?.answers?.ha_vitoria_imediata?.noul)) {
    throw new Error('Jev returned an invalid tic-tac-toe judgment');
  }
  const audit = {
    vitoria_imediata_percibida: res.answers.ha_vitoria_imediata.noul,
    minimax_concorda: move === bestMove(b, 'O'),
  };
  return { move, source: 'jev', probabilities, audit, cost_usd_estimate: knownCost(res),
    latency_ms: Number.isFinite(res.latencyMs) && res.latencyMs >= 0 ? res.latencyMs : null };
}
