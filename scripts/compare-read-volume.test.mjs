import { describe, expect, test } from 'vitest';
import { compareReadVolume } from './compare-read-volume.mjs';

const run = (rows) => [{ name: 'base', records: Object.entries(rows).flatMap(([path, values]) =>
  values.map((rowsRead) => ({ path, caller: 'admin', total: { rowsRead } }))) }];

describe('read volume comparison', () => {
  test('passes when every request type stays within the limit, and reports each change', () => {
    const result = compareReadVolume([run({ '/api/snapshot?sessionId=x': [100, 100] })],
      [run({ '/api/snapshot?sessionId=y': [110, 104] })], 10);
    expect(result).toMatchObject({ pass: true, compared: 1, changes: [{ id: 'base | /api/snapshot | admin', base: 100, head: 110, delta: 10 }] });
  });

  test('fails when one request type reads more than the limit', () => {
    const result = compareReadVolume([run({ '/api/contests': [5], '/api/snapshot': [100] })],
      [run({ '/api/contests': [5], '/api/snapshot': [111] })], 10);
    expect(result.pass).toBe(false);
    expect(result.over.map((change) => change.id)).toEqual(['base | /api/snapshot | admin']);
  });

  test('compares the largest count of each side and reports runs that differ', () => {
    const result = compareReadVolume([run({ '/api/snapshot': [100] }), run({ '/api/snapshot': [101] })],
      [run({ '/api/snapshot': [111] })], 10);
    expect(result).toMatchObject({ pass: true, changes: [{ base: 101, head: 111, delta: 10 }],
      varying: ['base base | /api/snapshot | admin (1)'] });
  });
});
