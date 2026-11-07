import assert from 'node:assert/strict';
import { afterAll, beforeAll, test } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { localD1 } from './store-database.mjs';

// One runtime, one database. `native` is the D1 binding that Workers see. `local` wraps that
// binding with the statements that the local suite uses. Both run the same SQL on the same data.
let platform;
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

beforeAll(async () => {
  platform = await getPlatformProxy({
    configPath: 'wrangler.auth-ci.jsonc', persist: false, remoteBindings: false, envFiles: [],
  });
  native = platform.env.DB;
  local = localD1(native);
  await native.batch(schema.map((sql) => native.prepare(sql)));
  await native.batch([native.prepare('INSERT INTO parent (id, note) VALUES (1, ?), (2, ?)').bind('one', 'two')]);
});

afterAll(async () => { await platform?.dispose(); });

/** Fields that depend on timing or on how many rows earlier statements wrote. */
const stable = ({ success, results, meta }) => ({
  success, results,
  meta: { changes: meta.changes, rows_read: meta.rows_read, rows_written: meta.rows_written, changed_db: meta.changed_db },
});

async function failure(attempt) {
  try {
    await attempt();
  } catch (error) {
    return { name: error.name, message: error.message, cause: error.cause?.message };
  }
  return 'resolved';
}

const reads = [
  ['a row', 'SELECT id, note FROM parent WHERE id = ?', [1]],
  ['no row', 'SELECT id FROM parent WHERE id = ?', [99]],
  ['many rows', 'SELECT id, note FROM parent ORDER BY id', []],
  ['an aggregate', 'SELECT COUNT(*) AS total FROM parent', []],
  ['a null and a number', 'SELECT NULL AS blank, ? AS number', [1.5]],
];

test('all, run, and first return what the native binding returns', async () => {
  for (const [label, sql, params] of reads) {
    const expected = await native.prepare(sql).bind(...params).all();
    assert.deepEqual(stable(await local.prepare(sql).bind(...params).all()), stable(expected), `${label}: all`);
    assert.deepEqual(stable(await local.prepare(sql).bind(...params).run()), stable(await native.prepare(sql).bind(...params).run()), `${label}: run`);
    assert.deepEqual(await local.prepare(sql).bind(...params).first(), await native.prepare(sql).bind(...params).first(), `${label}: first`);
  }
  assert.equal(await local.prepare('SELECT id FROM parent WHERE id = 99').first(), null);
  const write = 'INSERT INTO bytes (id, body) VALUES (?, ?)';
  assert.deepEqual(stable(await local.prepare(write).bind(1, 'a').run()), stable(await native.prepare(write).bind(2, 'a').run()));
  assert.deepEqual(stable(await local.prepare('UPDATE bytes SET body = ?').bind('b').all()), stable(await native.prepare('UPDATE bytes SET body = ?').bind('b').all()));
  assert.deepEqual(await local.prepare('SELECT id, body FROM bytes ORDER BY id').all().then(({ results }) => results), [{ id: 1, body: 'b' }, { id: 2, body: 'b' }]);
});

const rejections = [
  ['a unique key', 'INSERT INTO receipt (actor, request_id) VALUES (?, ?)', ['a', 'r'], [['a', 'r']]],
  ['a check', 'INSERT INTO child (parent_id, valid) VALUES (?, ?)', [1, 0], []],
  ['a foreign key', 'INSERT INTO child (parent_id, valid) VALUES (?, ?)', [404, 1], []],
  ['a trigger', 'UPDATE versioned SET version = ? WHERE id = 1', [1], [[1, 1]]],
  ['a missing table', 'SELECT * FROM absent', [], []],
];

test('a failing statement rejects with the native message and cause, and a failing batch rolls back', async () => {
  await native.batch([
    native.prepare('INSERT INTO receipt (actor, request_id) VALUES (?, ?)').bind('a', 'r'),
    native.prepare('INSERT INTO versioned (id, version) VALUES (1, 1)'),
  ]);
  for (const [label, sql, params] of rejections) {
    const expected = await failure(() => native.prepare(sql).bind(...params).run());
    assert.notEqual(expected, 'resolved', `${label} fails natively`);
    assert.deepEqual(await failure(() => local.prepare(sql).bind(...params).run()), expected, `${label}: run`);
    assert.deepEqual(await failure(() => local.prepare(sql).bind(...params).first()), expected, `${label}: first`);
    assert.deepEqual(await failure(() => local.batch([local.prepare(sql).bind(...params)])), expected, `${label}: batch`);
    const survivor = 'INSERT INTO parent (id, note) VALUES (?, ?)';
    const batch = await failure(() => local.batch([local.prepare(survivor).bind(500, label), local.prepare(sql).bind(...params)]));
    assert.deepEqual(batch, expected, `${label}: batch after a write`);
    assert.equal(await local.prepare('SELECT id FROM parent WHERE id = 500').first(), null, `${label}: the earlier write rolled back`);
  }
});

test('a value that D1 does not bind as it is gets the native result or the native error', async () => {
  const sql = 'SELECT ? AS value';
  for (const value of [undefined, 5n, { a: 1 }, new Date(0)]) {
    const expected = await failure(() => native.prepare(sql).bind(value).all());
    assert.notEqual(expected, 'resolved');
    assert.deepEqual(await failure(() => local.prepare(sql).bind(value).all()), expected);
  }
  for (const value of [true, [1, 2], new Uint8Array([1, 2])]) {
    assert.deepEqual((await local.prepare(sql).bind(value).all()).results, (await native.prepare(sql).bind(value).all()).results);
  }
});

test('one batch of local and native statements commits together or rolls back together', async () => {
  const insert = (id) => local.prepare('INSERT INTO parent (id, note) VALUES (?, ?)').bind(id, 'mixed');
  const viaNative = (id) => local.prepare('INSERT INTO parent (id, note) VALUES (?, ?)').bind(id, true);
  const present = async (...ids) => (await local.prepare(`SELECT id FROM parent WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`)
    .bind(...ids).all()).results.map(({ id }) => id);

  await local.batch([insert(11), viaNative(12), insert(13)]);
  assert.deepEqual(await present(11, 12, 13), [11, 12, 13]);

  const refused = await failure(() => local.batch([insert(21), viaNative(22), insert(11)]));
  assert.match(refused.message, /UNIQUE constraint failed/u);
  assert.deepEqual(await present(21, 22), []);
});
