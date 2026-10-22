# Activate the fresh Cloudflare development installation

Use this maintainer procedure to switch the existing development URL after owner approval.
For another installation, use [Install Cloudflare](../site/src/content/docs/operators/installation.mdx).
That guide owns resource creation, migrations, bootstrap, and trusted owner recovery.
This guide owns the development switch, verification, and repair.

## Review the prepared targets

PR #42 merged at `104d9d1` on 18 October 2026. T0021 includes that main revision.
The earlier restriction to local preparation ended at that merge.
[PR #43](https://github.com/GiftedNovaHD/minsky/pull/43) contains this preparation.
The owner reviews and merges. PR merge does not approve activation.

These targets exist in account `458ad6a930b0fb717796dfa19ca6a2b1`:

| Target | Prepared value |
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
| Private Worker secret | `AUTH_SECRET`, absent on the stable Worker before activation. |
| Private publishing credential | Existing repository secret `CLOUDFLARE_API_TOKEN`. |
| Public settings | `src/server/adapters/cloudflare/deploy/development.settings.json` |
| Generated stable configuration | `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc` |
| Installation marker | `7867c628-36b7-4724-b0a3-83c1894b23e8` |
| New owner | `e102228c-f5c8-4180-962f-3a8b87d99b13`, username `organizer`. |
| Development session | `5b092d9c-e3b1-4b33-b86c-f89f6df2839d` |
| Verified executable and first repair source | `f6864f6ea29e663e78483d0cfd28a8f4e3299c2c` |
| Approved deployment revision | Pending owner review, merge, and the concrete activation approval. |

The stable Worker's current metadata has no application bindings. It still uses Supabase.
`CLOUDFLARE_DEPLOY_ENABLED=false` pauses publishing. All five Cloudflare selection variables are absent.
The separate installation-verification and CI resources are listed in [current state](current-state.md#t0021-fresh-development-installation-2026-10-18).
Do not substitute those resources for development.

Existing Supabase records, accounts, passwords, images, and IDs do not appear in the fresh installation.
Leave Supabase intact. Do not export records, reset its accounts, or delete its resources.
The new owner comes from the supported bootstrap process. Its credentials stay in private files outside the checkout.

## Complete the approval record

Before requesting activation approval, complete these checks:

1. Have the owner review and merge PR #43. Update a clean checkout from `main`.
2. Record the exact approved main revision and its push run. Reconcile any review changes and repeat affected checks.
3. Confirm the account and every exact target again. Reconfirm the current stable version for the recovery record.
4. Require the final local and hosted checks. Record CLI hosted results separately from protected GitHub Actions results.
5. Obtain any required authorization before adding a branch to `cloud-test`. Preserve all existing entries and protection rules.
6. In Cloudflare, confirm that independent Git builds remain disabled for `minsky-dev` and `minsky-docs`.
7. Review the configuration, secret names, deployment sequence, verification criteria, and repair commands below with the owner.
8. Obtain explicit approval for this backend switch. Do not infer it from the preparation PR merge.

The owner previously confirmed that independent Git builds were disabled.
Current Builds API reads return `403`, so this run cannot verify that setting.
Use the dashboard before activation. Do not create a broader token merely for this read-only check.
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

## Create the approved stable secret

Run the following commands only after the concrete activation approval:

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
If the secret already exists, stop and reconcile its ownership. Do not delete or rotate it to force installation.
The candidate secret and cookie do not establish stable-origin sessions.
The stable application uses `__Host-minsky-session` with `Secure`, `HttpOnly`, and `SameSite=Strict`.

## Quiesce the candidate before stable deployment

Pause publishing and cancel any active publication job separately.
Stop candidate tests and close their browser contexts and live connections.
In account `458ad6a930b0fb717796dfa19ca6a2b1`, select only `minsky-development-candidate`:

1. Remove its Cron Triggers under **Settings**, then **Triggers**. Retain the recorded schedule for repair.
2. Disable its `workers.dev` and preview URLs under **Settings**, then **Domains & Routes**.
3. Confirm that the candidate has no custom domain or Worker route.
4. Confirm the disabled URL no longer reaches the application and its schedule list is empty.
5. Let admitted requests and scheduled work finish. Confirm no pending notification remains.

The candidate and stable Workers would share saved notification records but have different live-update namespaces.
A candidate dispatcher could mark a notification delivered without notifying stable clients.
Keep only one dispatcher active for this installation.
Do not delete either namespace, the database, the bucket, the administrator, or private secrets.

Only the candidate URL becomes unavailable during this step.
Supabase remains available at the existing development URL until the complete Worker replaces it.
This step is reversible through the candidate's recorded URL and schedule after stopping any stable dispatcher.

## Publish the complete stable Worker

From the approved checkout, validate the Cloudflare build and full configuration:

```sh
VITE_BACKEND=cloudflare npm run build
npx wrangler deploy --config="$MINSKY_DEV_CLOUDFLARE_CONFIG" --dry-run
```

Review the exact Worker, account, D1 UUID, bucket, live class, assets, origin, CPU cap, and cron.
The dry run makes no provider change.
Set these public repository variables to the approved values:

```sh
gh variable set MINSKY_DEV_BACKEND --body cloudflare
gh variable set MINSKY_DEV_CLOUDFLARE_CONFIG --body "$MINSKY_DEV_CLOUDFLARE_CONFIG"
gh variable set MINSKY_DEV_DATABASE_ID --body "$MINSKY_DEV_DATABASE_ID"
gh variable set MINSKY_DEV_DATABASE_NAME --body "$MINSKY_DEV_DATABASE_NAME"
gh variable set MINSKY_DEV_BUCKET_NAME --body "$MINSKY_DEV_BUCKET_NAME"
gh variable set CLOUDFLARE_DEPLOY_ENABLED --body true
```

Rerun the latest approved `main` push's **Checks** run.
Confirm that the run's revision matches the recorded approval before rerunning it.
The app job selects `VITE_BACKEND=cloudflare`, validates the exact hosted targets, and deploys the complete Worker.
It does not migrate D1, bootstrap accounts, or rotate secrets.
Docs publish through their independent job.

## Verify activation and subsequent deployment

Require these results:

1. `/minsky-revision.json` reports the approved revision, Cloudflare backend, D1 UUID, bucket, and origin.
2. Anonymous `/api/sessions` returns `401` with `Cache-Control: no-store`. Private source paths return `404`.
3. The new owner can sign in. Temporary-password changes and recovery restrictions hold.
4. The fictional application journey passes at the stable URL, including jury decisions, persisted timers, private images, internal-note separation, and reconnects.
5. Live metadata matches the approved D1, R2, live class, origin, cron, CPU cap, and `AUTH_SECRET` name. Record the newly created stable namespace ID.
6. Docs remain available independently.
7. A subsequent approved automated deployment preserves Cloudflare mode and the exact bindings, then passes the same checks.

Clean only UUID-owned fixtures and exact R2 keys. Retain a recovery journal if cleanup fails.
Keep the candidate's routes and schedules disabled.
Record code revisions, Worker versions, CLI results, protected run URLs, and outstanding manual checks in current state.
Only then mark activation complete.

## Repair a failed activation

Pause publishing with `CLOUDFLARE_DEPLOY_ENABLED=false`. Cancel active publishing jobs separately.
Retain all new D1 records, R2 objects, owner results, journals, and private secrets.
For first activation, use verified candidate code `f6864f6ea29e663e78483d0cfd28a8f4e3299c2c` with the stable configuration.
There is no earlier complete stable Worker to restore.
For a later release, select a recorded compatible complete stable revision.

Create a separate repair checkout at the selected revision and install its locked dependencies.
Set these public path variables in the repair shell:

- `MINSKY_APPROVED_SETTINGS` is the absolute path to the reviewed `development.settings.json` containing the table values above.
- `MINSKY_REPAIR_CONFIG` is a new absolute configuration path under the repair checkout.

Run the provider generator and publish the repair code:

```sh
npm run cloudflare:install -- configure --settings="$MINSKY_APPROVED_SETTINGS" --config="$MINSKY_REPAIR_CONFIG"
VITE_BACKEND=cloudflare npm run build
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
A return to Supabase requires a separate approved recovery plan. It does not transfer new Cloudflare records.
The guarded app deployment refuses an assets-only overwrite of a complete Worker.
