import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChessGame, getLegalMoves, applyChessMove, getChessStatus, chessCandidates,
} from './labs-chess-engine.mjs';

const ids = (game) => getLegalMoves(game).map((move) => move.id);
const play = (game, ...moves) => moves.reduce((state, move) => applyChessMove(state, move), game);

test('posição inicial: FEN, vinte lances e 400 sequências de dois lances', () => {
  const game = createChessGame();
  assert.equal(game.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(getChessStatus(game).status, 'playing');
  assert.equal(ids(game).length, 20);
  assert.equal(ids(game).reduce((sum, id) => sum + ids(applyChessMove(game, id)).length, 0), 400);
});

test('perft inicial em três lances encontra 8.902 folhas', () => {
  const count = (game, depth) => depth === 0 ? 1
    : getLegalMoves(game).reduce((sum, move) => sum + count(applyChessMove(game, move.id), depth - 1), 0);
  assert.equal(count(createChessGame(), 3), 8902);
  const tactical = createChessGame({ fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1' });
  assert.equal(count(tactical, 3), 2812);
});

test('aplicação é imutável e FEN/histórico permitem replay', () => {
  const game = createChessGame();
  const next = play(game, 'e2e4', 'e7e5', 'g1f3');
  assert.equal(game.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(game.history.length, 0);
  assert.equal(next.version, 3);
  assert.deepEqual(next.history.map((entry) => entry.id), ['e2e4', 'e7e5', 'g1f3']);
  assert.equal(next.fen, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
  assert.deepEqual(JSON.parse(JSON.stringify(next)), {
    fen: next.fen, history: next.history, positions: next.positions, version: 3,
  });
  assert.ok(Object.isFrozen(next) && Object.isFrozen(next.history));
});

test('lance ilegal ou promoção sem peça são recusados sem mutação', () => {
  const game = createChessGame();
  assert.throws(() => applyChessMove(game, 'e2e5'), /ilegal/);
  assert.throws(() => applyChessMove(game, 'e2e4x'), /UCI/);
  assert.equal(game.version, 0);
  const promotion = createChessGame({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1' });
  assert.deepEqual(ids(promotion).filter((id) => id.startsWith('a7a8')), ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r']);
  assert.throws(() => applyChessMove(promotion, 'a7a8'), /ilegal/);
  assert.match(applyChessMove(promotion, 'a7a8q').fen, /^Q3k3\//);
  const blackPromotion = createChessGame({ fen: '4k3/8/8/8/8/8/p7/4K3 b - - 0 1' });
  assert.ok(ids(blackPromotion).includes('a2a1q'));
  assert.match(applyChessMove(blackPromotion, 'a2a1q').fen, /\/q3K3 w/);
});

test('roque dos dois lados move torre, e passagem atacada impede roque', () => {
  const open = createChessGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
  assert.ok(ids(open).includes('e1g1'));
  assert.ok(ids(open).includes('e1c1'));
  assert.equal(applyChessMove(open, 'e1g1').fen, 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
  const attacked = createChessGame({ fen: 'r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1' });
  assert.ok(!ids(attacked).includes('e1g1'));
  assert.ok(ids(attacked).includes('e1c1'));
  const rookCapture = applyChessMove(open, 'a1a8');
  assert.equal(rookCapture.fen.split(' ')[2], 'Kk');
  const black = createChessGame({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1' });
  assert.ok(ids(black).includes('e8c8'));
  assert.equal(applyChessMove(black, 'e8c8').fen, '2kr3r/8/8/8/8/8/8/R3K2R w KQ - 1 2');
});

test('en passant captura peão e é proibido se expõe o rei', () => {
  const valid = createChessGame({ fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1' });
  assert.ok(ids(valid).includes('e5d6'));
  assert.equal(applyChessMove(valid, 'e5d6').fen, '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1');
  const pinned = createChessGame({ fen: 'k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1' });
  assert.ok(!ids(pinned).includes('e5d6'));
});

test('xeque, mate e afogamento são distintos', () => {
  const checked = createChessGame({ fen: '4k3/8/8/8/8/8/4r3/B3K3 w - - 0 1' });
  assert.equal(getChessStatus(checked).status, 'check');
  assert.ok(!ids(checked).includes('a1b2'));
  assert.throws(() => applyChessMove(checked, 'a1b2'), /ilegal/);
  const mate = play(createChessGame(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.deepEqual(
    { status: getChessStatus(mate).status, winner: getChessStatus(mate).winner, legal: ids(mate).length },
    { status: 'checkmate', winner: 'b', legal: 0 },
  );
  const stale = createChessGame({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
  assert.equal(getChessStatus(stale).status, 'stalemate');
  assert.equal(getChessStatus(stale).winner, null);
  assert.throws(() => applyChessMove(mate, 'h4h3'), /encerrada/);
});

test('50 movimentos, material insuficiente e repetição tripla encerram', () => {
  const fifty = createChessGame({ fen: '7k/8/8/8/8/8/8/K5R1 w - - 100 50' });
  assert.equal(getChessStatus(fifty).reason, 'fifty-move');
  assert.throws(() => applyChessMove(fifty, 'g1g2'), /encerrada/);
  const bare = createChessGame({ fen: '7k/8/8/8/8/8/8/K7 w - - 0 1' });
  assert.equal(getChessStatus(bare).reason, 'insufficient-material');
  const pawn = createChessGame({ fen: '7k/8/8/8/8/8/P7/K7 w - - 99 50' });
  assert.equal(applyChessMove(pawn, 'a2a3').fen.split(' ')[4], '0');
  const repeated = play(createChessGame(),
    'g1f3', 'g8f6', 'f3g1', 'f6g8',
    'g1f3', 'g8f6', 'f3g1', 'f6g8');
  assert.equal(getChessStatus(repeated).reason, 'threefold');
});

test('FEN malformado é recusado; candidatos são subset determinístico com exclusões', () => {
  assert.throws(() => createChessGame({ fen: '8/8/8/8/8/8/8/8 w - - 0 1' }), /rei/);
  assert.throws(() => createChessGame({ fen: '4k3/8/8/8/8/8/8/4K3 w - e3 0 1' }), /en passant/);
  const game = createChessGame();
  const first = chessCandidates(game, 8), second = chessCandidates(game, 8);
  assert.deepEqual(first, second);
  assert.equal(first.candidates.length, 8);
  assert.equal(first.excluded.length, 12);
  assert.equal(first.totalLegal, 20);
  assert.ok(first.candidates.every((move) => ids(game).includes(move.id)));
  assert.throws(() => chessCandidates(game, 0), /max/);
});
