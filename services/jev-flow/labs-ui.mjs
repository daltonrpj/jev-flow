import { SPAM_FIXTURES, RESCUE_FIXTURES, EVIDENCE_FIXTURES, applyBlastAction,
  blastDanger, blastLegalActions, createBlastGame, spamPolicy } from '/jev/labs/assets/engine.mjs';
import { createChessGame, applyChessMove, getLegalMoves, getChessStatus,
  chessCandidates } from '/jev/labs/assets/chess.mjs';

const $ = id => document.getElementById(id);
const LABS = ['spam', 'blast', 'chess', 'rescue', 'evidence'];
const TITLES = {
  spam: ['Radar de spam', 'Uma probabilidade tipada vira permitir, revisar ou bloquear por uma regra ajustável.'],
  blast: ['Blast Garden', 'Jev escolhe uma ação legal a cada turno; o motor controla bombas, dano e vitória.'],
  chess: ['Xadrez de decisões', 'O motor calcula lances legais; Jev escolhe entre candidatos e o código executa.'],
  rescue: ['Central de resgate', 'Urgência e equipe são julgamentos tipados; a fila é calculada em código.'],
  evidence: ['Mesa de evidências', 'Uma alegação é confrontada com a evidência fornecida antes da ação editorial.'],
};
const PIECE_NAMES = { k:'rei', q:'dama', r:'torre', b:'bispo', n:'cavalo', p:'peão' };
const PROMOTION_NAMES = { q:'Dama', r:'Torre', b:'Bispo', n:'Cavalo' };
const PIECE_SHAPES = {
  p: '<circle cx="32" cy="18" r="8"/><path d="M27 26h10l5 18H22z"/><path d="M20 45h24v5H20z"/><path d="M17 51h30v5H17z"/>',
  r: '<path d="M17 10h7v6h5v-6h6v6h5v-6h7v13H17z"/><path d="M21 23h22l-3 25H24z"/><path d="M22 29h20M20 48h24v4H20z" fill="none"/><path d="M16 52h32v5H16z"/>',
  n: '<path d="M21 51c2-8 5-15 4-22l-6 4-4-5 10-13 10-5 6 9 3 17-8 3-5-8-4 20z"/><path d="M22 51h25v5H17v-5z"/><circle cx="35" cy="20" r="2.2" fill="currentColor" stroke="none"/><path d="M20 29l9 2M30 13l5 7" fill="none"/>',
  b: '<path d="M32 9c-6 5-12 11-12 19 0 6 5 10 12 10s12-4 12-10c0-8-6-14-12-19z"/><path d="M36 17l-9 15" fill="none"/><circle cx="32" cy="10" r="3"/><path d="M25 39h14l4 9H21z"/><path d="M17 51h30v5H17z"/>',
  q: '<circle cx="11" cy="17" r="3"/><circle cx="21" cy="11" r="3"/><circle cx="32" cy="9" r="3"/><circle cx="43" cy="11" r="3"/><circle cx="53" cy="17" r="3"/><path d="M12 21l8 24h24l8-24-12 10-8-15-8 15z"/><path d="M20 45h24v6H20z"/><path d="M17 52h30v5H17z"/>',
  k: '<path d="M29 6h6v8h7v6h-7v7h-6v-7h-7v-6h7z"/><path d="M18 29l7-5 7 6 7-6 7 5-5 18H23z"/><path d="M22 47h20v5H22z"/><path d="M17 52h30v5H17z"/>'
};
let lab = 'spam', blast = createBlastGame(), chess = createChessGame(), selectedSquare = null;
let chessFlipped = false, focusedChessSquare = 'e2';
let epoch = 0, sequence = 0, pending = false, autoLab = null, autoTimer = null, runs = 0;
let activeController = null;
let latestSpam = null;
let selectedSpamFixture = null;
let availability = null;

function stringify(value, limit = 6000) {
  if (value == null) return '—';
  const source = JSON.stringify(value, null, 2);
  return source.length > limit ? source.slice(0, limit) + '\n…' : source;
}
function setStatus(message, error = false) {
  $('globalStatus').textContent = message;
  $('globalStatus').classList.toggle('error', error);
}
function clearTrace() {
  $('traceMeta').children[0].querySelector('strong').textContent = '—';
  $('traceMeta').children[1].querySelector('strong').textContent = '—';
  $('traceState').textContent = 'Aguardando execução.';
  $('traceQuestions').textContent = '—';
  $('traceSides').replaceChildren();
  const note = document.createElement('p');
  note.className = 'hint'; note.textContent = 'Origem e métricas aparecem após a chamada.';
  $('traceSides').append(note);
  $('traceAction').textContent = '—';
  $('traceNext').textContent = '—';
}
function cancelAuto() {
  autoLab = null;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
  epoch++;
  if (activeController) { activeController.abort(); activeController = null; pending = false; }
  $('blastAuto').textContent = '▶ Auto · até 40 turnos';
  $('chessAuto').textContent = '▶ Auto · até 40 lances';
}
function setLab(next) {
  if (!LABS.includes(next)) return;
  cancelAuto();
  lab = next;
  for (const button of document.querySelectorAll('.lab-tab')) {
    button.classList.toggle('active', button.dataset.lab === lab);
  }
  for (const section of document.querySelectorAll('.lab-section')) {
    section.classList.toggle('active', section.id === 'lab-' + lab);
  }
  $('labTitle').textContent = TITLES[lab][0];
  $('labSubtitle').textContent = TITLES[lab][1];
  $('labNumber').textContent = String(LABS.indexOf(lab) + 1).padStart(2, '0');
  if (!['blast','chess'].includes(lab) && $('mode').value === 'code') $('mode').value = 'jev';
  const codeOption = $('mode').querySelector('option[value=code]');
  codeOption.disabled = !['blast','chess'].includes(lab);
  updateControls();
  clearTrace();
  latestSpam = null;
  setPolicy(null,null);
  $('rescueVerdict').textContent = 'A fila é calculada com prioridade, risco imediato e equipe.';
  $('evidenceVerdict').textContent = 'O veredicto depende apenas da evidência fornecida.';
  setStatus('');
}
function updateControls() {
  const mode = $('mode').value;
  $('driverField').hidden = mode !== 'compare';
  $('model').disabled = mode !== 'compare' && mode !== 'llm';
  $('labBadge').textContent = mode === 'code' ? 'CÓDIGO LOCAL' : mode === 'llm' ? 'LLM SELECIONADO'
    : availability?.jevConfigured === false ? 'JEV NÃO CONFIGURADO'
    : mode === 'compare' ? 'COMPARAÇÃO SELECIONADA' : 'JEV SELECIONADO';
  $('labBadge').style.color = mode === 'code' ? 'var(--gold)' : mode === 'llm' ? 'var(--violet)' : 'var(--green)';
}
function renderSampleButtons(id, fixtures, callback) {
  const container = $(id);
  container.replaceChildren();
  fixtures.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sample';
    button.textContent = item.label;
    button.addEventListener('click', () => {
      for (const other of container.children) other.classList.remove('active');
      button.classList.add('active');
      callback(item);
      clearTrace();
    });
    container.append(button);
    if (index === 0) button.click();
  });
}
function setPolicy(action, probability) {
  for (const key of ['Allow','Review','Block']) $('policy' + key).className = '';
  const map = { permitir: 'Allow', revisar: 'Review', bloquear: 'Block' };
  if (map[action]) {
    const node = $('policy' + map[action]);
    node.className = 'selected ' + ({ revisar:'review', bloquear:'block' }[action] || '');
  }
  $('spamVerdict').textContent = probability == null
    ? 'Julgamento indisponível. Nenhuma ação foi aplicada.'
    : 'Spam: ' + Math.round(probability * 100) + '% · política local: ' + String(action || 'indefinida').toUpperCase();
  if (selectedSpamFixture && $('spamMessage').value === selectedSpamFixture.text) {
    $('spamVerdict').textContent += ' · gabarito da fixture (limiar 70%): '
      + selectedSpamFixture.expected.toUpperCase();
    if (action && Number($('spamThreshold').value) === 0.7) {
      $('spamVerdict').textContent += action === selectedSpamFixture.expected ? ' · coincide' : ' · diverge';
    }
  }
}
function updateThreshold() {
  const threshold = Number($('spamThreshold').value);
  $('spamThresholdValue').textContent = Math.round(threshold * 100) + '%';
  if (latestSpam !== null) {
    const policy = spamPolicy(latestSpam.spam, threshold, latestSpam);
    setPolicy(policy.action, latestSpam.spam);
    $('traceAction').textContent = stringify({ action: policy.action, threshold, reason: policy.reason, recalculatedLocally: true });
  }
}
function renderBlast() {
  const grid = $('blastGrid');
  grid.replaceChildren();
  const danger = new Set(blastDanger(blast).map(p => p.x + ',' + p.y));
  const blasts = new Set(blast.blasts.map(p => p.x + ',' + p.y));
  const gems = new Set(blast.gems.map(p => p.x + ',' + p.y));
  const bombs = new Map(blast.bombs.map(b => [b.x + ',' + b.y, b]));
  for (let y = 0; y < blast.grid.length; y++) for (let x = 0; x < blast.grid[y].length; x++) {
    const key = x + ',' + y, tile = blast.grid[y][x];
    const cell = document.createElement('div');
    cell.className = 'tile ' + (tile === '#' ? 'wall' : tile === '+' ? 'crate' : 'floor');
    if (danger.has(key)) cell.classList.add('danger');
    if (blasts.has(key)) cell.classList.add('blast');
    if (blast.player.x === x && blast.player.y === y) { cell.classList.add('player'); cell.textContent = '◆'; }
    else if (bombs.has(key)) cell.textContent = '✹';
    else if (gems.has(key)) { cell.classList.add('gem'); cell.textContent = '✦'; }
    else if (tile === '+') cell.textContent = '▣';
    grid.append(cell);
  }
  $('blastTurn').textContent = String(blast.turn) + ' / 80';
  $('blastHearts').textContent = '♥'.repeat(blast.player.hearts) + '♡'.repeat(3 - blast.player.hearts);
  $('blastGems').textContent = blast.collected + ' / 3';
  $('blastCrates').textContent = blast.cratesDestroyed + ' / 2';
  $('blastStatus').textContent = ({playing:'JOGANDO',won:'VITÓRIA',lost:'FIM'})[blast.status];
  $('blastEvent').textContent = blast.lastEvent;
  const legal = new Set(blastLegalActions(blast));
  for (const button of document.querySelectorAll('[data-blast-action]')) {
    button.disabled = pending || !legal.has(button.dataset.blastAction);
  }
}
function localBlastAction(action) {
  if (pending) return;
  cancelAuto();
  const before = blast;
  const result = applyBlastAction(blast, action);
  if (!result.accepted) { setStatus(result.reason, true); return; }
  blast = result.state;
  renderBlast();
  renderLocalTrace('blast', before, action, blast);
}
function boardRows(fen) {
  return fen.split(' ')[0].split('/').map(rank => {
    const row = [];
    for (const c of rank) if (/\d/.test(c)) for (let i = 0; i < Number(c); i++) row.push(null);
    else row.push(c);
    return row;
  });
}
function chessPieceSvg(piece) {
  const white = piece === piece.toUpperCase();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'piece-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-linecap', 'round');
  svg.style.fill = white ? '#f9f7ed' : '#23333b';
  svg.style.stroke = white ? '#263b42' : '#dce9e5';
  svg.style.color = white ? '#263b42' : '#dce9e5';
  // Shape data is a fixed local lookup; game state never becomes SVG markup.
  svg.innerHTML = PIECE_SHAPES[piece.toLowerCase()];
  return svg;
}
function formatChessMove(id) {
  if (!id || typeof id !== 'string') return '—';
  const promotion = PROMOTION_NAMES[id[4]?.toLowerCase()];
  return id.slice(0,2) + ' → ' + id.slice(2,4) + (promotion ? ' = ' + promotion : '');
}
function chessStatusText(status) {
  const turn = status.turn === 'w' ? 'Brancas' : 'Pretas';
  if (status.status === 'checkmate') {
    return { label:'Xeque-mate', banner:'Xeque-mate · ' + (status.winner === 'w' ? 'Brancas' : 'Pretas') + ' vencem', tone:'finished' };
  }
  if (status.status === 'stalemate') return { label:'Afogamento', banner:'Empate · afogamento', tone:'finished' };
  if (status.status === 'draw') {
    const reason = { 'fifty-move':'regra dos 50 lances', threefold:'repetição tripla', 'insufficient-material':'material insuficiente' }[status.reason] || 'partida encerrada';
    return { label:'Empate', banner:'Empate · ' + reason, tone:'finished' };
  }
  if (status.inCheck) return { label:'Xeque', banner:'Xeque nas ' + turn + ' · escolha um lance legal', tone:'check' };
  return { label:'Em jogo', banner:turn + ' jogam · partida em andamento', tone:'playing' };
}
function renderChess() {
  if (!$('chessExcluded')) {
    const row = document.createElement('div'); row.className = 'stat';
    const label = document.createElement('span'); label.textContent = 'Excluídos pela redução';
    const count = document.createElement('b'); count.id = 'chessExcluded';
    row.append(label,count); $('chessCandidates').parentElement.after(row);
    const criterion = document.createElement('p'); criterion.id = 'chessCriterion'; criterion.className = 'game-note';
    $('chessHistory').after(criterion);
  }
  const status = getChessStatus(chess);
  const legal = getLegalMoves(chess);
  const rows = boardRows(chess.fen);
  const board = $('chessBoard');
  const boardHadFocus = board.contains(document.activeElement);
  if (boardHadFocus && document.activeElement.dataset.square) focusedChessSquare = document.activeElement.dataset.square;
  board.replaceChildren();
  const targets = new Map(selectedSquare ? legal.filter(m => m.from === selectedSquare).map(m => [m.to, Boolean(m.capture || m.enPassant)]) : []);
  const king = status.inCheck ? (status.turn === 'w' ? 'K' : 'k') : null;
  const lastId = chess.history.at(-1)?.id;
  const lastFrom = lastId?.slice(0,2), lastTo = lastId?.slice(2,4);
  const flipped = chessFlipped;
  board.setAttribute('aria-label', 'Tabuleiro de xadrez, ' + (flipped ? 'pretas' : 'brancas') + ' na base. ' + (status.terminal ? 'Partida encerrada.' : (status.turn === 'w' ? 'Brancas' : 'Pretas') + ' jogam.') + ' Use as setas para navegar; Enter ou Espaço para selecionar.');
  for (let visualY = 0; visualY < 8; visualY++) for (let visualX = 0; visualX < 8; visualX++) {
    const y = flipped ? 7 - visualY : visualY, x = flipped ? 7 - visualX : visualX;
    const square = 'abcdefgh'[x] + String(8 - y), piece = rows[y][x];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'square ' + ((x+y)%2 ? 'dark':'light');
    if (selectedSquare === square) button.classList.add('selected');
    if (targets.has(square)) button.classList.add('legal');
    if (targets.get(square)) button.classList.add('capture-target');
    if (king && piece === king) button.classList.add('check');
    if (square === lastFrom) button.classList.add('last-from');
    if (square === lastTo) button.classList.add('last-to');
    if (piece) button.classList.add(piece === piece.toUpperCase() ? 'white-piece' : 'black-piece');
    if (piece) button.append(chessPieceSvg(piece));
    if (visualX === 0) {
      const rank = document.createElement('span'); rank.className = 'coord-rank';
      rank.setAttribute('aria-hidden','true'); rank.textContent = String(8-y); button.append(rank);
    }
    if (visualY === 7) {
      const file = document.createElement('span'); file.className = 'coord-file';
      file.setAttribute('aria-hidden','true'); file.textContent = 'abcdefgh'[x]; button.append(file);
    }
    const feminine = piece && ['q','r'].includes(piece.toLowerCase());
    const color = piece === piece?.toUpperCase() ? (feminine ? ' branca' : ' branco') : (feminine ? ' preta' : ' preto');
    const labels = ['Casa ' + square, piece ? PIECE_NAMES[piece.toLowerCase()] + color : 'vazia'];
    if (square === lastFrom) labels.push('origem do último lance');
    if (square === lastTo) labels.push('destino do último lance');
    if (selectedSquare === square) labels.push('selecionada');
    if (targets.has(square)) labels.push(targets.get(square) ? 'captura legal' : 'destino legal');
    if (king && piece === king) labels.push('rei em xeque');
    button.title = labels.join(' · ');
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', selectedSquare === square ? 'true' : 'false');
    button.tabIndex = square === focusedChessSquare ? 0 : -1;
    button.dataset.square = square;
    button.dataset.visualIndex = String(visualY*8+visualX);
    button.addEventListener('click', () => { focusedChessSquare=square; clickChessSquare(square); });
    board.append(button);
  }
  if (boardHadFocus) board.querySelector('[data-square="' + focusedChessSquare + '"]')?.focus({preventScroll:true});
  $('chessFen').textContent = chess.fen;
  const display = chessStatusText(status);
  $('chessBanner').dataset.tone = display.tone;
  $('chessBanner').textContent = display.banner;
  $('chessTurn').textContent = status.terminal ? '—' : status.turn === 'w' ? 'Brancas' : 'Pretas';
  $('chessStatus').textContent = display.label;
  $('chessLastMove').textContent = formatChessMove(lastId);
  $('chessFlip').setAttribute('aria-pressed', String(flipped));
  $('chessFlip').setAttribute('aria-label', 'Girar tabuleiro; ' + (flipped ? 'pretas' : 'brancas') + ' na base');
  $('chessLegal').textContent = String(status.legalMoves);
  const selection = chessCandidates(chess,8);
  $('chessCandidates').textContent = String(selection.candidates.length) + ' / ' + status.legalMoves;
  $('chessExcluded').textContent = String(selection.excluded.length);
  $('chessCriterion').textContent = 'Redução em código: ' + selection.criterion
    + '. Excluídos: ' + selection.excluded.map(move => move.id).join(', ');
  const history = $('chessHistory');
  history.replaceChildren();
  if (!chess.history.length) {
    const item = document.createElement('li'); item.className = 'empty'; item.textContent = 'Aguardando o primeiro lance.'; history.append(item);
  }
  const first = Math.max(0, chess.history.length - 30);
  for (let i = first - first%2; i < chess.history.length; i += 2) {
    const item = document.createElement('li');
    const number = document.createElement('span'); number.className = 'move-no'; number.textContent = String(i/2+1) + '.';
    const white = document.createElement('span'); white.textContent = formatChessMove(chess.history[i]?.id);
    const black = document.createElement('span'); black.textContent = chess.history[i+1] ? formatChessMove(chess.history[i+1].id) : '—';
    if (!chess.history[i+1]) black.className = 'placeholder';
    item.append(number,white,black); history.append(item);
  }
  $('chessStep').disabled = status.terminal || pending;
}
function clickChessSquare(square) {
  if (pending || getChessStatus(chess).terminal) return;
  const side = $('chessSide').value;
  const turn = getChessStatus(chess).turn;
  if (side !== 'both' && side !== (turn === 'w' ? 'white' : 'black')) {
    setStatus('Vez do outro lado. Use “Escolher lance” para o motor jogar.',true);
    return;
  }
  const legal = getLegalMoves(chess);
  if (selectedSquare) {
    const options = legal.filter(m => m.from === selectedSquare && m.to === square);
    if (options.length) {
      const chosen = options.find(m => !m.promotion || m.promotion.toLowerCase() === $('chessPromotion').value) || options[0];
      const before = chess;
      chess = applyChessMove(chess, chosen.id);
      selectedSquare = null;
      cancelAuto();
      renderChess();
      $('chessEvent').textContent = 'Lance manual ' + chosen.id + ' aplicado pelo motor legal.';
      renderLocalTrace('chess', before, chosen.id, chess);
      return;
    }
  }
  selectedSquare = legal.some(m => m.from === square) ? square : null;
  renderChess();
}
function renderLocalTrace(labName, before, action, after) {
  $('traceMeta').children[0].querySelector('strong').textContent = 'manual';
  $('traceMeta').children[1].querySelector('strong').textContent = String(before.version);
  $('traceState').textContent = stringify(labName === 'blast' ? {turn:before.turn,player:before.player,grid:before.grid,bombs:before.bombs,gems:before.gems} : {fen:before.fen});
  $('traceQuestions').textContent = 'Ação manual: sem pergunta remota';
  $('traceSides').replaceChildren();
  const p = document.createElement('p'); p.className='hint'; p.textContent='Origem: pessoa / motor local. Nenhuma chamada ao Jev ou LLM.'; $('traceSides').append(p);
  $('traceAction').textContent = stringify({action,source:'manual',validated:true});
  $('traceNext').textContent = stringify(labName === 'blast' ? {turn:after.turn,player:after.player,status:after.status,event:after.lastEvent} : {fen:after.fen,status:getChessStatus(after)});
}
function buildBody(target) {
  const body = {lab:target,mode:$('mode').value,driver:$('driver').value,model:$('model').value};
  if (target === 'spam') Object.assign(body, {message:$('spamMessage').value,threshold:Number($('spamThreshold').value)});
  if (target === 'rescue') body.incident = $('rescueIncident').value;
  if (target === 'evidence') Object.assign(body, {claim:$('evidenceClaim').value,evidence:$('evidenceText').value});
  if (target === 'blast') Object.assign(body, {state:blast,expectedVersion:blast.version});
  if (target === 'chess') Object.assign(body, {state:chess,expectedVersion:chess.version});
  return body;
}
function sideNode(result, label) {
  const section = document.createElement('section');
  section.className = 'trace-side ' + result.source + (result.ok ? '' : ' error');
  const title = document.createElement('h3');
  title.textContent = label + ' · ' + (result.ok ? 'válido' : 'sem decisão');
  const info = document.createElement('p');
  const cost = result.costUsd == null ? 'custo indisponível' : '$' + Number(result.costUsd).toFixed(7) + ' (' + result.costSource + ')';
  const tokens = result.inputTokens == null ? 'tokens —' : 'tokens ' + result.inputTokens + '/' + (result.outputTokens ?? '—');
  const model = (result.model || 'modelo não informado') + (result.modelBasis === 'requested' ? ' (solicitado)'
    : result.modelBasis === 'executor' ? ' (executor)' : result.modelBasis === 'provider' ? ' (provedor)' : '');
  const backend = result.backend ? 'backend ' + result.backend : 'backend não informado';
  const route = result.requestedBackend ? 'rota solicitada ' + result.requestedBackend : null;
  info.textContent = [backend,route,model,result.latencyMs + ' ms',tokens,cost].filter(Boolean).join(' · ');
  section.append(title,info);
  const pre = document.createElement('pre');
  pre.textContent = result.error ? result.error + '\n' + stringify(result.raw,2000) : stringify(result.raw,2500);
  section.append(pre);
  const normalized = document.createElement('pre');
  normalized.textContent = 'Normalizado:\n' + stringify(result.answers,2000);
  section.append(normalized);
  return section;
}
function renderTrace(result) {
  $('traceMeta').children[0].querySelector('strong').textContent = result.runId || '—';
  $('traceMeta').children[1].querySelector('strong').textContent = result.stateVersion == null ? 'texto' : String(result.stateVersion);
  $('traceState').textContent = stringify(result.state,5000);
  $('traceQuestions').textContent = stringify(result.questions,5000);
  $('traceSides').replaceChildren();
  if (result.jev) $('traceSides').append(sideNode(result.jev,'JEV'));
  if (result.llm) $('traceSides').append(sideNode(result.llm,'LLM'));
  if (!result.jev && !result.llm) {
    const p = document.createElement('p'); p.className='hint'; p.textContent='Origem: código local · nenhuma chamada remota.'; $('traceSides').append(p);
  }
  $('traceAction').textContent = stringify({driver:result.driver,proposed:result.proposed,applied:result.applied,policy:result.policy,status:result.status});
  $('traceNext').textContent = result.nextState ? stringify(result.lab === 'blast'
    ? {turn:result.nextState.turn,player:result.nextState.player,collected:result.nextState.collected,cratesDestroyed:result.nextState.cratesDestroyed,status:result.nextState.status,event:result.nextState.lastEvent}
    : {fen:result.nextState.fen,status:getChessStatus(result.nextState)},5000)
    : result.applied ? 'Ação registrada. Este cenário não altera um mundo simulado.' : 'Estado preservado: nenhuma ação válida.';
}
async function run(target, automatic = false) {
  if (pending || lab !== target) return false;
  const before = target === 'blast' ? blast.version : target === 'chess' ? chess.version : null;
  if (automatic && before >= 40) {
    setStatus('Pausa automática após 40 turnos. Continue com um passo manual se desejar.');
    cancelAuto(); return false;
  }
  if (before != null && $('mode').value !== 'code' && before >= 40) {
    setStatus('Julgamento remoto disponível até o turno 40. Continue manualmente ou use código local.',true);
    cancelAuto(); return false;
  }
  const currentEpoch = epoch, requestId = String(epoch) + '-' + String(++sequence);
  const body = buildBody(target); body.runId = requestId;
  const controller = new AbortController(); activeController = controller;
  const textSignature = target === 'spam' ? body.message : target === 'rescue' ? body.incident
    : target === 'evidence' ? body.claim + '\u0000' + body.evidence : null;
  let appliedOk = false;
  pending = true;
  setStatus('Executando ' + (body.mode === 'code' ? 'motor local' : body.mode === 'compare' ? 'Jev e LLM' : body.mode.toUpperCase()) + '…');
  if (target === 'blast') renderBlast();
  if (target === 'chess') renderChess();
  try {
    const response = await fetch('/api/jev/labs/step',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status);
    if (currentEpoch !== epoch || lab !== target || result.runId !== requestId
        || (before != null && result.stateVersion !== before)
        || (before != null && (target === 'blast' ? blast.version : chess.version) !== before)) return false;
    const currentSignature = target === 'spam' ? $('spamMessage').value : target === 'rescue' ? $('rescueIncident').value
      : target === 'evidence' ? $('evidenceClaim').value + '\u0000' + $('evidenceText').value : null;
    if (textSignature !== currentSignature) { setStatus('Entrada alterada durante a execução; resposta antiga descartada.',true); return false; }
    if (target === 'spam' && Number($('spamThreshold').value) !== body.threshold) {
      const selected = result.driver === 'llm' ? result.llm : result.jev;
      if (selected?.ok && typeof selected.answers.spam === 'number') {
        result.policy = spamPolicy(selected.answers.spam,Number($('spamThreshold').value),selected.answers);
        result.proposed = result.policy.action;
        result.applied = result.policy.action;
        result.status = result.applied ? 'applied' : 'unknown';
        result.policy.recalculatedLocally = true;
      }
    }
    renderTrace(result);
    if (result.jev && result.llm) $('labBadge').textContent = result.jev.ok && result.llm.ok ? 'JEV + LLM RESPONDERAM' : 'RESPOSTA PARCIAL';
    else if (result.jev) $('labBadge').textContent = result.jev.ok ? 'JEV RESPONDEU' : 'JEV INDISPONÍVEL';
    else if (result.llm) $('labBadge').textContent = result.llm.ok ? 'LLM RESPONDEU' : 'LLM INDISPONÍVEL';
    runs++; $('heroRuns').textContent = String(runs);
    if (target === 'spam') {
      const selected = result.driver === 'llm' ? result.llm : result.jev;
      latestSpam = selected?.ok ? selected.answers : null;
      setPolicy(result.applied,latestSpam?.spam ?? null);
    } else if (target === 'rescue') {
      $('rescueVerdict').textContent = result.applied
        ? 'Fila: ' + result.applied.queue + ' · equipe: ' + result.applied.team : 'Julgamento incompleto; sem despacho.';
    } else if (target === 'evidence') {
      $('evidenceVerdict').textContent = result.applied ? 'Ação editorial: ' + result.applied : 'Julgamento inconclusivo; sem ação.';
    } else if (target === 'blast' && result.nextState) {
      blast = result.nextState; renderBlast();
    } else if (target === 'chess' && result.nextState) {
      chess = result.nextState; selectedSquare=null; renderChess();
      $('chessEvent').textContent = 'Lance ' + result.applied + ' aplicado pelo motor legal.';
    }
    setStatus(result.applied ? 'Decisão aplicada · origem ' + result.driver + '.' : 'Resposta sem ação válida. Estado preservado.',!result.applied);
    appliedOk = !!result.applied;
    return appliedOk;
  } catch (error) {
    if (currentEpoch === epoch) setStatus(String(error.message || error),true);
    return false;
  } finally {
    if (body.mode !== 'code') refreshBudget();
    if (activeController === controller) {
      activeController = null;
      pending = false;
      if (target === 'blast') renderBlast();
      if (target === 'chess') renderChess();
      if (automatic && autoLab === target && currentEpoch === epoch && appliedOk) {
        const active = target === 'blast' ? blast.status === 'playing' : !getChessStatus(chess).terminal;
        if (active) autoTimer = setTimeout(() => run(target,true),1150);
        else cancelAuto();
      } else if (automatic && autoLab === target && currentEpoch === epoch) cancelAuto();
    }
  }
}
function toggleAuto(target) {
  if (autoLab) { cancelAuto(); setStatus('Execução automática pausada.'); return; }
  if (pending) return;
  autoLab = target;
  $(target + 'Auto').textContent = 'Ⅱ Pausar auto';
  run(target,true);
}
async function loadModels() {
  try {
    const response = await fetch('/api/jev/battle/models');
    const providers = await response.json();
    const list = providers.flatMap(p => (p.modelos || []).map(m => ({id:m.id,label:m.nome || m.id,provider:p.nome || p.id})));
    const select = $('model'); select.replaceChildren();
    for (const model of list) {
      const option = document.createElement('option');
      option.value = model.id; option.textContent = model.label + ' (' + model.provider + ')';
      if (model.id === 'groq/openai/gpt-oss-20b') option.selected = true;
      select.append(option);
    }
    if (!list.length) { const option=document.createElement('option');option.textContent='Nenhum modelo configurado';option.value='';select.append(option); }
  } catch {
    $('model').replaceChildren();
    const option=document.createElement('option');option.textContent='Modelos indisponíveis';option.value='';$('model').append(option);
  }
}
async function loadAvailability() {
  try {
    const response = await fetch('/api/jev/labs/status');
    availability = await response.json();
  } catch { availability = { jevConfigured: null }; }
  updateControls();
  renderBudget();
}
function renderBudget() {
  const remaining = availability?.remoteUnitsRemaining;
  $('heroBudget').textContent = Number.isInteger(remaining) ? String(remaining) : '—';
}
async function refreshBudget() {
  try {
    const response = await fetch('/api/jev/labs/status');
    availability = await response.json();
    renderBudget();
  } catch {}
}

for (const button of document.querySelectorAll('.lab-tab')) button.addEventListener('click', () => setLab(button.dataset.lab));
$('mode').addEventListener('change',updateControls);
$('chessSide').addEventListener('change',()=>{
  selectedSquare = null;
  if ($('chessSide').value !== 'both') chessFlipped = $('chessSide').value === 'black';
  focusedChessSquare = chessFlipped ? 'e7' : 'e2';
  renderChess();
});
$('chessFlip').addEventListener('click',()=>{chessFlipped=!chessFlipped;renderChess();});
$('chessBoard').addEventListener('keydown',event=>{
  const button = event.target.closest('.square');
  if (!button || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') { selectedSquare=null;renderChess();return; }
  const index = Number(button.dataset.visualIndex), x = index%8, y = Math.floor(index/8);
  const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  const nx = Math.max(0,Math.min(7,x+dx)), ny = Math.max(0,Math.min(7,y+dy));
  const next = $('chessBoard').children[ny*8+nx];
  button.tabIndex=-1; next.tabIndex=0; focusedChessSquare=next.dataset.square; next.focus();
});
$('spamThreshold').addEventListener('input',updateThreshold);
$('spamMessage').addEventListener('input',()=>{latestSpam=null;selectedSpamFixture=null;setPolicy(null,null);clearTrace();});
$('rescueIncident').addEventListener('input',()=>{$('rescueVerdict').textContent='Aguardando nova triagem.';clearTrace();});
for (const id of ['evidenceClaim','evidenceText']) $(id).addEventListener('input',()=>{$('evidenceVerdict').textContent='Aguardando nova verificação.';clearTrace();});
$('spamRun').addEventListener('click',()=>run('spam'));
$('rescueRun').addEventListener('click',()=>run('rescue'));
$('evidenceRun').addEventListener('click',()=>run('evidence'));
$('blastStep').addEventListener('click',()=>run('blast'));
$('chessStep').addEventListener('click',()=>run('chess'));
$('blastAuto').addEventListener('click',()=>toggleAuto('blast'));
$('chessAuto').addEventListener('click',()=>toggleAuto('chess'));
$('blastReset').addEventListener('click',()=>{
  try {
    const next = createBlastGame(Number($('blastSeed').value));
    cancelAuto(); blast = next; renderBlast(); clearTrace(); setStatus('Novo mapa carregado.');
  } catch (error) { setStatus(String(error.message || error),true); }
});
$('chessReset').addEventListener('click',()=>{cancelAuto();chess=createChessGame();selectedSquare=null;focusedChessSquare=chessFlipped?'e7':'e2';renderChess();clearTrace();$('chessEvent').textContent='Nova partida.';setStatus('Nova partida carregada.');});
for (const button of document.querySelectorAll('[data-blast-action]')) button.addEventListener('click',()=>localBlastAction(button.dataset.blastAction));
document.addEventListener('keydown',event=>{
  if (lab !== 'blast' || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  const action = {ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',' ':'plant'}[event.key];
  if (action) { event.preventDefault(); localBlastAction(action); }
});
renderSampleButtons('spamSamples',SPAM_FIXTURES,item=>{ $('spamMessage').value=item.text;selectedSpamFixture=item;latestSpam=null;setPolicy(null,null); });
renderSampleButtons('rescueSamples',RESCUE_FIXTURES,item=>{ $('rescueIncident').value=item.text;$('rescueVerdict').textContent='Aguardando nova triagem.'; });
renderSampleButtons('evidenceSamples',EVIDENCE_FIXTURES,item=>{ $('evidenceClaim').value=item.claim;$('evidenceText').value=item.evidence;$('evidenceVerdict').textContent='Aguardando nova verificação.'; });
updateThreshold(); renderBlast(); renderChess(); setLab('spam'); loadModels(); loadAvailability();
