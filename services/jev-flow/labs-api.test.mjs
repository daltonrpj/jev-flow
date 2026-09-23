import test from 'node:test';
import assert from 'node:assert/strict';
import { runLabStep } from './labs-api.mjs';
import { createBlastGame } from './labs-engine.mjs';
import { createChessGame, getLegalMoves } from './labs-chess-engine.mjs';

const meta = { backend:'mock',model:'fixture',inputTokens:10,outputTokens:2,costUsd:0.001,costSource:'provider' };
const injected = answers => ({
  ask: async () => ({answers,backend:'mock',model:'fixture'}),
  chat: async () => ({content:JSON.stringify({answers}),model:'fixture'}),
  resolve: () => ({providerId:'mock',modelId:'fixture'}),
  jevMeta: () => meta,
  llmMeta: () => meta,
});

test('spam conserva resposta tipada bruta e aplica limiar em código', async () => {
  const result = await runLabStep({lab:'spam',message:'Ganhe dinheiro agora',threshold:.7,mode:'jev',runId:'a'},
    injected({spam:{noul:.84},credential_request:{noul:.34},category:{choice:'promocional'}}));
  assert.equal(result.jev.ok,true);
  assert.equal(result.jev.raw.spam.noul,.84);
  assert.equal(result.applied,'bloquear');
  assert.equal(result.policy.threshold,.7);
  assert.equal(result.runId,'a');
});

test('resposta vazia não recebe crédito nem dispara ação', async () => {
  const result = await runLabStep({lab:'spam',message:'Oi',mode:'jev'},injected({}));
  assert.equal(result.jev.ok,false);
  assert.equal(result.applied,null);
  assert.equal(result.status,'unknown');
});

test('sinais tipados de golpe impedem permitir mesmo com noul de spam baixo', async () => {
  const result = await runLabStep({lab:'spam',message:'Envie sua senha no link',mode:'jev'},
    injected({spam:{noul:0},credential_request:{noul:1},category:{choice:'golpe'}}));
  assert.equal(result.applied,'revisar');
  assert.match(result.policy.reason,/credenciais/);
});

test('comparação roda os dois motores mas aplica somente o driver selecionado', async () => {
  const deps = injected({spam:{noul:.91},credential_request:{noul:.9},category:{choice:'golpe'}});
  deps.chat = async () => ({content:JSON.stringify({answers:{spam:.08,credential_request:.03,category:'pessoal'}})});
  const result = await runLabStep({lab:'spam',message:'Olá',mode:'compare',driver:'llm',model:'mock/fixture'},deps);
  assert.equal(result.jev.answers.spam,.91);
  assert.equal(result.llm.answers.spam,.08);
  assert.equal(result.applied,'permitir');
  assert.equal(result.driver,'llm');
});

test('evidência pouco pertinente nunca aciona publicação, mesmo com veredicto apoiada', async () => {
  const result = await runLabStep({lab:'evidence',claim:'O faturamento cresceu 40%.',
    evidence:'A equipe redesenhou o logotipo.',mode:'jev'},
    injected({verdict:{choice:'apoiada'},relevance:{noul:0}}));
  assert.equal(result.applied,'pedir_evidencia');
  assert.match(result.policy.reason,/pouco pertinente/);
});

test('Blast Garden valida versão e só aplica ação legal após escolha tipada', async () => {
  const state = createBlastGame();
  const result = await runLabStep({lab:'blast',state,expectedVersion:0,mode:'jev'},injected({action:{choice:'right'},danger:{noul:.1}}));
  assert.equal(result.stateVersion,0);
  assert.equal(result.applied,'right');
  assert.equal(result.nextState.player.x,2);
  assert.equal(state.player.x,1);
  await assert.rejects(() => runLabStep({lab:'blast',state,expectedVersion:1,mode:'code'}),/versão/);
});

test('partidas adulteradas são rejeitadas por replay, mesmo com versão coerente', async () => {
  const blast = createBlastGame(2);
  blast.collected = 3; blast.cratesDestroyed = 2;
  await assert.rejects(() => runLabStep({lab:'blast',state:blast,expectedVersion:0,mode:'code'}),/replay/);
  const chess = structuredClone(createChessGame());
  chess.fen = '8/8/8/8/8/8/8/4K2k w - - 0 1';
  await assert.rejects(() => runLabStep({lab:'chess',state:chess,expectedVersion:0,mode:'code'}),/replay/);
});

test('ação fora do schema não muda o mundo do jogo', async () => {
  const state = createBlastGame();
  const result = await runLabStep({lab:'blast',state,expectedVersion:0,mode:'jev'},injected({action:{choice:'teleport'},danger:{noul:0}}));
  assert.equal(result.jev.ok,false);
  assert.equal(result.nextState,null);
});

test('xadrez oferece somente candidatos legais e executa lance validado', async () => {
  const state = createChessGame();
  const move = getLegalMoves(state)[0].id;
  const result = await runLabStep({lab:'chess',state,expectedVersion:0,mode:'code'});
  assert.equal(result.candidates.candidates.length,8);
  assert.equal(result.candidates.totalLegal,20);
  assert.ok(getLegalMoves(state).some(item=>item.id===result.applied));
  assert.equal(result.nextState.version,1);
  assert.ok(move);
});

test('entradas de texto têm limite de tamanho e validação', async () => {
  let remoteStarted = 0;
  const deps = { ...injected({}), onRemoteStart: () => { remoteStarted++; } };
  await assert.rejects(()=>runLabStep({lab:'spam',message:'',mode:'jev'},deps),/obrigatória/);
  assert.equal(remoteStarted,0);
  await assert.rejects(()=>runLabStep({lab:'spam',message:'x'.repeat(2001),mode:'jev'},injected({})),/2.000/);
});
