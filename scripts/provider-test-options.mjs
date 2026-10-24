import { isAbsolute, resolve } from 'node:path';
import { connectorTarget } from '../tests/providers/cloudflare/target.mjs';
import { isolatedSupabaseProject } from '../tests/providers/supabase/target.mjs';

/** Validate the explicit target before a browser or privileged client starts. */
export function providerTestOptions(arguments_, environment) {
  const providers = arguments_.filter((argument) =>
    argument.startsWith('--provider=')
  );
  if (providers.length !== 1 || !['--provider=supabase', '--provider=cloudflare'].includes(providers[0])) {
    throw new Error(
      'Select one implemented provider with --provider=supabase or --provider=cloudflare.',
    );
  }
  const recovery = arguments_.filter((argument) =>
    argument.startsWith('--recover=')
  );
  if (recovery.length > 1) throw new Error('Supply only one recovery journal.');
  const recoveryPath = recovery[0]?.slice('--recover='.length);
  if (recoveryPath !== undefined && !isAbsolute(recoveryPath)) {
    throw new Error('Use an absolute path for the recovery journal.');
  }
  const provider = providers[0].slice('--provider='.length);
  const target = {};
  if (provider === 'cloudflare') {
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
  }
  const project = provider === 'supabase'
    ? isolatedSupabaseProject(environment.MINSKY_TEST_PROJECT_REF)
    : '';
  if (provider === 'supabase') {
    if (
      !environment.SUPABASE_ANON_KEY || !environment.SUPABASE_SERVICE_ROLE_KEY
    ) {
      throw new Error(
        'Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for the isolated test project.',
      );
    }
    if (!recoveryPath && !environment.SUPABASE_ACCESS_TOKEN) {
      throw new Error(
        'Set SUPABASE_ACCESS_TOKEN for the read-only backend prerequisite check.',
      );
    }
  }
  const forwarded = arguments_.filter((argument) =>
    !argument.startsWith('--provider=') && !argument.startsWith('--recover=') &&
      !(provider === 'cloudflare' && ['account', 'database', 'config', 'origin'].some((field) => argument.startsWith(`--${field}=`)))
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
  return provider === 'supabase' ? { project, recoveryPath, arguments: forwarded }
    : { provider, ...target, recoveryPath, arguments: forwarded };
}
