import {readFile, readdir, stat} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, URL} from 'node:url';
import console from 'node:console';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const origin = 'https://minsky-docs.icaic-minsky.workers.dev';
const entries = await readdir(output, {recursive: true});
const pages = entries.filter((entry) => entry.endsWith('.html'));
const documents = new Map(await Promise.all(pages.map(async (page) => {
  const html = await readFile(join(output, page), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  return [page, {html, ids}];
})));
const failures = [];
let checked = 0;

for (const [page, {html}] of documents) {
  const source = new URL(page.replace(/index\.html$/, ''), `${origin}/`);
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const target = new URL(match[1].replaceAll('&amp;', '&'), source);
    if (target.origin !== origin) continue;
    const pathname = decodeURIComponent(target.pathname).replace(/^\//, '');
    let relative = pathname.endsWith('/') || !pathname ? `${pathname}index.html` : pathname;
    try {
      if ((await stat(join(output, relative))).isDirectory()) relative += '/index.html';
      await stat(join(output, relative));
    } catch {
      // Workers also serves a flat HTML file at its clean, trailing-slash URL.
      relative = `${pathname.replace(/\/$/, '')}.html`;
      if (!documents.has(relative)) {
        failures.push(`${page}: missing ${target.pathname}`);
        continue;
      }
    }
    const document = documents.get(relative);
    const fragment = decodeURIComponent(target.hash.slice(1));
    if (fragment && document && !document.ids.has(fragment)) {
      failures.push(`${page}: missing anchor ${target.pathname}${target.hash}`);
    }
    checked++;
  }
}

if (failures.length) throw new Error([...new Set(failures)].join('\n'));
console.log(`Checked ${pages.length} HTML pages and ${checked} local links and assets.`);
