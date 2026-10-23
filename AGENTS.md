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

Implement **T0022 reduce duplicate CI checks** on `feature/t0022-ci-run-deduplication` from updated `main` at `4e43739`.
The owner merged T0021 in PR #43, then requested this bounded CI change.
See [the ticket](docs/tickets.md#t0022-reduce-duplicate-ci-checks) and the latest decision in [PLAN.md](PLAN.md).
Preserve branch-push deployment prerequisites, fork PR checks, scheduled security jobs, and manual protected suites.
Skipped same-repository PR jobs must not satisfy the names of required checks.
Correct the observed docs-preview JSON parsing failure. Preserve URL restrictions, revision checks, and provider targets.
Do not migrate CI providers, change provider settings, add paid services, activate Cloudflare development, or alter cloud-test rules.
Supabase remains active. Backend activation requires the separate [activation procedure](docs/activate-cloudflare-development.md).
Earlier provider permissions and unique verification records remain in PLAN.md and the dated run records.
The owner reviews and merges.

## Code and documentation cleanup

- Subtract before adding. Remove code that the current architecture no longer needs.
- Use the current shared contracts and application paths. Remove obsolete proof modes, duplicate helpers, and unused stubs.
- Keep one authoritative procedure or reference for each task. Update incoming links when you remove a duplicate page.
- Preserve unique decisions and evidence in dated records. Do not present historical probes as current instructions.
- Add an abstraction only when current callers need it.
- Measure reader load by layers to trace and mutable context to remember. Remove pass-through wrappers that hide no meaningful decision.
- Prefer local derived values. Before adding a layer or state, check that it reduces reader load elsewhere.
- State which bounded behavior may temporarily break during a change and how the change remains reversible.
- Run focused checks for touched behavior during implementation. Keep checks that detect material failures.
- At completion, run the full static checks and required runtime suites before calling the PR ready.
- Test changed behavior and material failure cases. Do not add application tests only to test prose.

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
- Start each development ticket from updated `main`.
- Use `feature/tNNNN-description` for ticket branches.

Historical branch exceptions remain in [PLAN.md](PLAN.md). Use the normal ticket workflow unless the user gives a newer instruction.

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
8. After automation setup, let GitHub Actions deploy docs and the selected application when the `main` CI checks pass. A Cloudflare application deployment includes the complete Worker. Coordinate migrations, bootstrap, secrets, and activation separately.

Automatic frontend deployment requires GitHub deployment settings and passing `checks`, `secrets`, and `dependencies` jobs.
Before setup is verified, report deployment separately from merge.
Prepare compatible backend changes before a dependent frontend merges, or pause frontend deployment for that release.
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
- Keep npm scripts for development, production builds, type checking, linting, and focused tests.
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

Update relevant documents in the same change as behavior or workflow changes.
Distinguish proposed, implemented, and verified capabilities.
Use PLAN.md as the initial baseline.
Record later decisions explicitly in the appropriate document.
Do not leave conflicting instructions.

## Product and provider constraints

Use [the product direction](docs/product-direction.md) for agreed requirements and deferred work.
Assume connectivity during development. Offline capture and venue-local resilience remain deferred.
Do not restore the retired local demo runtime, persona controls, or shared-data reset tooling.
Use organizer-created usernames, temporary passwords, and organizer-assisted recovery.
Require temporary-password changes at the database boundary. Personal email and SMTP are not prerequisites.

Staff can attach JPEG, PNG, and WebP images while the event is active.
The uploader chooses team visibility or staff-only visibility. That choice stays fixed.
Only the uploader can remove a ready image during that time.
Session admins set the file size, image count, and combined size limits. There is no upload-disable control.
Contestants can view only team-visible images on their own team's issues.

Keep hosted Supabase active and use embedded PostgreSQL for fast policy and transaction checks.
Docker is optional. Privileged credentials stay outside Git and frontend builds.
Cloud CI uses isolated fictional fixtures. Provider access does not grant application membership.
A free-tier pilot does not establish production capacity.
The future healthy-connection targets remain 800 simultaneous users, 95% of ordinary actions within two seconds, and live updates within three seconds.

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
