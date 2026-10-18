# Minsky

Minsky helps contest teams and staff report, triage, resolve, and review technical problems.
Contestants report issues; volunteers and specialists handle them through a shared queue.
Jury members record time awards, and staff confirm their application to the external contest clock.
Administrators manage accounts, roles, and contestant intake.
Staff can attach images to issues and choose staff-only or team visibility.

The app uses React, TypeScript, and Vite, with Supabase Auth, Postgres, and Realtime.
Cloudflare Workers hosts the frontend.
The browser uses shared [backend contracts](docs/backend-contracts.md), with Supabase as the current implementation.
The [shared server workflow](docs/server-workflow.md) now supplies all nine issue decisions for a separate Supabase verification path.
The active browser path retains its guarded SQL workflow during the transition.
The selected future backend uses Workers, D1, R2, and Durable Objects.
See [the migration direction](docs/product-direction.md#backend-migration-direction) for the agreed scope and pending decisions.
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
| `npm run check:functions` | Check the account, attachment, and workflow functions with Deno. |
| `npm run test:functions` | Test attachment authorization and file removal with fake clients. |
| `npm test` | Run unit, script, and embedded database tests without cloud credentials. |
| `npm run test:d1` | Run the experimental D1 transaction proof with local emulation. |
| `npm run test:d1:hosted -- --account=… --database=…` | Run the proof against its explicit isolated hosted D1 target. See the proof guide for exact values. |
| `npm run test:workflow:hosted` | Verify the shared server through the deployed Supabase function on approved Minsky CI. See the [verification guide](docs/verify-server-workflow.md). |
| `npm run test:auth` | Run experimental Cloudflare account and permission tests on local D1. |
| `npm run test:auth:browser` | Check cookies, origins, and request protection with a local HTTPS Worker and Chromium. |
| `npm run test:auth:hosted -- --account=… --database=…` | Run account cases on the explicit isolated hosted authentication D1 target. |
| `npm run test:auth:http -- --account=… --database=… --origin=…` | Check the isolated deployed authentication Worker. |
| `npm run test:auth:hash` | Measure password cost in a temporary local Worker. |
| `npm run test:e2e` | Run browser tests with mocked cloud responses. |
| `npm run test:providers:list` | List the shared provider scenarios without hosted credentials. |
| `npm run test:providers -- --provider=supabase` | Run the shared contracts against an explicitly configured isolated Supabase project. |

Install Chromium once before browser tests:

```sh
npx playwright install chromium
```

Deno and the provider CLIs are pinned npm dependencies.
For `npm run test:cloud` and `npm run test:hosted`, follow [cloud verification](docs/cloud-onboarding.md#verification-and-protected-cloud-ci).
For shared adapter checks, follow [Run the shared provider tests](docs/run-provider-tests.md).
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
- [Server workflow reference](docs/server-workflow.md) inventories existing rules and the shared service and persistence boundaries.
- [Verify the shared server workflow](docs/verify-server-workflow.md) gives local, CI-only hosted, and recovery commands.
- [Backend contracts](docs/backend-contracts.md) describe the provider interfaces and their behavior.
- [Cloudflare backend design](docs/cloudflare-backend-design.md) explains the proposed server boundaries and migration decisions.
- [Cloudflare implementation plan](docs/cloudflare-implementation-plan.md) defines the work and verification required before cutover.
- [Cloudflare authentication reference](docs/cloudflare-authentication.md) defines the experimental API, browser sessions, and account rules.
- [Authentication choice](docs/cloudflare-authentication-choice.md) records Better Auth, maintained crypto, resource measurements, and costs.
- [Verify Cloudflare authentication](docs/verify-cloudflare-authentication.md) gives local, hosted, and protected CI procedures.
- [D1 transaction proof](docs/d1-transaction-proof.md) gives the local and isolated hosted verification commands.
- [Shared provider test contracts](docs/provider-test-contracts.md) describe reusable assertions, fixture ownership, and provider requirements.
- [Product direction](docs/product-direction.md) — agreed requirements and open decisions.
- [Contributor rules](AGENTS.md) and [planning record](PLAN.md).
