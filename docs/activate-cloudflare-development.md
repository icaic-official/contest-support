# Activate the fresh Cloudflare development installation

This maintainer procedure switched the development URL to Cloudflare on 19 October 2026. See the [activation record](#activation-record-19-october-2026).
Use the same steps for a later approved switch of the same kind. Each switch needs a new owner approval.
For another installation, use [Install Cloudflare](../site/src/content/docs/operators/installation.mdx).
That guide owns resource creation, migrations, bootstrap, and trusted owner recovery.
This guide owns the development switch, verification, and repair.

## Review the installation targets

[PR #43](https://github.com/GiftedNovaHD/minsky/pull/43) merged at `4e43739ac2ce56cca7e7739e4db189aa2854d4a9` on 19 October 2026.
It includes PR #42, merged at `104d9d1` on 18 October.
The owner separately approved activation and repeat-deployment verification. A preparation PR merge alone does not approve a backend switch.

These targets exist in account `458ad6a930b0fb717796dfa19ca6a2b1`:

| Target | Recorded value |
| --- | --- |
| Stable Worker and URL | `minsky-dev`, `https://minsky-dev.icaic-minsky.workers.dev` |
| Stable version before preparation | `71b610bd-7f43-450d-b9c7-e85057c31da4` |
| Verified candidate and URL | `minsky-development-candidate`, `https://minsky-development-candidate.icaic-minsky.workers.dev` |
| Candidate version | `c15b6ab7-bba0-4e9f-9292-2c2bd345e9a3` |
| Development D1 | `minsky-development`, UUID `a1832f97-4d4c-45c2-a848-8d3dfd0b74f5` |
| Private R2 | `minsky-development-images` |
| Candidate live namespace | `09c5ecd2771042609fa9d280380ef06f` |
| Live binding and class | `LIVE_UPDATES`, `SessionLiveCoordinator` |
| Durable Object migration | `v1`, SQLite class `SessionLiveCoordinator` |
| CPU cap | `1000` ms |
| Scheduled recovery | `* * * * *` |
| Stable public origin | `AUTH_ORIGIN=https://minsky-dev.icaic-minsky.workers.dev` |
| Private Worker secret | `AUTH_SECRET`, created privately during activation and preserved on later deployments. |
| Private publishing credential | `CLOUDFLARE_API_TOKEN` in the private publishing shell. The 2026-10-19 activation used the former GitHub repository secret. |
| Public settings | `src/server/adapters/cloudflare/deploy/development.settings.json` |
| Generated stable configuration | `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc` |
| Installation marker | `7867c628-36b7-4724-b0a3-83c1894b23e8` |
| New owner | `e102228c-f5c8-4180-962f-3a8b87d99b13`, username `organizer`. |
| Development session | `5b092d9c-e3b1-4b33-b86c-f89f6df2839d` |
| Original verified candidate source | `f6864f6ea29e663e78483d0cfd28a8f4e3299c2c` |
| Approved stable source and repair revision | `4e43739ac2ce56cca7e7739e4db189aa2854d4a9` |
| Stable live namespace | `71700338eed643d59185f4a777fcb7b2` |
| First complete stable version | `cd704354-5ca8-483c-998b-5bfe9ccd8d86` |
| Repeat deployment version | `9f3686bd-ffa8-46bf-977f-2d9554235d41` |

The stable URL uses Cloudflare after the approved activation.
The four exact target variables select the complete Worker. Since 2026-10-24 the deploy script publishes only Cloudflare and ignores `MINSKY_DEV_BACKEND`.
The candidate remains stopped, with its public and preview URLs disabled and its cron list empty.
The separate installation-verification and CI resources are listed in [run log](history/run-log.md#t0021-fresh-development-installation-2026-10-18).
Do not substitute those resources for development.

Records, accounts, passwords, images, and IDs from the earlier backend do not appear in the fresh installation.
The activation exported no records, reset no accounts, and deleted no resources.
The new owner comes from the supported bootstrap process. Its credentials stay in private files outside the checkout.

## Complete the approval record

Before requesting activation approval, complete these checks:

1. Have the owner review and merge the preparation revision. Update a clean checkout from `main`.
2. Record the exact approved main revision and its push run. Reconcile any review changes and repeat affected checks.
3. Confirm the account and every exact target again. Reconfirm the current stable version for the recovery record.
4. Require the final local and hosted checks. Record local and CLI hosted results separately.
5. In Cloudflare, confirm that independent Git builds remain disabled for `minsky-dev`. The `minsky-docs` docs builds stay connected.
6. Review the configuration, secret names, deployment sequence, verification criteria, and repair commands below with the owner.
7. Obtain explicit approval for this backend switch. Do not infer it from the preparation PR merge.

On 19 October 2026, the owner confirmed that independent Git build connections were disconnected for both Workers.
The Builds API returned `403`, so that confirmation came from the owner's dashboard check.
For a future switch, reconfirm the setting. Do not create a broader token merely for this read-only check.
See [Cloudflare Builds permissions](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/#1-create-an-api-token-with-the-correct-permissions).

Check existing Wrangler access before requesting credentials:

```sh
unset CLOUDFLARE_ENV
export WRANGLER_WRITE_LOGS=false WRANGLER_LOG_SANITIZE=true WRANGLER_SEND_METRICS=false
npx wrangler whoami
```

Confirm account `458ad6a930b0fb717796dfa19ca6a2b1`.
Workers Paid and R2 are active. No further paid upgrade is approved.
Document a concrete need and cost before proposing one.
The deployment token needs the permissions in [deployment settings](cloudflare-build-settings.md#repository-settings).
Keep private credentials out of chat, command arguments, Git, frontend variables, logs, and ordinary artifacts.

## Quiesce the candidate before stable secret preparation

Do not start another publish.
Stop candidate tests and close their browser contexts and live connections.
In account `458ad6a930b0fb717796dfa19ca6a2b1`, select only `minsky-development-candidate`:

1. Remove its Cron Triggers under **Settings**, then **Triggers**. Retain the recorded schedule for repair.
2. Disable its `workers.dev` and preview URLs under **Settings**, then **Domains & Routes**.
3. Confirm that the candidate has no custom domain or Worker route.
4. Confirm the disabled URL no longer reaches the application and its schedule list is empty.
5. Record a drain deadline 30 minutes after the settings read confirms shutdown.
6. Keep tests and live connections stopped. Do not publish the stable dispatcher before that deadline.

Cron removal can take 15 minutes to propagate. An already admitted scheduled invocation can run for another 15 minutes.
The 30-minute deadline covers both intervals. Secret preparation and build checks can run during this drain.
After the deadline, require zero pending notification records before publication.
Do not treat an immediate URL assertion failure as proof that the acknowledged settings writes failed. Reconcile through read-only checks.

The candidate and stable Workers would share saved notification records but have different live-update namespaces.
A candidate dispatcher could mark a notification delivered without notifying stable clients.
Keep only one dispatcher active for this installation.
Do not delete either namespace, the database, the bucket, the administrator, or private secrets.

Only the candidate URL becomes unavailable during this step.
During the first switch, the earlier backend remained available at the stable URL until the complete Worker replaced it.
This step is reversible through the candidate's recorded URL and schedule after stopping any stable dispatcher.

## Create the approved stable secret

Run initial secret preparation only after explicit activation approval and confirmed candidate shutdown.
An ordinary deployment preserves the existing secret and skips this creation step:

```sh
MINSKY_DEV_CLOUDFLARE_CONFIG=src/server/adapters/cloudflare/deploy/development.wrangler.jsonc
MINSKY_DEV_DATABASE_ID=a1832f97-4d4c-45c2-a848-8d3dfd0b74f5
MINSKY_DEV_DATABASE_NAME=minsky-development
MINSKY_DEV_BUCKET_NAME=minsky-development-images
npm run cloudflare:install -- plan --settings=src/server/adapters/cloudflare/deploy/development.settings.json --config="$MINSKY_DEV_CLOUDFLARE_CONFIG"
npm run cloudflare:install -- secret --config="$MINSKY_DEV_CLOUDFLARE_CONFIG" --account=458ad6a930b0fb717796dfa19ca6a2b1 --database="$MINSKY_DEV_DATABASE_ID"
```

The plan must identify the exact table values above.
The secret command checks live account, database, migrations, and secret metadata.
It creates `AUTH_SECRET` through private stdin and refuses an existing secret.
If the secret already exists, reconcile its ownership and preserve it. Do not delete or rotate it to force installation.
The candidate secret and cookie do not establish stable-origin sessions.
The stable application uses `__Host-minsky-session` with `Secure`, `HttpOnly`, and `SameSite=Strict`.

## Publish the complete stable Worker

From the approved checkout, validate the Cloudflare build and full configuration.
Before setting publication variables, require the recorded drain deadline to pass. Confirm that pending notifications are zero.
Reconfirm candidate shutdown, exact targets, and the preserved stable secret.

Run the build and dry run:

```sh
npm run build
npx wrangler deploy --config="$MINSKY_DEV_CLOUDFLARE_CONFIG" --dry-run
```

Review the exact Worker, account, D1 UUID, bucket, live class, assets, origin, CPU cap, and cron.
The dry run makes no provider change.
Export the approved values in the publishing shell. No GitHub workflow reads repository variables now.

```sh
export MINSKY_DEV_CLOUDFLARE_CONFIG MINSKY_DEV_DATABASE_ID MINSKY_DEV_DATABASE_NAME MINSKY_DEV_BUCKET_NAME
```

Publish the approved revision with the guarded script in [deployment settings](cloudflare-build-settings.md#publication-commands).
Confirm the script's revision matches the recorded approval before it uploads.
The app command validates the exact hosted targets, applies new D1 migrations, and deploys the complete Worker.
It does not bootstrap accounts or rotate secrets.
After activation, Workers Builds publishes each push to `main`. See [Publish the application](cloudflare-builds.md#publish-the-application).
Workers Builds also publishes the docs. See [Publish the docs](cloudflare-builds.md#publish-the-docs).

## Verify activation and subsequent deployment

Require these results:

1. `/minsky-revision.json` reports the approved revision, Cloudflare backend, D1 UUID, bucket, and origin.
2. Anonymous `/api/sessions` returns `401` with `Cache-Control: no-store`. Private source paths return `404`.
3. The new owner can sign in. Temporary-password changes and recovery restrictions hold.
4. The fictional application journey passes at the stable URL, including jury decisions, persisted timers, private images, internal-note separation, and reconnects.
5. Live metadata matches the approved D1, R2, live class, origin, cron, CPU cap, and `AUTH_SECRET` name. Record the newly created stable namespace ID.
6. Docs remain available independently.
7. A subsequent approved deployment preserves Cloudflare mode and the exact bindings, then passes the same checks.

Clean only UUID-owned fixtures and exact R2 keys. Retain a recovery journal if cleanup fails.
Keep the candidate's routes and schedules disabled.
Record code revisions, Worker versions, CLI results, and outstanding manual checks in the [run log](history/run-log.md).
Only then mark activation complete.

## Activation record, 19 October 2026

The owner merged PR #43 at `4e43739ac2ce56cca7e7739e4db189aa2854d4a9`.
Ordinary [main CI](https://github.com/GiftedNovaHD/minsky/actions/runs/39252514749) passed on attempt 1.
The owner then explicitly approved activation and repeat-deployment verification and confirmed both independent Git builds were disconnected.
The candidate's cron and public routes were disabled before stable secret creation.
A later read-only check confirmed its disabled URL returned `404`. The original immediate-check failure and recovery journal remain preserved.
The drain deadline was 13:10:00.638 UTC. Initial stable secret creation used the supported private command during that drain.
The build and complete Worker dry run passed on the approved source.
[Attempt 2](https://github.com/GiftedNovaHD/minsky/actions/runs/39252514749/attempts/2) failed its docs keyboard-search wait before publication. Both upload jobs skipped.
The unchanged focused local case passed. The complete unchanged retry passed as attempt 3.
No assertion, timeout, or protection changed. The initial wait failure has no confirmed cause.

| Evidence | Result |
| --- | --- |
| First automated publication | [Run 39252514749, attempt 3](https://github.com/GiftedNovaHD/minsky/actions/runs/39252514749/attempts/3), source `4e43739`. All five ordinary and publication jobs pass. |
| First stable verification | CLI stable verification passes 14/14 at 13:42:36 UTC. No failures, skips, flaky results, infrastructure errors, or retained fixture journals. The live configuration audit passes. |
| Subsequent automated publication | [Run 39252514749, attempt 4](https://github.com/GiftedNovaHD/minsky/actions/runs/39252514749/attempts/4), source `4e43739`. All five ordinary and publication jobs pass. |
| Repeat verification and retained namespace | CLI stable verification passes 14/14 at 14:07:38 UTC, with clean owned-fixture removal. The live audit confirms namespace `71700338eed643d59185f4a777fcb7b2` and every binding match the first deployment. |

The [run log](history/run-log.md) owns detailed verification results and remaining manual checks.
No data or identifiers transferred from the earlier backend.

## Recover a Cloudflare admin password

The development admin is `organizer`.

Use `npm run cloudflare:recover-admin` when a Cloudflare admin cannot sign in.
Run it in a private terminal on your computer.
The command refuses CI.
It also refuses a terminal whose output is redirected, because the temporary password must stay on that screen.

The command reads the `DB` binding from a Wrangler configuration.
The default file is `wrangler.jsonc`.
That file does not name the development database.
The development Worker binding is in `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc`.
Its database name is `minsky-development`.
The command uses the remote database named by the selected file.
It does not use a local database.

Confirm the database name in the command output before you share the password.
From the repository root, run:

```sh
npm run cloudflare:recover-admin -- --config src/server/adapters/cloudflare/deploy/development.wrangler.jsonc --username organizer
```

Pass `--user ACCOUNT_ID` instead of `--username` when you know the account ID.
Pass exactly one of those selectors.
You can pass `--config` with another Wrangler file when the account is in a different remote `DB` binding.
The binding must set `"remote": true`.
The file must not define Wrangler environment overrides.

The command checks that the account exists and is not disabled.
The account must be an admin of an active event, or the installation owner.
It then writes the same credential rows as **Reset password** in the application.
It sets `must_change`, increases `credential_generation`, and database triggers increase `access_version`.
It revokes every login and Better Auth session for that account.
It records a completed `reset_password` row in `account_operations`.
The actor on that row is the recovered account, because the maintainer has no Minsky account.
All of those writes commit in one database batch.
If the batch fails, the account keeps its previous password.

The command prints the temporary password once on the terminal.
It does not write the password to a file or a log.
Copy the password from the terminal and share it through a secure channel.
The admin must change the password at the next sign-in.

Do not run this command in CI.
Do not paste its output into chat or commit it.
Do not run it against a database other than the one named in your selected configuration.

The installation guide has a separate owner recovery command.
That command requires the installation ID and writes a private result file.
Use it when you are recovering a new installation and already have those IDs.

## Repair a failed activation

Do not start another publish.
Retain all new D1 records, R2 objects, owner results, journals, and private secrets.
Use the latest recorded compatible complete stable revision with the retained stable configuration.
The first verified complete stable source is `4e43739ac2ce56cca7e7739e4db189aa2854d4a9`.
The initial activation approval allowed candidate source `f6864f6ea29e663e78483d0cfd28a8f4e3299c2c` for first repair. That repair was not needed. The verified stable source is now the recorded repair baseline.
Do not restore the earlier assets-only version after Cloudflare writes begin.

Create a separate repair checkout at the selected revision and install its locked dependencies.
Set these public path variables in the repair shell:

- `MINSKY_APPROVED_SETTINGS` is the absolute path to the reviewed `development.settings.json` containing the table values above.
- `MINSKY_REPAIR_CONFIG` is a new absolute configuration path under the repair checkout.

Run the provider generator and publish the repair code:

```sh
npm run cloudflare:install -- configure --settings="$MINSKY_APPROVED_SETTINGS" --config="$MINSKY_REPAIR_CONFIG"
npm run build
npx wrangler deploy --config="$MINSKY_REPAIR_CONFIG" --dry-run
npx wrangler deploy --config="$MINSKY_REPAIR_CONFIG"
```

The regenerated configuration must select `minsky-dev`, the stable origin, and the retained development D1 and R2 resources.
Preserve the stable Worker's existing `AUTH_SECRET`. Do not create or rotate that secret during repair.
Do not use the candidate name or origin in a stable repair deployment.
Do not apply down migrations or rerun bootstrap. Follow the installation guide for owner recovery.
Verify stable authentication, workflows, images, and live updates before resuming publication.

If repair requires the candidate URL, first stop stable traffic, disable stable routes and schedules, and drain admitted work.
Then restore only the candidate's recorded URL and schedule. An unavailable stable URL alone does not stop its cron.
A return to the earlier backend requires a separate approved recovery plan. It does not transfer new Cloudflare records.
The guarded app deployment refuses an assets-only overwrite of a complete Worker.
