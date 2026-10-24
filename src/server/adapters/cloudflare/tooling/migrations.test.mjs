import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertAdditiveMigrations, destructiveStatements } from './migrations.mjs';

test('every repository D1 migration keeps the previous Worker runnable', async () => {
  await assertAdditiveMigrations();
});

test('removed or renamed schema is reported', () => {
  for (const [sql, expected] of [
    ['DROP TABLE issues;', ['DROP TABLE']],
    ['drop table if exists issues;', ['DROP TABLE']],
    ['ALTER TABLE issues DROP COLUMN category;', ['DROP COLUMN']],
    ['ALTER TABLE issues RENAME TO tickets;', ['RENAME']],
    ['ALTER TABLE issues\n  RENAME COLUMN category TO kind;', ['RENAME']],
    ['DROP INDEX issues_by_session;', ['DROP INDEX issues_by_session without a replacement']],
    ['DROP TRIGGER session_changes;', ['DROP TRIGGER session_changes without a replacement']],
    ['DROP VIEW IF EXISTS open_issues;', ['DROP VIEW open_issues without a replacement']],
    // A table rebuild drops the original even when a copy takes its name.
    ['CREATE TABLE issues_new (id TEXT);\nDROP TABLE issues;\nALTER TABLE issues_new RENAME TO issues;', ['DROP TABLE', 'RENAME']],
  ]) {
    assert.deepEqual(destructiveStatements(sql), expected, sql);
  }
});

test('a replaced trigger or index, comments, strings, and similar names are accepted', () => {
  for (const sql of [
    'DROP TRIGGER session_changes;\nCREATE TRIGGER session_changes AFTER UPDATE ON sessions BEGIN SELECT 1; END;',
    'DROP INDEX IF EXISTS issues_by_session;\nCREATE UNIQUE INDEX IF NOT EXISTS issues_by_session ON issues(session_id);',
    '-- DROP TABLE issues;\n/* ALTER TABLE issues RENAME TO tickets; */\nSELECT 1;',
    "INSERT INTO notes(body) VALUES ('DROP TABLE issues; it''s RENAME day');",
    'ALTER TABLE issues ADD COLUMN drop_count INTEGER NOT NULL DEFAULT 0;\nALTER TABLE issues ADD COLUMN renamed_at TEXT;',
    'DELETE FROM notifications WHERE delivered = 1;',
  ]) {
    assert.deepEqual(destructiveStatements(sql), [], sql);
  }
});

test('a re-created object must follow its drop and match its full name', () => {
  assert.deepEqual(
    destructiveStatements('CREATE TRIGGER t AFTER UPDATE ON s BEGIN SELECT 1; END;\nDROP TRIGGER t;'),
    ['DROP TRIGGER t without a replacement'],
  );
  assert.deepEqual(
    destructiveStatements('DROP INDEX by_session;\nCREATE INDEX by_session_and_team ON issues(session_id, team_id);'),
    ['DROP INDEX by_session without a replacement'],
  );
});

test('the repository check names each file and skips only reviewed exceptions', async () => {
  const files = new Map([['0011_keep.sql', 'ALTER TABLE a ADD COLUMN b TEXT;'], ['0012_drop.sql', 'DROP TABLE a;']]);
  const options = { names: async () => [...files.keys()], read: async (name) => files.get(name) };
  await assert.rejects(assertAdditiveMigrations({ ...options, reviewed: new Map() }),
    /0012_drop\.sql: DROP TABLE\. Pause minsky-dev publication/);
  await assertAdditiveMigrations({ ...options, reviewed: new Map([['0012_drop.sql', 'Owner paused publication.']]) });
});
