# Development tickets

These tickets describe development work, not contestant issues.

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

## T0013 — Image preview request handling

Branch: `feature/t0013-image-preview-race`, from updated `main` at `de92d54`.

Status: implemented and verified locally. The user reviews and merges.

The user requested two independent PRs for the review findings on 2026-10-17.
T0013 fixes image previews. [PR #30](https://github.com/GiftedNovaHD/minsky/pull/30) fixes reply retry cleanup in T0012.
Both branches start from `main`. Either PR can be reviewed and merged first.

Only the current, open preview can use a completed download or report its error.
Closing a preview or opening another image makes older requests inactive.
The app releases each temporary browser URL when its preview closes, changes, or leaves the page.

Acceptance criteria:

- [x] A delayed download cannot replace a newer preview or its download link.
- [x] A delayed error from an older preview cannot replace the current status. Current errors still appear.
- [x] Both **Close** and Escape restore focus and prevent older results from changing a new preview.
- [x] The temporary browser URL is released when the preview closes.
- [x] Browser regression tests reproduce the original failures and pass with the fix. Required local checks pass.
- [ ] The user reviews and merges the pull request.

Verification is recorded in [current state](current-state.md#t0013-image-preview-request-handling-2026-10-17).
No schema or function change is required. Deployment remains a separate step.

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

Status: implemented and merged in [PR #2](https://github.com/notbowen/minsky/pull/2) on 2026-10-02. Work started from updated `main` on `feature/t0003-cloud-product`. Supabase schema and trusted first-admin/session bootstrap were applied to development; connected frontend, account administration, cloud contributor commands and embedded database tests are implemented. Hosted username-flow/workflow/authorization verification is recorded in current-state.md. Protected cloud CI environment setup and its first successful run remain a recorded setup gap; the T0004 repository inspection still found no GitHub environments.

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

Implementation branch: `feature/t0004-ui-makeover` (deleted after merge).
The branch started from updated `origin/main` after T0003 merged in PR #2 on 2026-10-02.

Status: implemented and merged in [PR #9](https://github.com/notbowen/minsky/pull/9) on 2026-10-11 (SGT).
Merge commit: `52ff99133bd727626b3589b40a507ab438f508da`.
[The merge record](current-state.md#t0004-merge-and-documentation-follow-up-2026-10-11) gives the exact UTC timestamp and reviewed revision.
[PR #13](https://github.com/notbowen/minsky/pull/13) merged the documentation rewrite on 2026-10-11 (SGT).

Deployment evidence (2026-10-03): verified locally and deployed to [minsky-dev](https://minsky-dev.icaic-minsky.workers.dev).
The user explicitly requested "Deploy first".
All 12 hosted cases passed, and fixture deletion completed.

The user selected the two attached visual references on 2026-10-03.
[Current state](current-state.md#t0004-ui-makeover-2026-10-03) records implementation.
The [deployment record](current-state.md#t0004-development-deployment-2026-10-03) contains the hosted evidence.
That development deployment preceded merge under the user's exception for T0004.

### Selected scope

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

Status: implemented and verified locally on 2026-10-11.
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

### Selected scope

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
Status: implemented and verified locally. The user reviews and merges.

The user authorized fixes for the three P2 findings from the review of `1ed603a`.
The branch preserves the merged T0008 team search and stays independent of the other open feature pull requests.

Acceptance criteria:

- [x] A new issue cannot replace the displayed issue or discard its reply draft during a background refresh.
- [x] Refreshed membership fields send the current roles, admin flag, and team. Unchanged membership values preserve local edits.
- [x] Failed cloud cleanup retains the fixture file and reports its path. Successful teardown removes it before the wrapper removes the directory.
- [x] Regression tests use the application UI or the real test runner and assert exact requests and observable file effects.
- [x] Required local checks pass and documentation records the results.
- [ ] The user reviews and merges the pull request.

No schema change or deployment is part of this ticket.
