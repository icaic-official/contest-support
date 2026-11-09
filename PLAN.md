# Minsky planning record

This file records the agreed scope that is still in force, newest first.
Superseded decisions are in Git history. Run `git log -p --follow -- PLAN.md` to find them.

**Open-source documentation base, 2026-11-07.** The owner asked to rewrite the documentation base for an open-source release.
Current docs state current facts, with no approval narrative or merge genealogy.
Pull requests and Git history hold dated evidence. `docs/measurements/` keeps the two measurement records that current designs cite.
The [documentation release plan](docs/documentation-release-plan.md) lists the work that remains before a public release, including the owner's decisions.

**Contestants on phones, 2026-11-05.** The owner decided that contestants can use phones.
The contestant app is one responsive app. [Product direction](docs/product-direction.md) states its behavior.

**Webmaster, event, and contest platform, 2026-10-27.** The owner settled GitHub issues #119 and #136 and answered the open questions of the design that followed.
The [event platform design](docs/event-platform-design.md) explains the implementation. All eight phases are merged.

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
8. A live contest gets fresh passwords, and this rule covers single contestants too. Its intake stays closed until every contestant has a fresh password. The manual override cannot open it earlier.
9. Intake opens at the scheduled start and closes at the scheduled end plus a grace period, with a manual override. A contestant's personal end time is the scheduled end plus the award minutes that staff confirmed as applied. That contestant can report until the personal end time plus the grace period.
   A contest-wide time award gives minutes to every contestant of one contest, with no exceptions.
10. A calendar shows each member the contests of their own events. Webmasters see every event. There is no public listing yet.
11. Announcements, categories, and image limits stay per contest. The product names are Webmaster, Event, and Contest.
12. A webmaster deletes an event permanently after a typed confirmation that names what is lost. The deletion does not wait for the export in issue #116. It shows "done" after 65 minutes.
13. The development accounts `organizer` and `playtest-admin` become webmasters. A migration promotes them by name, and only when each is a contest admin with no team seat. On a database without them, it promotes nobody.

**Cloudflare only, agent tokens, and production, 2026-10-25.** The owner made three decisions.

1. Cloudflare is the only backend. The Supabase implementation is removed.
   Keep the shared backend contracts, so that a later provider can implement them. Do not build, run, or test another provider adapter until the owner states that the codebase is complete.
   The hosted Supabase projects and the `SUPABASE_*` repository secrets stay until the owner deletes them.
2. Agents can create and delete scoped Cloudflare API tokens with `npm run token:create`, `token:list`, and `token:delete`. The owner asked to keep new tokens few.
   The owner creates one account-owned key with only the Account API Tokens Edit permission and stores it as `CLOUDFLARE_TOKEN_ADMIN` in `.env.local`.
   The key stays out of `CLOUDFLARE_API_TOKEN`, so ordinary Wrangler commands never run with it. [AGENTS.md](AGENTS.md#api-tokens-for-agents) states the rules.
3. Prepare a complete Cloudflare installation for production. Agents can create the production resources, named `minsky-prod*`.
   Each production deployment and each production D1 migration needs the owner's explicit approval for that release.
   A production readiness checklist defines the remaining work. That checklist is not written yet. The 800-user capacity target needs a separate load test.

**CI and publication, 2026-10-23 and 2026-10-24.** The target CI/CD is Cloudflare Workers Builds. GitHub Actions is not part of the stack. Do not add an Actions job.

- The owner keeps GitHub on the free plan. Every automatic check runs on Workers Builds on the existing Workers Paid plan.
- The CI Worker is `minsky-ci`. Its deploy command is a dry run. It does not publish `minsky-dev` or `minsky-docs`.
- Browser tests and hosted Cloudflare suites stay on-demand commands. The Workers Builds image has no Chromium, and the hosted jobs exceed the 20-minute build limit.
- `main` publishes automatically to `minsky-dev` through one Workers Builds trigger. Its build command is `npm run ci`. Its deploy command is `npm run deploy`. A failed check stops publication. Builds for other branches stay disabled.
- Branch builds on `minsky-preview` stay off until the trigger can use a token limited to the preview resources, or until the owner moves the preview to a separate Cloudflare account. The preview code and docs stay in the repository for that case.
- The owner keeps these open as candidate work: branch protection, Dependabot alerts, automatic browser checks, CI for fork pull requests, and automatic rollback.

[Run checks on Workers Builds](docs/cloudflare-builds.md) owns the triggers, the migration checks, and the publication steps.

**Documentation ownership, 2026-10-24.** `ROADMAP.md` owns the technology stack. `docs/product-direction.md` owns product requirements.
The PR template owns the pull request format. AGENTS.md owns branch and commit names.
Contribution types use the full names in AGENTS.md, such as `[Bugfix]` and `[Feature]` in titles and `bugfix/` and `feature/` in branch names.
