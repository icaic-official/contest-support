---
title: Configure the backend and first administrator
description: Prepare a separate backend, apply versioned setup, and initialize a competition.
---

These instructions accompany the [T0007 installation trial](/operators/installation/).
They require its source branch for the first-install generator.
Choose a fresh backend for your competition.
Keep its data and credentials separate from Minsky development and CI.

## Configure hosted Supabase

Install the repository's locked tools with `npm ci`.
Authenticate to Supabase, then select your own project explicitly:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase config diff --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with your project reference from the provider dashboard.
Review `supabase/config.toml` before you apply it.
Set the public frontend URL and allowed redirects for your installation.
Keep global public signup and anonymous sign-in disabled.
Keep the email/password provider enabled because Minsky uses internal email-format identifiers for username accounts.
Personal email addresses and SMTP are not required.

The repository's `cloud:link` and `cloud:functions` shortcuts target the original development project.
Use explicit project references for your installation.

## Apply the backend in order

Review the configuration difference and migration preview first.
Check that the linked project is your intended target.

```sh
npx supabase config push --project-ref YOUR_PROJECT_REF
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase secrets set ALLOWED_ORIGINS=https://YOUR_FRONTEND_HOST --project-ref YOUR_PROJECT_REF
npx supabase functions deploy admin --project-ref YOUR_PROJECT_REF --use-api
npx supabase functions deploy attachments --project-ref YOUR_PROJECT_REF --use-api
```

Apply all migrations from the selected source revision.
They include the private image bucket and its access rules.
Keep that bucket private.
Preserve its stored files during upgrades.
Deploy both functions from the same revision as the migrations and frontend.

`ALLOWED_ORIGINS` is the list of frontend addresses permitted to call the privileged functions from a browser.
Use the real HTTPS frontend origin, without a path.
Keep provider tokens, database passwords, and service credentials outside the browser build and Git.

## Create the first administrator

1. Create a password account through trusted Supabase administration.
2. Confirm the account through administration.
3. Record its existing Auth UUID, the unique account identifier.
4. Copy the competition configuration example.

```sh
cp deploy/competition.example.json deploy/competition.json
```

Edit the administrator UUID and name, event, session, categories, and teams.
The current application has no general roster editor, so review the roster carefully.
Do not put passwords or API credentials in this JSON file.

Generate the SQL, which is the database setup text:

```sh
node scripts/installation.mjs bootstrap deploy/competition.json > deploy/bootstrap.generated.sql
```

The command prints SQL without connecting to the backend.
Review the generated file and target before applying it through trusted database access.
The generator refuses a database that already contains an event or administrator.
It preserves the Auth account, records an audit entry, and leaves contestant intake closed.
This command initializes a fresh installation. It is not an upgrade or recovery command.

The initial admin can use the existing email-format login identifier until a username is assigned in Minsky.
Create later accounts through the app with temporary passwords.
Continue with [verification](/operators/verification/).
