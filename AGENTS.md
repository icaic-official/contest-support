# Working on Minsky

## Read first

- Read [PLAN.md](PLAN.md) before you start work.
- Read [README.md](README.md) before you start work.
- Follow the user's latest explicit instructions. If README.md and PLAN.md differ, PLAN.md records the newer agreed scope.
- Inspect the working tree and existing implementation before you change files.
- Preserve unrelated user changes.
- If a pull request or GitHub issue describes the work, read it.
- Read relevant documents under `docs/` when they exist.
- Do not assume that planned files or features exist.
- Check the repository to establish current state.

## Technical communication

- Apply the user's `unslop` and `technical-writing` principles through [the writing guide](docs/writing-guide.md).
- Give each public documentation page one purpose: tutorial, how-to, reference, or explanation.
- Use ASD-STE100 Simplified Technical English for technical explanations in replies, documentation, and pull requests.
- Use short sentences, active voice, and familiar words. Avoid unnecessary jargon.
- When a technical term is necessary, explain it in plain language on first use. Keep code names and commands exact.

## Contributions

- Contribution types include, but are not limited to: `bugfix`, `build`, `feature`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, `docs`.
- Name every branch `<type>/<title>`, whether or not it gets a PR. For example: `bugfix/race-request-fix` or `feature/session-announcements`.
- Write each commit message in this form. Merge commits are exempt.
  ```
  [Type]: <description>

  [optional body]

  [optional footer(s)]
  ```
  - The first letter of the type is to be capitalized.

- Write pull requests with [the PR template](.github/pull_request_template.md). It defines the PR title and description format.

## Current scope

On 2026-10-23 the owner selected Cloudflare as the live backend.
The development Worker is `minsky-dev`. The development D1 database is `minsky-development`.
On 2026-10-25 the owner decided to remove the Supabase implementation. Cloudflare is the only backend.
Build and test new features for Cloudflare only. Do not extend, run, or test the Supabase adapter. Do not add Supabase code to new features.
Keep the shared backend contracts in `src/backend/contracts.ts`, so that a later provider can implement them.
Do not add or test another provider adapter until the owner states that the codebase is complete.

Do not change hosted Cloudflare resources, secrets, or repository settings, except as the rules below allow.

- **Preview resources.** On 2026-10-24 the owner allowed agents to create and manage Cloudflare resources for branch previews.
  This includes their D1 migrations, test data, test accounts, and preview secrets.
  Give each preview resource a name that starts with `minsky-preview`.
- **Production resources.** On 2026-10-25 the owner allowed agents to create the production resources: the Worker, its D1 database, its R2 bucket, and their secrets.
  Give each production resource a name that starts with `minsky-prod`.
  Each production deployment and each production D1 migration needs the owner's explicit approval for that release. Ask before each one.
- **API tokens.** On 2026-10-25 the owner allowed agents to create and delete scoped Cloudflare API tokens. Follow [API tokens for agents](#api-tokens-for-agents).

These rules do not cover development or CI resources, the `minsky-dev` trigger, account members, billing, or account and repository settings.

Start new work from updated `main`. Open the result as a draft pull request into `main`.
Preserve the Workers Builds move and the removed GitHub Actions workflow.
Do not add an Actions job.
Browser suites and hosted provider checks stay manual commands.
`npm run ci` runs no hosted provider suite.
On 2026-10-24 the owner chose automatic publication of `main` to `minsky-dev` through one Workers Builds trigger. That trigger runs `npm run ci` and then `npm run deploy`. Builds for other branches stay disabled on `minsky-dev`. Do not change the trigger or its token yourself.
`minsky-docs` publishes through Workers Builds. A push to `main` publishes the docs. A push to another branch uploads a preview version that does not receive traffic.
Do not deploy, except to preview resources. Production deployments need the owner's approval, as stated above.
The owner reviews and merges.

The retired Supabase projects `Minsky` and `Minsky CI` and the `SUPABASE_*` repository secrets still exist until the owner deletes them. Do not use or change them. Development, CI, and installation-verification resources remain separate.
Earlier approvals in Git history do not authorize a new activation or deployment.

## API tokens for agents

An API token is a secret key that lets a program call the Cloudflare API with a fixed set of permissions.
On 2026-10-25 the owner allowed agents to create the tokens that their work needs. The owner also asked to keep the number of new tokens small.
A token that can create tokens can grant itself any permission. So these rules are the limit. Follow each one.

- Create a token only when no existing credential can do the task. Before you create one, run `npm run token:list` and reuse an agent token that already has the scope you need.
- Create one token for each purpose, not one for each command. Keep it until its task ends.
- Create tokens only with `npm run token:create`. The script enforces the rules below. It writes the token value to a new file that only you can read, and never prints it.
- The script reads the token-creation key from `CLOUDFLARE_TOKEN_ADMIN` in `.env.local`. Never copy that key into another variable, file, command, or log.
- Wrangler reads `CLOUDFLARE_API_TOKEN`. Never put the token-creation key there.
- Grant only the permissions that the task needs. Limit each policy to the Minsky account, one zone, or one R2 bucket. Use the narrowest of these that Cloudflare supports for the permission. Never grant a permission on all accounts or all zones.
- D1 permissions cover every database in the account. Grant D1 write only when the task must write through the API, and delete that token when the task ends.
- Grant only Workers, D1, R2, analytics, zone, and DNS permissions. The script refuses every other permission, including API tokens, account members, billing, account settings, Access, Zero Trust, Workers Admin, and Workers CI Write.
- Name each token `minsky-agent-<purpose>-<YYYYMMDD>`.
- Set an expiry. The default is 30 days. The maximum is 90 days.
- Use the narrowest storage that works: the process environment of one command, a Cloudflare secret, or a Workers Builds variable. Never commit a token or print it in a log, a pull request, or a reply.
- Delete a token when its task ends, with `npm run token:delete -- <id>`. The script deletes only tokens that an agent created.
- Do not create a token for the `minsky-dev` Workers Builds trigger. The owner manages that trigger and its token.
- `npm run token:list` is the record of agent tokens. It shows each token's name, ID, status, expiry, permissions, and resources. Name the token in the pull request or report that uses it.

## Code and documentation cleanup
- Subtract before adding. Remove code that the current architecture no longer needs.
- Use the current shared contracts and application paths. Remove obsolete proof modes, duplicate helpers, and unused stubs.
- Keep one authoritative procedure or reference for each task. Update incoming links when you remove a duplicate page.
- Keep decisions that are still in force in `PLAN.md`. Record the evidence for a change in its pull request. Git history holds older records. Do not present old probes as current instructions.
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
- Do not expose a shared-data reset or persona impersonation control in the connected product. The deletion of one named event through its journal is not a shared-data reset.

## Git workflow

- Set the author of every new commit to `CJX <72659439+GiftedNovaHD@users.noreply.github.com>`.
  Before the first commit, run `git config author.name CJX` and `git config author.email 72659439+GiftedNovaHD@users.noreply.github.com`.
  Do not change `user.name`, `user.email`, or the committer. The committer identity and its signing key keep the commit verified on GitHub.
- Include `Co-authored-by: PuR3Luck <aidan.ong822@gmail.com>` and `Co-authored-by: notbowen <contact@hubowen.dev>` in every new commit you create and push for this repository.
- Separate the co-author trailer from the commit body with a blank line.
- Preserve the primary author and any other co-author trailers.
- Before each push, check that every new commit you created has the required author and contains each required trailer exactly once.
- Distinguish development work from contestant issues in code, documentation, and communication.
- Start each change from updated `main`.
- Name branches as the [Contributions](#contributions) section states. If a GitHub issue describes the change, reference it in the PR description.

Each pull request records the scope, decisions, and verification of its change.

Complete these steps in sequence:

1. Implement the change.
2. Verify the implementation.
3. Update relevant documentation.
4. Prepare a pull request for the user's review.

The user reviews and merges.
Do not merge the current PR unless the user explicitly changes this workflow.
Unless the user explicitly changes this workflow, wait for their merge before you start the next change.
Testing and merging are workflow steps.
Do not create long-lived `test` or `merge` branches for them.

Keep future work in a short candidate queue until feedback determines the next change.
Do not create a large speculative backlog.
Routine implementation and verification within the current change do not require repeated confirmation.
Ask only for missing decisions that materially affect scope or behavior.

## Cloud development and deployment workflow

Keep development, CI, and future production databases and credentials separate.
The hosted `minsky-dev` app uses the complete Cloudflare development installation. It is not production.
The Cloudflare development resources are `minsky-development` and private bucket `minsky-development-images`.
The Cloudflare preview resources are D1 database `minsky-preview` and private bucket `minsky-preview-images`. They hold only test data.
Never point a preview at development, CI, or production resources.
On-demand hosted Cloudflare checks use the separate connector and store CI targets.
The project operates no Supabase project.
Production resources do not exist yet. Their names start with `minsky-prod`.

For each change, use this sequence:

1. Create the branch from updated `main`.
2. Develop against the Cloudflare development installation. Its Worker is `minsky-dev` and its D1 database is `minsky-development`.
3. Add repository-owned D1 migrations for the schema you change.
4. Run fast checks.
5. Prepare the PR.
6. Run cloud integration checks on the reviewed revision.
7. Let the user review and merge.
8. Workers Builds runs ordinary checks. After the merge, the `minsky-dev` trigger checks `main` again, applies new D1 migrations, and publishes the complete Worker.
   Write D1 migrations that only add tables, columns, or indexes. `npm test` and the deploy reject a migration that drops or renames schema. Coordinate bootstrap, secrets, and activation separately.

Automatic GitHub Actions publication is removed. Workers Builds publishes `minsky-dev` from `main`.
Report a manual publication separately from merge. Record its exact source revision.
Prepare compatible backend changes before a dependent frontend merges, or pause frontend deployment for that release.
Hosted Cloudflare checks are on-demand commands against isolated targets.
Ordinary Workers Builds checks run without cloud credentials.
Record each hosted check in the pull request with its revision and target.

CI fixtures create temporary accounts and records scoped by UUID.
They delete only their own data.
Never point CI at development or production.
Never copy real accounts into CI.
Never reset a shared project.
Confirm the target before you apply migrations or deploy functions.

For each production release, validate the approved revision on development and CI.
Ask the owner to approve the release.
Then apply its D1 migrations to production.
Deploy the complete Worker, its bindings, and its static assets.
Verify the production deployment afterward.

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
Update affected guides with behavior changes.
Do not call an installation path supported until its documented procedure passes on an isolated installation.

Update relevant documents in the same change as behavior or workflow changes.
Distinguish proposed, implemented, and verified capabilities.
Record decisions explicitly in the appropriate document.
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
Contest admins set the file size, image count, and combined size limits. There is no upload-disable control.
Contestants can view only team-visible images on their own team's issues.

Cloudflare is the only provider implementation. Test D1 rules and transactions with local D1 emulation.
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
7. **Follow-up work** — Reference existing GitHub issues or concise candidate work. Do not imply that an uncreated issue exists.
8. **Docs that need updating** — List outstanding documentation work. Use **None** if relevant documents are current.
