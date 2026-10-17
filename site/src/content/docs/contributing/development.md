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
The user reviews and merges.
Maintainers selected branch previews and automatic frontend deployment from `main` through Cloudflare Git builds.
The Git connections and first automatic builds remain unverified.
Backend deployment remains a separate step.
Include the required co-author trailer in each Codex-created commit for this repository.
Follow the Google TypeScript Style Guide for TypeScript changes, with documented project exceptions.

For this site, use the separate [documentation workflow](/contributing/documentation/).
