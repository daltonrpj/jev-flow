// Pure chess rules for Jev Flow Labs. Models may select IDs; only this module
// decides legality and changes the board. All public states are serializable.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FILES = 'abcdefgh';
const PIECES = 'PNBRQKpnbrqk';
const PROMOTIONS = ['q', 'r', 'b', 'n'];
const KNIGHT_STEPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING_STEPS = [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

function indexAt(file, row) {
  return row * 8 + file;
}

function inBoard(file, row) {
  return file >= 0 && file < 8 && row >= 0 && row < 8;
}

function squareName(index) {
  return FILES[index % 8] + String(8 - Math.floor(index / 8));
}

function squareIndex(name) {
  if (!/^[a-h][1-8]$/.test(name)) throw new TypeError('casa inválida: ' + name);
  return indexAt(FILES.indexOf(name[0]), 8 - Number(name[1]));
}

function pieceColor(piece) {
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

function other(color) {
  return color === 'w' ? 'b' : 'w';
}

function parseFen(fen) {
  if (typeof fen !== 'string' || fen.length > 120) throw new TypeError('FEN inválido');
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) throw new TypeError('FEN deve ter seis campos');
  const [placement, turn, rights, ep, halfText, fullText] = parts;
  const ranks = placement.split('/');
  if (ranks.length !== 8) throw new TypeError('FEN deve ter oito linhas');
  const board = Array(64).fill(null);
  for (let row = 0; row < 8; row++) {
    let file = 0;
    for (const char of ranks[row]) {
      if (/^[1-8]$/.test(char)) file += Number(char);
      else if (PIECES.includes(char)) {
        if (file >= 8) throw new TypeError('linha FEN excede oito casas');
        board[indexAt(file++, row)] = char;
      } else throw new TypeError('peça FEN inválida');
    }
    if (file !== 8) throw new TypeError('linha FEN deve ter oito casas');
  }
  if (board.filter((piece) => piece === 'K').length !== 1 || board.filter((piece) => piece === 'k').length !== 1) {
    throw new TypeError('FEN deve conter um rei de cada cor');
  }
  for (let file = 0; file < 8; file++) {
    if (/[Pp]/.test(board[file] || '') || /[Pp]/.test(board[56 + file] || '')) {
      throw new TypeError('peão na primeira ou oitava linha');
    }
  }
  if (turn !== 'w' && turn !== 'b') throw new TypeError('turno FEN inválido');
  if (rights !== '-' && (!/^[KQkq]+$/.test(rights) || new Set(rights).size !== rights.length)) {
    throw new TypeError('direitos de roque FEN inválidos');
  }
  const castling = rights === '-' ? '' : 'KQkq'.split('').filter((right) => rights.includes(right)).join('');
  let epSquare = null;
  if (ep !== '-') {
    epSquare = squareIndex(ep);
    if ((turn === 'w' && ep[1] !== '6') || (turn === 'b' && ep[1] !== '3') || board[epSquare]) {
      throw new TypeError('en passant FEN inválido');
    }
  }
  if (!/^(0|[1-9]\d*)$/.test(halfText) || !/^[1-9]\d*$/.test(fullText)) throw new TypeError('contadores FEN inválidos');
  const halfmove = Number(halfText), fullmove = Number(fullText);
  if (!Number.isSafeInteger(halfmove) || !Number.isSafeInteger(fullmove)) throw new TypeError('contadores FEN fora do limite');
  return { board, turn, castling, epSquare, halfmove, fullmove };
}

function formatFen(position) {
  const ranks = [];
  for (let row = 0; row < 8; row++) {
    let rank = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = position.board[indexAt(file, row)];
      if (!piece) empty++;
      else {
        if (empty) rank += String(empty);
        rank += piece;
        empty = 0;
      }
    }
    if (empty) rank += String(empty);
    ranks.push(rank);
  }
  return [
    ranks.join('/'),
    position.turn,
    position.castling || '-',
    position.epSquare === null ? '-' : squareName(position.epSquare),
    position.halfmove,
    position.fullmove,
  ].join(' ');
}

function assertGame(game) {
  if (!game || typeof game !== 'object' || typeof game.fen !== 'string') throw new TypeError('game inválido');
  return parseFen(game.fen);
}

function isSquareAttacked(board, target, attacker) {
  const targetFile = target % 8, targetRow = Math.floor(target / 8);
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || pieceColor(piece) !== attacker) continue;
    const file = from % 8, row = Math.floor(from / 8);
    const deltaFile = targetFile - file, deltaRow = targetRow - row;
    const type = piece.toLowerCase();
    if (type === 'p') {
      if (Math.abs(deltaFile) === 1 && deltaRow === (attacker === 'w' ? -1 : 1)) return true;
      continue;
    }
    if (type === 'n') {
      if ((Math.abs(deltaFile) === 1 && Math.abs(deltaRow) === 2) ||
          (Math.abs(deltaFile) === 2 && Math.abs(deltaRow) === 1)) return true;
      continue;
    }
    if (type === 'k') {
      if (Math.max(Math.abs(deltaFile), Math.abs(deltaRow)) === 1) return true;
      continue;
    }
    const directions = type === 'b' ? BISHOP_DIRS : type === 'r' ? ROOK_DIRS : QUEEN_DIRS;
    for (const [df, dr] of directions) {
      let x = file + df, y = row + dr;
      while (inBoard(x, y)) {
        const index = indexAt(x, y);
        if (index === target) return true;
        if (board[index]) break;
        x += df;
        y += dr;
      }
    }
  }
  return false;
}

function kingSquare(board, color) {
  return board.indexOf(color === 'w' ? 'K' : 'k');
}

function inCheck(position, color) {
  const king = kingSquare(position.board, color);
  return king < 0 || isSquareAttacked(position.board, king, other(color));
}

function pseudoMoves(position) {
  const { board, turn, castling, epSquare } = position;
  const moves = [];
  function push(from, to, extras = {}) {
    const target = board[to];
    if (target && (pieceColor(target) === turn || target.toLowerCase() === 'k')) return;
    moves.push({
      from, to, piece: board[from], capture: extras.enPassant ? (turn === 'w' ? 'p' : 'P') : target || null,
      promotion: extras.promotion || null, enPassant: Boolean(extras.enPassant), castle: extras.castle || null,
      doublePawn: Boolean(extras.doublePawn),
    });
  }
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || pieceColor(piece) !== turn) continue;
    const file = from % 8, row = Math.floor(from / 8), type = piece.toLowerCase();
    if (type === 'p') {
      const step = turn === 'w' ? -1 : 1, promotionRow = turn === 'w' ? 0 : 7;
      const nextRow = row + step;
      if (inBoard(file, nextRow)) {
        const next = indexAt(file, nextRow);
        if (!board[next]) {
          if (nextRow === promotionRow) for (const promotion of PROMOTIONS) push(from, next, { promotion });
          else push(from, next);
          const startRow = turn === 'w' ? 6 : 1;
          const doubleRow = row + step * 2;
          if (row === startRow && !board[indexAt(file, doubleRow)]) {
            push(from, indexAt(file, doubleRow), { doublePawn: true });
          }
        }
      }
      for (const df of [-1, 1]) {
        const x = file + df, y = row + step;
        if (!inBoard(x, y)) continue;
        const to = indexAt(x, y), target = board[to];
        if (target && pieceColor(target) !== turn && target.toLowerCase() !== 'k') {
          if (y === promotionRow) for (const promotion of PROMOTIONS) push(from, to, { promotion });
          else push(from, to);
        } else if (to === epSquare) {
          const capturedSquare = indexAt(x, row);
          if (board[capturedSquare] === (turn === 'w' ? 'p' : 'P')) push(from, to, { enPassant: true });
        }
      }
      continue;
    }
    if (type === 'n' || type === 'k') {
      for (const [df, dr] of type === 'n' ? KNIGHT_STEPS : KING_STEPS) {
        const x = file + df, y = row + dr;
        if (inBoard(x, y)) push(from, indexAt(x, y));
      }
      if (type === 'k') {
        const home = turn === 'w' ? 7 : 0;
        const kingPiece = turn === 'w' ? 'K' : 'k';
        const rookPiece = turn === 'w' ? 'R' : 'r';
        if (file === 4 && row === home && board[from] === kingPiece &&
            !isSquareAttacked(board, from, other(turn))) {
          const kingRight = turn === 'w' ? 'K' : 'k';
          if (castling.includes(kingRight) && board[indexAt(7, home)] === rookPiece &&
              !board[indexAt(5, home)] && !board[indexAt(6, home)] &&
              !isSquareAttacked(board, indexAt(5, home), other(turn)) &&
              !isSquareAttacked(board, indexAt(6, home), other(turn))) {
            push(from, indexAt(6, home), { castle: 'king' });
          }
          const queenRight = turn === 'w' ? 'Q' : 'q';
          if (castling.includes(queenRight) && board[indexAt(0, home)] === rookPiece &&
              !board[indexAt(1, home)] && !board[indexAt(2, home)] && !board[indexAt(3, home)] &&
              !isSquareAttacked(board, indexAt(3, home), other(turn)) &&
              !isSquareAttacked(board, indexAt(2, home), other(turn))) {
            push(from, indexAt(2, home), { castle: 'queen' });
          }
        }
      }
      continue;
    }
    const directions = type === 'b' ? BISHOP_DIRS : type === 'r' ? ROOK_DIRS : QUEEN_DIRS;
    for (const [df, dr] of directions) {
      let x = file + df, y = row + dr;
      while (inBoard(x, y)) {
        const to = indexAt(x, y), target = board[to];
        if (!target) push(from, to);
        else {
          if (pieceColor(target) !== turn && target.toLowerCase() !== 'k') push(from, to);
          break;
        }
        x += df;
        y += dr;
      }
    }
  }
  return moves;
}

function removeRight(rights, letter) {
  return rights.replace(letter, '');
}

function makePositionMove(position, move) {
  const board = position.board.slice();
  const { from, to, piece } = move;
  board[from] = null;
  if (move.enPassant) board[to + (position.turn === 'w' ? 8 : -8)] = null;
  board[to] = move.promotion
    ? position.turn === 'w' ? move.promotion.toUpperCase() : move.promotion
    : piece;
  if (move.castle) {
    const home = position.turn === 'w' ? 7 : 0;
    const rookFrom = indexAt(move.castle === 'king' ? 7 : 0, home);
    const rookTo = indexAt(move.castle === 'king' ? 5 : 3, home);
    board[rookTo] = board[rookFrom];
    board[rookFrom] = null;
  }
  let castling = position.castling;
  if (piece === 'K') castling = castling.replace('K', '').replace('Q', '');
  if (piece === 'k') castling = castling.replace('k', '').replace('q', '');
  if (from === squareIndex('a1') || to === squareIndex('a1')) castling = removeRight(castling, 'Q');
  if (from === squareIndex('h1') || to === squareIndex('h1')) castling = removeRight(castling, 'K');
  if (from === squareIndex('a8') || to === squareIndex('a8')) castling = removeRight(castling, 'q');
  if (from === squareIndex('h8') || to === squareIndex('h8')) castling = removeRight(castling, 'k');
  return {
    board,
    turn: other(position.turn),
    castling,
    epSquare: move.doublePawn ? (from + to) / 2 : null,
    halfmove: piece.toLowerCase() === 'p' || move.capture ? 0 : position.halfmove + 1,
    fullmove: position.fullmove + (position.turn === 'b' ? 1 : 0),
  };
}

function legalInternal(position) {
  return pseudoMoves(position).filter((move) => !inCheck(makePositionMove(position, move), position.turn));
}

function moveId(move) {
  return squareName(move.from) + squareName(move.to) + (move.promotion || '');
}

function describeMove(position, move) {
  const next = makePositionMove(position, move);
  return Object.freeze({
    id: moveId(move),
    from: squareName(move.from),
    to: squareName(move.to),
    piece: move.piece,
    capture: move.capture,
    promotion: move.promotion,
    castle: move.castle,
    enPassant: move.enPassant,
    check: inCheck(next, next.turn),
  });
}

function positionKey(fen) {
  const position = parseFen(fen);
  let ep = position.epSquare === null ? '-' : squareName(position.epSquare);
  if (ep !== '-' && !legalInternal(position).some((move) => move.enPassant)) ep = '-';
  return [fen.split(' ')[0], position.turn, position.castling || '-', ep].join(' ');
}

function freezeGame(game) {
  const history = (game.history || []).map((entry) => Object.freeze({ ...entry }));
  return Object.freeze({
    fen: game.fen,
    history: Object.freeze(history),
    positions: Object.freeze([...(game.positions || [])]),
    version: game.version,
  });
}

export function createChessGame({ fen = START_FEN } = {}) {
  const normalizedFen = formatFen(parseFen(fen));
  return freezeGame({ fen: normalizedFen, history: [], positions: [positionKey(normalizedFen)], version: 0 });
}

export function getLegalMoves(game) {
  const position = assertGame(game);
  return Object.freeze(legalInternal(position).map((move) => describeMove(position, move))
    .sort((a, b) => a.id.localeCompare(b.id)));
}

function insufficientMaterial(position) {
  const material = [];
  for (let index = 0; index < 64; index++) {
    const piece = position.board[index];
    if (piece && piece.toLowerCase() !== 'k') material.push({ piece, index });
  }
  if (material.length === 0) return true;
  if (material.length === 1 && 'bn'.includes(material[0].piece.toLowerCase())) return true;
  if (material.length === 2 && material.every(({ piece }) => piece.toLowerCase() === 'b') &&
      pieceColor(material[0].piece) !== pieceColor(material[1].piece)) {
    const color = ({ index }) => (index % 8 + Math.floor(index / 8)) % 2;
    return color(material[0]) === color(material[1]);
  }
  return false;
}

export function getChessStatus(game) {
  const position = assertGame(game);
  const legalCount = legalInternal(position).length;
  const checked = inCheck(position, position.turn);
  const base = { turn: position.turn, inCheck: checked, legalMoves: legalCount, halfmoveClock: position.halfmove };
  if (legalCount === 0) {
    return Object.freeze({ ...base, status: checked ? 'checkmate' : 'stalemate', terminal: true,
      reason: checked ? 'checkmate' : 'stalemate', winner: checked ? other(position.turn) : null });
  }
  if (position.halfmove >= 100) {
    return Object.freeze({ ...base, status: 'draw', terminal: true, reason: 'fifty-move', winner: null });
  }
  const key = positionKey(game.fen);
  if (Array.isArray(game.positions) && game.positions.filter((item) => item === key).length >= 3) {
    return Object.freeze({ ...base, status: 'draw', terminal: true, reason: 'threefold', winner: null });
  }
  if (insufficientMaterial(position)) {
    return Object.freeze({ ...base, status: 'draw', terminal: true, reason: 'insufficient-material', winner: null });
  }
  return Object.freeze({ ...base, status: checked ? 'check' : 'playing', terminal: false, reason: null, winner: null });
}

export function applyChessMove(game, selectedMoveId) {
  const position = assertGame(game);
  if (getChessStatus(game).terminal) throw new RangeError('partida encerrada');
  if (typeof selectedMoveId !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(selectedMoveId)) {
    throw new TypeError('moveId UCI inválido');
  }
  const move = legalInternal(position).find((candidate) => moveId(candidate) === selectedMoveId);
  if (!move) throw new RangeError('lance ilegal: ' + selectedMoveId);
  const fen = formatFen(makePositionMove(position, move));
  return freezeGame({
    fen,
    history: [...(game.history || []), { id: selectedMoveId, fen }],
    positions: [...(game.positions || [positionKey(game.fen)]), positionKey(fen)],
    version: (Number.isInteger(game.version) ? game.version : 0) + 1,
  });
}

function moveScore(move) {
  const value = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let score = 0;
  if (move.check) score += 100_000;
  if (move.promotion) score += 10_000 + (value[move.promotion] || 0) * 10;
  if (move.capture) score += 1_000 + (value[move.capture.toLowerCase()] || 0) * 10;
  if (move.castle) score += 100;
  if (['d4', 'e4', 'd5', 'e5'].includes(move.to)) score += 10;
  return score;
}

export function chessCandidates(game, max = 8) {
  if (!Number.isInteger(max) || max < 1 || max > 64) throw new RangeError('max deve ser inteiro de 1 a 64');
  const moves = getChessStatus(game).terminal ? [] : getLegalMoves(game);
  const ranked = moves.map((move) => ({ move, score: moveScore(move) }))
    .sort((a, b) => b.score - a.score || a.move.id.localeCompare(b.move.id));
  const wrap = ({ move, score }) => Object.freeze({ ...move, priority: score });
  return Object.freeze({
    candidates: Object.freeze(ranked.slice(0, max).map(wrap)),
    excluded: Object.freeze(ranked.slice(max).map(wrap)),
    totalLegal: moves.length,
    criterion: 'checks > promotions > captures > castling > center > UCI lexical',
    selectionMethod: 'deterministic-score/v1',
  });
}
