import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listJevlets } from '../jev-forge/forge.mjs';
import { SHIP_GATES, SHIP_JEVLET_DIR } from './gates.mjs';

export const SHIP_FONTE = 'https://www.shipwithjev.com/';
const descriptions = {
  filtrarSlop: 'Flag generic content that adds no checkable information.',
  detectarEvasiva: 'Detect hedging in a claim before treating it as evidence.',
  entradaPronta: 'Check whether a request has enough detail to start costly work.',
  acharGemeo: 'Judge whether two errors are likely symptoms of the same bug.',
  defletirSuporte: 'Route a support request to an answer, document, or person.',
  lacunaDocs: 'Spot questions that the available documentation does not answer.',
  sinaisAlerta: 'Flag potentially material risks in a contract clause.',
  checarSpec: 'Compare a deliverable with an explicit acceptance criterion.',
  portaoQualidade: 'Judge anomalous data before a code-owned ingestion decision.',
  detectarMudancaFase: 'Detect a structural shift in a metric series.',
  sugerirComando: 'Suggest an available CLI command without executing it.',
};

export const NOVOS = Object.entries(SHIP_GATES).map(([gate, def]) => ({
  id: def.jevlet || 'did-you-mean', gate, jevlet: def.jevlet,
  build: def.build, resumo: descriptions[gate], campos: def.campos,
}));

export const EXEMPLO_STATES = {
  filtrarSlop: { titulo: 'Ten secrets for instant success', texto: 'Believe in yourself and everything will work out.' },
  detectarEvasiva: { alegacao: 'Some studies might possibly suggest an improvement.' },
  entradaPronta: { pedido: 'Improve the app', contexto: 'No files, acceptance criteria, or failure report supplied.' },
  acharGemeo: { erro_a: 'TypeError reading event.id in webhook parser', erro_b: 'TypeError reading event.id in webhook parser after empty payload' },
  defletirSuporte: { mensagem: 'How do I change my account email?', doc_disponivel: 'Account email change guide is available.' },
  lacunaDocs: { pergunta: 'How can I export run history?', trecho_doc: 'The guide explains how to start a run.' },
  sinaisAlerta: { clausula: 'The vendor may terminate at any time; the customer owes all remaining fees on termination.' },
  checarSpec: { criterio: 'Restore a daily backup within one hour', entregavel: 'Backup restoration is planned for a future sprint.' },
  portaoQualidade: { campo: 'p95_latency_ms', valor: '412', serie: 'Seven day range: 320 to 480 milliseconds.' },
  detectarMudancaFase: { metrica: 'daily_accuracy', atual: '31%', serie: 'Prior 14 days stable around 58%.' },
  sugerirComando: { digitado: 'sutie' },
};

export function shipStatus() {
  const installed = new Map(listJevlets().map(item => [item.id, item]));
  const novos = NOVOS.map(item => {
    const packaged = item.jevlet ? existsSync(join(SHIP_JEVLET_DIR, `${item.jevlet}.jevlet.json`)) : false;
    const registered = item.jevlet ? installed.get(item.jevlet) : null;
    return { ...item, included: packaged, registered: Boolean(registered),
      version: registered?.version ?? null, historicalPassRate: registered?.pass_rate ?? null,
      executionKind: registered?.executionKind || 'unknown',
      certification: registered?.executionKind === 'live' && registered?.pass_rate === 1
        ? 'full fixture pass recorded for a live run in this installation'
        : registered ? 'runtime record without a verified live full pass' : 'not evaluated in this installation' };
  });
  return { source: SHIP_FONTE, generatedAt: new Date().toISOString(), novos,
    totalGates: novos.length, packagedJevlets: novos.filter(item => item.included).length,
    registeredJevlets: novos.filter(item => item.registered).length };
}
