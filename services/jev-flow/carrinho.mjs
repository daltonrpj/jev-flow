// ============================================================================
// JEV Self-Driving Sim — o jogo do carrinho que decide com julgamentos tipados.
// Inspirado no demo do ecossistema TypeSafe: a cada ~200ms o carro envia seu
// estado de percepção para o JEV, que decide (change_left/change_right/keep +
// speed_up/slow_down/hold). O código executa a decisão. O jogo roda em um
// canvas com estrada, obstáculos, sensores e overlay de respostas.
// ============================================================================
import { JevClient, isJevConfigured, noulQ, choiceQ } from '../jev/client.mjs';

export function buildCarrinhoPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JEV Self-Driving Sim · Jev Flow</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<style>
:root{--bg:#0a0a12;--bg2:#11111e;--bdr:#1d1d2e;--bdr2:#27273a;--tx:#e4e4f1;--tx2:#7d7d96;--tx3:#5c5c72;--cyan:#22d3ee;--acc:#818cf8;--acc2:#c084fc;--ok:#4ade80;--err:#f87171;--warn:#fbbf24;--mono:'JetBrains Mono',monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,-apple-system,sans-serif;background:var(--bg);color:var(--tx);min-height:100vh;padding:14px}
.header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
h1{font-size:18px;font-weight:800}
.sub{color:var(--tx2);font-size:11px;margin-bottom:12px;line-height:1.5}
.grid{display:grid;grid-template-columns:1fr 1fr 300px;gap:12px}
@media(max-width:1100px){.grid{grid-template-columns:1fr}}
.canvas-box{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--bdr)}
canvas{display:block;width:100%}
.canvas-label{position:absolute;top:8px;left:10px;font:800 10px var(--mono);letter-spacing:.1em;padding:3px 10px;border-radius:5px;z-index:2}
.canvas-label.jev{background:rgba(34,211,238,.15);color:var(--cyan)}
.canvas-label.llm{background:rgba(192,132,252,.15);color:var(--acc2)}
.overlay{position:absolute;top:40px;right:10px;font:500 9px var(--mono);color:#ccc;background:rgba(0,0,0,.55);border-radius:6px;padding:6px 8px;max-width:180px;z-index:2;pointer-events:none}
.overlay .k{color:#888;font-size:8px}
.overlay .v{font-weight:700}
.overlay .bar-bg{display:inline-block;width:40px;height:3px;background:#333;vertical-align:middle;margin-left:4px;border-radius:2px}
.overlay .bar-fill{display:block;height:3px;border-radius:2px}
.controls{background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;padding:14px}
.controls h3{font-size:13px;margin-bottom:10px}
.ctrl-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px}
.ctrl-row label{min-width:100px;color:var(--tx2)}
.ctrl-row input[type=range]{flex:1}
.ctrl-row input[type=checkbox]{width:14px;height:14px}
.ctrl-row span{min-width:40px;font:600 10px var(--mono);color:var(--cyan)}
button{padding:8px 14px;border-radius:8px;border:1px solid var(--bdr2);background:var(--bg3);color:var(--tx);cursor:pointer;font-size:11px}
button.primary{background:var(--acc);color:#fff;border:0;font-weight:700}
button:hover{border-color:var(--cyan)}
.stats{margin-top:10px}
.stats table{width:100%;border-collapse:collapse;font-size:10.5px}
.stats td{padding:4px 6px;border-bottom:1px solid var(--bdr)}
.stats td:first-child{color:var(--tx2)}
.stats td:last-child{text-align:right;font:600 10px var(--mono)}
.jev-val{color:var(--cyan)}.llm-val{color:var(--acc2)}
.status-driving{color:var(--ok)}.status-crashed{color:var(--err)}
</style>
</head>
<body>
<div class="header">
<h1>🛒 JEV Self-Driving Sim</h1>
<a href="/jev/battle" style="margin-left:auto">← Arena</a>
</div>
<p class="sub">A cada ~200ms o carro envia seu estado de percepção para o <b>JEV</b> ou <b>LLM</b>. O JEV decide com julgamentos tipados, o código dirige. Compare os dois lados em tempo real.</p>
<div class="grid">
<div class="canvas-box">
<span class="canvas-label jev">JEV · jev-latest</span>
<div class="overlay" id="ovJev"><div class="k">aguardando…</div></div>
<canvas id="cvJev" width="400" height="600"></canvas>
</div>
<div class="canvas-box">
<span class="canvas-label llm">LLM · <span id="llmModelName">off</span></span>
<div class="overlay" id="ovLlm"><div class="k">desativado</div></div>
<canvas id="cvLlm" width="400" height="600"></canvas>
</div>
<div class="controls">
<h3>⚙️ Controles</h3>
<button class="primary" style="width:100%;margin-bottom:10px" onclick="reset()">↻ Reiniciar (R)</button>
<button style="width:100%;margin-bottom:10px" onclick="togglePause()" id="pauseBtn">⏸ Pausar</button>
<div class="ctrl-row"><label>Modo</label><select id="mode" style="flex:1"><option value="jev-only">JEV only</option><option value="compare" selected>Comparar JEV vs LLM</option></select></div>
<div class="ctrl-row"><label>LLM Model</label><input id="llmModel" style="flex:1" placeholder="groq/llama-3.1-8b" value="groq/llama-3.1-8b-instant"></div>
<div class="ctrl-row"><label>Densidade</label><input type="range" id="density" min="1" max="10" value="4"><span id="densityVal">4×</span></div>
<div class="ctrl-row"><label>Vel. máx</label><input type="range" id="maxSpeed" min="2" max="10" value="6"><span id="speedVal">6</span></div>
<div class="ctrl-row"><label>Intervalo</label><input type="range" id="decInterval" min="4" max="30" value="10"><span id="intervalVal">10f</span></div>
<div class="ctrl-row"><label><input type="checkbox" id="safetyReflex" checked> Safety reflex</label></div>
<div class="ctrl-row"><label><input type="checkbox" id="showRays" checked> Sensor rays</label></div>
<div class="stats">
<table>
<tr><td>status</td><td id="stStatus" class="jev-val">driving</td></tr>
<tr><td>distância JEV</td><td id="stDistJ" class="jev-val">0m</td></tr>
<tr><td>distância LLM</td><td id="stDistL" class="llm-val">0m</td></tr>
<tr><td>decisões JEV</td><td id="stDecJ" class="jev-val">0</td></tr>
<tr><td>latência JEV</td><td id="stLatJ">—</td></tr>
<tr><td>colisões JEV</td><td id="stColJ" class="jev-val">0</td></tr>
<tr><td>colisões LLM</td><td id="stColL" class="llm-val">0</td></tr>
</table>
</div>
</div>
</div>
<script>
// ===== GAME ENGINE =====
const cvJ=document.getElementById('cvJev'),ctxJ=cvJ.getContext('2d');
const cvL=document.getElementById('cvLlm'),ctxL=cvL.getContext('2d');
const W=400,H=600,LANES=3,LANE_W=W/LANES;
var running=true,paused=false,frame=0,seed=Math.floor(Math.random()*1e9);
var mode='compare';
var cars={
  jev:{lane:1,y:H-80,speed:4,dist:0,decisions:0,colisoes:0,status:'driving',lastDecision:0,pending:null,latency:0,color:'#22d3ee'},
  llm:{lane:1,y:H-80,speed:4,dist:0,decisions:0,colisoes:0,status:'driving',lastDecision:0,pending:null,latency:0,color:'#c084fc'}
};
var obstacles=[];
var jevClient=null;
try{jevClient=new (await import('/services/jev/client.mjs')).JevClient({timeoutMs:8000});}catch(e){}
var llmBusy=false,jevBusy=false;

function getObstaclesAhead(car){
  return obstacles.filter(o=>o.y>car.y-250&&o.y<car.y&&Math.abs(o.lane-car.lane)<=1).sort((a,b)=>b.y-a.y);
}
function getPerception(car){
  const ahead=getObstaclesAhead(car);
  const nearest=ahead[0];
  return {
    lane:car.lane,
    speed:car.speed,
    obstacles_ahead:ahead.length,
    nearest_obstacle_lane:nearest?nearest.lane:null,
    nearest_obstacle_dist:nearest?Math.round(car.y-nearest.y):null,
    nearest_obstacle_type:nearest?nearest.type:null,
    left_free:!obstacles.some(o=>o.lane===car.lane-1&&o.y>H-300&&o.y<H),
    right_free:!obstacles.some(o=>o.lane===car.lane+1&&o.y>H-300&&o.y<H)
  };
}
function buildJevQuestions(perception){
  return {
    lane_action:choiceQ('Qual ação de pista? A pistola atual tem '+perception.obstacles_ahead+' obstáculo(s) à frente. Esquerda '+(perception.left_free?'LIVRE':'BLOQUEADA')+', direita '+(perception.right_free?'LIVRE':'BLOQUEADA')+'.', {keep_lane:'manter pista atual',change_left:'mudar para esquerda',change_right:'mudar para direita'}),
    speed_action:choiceQ('Qual ação de velocidade? Velocidade atual: '+perception.speed+'.', {hold:'manter',slow_down:'reduzir',speed_up:'acelerar'}),
    hazard:noulQ('Qual o risco de colisão se mantiver o rumo (0=seguro, 1=colisão certa)?'),
    overall_safety:noulQ('Qual a segurança geral da situação (0=perigo, 1=seguro)?')
  };
}
function buildLlmPrompt(perception){
  return 'Você é o cérebro de um carro autônomo. Estado atual:\\n'+
  JSON.stringify(perception,null,1)+
  '\\n\\nResponda APENAS JSON: {"lane_action":"keep_lane|change_left|change_right","speed_action":"hold|slow_down|speed_up"}';
}
function applyAction(car,decision){
  if(decision.lane_action==='change_left'&&car.lane>0)car.lane--;
  else if(decision.lane_action==='change_right'&&car.lane<LANES-1)car.lane++;
  if(decision.speed_action==='speed_up')car.speed=Math.min(8,car.speed+1);
  else if(decision.speed_action==='slow_down')car.speed=Math.max(1,car.speed-1);
}
function reflexBrake(car,perception){
  // Safety reflex em código (determinístico, $0): se obstáculo muito perto, frear
  if(perception.nearest_obstacle_dist!=null&&perception.nearest_obstacle_dist<80){
    car.speed=Math.max(1,car.speed-1);
    return true;
  }
  return false;
}
async function jevDecide(car){
  if(jevBusy)return;
  jevBusy=true;
  const perception=getPerception(car);
  const t0=performance.now();
  try{
    if(jevClient){
      const questions=buildJevQuestions(perception);
      const res=await jevClient.ask({state:perception,questions:questions});
      car.latency=Math.round(performance.now()-t0);
      const laneA=res.answers?.lane_action?.choice||'keep_lane';
      const speedA=res.answers?.speed_action?.choice||'hold';
      const hazard=res.answers?.hazard?.noul||0;
      applyDecision(car,{lane_action:laneA,speed_action:speedA,hazard:hazard,source:'jev',confidence:res.answers?.lane_action?.confidence||0});
      showOverlay('ovJev',res.answers,car.latency);
    }else{
      // Reflexo determinístico
      const decision=deterministicDecide(perception);
      applyDecision(car,decision);
      car.latency=Math.round(performance.now()-t0);
      showOverlay('ovJev',null,car.latency,decision);
    }
  }catch(e){
    // Reflexo fallback
    const decision=deterministicDecide(perception);
    applyDecision(car,decision);
  }
  jevBusy=false;
}
async function llmDecide(car){
  if(llmBusy||mode!=='compare')return;
  llmBusy=true;
  const perception=getPerception(car);
  const t0=performance.now();
  try{
    const model=document.getElementById('llmModel').value;
    if(!model){llmBusy=false;return;}
    const prompt=buildLlmPrompt(perception);
    const port=window.location.port||8723;
    const r=await fetch('/api/jev/battle/llm-decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,model:model})});
    const d=await r.json();
    car.latency=Math.round(performance.now()-t0);
    const decision=d.decision||{lane_action:'keep_lane',speed_action:'hold'};
    applyDecision(car,decision);
    showOverlay('ovLlm',null,car.latency,decision);
  }catch(e){
    car.latency=Math.round(performance.now()-t0);
  }
  llmBusy=false;
}
function deterministicDecide(perception){
  // JEV determinístico em código ($0): reflexo baseado na percepção
  if(perception.obstacles_ahead>0&&perception.nearest_obstacle_dist!=null&&perception.nearest_obstacle_dist<150){
    if(perception.left_free)return {lane_action:'change_left',speed_action:'slow_down'};
    if(perception.right_free)return {lane_action:'change_right',speed_action:'slow_down'};
    return {lane_action:'keep_lane',speed_action:'slow_down'};
  }
  return {lane_action:'keep_lane',speed_action:'hold'};
}
function applyDecision(car,decision){
  applyAction(car,decision);
  car.decisions++;
}
function showOverlay(overlayId,answers,latency,decision){
  const el=document.getElementById(overlayId);if(!el)return;
  let html='<div class="k">'+latency+'ms</div>';
  if(answers){
    for(const [qid,a] of Object.entries(answers)){
      const val=a.choice||a.noul!=null?Math.round((a.noul||a.score||0)*100)/100:a.choice;
      const conf=a.confidence!=null?Math.round(a.confidence*100)+'%':'';
      const barVal=Math.round((a.noul??a.confidence??0)*100);
      html+='<div><span class="k">'+qid+'</span> <span class="v">'+(a.choice||a.noul!=null?Math.round((a.noul||0)*100)/100:a.score??'')+'</span>';
      if(conf)html+=' <span style="color:#666">'+conf+'</span>';
      if(barVal)html+='<div class="bar-bg"><div class="bar-fill" style="width:'+barVal+'%;background:'+(barVal>60?'#4ade80':'#fbbf24')+'"></div></div>';
      html+='</div>';
    }
  }else if(decision){
    html+='<div class="v">'+decision.lane_action+' + '+decision.speed_action+'</div>';
    html+='<div class="k" style="color:#fbbf24">⚡ reflexo código</div>';
  }
  el.innerHTML=html;
}
function drawRoad(ctx,offset){
  ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,W,H);
  // lanes
  for(let i=1;i<LANES;i++){
    const x=i*LANE_W;
    ctx.strokeStyle='#333';ctx.lineWidth=2;
    ctx.setLineDash([20,20]);
    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
    ctx.setLineDash([]);
  }
  // bordas
  ctx.strokeStyle='#555';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,H);ctx.stroke();
  ctx.beginPath();ctx.moveTo(W,0);ctx.lineTo(W,H);ctx.stroke();
}
function drawObstacles(ctx,list){
  for(const obs of list){
    const x=obs.lane*LANE_W+LANE_W/2-15;
    if(obs.type==='barrier'){
      ctx.fillStyle='#e74c3c';ctx.fillRect(x,obs.y,30,12);
      ctx.fillStyle='#fff';
      for(let i=0;i<3;i++)ctx.fillRect(x+3+i*9,obs.y+2,6,8);
    }else if(obs.type==='coin'){
      ctx.fillStyle='#f1c40f';ctx.beginPath();ctx.arc(x+15,obs.y+10,8,0,2*Math.PI);ctx.fill();
      ctx.fillStyle='#e67e22';ctx.beginPath();ctx.arc(x+15,obs.y+10,5,0,2*Math.PI);ctx.fill();
    }else{
      ctx.fillStyle='#e67e22';ctx.beginPath();
      ctx.moveTo(x+15,obs.y);ctx.lineTo(x+30,obs.y+24);ctx.lineTo(x,obs.y+24);ctx.closePath();ctx.fill();
      ctx.fillStyle='#fff';ctx.font='bold 9px sans-serif';ctx.textAlign='center';
      ctx.fillText('!',x+15,obs.y+16);
    }
  }
}
function drawCar(ctx,x,y,color){
  ctx.fillStyle=color;
  ctx.beginPath();
  ctx.roundRect(x,y,30,50,8);
  ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.3)';
  ctx.fillRect(x+4,y+4,22,12);
  ctx.fillStyle='#0a0a12';
  ctx.fillRect(x+6,y+22,7,10);ctx.fillRect(x+17,y+22,7,10);
  // sensores
  if(document.getElementById('showRays')&&document.getElementById('showRays').checked){
    ctx.strokeStyle='rgba(34,211,238,.15)';ctx.lineWidth=1;
    for(const angle of [-0.5,-0.25,0,0.25,0.5]){
      ctx.beginPath();ctx.moveTo(x+15,y);
      ctx.lineTo(x+15+Math.sin(angle)*100,y-Math.cos(angle)*100);
      ctx.stroke();
    }
  }
}
function drawGame(ctx,car){
  drawRoad(ctx);
  drawObstacles(ctx,obstacles);
  drawCar(ctx,car.lane*LANE_W+LANE_W/2-15,car.y,car.color);
}
var lastTime=0;
function loop(timestamp){
  requestAnimationFrame(loop);
  if(!running||paused)return;
  var dt=timestamp-lastTime;lastTime=timestamp;
  if(dt>100)dt=100;
  frame++;
  // spawn obstacles
  var densityVal=Number(document.getElementById('density')?.value||4);
  if(frame%Math.max(10,Math.round(60/densityVal))===0){
    var lane=Math.floor(Math.random()*LANES);
    var types=['barrier','cone','coin'];
    obstacles.push({lane:lane,y:-30,type:types[Math.floor(Math.random()*types.length)]});
  }
  // move
  for(const key of ['jev','llm']){
    var car=cars[key];
    if(car.status!=='driving')continue;
    car.y=H-80; // fixo na tela, obstáculos movem
    car.dist+=car.speed*0.5;
    for(const obs of obstacles){obs.y+=car.speed;}
    // remove obstáculos fora da tela
    obstacles=obstacles.filter(o=>o.y<H+40);
    // colisão
    for(const obs of obstacles){
      var ox=obs.lane*LANE_W+LANE_W/2-15;
      if(car.lane===obs.lane&&obs.y>H-100&&obs.y<H-30&&obs.type!=='coin'){
        car.colisoes++;car.status='crashed';car.speed=0;
        obs.y=H+40;
        break;
      }
    }
    if(car.status==='crashed'){car.speed=0;continue;}
    // decide
    car.lastDecision++;
    var interval=Number(document.getElementById('decInterval')?.value||10);
    if(car.lastDecision>=interval){
      car.lastDecision=0;
      if(key==='jev')jevDecide(car);
      else if(key==='llm'&&mode==='compare')llmDecide(car);
    }
  }
  // desenha
  drawGame(ctxJ,cars.jev);
  drawGame(ctxL,cars.llm);
  // status
  updateStats();
}
function updateStats(){
  document.getElementById('stDistJ').textContent=Math.round(cars.jev.dist)+'m';
  document.getElementById('stDistL').textContent=Math.round(cars.llm.dist)+'m';
  document.getElementById('stDecJ').textContent=cars.jev.decisions;
  document.getElementById('stLatJ').textContent=cars.jev.latency?cars.jev.latency+'ms':'—';
  document.getElementById('stColJ').textContent=cars.jev.colisoes;
  document.getElementById('stColL').textContent=cars.llm.colisoes;
  var statusEl=document.getElementById('stStatus');
  if(cars.jev.status==='crashed'){statusEl.textContent='crashed (barrier)';statusEl.className='status-crashed';}
  else{statusEl.textContent='driving';statusEl.className='status-driving';}
}
function reset(){
  running=true;paused=false;frame=0;obstacles=[];
  for(const key of ['jev','llm']){
    cars[key].lane=1;cars[key].speed=4;cars[key].dist=0;cars[key].decisions=0;
    cars[key].colisoes=0;cars[key].status='driving';cars[key].lastDecision=0;
  }
  document.getElementById('pauseBtn').textContent='⏸ Pausar';
}
function togglePause(){
  paused=!paused;
  document.getElementById('pauseBtn').textContent=paused?'▶ Retomar':'⏸ Pausar';
}
document.addEventListener('keydown',function(e){
  if(e.key==='r'||e.key==='R')reset();
  if(e.key===' '){e.preventDefault();togglePause();}
});
requestAnimationFrame(loop);
</script>
</body>
</html>`;
}
