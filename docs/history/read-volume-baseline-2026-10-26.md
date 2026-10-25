# D1 read-volume baseline, 2026-10-26

**Status.** Dated record. It measures `main` at `f978488` with the script from the commit that adds `npm run perf:reads`.
It changes no application code, SQL, or migration. A later change implements fixes from the ranking below.

Each claim carries one of these labels:

- **Measured** means a number that `npm run perf:reads` or a prototype statement printed on the seeded local database.
- **Inferred** means arithmetic on measured numbers, or reasoning from the code at `f978488`. Nobody measured it directly.
- **Guess** means a hypothesis that nobody has measured yet.

## Summary

1. **The avatar list is the heaviest ordinary read** (measured). `GET /api/avatars` reads 5 to 7 rows for every ready profile picture in the whole installation, in every session and event. With a picture for each of 1,200 accounts it reads 6,005 rows for a contestant and 8,416 for a volunteer. It returns 1 and 3 avatars. A rewrite plus one partial index reads 12 and 28 rows (measured on a prototype statement).
2. **A screen refresh after each live hint costs 6,322 to 14,339 rows** (measured parts, inferred sum). Every hint makes each screen read `/api/sessions`, `/api/snapshot`, `/api/announcements` and `/api/avatars`. The avatar list is 50% to 95% of that.
3. **The staff snapshot is linear in issues by design** (measured). It reads 33 rows for each issue with its 5 history rows and 3 images, and 3 rows for each history row. One of those 3 rows is a re-read of the caller's access row. Reading the staff flag once removes 799 of 3,401 rows (measured on a prototype).
4. **Some reads grow with data they do not return** (measured). The contestant snapshot reads every team of the session. At 480 teams its statement reads 1,018 rows for a contestant who sees 1 team, and 60 rows with a key lookup. Each workflow command builds the session's team list three times, although only `submit` uses it.
5. **The minutely cron scans whole tables** (measured). One tick reads 7,880 rows at the base shape, from scans of `issue_images`, `announcement_images`, `logins` and `ba_session`. Four additive indexes cut it to 22 rows (measured on a prototype).
6. **Every authenticated request makes 3 D1 calls before its handler** (measured). Better Auth reads `ba_session` and `ba_user`, then Minsky reads `currentLoginSql`. The rows are few (5), but a snapshot read is 4 sequential calls.
7. **Many reads are already flat** (measured). `/api/auth/session` (5 rows), `/api/sessions` (12), the WebSocket grant check (13 to 16), announcements (104), sign-in (22) and the notification claim (12 to 13) do not grow with accounts, issues, history or teams.

All 38 measured rows of the tool's base table repeated exactly across 3 in-run repeats and a second seeded database (measured).

## Rerun the measurement

Run these commands from the repository root. They need Node and the installed packages. They need no Cloudflare credentials, and they create no hosted resource.

```sh
npm run perf:reads -- --plan=base --explain
npm run perf:reads -- --explain --out=read-volume.json
```

- `--plan=base` measures the base shape twice, with two seeds, in about 15 seconds.
- The default `--plan=full` measures 15 shapes in about 100 seconds on the machine below.
- `--explain` prints `EXPLAIN QUERY PLAN` for the identity checks and for each statement that reads 10 rows or more, with its real bound values.
- `--out` writes every record, with the rows of each statement, as JSON.

The script stops with an error if a request fails, a command is rejected, a statement returns no `meta`, a notification stays undelivered, or a hint reaches the wrong socket.

### Machine and versions

| Item | Value |
| --- | --- |
| Commit measured | `f978488` (`origin/main` on 2026-10-26) |
| Machine | AMD Ryzen 7 6800H, 16 logical cores, 23 GB memory, Linux 5.15 on WSL2 |
| Load during the runs | Load average 0.1 to 0.5 |
| Node | 22.22.1 |
| Installed packages | `better-auth` 1.7.10, `wrangler` 4.149.0, `miniflare` 5.20261006.1-alpha |

The installed packages are older than the lockfile at `f978488`, which pins `better-auth` 1.7.11 and `wrangler` 4.151.2.
This run used the `node_modules` folder of the main checkout without `npm ci`. Rerun after `npm ci` to confirm the identity statements and the local `rows_read` counts.

## Method

### What runs

The script bundles the real `src/server/adapters/cloudflare/applicationWorker.ts` with esbuild and calls its `fetch` and `scheduled` handlers in Node.
The only stub replaces the `cloudflare:workers` import, as `applicationWorker.test.ts` does.
Each request therefore runs the same route checks, identity check, CSRF check, handler, and `waitUntil` notification dispatch as the deployed Worker.

The D1 binding is a real local D1 database from `openStoreDatabase` with `remoteBindings: false`. Its SQLite engine is the one in workerd.
The R2 bucket is a fake that stores nothing. The Durable Object is the real `SessionLiveCoordinator` with in-memory state and fake sockets, as in `live.test.ts`.
R2 and Durable Object storage calls are not counted.

### What it counts

A meter wraps the D1 binding. For each request it records the following:

- **Calls.** One for each `first()`, `all()`, `run()` or `batch()`. A batch is one round trip. This is the count that `measureD1` in `testMetrics.ts` makes.
- **Statements.** One for each SQL statement, including each statement in a batch.
- **Rows read and rows written.** The sums of `meta.rows_read` and `meta.rows_written` over all statements.

`first()` returns no `meta`, so the meter runs it as `all()` and returns the first row.
Local D1 executes every row of a statement for both calls (`node_modules/miniflare/dist/src/workers/d1/database.worker.js`, `Array.from(cursor.raw())`), so the counts are the same (inferred from that source).

The table separates **dispatch**: the notification claim, the coordinator's work, and the delivery mark that run in `waitUntil` after a `POST`.
The Durable Object makes its own D1 calls in production, so the dispatch columns count them as D1 calls too.

### Callers and requests

The callers are the admin (account 1), a volunteer (account 2), a jury member (account 3) and a contestant (account 7 on team 8).
Each caller signs in through `POST /api/auth/sign-in`. The first sign-in in each run is marked cold. It uses a fresh Better Auth instance.
Each caller then repeats this sequence three times: `GET /api/auth/session`, `/api/sessions`, `/api/snapshot`, `/api/announcements`, `/api/avatars`, and the WebSocket upgrade `/api/updates`.

The commands follow one issue. The contestant submits it. The volunteer claims it, sends a public reply and an internal note, and resolves it. The jury member gives an award.
The live alarm and one cron tick run next.
Then 1,196 more sockets connect, one for every other member, and the volunteer sends one more public reply.

### Data shapes

The seed is a copy of the seed in `src/server/adapters/d1/readVolume.test.ts`. It is not shared code, because the HTTP and live boundaries accept only UUID keys and the test uses keys such as `acc-7`.
The copy adds the volunteer and jury roles, open intake, a ready profile picture for every account, 10 announcements with 20 images, and passwords for the four callers.

The base shape has 1,200 accounts, 24 teams, 100 issues, 500 history rows (5 for each issue) and 300 images in the measured session.
A second session holds 50 issues and 1,500 images. 10 more announcements belong to the second session.

The full plan changes one size at a time:

- Accounts: 300, 1,200, 4,800.
- Issues, each with 5 history rows and 3 images: 25, 100, 400.
- History rows for each issue: 5, 20, 80.
- Teams: 6, 24, 96, and 480. The 2026-10-25 load test used 480 teams.
- Accounts and issues together, with 24 teams: 300 and 25, 1,200 and 100, 4,800 and 400.
- The same, with teams in proportion: 6, 24 and 96 teams.

### Checks of the measurement

These checks follow the benchmark checklist:

- **Repeats.** rows_read is deterministic on the same data. All 38 measured rows of the tool's base table matched across the 3 in-run repeats and the second seed (measured). Commands were compared across the two seeds.
- **Meter against `measureD1`.** `measureD1` counted 372 calls and 473 statements in the Worker. The meter counted 372 and 473 (measured).
- **Meter against a direct read.** The snapshot statement run directly with `all()` read 196 rows for the contestant and 7,000 for the admin. The meter recorded the same numbers (measured).
- **Did the work happen.** The script checks the issue and member counts of each snapshot, checks that the contestant sees no internal history, and checks that the team socket gets a hint for the public reply and none for the internal note.
- **Did it error.** Every request returned 200 and every command committed. Otherwise the script stops.
- **Does the arithmetic hold.** The staff snapshot grows 3 rows for each history row. Reading the staff flag once removed 799 rows (measured). That is 500 history rows plus 300 images, less 1. The remaining 2 rows per row are the index entry and the table row (inferred).

This baseline counts rows and calls. It measures no latency.

## Ranked results at 1,200 accounts

Rows read include the dispatch after the response. "Calls" counts the request first, then the dispatch.
"Per" values are the added rows read for one added account, issue, history row or team (measured).

| Rank | Request | Caller | Calls | Rows read | Rows written | Growth |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Public reply, all 1,200 members connected | Volunteer | 6 + 6 | 10,790 (3,556 + 7,234) | 41 | 6 per connected socket, 33 per issue, 3 per history row, 6 per team |
| 2 | `GET /api/avatars` | Volunteer, jury | 4 | 8,416 | 0 | 7 per ready avatar in the installation |
| 3 | Cron tick, every minute | Scheduler | 7 + 1 | 7,880 | 0 | 2 per account (1 login and 1 identity session), 9 per issue (3 per image) |
| 4 | `GET /api/avatars` | Admin | 4 | 7,218 | 0 | 6 per ready avatar |
| 5 | Live alarm, 1,200 sockets, at most every 30 seconds | Coordinator | 3 | 7,211 | 0 | 6 per connected socket |
| 6 | `GET /api/snapshot` | Admin | 4 | 7,005 | 0 | 3 per member, 33 per issue, 3 per history row, 3 per team |
| 7 | `GET /api/avatars` | Contestant | 4 | 6,005 | 0 | 5 per ready avatar |
| 8 | `POST /api/workflow` claim, reply, note, resolve, award | Volunteer, jury | 6 + 4 | 3,588 to 3,610 | 29 to 44 | 33 per issue, 3 per history row, 6 per team |
| 9 | `GET /api/snapshot` | Volunteer, jury | 4 | 3,406 | 0 | 33 per issue, 3 per history row, 3 per team |
| 10 | `POST /api/workflow` submit | Contestant | 6 + 4 | 375 | 48 | 2,564 at 480 teams |
| 11 | `GET /api/snapshot` | Contestant | 4 | 201 | 0 | 2 per team in the session; 1,023 at 480 teams |
| 12 | `GET /api/announcements` | Any | 4 | 104 | 0 | Flat |
| 13 | `POST /api/auth/sign-in`, cold or warm | Any | 10 + 1 | 22 | 14 | Flat |
| 14 | `GET /api/updates`, the WebSocket grant check | Any | 4 | 13 to 16 | 0 | Flat |
| 15 | `GET /api/sessions` | Any | 4 | 12 | 0 | Flat |
| 16 | `GET /api/auth/session`, the CSRF read | Any | 3 | 5 | 0 | Flat |
| 17 | Live alarm, 4 sockets | Coordinator | 1 | 31 | 0 | Flat |

The account slopes of the avatar list come from a seed with a ready avatar for every account. The list grows with ready avatars, not with members.
The socket slopes come from runs in which every account had a socket. A real contest connects fewer.

One dispatch cycle with the four caller sockets makes 4 calls and reads 44 to 54 rows (measured). The calls are the claim, the session check, one grant query, and the delivery mark. An internal note reads 44 rows, because it notifies only `staff`.

### The refresh that each live hint starts

`useSessionSnapshot`, `useAnnouncements` and `Avatars.tsx` read again whenever `SessionData.updates` changes, and every live hint changes it.
The sum of those four reads is the cost of one screen for one hint (measured parts, inferred sum).

| Caller | Calls | Rows read | Avatar share | At 4,800 accounts and 400 issues |
| --- | --- | --- | --- | --- |
| Admin | 16 | 14,339 | 7,218 | 56,639 |
| Volunteer, jury | 16 | 11,938 | 8,416 | 47,038 |
| Contestant | 16 | 6,322 | 6,005 | 24,723 |

A public workflow command sends a hint to `staff` and to the issue's team. An internal note sends one to `staff` only.
The rows of one command therefore grow with the number of staff screens that are open (inferred from `src/server/adapters/d1/store.ts` and the refresh rule).
For example, if 240 staff screens are open and each reads what the volunteer read here, one public reply makes them read about 240 × 11,938 ≈ 2.9 million rows (inferred).

## Growth verdicts

| Endpoint | Verdict | Cause |
| --- | --- | --- |
| `/api/avatars` | Grows with all ready avatars in the installation, not only with the session | `SEARCH v USING INDEX account_avatars_cleanup (state=?)` |
| `/api/snapshot`, staff | Grows with issues, history and teams by design. Flat in accounts | Every visible issue, history row and image |
| `/api/snapshot`, admin | Also grows with members, 3 rows for each | The `members` section |
| `/api/snapshot`, contestant | Grows with the team's issues by design, and with all teams of the session, which it does not need | `teams t CROSS JOIN access a` |
| `/api/workflow` commands | Grow with issues and history through the snapshot in the response, and 3 rows for each team through `workflowSql` | The response snapshot and the team lists |
| Dispatch and live alarm | Grow with connected sockets, 6 rows for each socket on every notification and alarm | `currentAccessForLoginsSql` for every socket |
| Cron tick | Grows with all images and logins in the installation | Full scans |
| `/api/auth/session`, `/api/sessions`, `/api/updates`, `/api/announcements`, sign-in | Flat in accounts, issues, history and teams | Index lookups. Announcements grow with announcements, which this run did not vary. |

With accounts and issues in proportion (300 and 25, 1,200 and 100, 4,800 and 400), the volunteer snapshot reads 931, 3,406 and 13,306 rows, and the admin snapshot reads 1,830, 7,005 and 27,705 rows (measured).
Scaling the teams in proportion as well changes these by less than 6% (measured).

## Causes and hypotheses

The hypotheses follow the perf playbook's mantras in order: don't do it, don't do it again, do it less.
"Prototype" means that the changed statement ran against the same seeded database and returned the same rows, without the `server_time` field, as the current statement.
It was not run through the application, so each delta is a guess for the request until a later change measures it with `npm run perf:reads`.
The cron prototype ran without sign-ins, so its database had 4 fewer logins and 4 fewer identity sessions than the tool's run. At 1 row each, that is why it starts at 7,872 rows and the ranking shows 7,880.

| Prototype | Current rows | Prototype rows | Same result |
| --- | --- | --- | --- |
| Avatar list, contestant | 6,000 | 12 | Yes |
| Avatar list, volunteer, no new index | 8,411 | 1,225 | Yes |
| Avatar list, volunteer, partial index | 8,411 | 28 | Yes |
| Avatar list, volunteer, 4,800 accounts, partial index | 33,611 | 28 | Yes |
| Cron tick, four indexes | 7,872 | 22 | Not compared |
| Contestant snapshot, own team by key, 480 teams | 1,018 | 60 | Yes |
| Contestant snapshot, own team by key and staff flag once | 196 | 119 | Yes |
| Volunteer snapshot, staff flag once | 3,401 | 2,602 | Yes |
| Volunteer snapshot, staff flag once and teams with access first, 480 teams | 4,769 | 3,492 | Yes |
| Admin snapshot, staff flag once | 7,000 | 6,201 | Yes |
| Workflow read, no team lists, 480 teams | 973 | 11 | No, by design |
| Volunteer snapshot, one issue only | 3,401 | 137 | No, by design |
| Admin snapshot, no members | 7,000 | 3,397 | No, by design |
| Identity, one statement by token | 5 rows in 3 calls | 3 rows in 1 call | Yes, same login row |

### H1. Avatar list

- **Cause** (measured). The plan starts with `SEARCH v USING INDEX account_avatars_cleanup (state=?)`. It reads every ready avatar in the installation. It then evaluates the staff test as a correlated subquery for each avatar.
- **Don't do it** (guess). `Avatars.tsx` reloads the list on every `updates` change. That counter counts live hints, but a picture change sends no hint. Reload the list on a session change, on the timer and after the person's own upload. This removes one avatar read for each screen and hint (inferred).
- **Do it less, SQL only** (prototype). Start from the caller's own avatar through the partial unique index `account_avatars_current`. Add the ready avatars of the session's staff memberships with `UNION`. The prototype reads 12 rows instead of 6,000 for the contestant, and 1,225 instead of 8,411 for the volunteer. Staff still scan the session's memberships, 1 row for each member.
- **Do it less, with an index** (prototype). Add `CREATE INDEX memberships_staff ON memberships(session_id, account_id) WHERE team_id IS NULL`. The prototype then reads 28 rows instead of 8,411 for the volunteer, and 28 instead of 33,611 at 4,800 accounts.
- **Risk.** The permission rule must stay the same. A person sees their own avatar, and staff see the avatars of the session's staff. The prototype returned identical rows for the contestant, the volunteer and the admin at 1,200 accounts, 4,800 accounts and 480 teams (measured). No timer is involved.
- **Migration.** The SQL rewrite needs none. The partial index is an additive migration.

The prototype statement keeps the bound values of the current statement in the same order:

```sql
WITH login AS (<currentReadyLoginSql>), access AS MATERIALIZED (<currentAccessSql>)
SELECT person_id, avatar_id, content_type FROM (
  SELECT v.account_id AS person_id, v.id AS avatar_id, v.content_type FROM login l
    JOIN account_avatars v ON v.account_id = l.id AND v.state = 'ready'
  UNION
  SELECT v.account_id, v.id, v.content_type FROM access a JOIN memberships m ON m.session_id = ? AND m.team_id IS NULL
    JOIN account_avatars v ON v.account_id = m.account_id AND v.state = 'ready'
    WHERE a.staff = 1 AND (m.is_admin = 1 OR EXISTS (SELECT 1 FROM membership_roles r
      WHERE r.session_id = m.session_id AND r.account_id = m.account_id)) AND EXISTS (SELECT 1 FROM login))
ORDER BY person_id
```

### H2. Cron tick

- **Cause** (measured). The plans show `SCAN issue_images` in three statements in `R2ImageService.recover`, `SCAN announcement_images` in three statements in `R2AnnouncementImageService.recover`, and `SCAN logins` and `SCAN ba_session` in the expiry batch in `worker.ts`. No index starts with `state` or with the expiry column. The scans cover all sessions.
- **Do it less** (prototype). Add `issue_images(state)`, `announcement_images(state)`, `logins(expires_at)` and `ba_session(expiresAt)`. The prototype tick reads 22 rows instead of 7,872 at the base shape, and 22 instead of 15,072 at 4,800 accounts.
- **Scale.** At the base shape one tick each minute reads about 11.3 million rows a day (inferred from 7,880 × 1,440). The expired image rows stay and are queued again on every tick with `ON CONFLICT DO NOTHING`, so the scan grows with every image the installation has kept (inferred from `images.ts`).
- **Risk.** No permission or timer effect. Each index adds a write when a row of its table is inserted or changes state (guess, about one more row written each time).
- **Migration.** Additive. `ba_session` belongs to the identity schema in `0004_identity.sql`, but an extra index does not change Better Auth's columns.

### H3. Snapshot re-reads the access row for each row

- **Cause** (measured). The `history` and `attachments` sections end in `CROSS JOIN access a` and test `a.staff` for each row. The plan shows `SCAN a` inside both sections. `teams t CROSS JOIN access a` does the same for each team.
- **Do it less, SQL only** (prototype). Test `(SELECT staff FROM access) = 1`, which SQLite evaluates once. Put `access` first in the staff branch of `teams`. The prototype reads 2,602 rows instead of 3,401 for the volunteer and 6,201 instead of 7,000 for the admin. At 480 teams the volunteer reads 3,492 instead of 4,769.
- **Risk.** Internal-note separation depends on the same predicate, `visibility = 'public' OR staff`. The contestant's prototype snapshot was identical to the current one, and the current one has no internal history (measured). The later change needs the same contestant check.
- **Migration.** None.

### H4. Contestant snapshot reads every team

- **Cause** (measured). In `FROM teams t CROSS JOIN access a WHERE t.session_id = ? AND (a.staff = 1 OR t.id = a.team_id)`, `CROSS JOIN` makes `teams` the outer loop. The plan searches `sqlite_autoindex_teams_2 (session_id=?)` and reads every team of the session, 2 rows for each.
- **Do it less, SQL only** (prototype). Use a staff branch with `access` first, and `JOIN teams t ON t.id = a.team_id` for a team member. The prototype reads 150 rows instead of 196 at 24 teams, and 60 instead of 1,018 at 480 teams. With H3 the contestant reads 119 rows at 24 teams and 53 at 480.
- **Risk.** The team branch returns less, not more. A membership's team must belong to the same session, and the `memberships` foreign key already requires that.
- **Migration.** None.

### H5. Each workflow command builds the team list three times

- **Cause** (measured). `workflowSql` in `src/server/adapters/d1/store.ts` selects the session's team IDs twice, in `teams` and in `dependency`. The commit batch runs `workflowSql` twice more inside its assertions. The workflow statements read 3 rows for each team (measured slope). Only `submit` reads `state.teams` (`decideWorkflow` in `src/server/workflow.ts`).
- **Don't do it** (prototype). Build the list only for `submit`. For `submit`, check the one team with `EXISTS`. The prototype read takes 11 rows instead of 61 at 24 teams, and 11 instead of 973 at 480 teams. A command at 480 teams would read about 1,400 rows fewer (inferred from the slope of 3 rows for each team).
- **Risk.** The `dependency` string guards against concurrent changes. Without the team list, a team change between the read and the commit no longer forces a retry of a claim or a reply. Those commands do not use the team list. Receipt replay compares `dependency`, so the later change needs a replay test.
- **Migration.** None.

### H6. The command response carries the whole snapshot

- **Cause** (measured). `http.ts` reads the full snapshot after each committed command. For a volunteer claim that is 3,415 of 3,595 rows.
- **Return less data** (prototype, not equivalent). Return the changed issue with its history, resolution, award and images. A snapshot of one issue reads 137 rows instead of 3,401, or 1,505 instead of 4,769 at 480 teams, because the team list stays.
- **Risk.** The client then merges one issue into its state. Other issues stay as they were until the next hint or timer. The permission filters must stay identical. This needs a frontend change.
- **Migration.** None.

### H7. Every admin refresh carries every member

- **Cause** (measured). The `members` section reads 3 rows for each member. That is 3,603 rows at 1,200 accounts and 14,403 at 4,800, measured as the difference from the prototype.
- **Don't do it** (prototype, not equivalent). Read members only on the page that shows them, through a separate request or a flag. Without the section the admin snapshot reads 3,397 rows at both 1,200 and 4,800 accounts.
- **Risk.** Admin pages that read `snapshot.members` need the new read. No permission change if the new read uses the same admin test.
- **Migration.** None.

### H8. The identity check makes three round trips

- **Cause** (measured). `D1AuthenticationService.current` calls Better Auth's `getSession`, which reads `ba_session` by token (`sqlite_autoindex_ba_session_2 (token=?)`) and then `ba_user` by id. It then runs `currentLoginSql`, which joins `ba_session` again. The `ba_user` row is not used.
- **Don't do it again** (prototype). Verify the signed cookie in the Worker, then read the token, login and account in one statement. The prototype statement returned the same login row with 3 rows read in 1 call. Every authenticated request would make 2 calls fewer, so a snapshot read would make 2 calls instead of 4 (inferred).
- **Risk.** High. Cookie signature checks would move out of Better Auth. The rows do not change, so this item is about round trips and D1 query rate, not rows.
- **Migration.** None.

### H9. Every notification and alarm rechecks every socket

- **Cause** (measured). `SessionLiveCoordinator.grants` reads `currentAccessForLoginsSql` for every open socket before every notification and every alarm, 6 rows for each socket. The code requires this so that a duplicate notification still closes a revoked socket.
- **Do it less** (guess, not prototyped). Recheck only the sockets that receive the hint and the sockets of fresh `account:` audiences, and let the alarm stay the full sweep. The rows would then grow with the notified sockets instead of all sockets (guess).
- **Risk.** High. Revocation is the reason for the full check. A grant that changes without an `account:` notification would stay open until the next alarm. This needs a design note before code.
- **Migration.** None.

## Reads that the product needs

Some reads are linear by design. A change-based or paged design can cut them. This record builds neither.

- **Staff snapshot.** Staff see every issue, so the snapshot reads every issue, history row and image of the session. That is 33 rows for each issue in this seed (measured). A change-based read returns only the rows whose revision passed the client's last revision. One changed issue costs about 137 rows in the one-issue prototype (measured), so a read after one change would cost about that instead of 3,406 (inferred).
- **The refresh after each hint.** Every open staff screen reads the full snapshot after every hint. A change-based read cuts the rows of each screen. A hint that names the changed issue would let each screen read only that issue (guess).
- **Admin members list.** The members page needs every member, 3 rows for each (measured). Paging, or a separate read on that page only, makes the other admin pages independent of the number of members (H7).
- **Contestant snapshot.** A contestant sees all of the team's issues, so the snapshot grows with them. It reads 110, 201 and 602 rows for 1, 4 and 17 team issues (measured).
- **Live grant checks.** Every open socket is rechecked on each notification, 6 rows for each socket (measured). Checking only affected sockets (H9) needs a design for revocation.
- **Announcements.** The announcement read returns every active announcement of the session. It reads 104 rows for 10 announcements and 20 images (measured). It grows with announcements, which this run did not vary.

## Statements in `docs/scaling-design.md` that are now stale

These statements no longer match `main` at `f978488`. The page is not changed in this record.

1. "**Status.** Measured baseline and proposed plan. Nothing in the plan is implemented." Scale-up items 1, 2, 4, 5 and 6 are on `main`: `e1325bd`, `83849fc`, `448f52c`, `8234216` and `5aafc3c`.
2. Summary item 2, "Each Worker request ran about 40 D1 queries, because Better Auth checks the database schema on every request." A read request now makes 3 or 4 D1 calls (measured). `identity.ts` sets `validateSchema: false`.
3. Summary item 5, "An ordinary action makes four requests one after another". Since `8234216` an action is one request. The browser keeps the CSRF token, and the command response carries the snapshot.
4. "Each dispatcher reads up to 100 undelivered rows and sends one Durable Object request for each row." Since `83849fc` a dispatcher claims up to 500 rows with one `UPDATE … RETURNING` statement and sends one request for each session.
5. "**Duplicate dispatch.** Concurrent dispatchers read the same undelivered rows." The claim gives each row a 30-second lease, so concurrent dispatchers take different rows.
6. "The dispatcher's `SELECT … ORDER BY COALESCE(last_attempt_at, 0) …` read about 4,160 rows for each call, because no index serves that order". Migration `0014_notification_claims.sql` adds `notifications_claim_order`. The claim reads 12 to 13 rows (measured).
7. In "D1 runs about 40 queries for each request": "The Worker builds a new Better Auth instance for every request (`applicationWorker.ts`, `authentication(env)`)." and "the check runs again for each request". `sharedBetterAuthIdentity` reuses one instance for each binding, origin and secret, and the schema check is off.
8. In "Some reads grow with the number of accounts": "The snapshot read 11,500 to 17,000 rows for each call", "The sessions list … read about 1,206 rows for each call", and "`memberships` has no index that starts with `account_id`". Since `5aafc3c` the snapshot request reads 201, 3,406 or 7,005 rows at 1,200 accounts (measured). The sessions request reads 12 rows and stays flat (measured). Migration `0013` adds `memberships_account_session`.
9. The whole section "One action waits for four requests in a row". See item 3.
10. Scale-up item 2, "Do not write `account:<id>` notifications for accounts that have no session login". Migration `0014` rewrites the account triggers so that they write `account:<id>` only when a login exists.
11. In "Account setup floods the live channel": "Each account operation writes notifications through database triggers (`0009_notifications.sql`): one for `staff`, one or more for `account:<id>`, and one for the team." Migration `0014` replaces those triggers. Account setup now writes only the staff notification for an account without a login.
12. Scale-up item 4, "Stop the 10-second polls while the socket is connected". `448f52c` implements it. In the code both periods are now 60 seconds. See the next section.
13. In "Decisions for the owner": "Until scale-up item 2 ships, whether the contest procedure waits until no setup notifications remain undelivered." Item 2 has shipped.
14. The cost table row "D1 rows read | About 3,500 per request". That figure came from the 2026-10-25 run before these changes. This record measures 5 to 8,416 rows for each request, depending on the endpoint.
15. "**Inferred** means reasoning from measured numbers and the code at `5792530`." The code has changed since `5792530`.

## Other findings not fixed here

- `src/connected/hooks/refreshSchedule.ts` sets `DISCONNECTED_REFRESH_MS` and `CONNECTED_REFRESH_MS` to 60,000 since `448f52c`. `docs/cloudflare-backend-design.md` line 335 and `docs/frontend-architecture.md` lines 175 and 196 say that the browser refreshes every 10 seconds while the channel is down. Either the code or those pages is wrong.
- The installed packages differ from the lockfile. See [machine and versions](#machine-and-versions).

## Limits of this baseline

- The numbers come from local D1. Hosted D1 uses the same SQLite engine, so the counts should match (inferred). Nobody compared them on a hosted database.
- The seed has 3 staff members. A contest with 240 staff members makes the staff part of the avatar list, the members list and the fan-out larger. The seed gives every account a ready profile picture, which is the worst case for the avatar list.
- The seed has no resolutions or awards except those that the commands create, and no admin audit rows.
- The prototype deltas come from single statements on the same data, not from requests through the application.
- This baseline counts rows and round trips. It does not measure time.
