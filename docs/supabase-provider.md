# Run the Supabase adapter

Use this guide to run Minsky on your own Supabase project.

The project does not operate a Supabase installation.
On 2026-10-23 the owner selected Cloudflare as the live backend. On 2026-10-24 the owner retired the project's own Supabase projects.
The Supabase adapter stays in the repository as a second implementation of the shared [backend contract](backend-contracts.md).
`npm run ci` checks it with embedded PostgreSQL and Deno on every push. Nothing in this repository connects to a Supabase project unless you run one of the commands below.

**Status: unverified procedure.** The adapter passes its local checks. The project last passed the hosted Supabase checks on 2026-10-19, against its own CI project. Nobody has run this procedure from start to end on a new project since that project was retired. Record your result if you run it.

Supabase provides managed authentication, Postgres, Realtime, and private Storage for this adapter.
Earlier setup records are in [Supabase provider records](history/supabase-provider-records.md). They are history, not instructions.

## Before you start

You need:

- Node.js 22.13 or later within 22.x, or Node.js 24 or later, and npm.
- A Supabase account that can create projects.
- One project for your installation. Use a second, separate project for the hosted test commands. The tests create and delete temporary accounts, and they must not run against real data.

Docker is not required. The Supabase CLI is a pinned npm dependency, and functions bundle on the Supabase servers.

Install the locked dependencies:

```sh
npm ci
```

Keep the database password, the service role key, and access tokens out of Git, chat, frontend builds, and logs.
Never put a service credential in a `VITE_` variable.

## Create and link your project

1. In the Supabase dashboard, create a project. Record its reference. The reference is the 20-letter name in its URL, `https://<your-project-ref>.supabase.co`.
2. Sign in to the Supabase CLI:

   ```sh
   npm run cloud:login
   ```

3. Link the checkout to your project. Enter the database password privately when the command asks for it.

   ```sh
   npx supabase link --project-ref <your-project-ref>
   ```

The `cloud:plan`, `cloud:migrate`, `cloud:bootstrap`, and `cloud:recover-admin` commands act on the linked project.
Check the linked project before you run them. To run commands against your test project, use a separate checkout that you link to that project.

## Apply the authentication settings

`supabase/config.toml` holds the repository's Auth settings.
They disable public signup and anonymous sign-in. They keep the email and password provider, which the internal username identifiers need.

Review the difference, then apply it:

```sh
npx supabase config diff --project-ref <your-project-ref>
npx supabase config push --project-ref <your-project-ref>
```

Minsky uses organizer-created usernames and temporary passwords.
It sends no mail. It needs no SMTP server or personal email addresses.

## Apply the migrations

Show the migrations that the linked project does not have, then apply them:

```sh
npm run cloud:plan
npm run cloud:migrate
```

Migrations create the schema, policies, and the private Storage buckets `issue-attachments`, `announcement-images`, and `person-avatars`. They add no seed data.
Apply migrations before you deploy functions that depend on them.

## Deploy the functions

Deploy the four functions that the browser uses:

```sh
npx supabase functions deploy admin --project-ref <your-project-ref> --use-api
npx supabase functions deploy attachments --project-ref <your-project-ref> --use-api
npx supabase functions deploy announcement-images --project-ref <your-project-ref> --use-api
npx supabase functions deploy avatars --project-ref <your-project-ref> --use-api
```

The `workflow` function is the opt-in server path for workflow commands. The default browser path does not use it.
Deploy it to a test project before you run `npm run test:workflow:hosted`:

```sh
npx supabase functions deploy workflow --project-ref <your-project-ref> --use-api
```

Set the browser origins that may call the functions. List only frontends that use this project.
Port 5173 is `npm run dev`. Port 4174 is the hosted test commands.

```sh
npx supabase secrets set ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4174 --project-ref <your-project-ref>
```

Supabase supplies the functions' service credentials. `ALLOWED_ORIGINS` is the only custom setting.

## Make the first admin

1. In the Supabase dashboard, open **Authentication > Users** and add a user with a password.
   Set its email to `<username>@accounts.minsky.invalid`, for example `organizer@accounts.minsky.invalid`.
   Minsky signs in usernames with this internal identifier. It sends no mail to it.
2. Copy the user's UUID.
3. Review `scripts/bootstrap.sql`. It creates one development event, one session, and three fictional teams, and makes the user that session's admin.
4. Run the bootstrap against the linked project:

   ```sh
   npm run cloud:bootstrap -- --admin-user <auth-user-uuid>
   ```

The bootstrap stops if an admin already exists. Run it once per project.
Contestant intake stays closed until an admin opens it.

## Connect the frontend

1. Copy the example settings:

   ```sh
   cp .env.example .env.local
   ```

2. In `.env.local`, set these values. Use the project's public keys only.

   | Variable | Value |
   | --- | --- |
   | `VITE_BACKEND` | `supabase`. The default is `cloudflare`. |
   | `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key, or its legacy `anon` key. |

3. Start the frontend:

   ```sh
   npm run dev
   ```

4. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Select **Sign in**. Then sign in as the first admin with the username, for example `organizer`, and the password from the dashboard.
5. Change the password if the app asks for it.

`npm run build` creates static assets in `dist/` with the same settings. You can serve them from any static host. Add that origin to `ALLOWED_ORIGINS`.
The guarded `npm run deploy` command publishes only the project's Cloudflare Worker. It does not publish a Supabase build.

## Manage accounts

Team contestants share a team account. Staff have individual accounts.
Supabase stores each username as an internal identifier in email format. These identifiers are not mailboxes.

To create an account:

1. Open the **Session** tab in the organiser phone app and select **New account**. In the desktop console, open **Accounts** and select **Create account**. Enter a display name.
2. Enter a unique username. Usernames contain 3–32 letters, digits, underscores, or hyphens. The app stores them in lowercase.
3. Select a roster team for a contestant, or staff permissions for an individual.
4. Select **Create account**.
5. Share the displayed username and temporary password through an agreed secure channel.
6. Select **Done** to dismiss the credentials.

The app keeps no copy of the password. If you lose it, reset the password.
Users must change a temporary password before they can read or change contest data. Refresh and direct API calls cannot bypass this rule.

To assign a username to an account that signs in with an email identifier, expand the account under **Session accounts** and select **Assign username → Set username**.
The password, Auth UUID, memberships, and history stay the same.

To reset a password:

1. Verify the requester's identity outside the app.
2. Open the account in the **Session** tab, or select **Manage** on **Accounts** in the desktop console.
3. Select **Reset password** and confirm it.
4. Share the new temporary password securely.

The reset ends the account's existing sessions. To change your own password, use **Change password**.
Account-wide resets and username assignment need admin access to every session where the account is a member. They reject archived memberships.

## Recover the only admin

Use this procedure when the only admin cannot sign in.
It changes the Supabase account only. For a Cloudflare admin, use [Recover a Cloudflare admin password](activate-cloudflare-development.md#recover-a-cloudflare-admin-password).

1. Link the checkout to the affected project.
2. Find the admin's Auth UUID in **Authentication > Users**.
3. In a private terminal, run:

   ```sh
   npm run cloud:recover-admin -- --user <existing-admin-auth-uuid>
   ```

The command reads the service key into memory. It checks that the account is an admin of an active event.
It prints a temporary password once in that terminal and ends the account's existing sessions. The next sign-in requires a password change.
Never run it in CI. Never paste its output into chat or commit it.
Its audit entry names a provider operation, not the person who lost access.

## Run the local checks

These checks need no Supabase project or credentials:

```sh
npm run typecheck
npm run lint
npm run check:functions
npm run test:functions
npm test
npm run build
```

Expect each command to exit with code zero. `npm run ci` runs all of them.

- `npm test` runs the migrations and policies in embedded PostgreSQL, with stubs for Auth context, sessions, and password hashes. It does not prove managed Auth behavior.
- `npm run check:functions` type-checks the five functions with Deno.
- `npm run test:functions` tests the attachment, announcement image, and avatar handlers with fake Auth, database, and Storage clients.
- `npm run test:e2e` runs the browser tests against mocked Supabase responses. Install Chromium first with `npx playwright install chromium`.

## Run the hosted checks on your test project

These commands create real temporary accounts and records in a Supabase project. Run them only against your separate test project.
They are manual commands. `npm run ci` does not run them.

Prepare the test project with this guide: link it, apply the settings and migrations, deploy all five functions, and allow origin `http://127.0.0.1:4174`. You do not need to make a first admin.

Set these values in your private shell only:

| Variable | Value |
| --- | --- |
| `MINSKY_TEST_PROJECT_REF` | Your test project's reference. Every hosted command requires it. None falls back to the linked project. |
| `SUPABASE_ACCESS_TOKEN` | A personal access token that can read the project's migration and function metadata. |
| `SUPABASE_ANON_KEY` | The test project's public key. |
| `SUPABASE_SERVICE_ROLE_KEY` | The test project's service role key, for fixture setup and cleanup. |

| Command | What it checks |
| --- | --- |
| `npm run test:providers -- --provider=supabase` | The 11 shared provider scenarios through the browser adapter. |
| `npm run test:workflow:hosted` | The shared workflow service through the deployed `workflow` function. |
| `npm run test:cloud` | Managed Auth, database, Realtime, and images through a local frontend. |

[Run the shared provider tests](run-provider-tests.md#run-against-the-supabase-provider) gives each procedure, its expected result, and its prerequisite checks.
The commands refuse a reference that is not 20 lowercase letters. They also refuse the retired project `Minsky`, `ovymmobupzowotvrywek`, while it exists, because it holds trial accounts.

## Recover fixtures

Each hosted command deletes only the records and accounts that its run created.
If cleanup fails, the command keeps a local recovery file and prints its path. Do not delete that file. Do not reset the project.

| Command | Recovery |
| --- | --- |
| `npm run test:providers -- --provider=supabase` | `npm run test:providers -- --provider=supabase --recover=/absolute/path/recovery.json` |
| `npm run test:workflow:hosted` | `npm run test:workflow:hosted -- --recover=/absolute/path/fixture.json` |
| `npm run test:cloud` | Manual. See [Recover test:cloud fixtures](run-provider-tests.md#recover-testcloud-fixtures). |

Set the same `MINSKY_TEST_PROJECT_REF` and keys before you run a recovery command.
Recovery checks that each record belongs to the failed run before it deletes the record.
See [Recover an incomplete fixture](run-provider-tests.md#recover-an-incomplete-fixture) for the complete steps.

## Issue images

Migrations create the private Storage bucket `issue-attachments`.
It accepts JPEG, PNG, and WebP files up to 50 MB.
Each image has two objects: `{session}/{issue}/{attachment}/original` and `{session}/{issue}/{attachment}/thumbnail`.
The browser creates the JPEG thumbnail. Its longest edge is 480 pixels and its maximum size is 512 KB.
Thumbnails do not count toward the image count or the issue total.
The adapter uses no Supabase image transformations.

When file deletion fails, the uploader keeps a cleanup record after refresh. **Retry removal** repeats the deletion and confirms it in the database.
Other members cannot see that record. New removal requests stop after archival.

The Supabase Free plan includes 1 GB of file storage. At the default 120 MB issue total, about eight full issues use 1 GB.
A free plan does not establish capacity for a live contest. See [Supabase pricing](https://supabase.com/pricing).

## Profile pictures

Migration `202610250001_person_avatars.sql` creates the private Storage bucket `person-avatars`.
It accepts JPEG, PNG, and WebP files up to 256 KB (262,144 bytes). Each object is `{person}/{avatar}`.
The `avatars` function is the only writer. Deploy it before a frontend that uses profile pictures.

The adapter has no scheduled cleanup. Each upload and each removal deletes the caller's replaced and expired files, then confirms the deletion in the database.
If a deletion fails, the next upload or removal by the same person tries again. Until then, the file stays in the bucket, and nobody can read it.
An abandoned upload expires after 15 minutes. Its file stays until the same person uploads or removes a picture again.

## Update an installation

To install a newer revision on your project:

1. Run `npm run cloud:plan`, then `npm run cloud:migrate`.
2. Deploy each function that changed.
3. Build and publish the frontend.

Apply migrations before functions, and functions before the frontend. A newer frontend can need a newer function or schema.
Run the hosted checks on your test project before you update a project with real data.
