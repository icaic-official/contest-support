---
name: verify-minsky
description: Drive the Minsky contest-support web app in a local browser and capture evidence. Use when a change affects sign-in, contestant reports, the staff queue, jury awards, or account administration.
---

# Verify Minsky

Minsky's primary surface is the web app. Contestants report issues. Staff claim and reply. Jury members record time awards. Administrators manage accounts. After sign-in, the membership and the window width select one of three layouts: the contestant desktop, the organiser phone layout below 1024 px, or the organiser desktop console at 1024 px and wider.

This skill does not drive the documentation site, maintainer npm scripts, or a deployed Worker. Those are separate surfaces.

## Launch

Run the commands from the repository root. Install dependencies and Chromium first:

```sh
npm ci
npx playwright install chromium
```

Use Node.js 22.13 or later within 22.x, or Node.js 24 or later. If the shell sets `NODE_ENV=production`, the helper still starts Vite with `NODE_ENV=development`. A production value makes the page blank.

Leave the serve process running in its own terminal. On a machine that uses tmux, use a session named `verify-minsky`.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts serve --seed empty
```

Use `--seed jury` when the journey needs the six existing issues. The default viewport is `1280x800`. Pass `--viewport 390x844` for the organiser phone layout. Set the viewport before sign-in.

Stdout prints this line only after the **Sign in** heading is visible:

```text
ready http://127.0.0.1:5199
```

That line means the page can accept a username and a password. An HTTP response alone is not ready.

The helper binds `127.0.0.1:5199` for Vite, `127.0.0.1:5198` for its own commands, and `127.0.0.1:9223` for Chromium. It creates an empty in-memory database, applies every file in `supabase/migrations` in filename order, and inserts the seed below.

The empty seed has no issues. The event is **Jury verification**. The sessions are **Primary** and **Secondary**. Intake is open. The teams are **Aurora** at A12, **Cedar** at A18, and **Isolated** at B01 on the secondary session. The accounts are `contestant` on Aurora, `volunteer`, `specialist`, `jury`, `admin`, and `combined`. The combined account has volunteer, specialist, and jury roles. The jury account also has a volunteer role on the secondary session.

The jury seed adds six issues. None of them are open. Award review uses that seed.

The feature files type the password `verification-only`. This local session accepts any password for the six usernames. The value is not a real credential.

### Isolation

One verification session owns the three ports above. A second `serve` exits with an error when a recorded process is still alive or when any of those ports is taken. It does not kill the other process, and it does not attach a second browser to the same Chromium.

Do not start `npm run dev` for this skill. That command uses port 5173 and the linked Supabase development project. That project is shared by every developer. This skill does not read `.env.local`, and it does not run `npm run cloud:login`, `npm run cloud:link`, or `npm run cloud:migrate`.

### Local stand-in

The product's documented dev command is `npm run dev`, which opens `http://127.0.0.1:5173` and uses the linked Supabase project. This skill does not run that command. A passing local journey does not verify the linked project or a deployed Worker. These setup steps happen only inside `serve`:

- Vite receives `VITE_SUPABASE_URL=https://example.supabase.co`, `VITE_SUPABASE_PUBLISHABLE_KEY=public-test-key`, and `VITE_BACKEND=supabase`. The helper answers that host inside the session process. The requests do not leave the machine.
- The database is a new in-memory PGlite database. It is not hosted Postgres.
- The helper applies `supabase/migrations` and inserts the fictional event, sessions, teams, and accounts.
- Sign-in does not check the password. No account is marked for a temporary-password change, so that screen does not appear.
- The helper builds the session token and sets the database role itself.
- The **Live** badge is fed by a websocket answered in the session process. Hosted Realtime is not used.
- Account creation and image upload call services the helper does not provide. Those actions fail in the UI.
- Chromium is headless. The helper sets the viewport and a light color scheme.

Tear the session down with Cleanup. Run Cleanup after a failed launch too, so the ports do not stay occupied.

## Doctor

Doctor is read-only. Run it before a journey, and again when the page looks wrong.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts doctor
```

Exit code 0 and `"ok": true` mean all of the following:

- The recorded `serve` process, Vite process, and Chromium process are alive.
- Their command lines still match this checkout's helper, `vite.js` on port 5199, and Chromium's debugging port 9223.
- `lsof` shows each of those processes as the only listener on its port.
- The page shows the **Sign in** heading, or a signed-in layout whose root has `data-ui` of `contestant`, `organiser-phone`, or `organiser-desktop`.
- A read of the admin account returns session **Primary** and event **Jury verification**.

Any other result means the session is not worth driving. Run Cleanup and start `serve` again. Do not reuse a Vite process you did not start.

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

Mocks in this session exist only at the hosted Auth, HTTP, and Realtime boundary. The issue rules and the migrations run in the local database. Do not add a mock that skips those rules.

## Cleanup

Stop only the processes recorded in `.verify-minsky/session.json`.

```sh
node .cursor/skills/verify-minsky/scripts/minsky-verify.ts cleanup
```

Cleanup sends shutdown to the session. It then signals the recorded `serve` pid, the recorded Chromium pid, and the recorded Vite pid, and only when `/proc/<pid>/cmdline` still matches that process. It does not kill by process name. It removes `.verify-minsky/session.json`. It leaves `.verify-minsky/evidence/` and `.verify-minsky/vite.log`.

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
