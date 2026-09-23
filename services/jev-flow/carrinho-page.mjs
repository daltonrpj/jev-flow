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
var mode='compare',paused=false,selectedTool='barrier',obstacles=[],nextId=1,courseRow=0,runId=0,lastFrame=0,elapsed=0,rand=createSeededRandom(20260922);
var cars={};
function newCar(){return{lane:1,speed:42,dist:0,drivingMs:0,decisions:0,dodges:0,crashes:0,status:'driving',latency:null,roundTrip:null,source:'aguardando',model:null,usage:{input:0,output:0,seen:false},cost:0,costSeen:false,costPartial:false,pending:false,lastRequest:0,seenObjects:new Set(),error:null,clientSafetyOverride:null};}
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
  var delta=Math.min(70,Math.max(0,timestamp-lastFrame));lastFrame=timestamp;
  if(!paused){elapsed+=delta;
    for(var key of ['jev','llm']){
      var car=cars[key];if(!active(key)||car.status!=='driving')continue;
      emergencyReflex(car);car.drivingMs+=delta;car.dist+=car.speed/3.6*delta/1000;
      for(var o of obstacles){
        if(car.seenObjects.has(o.id))continue;
        var dist=obstacleDistance(car,o);
        if(dist<=0&&dist>=-4&&car.lane===o.lane){car.crashes++;car.status='crashed';car.speed=0;car.seenObjects.add(o.id);$(key==='jev'?'trackJ':'trackL').classList.add('is-crashed');}
        else if(dist< -4){car.seenObjects.add(o.id);}
      }
      if(elapsed-car.lastRequest>=Number($('interval').value))decide(key);
    }
    refillCourse();
    var moving=['jev','llm'].filter(function(key){return active(key)&&cars[key].status==='driving';});
    var minDist=moving.length?Math.min.apply(null,moving.map(function(key){return cars[key].dist;})):Math.max(cars.jev.dist,cars.llm.dist);
    obstacles=obstacles.filter(function(o){return o.distance>minDist-35;});
  }
  drawScene('jev');drawScene('llm');refreshUI();
}
function building(ctx,x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);ctx.fillStyle='#b4b69a88';for(var wy=y+11;wy<y+h-5;wy+=15)for(var wx=x+9;wx<x+w-5;wx+=15)ctx.fillRect(wx,wy,5,6);}
function drawScene(key){
  var ctx=context[key],car=cars[key],scroll=car.dist*PX_PER_M;
  ctx.fillStyle=key==='jev'?'#263a31':'#3c302b';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#718086';ctx.fillRect(65,0,22,H);ctx.fillRect(333,0,22,H);
  for(var i=-1;i<6;i++){var y=((i*155+scroll*.5)%930)-155;building(ctx,8,y,48,105,key==='jev'?'#3c4654':'#584046');building(ctx,363,y+35,49,120,key==='jev'?'#504855':'#63505a');}
  ctx.fillStyle='#30373b';ctx.fillRect(ROAD_X,0,ROAD_W,H);
  ctx.fillStyle='#f4f5e3';ctx.fillRect(ROAD_X,0,2,H);ctx.fillRect(ROAD_X+ROAD_W-2,0,2,H);
  ctx.strokeStyle='#d7dbd6';ctx.lineWidth=2;ctx.setLineDash([25,22]);
  for(var l=1;l<3;l++){ctx.beginPath();ctx.moveTo(ROAD_X+l*LANE_W,(-scroll)%47);ctx.lineTo(ROAD_X+l*LANE_W,H);ctx.stroke();}ctx.setLineDash([]);
  for(var o of obstacles){var y=CAR_Y-obstacleDistance(car,o)*PX_PER_M;if(y<-40||y>H+40)continue;drawObject(ctx,o,y);}
  if($('rays').checked&&car.status==='driving'){ctx.strokeStyle=key==='jev'?'#7ce0a366':'#80b8ff66';ctx.lineWidth=1;for(var a=-1;a<=1;a++){ctx.beginPath();ctx.moveTo(ROAD_X+(car.lane+.5)*LANE_W,CAR_Y);ctx.lineTo(ROAD_X+(car.lane+.5+a)*LANE_W,CAR_Y-160);ctx.stroke();}}
  drawCar(ctx,car,key==='jev'?'#3697ff':'#a88bff');
  if(car.status==='crashed'){ctx.fillStyle='#ac201e77';ctx.fillRect(0,0,W,H);}
}
function drawObject(ctx,o,y){
  var cx=ROAD_X+(o.lane+.5)*LANE_W;
  if(o.type==='barrier'){ctx.fillStyle='#ef553f';ctx.fillRect(cx-27,y-7,54,15);ctx.fillStyle='#fff';for(var i=0;i<4;i++)ctx.fillRect(cx-23+i*14,y-5,8,11);return;}
  if(o.type==='cone'){ctx.fillStyle='#fb9147';ctx.beginPath();ctx.moveTo(cx,y-15);ctx.lineTo(cx-13,y+13);ctx.lineTo(cx+13,y+13);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(cx-7,y+1,14,4);return;}
  if(o.type==='pedestrian'){ctx.fillStyle='#f7ca8b';ctx.beginPath();ctx.arc(cx,y-10,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d0bb7d';ctx.fillRect(cx-5,y-3,10,17);return;}
  ctx.fillStyle=o.type==='truck'?'#d19b53':o.type==='traffic_car'?'#fa7779':'#818fa6';
  var h=o.type==='truck'?50:35;ctx.beginPath();ctx.roundRect(cx-15,y-h/2,30,h,5);ctx.fill();ctx.fillStyle='#1c323d';ctx.fillRect(cx-11,y-h/2+5,22,7);
}
function drawCar(ctx,car,color){
  var x=ROAD_X+(car.lane+.5)*LANE_W-17,y=CAR_Y-23;
  ctx.fillStyle='#121617';ctx.fillRect(x-3,y+6,5,14);ctx.fillRect(x+32,y+6,5,14);ctx.fillRect(x-3,y+30,5,13);ctx.fillRect(x+32,y+30,5,13);
  ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,34,48,7);ctx.fill();
  ctx.fillStyle='#14334a';ctx.fillRect(x+5,y+8,24,10);ctx.fillRect(x+6,y+31,22,8);
  ctx.fillStyle='#ecf6ff';ctx.fillRect(x+5,y+2,7,3);ctx.fillRect(x+22,y+2,7,3);
}
function refreshUI(){
  for(var key of ['jev','llm']){var car=cars[key],s=key==='jev'?'J':'L';
    text('status'+s,car.status==='crashed'?'crashed':paused?'paused':car.source==='deterministic'?'reflexo local':'driving');
    text('distance'+s,Math.round(car.dist)+' m');text('average'+s,car.drivingMs>0?Math.round(car.dist/(car.drivingMs/1000)*3.6)+' km/h':'—');
    text('decisions'+s,car.decisions);text('dodges'+s,car.dodges);text('crashes'+s,car.crashes);
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
