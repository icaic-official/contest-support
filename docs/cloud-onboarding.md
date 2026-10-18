# Cloud onboarding for T0003

Supabase remains the active backend during [T0014 backend adapters](tickets.md#t0014-backend-adapters).
The adapter extraction keeps the public environment variables and provider commands below unchanged.
The selected future migration to Workers, D1, R2, and Durable Objects is recorded in [product direction](product-direction.md#backend-migration-direction).

**Workflow update (2026-10-17):** the user selected automatic frontend previews and deployment from `main` for both Workers.
GitHub Actions publishes both sites only after all required CI jobs pass.
Follow [deployment setup](cloudflare-builds.md). Credentials, activation, and the first automatic deployments remain unverified.
Backend migrations, functions, and provider settings retain their explicit deployment steps.

The connected development app runs at https://minsky-dev.icaic-minsky.workers.dev.
Supabase hosts authentication, Postgres, and Realtime.
Cloudflare Workers Static Assets serves the frontend.
Docker is optional.
The user permits full authorized cloud credential access for contributors.

## Experimental Cloudflare authentication

T0018 uses separate local development databases and the isolated hosted `minsky-auth-ci` database and Worker.
Follow [the authentication verification guide](verify-cloudflare-authentication.md) for explicit targets, credentials, checks, and recovery.
The [identity choice](cloudflare-authentication-choice.md) records measured Worker CPU and the Standard plan need and cost.
These resources contain fictional fixtures. They do not replace the Supabase projects described below.

## Authentication decision (2026-10-02)

The public documentation has separate hosting. See [documentation hosting](#documentation-hosting-t0011).

The user replaced email invitations and email recovery with organizer-created **usernames and passwords**.
SMTP and personal email addresses are not prerequisites.
Team contestants share a team account.
Staff have individual accounts.
Supabase manages passwords and sessions through internal identifiers with email format.
These identifiers are not mailboxes and must not receive mail.

### Create and recover accounts

To assign a username to an existing account:

1. Sign in to Minsky as admin.
2. Under **Session accounts**, expand the account.
3. Select **Assign username → Set username**.

Existing development accounts can use their original email and password until an admin assigns a username.
Usernames contain 3–32 letters, digits, underscores, or hyphens.
The app stores them in lowercase.
Username assignment preserves the password, Auth UUID, memberships, and history.
It replaces that account's email login.
Do not distribute the old email as future login instructions.

To create an account:

1. Open the **Session** tab in the organiser phone app and select **New account**. In the desktop console, open **Accounts** and select **Create account**. Enter a display name.
2. Enter a unique username.
3. Select a roster team for a contestant, or staff permissions for an individual.
4. Select **Create account**.
5. Share the displayed username and generated temporary password through an agreed secure channel.
6. Record the credentials privately.
7. Select **Done** to dismiss the displayed credentials.

The app does not retain a recoverable password copy.
If you lose the response, reset the password.
Users must change temporary passwords before they can read or change contest data.
Refresh and direct API calls cannot bypass this requirement.

To recover an account:

1. Verify the requester's identity outside the app.
2. Open the account in the **Session** tab, or select **Manage** on **Accounts** in the desktop console.
3. Select **Reset password** and confirm it.
4. Share the replacement temporary password securely.

Existing sessions and refresh tokens lose access.
The user must sign in again and change the replacement password.
For your own account, use **Change password** and enter the current password.
Account-wide resets and username assignment require admin access to every session where the target has membership.
These operations reject archived memberships.
Ordinary session permission changes remain scoped to that session.

If the sole admin loses their password, a trusted provider maintainer can use the recovery command below.
First, link the intended project.
Run the command in a **private terminal**:

```sh
npm run cloud:recover-admin -- --user EXISTING_ADMIN_AUTH_UUID
```

The command holds service credentials in memory.
It verifies an existing admin for an active event.
It issues a temporary password and invalidates previous sessions.
The next login requires a password change.
The command displays the temporary password only in that terminal.

Never run this command in CI.
Never paste its output into chat or commit it.
Ordinary app accounts cannot access its service-only recovery RPC.
Recovery audit entries identify a provider operation.
They do not attribute the operation to the person who lost access.

This flow uses no public signup, email confirmation links, invitation links, or email recovery.
Keep signup and anonymous sign-in disabled.
The trusted creation function explicitly confirms internal accounts.
This creates the account without verifying a mailbox.
Previously configured redirect URLs may remain.
T0003 does not require a sender, domain, or SMTP setup.

## Ownership and costs

### Documentation hosting (T0011)

The documentation site uses a separate static Worker named `minsky-docs`.
Its address is `https://minsky-docs.icaic-minsky.workers.dev`.
Its configuration is `wrangler.docs.jsonc`, with `site/dist` as its only asset directory.
The account is the existing Minsky development account, `458ad6a930b0fb717796dfa19ca6a2b1`.
It has no backend binding, Supabase credential, or Worker request handler.
No paid upgrade or purchased domain is required for this setup.

Use Node.js 22.22 or later. From the repository root:

```sh
npm ci
npm ci --prefix site
npm run docs:build
npm run docs:test
npx wrangler whoami
npx wrangler deploy --config wrangler.docs.jsonc --dry-run
npm run docs:deploy
```

Confirm the account and Worker name before the final command.
The user authorized the initial documentation deployment before merge on 2026-10-17.
This is a T0011 exception for the docs Worker only.
After automation setup, later stable updates use review, merge, passing CI, and automatic frontend deployment.
The app's `npm run deploy` command is separate.
See [the complete guide](../site/src/content/docs/contributing/documentation.md).

### Existing provider records

On 2026-10-02, the user deferred records of provider ownership and billing details.
On 2026-10-03, the user moved these scope notes from T0004.
They stay deferred.
They are not part of the T0005 issue-image ticket.
The guidance below still applies before any paid upgrade.
No paid upgrade is selected.

Use individual provider logins and membership controls for Supabase and Cloudflare.
Provider access and Minsky app membership are separate.
The user completes provider account verification and payment entry privately.
Keep passwords, database credentials, recovery codes, and API secrets outside Git, chat, and public logs.

Record these non-secret details in the completion record:

- The organization or account owner and maintainer access.
- The billing contact and selected plan for each provider.
- Current recurring charges.
- The location of the usage dashboard.
- Receipt and reimbursement procedures.

Start with Supabase Free and Workers Free.
This ticket does not require an SMTP provider, image bucket, custom application domain, R2, or AWS account.
Static assets served without Worker code invocation are free and unlimited.
Supabase Free limits and inactivity pausing still apply.
Review usage before a pilot.
Before any paid upgrade, record the concrete blocker, current cost, and expected monthly spend.

Free tiers do not establish capacity for 800 users.
See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Supabase pricing](https://supabase.com/pricing).

## Issue image storage (T0005)

T0005 adds a private Storage bucket named `issue-attachments`.
The bucket accepts JPEG, PNG, and WebP objects up to 50 MB.
Each image uses two paths: `{session}/{issue}/{attachment}/original` and `{session}/{issue}/{attachment}/thumbnail`.
The browser creates the JPEG thumbnail.
Its longest edge is 480 pixels, and its maximum size is 512 KB.
Thumbnails do not count toward the image count or the issue total.
Supabase Free includes 1 GB of file storage.
It does not include image transformations.
This ticket does not enable transformations or a paid plan.
At the default 120 MB issue total, about eight full issues use 1 GB.

The user authorized the T0005 preview and use of the existing development backend on 2026-10-11.
The migration and `admin`/`attachments` functions are applied to `Minsky` development.
`Minsky CI` remains unchanged.
Apply the migration before you deploy functions.
Then deploy `admin` and `attachments`.
Then deploy the frontend.
`npm run cloud:functions` deploys both functions to development.
Prepare these backend changes before a dependent frontend merges. Automatic frontend deployment does not apply backend changes.

The review fixes use `202610140001_attachment_fixes.sql`.
Keep the first attachment migration unchanged.
Apply the new migration, then deploy the updated `attachments` function, then deploy the frontend.
The migration removes the old upload-completion function.
The new function requires the verified login-session ID from `account_status`.
The older deployed attachment function cannot complete uploads after this migration.
Complete the function update in the same release before testing uploads.

Failed file deletion keeps a cleanup record for the uploader.
The record remains available after refresh.
**Retry removal** repeats file deletion and confirms completion in the database.
Other members cannot see the uploader's cleanup record.
This does not add a deletion job.
New removal requests stop after archival.
File cleanup for a removal already approved before archival can still finish.

### Manual Worker previews

From the reviewed ticket branch, run `npm run deploy:preview -- --preview-alias t0005`.
This builds the frontend and runs `wrangler versions upload`.
It updates `https://t0005-minsky-dev.icaic-minsky.workers.dev` and leaves the main Worker deployment unchanged.
No permanent `preview` Git branch is needed.
This command is the older manual preview path. After setup, repository branch pushes publish through [the CI workflow](cloudflare-builds.md).
See [Cloudflare version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).

The frontend uses its build-time Supabase settings.
The approved T0005 preview shares `Minsky` accounts, database, and Storage.
The functions' `ALLOWED_ORIGINS` includes the exact preview origin alongside the existing main and local origins.
A frontend preview does not isolate backend changes or data.
Confirm the backend target before applying migrations or functions.
The attachment migration checks that Supabase already enabled Storage RLS rather than altering its managed table.

## Contributor setup

Use Node.js 22.13 or later within 22.x, or Node.js 24 or later.
Use npm.
For a fresh clone, run these commands in sequence:

```sh
npm ci
cp .env.example .env.local
npm run cloud:login
npm run cloud:link
npm run dev
```

Enter the project's public URL in `.env.local`.
Enter its publishable key in `.env.local`.
Obtain authorized provider access.
Enter the database password privately at the CLI prompt.
An application admin must separately grant Minsky session membership.
Never put privileged credentials in `VITE_` variables or frontend builds.

Use timestamped, repository-owned migrations.
Run `npm run cloud:plan` before `cloud:migrate`.
Migrations never seed the shared product.
First setup uses an explicitly selected existing Auth account:

```sh
npm run cloud:plan
npm run cloud:migrate
npm run cloud:bootstrap -- --admin-user EXISTING_AUTH_UUID
npm run cloud:functions
npx supabase secrets set ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4174,https://minsky-dev.icaic-minsky.workers.dev --project-ref ovymmobupzowotvrywek
npm run cloud:hosting-login
npm run deploy
```

Before first setup, review `scripts/bootstrap.sql`.
The bootstrap refuses to run if an admin already exists.
Do not run it again against the development project, which already has an admin.
Initial intake is closed until an admin opens it.
`cloud:functions` bundles remotely with `--use-api`.
Docker is not required.

Supabase supplies the function's service credentials.
Only `ALLOWED_ORIGINS` requires custom function configuration.
The previous `APP_URL` setting is unused.

## Development and release process

| Environment | Supabase project | Use |
| --- | --- | --- |
| Development | `Minsky` — `ovymmobupzowotvrywek` | Shared development app, contributor work, and user trial accounts. |
| CI | `Minsky CI` — `ghtztmovdkhuketcbjmq` | Temporary automated accounts and workflow and authorization fixtures scoped by UUID. |
| Production | Not provisioned | Future real contest accounts and data. Use a separate database, credentials, and frontend. |

For each ticket, use this sequence:

1. Create its branch from updated `main`.
2. Develop against the development project.
3. Add versioned migrations.
4. Run the fast README checks.
5. Prepare the PR.
6. Run cloud integration checks against the reviewed revision.
7. Let the user review and merge.
8. After automation setup, let GitHub Actions deploy both static frontends when the `main` CI checks pass. Coordinate backend deployment separately.

Automatic frontend deployment requires GitHub deployment settings and passing `checks`, `secrets`, and `dependencies` jobs.
Until setup is verified, record merge and deployment separately.
Prepare compatible backend changes before a dependent frontend merges, or pause frontend deployment for that release.
When production exists, validate changes on development and CI before you apply them to production.
See [AGENTS.md](../AGENTS.md#cloud-development-and-deployment-workflow).

**T0004 exception (2026-10-03):** the user's "Deploy first" instruction authorized frontend deployment to the existing `minsky-dev` Worker before merge.
That deployment and all 12 hosted cases passed.
[Current state](current-state.md#t0004-development-deployment-2026-10-03) records the revision, version, and asset checks.
No database migration or account-function deployment was necessary.
The user merged [PR #9](https://github.com/notbowen/minsky/pull/9) on 2026-10-11 (SGT).
The [merge record](current-state.md#t0004-merge-and-documentation-follow-up-2026-10-11) identifies its revision and exact timestamp.

Run CI project commands from a **separate checkout**.
Link that checkout with `npx supabase link --project-ref ghtztmovdkhuketcbjmq`.
Keep the primary checkout linked to development.
Use these commands in the CI checkout:

```sh
npx supabase config diff --project-ref ghtztmovdkhuketcbjmq
npx supabase config push --project-ref ghtztmovdkhuketcbjmq
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase functions deploy admin --project-ref ghtztmovdkhuketcbjmq --use-api
npx supabase functions deploy attachments --project-ref ghtztmovdkhuketcbjmq --use-api
npx supabase secrets set ALLOWED_ORIGINS=http://127.0.0.1:4174 --project-ref ghtztmovdkhuketcbjmq
npm run test:cloud
```

Review the configuration diff before you apply it.
Review the migration target before you apply migrations.
Deploy `attachments` only from a checkout that contains that function.
The merged T0005 image migrations and both functions are installed in `Minsky CI` as of 2026-10-17.
The CI preparation retained the already applied announcement migration from open PR #20.
See the [T0014 verification record](current-state.md#t0014-existing-backend-verification-2026-10-17) for the setup and recovery evidence.
The `cloud:link` and `cloud:functions` npm shortcuts target development.
Use the explicit CI commands above in the separate checkout.

`auth.enable_signup = false` blocks public signup.
Anonymous sign-in is disabled.
Keep `auth.email.enable_signup = true`.
The hosted CLI maps this setting to the email and password provider required for internal username identifiers.
The cloud suite checks that public signup fails while organizer-created accounts can sign in.
Personal mailboxes and SMTP are not required.

## Verification and protected cloud CI

Run these checks:

```sh
npm run typecheck
npm run lint
npm run check:functions
npm run test:functions
npm test
npm run build
```

Embedded PostgreSQL executes the actual migrations and policies with stubs for Auth context, sessions, and password hashes.
It does not establish managed Auth behavior.
`npm run test:functions` checks the attachment HTTP handler with fake Auth, database, and Storage clients.
It tests revoked access, invalid login sessions, failed file deletion, and retries.
`npm run test:e2e` checks login, team search, workspace refresh, and image previews with fictional API responses and no cloud credentials.
The old demo and its tests are removed.
`npm run test:cloud` tests managed Auth, database, and Realtime behavior against a local frontend.
`npm run test:hosted` repeats the suite with real accounts against the deployed app.
The protected cloud job also runs the [shared provider suite](provider-test-contracts.md) through the Supabase adapter.
See [Run the shared provider tests](run-provider-tests.md) for its explicit target settings and separate recovery journal.

Install Chromium with `npx playwright install chromium`.
Cloud tests create unique temporary sessions and accounts.
They change temporary passwords and check the shared workflow and account creation and reset behavior.
They explicitly delete only their own rows.
They never reset the shared project.
Credentials remain in memory and an ignored temporary fixture file.

Do not interrupt fixture deletion.
Do not capture live temporary credentials in screenshots.
Tests dismiss the credentials before capture.

PR CI runs checks without hosted secrets.
The manually dispatched cloud job uses a protected GitHub environment named **cloud-test** and a **separate Supabase test project**.
CI refuses the shared development reference `ovymmobupzowotvrywek`.

Configure `MINSKY_TEST_PROJECT_REF` as an environment variable.
Configure these environment secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Restrict execution to trusted revisions.
Configure required reviewers where the repository's GitHub plan supports them.
Verify plan availability before you treat protection as enabled.
Then manually dispatch **Checks** for the reviewed branch.
Record the cloud job result.
By default, the cloud job applies configuration and migrations, deploys both `admin` and `attachments`, and sets the test origin before the tests.
The job records the remote migration versions and function versions in its log.

To test a frontend change against the existing CI backend, select `existing_backend` when you dispatch the workflow.
Use this mode only when the change needs no new backend migration, function, or configuration.
The existing backend must already allow the test origin `http://127.0.0.1:4174`.
For T0014, the command is:

```sh
gh workflow run checks.yml --repo GiftedNovaHD/minsky \
	--ref feature/t0014-backend-adapters -f existing_backend=true
```

This mode skips backend preparation. The tests still create and delete isolated fixtures.
Before fixture creation, `scripts/check-cloud-backend.mjs` requires every local migration version and active `admin` and `attachments` functions.
The check reads provider metadata and reports additional remote migration versions.
It stops when prerequisites are missing. It does not compare deployed function source or prove that database objects match migration history.
A passing result verifies the frontend against the recorded backend. It does not verify installation of that revision's backend.
Keep the default mode for changes to migrations, functions, or backend configuration.
If the migration history differs, resolve that difference before an installation check.
Do not remove a migration record while its database objects remain.

Automatic frontend deployment is selected but its setup remains unverified.
An app preview can write to its configured development backend through the authenticated app.
It does not isolate data. See [preview backend limits](cloudflare-preview-behavior.md).

See [GitHub environment documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
Initial inspection on 2026-10-02 found no GitHub environments and no separate Supabase test project.
The user later created `Minsky CI`.
The completion record below describes its setup.
The contributor has write access without repository administration access.
The repository owner must configure `cloud-test` for this personal-account repository.

The private repository's plan must support environments and the selected protection rules.
Do not replace environment protection with repository-wide privileged secrets.

The existing setup record also identifies the absence of the `Checks` workflow from `main`.
GitHub requires a manually dispatched workflow on the default branch before execution, even when another reviewed branch is selected.
The user must review and merge the workflow before the first dispatch.
The agent must not merge it to bypass that step.
See [manual workflow requirements](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

## Fixture recovery

Successful teardown deletes the fixture file after all fixture records and accounts are removed.
The wrapper then removes its temporary directory, including when a test assertion failed.
If cleanup fails, the wrapper keeps the file and prints its path.
The file retains the recorded account and session IDs and its existing access restrictions.
It can contain temporary test passwords. Do not copy its contents into logs, chat, or a pull request.

Use the recorded IDs to identify the remaining fixtures in the selected test project.
Delete only records and accounts from that test run.
Remove the recovery file and its directory after cleanup succeeds.
The file is local to the machine that ran the tests.

## Completion record

- Supabase project: `Minsky`, URL `https://ovymmobupzowotvrywek.supabase.co`, reference `ovymmobupzowotvrywek`, organization `gayymsuhfqsboksikzwx`, Singapore region `ap-southeast-1`, PostgreSQL 17. Provider access and CLI login/link were independently verified in the initial implementation.
- Separate CI project: `Minsky CI`, URL `https://ghtztmovdkhuketcbjmq.supabase.co`, reference `ghtztmovdkhuketcbjmq`, organization `gayymsuhfqsboksikzwx`, Tokyo region `ap-northeast-1`, PostgreSQL 17. CLI verified `ACTIVE_HEALTHY`. All five migrations were applied without seeds; the admin function was deployed with server-side bundling and `ALLOWED_ORIGINS=http://127.0.0.1:4174`. Repository-owned Auth configuration was applied. No trial accounts or shared development records were copied.
- CI project verification: all 11 local cloud workflow/Auth/authorization cases passed with fixture teardown. This is project preparation evidence, not a protected GitHub Actions run. Detailed outcomes and the initial configuration failure are recorded in [current state](current-state.md#separate-ci-project-and-development-workflow-2026-10-02).
- Cloudflare account: `458ad6a930b0fb717796dfa19ca6a2b1`; Worker `minsky-dev` under `icaic-minsky.workers.dev`. Provider access and deployment were verified. Current deployment version and tests are in [current state](current-state.md).
- Initial development account identifier: `1b8c9cb2-f84c-4d13-92f9-b70088db38f8`. Trusted bootstrap verified existence and assigned the initial development event/session/three teams. The user subsequently confirmed signing into the hosted app. Their password was never requested or inspected. Assign a username through the app without recreating this account.
- Authentication settings: user reported Email enabled, public signup and anonymous sign-in disabled, email confirmation enabled and exact local/hosted redirects saved. Keep these settings; the trusted function confirms organizer-created internal identities.
- Historical migrations `202610020001_cloud.sql` through `202610020003_private_signals.sql` and the first bootstrap were applied without seeds. Both username/password migrations were applied without seeds, the account function was deployed, and all eight final hosted cases passed. Current deployment/version and detailed verification are recorded in current-state.md.
- SMTP: deliberately removed from T0003 requirements by the user. No sender domain or paid mail service was configured; prior SMTP blockers are historical.
- Ownership/billing: selected plans, organization owner, billing contact, recurring charges and receipt handling remain unverified. They stay deferred and are not part of the T0005 issue-image ticket. No paid upgrade was selected or payment action performed by the agent.
- Protected cloud CI: remains in T0003. The separate test project is prepared; protected GitHub environment setup and the first protected cloud run remain pending, including owner access and default-branch workflow availability. Local runs against isolated fixtures are separate evidence.
