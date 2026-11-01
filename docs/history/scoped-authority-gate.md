# Scoped authority read gate, 2026-11-01

**Status.** Dated record. It is the local half of the Phase 1 gate in the [event platform design](../event-platform-design.md#delivery-phases), on branch `feature/scoped-authority`.
The hosted half of the gate on `minsky-preview` was not run. Nothing on this page was measured on hosted D1.

Each claim carries one of these labels:

- **Measured** means a number that `npm run perf:reads`, a repository test, or a local probe printed on a local D1 database.
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

The design's fallback, a per-login authority cache, was not built, because the gate passes.

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

## Not run

- The hosted half of the gate: the `main` Worker and the branch Worker on a `minsky-preview-*` Worker, `npm run load -- run --steps=50,200 --step-seconds=120` twice each, and `npm run load -- analytics`. Its two conditions, the p95 latency at 200 users and the D1 rows read per request from analytics, stay unmeasured.
