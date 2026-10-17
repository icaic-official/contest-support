# Shared provider test contracts

The shared suite checks Minsky behavior through the browser `Backend` interface.
Supabase supplies the first hosted test implementation.
Cloudflare and AWS implementations do not exist in this change.

T0017 adds a separate [D1 transaction proof](d1-transaction-proof.md).
It checks the experimental application store directly, with local and hosted D1 bindings.
It does not add a Cloudflare browser adapter or fixture driver for this shared suite.
The complete Cloudflare connector must later pass the same shared scenarios as Supabase.

T0019 reuses the workflow scenarios against the [shared server service](server-workflow.md).
The focused [hosted Supabase suite](../tests/workflow/supabase.test.ts) replaces only the workflow executor in a real Supabase connection.
Commands pass through the deployed `workflow` Edge Function, the shared service, and guarded PostgreSQL commits.
Reads and other operations retain their existing Supabase adapters.
Scenario assertions remain provider-neutral and unchanged for the replacement path.
This focused suite does not constitute a second complete `Backend` implementation.
Use [Verify the shared server workflow](verify-server-workflow.md) to run it.
The focused workflow run shares one owned fixture across cases with distinct request and issue IDs.
Its organizer setup uses a fresh privileged Auth password update, then completes the actual mandatory-change database gate.
That setup avoids password-change rate limits. It is not evidence for the account password-change endpoint.
The existing provider authentication scenario keeps its normal setup and assertions.

The suite complements the database, function, and hosted UI tests.
It does not replace provider-specific policy tests or prove capacity, installation, or migration correctness.
[Run the provider tests](run-provider-tests.md) describes setup and recovery.

## Boundaries

| Component | Responsibility |
| --- | --- |
| `tests/providers/contracts.ts` | Fixture accounts, session identifiers, authenticated connections, and the required fault control. |
| `tests/providers/scenarios/` | Shared assertions against `Backend`, with no provider SDK or database calls. |
| `tests/providers/drivers.ts` | Explicit selection of an implemented fixture driver. |
| `tests/providers/browser-backend.ts` | A separate browser context for each connection and a typed Node proxy for `Backend`. |
| `tests/providers/browser-dispatch.ts` | Calls to the real browser adapter, serialized errors and image bytes, and callback forwarding. |
| `tests/providers/supabase/` | Supabase fixture creation, the real browser adapter, transport fault injection, and scoped cleanup. |
| `scripts/provider-test.mjs` | Target checks, backend prerequisites, process status, and recovery-journal retention. |
| `playwright.providers.config.ts` | Hosted suite isolation and disabled credential-bearing captures. |
| `tests/workflow/supabase.test.ts` | Reuses workflow scenarios through the opt-in shared server path and adds trusted-boundary checks. |
| `scripts/workflow-proof.mjs` | Restricts the focused workflow run to approved Minsky CI and retains recovery journals on cleanup failure. |

Each connection has a separate browser context, including its cookies and local storage.
The Node scenarios call a `Backend` bridge that invokes the real adapter in that context.
The bridge transfers image bytes, typed errors, progress, and subscription callbacks.
Separate contexts permit both bearer-token providers and cookie-based providers without changing the scenarios.

The Supabase driver disables persisted browser sessions and uses each account's real login.
The service key stays in Node fixture setup and cleanup.
The browser receives only the public key and temporary fixture credentials.
The fault control discards one successful workflow response after the server commits it.
This tests the adapter's uncertain-outcome behavior without replacing the workflow operation.

ESLint rejects provider imports in shared scenarios, fixture contracts, and the browser bridge.
Provider implementations register outside those files.
There is no provider-specific branch that weakens a scenario's expected result.

## Behavior coverage

The scenario registry is the source for the current case names.
`npm run test:providers:list` lists them without hosted credentials.

The suite checks these behaviors:

- Login, logout, temporary-password restrictions, password changes, and authentication callback cleanup.
- Submission, assignment, handoff, resolution, awards, external application, reopening, and persisted history.
- Team and session access, staff-note separation, and forbidden workflow transitions.
- Lost responses, request-ID reuse, conflicting request content, and concurrent claims.
- Image reservation retries, incomplete uploads, visibility, removal, abandonment, and revoked access.
- Live invalidation, independent subscribers, immediate resubscription, authorized reads after notification, and callback cleanup.
- Membership removal and account password resets.

The shared suite does not yet cover account creation through `Backend.admin.account`, every image-limit edge, reconnect recovery, or every authorization race.
The private-note notification check observes a bounded interval after a positive staff notification.
It does not prove delivery latency or the absence of arbitrarily delayed messages.

The existing SQL and function suites retain lower-level permission and failure cases.
The hosted UI suite still checks the app's account journey and provider-specific integration.
Passing shared scenarios on Supabase does not establish Cloudflare or AWS conformance.
The focused T0019 suite adds direct plan rejection and captured-state race checks for the shared Supabase execution path.
Local embedded PostgreSQL covers additional commit guards and rollback cases.
Record local, hosted Supabase, hosted D1, and protected GitHub Actions results separately.

## Fixture ownership and recovery

Each run generates UUID identifiers for its event, sessions, and teams.
Each created account carries the exact run UUID in its fixture metadata.
Cleanup checks those ownership records before deletion.
The account scan also finds a creation whose response was lost before the runner saved its account ID.

The recovery journal contains identifiers and the provider target. It contains no credentials.
The runner saves the journal before creating records and replaces it atomically after account creation.
Cleanup removes only that run's records and image objects.
Deleting fixture people also deletes their command receipts through the existing foreign key.

A cleanup failure fails the run and retains the journal.
The protected workflow retains remaining journals as an artifact for seven days.
Forced runner termination can prevent artifact upload. Exact run metadata remains the basis for manual recovery in that case.
Recovery refuses a different target or ownership mismatch.
It skips the migration prerequisite check so a changed backend does not prevent a cleanup attempt.

## Requirements for another provider

A provider driver supplies the same account roles, session relationships, temporary-password state, and disposable records.
Its browser factory returns the real application adapter.
Its cleanup owns provider-specific tables, accounts, objects, and test resources.
The lost-response control must discard a committed response, not fake a successful write.

Cloudflare and AWS drivers must run the complete scenario registry.
A driver cannot skip a failing behavior because its database or identity provider differs.
A missing operation means that the provider implementation is incomplete.
Provider-specific consistency, storage recovery, and migration tests remain additional requirements.

No generic database API or infrastructure provisioning layer is part of this test boundary.
Terraform can later create resources. It cannot establish the behavior that these scenarios verify.


## Bounded Cloudflare authentication reuse

T0018 extracts `verifyTemporaryAuthentication()` from the existing authentication scenario.
The Supabase scenario retains its workflow hooks. Cloudflare supplies its real authentication adapter and protected session-list hooks.
Both providers use the same identity, temporary-password, password-change, logout, stale-password, and subscription-cleanup assertions.
This bounded reuse does not establish complete Cloudflare `Backend` conformance.
The remaining workflow, image, and live-update scenarios still require the complete connector.
