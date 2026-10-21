# Minsky

Minsky helps contest teams and staff report, triage, resolve, and review technical problems.
Contestants report issues; volunteers and specialists handle them through a shared queue.
Jury members record time awards, and staff confirm their application to the external contest clock.
Administrators manage accounts, roles, and contestant intake.
Staff can attach images to issues and choose staff-only or team visibility.

The app uses React, TypeScript, Vite, Tailwind CSS, and shadcn/ui.
Its shared [backend contract](docs/backend-contracts.md) has Supabase and Cloudflare implementations.
Supabase remains the active development backend.
The Cloudflare installation serves the frontend and API through Workers, with D1, private R2 images, and Durable Object live updates.
Both providers use the same workflow decisions. The active Supabase browser path retains its guarded SQL workflow during replacement verification.

[Read the user and operator guides](https://minsky-docs.icaic-minsky.workers.dev).
Use [the installation guide](site/src/content/docs/operators/installation.md) for an isolated Cloudflare instance.
T0021 prepares a fresh Cloudflare development installation after PR #42 merged at `104d9d1`.
It transfers no existing Supabase records or accounts. Supabase stays intact and active until the owner approves the concrete backend switch.
See [current state](docs/current-state.md) for source-specific checks and [activation](docs/activate-cloudflare-development.md) for the remaining gates.
These are development installations that require connectivity. Live-contest readiness and capacity for 800 simultaneous users remain unverified.

## User interfaces

T0015 redesigns the frontend on `feature/t0015-frontend-redesign`. It is not merged yet.
After sign-in, the membership selects one of three UIs:

- **Contestant desktop app.** A membership with a team gets this app. It shows the team's reports, a live timer, a progress tracker, public messages, team-visible images and the report form. It has no phone layout and needs a window at least 1024 px wide.
- **Organiser phone app.** Staff in a window narrower than 1024 px get bottom tabs by role: Queue, Mine, Find, Awards, Session and Me. Issues open in a full-screen view with an action bar and bottom sheets.
- **Organiser desktop console.** Staff in a window 1024 px wide or wider get a sidebar, a queue table, an issue side sheet, a ⌘K command palette, Award review and the admin pages.

The jury award lists from T0009 are in the phone **Awards** tab and the desktop **Award review** page.
All UIs use shadcn/ui, Tailwind CSS and the same data hooks, with light and dark themes.
See [frontend architecture](docs/frontend-architecture.md) and the [design record](design/redesign/README.md).

## Local development

Use npm with Node.js 22.13 or later within 22.x, or Node.js 24 or later. Docker is not required.

```sh
npm ci
cp .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` using the development project's public credentials.
Never put service credentials in a `VITE_` variable.

Then connect to the development project and start the frontend.
Enter the database password privately when prompted by the link command.

```sh
npm run cloud:login
npm run cloud:link
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).
Provider access and app membership are separate: an administrator must grant your account session access.
Sign in with your organizer-provided username and password, then change any temporary password.

See [cloud onboarding](docs/cloud-onboarding.md#contributor-setup) for provider access, first setup, migrations, account recovery, and deployment.

## Checks and common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local frontend. |
| `npm run build` | Check types and create static assets in `dist/`. |
| `npm run deploy` | Build and publish the selected app through guarded deployment tooling. Requires an eligible repository push context and approved activation settings. |
| `node scripts/deploy-workers.mjs --check --site=app` | Validate the selected deployment target without provider changes. Use `--site=docs` for independent docs settings. |
| `node scripts/deploy-workers.mjs --build --site=app` | Build the explicitly selected backend and record its revision before guarded publication. |
| `npm run preview` | Serve built assets locally. |
| `npm run typecheck` | Check TypeScript. |
| `npm run lint` | Run ESLint. |
| `npm run check:functions` | Check the account, attachment, and workflow functions with Deno. |
| `npm run test:functions` | Test attachment authorization and file removal with fake clients. |
| `npm test` | Run unit, script, and embedded database tests without cloud credentials. |
| `npm run test:d1` | Run every D1 workflow case with local emulation and current identity guards. |
| `npm run test:connector:runtime` | Run the complete connector through a temporary local HTTPS Worker, D1, R2, and Durable Objects. |
| `npm run test:connector:ui:local` | Build a temporary Cloudflare frontend and run the complete React journey on local HTTPS and real emulated bindings. |
| `npm run test:connector:ui -- --config=… --account=… --database=… --origin=…` | Run the complete React journey against the confirmed hosted Cloudflare CI application. |
| `npm run test:connector:workflow:hosted -- --config=… --account=… --database=…` | Run every workflow case on the confirmed D1-only store CI target. |
| `npm run test:connector:accounts:hosted -- --config=… --account=… --database=…` | Check account guards on the same D1-only store CI target. |
| `npm run cloudflare:install -- plan --settings=… --config=…` | Inspect an independent Cloudflare installation plan without provider changes. See the [installation guide](site/src/content/docs/operators/installation.md). |
| `npm run test:workflow:hosted` | Verify the shared server through the deployed Supabase function on approved Minsky CI. See the [verification guide](docs/verify-server-workflow.md). |
| `npm run test:auth` | Run experimental Cloudflare account and permission tests on local D1. |
| `npm run test:auth:browser` | Check cookies, origins, and request protection with a local HTTPS Worker and Chromium. |
| `npm run test:auth:hosted -- --account=… --database=…` | Run account cases on the explicit isolated hosted authentication D1 target. |
| `npm run test:auth:http -- --account=… --database=… --origin=…` | Check the isolated deployed authentication Worker. |
| `npm run test:auth:hash` | Measure password cost in a temporary local Worker. |
| `npm run test:e2e` | Run browser tests with mocked cloud responses. |
| `npm run test:cloud` | Run the browser and workflow suite with isolated fixtures on the CI project. Needs cloud credentials. |
| `npm run test:hosted` | Repeat the suite with real accounts against the deployed app. Needs cloud credentials. |
| `npm run test:providers:list` | List the shared provider scenarios without hosted credentials. |
| `npm run test:providers -- --provider=supabase` | Run the shared contracts against an explicitly configured isolated Supabase project. |
| `npm run test:providers -- --provider=cloudflare --config=… --account=… --database=… --origin=…` | Run the same contracts through the isolated Cloudflare browser adapter. |

Install the Chromium build that matches the installed Playwright (1.64) before browser tests:

```sh
npx playwright install chromium
```

If the default browser folder is not writable, set `PLAYWRIGHT_BROWSERS_PATH` to a writable folder before the install and before each test run.
If your shell sets `NODE_ENV=production`, unset it before `npm run dev` or `npm run test:e2e`. Otherwise the page stays blank.

These commands connect to provider accounts. Several of them change hosted data or deployments. Confirm the target before you run them:

| Command | Purpose |
| --- | --- |
| `npm run cloud:login` and `npm run cloud:link` | Sign in to Supabase and link the development project. |
| `npm run cloud:plan` | Show the migrations that `cloud:migrate` would apply. |
| `npm run cloud:migrate` | Apply migrations to the linked project. |
| `npm run cloud:functions` | Deploy the `admin` and `attachments` functions to the development project. |
| `npm run cloud:bootstrap` | Make the first session admin. |
| `npm run cloud:recover-admin` | Reset the password of an existing admin when the only admin cannot sign in. |
| `npm run cloud:hosting-login` | Sign in to Cloudflare with Wrangler. |
| `npm run deploy` | Build and deploy the frontend Worker. Deploy only after an explicit request. |
| `npm run deploy:preview` | Build and upload a preview version of the frontend Worker. |

See [cloud onboarding](docs/cloud-onboarding.md) for the exact arguments.

Deno and the provider CLIs are pinned npm dependencies.
For `npm run test:cloud` and `npm run test:hosted`, follow [cloud verification](docs/cloud-onboarding.md#verification-and-protected-cloud-ci).
For shared adapter checks, follow [Run the shared provider tests](docs/run-provider-tests.md).
The two hosted store commands accept the optional [D1 API transport](docs/run-provider-tests.md#use-the-d1-api-transport).
Run those API commands in sequence. Default binding checks and protected CI keep their existing transport.
`VITE_BACKEND` defaults to `supabase`. An isolated Cloudflare application build sets `VITE_BACKEND=cloudflare` and uses its own origin.
Cloudflare cookies and API requests require the same origin. A plain Vite server does not supply that API.
If an existing cloud fixture cleanup fails, follow [fixture recovery](docs/cloud-onboarding.md#fixture-recovery).

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
| `npm run docs:deploy` | Build and publish only the `minsky-docs` Worker during an approved manual recovery. |

The deployment configuration is `wrangler.docs.jsonc`.
See [the writing and deployment guide](site/src/content/docs/contributing/documentation.md).
The initial docs deployment is explicitly authorized in T0011 before merge.
The user selected CI-controlled deployment from `main`.
Docs branch previews remain available. App branch previews are disabled until independent preview resources exist.
GitHub Actions runs CI for pull requests and all branch pushes.
Independent docs and app deployment jobs wait for `checks`, `secrets`, and `dependencies`.
See [deployment setup](docs/cloudflare-builds.md) for credentials, activation, and backend limits.
The fresh Cloudflare development candidate and a separate empty installation pass the complete application checks.
Stable URL activation and subsequent automated deployment remain unverified and require owner approval.
PR #42 merged at `104d9d1`. T0021 includes the accepted connector and its final verification records.

### Repository records

- [Writing guide](docs/writing-guide.md) gives the documentation structure and sentence rules.
- [Deployment setup](docs/cloudflare-builds.md) explains branch previews, deployment after CI passes, and first-run verification.
- [Documentation release plan](docs/documentation-release-plan.md) — public-reader requirements, specific gaps, and completion criteria.
- [Development tickets](docs/tickets.md) — ticket scope, status, and acceptance criteria.
- [Frontend architecture](docs/frontend-architecture.md) — UI selection, shells, data hooks, the jury award lists, and the Tailwind and shadcn/ui setup.
- [Frontend redesign record](design/redesign/README.md) — the mockups, the chosen direction, and how its open decisions were resolved.
- [Current state](docs/current-state.md) — implementation details, verification records, and limitations.
- [Cloud onboarding](docs/cloud-onboarding.md) — provider setup, costs, accounts, and deployment.
- [Jury worklist specification](docs/jury-worklist.md) records T0009 behavior and verified acceptance.
- [Manual verification](docs/manual-verification.md) — workflow and interface checks.
- [Code quality](docs/code-quality.md) — CI checks and review requirements.
- [Server workflow reference](docs/server-workflow.md) inventories existing rules and the shared service and persistence boundaries.
- [Verify the shared server workflow](docs/verify-server-workflow.md) gives local, CI-only hosted, and recovery commands.
- [Backend contracts](docs/backend-contracts.md) describe the provider interfaces and their behavior.
- [Add a backend provider](docs/add-provider.md) gives contributor interfaces, registration points, installation, cleanup, and required shared verification.
- [Activate Cloudflare development](docs/activate-cloudflare-development.md) gives the fresh-installation approval, deployment, verification, and recovery gates.
- [Cloudflare backend design](docs/cloudflare-backend-design.md) explains the implemented server boundaries.
- [Cloudflare authentication reference](docs/cloudflare-authentication.md) defines the experimental API, browser sessions, and account rules.
- [Authentication choice](docs/cloudflare-authentication-choice.md) records Better Auth, maintained crypto, resource measurements, and costs.
- [Verify Cloudflare authentication](docs/verify-cloudflare-authentication.md) gives local, hosted, and protected CI procedures.
- [Cloudflare installation](site/src/content/docs/operators/installation.md) gives the complete development installation procedure and owner recovery.
- [PR #21 component record](docs/pr21-installation-disposition.md) records reused safeguards and replaced or deferred scaffolding.
- [Shared provider test contracts](docs/provider-test-contracts.md) describe reusable assertions, fixture ownership, and provider requirements.
- [Product direction](docs/product-direction.md) — agreed requirements and open decisions.
- [Contributor rules](AGENTS.md) and [planning record](PLAN.md).
