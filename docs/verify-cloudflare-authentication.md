# Verify Cloudflare authentication

Use this guide for the fictional authentication fixtures.
These procedures test the separate authentication CI target. They do not migrate accounts or deploy the development application.
See the [API reference](cloudflare-authentication.md) and [identity choice](cloudflare-authentication-choice.md) for behavior and resource limits.
For the complete connector, use the separate [direct store procedure](run-provider-tests.md#run-direct-cloudflare-store-checks).
That procedure requires the D1-only `minsky-connector-store-ci` target and all 34 hosted account cases.

Anyone can run the local checks. The hosted sections are for maintainers. Each hosted runner compares its target with fixed values in the code, and it refuses any other target.
`<account-id>` means the `account_id` value in `wrangler.jsonc`. Before you paste a command, set `CLOUDFLARE_ACCOUNT_ID` to that value.

## Run local checks

Use the Node.js version from the README. Install the locked dependencies and Chromium:

```sh
npm ci
npx playwright install chromium
npm run test:auth
npm run test:auth:browser
```

The first suite runs every local account, permission, failure, and race case.
The suite uses three fixed files under `src/server/adapters/cloudflare/`:

| File | Cases |
| --- | --- |
| `authentication.test.ts` | Login, sessions, and password changes. |
| `authenticationRecovery.test.ts` | Organizer account operations, interrupted operations, and recovery. |
| `authenticationCompletion.test.ts` | Current-access races when credential operations complete. |

Cases run serially within each file. The files run concurrently, with up to four workers.
Each file owns a temporary local D1 database and identity service.
Each case creates new UUID-scoped records. Fixture setup, credential snapshots, and cleanup checks use D1 batches.
These batches retain the row assertions and exact fixture ownership checks.
Local runs use a low-cost scrypt in the same stored format, because each Better Auth hash or check takes about 110 ms.
`password.test.ts` checks the maintained hasher. Hosted runs use the maintained hasher.
`npm test` runs these three files with a 30 second case limit.
`npm run test:auth` uses a 120 second limit.
Hosted runs also use 120 seconds, because they use maintained scrypt, which is slow on a busy builder.
The browser suite creates a separate temporary D1 database and a local HTTPS Worker on port 8788.
It uses Chromium with a self-signed local certificate.
Expect every account case and the three browser cases to pass.
The local expiry probe checks a self password change after that change deletes the original identity session.
For that case only, the test double replaces `strftime('now')` with a read of a one-row test clock.
It moves the clock inside the same batch, after the session delete.
It does not spend processor time to advance the wall clock.
Hosted account cases inject expiry inside the actual batch instead, so transport latency does not determine that assertion.
Record the local and hosted case counts separately.
No provider credentials are needed. Local socket access is required.
`npm test` also runs the account suite and browser-adapter unit tests. Browser tests run separately.
The account suite checks password changes after the final allowed username login and retains the separate password-change limit.
The browser-adapter unit tests delay session responses across login, logout, and password changes.
They check that subscriptions retain the completed state after successful or failed requests.

The browser fixture Worker contains test-only setup routes. The deployed Worker does not import those routes.
Browser checks disable traces, screenshots, and video because request bodies contain fictional credentials.
Expected-rejection assertions discard success values so failures cannot print a generated password or cookie.
Fixture passwords and cookies remain in memory. Do not enable request tracing for these suites.
Cleanup checks the UUID-owned records and removes the temporary database directory.

## Confirm the hosted CI target

Check existing Wrangler access before requesting credentials:

```sh
npx wrangler whoami
npx wrangler d1 info minsky-auth-ci --config wrangler.auth-ci.jsonc --json
```

Expect account `<account-id>` and database `5d746d29-0a66-4346-96a6-4974126685d7`.
The database name must be `minsky-auth-ci`. Stop if any value differs.
The local authentication tests use temporary local databases.
The Cloudflare development database is a separate target.

The committed Worker configuration requests a 1,000 ms CPU cap per request.
Cloudflare requires Workers Paid for that setting.
Before deploying the Worker, confirm that an authorized account owner activated Workers Paid for the configured account.
On Free, deployment fails with error `100328`. Do not reduce password cost to bypass that requirement.

Only authorized maintainers apply schema or deploy this isolated CI Worker:

```sh
npx wrangler d1 migrations apply minsky-auth-ci --remote --config wrangler.auth-ci.jsonc
npx wrangler deploy --config wrangler.auth-ci.jsonc
```

Expect every migration in `src/server/adapters/d1/migrations` on an empty target.
Expect `No migrations to apply` on an up-to-date target.
Expect deployment only to `https://minsky-auth-ci.icaic-minsky.workers.dev`.
The Worker requires the existing `AUTH_SECRET`. Preserve that secret on ordinary deployments.
For an empty authorized installation, create a random secret of at least 32 characters in a password manager.
Enter the secret privately with `npx wrangler secret put AUTH_SECRET --config wrangler.auth-ci.jsonc`.
Do not paste secrets into chat or include them in command arguments, files, or logs.
Changing this secret invalidates existing identity cookies.

The selected password cost exceeds the Workers Free CPU allowance in measured samples.
Read the [recorded need and Standard pricing](cloudflare-authentication-choice.md#resource-evidence-and-deployment-cost) before a paid upgrade.
These commands do not change the account plan.

Run hosted D1 account cases with both explicit target identifiers:

```sh
npm run test:auth:hosted -- \
  --account="$CLOUDFLARE_ACCOUNT_ID" \
  --database=5d746d29-0a66-4346-96a6-4974126685d7
```

This command runs local Node.js application code against hosted D1 through Wrangler's remote binding.
It does not measure Worker execution.
Use the separate hosted HTTP runner to call the deployed Worker:

```sh
npm run test:auth:http -- \
  --account="$CLOUDFLARE_ACCOUNT_ID" \
  --database=5d746d29-0a66-4346-96a6-4974126685d7 \
  --origin=https://minsky-auth-ci.icaic-minsky.workers.dev
```

The runners reject missing or different targets before fixture writes.
For a focused D1 rerun, append `--test-name-pattern=PATTERN` using a test-name expression.
The target arguments remain mandatory. Record focused results separately from a complete run.
This filter applies only to the `test:auth:hosted` runner.
The complete connector account runner rejects filters and overrides. It requires all 34 hosted cases without failures or skips.
Its numeric progress reports appear at least every 15 seconds while the test process runs.
Reports include completed and total cases, active cases, elapsed time, and the age of the oldest active case.
They also include database call counts, statement counts, accumulated call time, partial provider-reported SQL time, and calls in progress.
Accumulated call time can exceed elapsed time when calls overlap.
Calls such as `first()` omit timing metadata, so reported SQL time does not cover every statement.
Progress omits case names, SQL text, values, rows, credentials, and raw provider errors.
Expect passing assertions and verified scoped cleanup. Credentials do not appear in results.
Do not run these suites against shared development or real contest data.

## Measure password cost

Measure local Worker hashing and verification with this command:

```sh
npm run test:auth:hash
```

For hosted CPU evidence, run each operation separately. The hosted runs are for maintainers:

```sh
npm run test:auth:hash -- --hosted --operation=hash --account="$CLOUDFLARE_ACCOUNT_ID"
npm run test:auth:hash -- --hosted --operation=verify --account="$CLOUDFLARE_ACCOUNT_ID"
```

Each hosted run creates one temporary Worker without database bindings and deletes it afterward.
The runner uses random fictional inputs and an in-memory request credential.
It reports elapsed time and sampled CPU metrics without passwords, hashes, cookies, or tokens.
Analytics can arrive late or omit samples. Preserve that uncertainty when recording results.
Local elapsed time and hosted client time are not hosted CPU measurements.

## Run hosted checks on demand

Run the hosted authentication checks with the commands in [CI settings](cloudflare-build-settings.md#on-demand-checks).
Run them on the reviewed revision. They migrate and deploy only `minsky-auth-ci`.
They do not deploy the application.
Your Wrangler credentials need D1 access and deployment access to the isolated authentication Worker.
The Worker must already have its private `AUTH_SECRET`.
Ordinary checks run local browser security tests without hosted credentials.

Record local tests and runs against hosted resources separately.
A credential-blocked run is not a pass.

## Recover interrupted fixtures

The D1 fixture records account, event, session, and login IDs before its first write.
Its `/tmp/minsky-d1-proof-*/fixture.json` journal contains the exact authentication configuration and target without credentials.
Verified cleanup removes the journal. Failed cleanup preserves it.
Account-operation rows contain IDs, actions, states, and timestamps. They contain no passwords.

Before manual cleanup, confirm the journal target and exact account markers.
The core accounts use `d1-proof:EVENT_UUID:INDEX` names.
Created account tests use the exact name `auth-fixture:EVENT_UUID`.
The event, two sessions, and account IDs must match the journal.
Inspect only those UUIDs. Stop if ownership differs.

Delete only that fixture's account operations, event, Better Auth users, marked accounts, and password-attempt counters.
Delete the event before its account actors. Foreign keys remove its related workflow records.
Deleting a Better Auth user removes that user's identity sessions and credential rows.
Never print credential-table contents. Inspect counts and IDs instead.
Repeat the count checks before removing the journal.
Do not reset the database or delete another run's records.

For an interrupted account operation in an authorized fixture, reset the password after you check current permissions.
A webmaster or the event's admin can reset it. A contest admin can reset it only when that admin administers every contest of the account and none of those events is archived.
To recover the webmaster of an installation, use [Recover a webmaster password](../site/src/content/docs/operators/installation.mdx#recover-a-webmaster-password). Confirm the exact installation and webmaster before recovery.
