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

## Current scope and completed demo baseline

**Latest ticket decision (2026-10-03):** implement T0004's UI makeover from the user's references.
The references show a dark green workspace and a centered sign-in form with an amber button.
Keep actual authenticated data, workflow behavior, and authorization.
Reference values are placeholders.

Start T0004 from updated `main` after T0003 merges.
Use `feature/t0004-ui-makeover`.
Previous T0004 follow-up scope notes move to T0005:

- Provider ownership and billing records.
- GitHub merge enforcement and vulnerability alerts.
- Remaining manual acceptance checks.
- Candidate organizer tools and configurable issue attachments.

T0005 implementation remains pending.
See [docs/tickets.md](docs/tickets.md).

**T0004 deployment exception (2026-10-03):** the user explicitly requested "Deploy first" while PR #9 was open.
Deploy the completed T0004 frontend to the existing development Worker `minsky-dev` before merge.
Verify it there.
This exception applies to T0004's development frontend.
The user still reviews and merges the PR.
See [deployment evidence](docs/current-state.md#t0004-development-deployment-2026-10-03).

**Demo retirement decision (2026-10-02):** remove the old local demo and these related parts:

- Its command.
- Persona, reset, and storage code.
- Tests and fixtures that apply only to the demo.
- The obsolete walkthrough and specification.

Maintain the connected app, public login landing page, and sidebar.
Maintain workflow and authorization tests that use real accounts.
The demo requirements below are historical.
Do not restore the demo runtime or reset tooling.

### Historical demo baseline

T0001 and T0002 were merged in PR #1 on 2026-10-02. T0003 is scoped in `docs/tickets.md` for cloud onboarding and an authenticated shared product. Its implementation must start from updated `main` on `feature/t0003-cloud-product`. The demo requirements below describe the completed baseline; they do not exclude the connected features explicitly selected for T0003. Keep planning separate from implemented capabilities.

The initial objective was an interactive demo that helped the user decide where the application should go. T0001 and T0002 completed that baseline. Keep subsequent tickets small and driven by the user's feedback.

- Use React, TypeScript, Vite, and npm with a committed lockfile.
- Use fictional seeded data, simulated personas, and versioned browser-local persistence. The demo requires no cloud account or paid service.
- Implement the complete journey: contestant submission, volunteer claim, escalation, specialist acceptance and resolution, discretionary award, and confirmation of external application.
- Support team contestant, volunteer, specialist, and jury personas in one fictional group-contest session.
- Make the volunteer experience usable on phones. Make the contestant and jury experiences usable on laptops/desktops. Support keyboard navigation. Label controls clearly.
- Clearly identify the application as a demo. Persona switching and hidden UI controls are not authentication or authorization boundaries.
- Keep real authentication, uploads, push notifications, cloud synchronization, CSV imports, shared-incident actions, and administration interfaces outside the initial demo ticket.
- Preserve broader requirements in documentation. Do not silently implement them as extra demo scope.

Use simple components and domain logic appropriate to the demo. Avoid speculative infrastructure or abstractions for features outside the selected scope.

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
8. Explicitly deploy approved changes afterward.

Do not imply that merge automatically deploys the app.
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
Deploy its account function and configuration.
Deploy its frontend.
Verify the production deployment afterward.
Production setup remains future work.

This future production work does not authorize provider resource creation or upgrades now.
Use [cloud-onboarding.md](docs/cloud-onboarding.md) for project references, commands, environment protection requirements, and observed setup results.
T0003 retains protected cloud CI.
The user's 2026-10-03 decision defers these items to T0005:

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
- For documentation-only changes, check content, paths, and whitespace.
- Do not add application tests only to test prose.
- Never present local demo tests as evidence of production security, offline operation, or capacity for 800 simultaneous users.

## Documentation upkeep

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

Future attachments must link helpers' images to issues.
Record configurable upload permissions as future work.
These must include controls to enable or disable volunteer image submission.
Attachment visibility for contestants and staff remains undecided.
Configuration scope also remains undecided.
Do not silently select either policy.

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
