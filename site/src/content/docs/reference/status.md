---
title: Feature status
description: Distinguish merged features, pending changes, and unverified operating conditions.
---

Status recorded on **23 October 2026** against repository history.
This page is a dated record, not a live deployment dashboard.

## Merged into main

| Work | What it provides |
| --- | --- |
| T0003 | Connected Supabase accounts, shared issues, access rules, and account administration. |
| T0004 | Dark green workspace, sidebar, and phone layouts. T0015 replaces this interface. |
| [T0005](https://github.com/GiftedNovaHD/minsky/pull/19) | Staff image uploads, fixed visibility, removal, and session limits. |
| [T0008](https://github.com/GiftedNovaHD/minsky/pull/22) | Team search in the queue and staff report form. |
| [T0010](https://github.com/GiftedNovaHD/minsky/pull/24) | Refresh behavior and cloud fixture cleanup fixes. |
| [T0012](https://github.com/GiftedNovaHD/minsky/pull/30) | Reply text clears after a successful retry without duplicate history entries. |
| [T0013](https://github.com/GiftedNovaHD/minsky/pull/31) | Delayed image downloads and errors cannot replace the current preview. |
| [T0014](https://github.com/GiftedNovaHD/minsky/pull/32) | Shared backend interfaces and the retained Supabase adapter. |
| [T0015](https://github.com/GiftedNovaHD/minsky/pull/37) | Shared provider behavior tests. T0021 expands the same assertions for Supabase and Cloudflare. |
| [T0016](https://github.com/GiftedNovaHD/minsky/pull/36) | Cloudflare architecture and provider boundaries, implemented through T0020. |
| [T0017](https://github.com/GiftedNovaHD/minsky/pull/39) | Verified bounded D1 transaction proof for claims and messages. T0020 implements the complete connector separately. |
| [T0018 Cloudflare authentication](https://github.com/GiftedNovaHD/minsky/pull/40) | Username authentication, cookie sessions, and organizer recovery, retained in the complete Cloudflare connector. Hosted checks use isolated fictional fixtures. |
| [T0019 shared server workflow](https://github.com/GiftedNovaHD/minsky/pull/41) | All nine issue decisions use one shared service, verified through isolated Supabase execution. |
| [T0009 jury worklist](https://github.com/GiftedNovaHD/minsky/pull/23) | Merged at `c144a2a`. Separate lists show outstanding award decisions and external confirmations through the existing issue actions. T0015 places these lists in the redesigned award screens. |
| [T0020 complete Cloudflare connector](https://github.com/GiftedNovaHD/minsky/pull/42) | Merged at `104d9d1`. Complete backend operations, provider-owned installation tooling, private images, and live updates. |
| [T0021 fresh Cloudflare development installation](https://github.com/GiftedNovaHD/minsky/pull/43) | Merged at `4e43739`. The separately approved development switch and repeat automated deployment preserve the full Cloudflare Worker and exact resources. |
| [T0015 frontend redesign](https://github.com/GiftedNovaHD/minsky/pull/44) | Merged at `a25f9f1`. Separate contestant desktop app, organiser phone app, and organiser desktop console. |
| [T0022 CI routing](https://github.com/GiftedNovaHD/minsky/pull/46) | Merged at `a938e6a`. Repository branch pushes run ordinary checks once. Fork PR checks remain. |

## Pending changes

| Work | Status |
| --- | --- |
| [T0021 follow-up](https://github.com/GiftedNovaHD/minsky/pull/45) | Draft follow-up. Browser routes, workflow retry protections, and Workers Builds CI. GitHub Actions checks are removed. The owner reviews and merges. |
| [T0006 announcements](https://github.com/GiftedNovaHD/minsky/pull/20) | Open pull request. |
| [T0007 independent installations](https://github.com/GiftedNovaHD/minsky/pull/21) | Open pull request. Packaging exists on its branch. Container operation remains unverified. |

Cloudflare is the active development backend.
Supabase remains available as a separate provider implementation. Its existing projects and accounts remain intact.
No Supabase accounts, passwords, records, images, or IDs transferred.

T0011 adds this documentation site.
The initial docs deployment did not deploy the Minsky application or apply database migrations.
The approved activation used GitHub Actions publication. That publisher is removed. Workers Builds does not publish the docs Worker or the application.
Cloudflare app publication includes its API, bindings, schedule, and static assets.
Migrations, bootstrap, and secret creation remain separate approved operations.
A later switch of the development URL also needs a separate owner approval.

## Development and production

The shared development app is at [minsky-dev.icaic-minsky.workers.dev](https://minsky-dev.icaic-minsky.workers.dev).
The approved activation and repeat deployment used source `4e43739ac2ce56cca7e7739e4db189aa2854d4a9`.
Both passed their recorded application and resource checks.
A later owner-requested manual publication used `adff06c` before the retry fixes and frontend integration.
See the [manual publication record](https://github.com/GiftedNovaHD/minsky/blob/main/docs/t0021-run-report.md#owner-requested-manual-frontend-publication-2026-10-20) for its exact source and limits.
This integration does not read or change the live deployment.
The earlier Supabase frontend deployment used `d1c36fd` on 11 October 2026. An HTTP check on 17 October returned 200 without establishing its running source.

The documentation Worker uses its own deployment.
There is no provisioned Minsky production project in the recorded setup.

## Verification limits

- Ordinary repository checks use embedded databases and fictional browser responses.
- Protected Supabase checks use the separate **Minsky CI** project. Cloudflare checks use separate connector CI resources. A skipped job is not a passing check.
- The independent Cloudflare installation passes on review-fix source `2b6f6f0`, including the complete React workflow and owner recovery. T0007 container startup remains unverified and deferred.
- Live-contest readiness and capacity for 800 simultaneous users remain unverified.
- Offline capture, outage operation, and venue-local resilience remain deferred.
- An application license remains a decision before an open-source release.

For an installation you operate, record its exact source revision and verification results before use.
