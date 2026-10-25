# Run checks on Workers Builds

Use this guide to see which Workers Builds triggers run on each push and to connect them.
Use [deployment settings](cloudflare-build-settings.md) for commands, limits, and checks that stay on demand.
Use [activation](activate-cloudflare-development.md) for the separate development-installation approval.

## Build and publication flow

Four Workers build from this repository. Each Worker has its own Workers Builds trigger.
Each build reports a commit status named `Workers Builds: <worker>`.

| Worker | Branches it builds | Build command | Deploy command | Result |
| --- | --- | --- | --- | --- |
| `minsky-ci` | All branches, including `main` | `npm run ci` | `npm run ci:worker` | A check only. It publishes nothing. |
| `minsky-preview` | `main` only, which does not publish. Builds for other branches are switched off. See [Publish branch previews](#publish-branch-previews). | `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY npm ci` | `npm run deploy` | Publishes nothing while branch builds are off. When they are on, publishes the branch to `https://minsky-preview.icaic-minsky.workers.dev` with test data. |
| `minsky-docs` | All branches | `npm ci --prefix site && npm run docs:build` | `npx wrangler deploy` on `main`, `npx wrangler versions upload` on other branches | Publishes the docs from `main`. Uploads a docs preview version for other branches. |
| `minsky-dev` | `main` only | `npm run ci` | `npm run deploy` | Publishes `main` to `https://minsky-dev.icaic-minsky.workers.dev` with development data. |

### When you push a branch

1. `minsky-ci` runs the checks.
2. `minsky-preview` does not build, because branch previews are switched off. See [Publish branch previews](#publish-branch-previews).
3. `minsky-docs` uploads a docs preview version. That version receives no traffic.
4. `minsky-dev` does not build.

### When a pull request merges into `main`

1. `minsky-ci` checks `main`.
2. `minsky-dev` runs the checks again. It then applies new migrations to `minsky-development` and publishes `main`.
3. `minsky-docs` publishes the docs.
4. `minsky-preview` installs the dependencies for `main`, but it does not publish.

A failed check stops its build. The deploy command does not run, and the Worker keeps its previous version.
On `minsky-preview`, only a failed app build or a failed target check stops publication.
A pull request from a fork starts no builds, because it pushes no branch to this repository.
GitHub Actions runs no checks or publication. The GitHub account stays on the free plan.

The sections below give the dashboard steps for each trigger.

## How app previews stay separate

A preview runs branch code that nobody has reviewed yet. It must not change the data of `minsky-dev`.
So app previews use a separate Worker, `minsky-preview`, with its own resources and token:

- D1 database `minsky-preview` and private bucket `minsky-preview-images`. They hold only test data.
- A build token that cannot publish `minsky-dev` and reaches only the preview database and bucket. Workers Builds cannot use such a token yet, so branch previews are switched off.
- `minsky-dev` builds only `main`. Its token never runs branch code.

Cloudflare preview URLs stay disabled on both Workers. Cloudflare does not create them for Workers that use a Durable Object.
Docs previews use Cloudflare preview URLs. They are safe because the docs contain no application data.

## Connect one CI Worker

You need access to Cloudflare account `458ad6a930b0fb717796dfa19ca6a2b1`.
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
10. Add build variable `SKIP_DEPENDENCY_INSTALL` with value `1`.
    The check script installs the root and `site` lockfiles itself.
    Build variables are under **Settings > Build > Build variables and secrets**.
11. Do not add `CLOUDFLARE_API_TOKEN`, Supabase keys, or `AUTH_SECRET` to this Worker.
    Ordinary checks do not use those values.
12. Leave **Settings > Build > Build watch paths** at the default, which includes every file.

Both `minsky-ci` triggers pin the build variable `NODE_VERSION` to `22.23.2`.
That value is set in Cloudflare, and a read-back confirmed it.
`.nvmrc` contains `22` and stays for local tools.
See [the build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) and [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Confirm the first build

Push a commit to a branch other than `main`.
Then confirm all of the following:

- The commit shows a Workers Builds check. Copy that check's name from the commit status.
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
- A push to any other branch builds the site and runs `npx wrangler versions upload --config wrangler.docs.jsonc`. The preview version does not receive traffic. The build log shows its preview URL.

The docs build does not wait for the `minsky-ci` checks. A docs build failure does not change the published version.
To publish again without a new push, start a build of `main` from **Workers & Pages > minsky-docs > Deployments**.
If Workers Builds is not available, run `npm ci && npm ci --prefix site && npm run docs:deploy` from an updated `main` with a Wrangler login for account `458ad6a930b0fb717796dfa19ca6a2b1`.

To recreate the triggers, open **Workers & Pages > minsky-docs > Settings > Build**:

1. Connect GitHub repository `GiftedNovaHD/minsky`. Set the production branch to `main`.
2. Set the build command to `npm ci --prefix site && npm run docs:build`.
3. Set the deploy command to `npx wrangler deploy --config wrangler.docs.jsonc`.
4. Enable preview builds. Set the preview command to `npx wrangler versions upload --config wrangler.docs.jsonc`.
5. Leave the root directory empty. Keep the default dependency install. It installs the root lockfile, which provides Wrangler.
6. Add build variable `NODE_VERSION` with value `22.23.2` to both triggers.
7. Do not add application secrets. The docs build does not use them.

## Publish the application

On 2026-10-24 the owner chose automatic publication of `main` to `minsky-dev`.
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
Create a user API token for account `458ad6a930b0fb717796dfa19ca6a2b1` with these permissions:

- **Account > Workers Scripts > Edit**
- **Account > D1 > Edit**
- **Account > Workers R2 Storage > Read**
- **Account > Account Settings > Read**
- **User > User Details > Read**
- **User > Memberships > Read**

Limit the token to that account. Do not add other accounts or zones.

### Connect the Worker

You need access to Cloudflare account `458ad6a930b0fb717796dfa19ca6a2b1`.

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
   | `NODE_VERSION` | `22.23.2` |
   | `CLOUDFLARE_ACCOUNT_ID` | `458ad6a930b0fb717796dfa19ca6a2b1` |
   | `VITE_ENVIRONMENT` | `development` |
   | `MINSKY_DEV_CLOUDFLARE_CONFIG` | `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc` |
   | `MINSKY_DEV_DATABASE_ID` | `a1832f97-4d4c-45c2-a848-8d3dfd0b74f5` |
   | `MINSKY_DEV_DATABASE_NAME` | `minsky-development` |
   | `MINSKY_DEV_BUCKET_NAME` | `minsky-development-images` |

   The deploy script compares the last four values with the committed configuration.
   A pull request that changes the configuration to another database or bucket fails until you also change these values.
10. Do not add `MINSKY_DEV_BACKEND` or Supabase variables. The script always publishes the Cloudflare app.
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

- If `npm run ci` fails, nothing is published. Fix the check and merge again.
- If the build stops before `wrangler deploy`, the previous Worker keeps serving. Read the fixed error message. Provider output is withheld on purpose.
- If the message says that the migration outcome is unknown, compare `SELECT name FROM d1_migrations` with `src/server/adapters/d1/migrations` before you retry.
- If a published version is bad, roll back the Worker with `npx wrangler rollback --config src/server/adapters/cloudflare/deploy/development.wrangler.jsonc`. Write migrations that only add tables, columns, or indexes, so that the earlier Worker still runs against the newer schema.
- If a migration damaged data, find `Restore point before migrations:` in the deploy log. Run the `npx wrangler d1 time-travel restore` command on that line. It returns `minsky-development` to its state before the migration and discards later writes. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

### Read the Worker logs

Workers Logs is on for `minsky-dev`. The next publication applies this setting.
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
2. Add the file name and the reason to `reviewedDestructiveMigrations` in `src/server/adapters/cloudflare/tooling/migrations.mjs`, in the same PR.
3. After the merge, apply the migration and publish by hand. Record the restore point first.
4. Reconnect the trigger.

To publish by hand, run `npm run deploy` from an updated `main` with the same variables, a token with the same permissions, `WORKERS_CI_BRANCH=main`, and `WORKERS_CI_COMMIT_SHA` set to the output of `git rev-parse HEAD`.

The script sets `VITE_BACKEND=cloudflare` and guards the complete Worker:

- The app needs its API code, D1 database, private R2 bucket, and live coordinator. The script has no assets-only upload path that could remove them.
- It validates the generated configuration and exact hosted targets before upload. After upload, it checks the published targets, live bindings, and an anonymous rejection at the authentication API.
- On `minsky-dev`, it publishes the app only from `main`. On `minsky-preview`, it publishes every other branch that the trigger builds. See [Publish branch previews](#publish-branch-previews).

These checks do not verify authenticated behavior. The installation and activation procedures require the full application checks.
A broken application target cannot block the docs, because Workers Builds publishes them separately.

## Publish branch previews

The owner chose one shared preview on 2026-10-24 and connected the `minsky-preview` trigger. Its first preview was `9c70247`.

**Branch previews are switched off.** On 2026-10-24 the owner turned off builds for non-production branches on `minsky-preview`.
The trigger's **API token** field offers only tokens that Workers Builds creates itself.
Such a token can publish every Worker, including `minsky-dev`, and can change every R2 bucket. The preview also needs D1 Edit, and the form could not limit it to one database.
Branch code runs with that token, and it can change the deploy checks. So any branch could reach `minsky-dev` and its data.
The Worker keeps serving its last preview, `980653e`. A push to `main` still builds on this Worker and publishes nothing.

Turn branch builds on again only when one of these is true:

- The trigger can use a token that reaches only the preview Worker, database `minsky-preview`, and bucket `minsky-preview-images`. See [Prepare the preview token](#prepare-the-preview-token).
- The preview resources move to a separate Cloudflare account, so that its token can reach nothing else.

The rest of this section describes the preview when branch builds are on.

Each push to a branch other than `main` publishes that branch to `https://minsky-preview.icaic-minsky.workers.dev`.
A push to `main` builds on this Worker too, but it does not publish. `minsky-dev` publishes `main`.

The build that finishes last replaces the preview. When two branches build at the same time, an older push can therefore replace a newer one.
If another build replaces the preview while a build verifies it, that build reports `Another build replaced minsky-preview after this upload.` and passes. The newer build verifies its own deployment.

The build command only installs dependencies. It removes the token first, so package install scripts run without it.
The preview does not wait for the checks, so it can show code that fails them. Check the `Workers Builds: minsky-ci` status for the same commit.

The deploy command is `npm run deploy`, the same as on `minsky-dev`.
With `VITE_ENVIRONMENT=preview` on a branch, it runs the steps in [Publish the application](#publish-the-application) against `minsky-preview`.
The build step (`deploy-workers.mjs --build`) runs steps 1 to 3. The upload step runs steps 1 and 2 again, then steps 4 to 8:

1. Stop if any `MINSKY_DEV_*` variable is set. Those variables belong to the `minsky-dev` build.
2. Stop unless the committed configuration names Worker `minsky-preview`, database `minsky-preview`, bucket `minsky-preview-images`, and the database ID in `MINSKY_PREVIEW_DATABASE_ID`.
3. Build the Cloudflare application for the preview origin.
4. Stop if the build's commit is no longer the head of its branch.
5. Confirm the account, the database, the private bucket, and the `AUTH_SECRET` name. Record a restore point.
6. Apply new migrations to `minsky-preview`. Stop if the database lacks a migration from the checkout.
   Migrations that other branches applied are accepted, because every migration only adds schema.
7. Record the revision that the preview serves now.
8. Publish the Worker `minsky-preview` with `wrangler deploy`. Verify its revision, bindings, and an anonymous `401`.

The configuration is `src/server/adapters/cloudflare/deploy/preview.wrangler.jsonc`.
`npm run cloudflare:install -- configure` generated it from `preview.settings.json` in the same directory.

### Prepare the preview token

The `minsky-preview` Worker must exist before you can limit a token to it.
It exists since 2026-10-24, with `AUTH_SECRET`, all migrations, and a test admin account.
Until its first build, it served a placeholder that returned `503`. A local `wrangler deploy` through an authenticating proxy cannot upload static assets, so the first full publication runs in Workers Builds.
Every branch that the trigger builds runs its own code with this token. That includes code that nobody has reviewed, Dependabot updates, and the npm packages that they install.
The checks in `scripts/deploy-workers.mjs` and `scripts/ci.mjs` are branch code too. A branch can change them. So only the token's permissions keep branch code away from development data.

Create an account API token in **Manage Account > Account API Tokens > Create token > Custom token**:

- **Workers**: **Editor**. Set the scope to **Specified Workers** and select only `minsky-preview`.
- **D1**: **Edit**. Select only database `minsky-preview`.
- **Workers R2 Storage**: **Read**. Select only bucket `minsky-preview-images`.
- **Account Settings**: **Read**.

Do not use the `minsky-dev` token.
If the form cannot limit D1 to `minsky-preview` and R2 to `minsky-preview-images`, do not create the token and do not connect the trigger.
On 2026-10-24 the trigger accepted only tokens that Workers Builds creates. Those tokens cannot be limited this way.
If the connected token is wider than this, disconnect the trigger or replace the token.
A wider token lets any branch read or change `minsky-development` through the API.
In that case, the preview needs its own Cloudflare account. That is an account decision for the owner.

### Connect the preview Worker

1. Open **Workers & Pages > minsky-preview > Settings > Build**.
2. Connect GitHub repository `GiftedNovaHD/minsky`.
3. Set the production branch to `main`. Enable builds for non-production branches only after you select a token that meets [Prepare the preview token](#prepare-the-preview-token).
   Exclude branches that match `dependabot/*`. Dependabot branches install package updates that nobody has reviewed. `minsky-ci` still checks them.
4. Set the build command to `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY npm ci`.
5. Set the deploy command and the non-production branch deploy command to `npm run deploy`.
6. Leave the root directory empty.
7. Under **API token**, select the token from [Prepare the preview token](#prepare-the-preview-token).
8. Add these build variables:

   | Name | Value |
   | --- | --- |
   | `SKIP_DEPENDENCY_INSTALL` | `1` |
   | `NODE_VERSION` | `22.23.2` |
   | `CLOUDFLARE_ACCOUNT_ID` | `458ad6a930b0fb717796dfa19ca6a2b1` |
   | `VITE_ENVIRONMENT` | `preview` |
   | `MINSKY_PREVIEW_DATABASE_ID` | `3189b257-13f9-4e73-9bd1-bf211c7cbb25` |

9. Do not add any `MINSKY_DEV_*` variable. The deploy script stops when it finds one.
10. Do not add `AUTH_SECRET`. That secret stays on the Worker.

Optionally, protect `minsky-preview.icaic-minsky.workers.dev` with [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/). The preview is public without it.

### Confirm the first preview

Push a branch other than `main`. Then confirm all of the following:

- The `minsky-preview` build log prints `Target: shared preview Worker` and `The revision and deployment checks passed for minsky-preview.`
- `https://minsky-preview.icaic-minsky.workers.dev/minsky-revision.json` shows the pushed commit and database `3189b257-13f9-4e73-9bd1-bf211c7cbb25`.
- `https://minsky-dev.icaic-minsky.workers.dev/minsky-revision.json` still shows the commit of `main`.

Sign in with the preview test account. Its credentials are in a private file outside Git, not in this repository.

### Reset the preview data

All branches share `minsky-preview`. A branch can apply a migration that another branch does not have.
The other branch's build still publishes, because its code runs against the added schema.
The preview database keeps that schema after the branch is merged, renamed, or deleted.

A build stops at the migration comparison only when the database still lacks a migration from its checkout after the apply step. Inspect the applied migrations before you build again.
The comparison checks names only. If you change a migration after a build applied it, the preview keeps the old version. Add a new migration instead, or reset the preview data.

To reset the preview data, find `Restore point before migrations:` in an earlier `minsky-preview` build log.
Run the `npx wrangler d1 time-travel restore minsky-preview` command from that line. Then build the branch again.
The reset discards all preview data written after that point, including test accounts created after it.

## Checks that stay on demand

Browser tests need Chromium libraries that the [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) does not install.
Hosted Supabase and Cloudflare suites also exceed the 20 minute build limit, or they change isolated CI resources.
Coding agents run those commands when the change needs them.
The exact commands are in [deployment settings](cloudflare-build-settings.md#on-demand-checks).
