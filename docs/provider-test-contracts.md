# Shared provider test contracts

The shared suite checks Minsky behavior through the browser `Backend` interface.
Cloudflare supplies the browser adapter and the fixture driver.
[The scenario registry](../tests/providers/scenarios/index.ts) holds 11 scenarios, and they apply to any provider without weaker assertions.
`npm run test:providers:list` lists them without hosted credentials.

The suite runs on demand against hosted resources. No automatic job runs it, so a later change to the registry or to an adapter needs a fresh hosted run.
[Run the provider tests](run-provider-tests.md) describes setup and recovery.

The suite complements the database and hosted UI tests.
It does not replace provider-specific policy tests or prove capacity, installation, or migration correctness.
It does not cover the `announcements`, `avatars`, or `contestAwards` groups, and it covers only some `manage` commands. See [contest announcements](session-announcements.md#verification) and [Avatars](backend-contracts.md#avatars).

Direct persistence and account suites check `WorkflowPersistence` and the account rules on a D1-only database. Their records cannot enter the application's live delivery process.
Complete application checks use separate Worker, D1, private R2, and Durable Object resources.

## Boundaries

| Component | Responsibility |
| --- | --- |
| `tests/providers/contracts.ts` | Fixture accounts, contest identifiers, authenticated connections, planned account markers, and transport fault controls. |
| `tests/providers/scenarios/` | Shared assertions against `Backend`, with no provider SDK or database calls. |
| `tests/providers/drivers.ts` | Explicit selection of an implemented fixture driver. |
| `tests/providers/browser-backend.ts` | A separate browser context for each connection and a typed Node proxy for `Backend`. |
| `tests/providers/browser-dispatch.ts` | Calls to the real browser adapter, serialized errors and image bytes, and callback forwarding. |
| `tests/providers/cloudflare/` | Exact Cloudflare CI target checks, D1 and identity fixtures, the real browser adapter, committed-response loss, and exact R2 object cleanup. |
| `scripts/provider-test.mjs` | Target checks, backend prerequisites, process status, and recovery-journal retention. |
| `playwright.providers.config.ts` | Hosted suite isolation and disabled credential-bearing captures. |

Each connection has a separate browser context, including its cookies and local storage.
The Node scenarios call a `Backend` bridge that invokes the real adapter in that context.
The bridge transfers image bytes, typed errors, progress, and subscription callbacks.
Separate contexts permit bearer-token providers and cookie-based providers without changing the scenarios.

The response fault control discards one successful workflow or account response after the server commits it.
A provider reuses `tests/providers/support/response-fault.ts` with its actual endpoint paths. Cloudflare passes `/api/workflow` and `/api/credentials`.
This tests uncertain outcomes without replacing the operation.
The browser bridge can also close real provider WebSockets and reject reconnects until the scenario resumes them.
It leaves HTTP requests available so another connection can commit changes during the interruption.

The Cloudflare driver keeps generated passwords and hashes in memory during setup.
It creates fictional application and Better Auth records in its dedicated D1 database.
Its browser contexts use the hosted application origin for API calls, cookies, request protection, and WebSockets.
Playwright supplies only bridge and source assets from the local Vite server under that browser origin.
Those intercepted assets do not replace application HTTP operations or become public deployment routes.

ESLint rejects provider imports in shared scenarios, fixture contracts, and the browser bridge.
Provider implementations register outside those files.
No provider-specific branch weakens a scenario's expected result.

## Behavior coverage

The suite checks these behaviors:

- Login, logout, temporary-password restrictions, password changes, and authentication callback cleanup.
- Account creation by an event admin, rejected creation by other seats, combined staff roles, lost create responses, and organizer recovery.
- Submission, assignment, handoff, resolution, awards, external application, reopening, and persisted history.
- Team and contest access, staff-note separation, and forbidden workflow transitions.
- Lost responses, request-ID reuse, conflicting request content, and concurrent claims.
- Image reservation retries, incomplete uploads, visibility, removal, abandonment, and revoked access.
- File-size, image-count, and combined-size boundaries, released reservations, removed images, and limits lowered before completion.
- Live invalidation, independent subscribers, immediate resubscription, authorized reads after notification, and callback cleanup.
- Transport interruption, reconnecting the existing subscription, reading missed changes, and receiving later invalidations.
- Membership removal and account password resets.

The shared suite does not cover every authorization race or storage failure.
It checks reconnect recovery through an authorized refresh, not replay of missed notifications.
The private-note notification check observes a bounded interval after a positive staff notification.
It does not prove delivery latency or the absence of arbitrarily delayed messages.

Other Cloudflare suites test what the shared suite does not:

- `npm test` runs the local D1 and Worker suites. They cover current credential guards, atomic administration, concurrent image limits, partial storage failures, live reconnect recovery, avatars, and lower-level permission and failure cases.
- `npm run test:connector:runtime` runs the complete local HTTPS runtime.
- Installation and tooling tests cover bootstrap, webmaster recovery, exact target selection, and credential handling.
- The hosted UI suite checks the app's account journey and provider-specific integration.

Passing shared scenarios on one provider does not establish another provider's conformance.

## Fixture ownership and recovery

Each run generates UUID identifiers for its event, contests, and teams.
Initial accounts carry the exact run UUID in their fixture metadata.
Accounts created through the application use exact name and handle markers saved before the create request.
The name includes the full run UUID. Cleanup discovers their IDs after a lost create response and checks their memberships before deletion.
Cloudflare removes a created account's sign-in limit counter only after that account ID is proved and retained. A planned handle alone is not ownership evidence.
Cleanup checks those ownership records before deletion.
Cloudflare records its generated account IDs before its first fixture write.

The recovery journal contains identifiers and the provider target. It contains no credentials.
The runner saves the journal before creating records and replaces it atomically after account creation.
Cleanup removes only that run's records and image objects.
Cloudflare verifies the event, contests, teams, memberships, identities, and exact image keys before deletion.
It refuses records that cross a fixture boundary, including an installation marker for those IDs.
It checks D1 cleanup counts, R2 object absence, and Durable Object cursor and alarm removal before removing the journal.
It deletes exact object keys without a bucket-wide list or prefix deletion.
The Cloudflare fixture uses the named `SessionMaintenance` service entrypoint through trusted account access.
The public application has no maintenance route.
Cleanup first proves fixture ownership and blocks late live messages. It then removes owned D1 rows and verifies empty coordinator storage.
An interrupted cleanup retains its identifiers-only journal for retry.

A cleanup failure fails the run and retains the journal on the machine that ran the tests. The runner prints its path.
Recovery refuses a different target or ownership mismatch.
It skips the migration prerequisite check so a changed backend does not prevent a cleanup attempt.

## Requirements for another provider

A provider driver supplies the same account roles, contest relationships, temporary-password state, and disposable records.
Its browser factory returns the real application adapter.
Its cleanup owns provider-specific tables, accounts, objects, and test resources.
The lost-response controls must discard committed workflow and account responses. They must not fake a successful write.
The reconnect control must interrupt the real subscription transport, hold reconnect attempts, then permit recovery.

Every new provider must pass the same registry.
A driver cannot skip a failing behavior because its database or identity provider differs.
A missing operation means that the provider implementation is incomplete.
The [provider implementation guide](add-provider.md) lists interfaces, registration points, and commands.

Shared scenarios do not replace these provider-specific checks:

| Area | Additional required checks |
| --- | --- |
| Authentication and authorization | Test exact origins, request protection, expiry, revocation, temporary-password gates, credential races, and rejected attempts to forge a caller. Test direct database or storage access where the provider exposes it. |
| Atomic persistence | Race ownership, membership, role, archive, intake, and credential changes against commits and receipt replay. Verify rollback and no partial state, history, award, receipt, or notification writes. |
| Account administration | Test account creation, permissions for each level of authority, last-webmaster protection, interrupted credential changes, and repeated issues. |
| Scoped authority | Test isolation between events, the webmaster read restriction and its audited join, and the failure of a stale authority check inside a commit. |
| Contest schedule | Test derived intake across the start, the end, and the grace period, the manual override, personal end times, contest-wide awards, and the live password rule. |
| Private storage | Race reservations and completion against limits and revocation. Test interrupted transfers, late writes, deletion failures, exact-object cleanup, and current authorization on downloads. |
| Live delivery | Test reconnect refresh, expired connections, revoked access, audience isolation, duplicate hints, failed delivery retries, and cleanup of persisted coordinator state. |
| Installation and recovery | Apply repository migrations to an empty isolated target. Bootstrap the first webmaster, complete the mandatory password change, and recover that webmaster. Test wrong targets and partial failures without a shared reset. |
| Tooling and fixtures | Reject target substitutions. Keep credentials private. Recover interrupted setup and cleanup, and prove that unrelated records and objects remain intact. |

Use the actual provider's transaction and identity boundaries for these tests.
A browser adapter with mocked responses cannot establish those guarantees.
List the exact local and hosted commands with expected results in the provider's verification guide.
Report unsupported upgrade, backup, restoration, or capacity behavior explicitly.

No generic database API or infrastructure provisioning layer is part of this test boundary.
