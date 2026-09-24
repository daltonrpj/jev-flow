#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { SHIP_JEVLET_DIR, SHIP_GATES, runShipGate } from '../services/jev-ship/gates.mjs';
import { NOVOS, shipStatus } from '../services/jev-ship/catalog.mjs';
import { shipReport, formatarShipReport } from '../services/jev-ship/report.mjs';
import { loadJevlet, testJevlet } from '../services/jev-forge/forge.mjs';
import { validateJevlet } from '../services/jev-forge/jevlet.mjs';
import { isJevConfigured } from '../services/jev/client.mjs';
import { runSuite, suiteHistory, setBaseline } from '../services/jev-flow/suite-runs.mjs';
import { installShipPack } from '../services/jev-ship/install.mjs';

const [area = 'help', action = '', ...args] = process.argv.slice(2);
const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
const help = `jev-flow ship list
jev-flow ship report [days]
jev-flow ship doctor [--live]
jev-flow ship install --live
jev-flow ship gate <gate> <state.json | ->
jev-flow suite run --live
jev-flow suite history
jev-flow suite baseline set`;

async function main() {
  if (area === 'help' || area === '--help') return print(help);
  if (area === 'ship' && action === 'list') return print(shipStatus());
  if (area === 'ship' && action === 'report') return print(formatarShipReport(shipReport({ dias: Number(args[0]) || 7 })));
  if (area === 'ship' && action === 'doctor') {
    const live = args.includes('--live');
    if (live && !isJevConfigured()) throw new Error('Configure Jev before a live doctor run');
    const results = [];
    for (const item of NOVOS.filter(entry => entry.jevlet)) {
      const jevlet = loadJevlet(item.jevlet, { dir: SHIP_JEVLET_DIR });
      const validation = validateJevlet(jevlet);
      const row = { id: item.jevlet, validation, executionKind: live ? 'live' : 'static' };
      if (live && validation.ok) row.test = await testJevlet(jevlet);
      results.push(row);
    }
    print({ total: results.length, valid: results.filter(row => row.validation.ok).length,
      live, results });
    if (results.some(row => !row.validation.ok || live && !row.test?.aprovado)) process.exitCode = 1;
    return;
  }
  if (area === 'ship' && action === 'install') {
    if (!args.includes('--live')) throw new Error('Add --live to explicitly certify and install all 10 packaged Jevlets');
    const result = await installShipPack(); print(result); if (!result.ok) process.exitCode = 1; return;
  }
  if (area === 'ship' && action === 'gate') {
    const [gate, path] = args;
    if (!Object.hasOwn(SHIP_GATES, gate)) throw new Error('Unknown gate. Use ship list.');
    if (!path) throw new Error('Provide a JSON file or - for stdin');
    const raw = path === '-' ? await new Promise((resolve, reject) => {
      let content = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { content += chunk; if (content.length > 1_000_000) reject(new Error('Input too large')); });
      process.stdin.on('end', () => resolve(content)); process.stdin.on('error', reject);
    }) : readFileSync(path, 'utf8');
    return print(await runShipGate(gate, JSON.parse(raw)));
  }
  if (area === 'suite' && action === 'history') return print(suiteHistory());
  if (area === 'suite' && action === 'baseline' && args[0] === 'set') return print(setBaseline());
  if (area === 'suite' && action === 'run') {
    if (!args.includes('--live')) throw new Error('Add --live to explicitly run all 52 provider calls');
    return print(await runSuite());
  }
  throw new Error(help);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
