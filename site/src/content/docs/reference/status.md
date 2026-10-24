---
title: Feature status
description: What is merged, what is pending, and what is not verified.
---

Checked on **24 October 2026** against `main` at `c9c369b`. This is a dated record, not a live dashboard.

## In main

- Username accounts, organizer-created passwords, and organizer recovery.
- Issue lifecycle with timer, handoffs, resolutions, reopening, and awards.
- Public replies and internal notes.
- Staff image uploads with fixed visibility and session limits.
- Team search, jury award lists, and session admin tools.
- Session announcements with images, for session admins and jury (T0006, [PR #62](https://github.com/GiftedNovaHD/minsky/pull/62)).
- Three interfaces: contestant desktop, staff phone app, and staff console (T0015, [PR #44](https://github.com/GiftedNovaHD/minsky/pull/44)).
- Two backends behind one contract: Supabase and Cloudflare (T0020, [PR #42](https://github.com/GiftedNovaHD/minsky/pull/42)). Cloudflare is the live backend ([PR #57](https://github.com/GiftedNovaHD/minsky/pull/57)). The project operates no Supabase installation. The Supabase adapter stays as code that you can run on your own Supabase project.
- A verified fresh Cloudflare development installation (T0021, [PR #43](https://github.com/GiftedNovaHD/minsky/pull/43)). The owner approved the development switch and a repeat deployment. No Supabase accounts, passwords, records, images, or IDs moved.
- T0022 CI run deduplication ([PR #46](https://github.com/GiftedNovaHD/minsky/pull/46), merged).
- Workers Builds runs `npm run ci` for branches in this repository ([PR #45](https://github.com/GiftedNovaHD/minsky/pull/45)). A second trigger checks each push to `main` again and then publishes the development app. A third trigger publishes other branches to the shared preview ([PR #73](https://github.com/GiftedNovaHD/minsky/pull/73)). GitHub Actions checks are removed.
- Workers Builds publishes these docs from `main` ([PR #48](https://github.com/GiftedNovaHD/minsky/pull/48)).

## Not in main

| Work | State |
| --- | --- |
| T0007 container packaging | Open, [PR #21](https://github.com/GiftedNovaHD/minsky/pull/21). Deferred. |

## Environments

| Environment | State |
| --- | --- |
| [minsky-dev](https://minsky-dev.icaic-minsky.workers.dev) | Development only. Uses Cloudflare. Can run an older revision than `main`. |
| [minsky-preview](https://minsky-preview.icaic-minsky.workers.dev) | Shared branch preview. Uses Cloudflare with test data only. Shows the last branch that someone pushed. |
| Docs | This site. Its own Worker. Workers Builds publishes it from `main` and uploads preview versions for other branches. |
| Production | None. |

## Not verified

- Live-contest use and 800 simultaneous users.
- Offline use. Minsky needs a network connection.
- Container packaging (T0007).
- Session announcements on hosted Supabase or hosted Cloudflare, and announcement image upload in a browser.
- The procedure to run the Supabase adapter on a new Supabase project. Nobody has run it from start to end since the project retired its own Supabase projects.
- An open-source license is not chosen yet.

Before you rely on an installation, record its source revision and verification results.
