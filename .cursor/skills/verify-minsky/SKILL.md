---
name: verify-minsky
description: Drive the Minsky contest-support web app in a local browser and capture evidence. Use when a change affects sign-in, contestant reports, the staff queue, jury awards, or account administration.
---

# Verify Minsky

Minsky's primary surface is the web app. Contestants report issues. Staff claim and reply. Jury members record time awards. Administrators manage accounts. After sign-in, the membership and the window width select one of three layouts: the contestant desktop, the organiser phone layout below 1024 px, or the organiser desktop console at 1024 px and wider.

This skill drives the local Cloudflare backend. D1 stores the rows. R2 is the local image bucket. A Durable Object serves live updates. Supabase remains a supported second provider. This skill does not start it.

This skill does not drive the documentation site, maintainer npm scripts, or a deployed Worker. Those are separate surfaces.

## Launch

Run the commands from the repository root. Install dependencies and Chromium first:

```sh
npm ci
npx playwright install chromium
```

Use Node.js 22.13 or later within 22.x, or Node.js 24 or later.

Leave the serve process running in its own terminal. On a machine that uses tmux, use a session named `verify-minsky`.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts serve --seed empty
```

Use `--seed jury` when the journey needs the six existing issues. The default viewport is `1280x800`. Pass `--viewport 390x844` for the organiser phone layout. Set the viewport before sign-in.

Stdout prints this line only after the **Sign in** heading is visible:

```text
ready https://127.0.0.1:5199
```

That line means the page can accept a username and a password. An HTTP response alone is not ready. The first start builds the frontend and hashes passwords, so it can take a few minutes.

The helper binds `127.0.0.1:5199` for the local Worker, `127.0.0.1:5198` for its own commands, and `127.0.0.1:9223` for Chromium. Each `serve` deletes `.verify-minsky/state` and creates `.verify-minsky/state/persist`. Wrangler receives that directory as `--persist-to`. The helper applies every file in `src/server/adapters/d1/migrations` with `wrangler d1 migrations apply --local`. It then bootstraps the installation and creates the other accounts through the account API.

The empty seed has no issues. The event is **Jury verification**. The session is **Primary**. Intake is open. The teams are **Aurora** at A12 and **Cedar** at A18. The accounts are `contestant` on Aurora, `volunteer`, `specialist`, `jury`, `admin`, and `combined`. The combined account has volunteer, specialist, and jury roles. Bootstrap creates one session. The account API does not add a second session, so this seed has no Secondary session and no Isolated team.

The jury seed adds six issues through the workflow API. None of them are open. Award review uses that seed.

The feature files type the password `verification-only`. The local Worker stores it with Better Auth. The value is a local verification password. It is not an organizer password.

### Isolation

One verification session owns the ports above. A second `serve` exits with an error when a recorded process is still alive or when any of those ports is taken. It does not kill the other process, and it does not attach a second browser to the same Chromium.

Do not start `npm run dev` for this skill. That command uses port 5173. This skill does not read `.env.local`. It does not call `wrangler login`, `npm run cloud:hosting-login`, or any remote Wrangler command. The generated config has no account id, and its D1 and R2 bindings are local. The database name is `minsky-verify-local-only`. It is not `minsky-development`.

### Local Worker

`serve` performs these steps inside the session directory:

- Vite builds the frontend with `VITE_BACKEND=cloudflare`. The build reads environment files from the empty session directory, so it does not load `.env.local`.
- Wrangler applies `src/server/adapters/d1/migrations` to a new local D1 database.
- `bootstrapInstallation` creates the event, the Primary session, the two teams, and the admin account. The password hash is Better Auth's hash. The operations log records the bootstrap. The local platform proxy prints a Durable Object warning because that proxy does not export `SessionLiveCoordinator`. The warning does not stop `wrangler dev`. The running Worker serves the **Live** badge.
- The helper signs in as admin, changes the temporary password, opens intake, and creates the other accounts with `POST /api/accounts`. Each account then changes its temporary password through `POST /api/auth/change-password`.
- `--seed jury` submits, claims, resolves, awards, applies, and reopens through `POST /api/workflow`. The helper does not insert auth rows or issue rows by hand.
- `wrangler dev --local` serves the built app and the API on `https://127.0.0.1:5199`. The browser accepts the local certificate. Requests stay on the machine.
- Chromium is headless. The helper sets the viewport and a light color scheme.

A passing local journey does not verify the hosted `minsky-development` database or a deployed Worker.

Tear the session down with Cleanup. Run Cleanup after a failed launch too, so the ports do not stay occupied.

## Doctor

Doctor is read-only. Run it before a journey, and again when the page looks wrong.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts doctor
```

Exit code 0 and `"ok": true` mean all of the following:

- The recorded `serve` process, Wrangler process, Worker listener, and Chromium process are alive.
- Their command lines still match this checkout's helper, `wrangler.js` with this session's config, the Worker listener, and Chromium's debugging port 9223.
- `lsof` shows each of those processes as the only listener on its port.
- The page shows the **Sign in** heading, or a signed-in layout whose root has `data-ui` of `contestant`, `organiser-phone`, or `organiser-desktop`.
- A read of the admin account through the local API returns session **Primary** and event **Jury verification**.

Any other result means the session is not worth driving. Run Cleanup and start `serve` again. Do not reuse a Worker you did not start.

## Drive

Drive the open Chromium window with the helper. The feature files in `features/` are the recipes. Prefer accessible roles and names. Use a CSS selector only where the layout root publishes `data-ui`.

Useful handles from this app:

- Sign-in fields: label **Username**, label **Password**, button **Sign in**. The heading is **Sign in**.
- Contestant shell: complementary region **Your reports**, button **Report an issue**, heading **Report an issue**, label **What is happening?**, button **Send report**, region **Your report**. The category choices are **Problem statement**, **Devices**, **Backend**, and **Other**.
- Connection badge: the visible text is **Live**. The status role has no accessible name, so wait with `wait-text --text Live --exact`.
- Contestant account menu: button **Account menu for Aurora**, then menuitem **Sign out**.
- Desktop console navigation: navigation **Console pages**. Staff buttons include **Queue**, **Award review**, and **Accounts**. The visible names can include a count. Omit `--exact` when the recipe says the count is present.
- Phone tabs sit in navigation **Organiser sections**.

Run one action per command. A command prints one JSON object. `"ok": true` and exit code 0 mean the action completed. A missing control, a strict-mode duplicate, or a timeout returns `"ok": false` and exit code 1. Stop the journey and report that result.

Append every JSON line to the transcript named in the feature file. Create the evidence directory before the first screenshot.

Set the phone viewport before sign-in when the recipe needs it:

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts viewport --width 390 --height 844
```

Scope a control that is also present on the page behind a dialog:

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Create account" --exact --within-role dialog --within-name "Create account" --within-exact
```

Do not call workflow functions, test fixtures, or `fixture.act()` to perform a user action. The snapshot command is a read after the click. It is not a substitute for the click.

## Evidence

Write proof under `.verify-minsky/evidence/<feature>/`. That directory is gitignored. Cleanup does not delete it.

For a journey that changes data, capture all of these:

- A screenshot of the filled-in action, before you submit it.
- A screenshot of the resulting screen.
- An ARIA snapshot of the resulting screen.
- The command transcript, including exit codes.
- The database snapshot for the signed-in account, written by the `snapshot` command.

The screenshot must show the action and the later state. The database file must show the row the click wrote. A toast or a final screen without the saved row is not proof.

A failed action also writes `.verify-minsky/evidence/last-failure.png`. Keep it until you understand the failure. Cleanup leaves it in place.

The browser talks to the local Worker. Authentication, the issue rules, and the migrations run in local D1. Do not add a mock that skips those rules.

## Cleanup

Stop only the processes recorded in `.verify-minsky/session.json`.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts cleanup
```

Cleanup sends shutdown to the session. It then signals the recorded `serve` pid, the recorded Chromium pid, the recorded Wrangler pid, and the recorded Worker pid, and only when `/proc/<pid>/cmdline` still matches that process. It does not kill by process name. It removes `.verify-minsky/session.json` and `.verify-minsky/state/`, including the local D1 directory. It leaves `.verify-minsky/evidence/` and `.verify-minsky/worker.log`.

If the session file is missing and ports 5198, 5199, or 9223 are in use, cleanup exits with an error and does not signal those pids.

Run cleanup after every failed attempt, then confirm the evidence directory is still present.

## Helpers

The helper is executable TypeScript. Node.js 22 runs it directly. `npm run typecheck` includes the file.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts serve --seed empty
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts doctor
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Sign in" --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click-text --text Devices --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label "What is happening?" --value "Keyboard stopped responding after the IDE froze" --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts select --label "Contestant team" --option "Aurora · A12" --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role heading --name "Sign in" --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts absent --role button --name "Claim ISS-1" --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text Live --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts text --role region --name "Your report" --exact
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/report-an-issue/02-submitted.png
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out .verify-minsky/evidence/report-an-issue/submitted.aria.txt
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts snapshot --user contestant --out .verify-minsky/evidence/report-an-issue/snapshot.json
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts viewport --width 1280 --height 800
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts cleanup
```

Screenshot, ARIA, and snapshot paths must stay under `.verify-minsky/evidence/` or `/opt/cursor/artifacts/`.
