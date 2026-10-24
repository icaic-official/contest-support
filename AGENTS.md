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

## Contributions

- Contribution types include, but are not limited to: `bugfix`, `build`, `feature`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`.
- Name every branch `<type>/<title>`, whether or not it gets a PR. For example: `bugfix/race-request-fix` or `feature/session-announcements`.
- Write each commit message in this form. Merge commits are exempt.

  ```
  <type>[optional scope]: <description>

  [optional body]

  [optional footer(s)]
  ```

- Write pull requests with [the PR template](.github/pull_request_template.md). It defines the PR title and description format.

## Current scope

On 2026-10-23 the owner selected Cloudflare as the live backend.
The development Worker is `minsky-dev`. The development D1 database is `minsky-development`.
Supabase remains a supported second provider behind the shared backend interfaces.
Keep its adapter, migrations, functions, and provider tests.
Do not describe it as the live backend, the default setup, or the development URL's backend.
Do not change hosted Supabase or Cloudflare resources, secrets, or repository settings.

Start new work from updated `main`. Open the result as a draft pull request into `main`.
Preserve the Workers Builds move and the removed GitHub Actions workflow.
Do not add an Actions job.
Browser suites and hosted provider checks stay manual commands.
`npm run ci` lists provider scenarios. It does not run the hosted Supabase provider suite.
Do not connect `minsky-dev` to Workers Builds.
`minsky-docs` publishes through Workers Builds. A push to `main` publishes the docs. A push to another branch uploads a preview version that does not receive traffic.
Do not deploy.
The owner reviews and merges.

T0021's separately approved Cloudflare activation and repeat deployment retain their dated evidence in [run log](docs/history/run-log.md#t0021-approved-activation-2026-10-19).
Supabase resources and accounts remain intact. Development, CI, and installation-verification resources remain separate.
Earlier provider permissions and exact protected branch limits remain in the [planning log](docs/history/plan-log.md) and dated run records.
Those historical approvals do not authorize a new activation or deployment.
Statements in those records that Supabase is the active backend are superseded by the 2026-10-23 decision.

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

- Set the author of every new commit to `CJX <72659439+GiftedNovaHD@users.noreply.github.com>`.
  Before the first commit, run `git config author.name CJX` and `git config author.email 72659439+GiftedNovaHD@users.noreply.github.com`.
  Do not change `user.name`, `user.email`, or the committer. The committer identity and its signing key keep the commit verified on GitHub.
- Include `Co-authored-by: PuR3Luck <aidan.ong822@gmail.com>` and `Co-authored-by: notbowen <contact@hubowen.dev>` in every new commit you create and push for this repository.
- Separate the co-author trailer from the commit body with a blank line.
- Preserve the primary author and any other co-author trailers.
- Before each push, check that every new commit you created has the required author and contains each required trailer exactly once.
- Distinguish development tickets from contestant issues in code, documentation, and communication.
- Start each development ticket from updated `main`.
- Name branches as the [Contributions](#contributions) section states. Reference the development ticket, if one exists, in the PR description.

Historical branch exceptions remain in the [planning log](docs/history/plan-log.md). Use the normal ticket workflow unless the user gives a newer instruction.

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
The hosted `minsky-dev` app uses the complete Cloudflare development installation. It is not production.
The Cloudflare development resources are `minsky-development` and private bucket `minsky-development-images`.
On-demand hosted Cloudflare checks use the separate connector and store CI targets.
The retained Supabase `Minsky` development project and `Minsky CI` project remain intact.
Use `Minsky CI` only for isolated Supabase fixtures.
No production project exists.

For each ticket, use this sequence:

1. Create the ticket branch from updated `main`.
2. Develop against the Cloudflare development installation. Its Worker is `minsky-dev` and its D1 database is `minsky-development`.
3. Add repository-owned migrations for the provider you change.
4. Run fast checks.
5. Prepare the PR.
6. Run cloud integration checks on the reviewed revision.
7. Let the user review and merge.
8. Workers Builds runs ordinary checks. It does not publish the application.
   A Cloudflare application deployment includes the complete Worker. Coordinate migrations, bootstrap, secrets, and activation separately.

Automatic GitHub Actions publication is removed.
Report any later publication separately from merge. Record its exact source revision.
Prepare compatible backend changes before a dependent frontend merges, or pause frontend deployment for that release.
Hosted Supabase and Cloudflare checks are on-demand commands against isolated CI targets.
Ordinary Workers Builds checks run without cloud credentials.
Record local cloud runs separately from earlier protected GitHub Actions runs.
Neither replaces the other. GitHub Actions no longer runs those checks.

CI fixtures create temporary accounts and records scoped by UUID.
They delete only their own data.
Never point CI at development or production.
Never copy real accounts into CI.
Never reset a shared project.
Confirm the target before you apply migrations or deploy functions.

After production is selected and provisioned, validate the approved revision on development and CI.
Then apply its D1 migrations to production.
Deploy the complete Worker, its bindings, and its static assets.
Verify the production deployment afterward.
The Supabase provider keeps its own migration, function, and frontend order in the [Supabase provider guide](docs/supabase-provider.md).
Production setup remains future work.

This future production work does not authorize provider resource creation or upgrades now.
Use [the Supabase provider guide](docs/supabase-provider.md) for that provider's project references, commands, and observed setup results.
These operational items stay deferred:

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
- Dependabot may open weekly npm update pull requests. The repository does not use GitHub Actions.
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
Use the original plan in the [planning log](docs/history/plan-log.md) as the initial baseline.
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

Keep both provider implementations available. Use embedded PostgreSQL for fast Supabase policy and transaction checks.
Docker is optional. Privileged credentials stay outside Git and frontend builds.
Cloud CI uses isolated fictional fixtures. Provider access does not grant application membership.
A free-tier pilot does not establish production capacity.
The future healthy-connection targets remain 800 simultaneous users, 95% of ordinary actions within two seconds, and live updates within three seconds.

## Required end-of-run report

At the end of every run, report all eight fields below.
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
