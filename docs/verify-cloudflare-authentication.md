# Verify Cloudflare authentication

Use this guide for T0018's fictional authentication fixtures.
Supabase remains active. These procedures do not migrate accounts or deploy the application.
See the [API reference](cloudflare-authentication.md) and [identity choice](cloudflare-authentication-choice.md) for behavior and resource limits.

## Run local checks

Use the Node.js version from the README. Install the locked dependencies and Chromium:

```sh
npm ci
npx playwright install chromium
npm run test:auth
npm run test:auth:browser
```

The first suite creates a temporary local D1 database and runs account, permission, failure, and race cases.
The browser suite creates a separate temporary D1 database and a local HTTPS Worker on port 8788.
It uses Chromium with a self-signed local certificate.
Expect all focused cases and three browser cases to pass.
No provider credentials are needed. Local socket access is required.
`npm test` also runs the account suite. Browser tests run separately.

The browser fixture Worker contains test-only setup routes. The deployed Worker does not import those routes.
Browser checks disable traces, screenshots, and video because request bodies contain fictional credentials.
Fixture passwords and cookies remain in memory. Do not enable request tracing for these suites.
Cleanup checks the UUID-owned records and removes the temporary database directory.

## Confirm the hosted CI target

Check existing Wrangler access before requesting credentials:

```sh
npx wrangler whoami
npx wrangler d1 info minsky-auth-ci --config wrangler.auth-ci.jsonc --json
```

Expect account `458ad6a930b0fb717796dfa19ca6a2b1` and database `5d746d29-0a66-4346-96a6-4974126685d7`.
The database name must be `minsky-auth-ci`. Stop if any value differs.
Development uses local databases. Neither the active Supabase projects nor the earlier D1 proof database is this target.

Only authorized maintainers apply schema or deploy this isolated CI Worker:

```sh
npx wrangler d1 migrations apply minsky-auth-ci --remote --config wrangler.auth-ci.jsonc
npx wrangler deploy --config wrangler.auth-ci.jsonc
```

Expect four migrations on an empty target, or `No migrations to apply` on the current target.
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
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=5d746d29-0a66-4346-96a6-4974126685d7
```

This command runs local Node.js application code against hosted D1 through Wrangler's remote binding.
It does not measure Worker execution.
Use the separate hosted HTTP runner to call the deployed Worker:

```sh
npm run test:auth:http -- \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=5d746d29-0a66-4346-96a6-4974126685d7 \
  --origin=https://minsky-auth-ci.icaic-minsky.workers.dev
```

The runners reject missing or different targets before fixture writes.
For a focused D1 rerun, append `--test-name-pattern=PATTERN` using a test-name expression.
The target arguments remain mandatory. Record focused results separately from a complete run.
Expect passing assertions and verified scoped cleanup. Credentials do not appear in results.
Do not run these suites against shared development or real contest data.

## Measure password cost

Measure local Worker hashing and verification with this command:

```sh
npm run test:auth:hash
```

For hosted CPU evidence, run each operation separately:

```sh
npm run test:auth:hash -- --hosted --operation=hash --account=458ad6a930b0fb717796dfa19ca6a2b1
npm run test:auth:hash -- --hosted --operation=verify --account=458ad6a930b0fb717796dfa19ca6a2b1
```

Each hosted run creates one temporary Worker without database bindings and deletes it afterward.
The runner uses random fictional inputs and an in-memory request credential.
It reports elapsed time and sampled CPU metrics without passwords, hashes, cookies, or tokens.
Analytics can arrive late or omit samples. Preserve that uncertainty when recording results.
Local elapsed time and hosted client time are not hosted CPU measurements.

## Run protected CI

The `Checks` workflow has a `cloudflare_auth` dispatch option.
Select the reviewed branch revision and enable that option.
The protected `cloud-test` environment controls the hosted job.
The existing `CLOUDFLARE_API_TOKEN` needs D1 access and deployment access to the isolated authentication Worker.
The Worker must already have its private `AUTH_SECRET`.
The job checks the target, applies CI migrations, deploys that revision, and runs both hosted suites.
It does not run Supabase migrations or deploy the application.
Ordinary checks run local browser security tests without hosted credentials.

Record local tests, local CLI runs against hosted resources, and protected GitHub Actions results separately.
A skipped or credential-blocked protected job is not a pass.

## Recover interrupted fixtures

The D1 fixture records account, event, session, and login IDs before its first write.
Its `/tmp/minsky-d1-proof-*/fixture.json` journal contains the exact authentication configuration and target without credentials.
Verified cleanup removes the journal. Failed cleanup preserves it.
The protected workflow retains remaining journals for seven days.
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

For an interrupted account operation in an authorized fixture, use organizer-assisted reset after checking current permissions.
The organizer must administer every assigned session. Archived memberships block recovery through the account API.
Lost sole-organizer credentials need a future Cloudflare owner-recovery procedure before independent installations are supported.
The current Supabase owner-recovery command does not operate on Cloudflare.
