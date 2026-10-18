import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArguments } from './configuration.mjs';
import { runTrustedCommand } from './operations.mjs';

// Parent captures both streams. No credential is a process argument or output.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runTrustedCommand(parseArguments(process.argv.slice(2)));
  } catch {
    process.exitCode = 1;
  }
}
