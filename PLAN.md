# Minsky planning record

This file records the current agreed scope, newest first.
Earlier requests, approvals, branch exceptions, and the original demo plan are in the [planning log](docs/history/plan-log.md).

**Documentation consolidation, 2026-10-24.** The owner approved a second documentation review in PR #65.
Move dated records to `docs/history/`. Rename `docs/current-state.md` to `docs/history/run-log.md` and `docs/cloud-onboarding.md` to `docs/supabase-provider.md`.
Merge the preview rationale into the Workers Builds guide. Move planning entries before 2026-10-23 to the planning log.
`ROADMAP.md` owns the technology stack. `docs/product-direction.md` owns product requirements.
The PR template owns the pull request format. AGENTS.md owns branch and commit names.

**Stale documentation cleanup, 2026-10-24.** The owner asked to identify and correct stale documentation on `main`.
Correct present-tense instructions that still describe the removed GitHub Actions workflow, merged PRs as open, or the five-group `Backend`.
Add the merged session announcements to the public guides and status page.
Keep dated records as history. Change no code, hosted resource, secret, or repository setting.
Name the branch and PR as the AGENTS.md Contributions section states. The owner reviews and merges.

**Cloudflare is the live backend, 2026-10-23.** The owner selected Cloudflare as the live backend.
The development Worker is `minsky-dev`. The development D1 database is `minsky-development`.
Keep the Supabase adapter, its migrations, its functions, and its provider tests.
Supabase is a supported second provider behind the shared backend interfaces.
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
`minsky-dev` stays disconnected from Workers Builds.
