// Short-lived server-side store for designer drafts.
// The browser receives only a redacted projection plus this opaque handle.
import { randomUUID } from 'node:crypto';

const DRAFT_TTL_MS = 10 * 60 * 1000;
const MAX_DRAFTS = 200;
const drafts = new Map();

function prune(now = Date.now()) {
  for (const [token, entry] of drafts) {
    if (entry.expiresAt <= now) drafts.delete(token);
  }
  while (drafts.size > MAX_DRAFTS) drafts.delete(drafts.keys().next().value);
}

export function storeFlowDraft(flow, { ttlMs = DRAFT_TTL_MS } = {}) {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) throw new TypeError('flow draft must be an object');
  const token = randomUUID();
  const now = Date.now();
  prune(now);
  drafts.set(token, { flow: structuredClone(flow), expiresAt: now + Math.max(1_000, Number(ttlMs) || DRAFT_TTL_MS) });
  return token;
}

export function getFlowDraft(token) {
  const key = String(token || '').trim();
  if (!/^[0-9a-f-]{36}$/iu.test(key)) return null;
  const entry = drafts.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    drafts.delete(key);
    return null;
  }
  return structuredClone(entry.flow);
}

export function discardFlowDraft(token) {
  const key = String(token || '').trim();
  if (!/^[0-9a-f-]{36}$/iu.test(key)) return false;
  return drafts.delete(key);
}

export function clearFlowDrafts() {
  drafts.clear();
}
