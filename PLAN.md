# Minsky planning record

This file records the current agreed scope, newest first.
Earlier requests, approvals, branch exceptions, and the original demo plan are in the [planning log](docs/history/plan-log.md).

**Webmaster, event, and contest platform, 2026-10-27.** The owner settled GitHub issues #119 and #136 and answered the open questions of the design that followed.
The [event platform design](docs/event-platform-design.md) explains the proposed implementation. It is proposed and not implemented.

1. Minsky stays a contest support desk. It gets no problems, submissions, judging, or scoreboard.
2. One shared installation, with one Worker and one D1 database, hosts the events of many organizers for free. Self-hosters run the same code. The owner will revisit the system design for scale later.
3. Webmasters have full authority over the site. They create events, create and reset any account, delete events permanently, and add or remove webmasters. The last webmaster cannot be removed.
   By default, webmasters see all contest data. A site setting can switch on a restriction. With it on, a webmaster sees a contest's data only after joining that contest, and the join is audited. A join stays when the setting is switched off and on again. Webmasters do not appear in contest member lists.
4. An event, such as "XXXX Olympiad 2026", has one time zone, can span several days, and has its own event admins. A webmaster appoints the first event admin. Event admins can add more.
   Every account that is not a webmaster belongs to one event. A username is unique only inside its event. Sign-in names the event. The sign-in screen does not show the event name.
5. A contest is today's `sessions` row. An event has many contests. Each contest has a scheduled start and end, runs continuously with no pause, and can overlap other contests of its event.
   Each contest has its own type: singles only, mixed, or teams only. The practice and live kinds stay. Existing development contests become practice contests.
6. Event admins and optional contest admins both stay, with no setting. Only event admins and webmasters create accounts and assign people, entrants and staff, to contests.
   A contest admin manages only their own contest. That covers settings, categories, announcements, the intake override, the issue workflow, and password reissue and handle changes for accounts that belong only to that contest. A contest admin does not add or remove staff. An event that wants no contest admins assigns none.
   Staff switch between contests one at a time. The roles stay administrator, jury, volunteer, and specialist.
7. A team keeps one shared sign-in. A single contestant has a personal sign-in. A person who competes alone in one contest and in a team in another uses two sign-ins. Organizers create every account. There is no self sign-up, payment, or plan.
8. The 2026-10-25 live password rule stays, and it covers single contestants too. A live contest gets fresh passwords, and its intake stays closed until every contestant has one. The manual override cannot open it earlier.
9. Intake opens at the scheduled start and closes at the scheduled end plus a grace period, with a manual override. A contestant's personal end time is the scheduled end plus the award minutes that staff confirmed as applied. That contestant can report until the personal end time plus the grace period.
   A contest-wide time award gives minutes to every contestant of one contest, with no exceptions.
10. A calendar shows each member the contests of their own events. Webmasters see every event. There is no public listing yet.
11. Announcements, categories, and image limits stay per contest. The product names become Webmaster, Event, and Contest. They replace Organization and Competition from the 2026-10-25 design.
12. A webmaster deletes an event permanently after a typed confirmation that names what is lost. The deletion does not wait for the export in issue #116. It shows "done" after 65 minutes.
13. The development accounts `organizer` and `playtest-admin` become webmasters. A migration promotes them by name. On a database without them, it promotes nobody.

This decision supersedes these earlier statements:

- In the 2026-10-25 [multi-competition design](docs/history/multi-competition-design.md): one installation per organization, usernames unique across the installation, rosters copied between contests, Decision 4's audited join as the default for organization admins, and "Minsky deletes no contest data".
- In [product direction](docs/product-direction.md): one contest type per event, and intake that staff open and close by hand.

**Cloudflare only, agent tokens, and production, 2026-10-25.** The owner made three decisions.

1. Remove the Supabase implementation completely. Cloudflare is the only backend.
   Keep the shared backend contracts, so that a later provider can implement them. Do not build, run, or test another provider adapter until the owner states that the codebase is complete.
   First, the mocked browser suite moves from the Supabase provider to the Cloudflare provider, so that browser coverage stays. Then a separate pull request deletes `supabase/`, `src/backend/supabase/`, `src/server/adapters/supabase/`, the Supabase scripts, tests, and dependencies, and the Supabase guides. Dated records in `docs/history/` stay.
   This supersedes the 2026-10-23 and 2026-10-24 statements below that the Supabase adapter stays as a second implementation.
   The hosted Supabase projects and the `SUPABASE_*` repository secrets stay until the owner deletes them.
2. Agents can create and delete scoped Cloudflare API tokens with `npm run token:create`, `token:list`, and `token:delete`. The owner asked to keep new tokens few.
   The owner creates one account-owned key with only the Account API Tokens Edit permission and stores it as `CLOUDFLARE_TOKEN_ADMIN` in `.env.local`.
   The key stays out of `CLOUDFLARE_API_TOKEN`, so ordinary Wrangler commands never run with it. [AGENTS.md](AGENTS.md#api-tokens-for-agents) states the rules.
3. Prepare a complete Cloudflare installation for production. Agents can create the production resources, named `minsky-prod*`.
   Each production deployment and each production D1 migration needs the owner's explicit approval for that release.
   A production readiness checklist defines the remaining work. The 800-user capacity target needs a separate load test.

**Shared branch preview, 2026-10-24.** The owner chose one shared preview for branches (PR #73).
The `minsky-preview` Worker binds only D1 database `minsky-preview` and private bucket `minsky-preview-images`. They hold only test data.
Its Workers Builds trigger publishes every branch except `main` and `dependabot/*` with `npm run deploy`. Its build command only installs dependencies without the token, so the preview does not wait for checks. `minsky-ci` still reports them.
The build that finishes last replaces the preview. A build that another build replaced during verification passes.
The preview accepts migrations that other branches applied. It still requires every migration in the checkout.
Branch code can change the deploy checks, so only the token protects development data. The preview token must reach only the preview Worker, database, and bucket. If Cloudflare cannot limit it that way, the owner disconnects the trigger and decides on a separate account.
The owner connected the trigger on 2026-10-24 and applies changes to its settings, such as the build command and the branch exclusion. `minsky-dev` publication from `main` does not change.
The same day, the owner switched off branch builds on `minsky-preview`. The trigger offers only tokens that Workers Builds creates. They reach every Worker and R2 bucket, and D1 Edit could not be limited to one database.
Branch previews stay off until the trigger can use a token limited to the preview resources, or until the owner moves the preview to a separate Cloudflare account. The preview code and docs stay in the repository for that case.

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
