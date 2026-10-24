---
title: Develop locally
description: Set up a checkout, run the app, and run the checks.
---

## Set up

Use Node.js 22.13+ (22.x) or 24+. The docs need 22.22+.

```sh
npm ci
cp .env.example .env.local
npm run dev                  # http://127.0.0.1:5173
```

`VITE_BACKEND` defaults to `cloudflare`. A plain Vite server has no Cloudflare API, so sign-in fails there.
Use `npm run test:connector:ui:local` for a temporary local Cloudflare app, or the [development app](https://minsky-dev.icaic-minsky.workers.dev). Its Worker is `minsky-dev` and its D1 database is `minsky-development`.

The project operates no Supabase installation. To use the Supabase adapter, run it on your own Supabase project with [Run the Supabase adapter](https://github.com/GiftedNovaHD/minsky/blob/main/docs/supabase-provider.md).
Then set `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`.
Never put a service key in a `VITE_` variable. An admin must add your account to a session.
`npm run cloud:recover-admin` recovers a Supabase admin. Use `npm run cloudflare:recover-admin` for Cloudflare.

## Find application code

`src/connected/` owns authentication checks, browser routes, session data, and workflow retry protection.
`src/contestant/` contains the contestant desktop app.
`src/organiser/` contains the organiser phone app, desktop console, and shared forms.
`src/screens/` contains sign-in, password change, and session-access screens.
Features use the selected backend contracts. Provider SDKs stay inside provider implementations.
See the repository's [frontend architecture](https://github.com/GiftedNovaHD/minsky/blob/main/docs/frontend-architecture.md) for the module and route reference.

## Run the checks

| Command | Checks |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit, script, and embedded database tests |
| `npm run test:d1` | D1 workflow on local emulation |
| `npm run test:connector:runtime` | Cloudflare connector on a local Worker |
| `npm run check:functions` | Supabase functions (Deno) |
| `npm run test:functions` | Attachment and announcement image functions with fake clients |
| `npm run build` | Production build |
| `npm run test:e2e` | Browser UI with mocked Supabase responses. The suite sets `VITE_BACKEND=supabase`. |

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
