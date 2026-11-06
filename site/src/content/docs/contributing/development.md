---
title: Develop locally
description: Set up a checkout, run the app, and run the checks.
---

## Set up

Use Node.js 22.13+ (22.x) or 24+. The docs need 22.23.4+.

```sh
npm ci
cp .env.example .env.local
npm run dev                  # http://127.0.0.1:5173
```

A plain Vite server has no Cloudflare API, so sign-in fails there.
Use `npm run test:connector:ui:local` for a temporary local Cloudflare app, or the [development app](https://minsky-dev.icaic-minsky.workers.dev). Its Worker is `minsky-dev` and its D1 database is `minsky-development`.

An admin must add your account to a session. Use `npm run cloudflare:recover-admin` to recover a webmaster.

## Find application code

`src/connected/` owns authentication checks, browser routes, session data, and workflow retry protection.
`src/contestant/` contains the contestant app. It has one layout for phones and laptops.
`src/organiser/` contains the organizer phone app, desktop console, and shared forms.
`src/screens/` contains the landing page and the sign-in, password change, and session-access screens.
Features use the selected backend contracts. Provider SDKs stay inside provider implementations.
See the repository's [frontend architecture](https://github.com/GiftedNovaHD/minsky/blob/main/docs/frontend-architecture.md) for the module and route reference.

## Run the checks

| Command | Checks |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit and script tests |
| `npm run test:d1` | D1 workflow on local emulation |
| `npm run test:connector:runtime` | Cloudflare connector on a local Worker |
| `npm run build` | Production build |
| `npm run test:e2e` | Browser UI with the Cloudflare client. The test process serves the real Worker routes with local data. Set `PLAYWRIGHT_PORT` to use a port other than 4173. |

Run `npx playwright install chromium` once before browser tests.
Hosted test commands need isolated CI resources. Check their targets first, and never point them at real data. See [README.md](https://github.com/GiftedNovaHD/minsky#checks-and-common-commands) for the full list.

## Submit a change

1. Branch from updated `main`. Name the branch `<type>/<title>`, for example `bugfix/race-request-fix`.
2. Implement, verify, and update the docs in the same change.
3. Push the branch. Wait for `Workers Builds: minsky-ci` to pass.
   Test the change locally. The shared preview does not build branches now, because [branch previews are switched off](https://github.com/GiftedNovaHD/minsky/blob/main/docs/cloudflare-builds.md#publish-branch-previews).
4. Open a draft pull request into `main`. The owner reviews and merges.
5. After the merge, Workers Builds checks `main` again and publishes the development app and the docs.

[Build and publication flow](https://github.com/GiftedNovaHD/minsky/blob/main/docs/cloudflare-builds.md#build-and-publication-flow) describes each trigger.
Write D1 migrations that only add tables, columns, or indexes. The checks reject a migration that drops or renames schema.
Bootstrap and secrets are separate steps.

To add a backend, follow the [provider guide](https://github.com/GiftedNovaHD/minsky/blob/main/docs/add-provider.md). New providers must pass the shared scenarios unchanged.
