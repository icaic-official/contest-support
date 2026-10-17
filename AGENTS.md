# Working on Minsky

## Read first

- Read [PLAN.md](PLAN.md) before you start work.
- Read [README.md](README.md) before you start work.
- Follow the user's latest explicit instructions. If README.md and PLAN.md differ, PLAN.md records the newer agreed scope.
- Inspect the working tree and existing implementation before you change files.
- Preserve unrelated user changes.
- Read the active development ticket.
- Read relevant documents under `docs/` when they exist.
- Do not assume that planned files or features exist.
- Treat historical run reports as records of those runs. Check the repository to establish current state.

## Technical communication

- Apply the user's `unslop` and `technical-writing` principles through [the writing guide](docs/writing-guide.md).
- Give each public documentation page one purpose: tutorial, how-to, reference, or explanation.
- Use ASD-STE100 Simplified Technical English for technical explanations in replies, documentation, and pull requests.
- Use short sentences, active voice, and familiar words. Avoid unnecessary jargon.
- When a technical term is necessary, explain it in plain language on first use. Keep code names and commands exact.

## Current scope

**Automatic frontend builds (2026-10-17):** the user authorized branch previews and automatic stable deployments after merges to `main`.
Use the existing `minsky-dev` and `minsky-docs` Workers through their Git connections.
See [setup and verification](docs/cloudflare-builds.md).
Until those connections are enabled and verified, do not claim that merges deploy automatically.
The user still reviews and merges. Backend changes retain explicit deployment and target checks.

**T0011 documentation site (2026-10-17):** the user requested implementation, written guides, and deployment.
Develop on `feature/t0011-documentation-site` from updated `main`, alongside the open T0007 PR.
Publish a separate static `minsky-docs` Worker in the existing Minsky development account.
The user's request authorizes this initial docs deployment before merge.
The user still reviews and merges the source PR.
This exception does not authorize application, database, or function deployment.
Maintain public guides under `site/src/content/docs/` and label T0007's pending and unverified steps.
See [T0011](docs/tickets.md#t0011--documentation-site).

**T0008 team search (2026-10-15):** the user merged [PR #22](https://github.com/notbowen/minsky/pull/22) into `main`.
It was developed separately on `feature/t0008-team-search` while PR #19 remained open.
The T0005 branch now includes it through a merge from `main` to resolve conflicts.
Deployment is a separate explicit step.
See [T0008](docs/tickets.md#t0008--fuzzy-team-search).

**T0004 merge status (2026-10-11):** the user merged [PR #9](https://github.com/notbowen/minsky/pull/9) into `main` and deleted its branch.
The user merged the documentation rewrite in [PR #13](https://github.com/notbowen/minsky/pull/13) on 2026-10-11 (SGT).
See [the merge record](docs/current-state.md#t0004-merge-and-documentation-follow-up-2026-10-11) for the revision and timestamp.

**Latest ticket decision (2026-10-11):** implement T0005 issue images on `feature/t0005-issue-attachments`.
Start from updated `main` after T0004.
Staff can attach JPEG, PNG, and WebP images to an issue.
The uploader chooses team visibility or staff-only visibility at upload.
Session admins set the image size and count limits.
See [docs/tickets.md](docs/tickets.md#t0005--issue-images).

These items stay deferred.
They are not part of T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining manual acceptance checks.
- Event, roster, and category editors.

**T0004 deployment exception (2026-10-03):** the user explicitly requested "Deploy first" while PR #9 was open.
The completed T0004 frontend deployed to the existing development Worker `minsky-dev` before merge.
Hosted verification passed there.
This exception applies to T0004's development frontend.
See [deployment evidence](docs/current-state.md#t0004-development-deployment-2026-10-03).

**Demo retirement decision (2026-10-02):** remove the old local demo and these related parts:

- Its command.
- Persona, reset, and storage code.
- Tests and fixtures that apply only to the demo.
- The obsolete walkthrough and specification.

Maintain the connected app, public login landing page, and sidebar.
Maintain workflow and authorization tests that use real accounts.
Do not restore the demo runtime or reset tooling.

## TypeScript style

- Before you write or change TypeScript or TSX, read the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html).
- Follow the guide unless project requirements justify an exception. Framework requirements, correctness, readability, and maintainability can justify exceptions.
- Briefly explain deliberate exceptions in the PR description or run report.
- Add a code comment when the reason helps future maintainers understand the code.
- Exceptions do not require separate user approval.
- Explicit user instructions and project requirements take precedence over the guide.
- Apply the guide to future work. Do not make unrelated style changes.

## Behavior to preserve

- Start the issue timer on submission.
- Record the first assignment separately.
- Calculate elapsed time from persisted timestamps. Refresh must not reset the timer.
- Retain the current owner during escalation until a specialist accepts the handoff.
- Stop the timer on resolution.
- On reopening, resume accumulated unresolved time. Exclude resolved intervals.
- Retain every resolution summary, actor, and timestamp.
- Identify staff owners and activity actors by person. Combine all capabilities from their assigned roles.
- On reopening, retain the prior owner and any existing award and external application status.
- Separate contestant-visible replies from internal staff notes.
- Omit internal notes from contestant views.
- Record an award separately from confirmation of its external application. Minsky does not change an external contest clock.
- Keep shared activity history that identifies the authenticated actor.
- Prevent repeated actions from creating duplicate awards or invalid transitions.
- Use isolated verification fixtures.
- Delete only records that belong to those fixtures.
- Do not expose a shared-data reset or persona impersonation control in the connected product.

## Ticket and Git workflow

- Include `Co-authored-by: PuR3Luck <aidan.ong822@gmail.com>` in every new commit Codex creates and pushes for this repository.
- Separate the co-author trailer from the commit body with a blank line.
- Preserve the primary author and any other co-author trailers.
- Before each push, check that every new Codex-created commit contains the required trailer exactly once.
- Distinguish development tickets from contestant issues in code, documentation, and communication.
- The first implementation ticket is **T0001 — Local workflow demo and project guidance**. Its branch is `feature/t0001-local-demo`.
- Start each development ticket from updated `main`.
- Use `feature/tNNNN-description` for later ticket branches.

The user approved one branch exception for T0002.
Plan and implement T0002 on `feature/t0001-local-demo` without waiting for the T0001 merge.
The user still reviews and merges.
Use the normal branch workflow for later tickets unless the user instructs otherwise.

Complete these steps in sequence:

1. Implement the active ticket.
2. Verify the implementation.
3. Update relevant documentation.
4. Prepare a pull request for the user's review.

The user reviews and merges.
Do not merge the current ticket unless the user explicitly changes this workflow.
Unless the user explicitly changes this workflow, wait for their merge before you start the next ticket.
Testing and merging are workflow steps.
Do not create long-lived `test` or `merge` branches for them.

Keep future work in a short candidate queue until feedback determines the next ticket.
Do not create a large speculative backlog.
Routine implementation and verification within the active ticket do not require repeated confirmation.
Ask only for missing decisions that materially affect scope or behavior.

## Cloud development and deployment workflow

Keep development, CI, and future production databases and credentials separate.
The hosted `minsky-dev` app uses the `Minsky` development project.
It is not production.
`Minsky CI` is for isolated automated fixtures.
No production project exists.

For each ticket, use this sequence:

1. Create the ticket branch from updated `main`.
2. Develop against the development project.
3. Add repository-owned migrations.
4. Run fast checks.
5. Prepare the PR.
6. Run cloud integration checks on the reviewed revision.
7. Let the user review and merge.
8. After Git build setup, let Cloudflare deploy the static frontends from `main`. Coordinate backend deployment separately.

Automatic frontend deployment requires the configured Git connections and a successful build.
Before setup is verified, report deployment separately from merge.
Prepare compatible backend changes before a dependent frontend merges, or pause automatic app builds for that release.
Privileged GitHub cloud checks use the protected `cloud-test` environment and the separate CI project.
Ordinary PR checks run without cloud credentials.
Record local cloud runs separately from protected GitHub Actions runs.
Neither replaces the other.

CI fixtures create temporary accounts and records scoped by UUID.
They delete only their own data.
Never point CI at development or production.
Never copy real accounts into CI.
Never reset a shared project.
Confirm the target before you apply migrations or deploy functions.

After production is selected and provisioned, validate the approved revision on development and CI.
Then apply its migrations to production.
Deploy its account and attachment functions and configuration.
Deploy its frontend.
Verify the production deployment afterward.
Production setup remains future work.

This future production work does not authorize provider resource creation or upgrades now.
Use [cloud-onboarding.md](docs/cloud-onboarding.md) for project references, commands, environment protection requirements, and observed setup results.
T0003 retains protected cloud CI.
These operational items stay deferred.
They are not part of the T0005 issue-image ticket:

- Ownership and billing records.
- Remote merge enforcement and vulnerability alerts.
- Remaining user and manual acceptance checks.

## Verification

- Inspect available scripts before you invoke them.
- During T0001, provide npm scripts for development, production builds, type checking, linting, and focused tests.
- Document their exact names in README.md.
- Test lifecycle transitions, ownership during handoff, timestamp calculations, persistence, awards, and external application status.
- Include one browser test for the complete journey across authenticated test accounts.
- Manually check volunteer screens at phone widths.
- Manually check keyboard navigation, persistence after refresh, and separation of public replies from internal notes.
- Before you present an implementation PR as ready, build, lint, type checking, and required tests must pass.
- If a check cannot run, report the reason. Leave the result unverified.
- Dependabot may open weekly npm and GitHub Actions update pull requests.
- Review Dependabot updates with the same checks as other changes.
- Do not adopt TypeScript major updates while `.github/dependabot.yml` ignores them. The installed `typescript-eslint` release cannot install TypeScript 7.
- For documentation-only changes, check content, paths, and whitespace.
- Do not add application tests only to test prose.
- Never present local demo tests as evidence of production security, offline operation, or capacity for 800 simultaneous users.

## Documentation upkeep

The user requires documentation suitable for an open-source release.
Follow the [documentation release plan](docs/documentation-release-plan.md).
Write for readers without project conversations or access to the maintainers' provider accounts.
State prerequisites, exact commands, expected results, permissions, and failure recovery where relevant.
Label development, experimental, and unverified behavior explicitly.
Update affected guides with behavior changes. Keep historical run reports separate from current instructions.
Do not call an installation path supported until its documented procedure passes on an isolated installation.

During T0001, create the remaining documentation.
Keep it concise and consistent with implemented behavior.

| Document | Responsibility |
| --- | --- |
| `README.md` | Project introduction, exact setup and check commands, demo limitations, and documentation links. |
| `docs/product-direction.md` | Agreed longer-term requirements, provisional architecture, and unresolved decisions. |
| `docs/tickets.md` | Active development ticket, status, acceptance criteria, and a short follow-up queue. |
| `docs/current-state.md` | Implemented and verified capabilities, limitations, and next work. |
| `docs/manual-verification.md` | Repeatable verification steps, expected results, and required fictional personas and data. |
| `docs/cloud-onboarding.md` | Provider setup, costs, and contributor onboarding for T0003. Distinguish planned steps from verified results. |

Update relevant documents in the same change as behavior or workflow changes.
Distinguish proposed, implemented, and verified capabilities.
Use PLAN.md as the initial baseline.
Record later decisions explicitly in the appropriate document.
Do not leave conflicting instructions.

## Deferred decisions and production direction

**Cloud first, features first (2026-10-02).**
The user deferred outage handling and resilience until after cloud features.
Assume connectivity during the developer phase.
Do not block backend work on manual fallback, offline capture, or venue-local operation.
Ordinary error reporting and correct shared data remain product requirements.

**Authentication revision (2026-10-02).**
Use organizer-created usernames and passwords.
Use temporary credentials and organizer-assisted recovery.
Enforce temporary-password changes at the database boundary.
SMTP and personal email addresses are not prerequisites.
Preserve existing account IDs and history during the transition.

**Cloud contributor access (2026-10-02).**
The user permits full cloud credential access for contributors.
Docker is optional.
Use hosted Supabase for connected development.
Use embedded PostgreSQL for fast policy and transaction checks.
Use isolated cloud fixtures for integration tests.

Use `supabase functions deploy --use-api` for server-side bundling.
Keep privileged credentials outside Git and frontend builds.
Privileged CI uses a protected, separate test project.

Use Cloudflare Workers and Supabase.
Prefer free tiers.
The user accepts necessary costs.
Before a paid upgrade, document the concrete need and cost.
Do not treat free tiers as a hard limit.
Do not enable speculative paid services.

T0005 links staff images to issues.
The uploader chooses team-visible or staff-only visibility, and the choice stays fixed.
Every staff member can upload while the event is active.
Only the uploader can remove an image during that time.
Session admins set the file size, image count, and combined size limits.
Contestants can view team-visible images on their own team's issues.
There is no control that disables uploads.

A free-tier pilot and production capacity validation are separate milestones.
Future targets on a healthy venue connection are:

- 800 simultaneous users.
- 95% of ordinary actions complete within two seconds.
- Live updates arrive within three seconds.

Consult the product direction in PLAN.md when you record future requirements.
These include configurable roles and categories, shared incidents, award ledgers, and browser push.
Do not automatically add these features to T0001.

## Required end-of-run report

At the end of every Codex run, report all eight fields below.
Keep them concise.
Use **None**, **Not run**, or **Not applicable** when appropriate.
Distinguish completed checks from suggested manual steps.

1. **Summary of changes** — State what changed and why.
2. **Files changed** — List paths to created, modified, or deleted files.
3. **Commands run** — List commands actually executed, including relevant failures.
4. **Build/test results** — Record observed results and checks that could not run.
5. **Manual verification steps** — State what you checked manually and what the user should still verify.
6. **Risks** — Record known limitations, unresolved decisions, or regressions. Do not invent risks.
7. **Follow-up tickets** — Reference existing tickets or concise candidate work. Do not imply that an uncreated ticket exists.
8. **Docs that need updating** — List outstanding documentation work. Use **None** if relevant documents are current.
