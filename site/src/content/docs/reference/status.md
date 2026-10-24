---
title: Feature status
description: What is merged, what is pending, and what is not verified.
---

Checked on **23 October 2026** against `main` at `21bfd6e`. This is a dated record, not a live dashboard.

## In main

- Username accounts, organizer-created passwords, and organizer recovery.
- Issue lifecycle with timer, handoffs, resolutions, reopening, and awards.
- Public replies and internal notes.
- Staff image uploads with fixed visibility and session limits.
- Team search, jury award lists, and session admin tools.
- Three interfaces: contestant desktop, staff phone app, and staff console (T0015, [PR #44](https://github.com/GiftedNovaHD/minsky/pull/44)).
- Two backends behind one contract: Supabase and Cloudflare (T0020, [PR #42](https://github.com/GiftedNovaHD/minsky/pull/42)). Cloudflare is the live backend. Supabase stays a supported second provider ([PR #57](https://github.com/GiftedNovaHD/minsky/pull/57)).
- A verified fresh Cloudflare development installation (T0021, [PR #43](https://github.com/GiftedNovaHD/minsky/pull/43)). The owner approved the development switch and a repeat deployment. No Supabase accounts, passwords, records, images, or IDs moved.
- T0022 CI run deduplication ([PR #46](https://github.com/GiftedNovaHD/minsky/pull/46), merged).
- Workers Builds runs `npm run ci` for branches in this repository ([PR #45](https://github.com/GiftedNovaHD/minsky/pull/45)). A second trigger checks each push to `main` again and then publishes the development app. GitHub Actions checks are removed.

## Not in main

| Work | State |
| --- | --- |
| T0006 session announcements | Open, [PR #62](https://github.com/GiftedNovaHD/minsky/pull/62). It replaces PR #20, which is closed. |
| T0007 container packaging | Open, [PR #21](https://github.com/GiftedNovaHD/minsky/pull/21). Deferred. |

## Environments

| Environment | State |
| --- | --- |
| [minsky-dev](https://minsky-dev.icaic-minsky.workers.dev) | Development only. Uses Cloudflare. Can run an older revision than `main`. |
| Docs | This site. Its own Worker. Workers Builds publishes it from `main` and uploads preview versions for other branches. |
| Production | None. |

## Not verified

- Live-contest use and 800 simultaneous users.
- Offline use. Minsky needs a network connection.
- Container packaging (T0007).
- An open-source license is not chosen yet.

Before you rely on an installation, record its source revision and verification results.
