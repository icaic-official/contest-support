// Serves dist/ like the Worker does for the app: Brotli, immutable hashed assets, SPA fallback.
// Usage: node scripts/perf/serve.mjs <port>
import { createServer } from "node:http";
import process from "node:process";
import { URL } from "node:url";
import { readFileSync, existsSync, statSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { extname, join } from "node:path";

const dist = join(import.meta.dirname, "../../dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
const cache = new Map();
function load(path) {
  if (!cache.has(path)) {
    const raw = readFileSync(path);
    const type = types[extname(path)] ?? "application/octet-stream";
    const packed = type.startsWith("font/") ? raw : brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
    cache.set(path, { type, body: packed, packed: packed !== raw });
  }
  return cache.get(path);
}
createServer((request, response) => {
  const pathname = new URL(request.url, "http://x").pathname;
  let file = join(dist, pathname);
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) file = join(dist, "index.html");
  const { type, body, packed } = load(file);
  const html = type === "text/html";
  response.writeHead(200, {
    "content-type": type,
    "cache-control": !html && /\/assets\//.test(file) ? "public, max-age=31536000, immutable" : "no-cache",
    ...(packed ? { "content-encoding": "br" } : {}),
  });
  response.end(body);
}).listen(Number(process.argv[2] ?? 4180), "127.0.0.1");
