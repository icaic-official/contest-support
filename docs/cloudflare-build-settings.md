# Worker deployment and CI settings

This reference is for maintainers of this project's own Cloudflare resources. An outside contributor needs only the [CI summary](cloudflare-builds.md).
It describes `scripts/ci.mjs`, `wrangler.ci.jsonc`, and `scripts/deploy-workers.mjs`.
The [setup guide](cloudflare-builds.md) owns the dashboard steps, including the [`minsky-dev` trigger](cloudflare-builds.md#publish-the-application).
`<account-id>` means the `account_id` value in `wrangler.jsonc`.

## Workers Builds

Workers Builds on the Workers Paid plan includes 6,000 build minutes per month.
A build times out at 20 minutes.
See [Workers Builds limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

| Setting | Value |
| --- | --- |
| Worker | `minsky-ci` |
| Config | `wrangler.ci.jsonc` |
| Production branch | `main` |
| Other branches | Preview builds enabled. They run the same two commands. |
| Build command | `npm run ci` |
| Deploy command | `npm run ci:worker` |
| Preview command | `npm run ci:worker` |
| Build variable | `SKIP_DEPENDENCY_INSTALL=1` |
| Node.js | `NODE_VERSION=22.23.4` on both `minsky-ci` triggers. `.nvmrc` contains `22`. |

`NODE_VERSION` keeps CI on Node.js 22.23.4 when the build image's default Node.js changes.

`npm run ci` installs both lockfiles, then runs the app production build, ESLint, unit tests, the provider scenario list, the docs build, both `npm audit` checks, and a checksum-verified Gitleaks scan.
The app build starts with `tsc -b`, so it is also the type check. It runs first so that type errors fail early.
Vitest uses every CPU. It starts the three short authentication files first, because a fresh install has no earlier test durations and Vitest would otherwise start them last.

`npm run ci:worker` runs `wrangler versions upload --config wrangler.ci.jsonc --dry-run`.
The dry run does not upload a version and does not send traffic.
The first real `wrangler versions upload` of a new Worker fails until `wrangler deploy` has created it.

A push to a branch in `GiftedNovaHD/minsky` starts one build when preview builds are enabled.
A fork pull request does not push a branch to this repository, so it does not start a build.
There is no scheduled run. Secret and dependency scans run on each build.

## Docs Workers Builds

[Publish the docs](cloudflare-builds.md#publish-the-docs) explains the behavior and the dashboard steps.

| Setting | Production trigger | Preview trigger |
| --- | --- | --- |
| Name | `Deploy docs from main` | `Preview docs from other branches` |
| Branches | `main` | Every branch except `main` |
| Build command | `npm ci --prefix site && npm run docs:build` | Same |
| Deploy command | `npx wrangler deploy --config wrangler.docs.jsonc` | `npx wrangler versions upload --config wrangler.docs.jsonc` |
| Root directory | Repository root | Same |
| Dependency install | Default `npm clean-install` of the root lockfile | Same |
| Build variable | `NODE_VERSION=22.23.4` | Same |
| Build token and repository connection | Same as `minsky-ci` | Same |

## Application Workers Builds

The `minsky-dev` Worker has one trigger.
[Publish the application](cloudflare-builds.md#publish-the-application) explains the behavior and the dashboard steps.

| Setting | Value |
| --- | --- |
| Worker | `minsky-dev` |
| Branches | `main` only. Builds for other branches are disabled. |
| Build command | `npm run ci` |
| Deploy command | `npm run deploy` |
| Root directory | Repository root |
| API token | User token with the permissions in [Prepare the deployment token](cloudflare-builds.md#prepare-the-deployment-token) |
| Build variables | `SKIP_DEPENDENCY_INSTALL`, `NODE_VERSION`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_ENVIRONMENT`, and the four `MINSKY_DEV_*` target values in [Repository settings](#repository-settings) |

The build runs `npm run ci` once more on `main`, after `minsky-ci` has checked the same commit.
That repeat makes the publication depend on checks in the same build. The deploy step cannot run after a failed check.
The combined build time of checks and publication is not measured. It must stay under the 20 minute build limit.

## Preview Workers Builds

The `minsky-preview` Worker publishes branch previews when its branch builds are on. They are switched off, because its token cannot be limited to the preview resources.
[Publish branch previews](cloudflare-builds.md#publish-branch-previews) explains the behavior and the dashboard steps. The table lists the settings for when branch builds are on.

| Setting | Value |
| --- | --- |
| Worker | `minsky-preview` |
| Branches | Production branch `main`, which builds but does not publish. Builds for other branches are enabled. Branches that match `dependabot/*` are excluded. |
| Build command | `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_API_KEY npm ci`. It installs dependencies without the token and runs no checks. |
| Deploy command | `npm run deploy` for every branch |
| Root directory | Repository root |
| API token | Account token in [Prepare the preview token](cloudflare-builds.md#prepare-the-preview-token), limited to `minsky-preview` and `minsky-preview-images`. Never the `minsky-dev` token. |
| Build variables | `SKIP_DEPENDENCY_INSTALL=1`, `NODE_VERSION=22.23.4`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_ENVIRONMENT=preview`, `MINSKY_PREVIEW_DATABASE_ID=3189b257-13f9-4e73-9bd1-bf211c7cbb25` |

The preview resources are D1 database `minsky-preview` and private bucket `minsky-preview-images`, both in APAC.
They hold only test data.

## On-demand checks

These commands are not part of `npm run ci`. Run them by hand.

The smoke set is `tests/landing.spec.ts` and `tests/journey.spec.ts`.
The first file checks the sign-in gate and skip navigation.
The second file follows one report from the contestant through support, the jury, and external application.
Install Chromium, then run:

```sh
npx playwright install chromium
npm run test:e2e:smoke
```

The full mocked browser suite, local authentication browser, local connector runtime, local connector UI, and docs browser are separate:

```sh
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:auth:browser
npm run test:connector:runtime
npm run test:connector:ui:local
npm run docs:build
npm run docs:test
```

`npm run test:e2e` includes the smoke files and the other mocked browser files.
`npm run test:connector:runtime` runs in Vitest. It starts a temporary local Worker and opens Chromium.
These suites stay on demand, because the [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) preinstalls `libgbm1` and does not list Chromium or the rest of the Playwright libraries.
Its docs do not say that a build can install apt packages.

Hosted suites stay on demand too. `test-store.mjs` gives each store suite a 30 minute limit, which is longer than the 20 minute build limit.

Hosted Cloudflare authentication checks change only the isolated authentication CI Worker:

```sh
npx wrangler d1 migrations apply minsky-auth-ci --remote --config wrangler.auth-ci.jsonc
npx wrangler deploy --config wrangler.auth-ci.jsonc
npm run test:auth:hosted -- --account=<account-id> --database=5d746d29-0a66-4346-96a6-4974126685d7
npm run test:auth:http -- --account=<account-id> --database=5d746d29-0a66-4346-96a6-4974126685d7 --origin=https://minsky-auth-ci.icaic-minsky.workers.dev
```

Hosted connector commands stay in [Run the shared provider tests](run-provider-tests.md).
Run them only against the documented CI database names.

## Publication commands

Publication is an explicit, guarded command. Run it only after an explicit request.

`scripts/deploy-workers.mjs` reads the pushed branch and commit from two variables:

- `WORKERS_CI_BRANCH` is the branch name. Workers Builds sets it.
- `WORKERS_CI_COMMIT_SHA` is 40 lowercase hexadecimal characters and is not all zeros. Workers Builds sets it.

A manual run sets both variables itself. `main` selects the stable Workers. On other branches, the script publishes only the app, and only on the `minsky-preview` build.
Publication also requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
`CLOUDFLARE_API_TOKEN` is the token for the target checks, the migrations, and the upload.
`CLOUDFLARE_ACCOUNT_ID` must be `<account-id>`.
`--check` and `--build` do not read `CLOUDFLARE_API_TOKEN`.
A stable app publication also reads the backend values in [Repository settings](#repository-settings).

The branch check runs `git ls-remote` on `https://github.com/GiftedNovaHD/minsky.git` with terminal prompts off. The script passes no GitHub token.
If the machine cannot read that URL, the check stops with `The GitHub branch lookup failed.` The repository is private, so a manual run needs Git credentials for that URL.

## Repository settings

The `minsky-dev` Workers Builds trigger sets these values as build variables.
A manual publication command needs the same values in its environment.
The [setup guide](cloudflare-builds.md#connect-the-worker) lists the exact values.

| Kind | Name | Value |
| --- | --- | --- |
| Build API token | `CLOUDFLARE_API_TOKEN` | Private user token limited to the account. |
| Build variable | `MINSKY_DEV_CLOUDFLARE_CONFIG` | Repository-relative generated Wrangler path. |
| Build variable | `MINSKY_DEV_DATABASE_ID` | Exact development D1 UUID. |
| Build variable | `MINSKY_DEV_DATABASE_NAME` | Exact development D1 name. |
| Build variable | `MINSKY_DEV_BUCKET_NAME` | Exact private development bucket name. |

Set `CLOUDFLARE_ACCOUNT_ID` to `<account-id>` and `VITE_ENVIRONMENT` to `development`.
The token needs Worker publication and settings inspection access.
Cloudflare app checks also need D1 metadata, migration query, and migration apply access. They also need R2 bucket and public-domain metadata access and Worker secret-name inspection.
The automatic Workers Builds token has no D1 access.
Review these permissions against the exact account before you connect the trigger. Do not grant access to another account.
The deployment token never becomes a frontend variable. Its secret value reaches only the publishing step.
The build child excludes Cloudflare, GitHub, and authentication secrets.
`npm run ci` removes `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`, and `AUTH_SECRET` before it installs packages or runs checks.

`AUTH_SECRET` is a private Worker secret, installed separately through the provider tool.
It is not a repository variable, public config field, build input, or ordinary artifact.
The public Worker variable `AUTH_ORIGIN` comes from the generated configuration.

## Build and target selection

Install the locked dependencies before these commands:

| Purpose | Command |
| --- | --- |
| Validate public app deployment settings | `node scripts/deploy-workers.mjs --check --site=app` |
| Build the selected app and record its backend | `node scripts/deploy-workers.mjs --build --site=app` |
| Publish the selected app | `node scripts/deploy-workers.mjs --site=app` |
| Validate, build, or publish docs from `main` | Use the same options with `--site=docs`. |
| Guarded app build and publication | `npm run deploy` |

These commands require the branch and commit variables under [Publication commands](#publication-commands).
They are deployment commands, not substitutes for local `npm run build`.

| Site and mode | Configuration | Worker | Assets |
| --- | --- | --- | --- |
| App | `MINSKY_DEV_CLOUDFLARE_CONFIG`, validated by the provider generator | `minsky-dev` | `dist` |
| Branch preview | `src/server/adapters/cloudflare/deploy/preview.wrangler.jsonc`, validated by the provider generator | `minsky-preview` | `dist` |
| Docs | `wrangler.docs.jsonc` | `minsky-docs` | `site/dist` |

The stable URLs are `https://minsky-dev.icaic-minsky.workers.dev` and `https://minsky-docs.icaic-minsky.workers.dev`.
The app build uses same-origin cookie authentication.
A missing Cloudflare configuration stops the app publication. There is no static upload path.
The selected Cloudflare config must have the exact stable name, origin, account, D1 UUID, database name, and bucket name.
The script rejects CI, test, and installation resource names.
The provider validator rejects extra bindings, unknown variables, and environment overrides.

The generated full Worker includes application code, static assets, `DB`, `IMAGES`, `LIVE_UPDATES`, and `ASSETS`.
It includes Durable Object migration tag `v1`, a one-minute recovery cron, and a 1,000 ms CPU cap.
The application configs disable Cloudflare preview URLs. Cloudflare does not create them for Workers that use a Durable Object. Branch previews replace the separate `minsky-preview` Worker, which binds only preview resources.
A branch build selects the preview only when `VITE_ENVIRONMENT` is `preview`. Other branch builds skip the app.
A `main` build with `VITE_ENVIRONMENT=preview` skips the app, because `minsky-dev` publishes `main`.

## Publication checks

`dist/minsky-build.json` records the app build's revision, backend, config path, D1 UUID, bucket name, and origin.
The upload requires those fields to match the selected deployment.
Before a Cloudflare upload, the script checks that no unreviewed D1 migration removes or renames schema. This check is local and runs before any provider call.
Then it confirms current account access, D1 metadata, private R2 settings, and `AUTH_SECRET` presence.
Then it reads the database's current Time Travel bookmark with `wrangler d1 time-travel info --json`. It prints the bookmark and the matching restore command. If the bookmark cannot be read, no migration starts.
Then it runs `wrangler d1 migrations apply` on the confirmed database.
Then it requires the applied migrations to equal the checkout's migrations. More applied migrations mean that a newer build already ran, so the older build stops.
Migrations must only add schema, so that a Worker rollback still runs against the newer schema. [Change the D1 schema](cloudflare-builds.md#change-the-d1-schema) describes the check and the exception procedure.
The bucket must have its managed public domain disabled and no custom domain attached.
Provider diagnostics and secret values are withheld.

Each upload checks that the push revision is still the branch's current revision.
Lookup errors fail the build. Deleted or outdated branches skip remaining uploads.
This check runs before the migrations.
A newer push does not cancel an upload already in progress.
The script has no lock. Do not start a manual publication while a Workers Builds publication runs.

For the app, `minsky-revision.json` records `sha`, `backend`, `databaseId`, `bucketName`, and `origin`.
The app record holds the exact selected targets.
The docs record contains only `sha`.
The HTTP check compares every expected field.
It retries up to 12 times with five-second intervals and a ten-second request timeout.
The build log records the URL and result.

After a Cloudflare upload, the script checks the deployed `DB`, `IMAGES`, `LIVE_UPDATES`, `AUTH_ORIGIN`, and `AUTH_SECRET` bindings.
The database UUID, bucket name, origin, and binding types must match the reviewed configuration.
The live binding must name `SessionLiveCoordinator` and a namespace within this Worker.
An anonymous `/api/auth/session` request must return `401` and `Sign in to continue.`.
A mismatch fails the command. The script withholds provider diagnostics and secret values.
These checks verify publication, selection, bindings, and an anonymous denial.
Authenticated authorization, private images, recovery, and live updates require the separate application checks.

Workers Builds publishes the docs and their preview versions. See [Publish the docs](cloudflare-builds.md#publish-the-docs).
The script's `--site=docs` path is a manual fallback for `main`.
On other branches, the script skips the docs, because the `minsky-docs` build uploads their preview versions.
The script publishes each Worker with `wrangler deploy` and the reviewed configuration.
Docs deployment never reads app backend variables or configuration.
A stable Cloudflare publication applies new development migrations. Bootstrap and secret creation are separate operations.
