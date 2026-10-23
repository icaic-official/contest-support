# PR #21 installation component record

This reference records the installation work inspected in [PR #21](https://github.com/GiftedNovaHD/minsky/pull/21).
It separates reusable components from the older Supabase and container implementation.
The reviewed PR revision is `c9c3116be7d3e1a7712b0d462b8bf40e8255e725`.
GitHub reported the PR open on 2026-10-18.
This record does not authorize its merge or closure.

## Components

| PR #21 source | Disposition for the Cloudflare connector |
| --- | --- |
| `deploy/competition.example.json` | Reuse the `adminName`, `eventName`, `sessionName`, `categories`, and `teams` fields. Each team retains `name` and `location`. Replace the existing Supabase `adminUserId` requirement with `adminUsername`. The configuration contains no passwords or provider credentials. |
| `scripts/installation.mjs` text checks | Reuse trimming, nonempty values, the 200-character limit, null-byte rejection, and uniqueness after trimming. The Cloudflare implementation uses Zod for these checks. |
| `renderBootstrap()` input checks | Reuse the object requirement, nonempty category list, team array, and optional empty roster. Reject unknown configuration fields. |
| `renderBootstrap()` PostgreSQL generator | Replace the SQL generator with parameter-bound D1 statements. PostgreSQL dollar quoting, escape strings, arrays, advisory locks, and `auth.users` do not apply to Cloudflare. |
| `renderBootstrap()` initialization safeguards | Reuse trusted operator execution, a closed initial intake, an explicit owner record, atomic creation, and rejection of repeated initialization. Strengthen the empty-database check to inspect all application and identity tables. Repeat that check inside the atomic batch. |
| `scripts/installation.test.mjs` validation cases | Reuse malformed configuration, whitespace duplicates, null bytes, empty categories, and quoted configuration cases. The hostile event name retains the old dollar delimiter and SQL text. Team values retain an apostrophe and a backslash. |
| `scripts/installation.test.mjs` PostgreSQL fixture | Replace the fixture with local D1 emulation that loads all current migrations. Verify rollback, concurrent initialization, lost responses, temporary-password enforcement, and owner recovery. Local checks do not prove hosted installation. |
| `validateFrontendEnvironment()` | Retain its principle that errors must omit credentials. Replace Supabase URL and key assumptions for Cloudflare. Supabase-specific public-key validation remains provider-specific. |
| `deploy/wrangler.example.jsonc` | Replace the frontend-only template for a complete installation. The new configuration must identify independent D1, R2, Durable Object, Worker, origin, and secret settings. Do not copy the original deployment IDs. |
| `scripts/container-smoke.mjs` | Replace the Nginx and Supabase smoke command. The Cloudflare guide includes a private-path check and a complete browser checklist. The hosted UI test passes through the deployed application and its assets. The old script's cache-header assertions have not been ported. |
| `docs/self-hosting.md` | Reuse explicit target selection, separate credentials, operator prerequisites, reviewed configuration, and clear verification limits. Replace its procedure with the [Cloudflare development installation guide](../site/src/content/docs/operators/installation.mdx). The review-fix empty hosted trial passes on `2b6f6f0`. |
| `Dockerfile`, `compose.yaml`, `deploy/nginx.conf`, `.dockerignore`, and Docker update settings | Defer. Docker packaging is outside this goal. |
| Branch-wide guidance, workflow, and dependency edits | Do not merge the old branch wholesale. Apply only changes required by the current architecture and ticket. |

## Provider implementation

[installation.ts](../src/server/adapters/cloudflare/installation.ts) owns configuration validation, first installation, and trusted owner recovery.
[0008_installation.sql](../src/server/adapters/d1/migrations/0008_installation.sql) records the initial owner, event, and session.
These functions require trusted provider access.
They have no public HTTP route and perform no automatic first-login promotion.
The [operator command](../src/server/adapters/cloudflare/tooling/install.mjs) confirms the exact account and database before it calls either function.
It also requires the hosted migration list to match the current checkout before bootstrap, recovery, or initial secret creation.
The migration command permits a partial list so it can apply the missing reviewed migrations.
The command forces Wrangler log sanitization and disables Wrangler debug files before provider access.

`bootstrapInstallation()` creates the application account and Better Auth credential in the same atomic D1 batch.
The batch also creates the event, session, roster, administrator membership, audit record, and installation marker.
The initial account must change its generated temporary password before contest access.
The batch leaves contestant intake closed.
The function rejects foreign or partial application records instead of deleting them.

`recoverInstallationOwner()` targets the recorded owner by installation and account UUID.
The owner must retain administrator membership in the initial active session.
Recovery does not enable a disabled account or restore removed permissions.
The first batch records a pending credential operation, increases the credential generation, and revokes old sessions.
The function then calculates the password hash outside the batch.
A guarded completion batch replaces the credential and retains the mandatory-password gate.
An interrupted recovery stays restricted.
A later trusted attempt supersedes the interrupted operation.
Recovery preserves account IDs, memberships, history, and installation records.

The functions return generated temporary passwords only to the trusted caller in memory.
They do not log passwords, write credential files, or retrieve earlier passwords.
The operator command saves the returned result only in a newly created private file outside the checkout.
It refuses existing output files and retains its result file after errors.
A lost success response requires inspection and trusted recovery.
It does not authorize deletion or another bootstrap.

## Verification and disposition

[installation.test.ts](../src/server/adapters/cloudflare/installation.test.ts) covers local validation, bootstrap, and owner recovery.
The tooling tests cover exact target and migration checks, private output, inherited logging settings, and refusal to rotate an existing secret.
The [review-fix empty hosted installation](current-state.md#fresh-installation-after-review-fixes) passes the full React journey and trusted owner recovery on `2b6f6f0`.
It verifies mandatory password changes, rejected repeated bootstrap and secret creation, original IDs and history, and scoped cleanup.
The active ticket records protected CI separately.
PR #21's older PostgreSQL and frontend checks do not establish those results.

Recommend that the owner close PR #21 as superseded for Cloudflare installation.
The [installation guide](../site/src/content/docs/operators/installation.mdx), current empty-installation trial, and [protected connector result](current-state.md#protected-verification-after-review-fixes) supply the replacement procedure and evidence.
The owner decides whether to close the PR.
Container packaging, an AWS backend, and Terraform remain outside this goal.
