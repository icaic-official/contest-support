# Minsky

Minsky helps contest teams and staff report, triage, resolve and review technical problems. T0003 connects the existing workflow to Supabase Auth, Postgres and Realtime; Cloudflare Workers serves the static React frontend.

The connected app is a **development deployment**, with connectivity assumed. Invitation/recovery delivery remains pending custom SMTP. It is not yet certified for a live contest or the 800-user target.

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

`cloud:functions` uses server-side bundling (`--use-api`), so Docker is not required. The bootstrap refuses to run if an admin already exists. Review/edit `scripts/bootstrap.sql` for the initial event, session and roster. Once bootstrapped, use the admin view for account membership, roles and contestant intake. See [cloud onboarding](docs/cloud-onboarding.md) for redirect URLs, function configuration, provisioning while SMTP is pending, and tested setup outcomes.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Connected frontend at `http://127.0.0.1:5173` |
| `npm run build` | Type check and create production static assets in `dist/` |
| `npm run preview` | Serve built assets locally |
| `npm run typecheck` | Check frontend, scripts' TypeScript and browser tests |
| `npm run lint` | ESLint for TypeScript and Node scripts |
| `npm run check:functions` | Deno type check of privileged Supabase function |
| `npm test` | Domain, storage, connected timing and embedded PostgreSQL migration/RLS tests; no cloud credentials or Docker needed |
| `npm run test:e2e` | Historical demo browser regression suite |
| `npm run test:hosted` | Run the real-account smoke suite against the deployed development frontend |
| `npm run test:cloud` | Real Auth/database/Realtime tests against the linked project, with temporary accounts and isolated sessions, then fixture cleanup |
| `npm run dev:demo` | Historical browser-local demo, development only |
| `npm run cloud:plan` / `cloud:migrate` | Dry-run / apply linked cloud migrations |
| `npm run cloud:bootstrap -- --admin-user UUID` | Trusted first-admin/session bootstrap |
| `npm run cloud:functions` | Deploy account administration with cloud bundling |
| `npm run deploy` | Build and explicitly deploy Workers Static Assets |

Install Chromium once with `npx playwright install chromium`. Deno and the provider CLIs are pinned npm dependencies. Test credentials are captured in memory and a temporary file; privileged credentials never enter the browser. Do not interrupt cloud tests during cleanup. If cleanup fails, investigate the reported test sessions before deleting them; there is no shared-data reset command.

PR CI runs build/lint/type/function/database/demo checks without hosted secrets. The protected, manually dispatched `cloud-test` environment requires a separate Supabase test project and credentials. It refuses the shared development project. Preview deployments do not automatically use or mutate the shared database. See [contributor and CI setup](docs/cloud-onboarding.md#5-contributor-onboarding).

PR security checks scan Git history for secrets with redacted Gitleaks output and audit locked npm dependencies, blocking high/critical vulnerabilities. Dependabot proposes weekly dependency/action updates. The [code-quality guide](docs/code-quality.md) describes the review checklist and prepared mandatory merge rules; the repository owner must enable those remote rules and vulnerability alerts.

## Connected workflow

Sign in with an organizer-provided account. Team accounts see their own issues and public activity. Staff see their combined volunteer/specialist/jury capabilities; admin is a separate capability. Submit → claim → escalate → accept → resolve → award → confirm external application. Support can report for a roster team. Reopening preserves ownership, every previous resolution and the existing award, while excluding resolved intervals from unresolved time. Server timestamps, issue revisions, transactional locks and persisted request IDs protect writes. An award remains separate from the external contest clock.

The admin view can invite accounts, assign existing Auth users to teams or staff roles, revoke membership, and open/close contestant intake. It cannot remove the last admin. Existing logins lose database access immediately when membership is removed; the UI refetches current membership on focus, reconnect and at ten-second intervals. Realtime uses team-scoped public and staff-only private invalidations followed by authorized reads. Private notes do not advance public counters. No notes or issue content are sent in the invalidation payload.

Uploads, broader event/roster/category editors, CSV, notifications, shared incidents, offline operation and award adjustments remain deferred. This implementation supports group events and one award per issue.

## Documentation

- [Working rules](AGENTS.md) and [original plan](PLAN.md)
- [Development tickets](docs/tickets.md)
- [Cloud onboarding and costs](docs/cloud-onboarding.md)
- [Current implementation and verification](docs/current-state.md)
- [Manual walkthrough](docs/manual-verification.md)
- [Code quality and review](docs/code-quality.md)
- [Product direction](docs/product-direction.md)
- [Historical demo specification](docs/demo-spec.md)

## Historical local demo (T0001/T0002)

The following describes the merged demo baseline. Run it with `npm run dev:demo`. It is excluded from production builds.

## Try the journey

1. As **Team contestant · Team Aurora**, submit a Backend issue.
2. As **Volunteer · Sam Chen**, claim it, send a public reply and an internal note, then escalate.
3. As **Technical specialist · Dr. Maya Rao**, accept the handoff and choose a common resolution summary or Custom. “Resolved without comment” records that explicit public summary.
4. As **Jury · Alex Morgan**, choose 0, 5, 10, 15, 30 or 60 award minutes, or Custom for another non-negative whole number. A public explanation is required, including for zero-minute decisions.
5. As any staff persona, confirm the award was applied externally in the simulation.
6. Return to the contestant to see the decision and application status. Refresh to check persistence. Use **Reset demo** to restore the fictional scenario.

Timers start at submission, record first assignment separately, and stop at resolution. Reopening resumes accumulated unresolved time and excludes time spent resolved. Escalation retains the current owner until acceptance. Awards do not change an external contest clock.

Specialists can also claim open issues directly. **Volunteer + Technical specialist · Robin Ellis** has both roles under one identity and can accept another person's handoff. Owners cannot accept their own handoffs. A support role combined with jury membership has both capabilities; the five seeded personas do not include that combination.

Contestants can reopen their own team's resolved issues; any support helper can reopen a session issue. Enter a public reopening reason. The same issue and previous owner remain, earlier summaries stay visible, and a new resolution needs a new summary. Existing awards and application confirmations remain unchanged. The demo still permits only one award per issue.

## Demo limitations

Persona switching and hidden controls are not authentication or authorization. The demo stores data under `minsky.demo.v2` in this browser's local storage. Valid v1 progress migrates when v2 is absent; the v1 source remains untouched. Existing v2 data takes priority, including after reset. The browser scopes this storage to its origin. Use fictional information only. Clearing browser data removes progress. Persona selection and filters reset on reload. The demo does not synchronize concurrent tabs, devices, or users. Keep one demo tab open. The interface shows storage failures. Unavailable or incompatible saved data requires an explicit reset.

There are no real accounts, uploads, notifications, cloud synchronization, CSV imports, shared-incident actions, or administration interfaces. Seed categories are configurable in `src/domain.ts`, with no category editor. This demo does not validate production security, offline operation, or capacity for 800 simultaneous users.
