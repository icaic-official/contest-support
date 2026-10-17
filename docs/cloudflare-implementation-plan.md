# Prepare the Cloudflare backend

This plan defines the work needed to implement and verify the [proposed backend](cloudflare-backend-design.md).
T0016 adds design documents. The branch also includes the merged T0015 tests and Supabase fixes.
The phases below are acceptance steps, not additional opened development tickets.

## Use the merged design and provider tests

PR #32 merged on 2026-10-17 at `ef6a029`. T0014's merge step is complete.

T0015 merged in [PR #37](https://github.com/GiftedNovaHD/minsky/pull/37) at `738ef4a` on 2026-10-17.
Its protected run passed all eight shared scenarios and all 14 existing hosted UI tests.
T0016 merged in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36) at `b68ef72` on 2026-10-17 at 13:50:36 UTC.
The design review is complete. T0017 starts the D1 transaction proof below.
The later phases remain pending.

The user authorized T0015 and T0016 in parallel on 2026-10-17 while PR #32 was under review.
Both branches started at its `d158906` revision. T0016 now includes PR #32 and PR #37.
Supabase remains active.

The [shared suite](provider-test-contracts.md) and its [verification record](current-state.md#t0015-shared-provider-tests-2026-10-17) are available in this branch.
The suite does not yet cover every proposed Cloudflare behavior.
The remaining phases require the additional cases below.

## Prove the database transaction pattern

T0017 uses `feature/t0017-d1-transaction-proof` from updated `main` at `53f9dfd`.
See [the proof guide](d1-transaction-proof.md) for the focused scope and verification procedure.

1. Define the SQLite schema and the proposed application-store port.
2. Implement one complete command with an atomic receipt, history, and notification record.
3. Test concurrent calls, including the same request ID with equal and different commands.
4. Interrupt the response after commit and retry the original request.
5. Race the command against membership revocation, account restriction, and event archival.

Completion requires hosted D1 evidence that a failed assertion rolls back the entire batch.
A losing concurrent request must not create history, an award, or a notification.
Private state conflicts must not change contestant-visible revisions or disclose private activity.
Test the primary-read snapshot against concurrent authorization changes.

Local emulation supports development. Hosted D1 evidence remains required for completion.
The owner authorizes isolated development and CI resources in the existing Cloudflare account.
Keep the resources separate and verify the account before provisioning.
Check existing Wrangler access before requesting credentials. Keep tokens out of chat and logs.

The existing OAuth login was checked against account `458ad6a930b0fb717796dfa19ca6a2b1`, which matches the repository configuration.
Document the concrete need and cost before any paid upgrade.
Subagents may perform independent, bounded tasks.

## Select and verify identity

This phase follows the D1 proof.
The owner selected organizer-issued replacement temporary passwords on 2026-10-17.
Users must change these passwords before contest access.
Preserve account IDs, memberships, permissions, and history.
Existing passwords do not need to survive. Password-hash import is no longer required.

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

## Implement the remaining Cloudflare operations

1. Implement the remaining workflow and administration operations through the server ports.
2. Implement the Cloudflare browser adapter behind `Backend`.
3. Implement private R2 upload, completion, reads, abandonment, and deletion recovery.
4. Implement Durable Object connections and delivery from the D1 outbox.
5. Add the Cloudflare fixture driver to the shared provider tests.

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

## Rehearse installation and migration

Full migration tooling starts only after connector verification.
Real-data exports and the backend switch remain later phases with separate target checks and owner approval.

1. Install the selected Cloudflare revision into an empty isolated environment.
2. Export a protected migration snapshot after the owner approves access to existing data.
3. Import account IDs and application records without replacing their identifiers.
4. Copy image objects and verify their hashes and metadata.
5. Compare source and destination relationships, receipt results, timestamps, and authorized snapshots.
6. Exercise the approved credential migration and recovery procedure.
7. Rehearse the write pause, final synchronization, and rollback procedure.

The migration manifest records the source revision, schema versions, export time, counts, and comparison results.
Counts alone are insufficient. The comparison checks values and relationships too.
Encrypted exports stay outside repository files and test artifacts.

Completion requires no unexplained differences and a successful restoration rehearsal.
After new Cloudflare writes, rollback must preserve those writes or keep the application paused.
The owner approves the cutover window and rollback procedure before any live switch.

## Authorize cutover after evidence is complete

1. Review the provider tests, installation result, migration comparison, and rollback rehearsal.
2. Confirm environment separation and the measured resource requirements.
3. Confirm the release revision and the explicit migration target.
4. Approve the cutover operation and its maintenance window.

The connector is ready only when its implementation and required tests pass.
The migration is ready only when installation, data, credentials, and rollback checks pass too.
AWS adapters and Terraform remain deferred until the owner selects a concrete AWS deployment.
