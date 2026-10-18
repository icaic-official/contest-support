# Run the shared provider tests

Use this guide to check an implemented provider against Minsky's shared behavior scenarios.
Use an isolated test backend. Never use development or production accounts.
For the suite's responsibilities and limits, see [the test contracts](provider-test-contracts.md).

Both drivers pass the same eight shared scenarios with verified fixture cleanup.
The Cloudflare CLI run verifies `1ee8cbf` against real hosted endpoints.
The complete hosted React journey passes on `59121f7`, which has the same application Worker source.
The owner activated R2 after the initial provider error `10042`. Private image and live-update journeys now pass.
The full hosted D1 suite separately passes all 70 cases without skips and verifies scoped cleanup.
Protected Cloudflare connector CI remains pending.
See [current state](current-state.md) for the tested revisions and separate evidence categories.

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
3. Confirm current Wrangler access to the exact account and database.
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
Cleanup verifies the owned D1 records, exact R2 keys, and Durable Object state before removing the identifiers-only journal.
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
It accepts no targets or filters and removes its temporary build, bindings, and browser artifacts afterward.
Local emulation does not replace the required hosted Cloudflare evidence.

Run the complete workflow directly against the explicit hosted D1 target:

```sh
npm run test:connector:workflow:hosted -- \
  --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=de43cf95-c024-4e44-860d-8ff179e4e08d
```

Expected output is `Hosted full D1 workflow: 70 passed, 0 failed, 0 skipped.`
This runner uses production identity guards and a temporary D1-only proxy configuration.
It requires the checkout's exact applied migration list, but applies no migrations itself.
It requires no R2 binding or deployed Worker.
Its result does not verify images, hosted product UI, or Durable Object delivery.

Check account permissions and credential races on the same isolated D1 schema:

```sh
npm run test:connector:accounts:hosted -- \
  --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=de43cf95-c024-4e44-860d-8ff179e4e08d
```

Expected output is `Hosted connector accounts: 82 passed, 0 failed, 0 skipped.`
This command checks current permissions, identity expiry, credential generation, revocation, and rollback inside account batches.
It uses maintained password hashing and a D1-only proxy. It does not deploy the Worker or require R2.
The local account suite includes one additional short execution-clock probe. Record that local result separately.
Both direct D1 runners retain fixture journals and their proxy configurations if cleanup fails.

After the full application is deployed, check the actual product UI separately:

```sh
node src/server/adapters/cloudflare/tooling/test-ui.mjs \
  --config=src/server/adapters/cloudflare/deploy/connector-ci.wrangler.jsonc \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=de43cf95-c024-4e44-860d-8ff179e4e08d \
  --origin=https://minsky-connector-ci.icaic-minsky.workers.dev
```

The required result is one hosted UI case with no failures, skips, or retries and verified fixture cleanup.
That result passes on `59121f7` through the actual deployed React application.
Follow [the installation guide](install-cloudflare.md) for the separate empty-installation procedure.
Its hosted journey also passes on `59121f7`, with verified scoped fixture cleanup and the installed baseline intact.

## Run protected GitHub checks

1. Configure the existing `cloud-test` environment as described in [cloud onboarding](cloud-onboarding.md#verification-and-protected-cloud-ci).
2. Confirm that the reviewed branch is allowed. Preserve the existing entries and protection rules.
3. To check Supabase against the prepared CI backend, dispatch the reviewed ticket branch:

   ```sh
   gh workflow run checks.yml --repo GiftedNovaHD/minsky --ref feature/t0020-cloudflare-connector -f existing_backend=true
   ```

4. Check both the existing hosted suite and the shared provider suite in the `cloud` job.
5. Record the revision, backend versions, results, and cleanup outcome.

`existing_backend=true` skips backend preparation.
It does not skip fixture creation or cleanup and does not verify a fresh installation.
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
It confirms and migrates only the connector CI database, runs the full D1 cases, then builds and deploys the isolated Worker.
It runs the shared contracts through the Cloudflare browser driver.
The private bucket, service activation, and initial Worker secret must exist before this job can pass.
The workflow does not activate a paid service or create the bucket.
Its job definition and branch allowlist entry are implemented, but its passing protected result remains pending.
The current protected connector run targets `1ee8cbf`. The passing CLI runs do not establish that protected result.
The T0020 branch was added to the existing allowlist while preserving the other entries and protection rules.
Earlier protected authentication runs do not verify this complete connector job.
Protected Supabase verification passes on `de1ecbd` in [run 39095319959](https://github.com/GiftedNovaHD/minsky/actions/runs/39095319959).
Keep that result separate from the Cloudflare CLI runs and the pending protected connector job.

## Recover an incomplete fixture

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

6. Confirm that recovery exits with code zero and removes the journal.

Recovery checks the target and fixture ownership before deletion.
Do not substitute a project reference or edit identifiers to make a mismatch pass.
If recovery fails, retain the journal and inspect the reported cleanup step.
Do not reset the project or delete records by a broad name prefix.
Recovery skips scenario execution and normal backend prerequisites, but retains target and ownership checks.
For a direct D1 workflow journal, preserve its temporary runtime configuration and follow [D1 fixture recovery](d1-transaction-proof.md#recover-a-failed-run).
