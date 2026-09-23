import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSite, mediaFiles, siteSourceFiles } from './build-site.mjs';

test('site:build copies only the explicit public allowlist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-flow-public-build-'));
  try {
    for (const dir of ['site', 'media', 'examples', 'server', 'services', 'data']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    for (const name of siteSourceFiles) await writeFile(join(root, 'site', name), name);
    for (const name of mediaFiles) await writeFile(join(root, 'media', name), name);
    await writeFile(join(root, 'examples', 'safe.flow.json'), '{"fixture":true}');
    await writeFile(join(root, 'examples', 'private.txt'), 'do not publish');
    await writeFile(join(root, 'catalog-certification.json'), '{"passed":true}');
    await writeFile(join(root, 'site', 'obsolete.html'), 'do not publish');
    await writeFile(join(root, 'server.mjs'), 'do not publish');
    await writeFile(join(root, 'services', 'private.mjs'), 'do not publish');
    await writeFile(join(root, 'data', 'history.json'), 'do not publish');
    await writeFile(join(root, '.env'), 'do not publish');
    const result = await buildSite(root);
    const expected = [
      ...siteSourceFiles, ...mediaFiles.map(name => `media/${name}`),
      'examples/safe.flow.json', 'catalog-certification.json',
    ].sort();
    assert.deepEqual(result.files.sort(), expected);
    async function tree(directory, prefix = '') {
      const files = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) files.push(...await tree(join(directory, entry.name), `${relative}/`));
        else files.push(relative);
      }
      return files;
    }
    assert.deepEqual((await tree(result.output)).sort(), expected);
    assert.equal(await readFile(join(result.output, 'media', 'jev-flow-walkthrough.vtt'), 'utf8'), 'jev-flow-walkthrough.vtt');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('jev-flow-public-build-')) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('site:build leaves previous output intact when an allowlisted source is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-flow-public-build-'));
  try {
    await mkdir(join(root, 'site', 'dist'), { recursive: true });
    await mkdir(join(root, 'examples'), { recursive: true });
    await writeFile(join(root, 'site', 'dist', 'previous.html'), 'previous');
    await writeFile(join(root, 'examples', 'safe.flow.json'), '{}');
    await assert.rejects(buildSite(root), /ENOENT/u);
    assert.equal(await readFile(join(root, 'site', 'dist', 'previous.html'), 'utf8'), 'previous');
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('jev-flow-public-build-')) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
