# Prepare the Cloudflare backend

This plan defines implementation and verification of the [Cloudflare connector](cloudflare-backend-design.md).
T0016 added design documents. T0015 added shared tests and Supabase fixes.
The phases below are acceptance steps, not additional opened development tickets.

T0020 uses `feature/t0020-cloudflare-connector`, from updated `main` at `7d19b00` after PR #41 merged.
The complete connector passes hosted development journeys with verified fixture cleanup. Protected connector CI remains pending.
Supabase remains the active development backend.

## Current milestone evidence

| Milestone | Implemented behavior | Observed verification and remaining gate |
| --- | --- | --- |
| Complete D1 workflow | All nine commands persist shared `WorkflowService` decisions with atomic effects and current identity guards. | All 70 local and hosted D1 cases pass with scoped cleanup. Direct hosted target: D1-only `minsky-connector-store-ci`, database `341350ba-7c74-4c46-8b21-edfdcda475f5`. |
| Complete application boundary | Authenticated routes, session lists, authorized snapshots, administration, and every browser `Backend` group. | Application cases, the local HTTPS runtime, and local and hosted complete React journeys pass. All 82 hosted D1 account cases pass. |
| Private R2 images | Reservations, immutable transfers, completion, authorized downloads, removal, abandonment, expiry, and exact-key recovery. | All 59 local image cases pass. Hosted shared scenarios and the complete React journey verify private R2 image behavior and scoped cleanup. |
| Durable Object updates | Audience-specific delivery from the D1 outbox, current-access checks, duplicate handling, reconnect refresh, and retry recovery. | Local delivery and cleanup-binding checks pass. Hosted shared scenarios verify audience separation and independent subscribers. The hosted React journey verifies reconnection and refreshed state. |
| Shared provider assertions | Both fixture drivers use the same eight scenarios. | Both providers pass all eight unchanged scenarios with verified fixture cleanup. The Cloudflare CLI run verifies `1ee8cbf`. |
| Empty installation | Provider-owned configuration, explicit target checks, atomic bootstrap, and trusted owner recovery. | Local bootstrap, recovery, and tooling cases pass. The separate documented hosted journey passes on `59121f7`, with verified scoped fixture cleanup. |

The owner activated R2 after the initial provider error `10042`.
The isolated Standard CI bucket has public access disabled and passes hosted image journeys.
Workers Paid is active.
Direct workflow and account cases use the D1-only store target. The application keeps its separate database and live bindings.
The complete hosted React and separate empty-installation journeys pass on `59121f7`.
The shared CLI run verifies `1ee8cbf`. Its bridge correction leaves the application Worker source unchanged.
Protected Cloudflare connector CI on `9b0ef6b` passes both direct suites, then fails two shared browser scenarios. Record this result separately from CLI evidence.
Record each result with its actual revision and target in [current state](current-state.md).
Earlier aggregate test counts describe those runs and do not replace checks of the final PR revision.

## Use the merged design and provider tests

PR #32 merged on 2026-10-17 at `ef6a029`. T0014's merge step is complete.

T0015 merged in [PR #37](https://github.com/GiftedNovaHD/minsky/pull/37) at `738ef4a` on 2026-10-17.
Its protected run passed all eight shared scenarios and all 14 existing hosted UI tests.
T0016 merged in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36) at `b68ef72` on 2026-10-17 at 13:50:36 UTC.
The design review and bounded T0017 proof are complete.
T0019 extracted the existing server workflow before further Cloudflare persistence and merged in PR #41.
Authentication in PR #40 merged at `68e8642`.

The user authorized T0015 and T0016 in parallel on 2026-10-17 while PR #32 was under review.
Both branches started at its `d158906` revision. The design branch later included PR #32 and PR #37.
Supabase remains active.

The [shared suite](provider-test-contracts.md) and its [verification record](current-state.md#t0015-shared-provider-tests-2026-10-17) are available in this branch.
The shared suite does not cover every provider-specific race or failure.
Focused D1, image, authentication, administration, and live-update tests supply additional coverage.

## Prove the database transaction pattern

T0017 used `feature/t0017-d1-transaction-proof` from updated `main` at `53f9dfd`.
[PR #39](https://github.com/GiftedNovaHD/minsky/pull/39) implements the bounded proof.
The recorded `edb4bd0` run passed all 42 local and hosted D1 cases, with verified scoped fixture cleanup.
See [the evidence](current-state.md#t0017-d1-transaction-proof-2026-10-17).
The owner merged PR #39 at `0c797ad` on 2026-10-17 at 15:49:49 UTC.
Those hosted results apply to the recorded proof revision, not later adapter changes.
See [the proof guide](d1-transaction-proof.md) for the focused scope and verification procedure.

That bounded phase defined the schema and application-store interface.
It verified atomic command effects, concurrent receipts, response loss, and access races.
Its historical constructor mode remains explicit and separate from production guards.
T0020 extends the same shared service to every command and verifies current identity state at commit and replay.

Completion requires hosted D1 evidence that a failed assertion rolls back the entire batch.
A losing concurrent request must not create history, an award, or a notification.
Private state conflicts must not change contestant-visible revisions or disclose private activity.
Test the primary-read snapshot against concurrent authorization changes.

Local emulation supports development. T0017 supplies hosted D1 evidence for this bounded transaction pattern.
The owner authorizes isolated development and CI resources in the existing Cloudflare account.
Keep the resources separate and verify the account before provisioning.
Check existing Wrangler access before requesting credentials. Keep tokens out of chat and logs.

The existing OAuth login was checked against account `458ad6a930b0fb717796dfa19ca6a2b1`, which matches the repository configuration.
Document the concrete need and cost before any paid upgrade.
Subagents may perform independent, bounded tasks.

## Extract and verify the existing workflow

T0019 used `feature/t0019-shared-server-workflow` from `main` at `0c797ad`.
The owner authorized this ticket while authentication PR #40 was open.
The branch started independently of that authentication branch.
It included PR #40's merge at `68e8642` and preserved the authentication implementation.
The completed phase used these steps:

1. Inventory the effective PostgreSQL functions and all existing browser commands.
2. Extract the existing decisions and application orchestration into shared server modules.
3. Execute every command through a trusted Supabase entry point and guarded atomic persistence.
4. Verify existing behavior, commit races, access changes, rollback, receipts, and uncertain retries with fictional CI fixtures.
5. Adapt the bounded D1 proof to reuse the same service and decisions.
6. Record local, hosted Supabase, hosted D1, and protected GitHub Actions results separately.

The [workflow reference](server-workflow.md) defines the implemented boundaries.
The [verification guide](verify-server-workflow.md) gives the checks and recovery steps.
The active Supabase browser adapter retains its legacy workflow RPC during replacement verification.
The new Edge executor is opt-in. Development backend activation requires separate authorization.
Keep workflow decisions in the shared service. Do not duplicate those rules in D1 SQL.

Completion requires actual Supabase execution through the shared service and evidence that existing behavior remains intact.
An unused interface or design document is insufficient.
That verified shared service now supplies T0020's complete D1 decisions.

## Select and verify identity

T0018 implemented this phase on `feature/t0018-cloudflare-authentication` from merged PR #39.
PR #40 merged T0018 at `68e8642` on 2026-10-17 at 17:16:41 UTC.
See the [reference](cloudflare-authentication.md), [choice and costs](cloudflare-authentication-choice.md), and [verification guide](verify-cloudflare-authentication.md).
Current evidence remains in the [T0018 record](current-state.md#t0018-cloudflare-authentication-2026-10-18).
The initial protected run passed 28 hosted D1 account cases, then reached the Workers Free HTTP resource limit.
The owner initially deferred subscription activation on 2026-10-18, then activated Workers Paid during PR #41 review.
The isolated authentication Worker accepted the 1,000 ms CPU cap and passed later hosted HTTP and protected authentication checks.
Keep those results separate from the complete T0020 connector, whose protected job remains pending.
T0020 retains the maintained Better Auth implementation and its password parameters.
Data migration remains later work.
The owner selected organizer-issued replacement temporary passwords on 2026-10-17.
Users must change these passwords before contest access.
Preserve account IDs, memberships, permissions, and history.
Existing passwords do not need to survive. Password-hash import is no longer required.
The bounded identity phase required these checks:

1. Evaluate a maintained identity implementation that can run in the selected Worker environment.
2. Use fictional accounts to verify temporary passwords, mandatory changes, and preserved account IDs.
3. Measure password creation and verification within the selected Worker resource limits.
4. Test login expiry, logout, resets, mandatory password changes, and failed identity updates.
5. Test reset authorization across all sessions assigned to the account.

Verify private credential distribution and organizer-assisted recovery before account migration.
No password hashes or plaintext credentials belong in Git, CI output, or public artifacts.

Completion requires a selected identity implementation and tests for both current-password verification and older-session rejection.
Cookie scope, lifetime, preview origins, and cross-site request protection need recorded settings and browser tests.
An identity update that fails midway must leave a recoverable, restricted account.

## Verify the implemented connector

The [application Worker](../src/server/adapters/cloudflare/applicationWorker.ts) constructs the complete server implementation.
The [browser adapter](../src/backend/cloudflare/backend.ts) implements every `Backend` group.
The [Cloudflare fixture driver](../tests/providers/cloudflare/fixture.ts) supplies fictional setup, exact target checks, and scoped D1 and R2 cleanup.
The hosted CLI verification has completed this sequence:

1. Verify the new isolated Standard bucket after the owner's R2 activation. Preserve existing resources.
2. Deploy the reviewed complete Worker and its private secret to the selected CI target.
3. Run every shared provider scenario through real hosted endpoints and browser cookies.
4. Run the complete hosted product journey, including fictional accounts, images, and live updates.
5. Verify the documented empty installation and owner recovery procedure.

Scoped installation fixture cleanup passes. The installed baseline remains intact, and both test Durable Objects are empty.
Protected connector CI on `9b0ef6b` fails two shared browser scenarios after passing both direct suites. A corrected job must pass before final acceptance.

Keep provider imports in the corresponding adapter modules.
Pass dependencies and authenticated context explicitly.
Do not add a generic database layer or AWS placeholder implementations.

Completion requires the same behavior assertions to pass for Supabase and Cloudflare.
Provider-specific setup may differ. Scenario expectations must remain the same.
Every fixture run uses a unique namespace and proves deletion of only its own records and objects.

Required cases include these behaviors:

- Only the current owner resolves an issue. Another specialist accepts a handoff. Resolved issues reject replies.
- Timers retain persisted times, exclude resolved intervals, and retain the prior owner after reopening.
- Awards remain unique. External application remains a separate action.
- Contestants cannot read another team's data, staff notes, staff images, or private change sequences.
- Image limits hold under concurrent reservations. Removal and expired-upload cleanup survive partial failure.
- Revoked accounts cannot commit commands, publish images, download bytes, or retain authorized live access.
- Reconnect refreshes the snapshot after missed notifications. Duplicate deliveries do not repeat writes.
- One provider instance cannot change another instance's account, subscription, or configuration.

## Verify an empty installation

Follow [Install an isolated Cloudflare instance](install-cloudflare.md) against new resources with fictional data.
Use the provider-owned [operator command](../src/server/adapters/cloudflare/tooling/install.mjs).
Confirm the account and exact database before migrations, secret creation, bootstrap, or owner recovery.
Bootstrap must reject nonempty and partially initialized foreign databases rather than deleting records.
Verify the mandatory-password gate, closed intake, full application journey, and lost-credential recovery.
Keep generated credentials in exclusive private files outside the checkout.

The [PR #21 record](pr21-installation-disposition.md) identifies reused, replaced, and deferred components.
Do not merge its old branch wholesale.
The final recommendation to close that PR remains conditional on the complete goal passing.
The owner decides whether to close it.
Docker packaging remains outside this ticket.

## Defer data migration and cutover

Full data-migration tooling starts only after connector verification.
Real-data exports and the backend switch require separate target checks and owner approval.
The later rehearsal must preserve identifiers, relationships, timestamp precision, receipt results, image hashes, permissions, and historical actor names.
It must also verify replacement temporary passwords, recovery, the write pause, final synchronization, and rollback.

The migration manifest records the source revision, schema versions, export time, counts, and comparison results.
Counts alone are insufficient. The comparison checks values and relationships too.
Encrypted exports stay outside repository files and test artifacts.

Completion requires no unexplained differences and a successful restoration rehearsal.
After new Cloudflare writes, rollback must preserve those writes or keep the application paused.
The owner approves the cutover window and rollback procedure before any live switch.

## Finish the active ticket

Keep local emulation, hosted CLI, and protected GitHub Actions evidence separate.
The protected `cloudflare_connector` input selects only the connector CI resources.
Its environment retains the existing protection rules and allowlist entries, with the T0020 branch added.
The job definition alone is not a passing protected run.

Before presenting the PR as ready, pass the required type, lint, build, database, function, browser, documentation, and hosted checks.
Verify the final reviewed revision and fixture cleanup.
Update the current instructions and verification records, then prepare the PR for the owner.
The owner reviews and merges.

## Authorize cutover after evidence is complete

1. Review the provider tests, installation result, migration comparison, and rollback rehearsal.
2. Confirm environment separation and the measured resource requirements.
3. Confirm the release revision and the explicit migration target.
4. Approve the cutover operation and its maintenance window.

The connector is ready only when its implementation and required tests pass.
The migration is ready only when installation, data, credentials, and rollback checks pass too.
AWS adapters and Terraform remain deferred until the owner selects a concrete AWS deployment.
