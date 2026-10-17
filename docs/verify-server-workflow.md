# Verify the shared server workflow

Use this guide to check the shared service and its Supabase execution path.
Use fictional fixtures in the approved Minsky CI project, `ghtztmovdkhuketcbjmq`.
The [workflow reference](server-workflow.md) defines the boundaries and compatibility rules.
Record observed results in [current state](current-state.md).

## Run local checks

1. Use the Node.js version specified in the [README](../README.md#local-development).
2. Install the locked dependencies.

   ```sh
   npm ci
   ```

3. Check types, lint, the application build, and local tests.

   ```sh
   npm run typecheck
   npm run lint
   npm run build
   npm test
   ```

4. Check the deployed-function entry points and existing function tests.

   ```sh
   npm run check:functions
   npm run test:functions
   ```

5. Run the browser regressions.

   ```sh
   npx playwright install chromium
   npm run test:e2e
   ```

Expect every command to exit with code zero.
Local tests include shared decisions, orchestration, Supabase commit guards, and the bounded D1 path.
Embedded PostgreSQL uses isolated in-process data.
Local D1 uses Wrangler with remote bindings disabled.
These checks do not establish hosted Supabase or hosted D1 results.

## Prepare the isolated Supabase target

1. Confirm that the selected project is Minsky CI, `ghtztmovdkhuketcbjmq`.

   ```sh
   npx supabase projects list
   ```

2. Create an operational directory outside the checkout.

   ```sh
   workflow_ci_dir=$(mktemp -d /tmp/minsky-workflow-ci.XXXXXX)
   mkdir -p "$workflow_ci_dir/supabase"
   cp supabase/config.toml "$workflow_ci_dir/supabase/config.toml"
   ```

3. Link only that directory to the approved CI project and fetch its migration records.

   ```sh
   npx supabase link --workdir "$workflow_ci_dir" --project-ref ghtztmovdkhuketcbjmq
   npx supabase migration fetch --workdir "$workflow_ci_dir"
   ```

4. If the new migration is absent remotely, copy it and inspect the proposed change.

   ```sh
   cp supabase/migrations/202610180001_shared_workflow.sql "$workflow_ci_dir/supabase/migrations/"
   npx supabase db push --workdir "$workflow_ci_dir" --dry-run
   ```

5. If the dry run lists only `202610180001_shared_workflow.sql`, apply that migration.

   ```sh
   npx supabase db push --workdir "$workflow_ci_dir" --yes
   ```

6. If the migration already exists remotely, retain its recorded source and verify its equivalence before continuing.
7. Deploy the inspected function source from the repository checkout to that CI project.

   ```sh
   npx supabase functions deploy workflow --project-ref ghtztmovdkhuketcbjmq --use-api
   ```

8. Retain the CI functions' existing allowed origins.
9. Keep the development backend and its active browser path unchanged.

The hosted runner does not install migrations or deploy functions.
It accepts only the approved CI project.
The operational directory preserves extra CI migration records, including the existing announcement migration.
If the dry run proposes another migration, stop and inspect the selected target and history.
Do not repair migration history or copy CI-only migrations into the repository.
Use the existing Supabase CLI login or private CI secrets.
Keep access tokens and database keys out of terminal output, Git, and test artifacts.
Do not use `cloud:migrate` or `cloud:functions` for this check. Those commands target development.

## Run the hosted Supabase suite

1. Set the explicit CI target in your private shell environment.

   ```sh
   export MINSKY_TEST_PROJECT_REF=ghtztmovdkhuketcbjmq
   ```

2. If the CLI cannot retrieve the CI keys, supply `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` through your private environment.
3. Run the focused suite.

   ```sh
   npm run test:workflow:hosted
   ```

4. Leave the process running until fixture cleanup finishes.
5. Record the source revision, CI migration, deployed function version, test result, and cleanup result.

The runner retrieves missing keys through the existing CLI login and keeps the key response in memory.
Each run creates real temporary Auth accounts and records with a unique run UUID.
The focused cases share that run's fixture and use distinct issue and request IDs.
The final access-race case changes fixture permissions after the other scenarios finish.
Organizer setup assigns fresh fixture passwords through the privileged Auth API, then completes the actual database mandatory-change gate.
This setup avoids repeated calls to the rate-limited password-change endpoint.
It does not verify that endpoint. The existing provider authentication scenario retains its normal password-change flow.
The connections use the opt-in workflow executor and the real deployed Edge Function.
Provider-neutral lifecycle, access, and retry scenarios retain their existing assertions.
Additional checks exercise the trusted boundary and commit races.

A passing run exits with code zero and removes its recovery journal.
A failure exits with a nonzero code.
A cleanup failure retains `minsky-workflow-proof-*/fixture.json` under `RUNNER_TEMP` or the system temporary directory.
The runner reports the exact journal path.
The journal contains fixture identifiers, not passwords or provider keys.

This command is a local runner against hosted Supabase.
It is separate from protected GitHub Actions checks and hosted D1 verification.
Protected execution also requires the reviewed branch in the `cloud-test` environment's branch allowlist.
This ticket does not change that allowlist or its protection rules.
T0017's recorded hosted D1 result does not verify a changed adapter.
Record any new hosted D1 result separately through the [D1 proof guide](d1-transaction-proof.md).

## Recover an incomplete fixture

1. Retain the exact journal path printed by the failed run.
2. Confirm that the journal names the approved CI project and the failed run.
3. Restore the same CI target and keys in your private environment.
4. Run scoped recovery through the workflow runner.

   ```sh
   npm run test:workflow:hosted -- --recover=/absolute/path/fixture.json
   ```

5. Confirm that recovery exits with code zero and removes the journal.

Recovery checks the event, sessions, and exact account metadata before deletion.
It deletes only that run's records and objects.
If recovery fails, retain the journal and inspect the reported step.
Do not reset the project or broaden the deletion criteria.
