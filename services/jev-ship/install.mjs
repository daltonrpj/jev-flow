import { SHIP_JEVLET_DIR } from './gates.mjs';
import { NOVOS } from './catalog.mjs';
import { loadJevlet, registerJevlet, testJevlet } from '../jev-forge/forge.mjs';
import { validateJevlet } from '../jev-forge/jevlet.mjs';
import { isJevConfigured } from '../jev/client.mjs';

/** Explicit operator action: all packaged jevlets must pass before publishing any. */
export async function installShipPack() {
  if (!isJevConfigured()) throw new Error('Connect a Jev provider before installing the Ship Pack');
  const verified = [];
  for (const item of NOVOS.filter(entry => entry.jevlet)) {
    const jevlet = loadJevlet(item.jevlet, { dir: SHIP_JEVLET_DIR });
    const validation = validateJevlet(jevlet);
    if (!validation.ok) return { ok: false, installed: 0, failed: item.jevlet, validation, executionKind: 'static' };
    const test = await testJevlet(jevlet);
    verified.push({ jevlet, test });
    if (!test.aprovado || test.executionKind !== 'live') return { ok: false, installed: 0, failed: item.jevlet,
      tested: verified.length, test, executionKind: 'live' };
  }
  const installed = verified.map(({ jevlet, test }) => registerJevlet(jevlet, { teste: test }));
  return { ok: installed.every(item => item.publicado), installed: installed.filter(item => item.publicado).length,
    executionKind: 'live', jevlets: installed.map(item => ({ id: item.entrada?.id || null,
      version: item.entrada?.version ?? null, published: item.publicado === true })) };
}
