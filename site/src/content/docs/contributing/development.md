---
title: Develop Minsky locally
description: Prepare a contributor checkout and run the repository checks.
---

## Prepare your checkout

Read `PLAN.md`, `README.md`, `AGENTS.md`, and the active development ticket before changing code.
Start a ticket branch from updated `main`.
Use the `feature/tNNNN-description` naming convention.
Preserve unrelated changes in the working tree.

The application supports Node.js 22.13 or later within 22.x, or Node.js 24 or later.
The documentation package requires Node.js 22.22 or later.
Use a current Node.js 22 release or Node.js 24 to work on both.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

`.env.example` sets `VITE_BACKEND=cloudflare`.
The local page runs at `http://127.0.0.1:5173`.
A plain Vite server does not provide the Cloudflare API, so sign-in on that page fails.
The live development app is [minsky-dev.icaic-minsky.workers.dev](https://minsky-dev.icaic-minsky.workers.dev).
Its Worker is `minsky-dev` and its D1 database is `minsky-development`.
Use `npm run test:connector:ui:local` for a temporary local Cloudflare application.
Docker is optional.

## Supabase provider

Set `VITE_BACKEND=supabase` to select the Supabase provider.
Also set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
Use that project's public URL and publishable key.
An organizer must also give your account session membership.
`npm run cloud:recover-admin` recovers an administrator for this provider only.
Use `npm run cloudflare:recover-admin` for the Cloudflare development admin.
The repository guide is `docs/cloud-onboarding.md`.

## Find application code

`src/connected/` owns authentication checks, browser routes, session data, and workflow retry protection.
`src/contestant/` contains the contestant desktop app.
`src/organiser/` contains the organiser phone app, desktop console, and shared forms.
`src/screens/` contains sign-in, password change, and session-access screens.
Features use the selected backend contracts. Provider SDKs stay inside provider implementations.
See the repository's [frontend architecture](https://github.com/GiftedNovaHD/minsky/blob/main/docs/frontend-architecture.md) for the module and route reference.

## Run the checks

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check the application's TypeScript. |
| `npm run lint` | Check source rules. |
| `npm test` | Run unit, script, and embedded database tests. |
| `npm run check:functions` | Check the account and attachment functions. |
| `npm run test:functions` | Run attachment function tests with fake clients. |
| `npm run build` | Build the application. |
| `npm run test:e2e` | Check the browser UI with fictional Supabase responses. The suite sets `VITE_BACKEND=supabase`. |

Install the browser once with `npx playwright install chromium`.
Keep development and CI databases and credentials separate.
Inspect cloud-test targets before running integration tests.
Never use the CI fixture scripts against real competition data.

## Prepare the review

Implement the ticket, verify it, update its documentation, and prepare a pull request.
The owner reviews and merges.
Workers Builds runs `npm run ci` for branches in this repository. It does not publish docs or the application.
Pull request checks do not receive deployment credentials.
The repository setup guide is `docs/cloudflare-builds.md`.
Application previews remain disabled until they have independent provider resources.
Cloudflare application deployment includes its API code and bindings. Migrations and administrator bootstrap remain separate steps.
The development URL already uses Cloudflare. A later switch of that URL needs a separate owner approval.
Include the required co-author trailer in each Codex-created commit for this repository.
Follow the Google TypeScript Style Guide for TypeScript changes, with documented project exceptions.

For this site, use the separate [documentation workflow](/contributing/documentation/).

## Add a provider

Use the repository's [provider contribution guide](https://github.com/GiftedNovaHD/minsky/blob/main/docs/add-provider.md).
It identifies the shared interfaces, registration points, installation responsibilities, fixture cleanup, and required verification.
Providers must preserve the same application behavior and pass the unchanged shared scenarios.
Servers with the same HTTP protocol can reuse the existing browser transport.
Supabase and Cloudflare have implementations. AWS, GCP, and Azure remain future contributions.
