# Run the D1 transaction proof

Use this guide to test the experimental application store in T0017.
The store implements `claim` and `message` only. Supabase remains the active backend.
The [store reference](backend-contracts.md#bounded-d1-application-store) defines the interface and transaction rules.
The [current-state record](current-state.md#t0017-d1-transaction-proof-2026-10-17) records observed results.
T0019 aligns this bounded adapter with the [shared workflow service](server-workflow.md).
The adapter still implements only `claim` and `message`.
Record new adapter checks separately from T0017's historical hosted result.

## Run without cloud access

Use the Node.js version from the [README](../README.md#local-development).
Install the locked dependencies and run the focused suite:

```sh
npm ci
npm run test:d1
```

The suite uses Wrangler's local D1 binding with remote bindings disabled.
It applies the proof migrations to a temporary database and deletes its fixtures afterward.
The same local cases also run in `npm test`. You do not need provider credentials.

## Check the hosted target

Hosted tests require Cloudflare account access with D1 write permission and remote binding access.
Check existing access before you request or create credentials:

```sh
npx wrangler whoami
npx wrangler d1 info minsky-d1-proof-ci --config wrangler.d1-proof.jsonc --json
```

The expected account is `458ad6a930b0fb717796dfa19ca6a2b1`.
The expected database is `minsky-d1-proof-ci`, ID `06560c1c-8907-47d6-b2b6-f22e129ebbe4`.
Stop if either value differs. Keep tokens out of chat, logs, and repository files.

The owner authorized this isolated CI database on 2026-10-17.
Development uses local emulation. This proof needs no hosted development database.
Do not use this CI database for development records, real accounts, or contest data.
The static frontend Workers have no binding to it.

This small fixture workload needs no paid upgrade.
D1's free allowance includes 5 million rows read, 100,000 rows written daily, and 5 GB total storage.
Check [current D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) before expanding the workload.
Document the concrete need and cost before any paid upgrade.

## Apply the schema and run hosted cases

After you confirm the target, apply the proof migrations:

```sh
npx wrangler d1 migrations apply minsky-d1-proof-ci --remote --config wrangler.d1-proof.jsonc
```

Expect both `0001_transaction_proof.sql` and `0002_version_guards.sql` to succeed on their first application.
T0018 adds authentication migrations `0003_authentication.sql` and `0004_identity.sql` to the same directory.
The command also applies those files when absent. They do not enable a complete connector.
The original T0017 hosted result used the first two migrations only.
Run [authentication checks](verify-cloudflare-authentication.md) against the separate `minsky-auth-ci` target.
On later runs, expect `No migrations to apply`.
This command changes only the isolated proof database.
It does not install a complete Cloudflare connector.

Run the hosted suite with both target identifiers:

```sh
npm run test:d1:hosted -- \
  --account=458ad6a930b0fb717796dfa19ca6a2b1 \
  --database=06560c1c-8907-47d6-b2b6-f22e129ebbe4
```

The runner refuses missing or different targets.
Wrangler's remote D1 binding executes the same store code and assertions used locally.
Expect every case to pass and fixture cleanup to complete.
This is a local CLI run against hosted D1. It is separate from protected GitHub Actions verification.

## Recover a failed run

If login access fails, repeat `wrangler whoami` before changing credentials.
If a migration fails, inspect the listed migration status and the exact target before retrying.
Do not substitute the application database or remove another run's records.

Each fixture uses fresh UUIDs and an account name marker.
Cleanup checks the marker and session relationships before deleting those exact records.
Before its first write, each fixture saves `/tmp/minsky-d1-proof-*/fixture.json`.
The journal records the account, database, event, session, team, issue, account, and login IDs without credentials.
Verified cleanup removes that journal. Failed creation or cleanup preserves it.
If cleanup fails, preserve the journal path and fixture identifiers reported by the suite.

For an interrupted hosted run, read the journal and confirm its exact target first.
Replace `RUN_UUID` below with the journal's `eventId`:

```sh
npx wrangler d1 execute minsky-d1-proof-ci --remote --config wrangler.d1-proof.jsonc \
  --command "SELECT id, name FROM accounts WHERE name LIKE 'd1-proof:RUN_UUID:%'; SELECT id FROM sessions WHERE event_id = 'RUN_UUID';"
```

Compare the account IDs and marker names with the journal.
Compare both session IDs with the journal.
Stop if an unexpected record appears.
After you confirm ownership, remove only that event and its exact marked accounts:

```sh
npx wrangler d1 execute minsky-d1-proof-ci --remote --config wrangler.d1-proof.jsonc \
  --command "DELETE FROM events WHERE id = 'RUN_UUID'; DELETE FROM accounts WHERE name IN ('d1-proof:RUN_UUID:0', 'd1-proof:RUN_UUID:1', 'd1-proof:RUN_UUID:2', 'd1-proof:RUN_UUID:3');"
```

The event deletion removes its related workflow records before the account deletion.
Repeat the inspection query and expect no matching accounts or sessions.
Retain the journal until those checks pass. Review covered these recovery commands. Normal verification did not execute them.
Never reset a shared database.

Passing this suite proves the tested transaction pattern on the recorded revision.
It does not verify authentication, a complete connector, migration, installation, or contest capacity.
