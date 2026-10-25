# Run a load test

Use this guide before a contest to check that an installation holds the expected number of simultaneous users.
The load test signs in many fictional accounts, keeps their live connections open, repeats the frontend's normal refreshes, and runs a mix of workflow commands.
It reports latency per request and per user action, the delay before other screens show a change, error rates, and the load on the test machine.
For the measured results and what they mean for capacity, see [Scaling design](scaling-design.md).

The load test writes fictional issues, history, and accounts that Minsky cannot delete. Run it only on an installation that exists for testing.
Never point it at development, CI, or production data.
The command refuses any origin whose Worker name does not start with `minsky-preview`, unless you confirm the exact origin with `--isolated-origin`.

## Prerequisites

You need:

- A checkout of the revision that you want to measure, with `npm ci` complete.
- A fresh installation made with [Install on Cloudflare](../site/src/content/docs/operators/installation.mdx), on Workers Paid. Give its Worker, D1 database, and R2 bucket new names, for example `minsky-preview-load`, `minsky-preview-load`, and `minsky-preview-load-images`.
- The private owner file from the installation's `bootstrap` step, or from `recover` if the bootstrap result was lost.
- Node.js 22.13 or later on a machine with at least 8 CPU cores and 50 Mbit/s or more download bandwidth. A step of 800 users opens 800 WebSocket connections from this machine.
- A revision that includes PR #86. Before it, one IP address could sign in only 50 times in 15 minutes, so one machine could not sign in 800 accounts. Since PR #86, only failed sign-ins count.

## Create the installation

1. Generate a competition file with enough fictional teams. Two accounts per team and 20% staff need 0.4 teams per user. For 1,200 users, use 480 teams.

   ```sh
   npm run load -- competition --teams=480 > "$PRIVATE_DIR/competition.json"
   ```

2. Follow [Install on Cloudflare](../site/src/content/docs/operators/installation.mdx) with that competition file. Keep the owner file in `$PRIVATE_DIR`, outside the checkout.

The harness uses only the installation's normal HTTP API. It needs no Cloudflare credential to create accounts or to run the load.

## Create the fictional accounts

Run `setup` with the installation's origin and the owner file:

```sh
npm run load -- setup --origin=https://minsky-preview-load.ACCOUNT_SUBDOMAIN.workers.dev \
	--owner="$PRIVATE_DIR/owner.json" --fixtures="$PRIVATE_DIR/fixtures.json" \
	--staff=240 --team-accounts=960
```

The command signs in as the owner, changes the temporary password, opens intake, and creates each account through **Create account**.
Staff accounts get the volunteer role. Team accounts are spread over the teams, two per team by default.
Usernames start with `load-RUNID-`, where `RUNID` is 8 hexadecimal characters chosen for this fixture file.

`fixtures.json` holds the temporary passwords and a secret that derives each account's later password. The command creates it with mode `0600`. Keep it private, and delete it when you delete the installation.

If `setup` stops, run the same command again. It creates only the missing accounts. It resets the password of an account that exists without a saved password.
On 2026-10-25, creating 1,200 accounts with 6 requests at a time took 7 minutes.

Each new account writes live notifications, and the installation delivers them at about 100 rows a minute. Wait until none remain before you run the load. Otherwise the run measures that backlog.
Check the count with the installation's configuration:

```sh
npx wrangler d1 execute minsky-preview-load --remote --config="$MINSKY_INSTALL_CONFIG" \
	--command='SELECT count(*) AS pending FROM notifications WHERE delivered = 0'
```

On 2026-10-25, the notifications from 1,200 new accounts took 49 minutes to reach 0. A stopped step leaves more undelivered rows, so check the count again before the next run.

## Run the load steps

Run the steps with the fixture file:

```sh
npm run load -- run --fixtures="$PRIVATE_DIR/fixtures.json" --results="$PRIVATE_DIR/results.json" \
	--steps=50,200,800,1200 --ramp-seconds=60 --step-seconds=120
```

Before the first step, the command signs in as the owner and opens one live connection. If the connection does not answer within 5 seconds, the command stops without load.
This check does not detect undelivered notifications. A socket can open while thousands remain, so check the count above first. See [Scaling design](scaling-design.md#account-setup-floods-the-live-channel).

Each step adds users until the step's total is active, then holds that total.
New users sign in during the ramp. At the first run each account also changes its temporary password, like a team at the start of a contest.
Users from earlier steps stay connected.
Every 2 seconds the command checks failures in the current step. If more than 5% of requests failed, it stops the step and runs no later step. Change the threshold with `--max-error-rate`.

Each user repeats the frontend's requests for one open browser tab:

- Every 10 seconds: sessions and snapshot, one after another, the account check, announcements, and profile pictures.
- Every 60 seconds: one more account check.
- On each live `change` message: sessions and snapshot, announcements, and profile pictures.
- Before each command: the account check that supplies the CSRF token. After the command: sessions and snapshot.

Team accounts submit issues at random times. The default rate is 4 issues for each team in an hour. Change it with `--issues-per-team-hour`. Use `0` to measure polling and connections without new issues.
When their team has a claimed issue, team accounts reply to it in 30% of their turns.
Each staff account waits 4 to 10 seconds between turns. In a turn it claims an open issue, replies to its claimed issue, or resolves the issue after its reply.
Staff divide open issues by issue number, so two staff members rarely claim the same issue.

After the last step the command stops new commands for 20 seconds, so that screens can show the last changes. Then it writes the results file.

## Read the results

The command prints one table for each step and writes every number to the results file.

| Row | Meaning |
| --- | --- |
| `sessions`, `snapshot`, `auth-session`, `announcements`, `avatars` | One HTTP request each. |
| `workflow:KIND` | The command request alone. |
| `action:KIND` | What a person waits for: the CSRF read, the command, and the refresh after it. |
| `action:first-sign-in` | Sign-in with the temporary password, the session read, and the password change. |
| `action:sign-in` | Sign-in with the account's current password and the session read. |
| `action:first-load` | The first sessions and snapshot after sign-in. |
| `ws-ready` | From opening the WebSocket to its `ready` message. |
| `canary:static` | A file that the Worker serves without D1. If it slows down, the network or the test machine is the limit. |
| `canary:anonymous-api` | An API request without a cookie. It returns `401`. |

The live delivery line counts each command once for each other person who should see it: every staff member, and the accounts of the issue's team.
"Data visible" is the time from the moment the person who sent the command received the response until another person's snapshot showed the change.
"Hint" is the time until the `change` message arrived that started that refresh. "Found by polling" counts changes that a 10-second refresh found first.
"Missed" counts changes that did not appear within 15 seconds.

Failures are counted by class:

| Class | Source |
| --- | --- |
| `server` | The Worker returned `5xx` with a JSON body. |
| `edge` | An error response without a JSON body. Cloudflare sent it before the Worker, for example a rate limit page. |
| `client`, `limited` | The Worker refused the request with `4xx` or `429`. |
| `network`, `timeout` | No response, or no response within 30 seconds. |
| `socket` | A WebSocket closed or failed to open. |

A `409` from a workflow command is a conflict between two people, not a failure. It is counted separately.

Check the harness columns before you trust a step. Event-loop delay p99 above 50 ms, or CPU near the machine's core count, means the test machine limited the result.

## Add server-side cost

Analytics reach the Cloudflare API one or two minutes after the requests. Wait 3 minutes after the run, then run:

```sh
CLOUDFLARE_API_TOKEN=… npm run load -- analytics --results="$PRIVATE_DIR/results.json" \
	--account=ACCOUNT_ID --database=D1_UUID --worker=minsky-preview-load
```

The token needs read access to account analytics. Supply it through your private environment, never as an argument.
The command adds, for each step, the average per minute of D1 queries, rows read and written, Worker requests and CPU time, and Durable Object CPU time. It uses only the minutes that lie wholly inside the step.
It also lists the 10 D1 statements with the largest total duration in the whole run.

## Clean up

1. Remove the run's accounts from the session:

   ```sh
   npm run load -- cleanup --fixtures="$PRIVATE_DIR/fixtures.json"
   ```

   Minsky keeps every issue, reply, and resolution, so they stay in the database.

2. Delete the test installation when you no longer need it. Check each name before you confirm:

   ```sh
   npx wrangler delete --name minsky-preview-load
   npx wrangler r2 bucket delete minsky-preview-load-images
   npx wrangler d1 delete minsky-preview-load
   ```

   The load test uploads no images. If you uploaded images by hand, delete them in the dashboard first, because R2 deletes only an empty bucket.
   On 2026-10-25, deleting the Worker also deleted its Durable Object namespace.

3. Delete `$PRIVATE_DIR`, which holds the owner and fixture files.
