# Run the shared provider tests

Use this guide to check an implemented provider against Minsky's shared behavior scenarios.
Use an isolated test backend. Never use development or production accounts.
For the suite's responsibilities and limits, see [the test contracts](provider-test-contracts.md).

The Cloudflare driver runs 11 shared scenarios.
On 2026-10-19, protected runs at `2125875` passed all 11 cases. A later change needs fresh hosted verification.
Record local checks and CLI runs against hosted resources separately. Keep earlier protected GitHub runs as dated evidence.
See [run log](history/run-log.md) for tested revisions, results, and cleanup evidence.
For a new implementation, complete [Add a backend provider](add-provider.md) before using this runner.
The runner currently accepts only `cloudflare`.
The commands below verify existing implementations. They do not register a provider or provision a new installation.

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
`npm run ci` runs this list. It does not run the hosted provider commands below.

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

A passing run exits with code zero after all 11 cases and cleanup.
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
It applies every repository migration to an empty target.
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

The expected result is `Hosted full D1 workflow: 70 passed, 0 failed, 0 skipped.`
This runner uses production identity guards and the reviewed D1-only configuration.
It requires the checkout's exact applied migration list, but applies no migrations itself.
Its result does not check Worker execution, images, the product UI, or live delivery.

Check account permissions and credential races on the same isolated store schema:

```sh
npm run test:connector:accounts:hosted -- \
  --config=src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=341350ba-7c74-4c46-8b21-edfdcda475f5
```

The expected result is `Hosted connector accounts: 34 passed, 0 failed, 0 skipped.`
This command checks current permissions, identity expiry, credential generation, revocation, and rollback inside account batches.
It uses maintained password hashing and the same reviewed D1-only configuration.
The runner includes four fixed authentication files:

- `src/server/adapters/cloudflare/authentication.test.ts`
- `src/server/adapters/cloudflare/authenticationRecovery.test.ts`
- `src/server/adapters/cloudflare/authenticationCompletion.test.ts`

Cases run serially within each file. Up to four files run concurrently.
Each case creates its own UUID-scoped fixture. Each file owns its identity service and database proxy.
Fixture setup, credential snapshots, and cleanup checks use D1 batches with the same row assertions.
The local `npm run test:auth` suite includes one additional expiry-clock probe and must pass all 83 cases.
Record that local result separately from the 34 hosted cases.
Both connector runners reject test filters, count overrides, and configuration overrides beyond the documented target and transport options.
Both direct D1 runners retain their own fixture journals if cleanup fails. They use the original reviewed repository configuration.

Both runners report numeric progress at least every 15 seconds while their test process runs.
Progress includes completed and total cases, elapsed time, active cases, and the age of the oldest active case.
Database totals include calls, statements, accumulated call time (`wall`), provider-reported SQL time (`reported SQL`), and calls in progress.
Accumulated call time can exceed elapsed time because database calls can overlap.
Reported SQL time is partial. Calls such as `first()` return rows without provider timing metadata.
Progress excludes case names, SQL text, bound values, result rows, credentials, and raw provider errors.
The final result still requires every case to pass without failures or skips.

### Use the D1 API transport

The commands above use native D1 bindings through the local Wrangler preview proxy.
This remains the default transport.
If that local proxy disconnects, you can select `--transport=api` for these two store suites.
Read-only probes reproduced a failure while the local proxy forwarded requests to the remote preview Worker.
The underlying connection fault remains unresolved. This option bypasses that proxy for database requests.

Use the same prepared D1-only CI target and existing Wrangler access.
The runner confirms the account, database, configuration, and applied migrations before it starts fixtures.
It reads the existing Wrangler token into memory and passes it privately to the test process.
Do not export a token manually or put credentials in commands, Git, frontend builds, logs, or ordinary CI artifacts.
This option creates no hosted resources.

Run the complete workflow suite first:

```sh
npm run test:connector:workflow:hosted -- \
  --transport=api \
  --config=src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=341350ba-7c74-4c46-8b21-edfdcda475f5
```

The expected result is `Hosted full D1 workflow: 70 passed, 0 failed, 0 skipped.`
After that command finishes, run the complete account suite:

```sh
npm run test:connector:accounts:hosted -- \
  --transport=api \
  --config=src/server/adapters/cloudflare/deploy/connector-store-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=341350ba-7c74-4c46-8b21-edfdcda475f5
```

The expected result is `Hosted connector accounts: 34 passed, 0 failed, 0 skipped.`
The API option uses the same files, assertions, case counts, and timeouts as the binding transport.
The API transport runs files in sequence with one worker. Native account checks retain four workers.
Tests can still run concurrent operations inside each case. The runner adds no retries or case filters.
Each database batch uses one API request and retains transaction rollback, result metadata, numeric values, and null values.

Run these API commands in sequence. Do not run another API store check concurrently.
Both API suites space request starts by 300 milliseconds.
One active file can make about 1,000 requests in five minutes at that pace.
A four-file API run passed 81 cases and timed out one case.
Sequential files give each case the full request budget without increasing that timeout.
Cloudflare's [shared API limit](https://developers.cloudflare.com/fundamentals/api/reference/limits/) is 1,200 requests in five minutes.
Other API activity can use the same allowance. An HTTP 429 response fails the check without a retry.

Keep the same progress and fixture-journal requirements described above.
If a request loses its response, its database outcome can be unknown. Inspect retained journals before cleanup.
Follow [direct D1 fixture recovery](#recover-direct-d1-fixtures) if cleanup is incomplete.
Record the selected transport with the result.
An API result checks database behavior through the D1 HTTP API.
It does not replace native-binding checks, Worker execution checks, or browser checks.

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
Follow [the installation guide](../site/src/content/docs/operators/installation.mdx) for the separate empty-installation procedure.
Record the tested source revision and installation result in the [run log](history/run-log.md).

## Run hosted checks on demand

GitHub Actions no longer runs these checks.
A maintainer or coding agent runs them on the reviewed revision.

For the complete Cloudflare connector, run the hosted commands in this guide on the reviewed revision.
Do not point them at the development database.
The test commands do not migrate, deploy, or create resources.
Before you run them, migrate the store and connector CI databases and deploy the isolated application Worker, as [Run against Cloudflare](#run-against-cloudflare) states.
The private bucket, service activation, and initial Worker secret must exist before those commands can pass.
Record the result and tested revision in [run log](history/run-log.md), separately from other hosted CLI results.
Earlier authentication runs do not check this connector path.

## Recover an incomplete fixture

### Recover shared browser fixtures

1. Locate the `recovery.json` path printed by the failed local run.
2. Restore the same provider target and privileged provider access to your private environment.
3. Retain every exact target option and add the journal path:

   ```sh
   npm run test:providers -- --provider=cloudflare \
     --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
     --account=458ad6a930b0fb717796dfa19ca6a2b1 \
     --database=de43cf95-c024-4e44-860d-8ff179e4e08d \
     --origin=https://minsky-connector-ci.icaic-minsky.workers.dev \
     --recover=/absolute/path/recovery.json
   ```

4. Check that recovery exits with code zero and deletes the journal.

Recovery checks the target and fixture ownership before deletion.
Do not substitute another target or edit identifiers to make a mismatch pass.
If recovery fails, retain the journal and inspect the reported cleanup step.
Do not reset the project or delete records by a broad name prefix.
Recovery skips scenario execution and normal backend prerequisites, but retains target and ownership checks.

### Recover direct D1 fixtures

There is no automatic recovery command for the direct workflow or account suites.
The historical transaction-proof DELETE commands omit modern identity and account records. Do not use those commands for these journals.

Past GitHub Actions runs stored journals under `$RUNNER_TEMP/minsky-connector-store-*/minsky-d1-proof-*/fixture.json`.
Local runs use the same nested directory names under the system temporary directory.
Current runs use the original reviewed repository configuration. They create no temporary Wrangler configuration copy.

1. Retain each `fixture.json` journal and its containing `minsky-connector-store-*` directory.
2. Retain the original repository configuration from that run's source revision.
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
Delete the journal and its private temporary directory only after the batch and independent final checks pass.
Retain the original repository configuration.
