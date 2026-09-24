import { existsSync, readFileSync } from 'node:fs';
import { JOURNAL_PATH } from '../jev/journal.mjs';

const ATTENTION = new Set(['escalar_humano', 'revisao_humana_urgente', 'recusar',
  'bloquear_ingestao', 'descartar', 'pedir_detalhe', 'marcar_evasiva',
  'registrar_lacuna', 'alertar_mudanca', 'regressed']);

export function shipReport({ journalPath = JOURNAL_PATH, dias = 7 } = {}) {
  const entries = [];
  if (existsSync(journalPath)) {
    for (const line of readFileSync(journalPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch { /* ignore a truncated line */ }
    }
  }
  const cutoff = dias > 0 ? Date.now() - dias * 86_400_000 : 0;
  const window = entries.filter(item => item.ts && Date.parse(item.ts) >= cutoff);
  const groups = new Map();
  const daily = new Map();
  let knownCost = 0, unknownCostCount = 0, cacheHits = 0, attention = 0;
  for (const item of window) {
    const gate = String(item.gate || 'generic');
    const cost = Number.isFinite(item.custoUsd) ? item.custoUsd : null;
    if (cost == null) unknownCostCount++; else knownCost += cost;
    if (item.cache === true) cacheHits++;
    if (ATTENTION.has(String(item.decisao || '').split(' ')[0])) attention++;
    const group = groups.get(gate) || { gate, decisions: 0, knownCostUsd: 0, unknownCostCount: 0,
      cacheHits: 0, attention: 0, latest: null };
    group.decisions++;
    if (cost == null) group.unknownCostCount++; else group.knownCostUsd += cost;
    if (item.cache === true) group.cacheHits++;
    if (ATTENTION.has(String(item.decisao || '').split(' ')[0])) group.attention++;
    if (!group.latest || item.ts > group.latest) group.latest = item.ts;
    groups.set(gate, group);
    const day = item.ts.slice(0, 10);
    const point = daily.get(day) || { day, decisions: 0, knownCostUsd: 0 };
    point.decisions++; if (cost != null) point.knownCostUsd += cost;
    daily.set(day, point);
  }
  return { windowDays: dias, generatedAt: new Date().toISOString(),
    total: { decisions: window.length, gates: groups.size,
      costUsd: unknownCostCount ? null : Number(knownCost.toFixed(8)),
      knownCostUsd: Number(knownCost.toFixed(8)), unknownCostCount,
      cacheHits, cacheRate: window.length ? cacheHits / window.length : 0, attention },
    byGate: [...groups.values()].sort((a, b) => b.decisions - a.decisions),
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    // Savings require a measured alternative cost. No counterfactual is invented.
    savingsUsd: null };
}

export function formatarShipReport(report) {
  const lines = [`Jev Ship Report — ${report.windowDays} days`,
    `${report.total.decisions} decisions · ${report.total.gates} gates · ${report.total.cacheHits} cache hits`,
    `Observed cost: ${report.total.costUsd == null ? 'unknown' : `$${report.total.costUsd.toFixed(8)}`}`];
  for (const gate of report.byGate) lines.push(`${gate.gate}: ${gate.decisions} decisions, ${gate.unknownCostCount} unknown costs`);
  return lines.join('\n');
}
