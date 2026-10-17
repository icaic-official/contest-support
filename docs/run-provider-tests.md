# Run the shared provider tests

Use this guide to check an implemented provider against Minsky's shared behavior scenarios.
Use an isolated test project. Never use development or production accounts.
For the suite's responsibilities and limits, see [the test contracts](provider-test-contracts.md).

## List the scenarios without credentials

1. Install the locked dependencies.

   ```sh
   npm ci
   ```

2. List the hosted scenarios.

   ```sh
   npm run test:providers:list
   ```

The command lists the cases without creating accounts, records, or a browser session.
Ordinary pull-request CI runs this command and the credential-free checks.

## Run against Supabase

1. Use a separate test project with the repository migrations and active `admin` and `attachments` functions.
2. Set the function origin to `http://127.0.0.1:4174`.
3. Supply the following variables through your private environment.

   | Variable | Value |
   | --- | --- |
   | `MINSKY_TEST_PROJECT_REF` | The isolated Supabase project reference. Minsky CI uses `ghtztmovdkhuketcbjmq`. |
   | `SUPABASE_ACCESS_TOKEN` | A personal access token that can read the test project's migration and function metadata. |
   | `SUPABASE_ANON_KEY` | The test project's public browser key. |
   | `SUPABASE_SERVICE_ROLE_KEY` | The test project's privileged fixture key. |

4. Install Chromium.

   ```sh
   npx playwright install chromium
   ```

5. Run the Supabase driver.

   ```sh
   npm run test:providers -- --provider=supabase
   ```

The runner requires an explicit provider and target. It does not use the linked development project.
It rejects the known development reference before creating fixtures.
The prerequisite check requires all repository migration versions and both active functions.
It does not prove deployed source equivalence or install missing prerequisites.

Leave the process running until fixture cleanup finishes.
A passing run exits with code zero and removes its recovery journal.
A failed scenario or failed cleanup exits with a nonzero code.
Do not enable traces, screenshots, video, or debug request logging for real fixture credentials.
The runner blocks overrides that change the suite's isolation or reports.

## Run protected GitHub checks

1. Configure the existing `cloud-test` environment as described in [cloud onboarding](cloud-onboarding.md#verification-and-protected-cloud-ci).
2. Restrict the environment to the reviewed branch before dispatch.
3. For a test-only change against the prepared CI backend, run this command.

   ```sh
   gh workflow run checks.yml --repo GiftedNovaHD/minsky --ref feature/t0015-provider-contract-tests -f existing_backend=true
   ```

4. Check both the existing hosted suite and the shared provider suite in the `cloud` job.
5. Record the revision, backend versions, results, and cleanup outcome.

`existing_backend=true` skips backend preparation.
It does not skip fixture creation or cleanup and does not verify a fresh installation.
Use the default preparation mode only when the remote migration history matches the intended backend revision.
The current CI project also has the unmerged announcement migration recorded in [current state](current-state.md#t0014-existing-backend-verification-2026-10-17).

## Recover an incomplete fixture

1. Locate the `recovery.json` path printed by the failed local run.
2. For a GitHub run, download its `provider-recovery` artifact before the seven-day retention period ends.
3. Restore the same provider target and fixture credentials to your private environment.
4. Run recovery with the journal's absolute path.

   ```sh
   npm run test:providers -- --provider=supabase --recover=/absolute/path/recovery.json
   ```

5. Confirm that recovery exits with code zero and removes the journal.

Recovery checks the target and fixture ownership before deletion.
Do not substitute a project reference or edit identifiers to make a mismatch pass.
If recovery fails, retain the journal and inspect the reported cleanup step.
Do not reset the project or delete records by a broad name prefix.
