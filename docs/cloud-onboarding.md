# Cloud onboarding for T0003

The connected development app is deployed at https://minsky-dev.icaic-minsky.workers.dev. Supabase hosts authentication, Postgres and Realtime; Cloudflare Workers Static Assets serves the frontend. Docker is optional. The user permits contributors to have full authorized cloud credential access.

## Authentication decision (2026-10-02)

The user replaced email invitations and email recovery with organizer-created **usernames/passwords**. SMTP and personal email addresses are not prerequisites. Team contestants share a team account; staff have individual accounts. Supabase manages passwords and sessions behind internal email-format identifiers; those identifiers are not mailboxes and must not receive mail.

### Create and recover accounts

1. Sign into Minsky as admin. Existing development accounts can use their original email and password until a username is assigned.
2. Under **Session accounts**, expand the existing account and use **Assign username → Set username**. Usernames contain 3–32 letters, digits, underscores or hyphens and are stored lowercase. The existing password, Auth UUID, memberships and history stay unchanged. Username assignment replaces that account’s email login; do not distribute its old email as future login instructions.
3. Under **Create an account**, enter a display name and unique username. Select a roster team for a contestant, or choose staff permissions for an individual. Click **Create account**.
4. Share the displayed username and newly generated temporary password through an agreed secure channel. Dismiss credentials once recorded privately. The app does not retain a recoverable copy; losing the response requires a new reset, not viewing an old password.
5. Users sign in and must change their temporary password before reading or changing contest data. Refresh or direct API calls cannot bypass this requirement.
6. For forgotten passwords, organizers verify the requester’s identity outside the application, expand the account and choose **Reset password**. Share the replacement temporary password securely. Existing sessions/refresh tokens lose access; the user must sign in again and change the replacement password.
7. Use **Change password** for your own account, entering the current password. Account-wide resets/username assignment require admin access to every session where the target has membership and reject archived memberships. Ordinary session permission editing remains scoped to its session.

If the sole admin loses their password, a trusted provider maintainer can run this in a **private terminal** after linking the intended project:

```sh
npm run cloud:recover-admin -- --user EXISTING_ADMIN_AUTH_UUID
```

The command captures service credentials in memory, verifies an existing active-event admin, issues a temporary password, invalidates previous sessions and requires password change on next login. The temporary password is intentionally displayed in that terminal only; never run this command in CI, paste its output into chat or commit it. Its service-only recovery RPC is unavailable to ordinary app accounts. Recovery audit entries identify this as a provider operation, not an action performed by the locked-out person.

No public signup, email confirmation links, invitation links or email recovery are used by this flow. Keep signup and anonymous sign-in disabled. Internal accounts are explicitly confirmed by the trusted creation function; this is account provisioning, not mailbox verification. Previously configured redirect URLs may remain, but no sender/domain/SMTP setup is required for T0003.

## Ownership and costs

Use individual provider logins and membership controls for Supabase and Cloudflare. Provider access and Minsky app membership are separate. The user completes provider account verification and payment entry privately. Keep passwords, database credentials, recovery codes and API secrets out of Git, chat and public logs.

Record these non-secret details in the completion record below:

- Organization/account owner and maintainer access.
- Billing contact and selected plan for each provider.
- Current recurring charges, usage-dashboard location and receipt/reimbursement handling.

Start with Supabase Free and Workers Free. No SMTP provider, image bucket, custom application domain, R2 or AWS account is needed for this ticket. Static assets served without invoking Worker code are free/unlimited; Supabase Free limits and inactivity pausing still apply. Review usage before a pilot. Before any paid upgrade, record the concrete blocker, current cost and expected monthly spend. Free tiers are not proof of capacity for 800 users. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Supabase pricing](https://supabase.com/pricing).

## Contributor setup

Use Node.js 22.13+ within 22.x, or 24+, and npm. The primary fresh-clone sequence is:

```sh
npm ci
cp .env.example .env.local
npm run cloud:login
npm run cloud:link
npm run dev
```

Fill `.env.local` with the project's public URL and publishable key. Obtain authorized provider access and enter the database password privately at the CLI prompt. An application admin must separately grant Minsky session membership. Never put privileged credentials in `VITE_` variables or frontend builds.

Use timestamped repository-owned migrations. Run `npm run cloud:plan` before `cloud:migrate`. Migrations never seed the shared product. The first setup uses an explicitly chosen existing Auth account:

```sh
npm run cloud:plan
npm run cloud:migrate
npm run cloud:bootstrap -- --admin-user EXISTING_AUTH_UUID
npm run cloud:functions
npx supabase secrets set ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4174,https://minsky-dev.icaic-minsky.workers.dev --project-ref ovymmobupzowotvrywek
npm run cloud:hosting-login
npm run deploy
```

Review `scripts/bootstrap.sql` before first setup; it refuses an existing admin. Do not rerun it against the already bootstrapped development project. The initial intake is closed until an admin opens it. `cloud:functions` bundles remotely with `--use-api`, without Docker. Supabase supplies the function’s service credentials; only `ALLOWED_ORIGINS` is required as custom function configuration. The previous `APP_URL` setting is unused.

## Verification and protected cloud CI

Run `npm run typecheck`, `npm run lint`, `npm run check:functions`, `npm test` and `npm run build`. Embedded PostgreSQL executes the actual migrations/policies with Auth-context/session/password-hash stubs; it does not prove managed Auth behavior. `npm run test:e2e` retains the historical local demo regression suite. `npm run test:cloud` exercises managed Auth/database/Realtime against a local frontend. `npm run test:hosted` repeats the real-account suite against the deployed app. Install Chromium with `npx playwright install chromium`.

Cloud tests create unique temporary sessions/accounts, change their temporary passwords, verify the shared workflow and creation/reset behavior, and explicitly clean up their own rows. They never reset the shared project. Credentials are held in memory and an ignored temporary fixture file. Do not interrupt cleanup. No screenshots should contain live temporary credentials; tests dismiss them before capture.

PR CI runs secret-free checks. The manually dispatched cloud job uses a protected GitHub environment named **cloud-test** and a **separate Supabase test project**. CI refuses shared development reference `ovymmobupzowotvrywek`.

Configure `MINSKY_TEST_PROJECT_REF` as an environment variable, and `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` as environment secrets. Restrict execution to trusted revisions and configure required reviewers where the repository’s GitHub plan supports them; verify plan availability before treating protection as enabled. Then manually dispatch **Checks** for the reviewed branch and record the cloud job result. No automatic deployment or preview writes to shared data are configured. See [GitHub environment documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## Completion record

- Supabase project: `Minsky`, URL `https://ovymmobupzowotvrywek.supabase.co`, reference `ovymmobupzowotvrywek`, organization `gayymsuhfqsboksikzwx`, Singapore region `ap-southeast-1`, PostgreSQL 17. Provider access and CLI login/link were independently verified in the initial implementation.
- Cloudflare account: `458ad6a930b0fb717796dfa19ca6a2b1`; Worker `minsky-dev` under `icaic-minsky.workers.dev`. Provider access and deployment were verified. Current deployment version and tests are in [current state](current-state.md).
- Initial development account identifier: `1b8c9cb2-f84c-4d13-92f9-b70088db38f8`. Trusted bootstrap verified existence and assigned the initial development event/session/three teams. The user subsequently confirmed signing into the hosted app. Their password was never requested or inspected. Assign a username through the app without recreating this account.
- Authentication settings: user reported Email enabled, public signup and anonymous sign-in disabled, email confirmation enabled and exact local/hosted redirects saved. Keep these settings; the trusted function confirms organizer-created internal identities.
- Historical migrations `202610020001_cloud.sql` through `202610020003_private_signals.sql` and the first bootstrap were applied without seeds. Both username/password migrations were applied without seeds, the account function was deployed, and all eight final hosted cases passed. Current deployment/version and detailed verification are recorded in current-state.md.
- SMTP: deliberately removed from T0003 requirements by the user. No sender domain or paid mail service was configured; prior SMTP blockers are historical.
- Ownership/billing: selected plans, organization owner, billing contact, recurring charges and receipt handling remain to be confirmed. No paid upgrade was selected or payment action performed by the agent.
- Protected cloud CI: source is implemented; separate test project/environment setup and the first protected cloud run remain pending. Local runs against isolated development fixtures are separate evidence.
