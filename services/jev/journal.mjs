import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { JEV_DATA_DIR } from './client.mjs';

export const JOURNAL_PATH = join(JEV_DATA_DIR, 'decisions.jsonl');

// The journal records provenance and outcomes, never raw prompts or user input.
export function journalAppend(entry = {}) {
  try {
    const question = String(entry.pergunta ?? '');
    const record = {
      ts: new Date().toISOString(),
      gate: String(entry.gate || 'generic').slice(0, 80),
      inputHash: question ? createHash('sha256').update(question).digest('hex').slice(0, 16) : null,
      decisao: String(entry.decisao || '').slice(0, 160),
      score: Number.isFinite(entry.score) ? entry.score : null,
      custoUsd: Number.isFinite(entry.custoUsd) ? entry.custoUsd : null,
      costSource: entry.costSource || null,
      executionKind: entry.executionKind || null,
      cache: entry.cache === true,
    };
    mkdirSync(JEV_DATA_DIR, { recursive: true });
    appendFileSync(JOURNAL_PATH, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    return { ok: true };
  } catch { return { ok: false }; }
}

export function journalList({ limit = 30, gate = '' } = {}) {
  try {
    if (!existsSync(JOURNAL_PATH)) return { entries: [], total: 0 };
    const entries = readFileSync(JOURNAL_PATH, 'utf8').split('\n').filter(Boolean).slice(-500)
      .reverse().map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(item => item && (!gate || item.gate === gate)).slice(0, Math.min(200, Math.max(1, Number(limit) || 30)));
    return { entries, total: entries.length };
  } catch { return { entries: [], total: 0 }; }
}
