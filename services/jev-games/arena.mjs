// ============================================================================
// Fictional combat arena: explicit local simulation or opt-in Jev judgment.
// ============================================================================
import { JevClient, choiceQ, noulQ, scoreQ, isJevConfigured } from '../jev/client.mjs';

export const ROSTER = [
  { id: 'night-scout', nome: 'Night Scout', emoji: '🦇', desc: 'A tactical inventor who studies every rival before a match' },
  { id: 'sky-forge', nome: 'Sky Forge', emoji: '🤖', desc: 'An armored engineer with flight and defensive tools' },
  { id: 'ember-giant', nome: 'Ember Giant', emoji: '🦖', desc: 'A towering fictional creature with heat and heavy armor' },
  { id: 'star-runner', nome: 'Star Runner', emoji: '🥋', desc: 'A fast martial artist with short-range teleportation' },
  { id: 'bugprod', nome: 'Production Bug', emoji: '🐛', desc: 'Appears on Friday evening, invisible in staging' },
  { id: 'regex', nome: 'Regex Master', emoji: '🌀', desc: 'Matches nearly anything, including surprises' },
  { id: 'llm405', nome: 'Large Language Model', emoji: '🧠', desc: 'Broad knowledge, sometimes confidently wrong' },
  { id: 'jev', nome: 'Jev', emoji: '⚖️', desc: 'Typed judgments and probability outputs' },
  { id: 'carrinho', nome: 'Jev Cart', emoji: '🛒', desc: 'Drives with typed judgments and local emergency control' },
  { id: 'deadline', nome: 'Deadline', emoji: '⏰', desc: 'Arrives sooner than expected' },
];

function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function normalizarLutador(raw, fallbackNome = 'fighter') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('fighter must be an object');
  const text = (value, fallback, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '') || fallback;
  return { nome: text(raw.nome ?? raw.name, fallbackNome, 60),
    desc: text(raw.desc, 'No description', 300), emoji: text(raw.emoji, '⚔️', 8) };
}

/** Deterministic fiction, never a calibrated probability or real outcome. */
function lutaLocal(a, b) {
  const r = rng(seedOf(a.nome + '&vs&' + b.nome));
  const favorA = 0.5 + (seedOf(a.nome) % 23 - 11) / 100;
  const pa = Math.min(0.92, Math.max(0.08, favorA + (r() - 0.5) * 0.2));
  const vencedor = pa >= 0.5 ? 'a' : 'b';
  return {
    vencedor, source: 'local simulation',
    probabilidades: { a: Math.round(pa * 100) / 100, b: Math.round((1 - pa) * 100) / 100, empate: 0 },
    confianca: null, disputada: null, rounds: Math.floor(r() * 5),
    narrativa_curta: 'Deterministic fictional simulation', cost_usd_estimate: 0, latency_ms: null,
  };
}

function validUnit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function knownCost(res) { return Number.isFinite(res?.usage?.input_tokens) && res.usage.input_tokens >= 0
  && Number.isFinite(res?.costEstimateUsd) && res.costEstimateUsd >= 0 ? res.costEstimateUsd : null; }

/**
 * Judge a fictional match. `live:true` is required for an actual provider call.
 */
export async function fightJudge({ a: aRaw, b: bRaw, live = false } = {}, { client } = {}) {
  const a = normalizarLutador(aRaw, 'Challenger A');
  const b = normalizarLutador(bRaw, 'Challenger B');
  if (!live && !client) return { a, b, ...lutaLocal(a, b) };
  if (!client && !isJevConfigured()) throw new Error('Jev is unavailable; select local simulation or configure a provider');

  const jev = client || new JevClient({ timeoutMs: 8000 });
  let res;
  try { res = await jev.ask({
    state: {
      fighter_a: a.nome + ' — ' + a.desc,
      fighter_b: b.nome + ' — ' + b.desc,
      rules: 'fictional direct fight, neutral arena, no allies',
    },
    questions: {
      vencedor: choiceQ('In this fictional fight between fighter_a and fighter_b, who wins?', {
        a: 'Fighter A wins',
        b: 'Fighter B wins',
        empate: 'Draw: neither wins',
      }),
      disputada: noulQ('Would this fictional fight be close and competitive?'),
      rounds: scoreQ('How many rounds might this fictional fight last?', [
        '1 round: one-sided',
        '2 rounds: dominant with resistance',
        '3 rounds: balanced with a turning point',
        '4 rounds: long battle of attrition',
        '5 rounds: unlikely late reversal',
      ]),
    },
  }); } catch { throw new Error('Jev request failed'); }
  const v = res?.answers?.vencedor;
  const p = v?.probabilities;
  const round = res?.answers?.rounds;
  if (!['a', 'b', 'empate'].includes(v?.choice) || !validUnit(v?.confidence)
      || !p || Object.keys(p).length !== 3 || !['a','b','empate'].every(k => validUnit(p[k]))
      || Math.abs(p.a + p.b + p.empate - 1) > 0.02
      || !validUnit(res?.answers?.disputada?.noul)
      || typeof round?.score !== 'number' || !Number.isFinite(round.score) || round.score < 0 || round.score > 4) {
    throw new Error('Jev returned an invalid combat judgment');
  }
  return {
    a, b,
    vencedor: v.choice,
    source: 'jev', model: res.model ?? null,
    probabilidades: { a: p.a, b: p.b, empate: p.empate },
    confianca: v.confidence,
    disputada: res.answers.disputada.noul,
    rounds: round.score,
    rounds_legenda: round.legend ?? null,
    cost_usd_estimate: knownCost(res),
    latency_ms: Number.isFinite(res.latencyMs) && res.latencyMs >= 0 ? res.latencyMs : null,
  };
}
