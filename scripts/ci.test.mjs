import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { commands, gitleaksRelease } from './ci.mjs';

describe('Workers Builds command list', () => {
  test('keeps ordinary checks and leaves browser and hosted suites out', () => {
    const flat = commands.map(entry => entry.flat().join(' '));
    expect(flat).toEqual([
      'npm ci',
      'npm ci --prefix site',
      'npm run typecheck',
      'npm run lint',
      'npm run check:functions',
      'npm run test:functions',
      'npm test',
      'npm run test:providers:list',
      'npm run build',
      'npm run docs:build',
      'npm audit --package-lock-only --audit-level=high',
      'npm audit --prefix site --package-lock-only --audit-level=high',
    ]);
    expect(flat.join('\n')).not.toMatch(/playwright|test:e2e|test:cloud|wrangler deploy|test:auth/);
  });

  test('pins the retired workflow Gitleaks release', () => {
    expect(gitleaksRelease).toEqual({
      version: '8.30.1',
      sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
      asset: 'gitleaks_8.30.1_linux_x64.tar.gz',
    });
  });

  test('names the smoke files in the on-demand script', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['test:e2e:smoke']).toBe(
      'playwright test tests/landing.spec.ts tests/journey.spec.ts',
    );
    expect(scripts.ci).toBe('node scripts/ci.mjs');
    expect(scripts['ci:worker']).toBe('node scripts/ci-worker.mjs');
  });
});
