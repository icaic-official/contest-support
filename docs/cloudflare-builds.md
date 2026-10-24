# Run checks on Workers Builds

Use this guide to connect repository checks to Cloudflare Workers Builds.
Use [deployment settings](cloudflare-build-settings.md) for commands, limits, and checks that stay on demand.
Use [activation](activate-cloudflare-development.md) for the separate development-installation approval.

On `minsky-ci`, Workers Builds runs `npm run ci` and then `npm run ci:worker`.
It does not publish `minsky-dev` or `minsky-docs`.
On `minsky-docs`, Workers Builds publishes the docs. See [Publish the docs](#publish-the-docs).
On `minsky-dev`, Workers Builds checks each push to `main` and then publishes it. See [Publish the application](#publish-the-application).
GitHub Actions no longer runs checks or publication. The GitHub account stays on the free plan.

## Why app previews are disabled

A frontend preview can change shared data when it uses a stable backend.
Earlier Supabase previews used the development project directly.
Cloudflare previews receive no stable D1, R2, or Durable Object bindings.
A future preview needs its own resources, credentials, fixture ownership, and cleanup checks.
Docs previews are safe because the docs contain no application data.

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

1. Build the application for the backend that the build variables select.
2. Stop if the build's commit is no longer the head of `main`. A newer push then owns the publication.
3. Confirm the account, the D1 database, the private R2 bucket, and the `AUTH_SECRET` name.
4. Apply new D1 migrations with `wrangler d1 migrations apply minsky-development --remote`.
5. Stop if the applied migrations differ from the checkout. An older build stops here after a newer build has migrated.
6. Publish the complete Worker with `wrangler deploy`.
7. Read `minsky-revision.json` and the live bindings. Confirm that an anonymous `/api/auth/session` request returns `401`.

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
10. Do not add `MINSKY_DEV_BACKEND`. Its absence selects Cloudflare.
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
- If a migration damaged data, restore the database with [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

To publish by hand, run `npm run deploy` from an updated `main` with the same variables, a token with the same permissions, `WORKERS_CI_BRANCH=main`, and `WORKERS_CI_COMMIT_SHA` set to the output of `git rev-parse HEAD`.

The script sets `VITE_BACKEND` from `MINSKY_DEV_BACKEND` and guards the complete Worker:

- A Cloudflare app needs its API code, D1 database, private R2 bucket, and live coordinator. An assets-only upload would remove them.
- The Supabase path runs only when `MINSKY_DEV_BACKEND=supabase`. It refuses the upload when the deployed Worker has application bindings.
- The Cloudflare path validates the generated configuration and exact hosted targets before upload. After upload, it checks the published targets, live bindings, and an anonymous rejection at the authentication API.
- It rejects pushes by Dependabot.

These checks do not verify authenticated behavior. The installation and activation procedures require the full application checks.
A broken application target cannot block the docs, because Workers Builds publishes them separately.

## Checks that stay on demand

Browser tests need Chromium libraries that the [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) does not install.
Hosted Supabase and Cloudflare suites also exceed the 20 minute build limit, or they change isolated CI resources.
Coding agents run those commands when the change needs them.
The exact commands are in [deployment settings](cloudflare-build-settings.md#on-demand-checks).
