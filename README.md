# Minsky

Minsky helps contest teams and staff report, triage, resolve, and review technical problems.
Contestants report issues; volunteers and specialists handle them through a shared queue.
Jury members record time awards, and staff confirm their application to the external contest clock.
Administrators manage accounts, roles, and contestant intake.
Staff can attach images to issues and choose staff-only or team visibility.

The app uses React, TypeScript, and Vite, with Supabase Auth, Postgres, and Realtime.
Cloudflare Workers hosts the frontend.
This is a **development deployment** that requires connectivity.
Live-contest readiness and capacity for 800 simultaneous users remain unverified.

[Read the user and operator guides](https://minsky-docs.icaic-minsky.workers.dev).
The documentation site describes merged features and labels pending T0007 installation work.
Its deployment is separate from the application.

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
| `npm run preview` | Serve built assets locally. |
| `npm run typecheck` | Check TypeScript. |
| `npm run lint` | Run ESLint. |
| `npm run check:functions` | Check the account and attachment functions with Deno. |
| `npm run test:functions` | Test attachment authorization and file removal with fake clients. |
| `npm test` | Run unit, script, and embedded database tests without cloud credentials. |
| `npm run test:e2e` | Run browser tests with mocked cloud responses. |

Install Chromium once before browser tests:

```sh
npx playwright install chromium
```

Deno and the provider CLIs are pinned npm dependencies.
For `npm run test:cloud` and `npm run test:hosted`, follow [cloud verification](docs/cloud-onboarding.md#verification-and-protected-cloud-ci).
If fixture cleanup fails, follow [fixture recovery](docs/cloud-onboarding.md#fixture-recovery).

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
The user selected automatic branch previews and deployment from `main` for both sites.
GitHub Actions runs CI for pull requests and all branch pushes.
The deployment job waits for `checks`, `secrets`, and `dependencies` before publishing either Worker.
See [deployment setup](docs/cloudflare-builds.md) for credentials, activation, and backend limits.
The workflow requires account setup. The first automatic deployments remain unverified.

### Repository records

- [Writing guide](docs/writing-guide.md) gives the documentation structure and sentence rules.
- [Deployment setup](docs/cloudflare-builds.md) explains branch previews, deployment after CI passes, and first-run verification.
- [Documentation release plan](docs/documentation-release-plan.md) — public-reader requirements, specific gaps, and completion criteria.
- [Development tickets](docs/tickets.md) — ticket scope, status, and acceptance criteria.
- [Current state](docs/current-state.md) — implementation details, verification records, and limitations.
- [Cloud onboarding](docs/cloud-onboarding.md) — provider setup, costs, accounts, and deployment.
- [Manual verification](docs/manual-verification.md) — workflow and interface checks.
- [Code quality](docs/code-quality.md) — CI checks and review requirements.
- [Product direction](docs/product-direction.md) — agreed requirements and open decisions.
- [Contributor rules](AGENTS.md) and [planning record](PLAN.md).
