import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { normalizeBoard, winner, bestMove, jevVelhaMove } from './velha.mjs';
import { fightJudge, ROSTER } from './arena.mjs';
import { cityTick, normalizeAgents, ACTIONS, BUILDINGS } from './city.mjs';
import { buildGamesPage } from './games-page.mjs';
import { buildVelhaPage } from './velha-page.mjs';
import { buildArenaPage } from './arena-page.mjs';
import { buildCityPage } from './city-page.mjs';

function choice(choiceKey, keys) {
  return { choice: choiceKey, confidence: 0.9,
    probabilities: Object.fromEntries(keys.map(key => [key, key === choiceKey ? 1 : 0])) };
}

test('tic-tac-toe minimax cannot lose against any sequence of X moves', () => {
  function play(board) {
    const outcome = winner(board);
    if (outcome) { assert.notEqual(outcome.who, 'X'); return; }
    for (let i = 0; i < 9; i++) {
      if (board[i]) continue;
      const afterX = board.slice(); afterX[i] = 'X';
      const xOutcome = winner(afterX);
      if (xOutcome) { assert.notEqual(xOutcome.who, 'X'); continue; }
      const move = bestMove(afterX, 'O');
      assert.equal(afterX[move], '');
      afterX[move] = 'O';
      play(afterX);
    }
  }
  play(Array(9).fill(''));
});

test('tic-tac-toe rejects malformed boards and never calls Jev by default', async () => {
  assert.throws(() => normalizeBoard(['X', null, ...Array(7).fill('')]), TypeError);
  await assert.rejects(() => jevVelhaMove({ board: Array(9).fill('') }), RangeError);
  await assert.rejects(() => jevVelhaMove({ board: ['X', 'X', ...Array(7).fill('')] }), RangeError);
  const board = ['X', '', '', '', '', '', '', '', ''];
  const result = await jevVelhaMove({ board });
  assert.equal(result.source, 'local');
  assert.equal(result.cost_usd_estimate, 0);
  assert.equal(board[result.move], '');
  assert.deepEqual(board, ['X', '', '', '', '', '', '', '', '']);
});

test('tic-tac-toe validates one typed live choice without inventing cost', async () => {
  let calls = 0;
  const client = { async ask({ questions }) {
    calls++;
    const keys = Object.keys(questions.melhor.criteria);
    return { answers: { melhor: choice('c4', keys), ha_vitoria_imediata: { noul: 0 } }, latencyMs: 12 };
  } };
  const board = ['X', '', '', '', '', '', '', '', ''];
  const result = await jevVelhaMove({ board, live: true }, { client });
  assert.equal(calls, 1);
  assert.equal(result.move, 4);
  assert.equal(result.source, 'jev');
  assert.equal(result.cost_usd_estimate, null);
  const invalid = { async ask() { return { answers: { melhor: { choice: 'c99' } } }; } };
  await assert.rejects(() => jevVelhaMove({ board, live: true }, { client: invalid }), /invalid/);
  assert.equal(board[4], '');
});

test('combat local simulation is deterministic and winner probability is coherent', async () => {
  const pairs = ROSTER.slice(0, 5).flatMap(a => ROSTER.slice(5).map(b => [a, b]));
  let sawB = false;
  for (const [a, b] of pairs) {
    const input = { a, b };
    const one = await fightJudge(input);
    const two = await fightJudge(input);
    assert.deepEqual(one, two);
    assert.equal(one.source, 'local simulation');
    assert.ok(Math.abs(one.probabilidades.a + one.probabilidades.b + one.probabilidades.empate - 1) < 0.001);
    assert.equal(one.vencedor, one.probabilidades.a >= one.probabilidades.b ? 'a' : 'b');
    if (one.vencedor === 'b') sawB = true;
  }
  assert.equal(sawB, true, 'test must exercise the former B-winner probability inversion');
});

test('combat live mode requires complete typed outputs and preserves unknown cost', async () => {
  const client = { async ask({ questions }) { return { answers: {
    vencedor: choice('b', Object.keys(questions.vencedor.criteria)),
    disputada: { noul: 0.72 }, rounds: { score: 2.5 },
  }, latencyMs: 20 }; } };
  const result = await fightJudge({ a: ROSTER[0], b: ROSTER[1], live: true }, { client });
  assert.equal(result.vencedor, 'b');
  assert.equal(result.rounds, 2.5);
  assert.equal(result.cost_usd_estimate, null);
  const malformed = { async ask() { return { answers: { vencedor: { choice: 'a' }, disputada: { noul: 0.5 }, rounds: { score: 3 } } }; } };
  await assert.rejects(() => fightJudge({ a: ROSTER[0], b: ROSTER[1], live: true }, { client: malformed }), /invalid/);
});

test('city local ticks are deterministic, bounded, and reject colliding question IDs', async () => {
  const raw = [{ id: 'ada', nome: 'Ada', energia: 10, fome: 90 }, { id: 'linus', nome: 'Linus', energia: 90, fome: 10 }];
  const first = await cityTick({ agents: raw, tick: 2 });
  const second = await cityTick({ agents: raw, tick: 2 });
  assert.deepEqual(first, second);
  assert.equal(first.source, 'local simulation');
  assert.equal(first.eventos.length, 2);
  assert.deepEqual(raw[0], { id: 'ada', nome: 'Ada', energia: 10, fome: 90 });
  for (const event of first.eventos) { assert.ok(ACTIONS[event.acao]); assert.ok(BUILDINGS[event.local]); }
  for (const agent of first.agents) for (const key of ['energia','fome','felicidade','dinheiro','saber']) assert.ok(agent[key] >= 0 && agent[key] <= 100);
  assert.throws(() => normalizeAgents(Array.from({ length: 11 }, (_, i) => ({ id: String(i) }))), /1 to 10/);
  assert.throws(() => normalizeAgents([{ id: 'same' }, { id: 'same' }]), /unique/);
  assert.throws(() => normalizeAgents([{ id: 'bad.id' }]), /short slugs/);
  assert.throws(() => normalizeAgents([{ id: 'a', energia: NaN }]), /finite/);
  await assert.rejects(() => cityTick({ agents: raw, tick: 1.5 }), /integer/);
});

test('city live tick is one all-or-nothing call with code-applied effects', async () => {
  let calls = 0;
  const agents = [{ id: 'a', nome: 'Ada', energia: 15, fome: 20 }];
  const client = { async ask({ questions }) {
    calls++;
    assert.deepEqual(Object.keys(questions).sort(), ['ag_a', 'prosperidade']);
    return { answers: { ag_a: choice('dormir', Object.keys(questions.ag_a.criteria)), prosperidade: { noul: 0.77 } }, latencyMs: 9 };
  } };
  const result = await cityTick({ agents, live: true, tick: 3 }, { client });
  assert.equal(calls, 1);
  assert.equal(result.source, 'jev');
  assert.equal(result.eventos[0].acao, 'dormir');
  assert.ok(result.agents[0].energia > agents[0].energia);
  assert.equal(result.prosperidade, 0.77);
  assert.equal(result.custo, null);
  const invalid = { async ask() { return { answers: { ag_a: { choice: 'dormir' } } }; } };
  await assert.rejects(() => cityTick({ agents, live: true }, { client: invalid }), /invalid/);
  assert.equal(agents[0].energia, 15);
});

test('city preserves a typed choice for an object-prototype-shaped citizen ID', async () => {
  const agents = [{ id: '__proto__', nome: 'Ada', energia: 15 }];
  const client = { async ask({ questions }) { return { answers: {
    ag___proto__: choice('dormir', Object.keys(questions.ag___proto__.criteria)),
    prosperidade: { noul: 0.5 },
  } }; } };
  const result = await cityTick({ agents, live: true }, { client });
  assert.equal(result.source, 'jev');
  assert.equal(result.eventos[0].acao, 'dormir');
});

test('provider transport errors do not echo private response text', async () => {
  const client = { async ask() { throw new Error('private-provider-token'); } };
  const board = ['X', '', '', '', '', '', '', '', ''];
  for (const promise of [
    jevVelhaMove({ board, live: true }, { client }),
    fightJudge({ a: ROSTER[0], b: ROSTER[1], live: true }, { client }),
    cityTick({ agents: [{ id: 'a' }], live: true }, { client }),
  ]) {
    await assert.rejects(promise, error => error.message === 'Jev request failed');
  }
});

test('game pages are English-first, parse, and safely serialize hostile roster text', () => {
  const pages = [buildGamesPage(), buildVelhaPage(), buildArenaPage(), buildCityPage()];
  for (const page of pages) {
    assert.match(page, /<html lang="en">/);
    assert.doesNotMatch(page, /Atlas|shipwithjev/u);
    const match = page.match(/<script>([\s\S]*?)<\/script>/u);
    if (match) new Script(match[1]);
  }
  assert.match(pages[1], /live Jev \(may incur provider cost\)/u);
  assert.match(pages[2], /api\/jev\/games\/arena\/fight/u);
  assert.match(pages[3], /api\/jev\/games\/city\/tick/u);
  const hostile = buildArenaPage({ roster: [{ id: 'x', nome: '</script><script>alert(1)</script>', emoji: 'x', desc: 'x' }] });
  assert.equal((hostile.match(/<script>/gu) || []).length, 1);
  assert.equal((hostile.match(/<\/script>/gu) || []).length, 1);
  assert.doesNotMatch(hostile, /<script>alert\(1\)<\/script>/u);
});
