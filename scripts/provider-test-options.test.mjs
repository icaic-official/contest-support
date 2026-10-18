import { describe, expect, test } from 'vitest';
import { providerTestOptions } from './provider-test-options.mjs';

const environment = {
  MINSKY_TEST_PROJECT_REF: 'ghtztmovdkhuketcbjmq',
  SUPABASE_ACCESS_TOKEN: 'fixture-management-value',
  SUPABASE_ANON_KEY: 'fixture-public-value',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-private-value',
};

describe('provider test target and isolation checks', () => {
  test('requires an explicit implemented provider and isolated target', () => {
    for (
      const args of [[], ['--provider=aws'], [
        '--provider=supabase',
        '--provider=supabase',
      ]]
    ) {
      expect(() => providerTestOptions(args, environment)).toThrow();
    }
    for (const project of ['', 'invalid', 'ovymmobupzowotvrywek']) {
      expect(() =>
        providerTestOptions(['--provider=supabase'], {
          ...environment,
          MINSKY_TEST_PROJECT_REF: project,
        })
      ).toThrow();
    }
  });

  test('does not fall back to linked projects or return credential values', () => {
    expect(() => providerTestOptions(['--provider=supabase'], {})).toThrow();
    const result = providerTestOptions([
      '--provider=supabase',
      '--grep',
      'workflow',
    ], environment);
    expect(result).toEqual({
      project: environment.MINSKY_TEST_PROJECT_REF,
      recoveryPath: undefined,
      arguments: ['--grep', 'workflow'],
    });
    expect(JSON.stringify(result)).not.toContain(
      environment.SUPABASE_SERVICE_ROLE_KEY,
    );
  });

  test('refuses settings that weaken isolation or capture credentials', () => {
    for (
      const argument of [
        '--workers=2',
        '--workers',
        '-j2',
        '--config=other.ts',
        '-c',
        '-cplaywright.config.ts',
        '-c/tmp/other.ts',
        '--trace=on',
        '--reporter=html',
        '--output=/tmp/shared',
        '--repeat-each=2',
        '--retries=1',
        '--fully-parallel',
        '--shard=1/2',
        '--debug',
        '--ui',
      ]
    ) {
      expect(() =>
        providerTestOptions(['--provider=supabase', argument], environment)
      ).toThrow();
    }
  });

  test('requires credentials without putting their values in errors', () => {
    expect(() =>
      providerTestOptions(['--provider=supabase'], {
        ...environment,
        SUPABASE_ANON_KEY: '',
      })
    ).toThrow('Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');
    expect(() =>
      providerTestOptions(['--provider=supabase'], {
        ...environment,
        SUPABASE_ACCESS_TOKEN: '',
      })
    ).toThrow('Set SUPABASE_ACCESS_TOKEN');
  });

  test('recovery requires one absolute journal and forbids unrelated runner flags', () => {
    const args = [
      '--provider=supabase',
      '--recover=/tmp/fixture/recovery.json',
    ];
    expect(providerTestOptions(args, environment).recoveryPath).toBe(
      '/tmp/fixture/recovery.json',
    );
    expect(
      providerTestOptions(args, { ...environment, SUPABASE_ACCESS_TOKEN: '' })
        .recoveryPath,
    ).toBe('/tmp/fixture/recovery.json');
    expect(() => providerTestOptions([...args, '--grep=workflow'], environment))
      .toThrow();
    expect(() =>
      providerTestOptions(
        ['--provider=supabase', '--recover=relative.json'],
        environment,
      )
    ).toThrow();
    expect(() =>
      providerTestOptions([...args, '--recover=/tmp/other.json'], environment)
    ).toThrow();
  });
});
