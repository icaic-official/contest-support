# Minsky

Minsky helps contest teams and staff report, triage, resolve, and review technical problems.
T0003 connects this workflow to Supabase Auth, Postgres, and Realtime.
Cloudflare Workers serves the static React frontend.

The connected app is a **development deployment**.
Development assumes connectivity.
Organizers provide usernames and passwords.
Users must change temporary passwords before they can access contest data.
Organizers handle password recovery without SMTP.
The app is not yet certified for a live contest or the 800-user target.

T0004 gives the app a dark green interface based on the user's references.
On desktop screens, a compact sidebar sits beside the issue queue and the panel for issue details and activity.
On phones, queue rows become cards.
**Menu** opens navigation.
When you select a report, focus moves to its details.
**Back to queue** returns focus to the queue heading.

**Report an issue** and **Report for team** open the submission form.
The centered public sign-in page includes organizer recovery guidance and a control that shows or hides the password.
The sign-in button is amber.
Account settings and administration use the same theme.
The app serves Public Sans locally.
Its license is in `public/fonts/OFL-Public-Sans.txt`.

The app uses actual authenticated accounts and shared data.
It preserves the workflow and account permissions.
The reference values are not product seed data.
The old local demo and its commands are removed.

T0005 lets staff attach JPEG, PNG, and WebP images to an issue.
The uploader chooses **Staff only** or **Visible to the team**.
**Staff only** is the default, and the choice stays fixed.
Session admins set the size and count limits under **Administration**.
Contestants can view team-visible images on their own team's issues.
They cannot upload images.

## Connected development — no Docker required

Use Node.js 22.13 or later within 22.x, or Node.js 24 or later.
Use npm.
The user's 2026-10-02 decision permits full cloud credential access for contributors.
Provider-console permissions and Minsky session membership are separate.

Run these commands in sequence:

```sh
npm ci
cp .env.example .env.local
npm run cloud:login
npm run cloud:link
npm run dev
```

Enter the Supabase URL in `.env.local`.
Enter the publishable key in `.env.local`.
Enter the database password privately at the CLI prompt.
Never put service credentials in a `VITE_` variable.
The app does not import old local demo data.

The project maintainer explicitly applies schema changes and creates the first admin through the bootstrap command.
For first setup, the commands are:

```sh
npm run cloud:plan
npm run cloud:migrate
npm run cloud:bootstrap -- --admin-user EXISTING_AUTH_UUID
npm run cloud:functions
npm run cloud:hosting-login
npm run deploy
```

`cloud:functions` uses server-side bundling with `--use-api`.
Docker is not required.
The bootstrap refuses to run if an admin already exists.
Before first setup, review `scripts/bootstrap.sql` for the initial event, session, and roster.
Edit it if necessary.

After bootstrap, select **Administration** in the sidebar.
Use this section to manage account membership, roles, and contestant intake.
See [cloud onboarding](docs/cloud-onboarding.md) for function configuration, username creation, password resets, and observed setup results.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Serve the connected frontend at `http://127.0.0.1:5173`. |
| `npm run build` | Check types and create production static assets in `dist/`. |
| `npm run preview` | Serve built assets locally. |
| `npm run typecheck` | Check TypeScript in the frontend, scripts, and browser tests. |
| `npm run lint` | Run ESLint for TypeScript and Node scripts. |
| `npm run check:functions` | Run the Deno type check for the account and attachment functions. |
| `npm test` | Test connected timing, account identifiers, image rules, and migrations and RLS with embedded PostgreSQL. Cloud credentials and Docker are not required. |
| `npm run test:e2e` | Run public landing, login, and image-preview browser checks without cloud credentials. |
| `npm run test:hosted` | Run the smoke suite with real accounts against the deployed development frontend. |
| `npm run test:cloud` | Test real Auth, database, and Realtime behavior against the linked project. The suite creates temporary accounts and isolated sessions, then deletes its fixtures. |
| `npm run cloud:plan` / `cloud:migrate` | Preview or apply migrations to the linked cloud project. |
| `npm run cloud:bootstrap -- --admin-user UUID` | Create the first admin and session through a trusted bootstrap. |
| `npm run cloud:recover-admin -- --user UUID` | Recover an existing admin through trusted provider access. Print a new temporary password in the private terminal. |
| `npm run cloud:functions` | Deploy the account and attachment functions with cloud bundling. |
| `npm run deploy` | Build and explicitly deploy Workers Static Assets. |
| `npm run deploy:preview -- --preview-alias t0005` | Build and upload a Worker version at the `t0005` preview URL without changing the main deployment. |

Install Chromium once:

```sh
npx playwright install chromium
```

Deno and the provider CLIs are pinned npm dependencies.
Cloud tests hold test credentials in memory and a temporary file.
Privileged credentials never enter the browser.
Do not interrupt cloud tests during fixture deletion.
If fixture deletion fails, investigate the reported test sessions before you delete them.
There is no command to reset shared data.

PR CI checks builds, lint, types, functions, database behavior, and the public landing and login pages without hosted secrets.
The protected `cloud-test` environment supports manually dispatched cloud tests.
It requires a separate Supabase test project and credentials.
It refuses the shared development project.
Preview deployments do not automatically use or change the shared database.
The T0005 preview uses the existing `Minsky` development backend with the user's approval.
It shares development accounts and data.
Upload it from `feature/t0005-issue-attachments` with `npm run deploy:preview -- --preview-alias t0005`.
The alias is `https://t0005-minsky-dev.icaic-minsky.workers.dev`.
This is a manual upload; branch pushes do not automatically publish previews.
See [contributor setup](docs/cloud-onboarding.md#contributor-setup) and [protected cloud CI](docs/cloud-onboarding.md#verification-and-protected-cloud-ci).

Use this development sequence:

1. Create the ticket branch from updated `main`.
2. Develop the change and add migrations.
3. Run fast checks.
4. Prepare the PR.
5. Review the PR and run isolated cloud integration checks on the reviewed revision.
6. Let the user review and merge.
7. Explicitly deploy the approved changes.

`Minsky` serves development and trial accounts.
`Minsky CI` contains temporary automated fixtures.
Production is not provisioned.
When production exists, validate changes on development and CI before deployment to its separate database and frontend.
See [AGENTS.md](AGENTS.md#cloud-development-and-deployment-workflow) and the [release process](docs/cloud-onboarding.md#development-and-release-process).

PR security checks scan Git history for secrets with redacted Gitleaks output.
They also audit locked npm dependencies.
High and critical vulnerabilities block the dependency check.
Dependabot proposes weekly dependency and action updates.
TypeScript major updates are ignored until the installed lint toolchain accepts them.
The [code-quality guide](docs/code-quality.md) describes the review checklist and prepared mandatory merge rules.
The repository owner must enable the remote rules and vulnerability alerts.

## Connected workflow

Sign in with the username and password from your organizer.
Existing development accounts can use their original email until an admin assigns a username.
Team accounts see their own issues and public activity.
Staff receive the combined capabilities of their volunteer, specialist, and jury roles.
Admin is a separate capability.

The complete workflow is:

1. The contestant submits an issue.
2. A support staff member claims the issue.
3. The owner requests a specialist handoff.
4. A specialist accepts the handoff.
5. The owner resolves the issue.
6. The jury records an award.
7. Staff confirm external application of the award.

Support staff can report an issue for a roster team.
Reopening retains the owner, every previous resolution, and any existing award.
Unresolved time excludes resolved intervals.
Server timestamps, issue revisions, transactional locks, and persisted request IDs protect writes.
Minsky records awards separately from the external contest clock.

The admin view supports these actions:

- Create username accounts.
- Issue new temporary passwords.
- Assign existing Auth users to teams or staff roles.
- Revoke membership.
- Open or close contestant intake.

The app shows temporary credentials only for the account creation or reset action.
It does not store passwords in recoverable form.
Users must change temporary passwords before they can read or change contest data.
Resets invalidate previous sessions.

Account-wide changes require admin access to every session of that identity.
They reject archived memberships.
The app prevents removal of the last admin.

When an admin removes membership, an existing login immediately loses database access.
The UI retrieves current membership on focus, on reconnect, and at ten-second intervals.
Realtime sends public invalidations scoped to teams and private invalidations restricted to staff.
The app then reads the data that the account can access.
Private notes do not advance public counters.
Invalidation payloads contain no notes or issue content.

Staff can attach JPEG, PNG, and WebP images to an issue.
Broader event, roster, and category editors, CSV imports, notifications, shared incidents, offline operation, and award adjustments remain deferred.
This implementation supports group events and one award per issue.

## Documentation

- [Working rules](AGENTS.md) and [original plan](PLAN.md)
- [Development tickets](docs/tickets.md)
- [Cloud onboarding and costs](docs/cloud-onboarding.md)
- [Current implementation and verification](docs/current-state.md)
- [Manual walkthrough](docs/manual-verification.md)
- [Code quality and review](docs/code-quality.md)
- [Product direction](docs/product-direction.md)
