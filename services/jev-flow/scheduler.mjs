import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JEV_DATA_DIR } from '../jev/client.mjs';

const path = join(JEV_DATA_DIR, 'schedules.json');
let tasks = new Map();
let handler = null;
let timer = null;

function load() {
  try {
    if (!existsSync(path)) return;
    const entries = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(entries)) tasks = new Map(entries.filter(task => task && typeof task.id === 'string').map(task => [task.id, task]));
  } catch { tasks = new Map(); }
}
function persist() {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify([...tasks.values()], null, 2));
  renameSync(tmp, path);
}
function nextCron(schedule, after = Date.now()) {
  const fields = String(schedule).slice(5).trim().split(/\s+/u);
  if (fields.length !== 5) throw new TypeError('cron schedule must contain five fields');
  const matches = (field, value, min, max) => field === '*' || field === `*/${Math.max(1, Number(field.slice(2)) || 1)}` && value % Math.max(1, Number(field.slice(2)) || 1) === 0 || Number(field) === value || field.includes(',') && field.split(',').some(part => Number(part) === value) || field.includes('-') && (() => { const [a,b] = field.split('-').map(Number); return value >= a && value <= b; })();
  const candidate = new Date(Math.floor(after / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 366 * 24 * 60; i++, candidate.setMinutes(candidate.getMinutes() + 1)) {
    if (matches(fields[0], candidate.getMinutes(), 0, 59) && matches(fields[1], candidate.getHours(), 0, 23)
      && matches(fields[2], candidate.getDate(), 1, 31) && matches(fields[3], candidate.getMonth() + 1, 1, 12)
      && matches(fields[4], candidate.getDay(), 0, 6)) return candidate.getTime();
  }
  throw new TypeError('cron schedule has no upcoming date');
}
function calculateNext(schedule, after = Date.now()) {
  const text = String(schedule || '');
  if (text.startsWith('interval:')) {
    const match = /^(\d+)(s|m|h|d)$/iu.exec(text.slice(9));
    if (!match) throw new TypeError('interval must look like interval:10m');
    const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
    const duration = Number(match[1]) * multiplier;
    if (duration < 10_000 || duration > 365 * 86_400_000) throw new RangeError('interval must be between 10 seconds and 365 days');
    return after + duration;
  }
  if (text.startsWith('at:')) {
    const at = Date.parse(text.slice(3));
    if (!Number.isFinite(at) || at <= after) throw new TypeError('at schedule must be a future ISO date');
    return at;
  }
  if (text.startsWith('cron:')) return nextCron(text, after);
  throw new TypeError('schedule must use interval:, cron:, or at:');
}
function tick() {
  const now = Date.now();
  for (const task of tasks.values()) {
    if (!task.enabled || !Number.isFinite(task.nextRunAt) || task.nextRunAt > now) continue;
    task.lastRunAt = new Date(now).toISOString();
    try { task.nextRunAt = calculateNext(task.schedule, now); } catch { task.enabled = false; }
    if (String(task.schedule).startsWith('at:')) task.enabled = false;
    persist();
    Promise.resolve(handler?.(structuredClone(task))).then(() => {
      task.lastStatus = 'complete'; persist();
    }).catch(error => { task.lastStatus = 'failed'; task.lastError = String(error?.message || error).slice(0, 240); persist(); });
  }
}
load();

export function upsertTask(task) {
  if (!task || typeof task.id !== 'string' || !task.id) throw new TypeError('task id required');
  const existing = tasks.get(task.id);
  const next = { ...existing, ...structuredClone(task), enabled: task.enabled !== false,
    nextRunAt: task.enabled === false ? null : calculateNext(task.schedule), lastStatus: existing?.lastStatus || 'pending' };
  tasks.set(next.id, next); persist(); return structuredClone(next);
}
export function deleteTask(id) { const removed = tasks.delete(String(id)); if (removed) persist(); return removed; }
export function listTasks() { return [...tasks.values()].map(task => structuredClone(task)); }
export function setScheduleRunner(run) {
  handler = typeof run === 'function' ? run : null;
  if (timer) clearInterval(timer);
  if (handler) { timer = setInterval(tick, 5_000); timer.unref?.(); tick(); }
  return () => { if (timer) clearInterval(timer); timer = null; handler = null; };
}
