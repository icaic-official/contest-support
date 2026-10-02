# Development tickets

These tickets describe development work, not contestant issues.

## T0001 — Local workflow demo and project guidance

Branch: `feature/t0001-local-demo`

Status: implemented, verified and merged in [PR #1](https://github.com/notbowen/minsky/pull/1) on 2026-10-02. The user accepted the proof of concept and authorized T0002 on this branch before the shared merge.

Scope: React, TypeScript, Vite, npm lockfile, fictional group session, simulated contestant/volunteer/specialist/jury personas, versioned local persistence, and supporting project guidance. No cloud or deferred production features.

The tooling update on this branch upgraded ESLint to version 10 and installed compatible plugins. It preserved the existing Hooks checks. It updated the lockfile and Node requirements. All required automated checks passed after the update.

Acceptance criteria:

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

### Acceptance and verification

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

### Review refinements — 2026-10-02

The user requested these refinements on the open shared PR, within T0002:

- Award zero minutes as an explicit decision; retain the required public explanation, one-award rule and separate application confirmation. Offer 0, 5, 10, 15, 30, 60 and Custom in a dropdown. Custom accepts non-negative whole minutes.
- Offer common public resolution summaries in a dropdown: Resolved without comment, Service restored, Device issue resolved, Problem statement clarified, and Custom. The no-comment choice stores its explicit text. Custom retains the existing required 1–2,000-character validation. Reopening clears the current selection so another resolution needs a fresh choice.
- Preserve saved v2 data without resetting or adding a schema version: this extends the accepted minute range and keeps the existing summary representation. Keep the frozen v1 migration validator unchanged.

Verification is recorded in [current-state.md](current-state.md).

## T0003 — Cloud onboarding and authenticated shared product

Status: implementation in progress on `feature/t0003-cloud-product`, started from updated `main` on 2026-10-02. Supabase schema and trusted first-admin/session bootstrap have been applied to the development project. Connected frontend, account administration, cloud contributor commands and embedded database tests are implemented. The initial hosted workflow/authorization/browser checks passed; final privacy/archival verification is recorded in current-state.md; the user has replaced email onboarding with username/password provisioning and organizer-assisted recovery. The user reviews and merges [draft PR #2](https://github.com/notbowen/minsky/pull/2). Username-flow verification is recorded in current-state.md. Billing/ownership records and protected cloud CI environment setup remain incomplete.

Updated authentication decision (2026-10-02): organizer-created usernames/passwords replace email invitations and recovery. Users must change temporary passwords before contest access. Organizers verify identity and issue new temporary credentials for recovery. SMTP/personal email addresses are not prerequisites. Existing Auth IDs and history are preserved.

Updated contributor decision (2026-10-02): contributors may be assumed to have full cloud credential access. Docker is optional, not required for development, migrations, function deployment or the embedded database checks. Cloud integration CI uses a protected isolated test project; untrusted PR checks run without provider credentials. This supersedes the local-stack prerequisite below; the connected workflow and authorization requirements remain in scope.

Selected quality improvements (2026-10-02): require CI and independent review before merging, add a short PR review checklist, and scan secrets/dependencies with routine update PRs. Implementation and owner setup are described in [code-quality.md](code-quality.md). Remote merge rules and vulnerability alerts require repository administration access; they are not inferred from committed workflow files.

Selected interface refinement (2026-10-02): the user requested temporarily installing Anthropic's `frontend-design` skill, applying it to the repository, pushing the changes and deploying the frontend to Cloudflare, then removing the skill. This refinement stays on the active T0003 branch and covers sign-in, shared styles, responsive reporting/queue/detail layouts and administration. It preserves existing workflow and authorization rules; no new backend features are included. Verification and deployment evidence are recorded in [current-state.md](current-state.md).

### Outcome and recommended boundary

Different people can sign in to a hosted Minsky deployment and complete the existing issue journey against shared data. Another developer with authorized cloud access can clone the repository, run the connected frontend locally, make a migration and submit a tested PR. Fast checks run without cloud credentials or Docker; full integration tests provision isolated cloud fixtures.

Include real authentication and the contestant/support/jury dashboards now: they are necessary to make shared workflows useful. Include only the account and session controls needed to operate the first group-contest pilot. Recommend broader organizer administration and configurable uploads for the next ticket (candidate T0004). Do not add every long-term product requirement to this ticket.

Cloud first, features first: connectivity is assumed. Offline queues, synchronization after outages, venue-local operation, disaster recovery and capacity validation are deferred. Visible request failures and prevention of conflicting/duplicate writes are part of ordinary product correctness.

### Provider onboarding and deployment

- Walk the user through Cloudflare and Supabase account/organization setup, project ownership, developer access and billing visibility. Distinguish provider-console membership from Minsky application accounts. The user completes provider login, verification and any payment entry in the provider UI.
- Start with one Supabase Free development project and Workers Free on a `workers.dev` address. Use shared cloud access for contributors and an isolated cloud test project for privileged CI; Docker is optional. Avoid requiring paid hosted database branches, a purchased application domain, R2 or AWS merely to begin.
- Follow [cloud-onboarding.md](cloud-onboarding.md), completing it with the actual region, non-secret project identifiers, deployment URL, tested commands and setup results. Explain any required spend, recurring costs and usage limits; use available cost controls and retain billing records for reimbursement.
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
- Remove demo reset, persona switching, fictional auto-seeding and browser-local issue persistence from the hosted product. Keep fictional data/reset tooling local to development and tests. Do not import browser demo data into the hosted database automatically. Identify the hosted environment as development without claiming event readiness.

### Contributor setup and verification

- Commit migrations, isolated cloud fixture/account setup, environment examples and exact setup/check/deploy commands. Document Node, npm, CLI login, shared cloud setup and isolated cloud test fixtures. Docker and local email capture are optional; SMTP is not needed for the selected account flow. A fresh clone must not require shared provider credentials to run tests.
- Add CI for type checking, lint, build, focused tests, database policies/transactions and a browser journey across real test accounts. Keep existing domain semantics covered as persistence changes. Include two simultaneous clients, cross-team/session denial, internal-note exclusion, combined roles, account revocation, admin-only operations and claim/award races.
- Document and execute a hosted smoke test of username login, forced password change/reset, shared updates and the complete workflow. Verify phone widths, keyboard navigation and refresh against the connected app. Record commands and results; do not reuse demo results as backend verification.
- Update README, current state and manual verification to describe actual connected behavior. Keep the demo specification as historical scope and explain its replacement. Expand the onboarding guide with observed setup outcomes.

### Acceptance criteria

- [ ] User can identify project ownership, URLs, environment settings, usage dashboards and any actual recurring charges; account setup and contributor access are documented.
- [x] App is deployed on Workers with a shared Supabase database and working username/password provisioning, mandatory password changes, login, logout and organizer-assisted resets.
- [x] Admin can onboard a team and individual staff, assign combined roles, revoke access and operate contestant intake without editing source code. First-admin bootstrap is reproducible.
- [x] Separate authenticated contestant/support/jury/admin views work; demo controls and client-supplied identity cannot bypass permissions.
- [x] Full submit → claim → handoff → resolve → award → external confirmation journey and repeated reopening work across distinct signed-in browsers. Staff can submit for a roster team.
- [x] Server timestamps, transactional transitions and a unique award constraint preserve history and reject concurrent/duplicate actions. Unauthorized API access and private-note leakage are tested.
- [x] Cloud migrations, isolated fixtures and documented commands reproduce the connected environment from a fresh clone; fast PR checks run without hosted secrets or Docker.
- [ ] Build, lint, type checking, focused/database/browser tests and hosted/manual checks pass, with actual evidence recorded. Provider setup blockers are marked incomplete.

### Explicit exclusions and later decisions

No offline/resilience project, 800-user load certification, individual-contest UI, shared incidents, CSV imports, push notifications, full event/category/role editors, advanced reporting or award adjustments. Image uploads and upload-setting UI are deferred to the next candidate so visibility rules can be settled first; this does not discard the user's attachment requirement.

## Candidate queue (not yet development tickets)

1. **Recommended T0004: organizer tools and configurable issue attachments.** Event/session/roster/category editing and permission settings, prioritized after the cloud workflow is reviewed. Helpers' uploaded photos/screenshots must be linked to an issue with uploader/time metadata. Include enable/disable controls for volunteer image submission, enforced by the backend. Decide configuration scope, defaults, and contestant-visible versus staff-only access before implementation; do not infer that the uploader chooses visibility. Supabase Storage is recommended initially, with file records in Postgres and private bucket access. Choose file types/size limits and deletion rules when scoping. This is a candidate, not a created or started T0004.

Resilience and event-capacity work remain deferred until feature feedback warrants them.
