import { pageShell, serializeForInlineScript } from './shared.mjs';
import { BUILDINGS, ACTIONS, ACTION_LABELS } from './city.mjs';

const CSS = `
.grid2{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start;margin-top:14px}
@media(max-width:980px){.grid2{grid-template-columns:1fr}}
#city{width:100%;border-radius:14px;border:1px solid var(--line);display:block}
.agent-row{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid #223036;font-size:12px}
.agent-row .bars{display:flex;gap:4px}.mini{width:28px;height:5px;border-radius:3px;background:#101a1f;overflow:hidden}.mini i{display:block;height:100%}
.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.controls label{font-size:12px}.tickinfo{font:700 11px ui-monospace,Consolas,monospace;color:var(--muted)}
`;

export function buildCityPage() {
  const script = `
var BUILDINGS=${serializeForInlineScript(BUILDINGS)};
var ACTIONS=${serializeForInlineScript(ACTIONS)};
var LABELS=${serializeForInlineScript(ACTION_LABELS)};
var agents=[],tickN=0,auto=null,busy=false,version=0,lastProsper=null;
var EMOS=['🟢','🔵','🟡','🟣','🟠','🔴','⚫'];
function $(id){return document.getElementById(id);}
function initAgents(){var names=['Ada','Linus','Grace','Alan','Dijkstra','Hopper','Turing'];agents=names.map(function(name,i){return{id:String(i),nome:name,emoji:EMOS[i],energia:55+(i*13)%31,fome:20+(i*17)%41,felicidade:50+(i*11)%31,dinheiro:25+(i*19)%41,saber:10+(i*7)%31,x:340+(i*37)%120,y:230+(i*29)%60,tx:380,ty:260,ultima:null,speed:.06+i*.005};});}
function drawCity(time){
 var canvas=$('city'),ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,day=tickN%12<8;
 var sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,day?'#2a4a5e':'#101528');sky.addColorStop(1,day?'#1b3240':'#0b1120');ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
 if(!day){ctx.fillStyle='#dfe6ff';for(var s=0;s<40;s++){ctx.globalAlpha=.3+.4*Math.abs(Math.sin(s+time/1400));ctx.fillRect((s*97)%W,(s*53)%150,2,2);}ctx.globalAlpha=1;}
 ctx.fillStyle=day?'#ffd76a':'#f2ead8';ctx.beginPath();ctx.arc(W-80,65,day?22:16,0,6.29);ctx.fill();
 ctx.fillStyle=day?'#20313a':'#16222b';ctx.fillRect(0,H-70,W,70);ctx.strokeStyle='#2c3e46';ctx.lineWidth=3;ctx.setLineDash([12,14]);ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.moveTo(W/2,0);ctx.lineTo(W/2,H);ctx.stroke();ctx.setLineDash([]);
 Object.keys(BUILDINGS).forEach(function(key){var b=BUILDINGS[key];ctx.fillStyle=day?'#24333c':'#1a262e';ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,10);ctx.fill();ctx.strokeStyle='#31454e';ctx.stroke();ctx.font='22px serif';ctx.textAlign='center';ctx.fillText(b.icone,b.x+b.w/2,b.y+30);ctx.font='700 10px system-ui';ctx.fillStyle='#9bb0b7';ctx.fillText(b.nome,b.x+b.w/2,b.y+b.h-8);});
 agents.forEach(function(a){a.x+=(a.tx-a.x)*a.speed;a.y+=(a.ty-a.y)*a.speed;ctx.font='18px serif';ctx.textAlign='center';ctx.fillText(a.emoji,a.x,a.y+5);ctx.font='700 9px system-ui';ctx.fillStyle='#d4e0e2';ctx.fillText(a.nome,a.x,a.y+18);if(a.ultima&&a.bubble>0){ctx.fillText(ACTIONS[a.ultima.acao]?.icone||'',a.x,a.y-12);a.bubble-=16;}});
 var gauge=$('gauge'),g=gauge.getContext('2d');g.fillStyle='#101a1f';g.fillRect(0,0,gauge.width,gauge.height);var p=lastProsper==null?0:Math.max(0,Math.min(1,lastProsper));g.fillStyle='#7ce0a3';g.fillRect(0,0,gauge.width*p,gauge.height);g.fillStyle='#eaf2f2';g.font='700 12px system-ui';g.fillText('Prosperity: '+(lastProsper==null?'—':Math.round(p*100)+'%'),8,18);
 requestAnimationFrame(drawCity);
}
function log(message){var row=document.createElement('div');row.className='log-item';row.textContent=message;$('events').prepend(row);while($('events').children.length>16)$('events').lastChild.remove();}
function bar(value,color,label){var wrap=document.createElement('span'),inner=document.createElement('i');wrap.className='mini';wrap.title=label;inner.style.width=Math.max(0,Math.min(100,Math.round(value)))+'%';inner.style.background=color;wrap.appendChild(inner);return wrap;}
function renderAgents(){var host=$('agents');host.replaceChildren();agents.forEach(function(a){var row=document.createElement('div'),emoji=document.createElement('span'),name=document.createElement('span'),bars=document.createElement('span');row.className='agent-row';emoji.textContent=a.emoji;name.textContent=a.nome+(a.ultima?' · '+(LABELS[a.ultima.acao]||a.ultima.acao):'');bars.className='bars';bars.append(bar(a.energia,'#7ce0a3','Energy'),bar(100-a.fome,'#fbbf24','Hunger'),bar(a.felicidade,'#7ec8ff','Happiness'),bar(a.dinheiro,'#ffd76a','Money'));row.append(emoji,name,bars);host.appendChild(row);});}
function stopAuto(){if(auto){clearInterval(auto);auto=null;}$('autoChk').checked=false;}
async function tick(){
 if(busy)return;busy=true;$('tickbtn').disabled=true;var request=++version,live=$('live').checked;
 try{
  var payload={agents:agents.map(function(a){return{id:a.id,nome:a.nome,emoji:a.emoji,energia:a.energia,fome:a.fome,felicidade:a.felicidade,dinheiro:a.dinheiro,saber:a.saber};}),tick:tickN,live:live};
  var response=await fetch('/api/jev/games/city/tick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  var result=await response.json();if(request!==version)return;if(!response.ok)throw new Error(result.error||('HTTP '+response.status));
  if(!Array.isArray(result.agents)||!Array.isArray(result.eventos)||result.agents.length!==agents.length||result.eventos.length!==agents.length)throw new Error('Invalid city response');
  if(typeof result.prosperidade!=='number'||!Number.isFinite(result.prosperidade)||result.prosperidade<0||result.prosperidade>1)throw new Error('Invalid prosperity value');
  var byId=Object.fromEntries(result.agents.map(function(a){return[a.id,a];}));
  var ids=new Set(),events=new Set();
  result.agents.forEach(function(state){if(ids.has(state.id)||!agents.some(function(a){return a.id===state.id;})||['energia','fome','felicidade','dinheiro','saber'].some(function(key){return typeof state[key]!=='number'||!Number.isFinite(state[key])||state[key]<0||state[key]>100;}))throw new Error('Invalid citizen state');ids.add(state.id);});
  result.eventos.forEach(function(event){if(events.has(event.agente)||!ids.has(event.agente)||!Object.hasOwn(ACTIONS,event.acao))throw new Error('Invalid city event');events.add(event.agente);});
  result.eventos.forEach(function(event,i){var state=byId[event.agente],agent=agents.find(function(a){return a.id===event.agente;});Object.assign(agent,{energia:state.energia,fome:state.fome,felicidade:state.felicidade,dinheiro:state.dinheiro,saber:state.saber,ultima:{acao:event.acao},bubble:1600});var b=BUILDINGS[ACTIONS[event.acao].local];agent.tx=b.x+18+(i*19+tickN*11)%(b.w-36);agent.ty=b.y+38+(i*13+tickN*7)%Math.max(1,b.h-52);log(agent.nome+' · '+LABELS[event.acao]+' @ '+b.nome);});
  tickN++;lastProsper=result.prosperidade;$('src').textContent=result.source==='jev'?'Live Jev judgment':'Local simulation';$('tickn').textContent='Tick '+tickN+(result.latencia!=null?' · '+result.latencia+' ms':'')+(result.custo!=null&&result.source==='jev'?' · estimated $'+result.custo.toFixed(6):'');renderAgents();
 }catch(error){if(request===version)log('Tick failed: '+error.message);}
 if(request===version){busy=false;$('tickbtn').disabled=false;}
}
$('tickbtn').addEventListener('click',tick);
$('autoChk').addEventListener('change',function(){if(auto){clearInterval(auto);auto=null;}if(this.checked){if($('live').checked){this.checked=false;log('Auto tick is local-only. Click Next tick for each live call.');}else auto=setInterval(tick,4000);}});
$('live').addEventListener('change',function(){if(this.checked)stopAuto();});
$('reset').addEventListener('click',function(){version++;busy=false;$('tickbtn').disabled=false;stopAuto();initAgents();tickN=0;lastProsper=null;$('src').textContent='Waiting';$('tickn').textContent='';$('events').replaceChildren();renderAgents();});
initAgents();renderAgents();requestAnimationFrame(drawCity);
`;
  const body = `
<div class="grid2">
 <section class="card"><canvas id="city" width="820" height="460" aria-label="Animated city simulation"></canvas><div class="controls"><button class="primary" id="tickbtn">▶ Next tick</button><label><input type="checkbox" id="autoChk"> Auto (local, 4 s)</label><label><input type="checkbox" id="live"> Use live Jev (may incur provider cost)</label><button id="reset">↻ New city</button><span class="tickinfo"><span class="badge" id="src">Waiting</span> <span id="tickn"></span></span></div><canvas id="gauge" width="820" height="26" style="width:100%;border-radius:8px" aria-label="Prosperity gauge"></canvas></section>
 <aside class="card"><h2>JevFlow City</h2><p class="muted">Each local tick uses a deterministic policy. A live tick sends one batch with a Choice for each citizen and a Noul prosperity judgment. Code applies the effects. Auto tick is available only in local mode.</p><h3>Citizens</h3><div id="agents"></div><h3>City log</h3><div class="log" id="events" aria-live="polite"></div></aside>
</div>`;
  return pageShell({ title: '🏙️ JevFlow City', subtitle: 'Advance a small city with local decisions or deliberate live Jev ticks.', body, script, extraCss: CSS });
}
