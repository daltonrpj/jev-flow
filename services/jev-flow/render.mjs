// ============================================================================
// Jev Flow Render — a parte VISUAL do estúdio: todo flow vira um diagrama
// Mermaid (nós = caixas por tipo, arestas rotuladas pelos casos/condições).
// Saídas: .mmd (renderiza em GitHub/VSCode/notion) e .html (visualizador
// autocontido com mermaid via CDN — abre no navegador e pronto).
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNodeDefinition, normalizeNodeType } from './node-catalog.mjs';
import { projectFlowForPublic } from './public-projection.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const GROUP_STYLE = Object.freeze({
  judgment: 'fill:#302a55,color:#f4f0ff,stroke:#9a83ff,stroke-width:1.5px',
  deterministic: 'fill:#12343a,color:#eafffb,stroke:#50c8c2,stroke-width:1.5px',
  context: 'fill:#173045,color:#edf8ff,stroke:#62b6e8,stroke-width:1.5px',
  logic: 'fill:#3a2d1f,color:#fff8e9,stroke:#e2ab5d,stroke-width:1.5px',
  control: 'fill:#3d3319,color:#fff9df,stroke:#d9b94e,stroke-width:1.5px',
  action: 'fill:#3b232a,color:#fff1f4,stroke:#e27a91,stroke-width:1.5px',
  observability: 'fill:#25313a,color:#f0f6fa,stroke:#8095a3,stroke-width:1.5px',
});

function flowMarkDataUri() {
  try {
    const svg = readFileSync(join(MODULE_DIR, '..', '..', 'site', 'assets', 'mark.svg'));
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch {
    return '';
  }
}

const JEV_FLOW_MARK_DATA_URI = flowMarkDataUri();

function esc(s) {
  return String(s ?? '')
    .replace(/>=/g, '≥').replace(/<=/g, '≤')
    .replace(/>/g, '&gt;').replace(/</g, '&lt;')
    .replace(/["\n\r|]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
}

function htmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rotuloNo(id, node, isStart) {
  const tipo = normalizeNodeType(node?.type) || '?';
  const definition = getNodeDefinition(tipo);
  let detalhe = '';
  if (tipo === 'jev.ask' && node.questions) detalhe = `${Object.keys(node.questions).length} julgamento(s) tipado(s)`;
  if (tipo === 'jev.jevlet') detalhe = 'jevlet catalogado';
  if (tipo === 'flow.if') detalhe = 'condição tipada protegida';
  if (tipo === 'flow.switch') detalhe = 'seletor tipado protegido';
  if (tipo === 'action.webhook') detalhe = 'endpoint protegido';
  if (tipo === 'action.log') detalhe = 'mensagem protegida';
  if (tipo === 'action.set') detalhe = `${Object.keys(node.values || {}).length} variável(is)`;
  if (tipo === 'rule.match') detalhe = `comparação ${node.operator || 'fechada'}`;
  if (tipo === 'rule.extract') detalhe = `${Object.keys(node.paths || {}).length} extração(ões)`;
  if (tipo === 'rule.lookup') detalhe = `${Object.keys(node.table || {}).length} entrada(s) catalogada(s)`;
  if (tipo === 'context.compact') detalhe = `máx. ${node.maxChars || 4000} caracteres`;
  if (tipo === 'context.prune') detalhe = 'poda fail-open';
  if (tipo === 'det.skill') detalhe = 'skill determinística registrada';
  if (tipo === 'budget.guard') detalhe = `${Object.keys(node.budget || {}).length} limite(s) reservado(s)`;
  if (tipo === 'jev.verify') detalhe = 'alegação e evidência protegidas';
  if (tipo === 'metrics.emit') detalhe = 'evento redigido';
  if (tipo === 'logic.subgraph') detalhe = `${Object.keys(node.graph?.facts || {}).length} fatos · ${(node.graph?.rules || []).length} políticas`;
  const marca = isStart ? ' ▶' : '';
  const glyph = esc(definition?.glyph || '··');
  return `${glyph}  ${id}${marca} · ${tipo}${detalhe ? `<br/>${esc(detalhe)}` : ''}`;
}

/** Gera o diagrama Mermaid (texto) de um flow. */
export function renderMermaid(flow) {
  const safeFlow = projectFlowForPublic(flow);
  const linhas = [`flowchart TD`];
  for (const [id, node] of Object.entries(safeFlow.nodes || {})) {
    const definition = getNodeDefinition(node?.type);
    const estilo = GROUP_STYLE[definition?.group];
    linhas.push(`  ${noId(id)}["${rotuloNo(id, node, id === safeFlow.start)}"]`);
    if (estilo) linhas.push(`  style ${noId(id)} ${estilo}`);
  }
  for (const [id, node] of Object.entries(safeFlow.nodes || {})) {
    if (node?.next) linhas.push(`  ${noId(id)} --> ${noId(node.next)}`);
    if (node?.type === 'flow.if') {
      if (node.then) linhas.push(`  ${noId(id)} -->|sim · condição protegida| ${noId(node.then)}`);
      if (node.else) linhas.push(`  ${noId(id)} -->|não| ${noId(node.else)}`);
    }
    if (node?.type === 'flow.switch') {
      let caseIndex = 0;
      for (const [caso, alvo] of Object.entries(node.cases || {})) {
        const destino = Array.isArray(alvo) ? alvo[0] : alvo;
        caseIndex += 1;
        if (destino) linhas.push(`  ${noId(id)} -->|${caso === '_default' ? 'padrão' : `caso ${caseIndex}`}| ${noId(destino)}`);
      }
    }
  }
  return linhas.join('\n');
}

function noId(id) {
  return `n_${String(id).replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

const HTML = (flow, mmd) => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Jev Flow — ${esc(flow.name)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  :root { color-scheme: dark; --bg:#081017; --surface:#0d171f; --line:#24313b; --muted:#8d9ba6; --ink:#f3f5f7; --accent:#9a83ff; }
  * { box-sizing: border-box; }
  body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; margin: 0; min-height:100vh; background:var(--bg); color:var(--ink); }
  body:before { content:''; position:fixed; inset:0; pointer-events:none; opacity:.34; background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px); background-size:32px 32px; }
  header { position:relative; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:14px; padding:18px 24px; border-bottom:1px solid var(--line); background:rgba(8,16,23,.88); backdrop-filter:blur(18px); }
  .brand { display:flex; align-items:center; gap:10px; }
  .brand img { width:30px; height:30px; object-fit:contain; }
  .brand b { display:block; font-size:13px; letter-spacing:.01em; }
  .brand small { display:block; margin-top:1px; color:var(--muted); font:8px ui-monospace,Consolas,monospace; letter-spacing:.12em; text-transform:uppercase; }
  header h1 { margin:0; min-width:0; font:600 clamp(18px,3vw,26px) Georgia,serif; letter-spacing:-.02em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  header h1 small { color:var(--muted); font:9px ui-monospace,Consolas,monospace; letter-spacing:.06em; }
  .contract { padding:6px 8px; border:1px solid rgba(154,131,255,.38); border-radius:5px; color:#cfc4ff; font:700 8px ui-monospace,Consolas,monospace; letter-spacing:.1em; text-transform:uppercase; }
  .summary { position:relative; display:flex; gap:18px; flex-wrap:wrap; padding:12px 24px; border-bottom:1px solid var(--line); color:var(--muted); font-size:11px; }
  .summary p { margin:0; }
  .summary b { color:#c8d1d8; }
  .summary code { color:#bcb0ff; }
  main { position:relative; padding:40px 24px; overflow:auto; }
  .mermaid { display:flex; justify-content:center; min-width:max-content; }
  @media (max-width:720px) { header{grid-template-columns:auto 1fr;padding:14px}.contract{display:none}.summary,main{padding-left:14px;padding-right:14px}.brand small{display:none} }
</style>
</head>
<body>
<header>
  <div class="brand"><img src="${JEV_FLOW_MARK_DATA_URI}" alt=""/><span><b>Jev Flow</b><small>Decision Studio</small></span></div>
  <h1>${esc(flow.name)} <small>${esc(flow.id)}</small></h1>
  <span class="contract">Jev Flow · grafo executável</span>
</header>
<div class="summary"><p>${esc(flow.description || '')}</p><p><b>Input</b> ${Object.keys(flow.input_schema || {}).map(k => `<code>${esc(k)}</code>`).join(' ') || '<code>sem campos</code>'}</p></div>
<main>
  <div class="mermaid">${htmlEsc(mmd).replace(/&lt;br\/&gt;/g, '<br/>')}</div>
</main>
<script>mermaid.initialize({ startOnLoad: true, theme: 'dark', themeVariables: { fontFamily: 'Inter, ui-sans-serif, system-ui', lineColor: '#687782', primaryTextColor: '#f3f5f7' }, flowchart: { curve: 'basis', htmlLabels: true } });</script>
</body>
</html>`;

/**
 * Escreve os artefatos visuais do flow: <id>.mmd e <id>.html em `dir`.
 * Retorna { mermaid, mmdPath, htmlPath }.
 */
export function drawFlow(flow, { dir = '.' } = {}) {
  const safeFlow = projectFlowForPublic(flow);
  const mmd = renderMermaid(safeFlow);
  mkdirSync(dir, { recursive: true });
  const mmdPath = join(dir, `${safeFlow.id}.mmd`);
  const htmlPath = join(dir, `${safeFlow.id}.html`);
  writeFileSync(mmdPath, mmd, 'utf8');
  writeFileSync(htmlPath, HTML(safeFlow, mmd), 'utf8');
  return { mermaid: mmd, mmdPath, htmlPath };
}
