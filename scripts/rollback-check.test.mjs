import { describe, expect, test } from 'vitest';
import { migrationsToCopy } from './rollback-check.mjs';

describe('rollback check migrations', () => {
  test('copies only the migrations that the previous release does not have', () => {
    const base = new Map([['0001_a.sql', 'A'], ['0002_b.sql', 'B']]);
    const head = new Map([['0001_a.sql', 'A'], ['0002_b.sql', 'B'], ['0004_d.sql', 'D'], ['0003_c.sql', 'C']]);
    expect(migrationsToCopy(base, head)).toEqual(['0003_c.sql', '0004_d.sql']);
  });

  test('refuses a released migration that this checkout changed or removed', () => {
    const base = new Map([['0001_a.sql', 'A'], ['0002_b.sql', 'B']]);
    expect(() => migrationsToCopy(base, new Map([['0001_a.sql', 'A changed'], ['0002_b.sql', 'B']]))).toThrow('0001_a.sql');
    expect(() => migrationsToCopy(base, new Map([['0001_a.sql', 'A']]))).toThrow('0002_b.sql');
  });
});
