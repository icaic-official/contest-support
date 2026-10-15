# Minsky planning record

**Latest ticket decision (2026-10-15):** the user authorized implementation of
[T0009 — Jury worklist](docs/jury-worklist.md) independently of T0005, T0006,
T0007, and T0008. The branch is `feature/t0009-jury-worklist`, from updated
`main` at `1ed603a`. It uses existing issue, resolution, and award data.
[Current state](docs/current-state.md#t0009-jury-worklist-2026-10-15) records local
verification and the remaining hosted and manual checks. The user reviews and
merges; deployment remains a separate explicit step.

**Specification decision (2026-10-14):** the user requested T0009's specification.
Its implementation scope is recorded in the document linked above.

**T0004 merge status (2026-10-11):** the user merged [PR #9](https://github.com/notbowen/minsky/pull/9) into `main` and deleted its branch.
[PR #13](https://github.com/notbowen/minsky/pull/13) remains the documentation follow-up and now targets `main`.
See [the merge record](docs/current-state.md#t0004-merge-and-documentation-follow-up-2026-10-11) for the revision and timestamp.

**Earlier ticket decision (2026-10-03):** implement T0004's UI makeover from the user's references.
The references specify these elements:

- Dark green surfaces.
- A compact sidebar.
- Desktop columns for the queue and details.
- Green status and selection accents.
- Amber handoff actions.
- A centered sign-in form with a password visibility control.

Use actual authenticated data.
Reference names, values, and timestamps are placeholders.
Previous T0004 follow-up scope notes move to T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining manual acceptance checks.
- Candidate organizer tools and configurable issue attachments.

T0005 implementation remains pending.
See [development tickets](docs/tickets.md#t0004--ui-makeover).

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
