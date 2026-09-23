// ============================================================================
// Página da JEV Battle Arena — /jev/battle
// Streaming SSE, dark premium, GPU-safe, carrinho game.
// ============================================================================
import { listBattleModels } from './battle.mjs';
import { RACE_EXAMPLE, RACE_QUESTIONS } from './race.mjs';
import { listArenaTests } from './arena-tests.mjs';

const html = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export async function buildBattlePage() {
  const providers = await listBattleModels();
  const testCount = listArenaTests().length;
  const modelOptions = providers
    .flatMap(p => p.modelos.map(m => `<option value="${html(m.id)}"${m.id === 'groq/openai/gpt-oss-20b' ? ' selected' : ''}>${html(m.nome)} (${html(p.nome)})</option>`))
    .join('\n');
  const raceQuestions = html(JSON.stringify(RACE_QUESTIONS, null, 2));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jev Flow · JEV Battle Arena</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<style>
:root{--bg:#070710;--bg2:#0e0e1a;--bg3:#161624;--bdr:#1d1d2e;--bdr2:#27273a;--tx:#e4e4f1;--tx2:#7d7d96;--tx3:#5c5c72;--acc:#818cf8;--acc2:#c084fc;--ok:#4ade80;--err:#f87171;--warn:#fbbf24;--cyan:#22d3ee;--mono:'JetBrains Mono','SF Mono',Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--tx);min-height:100vh;padding:20px}
a{color:var(--acc);text-decoration:none}
.header{display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.header h1{font-size:22px;font-weight:800}
.header .locale{margin-left:auto;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--tx2)}
.engine-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;padding:11px 13px;background:var(--bg2);border:1px solid var(--bdr2);border-radius:11px;font-size:11px}
.engine-bar select{min-width:155px}.engine-status{color:var(--tx2);min-width:170px;flex:1}
.mode-help{border-left:2px solid var(--acc);padding:9px 12px;background:var(--bg2);border-radius:7px;font-size:11px;color:var(--tx2);margin:0 0 10px}
.setup-panel{margin:8px 0 14px;padding:10px 13px;background:var(--bg2);border:1px solid var(--bdr);border-radius:10px;color:var(--tx2);font-size:11px;line-height:1.6}
.trace{margin:10px 0;border:1px solid var(--bdr2);border-radius:9px;padding:8px;font-size:11px;color:var(--tx2)}
.trace pre{white-space:pre-wrap;overflow:auto;max-height:350px;font:10px/1.5 var(--mono);padding:9px;background:var(--bg3)}
.badge{font:700 9.5px var(--mono);letter-spacing:.12em;padding:4px 11px;border-radius:99px}
.badge.jev{color:var(--cyan);border:1px solid rgba(34,211,238,.4)}
.badge.llm{color:var(--acc2);border:1px solid rgba(192,132,252,.4)}
.sub{color:var(--tx2);font-size:12px;margin:-8px 0 16px;max-width:800px}
.input-bar{display:grid;grid-template-columns:1fr 220px auto;gap:10px;margin-bottom:18px}
@media(max-width:900px){.input-bar{grid-template-columns:1fr}}
textarea{background:var(--bg2);border:1px solid var(--bdr2);border-radius:11px;color:var(--tx);padding:12px 14px;font-size:13px;resize:vertical;min-height:52px;grid-column:1/-1}
textarea:focus{outline:none;border-color:var(--acc)}
select{background:var(--bg2);border:1px solid var(--bdr2);border-radius:11px;color:var(--tx);padding:10px 12px;font-size:12px}
button.run{padding:12px 24px;border:0;border-radius:11px;background:linear-gradient(135deg,var(--cyan),var(--acc));color:#070710;font-weight:800;font-size:13px;cursor:pointer}
button.run:disabled{opacity:.4;cursor:wait}
.presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.preset{font:600 10.5px var(--mono);padding:6px 12px;border-radius:99px;border:1px solid var(--bdr2);background:var(--bg2);color:var(--tx2);cursor:pointer}
.preset:hover{border-color:var(--cyan);color:var(--tx)}
.arena{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
@media(max-width:900px){.arena{grid-template-columns:1fr}}
.fighter{background:var(--bg2);border:1px solid var(--bdr);border-radius:16px;padding:16px;min-height:280px;transition:border-color .3s}
.fighter.jev{border-top:3px solid var(--cyan)}
.fighter.llm{border-top:3px solid var(--acc2)}
.fighter.winner{border-color:rgba(74,222,128,.5)}
.f-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.f-avatar{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-weight:900;font-size:13px}
.fighter.jev .f-avatar{background:rgba(34,211,238,.15);color:var(--cyan)}
.fighter.llm .f-avatar{background:rgba(192,132,252,.15);color:var(--acc2)}
.f-name{font-weight:800;font-size:14px}
.f-desc{font-size:10.5px;color:var(--tx3)}
.f-timer{margin-left:auto;text-align:right}
.f-timer .ms{font:800 22px var(--mono)}
.f-timer .lbl{font:600 8.5px var(--mono);color:var(--tx3);text-transform:uppercase}
.fighter.jev .ms{color:var(--cyan)}.fighter.llm .ms{color:var(--acc2)}
.ms.running{animation:pulse 1s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.f-body{font-size:12.5px;line-height:1.65;min-height:120px}
.f-body .typed{display:flex;flex-direction:column;gap:6px}
.typed-row{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg3);border-radius:8px;border-left:2px solid var(--cyan);animation:rowIn .4s ease both}
@keyframes rowIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:none}}
.typed-row .k{font:700 10px var(--mono);color:var(--tx3);min-width:110px}
.typed-row .v{font-weight:700;font-size:12px}
.typed-row .v.noul{color:var(--cyan)}.typed-row .v.choice{color:var(--ok)}.typed-row .v.score{color:var(--warn)}
.typed-row .bar{flex:1;height:4px;border-radius:2px;background:var(--bdr);overflow:hidden}
.typed-row .bar-fill{height:100%;border-radius:2px;background:var(--cyan);transition:width .6s ease}
.f-body .llm-text{white-space:pre-wrap;padding:12px;background:var(--bg3);border-radius:10px;border-left:2px solid var(--acc2);font-size:12px;line-height:1.7}
.f-body .llm-text .cursor{display:inline-block;width:6px;height:14px;background:var(--acc2);animation:blink .7s infinite;margin-left:1px;vertical-align:text-bottom}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.f-body .error{color:var(--err);font-size:12px;padding:10px;background:rgba(248,113,113,.08);border-radius:8px;border-left:2px solid var(--err)}
.f-body .waiting{color:var(--tx3);display:grid;place-items:center;min-height:120px}
.f-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:12px}
.metric{background:var(--bg3);border-radius:8px;padding:8px 10px;text-align:center}
.metric b{display:block;font:800 13px var(--mono);margin-top:2px}
.metric span{font:600 8px var(--mono);letter-spacing:.08em;color:var(--tx3);text-transform:uppercase}
.comparison{background:var(--bg2);border:1px solid var(--bdr);border-radius:14px;padding:16px;display:none}
.comparison.show{display:block}
.comp-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.comp-card{background:var(--bg3);border-radius:10px;padding:12px;text-align:center}
.comp-card b{display:block;font:800 20px var(--mono);margin-bottom:4px}
.comp-card span{font-size:10px;color:var(--tx3)}
.comp-verdict{margin-top:12px;font-size:12px;color:var(--tx2);padding:10px;background:var(--bg3);border-radius:8px;border-left:2px solid var(--acc)}
.mode-switch{display:flex;gap:4px;margin-bottom:14px}
.mode-switch button{font:700 11px var(--mono);padding:8px 16px;border-radius:10px;border:1px solid var(--bdr2);background:var(--bg2);color:var(--tx2);cursor:pointer}
.mode-switch button.on{background:rgba(129,140,248,.2);border-color:var(--acc);color:var(--tx)}
.presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.preset{font:600 10.5px var(--mono);padding:6px 12px;border-radius:99px;border:1px solid var(--bdr2);background:var(--bg2);color:var(--tx2);cursor:pointer;transition:border-color .2s}
.preset:hover{border-color:var(--cyan);color:var(--tx)}
.tests-section{display:none;margin-top:20px}
.tests-section.show{display:block}
.tests-title{font:800 10px var(--mono);letter-spacing:.12em;color:var(--tx3);text-transform:uppercase;margin-bottom:10px}
.test-card{background:var(--bg2);border:1px solid var(--bdr);border-radius:12px;padding:12px 14px;margin-bottom:8px;cursor:pointer}
.test-card:hover{border-color:var(--acc)}
.tc-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.tc-nome{font-weight:700;font-size:12.5px}
.tc-cat{font:600 9px var(--mono);padding:2px 8px;border-radius:99px;border:1px solid var(--bdr2);color:var(--tx3)}
.tc-desc{font-size:11px;color:var(--tx2)}
.tc-result{margin-top:6px}
.tc-compare{display:grid;grid-template-columns:repeat(3,1fr) 1fr;gap:6px}
.tc-side{text-align:center;padding:6px;background:var(--bg3);border-radius:6px}
.tc-side.jev b{color:var(--cyan)}.tc-side.llm b{color:var(--acc2)}
.tc-side span{display:block;font:600 8px var(--mono);color:var(--tx3);text-transform:uppercase;margin-top:2px}
.tc-verdict{grid-column:1/-1;font:700 10px var(--mono);color:var(--ok);text-align:center;padding:6px;background:rgba(74,222,128,.08);border-radius:6px;margin-top:2px}
.note{color:var(--tx3);font-size:10.5px;margin-top:12px}
.q-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--bdr)}
.q-row .qnome{font:700 10px var(--mono);min-width:90px;color:var(--tx2)}
.q-row .qbar{flex:1;height:5px;background:var(--bdr);border-radius:3px;overflow:hidden}
.q-row .qfill{height:100%;border-radius:3px}
.q-row .qscore{font:800 11px var(--mono);min-width:36px;text-align:right}
.radar-poly{fill:rgba(34,211,238,.12);stroke:var(--cyan);stroke-width:2}
.radar-grid{fill:none;stroke:var(--bdr2);stroke-width:.5}
.radar-lbl{font:600 9px var(--mono);fill:var(--tx3);text-anchor:middle}
.radar-dot{fill:var(--cyan)}
#gameCanvas{width:100%;border-radius:12px;border:1px solid var(--bdr);display:none;margin-top:14px}
.game-controls{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.game-controls button{font:700 10px var(--mono);padding:7px 14px;border-radius:8px;border:1px solid var(--bdr2);background:var(--bg2);color:var(--tx2);cursor:pointer}
.game-controls button:hover{border-color:var(--cyan);color:var(--cyan)}
.game-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
.game-stats .metric b.ok{color:var(--ok)}
.game-stats .metric b.err{color:var(--err)}
.race-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,260px) auto;gap:4px 8px;margin:6px 0}
.race-controls textarea{grid-column:1;grid-row:2;min-height:48px;height:48px;font:11px/1.35 var(--mono);padding:6px 8px}
.race-controls label{font:700 10px var(--mono);color:var(--tx2)}
.race-controls label[for=raceInput]{grid-column:1;grid-row:1}.race-controls label[for=raceModel]{grid-column:2;grid-row:1}
.race-controls select{min-width:0;grid-column:2;grid-row:2;padding:6px}
.race-controls button{grid-column:3;grid-row:2}
.race-controls button{border:0;border-radius:10px;background:var(--acc);color:#fff;font-weight:800;padding:10px 16px;cursor:pointer}
.race-controls button:disabled{opacity:.5;cursor:wait}
.race-questions{margin:12px 0;border:1px solid var(--bdr2);border-radius:10px;padding:8px 10px;color:var(--tx2);font-size:11px}
.race-questions summary{cursor:pointer;font-weight:700}
.race-questions textarea{display:block;width:100%;height:280px;margin-top:10px;background:var(--bg3);border:1px solid var(--bdr2);border-radius:8px;color:var(--tx);padding:10px;font:11px/1.5 var(--mono);resize:vertical}
.race-summary{font:700 11px var(--mono);text-align:center;padding:5px;color:var(--tx);min-height:25px}
.race-panels{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.race-panel{background:#f6f6f3;border:2px solid #c9c9c7;border-radius:8px;color:#202020;min-width:0;overflow:hidden}
.race-panel header{display:flex;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:2px solid #bdbdb9;font:800 13px var(--mono)}
.race-panel .race-meta{padding:10px 14px;font:700 11px/1.55 var(--mono);white-space:pre-wrap;min-height:68px}
.race-panel pre{font:10px/1.35 var(--mono);padding:8px 12px;white-space:pre-wrap;overflow:auto;height:calc(100vh - 355px);min-height:300px;max-height:520px;word-break:break-word}
.race-panel footer{padding:10px 14px;border-top:1px solid #bdbdb9;font:700 11px var(--mono)}
.race-mode{background:#f2f2f1;color:#202020;padding:8px}.race-mode .header{margin-bottom:5px}.race-mode .header h1{font-size:15px}.race-mode .badge{border-color:#c8c8c8;color:#333}.race-mode .sub{display:none}.race-mode .mode-switch{margin:0 0 5px}.race-mode .mode-switch button{padding:5px 9px}.race-mode .mode-switch button.on{background:#dfe7ff;color:#202020;border-color:#9ab2f4}.race-mode .race-controls label{color:#444}.race-mode .race-controls textarea,.race-mode .race-controls select{background:#fff;color:#202020;border-color:#b9b9b9}.race-mode .race-summary{color:#202020}.race-mode .race-questions{color:#444;border-color:#c8c8c8}
@media(max-width:900px){.race-controls{grid-template-columns:1fr 150px}.race-controls button{grid-column:1/-1;grid-row:3}.race-panels{grid-template-columns:1fr}.race-panel pre{min-height:220px}}
</style>
</head>
<body class="race-mode">
<div class="header">
<h1>⚔️ JEV Battle Arena</h1>
<span class="badge jev">JEV · TYPED JUDGMENT</span>
<span style="color:var(--tx3)">vs</span>
<span class="badge llm">LLM · TEXT GENERATION</span>
<label class="locale" for="uiLanguage">Language <select id="uiLanguage" aria-label="Interface language"><option value="en">English</option></select></label>
<span><a href="/jev/flows">← studio</a></span>
</div>
<p class="sub">Compare one input across two different operations. The Arena shows execution source, model, measured latency and reported usage. Costs appear only when supported by data.</p>
<p class="note" style="margin:-9px 0 12px">Selecting a non-English interface language calls the configured translation provider on demand and may incur its own cost. Inputs and question schemas stay unchanged.</p>

<div class="engine-bar"><label for="jevEngine">Jev engine</label><select id="jevEngine"><option value="typesafe">TypeSafe API</option><option value="laya-local">Laya local</option></select><span class="engine-status" id="engineStatus">Checking availability…</span><button type="button" id="engineRefresh">Refresh status</button></div>
<details class="setup-panel"><summary>Local Laya setup and provenance</summary><p>Install from your terminal: <code>python -m pip install laya</code>. If the service uses another Python, set <code>LAYA_PYTHON</code> for that service. Nothing installs when you choose Laya here.</p><p>Verified upstream: <a href="https://github.com/NandhaKishorM/laya" target="_blank" rel="noopener noreferrer">source code</a> · <a href="https://github.com/NandhaKishorM/laya/releases/latest" target="_blank" rel="noopener noreferrer">Download release</a> · <a href="https://huggingface.co/convaiinnovations/laya" target="_blank" rel="noopener noreferrer">English checkpoint</a> · <a href="https://huggingface.co/convaiinnovations/laya-multilingual" target="_blank" rel="noopener noreferrer">multilingual checkpoint</a> · <a href="/api/jev/docs/laya" target="_blank" rel="noopener noreferrer">local setup guide</a>. Local calibration is specific to the checkpoint and question set.</p></details>

<div class="mode-switch">
<button class="on" data-mode="race" onclick="setMode('race')">⌨ Race · 27 questions</button>
<button data-mode="battle" onclick="setMode('battle')">⚔️ Single comparison</button>
<button data-mode="tests" onclick="setMode('tests')">🧪 Test suite (${testCount})</button>
<button type="button" onclick="window.open('/jev/carrinho','_blank','noopener')">🛒 Self driving cart</button>
<button type="button" onclick="window.open('/jev/labs','_blank','noopener')">✹ JEV Labs</button>
</div>

<div id="modeRace" style="display:block">
  <p class="mode-help">Race sends the same incident and ordered typed question set to Jev and the LLM in parallel. Jev returns typed judgments; the LLM generates JSON that is validated against the same schema. Different workloads limit direct speed and cost conclusions.</p>
  <div class="race-controls">
    <label for="raceInput">Incident sent to both engines</label>
    <textarea id="raceInput" spellcheck="false">${html(RACE_EXAMPLE)}</textarea>
    <label for="raceModel">LLM model</label>
    <select id="raceModel">${modelOptions}</select>
    <button id="raceRun" onclick="runRace()">▶ Run race</button>
  </div>
  <div class="race-summary" id="raceSummary" aria-live="polite">Same 27 questions · same order · waiting</div>
  <div class="race-panels">
    <section class="race-panel"><header><span>— JEV —</span><span id="raceJevStatus">waiting</span></header>
      <div class="race-meta" id="raceJevMeta">Model and measurements appear after execution.</div>
      <pre id="raceJevOutput">{}</pre><footer id="raceJevFoot">time — · cost —</footer></section>
    <section class="race-panel"><header><span>— LLM —</span><span id="raceLlmStatus">waiting</span></header>
      <div class="race-meta" id="raceLlmMeta">Model and measurements appear after execution.</div>
      <pre id="raceLlmOutput">{}</pre><footer id="raceLlmFoot">time — · cost —</footer></section>
  </div>
  <details class="race-questions"><summary>Edit the 27 typed questions · shared JSON and preserved order</summary>
    <textarea id="raceQuestions" spellcheck="false">${raceQuestions}</textarea>
  </details>
</div>

<div id="modeBattle" style="display:none">
<p class="mode-help">Single comparison: Jev classifies the request with typed Choice, Noul and Score outputs; the LLM writes a free-form answer. Jev judgments appear after its response, while LLM text streams only when the provider emits real deltas.</p>
<div class="presets">
<button class="preset" data-q="Classify this ticket: order 1234 has not arrived and I urgently want a refund">🎫 Classify ticket</button>
<button class="preset" data-q="Is this email spam: Congratulations! You won a cash prize. Click now!">📧 Detect spam</button>
<button class="preset" data-q="Check whether this claim is supported by the supplied evidence">⚖️ Check claim</button>
<button class="preset" data-q="What is the priority of an enterprise customer reporting a production bug?">🚨 Prioritize incident</button>
<button class="preset" data-q="Analyze sentiment: delivery was fast but the product arrived damaged">💭 Mixed sentiment</button>
<button class="preset" data-q="How do I configure DNS for my domain?">🔀 Route request</button>
</div>
<div class="input-bar">
<textarea id="q" placeholder="Enter the request for both engines…" rows="2"></textarea>
<select id="model">
<option value="">— choose an LLM —</option>
${modelOptions}
</select>
<button class="run" id="runBtn" onclick="battle()">⚔️ Compare</button>
</div>
<label style="display:flex;align-items:center;gap:7px;color:var(--tx2);font-size:11px;margin:-8px 0 13px"><input id="qualityOptIn" type="checkbox">Optional second Jev call to judge text relevance and clarity · additional cost may apply; factual accuracy remains unverified</label>

<div class="arena">
<div class="fighter jev" id="fJev">
<div class="f-head"><div class="f-avatar">J</div><div><div class="f-name" id="jevName">JEV · System One</div><div class="f-desc">typed judgment · explicit source</div></div><div class="f-timer"><div class="ms" id="msJev">—</div><div class="lbl">ms</div></div></div>
<div class="f-body" id="bodyJev"><div class="waiting">waiting…</div></div>
<div class="f-metrics">
<div class="metric"><span>cost</span><b id="costJev">—</b></div>
<div class="metric"><span>tokens in</span><b id="tinJev">—</b></div>
<div class="metric"><span>tokens out</span><b id="toutJev">—</b></div>
<div class="metric"><span>judgments</span><b id="nJev">—</b></div>
</div>
</div>
<div class="fighter llm" id="fLlm">
<div class="f-head"><div class="f-avatar">L</div><div><div class="f-name" id="llmName">LLM</div><div class="f-desc">text generation</div></div><div class="f-timer"><div class="ms" id="msLlm">—</div><div class="lbl">ms</div></div></div>
<div class="f-body" id="bodyLlm"><div class="waiting">waiting…</div></div>
<div class="f-metrics">
<div class="metric"><span>cost</span><b id="costLlm">—</b></div>
<div class="metric"><span>tokens in</span><b id="tinLlm">—</b></div>
<div class="metric"><span>tokens out</span><b id="toutLlm">—</b></div>
<div class="metric"><span>tok/s</span><b id="tpsLlm">—</b></div>
</div>
</div>
</div>

<div class="comparison" id="comparison">
<div class="comp-title">📊 Measured comparison</div>
<div class="comp-grid">
<div class="comp-card"><b id="cSpeed" style="color:var(--cyan)">—</b><span>latency ratio LLM/Jev</span></div>
<div class="comp-card"><b id="cCost" style="color:var(--ok)">—</b><span>cost ratio LLM/Jev</span></div>
<div class="comp-card"><b id="cDiff" style="color:var(--warn)">typed × text</b><span>different operations</span></div>
</div>
<div class="comp-verdict" id="cVerdict"></div>
</div>

<div id="qualitySection" style="display:none;background:var(--bg2);border:1px solid var(--bdr);border-radius:14px;padding:16px;margin-bottom:14px">
<div style="font:800 10px var(--mono);letter-spacing:.12em;color:var(--tx3);text-transform:uppercase;margin-bottom:12px">🎯 Text relevance and clarity · optional Jev judgment, factual accuracy unverified</div>
<div style="display:grid;grid-template-columns:260px 1fr;gap:16px;align-items:center">
<div><svg id="radarChart" width="240" height="240" viewBox="0 0 260 260"></svg></div>
<div>
<div id="qDetails"></div>
<div style="margin-top:12px;text-align:center">
<span style="font:600 9px var(--mono);color:var(--tx3);text-transform:uppercase">score composto</span>
<div style="font:800 32px var(--mono);margin-top:2px" id="qScore">—</div>
<div style="font:700 10px var(--mono);margin-top:2px" id="qVerdict2"></div>
</div>
</div>
</div>
</div>
</div><!-- /modeBattle -->

<div class="tests-section" id="modeTests">
<p class="mode-help">Test suite: fixed synthetic inputs and expected outputs score both engines. This is a fixture score, not a general accuracy estimate. Open a test to inspect each input, expected value, prompt, raw answer and measurement.</p>
<div style="font:800 10px var(--mono);letter-spacing:.12em;color:var(--tx3);text-transform:uppercase;margin-bottom:10px">🧪 Select a fixture suite to run Jev and the LLM</div>
<label for="testModel" style="display:block;font:700 11px var(--mono);color:var(--tx2);margin-bottom:6px">LLM model for tests</label>
<select id="testModel" style="width:min(100%,420px);margin-bottom:12px">${modelOptions}</select>
<div id="testList">loading…</div>
<p class="note">Each case shows input, typed questions or LLM prompt, raw output, source, latency, tokens and cost when known.</p>
</div>

<p class="note">TypeSafe requires TYPESAFE_API_KEY. Laya uses the selected local Python and checkpoint. No engine fallback occurs. Local hardware cost is not measured.</p>
<details class="trace"><summary>Execution log</summary><label><input id="traceFullContent" type="checkbox"> Include raw content in future traces (may contain sensitive data)</label> <button type="button" id="traceDownload">Download sanitized trace</button><pre id="executionTrace">Run a mode to inspect provenance and measurements. Raw content is hidden by default.</pre></details>

<script>
const $=function(id){return document.getElementById(id);};
const esc=function(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
let timerInt=null;
let battleStatus=null;
function selectedEngine(){return $('jevEngine').value;}
function redactTrace(value){
  const full=$('traceFullContent').checked;
  return JSON.stringify(value,(key,item)=>{
    if(/^(?:api_?key|password|secret|authorization|access_?token|refresh_?token)$/i.test(key))return '[redacted]';
    if(key==='questions'&&item&&typeof item==='object'&&!full)
      return Object.fromEntries(Object.entries(item).map(([id,q])=>[id,{type:q?.type||'unknown'}]));
    if(!full&&/^(?:incident|questao|input|prompt|content|resposta|respostas|texto|raw|rawJev|answers|token|valor)$/i.test(key))
      return '[raw content hidden]';
    if(!full&&/^(?:error|message|reason|detail|details)$/i.test(key))return '[error details hidden; inspect status]';
    return typeof item==='string'?item
      .replace(/\\b(?:sk-|ts_)[A-Za-z0-9_-]{12,}\\b/g,'[redacted-token]')
      .replace(/Bearer\\s+[A-Za-z0-9._~-]{12,}/gi,'Bearer [redacted-token]')
      .replace(/\\b(api[_-]?key|token|password|secret)\\s*[:=]\\s*[A-Za-z0-9._-]{8,}/gi,'$1: [redacted]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi,'[redacted-email]'):item;
  },2);
}
function setTrace(value){$('executionTrace').textContent=redactTrace(value);}
$('traceDownload').addEventListener('click',()=>{
  const link=document.createElement('a');
  link.href=URL.createObjectURL(new Blob([$('executionTrace').textContent],{type:'application/json'}));
  link.download='jev-arena-trace.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
});
async function refreshEngineStatus(){
  $('engineStatus').innerHTML='<span class="dynamic-label">Checking availability…</span>';
  localizeRendered([...$('engineStatus').querySelectorAll('.dynamic-label')]);
  try{
    const response=await fetch('/api/jev/battle/status');
    if(!response.ok)throw new Error('status HTTP '+response.status);
    battleStatus=await response.json();
    const selected=selectedEngine()==='laya-local'?battleStatus.laya:battleStatus.typesafe;
    const label=text=>'<span class="dynamic-label">'+esc(text)+'</span>';
    const raw=value=>'<code>'+esc(value)+'</code>';
    let status='';
    if(selectedEngine()==='laya-local'){
      if(selected.disponivel){
        const knownState={'calibrated':'Legacy calibration record; quality not verified',
          'record-present-quality-unverified':'Calibration record present; quality not verified',
          'validated-noul-only':'Noul temperature validated; overall quality not verified',
          'discovered-un-calibrated':'Calibration unverified',
          'unavailable':'Unavailable','off':'Off'}[selected.estado];
        const ecePair=(name,metrics)=>Number.isFinite(metrics?.ece_antes)&&Number.isFinite(metrics?.ece_depois)
          ?' · '+label(name)+' '+raw(metrics.ece_antes.toFixed(3)+' → '+metrics.ece_depois.toFixed(3)) : '';
        const standardMetric=selected.metric_version==='top-label-ece-v1';
        const permitted=selected.temperaturasPermitidas;
        status=label('Available')+' · '+(selected.modelo?label('Checkpoint:')+' '+raw(selected.modelo):label('Checkpoint unknown'))
          +' · '+(knownState?label('Calibration:')+' '+label(knownState)
            :selected.estado?label('Calibration state (raw):')+' '+raw(selected.estado):label('Calibration unknown'))
          +(selected.motivoCalibracao?' · '+label('Gate reason:')+' '+raw(selected.motivoCalibracao):'')
          +ecePair(standardMetric?'Real top-label ECE before → after:':'Legacy invalid ECE calculation (real):',selected.validacao?.real)
          +ecePair(standardMetric?'Holdout top-label ECE before → after:':'Legacy invalid ECE calculation (holdout):',selected.validacao?.sintetico_holdout)
          +' · '+(permitted?.noul!=null
            ?label('Eligible Noul T override (runtime use unconfirmed):')+' '+raw(permitted.noul)
            :label('No calibration override; native model defaults retained'))
          +' · '+(selected.python?label('Python:')+' '+raw(selected.python):label('Python not reported'));
      }else status=label('Unavailable')+' · '+(selected.error
        ?label('Raw diagnostic:')+' '+raw(selected.error):label('Python/Laya not found'));
    }else status=selected.available?label('Configured · TypeSafe API (remote execution unverified)')
      :label('Unavailable')+' · '+(/key|chave|TYPESAFE_API_KEY/i.test(selected.reason||'')
        ?label('TypeSafe API key missing')
        :selected.reason?label('Raw diagnostic:')+' '+raw(selected.reason):label('TypeSafe API key missing'));
    $('engineStatus').innerHTML=status;
    localizeRendered([...$('engineStatus').querySelectorAll('.dynamic-label')]);
  }catch(error){$('engineStatus').innerHTML='<span class="dynamic-label">Status unavailable</span> · <span class="dynamic-label">Raw diagnostic:</span> <code>'+esc(error.message)+'</code>';localizeRendered([...$('engineStatus').querySelectorAll('.dynamic-label')]);}
}
$('jevEngine').addEventListener('change',refreshEngineStatus);
$('engineRefresh').addEventListener('click',refreshEngineStatus);

// Capture visible interface copy once. User input, schemas, model IDs and run output stay untouched.
const staticUiNodes=[];
const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
while(walker.nextNode()){
  const node=walker.currentNode, parent=node.parentElement;
  if(!parent||parent.closest('script,style,textarea,input,select,option,pre,code,#testList,#executionTrace,#bodyJev,#bodyLlm,#raceJevOutput,#raceLlmOutput'))continue;
  const source=node.nodeValue;
  if(source.trim())staticUiNodes.push({node,source});
}
const staticUiAttributes=[
  {element:$('q'),attr:'placeholder',source:$('q').getAttribute('placeholder')},
  {element:$('uiLanguage'),attr:'aria-label',source:$('uiLanguage').getAttribute('aria-label')},
  ...[...document.querySelectorAll('.preset')].map(element=>({element,attr:'data-q',source:element.getAttribute('data-q')})),
];
let localeRequest=0;
const dynamicUiSources=new Map();
async function loadLanguages(){
  try{
    const response=await fetch('/api/translate/languages');
    if(!response.ok)throw new Error('languages HTTP '+response.status);
    const data=await response.json();
    const select=$('uiLanguage');
    select.replaceChildren();
    for(const language of data.languages||[]){
      const option=document.createElement('option');
      option.value=language.code;option.textContent=(language.native||language.name)+' · '+language.code;
      select.appendChild(option);
    }
    if(![...select.options].some(option=>option.value==='en')){
      const option=document.createElement('option');option.value='en';option.textContent='English · en';select.prepend(option);
    }
    let remembered='en';
    try{remembered=new URL(location.href).searchParams.get('lang')||localStorage.getItem('jevArenaLanguage')||'en';}catch{}
    select.value=[...select.options].some(option=>option.value===remembered)?remembered:'en';
    if(select.value!=='en')await setLanguage(select.value);
  }catch(error){$('engineStatus').textContent+=' · language list unavailable: '+error.message;}
}
async function setLanguage(code){
  const requestId=++localeRequest;
  if(code==='en'){
    staticUiNodes.forEach(entry=>{entry.node.nodeValue=entry.source;});
    staticUiAttributes.forEach(entry=>entry.element.setAttribute(entry.attr,entry.source));
    document.documentElement.lang='en';document.documentElement.dir='ltr';
    await applyDynamicLanguage('en',requestId);return;
  }
  const entries=staticUiNodes.concat(staticUiAttributes).filter(entry=>entry.source.trim());
  const translated=[];
  try{
    for(let index=0;index<entries.length;index+=100){
      const batch=entries.slice(index,index+100);
      const response=await fetch('/api/translate/batch',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({texts:batch.map(entry=>entry.source.trim()),from:'en',to:code})});
      const data=await response.json();
      if(requestId!==localeRequest)return;
      if(!response.ok||!Array.isArray(data.translations)||data.translations.length!==batch.length)
        throw new Error(data.error||'translation response invalid');
      translated.push(...data.translations);
    }
    if(requestId!==localeRequest)return;
    entries.forEach((entry,index)=>{
      const value=entry.source.replace(entry.source.trim(),translated[index]);
      if(entry.node)entry.node.nodeValue=value;else entry.element.setAttribute(entry.attr,value);
    });
    const language=[...$('uiLanguage').options].find(option=>option.value===code);
    document.documentElement.lang=code;
    document.documentElement.dir=/^(ar|fa|he|ur|ug)(-|$)/.test(code)?'rtl':'ltr';
    $('uiLanguage').title=language?.textContent||code;
    await applyDynamicLanguage(code,requestId);
  }catch(error){if(requestId===localeRequest)$('engineStatus').textContent+=' · translation unavailable: '+error.message;}
}
$('uiLanguage').addEventListener('change',event=>{
  const code=event.target.value;
  try{localStorage.setItem('jevArenaLanguage',code);const url=new URL(location.href);
    url.searchParams.set('lang',code);history.replaceState(null,'',url);}catch{}
  setLanguage(code);
});
loadLanguages();
refreshEngineStatus();

async function applyDynamicLanguage(code,epoch,elements=[...dynamicUiSources.keys()]){
  const snapshot=elements.filter(element=>element?.isConnected&&dynamicUiSources.get(element)?.trim())
    .map(element=>({element,text:dynamicUiSources.get(element)}));
  if(code==='en'){
    snapshot.forEach(entry=>{if(dynamicUiSources.get(entry.element)===entry.text)entry.element.textContent=entry.text;});
    return;
  }
  if(!snapshot.length)return;
  try{
    for(let index=0;index<snapshot.length;index+=100){
      const batch=snapshot.slice(index,index+100);
      const response=await fetch('/api/translate/batch',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({texts:batch.map(entry=>entry.text),from:'en',to:code})});
      const data=await response.json();
      if(!response.ok||!Array.isArray(data.translations)||data.translations.length!==batch.length)return;
      if(epoch!==localeRequest||$('uiLanguage').value!==code)return;
      batch.forEach((entry,i)=>{if(dynamicUiSources.get(entry.element)===entry.text)entry.element.textContent=data.translations[i];});
    }
  }catch{}
}
async function localizeRendered(elements){
  const targets=elements.filter(Boolean);
  targets.forEach(element=>dynamicUiSources.set(element,element.textContent));
  await applyDynamicLanguage($('uiLanguage').value,localeRequest,targets);
}

function raceCost(side){
  if(side.costUsd==null)return 'cost — ('+(side.costSource==='local-compute-unmeasured'?'local compute unmeasured':'unavailable')+')';
  return 'cost '+fmtUsd(side.costUsd)+' · '+(side.costSource==='provider'?'provider-reported':'catalog estimate');
}
function renderRaceSide(prefix,side){
  $(prefix+'Status').textContent=side.ok?'complete':'unavailable / invalid';
  const field=(label,value)=>'<span class="race-meta-label">'+esc(label)+'</span> '+esc(value??'—');
  $(prefix+'Meta').innerHTML=field('source:',side.source)+' · '+field('backend reported:',side.backend||'not reported')
    +(side.requestedBackend?' · '+field('requested route:',side.requestedBackend):'')+'<br>'
    +field('model:',side.model)+(side.modelBasis?' ('+esc(side.modelBasis)+')':'')+'<br>'
    +field('valid answers:',side.answered||0)+(side.error?'<br>'+field('error:',side.error):'')
    +' · '+field('engine:',side.engine)+' · '+field('execution:',side.executionKind)
    +(side.calibration?' · '+field('calibration:',side.calibration.state)+' · '+esc(side.calibration.caveat):'');
  $(prefix+'Output').textContent=typeof side.raw==='string'?side.raw:'{\\n'+Object.entries(side.raw||{}).map(function(entry){return '  '+JSON.stringify(entry[0])+': '+JSON.stringify(entry[1]);}).join(',\\n')+'\\n}';
  $(prefix+'Foot').textContent='time '+(side.latencyMs==null?'—':side.latencyMs+' ms')+' · '+raceCost(side)+' · tokens in/out '+(side.inputTokens??'—')+'/'+(side.outputTokens??'—');
  localizeRendered([$(prefix+'Status'),$(prefix+'Foot'),...$(prefix+'Meta').querySelectorAll('.race-meta-label')]);
}
async function runRace(){
  const button=$('raceRun');
  let questions;
  try{questions=JSON.parse($('raceQuestions').value);}catch(error){$('raceSummary').innerHTML='<span>Invalid question JSON:</span> '+esc(error.message);localizeRendered([...$('raceSummary').querySelectorAll('span')]);return;}
  button.disabled=true;
  $('raceSummary').textContent='Running the same '+Object.keys(questions).length+' questions in parallel…';
  $('raceJevStatus').textContent='running';$('raceLlmStatus').textContent='running';
  localizeRendered([$('raceSummary'),$('raceJevStatus'),$('raceLlmStatus')]);
  try{
    const input={incident:$('raceInput').value,questions,model:$('raceModel').value,jevEngine:selectedEngine()};
    const response=await fetch('/api/jev/battle/race',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'race failed');
    renderRaceSide('raceJev',data.jev);renderRaceSide('raceLlm',data.llm);
    setTrace({mode:'race',request:input,response:data});
    const speed=data.comparison?.speedRatio;
    const cost=data.comparison?.costRatio;
    $('raceSummary').textContent='Same '+data.questionCount+' questions · same order · latency ratio LLM/Jev '+(speed==null?'unavailable':speed.toFixed(1)+'×')+' · cost ratio '+(cost==null?'unavailable':cost.toFixed(1)+'×');
    localizeRendered([$('raceSummary')]);
  }catch(error){$('raceSummary').innerHTML='<span>Failed:</span> '+esc(error.message);$('raceJevStatus').textContent='error';$('raceLlmStatus').textContent='error';setTrace({mode:'race',error:error.message});localizeRendered([...$('raceSummary').querySelectorAll('span'),$('raceJevStatus'),$('raceLlmStatus')]);}
  finally{button.disabled=false;}
}

// ===== MODE SWITCH =====
function setMode(m){
document.body.classList.toggle('race-mode',m==='race');
document.querySelectorAll('.mode-switch button').forEach(function(b){b.classList.toggle('on',b.dataset.mode===m);});
$('modeRace').style.display=m==='race'?'block':'none';
$('modeBattle').style.display=m==='battle'?'block':'none';
$('modeTests').classList.toggle('show',m==='tests');
}
// ===== PRESETS =====
document.querySelectorAll('.preset').forEach(function(b){
b.addEventListener('click',function(){$('q').value=b.dataset.q||'';$('q').focus();});
});

// ===== BATTLE (SSE streaming) =====
let llmText='';
let battleLog=[];
function startTimers(){
$('msJev').textContent='0';$('msJev').classList.add('running');
$('msLlm').textContent='0';$('msLlm').classList.add('running');
const t0=performance.now();
timerInt=setInterval(function(){
const el=Math.round(performance.now()-t0);
if($('msJev').classList.contains('running'))$('msJev').textContent=el;
if($('msLlm').classList.contains('running'))$('msLlm').textContent=el;
},50);
}
function stopTimer(side,ms){const el=$(side==='jev'?'msJev':'msLlm');el.classList.remove('running');el.textContent=ms!=null?String(Math.round(ms)):'—';}
function fmtUsd(v){if(v==null||!isFinite(v))return '—';if(v<0.001)return '$'+v.toFixed(6);return '$'+v.toFixed(4);}
function fill(t){$('q').value=t;$('q').focus();}
function renderJev(j){
stopTimer('jev',j.latencyMs);
$('jevName').textContent='JEV · '+(j.model||'System One');
if(!j.ok){$('bodyJev').innerHTML='<div class="error">'+esc(j.error||'JEV failed')+'</div>';return;}
if(j.rawJev){
$('bodyJev').innerHTML='<pre style="background:var(--bg3);border-radius:10px;padding:12px;font:500 11px var(--mono);color:var(--cyan);overflow:auto;max-height:300px;white-space:pre-wrap;margin:0">'+esc(JSON.stringify(j.rawJev,null,2))+'</pre>';
}else{
const rows=Object.entries(j.respostas||{}).map(function(pair){
const qid=pair[0];const a=pair[1];
let val='',cls='',bar='';
if(typeof a==='object'&&a.tipo==='noul'){val=Math.round(a.valor*100)+'%';cls='noul';bar='<div class="bar"><div class="bar-fill" style="width:'+Math.round(a.valor*100)+'%"></div></div>';}
else if(typeof a==='object'&&a.tipo==='choice'){val=a.valor;cls='choice';}
else if(typeof a==='number'){val=a;cls='score';}
else{val=JSON.stringify(a);cls='';}
return '<div class="typed-row"><span class="k">'+esc(qid)+'</span><span class="v '+cls+'">'+esc(val)+'</span>'+bar+'</div>';
}).join('');
$('bodyJev').innerHTML='<div class="typed">'+rows+'</div>';
}
$('costJev').textContent=fmtUsd(j.custoUsd);
$('costJev').title=j.costSource||'cost unavailable';
$('tinJev').textContent=j.inputTokens??'—';
$('toutJev').textContent=j.outputTokens??'—';
$('nJev').textContent=Object.keys(j.respostas||{}).length;
}
function renderLlm(l,model){
stopTimer('llm',l.latencyMs);
$('llmName').textContent=l.model?'LLM · '+l.model:'LLM · '+model;
if(!l.ok){$('bodyLlm').innerHTML='<div class="error">'+esc(l.error||'LLM failed')+'</div>';return;}
$('bodyLlm').innerHTML='<div class="llm-text">'+esc(l.resposta||'')+'</div>';
$('costLlm').textContent=fmtUsd(l.custoUsd);
$('costLlm').title=l.costSource||'cost unavailable';
$('tinLlm').textContent=l.inputTokens??'—';
$('toutLlm').textContent=l.outputTokens??'—';
$('tpsLlm').textContent=l.tokensPerSecond??'—';
}

async function battle(){
const q=$('q').value.trim();const model=$('model').value;
if(!q){$('q').focus();return;}
if(!model){alert('Choose an LLM model');return;}
$('runBtn').disabled=true;$('runBtn').textContent='⚔️ comparing…';
$('bodyJev').innerHTML='<div class="waiting">⚡ judging…</div>';
$('bodyLlm').innerHTML='<div class="llm-text"><span class="cursor"></span></div>';
$('comparison').classList.remove('show');
$('qualitySection').style.display='none';$('radarChart').innerHTML='';$('radarChart').style.display='';
$('qDetails').textContent='';$('qScore').textContent='—';$('qVerdict2').textContent='';
$('fJev').classList.remove('winner');$('fLlm').classList.remove('winner');
llmText='';
battleLog=[];
startTimers();
try{
const request={questao:q,model:model,jevEngine:selectedEngine(),quality:$('qualityOptIn').checked};
setTrace({mode:'battle',request,status:'running'});
const r=await fetch('/api/jev/battle/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
if(!r.ok)throw new Error('battle HTTP '+r.status);
const reader=r.body.getReader();const dec=new TextDecoder();
let buf='',ev='';
while(true){
const {done,value}=await reader.read();if(done)break;
buf+=dec.decode(value,{stream:true});
const lines=buf.split('\\n');buf=lines.pop()||'';
for(const line of lines){
const t=line.trim();
if(t.startsWith('event: ')){ev=t.slice(7);continue;}
if(!t.startsWith('data: '))continue;
let d;try{d=JSON.parse(t.slice(6));}catch{continue;}
renderEvent(ev,d);
battleLog.push(JSON.parse(redactTrace({event:ev,data:d})));
setTrace({mode:'battle',request,events:battleLog});
if(ev==='comparativo'&&d.qualidade&&d.qualidade.dimensoes)renderRadar(d.qualidade);
}
}
}catch(e){$('bodyJev').textContent='Battle failed: '+e.message;setTrace({mode:'battle',error:e.message});}
$('runBtn').disabled=false;$('runBtn').textContent='⚔️ Compare';
clearInterval(timerInt);
}
function renderEvent(ev,d){
if(ev==='jev_judgment'){
let val='',cls='';
if(d.tipo==='noul'){val=Math.round(d.valor*100)+'%';cls='noul';}
else{val=d.valor;cls=d.tipo;}
const bar=d.tipo==='noul'?'<div class="bar"><div class="bar-fill" style="width:'+Math.round(d.valor*100)+'%"></div></div>':'';
const body=$('bodyJev');
if(body.querySelector('.waiting'))body.innerHTML='<div class="typed"></div>';
body.querySelector('.typed').insertAdjacentHTML('beforeend','<div class="typed-row"><span class="k">'+esc(d.qid)+'</span><span class="v '+cls+'">'+esc(val)+'</span>'+bar+'</div>');
}
else if(ev==='jev_done'){
stopTimer('jev',d.latencyMs);
$('jevName').textContent='JEV ['+(d.source||d.engine||'unavailable')+'] · '+(d.model||'model unavailable');
$('costJev').textContent=fmtUsd(d.custoUsd);
$('costJev').title=d.costSource||'cost unavailable';
$('tinJev').textContent=d.inputTokens??'—';
$('toutJev').textContent=d.outputTokens??'—';
$('nJev').textContent=Object.keys(d.respostas||{}).length;
if(!d.ok){$('bodyJev').innerHTML='<div class="error">'+esc(d.error||'Jev failed')+'</div>';return;}
if(d.rawJev){
  var jsonStr=JSON.stringify(d.rawJev,null,2);
  $('bodyJev').innerHTML='<pre style="background:var(--bg3);border-radius:10px;padding:12px;font:500 11px var(--mono);overflow:auto;max-height:320px;white-space:pre-wrap;margin:0;color:#aaa">'+esc(jsonStr)+'</pre>';
}
}
else if(ev==='llm_token'){
llmText+=d.token;
const body=$('bodyLlm');
if(body.querySelector('.waiting'))body.innerHTML='<div class="llm-text"><span class="cursor"></span></div>';
body.querySelector('.llm-text').innerHTML=esc(llmText)+'<span class="cursor"></span>';
}
else if(ev==='llm_done'){
stopTimer('llm',d.latencyMs);
$('llmName').textContent='LLM · '+(d.model||$('model').value||'unavailable');
$('costLlm').textContent=fmtUsd(d.custoUsd);
$('costLlm').title=d.costSource||'cost unavailable';
$('tinLlm').textContent=d.inputTokens??'—';
$('toutLlm').textContent=d.outputTokens??'—';
$('tpsLlm').textContent=d.tokensPerSecond??'—';
if(!d.ok)$('bodyLlm').innerHTML='<div class="error">'+esc(d.error||'LLM failed')+'</div>';
else $('bodyLlm').innerHTML='<div class="llm-text">'+esc(d.resposta||'')+'</div>';
}
else if(ev==='comparativo'){
$('comparison').classList.add('show');
$('cSpeed').textContent=d.velocidadeVantagem!=null?d.velocidadeVantagem+'×':'—';
$('cCost').textContent=d.custoVantagem!=null?d.custoVantagem+'×':'—';
$('cVerdict').textContent=d.veredicto||(d.qualityCall?'Additional Jev call: '+d.qualityCall.status+' · cost '+fmtUsd(d.qualityCall.costUsd):'');
localizeRendered([$('cVerdict')]);
}
else if(ev==='sim_done'||ev==='battle_done'){
clearInterval(timerInt);
}
else if(ev==='error'){
$('bodyJev').innerHTML='<div class="error">'+esc(d.message||'error')+'</div>';
}
}

// ===== SUITE DE TESTES =====
let TESTES=[];
const TEST_META_EN={
  'classificacao-ticket':['🎫 Ticket classification','Route 8 tickets into four categories with typed Jev Choice and LLM text parsing.'],
  'deteccao-spam':['📧 Spam detection','14 contextual messages with legitimate, advertising and scam boundaries.'],
  'analise-sentimento':['💭 Sentiment analysis','8 short phrases with fixed sentiment labels.'],
  'priorizacao-incidentes':['🚨 Incident priority','6 IT incidents scored from 0 to 4.'],
  'moderacao-conteudo':['🛡️ Content moderation','8 messages with block, warn or allow fixtures.'],
  'extracao-entidades':['🔍 Entity extraction','Extract amount, date and product from short texts.'],
  'verificacao-alegacoes':['⚖️ Claim checking','Compare claims with supplied evidence and allow unknown.'],
  'roteamento-intencao':['🔀 Intent routing','Route 8 commands to the matching handler.'],
  'deteccao-injecao':['💉 Prompt injection detection','8 inputs, half with injection attempts.'],
  'calibracao-confianca':['📏 Confidence calibration','Contrast easy and impossible questions.'],
  'sniff-qualidade':['👃 Quality sniff test','Four criteria scored together.'],
  'deteccao-phishing':['🎣 Contextual phishing','8 messages with explicit context and safety actions.'],
  'vazamento-dados':['🔐 Data exposure','8 publication and sharing cases with protective actions.'],
  'fraude-cobranca':['💳 Billing triage','8 reports distinguish fraud indicators from operational errors.'],
  'triagem-resgate':['🚑 Rescue triage','8 synthetic calls scored by priority and response team; no real dispatch.'],
};
async function loadTests(){
try{
TESTES=await(await fetch('/api/jev/battle/tests')).json();
const list=$('testList');list.innerHTML='';
TESTES.forEach(function(t,ti){
const copy=TEST_META_EN[t.id]||[t.nome,t.descricao];
const card=document.createElement('div');card.className='test-card';card.id='tc-'+t.id;
const head=document.createElement('div');head.className='tc-head';
head.innerHTML='<span class="tc-nome">'+esc(copy[0])+'</span><span class="tc-cat pill">'+esc(t.categoria)+'</span>';
const desc=document.createElement('div');desc.className='tc-desc';desc.textContent=copy[1];
const result=document.createElement('div');result.className='tc-result';result.id='tr-'+t.id;
card.appendChild(head);card.appendChild(desc);card.appendChild(result);
card.addEventListener('click',function(event){if(!event.target.closest('details'))runTest(ti);});
list.appendChild(card);
for(const element of [head.querySelector('.tc-nome'),head.querySelector('.tc-cat'),desc])
  if(element?.firstChild?.nodeType===Node.TEXT_NODE)staticUiNodes.push({node:element.firstChild,source:element.firstChild.nodeValue});
});
if($('uiLanguage').value!=='en')await setLanguage($('uiLanguage').value);
}catch(e){$('testList').textContent='Failed to load test suites';localizeRendered([$('testList')]);}
}
async function runTest(testIndex){
const t=TESTES[testIndex];if(!t)return;
const card=document.getElementById('tc-'+t.id);if(!card)return;
const out=document.getElementById('tr-'+t.id);
card.classList.add('running');
out.innerHTML='<span style="color:var(--tx3)">⏳ running…</span>';
localizeRendered([...out.querySelectorAll('span')]);
try{
const request={testId:t.id,model:$('testModel').value,jevEngine:selectedEngine()};
const r=await fetch('/api/jev/battle/test-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
const d=await r.json();
setTrace({mode:'tests',request,response:d});
if(d.error){out.innerHTML='<span style="color:var(--err)">✗ <span>Failed:</span> '+esc(d.error)+'</span>';localizeRendered([...out.querySelectorAll('span span')]);return;}
const j=d.jev,l=d.llm;
const jAcc=j.acuracia!=null?(j.acuracia*100).toFixed(0)+'%':'—';
const lAcc=l.acuracia!=null?(l.acuracia*100).toFixed(0)+'%':'—';
const jMs=j.latenciaMediaMs!=null?j.latenciaMediaMs+'ms':'—';
const lMs=l.latenciaMediaMs!=null?l.latenciaMediaMs+'ms':'—';
out.innerHTML='<div class="tc-compare">'+
'<div class="tc-side jev"><b>'+jAcc+'</b><span>fixture score</span></div>'+
'<div class="tc-side llm"><b>'+lAcc+'</b><span>fixture score</span></div>'+
'<div class="tc-side jev"><b>'+jMs+'</b><span>Jev latency</span></div>'+
'<div class="tc-side llm"><b>'+lMs+'</b><span>LLM latency</span></div>'+
'<div class="tc-verdict">'+(j.status==='partial'||l.status==='partial'?'Partial execution · inspect errors':d.eligibleForWinner&&j.acuracia!=null&&l.acuracia!=null?(j.acuracia===l.acuracia?'Fixture tie':j.acuracia>l.acuracia?'🏆 Jev higher fixture score':'🏆 LLM higher fixture score'):'Fixture scores only · no live winner')+'</div>'+
'</div>';
const details=document.createElement('details');details.style.marginTop='8px';
const summary=document.createElement('summary');summary.textContent='Inspect fixture inputs, answers and measurements';details.appendChild(summary);
const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;overflow:auto;max-height:330px;font:10px/1.5 var(--mono);padding:10px;background:var(--bg3);border-radius:8px';
pre.textContent=JSON.stringify({jev:{status:j.status,model:j.model,custoTotalUsd:j.custoTotalUsd,respostas:j.respostas},llm:{status:l.status,model:l.model,custoTotalUsd:l.custoTotalUsd,respostas:l.respostas}},null,2);
details.appendChild(pre);out.appendChild(details);
localizeRendered([...out.querySelectorAll('.tc-side span,.tc-verdict,details summary')]);
card.classList.remove('running');card.classList.add('done');
}catch(e){out.innerHTML='<span style="color:var(--err)">✗ <span>Failed:</span> '+esc(e.message)+'</span>';localizeRendered([...out.querySelectorAll('span span')]);card.classList.remove('running');}
}
loadTests();

// ===== RADAR CHART DE QUALIDADE =====
const DIM_LBL={relevancia:'Relevance',precisao:'Precision',completude:'Completeness',honestidade:'Honesty',clareza:'Clarity'};
function renderRadar(quality){
$('qualitySection').style.display='block';
const dims=quality.dimensoes||{};
const keys=Object.keys(dims);
const n=keys.length;
if(n<3){
  $('radarChart').style.display='none';
  $('qDetails').innerHTML=keys.map(k=>'<span class="qnome">'+esc(DIM_LBL[k]||k)+'</span>: '+Math.round((dims[k].score||0)*100)+'%').join(' · ');
  $('qScore').textContent=Math.round((quality.scoreComposto||0)*100)+'%';
  $('qVerdict2').textContent=quality.veredito||quality.scope||'';
  localizeRendered([...$('qDetails').querySelectorAll('.qnome'),$('qVerdict2')]);
  return;
}
const cx=130,cy=130,R=95;
let svg='';
for(let ring=1;ring<=3;ring++){
const r=R*ring/3;
const pts=keys.map(function(_,i){const ang=(i/n)*2*Math.PI-Math.PI/2;return (cx+r*Math.cos(ang)).toFixed(1)+','+(cy+r*Math.sin(ang)).toFixed(1);}).join(' ');
svg+='<polygon class="radar-grid" points="'+pts+'"/>';
}
keys.forEach(function(k,i){
const ang=(i/n)*2*Math.PI-Math.PI/2;
svg+='<line x1="'+cx+'" y1="'+cy+'" x2="'+(cx+R*Math.cos(ang)).toFixed(1)+'" y2="'+(cy+R*Math.sin(ang)).toFixed(1)+'" stroke="var(--bdr2)" stroke-width=".5"/>';
const lx=cx+(R+20)*Math.cos(ang),ly=cy+(R+20)*Math.sin(ang);
svg+='<text class="radar-lbl" x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'">'+(DIM_LBL[k]||k)+'</text>';
});
const pts=keys.map(function(k,i){
const sc=dims[k]?.score||0;const r=R*sc;
const ang=(i/n)*2*Math.PI-Math.PI/2;
return (cx+r*Math.cos(ang)).toFixed(1)+','+(cy+r*Math.sin(ang)).toFixed(1);
}).join(' ');
svg+='<polygon class="radar-poly" points="'+pts+'"/>';
keys.forEach(function(k,i){
const sc=dims[k]?.score||0;const r=R*sc;
const ang=(i/n)*2*Math.PI-Math.PI/2;
svg+='<circle class="radar-dot" cx="'+(cx+r*Math.cos(ang)).toFixed(1)+'" cy="'+(cy+r*Math.sin(ang)).toFixed(1)+'" r="3"/>';
});
$('radarChart').innerHTML=svg;
$('qDetails').innerHTML=keys.map(function(k){
const sc=dims[k]?.score||0;
const cor=sc>=0.7?'var(--ok)':sc>=0.4?'var(--warn)':'var(--err)';
return '<div class="q-row"><span class="qnome">'+(DIM_LBL[k]||k)+'</span><div class="qbar"><div class="qfill" style="width:'+Math.round(sc*100)+'%;background:'+cor+'"></div></div><span class="qscore" style="color:'+cor+'">'+Math.round(sc*100)+'%</span></div>';
}).join('');
$('qScore').textContent=Math.round(quality.scoreComposto*100)+'%';
$('qScore').style.color=quality.scoreComposto>=0.7?'var(--ok)':quality.scoreComposto>=0.4?'var(--warn)':'var(--err)';
$('qVerdict2').textContent=quality.veredicto||'';
$('qVerdict2').style.color=quality.scoreComposto>=0.6?'var(--ok)':'var(--warn)';
localizeRendered([...$('radarChart').querySelectorAll('.radar-lbl'),...$('qDetails').querySelectorAll('.qnome'),$('qVerdict2')]);
}
// ===== HOOK no renderEvent =====
const _origRenderEvent=renderEvent;
renderEvent=function(ev,d){
_origRenderEvent(ev,d);
if(ev==='comparativo'&&d.qualidade&&d.qualidade.dimensoes)renderRadar(d.qualidade);
};
</script>
</body>
</html>`;
}
