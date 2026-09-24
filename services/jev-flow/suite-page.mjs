// ============================================================================
// Ship Test Suite — console premium (/jev/suite). Dashboard de testes de alto
// nível do ecossistema JEV: anel de score, cards por cenário, execução ao vivo
// contra o Jev real (via /api/jev/battle/test-run), veredito por caso com
// latência e custo. Sem template literal no script interno (concatenação).
// ============================================================================
function esc(v) {
  return String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const CAT_STYLE = {
  legal: { label: 'Legal', cor: '#c084fc' },
  quality: { label: 'Quality', cor: '#4ade80' },
  suporte: { label: 'Support', cor: '#38bdf8' },
  production: { label: 'Production', cor: '#fb923c' },
  docs: { label: 'Docs', cor: '#facc15' },
  cache: { label: 'Cache', cor: '#22d3ee' },
  context: { label: 'Context', cor: '#f472b6' },
  routing: { label: 'Routing', cor: '#94a3b8' },
  guardrails: { label: 'Guardrails', cor: '#f87171' },
};
const SCENARIO_COPY = {
  'clausulas-red-flag': ['Contract red flags', 'Six synthetic clauses: identify material risk and its likely severity.'],
  'slop-deteccao': ['AI slop detection', 'Five texts: separate generic filler from checkable information.'],
  'hedging-evasiva': ['Hedging detection', 'Four claims: distinguish unsupported hedging from sourced statements.'],
  'deflexao-suporte': ['Support deflection', 'Five requests: choose self-service, documentation, or human review.'],
  'bug-gemeo-rastreio': ['Duplicate bug triage', 'Four error pairs: shared cause, related issue, or independent issue.'],
  'qualidade-dado-portao': ['Data quality gate', 'Four observations: collection error or real-world event?'],
  'lacuna-docs': ['Documentation gaps', 'Four questions: does the supplied documentation answer them?'],
  'cache-decisao-semantica': ['Semantic cache', 'Four reuse decisions when the input state changes.'],
  'compactacao-contexto': ['Context compaction', 'Four block pairs: preserve what the task requires.'],
  'especificidade-entrada': ['Input specificity', 'Four requests: ready to execute or too vague?'],
  'mudanca-fase-regime': ['Phase change', 'Four metric series: regime shift or ordinary variation?'],
  'conformidade-spec': ['Spec compliance', 'Four deliverables against acceptance criteria.'],
};

export function buildSuitePage({ testes = [] } = {}) {
  const cardsData = testes.map(t => ({
    id: t.id, nome: SCENARIO_COPY[t.id]?.[0] || t.nome,
    categoria: t.categoria, descricao: SCENARIO_COPY[t.id]?.[1] || t.descricao,
    casos: (t.casos || []).length, limítrofes: (t.casos || []).filter(c => c.rotulo).length,
  }));

  const CSS = `
:root{color-scheme:dark;--bg:#07090c;--panel:#0e1519;--panel2:#131c21;--line:#22313a;--line2:#2e4250;--text:#eef6f7;--muted:#8fa6ad;--jev:#7ce0a3;--cyan:#22d3ee;--amber:#fbbf24;--red:#ff8a82}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1100px 500px at 75% -8%,#0d2a2b 0%,#07090c 55%),radial-gradient(900px 420px at -10% 110%,#101b30 0%,transparent 60%),#07090c;color:var(--text);font:14px/1.5 Inter,'Segoe UI',system-ui,sans-serif;min-height:100vh}
.shell{max-width:1280px;margin:auto;padding:22px 20px 60px}
.top{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:18px}
.top h1{font-size:26px;margin:0;letter-spacing:-.045em;background:linear-gradient(92deg,#eafff2,#9df0c1 55%,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}
.top p{margin:2px 0 0;color:var(--muted);font-size:12.5px}
.links{margin-left:auto}.links a{color:#7fc4ff;text-decoration:none;margin-left:14px;font-size:12.5px}
.hero{display:grid;grid-template-columns:210px 1fr auto;gap:18px;align-items:center;background:linear-gradient(150deg,rgba(124,224,163,.07),rgba(34,211,238,.05) 55%,rgba(0,0,0,0)),var(--panel);border:1px solid var(--line);border-radius:20px;padding:20px 22px;box-shadow:0 18px 50px #00000066}
.ring{position:relative;width:190px;height:190px}
.ring svg{transform:rotate(-90deg)}
.ring .val{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:9px}
.ring .val b{font-size:38px;font-weight:850;letter-spacing:-.03em}
.ring .val small{color:var(--muted);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}
.stat b{display:block;font-size:23px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat small{color:var(--muted);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase}
.runbtn{background:linear-gradient(135deg,#1f9d5f,#178a4e);border:0;border-radius:14px;color:#fff;font:800 15px Inter;padding:16px 26px;cursor:pointer;box-shadow:0 10px 30px #1f9d5f44;transition:transform .12s}
.runbtn:hover{transform:translateY(-2px)}.runbtn:disabled{opacity:.5;cursor:wait;transform:none}
.suite-actions{display:flex;flex-direction:column;gap:8px}
.baselinebtn{background:transparent;border:1px solid var(--line2);border-radius:10px;color:var(--text);font:700 11px Inter;padding:10px 14px;cursor:pointer}
.baselinebtn:hover{border-color:var(--jev);color:var(--jev)}.baselinebtn:disabled{opacity:.45;cursor:not-allowed}
.progress{grid-column:1/-1;display:none;align-items:center;gap:12px}
.progress.show{display:flex}
.pbar{flex:1;height:8px;background:#0a1216;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.pbar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7ce0a3,#22d3ee);transition:width .3s}
.ptxt{font:700 12px ui-monospace,Consolas,monospace;color:var(--jev);white-space:nowrap}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 12px}
.chip{border:1px solid var(--line2);background:var(--panel2);color:var(--muted);border-radius:20px;padding:6px 14px;font-size:12px;cursor:pointer;transition:all .12s}
.chip.on{color:#07120c;background:var(--jev);border-color:var(--jev);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{position:relative;background:linear-gradient(165deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:9px;overflow:hidden;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--line2);transform:translateY(-2px)}
.card .cat{position:absolute;top:14px;right:14px;font:700 9.5px ui-monospace,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;padding:3px 10px;border-radius:12px;border:1px solid}
.card h3{margin:0 46px 0 0;font-size:14.5px;letter-spacing:-.02em}
.card .desc{color:var(--muted);font-size:11.5px;line-height:1.5;min-height:34px}
.meta{display:flex;gap:14px;font:600 10.5px ui-monospace,Consolas,monospace;color:var(--muted)}
.meta b{color:#cfe3e6}
.cardbtn{align-self:flex-start;background:var(--panel);border:1px solid var(--line2);color:var(--text);border-radius:9px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;transition:all .12s}
.cardbtn:hover{border-color:var(--jev);color:var(--jev)}
.cardbtn:disabled{opacity:.45;cursor:wait}
.result{display:none;flex-direction:column;gap:8px}
.result.show{display:flex}
.scoreline{display:flex;align-items:center;gap:10px}
.scorebar{flex:1;height:7px;border-radius:5px;background:#0a1216;border:1px solid var(--line);overflow:hidden}
.scorebar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#7ce0a3);transition:width .5s}
.scorenum{font:800 15px Inter;min-width:52px;text-align:right;font-variant-numeric:tabular-nums}
.dots{display:flex;gap:5px;flex-wrap:wrap}
.dot{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font:800 11px Inter;border:1px solid}
.dot.ok{color:#0a2417;background:var(--jev);border-color:#2f7a52}
.dot.half{color:#332005;background:var(--amber);border-color:#8a6a1c}
.dot.bad{color:#3a0f0c;background:var(--red);border-color:#8a3a34}
.rmeta{font:600 10.5px ui-monospace,Consolas,monospace;color:var(--muted)}
.catsum{margin-top:22px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.catsum h4{margin:0 0 10px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.catrow{display:grid;grid-template-columns:110px 1fr 52px;gap:10px;align-items:center;margin:7px 0;font-size:12px}
.catrow .cb{height:7px;border-radius:5px;background:#0a1216;border:1px solid var(--line);overflow:hidden}
.catrow .cb i{display:block;height:100%;transition:width .4s}
.empty{color:var(--muted);font-size:12px;padding:30px;text-align:center}
@media(max-width:900px){.hero{grid-template-columns:1fr;text-align:center}.ring{margin:auto}.stats{grid-template-columns:repeat(2,1fr)}}
`;

  const cards = cardsData.map(t => {
    const st = CAT_STYLE[t.categoria] || { label: t.categoria, cor: '#94a3b8' };
    return '<article class="card" data-cat="' + esc(t.categoria) + '" id="card-' + esc(t.id) + '">' +
      '<span class="cat" style="color:' + st.cor + ';border-color:' + st.cor + '55;background:' + st.cor + '14">' + esc(st.label) + '</span>' +
      '<h3>' + esc(t.nome) + '</h3>' +
      '<p class="desc">' + esc(t.descricao) + '</p>' +
      '<div class="meta"><span>cases <b>' + t.casos + '</b></span><span>edge cases <b>' + t.limítrofes + '</b></span><span>source <b>pending</b></span></div>' +
      '<button class="cardbtn" data-id="' + esc(t.id) + '">▶ Run live</button>' +
      '<div class="result" id="res-' + esc(t.id) + '"></div>' +
      '</article>';
  }).join('\n');

  const script = `
var TESTES=${JSON.stringify(cardsData)};
var CAT_COR=${JSON.stringify(Object.fromEntries(Object.entries(CAT_STYLE).map(([k, v]) => [k, v.cor])))};
var $=function(id){return document.getElementById(id);};
function fmtCost(v){return typeof v==='number'&&Number.isFinite(v)?'$'+v.toFixed(6):'—';}
function dot(score){return score>=1?'ok':score>=0.5?'half':'bad';}
function renderCard(t,r){
  var host=$('res-'+t.id);host.classList.add('show');
  var pct=r.total?Math.round(r.acertos/r.total*100):0;
  var answers=r.respostas||[];
  var dots=answers.map(function(c){return '<span class="dot '+dot(c.score)+'" title="score '+c.score+'">'+(c.score>=1?'✔':c.score>=0.5?'◐':'✖')+'</span>';}).join('');
  var lat=answers.length?Math.round(answers.reduce(function(s,c){return s+(c.latencyMs||0);},0)/answers.length):null;
  host.innerHTML='<div class="scoreline"><div class="scorebar"><i style="width:'+pct+'%"></i></div><span class="scorenum">'+r.acertos+'/'+r.total+'</span></div>'+
    '<div class="dots">'+dots+'</div>'+
    '<div class="rmeta">'+(r.executionKind||'unavailable')+' · average latency '+(lat==null?'—':lat+' ms')+' · estimated cost '+fmtCost(r.custoUsd)+'</div>';
  return pct;
}
async function rodar(t){
  if(!window.confirm('Run '+t.casos.length+' live Jev requests for this scenario? Provider charges may apply; a monetary maximum is not available.'))return;
  var btn=document.querySelector('[data-id="'+t.id+'"]');
  if(btn){btn.disabled=true;btn.textContent='⏳ Running…';}
  try{
    var resp=await fetch('/api/jev/battle/test-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({testId:t.id})});
    var j=await resp.json();
    if(!resp.ok)throw new Error(j.error||('HTTP '+resp.status));
    var pct=renderCard(t,j.jev||{acertos:0,total:0,respostas:[],custoUsd:null});
    acc.acertos+=(j.jev||{}).acertos||0;acc.total+=(j.jev||{}).total||0;
    if((j.jev||{}).custoUsd==null)acc.costKnown=false;else acc.custo+=j.jev.custoUsd;
    acc.lat.push((j.jev||{}).respostas||[]);
    porCategoria[t.categoria]=porCategoria[t.categoria]||{a:0,t:0};
    porCategoria[t.categoria].a+=(j.jev||{}).acertos||0;porCategoria[t.categoria].t+=(j.jev||{}).total||0;
    atualizarHero();
    return pct;
  }catch(e){
    var host=$('res-'+t.id);host.classList.add('show');
    host.innerHTML='<div class="rmeta" style="color:var(--red)">⚠ '+String(e.message||e).slice(0,120)+'</div>';
    return null;
  }finally{if(btn){btn.disabled=false;btn.textContent='▶ Run live';}}
}
var acc={acertos:0,total:0,custo:0,costKnown:true,lat:[]},porCategoria={};
function atualizarHero(){
  var pct=acc.total?Math.round(acc.acertos/acc.total*100):0;
  $('ringPct').textContent=pct+'%';
  var C=2*Math.PI*80;
  $('ringArc').setAttribute('stroke-dasharray',C.toFixed(1));
  $('ringArc').setAttribute('stroke-dashoffset',(C*(1-pct/100)).toFixed(1));
  $('stCasos').textContent=acc.total;
  $('stAcertos').textContent=acc.acertos;
  $('stCusto').textContent=fmtCost(acc.costKnown&&acc.total?acc.custo:null);
  var todas=acc.lat.flat();
  $('stLat').textContent=todas.length?Math.round(todas.reduce(function(s,c){return s+(c.latencyMs||0);},0)/todas.length)+' ms':'—';
  $('stCen').textContent=Object.keys(porCategoria).length+' / '+TESTES.length;
  for(var cat in porCategoria){var el=$('cb-'+cat);if(el){var p=porCategoria[cat];el.style.width=(p.t?Math.round(p.a/p.t*100):0)+'%';var lbl=$('lbl-'+cat);if(lbl)lbl.textContent=p.a+'/'+p.t;}}
}
async function rodarTudo(){
  if(!window.confirm('Run all 52 synthetic cases with the configured Jev provider? This sends up to 52 requests and may incur charges. There is no guaranteed USD cap.'))return;
  var btn=$('runAll');btn.disabled=true;var label=btn.textContent;btn.textContent='⏳ Running suite…';
  $('progress').classList.add('show');
  $('ptxt').textContent='Running 52 synthetic cases against the configured Jev provider…';
  try{
    var response=await fetch('/api/jev/suite/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var run=await response.json();if(!response.ok)throw new Error(run.error||'Suite failed');
    acc={acertos:run.acertos||0,total:run.total||0,custo:run.custo_usd||0,costKnown:run.custo_usd!=null,lat:[]};porCategoria={};
    TESTES.forEach(function(t){var side=run.por_cenario[t.id];if(!side)return;renderCard(t,side);
      porCategoria[t.categoria]=porCategoria[t.categoria]||{a:0,t:0};porCategoria[t.categoria].a+=side.acertos||0;porCategoria[t.categoria].t+=side.total||0;});
    atualizarHero();$('stLat').textContent=run.latencia_media_ms==null?'—':run.latencia_media_ms+' ms';
    $('pfill').style.width='100%';$('ptxt').textContent=run.executionKind+' · '+run.acertos+'/'+run.total+' · '+run.veredito+' · '+fmtCost(run.custo_usd);
    carregarRegua();
  }catch(error){$('ptxt').textContent='Unavailable: '+error.message;}
  finally{btn.disabled=false;btn.textContent=label;}
}
$('runAll').addEventListener('click',rodarTudo);
async function carregarRegua(){
  try{
    var h=await (await fetch('/api/jev/suite/history')).json();
    var el=$('ruler');
    $('baselineBtn').disabled=!h.runs.length;
    if(!h.runs.length){el.textContent='No complete live run yet. Run all 52 cases, then choose a baseline.';return;}
    var u=h.runs[h.runs.length-1];
    var cor=u.veredito==='regressed'?'var(--red)':u.veredito==='improved'?'var(--jev)':'var(--amber)';
    var spark=h.runs.slice(-10).map(function(r){return r.acuracia*100;});
    var mini=spark.map(function(v,i){var x=i*14;var y=18-v*0.16;return (i?'L':'M')+x+' '+y;}).join(' ');
    el.innerHTML='Live ruler: '+h.runs.length+' run(s) · baseline '+(h.baseline?Math.round(h.baseline.acuracia*100)+'%':'—')+
      ' · latest '+Math.round(u.acuracia*100)+'% ('+u.acertos+'/'+u.total+') · <b style="color:'+cor+'">'+u.veredito+'</b>'+
      (u.delta_pp!=null?' Δ'+(u.delta_pp>0?'+':'')+u.delta_pp+'pp':'')+
      (h.tendencia_pp!=null?' · trend '+(h.tendencia_pp>=0?'+':'')+h.tendencia_pp+'pp':'')+
      ' <svg width="'+(spark.length*14)+'" height="20" style="vertical-align:-5px"><path d="'+mini+'" fill="none" stroke="var(--jev)" stroke-width="2"/></svg>';
  }catch(e){$('ruler').textContent='Live ruler unavailable';}
}
async function setLatestBaseline(){
  if(!window.confirm('Set the latest complete live 52-case run as the comparison baseline? This replaces the current baseline, if any.'))return;
  var button=$('baselineBtn');button.disabled=true;
  try{
    var response=await fetch('/api/jev/suite/baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var result=await response.json();if(!response.ok)throw new Error(result.error||'Could not set baseline');
    await carregarRegua();
  }catch(error){$('ruler').textContent='Baseline unavailable: '+error.message;}
  finally{button.disabled=false;}
}
$('baselineBtn').addEventListener('click',setLatestBaseline);
carregarRegua();
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-id]');if(!b||b.id==='runAll')return;
  var t=TESTES.find(function(x){return x.id===b.dataset.id;});
  if(t)rodar(t);
});
var filtro='todas';
document.querySelectorAll('.chip[data-f]').forEach(function(ch){
  ch.addEventListener('click',function(){
    filtro=ch.dataset.f;
    document.querySelectorAll('.chip[data-f]').forEach(function(c){c.classList.toggle('on',c===ch);});
    document.querySelectorAll('.card[data-cat]').forEach(function(card){
      card.hidden=!(filtro==='todas'||card.dataset.cat===filtro);
    });
  });
});
`;

  const categorias = [...new Set(cardsData.map(t => t.categoria))];
  const chips = ['<button class="chip on" data-f="todas">All (' + cardsData.length + ')</button>']
    .concat(categorias.map(c => {
      const st = CAT_STYLE[c] || { label: c, cor: '#94a3b8' };
      const n = cardsData.filter(t => t.categoria === c).length;
      return '<button class="chip" data-f="' + esc(c) + '" style="border-color:' + st.cor + '55">' + esc(st.label) + ' (' + n + ')</button>';
    })).join('');

  const catRows = categorias.map(c => {
    const st = CAT_STYLE[c] || { label: c, cor: '#94a3b8' };
    return '<div class="catrow"><span style="color:' + st.cor + '">' + esc(st.label) + '</span>' +
      '<div class="cb"><i id="cb-' + esc(c) + '" style="width:0;background:' + st.cor + '"></i></div>' +
      '<b id="lbl-' + esc(c) + '" style="text-align:right;font-variant-numeric:tabular-nums">—</b></div>';
  }).join('');

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ship Test Suite · Jev Flow</title><link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>${CSS}</style></head>
<body>
<main class="shell">
  <header class="top">
    <div><h1>🧪 Ship Test Suite</h1>
    <p>12 synthetic scenarios, 52 cases. Run them against your connected Jev provider and compare typed judgments with fixed expected answers. No result is claimed before execution.</p></div>
    <nav class="links"><a href="/jev/labs">Labs</a><a href="/jev/battle">Arena</a><a href="/jev/games">Games</a><a href="/jev/flows">Studio</a></nav>
  </header>

  <section class="hero">
    <div class="ring">
      <svg width="190" height="190" viewBox="0 0 190 190">
        <circle cx="95" cy="95" r="80" fill="none" stroke="#182530" stroke-width="13"/>
        <circle id="ringArc" cx="95" cy="95" r="80" fill="none" stroke="url(#gradRing)" stroke-width="13" stroke-linecap="round" stroke-dasharray="502.6" stroke-dashoffset="502.6"/>
        <defs><linearGradient id="gradRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#7ce0a3"/></linearGradient></defs>
      </svg>
      <div class="val"><b id="ringPct">—</b><small>fixture score</small></div>
    </div>
    <div class="stats">
      <div class="stat"><b id="stAcertos" style="color:var(--jev)">0</b><small>points</small></div>
      <div class="stat"><b id="stCasos">0</b><small>cases</small></div>
      <div class="stat"><b id="stCen">0 / ${cardsData.length}</b><small>scenarios</small></div>
      <div class="stat"><b id="stLat">—</b><small>mean latency</small></div>
      <div class="stat"><b id="stCusto" style="color:var(--cyan)">—</b><small>estimated cost</small></div>
    </div>
    <div class="suite-actions"><button class="runbtn" id="runAll">⚡ Run full live suite</button>
    <button class="baselinebtn" id="baselineBtn" disabled>Set latest live run as baseline</button></div>
    <div class="ruler" id="ruler" style="grid-column:1/-1;font:600 11.5px ui-monospace,Consolas,monospace;color:var(--muted)">Loading live history…</div>
    <div class="progress" id="progress" aria-live="polite"><div class="pbar"><i id="pfill"></i></div><span class="ptxt" id="ptxt">ready</span></div>
  </section>

  <div class="chips">${chips}</div>
  <section class="grid" id="grid">${cards}</section>

  <section class="catsum">
    <h4>Fixture score by category</h4>
    ${catRows}
  </section>
</main>
<script>${script}</script>
</body></html>`;
}
