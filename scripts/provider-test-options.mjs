import { isAbsolute } from 'node:path';

/** Validate the explicit target before a browser or privileged client starts. */
export function providerTestOptions(arguments_, environment) {
  const providers = arguments_.filter((argument) =>
    argument.startsWith('--provider=')
  );
  if (providers.length !== 1 || providers[0] !== '--provider=supabase') {
    throw new Error(
      'Select one implemented provider with --provider=supabase.',
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
  const project = environment.MINSKY_TEST_PROJECT_REF ?? '';
  if (!/^[a-z]{20}$/.test(project) || project === 'ovymmobupzowotvrywek') {
    throw new Error(
      'Select an isolated Supabase project with MINSKY_TEST_PROJECT_REF. Development is forbidden.',
    );
  }
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
  const forwarded = arguments_.filter((argument) =>
    !argument.startsWith('--provider=') && !argument.startsWith('--recover=')
  );
  // More than one worker would overwrite the run journal and share fixture accounts.
  // Trace files can contain authentication arguments or provider credentials.
  if (
    forwarded.some((argument) =>
      /^--(?:config|workers|fully-parallel|trace|reporter|output|repeat-each|retries|shard|debug|ui)(?:=|$)/
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
  return { project, recoveryPath, arguments: forwarded };
}
