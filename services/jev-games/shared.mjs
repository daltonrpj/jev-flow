// ============================================================================
// Shared shell for the standalone games.
// ============================================================================
export function esc(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function serializeForInlineScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

export const GAMES_CSS = `
:root{color-scheme:dark;--bg:#0d1418;--panel:#161f24;--panel2:#1d282e;--line:#2c3b41;--text:#e8f1f2;--muted:#94a7ab;--jev:#7ce0a3;--llm:#a48bff;--accent:#2587ed;--warn:#fbbf24;--danger:#ff8a82}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 70% -10%,#12222a,#0b1114 60%),#0b1114;color:var(--text);font:14px/1.45 Inter,Segoe UI,system-ui,sans-serif}
button,select,input{font:inherit}button{cursor:pointer;border:1px solid var(--line);border-radius:9px;padding:8px 14px;background:var(--panel2);color:var(--text)}
button:hover{border-color:var(--jev)}button.primary{background:linear-gradient(135deg,#1f9d5f,#178a4e);border:0;font-weight:800}
button:disabled{opacity:.45;cursor:wait}
.shell{max-width:1180px;margin:auto;padding:16px}
.top{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}.top h1{font-size:22px;margin:0;letter-spacing:-.03em}.top p{color:var(--muted);font-size:12px;margin:2px 0 0}
.links{margin-left:auto}.links a{color:#8fd0ff;text-decoration:none;margin-left:12px;font-size:12.5px}
.badge{display:inline-block;padding:3px 10px;border:1px solid #2f5c46;border-radius:20px;background:#10281d;color:var(--jev);font:700 11px ui-monospace,Consolas,monospace}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px}
.muted{color:var(--muted);font-size:11.5px}
.mono{font:11px ui-monospace,Consolas,monospace}
.log{display:grid;gap:6px;max-height:210px;overflow:auto;font:11px ui-monospace,Consolas,monospace}
.log-item{background:#101a1f;border:1px solid var(--line);border-radius:8px;padding:7px 9px;white-space:pre-wrap;overflow-wrap:anywhere}
.log-item small{color:var(--muted)}
@media(max-width:760px){.shell{padding:10px}}
`;

export function pageShell({ title, subtitle, body, script = '', extraCss = '', nav = '<a href="/jev/games">🎮 Games</a><a href="/jev/carrinho">Cart</a><a href="/jev/battle">Battle</a><a href="/jev/flows">Flows</a>' }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Jev Games</title><link rel="icon" href="/logo.svg" type="image/svg+xml">
<style>${GAMES_CSS}${extraCss}</style></head>
<body>
<main class="shell">
<header class="top"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><nav class="links">${nav}</nav></header>
${body}
</main>
<script>${script}</script>
</body></html>`;
}
