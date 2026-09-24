import { pageShell, serializeForInlineScript } from './shared.mjs';
import { ROSTER } from './arena.mjs';

const CSS = `
.arena{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:14px;align-items:center;margin:16px 0}
.fighter{background:var(--panel2);border:1px solid var(--line);border-radius:18px;padding:18px;text-align:center;min-width:0}
.fighter .emoji{font-size:48px}.fighter select,.fighter input{width:100%;margin-top:8px;background:#101a1f;border:1px solid var(--line);border-radius:8px;padding:8px;color:var(--text)}
.fighter.winner{border-color:var(--jev);box-shadow:0 0 28px #7ce0a336}.fighter.loser{opacity:.65}
.vs{font:900 26px system-ui}.verdict{display:grid;gap:10px}.pbar{height:16px;border-radius:9px;background:#101a1f;display:flex;overflow:hidden}
.pbar .a{background:#64dca0}.pbar .b{background:#a48bff}.pbar .draw{background:#7b8790}.meta{overflow-wrap:anywhere;color:var(--muted)}
.controls{display:flex;justify-content:center;gap:14px;align-items:center;flex-wrap:wrap}.controls label{font-size:12px}
@media(max-width:660px){.arena{grid-template-columns:1fr}.vs{text-align:center}.fighter{padding:12px}}
`;

export function buildArenaPage({ roster = ROSTER } = {}) {
  const sourceRoster = Array.isArray(roster) && roster.length ? roster : ROSTER;
  const script = `
var ROSTER=${serializeForInlineScript(sourceRoster.map(f => ({ id: f.id, nome: f.nome, emoji: f.emoji, desc: f.desc })))};
function $(id){return document.getElementById(id);}
function fill(select){ROSTER.forEach(function(f){var option=document.createElement('option');option.value=f.id;option.textContent=f.emoji+' '+f.nome;select.appendChild(option);});}
fill($('selA'));fill($('selB'));$('selB').selectedIndex=Math.min(1,ROSTER.length-1);
function selected(side){var prefix=side==='a'?'A':'B';var f=ROSTER.find(function(x){return x.id===$('sel'+prefix).value;})||ROSTER[0];return {nome:$('nome'+prefix).value.trim()||f.nome,desc:$('desc'+prefix).value.trim()||f.desc,emoji:f.emoji};}
function sync(side){var prefix=side==='a'?'A':'B';var f=ROSTER.find(function(x){return x.id===$('sel'+prefix).value;})||ROSTER[0];$('nome'+prefix).placeholder=f.nome;$('desc'+prefix).placeholder=f.desc;$('emo'+prefix).textContent=f.emoji;}
['A','B'].forEach(function(prefix){$('sel'+prefix).addEventListener('change',function(){sync(prefix.toLowerCase());});sync(prefix.toLowerCase());});
function log(message){var row=document.createElement('div');row.className='log-item';row.textContent=message;$('hist').prepend(row);while($('hist').children.length>10)$('hist').lastChild.remove();}
function safeProb(value){return typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;}
async function fight(){
 var button=$('fight');button.disabled=true;button.textContent='Judging…';$('fA').className='fighter';$('fB').className='fighter';
 try{
  var response=await fetch('/api/jev/games/arena/fight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:selected('a'),b:selected('b'),live:$('live').checked})});
  var result=await response.json();if(!response.ok)throw new Error(result.error||('HTTP '+response.status));
  var p=result.probabilidades||{};var a=safeProb(p.a),b=safeProb(p.b),draw=safeProb(p.empate),total=a+b+draw;
  $('barA').style.width=(total?a/total*100:0)+'%';$('barB').style.width=(total?b/total*100:0)+'%';$('barDraw').style.width=(total?draw/total*100:0)+'%';
  $('bar').setAttribute('aria-label','Winner probabilities: A '+Math.round(a*100)+'%, B '+Math.round(b*100)+'%, draw '+Math.round(draw*100)+'%');
  var name=result.vencedor==='a'?result.a.nome:result.vencedor==='b'?result.b.nome:'Draw';
  var source=result.source==='jev'?'Live Jev judgment':'Local fictional simulation';
  var details=[source,'Winner: '+name];
  if(result.confianca!=null)details.push('confidence '+Math.round(result.confianca*100)+'%');
  if(result.rounds!=null)details.push('round estimate '+(result.rounds+1).toFixed(1));
  if(result.disputada!=null)details.push('closeness '+Math.round(result.disputada*100)+'%');
  if(result.cost_usd_estimate!=null)details.push('estimated cost $'+result.cost_usd_estimate.toFixed(6));
  if(result.latency_ms!=null)details.push(result.latency_ms+' ms');
  $('vmeta').textContent=details.join(' · ');
  if(result.vencedor==='a'){$('fA').classList.add('winner');$('fB').classList.add('loser');}
  if(result.vencedor==='b'){$('fB').classList.add('winner');$('fA').classList.add('loser');}
  log(source+' · '+name);
 }catch(error){log('Request failed: '+error.message);$('vmeta').textContent='No verdict was recorded.';}
 button.disabled=false;button.textContent='⚔️ Fight';
}
$('fight').addEventListener('click',fight);
`;
  const body = `
<section class="card">
  <div class="arena">
    <div class="fighter" id="fA"><div class="emoji" id="emoA">🦇</div><select id="selA" aria-label="Fighter A"></select><input id="nomeA" aria-label="Custom name for fighter A" maxlength="60"><input id="descA" aria-label="Description for fighter A" maxlength="300"></div>
    <div class="vs" aria-hidden="true">VS</div>
    <div class="fighter" id="fB"><div class="emoji" id="emoB">🤖</div><select id="selB" aria-label="Fighter B"></select><input id="nomeB" aria-label="Custom name for fighter B" maxlength="60"><input id="descB" aria-label="Description for fighter B" maxlength="300"></div>
  </div>
  <div class="controls"><label><input type="checkbox" id="live"> Use live Jev (may incur provider cost)</label><button class="primary" id="fight">⚔️ Fight</button></div>
  <div class="verdict" style="margin-top:16px"><div class="pbar" id="bar" aria-label="Winner probabilities"><div class="a" id="barA" style="width:50%"></div><div class="b" id="barB" style="width:50%"></div><div class="draw" id="barDraw" style="width:0%"></div></div><p class="meta" id="vmeta" aria-live="polite">Choose two fighters, then press Fight.</p></div>
</section>
<section class="card" style="margin-top:14px"><h2>Recent matches</h2><div class="log" id="hist"></div><p class="muted">Local mode is deterministic fiction. Live mode asks Jev for a typed winner, closeness, and round estimate. No real-world outcome is implied.</p></section>`;
  return pageShell({ title: '⚔️ Combat Arena', subtitle: 'Explore a fictional matchup with local simulation or an opt-in typed judgment.', body, script, extraCss: CSS });
}
