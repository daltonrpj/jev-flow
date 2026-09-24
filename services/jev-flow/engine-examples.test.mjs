import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteFlow, loadFlow } from './engine.mjs';

test('loads the shipped root support example and keeps it read-only', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'jev-flow-example-test-'));
  try {
    const flow = loadFlow('support-triage', { dir: dataDir });
    assert.equal(flow.id, 'support-triage');
    assert.throws(() => deleteFlow('support-triage', { dir: dataDir }), { code: 'READONLY_EXEMPLO' });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
