# Development tickets

These tickets describe development work, not contestant issues.

The active ticket is [T0020 complete Cloudflare connector](#t0020-complete-cloudflare-connector).
The owner merged T0019 in PR #41 at `7d19b00` before authorizing this ticket.
T0020 completes Cloudflare persistence, the browser connector, and independent installation verification.
The owner merged the parallel T0009 jury worklist in PR #23 at `c144a2a` during this ticket.
T0020 includes that main revision and repeats the affected application checks.
Real-data migration tooling follows connector verification. Supabase remains active.

T0016 Cloudflare backend design merged in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36) at `b68ef72` on 2026-10-17.
[T0015 shared provider tests](#t0015-shared-provider-tests) merged in [PR #37](https://github.com/GiftedNovaHD/minsky/pull/37).
[PR #32](https://github.com/GiftedNovaHD/minsky/pull/32) merged on 2026-10-17 at `ef6a029`.
The numbered records below retain their original scope and verification history.

## Ticket record format

Start each ticket with these fields in this order:

```markdown
## TNNNN Ticket title

Branch: `feature/tNNNN-description`, from the stated base revision.
Status: Current state, with the PR and merge revision when merged.
Summary: One or two sentences that state the goal and result.

Optional sections describe scope, behavior, decisions, and exclusions.

### Acceptance criteria

- [ ] Observable condition or required evidence.
```

Use the same field order for every ticket. Keep the summary brief even when the ticket needs detailed scope or behavior sections. Use `### Acceptance criteria` for the checklist. Add detail sections only when they help explain the ticket. Add a `### Verification` section when the ticket has separate test or deployment evidence. Keep deployment state separate from merge state. Preserve historical details when you update an older ticket.

T0011 documentation and deployment automation merged in [PR #29](https://github.com/GiftedNovaHD/minsky/pull/29) on 2026-10-17.
T0005 merged in PR #19 and T0010 merged in PR #24 on 2026-10-15.
Those merges do not imply application deployment.

T0012 reply retry cleanup merged in [PR #30](https://github.com/GiftedNovaHD/minsky/pull/30) on 2026-10-17.
T0013 image preview request handling merged in [PR #31](https://github.com/GiftedNovaHD/minsky/pull/31) on the same date.
The T0011 branch includes both fixes through a merge from `main` at `f8a8cac`.

T0004 has two related pull requests.
[PR #9](https://github.com/notbowen/minsky/pull/9) implements the UI makeover.
[PR #13](https://github.com/notbowen/minsky/pull/13) rewrites the documentation.
The user merged both into `main` on 2026-10-11 (SGT).
[PR #14](https://github.com/notbowen/minsky/pull/14) records the TypeScript major-update rule.

T0005 implements issue images on `feature/t0005-issue-attachments`.
These items stay deferred and are not part of T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining manual acceptance checks.

T0008 fuzzy team search merged into `main` in [PR #22](https://github.com/notbowen/minsky/pull/22) on 2026-10-15 (SGT).

## T0020 Complete Cloudflare connector

Branch: `feature/t0020-cloudflare-connector`, from updated `main` at `7d19b00`.
Status: implementation, review fixes, cleanup, protected verification, and fresh installation are complete in [PR #42](https://github.com/GiftedNovaHD/minsky/pull/42). Final ordinary PR checks gate the documentation update. The owner reviews and merges.
Summary: Complete every Cloudflare backend operation and verify the application with isolated resources. Verify installation into an empty Cloudflare environment.

The owner authorized the complete connector after PR #41 merged.
Supabase remains the active development backend.
Use the existing Cloudflare account, `458ad6a930b0fb717796dfa19ca6a2b1`.
Keep new development, CI, and installation resources separate from existing verification resources.
Bounded subagent work is authorized.
Only this ticket branch may be added to the existing `cloud-test` branch allowlist.
Preserve every other entry and protection rule.
Document the need and cost before any additional paid upgrade.

Inspect [PR #21](https://github.com/GiftedNovaHD/minsky/pull/21) before installation tooling changes.
Reuse suitable configuration, validation, bootstrap safeguards, and tests.
Keep provider configuration and bootstrap code inside its provider implementation.
Record which old components are reused, replaced, or deferred.
Recommend a disposition for PR #21 after verification. The owner decides whether to close it.

Docker packaging, AWS, Terraform, real-data migration, account resets, and backend cutover remain outside this ticket.
Do not merge the old installation branch wholesale.
Do not claim contest capacity without separate evidence.

### Implementation milestones

1. Complete D1 persistence for all nine commands through the existing `WorkflowService`.
2. Complete authenticated HTTP routes, authorized snapshots, administration, and the browser adapter.
3. Implement private R2 images and recovery from partial failures.
4. Deliver audience-specific invalidations through Durable Objects and the D1 outbox.
5. Verify both providers, hosted application journeys, and an empty isolated installation.

### Acceptance criteria

- [x] Every workflow command uses shared decisions and atomic state, history, receipt, and notification commits.
- [x] Commits recheck permissions, credential generation, identity-session expiry, and revocation.
- [x] Every `Backend` capability has a working Cloudflare implementation with existing behavior preserved.
- [x] Authorized snapshots include complete permitted workflow, account, image, and timing data.
- [x] Private images preserve visibility, ownership, limits, archival rules, retries, and scoped cleanup.
- [x] Live updates preserve audience separation, revocation, reconnect refresh, duplicate handling, and failure recovery.
- [x] The same required shared scenarios pass against Supabase and Cloudflare.
- [x] Complete hosted application journeys pass with fictional accounts and images.
- [x] The documented installation procedure succeeds in an empty isolated Cloudflare environment.
- [x] PR #21 reuse decisions and the final disposition recommendation are documented.
- [x] Fixture cleanup is verified and deletes only UUID-owned data.
- [x] Required type, lint, build, database, function, browser, documentation, and hosted checks pass on executable source `2b6f6f0`.
- [x] Local, hosted CLI, and protected GitHub Actions evidence are recorded separately.
- [x] The final PR is prepared with accurate documentation and required CI checks for owner review.

### Review fixes and verification

The owner requested all review fixes and cleanup before this PR is ready.
Correct the confirmed review findings, including image-expiry cleanup and generated configuration safety.
Remove the retired bounded proof path and duplicate store runners.
Use the current `WorkflowPersistence` and consolidate the installation procedure and reference material.
Preserve the merged jury worklist, earlier installation resources, and unique historical evidence.

The [dated verification record](current-state.md#t0020-connector-implementation-2026-10-18) preserves earlier local, hosted CLI, protected, and empty-installation results.
Those runs do not verify later review fixes.
Fresh checks and scoped cleanup pass on executable source `2b6f6f0`.
The [review verification record](current-state.md#pr-42-review-fixes-and-cleanup-2026-10-18) separates the first Supabase failure, its passing unchanged repeats, protected Cloudflare results, and the new empty installation.

## T0019 Shared server workflow

Branch: `feature/t0019-shared-server-workflow`, from updated `main` at `0c797ad`.
Status: merged in [PR #41](https://github.com/GiftedNovaHD/minsky/pull/41) at `7d19b00`. Local, hosted Supabase, and bounded hosted D1 checks pass. Protected authentication passes on the earlier merged `main` revision. T0019's protected Supabase job was not run.
Summary: Extract the existing issue rules into one shared server service. Exercise all nine commands through a trusted Supabase path before expanding Cloudflare workflow persistence.

The owner authorized work while [PR #40](https://github.com/GiftedNovaHD/minsky/pull/40) was open.
This branch started independently at `0c797ad`.
It now includes that PR's merge at `68e8642`, from 2026-10-17 at 17:16:41 UTC.
T0019 preserves the merged authentication behavior.
The initial protected authentication HTTP check failed with a Workers Free resource limit.
The owner activated Workers Paid during PR #41 review. The local hosted HTTP suite now passes.

Supabase remains active. The legacy browser workflow and protective SQL remain available during replacement verification.
The new Supabase path is opt-in and uses the approved CI project, `ghtztmovdkhuketcbjmq`.
No active development backend deployment or backend switch is part of this ticket.
Full D1 workflow support, R2, notification delivery, migration tooling, AWS, and Terraform remain outside this scope.
Bounded subagent work is authorized.

### Acceptance criteria

- [x] Inventory every existing command against effective migrations, browser contracts, constraints, policies, receipts, and tests.
- [x] Implement one shared service with explicit decisions and operation-level persistence methods for all nine existing commands.
- [x] Execute that service through an authenticated Supabase server boundary and guarded atomic commits.
- [x] Preserve access, roles, ownership, lifecycle, persisted timestamps, resolution history, awards, and external application records.
- [x] Preserve request identity across uncertain retries and reject conflicting request reuse.
- [x] Preserve public and private history and notification visibility under concurrent requests.
- [x] Align D1's bounded `claim` and `message` proof with the shared service without adding the remaining D1 workflow commands.
- [x] Verify isolated Supabase execution, concurrent state and permission changes, rollback, lost responses, retries, and database bypass attempts.
- [x] Pass required checks and record local, hosted Supabase, hosted D1, and protected GitHub Actions evidence separately.
- [x] Update affected documents and prepare a PR for owner review.

### Verification

The [workflow reference](server-workflow.md) records the existing behavior and implemented boundaries.
The [verification guide](verify-server-workflow.md) gives the local and CI-only commands and recovery procedure.
[Current state](current-state.md) records observed results.
An interface or an uncalled rule module does not complete this extraction.

The PR #41 review found a login-expiry race after lock waits.
An additive migration corrects the final access check for writes and receipt replays.
Both new regression cases failed before the correction and pass afterward.
The owner also requested bounded cleanup and completion of T0018's hosted HTTP verification.
The owner activated Workers Paid. The isolated authentication Worker accepts its 1,000 ms CPU cap, and its local hosted HTTP suite passes.
Protected verification on `main` is recorded separately from the PR #41 hosted runs.

## T0018 Cloudflare authentication

Branch: `feature/t0018-cloudflare-authentication`, from updated `main` at `0c797ad` after PR #39 merged.
Status: merged in [PR #40](https://github.com/GiftedNovaHD/minsky/pull/40) at `68e8642` on 2026-10-17 at 17:16:41 UTC. Local, hosted D1, and protected HTTP checks pass on Workers Paid. The PR #41 follow-up records the paid verification.
Summary: Add Workers and D1 authentication, temporary passwords, account sessions, and organizer-assisted recovery. Keep Supabase active.

Better Auth `1.7.10` supplies username login and signed cookie sessions.
D1 guards preserve current permissions and atomic credentials. The browser implements the existing `Authentication` interface.
The [reference](cloudflare-authentication.md) defines endpoints, cookie scope, lifetime, request protection, and account restrictions.
The [identity choice](cloudflare-authentication-choice.md) records maintained crypto, schema coupling, Worker measurements, and cost.
Use the [verification guide](verify-cloudflare-authentication.md) for local and isolated hosted checks.

The isolated `minsky-auth-ci` database and Worker use confirmed account `458ad6a930b0fb717796dfa19ca6a2b1`.
Development databases remain local and separate. No real accounts, real-data exports, or backend switch are included.
The owner activated Workers Paid during the PR #41 verification follow-up.
The remaining workflow connector, R2, Durable Object delivery, migration tooling, AWS, and Terraform remain later work.

### Acceptance criteria

- [x] Select and document a maintained Workers and D1 identity implementation and cryptographic components.
- [x] Implement username login, logout, restoration, fixed expiry, revocation, and a browser authentication adapter.
- [x] Enforce temporary-password changes at the server before contest access.
- [x] Preserve account IDs and memberships through create, reset, and password changes.
- [x] Recheck all-session admin access, archived restrictions, current permissions, and stale credentials.
- [x] Protect cookie scope, permitted origins, state changes, and one-time credential responses.
- [x] Test partial failures, recovery, superseded updates, and login races with isolated fixtures.
- [x] Reuse provider-neutral authentication assertions and verify browser cookie and request protection.
- [x] Measure password cost in Workers and record the CPU allowance and paid-plan need.
- [x] Complete local checks, protected hosted D1 checks, scoped cleanup, and verification records.
- [x] Complete protected HTTP verification after the owner activates Workers Paid.
- [x] Prepare a PR for owner review. The owner merges.

### Verification

See [the current-state record](current-state.md#t0018-cloudflare-authentication-2026-10-18) for separate local, hosted D1, Worker HTTP, and protected CI results.
The newer [PR #41 follow-up](current-state.md#pr-41-review-corrections-and-paid-authentication-2026-10-18) records the passing paid-plan verification.

## T0017 D1 transaction proof

Branch: `feature/t0017-d1-transaction-proof`, from updated `main` at `53f9dfd`.
Status: merged in [PR #39](https://github.com/GiftedNovaHD/minsky/pull/39) at `0c797ad` on 2026-10-17 at 15:49:49 UTC. Local and hosted D1 checks passed. Its recorded hosted verification remains bounded to that proof revision.
Summary: Prove atomic workflow writes through a provider-independent application-store interface and a D1 adapter. Use `claim` and `message` to check concurrent transitions and private activity.

The owner authorized isolated Cloudflare development and CI resources in the existing account.
Existing Wrangler access verified account `458ad6a930b0fb717796dfa19ca6a2b1` before provisioning.
Development uses temporary local databases. Hosted fixtures use the separate `minsky-d1-proof-ci` database.
No paid upgrade is needed for this proof.

The later migration will use organizer-issued replacement temporary passwords with mandatory changes.
Preserve account IDs, memberships, permissions, and history. Password-hash import is no longer required.
Authentication implementation, remaining operations, real-data exports, migration tooling, and the backend switch remain outside this ticket.
AWS adapters and Terraform remain deferred. Bounded subagent work is authorized.

### Acceptance criteria

- [x] Define the necessary SQLite schema and provider-independent application-store interface.
- [x] Commit a command's state change, receipt, history, and permitted notifications in one D1 batch.
- [x] Prove assertion rollback, concurrent claims, concurrent duplicate requests, lost responses, and conflicting request IDs.
- [x] Prove current membership, login, account restrictions, event state, and consistent authorized reads.
- [x] Prove that private changes do not alter contestant-visible history, revisions, or notification sequences.
- [x] Obtain hosted D1 evidence with fictional fixtures and verified scoped cleanup.
- [x] Pass the required local checks and update relevant documents.
- [x] Prepare a PR for owner review. The owner merges.

### Verification

The [historical D1 proof guide](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/d1-transaction-proof.md) preserves the recorded commands and recovery procedure.
Current D1 verification uses the complete workflow suite in [Run the provider tests](run-provider-tests.md).
The [store reference](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/backend-contracts.md#bounded-d1-application-store) defines its bounded interface.
The [current-state record](current-state.md#t0017-d1-transaction-proof-2026-10-17) separates local and hosted evidence.
All 42 focused cases pass locally and on hosted D1 at `edb4bd0`. Ordinary CI passes on that implementation revision.
That bounded proof did not implement the complete connector. [T0020](#t0020-complete-cloudflare-connector) supplies the later implementation.


## T0015 shared provider tests

Branch: `feature/t0015-provider-contract-tests`, started at PR #32 revision `d158906` and updated to merged `main` at `ef6a029`.

Status: merged in [PR #37](https://github.com/GiftedNovaHD/minsky/pull/37) at `738ef4a` on 2026-10-17 at 13:44:12 UTC. Local and protected hosted checks passed.
Summary: Added provider-neutral browser behavior checks and isolated Supabase fixtures. Cloudflare and AWS can use the same scenarios when their adapters exist.

The user authorized this branch exception on 2026-10-17.
T0015 and separate T0016 Cloudflare design work started during PR #32 review.
PRs #32 and #37 are now merged. T0016 design merged in PR #36.

The shared scenarios call the real browser `Backend` contract.
Each provider supplies isolated accounts, records, clients, fault controls, and cleanup.
Supabase is the first fixture implementation.
Cloudflare and a possible future AWS adapter must pass the same behavior assertions.
Existing Supabase database, function, and hosted UI tests remain separate.

### Acceptance criteria

- [x] Shared scenarios contain no provider SDK, database query, or provider-specific response assertion.
- [x] Supabase runs the shared scenarios against isolated hosted accounts and records.
- [x] Tests cover authentication, workflow permissions, retries, images, live updates, and access revocation.
- [x] The runner requires an explicit provider and isolated target, rejects development, and checks prerequisites before creating fixtures.
- [x] Fixture cleanup uses recorded identifiers, handles partial setup, and reports cleanup failures without exposing credentials.
- [x] Ordinary CI runs without hosted credentials. Protected CI runs the hosted contract suite.
- [x] Documentation explains coverage, limits, and the requirements for another provider fixture.
- [x] Required local checks and the protected hosted run pass on the implementation revision.
- [x] The user merged PR #37.

### Verification

The [protected run on `672ec6d`](https://github.com/GiftedNovaHD/minsky/actions/runs/39036173268) passed all 14 existing hosted UI tests and all eight shared scenarios.
Cleanup completed without retained recovery files. The run used the existing CI backend and applied no migrations or function deployments.

The shared tests and subsequent verification exposed image and live-update defects.
Private image reads now bypass cached authorized responses.
Live subscriptions wait for database readiness before reporting a connected state.
Each subscriber has its own channel, and the dashboard waits for a selected session before it subscribes.
Cloudflare resource creation, data migration, AWS implementation, and Terraform remain outside T0015.

## T0013 — Image preview request handling

Branch: `feature/t0013-image-preview-race`, from updated `main` at `de92d54`.

Status: merged into `main` in [PR #31](https://github.com/GiftedNovaHD/minsky/pull/31) on 2026-10-17.
Summary: Prevented older image preview requests from replacing the current preview and released temporary browser URLs when previews close or change.

The user requested two independent PRs for the review findings on 2026-10-17.
T0013 fixes image previews. [PR #30](https://github.com/GiftedNovaHD/minsky/pull/30) fixes reply retry cleanup in T0012.
Both branches started from `main`. The user merged both PRs.

Only the current, open preview can use a completed download or report its error.
Closing a preview or opening another image makes older requests inactive.
The app releases each temporary browser URL when its preview closes, changes, or leaves the page.

### Acceptance criteria

- [x] A delayed download cannot replace a newer preview or its download link.
- [x] A delayed error from an older preview cannot replace the current status. Current errors still appear.
- [x] Both **Close** and Escape restore focus and prevent older results from changing a new preview.
- [x] The temporary browser URL is released when the preview closes.
- [x] Browser regression tests reproduce the original failures and pass with the fix. Required local checks pass.
- [x] The user merged PR #31.

### Verification

Results are recorded in [current state](current-state.md#t0013-image-preview-request-handling-2026-10-17).
No schema or function change is required. Deployment remains a separate step.

## T0001 — Local workflow demo and project guidance

Branch: `feature/t0001-local-demo`

Status: implemented, verified and merged in [PR #1](https://github.com/notbowen/minsky/pull/1) on 2026-10-02. The user accepted the proof of concept and authorized T0002 on this branch before the shared merge.
Summary: Created the local workflow demo and project guidance. T0003 later replaced the demo with the connected app.

Scope: React, TypeScript, Vite, npm lockfile, fictional group session, simulated contestant/volunteer/specialist/jury personas, versioned local persistence, and supporting project guidance. No cloud or deferred production features.

The tooling update on this branch upgraded ESLint to version 10 and installed compatible plugins. It preserved the existing Hooks checks. It updated the lockfile and Node requirements. All required automated checks passed after the update.

### Acceptance criteria

- [x] Complete submission → claim → escalation → specialist acceptance → resolution → jury award → separate application confirmation.
- [x] Submission/assignment/resolution timestamps, ownership during handoff, public/internal visibility and actor history.
- [x] Resolved-issue jury view, whole-minute award (now including zero per review feedback), public explanation and duplicate transition prevention.
- [x] Seed scenario, reset, status filters, roster locations and local persistence.
- [x] Labeled keyboard controls and a phone-width volunteer layout.
- [x] README and all five supporting documents.
- [x] Build, lint, type checking, focused tests and browser journey verified on final implementation.
- [x] Manual verification recorded with remaining limitations.
- [x] PR prepared for user review during T0001. The subsequent T0002 branch exception is recorded below.

## T0002 — Multiple staff roles, triage and reopening

Branch: `feature/t0001-local-demo` (explicit user exception; continue on the T0001 branch).

Status: implemented and verified; [PR #1](https://github.com/notbowen/minsky/pull/1) merged T0001 and T0002 into `main` on 2026-10-02.
Summary: Added combined staff-role capabilities, issue triage and handoffs, and reopening to the local demo.

### Outcome and scope

A support staff member can claim an open contestant issue and begin triage, including a technical specialist or a person with both volunteer and technical specialist roles. The same person keeps one identity, ownership and activity history across their roles. Contestants and helpers can also reopen resolved issues. The user accepted the local proof of concept; visual redesign and Figma work are deferred.

Keep this ticket within the fictional, browser-local demo. Use a small fixed role-to-capability mapping and seeded people. Real accounts, role editors, configurable permissions, connected services and production authorization remain outside this ticket.

### Behavior

In this demo, “begin triage” means the existing **Claim issue** action: assign the person, move an open issue to In progress, and record first assignment. It does not add a new lifecycle status.

Implemented default: volunteer and technical specialist roles confer support membership. Jury alone does not confer support membership. A staff member receives the combined capabilities of all their roles; roles have no precedence over one another. Contestant accounts remain separate from staff accounts in this demo.

| Role membership | Claim open issues | Accept specialist handoff | Record awards |
| --- | --- | --- | --- |
| Contestant | No | No | No |
| Volunteer | Yes | No | No |
| Technical specialist | Yes | Yes, from another owner | No |
| Volunteer + technical specialist | Yes | Yes, from another owner | No |
| Jury only | No | No | Yes, for resolved issues |
| Support role + jury | Yes | Only if also a technical specialist | Yes, for resolved issues |

- Preserve the existing four personas and add a fictional volunteer + technical specialist persona. Show every assigned role in its label. Selecting a person activates all their capabilities without a separate active-role switch.
- Identify owners, history actors, award decision makers and application confirmers by person ID. Role names describe capabilities, not ownership. Existing fictional people retain their names and historical attribution.
- Every support owner can resolve or request a specialist handoff. A specialist who claimed directly can resolve without a handoff. A specialist requesting help retains ownership until a different specialist accepts. The current owner cannot accept their own handoff by using another role.
- Escalation targets the technical specialist role. Acceptance requires that role and transfers ownership to the accepting person. First assignment stays unchanged; the submission timer continues. The retained owner can still resolve while awaiting acceptance.
- Support staff see active issues and status filters. Adding jury membership must not force that person into the resolved-only queue. Jury-only users retain their resolved-issue view. Jury members see award controls on resolved issues.
- Keep staff notes private from contestants, owner-only resolution, jury-only award decisions, and staff confirmation of external application. Multiple roles must not duplicate actions, history entries or awards.
- Upgrade saved state to version 2 with validated migration of version 1 data. Map the old persona identifiers to the same fictional people. Preserve issue IDs, timestamps, ownership, pending handoffs, messages, awards and application status. Prefer existing v2 data; migrate v1 only when v2 is absent. Preserve the v1 source. Invalid or unsupported data must keep the existing visible error and explicit-reset recovery, without silently overwriting it. Reset writes a fresh v2 scenario so old v1 progress cannot reappear on refresh.

### Reopening resolved issues

Requested for T0002 on 2026-10-02. “Helper” means any staff member with a support role, including volunteers, technical specialists and people with combined roles. The following ownership, reason and award rules are the implemented ticket defaults.

- A contestant can reopen a resolved issue belonging to their own team. Any support staff member can reopen a resolved issue in the session, including one they do not own. Jury-only membership does not permit reopening.
- Provide **Reopen issue** in the contestant and support views, with a required public reason of 1–2,000 non-whitespace characters. Record the reason, actor and timestamp in the public activity history. Internal notes remain private.
- Reopen the same issue ID, return it to In progress (`claimed`), and retain its previous support owner. Reopening does not assign the contestant or the helper who clicked the control. Keep the original submission and first-assignment timestamps. Do not restore an old pending escalation.
- Retain every previous resolution summary, resolution actor and timestamp in structured lifecycle records and public history. Clear only the current resolution marker. Public replies and staff notes become available again; the owner can resolve again or request a new handoff. A later resolution requires a new summary.
- User-confirmed timer rule: resume accumulated unresolved time from the reopening timestamp, excluding time spent resolved. Persist the timestamps for every resolution/reopen cycle and calculate elapsed time from those records. For example, submission at 10:00, resolution at 10:05, reopening at 10:08 and another resolution at 10:10 gives seven minutes of unresolved time. First-assignment delay still uses the original submission and assignment. Label the timer clearly as unresolved time; awards remain discretionary.
- Permit multiple resolve/reopen cycles. Reject reopening an already active issue, cross-team contestant actions, blank reasons and backwards timestamps without changing state or adding duplicate history.
- Preserve any existing award and its pending/applied state. Explain that the award relates to an earlier resolution. Reopening neither revokes nor duplicates that award, and it never reverses external application. Staff can still confirm an existing pending award. A new award requires a currently resolved issue with no award; T0002 retains one award per issue, with award adjustments deferred.
- Update saved-state validation so an awarded issue can be active after reopening. Validate the award against its earlier resolution record, rather than requiring the issue to remain resolved or comparing it with a later resolution. Migrate v1 resolved issues into a first resolution record so they can be reopened without losing history.
- Reopened issues reappear in active support queues and remain visible to their own contestant team. If a Resolved filter would hide the reopened issue, switch to In progress and keep that issue selected. Jury-only views remain resolved-only; an issue returns there after its next resolution.

### Implementation completed

1. In `src/domain.ts`, separate person identity from role membership, add the combined-role seed persona, and define small shared capability/action predicates. Add reopening and structured resolution/reopen records. Update transitions, timer calculations, schemas and attribution together. Enforce person ownership and role capabilities in domain rules as well as controls.
2. In `src/storage.ts`, add the v2 schema/storage path and validate v1 migration. Test legacy pending handoffs, resolution records, reopened issues and award/application records, plus failure and reset behavior.
3. In `src/App.tsx`, use the shared predicates for claim, escalation, acceptance, reopening and award controls. Add the public reopening reason, previous-resolution display and filter behavior. Update persona labels, queues and activity attribution. Limit UI changes to those required for the behavior.
4. Extend domain/storage tests and the browser suite. Retain the original complete journey and add direct specialist triage and combined-role triage/handoff coverage. Add contestant reopening → owner resolves again → helper reopening → refresh → resolution, including an existing award. Exercise a support + jury fixture to catch role precedence bugs without adding a role editor.
5. Run the checks below, perform the manual walkthrough, update implementation/verification documentation, and prepare the shared branch PR for user review with both tickets distinguished. The user merges.

### Acceptance criteria

- [x] Volunteer-only, specialist-only and volunteer + specialist people can each claim an open issue. Contestants and jury-only people cannot. Repeated claims fail without changing state.
- [x] A combined-role person can claim and resolve directly, and can accept another person's escalation. Their own escalation requires another specialist to accept; role switching cannot transfer ownership to themselves.
- [x] Ownership, attribution and first-assignment timestamps refer to the correct person and survive refresh. Escalation keeps its owner until acceptance; resolution stops accumulated unresolved time.
- [x] Combined roles expose the union of capabilities. Support + jury can see active issues and award resolved issues; support membership alone cannot award time. UI controls and domain rejections agree.
- [x] Public/internal visibility, the original complete journey, single awards and separate external application continue to work.
- [x] Contestants can reopen only their own team's resolved issues. Volunteer-only, specialist-only and combined-role helpers can reopen session issues, including another helper's issue. Jury-only, cross-team, repeated, blank-reason and backwards-time attempts fail without mutation.
- [x] Reopening retains issue ID, previous owner, submission/first-assignment timestamps and all previous summaries. A public reason, actor and timestamp are recorded once. Replies resume, active queues show the issue, and only its owner can resolve it again.
- [x] Multiple resolve/reopen cycles survive refresh. Existing pending and applied awards survive reopening and later resolution; no second award is created. Pending application can still be confirmed. v1 awarded issues can migrate, reopen and reload without validation failure.
- [x] Timer tests cover multiple cycles and refresh, preserve first-assignment delay and exclude resolved intervals. The 10:00 → 10:05 → 10:08 → 10:10 example yields seven minutes. Each resolution stops the timer; reopening resumes it without resetting accumulated time.
- [x] Valid v1 progress migrates without loss; v2 reload and reset work. Invalid data, unsupported versions and failed writes are reported and covered by focused tests.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`, `git diff --check` and documentation link checks pass. Any blocked check remains explicitly unverified.
- [x] Manually check combined-role labels/actions at 390 × 844 and 320 × 740, keyboard claiming/handoff/reopening, contestant and helper reopening forms, desktop jury controls, refresh, reset and contestant omission of internal notes.
- [x] README, demo specification, current state and manual guide describe the implemented behavior and observed checks. Record any deliberate Google TypeScript Style Guide exceptions. Shared branch PR is ready for user review.

### Verification

Results are recorded in [current state](current-state.md).

### Review refinements — 2026-10-02

The user requested these refinements on the open shared PR, within T0002:

- Award zero minutes as an explicit decision; retain the required public explanation, one-award rule and separate application confirmation. Offer 0, 5, 10, 15, 30, 60 and Custom in a dropdown. Custom accepts non-negative whole minutes.
- Offer common public resolution summaries in a dropdown: Resolved without comment, Service restored, Device issue resolved, Problem statement clarified, and Custom. The no-comment choice stores its explicit text. Custom retains the existing required 1–2,000-character validation. Reopening clears the current selection so another resolution needs a fresh choice.
- Preserve saved v2 data without resetting or adding a schema version: this extends the accepted minute range and keeps the existing summary representation. Keep the frozen v1 migration validator unchanged.

### Verification

Results are recorded in [current state](current-state.md).

## T0003 — Cloud onboarding and authenticated shared product

Branch: `feature/t0003-cloud-product`, from updated `main`.

Status: implemented and merged in [PR #2](https://github.com/notbowen/minsky/pull/2) on 2026-10-02. Hosted verification is recorded in current-state.md. Protected cloud CI setup remained incomplete at the time of the T0004 inspection.
Summary: Connected the app to Supabase and added account administration, contributor commands, and embedded database tests.

Updated completion boundary (2026-10-02, ticket allocation revised 2026-10-03): the user retained protected cloud integration CI in T0003 and deferred provider ownership/billing records, GitHub merge enforcement/vulnerability alerts and remaining user/manual acceptance checks to T0005 (previously T0004). Previously completed automated and browser checks remain evidence; deferred checks are not claimed as completed. The user still reviews and merges. T0004 implements the UI makeover selected below; T0005 implementation has not started.

Updated authentication decision (2026-10-02): organizer-created usernames/passwords replace email invitations and recovery. Users must change temporary passwords before contest access. Organizers verify identity and issue new temporary credentials for recovery. SMTP/personal email addresses are not prerequisites. Existing Auth IDs and history are preserved.

Updated contributor decision (2026-10-02): contributors may be assumed to have full cloud credential access. Docker is optional, not required for development, migrations, function deployment or the embedded database checks. Cloud integration CI uses a protected isolated test project; untrusted PR checks run without provider credentials. This supersedes the local-stack prerequisite below; the connected workflow and authorization requirements remain in scope.

Selected quality improvements (2026-10-02): require CI and independent review before merging, add a short PR review checklist, and scan secrets/dependencies with routine update PRs. Implementation and owner setup are described in [code-quality.md](code-quality.md). Remote merge rules and vulnerability alerts require repository administration access; they are not inferred from committed workflow files.

Selected interface refinement (2026-10-02): the user requested temporarily installing Anthropic's `frontend-design` skill, applying it to the repository, pushing the changes and deploying the frontend to Cloudflare, then removing the skill. This refinement stays on the active T0003 branch and covers sign-in, shared styles, responsive reporting/queue/detail layouts and administration. It preserves existing workflow and authorization rules; no new backend features are included. Verification and deployment evidence are recorded in [current-state.md](current-state.md).

Selected navigation/demo retirement (2026-10-02): the user requested a main login landing page and sidebar, then explicitly requested removing the old local demo and unnecessary old tests and pushing the changes. This remains a T0003 refinement. Retain real-account journey/authorization checks and credential-free connected landing/login checks. Remove demo runtime, personas/reset/storage migration, demo-only tests/fixtures, command and walkthrough/specification. Historical T0001/T0002 records below/above refer to their original commits.

### Outcome and recommended boundary

Different people can sign in to a hosted Minsky deployment and complete the existing issue journey against shared data. Another developer with authorized cloud access can clone the repository, run the connected frontend locally, make a migration and submit a tested PR. Fast checks run without cloud credentials or Docker; full integration tests provision isolated cloud fixtures.

Include real authentication and the contestant/support/jury dashboards now: they are necessary to make shared workflows useful. Include only the account and session controls needed to operate the first group-contest pilot. Broader organizer administration and configurable uploads remain candidate scope for T0005. Do not add every long-term product requirement to this ticket.

Cloud first, features first: connectivity is assumed. Offline queues, synchronization after outages, venue-local operation, disaster recovery and capacity validation are deferred. Visible request failures and prevention of conflicting/duplicate writes are part of ordinary product correctness.

### Provider onboarding and deployment

- Walk the user through Cloudflare and Supabase account/organization setup and developer access. Distinguish provider-console membership from Minsky application accounts. Ownership/billing records are deferred to T0005; the user completes provider login, verification and any payment entry in the provider UI.
- Start with one Supabase Free development project and Workers Free on a `workers.dev` address. Use shared cloud access for contributors and an isolated cloud test project for privileged CI; Docker is optional. Avoid requiring paid hosted database branches, a purchased application domain, R2 or AWS merely to begin.
- Follow [cloud-onboarding.md](cloud-onboarding.md), completing it with the actual region, non-secret project identifiers, deployment URL, tested commands and setup results. Explain any required spend before selecting a paid service. Recording selected plans, recurring charges and receipt handling is deferred to T0005.
- Add repository-owned Vite build/Workers Static Assets configuration, pinned npm tooling, environment examples and ignored secret files. Cloudflare serves the frontend only; all backend functionality lives in Supabase. Use Supabase Auth, Postgres policies/transactional database functions and Realtime, with Supabase Edge Functions for privileged account administration. Version and deploy those functions with the repository. Keep service credentials out of frontend builds and public CI logs; no custom Cloudflare backend endpoints are needed.
- Provision username/password accounts using Supabase Auth behind internal email-format identifiers. Show temporary credentials for each create/reset action; distribute them securely outside the app. Enforce mandatory password changes in database policies and RPCs. Verify first login, password change, reset and prior-session denial against hosted Auth.
- Sender-domain access is no longer a T0003 blocker. SMTP/email invitations and email recovery were explicitly replaced by the user; do not silently reintroduce email sending.
- Produce a hosted development deployment and repeatable deployment instructions. CI checks PRs; deployment credentials belong only in trusted deployment jobs. Untrusted PRs use embedded fictional data, and previews must not mutate the shared hosted database. First hosted release is an explicit maintainer action after checks.

### Accounts and authorization

- Username/password login backed by Supabase, logout, session restoration, mandatory temporary-password change, ordinary password change and organizer-assisted recovery. No public self-registration. Group contestants share a team account; each staff member has an individual account.
- Use stable authenticated user/person IDs, session/team membership and combined staff capabilities. Never trust a client-selected role, person ID or team ID as authorization. Users with no membership see an access message and no contest data.
- Minimal admin view: list and create accounts, assign/revoke session membership and the fixed volunteer/specialist/jury roles, assign a contestant account to a team, and issue replacement temporary passwords after verifying the requester’s identity. Admin membership is a distinct capability, not automatically jury/support membership. Bootstrap the first admin through a documented trusted command; prevent removing the last admin. Passwords are managed by Supabase Auth. Only a newly generated temporary password is shown for that create/reset action; existing passwords are never retrievable. Account-wide resets/username assignment require admin access to every affected session; archived identities cannot be changed.
- Removing membership must deny subsequent data access even with an existing login session. Account administration is restricted to admins; record its actor and time. Use current database membership for permission checks, not only long-lived token claims.
- Enforce authorization in Postgres row-level policies and transactional operations, and in privileged Supabase Edge Functions. Each privileged function authenticates the caller and checks current admin membership before using service credentials. Contestants cannot fetch another team's data or internal notes through direct API calls, history, counts or live-update payloads. Ordinary data operations retain the caller's identity; broad service credentials are reserved for narrowly authorized administration.

### Shared workflow and dashboards

- Versioned migrations for events/sessions, teams/rosters, people/memberships, issues, replies/notes, lifecycle history and the award ledger. Start with one configured group event/session; use a documented bootstrap for its initial roster/categories. Every record and access rule must have the appropriate session scope; a second test session verifies isolation.
- Preserve T0002 behavior: union of role capabilities, direct support triage, retained owner during handoff, owner-only resolution, reopening history and unresolved-time accumulation, zero/preset/custom awards, and separate external-application confirmation. Use authoritative server timestamps and database constraints/transactions. Concurrent claims or repeated awards must not overwrite another person's work or create duplicates.
- Contestant dashboard: submit and view own-team issues, public replies, resolution/reopening history, unresolved time and award/application status. Support dashboard: active queue, ownership, specialist handoffs, public replies/internal notes and resolution/reopening. Jury dashboard: resolved issues and award/application state. Combined memberships expose all applicable work without a simulated persona switch.
- Support staff can submit a report on behalf of a roster team; record both the affected team and actual staff reporter. Minimal admin session view shows issue counts by status and pending award applications, and can open/close contestant intake. Intake closure blocks new contestant submissions, not staff work or reopening existing issues.
- Use Supabase Realtime to refresh authorized views across signed-in clients on a healthy connection; refetch permitted data after relevant events and on reconnect. Reconnect refetch is not an offline-write system. Retain phone usability for support staff and desktop usability for contestant/jury/admin views.
- Remove demo reset, persona switching, fictional auto-seeding and browser-local issue persistence from the hosted product. The user subsequently removed the old local demo and its reset tooling. Keep only isolated verification fixtures, with cleanup restricted to their own records. Do not import browser demo data into the hosted database automatically. Identify the hosted environment as development without claiming event readiness.

### Contributor setup and verification

- Commit migrations, isolated cloud fixture/account setup, environment examples and exact setup/check/deploy commands. Document Node, npm, CLI login, shared cloud setup and isolated cloud test fixtures. Docker and local email capture are optional; SMTP is not needed for the selected account flow. A fresh clone must not require shared provider credentials to run tests.
- Add CI for type checking, lint, build, focused tests, database policies/transactions and a browser journey across real test accounts. Keep existing domain semantics covered as persistence changes. Include two simultaneous clients, cross-team/session denial, internal-note exclusion, combined roles, account revocation, admin-only operations and claim/award races.
- Document and execute a hosted smoke test of username login, forced password change/reset, shared updates and the complete workflow. Verify phone widths, keyboard navigation and refresh against the connected app. Record commands and results; do not reuse demo results as backend verification.
- Update README, current state and manual verification to describe actual connected behavior. Keep the demo specification as historical scope and explain its replacement. Expand the onboarding guide with observed setup outcomes.

### Acceptance criteria

- [x] Development URLs, environment settings, account setup and contributor access are documented. Provider ownership/billing records are deferred to T0005.
- [x] App is deployed on Workers with a shared Supabase database and working username/password provisioning, mandatory password changes, login, logout and organizer-assisted resets.
- [x] Admin can onboard a team and individual staff, assign combined roles, revoke access and operate contestant intake without editing source code. First-admin bootstrap is reproducible.
- [x] Separate authenticated contestant/support/jury/admin views work; demo controls and client-supplied identity cannot bypass permissions.
- [x] Full submit → claim → handoff → resolve → award → external confirmation journey and repeated reopening work across distinct signed-in browsers. Staff can submit for a roster team.
- [x] Server timestamps, transactional transitions and a unique award constraint preserve history and reject concurrent/duplicate actions. Unauthorized API access and private-note leakage are tested.
- [x] Cloud migrations, isolated fixtures and documented commands reproduce the connected environment from a fresh clone; fast PR checks run without hosted secrets or Docker.
- [x] Build, lint, type checking, focused/database/browser tests and hosted automated checks pass, with actual evidence recorded in current-state.md. Remaining user/manual acceptance checks are deferred to T0005.
- [ ] The separate Supabase test project is prepared; configure the protected GitHub `cloud-test` environment and record the first passing manually dispatched cloud integration job. Owner access and workflow availability on the default branch remain setup dependencies.

### Explicit exclusions and later decisions

No offline/resilience project, 800-user load certification, individual-contest UI, shared incidents, CSV imports, push notifications, full event/category/role editors, advanced reporting or award adjustments. Image uploads and upload-setting UI remain candidate T0005 scope so visibility rules can be settled first; this does not discard the user's attachment requirement.

## T0004 — UI makeover

Branch: `feature/t0004-ui-makeover` (deleted after merge).
The branch started from updated `origin/main` after T0003 merged in PR #2 on 2026-10-02.

Status: implemented and merged in [PR #9](https://github.com/notbowen/minsky/pull/9) on 2026-10-11 (SGT).
Merge commit: `52ff99133bd727626b3589b40a507ab438f508da`.
[The merge record](current-state.md#t0004-merge-and-documentation-follow-up-2026-10-11) gives the exact UTC timestamp and reviewed revision.
[PR #13](https://github.com/notbowen/minsky/pull/13) merged the documentation rewrite on 2026-10-11 (SGT).
Summary: Redesigned the connected workspace and sign-in experience while preserving workflow and authorization behavior.

Deployment evidence (2026-10-03): verified locally and deployed to [minsky-dev](https://minsky-dev.icaic-minsky.workers.dev).
The user explicitly requested "Deploy first".
All 12 hosted cases passed, and fixture deletion completed.

The user selected the two attached visual references on 2026-10-03.
[Current state](current-state.md#t0004-ui-makeover-2026-10-03) records implementation.
The [deployment record](current-state.md#t0004-development-deployment-2026-10-03) contains the hosted evidence.
That development deployment preceded merge under the user's exception for T0004.

### Scope

- Match the workspace reference's dark green surfaces, restrained borders, and compact sidebar.
- Use green status and selection accents.
- Use desktop columns for the queue and details, timing facts, and chronological activity.
- Put specialist acceptance in an amber handoff panel.
- Identify staff notes with a lock marker and separate surface.
- Match the centered sign-in reference. Include a green Minsky mark, username and password fields, an amber submit button, and organizer access and recovery guidance. Keep that guidance visible. Make the password visibility control operable with the keyboard. Replace the prior introductory landing-page sections with this sign-in layout.
- Keep actual authenticated session, team, account, issue, and history values. Screenshot names, counts, descriptions, and timestamps are examples. They do not define product seed data or new capabilities.
- Make the desktop queue tabular. Adapt rows to cards on phones. Use **Report an issue** and **Report for team** to open the reporting form. Keep filters, workflow actions, account controls, and administration accessible in the same theme. On narrow screens, move focus to details after selection. Make **Back to queue** return focus to the queue.
- Preserve backend permissions, public and internal visibility, handoff ownership, timer calculations, resolution history, and reopening. Preserve separate award and external application records.
- Exclude schema changes, account-function changes, new organizer features, and uploads.

### Acceptance criteria

- [x] Sign-in and the authenticated workspace reflect the supplied visual references. Typography is served locally. No example data enters the runtime.
- [x] Queue, details, reporting, accounts, and administration remain usable at desktop, laptop, and 320/390px phone widths. No horizontal overflow occurs.
- [x] Keyboard navigation, focus, password visibility, report open and cancel actions, phone navigation, and return between details and queue work.
- [x] Real accounts complete submission, claim, escalation, acceptance, resolution, award, external application, and reopening. Contestants cannot access internal notes.
- [x] Type checking, lint, build, focused tests, database tests, and browser and cloud checks pass. Current-state.md records screenshot review and remaining manual limitations.
- [x] Relevant documentation is current. A PR is prepared for user review.

## T0005 — Issue images

Branch: `feature/t0005-issue-attachments`, created from updated `main` after T0004 merged.

Status: merged in [PR #19](https://github.com/GiftedNovaHD/minsky/pull/19) on 2026-10-15.
Summary: Added private issue images with uploader-selected visibility, session limits, and active-event removal rules.
The following dated records describe implementation and preview verification.
The 2026-10-14 review fixes add current-access checks, fixed visibility during retry, exact file paths, saved removal retries, and completion-time count checks.
See the [review-fix record](current-state.md#t0005-review-fixes-2026-10-14) for local verification and cloud-test limits.
Review pull request: [PR #19](https://github.com/notbowen/minsky/pull/19).
On 2026-10-11, the user requested a Cloudflare preview before merge and approved using the existing development backend.
The migration and account/attachment functions are deployed to `Minsky` development.
The frontend preview is uploaded at https://t0005-minsky-dev.icaic-minsky.workers.dev.
See the [preview record](current-state.md#t0005-development-preview-2026-10-11) for verification.
`Minsky CI` and the main Worker deployment remain unchanged.
The user reviews and merges.
Deployment is a separate explicit step.

### Scope

- Staff add JPEG, PNG, or WebP images from the issue detail.
- Each image belongs to that issue and records the uploader and upload time.
- The uploader chooses **Staff only** or **Visible to the team**.
- **Staff only** is the default.
- The choice stays fixed.
- Contestants can view team-visible images on their own team's issues.
- Contestants cannot upload images, and they cannot see staff-only images.
- Volunteers, specialists, jury members, and session admins can upload while the event is active.
- There is no control that disables uploads.
- Only the uploader can remove an image, and only while the event is active.
- Removal deletes the stored file.
- Activity records the actor and time at the same visibility.
- Session admins set three limits for the session.
- One image can be from 1 to 50 MB. The default is 10 MB.
- One issue can have from 1 to 24 images. The default is 12.
- The combined size can be from 1 to 120 MB. The default is 120 MB.
- The combined limit must be at least the single-image limit.
- One MB is 1,048,576 bytes.
- A lower limit leaves images that are already attached.
- The next upload must fit the current limits.
- Resolved issues keep their images.
- Authorized uploads still work on a resolved issue while the event is active.
- Reopening does not change images, ownership, or awards.
- Images do not change the issue timer.
- An archived event keeps the files.
- Authorized members can still preview and download them.
- Uploads, removal, and limit changes stop.
- Minsky does not delete archived images.
- The interface shows thumbnails, upload progress, validation messages, and a retry control for a failed transfer.
- Full-size preview and download use the signed-in member's storage access.
- The controls use the dark green workspace.
- They remain usable on phones and desktops.
- Postgres and Storage enforce authorization.
- Clients cannot insert attachment rows directly.

### Outside this ticket

Contestant uploads, HEIC, GIF, SVG, PDF, video, extra captions, later visibility changes, event and roster editors, shared incidents, image transformations, a paid storage upgrade, and image deletion jobs are outside this ticket.

These operational items stay deferred.
They do not receive a new ticket number:

- Provider ownership, selected billing plans, billing contact, recurring charges, and receipt procedures.
- GitHub merge enforcement and vulnerability alerts.
- The remaining user and manual acceptance checks.

Resilience and event-capacity work remain deferred.

### Acceptance criteria

- [x] Staff can upload from the issue detail. Each image links to the issue and records the uploader and time.
- [x] Team-visible and staff-only images follow the same separation as public replies and internal notes. The uploader's choice stays fixed.
- [x] Only a session admin can change limits. The limits stay inside the stated ranges. The next upload must fit. Existing images remain when a limit is lowered.
- [x] Only the uploader can remove an image during an active event. An archived event stays readable and rejects uploads, removal, and limit changes.
- [x] Embedded database tests cover roles, storage access, visibility, limits, resolved issues, and archival. Phone-width browser checks cover preview, validation, retry, contestant hiding, and archived read-only controls.
- [x] Documentation matches this behavior. A pull request is prepared for review. Development and CI stay unchanged until an explicit deployment.

## T0008 — Fuzzy team search

Branch: `feature/t0008-team-search`, from updated `main` at `1ed603a`.

Status: merged into `main` in [PR #22](https://github.com/notbowen/minsky/pull/22) on 2026-10-15 (SGT).
Summary: Added fuzzy team search to the issue queue and the report-for-team form.
The user asked to build it while [PR #19](https://github.com/notbowen/minsky/pull/19), [PR #20](https://github.com/notbowen/minsky/pull/20), and [PR #21](https://github.com/notbowen/minsky/pull/21) remain open.
T0008 was developed separately. The T0005 branch now includes the accepted search through a merge from `main`.
Deployment is a separate explicit step.

### Behavior

- Use one team search in the issue queue and in **Report for team**.
- Update suggestions as staff type.
- Search team names and locations already present on the session snapshot.
- Do not add team codes, aliases, institutions, or a migration.
- Show at most eight suggestions.
- Show each team's name, location, and unresolved-issue count.
- Unresolved means open, in progress, or awaiting a specialist, including a reopened issue.
- That count ignores the status filter.
- Rank an exact team name, then an exact location, then whole words or whole numbers, then partial words, then a small spelling difference.
- Match partial words of at least three characters, either word order, and accents.
- Match a spelling difference only for a word of at least four characters.
- Match table numbers as whole numbers, including leading zeros. `12` matches `Desk 12` and `A12`. `1` does not match `12`.
- If more than eight teams match, say to keep typing. Those extra teams are not selectable.
- If nothing matches, say that no team matches and do not choose a substitute.
- An empty query shows no suggestions.
- Never select the first suggestion automatically.
- Store the chosen team's database id.
- Filter the queue to that team. Keep the status filter, including resolved history.
- Jury-only members keep the resolved queue and do not gain a status filter.
- Volunteers, specialists, jury members, and session admins can filter the queue.
- Only volunteers and specialists get the control on **Report for team**.
- A team chosen in the queue starts selected in that form, and either control updates the same choice.
- Editing the chosen text clears its id until staff choose again.
- **Submit issue** stays unavailable until a team id is selected.
- Clearing the team, or switching session, restores the unfiltered queue.
- Contestants do not see team search. Their form stays bound to their own team.

### Acceptance criteria

- [x] Queue search and **Report for team** use the same matching and the same selected team id.
- [x] Suggestions update while typing and require an explicit choice.
- [x] Ranking, accents, word order, spelling, whole numbers, weak queries, and the eight-suggestion cap are covered by focused tests.
- [x] The status filter and the jury-only resolved queue still apply with a selected team.
- [x] Numeric tokens never use partial or spelling matches, including three-digit prefixes and nearby four-digit numbers.
- [x] Tab leaves open suggestions for the next control without losing focus; arrow keys, Enter, and pointer selection still work.
- [x] Enter and Space on **Clear team** clear the shared selection, return focus to the input, and preserve the status filter and report draft. Pointer clearing still works.
- [x] Refreshed membership, automatic session fallback, and removal of a selected team cannot leave an invalid team choice active.
- [x] No schema or cloud fixture is added.
- [x] The user merged PR #22. Deployment waits for an explicit request.

## T0010 — P2 review fixes

Branch: `feature/t0010-p2-review-fixes`, from updated `main` at `d961f5b`.
The branch now includes `main` at `9c0341c`, with T0005 issue images.
Status: merged in [PR #24](https://github.com/GiftedNovaHD/minsky/pull/24) on 2026-10-15.
Summary: Fixed three review findings in issue refresh, membership refresh, and cloud fixture cleanup.

The user authorized fixes for the three P2 findings from the review of `1ed603a`.
The branch preserves the merged T0008 team search and stays independent of the other open feature pull requests.

### Acceptance criteria

- [x] A new issue cannot replace the displayed issue or discard its reply draft during a background refresh.
- [x] Refreshed membership fields send the current roles, admin flag, and team. Unchanged membership values preserve local edits.
- [x] Failed cloud cleanup retains the fixture file and reports its path. Successful teardown removes it before the wrapper removes the directory.
- [x] Regression tests use the application UI or the real test runner and assert exact requests and observable file effects.
- [x] Required local checks pass and documentation records the results.
- [x] The user merged PR #24.

No schema change or deployment is part of this ticket.

## T0016 Cloudflare backend design

Branch: `feature/t0016-cloudflare-backend-design`, from PR #32 at `d158906`.
The branch included PR #32 at `ef6a029` and T0015 in PR #37 at `738ef4a`.
Status: design merged in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36) at `b68ef72` on 2026-10-17 at 13:50:36 UTC. No Cloudflare connector or resources exist in this change.
Summary: Documented the proposed Cloudflare architecture and staged acceptance plan for implementation and data migration.

The user authorized this design in parallel with T0015 shared provider tests while PR #32 was under review.
This was an explicit exception to the normal branch and merge sequence.
The user accepted the design by merging PR #36. This did not authorize Cloudflare resource creation, credential exports, deployment, or data migration.

### Acceptance criteria

- [x] Separate browser contracts from server domain rules, transactional persistence, identity, blob storage, and change delivery.
- [x] Specify D1 command receipts, atomic preconditions, concurrent changes, and private revision rules without a cross-resource transaction claim.
- [x] Specify image permission checks, reservation limits, immutable storage, retryable deletion, and orphan cleanup.
- [x] Specify Durable Object authorization, audience separation, reconnect behavior, revocation, and recovery of pending notifications.
- [x] Record credential-migration options and decisions required before account cutover.
- [x] Define bounded implementation phases with provider tests, migration comparison, and rollback acceptance.
- [x] Keep AWS and Terraform as future work while defining portable interfaces.
- [x] The user reviewed and accepted the design by merging PR #36.

### Verification

The [design](cloudflare-backend-design.md) explains the decisions.
The [historical implementation plan](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/cloudflare-implementation-plan.md) records the accepted implementation phases.
Remaining [migration gates](product-direction.md#migration-and-cutover-gates) stay deferred.
The [verification record](current-state.md#t0016-cloudflare-backend-design-2026-10-17) identifies this documentation-only change.
Supabase remains active. This ticket creates no credentials, provider resources, or data migration.

## T0014 backend adapters

Branch: `feature/t0014-backend-adapters`, from updated `main` at `de92d54`.
Status: merged in [PR #32](https://github.com/GiftedNovaHD/minsky/pull/32) at `ef6a029` on 2026-10-17. Local checks, ordinary GitHub checks, and all 14 hosted Supabase cases pass. Fixture cleanup completed.
Summary: Added provider-neutral backend contracts and moved the existing Supabase integration behind the first adapter.

The user selected shared backend interfaces before the Cloudflare migration.
This ticket extracts Supabase as the first implementation.
The browser continues to use the existing Auth service, database functions, account function, private image storage, and live subscriptions.

### Acceptance criteria

- [x] The UI uses typed interfaces for authentication, session reads, issue commands, administration, images, and live updates.
- [x] Provider clients, access tokens, channels, database queries, and function payloads stay inside the Supabase implementation.
- [x] Existing database and server functions remain the authority for permissions and workflow transitions.
- [x] An uncertain write retains its request ID. A confirmed server rejection permits a new command.
- [x] Password changes complete the existing mandatory-password check before the UI reports success.
- [x] Image retries retain the existing upload identity, visibility, file checks, and removal behavior.
- [x] Live subscriptions release their resources and ignore callbacks after cleanup. The UI retains refresh on reconnect, focus, and polling.
- [x] Local type, lint, build, database, function, adapter, and browser checks pass.
- [x] Documentation separates the current Supabase implementation from the selected future Cloudflare backend.
- [x] Protected cloud checks pass on the reviewed revision against the existing Supabase backend. The [run on `a3b3c70`](https://github.com/GiftedNovaHD/minsky/actions/runs/39027288113) passes all 14 cases with `existing_backend=true` and successful fixture cleanup. The verification record identifies the backend versions.
- [x] The user merged PR #32.

### Verification

The [backend reference](backend-contracts.md) defines the interfaces.
[Current state](current-state.md#t0014-existing-backend-verification-2026-10-17) records the verification results.

The Cloudflare backend, D1 schema rewrite, account migration, R2 copy, and Durable Objects implementation remain later work.
[T0015](#t0015-shared-provider-tests) implements the shared hosted verification suite before the second provider implementation.
Other provider adapters and Terraform remain deferred.
This ticket adds no backend schema or provider service and does not migrate user data or deploy the app.
Hosted verification requires the existing CI project to have the merged backend migrations and functions.

## T0011 — Documentation site

Branch: `feature/t0011-documentation-site`, from updated `main` at `de92d54`.
The branch now includes `main` at `f8a8cac`, with the merged T0012 and T0013 fixes.
Status: the initial site is implemented, deployed, and verified locally and on the public docs site.
The later CI workflow passes local checks and awaits account setup and its first automatic deployments.
The user merged [PR #29](https://github.com/GiftedNovaHD/minsky/pull/29) on 2026-10-17 at 10:36:06 UTC, commit `aaa6bbc`.
The GitHub deployment switch remains off. Automatic deployment remains unverified.
See [deployment evidence](current-state.md#t0011-documentation-site-2026-10-17).
Summary: Built and deployed the documentation site, then added CI deployment workflows for the frontend and docs. The first automatic deployments remain unverified.

The user requested a documentation site to accompany T0007, including written content and Workers deployment.
This request authorizes the initial `minsky-docs` deployment before the source PR merges.
The user still reviews and merges the PR.
T0007 remains a separate open change.

### Scope

- Publish user, staff, jury, administrator, operator, and contributor guides from repository Markdown.
- Label merged features, pending T0007 installation steps, and unverified operating conditions.
- Use Astro Starlight with local search, keyboard navigation, phone layouts, and a useful 404 page.
- Keep the docs package and build output under `site/`.
- Deploy static assets through `wrangler.docs.jsonc` to `minsky-docs.icaic-minsky.workers.dev`.
- Add documentation links to the README, sign-in footer, and workspace sidebar.
- Add docs build, local-link, browser, and dependency checks to ordinary CI.
- Document the exact editing, verification, deployment, and hosted-check commands.

### Outside this ticket

Backend changes, T0007 container execution, merging other PRs, paid services, and domain purchases.
The later automation decision below extends the original static-site scope to prepare both existing frontend configurations.

### Acceptance criteria

- [x] Public guides describe the inspected implementation and clearly label T0007's pending status.
- [x] The site uses a separate Worker and publishes only its generated static files.
- [x] Required local checks pass, including docs search, navigation, local links, and phone layout.
- [x] The deployed site passes HTTP, deep-link, search, and 404 checks.
- [x] Deployment evidence and a source PR are available for user review.

### Open-source release follow-up (2026-10-17)

The user requires release-quality documentation for readers outside the project.
The initial site acceptance above remains complete. Public release readiness remains incomplete.
Use the [documentation release plan and audit](documentation-release-plan.md) for exact findings and completion criteria.

- [x] Record the reader structure, quality rules, source audit, and release gaps.
- [x] Remove the obsolete demo-command comment and correct current maintenance command repository paths.
- [ ] Complete factual details, public contribution instructions, and separation from maintainer records.
- [ ] Complete installation and operating guides against T0007's verified revision.
- [ ] Record owner decisions about licensing, source publication, and support before a public release.
- [ ] Verify the complete reader journey and publish through the selected deployment workflow.

These items do not authorize merging T0007, changing repository visibility, selecting a license, or provisioning services.

### Automatic frontend deployment decision (2026-10-17)

The user requested branch previews and stable deployment after merges to `main`.
The later CI requirement makes GitHub Actions publish only after `checks`, `secrets`, and `dependencies` pass.
The branch includes both Worker configurations, deployment validation, focused tests, and exact [setup instructions](cloudflare-builds.md).
The setup covers `minsky-dev` and `minsky-docs` and replaces repeated frontend deployment approval after activation.
Independent Cloudflare Git builds must remain disabled.
The user requested the workflow and setup steps before adding credentials.
Account setup, first automatic previews, and the first automatic `main` deployments remain unverified.
Migrations and functions remain explicit backend work.
Full app preview operation also needs approved browser origins for the development functions.

The four reported permission rules now appear in the public guides.
The [audit](documentation-release-plan.md#permission-documentation-fixes) maps each correction and its remaining proposed work.

## T0012 — Reply retry cleanup

Branch: `feature/t0012-reply-retry-cleanup`, from updated `main` at `de92d54`.

Status: merged into `main` in [PR #30](https://github.com/GiftedNovaHD/minsky/pull/30) on 2026-10-17.
Summary: Preserved reply drafts and request identity across uncertain retries, then cleared the editor after confirmed success.

The pending reply now retains its success cleanup with its request ID and command.
A successful retry clears the reply text and resets the audience before editing resumes.
Failed requests preserve the draft.
The request ID stays the same across retries, so the server can recognize an already recorded reply.

### Acceptance criteria

- [x] Successful retries clear public replies and internal notes. **Send reply** stays disabled until new text is entered.
- [x] Repeated transport failures preserve the draft, audience, request ID, and command until success.
- [x] A rejected request preserves an editable draft and does not create a history entry.
- [x] A new reply after successful retry uses a new request ID and completes normally.
- [x] Browser regression tests reproduce the original failure and pass with the fix. Required local checks pass.
- [x] The user merged PR #30.

Verification is recorded in [current state](current-state.md#t0012-reply-retry-cleanup-2026-10-17).
Deployment remains a separate step.

## T0009 — Jury worklist

Branch: `feature/t0009-jury-worklist`, from updated `main` at `1ed603a`.

Status: merged in [PR #23](https://github.com/GiftedNovaHD/minsky/pull/23) at `c144a2a` on 2026-10-18 after parallel maintenance and verification.
Current `main` at `7d19b00` is the integration baseline. Fast checks, 276 unit/database tests, 44 application browser cases, and authentication/documentation browser checks pass. Hosted jury acceptance, protected checks, and scoped cleanup pass on runtime source `f45d03f`. The final follow-up changes documentation only.
Summary: Provide separate outstanding decision and external-application lists through the existing issue details and actions.

The first implementation and local checks date from 2026-10-15.
Those results are historical and do not establish compatibility with current `main`.
The owner reviews and merges. This task does not authorize deployment.
The [jury worklist specification](jury-worklist.md) defines the behavior.
T0020 remains the separate active connector goal. Do not edit its checkout.
No schema, backend feature, provider implementation, or runtime dependency is part of T0009 maintenance.

### Selected scope

- Add a separate **Jury worklist** screen for current jury and combined-role members.
- Show **Needs decision** for resolved issues without an award and **Pending
  external application** for every unapplied award, including zero-minute awards
  and awards on reopened issues.
- Show team/location, issue/status, unresolved time, resolution evidence, and
  relevant award attribution. Order by the oldest outstanding resolution or award.
- Open existing issue details and actions with a return path to the worklist.
  Preserve discretionary awards, separate confirmation, and one award per issue.
- Reuse authorized snapshots, updates, timing, and workflow operations. No schema
  change or dependency on the other open feature branches is expected.

### Acceptance criteria

- [x] Role, session, archive, and live-access rules pass local browser/database checks.
- [x] Both lists, counts, ordering, fields, zero-minute decisions, and reopening
  behavior match the specification and its eligibility table.
- [x] Existing issue actions work from the new screen, including jury-only access
  to a reopened issue's pending confirmation and accessible return navigation.
- [x] Simulated two-client updates, preserved drafts, refresh, phone layout,
  keyboard use, and existing database workflow protections pass locally.
- [x] Fast checks and documentation validation pass with actual results recorded.
- [x] Hosted jury acceptance on Minsky CI and protected CI pass. Fixture cleanup is verified.
- [x] Remaining physical-device and assistive-technology limits are recorded without implying completed checks.
- [x] PR #23 reflects passing required verification and is prepared for owner review. The owner reviews and merges.
