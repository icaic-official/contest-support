# Minsky

Minsky helps contest teams and staff report, triage, resolve and review technical problems. T0003 connects the existing workflow to Supabase Auth, Postgres and Realtime; Cloudflare Workers serves the static React frontend.

The connected app is a **development deployment**, with connectivity assumed. Accounts use organizer-provided usernames/passwords. Temporary passwords must be changed before contest access; organizers handle recovery without SMTP. It is not yet certified for a live contest or the 800-user target.

T0004 gives the connected app a dark green interface based on the user's visual references. A compact sidebar sits beside the tabular issue queue and detail/activity panel on desktop. On phones, queue rows become cards, navigation uses **Menu**, and selecting a report focuses its details; **Back to queue** returns to the queue heading. **Report an issue** / **Report for team** opens the submission form. The centered public sign-in page has organizer recovery guidance, a password visibility control and an amber sign-in button. Account settings and administration use the same theme. Public Sans remains locally served, with its license in `public/fonts/OFL-Public-Sans.txt`. Workflow, account permissions and shared data remain connected; reference values are not seeded into the product. The old local demo and its commands have been removed.

## Connected development — no Docker required

Use Node.js 22.13+ within 22.x, or Node.js 24+, and npm. Contributors are assumed to have access to the shared cloud credentials, per the user's 2026-10-02 instruction. Provider-console permissions and Minsky session membership are separate.

```sh
npm ci
cp .env.example .env.local
npm run cloud:login
npm run cloud:link
npm run dev
```

Enter the Supabase URL and publishable key in `.env.local`. Enter the database password privately at the CLI prompt. Never put service credentials in a `VITE_` variable. The existing local demo data is not imported.

The project maintainer applies schema changes and bootstraps the first admin explicitly:

```sh
npm run cloud:plan
npm run cloud:migrate
npm run cloud:bootstrap -- --admin-user EXISTING_AUTH_UUID
npm run cloud:functions
npm run cloud:hosting-login
npm run deploy
```

`cloud:functions` uses server-side bundling (`--use-api`), so Docker is not required. The bootstrap refuses to run if an admin already exists. Review/edit `scripts/bootstrap.sql` for the initial event, session and roster. Once bootstrapped, select **Administration** in the sidebar for account membership, roles and contestant intake. See [cloud onboarding](docs/cloud-onboarding.md) for function configuration, username provisioning, password resets and tested setup outcomes.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Connected frontend at `http://127.0.0.1:5173` |
| `npm run build` | Type check and create production static assets in `dist/` |
| `npm run preview` | Serve built assets locally |
| `npm run typecheck` | Check frontend, scripts' TypeScript and browser tests |
| `npm run lint` | ESLint for TypeScript and Node scripts |
| `npm run check:functions` | Deno type check of privileged Supabase function |
| `npm test` | Connected timing, account identifiers and embedded PostgreSQL migration/RLS tests; no cloud credentials or Docker needed |
| `npm run test:e2e` | Public landing/login browser checks without cloud credentials |
| `npm run test:hosted` | Run the real-account smoke suite against the deployed development frontend |
| `npm run test:cloud` | Real Auth/database/Realtime tests against the linked project, with temporary accounts and isolated sessions, then fixture cleanup |
| `npm run cloud:plan` / `cloud:migrate` | Dry-run / apply linked cloud migrations |
| `npm run cloud:bootstrap -- --admin-user UUID` | Trusted first-admin/session bootstrap |
| `npm run cloud:recover-admin -- --user UUID` | Trusted provider recovery of an existing admin; prints a new temporary password in the private terminal |
| `npm run cloud:functions` | Deploy account administration with cloud bundling |
| `npm run deploy` | Build and explicitly deploy Workers Static Assets |

Install Chromium once with `npx playwright install chromium`. Deno and the provider CLIs are pinned npm dependencies. Test credentials are captured in memory and a temporary file; privileged credentials never enter the browser. Do not interrupt cloud tests during cleanup. If cleanup fails, investigate the reported test sessions before deleting them; there is no shared-data reset command.

PR CI runs build/lint/type/function/database/landing-page checks without hosted secrets. The protected, manually dispatched `cloud-test` environment requires a separate Supabase test project and credentials. It refuses the shared development project. Preview deployments do not automatically use or mutate the shared database. See [contributor setup](docs/cloud-onboarding.md#contributor-setup) and [protected cloud CI](docs/cloud-onboarding.md#verification-and-protected-cloud-ci).

The development process is ticket branch → develop and add migrations → fast checks → PR review and isolated cloud integration checks → user review/merge → explicit deployment of approved changes. `Minsky` serves development and trial accounts; `Minsky CI` contains temporary automated fixtures. Production has not been provisioned. Once it exists, validate changes on development and CI before deploying them to its separate database and frontend. The rules are in [AGENTS.md](AGENTS.md#cloud-development-and-deployment-workflow), with practical commands in [cloud onboarding](docs/cloud-onboarding.md#development-and-release-process).

PR security checks scan Git history for secrets with redacted Gitleaks output and audit locked npm dependencies, blocking high/critical vulnerabilities. Dependabot proposes weekly dependency/action updates. The [code-quality guide](docs/code-quality.md) describes the review checklist and prepared mandatory merge rules; the repository owner must enable those remote rules and vulnerability alerts.

## Connected workflow

Sign in with an organizer-provided username and password. Existing development accounts can keep using their original email until the admin assigns a username. Team accounts see their own issues and public activity. Staff see their combined volunteer/specialist/jury capabilities; admin is a separate capability. Submit → claim → escalate → accept → resolve → award → confirm external application. Support can report for a roster team. Reopening preserves ownership, every previous resolution and the existing award, while excluding resolved intervals from unresolved time. Server timestamps, issue revisions, transactional locks and persisted request IDs protect writes. An award remains separate from the external contest clock.

The admin view can create username accounts, issue new temporary passwords, assign existing Auth users to teams or staff roles, revoke membership, and open/close contestant intake. Credentials are shown for the provisioning/reset action only, not stored as recoverable passwords. Users must change temporary passwords before reading or changing contest data. Resets invalidate prior sessions. Account-wide changes require admin access to every session of that identity and reject archived memberships. It cannot remove the last admin. Existing logins lose database access immediately when membership is removed; the UI refetches current membership on focus, reconnect and at ten-second intervals. Realtime uses team-scoped public and staff-only private invalidations followed by authorized reads. Private notes do not advance public counters. No notes or issue content are sent in the invalidation payload.

Uploads, broader event/roster/category editors, CSV, notifications, shared incidents, offline operation and award adjustments remain deferred. This implementation supports group events and one award per issue.

## Documentation

- [Working rules](AGENTS.md) and [original plan](PLAN.md)
- [Development tickets](docs/tickets.md)
- [Cloud onboarding and costs](docs/cloud-onboarding.md)
- [Current implementation and verification](docs/current-state.md)
- [Manual walkthrough](docs/manual-verification.md)
- [Code quality and review](docs/code-quality.md)
- [Product direction](docs/product-direction.md)
