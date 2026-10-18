# Run the shared provider tests

Use this guide to check an implemented provider against Minsky's shared behavior scenarios.
Use an isolated test backend. Never use development or production accounts.
For the suite's responsibilities and limits, see [the test contracts](provider-test-contracts.md).

Both drivers use the same eight shared scenarios.
Record local checks, CLI runs against hosted resources, and protected GitHub runs separately.
The final protected Cloudflare connector check remains pending.
See [current state](current-state.md) for tested revisions, results, and cleanup evidence.

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
A passing run exits with code zero and deletes its recovery journal.
A failed scenario or failed cleanup exits with a nonzero code.
Do not enable traces, screenshots, video, or debug request logging for real fixture credentials.
The runner blocks overrides that change the suite's isolation or reports.

## Run against Cloudflare

The Cloudflare driver permits only this separate connector CI target:

| Resource | Required value |
| --- | --- |
| Account | `458ad6a930b0fb717796dfa19ca6a2b1` |
| D1 database | `minsky-connector-ci`, UUID `de43cf95-c024-4e44-860d-8ff179e4e08d` |
| Worker | `minsky-connector-ci` |
| R2 bucket | `minsky-connector-ci-images` |
| Origin | `https://minsky-connector-ci.icaic-minsky.workers.dev` |
| Configuration | `src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc` |

Do not substitute the authentication CI, transaction-proof, development, or production resources.
The target guard rejects those substitutions before fixture creation.

1. Prepare the isolated D1 schema, activate R2, and create the private bucket.
2. Deploy the reviewed complete application and its private `AUTH_SECRET` to the configured Worker.
3. Check current Wrangler access to the exact account and database.
4. Install Chromium with `npx playwright install chromium`.
5. Run the complete shared registry:

   ```sh
   npm run test:providers -- --provider=cloudflare \
     --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
     --account=458ad6a930b0fb717796dfa19ca6a2b1 \
     --database=de43cf95-c024-4e44-860d-8ff179e4e08d \
     --origin=https://minsky-connector-ci.icaic-minsky.workers.dev
   ```

The runner checks the generated configuration, live target metadata, and the protected application entry.
Fixture setup checks required migrations and schema fields before creating records.
Each browser context uses real hosted cookies, API requests, and WebSockets.
Only test bridge assets come from the local Vite server.
Both providers run the same eight behavior assertions.

A passing run exits with code zero after all eight cases and cleanup.
Cleanup verifies the owned D1 records, exact R2 keys, and Durable Object state before deleting the identifiers-only journal.
The selected Worker must expose the trusted `SessionMaintenance` service entrypoint from this revision.
The fixture checks that internal binding before it creates records. It does not use a public setup or cleanup route.
Do not enable credential-bearing traces, screenshots, video, or request debug logs.

## Check the complete Cloudflare runtime separately

Run the local HTTPS application check without hosted credentials:

```sh
npm run test:connector:runtime
```

This command accepts no provider target.
It uses fictional accounts, Chromium, and temporary local D1, R2, and Durable Object resources.
One complete runtime case passes locally.
That result does not establish hosted deployment or a fresh installation.

Run the complete React journey against a temporary local application:

```sh
npm run test:connector:ui:local
```

This command builds a separate Cloudflare frontend without replacing the default `dist` output.
It uses the same UI assertions as the guarded hosted journey, with separate local fixture setup.
It accepts no targets or filters and deletes its temporary build, bindings, and browser artifacts afterward.
Local emulation does not replace the required hosted Cloudflare evidence.

## Run direct Cloudflare store checks

The direct workflow and account suites require this separate D1-only target:

| Resource | Required value |
| --- | --- |
| Account | `458ad6a930b0fb717796dfa19ca6a2b1` |
| D1 database | `minsky-connector-store-ci`, UUID `341350ba-7c74-4c46-8b21-edfdcda475f5` |
| Configuration | `src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc` |

This configuration contains one D1 binding and no application entrypoint.
Do not bind this database to a deployed Worker.
These suites require no R2 bucket or Durable Object namespace.
Their target guards reject the full connector, authentication, historical proof, and development configurations.
The shared browser and product UI suites continue to use `minsky-connector-ci` above.

Shared Cloudflare clients report endpoint names, status counts, and request durations before logout.
For a resource authentication rejection, diagnostics record cookie presence and read only the fixture account's authentication flags.
These flags describe the newest login wrapper. Check the wrapper count before interpreting a client-specific failure.
The output excludes URLs, account IDs, cookies, passwords, and provider error text.

An active Worker can change notification delivery fields while a direct test compares database state.
Those fields are `delivered`, `attempts`, and `last_attempt_at`.
Notification delivery can also create coordinator cursors outside direct-fixture cleanup.
The separate database prevents that overlap. The tests retain their complete durable-state comparisons.

Check existing Wrangler access before preparing the schema:

```sh
npx wrangler whoami
node src/server/adapters/cloudflare/tooling/store-target.mjs migrate \
  --config=src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=341350ba-7c74-4c46-8b21-edfdcda475f5
```

The helper checks the exact account, database name, UUID, and configuration before applying migrations.
It applies all nine repository migrations to an empty target.
It accepts an existing schema only when its migration history matches a reviewed prefix.
Expected output is `Dedicated store CI migrations match this checkout.`
The helper deploys no Worker and creates no R2 or Durable Object resources.

Run the complete workflow suite:

```sh
npm run test:connector:workflow:hosted -- \
  --config=src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=341350ba-7c74-4c46-8b21-edfdcda475f5
```

Expected output is `Hosted full D1 workflow: 70 passed, 0 failed, 0 skipped.`
This runner uses production identity guards and a temporary D1-only proxy configuration.
It requires the checkout's exact applied migration list, but applies no migrations itself.
Its result does not check Worker execution, images, the product UI, or live delivery.

Check account permissions and credential races on the same isolated store schema:

```sh
npm run test:connector:accounts:hosted -- \
  --config=src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=341350ba-7c74-4c46-8b21-edfdcda475f5
```

Expected output is `Hosted connector accounts: 82 passed, 0 failed, 0 skipped.`
This command checks current permissions, identity expiry, credential generation, revocation, and rollback inside account batches.
It uses maintained password hashing and a D1-only proxy.
The runner includes four fixed authentication files:

- `src/server/adapters/cloudflare/authentication.test.ts`
- `src/server/adapters/cloudflare/authenticationRecovery.test.ts`
- `src/server/adapters/cloudflare/authenticationInitiation.test.ts`
- `src/server/adapters/cloudflare/authenticationCompletion.test.ts`

Cases run serially within each file. Up to four files run concurrently.
Each case creates its own UUID-scoped fixture. Each file owns its identity service and database proxy.
Fixture setup, credential snapshots, and cleanup checks use D1 batches with the same row assertions.
The local `npm run test:auth` suite includes one additional execution-clock probe and must pass all 83 cases.
Record that local result separately from the 82 hosted cases.
Both connector runners reject test filters, count overrides, and configuration overrides beyond the required target options.
Both direct D1 runners retain fixture journals and proxy configurations if cleanup fails.

Both runners report numeric progress at least every 15 seconds while their test process runs.
Progress includes completed and total cases, elapsed time, active cases, and the age of the oldest active case.
Database totals include calls, statements, accumulated call time (`wall`), provider-reported SQL time (`reported SQL`), and calls in progress.
Accumulated call time can exceed elapsed time because database calls can overlap.
Reported SQL time is partial. Calls such as `first()` return rows without provider timing metadata.
Progress excludes case names, SQL text, bound values, result rows, credentials, and raw provider errors.
The final result still requires every case to pass without failures or skips.

## Check the hosted React application

After deploying the full application, check the actual product UI separately:

```sh
node src/server/adapters/cloudflare/tooling/test-ui.mjs \
  --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=de43cf95-c024-4e44-860d-8ff179e4e08d \
  --origin=https://minsky-connector-ci.icaic-minsky.workers.dev
```

The required result is one hosted UI case with no failures, skips, or retries and verified fixture cleanup.
The journey checks all nine commands, jury worklist transitions, images, live updates, and account administration.
Follow [the installation guide](install-cloudflare.md) for the separate empty-installation procedure.
Record the tested source revision and installation result in the current-state record.

## Run protected GitHub checks

1. Configure the existing `cloud-test` environment as described in [cloud onboarding](cloud-onboarding.md#verification-and-protected-cloud-ci).
2. Check that the environment permits the reviewed branch. Preserve the existing entries and protection rules.
3. To check Supabase against the prepared CI backend, dispatch the reviewed ticket branch:

   ```sh
   gh workflow run checks.yml --repo GiftedNovaHD/minsky --ref feature/t0020-cloudflare-connector -f existing_backend=true
   ```

4. Check both the existing hosted suite and the shared provider suite in the `cloud` job.
5. Record the revision, backend versions, results, and cleanup outcome.

`existing_backend=true` skips backend preparation.
It does not skip fixture creation or cleanup and does not check a fresh installation.
Use the default preparation mode only when the remote migration history matches the intended backend revision.
The [earlier CI preparation record](current-state.md#t0014-existing-backend-verification-2026-10-17) includes an extra announcement migration.
Inspect the live migration history before preparation rather than assuming it matches a clean checkout.

For the complete Cloudflare connector, select its separate input:

```sh
gh workflow run checks.yml --repo GiftedNovaHD/minsky --ref feature/t0020-cloudflare-connector -f cloudflare_connector=true
```

Use only the connector mode for that dispatch.
The reviewed revision and workflow definition must exist on that remote branch.
The protected job waits for ordinary checks, secret scanning, and dependency checks.
It checks and migrates the dedicated store CI database for the 70 workflow and 82 account cases.
It prepares the separate full connector database before it builds and deploys the isolated application Worker.
It runs the shared contracts and React journey against that full connector.
The private bucket, service activation, and initial Worker secret must exist before this job can pass.
The workflow does not activate a paid service or create the bucket.
The final protected connector result remains pending. CLI results do not establish that protected result.
The existing allowlist includes the T0020 branch. Preserve the other entries and protection rules.
Earlier protected authentication runs do not check this complete connector job.
Record protected Supabase verification separately from Cloudflare CLI runs and the protected connector job.

## Recover an incomplete fixture

### Recover shared browser fixtures

1. Locate the `recovery.json` path printed by the failed local run.
2. For a GitHub run, download its `provider-recovery-*` or `connector-recovery-*` artifact before the seven-day retention period ends.
3. Restore the same provider target and privileged provider access to your private environment.
4. For Supabase, run recovery with the journal's absolute path:

   ```sh
   npm run test:providers -- --provider=supabase --recover=/absolute/path/recovery.json
   ```

5. For Cloudflare, retain every exact target option and add the journal path:

   ```sh
   npm run test:providers -- --provider=cloudflare \
     --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
     --account=458ad6a930b0fb717796dfa19ca6a2b1 \
     --database=de43cf95-c024-4e44-860d-8ff179e4e08d \
     --origin=https://minsky-connector-ci.icaic-minsky.workers.dev \
     --recover=/absolute/path/recovery.json
   ```

6. Check that recovery exits with code zero and deletes the journal.

Recovery checks the target and fixture ownership before deletion.
Do not substitute a project reference or edit identifiers to make a mismatch pass.
If recovery fails, retain the journal and inspect the reported cleanup step.
Do not reset the project or delete records by a broad name prefix.
Recovery skips scenario execution and normal backend prerequisites, but retains target and ownership checks.

### Recover direct D1 fixtures

There is no automatic recovery command for the 70 workflow or 82 account cases.
The historical transaction-proof DELETE commands omit modern identity and account records. Do not use those commands for these journals.

1. Retain each `/tmp/minsky-d1-proof-*/fixture.json` journal.
2. Retain the matching `/tmp/minsky-connector-workflow-*/wrangler.jsonc` or `/tmp/minsky-connector-accounts-*/wrangler.jsonc` runtime configuration.
3. Check the journal's account, database name, database UUID, and configuration against live metadata.
4. Check that the original migrations and foreign-key constraints remain installed.
5. Stop the interrupted test process before inspecting or deleting its records.

Current direct runs use `minsky-connector-store-ci`.
An older journal can refer to the full connector database. Keep that original target and schema when investigating the journal.
Do not redirect an old journal to the new store database.
If the original database has a Worker binding, check its fixture coordinator state separately before declaring cleanup complete.
A D1-only deletion does not check Durable Object storage.

Prepare a private recovery worksheet from the journal and current rows.
Select only IDs, names, usernames, and relationship fields. Do not print password hashes, identity tokens, cookies, or CSRF values.
The `workflow` flag does not establish whether identity rows exist. The account suite creates identity rows after the initial fixture write.

Check these ownership conditions before preparing a deletion batch:

- Each remaining journal account must have its exact name, `d1-proof:<eventId>:<index>`.
  The index is its position in the journal's four-account array.
- Each journal session must belong to the journal event. No additional session may belong to that event.
  Check the journal's teams and their session relationships too.
- The account suite can create extra accounts named exactly `auth-fixture:<eventId>`.
  Record each extra UUID only after checking its fixture memberships and account-operation relationships.
  A matching name alone does not establish ownership.
- Every membership for an owned account must remain inside the two fixture sessions.
  Every membership in those sessions must reference an owned account.
- Check `account_operations.account_id`, `actor`, and `session_id` for every operation involving an owned account.
  Both accounts must be owned. A non-null session must be a fixture session.
- Check workflow actor, owner, reporter, resolution, and award references involving those accounts.
  Check `admin_audit.actor` and `target` too. Stop if any relationship reaches a foreign account, session, or event.
- No installation record may reference the fixture event, sessions, or accounts.
  Direct store fixtures do not create images. Stop if image records require separate object cleanup.

A partially completed cleanup can leave some expected rows absent.
Check the remaining relationships before proceeding. Preserve the journal if ownership cannot be established.
Do not recreate records to make an ownership check pass.

Record exact identity and rate-limit keys before deleting account rows:

- Include every `ba_user.id` that matches a checked account UUID.
  Check related `ba_account.userId` and `ba_session.userId` values without reading their credential fields.
- Include application logins by `logins.account_id`, not only the initial login IDs in the journal.
  Authentication tests can create additional logins.
- Include exact `username:<normalized-username>` and `change:<account-UUID>` keys proved to belong to the fixture.
  Account tests use `auth_` plus the first 20 characters of the event UUID after deleting hyphens, and an admin `_a` suffix.
  Check current identity usernames and checked extra accounts for additional exact keys.
- Preserve shared `ip:` counters. Never delete counters by a prefix or guess an unrecorded username.

Have a maintainer prepare one reviewed `D1Connection.batch` with bound UUIDs and exact keys.
Repeat the ownership predicates inside that batch before deletion.
Use the existing non-null `command_assertions.valid = 1` constraint to abort the batch on a mismatch.
A separate inspection query is not an atomic deletion guard.

Use this deletion order inside the guarded batch:

1. Delete the exact owned event. Its foreign keys delete the fixture sessions, workflow records, session audit, and outbox records.
2. Delete any remaining `account_operations` involving the checked target or actor UUIDs.
3. Delete the checked `ba_user` UUIDs. Foreign keys delete their `ba_account` and `ba_session` rows.
4. Delete any remaining application logins by the checked account UUIDs.
5. Delete only the checked exact authentication-limit keys.
6. Delete the checked account UUIDs with their checked name markers.

Add final zero-row assertions for the fixture records before the batch commits.
Check all notification audiences, including `account:` records, and all associated sequence counters.
Check remaining history, audit, operation, identity, login, membership, and authentication-limit rows.
Delete the temporary assertion rows inside the same batch.
Retain the migrations and schema. Preserve unrelated records and shared IP counters.
Delete the journal and runtime configuration only after the batch and independent final checks pass.
