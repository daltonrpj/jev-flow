import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlastGame, validateBlastGame, blastLegalActions, blastObservation,
  applyBlastAction, deterministicBlastAction, spamPolicy, rescuePolicy, evidencePolicy } from './labs-engine.mjs';

test('Blast Garden reproduz o mapa por seed e preserva o estado anterior', () => {
  const first = createBlastGame(17), same = createBlastGame(17), other = createBlastGame(18);
  assert.deepEqual(first, same);
  assert.notDeepEqual(first.grid, other.grid);
  const result = applyBlastAction(first, 'right');
  assert.equal(result.accepted, true);
  assert.equal(first.turn, 0);
  assert.equal(result.state.turn, 1);
  assert.equal(result.state.version, 1);
  assert.equal(result.state.player.x, 2);
});

test('motor só executa ações legais e não avança quando a ação é inválida', () => {
  const state = createBlastGame();
  assert.deepEqual(blastLegalActions(state).sort(), ['down','right','wait'].sort());
  const bad = applyBlastAction(state, 'teleport');
  assert.equal(bad.accepted, false);
  assert.equal(bad.state, state);
  assert.equal(state.turn, 0);
  assert.ok(blastLegalActions(state).includes(deterministicBlastAction(state)));
});

test('bomba exige fuga possível e explode no terceiro turno sem dano em abrigo', () => {
  let state = createBlastGame();
  assert.equal(applyBlastAction(state,'plant').accepted,false,'não permite bomba sem rota de fuga');
  state = applyBlastAction(state, 'right').state;
  state = applyBlastAction(state, 'plant').state;
  assert.equal(state.bombs[0].fuse, 2);
  state = applyBlastAction(state, 'right').state;
  assert.equal(state.bombs[0].fuse, 1);
  assert.ok(blastObservation(state).imminentBlast.some(c => c.x === 3 && c.y === 1));
  state = applyBlastAction(state, 'down').state;
  assert.equal(state.bombs.length, 0);
  assert.equal(state.player.hearts, 3);
  assert.deepEqual([state.player.x,state.player.y],[3,2]);
});

test('estados adulterados e seed inválida são rejeitados', () => {
  assert.throws(() => createBlastGame(-1), /seed/);
  const state = createBlastGame();
  state.grid[0] = '...........';
  assert.throws(() => validateBlastGame(state), /inválido/);
});

test('piloto local encontra rota, escapa das bombas e conclui seed de regressão', () => {
  let state = createBlastGame(2);
  for (let turn = 0; turn < 40 && state.status === 'playing'; turn++) {
    const action = deterministicBlastAction(state);
    assert.ok(blastLegalActions(state).includes(action));
    state = applyBlastAction(state,action).state;
  }
  assert.equal(state.status,'won');
  assert.ok(state.collected >= 3);
  assert.ok(state.cratesDestroyed >= 2);
  assert.equal(state.player.hearts,3);
});

test('políticas locais preservam desconhecido e separam julgamento de efeito', () => {
  assert.equal(spamPolicy(0.8,0.7).action,'bloquear');
  assert.equal(spamPolicy(0.6,0.7).action,'revisar');
  assert.equal(spamPolicy(0.3,0.7).action,'permitir');
  assert.equal(spamPolicy(0,0.7,{category:'golpe',credential_request:1}).action,'revisar');
  assert.equal(spamPolicy(null).action,null);
  assert.equal(rescuePolicy({priority:3,immediate:0.8,team:'medica'}).action.queue,'emergencia');
  assert.equal(rescuePolicy({priority:null,immediate:0.5,team:'medica'}).action,null);
  assert.equal(evidencePolicy({verdict:'contradita',relevance:.9}).action,'corrigir_alegacao');
  assert.equal(evidencePolicy({verdict:'apoiada',relevance:0}).action,'pedir_evidencia');
  assert.equal(evidencePolicy({verdict:'inventada',relevance:.9}).action,null);
});
