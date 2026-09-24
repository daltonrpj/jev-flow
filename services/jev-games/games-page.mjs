import { pageShell, esc } from './shared.mjs';

const CSS = `
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:14px}
.game{display:block;text-decoration:none;background:linear-gradient(160deg,#18242b,#111a20);border:1px solid var(--line);border-radius:16px;padding:18px;color:var(--text);transition:transform .15s,border-color .15s,box-shadow .15s}
.game:hover{transform:translateY(-3px);border-color:var(--jev);box-shadow:0 8px 30px #0b2e2055}
.game .emoji{font-size:36px;margin-bottom:8px}
.game h3{margin:0 0 4px;font-size:15px}
.game p{margin:0;color:var(--muted);font-size:11.5px;line-height:1.5}
.game .tag{display:inline-block;margin-top:10px;font:700 9px ui-monospace,Consolas,monospace;letter-spacing:.08em;color:var(--jev);text-transform:uppercase}
`;

export function buildGamesPage({} = {}) {
  const games = [
    { emoji: '🛒', nome: 'Self-Driving Sim', desc: 'Drive with typed decisions and inspect the telemetry for each choice.', href: '/jev/carrinho', tag: 'driving' },
    { emoji: '❌⭕', nome: 'Tic-Tac-Toe vs Jev', desc: 'Play against local perfect minimax or opt into a typed Jev choice. See the cell probabilities when available.', href: '/jev/games/velha', tag: 'choice' },
    { emoji: '⚔️', nome: 'Combat Arena', desc: 'Judge a fictional matchup locally or with Jev. Live mode reports winner probabilities, a closeness score, and rounds.', href: '/jev/games/arena', tag: 'fictional match' },
    { emoji: '🏙️', nome: 'JevFlow City', desc: 'Advance a small city one tick at a time. Local mode is deterministic; live mode requests one decision batch per tick.', href: '/jev/games/city', tag: 'city simulation' },
    { emoji: '🧪', nome: 'Battle Arena', desc: 'Compare JEV and LLM responses to the same question set.', href: '/jev/battle', tag: 'comparison' },
    { emoji: '✹', nome: 'JEV Labs', desc: 'Explore interactive experiments with typed judgments.', href: '/jev/labs', tag: 'experiments' },
  ];
  const cards = games.map(g => `<a class="game" href="${esc(g.href)}"><div class="emoji">${esc(g.emoji)}</div><h3>${esc(g.nome)}</h3><p>${esc(g.desc)}</p><span class="tag">${esc(g.tag)} →</span></a>`).join('');
  const body = `<div class="cards">${cards}</div>`;
  return pageShell({
    title: '🎮 Jev Games', subtitle: 'Local simulation is the default. Live Jev calls require a deliberate opt-in and a configured provider.',
    body, extraCss: CSS,
    nav: '<a href="/jev/flows">Flows</a><a href="/jev">Jev Hub</a>',
  });
}
