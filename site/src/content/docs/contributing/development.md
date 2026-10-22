---
title: Develop locally
description: Set up a checkout, run the app, and run the checks.
---

## Set up

Use Node.js 22.13+ (22.x) or 24+. The docs need 22.22+.

```sh
npm ci
cp .env.example .env.local   # set the development Supabase URL and publishable key
npm run dev                  # http://127.0.0.1:5173
```

Never put a service key in a `VITE_` variable. An admin must add your account to a session.
`VITE_BACKEND` defaults to `supabase`. A Cloudflare build sets `VITE_BACKEND=cloudflare` and needs its Worker for the API.

## Run the checks

| Command | Checks |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Unit, script, and embedded database tests |
| `npm run test:d1` | D1 workflow on local emulation |
| `npm run test:connector:runtime` | Cloudflare connector on a local Worker |
| `npm run check:functions` | Supabase functions (Deno) |
| `npm run test:functions` | Attachment function with fake clients |
| `npm run build` | Production build |
| `npm run test:e2e` | Browser UI with mocked responses |

Run `npx playwright install chromium` once before browser tests.
Hosted test commands need isolated CI resources. Check their targets first, and never point them at real data. See [README.md](https://github.com/GiftedNovaHD/minsky#checks-and-common-commands) for the full list.

## Submit a change

1. Branch from updated `main` as `feature/tNNNN-description`.
2. Implement, verify, and update the docs in the same change.
3. Open a pull request. The owner reviews and merges.

When deployment is enabled, CI publishes the docs and the app from `main` after `checks`, `secrets`, and `dependencies` pass.
Migrations, bootstrap, and secrets are separate steps.

To add a backend, follow the [provider guide](https://github.com/GiftedNovaHD/minsky/blob/main/docs/add-provider.md). New providers must pass the shared scenarios unchanged.
