import { isAbsolute, resolve } from 'node:path';
import { connectorTarget } from '../tests/providers/cloudflare/target.mjs';

/** Validate the explicit target before a browser or privileged client starts. */
export function providerTestOptions(arguments_) {
  const providers = arguments_.filter((argument) =>
    argument.startsWith('--provider=')
  );
  if (providers.length !== 1 || providers[0] !== '--provider=cloudflare') {
    throw new Error('Select the implemented provider with --provider=cloudflare.');
  }
  const recovery = arguments_.filter((argument) =>
    argument.startsWith('--recover=')
  );
  if (recovery.length > 1) throw new Error('Supply only one recovery journal.');
  const recoveryPath = recovery[0]?.slice('--recover='.length);
  if (recoveryPath !== undefined && !isAbsolute(recoveryPath)) {
    throw new Error('Use an absolute path for the recovery journal.');
  }
  const target = {};
  for (const field of ['account', 'database', 'config', 'origin']) {
    const values = arguments_.filter((argument) => argument.startsWith(`--${field}=`));
    if (values.length !== 1 || values[0] === `--${field}=`) {
      throw new Error('Cloudflare tests require one explicit --account, --database, --config, and --origin.');
    }
    target[field] = values[0].slice(field.length + 3);
  }
  if (target.account !== connectorTarget.accountId || target.database !== connectorTarget.databaseId ||
      target.origin !== connectorTarget.origin) {
    throw new Error('Select only the confirmed isolated Cloudflare connector CI target. Development, authentication, and proof resources are forbidden.');
  }
  target.config = resolve(target.config);
  const forwarded = arguments_.filter((argument) =>
    !argument.startsWith('--provider=') && !argument.startsWith('--recover=') &&
      !['account', 'database', 'config', 'origin'].some((field) => argument.startsWith(`--${field}=`))
  );
  // More than one worker would overwrite the run journal and share fixture accounts.
  // Trace files can contain authentication arguments or provider credentials.
  if (
    forwarded.some((argument) =>
      /^--(?:config|workers|fully-parallel|trace|reporter|output|repeat-each|retries|shard|debug|ui|password|token|secret|key)(?:=|$)/
        .test(argument) || /^-[cj]/.test(argument)
    )
  ) {
    throw new Error(
      'Do not override the provider suite isolation, reports, or retry settings.',
    );
  }
  if (recoveryPath && forwarded.length) {
    throw new Error(
      'Recovery does not accept test filters or runner overrides.',
    );
  }
  return { provider: 'cloudflare', ...target, recoveryPath, arguments: forwarded };
}
