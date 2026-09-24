import { pageShell } from './shared.mjs';

const CSS = `
.grid2{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:14px;align-items:start;margin-top:14px}
.board{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:420px;margin:18px auto}
.cell{aspect-ratio:1;border:1px solid var(--line);border-radius:16px;background:linear-gradient(160deg,#17262c,#101a1f);font:800 clamp(42px,9vw,64px)/1 system-ui;color:var(--text)}
.cell.x{color:#7ec8ff}.cell.o{color:var(--jev)}.cell.win{outline:3px solid var(--warn)}
.scorebar{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}.score{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:8px 18px;text-align:center;min-width:86px}.score b{display:block;font-size:22px}
.turn{text-align:center;font:700 13px ui-monospace,Consolas,monospace;color:var(--jev);min-height:22px}.mode{display:flex;align-items:center;gap:7px;font-size:12px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
`;

export function buildVelhaPage() {
  const script = `
var board=Array(9).fill(''),locked=false,stats={you:0,jev:0,draw:0},winLine=null,version=0;
var LINES=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function $(id){return document.getElementById(id);}
function winner(b){for(var i=0;i<LINES.length;i++){var l=LINES[i];if(b[l[0]]&&b[l[0]]===b[l[1]]&&b[l[1]]===b[l[2]])return{who:b[l[0]],line:l};}return b.every(function(c){return c;})?{who:'draw',line:null}:null;}
function render(){for(var i=0;i<9;i++){var cell=$('c'+i);cell.textContent=board[i];cell.className='cell '+(board[i]?board[i].toLowerCase():'')+(winLine&&winLine.includes(i)?' win':'');cell.disabled=locked||!!board[i];} $('scV').textContent=stats.you;$('scJ').textContent=stats.jev;$('scE').textContent=stats.draw;}
function log(message){var row=document.createElement('div');row.className='log-item';row.textContent=message;$('log').prepend(row);while($('log').children.length>12)$('log').lastChild.remove();}
function finish(result){locked=true;winLine=result.line;if(result.who==='X'){stats.you++;$('turn').textContent='You win!';}else if(result.who==='O'){stats.jev++;$('turn').textContent='O wins.';}else{stats.draw++;$('turn').textContent='Draw.';}render();}
async function play(i){
 if(locked||board[i])return;board[i]='X';locked=true;render();
 var outcome=winner(board);if(outcome){finish(outcome);return;}
 var request=++version,live=$('live').checked;$('turn').textContent=live?'Waiting for Jev…':'Local minimax is choosing…';
 try{
  var response=await fetch('/api/jev/games/velha/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({board:board,live:live})});
  var result=await response.json();if(request!==version)return;
  if(!response.ok)throw new Error(result.error||('HTTP '+response.status));
  if(!Number.isInteger(result.move)||result.move<0||result.move>8||board[result.move])throw new Error('Invalid move in response');
  board[result.move]='O';
  var message=(result.source==='jev'?'Live Jev':'Local minimax')+' played cell '+(result.move+1);
  var p=result.probabilities&&result.probabilities['c'+result.move];if(typeof p==='number')message+=' · selected probability '+Math.round(p*100)+'%';
  if(result.audit&&result.audit.minimax_concorda!=null)message+=' · minimax agrees: '+(result.audit.minimax_concorda?'yes':'no');
  if(result.cost_usd_estimate!=null&&result.source==='jev')message+=' · estimated cost $'+result.cost_usd_estimate.toFixed(6);
  log(message);outcome=winner(board);if(outcome){finish(outcome);return;}
  locked=false;$('turn').textContent='Your turn (X)';render();
 }catch(error){if(request!==version)return;board[i]='';locked=false;$('turn').textContent='Move failed. Try again.';log('Request failed: '+error.message);render();}
}
function reset(){version++;board=Array(9).fill('');locked=false;winLine=null;$('turn').textContent='Your turn (X)';render();}
for(var i=0;i<9;i++)$('c'+i).addEventListener('click',function(){play(Number(this.id.slice(1)));});
$('reset').addEventListener('click',reset);render();
`;
  const cells = Array.from({ length: 9 }, (_, i) => '<button class="cell" id="c' + i + '" aria-label="Cell ' + (i + 1) + '"></button>').join('');
  const body = `
<div class="grid2">
 <section class="card"><div class="scorebar"><div class="score"><span class="muted">You</span><b id="scV">0</b></div><div class="score"><span class="muted">Draws</span><b id="scE">0</b></div><div class="score"><span class="muted">O</span><b id="scJ">0</b></div></div><div class="board" id="board">${cells}</div><div class="turn" id="turn" aria-live="polite">Your turn (X)</div><div style="text-align:center;margin-top:10px"><button class="primary" id="reset">↻ New game</button></div></section>
 <aside class="card"><h2>Typed judge</h2><p class="muted">You play X. Local mode uses perfect minimax, so it cannot lose. Opt into a live Jev Choice judgment to see its selected cell probability and a minimax audit. A failed request leaves the board unchanged.</p><label class="mode"><input type="checkbox" id="live"> Use live Jev (may incur provider cost)</label><h3>Moves</h3><div class="log" id="log"></div></aside>
</div>`;
  return pageShell({ title: '❌⭕ Tic-Tac-Toe vs Jev', subtitle: 'Local perfect play by default; live typed choice is optional.', body, script, extraCss: CSS });
}
