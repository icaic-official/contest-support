# Run checks on Workers Builds

This page is for maintainers of this project's own Cloudflare resources.
Its procedures need access to the maintainers' Cloudflare account. `<account-id>` means the `account_id` value in `wrangler.jsonc`.

An outside contributor needs only this summary:

- Run `npm run ci` yourself. A pull request from a fork starts no build, because it pushes no branch to this repository.
- `npm run ci` uses no Cloudflare credentials. It runs no browser suite and no hosted suite.
- `npm run ci` needs a network connection. Its last step, the Gitleaks scan, supports only Linux x64. On another platform the command fails at that step, after the other checks have run.

Use [deployment settings](cloudflare-build-settings.md) for commands, limits, and checks that stay on demand.

## Build and publication flow

Four Workers build from this repository. Each Worker has its own Workers Builds trigger.
Each build reports a GitHub check named `Workers Builds: <worker>`.

| Worker | Branches it builds | Build command | Deploy command | Result |
| --- | --- | --- | --- | --- |
| `minsky-ci` | All branches, including `main` | `npm run ci` | `npm run ci:worker` | A check only. It publishes nothing. |
| `minsky-preview` | `main` only, which does not publish. Builds for other branches are switched off. See [Publish branch previews](#publish-branch-previews). | `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY npm ci` | `npm run deploy` | Publishes nothing while branch builds are off. |
| `minsky-docs` | All branches | `npm ci --prefix site && npm run docs:build` | `npx wrangler deploy --config wrangler.docs.jsonc` on `main`, `npx wrangler versions upload --config wrangler.docs.jsonc` on other branches | Publishes the docs from `main`. Uploads a docs preview version for other branches. |
| `minsky-dev` | `main` only | `npm run ci` | `npm run deploy` | Publishes `main` to `https://minsky-dev.icaic-minsky.workers.dev` with development data. |

### When you push a branch

1. `minsky-ci` runs the checks.
2. `minsky-preview` does not build, because branch previews are switched off.
3. `minsky-docs` uploads a docs preview version. That version receives no traffic.
4. `minsky-dev` does not build.

### When a pull request merges into `main`

1. `minsky-ci` checks `main`.
2. `minsky-dev` runs the checks again. It then applies new migrations to `minsky-development` and publishes `main`.
3. `minsky-docs` publishes the docs.
4. `minsky-preview` installs the dependencies for `main`, but it does not publish.

A failed check stops its build. The deploy command does not run, and the Worker keeps its previous version.
On `minsky-preview`, only a failed app build or a failed target check stops publication.

## Connect one CI Worker

Create a Worker named `minsky-ci` if it does not exist.
Do not reuse `minsky-dev` or `minsky-docs`.

Set the deploy command before the first build.
The default command is `npx wrangler deploy`.
That command reads `wrangler.jsonc` and would publish `minsky-dev`.

1. In the Cloudflare dashboard, go to **Workers & Pages**.
2. Create a Worker named `minsky-ci`, or open that Worker if it already exists.
3. Go to **Settings > Build**.
4. Connect GitHub repository `GiftedNovaHD/minsky`.
5. Set the production branch to `main`.
6. Open **Settings > Build > Branch control** and enable preview builds.
   Preview builds make pushes to branches other than `main` run the same checks.
7. Set the build command to `npm run ci`.
8. Replace the deploy command and the preview command with `npm run ci:worker` before you save.
   Both commands run `wrangler versions upload --config wrangler.ci.jsonc --dry-run`.
   The dry run does not upload a version and does not send traffic.
   It does not read `wrangler.jsonc`.
9. Leave the root directory empty so the commands run at the repository root.
10. Add these build variables to both `minsky-ci` triggers, under **Settings > Build > Build variables and secrets**:
    - `SKIP_DEPENDENCY_INSTALL` with value `1`. The check script installs the root and `site` lockfiles itself.
    - `NODE_VERSION` with value `22.23.4`.
11. Do not add `CLOUDFLARE_API_TOKEN` or `AUTH_SECRET` to this Worker.
    Ordinary checks do not use those values.
12. Leave **Settings > Build > Build watch paths** at the default, which includes every file.

The `minsky-dev`, `minsky-preview`, and `minsky-docs` triggers pin the same `NODE_VERSION`.
`.nvmrc` contains `22` and stays for local tools.
See [the build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) and [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Confirm the first build

Push a commit to a branch other than `main`.
Then confirm all of the following:

- The commit shows a Workers Builds check. Copy that check's name from the commit.
- The build log runs `npm run ci` and exits zero.
- The next log step runs `npm run ci:worker` and says it did not upload.
- The log does not deploy `minsky-dev` or `minsky-docs`.
- `https://minsky-dev.icaic-minsky.workers.dev/minsky-revision.json` is unchanged.

GitHub may also show a pull request comment from Cloudflare.
That comment is the build status. It is not an application preview URL.

A failed `npm run ci` stops the build before `npm run ci:worker`.
Fix the reported command and push again. Do not retry by deploying the application.

## Publish the docs

The `minsky-docs` Worker has two Workers Builds triggers. Both use the repository connection and build token of `minsky-ci`.
The exact settings are in [deployment settings](cloudflare-build-settings.md#docs-workers-builds).

- A push to `main` builds the site and runs `npx wrangler deploy --config wrangler.docs.jsonc`. The new version serves `https://minsky-docs.icaic-minsky.workers.dev`.
- A push to any other branch builds the site and runs `npx wrangler versions upload --config wrangler.docs.jsonc`. The preview version does not receive traffic. The build log shows its preview URL. The docs contain no application data, so they use Cloudflare preview URLs.

The docs build does not wait for the `minsky-ci` checks. A docs build failure does not change the published version.
To publish again without a new push, start a build of `main` from **Workers & Pages > minsky-docs > Deployments**.
If Workers Builds is not available, run `npm ci && npm ci --prefix site && npm run docs:deploy` from an updated `main` with a Wrangler login for account `<account-id>`.

To recreate the triggers, open **Workers & Pages > minsky-docs > Settings > Build**:

1. Connect GitHub repository `GiftedNovaHD/minsky`. Set the production branch to `main`.
2. Set the build command to `npm ci --prefix site && npm run docs:build`.
3. Set the deploy command to `npx wrangler deploy --config wrangler.docs.jsonc`.
4. Enable preview builds. Set the preview command to `npx wrangler versions upload --config wrangler.docs.jsonc`.
5. Leave the root directory empty. Keep the default dependency install. It installs the root lockfile, which provides Wrangler.
6. Add build variable `NODE_VERSION` with value `22.23.4` to both triggers.
7. Do not add application secrets. The docs build does not use them.

## Publish the application

One `minsky-dev` build runs the checks, applies new D1 migrations, and publishes the complete Worker.
A failed step stops the build. Later steps do not run.
`minsky-dev` is a development installation. It is not production.

The deploy command is `npm run deploy`. It runs these steps in order:

1. Build the Cloudflare application.
2. Stop if the build's commit is no longer the head of `main`. A newer push then owns the publication.
3. Stop if a D1 migration removes or renames schema. See [Change the D1 schema](#change-the-d1-schema).
4. Confirm the account, the D1 database, the private R2 bucket, and the `AUTH_SECRET` name.
5. Record the D1 Time Travel restore point. The build log prints it with the exact restore command. Stop if it cannot be read.
6. Apply new D1 migrations with `wrangler d1 migrations apply minsky-development --remote`.
7. Stop if the applied migrations differ from the checkout. An older build stops here after a newer build has migrated.
8. Publish the complete Worker with `wrangler deploy`.
9. Read `minsky-revision.json` and the live bindings. Confirm that an anonymous `/api/auth/session` request returns `401`.

[Deployment settings](cloudflare-build-settings.md#publication-checks) describe each check.

### Prepare the deployment token

The automatic Workers Builds token cannot read D1. The migration step and the target check fail with that token.
Create a user API token for account `<account-id>` with these permissions:

- **Account > Workers Scripts > Edit**
- **Account > D1 > Edit**
- **Account > Workers R2 Storage > Read**
- **Account > Account Settings > Read**
- **User > User Details > Read**
- **User > Memberships > Read**

Limit the token to that account. Do not add other accounts or zones.

### Connect the Worker

1. In the Cloudflare dashboard, open **Workers & Pages > minsky-dev > Settings > Build**.
2. Connect GitHub repository `GiftedNovaHD/minsky`.
3. Set the production branch to `main`.
4. Open **Branch control**. Disable builds for branches other than `main`.
   `minsky-ci` already checks those branches. A `minsky-dev` build runs only to publish.
5. Set the build command to `npm run ci`.
6. Set the deploy command to `npm run deploy`.
7. Leave the root directory empty.
8. Under **API token**, select the token from [Prepare the deployment token](#prepare-the-deployment-token).
9. Add these build variables:

   | Name | Value |
   | --- | --- |
   | `SKIP_DEPENDENCY_INSTALL` | `1` |
   | `NODE_VERSION` | `22.23.4` |
   | `CLOUDFLARE_ACCOUNT_ID` | `<account-id>` |
   | `VITE_ENVIRONMENT` | `development` |
   | `MINSKY_DEV_CLOUDFLARE_CONFIG` | `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc` |
   | `MINSKY_DEV_DATABASE_ID` | `a1832f97-4d4c-45c2-a848-8d3dfd0b74f5` |
   | `MINSKY_DEV_DATABASE_NAME` | `minsky-development` |
   | `MINSKY_DEV_BUCKET_NAME` | `minsky-development-images` |

   The deploy script compares the last four values with the committed configuration.
   A pull request that changes the configuration to another database or bucket fails until you also change these values.
10. Do not add `MINSKY_DEV_BACKEND`. The script always publishes the Cloudflare app.
11. Do not add `AUTH_SECRET`. That secret stays on the Worker and is never a build input.
12. Leave **Build watch paths** at the default, which includes every file.

Workers Builds supplies `WORKERS_CI_BRANCH` and `WORKERS_CI_COMMIT_SHA`. The deploy script reads them.
If the first build stops with `Missing CLOUDFLARE_API_TOKEN.`, add the same token as build secret `CLOUDFLARE_API_TOKEN`.
`npm run ci` removes `CLOUDFLARE_API_TOKEN` before it installs packages or runs checks.

### Confirm the first publication

Start a build of `main` from **Workers & Pages > minsky-dev > Deployments**, or merge a pull request.
Then confirm all of the following:

- The build log runs `npm run ci` and exits zero.
- The deploy log prints `Published minsky-dev at https://minsky-dev.icaic-minsky.workers.dev` and `The revision and deployment checks passed for minsky-dev.`
- `https://minsky-dev.icaic-minsky.workers.dev/minsky-revision.json` shows the commit of `main` and `"backend":"cloudflare"`.
- The footer of every screen shows `Build` and the first seven characters of that commit. Hover over it to see the full hash.

The first build applies every migration that `minsky-development` does not have yet.

### Pause publication

Pause publication during a live contest. A merge then does not change the application for volunteers.

1. Open **Workers & Pages > minsky-dev > Settings > Build**.
2. Disconnect the repository, or disable the `main` trigger.
3. Connect it again after the contest. The next push to `main` publishes.

### Recover from a failed or bad publication

Find the case that matches the failure:

- If `npm run ci` fails, nothing is published. Fix the check and merge again.
- If the build stops before `wrangler deploy`, the previous Worker keeps serving. Read the fixed error message. Provider output is withheld on purpose.
- If the message says that the migration outcome is unknown, compare `SELECT name FROM d1_migrations` with `src/server/adapters/d1/migrations` before you retry.
- If a published version is bad, roll back the Worker with `npx wrangler rollback --config src/server/adapters/cloudflare/deploy/development.wrangler.jsonc`. Write migrations that only add tables, columns, or indexes, so that the earlier Worker still runs against the newer schema. Do not roll back to a version that has only static assets.
- If a migration damaged data, find `Restore point before migrations:` in the deploy log. Run the `npx wrangler d1 time-travel restore` command on that line. It returns `minsky-development` to its state before the migration and discards later writes. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

These rules apply to every repair of `minsky-dev`:

- Do not start another publication until you know the state of the failed one.
- Keep new D1 records and R2 objects, unless you restore a bookmark as the last case describes. Do not apply down migrations. Do not run `bootstrap` again.
- Keep the existing `AUTH_SECRET` on the Worker. Do not create or rotate it to repair a publication.
- If Worker `minsky-development-candidate` still exists, keep its URLs and its cron disabled. It uses the same database with a different live-update namespace. Its dispatcher could mark a notification delivered without notifying `minsky-dev` clients. Disabling its URLs does not stop the cron. Cron removal can take 15 minutes to propagate, and a running invocation can last 15 more. Wait 30 minutes after you remove the cron, and require zero pending notification records, before you publish.
- Before you resume publication, check sign-in, workflows, images, and live updates on `minsky-dev`. The deploy checks do not cover them.

### Read the Worker logs

Workers Logs is on for `minsky-dev`. The `observability` setting in `development.wrangler.jsonc` controls it.
The Worker writes one JSON object for each failure. It does not log a successful request.

To read the logs in the dashboard:

1. Open **Workers & Pages > minsky-dev > Logs**.
2. Filter on `level = error`, or on one `event` value from the table.

To watch live from a terminal, run `npx wrangler tail minsky-dev --format json`.

| Event | Meaning |
| --- | --- |
| `worker.unhandled_error` | A request to `/api` failed. The client got a 503. |
| `http.unhandled_error` | An application route failed. The client got a 503. |
| `authentication.unhandled_error` | Sign-in or account handling failed. The client got a 503. |
| `live.coordinator_error` | The live-update Durable Object failed a request. |
| `live.alarm_error` | The Durable Object alarm failed. |
| `live.notify_error`, `live.notify_rejected` | One live notification was not delivered. The cron job retries it. |
| `notifications.delivery_failed` | A delivery pass left notifications undelivered. |
| `scheduled.task_failed` | One task of the every-minute cron job failed. The `task` field names it. This includes the image, announcement image, and avatar recovery steps. |
| `scheduled.failed` | The cron job had at least one failed task. |

Each event has `level` and `event`. It can also have `route`, `method`, `requestId`, `status`, `task`, counts, `errorName`, and `errorCode`.
`requestId` is the `cf-ray` value of the request.
The logs never contain passwords, cookies, tokens, IP addresses, request bodies, image data, message text, or error messages.
A migration failure is not a Worker log. It appears in the Workers Builds log of the failed build.

### Change the D1 schema

Every merge to `main` applies its new D1 migrations automatically. A Worker rollback then runs the earlier code against the newer schema.
So a migration may only add tables, columns, indexes, triggers, or views.
It may also drop a trigger, index, or view and create it again with the same name in the same file.

`npm test` runs this check on every migration in `src/server/adapters/d1/migrations`. The deploy runs it again before it changes anything.
It fails on `DROP TABLE`, `DROP COLUMN`, `RENAME`, and a dropped trigger, index, or view that the file does not create again.
It does not check data changes such as `UPDATE` or `DELETE`.

To ship a migration that removes or renames schema:

1. Pause publication, as [Pause publication](#pause-publication) describes.
2. Add the file name and the reason to `reviewedDestructiveMigrations` in `src/server/adapters/cloudflare/tooling/migrations.mjs`, in the same pull request.
3. After the merge, apply the migration and publish by hand. Record the restore point first.
4. Reconnect the trigger.

To publish by hand, run `npm run deploy` from an updated `main` with the same variables, a token with the same permissions, `WORKERS_CI_BRANCH=main`, and `WORKERS_CI_COMMIT_SHA` set to the output of `git rev-parse HEAD`.

The script guards the complete Worker:

- The app needs its API code, D1 database, private R2 bucket, and live coordinator. The script has no assets-only upload path that could remove them.
- It validates the generated configuration and exact hosted targets before upload. After upload, it checks the published targets, live bindings, and an anonymous rejection at the authentication API.
- On `minsky-dev`, it publishes the app only from `main`. On `minsky-preview`, it publishes every other branch that the trigger builds.

These checks do not verify authenticated behavior. [Run the shared provider tests](run-provider-tests.md) covers that behavior on the isolated CI target.
A broken application target cannot block the docs, because Workers Builds publishes them separately.

## Publish branch previews

Branch previews are switched off. `minsky-preview` keeps serving its last preview, and a push to `main` builds on this Worker and publishes nothing.
A preview runs branch code that nobody has reviewed. It must not reach the data of `minsky-dev`.

Turn branch builds on again only when one of these conditions is true:

- The trigger can use a token that reaches only the preview Worker, database `minsky-preview`, and bucket `minsky-preview-images`. See [Prepare the preview token](#prepare-the-preview-token).
- The preview resources move to a separate Cloudflare account, so that its token can reach nothing else.

To turn them on, prepare the token, connect the Worker, and confirm the first preview, as the sections below describe.
Each push to a branch other than `main` then publishes that branch to `https://minsky-preview.icaic-minsky.workers.dev`.

### Prepare the preview token

On 2026-10-24 the trigger's **API token** field accepted only tokens that Workers Builds creates. Such a token can publish every Worker and change every R2 bucket, and the form could not limit D1 to one database.
Check the field again before you continue.

The `minsky-preview` Worker must exist before you can limit a token to it. It has `AUTH_SECRET` and a test admin account.

A branch can change the checks in `scripts/deploy-workers.mjs` and `scripts/ci.mjs`. So only the token's permissions keep branch code away from development data.

Create an account API token in **Manage Account > Account API Tokens > Create token > Custom token**:

- **Workers**: **Editor**. Set the scope to **Specified Workers** and select only `minsky-preview`.
- **D1**: **Edit**. Select only database `minsky-preview`.
- **Workers R2 Storage**: **Read**. Select only bucket `minsky-preview-images`.
- **Account Settings**: **Read**.

Do not use the `minsky-dev` token.
If the form cannot limit D1 to `minsky-preview` and R2 to `minsky-preview-images`, do not create the token and do not connect the trigger.
If the connected token is wider than this, disconnect the trigger or replace the token. A wider token lets any branch read or change `minsky-development` through the API.

### Connect the preview Worker

1. Open **Workers & Pages > minsky-preview > Settings > Build**.
2. Connect GitHub repository `GiftedNovaHD/minsky`.
3. Set the production branch to `main`. Enable builds for non-production branches only after you select a token that meets [Prepare the preview token](#prepare-the-preview-token).
   Exclude branches that match `dependabot/*`. Dependabot branches install package updates that nobody has reviewed. `minsky-ci` still checks them.
4. Set the build command to `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY npm ci`. It removes the token first, so package install scripts run without it.
5. Set the deploy command and the non-production branch deploy command to `npm run deploy`.
6. Leave the root directory empty.
7. Under **API token**, select the token from [Prepare the preview token](#prepare-the-preview-token).
8. Add these build variables:

   | Name | Value |
   | --- | --- |
   | `SKIP_DEPENDENCY_INSTALL` | `1` |
   | `NODE_VERSION` | `22.23.4` |
   | `CLOUDFLARE_ACCOUNT_ID` | `<account-id>` |
   | `VITE_ENVIRONMENT` | `preview` |
   | `MINSKY_PREVIEW_DATABASE_ID` | `3189b257-13f9-4e73-9bd1-bf211c7cbb25` |

9. Do not add any `MINSKY_DEV_*` variable. The deploy script stops when it finds one.
10. Do not add `AUTH_SECRET`. That secret stays on the Worker.

Optionally, protect `minsky-preview.icaic-minsky.workers.dev` with [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). The preview is public without it.

### Know how a preview differs from `minsky-dev`

With `VITE_ENVIRONMENT=preview` on a branch, `npm run deploy` runs the steps in [Publish the application](#publish-the-application) against `minsky-preview`, with these differences:

- It stops if any `MINSKY_DEV_*` variable is set.
- It stops unless `src/server/adapters/cloudflare/deploy/preview.wrangler.jsonc` names Worker `minsky-preview` and its origin, a database and a bucket whose names start with `minsky-preview`, and the database ID in `MINSKY_PREVIEW_DATABASE_ID`.
- It stops if the database lacks a migration from the checkout. It accepts migrations that other branches applied, because every migration only adds schema.
- It reads the revision that the preview serves before it publishes.

`npm run cloudflare:install -- configure` generates that configuration from `preview.settings.json` in the same directory.

The build that finishes last replaces the preview. When two branches build at the same time, an older push can replace a newer one.
If another build replaces the preview while a build verifies it, that build reports `Another build replaced minsky-preview after this upload.` and passes. The newer build verifies its own deployment.
The preview does not wait for the checks, so it can show code that fails them. Check `Workers Builds: minsky-ci` for the same commit.

### Confirm the first preview

Push a branch other than `main`. Then confirm all of the following:

- The `minsky-preview` build log prints `Target: shared preview Worker` and `The revision and deployment checks passed for minsky-preview.`
- `https://minsky-preview.icaic-minsky.workers.dev/minsky-revision.json` shows the pushed commit and database `3189b257-13f9-4e73-9bd1-bf211c7cbb25`.
- `https://minsky-dev.icaic-minsky.workers.dev/minsky-revision.json` still shows the commit of `main`.

Sign in with the preview test account. Its credentials are in a private file outside Git, not in this repository.

### Reset the preview data

All branches share `minsky-preview`. A branch can apply a migration that another branch does not have, and the database keeps that schema after the branch is merged, renamed, or deleted.
The other branch's build still publishes, because its code runs against the added schema.

A build stops at the migration comparison only when the database still lacks a migration from its checkout after the apply step. Inspect the applied migrations before you build again.
The comparison checks names only. If you change a migration after a build applied it, the preview keeps the old version. Add a new migration instead, or reset the preview data.

To reset the preview data, find `Restore point before migrations:` in an earlier `minsky-preview` build log.
Run the `npx wrangler d1 time-travel restore minsky-preview` command from that line. Then build the branch again.
The reset discards all preview data written after that point, including test accounts created after it.

## Checks that stay on demand

Browser tests need Chromium libraries that the [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) does not install.
Hosted Cloudflare suites change isolated CI resources, and a store suite can run longer than the 20 minute build limit.
Run those commands by hand when the change needs them.
The exact commands are in [deployment settings](cloudflare-build-settings.md#on-demand-checks).
