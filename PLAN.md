# Minsky planning record

**PR #42 review fixes and cleanup, 2026-10-18.** The owner requested all review fixes, cleanup, and tests before the existing T0020 PR is ready.
Continue on `feature/t0020-cloudflare-connector`. Preserve Supabase as the active backend and preserve the merged jury worklist.
Subtract before adding. Remove obsolete proof modes, duplicate helpers, stale instructions, and redundant references or stubs.
Converge on the current `Backend` and `WorkflowPersistence` architecture.
Keep one installation procedure and one current reference for each responsibility.
Preserve unique historical decisions, authorization limits, and verification evidence.
Retire executable historical proof paths instead of weakening current identity guards for compatibility.
Run the required checks after the fixes. Record new local, hosted CLI, and protected results separately.
Earlier passing runs do not verify the changed revision.
The owner reviews and merges. Bounded subagent work remains authorized.
The [earlier agent instructions](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/AGENTS.md) preserve the full ticket-specific scope record.

**Completed T0009 maintenance request, 2026-10-18.** The owner requested an update to [PR #23](https://github.com/GiftedNovaHD/minsky/pull/23).
Use its existing `feature/t0009-jury-worklist` branch in a separate worktree.
Merge current `main` at `7d19b00` and verify current behavior before owner review.
Preserve the separate T0020 connector checkout and scope.
Use the existing `Backend` contracts, authorized snapshots, and shared server workflow rules.
Keep Supabase active. Add no schema, backend feature, provider implementation, or runtime dependency.
Use only UUID-owned fictional fixtures in Minsky CI, `ghtztmovdkhuketcbjmq`, for hosted acceptance.
The owner approved the exact T0009 `cloud-test` branch addition on 2026-10-18. Preserve all other entries and protection rules.
Do not deploy the application, merge the PR, or migrate data.
Required checks and hosted acceptance were prerequisites for that review. The owner later merged PR #23 at `c144a2a`.

**Complete Cloudflare connector, 2026-10-18.** T0020 starts from updated `main` at `7d19b00` after PR #41 merged.
Use `feature/t0020-cloudflare-connector` for the complete connector and empty-installation verification.
The [ticket](docs/tickets.md#t0020-complete-cloudflare-connector) records milestones and acceptance criteria before implementation.
Reuse the shared workflow and merged authentication implementation.
Inspect PR #21 before installation tooling. Reuse suitable parts without merging its branch wholesale.
Keep provider configuration and bootstrap inside provider implementations.
Document reuse decisions and recommend a PR #21 disposition. The owner decides whether to close it.
Isolated Cloudflare development, CI, and installation resources are authorized in the confirmed account.
Only T0020's branch may be added to the protected cloud-test allowlist. Preserve other entries and rules.
Supabase remains active. Docker packaging, AWS, Terraform, real-data migration, and backend cutover remain deferred.
The owner reviews and merges. Bounded subagent work is authorized.
The owner merged T0009's jury worklist in PR #23 at `c144a2a` during T0020 verification.
T0020 now includes that main revision and verifies the combined application before owner review.

**PR #41 review follow-up, 2026-10-18.** The owner requested review fixes, code cleanup, and completion of authentication verification on the existing PR.
Use `feature/t0019-shared-server-workflow`.
Correct Supabase login expiry after lock waits with an additive migration. Preserve the installed migration source.
The owner confirmed Workers Paid activation. The isolated authentication Worker accepts the 1,000 ms cap.
Its local hosted HTTP suite and protected authentication on merged `main` pass.
Record that protected result separately from the PR #41 hosted runs.
Retain the maintained password parameters and the 1,000 ms CPU cap.
Supabase remains active. The owner reviews and merges.

**Shared server workflow, 2026-10-18.** T0019 extracts the existing issue rules before further Cloudflare workflow implementation.
Use `feature/t0019-shared-server-workflow` from updated `main` at `0c797ad`.
The owner authorized this ticket while [PR #40](https://github.com/GiftedNovaHD/minsky/pull/40) was open.
The branch started independently of the authentication branch.
The owner merged PR #40 at `68e8642` on 2026-10-17 at 17:16:41 UTC.
T0019 now includes that updated `main` and preserves the merged authentication implementation.
PR #39 merged the bounded D1 proof. Its merge does not make the complete server workflow portable.

Use one shared application service for all existing issue commands.
Exercise that service through a trusted Supabase entry point and isolated CI fixtures.
Keep database constraints, atomic writes, current-access checks, and stale-state detection in provider adapters.
Align D1's existing `claim` and `message` proof with those same decisions.
Do not design a separate Cloudflare workflow.
See [the workflow reference](docs/server-workflow.md) and [verification guide](docs/verify-server-workflow.md).

Supabase remains active. The legacy browser workflow stays available during replacement verification.
Development backend deployment requires separate authorization.
The owner reviews and merges. Bounded subagent work is authorized.
PR #40's initial protected HTTP verification hit the Workers Free resource limit.
The owner activated Workers Paid under the PR #41 follow-up above. See current-state records for the later verification results.
Remaining D1 commands, R2, notification delivery, migration tooling, AWS, and Terraform remain later work.
No real-data export, real-account reset, or backend switch is authorized.

**Cloudflare authentication, 2026-10-18.** The owner selected the next focused ticket after PR #39 merged.
T0018 uses `feature/t0018-cloudflare-authentication` from updated `main` at `0c797ad`.
The owner merged T0018 in PR #40 at `68e8642` on 2026-10-17 at 17:16:41 UTC.
Implement username login, bounded cookie sessions, mandatory password changes, and organizer-assisted recovery behind the shared contracts.
Preserve account IDs, memberships, permissions, and history. Check current permissions and revoked credentials at the server.
Use maintained Better Auth and cryptographic components, explicit origins, request-forgery protection, and isolated fictional fixtures.
See [the authentication reference](docs/cloudflare-authentication.md) and [verification guide](docs/verify-cloudflare-authentication.md).
Isolated development and CI resources remain authorized in the confirmed account.
The owner confirmed Workers Paid activation during PR #41 review.
The measured hash requires more CPU than Workers Free permits. The identity choice records the concrete Standard plan cost.
The initial protected run passed all 28 hosted D1 account cases, then hit a Worker resource limit during HTTP password change.
The owner initially deferred the subscription on 2026-10-18, then activated it during PR #41 review.
Record the later paid verification separately from that failed run.
Supabase remains active. The remaining connector, real-data exports, migration, and backend switch remain later work.
The owner reviews and merges.

**D1 proof and migration decisions, 2026-10-17.** The next focused ticket is T0017 on `feature/t0017-d1-transaction-proof`.
The branch starts from updated `main` at `53f9dfd`.
Prove one D1 command that commits its state change, retry receipt, history, and notification record together.
Define the SQLite schema and a provider-independent application-store interface.
Use fictional fixtures and obtain hosted D1 evidence before claiming verification.
See [the historical proof guide](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/d1-transaction-proof.md) and [historical implementation plan](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/cloudflare-implementation-plan.md).

Authentication and the remaining Cloudflare operations follow the proof.
Full migration tooling follows connector verification.
Real-data exports and the backend switch remain later phases. Keep Supabase active.
AWS adapters and Terraform remain deferred.

The owner selected organizer-issued replacement temporary passwords for migration.
Users must change these passwords before contest access.
Preserve account IDs, memberships, permissions, and history. Existing passwords do not need to survive.
Password-hash import is no longer required.

The owner authorizes isolated development and CI resources in the existing Cloudflare account as needed for this work.
Keep the resources separate. Verify the account before provisioning.
Check existing Wrangler access before requesting credentials. Keep tokens out of chat and logs.

The existing OAuth login was checked against account `458ad6a930b0fb717796dfa19ca6a2b1`, which matches the repository configuration.
Document the concrete need and cost before any paid upgrade.
Subagents may perform independent, bounded tasks.

The earlier dated records below retain their original ticket scope.
This decision adds resource authorization for T0017 without authorizing real-data exports or a backend switch.

**Parallel provider work, 2026-10-17.** The user authorized shared provider tests and Cloudflare design while PR #32 was under review.
T0015 uses `feature/t0015-provider-contract-tests`.
T0016 uses `feature/t0016-cloudflare-backend-design` for the [backend design](docs/cloudflare-backend-design.md) and [historical implementation plan](https://github.com/GiftedNovaHD/minsky/blob/88ea5020a0f9dfc34a32ed7fbd84dfea07423297/docs/cloudflare-implementation-plan.md).
Both branches started from PR #32 at `d158906`, as an explicit exception to waiting for its merge.
The user merged PR #32 at `ef6a029` on 2026-10-17 at 12:51:42 UTC.
The user then merged T0015 in [PR #37](https://github.com/GiftedNovaHD/minsky/pull/37) at `738ef4a` on 2026-10-17 at 13:44:12 UTC.
The user merged T0016 in [PR #36](https://github.com/GiftedNovaHD/minsky/pull/36) at `b68ef72` on 2026-10-17 at 13:50:36 UTC.
The merge accepts the design only. It does not authorize Cloudflare resource creation, credential exports, deployment, or data migration.

The shared tests call the browser `Backend` contract.
Provider fixtures own setup, credentials, fault injection, and cleanup.
The same assertions must apply to Supabase, Cloudflare, and a possible future AWS adapter.
See [T0015](docs/tickets.md#t0015-shared-provider-tests) for the merged test scope and evidence.

T0016 records provider boundaries and the proposed Cloudflare architecture.
It does not implement a connector, provision resources, export credentials, or migrate data.
AWS implementation and Terraform remain deferred.
Supabase remains active until Cloudflare verification and a data-preserving migration rehearsal pass.

**Backend adapter decision, 2026-10-17.** The user authorized step 1 as T0014 on `feature/t0014-backend-adapters`.
The branch starts from updated `main` at `de92d54` while the earlier pull requests remain open.
Define shared interfaces for Minsky operations and extract the existing Supabase integration behind them.
Preserve account access, workflow rules, image behavior, and live refresh.
See [T0014](docs/tickets.md#t0014-backend-adapters) and the [backend contracts](docs/backend-contracts.md).

The selected migration target is Cloudflare Workers, D1 with a SQLite rewrite, private R2 storage, and Durable Objects for live updates.
Supabase remains the active backend during this first step.
The migration must preserve existing accounts, IDs, history, awards, permissions, and images.
The Cloudflare implementation, authentication choice, migration tools, other providers, and Terraform remain later work.
This decision supersedes the older long-term Supabase direction below.

The user confirmed the migration order after PR #29 merged on 2026-10-17.
First implement the shared interfaces and Supabase adapter.
Verify that adapter against hosted Supabase before implementing the Cloudflare adapter.
Test the Cloudflare implementation and rehearse a data-preserving migration before switching the active backend.
Frontend deployment automation is separate from these acceptance steps.

**Documentation writing rules, 2026-10-17.** The user supplied `unslop` and `technical-writing` principles.
Apply them to documentation, README text, PR descriptions, and commit messages.
Use one Diataxis purpose per page and preserve exact code names and commands.
See [the writing guide](docs/writing-guide.md).

**Automatic frontend builds (2026-10-17):** the user requested previews for branch pushes and stable deployments after merges to `main`.
The later CI requirement selects GitHub Actions for `minsky-dev` and `minsky-docs`.
Deployment depends on passing `checks`, `secrets`, and `dependencies` jobs for the same push.
Keep independent Cloudflare Git builds disabled.
This replaces repeated frontend deployment approval after activation.
The user still reviews and merges. Backend deployment remains an explicit, coordinated step.
The user requested the completed workflow and setup instructions before adding credentials.
See [setup and verification](docs/cloudflare-builds.md).
Provider authentication and the first automatic deployments remain unverified.

**Open-source documentation quality (2026-10-17):** the documentation must serve readers outside the project.
Provide reproducible instructions, exact behavior and limits, clear release status, and tested installation procedures for supported paths.
Keep public guides separate from maintainer deployment records and historical ticket reports.
The initial T0011 site is a working baseline. It is not yet release-ready.
See the [documentation release plan and audit](docs/documentation-release-plan.md) for specific gaps and completion criteria.
License selection and repository publication remain owner decisions.

**Documentation site (2026-10-17):** the user requested implementation, written guides, and deployment to Cloudflare Workers.
T0011 is a companion to the open T0007 installation work.
Use `feature/t0011-documentation-site` from updated `main`.
The user authorizes a separate `minsky-docs` Worker in the existing development account and its initial deployment before merge.
The user still reviews and merges the source PR.
This exception does not authorize application, database, or function deployment.
See [T0011](docs/tickets.md#t0011--documentation-site).

**T0008 team search (2026-10-15):** the user merged [PR #22](https://github.com/notbowen/minsky/pull/22) into `main`.
Staff match the current session's team names and locations while they investigate issues or report one for a team.
The T0005 branch includes the accepted search through a merge from `main`.
Deployment is a separate explicit step.
See [T0008](docs/tickets.md#t0008--fuzzy-team-search).

**T0004 merge status (2026-10-11):** the user merged [PR #9](https://github.com/notbowen/minsky/pull/9) into `main` and deleted its branch.
The user merged the documentation rewrite in [PR #13](https://github.com/notbowen/minsky/pull/13) on 2026-10-11 (SGT).
See [the merge record](docs/current-state.md#t0004-merge-and-documentation-follow-up-2026-10-11) for the revision and timestamp.

**Latest ticket decision (2026-10-11):** T0005 adds issue images on `feature/t0005-issue-attachments`.
Staff attach JPEG, PNG, and WebP images to an issue.
The uploader chooses team-visible or staff-only visibility at upload.
The default is staff-only, and the choice stays fixed.
Session admins set the file size, image count, and combined size.
See [T0005](docs/tickets.md#t0005--issue-images).

These items stay deferred and are not part of T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining manual acceptance checks.
- Event, roster, and category editors.

**T0004 deployment exception (2026-10-03):** the user requested "Deploy first".
This authorized deployment of the completed frontend to `minsky-dev` before PR #9 merged.
The exception applies to T0004's development deployment.
[Current state](docs/current-state.md#t0004-development-deployment-2026-10-03) records the deployed revision and hosted verification.

**Current decision (2026-10-02):** T0003 is the connected Supabase and Cloudflare development app.
The user requested a public login landing page and sidebar.
The user then removed the old local demo and its unnecessary tests.
Keep connected workflow and authorization tests and isolated cloud fixtures.
The original demo plan below is historical.
It does not authorize restoration of the demo runtime, reset tooling, personas, or browser-local issue persistence.

## Original demo plan

## 1. Immediate goal

Build a small, interactive demo to help you decide how Minsky should work. Preserve our broader product decisions as future direction, and plan subsequent implementation tickets incrementally.

The first demo will use **React, TypeScript, and Vite**, fictional data, simulated personas, and browser-local persistence. It will require no cloud accounts or paid services.

Success means you can experience this complete journey:

**Contestant submits → volunteer claims → volunteer escalates → specialist accepts and resolves → jury awards time → staff confirms external application.**

## 2. Demo behavior

**Screens and personas**

- Provide a clearly labeled demo persona selector: team contestant, volunteer, specialist, and jury.
- Use one fictional group-contest session with several teams and seeded issues. Individual-contest support remains documented product direction.
- Give contestants a simple submission form and their team’s issue history.
- Give volunteers and specialists a queue with status filters, ownership, location, elapsed time, and issue details.
- Give the jury a resolved-issue view and time-award controls.
- Use a practical, accessible interface: laptop-friendly contestant screens, phone-friendly volunteer screens, and desktop-friendly jury screens.

**Interactive journey**

- Submit an issue with a configurable seeded category, description, and roster-derived location.
- Start its timer on submission. Claiming records the first assignment time.
- Escalate to a specialist role while retaining the original owner until the specialist accepts.
- Support contestant-visible replies and separate internal notes.
- Resolve with a summary and stop the timer. Display total elapsed time and time to first assignment.
- Record a discretionary award in whole minutes, with a public explanation and a reference to the resolved issue.
- Separately mark the award as applied externally. Show the distinction to the contestant.
- Keep a local activity history identifying the simulated actor for each action.

**Demo boundaries**

- Persist state in versioned browser storage, including timestamps, so refreshes preserve progress and timers.
- Provide a reset control that restores fictional seed data.
- Switching personas changes the view of the same local dataset. It is a simulation, not authentication or a security boundary.
- Exclude real accounts, uploads, push notifications, cloud synchronization, CSV imports, shared-incident actions, and administration interfaces from this first ticket.
- Do not claim that the demo validates production security, offline operation, or capacity.

## 3. Documentation and development workflow

Create a compact documentation package alongside the demo:

| File | Purpose |
|---|---|
| `README.md` | Project introduction, demo setup and commands, limitations, and documentation links. |
| `AGENTS.md` | Working rules, ticket workflow, verification expectations, documentation upkeep, and required run report. |
| `docs/product-direction.md` | Decisions from this discussion, clearly separated into agreed direction, provisional choices, and deferred questions. |
| `docs/tickets.md` | One actionable demo ticket and a small uncommitted follow-up queue. |
| `docs/current-state.md` | Existing capabilities, completed checks, and current limitations. |
| `docs/manual-verification.md` | Repeatable walkthrough of the complete demo journey. |

Preserve these longer-term decisions in the product-direction document:

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues, and awards.
- Organizers provision username/password accounts (updated 2026-10-02). Group contestants share a team account. Staff have individual accounts.
- Configurable roles combine fixed capabilities. Issue categories are configurable.
- Contestants and staff can submit reports. Staff manually open and close contestant intake.
- Ownership persists during escalation until handoff. Timers run continuously. Recurrences create linked new reports, and duplicates link to a canonical report.
- The agreed direction includes public replies, private notes, photos, session announcements, in-app alerts, and opt-in browser push.
- Shared incidents support explicit affected rosters, selective closure of linked reports, and bulk awards with recipient exceptions.
- Awards use a separate ledger, with one authorized decision and separate confirmation of external application. Contestants see decisions and application status.
- The agreed direction includes CSV roster imports and editing forms. Reporting uses dashboards only. Archived events permit reading only. The application does not automatically purge archived events.
- Cloudflare and Supabase remain the intended stack, beginning with free-tier experiments. Production targets on a healthy connection are:
  - 800 simultaneous users.
  - 95% of ordinary actions within two seconds.
  - Live updates within three seconds.
- **Updated decision (2026-10-02): cloud first, features first.** Assume connectivity during development. Outage handling and resilience are deferred and do not block the connected backend; no offline or venue-local design has been selected.

**Ticket workflow**

Start with `T0001 — Local workflow demo and project guidance`, on `feature/t0001-local-demo`.

Implement → verify → update documentation → prepare a pull request → **you review and merge**. Only then start the next ticket from updated `main`. Testing and merging are steps, not separate branches.

Future work stays as short candidate items until your demo feedback determines the next ticket. Do not generate a large implementation backlog now.

**Decision after demo review (2026-10-02):** The user accepted the local proof of concept and selected T0002 planning on the existing `feature/t0001-local-demo` branch, without waiting for T0001 to merge. T0002 will support people with multiple staff roles, allow any support staff member to begin triage, and let contestants and helpers reopen resolved issues. UI redesign, including possible Figma references, is deferred. See [T0002 in the development tickets](docs/tickets.md#t0002--multiple-staff-roles-triage-and-reopening) for the scope and recorded defaults. This exception supersedes the next-ticket branch and merge prerequisite above for T0002 only. T0002 is now implemented; current verification is recorded in [docs/current-state.md](docs/current-state.md).

**Cloud direction after merge (2026-10-02):** PR #1 merged T0001 and T0002. The user requested T0003 scoping on updated `main`: guided Cloudflare Workers/Supabase onboarding, real accounts, shared workflows and contributor setup. Prefer free tiers, with necessary paid services acceptable after identifying the need and cost. The recommended split puts authentication, role dashboards and minimal account administration in T0003, with broader organizer tools and configurable issue attachments as the next candidate. Helpers must eventually be able to attach images to issues; upload-permission toggles are required future direction, while attachment visibility remains undecided. See [T0003](docs/tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product). This decision supersedes the former requirement to settle outage handling before backend scoping.

## 4. Verification and acceptance

Use npm with a committed lockfile. Provide scripts for development, build, type checking, linting, and focused automated tests.

Verify:

- The complete journey works across all four personas.
- Escalation preserves ownership until acceptance.
- Refreshing preserves state. Timers remain correct and stop on resolution.
- Contestant views omit staff-only notes.
- An award stays pending until explicitly marked applied.
- Repeated clicks do not create duplicate awards or repeat completed transitions.
- Reset restores the seed scenario.
- Volunteer screens work at phone width. Controls support keyboard navigation.

Use focused tests for lifecycle transitions, timing, persistence, and award state, plus one browser test of the complete journey. Build, lint, type checking, and tests must pass before we present the pull request.

The manual guide will cover the same journey and identify anything automated checks cannot establish. The plan defers production load testing. The local demo is not evidence for the 800-user target.

## 5. Required reporting and this planning run

`AGENTS.md` will require every run to report all eight fields below, using “None” or “Not run” where appropriate and distinguishing observed results from planned work.

| Required field | This planning run |
|---|---|
| **Summary of changes** | Read the repository, gathered requirements, compared architectures, and narrowed the immediate scope to a local demo. |
| **Files changed** | None. This run remained in Plan mode. |
| **Commands run** | Repository inspection using `pwd`, `rg --files`, `cat README.md`, `ls -la`, `git status`, `git log`, and `git remote`. Checked ancestor guidance and tool availability. Consulted official platform documentation. |
| **Build/test results** | Not run. The repository currently contains only the README. |
| **Manual verification steps** | No application exists to exercise yet. The sections above specify the proposed walkthrough. |
| **Risks** | Simulated permissions and local state do not establish production correctness. Outage requirements remain unresolved. |
| **Follow-up tickets** | First implement T0001. Then use your feedback to select a refinement or free-tier integration experiment. |
| **Docs that need updating** | Update the README and create the documentation package listed above during T0001. |

**Authentication revision (2026-10-02):** The user selected organizer-created usernames/passwords for T0003. Team contestants share a team account; staff keep individual accounts. Organizers distribute temporary credentials securely and verify identity before password resets. Users must change temporary passwords before contest access. This replaces email invitations and email recovery in T0003; SMTP and personal email addresses are not prerequisites. Supabase still manages passwords and sessions. Existing development email logins remain valid until a username is assigned.
