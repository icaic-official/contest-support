# Scaling design

**Status.** Measured baselines and a partly implemented plan.
Scale-up items 1, 2 and 6 are implemented. Items 4 and 5 are partly implemented. Items 3, 7, 8 and 9 are open. The [status table](#status-of-the-plan) gives the commits.
Nobody has run a hosted load test since these changes. No tested build has reached the 800-user target, and the current code is not tested on a hosted installation.

This page explains where Minsky's Cloudflare installation saturates under contest load, and ranks the changes that raise its capacity.
It covers two directions:

- Scale-up: one contest with more simultaneous users.
- Scale-out: many contests and organizations on one hosted service.

The targets are 800 simultaneous users per contest, 95% of ordinary actions within 2 seconds, and live updates within 3 seconds ([product direction](product-direction.md)).
Two kinds of measurement exist:

- A hosted load test on 2026-10-25, of builds based on `5792530`. [Run a load test](run-load-tests.md) explains the harness. The dated record of the runs is in the [run log](history/run-log.md#load-test-baseline-2026-10-25). The code has changed since then, so this page keeps those results as a dated record.
- Local read counts on 2026-10-26, from `npm run perf:reads`. They count the D1 rows that each request reads, on `main` at `f978488` and after the read reductions at `247e4a7`. The [read-volume baseline](history/read-volume-baseline-2026-10-26.md) records the method and the first run. [Rerun the measurement](history/read-volume-baseline-2026-10-26.md#rerun-the-measurement) gives the commands.

Each claim carries a label:

- **Measured, hosted** means a number from the 2026-10-25 run on the isolated `minsky-preview-load` installation, or from Cloudflare analytics for that installation.
- **Measured, local** means a number that `npm run perf:reads` printed on a seeded local D1 database. The counts are rows and D1 calls. They are not time, and they are not capacity.
- **Inferred** means reasoning from measured numbers and the code at `247e4a7`. Nobody measured it directly.
- **Documented** means a statement in the Cloudflare documentation, read on 2026-10-26. The link follows the claim.

## Summary

The hosted run of 2026-10-25 found these limits (measured, hosted, on builds based on `5792530`):

1. **The live channel saturated first.** Each contest session has one Durable Object, and it handled every notification and every new connection one at a time. With the sign-in fix, it was busy 60 seconds of every minute at 50 users. Only 56% of screens showed a change within 3 seconds. At 100 users, none of the 50 new WebSocket connections opened.
2. **D1 throughput was the second limit.** Each Worker request ran about 40 D1 queries, because Better Auth checked the database schema on every request. D1 queries stopped rising at about 3,200 per second while Worker requests rose to about 80 per second. At 200 users the Worker returned `503`. The cause of those responses is not confirmed.
3. **Turning off that schema check removed 90% of the D1 queries** (in a throwaway prototype). Queries fell from 40 to 4.2 per request, and the prototype served 119 requests per second at 200 users. The live channel then limited the run again.
4. **Creating accounts flooded the live channel.** Setup of 1,200 accounts left 4,291 notifications. They took 49 minutes to deliver, and new connections hung for about 8 minutes of that time.
5. **An ordinary action made four requests one after another.** Even at 50 users, the 95th percentile of user actions was 2.0 to 2.9 seconds in the best build.

Since that run, the code has changed:

- Better Auth no longer checks the schema at run time, and one instance serves many requests (`e1325bd`). A read request now makes 3 or 4 D1 calls (measured, local).
- Notification delivery claims rows once and sends one request for each session (`83849fc`). Account setup no longer writes account notifications for accounts that have no login (migration `0014_notification_claims.sql`).
- An action is one request (`8234216`). The response carries the snapshot.
- Most reads no longer grow with data that they do not return (`5aafc3c` and the read reductions). The minute cron reads 24 rows instead of 7,880, and the staff avatar list reads 30 instead of 8,416 (measured, local).

The live channel still handles every connection and notification one at a time, and it still rechecks every socket on every notification (inferred from `src/server/adapters/cloudflare/live.ts`). It is probably still the first limit (inferred). Only a new hosted load test can show the current limit.

The cost at the 2026-10-25 efficiency was small. An 8-hour contest day with 800 users used about US$21 beyond the US$5 Workers Paid minimum, and most of it was D1 rows read (inferred from measured, hosted per-request costs). Money does not limit capacity. The design of the live channel and the per-request database work do.

## How the numbers were measured

The first four sections describe the hosted run of 2026-10-25. The last section describes the local read counts.

### Installation

The installation had its own Worker, D1 database, R2 bucket, Durable Object namespace, and `AUTH_SECRET`, all named `minsky-preview-load`.
It used the configuration that `cloudflare:install configure` generates, with Worker placement `aws:ap-southeast-1`, D1 location hint `apac`, `cpu_ms: 1000`, and a cron every minute.
D1 reported that the APAC primary served requests from Hong Kong (`served_by_colo: HKG`).
Bootstrap created 480 fictional teams. `npm run load -- setup` created 240 staff accounts with the volunteer role and 960 team accounts, two for each team.
The installation was deleted after the runs. The [run log](history/run-log.md#load-test-baseline-2026-10-25) lists every resource that was created and deleted.

### Builds

On `main` at `5792530`, one IP address could sign in only 50 times in 15 minutes, so one machine could not sign in 800 accounts.
Every build therefore included the uncommitted `bugfix/signin-failure-limits` work as a throwaway patch (SHA-256 of the exported diff `3e42da8e18ffa808…`). It counts only failed sign-ins, with 200 for each IP address and 10 for each username in 15 minutes.

| Build | Source |
| --- | --- |
| Baseline | `5792530` and the sign-in patch |
| B2+B3 | Baseline, `c5137a7` (`perf/live-batched-access`), and `7a17502` (`perf/history-index`, PR #84) |
| Prototype | B2+B3 and one line in `identity.ts`: `advanced: { database: { validateSchema: false } }` |

After the runs, PR #86 merged the sign-in limits with the same policy, and PRs #84 and #93 merged B3 and B2. `main` at `61f17ad` was therefore close to the B2+B3 build. It also had Workers Logs from PR #85 and security headers from PR #90, which these runs did not include.

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

### Local read counts

`npm run perf:reads` runs the real application Worker in Node against a local D1 database. It counts the D1 calls, statements and rows of each request.
The base shape has 1,200 accounts, 24 teams, 100 issues with 5 history rows and 3 images each, and a ready profile picture for every account. The full plan also changes one size at a time, up to 4,800 accounts, 400 issues and 480 teams.
The counts repeat exactly on the same data. Rows read on local D1 should match hosted D1, because both use SQLite (inferred). Nobody compared them on a hosted database.
The [read-volume baseline](history/read-volume-baseline-2026-10-26.md#method) describes the callers, the seed and the checks of the measurement.

## Results

### Hosted load test, 2026-10-25

These are the measured, hosted results of the builds above. They describe code that has changed since. Latency is in milliseconds. "Action p95" is the 95th percentile of a whole user action: CSRF read, command, and the refresh after it. "Live" is the share of other screens that showed a change within 3 seconds.

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

The builds ran one after another on the same database, so these differences are not separated from the change of build (measured, hosted):

- The data grew. The largest snapshot showed 5 issues in the first baseline step and 78 in the last prototype step, and the database held about 1,000 logins at the end.
- The command count differed at the same step: 19 commands at 50 users on the baseline, 47 on B2+B3, and 37 on the prototype.
- The baseline 100-user step included 50 first sign-ins with password changes. The later builds' 100-user steps had none, because those accounts had already changed their passwords.

Cloudflare analytics give the server-side cost per minute (measured, hosted):

| Build | Users | Worker requests | D1 queries per request | D1 rows read per request | Worker CPU per request | Durable Object busy time |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | 50 | 1,942 | 39.8 | 3,166 | 11.4 ms | 59.8 s of 60 |
| Baseline | 100 | 3,654 | 39.9 | 3,044 | 15.9 ms | 60.0 s of 60 |
| B2+B3 | 50 | 2,823 | 40.1 | 3,751 | 11.8 ms | 21.3 s of 60 |
| B2+B3 | 100 | 4,247 | 39.6 | 3,216 | 13.0 ms | 60.0 s of 60 |
| Prototype | 50 | 2,650 | 4.2 | 3,586 | 12.5 ms | 2.0 s of 60 |
| Prototype | 100 | 5,450 | 4.2 | 3,934 | 11.3 ms | 60.0 s of 60 |

### Local read counts, 2026-10-26

These are measured, local rows read at the base shape. "Before" is `main` at `f978488`. "After" is `247e4a7`.
Rows read include the notification dispatch after a `POST` and the claim in the cron tick.

| Request | Caller | Before | After | Growth after the change |
| --- | --- | --- | --- | --- |
| Public reply, all 1,200 members connected | Volunteer | 10,790 | 9,892 | 6 per connected socket, 25 per issue, 2 per history row, 2 per team |
| Live alarm, 1,200 sockets, at most every 30 seconds | Coordinator | 7,211 | 7,211 | 6 per connected socket |
| `GET /api/snapshot` | Admin | 7,005 | 6,187 | 3 per member, 25 per issue, 2 per history row, 2 per team |
| `POST /api/workflow` claim | Volunteer | 3,595 | 2,702 | 25 per issue, 2 per history row, 2 per team |
| `GET /api/snapshot` | Volunteer | 3,406 | 2,587 | 25 per issue, 2 per history row, 2 per team |
| `POST /api/workflow` submit | Contestant | 375 | 231 | The team's issues. 165 at 480 teams, where it read 2,564 |
| `GET /api/snapshot` | Contestant | 201 | 124 | The team's issues. 58 at 480 teams, where it read 1,023 |
| Cron tick, every minute | Scheduler | 7,880 | 24 | Flat from 300 to 4,800 accounts |
| `GET /api/avatars` | Volunteer | 8,416 | 30 | Flat. 30 at 4,800 accounts, where it read 33,616 |
| `GET /api/avatars` | Contestant | 6,005 | 17 | Flat |
| `GET /api/announcements` | Any | 104 | 104 | Flat in accounts, issues and teams |
| `POST /api/auth/sign-in` | Any | 22 | 22 | Flat |
| `GET /api/contests` (then named `/api/sessions`) | Any | 12 | 12 | Flat |
| `GET /api/auth/session` | Any | 5 | 5 | Flat |

Without the dispatch, the claim request reads 3,541 rows before and 2,648 after, the submit request reads 323 and 179, and the cron tick reads 7,877 and 21 (measured, local).
The 4,800-account avatar count of 33,616 at `f978488` is inferred from the measured slope of 7 rows for each ready avatar. The avatar statement alone read 33,611 rows at that size ([read-volume baseline](history/read-volume-baseline-2026-10-26.md#h1-avatar-list)). The count of 30 at 4,800 accounts is measured, local, with migration `0016_staff_membership_index.sql`.

Every live hint makes each open screen read `/api/contests`, `/api/snapshot`, `/api/announcements` and `/api/avatars` again. The sum of those four reads is the cost of one screen for one hint (measured, local parts, inferred sum):

| Caller | Before | After | At 4,800 accounts and 400 issues, after |
| --- | --- | --- | --- |
| Admin | 14,339 | 6,332 | 24,632 |
| Volunteer, jury | 11,938 | 2,733 | 10,233 |
| Contestant | 6,322 | 257 | 554 |

## Where the system saturates

### The live channel handles one thing at a time

`SessionLiveCoordinator` runs every connect, notification, and alarm through one promise chain (`src/server/adapters/cloudflare/live.ts`, `serialize`). This is still true at `247e4a7`.
A workflow command writes two notifications, `staff` and `team:<id>`. Every `POST` and `PUT` then starts a dispatcher in `waitUntil`, and the cron starts one every minute.
At `5792530` each dispatcher read up to 100 undelivered rows and sent one Durable Object request for each row.
Since `83849fc` a dispatcher claims up to 500 rows with one `UPDATE … RETURNING` statement and sends one request for each session.

Evidence (measured, hosted, on builds based on `5792530`):

- On the baseline at 50 users, the Durable Object was busy 59.8 seconds of each minute. It used only 0.48 seconds of CPU in that minute, so it spent the time waiting for D1, not computing.
- The `change` hint reached other screens after a median of 1.35 seconds and a 95th percentile of 5.0 seconds, with only 0.16 commands per second.
- At 100 users, all 240 connection attempts from the 50 new users timed out.
- `perf/live-batched-access` (B2) reads all socket grants in one query. It raised delivery within 3 seconds at 50 users from 56% to 97%. At 100 users the object was again busy the whole minute, and 193 connection attempts timed out.
- The same saturation stopped the prototype at 200 users, even with 90% fewer D1 queries in the Worker.
- Connections alone filled the object. In a prototype run with `--issues-per-team-hour=0`, 200 users signed in over 60 seconds with only 19 leftover staff commands. 50 sockets opened, and the other 150 users' 416 attempts timed out.

Three more costs kept the object busy in that run (measured, hosted):

- **Duplicate dispatch.** Concurrent dispatchers read the same undelivered rows. Delivered account notifications took 2.15 attempts each, and one row took 15. Since `83849fc` the claim gives each row a 30-second lease, so concurrent dispatchers take different rows.
- **Abandoned work still runs.** In the prototype run, Durable Object requests had a median wall time of 6 to 10 seconds, and 100 to 600 requests each minute ended after their caller had gone. After the run ended, the object stayed busy for about 3 more minutes with no WebSocket traffic. The code at `247e4a7` still runs queued work after its caller has gone (inferred from `live.ts`).
- **Each notification makes its own D1 round trips** to check that the session exists and to read grants, and the Worker and the D1 primary were in different locations (inferred cost per round trip: tens of milliseconds).

At `247e4a7` every notification and every alarm reads the grants of every open socket, 6 rows for each socket (measured, local). With all 1,200 members connected, the dispatch of one public reply reads 7,234 rows and one alarm reads 7,211. The code requires the full check so that a duplicate notification still closes a revoked socket.

### Account setup floods the live channel

At `5792530` each account operation wrote notifications through database triggers (`0009_notifications.sql`). It wrote one for `staff`, one or more for `account:<id>`, and one for the team.
Creating 1,200 accounts through the admin API wrote 4,291 notifications (measured, hosted). Nobody was connected to most of those audiences.

- The setup took 7 minutes at 6 requests at a time, about 2.9 accounts per second (measured, hosted).
- The undelivered rows took 49 minutes to deliver after setup ended. The rate was about 95 rows per minute, close to the cron's limit of 100 for each run (measured, hosted).
- For about 8 minutes after the setup, a WebSocket upgrade got no response within 25 seconds, and `waitUntil` tasks were cancelled after 30 seconds (measured, hosted, with `curl` and `wrangler tail`). Connections opened again while 2,786 rows were still undelivered, so the in-memory queue of abandoned work, not the database rows, blocked them (measured, hosted).
- The dispatcher's `SELECT … ORDER BY COALESCE(last_attempt_at, 0) …` read about 4,160 rows for each call, because no index served that order (measured, hosted: 1,936 calls read 8.06 million rows).

Migration `0014_notification_claims.sql` changes three of these causes:

- It replaces the account triggers. Account setup now writes only the `staff` notification for an account without a login.
- It adds the index `notifications_claim_order`. The claim reads 12 to 13 rows when rows are pending, and 3 rows in an idle cron tick (measured, local).
- With the claim of `83849fc`, one dispatcher sends up to 500 rows in each round, as one request for each session.

Nobody has measured account setup on a hosted installation since these changes.
A future bulk import or a roster copy (PR #80) does the same account work in larger batches.
A load test, or a contest, that starts during a backlog measures the backlog. [Run a load test](run-load-tests.md#create-the-fictional-accounts) waits until no undelivered rows remain. The harness preflight checks only that one socket opens.

### D1 ran about 40 queries for each request

At `5792530` the Worker built a new Better Auth instance for every request (`applicationWorker.ts`, `authentication(env)`).
Better Auth's Kysely adapter caches its schema check per adapter instance, so the check ran again for each request. It reads `sqlite_master` and then `pragma_table_info` for every table (`node_modules/@better-auth/kysely-adapter`, `findSchemaProblems`).

Evidence (measured, hosted):

- `SELECT * FROM pragma_table_info(?)` was the most frequent D1 statement in every window: 330,152 calls in the baseline run and 597,448 in the B2+B3 run.
- Each Worker request ran 39.6 to 40.1 D1 queries in every step of both builds.
- In the B2+B3 run, D1 queries per minute rose from 85,000 to between 156,000 and 192,000, then stopped rising. Worker requests per minute kept rising, and the Worker's median wall time rose from 0.65 to 3.0 seconds. A D1 database runs one query at a time, and Cloudflare documents a per-request overhead beyond the SQL time ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- The adapter sends the `pragma_table_info` queries for all tables in one `batch()` call, so many of the 40 queries share one round trip. The plateau of about 3,200 queries per second therefore does not convert to a ceiling for requests with a different mix of queries (inferred).
- In the 200-user step the Worker returned `503` to 12% to 25% of read requests. D1 analytics recorded no query errors in that window, so the cause is not confirmed.
- The prototype ran 4.2 queries per request. The anonymous API canary fell from a median of 229 ms to 36 ms. At 100 users, the snapshot median fell from 1,466 ms to 563 ms and failures from 2.5% to 0.6%.

Since `e1325bd`, `identity.ts` sets `validateSchema: false`, and `sharedBetterAuthIdentity` reuses one instance for each binding, origin and secret.
Every authenticated request now makes 3 D1 calls before its handler (measured, local). Better Auth reads `ba_session` and `ba_user`, and Minsky reads `currentLoginSql`. A snapshot request makes 4 calls. The new D1 ceiling is not measured.

### Some reads grow with the number of accounts

With 1,201 accounts and fewer than 100 issues, at `5792530` (measured, hosted):

- The snapshot read 11,500 to 17,000 rows for each call. It was the D1 statement with the most total time once the schema check was off: 40.6 seconds of SQL in the prototype run.
- The sessions list, `SELECT s.id, s.name FROM sessions s JOIN memberships m …`, read about 1,206 rows for each call, and every user called it every 10 seconds.

`5aafc3c` evaluates the `access` expression once and adds migration `0013_membership_account_index.sql` with `memberships(account_id, session_id)`. The read reductions then remove more reads of data that a request does not return:

- The snapshot reads the caller's access row once in each section (`7d8f0db`).
- A contestant's snapshot reads the contestant's own team by key, not every team of the session (`8aba7ee`).
- A workflow command reads only the membership team and the team that a submit names (`cd8142c`).
- The avatar list starts from the caller and the session's staff (`b820eb9`). Migration `0016_staff_membership_index.sql` adds the partial index `memberships_staff` for the staff part (`a509599`).
- Migration `0015_cron_cleanup_indexes.sql` adds partial indexes for the image rows that the cron reads, and plain indexes on `logins(expires_at)` and `ba_session(expiresAt)` (`36a360f`).

At `247e4a7` these reads still grow (measured, local):

- The admin snapshot grows 3 rows for each member, through the `members` section.
- The dispatch and the live alarm grow 6 rows for each connected socket.
- The staff snapshot grows 25 rows for each issue with its history and images, by design. Staff see every issue.

The sessions list reads 12 rows for each request and does not grow (measured, local).

### Each live hint makes every open screen read again

`useSessionSnapshot`, `useAnnouncements` and `Avatars.tsx` read again whenever `SessionData.updates` changes, and every live hint changes it.
A public workflow command sends a hint to `staff` and to the issue's team. An internal note sends one to `staff` only.
The rows of one command therefore grow with the number of open staff screens (inferred from `src/server/adapters/d1/store.ts` and the refresh rule).

At `247e4a7` a volunteer screen reads 2,733 rows for each hint, where it read 11,938 at `f978488` (measured, local parts, inferred sum).
For example, if 240 staff screens are open, one public reply makes them read about 240 × 2,733 ≈ 656,000 rows (inferred). At `f978488` the same reply made them read about 2.9 million rows (inferred).
The staff snapshot is 2,587 of those 2,733 rows, and the avatar list is 30.

### One action waited for four requests in a row

At `5792530` a workflow action in the frontend read `/api/auth/session` for a CSRF token, sent the command, then read `/api/sessions` and `/api/snapshot`, one after another (`src/backend/cloudflare/backend.ts`, `src/connected/hooks/useSessionSnapshot.ts`).
In the best build at 50 users, single requests had medians of 228 to 397 ms, and whole actions had a 95th percentile of 2.0 to 2.9 seconds (measured, hosted).
In the B2+B3 run, actions at 50 users had a 95th percentile of 5.2 to 14.2 seconds (measured, hosted). That run also had 2.5 times as many commands as the baseline at the same step. The frontend queued every refresh behind the earlier ones, and B2 delivered more `change` hints, each of which queued a full refresh. Actions then waited behind those refreshes (inferred, not separated from the larger command count). Do not read the number as a regression of B2 without a run that alternates the builds.

Since `8234216` an action is one request. The browser keeps the CSRF token of the login, and the command response carries the snapshot that the server reads after the commit.
That snapshot is most of the rows of a command. It reads 2,606 of the 2,658 rows of a public reply (measured, local).
Each request still makes several D1 round trips in sequence. On the 2026-10-25 installation the Worker and the D1 primary were in different cities (inferred). Nobody has measured the action latency since this change.

### Password hashing during the sign-in burst

At the 100-user baseline step, 50 accounts signed in for the first time within 30 seconds and changed their temporary passwords (measured, hosted):

- The whole first sign-in took a median of 7.4 seconds and a 95th percentile of 10.2 seconds.
- The password change alone took a median of 3.3 seconds.
- Worker CPU per invocation reached a 99th percentile of 63 to 116 ms across all steps. Cloudflare recorded no Worker errors in the baseline run.

In the B2+B3 200-user step, 27 of 98 password changes failed with `503` (measured, hosted). Other endpoints failed in the same window, so the hashing is not the likely cause (inferred). The cause is not confirmed.

## Scale-up plan

The items are in order of expected gain for the 800-user target. Each item is one small pull request with its own check. Rerun `npm run load` on an isolated installation after each one. Rerun `npm run perf:reads` for each change to D1 reads.

### Status of the plan

| Item | Status | Commits and migrations |
| --- | --- | --- |
| 1. Turn off the runtime schema check | Implemented | `e1325bd` |
| 2. Deliver each notification once | Implemented | `83849fc`, `0014_notification_claims.sql` |
| 3. Stop serializing connects | Open | None |
| 4. Stop the polls while connected | Partly implemented. Announcements are not in the snapshot | `448f52c` |
| 5. Make an action one request | Partly implemented. The response carries the full snapshot | `8234216` |
| 6. Make reads independent of the number of accounts | Implemented, except the admin members list and the socket checks | `5aafc3c`, `0013_membership_account_index.sql`, `7d8f0db`, `8aba7ee`, `cd8142c`, `b820eb9`, `a509599`, `0016_staff_membership_index.sql` |
| 7. Send changes, not full snapshots | Open | None |
| 8. Put the Worker next to its database | Open. See [Platform features checked](#platform-features-checked) | None |
| 9. Spread the first sign-in burst | Open | None |

Two changes outside the plan are also implemented:

- Migration `0015_cron_cleanup_indexes.sql` indexes the rows that the minute cron reads (`36a360f`). A tick reads 24 rows instead of 7,880 (measured, local).
- `withSecurityHeaders` gives the hashed build files under `/assets/` the header `Cache-Control: public, max-age=31536000, immutable` (`684a2bc`). A browser then does not ask for them again after the first load. The effect on Worker requests is not measured.

### The items

1. **Turn off Better Auth's runtime schema check.** Implemented in `e1325bd`. `identity.ts` sets `validateSchema: false`. Minsky's own D1 migrations own the schema, and `npm test` already checks them.
   - Gain on 2026-10-25: D1 queries per request fell from about 40 to about 4. With that change the installation served 119 requests per second at 200 users with a snapshot median of 720 ms, where B2+B3 served 84 with a median of 3,431 ms and `503` responses (measured, hosted, in the prototype). The new D1 ceiling is not measured, because the live channel stopped the run first.
2. **Deliver each notification once.** Implemented in `83849fc` and migration `0014_notification_claims.sql`. One `UPDATE … RETURNING` statement claims rows with a 30-second lease. The dispatcher sends one Durable Object request for each session with only the highest sequence for each audience. The index `notifications_claim_order` serves the claim order. The triggers write `account:<id>` only for an account that has a login.
   - Expected gain: account setup no longer floods the live channel, and the object handles one request per batch instead of one per row (inferred from 2.15 attempts per row and 4,291 rows for 1,200 accounts). Not measured on a hosted installation.
3. **Stop serializing connects behind notifications, and drop abandoned work.** Open. Only the cursor update in `notify` needs the chain. A connect can check its grant and accept the socket without waiting. Skip queued work whose caller has gone.
   - Expected gain: new connections open in about one D1 round trip under load. On 2026-10-25 Durable Object requests waited 6 to 10 seconds in the queue under load, or timed out (measured, hosted).
   - Smallest PR: `perf/live-connect`, with a test that a connect completes while a slow notification runs.
4. **Stop the 10-second polls while the socket is connected.** Partly implemented in `448f52c`. While the socket is connected, one timer refreshes every 60 seconds, and refresh still runs on focus and on `change`. Account status and announcements are still separate reads.
   - The commit intended a 10-second refresh while the socket is down, but `DISCONNECTED_REFRESH_MS` was `60_000`. On 2026-11-08 it became `10_000`. A screen without a live channel now sends refresh reads 6 times as often. A connected screen is unchanged.
   - Expected gain: an idle user sends about 0.1 instead of 0.53 requests per second (0.53 measured, hosted, at 200 users, 0.1 inferred), so 800 idle users send about 80 instead of 420 requests per second.
5. **Make an action one or two requests.** Partly implemented in `8234216`. The browser keeps the CSRF token, and the command response carries the snapshot, so an action is one request. The response still carries the full snapshot, not the changed issue.
   - Remaining gain: a response with only the changed issue reads about 137 rows instead of about 2,600 for a volunteer (inferred from the one-issue prototype in the [read-volume baseline](history/read-volume-baseline-2026-10-26.md#h6-the-command-response-carries-the-whole-snapshot)). The client must then merge one issue into its state. This needs a frontend change.
6. **Make reads independent of the number of accounts.** Implemented in `5aafc3c` and the read reductions. See [Some reads grow with the number of accounts](#some-reads-grow-with-the-number-of-accounts).
   - Gain: on the local seed, the volunteer snapshot reads 2,587 rows and the admin snapshot 6,187 (measured, local). On 2026-10-25 the snapshot read 11,500 to 17,000 rows with fewer issues (measured, hosted).
   - Still open: the admin snapshot reads every member, 3 rows each. Reading members only on the page that shows them makes the other admin pages flat in members (inferred from the [read-volume baseline](history/read-volume-baseline-2026-10-26.md#h7-every-admin-refresh-carries-every-member)).
7. **Send changes, not full snapshots.** Open. Return only rows whose revision passed the client's last revision. Each live change still makes every staff screen read a full snapshot.
   - Expected gain: snapshot bytes and rows grow with changes, not with all issues (inferred).
   - Smallest PR: a design note first, because the read must never show stale permissions.
8. **Put the Worker next to its database.** Open. Set the placement region next to the D1 primary's region. D1 read replication is a later option. See [Platform features checked](#platform-features-checked).
   - Expected gain: each of the several D1 round trips per request gets shorter (documented for placement, not measured here). Measure with the harness before and after.
   - Smallest PR: a configuration change on a test installation.
9. **Spread the first sign-in burst.** Open. Hand out credentials in waves, or let team accounts keep their first password. The second is a product decision.
   - Expected gain: about three password hashes per first sign-in leave the burst (inferred from the code).
   - Smallest PR: documentation for waves. The forced change needs an owner decision.

B2 (PR #93) and B3 (PR #84) are on `main`. B2 raised delivery within 3 seconds at 50 users from 56% to 97%, and B3 adds the history index. Neither changed where the system saturated.

The [read-volume baseline](history/read-volume-baseline-2026-10-26.md#causes-and-hypotheses) lists more candidates. Three of them are open:

- Reload the avatar list only on a session change, on the timer and after the person's own upload (H1). A picture change sends no live hint.
- Read the token, login and account in one statement, so that every authenticated request makes 2 D1 calls fewer (H8). The risk is high, because cookie signature checks move out of Better Auth.
- Recheck only the sockets that receive a hint, and keep the full sweep in the alarm (H9). The risk is high, because revocation is the reason for the full check. This needs a design note before code.

### Platform features checked

On 2026-10-26 a review read the Cloudflare documentation and compared the features with these limits. The statements about Cloudflare are documented, as that review read them, with a link where the review gave one. The statements about Minsky are inferred from the code.

These features are useful, but they need an owner decision and change hosted resources:

- **Choose the locations together, before you create production.** D1, R2 and Durable Objects take a location hint only when the resource is created ([D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/), [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/), [Durable Objects data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)). Choose them with the Worker placement.
- **Set `placement.region` next to the D1 primary.** [Workers placement](https://developers.cloudflare.com/workers/configuration/placement/) says that placement next to the database cuts D1 query latency from 20 to 30 ms to 1 to 3 ms. The 2026-10-25 installation used placement `aws:ap-southeast-1`, and its D1 primary reported `HKG` (measured, hosted). `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc` also sets `aws:ap-southeast-1`. Nobody has checked where the development D1 primary is. Smart Placement needs traffic from several locations, so it fits one venue poorly (inferred from the same page).
- **Use Workers traces with sampling** to measure rows read for each query on a hosted installation ([Workers traces](https://developers.cloudflare.com/workers/observability/traces/)). Cloudflare bills traces from 2026-12-01 ([observability pricing](https://developers.cloudflare.com/observability/pricing/)).

These changes are in code only and change no hosted resource:

- **Send fewer D1 statements for each request, and use `batch()`.** A D1 database processes queries one at a time, and each request has an overhead ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- **Change the live channel.** Tag each socket by audience with the tags of `acceptWebSocket`, and select sockets with `getWebSockets(tag)`. Connect outside the `serialize` chain. Call the coordinator through RPC ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/), [Durable Object state](https://developers.cloudflare.com/durable-objects/api/state/)).

These features can help later:

- **D1 read replication with the Sessions API.** It costs nothing extra, but a replica can be arbitrarily out of date. Live hints would then need to carry a bookmark, and the replication setting is a hosted change ([D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)).
- **`PRAGMA optimize`** after index changes ([D1 indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/)).
- **A selective `run_worker_first` with a `_headers` file**, so that static files do not start the Worker. The Worker now adds the security headers to every asset (inferred from `withSecurityHeaders`), so this change needs the same headers in the file.
- **Workers Analytics Engine** for application counters.

These features do not fit, for the reasons given:

- **Workers Cache and the Cache API.** They cache only `GET` requests, they skip responses for requests with `Authorization` or responses with `Set-Cookie`, and purges have limits. Minsky's reads are private to each caller (inferred).
- **Workers KV.** A change can take up to 60 seconds to reach every location, and one key accepts 1 write each second.
- **A snapshot cache in the session Durable Object.** It loads the part that saturates first (inferred).
- **Queues or Workflows for the outbox.** The send is outside the D1 batch, so the commit is no longer atomic with its notification (inferred).
- **R2 Local Uploads.** It helps only when the client and the bucket are in different regions ([R2 Local Uploads](https://developers.cloudflare.com/r2/buckets/local-uploads/)). The uploader here is the Worker, which is probably in the bucket's region (inferred). The bucket's Request Distribution chart in the dashboard can confirm that.
- **Presigned R2 URLs.** A URL cannot be revoked before it expires. Access to a picture or an image must stop when a grant changes (inferred).
- **R2 lifecycle rules.** They select objects only by prefix and age.
- **Cloudflare Images.** The browser already makes the thumbnails (inferred from `src/connected/imageUpload.ts`).
- **The Rate Limiting binding.** It counts over 10 or 60 seconds, and its counts are approximate. The sign-in limit uses a 15-minute window (inferred from `signInFailureLimits`).
- **Hyperdrive.** It serves only Postgres and MySQL.
- **Early Hints.** It is a zone setting, and `workers.dev` has no zone.

## Scale-out plan

Scale-out runs many contests and organizations on one service. The [multi-competition design](https://github.com/GiftedNovaHD/minsky/pull/80) proposes one organization per installation, with competitions as `events` and contests as `sessions`.

### One database for each organization

Keep one D1 database for each organization, as PR #80 proposes. Do not put all organizations in one database.
On 2026-10-27 the owner chose one shared installation for all organizers for now and deferred scale, so the measured limits below stay as risks of that choice ([event platform design](event-platform-design.md)).

- One D1 database runs one query at a time. The 2026-10-25 prototype held 119 requests per second, which is a lower bound for one database (measured, hosted). The ceiling is not measured. Measure it with the harness after scale-up item 3, so that the live channel does not stop the run first. One busy contest must not slow another organization's contest.
- A D1 database holds at most 10 GB, and that limit cannot be raised. Workers Paid allows 50,000 databases for each account, and Cloudflare raises that on request ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- Per-competition databases are possible later, because all operational data already belongs to one session. They would split accounts and usernames, which PR #80 keeps per organization. Wait until one organization nears the limits above.

A hosted service then needs a small control plane that maps an organization to its database. One Worker script can bind about 5,000 D1 databases (D1 limits). Beyond that, or for stronger isolation, use one Worker for each organization, for example with Workers for Platforms. That choice and its cost belong to the owner.

### One Durable Object for each contest session

Keep the current shape. `idFromName(sessionId)` gives each session its own object, so contests do not share a live channel.
Each object is still one thread, so scale-up item 3 and the socket checks set the limit for each contest. Many contests add objects, not load on one object.

### Images

Keep one private R2 bucket for each organization, next to its database, so that deleting an organization deletes one bucket. Inside it, keep the session-scoped keys that exist today. R2 has no egress charge, so storage dominates its cost.

### Cost

This estimate is a dated record. It uses Cloudflare's [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and the measured, hosted costs per request of 2026-10-25. It is for an 8-hour contest day with 800 users at the 0.53 requests per user per second of that run (inferred):

| Item | Usage | Estimate |
| --- | --- | --- |
| Worker requests | 12.2 million | About US$0.66 after 10 million included |
| Worker CPU | 12 ms per request, about 150 million ms | About US$2.40 after 30 million ms included |
| D1 rows read | About 3,500 per request, about 43 billion | About US$18 after 25 billion included |
| D1 rows written | Under 1 million | Included |
| Durable Object time | One object busy for 8 hours, about 3,700 GB-s | Included in 400,000 GB-s |

Rows read dominated that estimate. At `247e4a7` an ordinary request reads 5 to 6,187 rows on the local seed, and the refresh after one hint reads 257 to 6,332 rows for one screen (measured, local). A dispatch or an alarm with 1,200 sockets reads about 7,200 rows. A new estimate needs a hosted run with the current request mix, because local counts have no request mix.
Workers traces add a cost from 2026-12-01 if you turn them on ([observability pricing](https://developers.cloudflare.com/observability/pricing/)).
Nothing in these measurements needs a plan change beyond Workers Paid. The D1 throughput limit is per database, not per plan.

## Decisions for the owner

- Whether team accounts must change their temporary password at first sign-in (scale-up item 9 and readiness item S4).
- The D1, R2 and Durable Object locations and the Worker placement for production, chosen together before the production resources exist, so that they are next to each other and near the venue (item 8). Location hints work only at creation.
- Whether to turn on Workers traces with sampling on a test installation, to measure rows read for each query. Traces cost money from 2026-12-01.
- Whether the refresh while the live channel is down needs jitter and backoff. The period is 10 seconds, so a screen without a live channel sends 6 times as many refresh reads as at 60 seconds. This can add load when many sockets fail together (inferred). The options are to keep 10 seconds, or to add jitter and backoff.
- The avatar and members reads. The avatar list can reload only on a session change, on the timer and after the person's own upload, so another person's new picture shows within one timer period. The admin members list can move to a read on the members page only, which needs a frontend change.
- Whether to bound the retry of retained cleanup rows. The cron lists every image in a removal state that has a deletion row, including images whose files are already removed. It sends up to 100 R2 deletes on each tick, so its reads grow with the rows that the installation keeps in those states (inferred from `R2ImageService.recover` in `src/server/adapters/cloudflare/images.ts`).
- Whether to add an index on `authentication_limits(window_start)`. The cron's delete of old password-attempt counters is the one scan that `src/server/adapters/d1/cronReads.test.ts` allows. The table holds one row for each failed sign-in key of the last day. An index adds one written row to each failed sign-in (inferred).
- For a hosted service: one Worker for all organizations or one for each, and whether to use Workers for Platforms.
