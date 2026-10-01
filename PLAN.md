# Minsky: a local demo first

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
| `docs/demo-spec.md` | The demo’s screens, behavior, scope, and acceptance criteria. |
| `docs/product-direction.md` | Decisions from this discussion, clearly separated into agreed direction, provisional choices, and deferred questions. |
| `docs/tickets.md` | One actionable demo ticket and a small uncommitted follow-up queue. |
| `docs/current-state.md` | Existing capabilities, completed checks, and current limitations. |
| `docs/manual-verification.md` | Repeatable walkthrough of the complete demo journey. |

Preserve these longer-term decisions in the product-direction document:

- Each event has one contest type: individual or group. Sessions have separate rosters, schedules, issues, and awards.
- Organizers provision email/password accounts. Group contestants share a team account. Staff have individual accounts.
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
- **Outage handling remains unresolved.** Remind you before we scope the connected-backend ticket. Revisit the architecture if you require venue-local operation.

**Ticket workflow**

Start with `T0001 — Local workflow demo and project guidance`, on `feature/t0001-local-demo`.

Implement → verify → update documentation → prepare a pull request → **you review and merge**. Only then start the next ticket from updated `main`. Testing and merging are steps, not separate branches.

Future work stays as short candidate items until your demo feedback determines the next ticket. Do not generate a large implementation backlog now.

**Decision after demo review (2026-10-02):** The user accepted the local proof of concept and selected T0002 planning on the existing `feature/t0001-local-demo` branch, without waiting for T0001 to merge. T0002 will support people with multiple staff roles, allow any support staff member to begin triage, and let contestants and helpers reopen resolved issues. UI redesign, including possible Figma references, is deferred. See [T0002 in the development tickets](docs/tickets.md#t0002--multiple-staff-roles-triage-and-reopening) for the scope and recorded defaults. This exception supersedes the next-ticket branch and merge prerequisite above for T0002 only. T0002 is now implemented; current verification is recorded in [docs/current-state.md](docs/current-state.md).

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
