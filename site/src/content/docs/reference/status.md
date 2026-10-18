---
title: Feature status
description: Distinguish merged features, pending changes, and unverified operating conditions.
---

Status checked on **18 October 2026** against the repository and GitHub pull requests.
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
| [T0017](https://github.com/GiftedNovaHD/minsky/pull/39) | Verified bounded D1 transaction proof for claims and messages. T0020 implements the complete connector separately. |
| [T0018 Cloudflare authentication](https://github.com/GiftedNovaHD/minsky/pull/40) | Experimental username authentication, cookie sessions, and organizer recovery. Hosted HTTP checks pass on Workers Paid with isolated fictional fixtures. T0020 implements the complete connector separately. Real-data migration remains future work. |
| [T0019 shared server workflow](https://github.com/GiftedNovaHD/minsky/pull/41) | All nine issue decisions use one shared service, verified through isolated Supabase execution. |
| [T0009 jury worklist](https://github.com/GiftedNovaHD/minsky/pull/23) | Merged at `c144a2a`. Separate lists show outstanding award decisions and external confirmations through the existing issue actions. |

## Pending changes

| Work | Status |
| --- | --- |
| [T0006 announcements](https://github.com/GiftedNovaHD/minsky/pull/20) | Open pull request. |
| [T0007 independent installations](https://github.com/GiftedNovaHD/minsky/pull/21) | Open pull request. Packaging exists on its branch. Container operation remains unverified. |
| [T0020 complete Cloudflare connector](https://github.com/GiftedNovaHD/minsky/pull/42) | Implements every backend group and provider-owned installation tooling. Both providers pass the same eight hosted scenarios. The complete hosted React journey and fresh isolated installation pass. Protected connector CI and owner review remain pending. |

Supabase remains the active backend.
The active browser retains the existing SQL workflow during Cloudflare replacement verification.

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
- Protected Supabase checks use the separate **Minsky CI** project. Cloudflare checks use separate connector CI resources. A skipped job is not a passing check.
- The fresh independent Cloudflare installation passed on `e44cb69`. T0007 container startup remains unverified and deferred.
- Live-contest readiness and capacity for 800 simultaneous users remain unverified.
- Offline capture, outage operation, and venue-local resilience remain deferred.
- An application license remains a decision before an open-source release.

For an installation you operate, record its exact source revision and verification results before use.
