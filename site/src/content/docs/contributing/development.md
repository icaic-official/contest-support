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
```

Set the development project's public Supabase URL and publishable key in `.env.local`.
An organizer must also give your account session membership.
Start the frontend with:

```sh
npm run dev
```

The local app runs at `http://127.0.0.1:5173`.
It uses the configured backend.
Docker is optional for connected development.

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
| `npm run test:e2e` | Check the browser UI with fictional cloud responses. |

Install the browser once with `npx playwright install chromium`.
Keep development and CI databases and credentials separate.
Inspect cloud-test targets before running integration tests.
Never use the CI fixture scripts against real competition data.

## Prepare the review

Implement the ticket, verify it, update its documentation, and prepare a pull request.
The owner reviews and merges.
After account setup, GitHub Actions publishes docs previews and stable sites from `main` only when all required CI jobs pass.
Pull request checks do not receive deployment credentials.
The repository setup guide is `docs/cloudflare-builds.md`.
Application previews remain disabled until they have independent provider resources.
Cloudflare application deployment includes its API code and bindings. Migrations and administrator bootstrap remain separate steps.
Switching the development URL to Cloudflare requires the owner's separate activation approval.
Include the required co-author trailer in each Codex-created commit for this repository.
Follow the Google TypeScript Style Guide for TypeScript changes, with documented project exceptions.

For this site, use the separate [documentation workflow](/contributing/documentation/).

## Add a provider

Use the repository's [provider contribution guide](https://github.com/GiftedNovaHD/minsky/blob/main/docs/add-provider.md).
It identifies the shared interfaces, registration points, installation responsibilities, fixture cleanup, and required verification.
Providers must preserve the same application behavior and pass the unchanged shared scenarios.
Servers with the same HTTP protocol can reuse the existing browser transport.
Supabase and Cloudflare have implementations. AWS, GCP, and Azure remain future contributions.
