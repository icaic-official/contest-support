# Scoped authority read gate, 2026-11-01

**Status.** Dated record. It holds both halves of the Phase 1 gate in the [event platform design](../event-platform-design.md#delivery-phases), on branch `feature/scoped-authority`.
The local half passed. The hosted half was INCONCLUSIVE and did not pass. See [Hosted half](#hosted-half).
A later local diagnosis found a D1 compile cost in the snapshot readers and fixed it. See [Diagnosis](#diagnosis).
A hosted rerun on 2026-11-02 tested the fix. It was also INCONCLUSIVE. The snapshot p50 of the branch was below the interpolated `main` value in all four branch runs. The snapshot p95 is unresolved. Its median growth is -3.4 percent, or +7.5 percent when the one `main` run that changes the result most (M3) is left out. See [Hosted rerun](#hosted-rerun).
Every measurement before the hosted half was made on a local D1 database. Every measurement in the hosted half and in the hosted rerun was made on hosted D1. The diagnosis labels each of its numbers.

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
The hosted rerun after the fix is also INCONCLUSIVE. See [Hosted rerun](#hosted-rerun).
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

**Status.** Added on 2026-11-01 after the hosted half, on branch `feature/scoped-authority`. It names the cause of a measured D1 cost, the fix, and the local numbers before and after. The [hosted rerun](#hosted-rerun) of 2026-11-02 tested the fix against the list in [What a hosted rerun must confirm](#what-a-hosted-rerun-must-confirm).

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
On 2026-11-02 the owner decided to keep the compile-time test out of `npm run ci`. It runs with `npm run test:d1` before each merge.

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

## Hosted rerun

**Status.** Added on 2026-11-02 on branch `feature/scoped-authority`. It tests the fix of the [Diagnosis](#diagnosis) on hosted D1.
All numbers in this section are measured on hosted D1 from one small preview installation (measured, hosted). The installation has free-tier scale and at most 200 simulated users. The numbers do not establish production capacity.

### Hosted rerun result

The verdict is **INCONCLUSIVE**. It is not a pass, and it is not a fail.

- **The named limiter is the noise of the `main` runs.** Each interior `main` run differs from the line through its two neighbours by -28.3, +37.1, and -13.6 percent in snapshot p95. The 10 percent limit is smaller than that noise, so these runs cannot confirm or reject it (measured, hosted).
- **Snapshot p95.** The branch against the interpolated `main` value was +10.3, +1.2, -9.7, and -8.1 percent in the four branch runs. The median is -3.4 percent. The range is 20 points wide, which is twice the limit. One run exceeds the limit by 0.3 points (measured, hosted).
- **The p50 gap of the hosted half did not reappear.** That gap was +22 and +26 percent at p50 in the crossover. Here the snapshot p50 of the branch was below the interpolated `main` value in all four runs, by 2.5 to 26.2 percent. With M3 left out of the `main` series, it is still below in all four runs, by 2.5 to 8.6 percent (measured, hosted). The p50 row is not part of the rule. It moves less than the p95, because it does not depend on the slowest few requests.
- **The p95 gap is unresolved.** The gap of the hosted half was +11 to +58 percent at p95, with +11 and +24 percent in the crossover. Here the median is -3.4 percent. With M3 left out it is +7.5 percent, and two of the four runs exceed 10 percent. The p95 depends on the slowest few requests of a run, so it carries the noise of the `main` runs (measured, hosted).
- **Issue submit p95.** It was +35.4, -16.6, -26.5, and -1.5 percent. Each run holds only 10 to 18 submits, so this row cannot decide (measured, hosted).
- **D1 rows read per request.** The branch differed from the interpolated `main` value by -8.2, -4.2, +33.3, and -13.5. One run is above the limit of 10, so the rule marks the row as mixed (measured, hosted).
- **The announcement snapshot is at the level of `main`.** Its mean D1 time per call had a median of 1.37 ms (1.23 to 1.62) in B1 to B4 and 1.60 ms (1.30 to 2.08) in M1 to M5. The first hosted half saw 1.79 to 2.39 ms for the branch against 1.12 to 1.18 ms for `main`. The `main` mean is higher here than there, so the two installations differ in more than the code. It is not near 1.1 to 1.2 ms in absolute terms. It is near `main` in the comparison inside this installation. The branch reads 10 to 11 rows for each call and `main` reads 8, where the first hosted half counted 8 on both sides. The fix changed this statement, and the extra rows are within the local limit of 4 added rows (measured, hosted).
- **The first-run `ws-ready` timeouts did not appear.** See [First run and live sockets](#first-run-and-live-sockets).
- **The sessions list is the cost that remains.** It took 0.52 to 0.73 ms for each call on the branch and 0.18 to 0.25 ms on `main`. The Diagnosis lists it under "Not fixed". It adds about 0.4 ms of D1 time to about 1 request in 5 (measured, hosted). A queue could amplify that, but the snapshot p50 shows no gap, so I find no sign of amplification (inferred).

The gate is not met by its own rule, and it is not failed. The owner decides whether the supporting numbers are enough to merge Phase 1. I changed no code, and I did not build the per-login cache.

Against the list in [What a hosted rerun must confirm](#what-a-hosted-rerun-must-confirm):

1. A crossover on one installation, with database sizes controlled by interpolation. Done. The sizes were not matched, so the interpolation carries the control.
2. The announcement snapshot near the `main` level. Confirmed.
3. The snapshot p95 against the 10 percent limit. Not decided.
4. The wait of each D1 call from the Worker. Not run.
5. A first run on each side. Done for the branch only.

### What was fixed before the first run

I wrote this rule to a dated file before the first load ran, and I did not change it afterward.

- **Design.** One Worker, one D1 database, one R2 bucket, and one Durable Object namespace. Every run uses the same schema, with migration `0017` applied before the first run. The `main` code on that schema is the rollback case that `previousWorker.test.ts` covers.
- **Order.** B0 is a first run on branch code. It is excluded from the gate. Then M1 B1 M2 B2 M3 B3 M4 run on the warmed accounts. B is the branch code and M is the merge-base code.
- **Extension.** If the verdict was INCONCLUSIVE because a row was mixed or because the noise failed its gate, I would add B4 and then M5, and apply the same rule to all four B runs. That happened, so the data has 4 B runs and 5 M runs.
- **Statistics, at the 200-user step.** The snapshot p95, the `workflow:submit` p95, and D1 rows read per request. Rows read per request is the analytics `rowsRead` divided by the Worker `requests`, for the whole minutes inside the step.
- **Database size.** The mean of the issue counts before and after a run.
- **Interpolation.** For a B run, the `main` value is the linear interpolation by database size between the M run before it and the M run after it. The growth is B divided by that value minus 1. For rows, it is the difference.
- **Noise.** The same interpolation applied to each interior M run, between the M runs on each side of it.
- **Row states.** A row is **ok** when every B run is within the limit. It is **over** when every B run exceeds it. Otherwise it is **mixed**.
- **Verdict.** PASS when the snapshot p95, the submit p95, and the rows are all ok, and every snapshot noise value lies within 10 percent. FAIL when any of the three rows is over. INCONCLUSIVE otherwise. It is also INCONCLUSIVE when a step stops at the error limit, when `server` or `edge` failures differ between the sides, when the event-loop delay p99 is above 50 ms, or when `canary:static` is slow.

I added these after I saw the data, and they are labelled where they appear: the p50 and the other endpoint rows, the sensitivity analysis, and the interval of the mean.

Three of the four extra triggers did not fire. No step stopped at the error limit. No run had a `server` or `edge` failure. The event-loop delay p99 was at most 24 ms.
The fourth trigger may have fired. I set no number for "slow" before the runs. The `canary:static` p50 was 122 ms in B1 and 120 ms in B4, against 30 to 52 ms in the other eight runs (measured, hosted). I count B1 and B4 as runs with a slow canary. The canary does not call D1, so a slow canary means a slower network path or load machine in that run. That raises every latency of the run, so it biases B1 and B4 upward. B1 is the one run over the limit at p95 (+10.3 percent). The verdict is INCONCLUSIVE with or without this trigger, because all three rows are mixed and the noise is above the limit.
The issue rate stayed at its default, so the submit row stays weak.

### Resources and revisions

All resources have the `minsky-preview-rerun` prefix. The existing `minsky-preview` Worker and database, `minsky-dev`, `minsky-development`, `minsky-docs`, and every CI resource were not changed.

| Item | Value |
| --- | --- |
| Source of M | `6ecc656`, the merge base of `origin/main` and `origin/feature/scoped-authority`, built with `npm run build` in its own checkout |
| Source of B | `d4c0232`, the tip of `origin/feature/scoped-authority`. It includes the fix `c683066`. Built with `npm run build` |
| Worker | `minsky-preview-rerun-xo`, placement region `aws:ap-southeast-1`, `cpu_ms` 1000, cron every minute |
| D1 | `minsky-preview-rerun-xo`, location hint `apac`. Its primary served from SIN (Singapore) at every probe |
| R2 | `minsky-preview-rerun-xo-images` |
| Token | `minsky-agent-preview-rerun-20261102` with Workers Scripts Write, D1 Write, Workers R2 Storage Write, and Account Analytics Read on the Minsky account. It had a 7-day expiry. |

Each side has its own Wrangler configuration, made by `configure` in its own checkout. The two files differ only in the paths to the checkout. So a deploy from a checkout ships that checkout's Worker code and static assets. I migrated once, through the branch configuration, so both sides run on the schema with `0017`.

I deployed with `npx wrangler deploy` and not with `npm run deploy`. So `/minsky-revision.json` was absent and the harness printed `revision unknown`. Instead, I checked the live code after each deploy. I fetched `/` and compared the hashed script name with that of the checkout's `dist/index.html`. The names differ between the sides, and every probe matched the intended side. The Worker version of each run is in the run order table.

The competition file is the one of the first hosted half (SHA-256 `deceda544045791c…`). The setup counts are the same: 80 teams, 40 staff accounts, and 160 team accounts.

### Commands

The token came from a private file and reached each command only through that command's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `CLOUDFLARE_TOKEN_ADMIN` was used only by `npm run token:list` and `npm run token:create`. Down to `secret`, the commands ran once. The `load` commands ran from the branch checkout, where `scripts/load` is identical to the merge base.

```sh
git worktree add --detach /tmp/rerun-main 6ecc656
npm ci && npm run build            # in each checkout
npm run token:list                 # no agent token existed
npm run token:create -- REQUEST.json --out TOKEN_FILE
npx wrangler d1 create minsky-preview-rerun-xo --location=apac --config=PROVISION --update-config=false
npm run cloudflare:install -- plan --settings=PROVIDER --config=CONFIG_B
npm run cloudflare:install -- configure --settings=PROVIDER --config=CONFIG_B   # branch checkout
npm run cloudflare:install -- configure --settings=PROVIDER --config=CONFIG_M   # merge-base checkout
npx wrangler r2 bucket create minsky-preview-rerun-xo-images --config=CONFIG_B --update-config=false
npm run cloudflare:install -- migrate --config=CONFIG_B --account=ACCOUNT --database=DATABASE_ID
npx wrangler deploy --config=CONFIG_B                                            # branch checkout
npm run -s load -- competition --teams=80 > competition.json
npm run cloudflare:install -- bootstrap --config=CONFIG_B --account=ACCOUNT --database=DATABASE_ID --competition=competition.json --credentials=OWNER_FILE
npm run cloudflare:install -- secret --config=CONFIG_B --account=ACCOUNT --database=DATABASE_ID
npm run load -- setup --origin=ORIGIN --owner=OWNER_FILE --fixtures=FIXTURES --staff=40 --team-accounts=160
# Before each run, deploy the side of that run, wait 30 s, and check the live script name:
npx wrangler deploy --config=CONFIG_M                                            # merge-base checkout
npx wrangler deploy --config=CONFIG_B                                            # branch checkout
# Each run, after the check that no notification waits for delivery:
npm run load -- run --fixtures=FIXTURES --results=RESULTS --steps=50,200 --step-seconds=120
npm run load -- analytics --results=RESULTS --account=ACCOUNT --database=DATABASE_ID --worker=minsky-preview-rerun-xo
```

`PROVIDER` is a `provider.json` with `placementRegion` `aws:ap-southeast-1`. The `load` commands ran as `node scripts/load/cli.mjs`, which is what `npm run load --` runs. I ran `analytics` for each results file 7 to 8 minutes after its run, except the last, which I ran 4 minutes after it.

Two things differ from the first hosted half.

1. The first `bootstrap` failed and changed nothing. `npm run load -- competition` printed the npm banner into `competition.json`. Use `npm run -s` to write the file. The `installation` table was empty after the failure. I made the file again and ran `bootstrap` again.
2. Between runs, I counted the issues and the undelivered notifications with `wrangler d1 execute --remote`. The count of undelivered notifications was 0 before every run.

Three throwaway scripts are not in the repository. One reads the per-statement `d1QueriesAdaptiveGroups` of each run window, which `npm run load -- analytics` lists only for the top 10 statements. One computes the interpolation and the noise values. One writes the tables below. The raw result files stay on the measuring machine in `/tmp/rerun-private/results`.

### Run order

Each run is `--steps=50,200 --step-seconds=120`, 3 minutes for each step. Times are UTC on 2026-11-02. The database held 0 issues before B0.

| Run | Code | Worker version | Start | Issues before to after |
| --- | --- | --- | --- | --- |
| B0 | branch | `7657dca7` | 10:56 | 0 to 14 |
| M1 | merge base | `c7746618` | 11:04 | 14 to 28 |
| B1 | branch | `71f54ba5` | 11:11 | 28 to 42 |
| M2 | merge base | `382ecef9` | 11:19 | 42 to 53 |
| B2 | branch | `5c10d70c` | 11:26 | 53 to 73 |
| M3 | merge base | `7f199ab6` | 11:33 | 73 to 92 |
| B3 | branch | `db00cb40` | 11:41 | 92 to 112 |
| M4 | merge base | `2bc65ff2` | 11:48 | 112 to 129 |
| B4 | branch | `5399704b` | 11:56 | 129 to 143 |
| M5 | merge base | `60f2e73e` | 12:03 | 143 to 157 |

B0 is the first run of the accounts. They changed their temporary passwords in it. Account setup took about 3 minutes, and 0 notifications were waiting afterward.

### Results at the 200-user step

Latencies are milliseconds, from the harness (measured, hosted). The step has a 60 s ramp from 50 to 200 users and a 120 s hold. The snapshot rows hold 4,773 to 5,410 requests. "Failed" counts all failure classes. `ws-drop` is a socket that closed after it was ready.

| Run | snapshot p50 | snapshot p95 (n) | submit p95 (n) | action:submit p95 | Failed (share) | ws-ready p95 / max | ws-ready timeouts | ws-drop | canary:static p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| B0 | 802 | 1788 (5053) | 2284 (13) | 5926 | 0 (0.00%) | 4405 / 5713 | 0 | 0 | 52 / 105 |
| M1 | 617 | 1458 (5410) | 1804 (12) | 5730 | 0 (0.00%) | 2230 / 3782 | 0 | 0 | 36 / 141 |
| B1 | 576 | 1541 (4786) | 2344 (11) | 5940 | 1 (0.00%) | 1274 / 2057 | 0 | 1 | 122 / 377 |
| M2 | 579 | 1343 (4820) | 1666 (10) | 6431 | 1 (0.00%) | 2100 / 5270 | 0 | 0 | 41 / 270 |
| B2 | 657 | 1843 (4775) | 2088 (13) | 7442 | 6 (0.03%) | 1897 / 2645 | 0 | 0 | 43 / 275 |
| M3 | 1266 | 2423 (5254) | 3556 (18) | 11422 | 21 (0.09%) | 4594 / 5967 | 0 | 18 | 41 / 98 |
| B3 | 856 | 2097 (5060) | 2348 (12) | 6592 | 22 (0.10%) | 3134 / 3884 | 0 | 0 | 30 / 191 |
| M4 | 1057 | 2228 (5051) | 2849 (14) | 8268 | 13 (0.06%) | 2385 / 3160 | 0 | 7 | 46 / 97 |
| B4 | 932 | 2275 (4773) | 2687 (11) | 9996 | 103 (0.47%) | 2467 / 3499 | 0 | 47 | 120 / 262 |
| M5 | 864 | 2698 (4911) | 2618 (12) | 8609 | 46 (0.20%) | 2061 / 2755 | 0 | 0 | 39 / 373 |

The failures are `network` and `socket`. No run has a `server`, `edge`, `client`, or `limited` failure. The `network` failures fall on the D1 endpoints (`sessions`, `avatars`, `announcements`, `auth-session`, and `snapshot`) on both sides. The first four runs have none. B4 has 56 and M5 has 46, so the later runs have more of them, on both sides. The worst run is B4 with 103 failures out of 22,053 requests. The event-loop delay p99 was 11 to 24 ms, and the harness used 0.26 to 0.56 cores.

Server-side numbers for the same step, from Cloudflare analytics, 2 whole minutes in each run (measured, hosted). The call counts come from an adaptively sampled dataset, so treat them as estimates. The means do not depend on them.

| Run | Rows read per request | D1 queries per request | Worker CPU ms per request | D1 batch p99 ms | Announcement snapshot mean ms (calls) | Sessions list mean ms (calls) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| B0 | 57.6 | 4.07 | 8.8 | 4.8 | 1.50 (7346) | 0.66 (3803) |
| M1 | 84.6 | 3.92 | 7.2 | 6.4 | 1.48 (5991) | 0.18 (6303) |
| B1 | 97.4 | 3.91 | 7.9 | 6.1 | 1.62 (2079) | 0.63 (6419) |
| M2 | 124.3 | 3.87 | 6.9 | 7.2 | 2.08 (4184) | 0.21 (3394) |
| B2 | 149.7 | 3.90 | 7.8 | 6.5 | 1.43 (3364) | 0.55 (3892) |
| M3 | 191.2 | 3.98 | 8.9 | 8.4 | 1.30 (4537) | 0.22 (2828) |
| B3 | 253.3 | 3.86 | 7.7 | 8.4 | 1.23 (4054) | 0.52 (3281) |
| M4 | 247.3 | 3.86 | 8.8 | 9.7 | 1.66 (5946) | 0.24 (6819) |
| B4 | 260.6 | 3.87 | 9.1 | 9.5 | 1.31 (3643) | 0.73 (3227) |
| M5 | 298.3 | 3.90 | 8.9 | 11.2 | 1.60 (2834) | 0.25 (6270) |

The announcement snapshot and the sessions list are matched by their SQL text, which differs between the sides. The sessions list is `SELECT s.id, s.name FROM sessions s JOIN memberships` on `main` and `SELECT session_id AS id, session_name AS name FROM` on the branch. The means cover the 200-user step window of each run, ramp included. They come from a separate query of the same analytics, so they do not equal the per-minute figures of the other columns.

### Comparison with the threshold

Each B run against the `main` value interpolated by database size between its two neighbouring M runs. Growth is B divided by M minus 1, except for rows, which is the difference (measured, hosted).

| B run | M neighbours | snapshot p95: B against M | snapshot p50: B against M | submit p95: B against M | Rows per request: B against M |
| --- | --- | --- | --- | --- | --- |
| B1 | M1, M2 | 1541 against 1397 (+10.3%) | 576 against 597 (-3.5%) | 2344 against 1731 (+35.4%) | 97.4 against 105.6 (-8.2) |
| B2 | M2, M3 | 1843 against 1821 (+1.2%) | 657 against 883 (-25.7%) | 2088 against 2503 (-16.6%) | 149.7 against 153.9 (-4.2) |
| B3 | M3, M4 | 2097 against 2323 (-9.7%) | 856 against 1159 (-26.2%) | 2348 against 3193 (-26.5%) | 253.3 against 220.0 (+33.3) |
| B4 | M4, M5 | 2275 against 2475 (-8.1%) | 932 against 956 (-2.5%) | 2687 against 2727 (-1.5%) | 260.6 against 274.1 (-13.5) |
| Median | | -3.4% | -14.6% | -9.0% | -6.2 |
| Range | | -9.7% to +10.3% | -26.2% to -2.5% | -26.5% to +35.4% | -13.5 to +33.3 |

By the rule, the snapshot p95 is mixed, the submit p95 is mixed, and the rows are mixed.

The mean of the four p95 growth values is -1.6 points, with a standard deviation of 9.3 points. A t interval at 95 percent for that mean runs from -16 to +13 percent. The upper end is above the limit, so four runs cannot exclude growth of more than 10 percent (inferred from four values, not part of the rule).

**Noise.** Each interior M run against the line through the M runs on each side of it. Those neighbours are two runs apart, so these values include more database growth than the B values do (measured, hosted).

| M run | snapshot p95 | snapshot p50 | submit p95 | Rows per request |
| --- | --- | --- | --- | --- |
| M2 | 1343 against 1874 (-28.3%) | 579 against 897 (-35.5%) | 1666 against 2559 (-34.9%) | 124.3 against 130.6 (-6.3) |
| M3 | 2423 against 1767 (+37.1%) | 1266 against 808 (+56.7%) | 3556 against 2233 (+59.3%) | 191.2 against 183.3 (+7.9) |
| M4 | 2228 against 2578 (-13.6%) | 1057 against 1040 (+1.7%) | 2849 against 3028 (-5.9%) | 247.3 against 251.5 (-4.1) |

The snapshot p95 noise is outside 10 percent for all three M runs, so the noise gate of the rule fails.
M3 changes the comparison most. In M3 the p50 of every D1 endpoint was about twice that of M1 and M2, including `auth-session`, whose SQL is the same on both sides (970 ms, against 367 ms in M2). M3 had 21 failures, 18 of them `ws-drop`. So the slowdown belongs to the whole run and not to one endpoint (measured, hosted). The cause is not known.

**Sensitivity, not part of the rule.** I chose these after I saw the data. They show whether the verdict depends on M3.

- With M3 removed from the M series, the snapshot p95 growth of B1 to B4 is +10.3, +20.4, +4.7, and -8.1 percent. The snapshot p50 growth is -3.5, -3.5, -8.6, and -2.5 percent. The submit p95 growth is +35.4, +8.9, -7.9, and -1.5 percent. The p95 rows are still mixed, so the verdict stays INCONCLUSIVE (measured, hosted). The B2 comparison then spans M2 to M4, four runs apart, so it includes more growth.
- A line of each side against database size, evaluated at the mean size of 84 issues, gives a snapshot p95 of 2,029 ms for M and 1,940 ms for B, which is -4.4 percent. The snapshot p50 is 876 and 756 ms, which is -13.8 percent. The residual standard deviation of the p95 line is 317 ms for M and 61 ms for B (measured, hosted). The M runs are the noisy ones in this installation. So the noise does not come from the branch code.

**Rows read per request.** Rows read per request grows with database size on both sides, from 58 with 0 to 14 issues to 298 with 143 to 157 issues. The M series is nearly linear, with residuals of -6.3, +7.9, and -4.1. The B series is not. B3 reads 33 rows more than the interpolation, and B4 reads 13.5 fewer. The statement that moves most is the session snapshot. Its rows per call were between 71 and 1,420 in the ten runs, on both sides, with the same SQL text and the same accounts (measured, hosted). The analytics cut the text of this statement at 4,096 characters. I do not know why the rows change. A plan change as the tables grow is a guess that I did not test. The local result stays the stronger evidence for rows. In `npm run perf:reads` no request type reads more than 4 added rows (measured, local D1, see [Before and after](#before-and-after)).

**The design's literal rule.** The rule compares the better run of each Worker. The better B run is B1 at 1,541 ms, with 35 issues. The better M run is M2 at 1,343 ms, with 47 issues. That is +14.7 percent. The two runs differ in database size, and the M run is a low outlier of its series (-28.3 percent against its neighbours). So the number does not test the limit. Interpolating M at the size of B1 gives +10.3 percent.

### What limits the numbers

- **The `main` runs are noisy.** Their p95 deviates from the line through their neighbours by up to 37 percent. Their p50 deviates by up to 57 percent in M3 (measured, hosted). A 10 percent limit on p95 needs more runs. With a standard deviation of 9 points for the growth, a standard error of 3 points needs about 10 B runs and as many M runs (inferred). That is about 80 more minutes of load.
- **The load is a queue.** The snapshot p50 is 86 to 181 ms at 50 users and 576 to 1,266 ms at 200 users, with Worker CPU per request at 7 to 9 ms (measured, hosted). The cost per request is flat while the latency grows, so requests wait for a shared resource (inferred). I did not find which one. That is the same finding as the first hosted half.
- **Database growth.** Latency rises with issues on both sides, at about 10 ms for each issue at p95 on the `main` line and 7 ms on the branch line (measured, hosted). The interpolation assumes that the growth is linear between neighbours. The M runs show that it is not.

### What else the numbers could be measuring

- **Cold starts.** Each run starts after a deploy and a 30 s wait, and then a preflight and the 50-user step. The snapshot p50 of the 50-user step is 86 to 139 ms in the branch runs and 97 to 181 ms in the `main` runs, so the sides overlap there. Cold starts do not explain a 200-user difference between the sides (measured, hosted).
- **The load machine and the network.** The harness used 0.26 to 0.56 cores of 16. The event-loop delay p99 was at most 24 ms. `canary:static`, which the Worker serves without D1, had a p50 of 30 to 52 ms in eight runs and of 122 and 120 ms in B1 and B4. Its p95 reached 377 ms. Both slow runs are branch runs, so I cannot say that the canary does not follow the code. A slow canary biases a run upward (see [What was fixed before the first run](#what-was-fixed-before-the-first-run-1)). The `network` failures rose through the session on both sides. They may come from the load machine or its network. I did not test that.
- **Work that did not happen.** The Worker made 3.86 to 4.07 D1 queries per request in every run, on both sides. No step stopped at the error limit. The largest share of failed requests is 0.47 percent.
- **A different schema.** Both sides ran on `0017`, so the M runs include its triggers and tables. In the first hosted half, `main` code on the schema without and with `0017` gave almost the same snapshot p95 (1672 and 1665 ms).
- **D1 and the Worker in one city.** This installation has its D1 primary in SIN and its Worker placement in Singapore. The first hosted half had its D1 primaries in NRT and ICN. The snapshot p50 at 50 users was 86 to 181 ms here and 357 to 391 ms there. The queue that the first hosted half found may depend on that distance, because each request makes about 4 sequential D1 calls (inferred). So this rerun may under-represent it.

### First run and live sockets

B0 is a first run on branch code. It had no `ws-ready` timeout at either step, and no failed request. Its `ws-ready` p95 was 1,132 ms at 50 users and 4,405 ms at 200 users, with a maximum of 5,713 ms. The cutoff is 10,000 ms (measured, hosted).
No run in this rerun had a `ws-ready` timeout. The first hosted half had 399 and 455 of them in two first runs of the branch.
I ran no first run on `main` code, so this record cannot say whether the first-run timeouts belong to the code. It can say that B0 on this installation did not show them. The `ws-drop` count was 0 to 47 in a run, on both sides.

### Not run

- A first run on `main` code. The design has no comparator for B0.
- A per-call trace of the sequential D1 calls of a request. See [What would decide](#what-would-decide).
- The per-login authority cache. The gate did not fail, so the contract does not call for it.
- The harness cleanup step. The database was deleted instead.
- Any claim about production capacity.

### What would decide

The p95 of the harness cannot decide a 10 percent limit in this installation. These are the options.

1. **More runs.** About 10 B runs and 10 M runs, in the same alternating order. About 80 more minutes. It is the only option that tests the design's own statistic.
2. **A per-call trace.** It shows where a request waits. It needs a token with Workers Observability Read, or a logging change in the Worker, to record the start and the end of each D1 call of a request, with its request ID. The token script allows Workers Observability Read, and Workers Logs are enabled on the Worker. With the trace, the 0.4 ms of the sessions list and the wait for a shared resource can be separated. This is item 4 of [What a hosted rerun must confirm](#what-a-hosted-rerun-must-confirm).
3. **A statistic with less noise.** The mean D1 time of the announcement snapshot and of the sessions list are server-side values with thousands of calls, and they agree with the local compile results. They do not measure the queue, which is what the p95 measures.

### Cleanup

I deleted the resources in this order, with the token still valid. First the Worker, with `npx wrangler delete --name minsky-preview-rerun-xo --force`. Then the bucket, with `npx wrangler r2 bucket delete minsky-preview-rerun-xo-images`. Then the database, with `npx wrangler d1 delete minsky-preview-rerun-xo --skip-confirmation`.

Before the deletion, the API listed exactly one resource with the prefix `minsky-preview-rerun` in each of four lists. They were D1 databases (7 listed), R2 buckets (4), Worker scripts (7), and Durable Object namespaces (4). The namespace was `minsky-preview-rerun-xo_SessionLiveCoordinator`.
After the deletion, the same four lists showed 0 resources with the prefix (6, 3, 6, and 3 listed). So the namespace went with the Worker. The Worker delete command printed a warning about reading membership roles and still deleted the Worker.

Then I deleted the token `minsky-agent-preview-rerun-20261102` with `npm run token:delete`. `npm run token:list` then listed no agent token. I removed the token file, the owner file, and the fixture file. The result files stay on the measuring machine in `/tmp/rerun-private/results`.

## Extended hosted run

**Status.** Stopped before any load run, so this section holds no data. Added on 2026-11-02 on branch `feature/scoped-authority`. The owner accepted the gate on 2026-11-02 (see [Owner decision](#owner-decision)), and the run stopped. Its preview resources and token were deleted. It repeats the [hosted rerun](#hosted-rerun) with more alternating runs, to test the 10 percent limit of the gate. The rerun could not test it, because its `main` runs varied from -28 to +37 percent.
All numbers in this section are measured on hosted D1 from one small preview installation (measured, hosted). The installation has free-tier scale and at most 200 simulated users. The numbers do not establish production capacity.

### Pre-registration

I finished this section at 12:36 UTC on 2026-11-02, before I created any resource and before the first load run. I commit it before I collect data, and I do not change it after I see data. Any analysis that I add later is labelled post hoc where it appears.

**Claim.** At the 200-user step on hosted D1, the snapshot read p95 of the branch is less than 10 percent above the p95 of the merge-base `main` code, at the same database size.

**Design.**

1. One installation. It has one Worker, one D1 database, one R2 bucket, and one Durable Object namespace. Every name starts with `minsky-preview-extend`. Both sides deploy to the same Worker.
2. M is the merge-base code `6ecc656`. B is `35d0ae2`, the tip of `origin/feature/scoped-authority` at 12:30 UTC. Its code equals that of `d4c0232`, because only this record differs. I build B from my own checkout. If code commits reach the branch while I run, the record names the commit that I tested. I apply migration `0017` before the first run, so M runs on the schema of B.
3. Run order: W0, M0, B1, M1, B2, M2, and so on to B10, M10. W0 is a first run on M code. Its accounts change their temporary passwords. No statistic uses W0. Pair j is run B_j with the runs M_(j-1) and M_j next to it.
4. Every run is `npm run load -- run --steps=50,200 --step-seconds=120` with every other option at its default.
5. Region. I create the D1 database with `--location=apac`. The hosted rerun served its primary from SIN, so I accept only a database that serves from SIN. I read the data centre from the `meta` of `wrangler d1 execute --remote --json`. Otherwise I delete the database and try again, up to 5 tries in all. A try is named `minsky-preview-extend-db-N`. If the fifth try is not SIN either, I keep it, and the record names its data centre as a difference from the rerun. The Worker uses the placement region `aws:ap-southeast-1`, as in the rerun.
6. Slots. A slot starts every 9 minutes on a fixed clock from W0, whatever the side. In a slot I do these steps in this order: check that no notification waits for delivery and count the rows of the `issues` table, deploy the side, wait exactly 30 s, check the live script name against the checkout, and start the load. If a notification waits, I check again each 15 s until none does. If the slot time has passed, the slot starts at once, and the lateness is logged. The time from the deploy to the load start is the same for both sides. The size of a run is the mean of the issue count before it and the count before the next run, or after the last run.
7. Eight minutes after each run ends, I add Cloudflare analytics to its results with `npm run load -- analytics`.

**Statistic.** For each pair j:

- `m_j` is the linear interpolation, by size, of the snapshot p95 of M_(j-1) and M_j, evaluated at the size of B_j.
- `g_j = p95(B_j) / m_j - 1`. The p95 is the `snapshot` row of the 200-user step in the results file.

**Decision rule.** Let n be the number of valid pairs.

- `ḡ` is the mean of `g_j`. `s` is the standard deviation of `g_j`.
- `r` is the lag-1 autocorrelation of `g_j` in time order, limited to the range 0 to 0.5. Adjacent pairs share one M run, so the structure allows no more than 0.5.
- `SE = s × sqrt((1 + 2r(n-1)/n) / n)`.
- `U = ḡ + t × SE` and `L = ḡ - t × SE`, with `t` the 95th percentile of the t distribution with n - 1 degrees of freedom.
- **PASS** when `U` is below 10 percent. **FAIL** when `L` is above 10 percent. **INCONCLUSIVE** in every other case.

The design's literal rule, the better run of each Worker, is not used. It compares runs of different sizes and selects on the outcome.

**Valid runs.** No rule for a valid run uses a latency of the `snapshot` row, so the sides cannot bias it.

- A run is invalid when its 200-user step stopped at the error limit, when its event-loop delay p99 is above 50 ms in either step, when the 1-minute load average of the machine is above 8 at the end of either step, when its live script name did not match its side, or when its `load` command failed. The machine has 16 logical cores.
- `canary:static` is reported and is not a rule. This Worker runs first for every request, so its own code serves the canary, and the canary does not measure the network alone.
- No run is dropped for a high or low latency.
- An invalid M run leaves the M series, and the pairs next to it use the nearest valid M run on each side. A B run with no valid M run on one side leaves the pairs, and W0 does not fill in. An invalid B run leaves the pairs.
- If fewer than 10 valid pairs remain after B10, I append B and M runs in the same alternating order until 10 valid pairs exist or 14 B runs have run.
- The verdict is INCONCLUSIVE, whatever the statistic, in each of these cases. One side has 5 or more `server` or `edge` failures in total and the other side has none. More than 30 percent of the runs are invalid.

**One extension.** If the verdict at 10 valid pairs is INCONCLUSIVE and neither of those two cases applies, I add 6 pairs and apply the rule once more to all 16. The verdict of the 16 is final. I report both. The stop after the first 10 is a second look at the data, so the 95 percent level is slightly optimistic for the final verdict.

**Reported, not deciding.**

- The mean and the median of `g_j`, and the count of B runs above 10 percent.
- The same statistic with no run dropped.
- The same statistic for the snapshot p50 and for the `workflow:submit` p95. The submit row holds 10 to 20 requests in a run, so its p95 is close to a maximum.
- Rows read per request, the difference of B and the interpolated M. It is the analytics `rowsRead` divided by Worker `requests` for the whole minutes of the 200-user step. The local `perf:reads` result stays the evidence for the rows condition.
- `ws-ready` timeouts, failures by class, `canary:static`, and the D1 mean time of the sessions-list statement and of the announcement snapshot, by side.
- The first half and the second half of the pairs, to see whether the growth depends on database size.

**Limits that I state before the data.**

- The verdict covers only the snapshot half of the design's rule. The issue submit half is not decided, because its p95 rests on 10 to 20 requests in a run.
- A PASS needs `ḡ` well below 10 percent. If `s` is 12 points, `r` is 0.25, and n is 10, then `U` is `ḡ` + 8.4, so PASS needs `ḡ` below 1.6 percent. The pairs share M runs, so noisy M runs widen the bound.
- The database grows by about 15 issues in each run, to about 330 after M10 and to about 500 after the extension. The rows read for each snapshot grow with it, and the added resolver cost does not, so the relative growth can shrink in late pairs. In the rerun, `network` failures rose with database size on both sides (103 in B4 and 46 in M5 at about 150 issues). If late steps reach the 5 percent error stop, the invalid-run rule applies, and the verdict can become INCONCLUSIVE for that reason.
- W0 is a first run on `main` code. It fills a gap in the rerun's "Not run" list. I report its `ws-ready` timeouts next to B0 of the rerun, and the installations differ.
- Another session uses this machine. The event-loop and load-average rules limit its effect, and the load average of each run is recorded.
- Hosted D1 at this scale does not establish production capacity.

## Owner decision

On 2026-11-02 the owner accepted the Phase 1 performance gate on the evidence of the [hosted rerun](#hosted-rerun) and the [diagnosis](#diagnosis). The rerun was inconclusive against the 10 percent p95 rule, because `main` itself varied from -28 to +37 percent between runs. After the compile-time fix, the branch's snapshot p50 was below `main` in all four runs, and its snapshot p95 was a median 3.4 percent below `main`. Rows read, Worker CPU, and D1 query counts matched `main`.

Before the merge, the owner ran two read-only queries on `minsky-development`. Both `organizer` and `playtest-admin` hold a contest admin membership and no team seat, so migration `0017` promotes both to webmasters. No account was reported with memberships in two events.
