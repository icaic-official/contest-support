# Cloud onboarding for T0003

Status: T0003 implementation and guided onboarding are in progress on 2026-10-02. The connected frontend, Supabase migrations and admin function are implemented. The development schema and first-admin/session bootstrap have been applied; server-side function deployment succeeded. All five final hosted browser cases passed; detailed verification is recorded in current-state.md. No paid upgrade is selected. SMTP delivery remains pending sender access. See [current verification](current-state.md) and [ticket scope](tickets.md#t0003--cloud-onboarding-and-authenticated-shared-product).

The user explicitly allows assuming that contributors have full cloud credential access. **Docker is not required** for the main development/setup path. Use cloud migrations and `--use-api` function bundling. Embedded PostgreSQL verifies database rules without containers; real integration tests run against isolated cloud sessions/accounts. The optional local Supabase path is no longer a contributor prerequisite.

## 1. Accounts and ownership

Create or select the Supabase organization and Cloudflare account that will own Minsky. Use individual provider logins and invite maintainers through the provider's membership controls; do not share an owner's password. Record the project owner and billing contact. Most contributors should work locally without provider-console access. Provider membership and Minsky contestant/staff/admin accounts are separate.

The user completes provider sign-in, account verification and any card entry directly on the provider website. Keep passwords, recovery codes, database credentials and API secrets out of chat, committed files and issue reports. Store billing receipts for reimbursement if a paid service becomes necessary.

## 2. Start with free plans

| Service | Initial choice | When to consider paying |
| --- | --- | --- |
| Cloudflare Workers Static Assets | Free, with the supplied `workers.dev` hostname; frontend hosting only | No paid Worker runtime is currently needed for this static frontend architecture. Revisit only if hosting requirements change. |
| Supabase | One Free development project; shared cloud development for authorized contributors; isolated cloud project for CI | Database, bandwidth or active-project limits become restrictive, or project inactivity pausing disrupts development. Pro starts at USD 25/month; extras may cost more. |
| Authentication email | Custom SMTP with a suitable free allowance and a verified sender | Recipient volume, sender requirements or delivery needs exceed the provider's free offering. Select the provider during onboarding. |
| Uploaded images | No bucket needed for T0003; Supabase Storage recommended for the attachment ticket | Review actual file volume and downloads when attachments are scoped. No R2 or AWS account is required now. |

Static-asset requests are free and unlimited when served without invoking Worker code. Minsky's backend runs in Supabase, so dynamic Worker request/CPU quotas are not the application's backend budget. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

Supabase Free currently includes a 500 MB database per project, 1 GB file storage, 5 GB uncached plus 5 GB cached egress, and up to two active projects. Free projects can pause after one week of inactivity. These allowances do not establish capacity for a live contest. See [Supabase pricing](https://supabase.com/pricing).

Record the selected plans and review usage dashboards after initial testing. Before any paid upgrade, identify the actual blocker, current price, expected monthly cost and applicable usage controls. The user accepts necessary spending, but no paid upgrade is currently selected. A custom application domain is optional; authentication email may separately require a sender domain. Do not assume a spending control is an absolute bill cap.

## 3. Supabase setup

1. Create a development project on the Free plan. Choose a region close to the pilot users; Singapore is a candidate if the pilot is based there. Save the database password securely. Record the project reference and URL, not its secrets.
2. Enable email/password authentication and disable public signup for this organizer-provisioned product. Once URLs are known, configure the site URL and exact local/deployed invitation and recovery redirect URLs. Use the [password authentication guide](https://supabase.com/docs/guides/auth/passwords).
3. Configure custom SMTP and verify its sender. Supabase's default email service sends only to project-team addresses and currently allows two messages/hour. It cannot support normal pilot-user invitations/recovery. Test invitation, password setup and recovery with a recipient outside that provider team. See [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).
4. During implementation, apply reviewed, repository-owned migrations, access policies and transactional database functions using the Supabase CLI. Deploy Supabase Edge Functions for privileged account administration, with caller authentication and explicit admin checks. Keep privileged credentials in Supabase's server-side environment. Document the exact target selection, migration and function deployment commands. Keep changes reproducible rather than relying on unrecorded dashboard edits. See [migration workflow](https://supabase.com/docs/guides/local-development/database-migrations) and [Edge Functions](https://supabase.com/docs/guides/functions).
5. Bootstrap the first application admin through the ticket's trusted command. Invite pilot accounts through the minimal admin UI after deployment. Local fixtures must never run automatically against the hosted database.
6. Test team/session isolation and private-note access through direct API requests as well as the UI. Row-level policies and transactional operations must enforce access independently of hidden controls. See [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 4. Cloudflare setup

### Development while sender setup is pending

The user reported on 2026-10-02 that a sender domain is not yet accessible. This does not block database, login, dashboard or deployment implementation. Recommended interim path: create only known development accounts through Supabase's trusted admin tools/API with a password and explicit per-account email confirmation. Keep public signup disabled and the project-wide email-confirmation setting enabled. This manual confirmation is development provisioning, not evidence that the mailbox was verified. Do not send passwords through repository files or chat.

Optional local Supabase mail capture can test invitation/recovery handling if a contributor chooses a container stack; it is not required by the cloud setup path and was not run during this implementation. Ordinary email/password login for provisioned accounts does not require sending email. Hosted invitation/recovery delivery remains incomplete until a suitable sender is configured and tested; do not mark T0003's email acceptance complete based on local tests. See [admin account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser) and [local development](https://supabase.com/docs/guides/local-development/cli/getting-started).

### Hosting setup

1. Select Workers Free and a `workers.dev` subdomain in the owning account. Keep the React/Vite build; `wrangler.jsonc` serves `dist/` directly through Workers Static Assets. No Worker runtime or Cloudflare backend endpoint is needed. See [React on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/).
2. Authenticate the deployment CLI as a maintainer. Use a scoped deployment credential for trusted CI only if automated deployment is configured. Do not give contributors the account owner's credentials.
3. Configure only the Supabase URL and publishable key for the frontend build. Backend secrets belong in Supabase Edge Functions, never a `VITE_` variable or the frontend hosting configuration. Ignore local function secret files and commit a placeholder example.
4. Run the implemented checks, apply compatible Supabase migrations/functions and deploy the reviewed frontend build to Workers Static Assets. No custom Cloudflare backend is required. Record the tested commands, URL and revision. Update Supabase authentication redirects to the actual URL, then run the hosted smoke test.
5. Verify that refresh on application routes works, Supabase privileged functions reject unauthorized callers, and two different logged-in browsers see shared updates. Keep the hosted environment visibly identified as development.

## 5. Contributor onboarding

Use Node.js 22.13+ within 22.x, or 24+, and npm. Docker is optional. The primary fresh-clone sequence is:

```sh
npm ci
cp .env.example .env.local
npm run cloud:login
npm run cloud:link
npm run dev
```

Fill `.env.local` with the project's public URL and publishable key. Obtain provider access through individual logins and authorized credential sharing. Enter the database password at the CLI prompt. Get a Minsky membership from an application admin; provider access alone does not grant app permissions.

For a migration, create a timestamped file under `supabase/migrations/`. Run `npm run typecheck`, `npm run lint`, `npm run check:functions`, `npm test`, and `npm run build`; run `npm run cloud:plan` before `npm run cloud:migrate`. The embedded tests execute every migration against PostgreSQL with Auth-context stubs. They do not test managed Supabase Auth or Realtime. Run `npm run test:cloud` for those real-account checks. Its fixtures use unique UUID sessions and temporary confirmed test accounts, then delete only their own data. It does not reset or seed the shared product. Do not interrupt it during cleanup. Privileged test credentials are captured in process memory and never put in a Vite build or printed.

First setup and deployment:

```sh
npm run cloud:plan
npm run cloud:migrate
npm run cloud:bootstrap -- --admin-user EXISTING_AUTH_UUID
npm run cloud:functions
npx supabase secrets set APP_URL=https://minsky-dev.icaic-minsky.workers.dev/ ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4174,https://minsky-dev.icaic-minsky.workers.dev --project-ref ovymmobupzowotvrywek
npm run cloud:hosting-login
npm run deploy
```

Review `scripts/bootstrap.sql` before the trusted first bootstrap. It creates the initial group event/session/roster and assigns one already provisioned Auth account; it refuses an existing admin. It does not know or change that account's password. Subsequent membership and intake changes use the admin UI. `cloud:functions` passes `--use-api`, which bundles remotely without Docker. Supabase supplies the function's service credentials; the two settings above are public application configuration.

In Supabase **Authentication → URL Configuration**, set Site URL to the deployed root URL and allow these exact redirects: `http://127.0.0.1:5173/` and `https://minsky-dev.icaic-minsky.workers.dev/`. Keep Email enabled, public signup disabled, anonymous sign-in disabled and email confirmation enabled. Invitation and recovery links arrive at `/`, establish a session and open the password form. Hosted mail must still be configured and tested.

PR CI (`.github/workflows/checks.yml`) runs type/lint/function/build, 66 focused tests including actual migration/RLS execution, and historical demo browser checks without hosted secrets. The manually dispatched cloud job uses a protected GitHub environment named `cloud-test`. Configure `MINSKY_TEST_PROJECT_REF` as its variable and `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` as environment secrets. Choose a separate free test project; CI refuses the shared development reference. Add required reviewers to the environment so privileged integration tests only run on trusted revisions. No automatic deployment or preview writes to shared data are configured. Cloud integration CI is implemented but requires this owner configuration before its first run.

`npm run test:cloud` tests a local frontend against hosted Supabase. To smoke-test the deployed frontend with the same temporary real accounts, use `npm run test:hosted`. Configure redirect/CORS settings first. Fixture cleanup is explicit; no shared reset or auto-import of old browser demo data exists.

The selected quality controls add secret scanning, dependency audits and a PR checklist. See [code-quality.md](code-quality.md) for required check names and the prepared merge-protection payload. The available contributor account cannot administer this repository; the owner must apply remote merge rules and enable vulnerability alerts. No paid security feature is selected.


## Completion record to fill during implementation

- Cloudflare account access: independently verified through `wrangler whoami` for account `458ad6a930b0fb717796dfa19ca6a2b1`. Supabase organization reference `gayymsuhfqsboksikzwx` and project access were confirmed through CLI login/project listing. Organization owner, billing contact and plan selection remain for the user to record.
- Supabase project URL: `https://ovymmobupzowotvrywek.supabase.co`; project reference: `ovymmobupzowotvrywek`. User confirmed reaching the project dashboard on 2026-10-02. Region `ap-southeast-1` and project name `Minsky` were independently verified through the CLI during implementation. The selected billing plan remains unconfirmed.
- Supabase Auth: user confirmed saving Email enabled, public signup disabled, anonymous sign-ins disabled and email confirmation enabled on 2026-10-02. These are user-reported settings, not independently inspected or tested by the agent. The schema/app connection implementation is now present; the user confirmed saving the exact local/deployed redirect configuration. SMTP delivery verification remains pending.
- Frontend connection settings: user supplied the publishable key on 2026-10-02. Project URL and publishable key are saved in Git-ignored `.env.local` under `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The connected app now consumes these public settings. Cloud browser verification is recorded in current-state.md. No privileged key was requested or saved.
- Cloudflare account ID: `458ad6a930b0fb717796dfa19ca6a2b1`. User confirmed the account-level Workers subdomain `icaic-minsky.workers.dev` on 2026-10-02. These identifiers were originally user-reported; CLI account access was independently verified during implementation.
- Worker `minsky-dev` is deployed at `https://minsky-dev.icaic-minsky.workers.dev`. Final verified deployment version: `dcbba8b9-39af-4528-8fda-70ce61534ddf`. Workflow verification is recorded in current-state.md. Selected Workers billing plan remains unconfirmed; no paid upgrade was selected.
- SMTP provider, sender and actual cost: not selected. User reported sender-domain access is unavailable for now (2026-10-02); known development accounts can be provisioned and assigned through the implemented path above; hosted mail remains pending.
- Development Auth account: user confirmed creation on 2026-10-02 after the guided Create user / Auto Confirm User steps and supplied UUID `1b8c9cb2-f84c-4d13-92f9-b70088db38f8` for the intended first Minsky admin. The trusted bootstrap independently confirmed that this Auth UUID exists. Its password/login was not inspected. Minsky admin membership and the initial development event/session/roster were assigned using the trusted bootstrap during implementation. Login with this specific account remains for the user to check; its password was not requested or changed. Pass this UUID explicitly to the trusted hosted bootstrap; do not hardcode it into migrations or local fixtures or automatically promote the first person who signs in.
- Trusted bootstrap: completed; account/membership authorization tested in embedded PostgreSQL. Non-team email delivery remains unverified.
- Final hosted journey: all five real-account browser cases passed, including repeated reopening and private-note counters. Clean-checkout install/type/lint/test/function/build checks passed; final hosted refinement results appear in current-state.md; protected cloud CI is configured in source but has not run.
- Spending: no paid upgrades or payment actions were performed by the agent. Provider usage charges and selected billing plans have not been independently checked.

### Implementation outcomes (2026-10-02)

- Supabase CLI login/link: completed by the user; `cloud:plan` verified the target and pending migration.
- `202610020001_cloud.sql`, `202610020002_indexes.sql` and `202610020003_private_signals.sql`: applied successfully through `cloud:migrate`, without seeds.
- Trusted bootstrap: completed for the explicitly recorded existing admin UUID. Initial intake remains closed until the admin opens it.
- Admin Edge Function: Deno check passed and deployment succeeded with `--use-api`. `APP_URL` and `ALLOWED_ORIGINS` configured for local development and the intended Worker URL.
- An initial default function deployment attempted local container bundling and was interrupted; the committed command now uses server-side bundling. Docker was not used for the database or tests.
- Worker login/deployment and the first hosted Auth workflow/Realtime checks succeeded. SMTP delivery and protected cloud CI remain incomplete; neither is inferred from embedded tests.
