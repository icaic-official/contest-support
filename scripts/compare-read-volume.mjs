import console from 'node:console';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const usage = `Usage: node scripts/compare-read-volume.mjs --base=<a.json,...> --head=<b.json,...> [--limit=10]

Compares the output files of npm run perf:reads. For each shape, endpoint, and
caller, it takes the largest total rows read (request and dispatch) over every
run of each side, and prints the request types whose rows read changed. It
also lists the request types whose runs differ. It exits 1 when a request type
reads more than --limit added rows.`;

const key = (shape, record) => `${shape} | ${record.path.replace(/\?.*/, '')} | ${record.caller}`;

/** The largest total rows read of each request type in one perf:reads output file. */
export function rowsByRequest(results) {
  const rows = new Map();
  for (const { name, records } of results) {
    for (const record of records) {
      const id = key(name, record);
      rows.set(id, Math.max(rows.get(id) ?? 0, record.total.rowsRead));
    }
  }
  return rows;
}

/**
 * Compares the runs of two sides. A request that inserts a random ID can read
 * one row more or less from run to run, so each side keeps its largest count
 * and reports the spread.
 */
export function compareReadVolume(baseRuns, headRuns, limit) {
  const side = (runs) => {
    const counts = runs.map(rowsByRequest);
    const rows = new Map();
    const spread = new Map();
    for (const id of new Set(counts.flatMap((run) => [...run.keys()]))) {
      const values = counts.map((run) => run.get(id)).filter((value) => value !== undefined);
      rows.set(id, Math.max(...values));
      if (Math.max(...values) !== Math.min(...values)) spread.set(id, Math.max(...values) - Math.min(...values));
    }
    return { rows, spread };
  };
  const base = side(baseRuns);
  const head = side(headRuns);
  const shared = [...head.rows.keys()].filter((id) => base.rows.has(id));
  const changes = shared.map((id) => ({ id, base: base.rows.get(id), head: head.rows.get(id), delta: head.rows.get(id) - base.rows.get(id) }))
    .filter((change) => change.delta !== 0)
    .sort((left, right) => right.delta - left.delta || left.id.localeCompare(right.id));
  const over = changes.filter((change) => change.delta > limit);
  return {
    compared: shared.length, changes, over,
    missing: [...base.rows.keys()].filter((id) => !head.rows.has(id)),
    added: [...head.rows.keys()].filter((id) => !base.rows.has(id)),
    varying: [...[...base.spread].map(([id, rows]) => `base ${id} (${rows})`), ...[...head.spread].map(([id, rows]) => `head ${id} (${rows})`)],
    pass: over.length === 0,
  };
}

async function main() {
  const options = { base: [], head: [], limit: 10 };
  for (const argument of process.argv.slice(2)) {
    const [name, value] = argument.replace(/^--/, '').split('=');
    if ((name === 'base' || name === 'head') && value) options[name] = value.split(',');
    else if (name === 'limit' && /^\d+$/.test(value ?? '')) options.limit = Number(value);
    else { console.error(usage); process.exit(1); }
  }
  if (!options.base.length || !options.head.length) { console.error(usage); process.exit(1); }
  const load = (files) => Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
  const result = compareReadVolume(await load(options.base), await load(options.head), options.limit);
  console.log(`Compared ${result.compared} request types. ${result.changes.length} changed. Limit: ${options.limit} added rows.\n`);
  console.log('| Shape | Endpoint | Caller | Base rows | Head rows | Added |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const change of result.changes) console.log(`| ${change.id} | ${change.base} | ${change.head} | ${change.delta} |`);
  for (const [label, ids] of [['Only in base', result.missing], ['Only in head', result.added],
    ['Runs differ by rows', result.varying], ['Over the limit', result.over.map((change) => change.id)]]) {
    if (ids.length) console.log(`\n${label}: ${ids.join('; ')}`);
  }
  console.log(`\n${result.pass ? 'PASS' : 'FAIL'}`);
  process.exit(result.pass ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
