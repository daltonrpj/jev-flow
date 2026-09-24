// ============================================================================
// One typed decision batch per live tick; otherwise deterministic local policy.
// ============================================================================
import { JevClient, choiceQ, noulQ, isJevConfigured } from '../jev/client.mjs';

export const ACTIONS = {
  dormir: { local: 'casa', efeitos: { energia: 34, fome: -10, felicidade: 4 }, icone: '😴' },
  comer: { local: 'lanchonete', efeitos: { fome: 38, energia: 6, dinheiro: -8 }, icone: '🍜' },
  trabalhar: { local: 'escritorio', efeitos: { energia: -22, fome: -14, dinheiro: 26 }, icone: '💼' },
  passear: { local: 'praca', efeitos: { felicidade: 18, energia: -8, fome: -6 }, icone: '🌳' },
  socializar: { local: 'praca', efeitos: { felicidade: 24, energia: -6, fome: -8 }, icone: '💬' },
  estudar: { local: 'biblioteca', efeitos: { energia: -10, felicidade: 6, saber: 14 }, icone: '📚' },
};
export const ACTION_KEYS = Object.keys(ACTIONS);
export const ACTION_LABELS = { dormir: 'Sleep', comer: 'Eat', trabalhar: 'Work', passear: 'Walk', socializar: 'Socialize', estudar: 'Study' };
const STAT_LABELS = { energia: 'energy', fome: 'hunger', felicidade: 'happiness', dinheiro: 'money', saber: 'knowledge' };
export const BUILDINGS = {
  casa: { x: 120, y: 130, w: 120, h: 90, icone: '🏠', nome: 'Homes' },
  lanchonete: { x: 560, y: 120, w: 130, h: 80, icone: '🍜', nome: 'Cafe' },
  escritorio: { x: 330, y: 60, w: 140, h: 70, icone: '🏢', nome: 'Office' },
  praca: { x: 340, y: 300, w: 160, h: 110, icone: '🌳', nome: 'Park' },
  biblioteca: { x: 580, y: 300, w: 130, h: 90, icone: '📚', nome: 'Library' },
};

const clampStat = (v) => Math.max(0, Math.min(100, v));
function numericStat(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('agent stats must be finite numbers');
  return clampStat(value);
}
function validUnit(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1; }
function knownCost(res) { return Number.isFinite(res?.usage?.input_tokens) && res.usage.input_tokens >= 0
  && Number.isFinite(res?.costEstimateUsd) && res.costEstimateUsd >= 0 ? res.costEstimateUsd : null; }

export function normalizeAgents(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) throw new TypeError('agents must contain 1 to 10 citizens');
  const seen = new Set();
  return raw.map((a, i) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new TypeError('each agent must be an object');
    const id = String(a.id ?? i);
    if (!/^[A-Za-z0-9_-]{1,24}$/u.test(id) || seen.has(id)) throw new TypeError('agent IDs must be unique short slugs');
    seen.add(id);
    return {
      id,
      nome: typeof a.nome === 'string' && a.nome.trim() ? a.nome.trim().slice(0, 24) : 'Jev ' + (i + 1),
      emoji: typeof a.emoji === 'string' && a.emoji.trim() ? a.emoji.slice(0, 8) : '🟢',
      energia: numericStat(a.energia, 70), fome: numericStat(a.fome, 40),
      felicidade: numericStat(a.felicidade, 60), dinheiro: numericStat(a.dinheiro, 30),
      saber: numericStat(a.saber, 10), ultima: null,
    };
  });
}

function localDecision(agent, r) {
  if (agent.energia < 25) return 'dormir';
  if (agent.fome > 65) return 'comer';
  if (agent.dinheiro < 15 && r() < 0.8) return 'trabalhar';
  if (agent.felicidade < 35) return r() < 0.5 ? 'socializar' : 'passear';
  const pool = ACTION_KEYS.filter(k => k !== 'dormir');
  return pool[Math.floor(r() * pool.length)];
}

function aplicar(agent, acao) {
  const def = ACTIONS[acao] ?? ACTIONS.passear;
  const antes = { ...agent };
  for (const [k, v] of Object.entries(def.efeitos)) agent[k] = clampStat((agent[k] ?? 0) + v);
  agent.ultima = { acao, local: def.local, icone: def.icone };
  return { agente: agent.id, nome: agent.nome, acao, local: def.local, efeitos: Object.fromEntries(Object.entries(def.efeitos).map(([k]) => [k, Math.round((agent[k] ?? 0) - (antes[k] ?? 0))])) };
}

/**
 * A local tick is the default. `live:true` opts into exactly one Jev call.
 */
export async function cityTick({ agents: rawAgents = [], live = false, tick = 0 } = {}, { client } = {}) {
  const agents = normalizeAgents(rawAgents);
  if (!Number.isSafeInteger(tick) || tick < 0 || tick > 1_000_000) throw new RangeError('tick must be an integer from 0 to 1000000');
  let decisoes = null;
  let source = 'local simulation';
  let custo = 0; let latencia = null; let prosperidadeNoul = null;

  if (live || client) {
      if (!client && !isJevConfigured()) throw new Error('Jev is unavailable; select local simulation or configure a provider');
      const jev = client || new JevClient({ timeoutMs: 8000 });
      const questions = {};
      for (const a of agents) {
        questions['ag_' + a.id] = choiceQ(
          'What should ' + a.nome + ' do next? energy=' + Math.round(a.energia) + ', hunger=' + Math.round(a.fome) + ', happiness=' + Math.round(a.felicidade) + ', money=' + Math.round(a.dinheiro) + ', knowledge=' + Math.round(a.saber),
          Object.fromEntries(ACTION_KEYS.map(k => [k, ACTIONS[k].icone + ' ' + ACTION_LABELS[k] + ' (' + Object.entries(ACTIONS[k].efeitos).map(([kk, vv]) => (vv > 0 ? '+' : '') + vv + ' ' + STAT_LABELS[kk]).join(', ') + ')'])),
        );
      }
      questions.prosperidade = noulQ('Overall, are the citizens prosperous and satisfied?');
      let res;
      try { res = await jev.ask({ state: { city: 'JevFlow City', tick, citizens: agents.map(a => ({ name: a.nome, energy: Math.round(a.energia), hunger: Math.round(a.fome), happiness: Math.round(a.felicidade), money: Math.round(a.dinheiro), knowledge: Math.round(a.saber) })) }, questions }); }
      catch { throw new Error('Jev request failed'); }
      decisoes = Object.create(null);
      for (const a of agents) {
        const answer = res?.answers?.['ag_' + a.id];
        const probabilities = answer?.probabilities;
        if (!ACTION_KEYS.includes(answer?.choice) || !validUnit(answer?.confidence)
          || !probabilities || Object.keys(probabilities).length !== ACTION_KEYS.length
          || ACTION_KEYS.some(k => !validUnit(probabilities[k]))
          || Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.02) {
          throw new Error('Jev returned an invalid city decision');
        }
        decisoes[a.id] = answer.choice;
      }
      prosperidadeNoul = res?.answers?.prosperidade?.noul;
      if (!validUnit(prosperidadeNoul)) throw new Error('Jev returned an invalid prosperity score');
      source = 'jev'; custo = knownCost(res); latencia = Number.isFinite(res.latencyMs) && res.latencyMs >= 0 ? res.latencyMs : null;
  }

  const eventos = [];
  agents.forEach((a, i) => {
    const acao = decisoes?.[a.id] ?? localDecision(a, rng(a.id + '|' + a.fome + '|' + a.energia + '|' + tick));
    eventos.push(aplicar(a, acao));
  });
  const prosperidade = prosperidadeNoul ?? agents.reduce((s, a) => s + a.felicidade, 0) / agents.length / 100;
  return { source, eventos, agents, prosperidade, custo, latencia };
}

function rng(seedMix) {
  let s = 2166136261 ^ String(seedMix).length;
  for (const ch of String(seedMix)) s = (Math.imul(s ^ ch.charCodeAt(0), 16777619)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
