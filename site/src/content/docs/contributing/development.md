---
title: Develop locally
description: Set up a checkout, run the app without a Cloudflare account, and run the checks.
---

## Set up

Use Node.js 22.13 or later in the 22.x line, or Node.js 24 or later. The documentation site needs Node.js 22.23.4 or later. Then run `npm ci`.

## Run the complete app locally

You can run the real Worker with local copies of D1, R2, and the Durable Object, with no Cloudflare account. Follow [Run the complete app locally](https://github.com/GiftedNovaHD/minsky#run-the-complete-app-locally) in the README. Then [create an event](/guides/webmaster/#create-an-event).

## Run only the frontend

`npm run dev` serves only the frontend at `http://127.0.0.1:5173`. It has no Cloudflare API, so sign-in fails there. Use the complete app above for anything that needs a signed-in screen.

## Find application code

These folders hold the application:

- `src/connected/` owns authentication checks, browser routes, contest data, and workflow retry protection.
- `src/contestant/` contains the contestant app. It has one layout for phones and laptops.
- `src/organiser/` contains the organizer phone app, desktop console, and shared forms.
- `src/event/` contains the event console.
- `src/site/` contains the webmasters' **Site** page.
- `src/screens/` contains the landing page and the sign-in, password change, and access screens.
- `src/server/` contains the Cloudflare Worker and D1 migrations.
- `src/backend/contracts.ts` holds the shared backend contracts.

The code and the database keep the word "session" for a contest.
See the repository's [frontend architecture](https://github.com/GiftedNovaHD/minsky/blob/main/docs/frontend-architecture.md) for the module and route reference.

## Run the checks

These checks need no Cloudflare account:

```sh
npm run ci                     # build, lint, tests, docs build, audit, and secret scan
npm run test:d1                # D1 workflow on local emulation
npm run test:connector:runtime # Cloudflare connector on a local Worker
```

`npm run ci` also builds the documentation site, so it needs Node.js 22.23.4 or later.

Before the first browser test, run `npx playwright install chromium`. Then run `npm run test:e2e`.

The README's [command table](https://github.com/GiftedNovaHD/minsky#commands) lists every command. Hosted test commands need your own isolated Cloudflare resources. Check their targets first, and never point them at real data.

## Submit a change

Follow the pull request workflow in [CONTRIBUTING.md](https://github.com/GiftedNovaHD/minsky/blob/main/CONTRIBUTING.md).
