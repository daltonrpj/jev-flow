// ============================================================================
// Jev Verify — a alegação encontra apoio na evidência fornecida?
//
// Padrão do `jev verify` (jev-cli) e do veredito de should-ai-kill-us-all:
// Choice com saída "não verificável" em vez de chute. Complementa (não
// substitui) o citation-gate: o gate valida IDs/URLs contra a fonte real;
// o Jev verifica SEMÂNTICA alegação×evidência quando a fonte está no texto.
//
// Importante: julgamento tipado não é prova. suportada = "a evidência diz
// isso", não "é verdade no mundo".
// ============================================================================

import { JevClient, choiceQ, noulQ } from './client.mjs';

const VERDICTS = {
  suportada: 'A evidência afirma explicitamente que a alegação é verdadeira (ou a contém como fato).',
  contradita: 'A evidência afirma explicitamente que a alegação é falsa, ou apresenta fato incompatível direto.',
  nao_verificavel: 'A evidência não trata da alegação: nem apoia nem contradiz.',
};

/**
 * Verifica UMA alegação contra UMA evidência em uma única chamada Jev.
 * Retorna { veredito, probabilidade, confianca, apoio, contradicao }.
 * `apoio`/`contradicao` são os noul (0..1) — úteis para limiares próprios.
 */
export async function verifyClaim({ claim, evidence, client } = {}) {
  if (!claim || typeof claim !== 'string') throw new Error('claim é obrigatória');
  if (!evidence || typeof evidence !== 'string') throw new Error('evidence é obrigatória');
  const jev = client || new JevClient();

  const res = await jev.ask({
    state: { alegacao: claim, evidencia: evidence },
    questions: {
      veredito: choiceQ('A `evidencia` fornecida apoia, contradiz ou ignora a `alegacao`? Julgue apenas pelo texto da evidência — nada externo a ele.', VERDICTS),
      apoio: noulQ('A `evidencia` afirma explicitamente que a `alegacao` é verdadeira?'),
      contradicao: noulQ('A `evidencia` afirma explicitamente que a `alegacao` é falsa?'),
    },
  });

  const v = res.answers.veredito || {};
  let veredito = VERDICTS[v.choice] ? v.choice : null;
  // Resposta choice ausente/malformada nunca passa silenciosamente: deriva
  // do noul com regra conservadora, marcando a degradação.
  let degradado = false;
  if (!veredito) {
    degradado = true;
    const apoio = res.answers.apoio?.noul ?? 0;
    const contra = res.answers.contradicao?.noul ?? 0;
    veredito = apoio >= 0.6 && apoio > contra ? 'suportada' : contra >= 0.6 ? 'contradita' : 'nao_verificavel';
  }

  return {
    veredito,
    probabilidade: v.probabilities || null,
    confianca: v.confidence ?? null,
    apoio: res.answers.apoio?.noul ?? null,
    contradicao: res.answers.contradicao?.noul ?? null,
    degradado,
    latency_ms: res.latencyMs,
    cost_usd_estimate: res.costEstimateUsd,
  };
}

/**
 * Verifica vários pares com concorrência limitada (o Jev é rápido, mas não
 * vamos abrir 50 conexões de uma vez).
 */
export async function verifyClaims(items, { client, concurrency = 3 } = {}) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await verifyClaim({ ...items[i], client });
      } catch (err) {
        results[i] = { veredito: 'erro', erro: String(err?.message || err).slice(0, 200) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/**
 * Porta de CI/gate (padrão exit-code do jev-cli): 0 = liberado, 2 = falhou
 * (contradita), 3 = não verificável, 1 = erro. Limiar de `apoio` default 0.6.
 */
export function gateResult(verification, { minSupport = 0.6 } = {}) {
  if (verification.veredito === 'erro') return { pass: false, exitCode: 1, motivo: verification.erro };
  if (verification.veredito === 'contradita') return { pass: false, exitCode: 2, motivo: 'evidência contradiz a alegação' };
  if (verification.veredito === 'nao_verificavel') return { pass: false, exitCode: 3, motivo: 'evidência não trata da alegação' };
  const apoio = verification.apoio ?? minSupport;
  if (apoio < minSupport) return { pass: false, exitCode: 3, motivo: `apoio ${apoio.toFixed(2)} < ${minSupport}` };
  return { pass: true, exitCode: 0, motivo: `suportada (apoio ${apoio.toFixed(2)})` };
}
