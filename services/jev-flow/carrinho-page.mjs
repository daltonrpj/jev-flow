// Simulador visual. A API informa a origem e a telemetria de cada decisão.
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const EN_COPY = [
  ['O mesmo percurso para JEV e LLM. Cada resposta mostra origem, modelo e métricas reais.', 'The same course for JEV and LLM. Each response shows its source, model and measured metrics.'],
  ['A percepção vai à API; o código valida a resposta e dirige. Se JEV falhar, o reflexo local fica identificado.', 'Perception goes to the API; code validates the response and drives. If JEV fails, the local reflex is clearly identified.'],
  ['Mostrar respostas tipadas na pista', 'Show typed responses on the track'],
  ['Reflexo de emergência no código', 'Emergency reflex in code'],
  ['Gerar objetos no percurso', 'Generate objects on the course'],
  ['Clique na pista para adicionar:', 'Click the track to add:'],
  ['Estreitamento de pista (difícil)', 'Narrow lane course (hard)'],
  ['Nenhum modelo disponível', 'No model available'],
  ['Selecione um modelo LLM disponível.', 'Select an available LLM model.'],
  ['Resposta da API fora do contrato', 'API response violated the contract'],
  ['faixa solicitada bloqueada no estado atual', 'requested lane blocked in the current state'],
  ['desvio local: estado mudou durante a chamada', 'local dodge: state changed during the call'],
  ['freio local: sem faixa livre', 'local braking: no open lane'],
  ['retomada local após freio', 'local recovery after braking'],
  ['sem aceleração junto ao obstáculo', 'no acceleration near the obstacle'],
  ['Aguardando primeira decisão.', 'Waiting for the first decision.'],
  ['JEV · aguardando', 'JEV · waiting'],
  ['LLM · aguardando', 'LLM · waiting'],
  ['REFLEXO LOCAL', 'LOCAL REFLEX'],
  ['Segurança local: ', 'Local safety: '],
  ['Modelo propôs ', 'Model proposed '],
  ['Segurança: ', 'Safety: '],
  [' · aplicado ', ' · applied '],
  ['Estatísticas ao vivo', 'Live statistics'],
  ['Decisões recentes', 'Recent decisions'],
  ['Velocidade máxima', 'Maximum speed'],
  ['Intervalo de decisão', 'Decision interval'],
  ['Seed do percurso', 'Course seed'],
  ['Modelo LLM', 'LLM model'],
  ['Trânsito urbano', 'Urban traffic'],
  ['Objeto aleatório', 'Random object'],
  ['Mostrar sensores', 'Show sensors'],
  ['Vel. média', 'Avg. speed'],
  ['Tokens entrada', 'Input tokens'],
  ['Tokens saída', 'Output tokens'],
  ['Custo conhecido', 'Known cost'],
  ['Latência API', 'API latency'],
  ['Carro parado', 'Parked car'],
  ['Caminhão', 'Truck'],
  ['Pedestre', 'Pedestrian'],
  ['Barreira', 'Barrier'],
  ['Trânsito', 'Traffic'],
  ['Remover', 'Remove'],
  ['Reiniciar', 'Restart'],
  ['Modo', 'Mode'],
  ['Retomar', 'Resume'],
  ['Pausar', 'Pause'],
  ['Percurso', 'Course'],
  ['Aleatório', 'Random'],
  ['Densidade', 'Density'],
  ['Métrica', 'Metric'],
  ['Distância', 'Distance'],
  ['Decisões', 'Decisions'],
  ['Desvios', 'Dodges'],
  ['Colisões', 'Collisions'],
  ['Pista JEV', 'JEV track'],
  ['Pista LLM', 'LLM track'],
  ['Fluxos', 'Flows'],
  ['Quase-batidas', 'Near misses'],
  ['iniciando', 'starting'],
  ['aguardando', 'waiting'],
  ['pausado', 'paused'],
  ['ao vivo · ', 'live · '],
  ['reflexo local', 'local reflex'],
  ['pista ', 'lane '],
  ['COLISÃO', 'COLLISION'],
  ['código', 'code'],
];

function englishCopy(page) {
  return EN_COPY.reduce((html, [pt, en]) => html.replaceAll(pt, en), page)
    .replaceAll("toLocaleString('pt-BR')", "toLocaleString('en-US')");
}

export function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCarrinhoPage({ llmModels = [], locale } = {}) {
  const en = locale === 'en';
  const langQuery = en ? '?lang=en' : '';
  const modelOpts = [...new Set(llmModels.filter((model) => typeof model === 'string' && model.length < 180))]
    .slice(0, 60).map((model) => `<option value="${escapeHtml(model)}"${model === 'groq/openai/gpt-oss-20b' ? ' selected' : ''}>${escapeHtml(model)}</option>`).join('');
  const page = `<!doctype html>
<html lang="${en ? 'en' : 'pt-BR'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>JEV Self-Driving Sim · Jev Flow</title><link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>
:root{color-scheme:dark;--bg:#101a1d;--panel:#192428;--panel2:#202e32;--line:#344449;--text:#eaf2f2;--muted:#9eafb3;--jev:#7ce0a3;--llm:#80b8ff;--danger:#ff8a82;--accent:#2587ed}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,Segoe UI,system-ui,sans-serif}button,select,input{font:inherit}button{cursor:pointer}
.shell{max-width:1840px;margin:auto;padding:10px}.top{display:flex;align-items:center;gap:14px;margin:0 0 8px}.top h1{font-size:19px;margin:0;font-weight:780;letter-spacing:-.04em}.top p{color:var(--muted);font-size:11px;margin:2px 0 0}.links{margin-left:auto;white-space:nowrap}.links a{color:#94c7ff;text-decoration:none;margin-left:12px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(330px,385px);gap:12px;align-items:start}
.track{position:relative;overflow:hidden;background:#172329;border:1px solid var(--line);border-radius:12px;min-width:0}.track-head{height:34px;padding:8px 10px;background:#163127;color:var(--jev);font:700 11px ui-monospace,Consolas,monospace;letter-spacing:.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track.llm .track-head{background:#1e3443;color:var(--llm)}
.track canvas{display:block;width:100%;height:min(680px,calc(100vh - 150px))}.track-hud{position:absolute;top:46px;left:10px;background:#0b1519dd;border:1px solid #51606480;padding:9px 11px;border-radius:6px;min-width:124px;pointer-events:none}.track-hud strong{display:block;font-size:20px;line-height:1}.track-hud small{color:var(--muted);font-size:10px}.track-hud div{margin-top:3px}.track-answer{position:absolute;top:46px;right:9px;background:#0b1519e8;border:1px solid #51606480;border-radius:6px;padding:8px;width:38%;max-height:290px;overflow:auto;pointer-events:none;font:10px/1.35 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.track-answer b{color:var(--jev)}.track.llm .track-answer b{color:var(--llm)}.track-answer pre{font:inherit;white-space:pre-wrap;margin:5px 0 0;color:#c7d7d9}
.crash{position:absolute;left:0;right:0;top:48%;text-align:center;font-size:32px;font-weight:900;text-shadow:0 4px 15px #000;display:none;pointer-events:none}.track.is-crashed .crash{display:block}
.side{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;max-height:calc(100vh - 112px);overflow:auto}.side h2{font-size:19px;margin:0 0 4px;letter-spacing:-.035em}.side .intro{color:var(--muted);font-size:12px;margin:0 0 7px}.badge{display:inline-block;padding:3px 9px;border:1px solid #3c704c;border-radius:20px;background:#153222;color:var(--jev);font:700 11px ui-monospace,Consolas,monospace}
.modes,.buttons,.tools{display:flex;gap:6px;flex-wrap:wrap}.modes{margin:6px 0}.modes label{padding:5px 7px;border:1px solid var(--line);border-radius:7px;cursor:pointer;background:var(--panel2);font-size:11px}.modes input{accent-color:var(--accent)}
.buttons{margin:6px 0}.buttons button,.tools button{border:1px solid var(--line);border-radius:7px;padding:5px 8px;color:var(--text);background:var(--panel2);font-size:11px}.buttons .primary,.tools .selected{background:var(--accent);border-color:#499cf3;color:#fff}.buttons button:hover,.tools button:hover{filter:brightness(1.18)}
.field{margin:5px 0}.field>label{display:block;font-size:11px;color:#c7d4d7;margin-bottom:2px}.field select,.field input[type=number]{width:100%;background:#101b1e;border:1px solid var(--line);border-radius:6px;padding:5px;color:var(--text);font-size:11px}.field input[type=range]{width:100%;accent-color:var(--accent)}.range-line{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}.model-seed-row{display:grid;grid-template-columns:1.2fr 1fr;gap:7px}.checks{display:grid;grid-template-columns:1fr 1fr;gap:0 4px}.checks label{display:block;font-size:11px;margin:3px 0}.checks input{accent-color:var(--accent);margin-right:5px}
.section-title{font:750 11px ui-monospace,Consolas,monospace;letter-spacing:.08em;color:#adbec2;text-transform:uppercase;margin:10px 0 5px}.live-table{width:100%;border-collapse:collapse;font-size:11px}.live-table th,.live-table td{padding:4px;border-bottom:1px solid #334246;text-align:right}.live-table th:first-child,.live-table td:first-child{text-align:left;color:var(--muted)}.live-table th:nth-child(2){color:var(--jev)}.live-table th:nth-child(3){color:var(--llm)}.live-table td{font-variant-numeric:tabular-nums}.error{min-height:25px;margin:8px 0;color:#ffb0a8;font-size:11px;overflow-wrap:anywhere}.log{display:grid;gap:5px;max-height:190px;overflow:auto}.log-item{background:#122024;border:1px solid var(--line);border-radius:5px;padding:7px;font:10px ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.log-item small{color:var(--muted)}
.toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0 0;color:var(--muted);font-size:12px}.tools button{padding:6px 9px}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
body[data-mode="jev-only"] .track.llm{display:none}body[data-mode="llm-only"] .track.jev{display:none}
body[data-mode="jev-only"] .layout,body[data-mode="llm-only"] .layout{grid-template-columns:minmax(0,1fr) minmax(330px,385px)}
@media(max-width:1160px){.layout{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.side{grid-column:1/-1;max-height:none}body[data-mode="jev-only"] .layout,body[data-mode="llm-only"] .layout{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media(max-width:680px){.shell{padding:8px}.top{align-items:flex-start}.top h1{font-size:17px}.top p{display:none}.links a{margin-left:6px;font-size:11px}.layout,body[data-mode="jev-only"] .layout,body[data-mode="llm-only"] .layout{grid-template-columns:1fr}.side{grid-column:auto}.track-answer{width:43%;font-size:9px}}
</style>
</head>
<body data-mode="compare">
<main class="shell">
  <header class="top"><div><h1>🛒 JEV Self-Driving Sim</h1><p>O mesmo percurso para JEV e LLM. Cada resposta mostra origem, modelo e métricas reais.</p></div><nav class="links"><a href="/jev/labs${langQuery}">Labs</a><a href="/jev/battle${langQuery}">Arena</a><a href="/jev/flows${langQuery}">Fluxos</a></nav></header>
  <div class="layout">
    <section class="track jev" id="trackJ" aria-label="Pista JEV"><div class="track-head" id="titleJ">JEV · aguardando</div><canvas id="canvasJ" width="420" height="680"></canvas><div class="track-hud" id="hudJ"></div><div class="track-answer" id="answerJ">Aguardando primeira decisão.</div><div class="crash">CRASHED</div></section>
    <section class="track llm" id="trackL" aria-label="Pista LLM"><div class="track-head" id="titleL">LLM · aguardando</div><canvas id="canvasL" width="420" height="680"></canvas><div class="track-hud" id="hudL"></div><div class="track-answer" id="answerL">Aguardando primeira decisão.</div><div class="crash">CRASHED</div></section>
    <aside class="side">
      <h2>Jev Self-Driving Sim</h2><span class="badge" id="liveBadge">iniciando</span>
      <p class="intro">A percepção vai à API; o código valida a resposta e dirige. Se JEV falhar, o reflexo local fica identificado.</p>
      <fieldset class="modes" style="border:0;padding:0"><legend class="visually-hidden">Modo</legend>
        <label><input type="radio" name="mode" value="jev-only"> Jev only</label>
        <label><input type="radio" name="mode" value="compare" checked> Compare Jev vs LLM</label>
        <label><input type="radio" name="mode" value="llm-only"> LLM only</label>
      </fieldset>
      <div class="buttons"><button class="primary" id="reset">↻ Reiniciar (R)</button><button id="pause">Pausar</button><button id="random">＋ Objeto aleatório</button></div>
      <div class="field"><label for="course">Percurso</label><select id="course"><option value="squeeze">Estreitamento de pista (difícil)</option><option value="city">Trânsito urbano</option><option value="random">Aleatório</option></select></div>
      <div class="model-seed-row">
        <div class="field"><label for="model">Modelo LLM</label><select id="model">@@MODEL_OPTIONS@@</select></div>
        <div class="field"><label for="seed">Seed do percurso</label><input id="seed" type="number" min="0" max="4294967295" step="1" value="20260922"></div>
      </div>
      <div class="field"><div class="range-line"><label for="density">Densidade</label><output id="densityValue">1×</output></div><input id="density" type="range" min="0.5" max="2.5" step="0.25" value="1"></div>
      <div class="field"><div class="range-line"><label for="maxSpeed">Velocidade máxima</label><output id="speedValue">72 km/h</output></div><input id="maxSpeed" type="range" min="25" max="110" step="1" value="72"></div>
      <div class="field"><div class="range-line"><label for="interval">Intervalo de decisão</label><output id="intervalValue">850 ms</output></div><input id="interval" type="range" min="400" max="3000" step="50" value="850"></div>
      <div class="checks"><label><input type="checkbox" id="autoObjects" checked> Gerar objetos no percurso</label><label><input type="checkbox" id="reflex" checked> Reflexo de emergência no código</label><label><input type="checkbox" id="rays" checked> Mostrar sensores</label><label><input type="checkbox" id="answers" checked> Mostrar respostas tipadas na pista</label></div>
      <div class="section-title">Estatísticas ao vivo</div>
      <table class="live-table"><thead><tr><th>Métrica</th><th>JEV</th><th>LLM</th></tr></thead><tbody>
      <tr><td>Status</td><td id="statusJ">—</td><td id="statusL">—</td></tr>
      <tr><td>Distância</td><td id="distanceJ">0 m</td><td id="distanceL">0 m</td></tr>
      <tr><td>Vel. média</td><td id="averageJ">—</td><td id="averageL">—</td></tr>
      <tr><td>Decisões</td><td id="decisionsJ">0</td><td id="decisionsL">0</td></tr>
      <tr><td>Desvios</td><td id="dodgesJ">0</td><td id="dodgesL">0</td></tr>
      <tr><td>Quase-batidas</td><td id="nearJ">0</td><td id="nearL">0</td></tr>
      <tr><td>Colisões</td><td id="crashesJ">0</td><td id="crashesL">0</td></tr>
      <tr><td>Latência API</td><td id="latencyJ">—</td><td id="latencyL">—</td></tr>
      <tr><td>Tokens entrada</td><td id="inputJ">—</td><td id="inputL">—</td></tr>
      <tr><td>Tokens saída</td><td id="outputJ">—</td><td id="outputL">—</td></tr>
      <tr><td>Custo conhecido</td><td id="costJ">—</td><td id="costL">—</td></tr>
      </tbody></table>
      <div class="error" id="error" role="status" aria-live="polite"></div>
      <div class="section-title">Decisões recentes</div><div class="log" id="log" aria-live="polite"></div>
    </aside>
  </div>
  <div class="toolbar"><span>Clique na pista para adicionar:</span><div class="tools" id="tools">
    <button data-tool="cone">🟠 Cone</button><button data-tool="barrier" class="selected">🚧 Barreira</button><button data-tool="parked_car">🚙 Carro parado</button><button data-tool="traffic_car">🚘 Trânsito</button><button data-tool="truck">🚚 Caminhão</button><button data-tool="pedestrian">🚶 Pedestre</button><button data-tool="remove">✕ Remover</button>
  </div></div>
</main>
<script>
(function(){
'use strict';
@@PRNG@@
var W=420,H=680,ROAD_X=87,ROAD_W=246,LANE_W=82,CAR_Y=550,PX_PER_M=4;
var $=function(id){return document.getElementById(id);};
function displayReason(reason){const message=String(reason??'');return document.documentElement.lang==='en'?message.replaceAll('JEV não configurado','JEV is not configured'):message;}
var canvas={jev:$('canvasJ'),llm:$('canvasL')};
var context={jev:canvas.jev.getContext('2d'),llm:canvas.llm.getContext('2d')};
var mode='compare',paused=false,selectedTool='barrier',obstacles=[],nextId=1,courseRow=0,runId=0,lastFrame=0,elapsed=0,deltaLast=16,rand=createSeededRandom(20260922),fxRand=createSeededRandom(20260922^0x9e3779b9);
var cars={};
function newCar(){return{lane:1,renderLane:1,speed:42,dist:0,drivingMs:0,decisions:0,dodges:0,crashes:0,nearMiss:0,status:'driving',latency:null,roundTrip:null,source:'aguardando',model:null,usage:{input:0,output:0,seen:false},cost:0,costSeen:false,costPartial:false,pending:false,lastRequest:0,seenObjects:new Set(),error:null,clientSafetyOverride:null,decisionFx:null,wheelPhase:0,shake:0,crashT:0,fx:{lines:[],dust:[],smoke:[],spark:[]},skids:[]};}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function active(key){return mode==='compare'||mode===(key==='jev'?'jev-only':'llm-only');}
function text(id,value){$(id).textContent=String(value);}
function fmtCost(value){return '$'+value.toFixed(value>0&&value<.0001?8:6);}
function addObstacle(lane,distance,type){if(lane<0||lane>2||!Number.isFinite(distance))return;obstacles.push({id:nextId++,lane:lane,distance:distance,type:type});}
function addCourseRow(){
  var density=Number($('density').value),spacing=42/density,at=50+courseRow*spacing;
  var course=$('course').value;
  if(course==='squeeze'){
    var open=[1,0,1,2,1,0,1,2][courseRow%8];
    for(var lane=0;lane<3;lane++)if(lane!==open)addObstacle(lane,at,'barrier');
  }else if(course==='city'){
    var lane=(courseRow*2+1)%3;
    addObstacle(lane,at,['traffic_car','parked_car','cone','truck'][courseRow%4]);
    if(courseRow%3===2)addObstacle((lane+1)%3,at+7,'pedestrian');
  }else{
    addObstacle(Math.floor(rand()*3),at,['cone','barrier','traffic_car','truck'][courseRow%4]);
  }
  courseRow++;
}
function refillCourse(){if(!$('autoObjects').checked)return;var farthest=Math.max(cars.jev.dist,cars.llm.dist);while(50+courseRow*(42/Number($('density').value))<farthest+185)addCourseRow();}
function reset(){
  var requestedSeed=Number($('seed').value);
  if(!Number.isInteger(requestedSeed)||requestedSeed<0||requestedSeed>4294967295){requestedSeed=20260922;$('seed').value=String(requestedSeed);}
  rand=createSeededRandom(requestedSeed);
  fxRand=createSeededRandom(requestedSeed^0x9e3779b9);
  runId++;obstacles=[];nextId=1;courseRow=0;elapsed=0;lastFrame=0;paused=false;cars.jev=newCar();cars.llm=newCar();$('pause').textContent='Pausar';$('log').replaceChildren();$('error').textContent='';$('trackJ').classList.remove('is-crashed');$('trackL').classList.remove('is-crashed');$('answerJ').textContent='Aguardando primeira decisão.';$('answerL').textContent='Aguardando primeira decisão.';refillCourse();refreshUI();
}
function obstacleDistance(car,o){return o.distance-car.dist;}
function perception(car){
  var list=obstacles.map(function(o){return{lane:o.lane,distance_m:Math.round(obstacleDistance(car,o)*10)/10,type:o.type};}).filter(function(o){return o.distance_m>=-20&&o.distance_m<=90;});
  return{ego:{lane:car.lane,speed_kmh:Math.round(car.speed*10)/10,max_speed_kmh:Number($('maxSpeed').value)},obstacles:list};
}
function lookahead(p){return Math.max(42,Math.min(70,Math.round(p.ego.speed_kmh/3.6*2.5+12)));}
function laneFree(p,lane,horizon){return lane>=0&&lane<3&&!p.obstacles.some(function(o){return o.lane===lane&&o.distance_m>=-10&&o.distance_m<=(horizon||lookahead(p));});}
function escapeLane(p,horizon){
  var choices=[p.ego.lane-1,p.ego.lane+1].filter(function(lane){return laneFree(p,lane,horizon);});
  choices.sort(function(a,b){
    var nearest=function(lane){var objects=p.obstacles.filter(function(o){return o.lane===lane&&o.distance_m>=0;});return objects.length?Math.min.apply(null,objects.map(function(o){return o.distance_m;})):Infinity;};
    return nearest(b)-nearest(a)||a-b;
  });
  return choices.length?choices[0]:null;
}
function safeClientDecision(raw,car){
  var lane=['keep_lane','change_left','change_right'].includes(raw&&raw.lane_action)?raw.lane_action:'keep_lane';
  var speed=['hold','slow_down','speed_up'].includes(raw&&raw.speed_action)?raw.speed_action:'hold';
  var p=perception(car),horizon=lookahead(p),reasons=[],target=car.lane+(lane==='change_left'?-1:lane==='change_right'?1:0);
  if(lane!=='keep_lane'&&!laneFree(p,target,horizon)){lane='keep_lane';reasons.push('faixa solicitada bloqueada no estado atual');}
  var nearest=p.obstacles.filter(function(o){return o.lane===car.lane&&o.distance_m>=0;}).sort(function(a,b){return a.distance_m-b.distance_m;})[0];
  var obstacleAhead=nearest&&nearest.distance_m<=horizon;
  if(obstacleAhead&&lane==='keep_lane'){
    var escape=escapeLane(p,horizon);
    if(escape!==null){lane=escape<car.lane?'change_left':'change_right';reasons.push('desvio local: estado mudou durante a chamada');}
    else if(speed!=='slow_down'){speed='slow_down';reasons.push('freio local: sem faixa livre');}
  }
  if(car.speed<Math.min(24,Number($('maxSpeed').value))&&(lane!=='keep_lane'||!obstacleAhead)&&speed!=='speed_up'){
    speed='speed_up';reasons.push('retomada local após freio');
  }
  if(nearest&&nearest.distance_m<12&&car.speed>=24&&lane!=='keep_lane'&&speed==='speed_up'){
    speed='slow_down';reasons.push('sem aceleração junto ao obstáculo');
  }
  return{decision:{lane_action:lane,speed_action:speed},reasons:reasons};
}
function applyDecision(car,raw){
  var checked=safeClientDecision(raw,car),d=checked.decision,oldLane=car.lane;
  car.clientSafetyOverride=checked.reasons.length?checked.reasons:null;
  if(d.lane_action==='change_left')car.lane--;
  if(d.lane_action==='change_right')car.lane++;
  if(d.speed_action==='slow_down')car.speed=Math.max(0,car.speed-13);
  if(d.speed_action==='speed_up')car.speed=Math.min(Number($('maxSpeed').value),car.speed+9);
  if(car.lane!==oldLane)car.dodges++;
  car.decisionFx={t:elapsed,lane:d.lane_action,speed:d.speed_action};
  return d;
}
function fallbackLocal(car){
  return safeClientDecision({lane_action:'keep_lane',speed_action:'hold'},car).decision;
}
function emergencyReflex(car){
  if(!$('reflex').checked||car.status!=='driving')return;
  var p=perception(car),near=p.obstacles.filter(function(o){return o.lane===car.lane&&o.distance_m>=0;}).sort(function(a,b){return a.distance_m-b.distance_m;})[0];
  if(near&&near.distance_m<8){car.speed=Math.min(car.speed,Math.max(0,near.distance_m*4));if(near.distance_m<2)car.speed=0;}
}
function setAnswer(key,result,d){
  var el=$(key==='jev'?'answerJ':'answerL');el.replaceChildren();
  if(!$('answers').checked){el.hidden=true;return;}el.hidden=false;
  var heading=document.createElement('b');heading.textContent=(result.source==='jev'?'JEV':result.source==='llm'?'LLM':'REFLEXO LOCAL')+' · '+(result.model||result.backend||'código');el.appendChild(heading);
  var info=document.createElement('div');info.textContent='API '+(result.latencyMs==null?'—':result.latencyMs+' ms')+' · aplicado '+d.lane_action+' / '+d.speed_action;el.appendChild(info);
  if(result.proposedDecision){var proposal=document.createElement('div');proposal.textContent='Modelo propôs '+result.proposedDecision.lane_action+' / '+result.proposedDecision.speed_action;el.appendChild(proposal);}
  if(result.safetyOverride){var safety=document.createElement('div');safety.textContent='Segurança: '+result.safetyOverride.join('; ');safety.style.color='#ffc179';el.appendChild(safety);}
  if(result.clientSafetyOverride){var local=document.createElement('div');local.textContent='Segurança local: '+result.clientSafetyOverride.join('; ');local.style.color='#ffc179';el.appendChild(local);}
  if(result.fallbackReason){var reason=document.createElement('div');reason.textContent=displayReason(result.fallbackReason);reason.style.color='#ffafa8';el.appendChild(reason);}
  if(result.answers){var pre=document.createElement('pre');pre.textContent=JSON.stringify(result.answers,null,1);el.appendChild(pre);}
}
function logDecision(key,result,d){
  var item=document.createElement('div');item.className='log-item';
  var headline=document.createElement('strong');headline.textContent=(key==='jev'?'JEV':'LLM')+' · '+result.source+' · '+d.lane_action+' / '+d.speed_action;
  var detail=document.createElement('small');detail.textContent='\\n'+(result.model||result.backend||'código')+' · '+(result.latencyMs==null?'—':result.latencyMs+' ms')+(result.costUsd==null?'':' · '+fmtCost(result.costUsd))+(result.fallbackReason?' · '+displayReason(result.fallbackReason):'');
  item.append(headline,detail);$('log').prepend(item);while($('log').children.length>18)$('log').lastChild.remove();
}
async function decide(key){
  var car=cars[key];if(car.pending||car.status!=='driving'||!active(key)||paused)return;
  if(key==='llm'&&!$('model').value){car.error='Selecione um modelo LLM disponível.';$('error').textContent=car.error;return;}
  car.pending=true;car.lastRequest=elapsed;var generation=runId,started=performance.now();
  var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},16000);
  var path=key==='jev'?'/api/jev/decide':'/api/jev/llm-decide';
  try{
    var response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({perception:perception(car),model:key==='llm'?$('model').value:undefined}),signal:controller.signal});
    var result=await response.json();
    if(!response.ok)throw new Error(result.error||'HTTP '+response.status);
    if(generation!==runId||!active(key)||car.status!=='driving'||paused)return;
    if(!result.decision||!['jev','llm','deterministic'].includes(result.source))throw new Error('Resposta da API fora do contrato');
    var decision=applyDecision(car,result.decision);result.clientSafetyOverride=car.clientSafetyOverride;
    car.decisions++;car.latency=Number.isFinite(result.latencyMs)?result.latencyMs:null;car.roundTrip=Math.round(performance.now()-started);car.source=result.source;car.model=result.model||result.backend||null;
    if(result.usage&&Number.isInteger(result.usage.inputTokens)){car.usage.input+=result.usage.inputTokens;car.usage.seen=true;}
    if(result.usage&&Number.isInteger(result.usage.outputTokens)){car.usage.output+=result.usage.outputTokens;car.usage.seen=true;}
    if(typeof result.costUsd==='number'&&Number.isFinite(result.costUsd)){car.cost+=result.costUsd;car.costSeen=true;}else car.costPartial=true;
    car.error=result.fallbackReason||null;if(car.error)$('error').textContent=(key==='jev'?'JEV':'LLM')+': '+displayReason(car.error);
    setAnswer(key,result,decision);logDecision(key,result,decision);
    text(key==='jev'?'titleJ':'titleL',(key==='jev'?'JEV':'LLM')+' · '+(result.source==='deterministic'?'REFLEXO LOCAL':result.model||result.backend||result.source));
  }catch(error){
    if(generation!==runId||!active(key)||car.status!=='driving'||paused)return;
    var reason=String(error&&error.message||error).slice(0,180),d=applyDecision(car,fallbackLocal(car));
    car.decisions++;car.latency=Math.round(performance.now()-started);car.roundTrip=car.latency;car.source='deterministic';car.error=reason;car.costPartial=true;
    var fallback={source:'deterministic',backend:'local-code',model:null,latencyMs:car.latency,costUsd:null,fallbackReason:reason,clientSafetyOverride:car.clientSafetyOverride};
    $('error').textContent=(key==='jev'?'JEV':'LLM')+': '+displayReason(reason);setAnswer(key,fallback,d);logDecision(key,fallback,d);
  }finally{clearTimeout(timer);if(generation===runId)car.pending=false;}
}
function tick(timestamp){
  requestAnimationFrame(tick);if(!lastFrame)lastFrame=timestamp;
  var delta=Math.min(70,Math.max(0,timestamp-lastFrame));lastFrame=timestamp;deltaLast=delta;
  if(!paused){elapsed+=delta;
    for(var key of ['jev','llm']){
      var car=cars[key];if(!active(key)||car.status!=='driving')continue;
      emergencyReflex(car);car.drivingMs+=delta;car.dist+=car.speed/3.6*delta/1000;
      for(var o of obstacles){
        if(car.seenObjects.has(o.id))continue;
        var dist=obstacleDistance(car,o);
        if(dist<=0&&dist>=-4&&car.lane===o.lane){car.crashes++;car.status='crashed';car.speed=0;car.seenObjects.add(o.id);car.shake=1;car.crashT=0;
          var cx=ROAD_X+(car.renderLane+.5)*LANE_W;
          car.skids.push({x1:cx-14,y1:CAR_Y+8,x2:cx-20,y2:CAR_Y+70},{x1:cx+14,y1:CAR_Y+8,x2:cx+20,y2:CAR_Y+70});
          for(var pf=0;pf<14;pf++)car.fx.spark.push({x:cx+(fxRand()-.5)*30,y:CAR_Y+(fxRand()-.5)*24,a:.9});
          for(var sf=0;sf<8;sf++)car.fx.smoke.push({x:cx+(fxRand()-.5)*26,y:CAR_Y-4,r:6+fxRand()*10,a:.6,vy:-.2-fxRand()*.3});
          $(key==='jev'?'trackJ':'trackL').classList.add('is-crashed');}
        else if(dist<=0&&dist>=-4&&Math.abs(o.lane-car.lane)===1){car.nearMiss++;car.seenObjects.add(o.id);
          for(var nf=0;nf<6;nf++)car.fx.spark.push({x:ROAD_X+(o.lane+.5)*LANE_W+(fxRand()-.5)*18,y:CAR_Y-6+(fxRand()-.5)*14,a:.8});}
        else if(dist< -4){car.seenObjects.add(o.id);}
      }
      if(elapsed-car.lastRequest>=Number($('interval').value))decide(key);
    }
    refillCourse();
    var moving=['jev','llm'].filter(function(key){return active(key)&&cars[key].status==='driving';});
    var minDist=moving.length?Math.min.apply(null,moving.map(function(key){return cars[key].dist;})):Math.max(cars.jev.dist,cars.llm.dist);
    obstacles=obstacles.filter(function(o){return o.distance>minDist-35;});
  }
  drawScene('jev',delta);drawScene('llm',delta);refreshUI();
}
var THEME={jev:{skyA:'#0b2b2f',skyB:'#134248',far:'#0e3a3e',near:'#155055',accent:'#7ce0a3',road:'#2a3336',star:'#bff5d8',car1:'#1e9df0',car2:'#0b6fd0',label:'JEV'},llm:{skyA:'#1b1035',skyB:'#2a1848',far:'#241543',near:'#33205c',accent:'#a48bff',road:'#2e2a36',star:'#e3d4ff',car1:'#c07dff',car2:'#8447e0',label:'LLM'}};
var STARS=[];for(var si=0;si<46;si++)STARS.push({x:8+createSeededRandom(7+si)()*404,y:createSeededRandom(13+si)()*300,r:.5+createSeededRandom(29+si)()*1.3,tw:createSeededRandom(31+si)()*6.28});
function skylineBand(ctx,seed,scroll,count,minH,maxH,color,winColor){
  var r=createSeededRandom(seed),items=[],x=-30;
  for(var i=0;i<count;i++){var w=26+Math.floor(r()*40),h=minH+Math.floor(r()*(maxH-minH));items.push({x:x,w:w,h:h,win:Math.floor(r()*4)});x+=w+4+Math.floor(r()*16);}
  var span=x+30,off=-(scroll%span);
  for(var k=0;k<items.length;k++){var b=items[k];for(var pass=0;pass<2;pass++){var bx=b.x+off+pass*span;if(bx>440||bx+b.w<-20)continue;ctx.fillStyle=color;ctx.fillRect(bx,470-b.h,b.w,b.h+400);
    if(b.win>0){ctx.fillStyle=winColor;for(var wy=470-b.h+8;wy<452;wy+=13)for(var wx=bx+5;wx<bx+b.w-5;wx+=11){if(((wx*7+wy*13+b.win)|0)%5<2)ctx.fillRect(wx,wy,4,6);}}}}
}
function lampGlow(ctx,cx,y,color){ctx.save();ctx.globalAlpha=.13;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(cx,y,64,20,0,0,6.29);ctx.fill();ctx.restore();}
function drawScene(key,delta){
  var t=THEME[key],car=cars[key],scroll=car.dist*PX_PER_M,ctx=context[key];
  var laneTarget=car.lane;
  car.renderLane+=(laneTarget-car.renderLane)*Math.min(1,(delta||16)/95);
  if(Math.abs(laneTarget-car.renderLane)<.004)car.renderLane=laneTarget;
  if(car.status==='driving'&&Math.abs(laneTarget-car.renderLane)>=.12&&car.fx.dust.length<40){car.fx.dust.push({x:ROAD_X+(car.renderLane+.5)*LANE_W,y:CAR_Y+16,r:3,a:.5});}
  if(car.shake>0)car.shake=Math.max(0,car.shake-delta/480);
  if(car.status==='crashed')car.crashT+=delta;
  var shx=car.shake>0?(fxRand()-.5)*10*car.shake:0,shy=car.shake>0?(fxRand()-.5)*8*car.shake:0;
  ctx.setTransform(1,0,0,1,shx,shy);
  var sky=ctx.createLinearGradient(0,0,0,H);sky.addColorStop(0,t.skyA);sky.addColorStop(.62,t.skyB);sky.addColorStop(1,t.far);
  ctx.fillStyle=sky;ctx.fillRect(-12,-12,W+24,H+24);
  ctx.fillStyle=t.star;for(var st=0;st<STARS.length;st++){var s2=STARS[st];ctx.globalAlpha=.25+.5*Math.abs(Math.sin(s2.tw+elapsed/900));ctx.fillRect(s2.x,s2.y,s2.r,s2.r);}ctx.globalAlpha=1;
  var moonX=340,moonY=64;ctx.fillStyle='#f2ead8';ctx.beginPath();ctx.arc(moonX,moonY,17,0,6.29);ctx.fill();ctx.fillStyle=t.skyA;ctx.beginPath();ctx.arc(moonX+7,moonY-5,15,0,6.29);ctx.fill();
  ctx.globalAlpha=.35;skylineBand(ctx,101,scroll*.12,14,90,190,t.far,'rgba(255,255,255,.05)');ctx.globalAlpha=1;
  skylineBand(ctx,207,scroll*.3,12,60,130,t.near,'rgba(255,255,255,.09)');
  ctx.fillStyle='#141d20';ctx.fillRect(0,468,W,H-468);
  ctx.fillStyle='#1a2428';for(var gy=468;gy<H;gy+=26){ctx.fillRect(0,gy,W,2);}
  skylineBand(ctx,311,scroll*.62,16,26,52,'#101a1d','rgba(124,224,163,.12)');
  ctx.fillStyle=t.road;ctx.fillRect(ROAD_X,0,ROAD_W,H);
  var asph=ctx.createLinearGradient(ROAD_X,0,ROAD_X+ROAD_W,0);asph.addColorStop(0,'#20282b');asph.addColorStop(.5,'#343d41');asph.addColorStop(1,'#20282b');ctx.fillStyle=asph;ctx.fillRect(ROAD_X+2,0,ROAD_W-4,H);
  ctx.fillStyle='rgba(255,255,255,.045)';for(var ry=(-scroll)%18;ry<H;ry+=18)ctx.fillRect(ROAD_X+4,ry,ROAD_W-8,7);
  ctx.save();ctx.shadowColor=t.accent;ctx.shadowBlur=8;ctx.fillStyle='#eef7ef';ctx.fillRect(ROAD_X,0,3,H);ctx.fillRect(ROAD_X+ROAD_W-3,0,3,H);ctx.restore();
  ctx.strokeStyle='rgba(230,240,230,.55)';ctx.lineWidth=3;ctx.setLineDash([26,24]);
  for(var l=1;l<3;l++){ctx.beginPath();ctx.moveTo(ROAD_X+l*LANE_W,(-scroll)%50);ctx.lineTo(ROAD_X+l*LANE_W,H);ctx.stroke();}ctx.setLineDash([]);
  for(var m=0;m<4;m++){var ly=((-scroll*.9)%(H/2)+m*(H/2)+H)%H;
    ctx.fillStyle='#39454b';ctx.fillRect(62,ly,10,34);ctx.fillRect(348,ly,10,34);
    ctx.fillStyle=t.accent;ctx.fillRect(58,ly-4,18,5);ctx.fillRect(344,ly-4,18,5);
    lampGlow(ctx,ROAD_X+18,ly+10,t.accent);lampGlow(ctx,ROAD_X+ROAD_W-18,ly+10,t.accent);}
  ctx.strokeStyle='rgba(20,24,26,.9)';ctx.lineWidth=3;
  for(var sk=0;sk<car.skids.length;sk++){var k2=car.skids[sk];ctx.beginPath();ctx.moveTo(k2.x1,k2.y1);ctx.lineTo(k2.x2,k2.y2);ctx.stroke();}
  if(car.status==='crashed'&&car.fx.smoke.length<70&&fxRand()<.5)car.fx.smoke.push({x:ROAD_X+(car.renderLane+.5)*LANE_W+(fxRand()-.5)*24,y:CAR_Y-6,r:5+fxRand()*8,a:.55,vy:-.25-fxRand()*.3});
  if(car.status==='driving'&&car.speed>58)for(var nl=0;nl<2;nl++)if(fxRand()<.5)car.fx.lines.push({x:ROAD_X+8+fxRand()*(ROAD_W-16),y:-10,len:16+fxRand()*26,a:.3});
  for(var arr of ['lines','dust','smoke','spark']){var list=car.fx[arr];
    for(var ii=list.length-1;ii>=0;ii--){var p=list[ii];
      if(arr==='lines'){p.y+=delta*(.55+car.speed/90);p.a-=delta/420;}
      else if(arr==='dust'){p.r+=delta/36;p.a-=delta/700;p.y+=delta*.04;}
      else if(arr==='smoke'){p.y+=p.vy*delta;p.r+=delta/26;p.a-=delta/2400;}
      else{p.y-=delta*.06;p.a-=delta/380;}
      if(p.a<=0||p.y>H+20||p.y<-30)list.splice(ii,1);}}
  ctx.fillStyle='rgba(210,225,235,'+(.10)+')';
  for(var q=0;q<car.fx.lines.length;q++){var ln=car.fx.lines[q];ctx.globalAlpha=Math.max(0,ln.a);ctx.fillRect(ln.x,ln.y,2,ln.len);}
  ctx.globalAlpha=1;
  var obsNear=[];
  for(var o of obstacles){var y=CAR_Y-obstacleDistance(car,o)*PX_PER_M;if(y<-40||y>H+40)continue;drawObject(ctx,o,y,key,t);if(y>CAR_Y-30&&y<CAR_Y+70&&Math.abs(o.lane-car.renderLane)===1)obsNear.push({o:o,y:y});}
  if($('rays').checked&&car.status==='driving'){ctx.strokeStyle=key==='jev'?'#7ce0a366':'#a48bff66';ctx.lineWidth=1;
    for(var a=-1;a<=1;a++){ctx.beginPath();ctx.moveTo(ROAD_X+(car.renderLane+.5)*LANE_W,CAR_Y);ctx.lineTo(ROAD_X+(car.renderLane+.5+a)*LANE_W,CAR_Y-160);ctx.stroke();}}
  drawCar(ctx,car,key,t);
  ctx.fillStyle='rgba(200,214,224,.16)';
  for(var d2=0;d2<car.fx.dust.length;d2++){var du=car.fx.dust[d2];ctx.globalAlpha=Math.max(0,du.a);ctx.beginPath();ctx.arc(du.x,du.y,du.r,0,6.29);ctx.fill();}
  ctx.fillStyle='rgba(90,96,104,.5)';
  for(var s3=0;s3<car.fx.smoke.length;s3++){var sm=car.fx.smoke[s3];ctx.globalAlpha=Math.max(0,sm.a);ctx.beginPath();ctx.arc(sm.x,sm.y,sm.r,0,6.29);ctx.fill();}
  ctx.fillStyle=t.accent;
  for(var sp=0;sp<car.fx.spark.length;sp++){var pk=car.fx.spark[sp];ctx.globalAlpha=Math.max(0,pk.a);ctx.fillRect(pk.x,pk.y,3,3);}
  ctx.globalAlpha=1;
  if(car.decisionFx&&elapsed-car.decisionFx.t<750&&car.status==='driving'){
    var age=(elapsed-car.decisionFx.t)/750,icon=car.decisionFx.lane==='change_left'?'◀':car.decisionFx.lane==='change_right'?'▶':'●';
    ctx.save();ctx.globalAlpha=1-age;ctx.font='900 22px Inter,sans-serif';ctx.fillStyle=t.accent;ctx.shadowColor=t.accent;ctx.shadowBlur=12;
    ctx.fillText(icon,ROAD_X+(car.renderLane+.5)*LANE_W-8,CAR_Y-42-age*26);
    var sub=car.decisionFx.speed==='speed_up'?'▲▲':car.decisionFx.speed==='slow_down'?'▼':'–';
    ctx.font='700 12px Inter,sans-serif';ctx.fillText(sub,ROAD_X+(car.renderLane+.5)*LANE_W-6,CAR_Y-58-age*26);ctx.restore();}
  drawSpeedo(ctx,car,t);
  if(car.status==='crashed'){
    var pulse=.35+.2*Math.sin(car.crashT/140);
    ctx.fillStyle='rgba(172,32,30,'+pulse.toFixed(3)+')';ctx.fillRect(-12,-12,W+24,H+24);}
  ctx.setTransform(1,0,0,1,0,0);
}
function drawSpeedo(ctx,car,t){
  var cx=52,cy=H-46,r=30,maxV=Math.max(30,Number($('maxSpeed').value));
  ctx.save();ctx.fillStyle='rgba(8,14,16,.72)';ctx.beginPath();ctx.arc(cx,cy,r+8,0,6.29);ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r+8,0,6.29);ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI*.75,-Math.PI*.25);ctx.stroke();
  var frac=clamp(car.speed/maxV,0,1),ang=-Math.PI*.75+frac*Math.PI*.5;
  ctx.strokeStyle=t.accent;ctx.lineWidth=4;ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI*.75,ang);ctx.stroke();
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(ang)*(r-7),cy+Math.sin(ang)*(r-7));ctx.stroke();
  ctx.fillStyle='#fff';ctx.font='800 13px ui-monospace,Consolas,monospace';ctx.textAlign='center';ctx.fillText(Math.round(car.speed),cx,cy+5);
  ctx.fillStyle='rgba(255,255,255,.5)';ctx.font='600 7px Inter,sans-serif';ctx.fillText('KM/H',cx,cy+15);ctx.textAlign='left';ctx.restore();
}
function drawObject(ctx,o,y,key,t){
  var cx=ROAD_X+(o.lane+.5)*LANE_W;
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(cx,y+12,20,6,0,0,6.29);ctx.fill();
  if(o.type==='barrier'){ctx.fillStyle='#4a4f54';ctx.fillRect(cx-30,y+5,5,12);ctx.fillRect(cx+25,y+5,5,12);
    var bg=ctx.createLinearGradient(cx-27,y-8,cx+27,y+8);bg.addColorStop(0,'#ff6a4d');bg.addColorStop(1,'#d63c22');ctx.fillStyle=bg;ctx.beginPath();ctx.roundRect(cx-27,y-9,54,16,3);ctx.fill();
    ctx.fillStyle='#fff';for(var i=0;i<4;i++)ctx.fillRect(cx-23+i*14,y-6,8,10);
    ctx.fillStyle='#ffd76a';ctx.fillRect(cx-2,y-13,4,4);return;}
  if(o.type==='cone'){ctx.fillStyle='#e0662a';ctx.beginPath();ctx.moveTo(cx,y-16);ctx.lineTo(cx-13,y+13);ctx.lineTo(cx+13,y+13);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffd76a';ctx.beginPath();ctx.moveTo(cx,y-9);ctx.lineTo(cx-8,y+5);ctx.lineTo(cx+8,y+5);ctx.closePath();ctx.fill();
    ctx.fillStyle='#c2531f';ctx.fillRect(cx-13,y+11,26,4);return;}
  if(o.type==='pedestrian'){var ph=Math.sin(elapsed/140+(o.id||0))*3;
    ctx.fillStyle='#2b2f36';ctx.fillRect(cx-6-ph*.4,y+8,3,9);ctx.fillRect(cx+3+ph*.4,y+8,3,9);
    ctx.fillStyle='#f7ca8b';ctx.beginPath();ctx.arc(cx,y-11,6,0,6.29);ctx.fill();
    ctx.fillStyle='#3f6fd8';ctx.beginPath();ctx.roundRect(cx-6,y-4,12,15,4);ctx.fill();
    ctx.fillStyle='#f7ca8b';ctx.fillRect(cx-8+ph,y+1,3,7);ctx.fillRect(cx+5-ph,y+1,3,7);return;}
  if(o.type==='truck'){
    ctx.fillStyle='#8f98a3';ctx.beginPath();ctx.roundRect(cx-17,y-34,34,26,4);ctx.fill();
    ctx.fillStyle='#16232c';ctx.fillRect(cx-13,y-30,12,10);ctx.fillRect(cx+2,y-30,11,10);
    var tg=ctx.createLinearGradient(cx-17,y-8,cx+17,y+22);tg.addColorStop(0,'#d8a35b');tg.addColorStop(1,'#a87836');ctx.fillStyle=tg;ctx.beginPath();ctx.roundRect(cx-17,y-8,34,30,3);ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,.25)';ctx.lineWidth=1;for(var tr=y-4;tr<y+18;tr+=6){ctx.beginPath();ctx.moveTo(cx-15,tr);ctx.lineTo(cx+15,tr);ctx.stroke();}
    ctx.fillStyle='#3a3f45';ctx.fillRect(cx-15,y+16,8,6);ctx.fillRect(cx+7,y+16,8,6);
    ctx.fillStyle='#ff5a4d';ctx.fillRect(cx-16,y-6,4,3);ctx.fillRect(cx+12,y-6,4,3);return;}
  var body=o.type==='traffic_car'?'#fa7779':'#8b98ad';
  var vg=ctx.createLinearGradient(cx-16,y-18,cx+16,y+18);vg.addColorStop(0,body);vg.addColorStop(1,shade(body,-38));
  ctx.fillStyle=vg;ctx.beginPath();ctx.roundRect(cx-16,y-19,32,36,6);ctx.fill();
  ctx.fillStyle='#152731';ctx.beginPath();ctx.roundRect(cx-11,y-13,22,9,2);ctx.fill();ctx.beginPath();ctx.roundRect(cx-10,y+4,20,8,2);ctx.fill();
  ctx.fillStyle='#ff5a4d';ctx.fillRect(cx-14,y+15,5,3);ctx.fillRect(cx+9,y+15,5,3);
  ctx.fillStyle='#3a3f45';ctx.fillRect(cx-14,y+18,7,5);ctx.fillRect(cx+7,y+18,7,5);return;
}
function shade(hex,amt){var h=hex.replace('#','');var r=clamp(parseInt(h.substr(0,2),16)+amt,0,255),g2=clamp(parseInt(h.substr(2,2),16)+amt,0,255),b=clamp(parseInt(h.substr(4,2),16)+amt,0,255);return 'rgb('+r+','+g2+','+b+')';}
function drawCar(ctx,car,key,t){
  var laneX=ROAD_X+(car.renderLane+.5)*LANE_W,x=laneX-17,y=CAR_Y-24;
  var tilt=clamp((car.lane-car.renderLane)*-.18,-.2,.2);
  car.wheelPhase+=car.speed/3.6*deltaLast/110;
  ctx.fillStyle='rgba(0,0,0,.4)';ctx.beginPath();ctx.ellipse(laneX,CAR_Y+26,24,7,0,0,6.29);ctx.fill();
  ctx.save();ctx.translate(laneX,CAR_Y);ctx.rotate(tilt);ctx.translate(-laneX,-CAR_Y);
  if(car.status==='driving'){
    var cone=ctx.createLinearGradient(x,y-6,x,y-70);cone.addColorStop(0,'rgba(255,244,200,.34)');cone.addColorStop(1,'rgba(255,244,200,0)');
    ctx.fillStyle=cone;ctx.beginPath();ctx.moveTo(x+5,y+2);ctx.lineTo(x-34,y-72);ctx.lineTo(x+30,y-72);ctx.lineTo(x+29,y+2);ctx.closePath();ctx.fill();}
  ctx.fillStyle='#14181c';
  var wp=(car.wheelPhase%6.28);
  for(var corner of [[-19,-8],[15,-8],[-19,16],[15,16]]){var wx=x+corner[0],wy=y+corner[1];
    ctx.beginPath();ctx.roundRect(wx,wy,7,13,3);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.35)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(wx+3.5,wy+2);ctx.lineTo(wx+3.5+Math.cos(wp)*2,wy+2+Math.sin(wp)*2);ctx.stroke();}
  var bg2=ctx.createLinearGradient(x,y,x+34,y+50);bg2.addColorStop(0,t.car1);bg2.addColorStop(1,t.car2);
  ctx.fillStyle=bg2;ctx.beginPath();ctx.roundRect(x,y,34,49,8);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.14)';ctx.beginPath();ctx.roundRect(x+2,y+1,30,10,6);ctx.fill();
  ctx.fillStyle='#0f2b40';ctx.beginPath();ctx.roundRect(x+5,y+9,24,12,3);ctx.fill();ctx.beginPath();ctx.roundRect(x+6,y+32,22,9,3);ctx.fill();
  ctx.fillStyle='rgba(190,225,245,.55)';ctx.fillRect(x+7,y+10,9,9);ctx.fillRect(x+18,y+10,9,9);
  var braking=car.decisionFx&&elapsed-car.decisionFx.t<600&&car.decisionFx.speed==='slow_down';
  ctx.fillStyle=braking?'#ff3b2e':'#c62828';ctx.fillRect(x+4,y+46,7,3);ctx.fillRect(x+23,y+46,7,3);
  if(braking){ctx.save();ctx.shadowColor='#ff3b2e';ctx.shadowBlur=10;ctx.fillRect(x+4,y+46,7,3);ctx.fillRect(x+23,y+46,7,3);ctx.restore();}
  var boosting=car.decisionFx&&elapsed-car.decisionFx.t<600&&car.decisionFx.speed==='speed_up';
  if(boosting&&car.status==='driving'){ctx.save();ctx.fillStyle='rgba(255,170,60,.85)';
    for(var fz=0;fz<3;fz++){var fl=6+fxRand()*9;ctx.beginPath();ctx.moveTo(x+9+fz*8,y+49);ctx.lineTo(x+12+fz*8,y+49+fl);ctx.lineTo(x+15+fz*8,y+49);ctx.closePath();ctx.fill();}ctx.restore();}
  ctx.fillStyle='#f5f9ff';ctx.fillRect(x+5,y+2,8,3);ctx.fillRect(x+21,y+2,8,3);
  ctx.fillStyle=t.accent;ctx.beginPath();ctx.roundRect(x+12,y-7,10,7,2);ctx.fill();
  ctx.fillStyle='#0b1416';ctx.font='800 5px ui-monospace,Consolas,monospace';ctx.textAlign='center';ctx.fillText(t.label,x+17,y-2);ctx.textAlign='left';
  ctx.restore();
  if(car.status==='crashed'){ctx.save();ctx.translate(laneX,CAR_Y);ctx.rotate(.35);ctx.translate(-laneX,-CAR_Y);
    ctx.fillStyle='rgba(255,90,60,.5)';ctx.beginPath();ctx.arc(laneX-8,CAR_Y-30,10+Math.sin(car.crashT/90)*3,0,6.29);ctx.fill();ctx.restore();}
}
function refreshUI(){
  for(var key of ['jev','llm']){var car=cars[key],s=key==='jev'?'J':'L';
    text('status'+s,car.status==='crashed'?'crashed':paused?'paused':car.source==='deterministic'?'reflexo local':'driving');
    text('distance'+s,Math.round(car.dist)+' m');text('average'+s,car.drivingMs>0?Math.round(car.dist/(car.drivingMs/1000)*3.6)+' km/h':'—');
    text('decisions'+s,car.decisions);text('dodges'+s,car.dodges);text('crashes'+s,car.crashes);text('near'+s,car.nearMiss);
    text('latency'+s,car.latency===null?'—':car.latency+' ms');text('input'+s,car.usage.seen?car.usage.input.toLocaleString('pt-BR'):'—');text('output'+s,car.usage.seen?car.usage.output.toLocaleString('pt-BR'):'—');
    text('cost'+s,car.costSeen?fmtCost(car.cost)+(car.costPartial?'*':''):'—');
    var hud=$(key==='jev'?'hudJ':'hudL');hud.replaceChildren();
    var big=document.createElement('strong');big.textContent=Math.round(car.speed)+' km/h';
    var distance=document.createElement('div');distance.textContent=Math.round(car.dist)+' m · pista '+(car.lane+1);
    var small=document.createElement('small');small.textContent=car.status==='crashed'?'COLISÃO':car.source.toUpperCase();
    hud.append(big,distance,small);
  }
  text('liveBadge',paused?'pausado':'ao vivo · '+$('course').selectedOptions[0].text);
}
function updateControls(){
  mode=document.querySelector('input[name=mode]:checked').value;document.body.dataset.mode=mode;
  text('densityValue',Number($('density').value).toFixed(Number($('density').value)%1?2:0)+'×');
  text('speedValue',$('maxSpeed').value+' km/h');text('intervalValue',$('interval').value+' ms');
  $('answerJ').hidden=!$('answers').checked;$('answerL').hidden=!$('answers').checked;
}
function placeAtClick(event,key){
  var rect=canvas[key].getBoundingClientRect(),x=(event.clientX-rect.left)*W/rect.width,y=(event.clientY-rect.top)*H/rect.height;
  if(x<ROAD_X||x>=ROAD_X+ROAD_W)return;
  var lane=Math.floor((x-ROAD_X)/LANE_W),car=cars[key],distance=car.dist+(CAR_Y-y)/PX_PER_M;
  if(selectedTool==='remove'){
    var nearest=null,delta=7;
    for(var o of obstacles){var d=Math.abs(o.distance-distance);if(o.lane===lane&&d<delta){nearest=o;delta=d;}}
    if(nearest)obstacles=obstacles.filter(function(o){return o.id!==nearest.id;});
  }else addObstacle(lane,clamp(distance,car.dist+5,car.dist+170),selectedTool);
}
document.querySelectorAll('input[name=mode]').forEach(function(el){el.addEventListener('change',function(){updateControls();});});
['density','maxSpeed','interval','answers'].forEach(function(id){$(id).addEventListener('input',updateControls);});
$('course').addEventListener('change',reset);$('reset').addEventListener('click',reset);
$('pause').addEventListener('click',function(){paused=!paused;this.textContent=paused?'Retomar':'Pausar';});
$('random').addEventListener('click',function(){var ahead=Math.max(cars.jev.dist,cars.llm.dist);addObstacle(Math.floor(rand()*3),ahead+25+rand()*35,['barrier','cone','traffic_car','truck'][Math.floor(rand()*4)]);});
$('tools').addEventListener('click',function(event){var btn=event.target.closest('button[data-tool]');if(!btn)return;selectedTool=btn.dataset.tool;this.querySelectorAll('button').forEach(function(b){b.classList.toggle('selected',b===btn);});});
canvas.jev.addEventListener('click',function(e){placeAtClick(e,'jev');});canvas.llm.addEventListener('click',function(e){placeAtClick(e,'llm');});
document.addEventListener('keydown',function(event){if(event.target.closest('input,select,textarea'))return;if(event.key==='r'||event.key==='R')reset();if(event.code==='Space'){event.preventDefault();$('pause').click();}});
reset();updateControls();requestAnimationFrame(tick);
})();
</script>
</body></html>`.replace('@@PRNG@@', createSeededRandom.toString());
  return (en ? englishCopy(page) : page).replace('@@MODEL_OPTIONS@@',
    modelOpts || (en ? '<option value="">No model available</option>' : '<option value="">Nenhum modelo disponível</option>'));
}
