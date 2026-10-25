# Scaling design

**Status.** Measured baseline and proposed plan. Nothing in the plan is implemented.

This page explains where Minsky's Cloudflare installation saturates under contest load, and ranks the changes that raise its capacity.
It covers two directions:

- Scale-up: one contest with more simultaneous users.
- Scale-out: many contests and organizations on one hosted service.

The targets are 800 simultaneous users per contest, 95% of ordinary actions within 2 seconds, and live updates within 3 seconds ([product direction](product-direction.md)).
[Run a load test](run-load-tests.md) explains the harness that produced the measurements.
The dated record of the runs is in the [run log](history/run-log.md#load-test-baseline-2026-10-25).

Each claim carries a label:

- **Measured** means a number from a recorded run on the isolated `minsky-preview-load` installation, or from Cloudflare analytics for that installation.
- **Inferred** means reasoning from measured numbers and the code at `5792530`. Nobody measured it directly.

## Summary

No tested build reached 800 users. The first limit is the live channel, and it appears at 50 to 200 users.

1. **The live channel saturates first** (measured). Each contest session has one Durable Object, and it handles every notification and every new connection one at a time. On `main` with the sign-in fix, it was busy 60 seconds of every minute at 50 users. Only 56% of screens showed a change within 3 seconds. At 100 users, none of the 50 new WebSocket connections opened.
2. **D1 throughput is the second limit** (measured). Each Worker request ran about 40 D1 queries, because Better Auth checks the database schema on every request. D1 queries stopped rising at about 3,200 per second while Worker requests rose to about 80 per second. At 200 users the Worker returned `503`. The cause of those responses is not confirmed.
3. **Turning off that schema check removes 90% of the D1 queries** (measured in a throwaway prototype). Queries fell from 40 to 4.2 per request, and the prototype served 119 requests per second at 200 users. The live channel then limited the run again.
4. **Creating accounts floods the live channel** (measured). Setup of 1,200 accounts left 4,291 notifications. They took 49 minutes to deliver, and new connections hung for about 8 minutes of that time.
5. **An ordinary action makes four requests one after another** (measured and inferred). Even at 50 users, the 95th percentile of user actions was 2.0 to 2.9 seconds in the best build.

The cost at current efficiency is small. An 8-hour contest day with 800 users uses about US$21 beyond the US$5 Workers Paid minimum, and most of it is D1 rows read (inferred from measured per-request costs). Money does not limit capacity. The design of the live channel and the per-request database work do.

## How the numbers were measured

### Installation

The installation had its own Worker, D1 database, R2 bucket, Durable Object namespace, and `AUTH_SECRET`, all named `minsky-preview-load`.
It used the configuration that `cloudflare:install configure` generates, with Worker placement `aws:ap-southeast-1`, D1 location hint `apac`, `cpu_ms: 1000`, and a cron every minute.
D1 reported that the APAC primary served requests from Hong Kong (`served_by_colo: HKG`).
Bootstrap created 480 fictional teams. `npm run load -- setup` created 240 staff accounts with the volunteer role and 960 team accounts, two for each team.
The installation was deleted after the runs. The [run log](history/run-log.md#load-test-baseline-2026-10-25) lists every resource that was created and deleted.

### Builds

On `main` at `5792530`, one IP address can sign in only 50 times in 15 minutes, so one machine cannot sign in 800 accounts.
Every build therefore included the uncommitted `bugfix/signin-failure-limits` work as a throwaway patch (SHA-256 of the exported diff `3e42da8e18ffa808…`). It counts only failed sign-ins, with 200 for each IP address and 10 for each username in 15 minutes.

| Build | Source |
| --- | --- |
| Baseline | `5792530` and the sign-in patch |
| B2+B3 | Baseline, `c5137a7` (`perf/live-batched-access`), and `7a17502` (`perf/history-index`, PR #84) |
| Prototype | B2+B3 and one line in `identity.ts`: `advanced: { database: { validateSchema: false } }` |

After the runs, PR #86 merged the sign-in limits with the same policy, and PRs #84 and #93 merged B3 and B2. `main` at `61f17ad` is therefore close to the B2+B3 build. It also has Workers Logs from PR #85 and security headers from PR #90, which these runs did not include.

### Load

Each run used `--steps=50,100,200,400,800 --ramp-seconds=30 --step-seconds=90 --issues-per-team-hour=12 --threads=8`.
Each user repeated one browser tab's requests. A Playwright capture of the built app confirmed that schedule. In 60 seconds one idle tab sent 6 each of `sessions`, `snapshot`, `announcements`, and `avatars`, and 7 `auth/session` requests.
12 issues for each team in an hour is a busy period. It produced 0.16 to 0.56 commands per second in these steps.
Each run stopped at the first step in which more than 5% of requests failed.

### The test machine was not the limit

These checks rule out the harness and the network:

- The static canary, a file that the Worker serves without D1, kept a median of 35 to 78 ms in every step, including the steps that failed.
- The harness used at most 0.43 CPU cores of 16. The 99th percentile of event-loop delay stayed at 11 to 23 ms.
- The harness received at most 3.1 MB per second of decoded response bodies. The machine downloaded 10.5 MB per second from Cloudflare before the runs.
- Cloudflare counted 1,942 to 7,499 Worker requests per minute. That matches the harness's own request rate, so the requests reached the Worker.

Other agents shared the machine. Its load average was 0.3 to 28 during the runs. Each build ran its step sequence once, so the numbers have no run-to-run spread. Treat differences under about 20% as noise.

## Results

Latency is in milliseconds. "Action p95" is the 95th percentile of a whole user action: CSRF read, command, and the refresh after it. "Live" is the share of other screens that showed a change within 3 seconds.

| Build | Users | Requests per second | Failed | Snapshot p50 / p95 | Action p95 | Live within 3 s | New sockets that opened |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 50 | 30 | 0.03% | 488 / 755 | 1,856 to 4,076 | 56% (19 commands) | 50 of 50 |
| Baseline | 100 | 56 | 4.9%, stopped | 941 / 1,445 | 4,738 to 8,697 | 41% | 0 of 50 |
| B2+B3 | 50 | 41 | 0% | 707 / 1,062 | 5,231 to 14,181 | 97% | 50 of 50 |
| B2+B3 | 100 | 66 | 2.5% | 1,466 / 2,176 | 8,335 to 22,716 | 70% | 18 of 50 |
| B2+B3 | 200 | 84 | 19%, stopped | 3,431 / 5,923 | 17,604 to 57,767 | 37% (14 commands) | 1 of 100 |
| Prototype | 50 | 40 | 0% | 341 / 628 | 2,018 to 2,949 | 99% | 50 of 50 |
| Prototype | 100 | 92 | 0.6% | 563 / 915 | 3,474 to 6,969 | 93% | 50 of 50 |
| Prototype | 200 | 119 | 5.0%, stopped | 720 / 1,285 | 2,901 to 6,843 | 45% | 1 of 100 |
| Prototype, no new issues | 200 | 106 | 5.1%, stopped | 1,035 / 1,799 | 5,128 to 6,483 | Not enough commands | 50 of 200 |

Failures in the stopped steps were WebSocket handshakes that got no `ready` message within 10 seconds, except in the B2+B3 200-user step. There the Worker also returned `503` to 12% to 25% of the requests to each read endpoint.

The builds ran one after another on the same database, so these differences are not separated from the change of build (measured):

- The data grew. The largest snapshot showed 5 issues in the first baseline step and 78 in the last prototype step, and the database held about 1,000 logins at the end.
- The command count differed at the same step: 19 commands at 50 users on the baseline, 47 on B2+B3, and 37 on the prototype.
- The baseline 100-user step included 50 first sign-ins with password changes. The later builds' 100-user steps had none, because those accounts had already changed their passwords.

Cloudflare analytics give the server-side cost per minute (measured):

| Build | Users | Worker requests | D1 queries per request | D1 rows read per request | Worker CPU per request | Durable Object busy time |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | 50 | 1,942 | 39.8 | 3,166 | 11.4 ms | 59.8 s of 60 |
| Baseline | 100 | 3,654 | 39.9 | 3,044 | 15.9 ms | 60.0 s of 60 |
| B2+B3 | 50 | 2,823 | 40.1 | 3,751 | 11.8 ms | 21.3 s of 60 |
| B2+B3 | 100 | 4,247 | 39.6 | 3,216 | 13.0 ms | 60.0 s of 60 |
| Prototype | 50 | 2,650 | 4.2 | 3,586 | 12.5 ms | 2.0 s of 60 |
| Prototype | 100 | 5,450 | 4.2 | 3,934 | 11.3 ms | 60.0 s of 60 |

## Where the system saturates

### The live channel handles one thing at a time

`SessionLiveCoordinator` runs every connect, notification, and alarm through one promise chain (`src/server/adapters/cloudflare/live.ts`, `serialize`).
A workflow command writes two notifications, `staff` and `team:<id>`. Every `POST` and `PUT` then starts a dispatcher in `waitUntil`, and the cron starts one every minute. Each dispatcher reads up to 100 undelivered rows and sends one Durable Object request for each row.

Evidence (measured):

- On the baseline at 50 users, the Durable Object was busy 59.8 seconds of each minute. It used only 0.48 seconds of CPU in that minute, so it spent the time waiting for D1, not computing.
- The `change` hint reached other screens after a median of 1.35 seconds and a 95th percentile of 5.0 seconds, with only 0.16 commands per second.
- At 100 users, all 240 connection attempts from the 50 new users timed out.
- `perf/live-batched-access` (B2) reads all socket grants in one query. It raised delivery within 3 seconds at 50 users from 56% to 97%. At 100 users the object was again busy the whole minute, and 193 connection attempts timed out.
- The same saturation stopped the prototype at 200 users, even with 90% fewer D1 queries in the Worker.
- Connections alone fill the object. In a prototype run with `--issues-per-team-hour=0`, 200 users signed in over 60 seconds with only 19 leftover staff commands. 50 sockets opened, and the other 150 users' 416 attempts timed out.

Three more costs keep the object busy (measured):

- **Duplicate dispatch.** Concurrent dispatchers read the same undelivered rows. Delivered account notifications took 2.15 attempts each, and one row took 15.
- **Abandoned work still runs.** In the prototype run, Durable Object requests had a median wall time of 6 to 10 seconds, and 100 to 600 requests each minute ended after their caller had gone. After the run ended, the object stayed busy for about 3 more minutes with no WebSocket traffic.
- **Each notification makes its own D1 round trips** to check that the session exists and to read grants, and the Worker and the D1 primary are in different locations (inferred cost per round trip: tens of milliseconds).

### Account setup floods the live channel

Each account operation writes notifications through database triggers (`0009_notifications.sql`): one for `staff`, one or more for `account:<id>`, and one for the team.
Creating 1,200 accounts through the admin API wrote 4,291 notifications (measured). Nobody was connected to most of those audiences.

- The setup took 7 minutes at 6 requests at a time, about 2.9 accounts per second (measured).
- The undelivered rows took 49 minutes to deliver after setup ended. The rate was about 95 rows per minute, close to the cron's limit of 100 for each run (measured).
- For about 8 minutes after the setup, a WebSocket upgrade got no response within 25 seconds, and `waitUntil` tasks were cancelled after 30 seconds (measured with `curl` and `wrangler tail`). Connections opened again while 2,786 rows were still undelivered, so the in-memory queue of abandoned work, not the database rows, blocked them (measured).
- The dispatcher's `SELECT … ORDER BY COALESCE(last_attempt_at, 0) …` read about 4,160 rows for each call, because no index serves that order (measured: 1,936 calls read 8.06 million rows).

A future bulk import or a roster copy (PR #80) does the same work in larger batches.
A socket can open again while thousands of rows are still undelivered. Every sign-in and command then starts a dispatcher that sends up to 100 of those rows to the object again. A load test, or a contest, that starts during the backlog measures the backlog. [Run a load test](run-load-tests.md#create-the-fictional-accounts) waits until no undelivered rows remain. The harness preflight checks only that one socket opens.

### D1 runs about 40 queries for each request

The Worker builds a new Better Auth instance for every request (`applicationWorker.ts`, `authentication(env)`).
Better Auth's Kysely adapter caches its schema check per adapter instance, so the check runs again for each request. It reads `sqlite_master` and then `pragma_table_info` for every table (`node_modules/@better-auth/kysely-adapter`, `findSchemaProblems`).

Evidence (measured):

- `SELECT * FROM pragma_table_info(?)` was the most frequent D1 statement in every window: 330,152 calls in the baseline run and 597,448 in the B2+B3 run.
- Each Worker request ran 39.6 to 40.1 D1 queries in every step of both builds.
- In the B2+B3 run, D1 queries per minute rose from 85,000 to between 156,000 and 192,000, then stopped rising. Worker requests per minute kept rising, and the Worker's median wall time rose from 0.65 to 3.0 seconds. A D1 database runs one query at a time, and Cloudflare documents a per-request overhead beyond the SQL time ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- The adapter sends the `pragma_table_info` queries for all tables in one `batch()` call, so many of the 40 queries share one round trip. The plateau of about 3,200 queries per second therefore does not convert to a ceiling for requests with a different mix of queries (inferred).
- In the 200-user step the Worker returned `503` to 12% to 25% of read requests. D1 analytics recorded no query errors in that window, so the cause is not confirmed.
- The prototype ran 4.2 queries per request. The anonymous API canary fell from a median of 229 ms to 36 ms. At 100 users, the snapshot median fell from 1,466 ms to 563 ms and failures from 2.5% to 0.6%.

### Some reads grow with the number of accounts

With 1,201 accounts and fewer than 100 issues (measured):

- The snapshot read 11,500 to 17,000 rows for each call. It was the D1 statement with the most total time once the schema check was off: 40.6 seconds of SQL in the prototype run.
- The sessions list, `SELECT s.id, s.name FROM sessions s JOIN memberships m …`, read about 1,206 rows for each call, and every user calls it every 10 seconds.

The cause is inferred: the snapshot joins the `access` common table expression in several subqueries, and SQLite can evaluate it again for each one. `memberships` has no index that starts with `account_id`. Check both with `EXPLAIN QUERY PLAN` before changing them.

### One action waits for four requests in a row

A workflow action in the frontend reads `/api/auth/session` for a CSRF token, sends the command, then reads `/api/sessions` and `/api/snapshot`, one after another (`src/backend/cloudflare/backend.ts`, `src/connected/hooks/useSessionSnapshot.ts`).
In the best build at 50 users, single requests had medians of 228 to 397 ms, and whole actions had a 95th percentile of 2.0 to 2.9 seconds (measured).
In the B2+B3 run, actions at 50 users had a 95th percentile of 5.2 to 14.2 seconds (measured). That run also had 2.5 times as many commands as the baseline at the same step. The frontend queues every refresh behind the earlier ones, and B2 delivered more `change` hints, each of which queues a full refresh. Actions then wait behind those refreshes (inferred, not separated from the larger command count). Do not read the number as a regression of B2 without a run that alternates the builds.
Each request makes several D1 round trips in sequence, and the Worker and the D1 primary are in different cities (inferred). The 2-second target for actions needs fewer requests per action, not only a faster database.

### Password hashing during the sign-in burst

At the 100-user baseline step, 50 accounts signed in for the first time within 30 seconds and changed their temporary passwords (measured):

- The whole first sign-in took a median of 7.4 seconds and a 95th percentile of 10.2 seconds.
- The password change alone took a median of 3.3 seconds.
- Worker CPU per invocation reached a 99th percentile of 63 to 116 ms across all steps. Cloudflare recorded no Worker errors in the baseline run.

In the B2+B3 200-user step, 27 of 98 password changes failed with `503` (measured). Other endpoints failed in the same window, so the hashing is not the likely cause (inferred). The cause is not confirmed.

## Scale-up plan

The items are in order of expected gain for the 800-user target. Each item is one small pull request with its own check. Rerun `npm run load` after each one.

1. **Turn off Better Auth's runtime schema check.** Add `advanced: { database: { validateSchema: false } }` in `identity.ts`. Minsky's own D1 migrations own the schema, and `npm test` already checks them.
   - Expected gain: D1 queries per request fall from about 40 to about 4. With that change the installation served 119 requests per second at 200 users with a snapshot median of 720 ms, where B2+B3 served 84 with a median of 3,431 ms and `503` responses (measured). The new D1 ceiling is not measured, because the live channel stopped the run first.
   - Smallest PR: `perf/auth-schema-check`, with a test that counts D1 statements for one authenticated request.
2. **Deliver each notification once.** Claim rows atomically, for example `UPDATE … SET claimed_until = … WHERE … RETURNING`, so concurrent dispatchers do not send the same row. Send one Durable Object request for each session with only the highest sequence for each audience. Add an index for the pending order. Do not write `account:<id>` notifications for accounts that have no session login, or coalesce them.
   - Expected gain: account setup no longer floods the live channel, and the object handles one request per batch instead of one per row (inferred from 2.15 attempts per row and 4,291 rows for 1,200 accounts).
   - Smallest PR: `perf/notification-dispatch`, with a test that two concurrent dispatchers deliver each row once.
3. **Stop serializing connects behind notifications, and drop abandoned work.** Only the cursor update in `notify` needs the chain. A connect can check its grant and accept the socket without waiting. Skip queued work whose caller has gone.
   - Expected gain: new connections open in about one D1 round trip under load. Today Durable Object requests wait 6 to 10 seconds in the queue under load, or time out (measured).
   - Smallest PR: `perf/live-connect`, with a test that a connect completes while a slow notification runs.
4. **Stop the 10-second polls while the socket is connected.** Keep a slow safety poll, for example 60 seconds with jitter, and keep refresh on focus and on `change`. Fold account status and announcements into the snapshot. This is step 2 of B3 in the readiness checklist.
   - Expected gain: an idle user sends about 0.1 instead of 0.53 requests per second (0.53 measured at 200 users, 0.1 inferred), so 800 idle users send about 80 instead of 420 requests per second.
   - Smallest PR: `perf/poll-when-disconnected`.
5. **Make an action one or two requests.** Keep the CSRF token from the session read, because it does not change during a login. Return the changed issue from `POST /api/workflow` and patch it into the screen. Skip the extra `sessions` read after a command.
   - Expected gain: an action waits for one or two requests instead of four (inferred, with a 95th percentile of about 1 second at the measured request latency).
   - Smallest PR: `perf/action-round-trips`, frontend only.
6. **Make reads independent of the number of accounts.** Evaluate the `access` expression once in the snapshot, and add an index on `memberships(account_id, session_id)` (an additive migration).
   - Expected gain: rows read per snapshot fall from about 11,500 to 17,000 toward the number of visible rows (inferred). Rows read are also the main cost item.
   - Smallest PR: `perf/snapshot-access`, with an `EXPLAIN QUERY PLAN` guard like PR #84.
7. **Send changes, not full snapshots.** Return only rows whose revision passed the client's last revision, or keep the staff snapshot in the session Durable Object and invalidate it on `notify`. Do this after items 4 and 6, because each live change still makes every staff screen read a full snapshot.
   - Expected gain: snapshot bytes and rows grow with changes, not with all issues (inferred).
   - Smallest PR: a design note first, because the cache must never show stale permissions.
8. **Put the Worker next to its database, or read from replicas.** Set the placement region to the D1 primary's region, or use D1 read replication through the Sessions API for snapshots and session reads.
   - Expected gain: each of the several D1 round trips per request gets shorter (inferred, not measured). Measure with the harness before and after.
   - Smallest PR: a configuration change on a test installation. The Sessions API needs bookmark handling for read-after-write.
9. **Spread the first sign-in burst.** Hand out credentials in waves, or let team accounts keep their first password. The second is a product decision.
   - Expected gain: about three password hashes per first sign-in leave the burst (inferred from the code).
   - Smallest PR: documentation for waves. The forced change needs an owner decision.

B2 (PR #93) and B3 (PR #84) are now on `main`. B2 raised delivery within 3 seconds at 50 users from 56% to 97%, and B3 adds the history index. Neither changes where the system saturates.

## Scale-out plan

Scale-out runs many contests and organizations on one service. The [multi-competition design](https://github.com/GiftedNovaHD/minsky/pull/80) proposes one organization per installation, with competitions as `events` and contests as `sessions`.

### One database for each organization

Keep one D1 database for each organization, as PR #80 proposes. Do not put all organizations in one database.

- One D1 database runs one query at a time. The prototype held 119 requests per second, which is a lower bound for one database (measured). The ceiling is not measured. Measure it with the harness after scale-up items 1 to 3, so that the live channel does not stop the run first. One busy contest must not slow another organization's contest.
- A D1 database holds at most 10 GB, and that limit cannot be raised. Workers Paid allows 50,000 databases for each account, and Cloudflare raises that on request ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- Per-competition databases are possible later, because all operational data already belongs to one session. They would split accounts and usernames, which PR #80 keeps per organization. Wait until one organization nears the limits above.

A hosted service then needs a small control plane that maps an organization to its database. One Worker script can bind about 5,000 D1 databases (D1 limits). Beyond that, or for stronger isolation, use one Worker for each organization, for example with Workers for Platforms. That choice and its cost belong to the owner.

### One Durable Object for each contest session

Keep the current shape: `idFromName(sessionId)` gives each session its own object, so contests do not share a live channel.
Each object is still one thread, so items 2 and 3 of the scale-up plan set the limit for each contest. Many contests add objects, not load on one object.

### Images

Keep one private R2 bucket for each organization, next to its database, so that deleting an organization deletes one bucket. Inside it, keep the session-scoped keys that exist today. R2 has no egress charge, so storage dominates its cost.

### Cost

The figures are from Cloudflare's [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and the measured costs per request. The estimate is for an 8-hour contest day with 800 users at today's 0.53 requests per user per second (inferred):

| Item | Usage | Estimate |
| --- | --- | --- |
| Worker requests | 12.2 million | About US$0.66 after 10 million included |
| Worker CPU | 12 ms per request, about 150 million ms | About US$2.40 after 30 million ms included |
| D1 rows read | About 3,500 per request, about 43 billion | About US$18 after 25 billion included |
| D1 rows written | Under 1 million | Included |
| Durable Object time | One object busy for 8 hours, about 3,700 GB-s | Included in 400,000 GB-s |

Rows read dominate, and scale-up items 4 and 6 reduce them. Nothing in these measurements needs a plan change beyond Workers Paid. The D1 throughput limit is per database, not per plan.

## Decisions for the owner

- Whether team accounts must change their temporary password at first sign-in (scale-up item 9 and readiness item S4).
- The D1 location and Worker placement for production, so that they are next to each other and near the venue (item 8).
- For a hosted service: one Worker for all organizations or one for each, and whether to use Workers for Platforms.
- Until scale-up item 2 ships, whether the contest procedure waits until no setup notifications remain undelivered.
