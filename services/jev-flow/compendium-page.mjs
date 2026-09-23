// ============================================================================
// Página do Jev Flow Compendium — busca, preview e instalação de milhares de
// orquestrações geradas deterministicamente. Estilo do estúdio (/jev/flows).
// ============================================================================
import { catalogStats } from './compendium-catalog.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function buildCompendiumPage({ locale } = {}) {
  const stats = catalogStats();
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jev Flow Compendium · ${new Intl.NumberFormat('pt-BR').format(stats.total)} orquestrações</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<style>
:root{--bg:#070710;--bg2:#0e0e1a;--bg3:#161624;--bdr:#1d1d2e;--bdr2:#27273a;--tx:#e4e4f1;--tx2:#7d7d96;--tx3:#5c5c72;--acc:#818cf8;--acc2:#c084fc;--ok:#4ade80}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,-apple-system,'Segoe UI',sans-serif;background:radial-gradient(circle at 12% -15%,#162038 0,transparent 32%),var(--bg);color:var(--tx);min-height:100vh;padding:clamp(14px,2vw,32px)}
a{color:var(--acc);text-decoration:none}
.head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
h1{font-size:clamp(24px,2vw,34px);font-weight:800;letter-spacing:-.035em}
.badge{font:700 10px 'JetBrains Mono',monospace;letter-spacing:.1em;color:var(--acc2);border:1px solid color-mix(in srgb,var(--acc2) 40%,transparent);border-radius:99px;padding:4px 10px}
.sub{color:#a6aac0;font-size:clamp(13px,.85vw,15px);margin:10px 0 23px;line-height:1.65;max-width:1050px}
.filters{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:16px}
.filters .search{grid-column:span 2}
@media(max-width:1100px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.filters .search{grid-column:span 3}}
@media(max-width:650px){.filters{grid-template-columns:1fr 1fr}.filters .search{grid-column:span 2}}
input,select{background:#111522;border:1px solid #30354a;border-radius:10px;color:var(--tx);padding:11px 12px;font-size:13px;width:100%;min-height:42px}
input:focus,select:focus{outline:none;border-color:var(--acc)}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.stat{background:#141827;border:1px solid #2b3044;border-radius:13px;padding:16px 18px}
.stat b{font-size:clamp(19px,1.5vw,27px)}.stat span{display:block;color:#9ca4bb;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:5px}
table{width:100%;border-collapse:collapse;background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;overflow:hidden}
th{font:700 11px 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:#a3a7bb;text-align:left;padding:14px 16px;border-bottom:1px solid var(--bdr)}
td{padding:14px 16px;border-bottom:1px solid var(--bdr);font-size:13px;vertical-align:top}
tr:hover td{background:color-mix(in srgb,var(--acc) 5%,transparent)}
td .desc{color:#aeb4c8;font-size:12px;line-height:1.5;max-width:680px}
.pill{font:700 9px 'JetBrains Mono',monospace;padding:2px 8px;border-radius:99px;border:1px solid var(--bdr2);color:var(--tx2);white-space:nowrap}
button{font:700 11px 'JetBrains Mono',monospace;padding:9px 12px;border-radius:9px;border:1px solid #40455f;background:#20263a;color:var(--tx);cursor:pointer;min-height:36px}
button:hover{border-color:var(--ok);color:var(--ok)}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #8debba;outline-offset:2px}
.primary{background:#324c5a;border-color:#4c8797;color:#ddfbff}
.actions{display:flex;flex-wrap:wrap;gap:6px;min-width:212px}
.action-out{display:none;padding:11px 13px;border:1px solid #335368;background:#102435;border-radius:9px;color:#d9f3f9;font-size:12px;margin:0 0 14px}
.action-out.error{display:block;border-color:#985158;background:#29191f;color:#ffd9dc}
.action-out.ok{display:block}
button.instalado{border-color:var(--ok);color:var(--ok);opacity:.75}
.pager{display:flex;gap:8px;align-items:center;margin-top:12px;color:var(--tx2);font-size:11.5px}
.pager button{padding:6px 12px}
pre{background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:12px;font:500 10.5px 'JetBrains Mono',monospace;color:var(--tx2);overflow:auto;max-height:420px;margin-top:10px;display:none}
.note{color:var(--tx3);font-size:11px;margin-top:14px;line-height:1.6}
@media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}table,thead,tbody,tr,td{display:block}thead{display:none}tr{border-bottom:1px solid #2d3548}td{border:0;padding:7px 12px}td:first-child{padding-top:14px}td:last-child{padding-bottom:14px}.actions{min-width:0}.pager{flex-wrap:wrap}}
</style>
</head>
<body>
  <div class="head">
    <h1>📚 Jev Flow Compendium</h1>
    <span class="badge">${new Intl.NumberFormat('pt-BR').format(stats.total)} CONFIGURAÇÕES</span>
    <span style="margin-left:auto"><a href="/jev/labs">Labs</a> · <a href="/jev/battle">Arena</a> · <a href="/jev/flows">Estúdio de fluxos</a></span>
  </div>
  <p class="sub">Explore fluxos parametrizados por padrão, domínio, foco, orçamento, limiar e complexidade. Cada item é gerado sob demanda e validado antes de aparecer. <b>Testar</b> abre o testador do Jev Flow com entrada tipada, sem instalar nem chamar Jev.</p>
  <div class="stats" id="stats"></div>
  <div class="filters">
    <input class="search" id="f-search" placeholder="Buscar: suporte, jurídico, roteamento, guardrail…" aria-label="Buscar orquestrações" oninput="debounce()">
    <select id="f-pattern" onchange="load(0)"><option value="">todos os padrões</option>${stats.patterns.map(p=>`<option value="${p.id}">${p.nome}</option>`).join('')}</select>
    <select id="f-domain" onchange="updateFocus();load(0)"><option value="">todos os domínios</option>${stats.domains.map(d=>`<option value="${d.id}">${d.nome}</option>`).join('')}</select>
    <select id="f-variant" onchange="load(0)"><option value="">todas as variantes</option>${stats.variants.map(v=>`<option value="${v.id}">${v.nome}</option>`).join('')}</select>
    <select id="f-limiar" onchange="load(0)"><option value="">todos os limiares</option>${stats.limiares.map(l=>`<option value="${l.id}">${l.nome} (${l.valor})</option>`).join('')}</select>
    <select id="f-complexity" onchange="load(0)"><option value="">todas as complexidades</option>${stats.complexities.map(c=>`<option value="${c.id}">${c.nome}</option>`).join('')}</select>
    <select id="f-focus" onchange="load(0)" disabled><option value="">todos os focos · escolha um domínio</option></select>
  </div>
  <div class="card" style="background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;padding:12px;margin-bottom:14px">
    <b style="font-size:12px">Personalize um exemplo</b>
    <span style="color:var(--tx3);font-size:11px;margin-left:8px">Instale uma configuração e edite-a no estúdio. Para importar, use um arquivo Flow JSON explícito.</span>
    <a href="/jev/flows" style="display:inline-block;margin-left:10px">Abrir estúdio →</a>
  </div>
  <div id="actionOut" class="action-out" role="status" aria-live="polite"></div>
  <table>
    <thead><tr><th style="width:26%">Fluxo</th><th>Descrição</th><th style="width:8%">Nós</th><th style="width:22%">Ações</th></tr></thead>
    <tbody id="rows"><tr><td colspan="4" style="color:var(--tx3)">carregando…</td></tr></tbody>
  </table>
  <div class="pager">
    <button onclick="load(Math.max(0,offset-40))">← anteriores</button>
    <span id="pagerInfo"></span>
    <button onclick="load(offset+40)">próximos →</button>
    <span style="margin-left:auto"><button id="bulkBtn" onclick="bulk(event)">Instalar itens desta página</button></span>
  </div>
  <details id="prevBox" style="display:none"><summary>JSON do fluxo selecionado</summary><pre id="prev"></pre></details>
  <p class="note">Padrões: ${stats.patterns.map(p=>p.nome).join(' · ')}. O catálogo representa configurações geráveis, sem materializar centenas de milhares de arquivos. Julgamentos Jev são tipados; simulações mostram origem própria. Instalação em lote afeta apenas os itens desta página.</p>
<script>
const esc=function(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
const $=function(id){return document.getElementById(id);};
let offset=0,totalRows=0,loadVersion=0,CATALOG_STATS=null;
function qs(){const p=new URLSearchParams();if($('f-search').value.trim())p.set('search',$('f-search').value.trim());['pattern','domain','variant','limiar','complexity','focus'].forEach(function(k){if($('f-'+k).value)p.set(k,$('f-'+k).value);});p.set('limit',40);p.set('offset',offset);return p.toString();}
function setAction(kind,message){const out=$('actionOut');out.className='action-out '+kind;out.textContent=message;}
function keyOf(it){return {id:it.id,pattern:it.pattern,domain:it.domain,variant:it.variant,limiar:it.limiar,complexity:it.complexity,focus:it.focus};}
function testUrl(it){const q=new URLSearchParams(keyOf(it));return '/jev/flows/compendium/test?'+q.toString()+'#testador';}
function updateFocus(){const domain=CATALOG_STATS&&CATALOG_STATS.domains.find(function(d){return d.id===$('f-domain').value;});const control=$('f-focus');control.innerHTML='<option value="">'+(domain?'todos os focos':'todos os focos · escolha um domínio')+'</option>'+(domain?domain.foci.map(function(f){return '<option value="'+esc(f.id)+'">'+esc(f.nome)+'</option>';}).join(''):'');control.disabled=!domain;control.value='';}
let t=null;function debounce(){clearTimeout(t);t=setTimeout(function(){load(0);},260);}
function pill(t){return '<span class="pill">'+esc(t)+'</span> ';}
var COMP_ITEMS=[];
async function load(o){
  offset=Math.max(0,o);const version=++loadVersion;
  $('rows').innerHTML='<tr><td colspan="4">Carregando configurações…</td></tr>';
  try{
    const r=await fetch('/api/jev/flows/compendium?'+qs());
    const d=await r.json();if(!r.ok)throw new Error(d.error||'consulta falhou');
    if(version!==loadVersion)return;
    COMP_ITEMS=d.items||[];totalRows=d.total||0;
    $('rows').innerHTML=COMP_ITEMS.map(function(it,i){
      const btn='<div class="actions"><button class="primary" onclick="testFlow('+i+')">▶ testar no Studio</button><button id="btn-'+esc(it.id)+'" onclick="install('+i+')">Instalar</button><button onclick="validateFlowById('+i+')">Validar</button><button onclick="preview('+i+')">JSON</button></div>';
      return '<tr><td><b>'+esc(it.name)+'</b><br>'+pill(it.patternNome)+pill(it.domainNome)+pill(it.focusNome)+pill(it.complexityNome)+'</td><td><div class="desc">'+esc(it.description)+'</div></td><td>'+it.nodeCount+'</td><td>'+btn+'</td></tr>';
    }).join('')||'<tr><td colspan="4">Nenhuma configuração encontrada. Ajuste a busca ou os filtros.</td></tr>';
    $('pagerInfo').textContent=d.total?((offset+1)+'–'+Math.min(offset+d.limit,d.total)+' de '+new Intl.NumberFormat('pt-BR').format(d.total)):'0 resultados';
    document.querySelector('.pager button:first-child').disabled=offset===0;
    document.querySelector('.pager button:nth-of-type(2)').disabled=offset+40>=d.total;
    $('bulkBtn').disabled=!COMP_ITEMS.length;
  }catch(error){if(version!==loadVersion)return;COMP_ITEMS=[];totalRows=0;$('rows').innerHTML='<tr><td colspan="4">Não foi possível carregar o catálogo. <button onclick="load(offset)">Tentar novamente</button></td></tr>';setAction('error',error.message);}
}
async function install(i){
  const it=COMP_ITEMS[i];if(!it)return;
  const btn=document.getElementById('btn-'+esc(it.id));if(btn)btn.disabled=true;
  try{
    const r=await fetch('/api/jev/flows/compendium/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(keyOf(it))});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'instalação falhou');
    if(btn){btn.textContent='✓ instalado';btn.classList.add('instalado');}
    setAction('ok','Fluxo instalado: '+d.name+'. Abra o Studio para editá-lo.');
  }catch(e){if(btn)btn.disabled=false;setAction('error','Falha ao instalar '+it.name+': '+e.message);}
}
async function bulk(event){
  const btn=event.target;btn.disabled=true;const old=btn.textContent;btn.textContent='⏳ instalando…';
  try{
    const r=await fetch('/api/jev/flows/compendium/install-bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:COMP_ITEMS.map(keyOf)})});
    const d=await r.json();if(!r.ok)throw new Error(d.error||'lote falhou');
    setAction(d.errors?.length?'error':'ok',d.installed+' instalados, '+(d.skipped||[]).length+' já existentes, '+(d.errors||[]).length+' falhas.');
    btn.textContent='✓ '+d.installed+' instalados';
  }catch(error){setAction('error',error.message);btn.textContent='✗ erro';}
  btn.disabled=false;setTimeout(function(){btn.textContent=old;},2500);
}
function showPrev(flow){$('prevBox').style.display='block';$('prev').style.display='block';$('prev').textContent=JSON.stringify(flow,null,1);}
async function testFlow(i){
  const it=COMP_ITEMS[i];if(!it)return;
  location.href=testUrl(it);
}
async function validateFlowById(i){
  const it=COMP_ITEMS[i];if(!it)return;
  setAction('ok','Validando '+it.name+'…');
  try{
    const r=await fetch('/api/jev/flows/compendium/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(keyOf(it))});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'validação falhou');
    setAction(d.ok?'ok':'error',d.ok?'Fluxo válido: '+it.name+' · '+d.nodeCount+' nós.':'Fluxo inválido: '+JSON.stringify(d.errors||[]).slice(0,200));
  }catch(e){setAction('error','Falha ao validar '+it.name+': '+e.message);}
}
async function preview(i){
  const it=COMP_ITEMS[i];if(!it)return;
  try{
    const r=await fetch('/api/jev/flows/compendium/item?'+new URLSearchParams(keyOf(it)));
    const flow=await r.json();if(!r.ok)throw new Error(flow.error||'preview falhou');
    showPrev(flow);$('prevBox').scrollIntoView({block:'nearest'});
  }catch(error){setAction('error','Falha ao abrir JSON: '+error.message);}
}
async function init(){
  const s=await(await fetch('/api/jev/flows/compendium/stats')).json();
  CATALOG_STATS=s;
  $('stats').innerHTML='<div class="stat"><b>'+new Intl.NumberFormat('pt-BR').format(s.total)+'</b><span>configurações geráveis</span></div><div class="stat"><b>'+s.patterns.length+'</b><span>padrões</span></div><div class="stat"><b>'+s.domains.length+'</b><span>domínios únicos</span></div><div class="stat"><b>'+s.fociPerDomain+'</b><span>focos por domínio</span></div>';
  await load(0);
}
init().catch(function(error){setAction('error','Não foi possível carregar as estatísticas: '+error.message);});
</script>
</body>
</html>`;
}
