import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localeNames, siteTranslations } from '../site/translations.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const comparePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
export const siteSourceFiles = Object.freeze(['index.html', 'styles.css', 'main.js', 'favicon.svg']);
export const mediaFiles = Object.freeze([
  'studio-screenshot.png', 'compendium-screenshot.png', 'arena-screenshot.png',
  'carrinho-screenshot.png', 'labs-screenshot.png', 'chess-screenshot.png',
  'jev-flow-walkthrough.webm', 'jev-flow-walkthrough.vtt',
  'jev-flow-walkthrough-transcript.md',
]);
const invariantText = new Set([
  'J', 'Jev Flow', '.', '·', '{ }', '?', '◇', '↗', '↳', '/', '27', '388,080',
  '01', '02', '03', '04', '01 — 06', '02 — 06',
  'English', 'Português (Brasil)', 'Español', 'Français', 'Deutsch',
  'GitHub', 'daltonrpj/jev-flow',
  'http://127.0.0.1:8723/jev/flows',
  'git clone https://github.com/daltonrpj/jev-flow.git\ncd jev-flow\nnpm ci\nnpm start',
]);
const escapeHtml = value => String(value).replace(/[&<>"]/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderSiteLocale(englishHtml, locale) {
  if (!Object.hasOwn(localeNames, locale)) throw new Error(`Unsupported site locale: ${locale}`);
  if (!englishHtml.includes('<html lang="en" data-site-root="./">')) throw new Error('English site source is not canonical');
  const copy = siteTranslations[locale];
  const translate = (raw, kind) => {
    const key = raw.trim().replace(/\r\n/gu, '\n');
    if (!key || invariantText.has(key) || /^\d+(?:[.,]\d+)?$/u.test(key)) return raw;
    const translated = copy.get(key);
    if (!translated) throw new Error(`Missing ${locale} ${kind} translation: ${key}`);
    return raw.replace(raw.trim(), escapeHtml(translated));
  };
  let html = englishHtml.replace(/>([^<>]+)</gu, (match, raw) => `>${translate(raw, 'text')}<`);
  html = html.replace(/\b(alt|aria-label)="([^"]*)"/gu,
    (match, name, value) => `${name}="${translate(value, 'attribute')}"`);
  html = html.replace(/(<meta name="description" content=")([^"]*)(")/u,
    (match, before, value, after) => before + translate(value, 'description') + after);
  html = html.replaceAll('="./', '="../');
  html = html.replace('<html lang="en" data-site-root="../">', `<html lang="${locale}" data-site-root="../">`);
  html = html.replace(`<option value="${locale}">`, `<option value="${locale}" selected>`);
  return html;
}

async function assertRegularSource(source) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular source file: ${source}`);
}

export async function buildSite(root = defaultRoot) {
  const projectRoot = resolve(root);
  const siteRoot = join(projectRoot, 'site');
  const output = join(siteRoot, 'dist');
  if (dirname(output) !== siteRoot || output === projectRoot) throw new Error('Invalid build output');
  const exampleNames = (await readdir(join(projectRoot, 'examples')))
    .filter(name => /^[a-z0-9][a-z0-9-]*\.flow\.json$/u.test(name)).sort();
  if (exampleNames.length === 0) throw new Error('No public example flows to publish');
  const paths = [
    ...siteSourceFiles.map(name => [join(siteRoot, name), name]),
    ...mediaFiles.map(name => [join(projectRoot, 'media', name), join('media', name)]),
    ...exampleNames.map(name => [join(projectRoot, 'examples', name), join('examples', name)]),
    [join(projectRoot, 'catalog-certification.json'), 'catalog-certification.json'],
  ];
  // Validate every source before replacing a previous build.
  for (const [source] of paths) await assertRegularSource(source);
  const englishHtml = await readFile(join(siteRoot, 'index.html'), 'utf8');
  const localized = Object.keys(localeNames).map(locale => [
    join(locale, 'index.html'), renderSiteLocale(englishHtml, locale),
  ]);
  const realRoot = await realpath(projectRoot);
  const realSite = await realpath(siteRoot);
  if (comparePath(realSite) !== comparePath(join(realRoot, 'site'))) throw new Error('Site source escapes project root');
  // Windows can hold an open handle on the output directory while allowing its entries to be replaced.
  await mkdir(output, { recursive: true });
  const realOutput = await realpath(output);
  if (comparePath(realOutput) !== comparePath(join(realSite, 'dist'))) throw new Error('Build output escapes site directory');
  for (const name of await readdir(output)) {
    const entry = join(output, name);
    const target = await realpath(entry);
    if (!comparePath(target).startsWith(comparePath(realOutput + sep))) throw new Error('Build entry escapes output directory');
    await rm(entry, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  for (const [source, relative] of paths) {
    const destination = join(output, relative);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  for (const [relative, html] of localized) {
    const destination = join(output, relative);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, html, 'utf8');
  }
  return { output, files: [
    ...paths.map(([, relative]) => relative.replaceAll('\\', '/')),
    ...localized.map(([relative]) => relative.replaceAll('\\', '/')),
  ] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildSite();
  console.log(`Built ${result.files.length} public files in ${result.output}`);
}
