// Operational helpers for the Jev Flow control room.
// Keeps versioning and import/export policy outside the execution engine.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  EXAMPLES_DIR,
  FLOWS_DIR,
  flowPath,
  isFlowId,
  loadFlow,
  saveFlow,
  validateInput as validateInputEngine,
  validateFlow,
} from './engine.mjs';

const MAX_VERSIONS = 20;
const MAX_RUN_FILE = 180;

function nowId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function slugifyFlowId(value, fallback = 'jev-flow') {
  const id = String(value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return /^[a-z][a-z0-9_-]{2,40}$/.test(id) ? id : fallback;
}

function existsAsFlow(id, dir = FLOWS_DIR) {
  return existsSync(flowPath(id, { dir })) || existsSync(join(EXAMPLES_DIR, `${id}.flow.json`));
}

export function nextFlowId(seed, { dir = FLOWS_DIR } = {}) {
  const base = slugifyFlowId(seed, 'jev-flow');
  let id = base;
  let i = 2;
  while (existsAsFlow(id, dir)) id = `${base}-${i++}`.slice(0, 41);
  return id;
}

export function snapshotFlow(id, { dir = FLOWS_DIR } = {}) {
  const current = flowPath(id, { dir });
  if (!existsSync(current)) return null;
  const versionDir = join(dir, 'versions', id);
  mkdirSync(versionDir, { recursive: true });
  const stem = nowId();
  let version = join(versionDir, `${stem}.flow.json`);
  let suffix = 2;
  while (existsSync(version)) version = join(versionDir, `${stem}-${suffix++}.flow.json`);
  copyFileSync(current, version);
  const files = readdirSync(versionDir).filter((f) => f.endsWith('.flow.json')).sort();
  for (const file of files.slice(0, Math.max(0, files.length - MAX_VERSIONS))) {
    try { unlinkSync(join(versionDir, file)); } catch { /* best effort */ }
  }
  return version;
}

export function listVersions(id, { dir = FLOWS_DIR } = {}) {
  if (!isFlowId(id)) return [];
  const versionDir = join(dir, 'versions', id);
  if (!existsSync(versionDir)) return [];
  return readdirSync(versionDir)
    .filter((f) => f.endsWith('.flow.json'))
    .sort()
    .reverse()
    .map((file) => ({ file, quando: file.replace('.flow.json', '') }));
}

export function undoFlow(id, { dir = FLOWS_DIR } = {}) {
  if (!isFlowId(id)) return { ok: false, motivo: 'id de flow inválido' };
  const versions = listVersions(id, { dir });
  if (!versions.length) return { ok: false, motivo: 'nenhuma versão anterior disponível' };
  const current = flowPath(id, { dir });
  if (!existsSync(current)) return { ok: false, motivo: 'flow atual não existe' };
  const latest = versions[0];
  const previous = join(join(dir, 'versions', id), latest.file);
  const currentBackup = snapshotFlow(id, { dir });
  copyFileSync(previous, current);
  unlinkSync(previous);
  return { ok: true, restaurado: id, versao: latest.quando, backup: currentBackup };
}

export function saveFlowWithVersion(flow, { dir = FLOWS_DIR } = {}) {
  const version = flow?.id && existsSync(flowPath(flow.id, { dir })) ? snapshotFlow(flow.id, { dir }) : null;
  const result = saveFlow(flow, { dir });
  return { ...result, version };
}

export function duplicateFlow(sourceId, { name, id, dir = FLOWS_DIR } = {}) {
  const source = loadFlow(sourceId, { dir });
  const requested = slugifyFlowId(id || `${source.id}-copy`, `${source.id}-copy`);
  const copy = {
    ...source,
    id: nextFlowId(requested, { dir }),
    name: String(name || `${source.name} · cópia`).trim(),
    copied_from: source.id,
    updated_at: new Date().toISOString(),
  };
  const result = saveFlow(copy, { dir });
  return { ...result, flow: result.salvo ? copy : null };
}

export function readRun(flowId, file, { dir = FLOWS_DIR } = {}) {
  if (!isFlowId(flowId)) return null;
  const safe = basename(String(file || '')).slice(0, MAX_RUN_FILE);
  if (!safe || safe !== String(file) || !safe.endsWith('.json')) return null;
  const path = join(dir, 'runs', flowId, safe);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export const validateInput = validateInputEngine;

export function importFlow(flow, { name, id, dir = FLOWS_DIR } = {}) {
  const incoming = flow && typeof flow === 'object' ? structuredClone(flow) : null;
  if (!incoming) return { salvo: false, validacao: { ok: false, errors: [{ codigo: 'FLOW_INVALIDO', campo: '', msg: 'flow deve ser objeto' }], warnings: [] } };
  const requested = slugifyFlowId(id || incoming.id || incoming.name, 'jev-flow');
  incoming.id = nextFlowId(requested, { dir });
  if (name) incoming.name = String(name).trim();
  incoming.importado_em = new Date().toISOString();
  const result = saveFlow(incoming, { dir });
  return { ...result, flow: result.salvo ? incoming : null };
}

export function validateDraft(flow) {
  return validateFlow(flow);
}
