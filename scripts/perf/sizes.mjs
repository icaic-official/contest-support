// Prints raw, gzip and brotli size of every script and stylesheet in dist/assets,
// and which of them index.html loads at start. Usage: node scripts/perf/sizes.mjs
import console from "node:console";
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { join } from "node:path";

const dist = join(import.meta.dirname, "../../dist");
const kb = (n) => (n / 1024).toFixed(1).padStart(8);
const html = readFileSync(join(dist, "index.html"), "utf8");
const eager = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((m) => m[1]));
const rows = readdirSync(join(dist, "assets"))
  .filter((name) => !name.endsWith(".woff2"))
  .map((name) => {
    const data = readFileSync(join(dist, "assets", name));
    return { name, raw: data.length, gzip: gzipSync(data).length, br: brotliCompressSync(data).length, eager: eager.has(`assets/${name}`) };
  });
console.log("file".padEnd(40), "     raw     gzip   brotli  loaded-by-index.html");
for (const r of rows.sort((a, b) => b.raw - a.raw)) {
  console.log(r.name.padEnd(40), kb(r.raw), kb(r.gzip), kb(r.br), r.eager ? "yes" : "lazy");
}
const sum = (key) => rows.filter((r) => r.eager).reduce((t, r) => t + r[key], 0);
console.log("initial JS+CSS".padEnd(40), kb(sum("raw")), kb(sum("gzip")), kb(sum("br")));
