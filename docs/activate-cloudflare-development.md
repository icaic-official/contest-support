# Activate the fresh Cloudflare development installation

Use this maintainer procedure for T0021's development URL switch.
It complements the [installation procedure](../site/src/content/docs/operators/installation.md).
The installation procedure owns resource creation, migrations, bootstrap, and owner recovery.
This page owns the repository's activation approval and deployment sequence.

## Observe the preparation gates

PR #42 merged at `104d9d1` on 18 October 2026. T0021 includes that main revision.
The earlier restriction to local preparation ended at the merge.
Keep the earlier ticket's checkout and unrelated resources unchanged.
For subsequent main updates, use:

```sh
git fetch origin main
git merge origin/main
```

Reconcile review changes. The pre-merge T0021 deployment hold is removed.
Repeat the required checks on the reconciled revision before marking the PR ready.
Do not change the protected `cloud-test` rules or branch allowlist under T0020's authorization.
If T0021 needs a new protected branch entry, obtain authorization for that exact entry.

Supabase remains active until the separate activation approval below.
Existing Supabase trial records, including its administrator, will not appear in Cloudflare.
Do not export them, reset accounts, or delete Supabase resources.

## Install and verify independent resources

Check existing Wrangler access before requesting credentials:

```sh
WRANGLER_WRITE_LOGS=false WRANGLER_LOG_SANITIZE=true npx wrangler whoami
```

Confirm account `458ad6a930b0fb717796dfa19ca6a2b1` and every exact resource target before mutation.
Workers Paid and R2 are already active. No further paid upgrade is approved.
The current generated Worker uses a 1,000 ms CPU cap for maintained password hashing.
Document a concrete need and price before proposing another upgrade.

Follow the installation procedure with a new development candidate Worker and dedicated D1 and private R2 resources.
Do not use `minsky-dev` for that initial deployment.
Record the actual names and IDs after creation. Resource names in a proposal do not establish that a resource is unused.
Keep these resource groups separate:

| Purpose | Resources |
| --- | --- |
| Fresh development candidate | Newly created Worker, D1 database, and private R2 bucket. Record their actual identifiers. |
| Connector CI | `minsky-connector-ci`, D1 `de43cf95-c024-4e44-860d-8ff179e4e08d`, bucket `minsky-connector-ci-images`. |
| Direct D1 CI | `minsky-connector-store-ci`, D1 `341350ba-7c74-4c46-8b21-edfdcda475f5`. No application Worker. |
| Installation verification | Separate empty-installation resources. Never reuse development or CI resources. |

Bootstrap one new administrator. Store generated credentials in a private file outside the checkout.
Require a password change before contest access, then verify trusted owner recovery and old-session rejection.
Run the installation guide's full fictional journey, including the jury worklist, persisted timers, images, and reconnects.
Inspect phone widths, keyboard actions, refresh persistence, and internal-note separation.

Run the [shared provider checks](run-provider-tests.md) on their guarded CI targets.
Do not bypass CI target guards to run them on the development installation.
Verify the candidate separately through the installation procedure.
Clean only UUID-owned fixtures. Keep journals if cleanup fails.
Record CLI hosted results separately from protected GitHub Actions results.
Historical T0020 results do not verify this revision.

## Prepare a concrete approval record

Before asking for activation approval, fill every field below with observed values:

| Field | Required evidence |
| --- | --- |
| Account | `458ad6a930b0fb717796dfa19ca6a2b1`, confirmed by current access. |
| Stable Worker and URL | `minsky-dev`, `https://minsky-dev.icaic-minsky.workers.dev`. |
| Candidate Worker | Exact verified name, URL, and deployed version. |
| Development D1 | Exact database name and UUID. Its schema must match the approved checkout. |
| Private R2 | Exact bucket name and disabled public access. |
| Durable Objects | `LIVE_UPDATES`, class `SessionLiveCoordinator`, migration tag `v1`. Record the stable namespace after deployment. |
| Code | Owner-approved full Git revision, PR, checks, and candidate verification record. |
| Public configuration | Reviewed provider settings and generated Wrangler path for the stable Worker. |
| Secrets | Existing deployment token metadata and private Worker `AUTH_SECRET`; include names, never values. |
| Recovery | Previous compatible full Worker revision, schema compatibility, retained credentials, and exact recovery commands. |

Keep the candidate database and bucket when generating the stable configuration.
Change `workerName` to `minsky-dev` and `origin` to the stable URL in a separate public settings file.
Generate the stable configuration with `cloudflare:install configure` at a new path.
Review its complete bindings, `AUTH_ORIGIN`, cron, CPU cap, and migration tag.
Commit only public settings and the generated configuration after actual IDs are known.
Do not place credentials in these files.

The application uses `__Host-minsky-session` cookies with `Secure`, `HttpOnly`, and `SameSite=Strict`.
Authentication and API requests use the frontend's exact HTTPS origin.
The candidate cookie cannot establish a stable-origin session.
Use a new private `AUTH_SECRET` on the stable Worker. Do not copy or print the candidate secret.

Set `CLOUDFLARE_DEPLOY_ENABLED=false` and cancel any running publish jobs before the switch.
Record the previous stable version and public Supabase build settings for recovery.
Review the candidate's continued access and cron before activation.
Include disabling its public URL, custom routes, and cron in the approval sequence after stable checks pass.
Retain its D1 database and bucket. Both hold the fresh installation's records.

Present this complete record and the exact commands to the owner.
Wait for approval of the backend switch. PR merge alone does not grant it.
No activation request is ready while actual resource identifiers or final hosted results are missing.

## Execute the approved switch

Use public shell variables from the approval record:

```sh
MINSKY_DEV_CLOUDFLARE_CONFIG='REPLACE_WITH_REVIEWED_REPOSITORY_CONFIG_PATH'
MINSKY_DEV_DATABASE_ID='REPLACE_WITH_APPROVED_D1_UUID'
MINSKY_DEV_DATABASE_NAME='REPLACE_WITH_APPROVED_D1_NAME'
MINSKY_DEV_BUCKET_NAME='REPLACE_WITH_APPROVED_PRIVATE_BUCKET'
```

Confirm the checked-out revision and the exact account and database again.
Use the existing installation `secret` command to create the stable Worker's initial `AUTH_SECRET` through private stdin:

```sh
npm run cloudflare:install -- secret --config="$MINSKY_DEV_CLOUDFLARE_CONFIG" --account=458ad6a930b0fb717796dfa19ca6a2b1 --database="$MINSKY_DEV_DATABASE_ID"
```

The stable assets Worker already exists. This command refuses to rotate an existing authentication secret.
If the secret exists, stop and reconcile its ownership and recovery plan instead of deleting it.
Review target metadata and perform a dry run with a Cloudflare build before publishing:

```sh
VITE_BACKEND=cloudflare npm run build
WRANGLER_WRITE_LOGS=false WRANGLER_LOG_SANITIZE=true npx wrangler deploy --config="$MINSKY_DEV_CLOUDFLARE_CONFIG" --dry-run
```

Set these GitHub repository variables to the approved values:

```sh
gh variable set MINSKY_DEV_BACKEND --body cloudflare
gh variable set MINSKY_DEV_CLOUDFLARE_CONFIG --body "$MINSKY_DEV_CLOUDFLARE_CONFIG"
gh variable set MINSKY_DEV_DATABASE_ID --body "$MINSKY_DEV_DATABASE_ID"
gh variable set MINSKY_DEV_DATABASE_NAME --body "$MINSKY_DEV_DATABASE_NAME"
gh variable set MINSKY_DEV_BUCKET_NAME --body "$MINSKY_DEV_BUCKET_NAME"
gh variable set CLOUDFLARE_DEPLOY_ENABLED --body true
```

The deployment token must already be stored privately as `CLOUDFLARE_API_TOKEN`.
Confirm its required account permissions in [deployment settings](cloudflare-build-settings.md).
Do not pass a token as a command argument or add it to a `VITE_` setting.
Rerun the latest approved `main` push's **Checks** run.
Do not rerun an older revision. The deployment script checks the current branch head before upload.
The app deployment builds with `VITE_BACKEND=cloudflare` and publishes the complete Worker.
It does not run migrations, bootstrap accounts, or rotate secrets.

## Verify activation and later deployment

Require all of these results:

1. `/minsky-revision.json` reports the approved revision, Cloudflare backend, D1 UUID, bucket name, and origin. `/minsky-build.json` also records the configuration path.
2. Anonymous `/api/sessions` returns `401` with `Cache-Control: no-store`. Private source paths return `404`.
3. The new owner can sign in. Its temporary-password change and recovery gates hold. Supabase credentials do not grant access.
4. The fictional application journey passes at the stable URL, including public/internal separation, jury decisions, private images, and reconnects.
5. Live metadata contains the approved D1 and R2 bindings, Durable Object class, `AUTH_ORIGIN`, cron, and CPU cap. `AUTH_SECRET` is present by name.
6. Docs remain available independently.
7. A subsequent approved automated deployment retains Cloudflare mode and those exact bindings, then passes the same smoke checks.

Record the code revision, Worker versions, protected run URLs, CLI checks, and remaining manual checks.
Disable the candidate's public routes and cron as approved. Confirm the stable application still receives live updates.
Only then mark activation complete.

## Recover a failed activation

Pause publishing with `CLOUDFLARE_DEPLOY_ENABLED=false`. Cancel running publish jobs separately.
Retain D1, R2, private owner results, journals, and all newly written Cloudflare records.
Redeploy the recorded compatible complete Worker revision with the same reviewed bindings and Cloudflare frontend.
Do not apply down migrations or rerun bootstrap to repair an installed application.
Follow the installation procedure for owner recovery.

If a return to Supabase is necessary, obtain approval for a concrete recovery plan.
Cloudflare records do not appear in Supabase. Retain the Cloudflare installation for repair.
The guarded deployment command refuses an assets-only overwrite of a complete Worker.
An operator must plan any intentional reversal separately and verify both provider state and user access.
