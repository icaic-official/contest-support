---
title: Feature status
description: Distinguish merged features, pending changes, and unverified operating conditions.
---

Status checked on **17 October 2026** against the repository and GitHub pull requests.
This page is a dated record, not a live deployment dashboard.

## Merged into main

| Work | What it provides |
| --- | --- |
| T0003 | Connected Supabase accounts, shared issues, access rules, and account administration. |
| T0004 | Dark green workspace, sidebar, and phone layouts. |
| [T0005](https://github.com/GiftedNovaHD/minsky/pull/19) | Staff image uploads, fixed visibility, removal, and session limits. |
| [T0008](https://github.com/GiftedNovaHD/minsky/pull/22) | Team search in the queue and staff report form. |
| [T0010](https://github.com/GiftedNovaHD/minsky/pull/24) | Refresh behavior and cloud fixture cleanup fixes. |
| [T0012](https://github.com/GiftedNovaHD/minsky/pull/30) | Reply text clears after a successful retry without duplicate history entries. |
| [T0013](https://github.com/GiftedNovaHD/minsky/pull/31) | Delayed image downloads and errors cannot replace the current preview. |
| [T0014](https://github.com/GiftedNovaHD/minsky/pull/32) | Shared backend interfaces and the active Supabase adapter. |
| [T0015](https://github.com/GiftedNovaHD/minsky/pull/37) | Shared provider behavior tests, verified against isolated Supabase fixtures. |
| [T0016](https://github.com/GiftedNovaHD/minsky/pull/36) | Proposed Cloudflare architecture and implementation plan. |

## Pending changes

| Work | Status |
| --- | --- |
| [T0006 announcements](https://github.com/GiftedNovaHD/minsky/pull/20) | Open pull request. |
| [T0007 independent installations](https://github.com/GiftedNovaHD/minsky/pull/21) | Open pull request. Packaging exists on its branch. Container operation remains unverified. |
| [T0009 jury worklist](https://github.com/GiftedNovaHD/minsky/pull/23) | Draft pull request. |
| T0017 D1 transaction proof | Experimental store for claims and messages. The Cloudflare connector remains incomplete. Supabase remains active. |

T0011 adds this documentation site.
The initial docs deployment did not deploy the Minsky application or apply database migrations.
After activation, the CI workflow publishes both frontends when all required checks pass.
Backend deployment remains separate.

## Development and production

The shared development app is at [minsky-dev.icaic-minsky.workers.dev](https://minsky-dev.icaic-minsky.workers.dev).
Its latest recorded main-site deployment is revision `d1c36fd` from 11 October 2026.
An HTTP check on 17 October returned 200, but did not establish the running source revision.
Merged features are not necessarily available at that address yet.

The documentation Worker uses its own deployment.
There is no provisioned Minsky production project in the recorded setup.

## Verification limits

- Ordinary repository checks use embedded databases and fictional browser responses.
- Protected cloud checks use the separate **Minsky CI** project. A skipped cloud job is not a passing cloud test.
- T0007 container startup and a fresh independent backend's complete workflow still need operator verification.
- Live-contest readiness and capacity for 800 simultaneous users remain unverified.
- Offline capture, outage operation, and venue-local resilience remain deferred.
- An application license remains a decision before an open-source release.

For an installation you operate, record its exact source revision and verification results before use.
