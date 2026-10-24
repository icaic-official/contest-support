import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryRoot } from './configuration.mjs';

/**
 * Bundle provider source into ignored repository scratch and import it.
 * Packages stay external, so the bundle must sit inside the repository for Node to find them.
 * The bundle contains no credentials. Callers choose the public failure message.
 */
export async function bundleProviderModule(entryPath, prefix) {
  const { build } = await import('esbuild');
  const scratchRoot = resolve(repositoryRoot, '.wrangler');
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(scratchRoot, prefix));
  const output = join(directory, 'module.mjs');
  try {
    await build({
      entryPoints: [resolve(repositoryRoot, entryPath)],
      outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm',
      target: 'node22', logLevel: 'silent',
    });
    return { library: await import(pathToFileURL(output).href), dispose: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
