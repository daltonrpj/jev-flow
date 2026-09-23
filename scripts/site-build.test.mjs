import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { buildSite, mediaFiles, siteSourceFiles, renderSiteLocale } from './build-site.mjs';
import { localeNames } from '../site/translations.mjs';

const sourceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const englishSource = await readFile(join(sourceRoot, 'site', 'index.html'), 'utf8');

test('site:build copies only the explicit public allowlist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jev-flow-public-build-'));
  try {
    for (const dir of ['site', 'media', 'examples', 'server', 'services', 'data']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    for (const name of siteSourceFiles) {
      await writeFile(join(root, 'site', name), name === 'index.html' ? englishSource : name);
    }
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
      ...Object.keys(localeNames).map(locale => `${locale}/index.html`),
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
    for (const locale of Object.keys(localeNames)) {
      const html = await readFile(join(result.output, locale, 'index.html'), 'utf8');
      assert.match(html, new RegExp(`<html lang="${locale}" data-site-root="../">`, 'u'));
      assert.match(html, /href="\.\.\/styles\.css"/u);
      assert.match(html, /src="\.\.\/media\/jev-flow-walkthrough\.webm"/u);
      assert.match(html, new RegExp(`<option value="${locale}" selected>`, 'u'));
      for (const target of ['en', ...Object.keys(localeNames)]) {
        const path = target === 'en' ? '../' : `../${target}/`;
        assert.ok(html.includes(`hreflang="${target}" href="${path}"`), `${locale} -> ${target}`);
      }
      assert.doesNotMatch(html, /The decision boundary is visible|Ask a model a bounded question|View source ↗/u);
      assert.doesNotMatch(html, /href="\.\/(?:styles\.css|media\/|examples\/)/u);
    }
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()) + sep) && root.includes('jev-flow-public-build-')) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('all four localized pages translate metadata, visible text and accessibility descriptions', () => {
  const titleByLocale = {
    'pt-BR': 'O limite da decisão está visível',
    es: 'El límite de la decisión es visible',
    fr: 'La frontière de décision est visible',
    de: 'Die Entscheidungsgrenze ist sichtbar',
  };
  for (const [locale, title] of Object.entries(titleByLocale)) {
    const html = renderSiteLocale(englishSource, locale);
    assert.ok(html.includes(`<title>Jev Flow — ${title}</title>`), locale);
    if (locale === 'pt-BR') assert.match(html, /Evidência tipada entra no fluxo\./u);
    assert.match(html, /<meta name="description" content="Jev Flow\s?: [^"]+"/u);
    assert.match(html, /<img src="\.\.\/media\/studio-screenshot\.png" alt="[^"]+"/u);
    assert.match(html, /<video controls playsinline preload="none"/u);
    assert.doesNotMatch(html, /<track\b/iu);
  }
  assert.throws(() => renderSiteLocale(englishSource, 'it'), /Unsupported site locale/u);
  assert.throws(() => renderSiteLocale(englishSource.replace('Skip to content', 'Untranslated new copy'), 'fr'), /Missing fr text translation/u);
});

test('language selector keeps the section hash between root and nested locale routes', async () => {
  const script = await readFile(join(sourceRoot, 'site', 'main.js'), 'utf8');
  for (const [from, next, expected] of [
    ['https://example.test/jev-flow/#watch', 'pt-BR', 'https://example.test/jev-flow/pt-BR/#watch'],
    ['https://example.test/jev-flow/fr/#install', 'de', 'https://example.test/jev-flow/de/#install'],
    ['https://example.test/jev-flow/es/#mechanism', 'en', 'https://example.test/jev-flow/#mechanism'],
  ]) {
    const listeners = {};
    const select = { value: '', addEventListener: (event, callback) => { listeners[event] = callback; } };
    const location = { href: from, hash: new URL(from).hash, assigned: null, assign(url) { this.assigned = url; } };
    const locale = from.match(/\/jev-flow\/(pt-BR|es|fr|de)\//u)?.[1] || 'en';
    const document = {
      documentElement: { lang: locale, dataset: { siteRoot: locale === 'en' ? './' : '../' } },
      getElementById: id => id === 'site-language' ? select : null,
    };
    runInNewContext(script, { document, location, URL, navigator: {}, window: {} });
    select.value = next;
    listeners.change();
    assert.equal(location.assigned, expected);
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
