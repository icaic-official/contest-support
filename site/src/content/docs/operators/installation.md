---
title: Prepare an independent installation
description: Choose a frontend host, prepare a separate Supabase backend, and understand the T0007 limits.
---

:::caution[T0007 is pending review]
The packaging described here exists on `feature/t0007-self-hosting-scaffold` in [PR #21](https://github.com/GiftedNovaHD/minsky/pull/21).
It is not yet part of `main`.
Container startup and the complete workflow against a fresh independent backend remain unverified.
Use it for an installation trial until those checks pass.
:::

## Choose a hosting path

| Path | Frontend | Backend |
| --- | --- | --- |
| Managed services | Cloudflare Workers Static Assets | Your own hosted Supabase project |
| Your server | The T0007 frontend container behind an HTTPS reverse proxy | Your own prepared Supabase backend |
| Full self-hosting | The T0007 frontend container | Supabase's own service stack, which still needs compatibility verification |

The frontend is the website that runs in the browser.
The backend stores accounts, contest records, and private images.
Minsky needs Supabase Auth, Postgres, Realtime, Storage, and Edge Functions.
A plain Postgres database is insufficient.
The T0007 Compose file contains only the frontend.

## Prepare the source

Use a separate checkout for your competition.
Select the reviewed source revision and record it.
While T0007 is pending, its packaging can be inspected with these commands:

```sh
git clone https://github.com/GiftedNovaHD/minsky.git
cd minsky
git switch feature/t0007-self-hosting-scaffold
git rev-parse HEAD
npm ci
```

Repository access is required while the source is private.
The checked T0007 revision was `c9c3116` on 17 October 2026.
Review later changes before using a different revision.
Use the repository's supported Node.js version.

Prepare the [backend and first administrator](/operators/backend/) before serving the frontend.

## Option A: Cloudflare Workers

Use the generic T0007 configuration for your installation.
The root `wrangler.jsonc` targets the original Minsky development app.

```sh
cp deploy/wrangler.example.jsonc deploy/wrangler.jsonc
cp .env.example .env.local
```

Set a unique Worker name in `deploy/wrangler.jsonc`.
Select your Cloudflare account through your local Wrangler login.
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` for your backend.
These values become public browser assets.
Never use a service-role key or secret key here.

Build and inspect the deployment target:

```sh
npx wrangler login
npx wrangler whoami
npm run build
npx wrangler deploy --config deploy/wrangler.jsonc --dry-run
```

After checking the account, Worker name, and backend URL, publish that frontend:

```sh
npx wrangler deploy --config deploy/wrangler.jsonc
```

Use the returned address in the backend's allowed origins and redirect settings.
Cloudflare gives each Worker an address in the form `<worker>.<account-subdomain>.workers.dev`.
A custom domain is optional.
See [Cloudflare's address rules](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## Option B: EC2 or another server

Install Docker Engine and the Compose plugin on your server.
Prepare a public HTTPS address and a reverse proxy, which forwards requests to the local frontend.
Provision persistent storage and backups for your backend separately.

On the T0007 checkout:

```sh
cp deploy/.env.example deploy/.env
```

Set the browser-accessible Supabase URL and public key in `deploy/.env`.
A Docker-internal hostname is not a browser-accessible backend address.
Check the settings, then build and start the frontend:

```sh
npm run installation:check
docker compose --env-file deploy/.env -p minsky up --build --detach --wait
node scripts/container-smoke.mjs
```

The default local address is `http://127.0.0.1:8080`.
Configure the server's HTTPS reverse proxy to use that address.
If you change `MINSKY_HTTP_PORT`, pass the new local URL to `container-smoke.mjs`.
Changing the Supabase URL or public key requires a new frontend build.

The smoke script checks HTTP behavior and assets.
It does not verify the authenticated contest workflow.
Complete the [installation verification](/operators/verification/) before use.

To stop only this frontend:

```sh
docker compose --env-file deploy/.env -p minsky down
```

For full backend self-hosting, start with [Supabase's official Docker guide](https://supabase.com/docs/guides/self-hosting/docker).
The Minsky project does not yet certify a self-hosted Supabase version set.
