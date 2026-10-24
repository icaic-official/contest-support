# Minsky planning record

This file records the current agreed scope, newest first.
Earlier requests, approvals, branch exceptions, and the original demo plan are in the [planning log](docs/history/plan-log.md).

**CI audit follow-up, 2026-10-24.** After a CI audit, the owner asked to add two safeguards to PR #67, because `main` now publishes automatically.
`npm test` and the deploy reject a D1 migration that drops or renames schema, unless `reviewedDestructiveMigrations` records a reviewed exception. Data changes are not checked.
Before it applies migrations, the deploy prints the D1 Time Travel bookmark and the restore command. If it cannot read the bookmark, no migration starts.
The other audit findings stay with the owner or as candidate work: branch protection, Dependabot alerts, automatic browser checks, CI for fork PRs, and automatic rollback.

**Retire the hosted Supabase setup, 2026-10-24.** The owner decided that the project no longer operates Supabase projects.
The Supabase adapter stays as a working second implementation. Anyone can run it on their own Supabase project.
Keep `supabase/`, `src/backend/supabase/`, `src/server/adapters/supabase/`, the embedded-PostgreSQL tests, the Deno function checks, `VITE_BACKEND=supabase`, the shared provider driver, and the mocked browser suite. Every local Supabase adapter test must keep passing.
Remove `npm run test:hosted`, `scripts/cloud-smoke.mjs`, `cloud:link`, `cloud:functions`, and the Supabase upload path in `scripts/deploy-workers.mjs`. `minsky-dev` publishes only the complete Cloudflare Worker. The deploy script ignores `MINSKY_DEV_BACKEND`.
The hosted Supabase runners accept any explicit isolated project in `MINSKY_TEST_PROJECT_REF`. They keep refusing the former development project while it exists.
`docs/supabase-provider.md` becomes "Run the Supabase adapter". The workflow verification guide merges into `docs/run-provider-tests.md`.
The owner asked for this change on the existing publication PR #66, on a branch named by the Contributions rules.
Leave the Supabase projects `Minsky` (`ovymmobupzowotvrywek`) and `Minsky CI` (`ghtztmovdkhuketcbjmq`), the `SUPABASE_*` GitHub secrets, and the repository settings unchanged. The owner removes them separately.
Do not deploy. Do not change Cloudflare resources. Moving the mocked browser suite to Cloudflare mocks is separate follow-up work.
This decision supersedes the 2026-10-23 statement below that Supabase is a supported provider with retained projects.

**Automatic application publication, 2026-10-24.** The owner chose automatic publication of `main` to `minsky-dev`.
Before this decision, `minsky-dev` served `a25f9f1`, 108 commits behind `main`, and lacked D1 migration `0010_announcements.sql`.
The `minsky-dev` Worker gets one Workers Builds trigger for `main`. Builds for other branches stay disabled.
Its build command is `npm run ci`. Its deploy command is `npm run deploy`. A failed check stops publication.
The deploy script reads `WORKERS_CI_BRANCH` and `WORKERS_CI_COMMIT_SHA`. It checks the branch head with `git ls-remote` and needs no GitHub token.
After its read-only target checks, the script applies new D1 migrations to `minsky-development`. Migrations must stay additive so that a Worker rollback remains possible.
The trigger needs a user API token with D1 access. The automatic build token has none. The owner creates the token and connects the trigger. This change does not.
`minsky-dev` remains a development installation. A separate production Worker is deferred at the owner's request.

**Documentation consolidation, 2026-10-24.** The owner approved a second documentation review in PR #65.
Move dated records to `docs/history/`. Rename `docs/current-state.md` to `docs/history/run-log.md` and `docs/cloud-onboarding.md` to `docs/supabase-provider.md`.
Merge the preview rationale into the Workers Builds guide. Move planning entries before 2026-10-23 to the planning log.
`ROADMAP.md` owns the technology stack. `docs/product-direction.md` owns product requirements.
The PR template owns the pull request format. AGENTS.md owns branch and commit names.
Contribution types use the full names in AGENTS.md, such as `[Bugfix]` and `[Feature]` in titles and `bugfix/` and `feature/` in branch names.
The target CI/CD is Cloudflare Workers Builds. GitHub Actions is not part of the target stack.

**Stale documentation cleanup, 2026-10-24.** The owner asked to identify and correct stale documentation on `main`.
Correct present-tense instructions that still describe the removed GitHub Actions workflow, merged PRs as open, or the five-group `Backend`.
Add the merged session announcements to the public guides and status page.
Keep dated records as history. Change no code, hosted resource, secret, or repository setting.
Name the branch and PR as the AGENTS.md Contributions section states. The owner reviews and merges.

**Cloudflare is the live backend, 2026-10-23.** The owner selected Cloudflare as the live backend.
The development Worker is `minsky-dev`. The development D1 database is `minsky-development`.
Keep the Supabase adapter, its migrations, its functions, and its provider tests.
Supabase is a supported second provider behind the shared backend interfaces. The 2026-10-24 retirement entry above narrows this to the adapter code.
It shows that another provider can implement the same behavior. AWS, GCP, Azure, and a possible Docker adapter remain later work.
Absent `VITE_BACKEND` and absent `MINSKY_DEV_BACKEND` select Cloudflare.
Set either value to `supabase` to select the Supabase provider.
Hosted Supabase provider tests stay manual commands. They are not part of `npm run ci`.
Do not add GitHub Actions. Do not change hosted resources, secrets, or repository settings.
This decision supersedes earlier statements in the [planning log](docs/history/plan-log.md) that Supabase remains the active backend.
The owner reviews and merges.

**Workers Builds CI, 2026-10-23.** The owner keeps GitHub on the free plan.
The Actions minute cap stopped hosted checks. It is not a failed payment.
Move every automatic check to Workers Builds on the existing Workers Paid plan.
Remove the GitHub Actions workflow so pushes do not start jobs.
Do not add a GitHub Actions fallback.
Browser tests and hosted Supabase or Cloudflare suites stay on-demand commands.
The Workers Builds image does not provide Chromium, and the hosted jobs exceed the 20 minute build limit.
The CI Worker is `minsky-ci`. Its deploy command is a dry run. It does not publish `minsky-dev` or `minsky-docs`.
The owner connects the repository. This change does not deploy or edit secrets.

**Docs publication, 2026-10-24.** The owner asked for the documentation site to publish through Workers Builds, with previews, in PR #48.
The removal of the GitHub Actions publisher had stopped all docs publication. The last docs deployment before this change was on 2026-10-21.
The `minsky-docs` Worker has two Workers Builds triggers. A push to `main` runs `wrangler deploy`. A push to any other branch runs `wrangler versions upload`, which creates a preview version without traffic.
The docs build does not wait for `minsky-ci`. The docs are static and contain no application data.
`minsky-dev` stays disconnected from Workers Builds. The automatic application publication decision above supersedes this sentence.
