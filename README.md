# Minsky

Minsky helps contest teams and staff report, triage, resolve, and review technical problems.
Contestants report issues; volunteers and specialists handle them through a shared queue.
Jury members record time awards, and staff confirm their application to the external contest clock.
Administrators manage accounts, roles, and contestant intake.
Staff can attach images to issues and choose staff-only or team visibility.

The app uses React, TypeScript, Vite, Tailwind CSS, and shadcn/ui.
Its shared [backend contract](docs/backend-contracts.md) defines the provider boundary. Cloudflare is the only implementation.
The [development application](https://minsky-dev.icaic-minsky.workers.dev) runs Cloudflare. See [run log](docs/history/run-log.md) for its deployed source.
The Cloudflare installation serves the frontend and API through Workers, with D1, private R2 images, and Durable Object live updates.

The frontend separates contestant screens, organiser screens, and shared session hooks.
`src/connected/` owns account checks, workspace state, browser routes, and workflow retry protection.
See [frontend architecture](docs/frontend-architecture.md) for module responsibilities, browser paths, and access checks.

[Read the user and operator guides](https://minsky-docs.icaic-minsky.workers.dev).
Use [the installation guide](site/src/content/docs/operators/installation.mdx) for an isolated Cloudflare instance.
The owner merged T0021 in [PR #43](https://github.com/GiftedNovaHD/minsky/pull/43) at `4e43739` on 2026-10-19.
The owner separately approved the Cloudflare switch and a repeat automated deployment.
It transferred no accounts, passwords, records, images, or IDs from the earlier backend.
See [run log](docs/history/run-log.md#t0021-approved-activation-2026-10-19) for the deployment results and [activation](docs/activate-cloudflare-development.md) for the procedure.
These are development installations that require connectivity. Live-contest readiness and capacity for 800 simultaneous users remain unverified.

## User interfaces

T0015 ([PR #44](https://github.com/GiftedNovaHD/minsky/pull/44), merged at `a25f9f1` on 2026-10-21) gives three UIs. After sign-in, the membership selects one:

- **Contestant desktop app.** A membership with a team gets this app. It shows the team's reports, a live timer, a progress tracker, public messages, team-visible images and the report form. It has no phone layout and needs a window at least 1024 px wide.
- **Organiser phone app.** Staff in a window narrower than 1024 px get bottom tabs by role: Queue, Mine, Find, Awards, Session and Me. Issues open in a full-screen view with an action bar and bottom sheets.
- **Organiser desktop console.** Staff in a window 1024 px wide or wider get a sidebar, a queue table, an issue side sheet, a ⌘K command palette, Award review and the admin pages.

The jury award lists from T0009 are in the phone **Awards** tab and the desktop **Award review** page.
All UIs use shadcn/ui, Tailwind CSS and the same data hooks, with light and dark themes.
See [frontend architecture](docs/frontend-architecture.md) and the [design record](design/redesign/README.md).

## Local development

Use npm with Node.js 22.13 or later within 22.x, or Node.js 24 or later. Docker is not required.
The live development backend is Cloudflare.
The Worker is `minsky-dev`. The D1 database is `minsky-development`.
The development app is [https://minsky-dev.icaic-minsky.workers.dev](https://minsky-dev.icaic-minsky.workers.dev).
A plain Vite server does not provide that API.
For a separate Cloudflare installation, use the [installation guide](site/src/content/docs/operators/installation.mdx).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).
Sign-in on that Vite server fails because the API is absent.
Use `npm run test:connector:ui:local` for a temporary local Cloudflare application.
Use the hosted development app for the shared development data.

### Lapiz preview

[`lapiz.deploy.json`](lapiz.deploy.json) and [`.lapiz/`](.lapiz) run a preview of the Cloudflare application on a Lapiz host.
The preview uses only local emulation of D1, R2, and Durable Objects in `.lapiz/state/`. It never connects to hosted Cloudflare resources.
On the first start, `.lapiz/bootstrap.ts` bootstraps the installation from `src/server/adapters/cloudflare/tooling/competition.example.json`.

The preview prints the first admin's username and temporary password in its start log on each start. This is deliberate, for debugging.
Anyone who can read that log can sign in as that admin. Use only fictional data in the preview.

`npm run typecheck` does not check `.lapiz/bootstrap.ts`. The preview setup bundles it with esbuild, which does not check types.

## Checks and common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local frontend. |
| `npm run build` | Check types and create static assets in `dist/`. |
| `npm run deploy` | Build the Cloudflare app, apply new D1 migrations, and publish it through guarded deployment tooling. Workers Builds runs it on `minsky-dev` for each push to `main`. Branch previews on `minsky-preview` are switched off. A manual run needs `WORKERS_CI_BRANCH`, `WORKERS_CI_COMMIT_SHA`, and the approved target settings. |
| `node scripts/deploy-workers.mjs --check --site=app` | Validate the selected deployment target without provider changes. Use `--site=docs` for independent docs settings. |
| `node scripts/deploy-workers.mjs --build --site=app` | Build the Cloudflare app and record its revision before guarded publication. |
| `npm run preview` | Serve built assets locally. |
| `npm run typecheck` | Check TypeScript. |
| `npm run lint` | Run ESLint. |
| `npm run ci` | Run the Workers Builds check: installs, type checking, lint, unit tests, both builds, audits, and the Gitleaks scan. |
| `npm test` | Run unit and script tests without cloud credentials. |
| `npm run test:d1` | Run every D1 workflow case with local emulation and current identity guards. |
| `npm run test:connector:runtime` | Run the complete connector through a temporary local HTTPS Worker, D1, R2, and Durable Objects. |
| `npm run test:connector:ui:local` | Build a temporary Cloudflare frontend and run the complete React journey on local HTTPS and real emulated bindings. |
| `npm run test:connector:ui -- --config=… --account=… --database=… --origin=…` | Run the complete React journey against the confirmed hosted Cloudflare CI application. |
| `npm run test:connector:workflow:hosted -- --config=… --account=… --database=…` | Run every workflow case on the confirmed D1-only store CI target. |
| `npm run test:connector:accounts:hosted -- --config=… --account=… --database=…` | Check account guards on the same D1-only store CI target. |
| `npm run cloudflare:install -- plan --settings=… --config=…` | Inspect an independent Cloudflare installation plan without provider changes. See the [installation guide](site/src/content/docs/operators/installation.mdx). |
| `npm run test:auth` | Run Cloudflare account and permission tests on local D1. |
| `npm run test:auth:browser` | Check cookies, origins, and request protection with a local HTTPS Worker and Chromium. |
| `npm run test:auth:hosted -- --account=… --database=…` | Run account cases on the explicit isolated hosted authentication D1 target. |
| `npm run test:auth:http -- --account=… --database=… --origin=…` | Check the isolated deployed authentication Worker. |
| `npm run test:auth:hash` | Measure password cost in a temporary local Worker. |
| `npm run test:e2e:smoke` | Run the critical-path browser files `tests/landing.spec.ts` and `tests/journey.spec.ts`. |
| `npm run test:e2e` | Run every mocked browser test, including the smoke files. The specs use the Cloudflare client. They serve the real Worker routes from the test process. See [the browser suite](#the-mocked-browser-suite). |
| `npm run test:providers:list` | List the shared provider scenarios without hosted credentials. |
| `npm run test:providers -- --provider=cloudflare --config=… --account=… --database=… --origin=…` | Run the same contracts through the isolated Cloudflare browser adapter. |

Install the Chromium build that matches the installed Playwright (1.64) before browser tests:

```sh
npx playwright install chromium
```

If the default browser folder is not writable, set `PLAYWRIGHT_BROWSERS_PATH` to a writable folder before the install and before each test run.
If your shell sets `NODE_ENV=production`, unset it before `npm run dev` or `npm run test:e2e`. Otherwise the page stays blank.

These commands connect to provider accounts. Several of them change hosted data or deployments. Confirm the target before you run them.

| Command | Purpose |
| --- | --- |
| `npm run cloudflare:recover-admin` | Reset the password of an existing Cloudflare admin. Prints the temporary password once in that terminal. |
| `npm run cloud:hosting-login` | Sign in to Cloudflare with Wrangler. |

For shared adapter checks, follow [Run the shared provider tests](docs/run-provider-tests.md).
The two hosted store commands accept the optional [D1 API transport](docs/run-provider-tests.md#use-the-d1-api-transport).
Run those API commands in sequence. Default binding checks and protected CI keep their existing transport.
Cloudflare cookies and API requests require the same origin. A plain Vite server does not supply that API.
If a hosted fixture cleanup fails, follow [Recover an incomplete fixture](docs/run-provider-tests.md#recover-an-incomplete-fixture).

### The mocked browser suite

`npm run test:e2e` starts a Vite server.
Playwright routes each `/api` request to the Worker HTTP handlers in `src/server`.
UI specs use in-memory data from `tests/support/worker.ts`.
Workflow specs use the real Cloudflare services on a local D1 database from `tests/support/localWorker.ts`.
Identity and the live socket are simulated. No hosted provider is contacted. A test fails if a page requests another host.

The server uses port 4173. Set `PLAYWRIGHT_PORT` to use another port, for example when two checkouts run the suite at the same time:

```sh
PLAYWRIGHT_PORT=4401 npm run test:e2e
```

Outside CI, Playwright reuses a server that already listens on the port. Give each checkout its own port so that a run does not test another checkout's server.

## Documentation

### Write and publish the site

Use Node.js 22.22 or later for the documentation tools.
The public guides are Markdown files in `site/src/content/docs/`.

```sh
npm ci
npm ci --prefix site
npm run docs:dev
```

| Command | Purpose |
| --- | --- |
| `npm run docs:dev` | Start the documentation server locally. |
| `npm run docs:build` | Build the static site and check local links and anchors. |
| `npm run docs:preview` | Serve the built site, including search. |
| `npm run docs:test` | Check navigation, search, and phone layouts with Chromium. Build the docs first. |
| `npm run docs:deploy` | Build and publish only the `minsky-docs` Worker. Use it only when Workers Builds cannot publish. |

The deployment configuration is `wrangler.docs.jsonc`.
See [the writing and deployment guide](site/src/content/docs/contributing/documentation.mdx).
The initial docs deployment is explicitly authorized in T0011 before merge.
Four Workers Builds triggers check and publish this repository. A branch push runs the checks. Branch previews on `minsky-preview` are switched off, because Workers Builds cannot limit their token to the preview resources. A merge into `main` publishes `minsky-dev` and the docs.
[Build and publication flow](docs/cloudflare-builds.md#build-and-publication-flow) describes each trigger and what each push does.
See [Workers Builds setup](docs/cloudflare-builds.md) for the dashboard steps and [CI settings](docs/cloudflare-build-settings.md) for on-demand browser and hosted commands.
Automatic GitHub Actions publication is removed.
The fresh Cloudflare development candidate and a separate empty installation pass the complete application checks.
The approved activation and a later automated deployment passed their recorded application checks. Those runs used the retired Actions publisher.
The [T0021 activation record](docs/history/run-log.md#t0021-approved-activation-2026-10-19) separates protected checks from stable URL verification.

### Repository records

Plans and rules:

- [Contributor rules](AGENTS.md), the [planning record](PLAN.md), and the [roadmap](ROADMAP.md) for the technology stack.
- [Product direction](docs/product-direction.md) — agreed requirements and open decisions.
- [Development tickets](docs/history/tickets.md) — ticket scope, status, and acceptance criteria.
- [Writing guide](docs/writing-guide.md) and [documentation release plan](docs/documentation-release-plan.md).
- [Code quality](docs/code-quality.md) — CI summary, dependency policy, secret scanning, and review requirements.

Frontend:

- [Frontend architecture](docs/frontend-architecture.md) — UI selection, shells, data hooks, the jury award lists, and the Tailwind and shadcn/ui setup.
- [Frontend redesign record](design/redesign/README.md) — the mockups, the chosen direction, and how its open decisions were resolved.

Backend:

- [Backend contracts](docs/backend-contracts.md) describe the provider interfaces and their behavior.
- [Server workflow reference](docs/server-workflow.md) inventories existing rules and the shared service and persistence boundaries.
- [Session announcements](docs/session-announcements.md) is the reference for announcement behavior on both providers.
- [Cloudflare backend design](docs/cloudflare-backend-design.md) explains the implemented server boundaries.
- [Cloudflare authentication reference](docs/cloudflare-authentication.md) and the [authentication choice](docs/cloudflare-authentication-choice.md).
- [Add a backend provider](docs/add-provider.md) gives contributor interfaces, registration points, installation, cleanup, and required shared verification.

Operations:

- [Workers Builds setup](docs/cloudflare-builds.md) — the CI Worker, docs publication, and application publication from `main` — and [CI settings](docs/cloudflare-build-settings.md).
- [Cloudflare installation](site/src/content/docs/operators/installation.mdx) gives the complete installation procedure and owner recovery.
- [Activate Cloudflare development](docs/activate-cloudflare-development.md) gives the approval, deployment, admin recovery, and repair steps.

Verification:

- [Manual verification](docs/manual-verification.md) — workflow and interface checks.
- [Run the shared provider tests](docs/run-provider-tests.md) and [shared provider test contracts](docs/provider-test-contracts.md).
- [Verify Cloudflare authentication](docs/verify-cloudflare-authentication.md).

History:

- [Project history](docs/history/README.md) — the run log, planning log, run reports, and superseded specifications. These are dated records, not current instructions.
