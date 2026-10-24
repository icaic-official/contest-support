import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// Pinned to the same release the retired GitHub Actions job verified.
export const gitleaksRelease = {
  version: '8.30.1',
  sha256: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  asset: 'gitleaks_8.30.1_linux_x64.tar.gz',
};

// Ordinary checks only. Browser and hosted provider commands stay outside this list.
// `npm run build` starts with `tsc -b`, which is the type check. A separate typecheck repeats it.
export const commands = [
  ['npm', ['ci']],
  ['npm', ['ci', '--prefix', 'site']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'check:functions']],
  ['npm', ['run', 'test:functions']],
  ['npm', ['test']],
  ['npm', ['run', 'test:providers:list']],
  ['npm', ['run', 'docs:build']],
  ['npm', ['audit', '--package-lock-only', '--audit-level=high']],
  ['npm', ['audit', '--prefix', 'site', '--package-lock-only', '--audit-level=high']],
];

export function runCommand(command, args, env = process.env) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export async function scanSecrets() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The pinned Gitleaks binary supports linux x64 only.');
  }
  if (existsSync('.git/shallow')) runCommand('git', ['fetch', '--unshallow']);
  const directory = mkdtempSync(join(tmpdir(), 'minsky-gitleaks-'));
  try {
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${gitleaksRelease.version}/${gitleaksRelease.asset}`;
    const response = await globalThis.fetch(url);
    if (!response.ok) throw new Error(`Gitleaks download failed: HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== gitleaksRelease.sha256) {
      throw new Error('Gitleaks checksum does not match the pinned value.');
    }
    const archive = join(directory, gitleaksRelease.asset);
    writeFileSync(archive, bytes);
    runCommand('tar', ['-xzf', archive, '-C', directory, 'gitleaks']);
    const binary = join(directory, 'gitleaks');
    chmodSync(binary, 0o755);
    runCommand(binary, ['git', '--redact', '--verbose', '--log-opts=--all', '.']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function main() {
  const env = { ...process.env, CI: 'true' };
  for (const [command, args] of commands) runCommand(command, args, env);
  await scanSecrets();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
