# Scoped authority read gate, 2026-11-01

**Status.** Dated record. It holds both halves of the Phase 1 gate in the [event platform design](../event-platform-design.md#delivery-phases), on branch `feature/scoped-authority`.
The local half passed. The hosted half was INCONCLUSIVE and did not pass. See [Hosted half](#hosted-half).
A later local diagnosis found a D1 compile cost in the snapshot readers and fixed it. A hosted rerun must still confirm the fix. See [Diagnosis](#diagnosis).
Every measurement before the hosted half was made on a local D1 database. Every measurement in it was made on hosted D1. The diagnosis labels each of its numbers.

Each claim carries one of these labels:

- **Measured** means a number that `npm run perf:reads`, a repository test, or a local probe printed on a local D1 database.
- **Measured, hosted** means a number from a load run or from Cloudflare analytics on hosted D1, from a small preview installation. It does not establish production capacity.
- **Inferred** means reasoning from measured numbers or from the code.

## Result

The local gate passes for the commit that puts the resolver behind `currentAccessSql` and `currentAccessForLoginsSql` (measured).

The design names two local conditions:

1. Every request type reads at most 10 more rows than on `main` in `npm run perf:reads`.
2. Every ceiling in `src/server/adapters/d1/readVolume.test.ts` holds unchanged.

These results hold for condition 1 (measured):

- The tool measured 630 request types. A request type is one shape, one endpoint, and one caller.
- 600 request types read the same rows as on `main`.
- 30 request types read 2 more rows. They are `/api/avatars` for the contestant at all 15 shapes, and the contestant's screen refresh after a change hint, which includes that list.
- No request type reads more than 2 added rows.

Condition 2 also holds. `npm run test:d1` passes on the measured commit with every earlier ceiling unchanged (measured).
The same commit adds two ceilings. The snapshot of an event admin and of a webmaster, neither of whom holds a membership, reads fewer than 6,800 rows, which is the admin ceiling.

The local gate also passes after the fourth commit moves every other reader onto the resolver. There, no request type reads more than 6 added rows (measured, see [below](#after-every-reader-moved-to-the-resolver)).

The hosted half is INCONCLUSIVE and did not pass. The snapshot p95 at 200 users grew by 11 to 58 percent over `main`, and the cause is not isolated. See [Hosted half](#hosted-half).
The design's fallback, a per-login authority cache, was not built. The local half did not need it. For the hosted half, the task contract said to report and stop. Whether the cache would help is untested. It would remove the resolver statement, which is the D1 cost that grew, but that statement accounts for only a few milliseconds of the gap (inferred).

## Revisions

| Side | Revision |
| --- | --- |
| `main` | `171769e` (`origin/main` on 2026-11-01) |
| Branch | `afd7829`, the first commit of `feature/scoped-authority`. The runs measured the same tree before a change of the commit message only. |

## Commands

Run these commands from the repository root. They need Node and the installed packages. They need no Cloudflare credentials, and they create no hosted resource.

1. Check out `main` beside the branch and install its packages:

	```sh
	git worktree add --detach /tmp/scoped-gate-main origin/main
	npm --prefix /tmp/scoped-gate-main ci
	```

2. Measure `main` three times:

	```sh
	cd /tmp/scoped-gate-main
	for i in 1 2 3; do npm run perf:reads -- --plan=full --out=/tmp/scoped-gate/main-$i.json; done
	```

3. Measure the branch three times from the branch checkout:

	```sh
	for i in 1 2 3; do npm run perf:reads -- --plan=full --out=/tmp/scoped-gate/branch-$i.json; done
	```

4. Compare the two sides:

	```sh
	node scripts/compare-read-volume.mjs \
	  --base=/tmp/scoped-gate/main-1.json,/tmp/scoped-gate/main-2.json,/tmp/scoped-gate/main-3.json \
	  --head=/tmp/scoped-gate/branch-1.json,/tmp/scoped-gate/branch-2.json,/tmp/scoped-gate/branch-3.json --limit=10
	```

The comparison takes the largest total rows read, request and dispatch, of each request type over the three runs of each side. It prints each request type that changed, and it exits 1 when one reads more than `--limit` added rows.

## Rows that changed

All 30 changed request types follow one pattern (measured):

| Endpoint | Caller | Rows on `main` | Rows on the branch | Added |
| --- | --- | --- | --- | --- |
| `/api/avatars` | contestant | 17 at every shape | 19 at every shape | 2 |
| screen refresh after a change hint | contestant | 190 to 709, by shape | 192 to 711, by shape | 2 |

The avatar list embeds the resolver in a `UNION`. A contestant's list reads its own picture and stops before the staff memberships. The 2 added rows come from that embedding of the resolver (inferred from a local probe on 8 accounts, where the bare resolver read the same 6 rows as `main` and the list read 14 against 12).

## Two drafts that failed

The gate failed twice on earlier drafts of the first commit (measured). Each failure had one cause in the resolver's SQL. Each cause was fixed in the resolver, and the cache was not built.
This is a judgment for the owner to review. The cache addresses the cost of the resolver's own lookups. These two costs came from how the drafts ordered and read those lookups.

| Draft | Largest added rows | Cause | Fix |
| --- | --- | --- | --- |
| 1 | 2,397 for the live alarm at the base shape with every member connected, and 9,590 at 4,800 accounts | The resolver joined `sessions` after the login tables, so the live form read the contest and its event once for each login, 2 rows each | The resolver starts from `sessions s JOIN events e`, then a `CROSS JOIN` to the login tables |
| 2 | 11 for a public message with every member connected at 4,800 accounts, and 10 for the live alarm there | The stamp read `site_settings` in every evaluation, 1 row each time. The live check runs one statement for each 500 sockets | Only a webmaster's stamp reads the site version. Other callers stamp the constant 0 |

The second fix keeps the guard correct. Only a webmaster's answer depends on the site setting, and a new site grant moves the holder's `access_version`, so the stamp still changes (inferred from migration `0017`). `authority.test.ts` checks that a webmaster's guard fails after the setting changes.

## After every reader moved to the resolver

The fourth commit of the branch, `Feature: Route every access check through the authority resolver`, moves the remaining readers onto the resolver: the workflow read and its guards, the admin gate, the account checks, the contest list, and the staff avatar list.
Three more runs on that commit, compared with the same three `main` runs, also pass (measured):

- 390 of 630 request types read the same rows as on `main`. 240 read more.
- No request type reads more than 6 added rows.
- Every ceiling in `readVolume.test.ts` holds unchanged.

| Endpoint | Callers | Added rows at every shape |
| --- | --- | --- |
| `/api/sessions` | admin, volunteer, jury, contestant | 4 |
| Each workflow command | volunteer, jury, contestant | 3, or 2 to 3 for a contestant's submit |
| `/api/avatars` | contestant | 2 |
| screen refresh after a change hint | contestant | 6 |
| screen refresh after a change hint | admin, volunteer, jury | 4 |

The causes are these (inferred from the statements and plans):

- A workflow command evaluates its read three times: the read, the guard before the writes, and the access check after them. Each evaluation reads the contest row a second time, for intake and categories.
- The contest list reads the caller's candidate contests and then the resolver row of each, with the contest's event.
- The screen refresh adds the contest list to the avatar list.

A draft of this commit read 8 more rows for `/api/sessions` and 10 more for the contestant's screen refresh, which is the limit (measured). It merged the candidate contests with `UNION` and joined `sessions` again for the name. `UNION ALL` and a `session_name` column on the resolver row removed 4 of those rows.

The fifth commit only adds the promotion statements to `0017`. They read and write nothing on the empty database that `perf:reads` seeds, so these numbers also hold for it (inferred).

The commands are those above, with the branch checkout on the fourth commit and the output files `tip-1.json` to `tip-3.json` in place of `branch-1.json` to `branch-3.json`.

## What the numbers cover

- The `perf:reads` seed holds no grant and no `site_settings` row. Every caller is a member of the contest. So the numbers cover an installation whose callers hold no grant (measured seed).
- A local probe added two event grants of other events, three site grants of other accounts, and a settings row. A non-holder's access row then read the same rows as before: 603 rows for 100 logins and 7 rows for one caller, on the second draft (measured). The final resolver keeps those lookups unchanged.
- An event admin and a webmaster read the admin snapshot within the admin ceiling in `readVolume.test.ts` (measured).
- The contestant's `workflow submit` reads 1 row more or less from run to run on both sides. The snapshot after the submit varies, because the new issue gets a random ID (measured on `main` and the branch). The comparison takes the largest count of each side.

## Machine and versions

| Item | Value |
| --- | --- |
| Machine | AMD Ryzen 7 6800H, 16 logical cores, 23 GB memory, Linux 5.15 on WSL2 |
| Node | 22.22.1 for `npm run perf:reads` |
| Installed packages | `better-auth` 1.7.11, `wrangler` 4.151.2, `miniflare` 5.20261019.0-beta, installed with `npm ci` on both sides |
| Time for one full run | About 110 seconds |

## Hosted half

The hosted half ran on 2026-11-01 from one Linux machine in Asia (16 logical cores, harness CPU at most 0.30 cores). All numbers in this section are measured on hosted D1 from small preview installations of free-tier scale, with at most 200 simulated users. They do not establish production capacity.

### Hosted result

The verdict is **INCONCLUSIVE**. It is not a pass.

- The snapshot read p95 at 200 users was more than 10 percent above `main` in every comparison. The growth ranged from 11 to 58 percent (measured, hosted).
- The issue submit p95 was also above the limit in every comparison, from 17 to 70 percent. Each run holds only 11 to 19 submits, so this row is weak (measured, hosted).
- The extra latency has no named limiter. The branch did not use more Worker CPU, more D1 queries, more rows read, or more D1 statement time for each request. Two D1 costs did grow. The resolver statement takes 0.5 to 1.4 ms more for each call, and the D1 p99 batch time is 1 to 2 ms higher in the crossover. Neither can account for 250 to 300 ms at the median (measured, hosted). The benchmark checklist requires INCONCLUSIVE when a difference has no named limiter.
- D1 rows read per request did not grow by more than 10 in the comparison that controls for database size (measured, hosted). The hosted figure depends on database size, so it cannot settle the condition alone. See [Rows read per request](#rows-read-per-request).
- The per-login cache was not built. The task contract says to report and stop when the gate does not pass. Whether the cache would help is untested. It would remove the resolver statement, which is the D1 cost that grew. That statement accounts for only a few milliseconds of the gap (inferred).

### What was fixed before the first run

I chose these rules before any load ran.

- **Decision rows.** The `snapshot` row and the `workflow:submit` row at the 200-user step. The `action:submit` row supports them.
- **Rule.** The design's rule says that the p95 of each row may grow by at most 10 percent over `main`. It compares the better of the two runs of each Worker. D1 rows read per request, from analytics, may grow by at most 10.
- **Rows read per request.** `rowsRead` of D1 per minute divided by Worker `requests` per minute. The harness averages the whole minutes inside the step.
- **Triggers for INCONCLUSIVE.** There were four. A step stopped at the error limit. Asymmetric `server` or `edge` failures. A region mismatch between the two databases. Event-loop delay p99 above 50 ms, or a slow `canary:static`.

None of the four fired. No step stopped at the error limit, and no run had a `server` or `edge` failure. Both databases were in the APAC region, and the event-loop delay and `canary:static` medians were normal.

The label INCONCLUSIVE rests on a different rule. The benchmark checklist says to call a verdict inconclusive when a difference has no named limiter. I added that basis after the results, and I did not fix it before the first run.

Three things happened during the runs. They are listed so that nobody reads them as part of the original plan.

1. **Socket failures.** The branch had `ws-ready` timeouts in two first runs, A1 and B1, that `main` did not have. They are a `timeout` class, so the `server` and `edge` trigger did not fire. I report them as a side finding.
2. **A different data centre.** The first branch database landed in a different data centre than the `main` database. Both were in the APAC region with the `apac` location hint, but `main` served from NRT and the branch from ICN. This is not a region mismatch, so the trigger did not fire. I created databases until one served from NRT (the fifth try, `minsky-preview-gate-roll-5`), moved the branch Worker onto it, and ran the branch again. The ICN run is kept as one extra data point.
3. **A crossover.** I added a crossover after the first comparison. The same installation ran `main` code and branch code in turn. This controls for the database and the Durable Object. The design's text allows it, because it deploys the `main` Worker and then the branch Worker to a `minsky-preview-*` Worker.

### Resources and revisions

All resources have the `minsky-preview` prefix. Each is deleted. The existing `minsky-preview` Worker and database, `minsky-dev`, and `minsky-development` were not touched.

| Item | Value |
| --- | --- |
| Source of `main` | `171769e` (`origin/main`), built with `npm run build` in its own checkout |
| Source of the branch | `70d1b48` (`origin/feature/scoped-authority`), built with `npm run build` |
| `main` installation | Worker `minsky-preview-gate-main`, D1 `minsky-preview-gate-main` (primary in NRT), R2 `minsky-preview-gate-main-images` |
| Branch installation A | Worker `minsky-preview-gate-p1`, D1 `minsky-preview-gate-p1` (primary in ICN), R2 `minsky-preview-gate-p1-images` |
| Branch installation B | The same Worker and bucket, D1 `minsky-preview-gate-roll-5` (primary in NRT) |
| Created and deleted unused | D1 `minsky-preview-gate-roll-1` to `-4` and `minsky-preview-gate-p1-nrt` |
| Settings on both Workers | Placement region `aws:ap-southeast-1`, D1 location hint `apac`, `cpu_ms` 1000, cron every minute |
| Token | `minsky-agent-preview-gate-20261101` with Workers Scripts Write, D1 Write, Workers R2 Storage Write, and Account Analytics Read on the Minsky account. It had a 7-day expiry and was deleted at the end of the run. |

Installation B is not wholly fresh. It reuses the Worker, the `AUTH_SECRET`, the bucket, and the Durable Object namespace of installation A. Only its database and accounts are new.

I deployed with `npx wrangler deploy` and not with `npm run deploy`. So `/minsky-revision.json` was absent and the harness printed `revision unknown`. These Worker versions map to the runs:

| Version | Code | Used by |
| --- | --- | --- |
| `786d0828` | `main` | M1, M2, M3 |
| `093c9e24` | branch | A1 |
| `d9ef9f9f` | branch | B1, B2 |
| `cc5127d8` | branch | X1 |
| `5d0e97d4` | `main` | M4 |
| `2ea53b4d` | branch | X2 |
| `f0f63bb4` | `main` | M5 |

The migration `0017` was applied to the `main` database before X1. M1 to M3 ran on the earlier 16 migrations. M4 and M5 are `main` code on the `0017` schema. M3 and M4 have almost the same snapshot p95 (1672 and 1665 ms), so the schema had little effect (measured, hosted).

### Commands

The token came from a private file and reached each command only through that command's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The account ID is the Minsky account. The commands down to `secret` ran once for each installation, each from the checkout of its code. The `load` commands ran from the branch checkout.

```sh
git worktree add --detach /tmp/gate-main origin/main
npm ci && npm run build
npx wrangler d1 create minsky-preview-gate-main --location=apac --config=PROVISION --update-config=false
npm run cloudflare:install -- plan --settings=PROVIDER --config=CONFIG
npm run cloudflare:install -- configure --settings=PROVIDER --config=CONFIG
npx wrangler r2 bucket create minsky-preview-gate-main-images --config=CONFIG --update-config=false
npm run cloudflare:install -- migrate --config=CONFIG --account=ACCOUNT --database=DATABASE_ID
npx wrangler deploy --config=CONFIG
npm run load -- competition --teams=80 > competition.json
npm run cloudflare:install -- bootstrap --config=CONFIG --account=ACCOUNT --database=DATABASE_ID --competition=competition.json --credentials=OWNER_FILE
npm run cloudflare:install -- secret --config=CONFIG --account=ACCOUNT --database=DATABASE_ID
npm run load -- setup --origin=ORIGIN --owner=OWNER_FILE --fixtures=FIXTURES --staff=40 --team-accounts=160
npm run load -- run --fixtures=FIXTURES --results=RESULTS --steps=50,200 --step-seconds=120
npm run load -- analytics --results=RESULTS --account=ACCOUNT --database=DATABASE_ID --worker=WORKER
```

`PROVIDER` is a `provider.json` with `placementRegion` `aws:ap-southeast-1`. Both installations used the same `competition.json` (SHA-256 `deceda544045791c…`) and the same `setup` counts. The load tool drives both from the branch checkout, and `scripts/load` is identical on the two sides.

I ran `node scripts/load/cli.mjs`, which is what `npm run load --` runs. I ran `analytics` for each results file 3 to 15 minutes after its run.
The cleanup step that removes accounts from the session did not run, because the databases were deleted. Resources were deleted with `npx wrangler delete --name NAME --force`, `npx wrangler d1 delete NAME --skip-confirmation`, and `npx wrangler r2 bucket delete NAME`.

Three throwaway scripts read more of the Cloudflare GraphQL analytics than `npm run load -- analytics` does. They are not in the repository. One sums `rowsRead` and Worker `requests` over a whole run. One sums `queryDurationMs` of every D1 statement for each minute. One lists the mean duration of each statement. The raw result files and logs stay on the measuring machine in `/tmp/gate-raw`.

### Run order

Each run is `--steps=50,200 --step-seconds=120`. Local times on 2026-11-01. The runs alternate between the sides.

| Run | Start | Code | Installation |
| --- | --- | --- | --- |
| M1 | 12:44 | `main` | `main` installation |
| A1 | 12:50 | branch | A (ICN) |
| M2 | 12:57 | `main` | `main` installation |
| B1 | 13:05 | branch | B (NRT) |
| B2 | 13:12 | branch | B (NRT) |
| M3 | 13:19 | `main` | `main` installation |
| X1 | 13:27 | branch | `main` installation |
| M4 | 13:34 | `main` | `main` installation |
| X2 | 13:41 | branch | `main` installation |
| M5 | 13:48 | `main` | `main` installation |

Before each run I checked that no notification was waiting for delivery. M1, A1, and B1 are first runs. Their accounts changed the temporary password in the run. Account setup took 70 s on the `main` installation, 126 s on A, and 77 s on B.

### Results at the 200-user step

Latencies are milliseconds. Each step holds 3 minutes. It has a 60 s ramp from 50 to 200 users and a 120 s hold. "Issues" is the issue count in the database at the start and the end of the run. Latencies come from the harness (measured, hosted).

| Run | Code | Installation | Issues | snapshot p50 | snapshot p95 | submit p95 (n) | action:submit p95 | Failed | `canary:static` p95 |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| M1 | `main` | `main` | 0 to 17 | 950 | 1356 | 1855 (13) | 5503 | 0 | 78 |
| M2 | `main` | `main` | 17 to 25 | 699 | 1292 | 2177 (5) | 5034 | 8 | 308 |
| M3 | `main` | `main` | 25 to 44 | 1028 | 1672 | 1997 (16) | 6299 | 0 | 246 |
| A1 | branch | A (ICN) | 0 to 13 | 1014 | 1756 | 2298 (11) | 7653 | 399 | 180 |
| B1 | branch | B (NRT) | 0 to 14 | 1401 | 2045 | 3154 (11) | 9236 | 455 | 357 |
| B2 | branch | B (NRT) | 14 to 31 | 1785 | 2676 | 3530 (13) | 11857 | 0 | 69 |
| X1 | branch | `main` | 44 to 61 | 1339 | 1848 | 2511 (15) | 7132 | 0 | 199 |
| M4 | `main` | `main` | 61 to 81 | 1161 | 1665 | 2317 (13) | 6980 | 0 | 406 |
| X2 | branch | `main` | 81 to 101 | 1507 | 2127 | 2761 (19) | 9816 | 0 | 46 |
| M5 | `main` | `main` | 101 to 123 | 1225 | 1772 | 2053 (15) | 7517 | 0 | 77 |

"submit" is the `workflow:submit` row. The snapshot rows each hold 3,937 to 5,466 requests.
The failures of A1 and B1 are all `ws-ready` timeouts at 10 s. The 8 failures of M2 are WebSocket drops. No run had a `server`, `edge`, `client`, or `limited` failure. Event-loop delay p99 was 11 ms in every step.

At 50 users the two sides look the same. The snapshot p50 was 357 to 391 ms on `main` and 369 to 391 ms on the branch, except A1 at 685 ms (measured, hosted).

Server-side numbers for the same step, from Cloudflare analytics (measured, hosted):

| Run | Rows read per request, 2 whole minutes | Rows read per request, whole run | D1 queries per request | Worker CPU ms per request | D1 statement time, share of a minute | Resolver statement, mean ms per call |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| M1 | 57.3 | 53.3 | 3.93 | 7.4 | 15% | 1.02 |
| M2 | 57.1 | 60.6 | 3.88 | 9.2 | 20% | 1.19 |
| M3 | 96.9 | 98.4 | 3.91 | 9.2 | 20% | 1.12 |
| A1 | 56.0 | 57.1 | 4.30 | 12.8 | 21% | 1.72 |
| B1 | 54.3 | 53.5 | 4.30 | 13.6 | 17% | 2.21 |
| B2 | 68.5 | 70.8 | 3.89 | 7.6 | 33% | 2.39 |
| X1 | 117.9 | 128.8 | 3.95 | 8.6 | 18% | 1.79 |
| M4 | 196.0 | 182.1 | 3.97 | 9.5 | 38% | 1.19 |
| X2 | 206.0 | 198.4 | 3.98 | 9.5 | 25% | 1.96 |
| M5 | 250.4 | 255.7 | 3.88 | 7.0 | 33% | 1.12 |

The resolver statement is the statement that begins `WITH access AS`. It reads 8 rows on both sides in every run.

### Comparison with the threshold

**The design's rule on the fresh installations.** The better of each Worker's two runs, at the 200-user step:

| Row | `main` (M1, M2) | Branch B (B1, B2) | Growth | Branch A (A1 only) | Growth |
| --- | ---: | ---: | ---: | ---: | ---: |
| Snapshot p95 | 1292 | 2045 | +58% | 1756 | +36% |
| `workflow:submit` p95 | 1855 | 3154 | +70% | 2298 | +24% |

Both rows fail the 10 percent limit. The two fresh installations differ in more than the code, so this result overstates the code's share. The crossover, which holds the installation fixed, gives +11% and +24% for the snapshot p95 where this comparison gives +58%. The D1 p99 batch time supports the point. On B it was 8.5 and 9.1 ms, against 3.8 and 4.2 ms on the `main` installation in runs 1 and 2. B had the smaller database, and X1 had 6.75 ms (measured, hosted).

**The crossover on one installation.** The same Worker, database, and Durable Object ran `main` code and branch code in turn. The database grows by 17 to 22 issues each run, and snapshot reads grow with it. So I compared each branch run with the `main` runs on both sides, interpolated to the branch run's midpoint issue count:

| Branch run | Compared with | snapshot p50 | snapshot p95 | `workflow:submit` p95 |
| --- | --- | ---: | ---: | ---: |
| X1 | M3 and M4 | 1339 against 1094 (+22%) | 1848 against 1669 (+11%) | 2511 against 2155 (+17%) |
| X2 | M4 and M5 | 1507 against 1192 (+26%) | 2127 against 1717 (+24%) | 2761 against 2188 (+26%) |

The snapshot p95 exceeds the limit by 0.8 points for X1 and by 14 points for X2. The `workflow:submit` p95 rests on 15 and 19 submits, and a p95 of so few samples is close to the maximum.

**Noise floor.** `main` against `main` does not repeat within 10 percent. The snapshot p95 of the five `main` runs ranges from 1292 to 1772 ms, and the p50 from 699 to 1225 ms. Part of that spread follows the database size. A 10 percent limit therefore needs several runs with matched database sizes. Two runs per side cannot test it.

### Rows read per request

Rows read per request depends strongly on database size, because each snapshot reads the issues. On the `main` code it rises from 57 with 0 to 25 issues to 250 with 101 to 123 issues (measured, hosted). That is 1 to 3 rows for each added issue, so 10 rows equal the effect of 4 to 9 issues. The fresh installations cannot match the database size between the sides.

| Comparison | Branch | `main` | Difference |
| --- | ---: | ---: | ---: |
| Run 1, installation A against M1 | 56.0 | 57.3 | -1.3 |
| Run 1, installation B against M1 | 54.3 | 57.3 | -3.0 |
| Run 2, installation B against M2 | 68.5 | 57.1 | +11.4 |
| X1 against M3 and M4, interpolated | 117.9 | 145.7 | -27.8 |
| X2 against M4 and M5, interpolated | 206.0 | 222.5 | -16.5 |

All rows are the per-minute figure of the 200-user step. The whole-run figure gives the same signs: +3.8, +0.2, +10.2, -10.9, and -19.6. The one pair above 10 is a fresh-installation pair with unmatched database size (B2 ended with 31 issues, M2 with 25). In the crossover, which controls for size, the branch read fewer rows per request. So the rows condition shows no growth. The hosted figure moves by more than 10 between nearby runs, so it cannot prove the condition by itself. The local measurement, at most 6 added rows for any request type, stays the stronger evidence for rows.

### What limits the numbers

- **The latency is a queue, not a cost.** From 50 to 200 users the `main` snapshot p50 grows from 357 to 391 ms to 699 to 1225 ms, which is 2 to 3 times. The Worker CPU per request stays at about 7 to 10 ms (measured, hosted). A larger latency with a flat cost per request means that requests wait for a shared resource (inferred). The branch has the same base cost at 50 users. At 200 users it waits longer.
- **I cannot name the resource.** Worker CPU per request is equal on both sides in the second and later runs: 7.6 to 9.5 ms for the branch and 7.0 to 9.5 ms for `main`. D1 queries per request are equal: 3.89 to 3.98 for the branch and 3.88 to 3.97 for `main`. D1 statement time stays at 17 to 33 percent of a minute for the branch and 15 to 38 percent for `main`, so one serial D1 executor was not saturated on either side. Durable Object active time does not follow the code. M4 (`main`) had 31 s a minute and X2 (branch) had 18 s. Total D1 statement time per request was 1.54 and 1.57 ms for M3 and X1, and 2.28 and 2.30 ms for M4 and X2 (measured, hosted).
- **What did grow.** The resolver statement takes 1.72 to 2.39 ms for each call on the branch and 1.02 to 1.19 ms on `main`, for the same 8 rows. That is 0.5 to 1.4 ms more for each call, and about one request in four makes the call. The D1 p99 batch time is 6.75 and 8.15 ms in X1 and X2 against 5.2 and 6.6 ms for `main` interpolated by database size. The median batch time is equal at 0.14 to 0.16 ms. These differences add up to a few milliseconds. They cannot account for 250 to 300 ms at the median unless a queue amplifies them, and the D1 busy share shows no such queue (inferred).
- **Candidates I did not measure.** The number of sequential Worker to D1 round trips for each request. The queue inside the Durable Object that serves one session. The Worker's isolate scheduling. Analytics counts statements, not round trips.

### What else the numbers could be measuring

- **Cold starts.** Every run starts with a 60 s ramp on a warm Worker after a preflight and the 50-user step. The 50-user step shows equal latency on both sides, so cold starts do not explain the 200-user gap (measured, hosted).
- **A different seed.** Both installations use the same competition file and counts. Account names and the random issue timing differ in each run. Submits per run range from 5 to 19, which is why the submit row is weak.
- **Rate limits.** No run has a `limited`, `edge`, or `client` failure. All counted failures are WebSocket timeouts or drops.
- **The load machine and the network.** Harness CPU was 0.09 to 0.30 cores of 16. Event-loop delay p99 was 11 ms in every step. `canary:static`, which the Worker serves without D1, had a median of 28 to 51 ms in every step. Its p95 in the 200-user step ranges from 46 to 406 ms and does not follow the code.
- **The database and the installation.** This is the largest confound for the fresh installations. The ICN database and the NRT database of B behave differently from the `main` database. The crossover removes it.
- **Work that did not happen.** The Worker counted 10 to 21 percent more requests than the harness in each run, from the cron, the canaries, the drain, and retried sockets. No run stopped at the error limit.
- **Database growth.** M1 to M5 and A1 to B2 each ran on a larger database than the run before. The interpolation corrects the crossover for it. It does not correct the fresh-installation pairs.

### Side findings

These are not part of the gate. All come from the first runs of the branch (measured, hosted).

- The first runs A1 and B1 had 399 and 455 `ws-ready` timeouts at 200 users. Run M1 had none, but its `ws-ready` p95 was 8,439 ms against the 10,000 ms cutoff. M2 and M3 had p95 of 1,523 and 2,260 ms. B2, X1, and X2 had no timeout. Durable Object active time was 60 s a minute in A1 and B1. The cause is not known. A first run is a flood of password changes and sign-ins.
- At 50 users the branch's first runs used 659 and 698 write queries a minute against 264 for M1. They used 4.30 D1 queries per request at 200 users against 3.93.
- The branch's first runs had a Worker CPU p99 of 375 to 425 ms, against 58 to 82 ms for M1. Later runs of both sides were at 52 to 168 ms.

### Limits of this record

- Two to five runs per side. A single run's p95 moves by more than 10 percent between neighbours of the same code.
- The installations of the two sides differ in database, so the fresh pairs are not clean. The crossover has one installation and two runs of the branch code.
- Database size changes between runs. The interpolation assumes that the effect is linear between neighbouring runs.
- The harness reports 1 or 2 whole minutes for each step in analytics. A step has a ramp, so the minutes differ in load.
- No hosted per-request-type row count exists. The local `perf:reads` result is the only per-type evidence.
- The load comes from one machine at one time of day. The first runs include password changes. Later runs do not.
- The cause of the extra latency is not isolated. I did not profile the Worker, trace the round trips of one request, or read Workers Logs.
- The numbers do not support a claim about 800 users, the future production Worker, or any capacity beyond this small preview.

## Not run

- The per-login authority cache. The contract said to report and stop when the gate did not pass. The cache is untested.
- A measurement of sequential D1 round trips for each request type on the `main` Worker and the branch Worker. It is the smallest next measurement that can name a limiter. Workers Logs are enabled on the Workers, but the token did not include Observability Read.
- A first run on the same installation for each side. It would show whether the first-run socket failures belong to the code or to the database.
- The harness cleanup step. The databases were deleted instead.
- Any claim about production capacity.

## Diagnosis

**Status.** Added on 2026-11-01 after the hosted half, on branch `feature/scoped-authority`. It names the cause of a measured D1 cost, the fix, and the local numbers before and after. A hosted rerun must still confirm the fix. See [What a hosted rerun must confirm](#what-a-hosted-rerun-must-confirm).

This section uses two more labels:

- **Measured, local D1** means a number from `npm run perf:reads` or a repository test on a local D1 database.
- **Measured, local SQLite** means a compile time from `node:sqlite` (SQLite 3.51.2, Node 22.22.1) on the machine above, with the migrations of that side applied. A compile time is the time of `prepare()`, which parses the SQL text and builds the program. It does not run the statement.

### Cause

The premise was that the branch does more work for each request, most likely more writes. The evidence contradicts it. The branch adds no statement, no D1 call, no written row, and no notification. See [The premise](#the-premise).

The cost that grew is the compile time of each statement that embeds the resolver:

1. D1 compiles each statement again on every call. On hosted D1, the mean time of a statement follows the local compile time of its text (measured, hosted, and measured, local SQLite). See [D1 time is compile time](#d1-time-is-compile-time).
2. SQLite compiles a common table expression (CTE) again at each place that names it. This holds for a `MATERIALIZED` CTE, and for a CTE named inside another CTE (measured, local SQLite).
3. The session snapshot named `access` in 10 places in its sections. `visible_issues` named it twice and 5 sections read `visible_issues`. So each snapshot compiled the resolver about 20 times. The announcement snapshot compiled it about 5 times (inferred from the statements, and consistent with the measured shares below).
4. `main` has the same structure. One place that names the branch resolver costs 0.069 to 0.085 ms to compile, against 0.031 ms for `currentAccessSql` on `main` (measured, local SQLite). So the resolver's share of the snapshot compile grew from 0.64 ms to 1.54 ms.

The first place that goes wrong is the readers. They name the resolver once for each section, and the richer resolver made that multiple 2.2 to 2.7 times as expensive.

The link to the hosted latency is inferred. At 200 users every endpoint that calls D1 waited about the same added time, including `/api/auth/session`, whose SQL is the same on both sides. The anonymous canary, which calls no D1, did not slow. So the added time is a wait in a queue in front of D1, not work on the slow request's own path. The added compile time is the one D1 cost per call that grew. The hosted data cannot show that this cost fills the queue, for two reasons. The D1 statement time per request also depends on the request mix, which differed between runs. And D1 work outside `queryDurationMs` is not measured. A cost that grows with the length of the SQL text outside statement time is not ruled out. The fix changes the text length by less than 1 percent.

### The premise

Every count that the premise predicted to grow is the same on both sides (measured, local D1):

| Count | `main` | Branch before the fix |
| --- | ---: | ---: |
| D1 calls, 630 request types, full plan | 3,750 | 3,750 |
| Statements, 630 request types | 5,265 | 5,265 |
| Rows written, 630 request types | 4,273 | 4,273 |
| Dispatch calls and rows written | 540 and 975 | 540 and 975 |
| `access_version` changes, base plan, 5 runs | 0 | 0 |
| Notification rows added | 26 | 26 |
| `command_assertions` rows left behind | 0 | 0 |
| History rows added | 14 | 14 |
| Live coordinator statements (socket checks) | 48 | 48 |
| Workflow commands that ended in a 409 | 0 | 0 |

The hosted crossover agrees (measured, hosted). X1 and X2 had no conflict. M3 and M5 had one each. Write queries for each run were 2,037 for M3, 2,026 for X1, 2,377 for M4, and 2,080 for X2. The first runs cannot show whether the branch writes more. Each first-run window also holds account setup and password changes, in different amounts. M1 holds 599 `ba_user` inserts and 456 completed password changes. A1 holds 330 `ba_account` inserts. B1 holds 198 account inserts and 268 membership inserts.

Every D1 endpoint gained a similar wait (measured, hosted). Each value is the 200-user p50 of the branch run minus the mean of the two neighbouring `main` runs:

| Endpoint | X1 against M3 and M4 | X2 against M4 and M5 |
| --- | ---: | ---: |
| `auth-session` | +139 ms | +220 ms |
| `sessions` | +218 ms | +295 ms |
| `snapshot` | +245 ms | +314 ms |
| `announcements` | +216 ms | +304 ms |
| `avatars` | +225 ms | +310 ms |
| `canary:anonymous-api`, no D1 | -5 ms | +12 ms |

### D1 time is compile time

For each statement shorter than 4,096 characters with at least 50 calls in a run, the hosted mean time per call was compared with the local compile time of the same text (measured, hosted, and measured, local SQLite):

| Side | Runs | Statements | Fit | r |
| --- | --- | ---: | --- | ---: |
| `main` | M3, M4, M5 | 42 | 0.10 ms + 3.07 x compile | 0.983 |
| Branch | X1, X2, B2 | 40 | 0.15 ms + 2.72 x compile | 0.965 |

The announcement snapshot shows it for one statement. It reads 8 rows on both sides. Its local compile time is 0.34 ms on `main` and 0.72 ms on the branch. Its hosted mean is 1.12 to 1.18 ms on `main` and 1.79 to 2.39 ms on the branch.

Local D1 hides this cost. Its `meta.duration` is whole milliseconds, and its total over 642 statements was 101 ms on both sides (measured, local D1).

The compile time of each reader splits into the resolver's share and the rest. The share is the compile time minus the compile time with the resolver replaced by a constant row (measured, local SQLite, one run):

| Statement | `main` share | `main` rest | Branch share | Branch rest |
| --- | ---: | ---: | ---: | ---: |
| Session snapshot | 0.638 ms | 0.541 ms | 1.539 ms | 0.539 ms |
| Announcement snapshot | 0.276 ms | 0.128 ms | 0.629 ms | 0.146 ms |
| Avatar list | 0.068 ms | 0.118 ms | 0.167 ms | 0.123 ms |
| Live socket check | 0.069 ms | 0.009 ms | 0.153 ms | 0.011 ms |

The rest is the same on both sides. All of the growth is in the resolver's share.

### Fix

The fix is in the two readers that named the resolver more than once. Every other reader names it once.

- `snapshotSql` in `application.ts` reads the resolver row once, as `c` in `FROM login LEFT JOIN access c ON true`. Each section reads the columns of `c`. Without a seat, `c` is NULL and the sections are empty, as before. `visible_issues` names `access` once. It reads its two branches through one `OR`, which SQLite runs as two index searches (`MULTI-INDEX OR`).
- `snapshotSql` in `announcements.ts` names `access` once in `visible`, and `access` is `MATERIALIZED`, so SQLite builds its program once. The image section reads `visible` before `announcement_images`. Without that order, SQLite scanned every announcement image of the site, and `queryPlans.test.ts` failed.
- `queryPlans.test.ts` allows the scans of the one-row materialized `access` under its new alias `c`.

The resolver, migration `0017`, and every other caller are unchanged. Removing the `SELECT * FROM (...) WHERE data = 1` wrapper of `contestDataSql` was tried. It made no measurable difference inside the readers (0.99 times), so it was not kept.

### Before and after

The compile time of each request type comes from two paired runs (measured, local SQLite). Each compiled every text 200 times in each of 7 rounds, with the two sides alternating. The values are milliseconds for one request. `/api/auth/session` has the same SQL on both sides, so its ratio shows the noise of each run: 0.96 in run 1 and 1.05 in run 2. A run with three sides was not used, because the side in the second and third place compiled the same SQL up to 40 percent slower.

| Request type | Run 1, `main` | Run 1, after the fix | Run 2, before the fix | Run 2, after the fix |
| --- | ---: | ---: | ---: | ---: |
| `/api/auth/session` | 0.045 | 0.044 | 0.040 | 0.042 |
| `/api/sessions` | 0.075 | 0.180 | 0.172 | 0.171 |
| `/api/snapshot` | 1.190 | 0.955 | 1.738 | 0.917 |
| `/api/announcements` | 0.451 | 0.430 | 0.769 | 0.435 |
| `/api/avatars` | 0.234 | 0.300 | 0.290 | 0.298 |
| `/api/updates`, the live socket | 0.127 | 0.180 | 0.174 | 0.178 |
| `workflow claim` | 1.852 | 1.883 | 2.645 | 1.839 |
| Live alarm, 4 sockets | 0.082 | 0.136 | 0.134 | 0.136 |
| Screen refresh: the five reads above `/api/updates` | 1.995 | 1.909 | 3.009 | 1.863 |
| All 38 request types of the base shape | 22.679 | 23.077 | 32.728 | 22.580 |

So the fix takes the compile time of a screen refresh from about 1.5 times that of `main` back to the level of `main`. The snapshot compiles faster than on `main`. The sessions list, the avatar list, and the live socket check stay slower. See [Not fixed](#not-fixed).

The read gate still passes (measured, local D1). `node scripts/compare-read-volume.mjs --limit=10` passes against the three `main` runs of [Commands](#commands). Of 630 request types, 285 read fewer rows than on `main`, 75 read more, and none reads more than 4 added rows. The rows added are those that the earlier commits added to `/api/sessions` and to the contestant's `/api/avatars`. At the base shape, the contestant's snapshot request reads 115 rows, against 124 on `main` and before the fix. The admin's reads 6,177 rows, against 6,187. Every ceiling in `readVolume.test.ts` holds.

The counts of [The premise](#the-premise) stay the same after the fix (measured, local D1, base plan, 3 runs): 498 calls, 700 statements, and 570 rows written for the requests, 70 calls and 130 rows written for the dispatch, 26 notification rows, 14 history rows, and 48 live coordinator statements, with no `access_version` change and no assertion left behind, on both sides. Over the full plan, both sides make 3,750 calls and 5,265 statements and write 4,273 rows.

### Test

`src/server/adapters/d1/readerCompile.test.ts` fails on the readers before the fix and passes after it. For the session snapshot and the announcement snapshot, it measures the resolver's share of the compile time, counted in compiles of the resolver alone. Both come from the same process, so the speed of the machine cancels. Inside Vitest, three runs of each version gave these shares (measured, local SQLite):

| Statement | Before the fix | After the fix | Bound |
| --- | ---: | ---: | ---: |
| Session snapshot | 7.20 to 7.51 | 3.18 to 3.63 | 5 |
| Announcement snapshot | 3.95 to 4.04 | 1.93 to 1.98 | 2.8 |

Each bound lies midway, so a reader that names the resolver in each section again fails. The bounds come from these runs, not from a stated requirement. This is a judgment for the owner to review. The test compares timings, so it runs in `npm run test:d1`, one file at a time. `vite.config.ts` excludes it from `npm test`, so a busy Workers Builds runner cannot fail a deploy with it.

### Not fixed

- **The resolver's own compile cost.** A reader that names the resolver once still compiles a resolver that costs 2.2 to 2.7 times as much as `currentAccessSql`. So the sessions list, the avatar list, and the live socket check compile 1.3 to 2.4 times as long as on `main` (measured, local SQLite). They are small statements.
- **`visible_issues`.** Five sections still read it, so the session snapshot compiles the resolver about 6 times. A later phase that adds a section reading `visible_issues` adds one more.
- **The first-run socket failures.** The `ws-ready` timeouts of A1 and B1 are not explained. This fix does not claim to address them.

### Corrections to the hosted half

- [What limits the numbers](#what-limits-the-numbers) infers that one serial D1 executor was not saturated, from `queryDurationMs`. That time is mostly compile time, and D1 work outside it is not measured. So the inference is not supported. The latency of `/api/auth/session`, whose SQL is the same on both sides, grew from 267 to 284 ms at 50 users to 446 to 782 ms at 200 users on `main` (measured, hosted). D1 calls already wait in a queue on `main`.
- The same section says that D1 statement time for each request matched. It did match in total, but the total also depends on the request mix. In the crossover of [Rows read per request](#rows-read-per-request), the branch read 16.5 to 27.8 fewer rows for each request than `main`, while locally it reads 0 to 6 more for each request type. So the hosted totals cannot show a change of about 0.6 ms for each request, which is 3 times the local compile change (inferred from the fit).

### What a hosted rerun must confirm

1. Run a crossover on one installation, with `main` and the fixed branch in turn and matched database sizes.
2. Compare the D1 mean of each statement that embeds the resolver. The announcement snapshot should fall from 1.8 to 2.4 ms to about the 1.1 to 1.2 ms of `main` (inferred from the fit and the local compile times).
3. Compare the snapshot p95 at 200 users with the 10 percent limit of the gate.
4. If the gap stays, measure the wait of each D1 call from the Worker. That needs a token with Observability Read for Workers Logs. It would also test the competing cause, a per-call cost that grows with SQL text length.
5. Run a first run on each side, to see whether the `ws-ready` timeouts belong to the code.

### Diagnosis commands

The local numbers come from throwaway scripts in `/tmp/diag-scripts` on the measuring machine. They are not in the repository. They do these things:

- They add `meta.duration`, SQL length, and the state counts above to a copy of `scripts/d1-read-volume.mjs`, and save each executed SQL text with its bound values.
- They compile each saved text in `node:sqlite` on a database with the migrations of its side, alternating the sides.
- They replace the resolver in a text with a constant row and compile both texts.

The repository commands are these:

```sh
npm run perf:reads -- --plan=full --out=/tmp/diag-out/final-full-1.json
node scripts/compare-read-volume.mjs --base=/tmp/scoped-gate/main-1.json,/tmp/scoped-gate/main-2.json,/tmp/scoped-gate/main-3.json \
  --head=/tmp/diag-out/final-full-1.json,/tmp/diag-out/final-full-2.json,/tmp/diag-out/final-full-3.json --limit=10
npm run test:d1
```
