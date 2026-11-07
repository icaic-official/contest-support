import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { localD1 } from './store-database.mjs';

// Two runtimes, each with its own empty database, the same schema, and the same rows. `native` is the
// D1 binding that Workers see. `local` wraps the binding of the other runtime. Each test runs one
// step on both and compares everything that comes back. Both databases receive the same steps in the
// same order, so even `last_row_id` and `size_after` match when `local` behaves as `native` does.
let platforms = [];
let native;
let local;

const schema = [
  'CREATE TABLE parent (id INTEGER PRIMARY KEY, note TEXT)',
  'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent (id), valid INTEGER NOT NULL CHECK (valid = 1))',
  'CREATE TABLE receipt (actor TEXT NOT NULL, request_id TEXT NOT NULL, UNIQUE (actor, request_id))',
  'CREATE TABLE versioned (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)',
  `CREATE TRIGGER versioned_advance BEFORE UPDATE ON versioned WHEN NEW.version <= OLD.version
   BEGIN SELECT RAISE(ABORT, 'Issue versions must advance with each write'); END`,
  'CREATE TABLE bytes (id INTEGER PRIMARY KEY, body BLOB)',
];
const rows = [
  "INSERT INTO parent (id, note) VALUES (1, 'one'), (2, 'two')",
  "INSERT INTO receipt (actor, request_id) VALUES ('a', 'r')",
  'INSERT INTO versioned (id, version) VALUES (1, 1)',
];

const open = () => getPlatformProxy({ configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [] });

beforeAll(async () => {
  platforms = await Promise.all([open(), open()]);
  const [first, second] = platforms.map((platform) => platform.env.DB);
  native = first;
  local = localD1(second);
  for (const db of [first, second]) await db.batch([...schema, ...rows].map((sql) => db.prepare(sql)));
});

afterAll(async () => { await Promise.all(platforms.map((platform) => platform.dispose())); });

/** `duration` and `timings` differ between any two runs, so only their type is compared. */
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) =>
      [key, key === 'duration' || key === 'timings' ? typeof inner : scrub(inner)]));
  }
  return value;
}

/** What a step returns, or the name, message, and cause of what it throws. */
async function settle(step) {
  try {
    return { ok: await step() };
  } catch (error) {
    return { threw: { name: error.name, message: error.message, cause: error.cause?.message } };
  }
}

/** Runs a step on the native binding and on the local one, requires the same outcome, and returns it. */
async function same(label, step) {
  const expected = scrub(await settle(() => step(native)));
  assert.deepEqual(scrub(await settle(() => step(local))), expected, label);
  return expected;
}

const reads = [
  ['a row', 'SELECT id, note FROM parent WHERE id = ?', [1]],
  ['no row', 'SELECT id FROM parent WHERE id = ?', [99]],
  ['many rows', 'SELECT id, note FROM parent ORDER BY id', []],
  ['an aggregate', 'SELECT COUNT(*) AS total FROM parent', []],
  ['a null and a number', 'SELECT NULL AS blank, ? AS number', [1.5]],
];

test('a read returns the same results and meta as the native binding', async () => {
  for (const [label, sql, params] of reads) {
    for (const method of ['all', 'run', 'first']) {
      await same(`${label}: ${method}`, (db) => db.prepare(sql).bind(...params)[method]());
    }
  }
  const unbound = await same('an unbound read', (db) => db.prepare('SELECT id FROM parent WHERE id = 99').first());
  assert.deepEqual(unbound, { ok: null });
  const many = await same('many rows', (db) => db.prepare('SELECT id, note FROM parent ORDER BY id').all());
  assert.deepEqual(many.ok.results, [{ id: 1, note: 'one' }, { id: 2, note: 'two' }]);
});

const writes = [
  ['an insert', 'run', 'INSERT INTO bytes (id, body) VALUES (?, ?)', [7, 'a']],
  ['an insert that returns a row', 'all', 'INSERT INTO bytes (id, body) VALUES (?, ?) RETURNING id, body', [8, 'b']],
  ['an update of every row', 'run', 'UPDATE bytes SET body = ?', ['c']],
  ['an update of no row', 'all', 'UPDATE bytes SET body = ? WHERE id = ?', ['d', 404]],
  ['a delete', 'run', 'DELETE FROM bytes WHERE id = ?', [8]],
  ['a new table', 'run', 'CREATE TABLE made (id INTEGER PRIMARY KEY)', []],
];

test('a write returns the same meta as the native binding and changes the same rows', async () => {
  const outcomes = [];
  for (const [label, method, sql, params] of writes) {
    outcomes.push(await same(label, (db) => db.prepare(sql).bind(...params)[method]()));
  }
  assert.equal(outcomes[0].ok.meta.last_row_id, 7);
  assert.equal(outcomes[0].ok.meta.changes, 1);
  assert.deepEqual(outcomes[1].ok.results, [{ id: 8, body: 'b' }]);
  assert.equal(outcomes[2].ok.meta.changes, 2);
  const left = await same('the rows left', (db) => db.prepare('SELECT id, body FROM bytes ORDER BY id').all());
  assert.deepEqual(left.ok.results, [{ id: 7, body: 'c' }]);
});

const rejections = [
  ['a unique key', 'INSERT INTO receipt (actor, request_id) VALUES (?, ?)', ['a', 'r']],
  ['a check', 'INSERT INTO child (parent_id, valid) VALUES (?, ?)', [1, 0]],
  ['a foreign key', 'INSERT INTO child (parent_id, valid) VALUES (?, ?)', [404, 1]],
  ['a trigger', 'UPDATE versioned SET version = ? WHERE id = 1', [1]],
  ['a missing table', 'SELECT * FROM absent', []],
];

test('a failing statement rejects with the native message and cause, and a failing batch rolls back', async () => {
  for (const [label, sql, params] of rejections) {
    const expected = await same(`${label}: run`, (db) => db.prepare(sql).bind(...params).run());
    assert.ok(expected.threw, `${label} fails natively`);
    await same(`${label}: first`, (db) => db.prepare(sql).bind(...params).first());
    await same(`${label}: batch`, (db) => db.batch([db.prepare(sql).bind(...params)]));
    const survivor = 'INSERT INTO parent (id, note) VALUES (?, ?)';
    await same(`${label}: batch after a write`, (db) => db.batch([db.prepare(survivor).bind(500, label), db.prepare(sql).bind(...params)]));
    const gone = await same(`${label}: the earlier write rolled back`, (db) => db.prepare('SELECT id FROM parent WHERE id = 500').first());
    assert.deepEqual(gone, { ok: null });
  }
});

test('bind returns a new statement, so one prepared statement binds twice and a later bind replaces an earlier one', async () => {
  const sql = 'SELECT ? AS value';
  const twice = await same('prepare once, bind twice', async (db) => {
    const base = db.prepare(sql);
    const one = base.bind(1);
    const two = base.bind(2);
    return [await settle(() => one.all()), await settle(() => two.all()), await settle(() => base.all()), await settle(() => one.all())];
  });
  const [one, two, unbound, oneAgain] = twice.ok;
  assert.deepEqual([one.ok.results, two.ok.results, oneAgain.ok.results], [[{ value: 1 }], [{ value: 2 }], [{ value: 1 }]]);
  assert.match(unbound.threw.message, /parameter bindings/u);

  const replaced = await same('bind, then bind again', (db) => db.prepare(sql).bind(1).bind(2).all());
  assert.deepEqual(replaced.ok.results, [{ value: 2 }]);
});

test('a value that D1 does not bind as it is gets the native result or the native error', async () => {
  const sql = 'SELECT ? AS value';
  for (const value of [undefined, 5n, { a: 1 }, new Date(0), [300], [1, 'a']]) {
    const outcome = await same(`${String(value)} fails`, (db) => db.prepare(sql).bind(value).all());
    assert.ok(outcome.threw, `${String(value)} fails natively`);
  }
  for (const value of [true, [1, 2], [], new Uint8Array([1, 2]), null, '', 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const outcome = await same(`${String(value)} binds`, (db) => db.prepare(sql).bind(value).all());
    assert.ok(outcome.ok, `${String(value)} binds natively`);
  }
});

test('a batch returns the results of its statements in order, and local and native statements commit or roll back together', async () => {
  const batch = await same('a batch', (db) => db.batch([
    db.prepare('INSERT INTO parent (id, note) VALUES (?, ?) RETURNING id, note').bind(31, 'x'),
    db.prepare('UPDATE parent SET note = ? WHERE id = ?').bind('y', 31),
    db.prepare('SELECT id, note FROM parent WHERE id = ?').bind(31),
    db.prepare('SELECT COUNT(*) AS total FROM parent WHERE id = 31'),
  ]));
  assert.deepEqual(batch.ok.map(({ results }) => results), [[{ id: 31, note: 'x' }], [], [{ id: 31, note: 'y' }], [{ total: 1 }]]);
  assert.equal(batch.ok[0].meta.last_row_id, 31);
  await same('an empty batch', (db) => db.batch([]));

  const insert = (db, id) => db.prepare('INSERT INTO parent (id, note) VALUES (?, ?)').bind(id, 'mixed');
  const viaNative = (db, id) => db.prepare('INSERT INTO parent (id, note) VALUES (?, ?)').bind(id, true);
  const present = (db, ...ids) => db.prepare(`SELECT id FROM parent WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`).bind(...ids).all();

  await same('local and native statements in one batch', (db) => db.batch([insert(db, 11), viaNative(db, 12), insert(db, 13)]));
  const committed = await same('they committed together', (db) => present(db, 11, 12, 13));
  assert.deepEqual(committed.ok.results, [{ id: 11 }, { id: 12 }, { id: 13 }]);

  const refused = await same('a refused batch', (db) => db.batch([insert(db, 21), viaNative(db, 22), insert(db, 11)]));
  assert.match(refused.threw.message, /UNIQUE constraint failed/u);
  const rolledBack = await same('they rolled back together', (db) => present(db, 21, 22));
  assert.deepEqual(rolledBack.ok.results, []);
});

test('exec runs every statement and returns the count', async () => {
  const sql = "CREATE TABLE made_by_exec (id INTEGER PRIMARY KEY, v TEXT);\nINSERT INTO made_by_exec (v) VALUES ('x');\nINSERT INTO made_by_exec (v) VALUES ('y');";
  const result = await same('exec', (db) => db.exec(sql));
  assert.deepEqual(result, { ok: { count: 3, duration: 'number' } });
  const written = await same('what exec wrote', (db) => db.prepare('SELECT v FROM made_by_exec ORDER BY id').all());
  assert.deepEqual(written.ok.results, [{ v: 'x' }, { v: 'y' }]);
  const refused = await same('a failing exec', (db) => db.exec("INSERT INTO made_by_exec (id, v) VALUES (1, 'again')"));
  assert.match(refused.threw.message, /UNIQUE constraint failed/u);
});

test('first takes no column name, because the native binding reads that column and this statement cannot', async () => {
  const sql = 'SELECT 7 AS a, 8 AS b';
  assert.equal(await native.prepare(sql).first('b'), 8);
  for (const name of ['b', '', 0, null]) {
    await assert.rejects(() => local.prepare(sql).first(name), /first takes no column name/u, `first(${JSON.stringify(name)})`);
  }
  await assert.rejects(() => local.prepare(sql).bind().first('b'), /first takes no column name/u);
  const row = await same('first(undefined) is first()', (db) => db.prepare(sql).first(undefined));
  assert.deepEqual(row, { ok: { a: 7, b: 8 } });
});
