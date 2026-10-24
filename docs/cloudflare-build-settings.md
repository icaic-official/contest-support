# Worker deployment and CI settings

This reference describes `scripts/ci.mjs`, `wrangler.ci.jsonc`, and `scripts/deploy-workers.mjs`.
The [setup guide](cloudflare-builds.md) owns the dashboard steps.
The [application publication steps](cloudflare-builds.md#publish-the-application) own the `minsky-dev` trigger.
The [activation guide](activate-cloudflare-development.md) owns the backend switch approval.

## Workers Builds

Workers Builds on the Workers Paid plan includes 6,000 build minutes per month.
Further minutes cost $0.005 each.
A build times out at 20 minutes.
Paid plans allow 6 concurrent builds, 4 vCPU, 8 GB of memory, and 20 GB of disk.
These figures are from [Workers Builds limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).
The $5 Workers Paid plan is the plan that includes that allowance.
See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

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
| Node.js | `NODE_VERSION=22.23.2` on both `minsky-ci` triggers. `.nvmrc` contains `22`. |

Both `minsky-ci` triggers set the build variable `NODE_VERSION` to `22.23.2`.
That value is already set in Cloudflare.
It keeps CI on Node.js 22.23.2 when the build image's default Node.js changes.

`npm run ci` installs both lockfiles, then runs type checking, ESLint, Deno function checks, function tests, unit tests, the provider scenario list, both production builds, both `npm audit` checks, and a checksum-verified Gitleaks scan.
`npm run ci:worker` runs `wrangler versions upload --config wrangler.ci.jsonc --dry-run`.
[Version upload](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/) does not send traffic.
The dry run does not upload a version.
The first real `wrangler versions upload` of a new Worker fails until `wrangler deploy` has created it.
This repository does not run that first deploy from CI.

A push to a branch in `GiftedNovaHD/minsky` starts one build when preview builds are enabled.
A fork pull request does not push a branch to this repository, so it does not start a build.
There is no weekly run when nobody pushes.
Secret and dependency scans run on each build instead.

Pages builds are a separate product.
The [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) page gives the Free plan 500 builds per month, and higher quotas on Pages Pro and Business.
Those quotas are not the Workers Paid build minutes above.
Pages also deploys a site. This CI target must not deploy `minsky-dev` or `minsky-docs`.

Containers and Sandbox bill through [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/).
The Workers Paid plan includes 375 vCPU-minutes, 25 GiB-hours of memory, and 200 GB-hours of disk per month.
Memory and disk use the instance size for the whole time the instance runs.
CPU uses active time.
A container runner would also be a deployed Worker.
This change does not add one.

## Docs Workers Builds

The `minsky-docs` Worker has these two triggers since 2026-10-24.
[Publish the docs](cloudflare-builds.md#publish-the-docs) explains the behavior and the dashboard steps.

| Setting | Production trigger | Preview trigger |
| --- | --- | --- |
| Name | `Deploy docs from main` | `Preview docs from other branches` |
| Branches | `main` | Every branch except `main` |
| Build command | `npm ci --prefix site && npm run docs:build` | Same |
| Deploy command | `npx wrangler deploy --config wrangler.docs.jsonc` | `npx wrangler versions upload --config wrangler.docs.jsonc` |
| Root directory | Repository root | Same |
| Dependency install | Default `npm clean-install` of the root lockfile | Same |
| Build variable | `NODE_VERSION=22.23.2` | Same |
| Build token and repository connection | Same as `minsky-ci` | Same |

## Application Workers Builds

The `minsky-dev` Worker has one trigger. The owner chose automatic publication of `main` on 2026-10-24.
[Publish the application](cloudflare-builds.md#publish-the-application) explains the behavior and the dashboard steps.
These settings are proposed. They take effect when the owner connects the trigger.

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
The combined build time of checks and publication is not measured yet. It must stay under the 20 minute build limit.

## On-demand checks

Coding agents run these commands. They are not part of `npm run ci`.

The smoke set is `tests/landing.spec.ts` and `tests/journey.spec.ts`.
The first file checks the sign-in gate and skip navigation.
The second file follows one report from the contestant through support, the jury, and external application.
Install Chromium, then run:

```sh
npx playwright install chromium
npm run test:e2e:smoke
```

The full mocked browser suite, local authentication browser, local connector UI, and docs browser are separate:

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
`npm run test:connector:runtime` starts a temporary local Worker. It is not a browser test.
The [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) preinstalls `libgbm1` and does not list Chromium or the rest of the Playwright libraries.
Its docs do not say a build can install apt packages.
That is why the smoke set stays on demand.
A Containers instance could run a Playwright image inside the included amounts for a short run.
For example, 10 minutes on the published `standard-1` size (1/2 vCPU, 4 GiB, 8 GB disk) is 5 vCPU-minutes at full CPU, 2/3 GiB-hour, and 4/3 GB-hours.
Those amounts sit inside the included 375 vCPU-minutes, 25 GiB-hours, and 200 GB-hours.
This paragraph is arithmetic from the pricing page. It is not a measured bill.
The hosted connector job used a 45 minute limit and the hosted authentication job used 35 minutes.
Both exceed the 20 minute Workers Builds timeout, so they cannot move into a build command.

Hosted Supabase checks need the isolated CI project and its private keys.
Do not point them at development project `ovymmobupzowotvrywek`.

```sh
npx supabase link --project-ref "$MINSKY_TEST_PROJECT_REF"
node scripts/check-cloud-backend.mjs
npm run test:cloud
npm run test:providers -- --provider=supabase
npm run test:workflow:hosted
```

Hosted Cloudflare authentication checks change only the isolated authentication CI Worker:

```sh
npx wrangler d1 migrations apply minsky-auth-ci --remote --config wrangler.auth-ci.jsonc
npx wrangler deploy --config wrangler.auth-ci.jsonc
npm run test:auth:hosted -- --account=458ad6a930b0fb717796dfa19ca6a2b1 --database=5d746d29-0a66-4346-96a6-4974126685d7
npm run test:auth:http -- --account=458ad6a930b0fb717796dfa19ca6a2b1 --database=5d746d29-0a66-4346-96a6-4974126685d7 --origin=https://minsky-auth-ci.icaic-minsky.workers.dev
```

Hosted connector commands stay in [Run the shared provider tests](run-provider-tests.md).
Run them only against the documented CI database names.

## Publication commands

The GitHub Actions jobs `checks`, `secrets`, `dependencies`, `deploy`, and `deploy-app` are removed.
Protected `cloud-test` rules stay in GitHub. No workflow uses them.

`scripts/deploy-workers.mjs` reads the pushed branch and commit from two variables:

- `WORKERS_CI_BRANCH` is the branch name. Workers Builds sets it.
- `WORKERS_CI_COMMIT_SHA` is 40 lowercase hexadecimal characters and is not all zeros. Workers Builds sets it.

A manual run sets both variables itself. `main` selects the stable Worker. Other branches select a preview.
Publication also requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
`CLOUDFLARE_API_TOKEN` is the token for the target checks, the migrations, and the upload.
`CLOUDFLARE_ACCOUNT_ID` must be `458ad6a930b0fb717796dfa19ca6a2b1`.
`--check` and `--build` do not read `CLOUDFLARE_API_TOKEN`.
A stable app publication also reads the backend values in [Repository settings](#repository-settings).
The branch check uses `git ls-remote` on the public repository. It needs no GitHub token.

## Repository settings

The `minsky-dev` Workers Builds trigger sets these values as build variables.
A manual publication command needs the same values in its environment.
The [setup guide](cloudflare-builds.md#connect-the-worker) lists the exact values.

| Kind | Name | Value |
| --- | --- | --- |
| Build API token | `CLOUDFLARE_API_TOKEN` | Private user token limited to the account. |
| Retired variable | `CLOUDFLARE_DEPLOY_ENABLED` | Nothing reads it. |
| Build variable | `MINSKY_DEV_BACKEND` | `cloudflare` is the live development selection and the default when the variable is absent. `supabase` selects static Supabase mode. The binding guard refuses that replacement after activation. |
| Build variable | `VITE_SUPABASE_URL` | `https://ovymmobupzowotvrywek.supabase.co`, required in Supabase mode. |
| Build variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Development public publishable key or legacy `anon` key, required in Supabase mode. |
| Build variable | `MINSKY_DEV_CLOUDFLARE_CONFIG` | Repository-relative generated Wrangler path, required in Cloudflare mode. |
| Build variable | `MINSKY_DEV_DATABASE_ID` | Exact approved development D1 UUID. |
| Build variable | `MINSKY_DEV_DATABASE_NAME` | Exact approved development D1 name. |
| Build variable | `MINSKY_DEV_BUCKET_NAME` | Exact approved private development bucket name. |

Set `CLOUDFLARE_ACCOUNT_ID` to `458ad6a930b0fb717796dfa19ca6a2b1` and `VITE_ENVIRONMENT` to `development`.
The token needs Worker publication and settings inspection access.
Cloudflare app checks also need D1 metadata, migration query, and migration apply access. They also need R2 bucket and public-domain metadata access and Worker secret-name inspection.
The automatic Workers Builds token has no D1 access.
Review these permissions against the exact account before activation. Do not grant access to another account.
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
| Validate, build, or publish docs | Use the same options with `--site=docs`. |
| Guarded app build and publication | `npm run deploy` |

These commands require the branch and commit variables under [Publication commands](#publication-commands).
They are deployment commands, not substitutes for local `npm run build`.
The removed `deploy:preview` command cannot upload an assets-only app version.

| Site and mode | Configuration | Worker | Assets |
| --- | --- | --- | --- |
| Supabase app | `wrangler.jsonc` | `minsky-dev` | `dist` |
| Cloudflare app | `MINSKY_DEV_CLOUDFLARE_CONFIG`, validated by the provider generator | `minsky-dev` | `dist` |
| Docs | `wrangler.docs.jsonc` | `minsky-docs` | `site/dist` |

The stable URLs are `https://minsky-dev.icaic-minsky.workers.dev` and `https://minsky-docs.icaic-minsky.workers.dev`.
The app build always sets `VITE_BACKEND` from `MINSKY_DEV_BACKEND`.
A missing Cloudflare configuration does not fall back to a static upload.
Cloudflare mode omits Supabase public settings and uses same-origin cookie authentication.
The selected Cloudflare config must have the exact stable name, origin, account, D1 UUID, database name, and bucket name.
The script rejects CI, test, and installation resource names.
The provider validator rejects extra bindings, unknown variables, and environment overrides.

The generated full Worker includes application code, static assets, `DB`, `IMAGES`, `LIVE_UPDATES`, and `ASSETS`.
It includes Durable Object migration tag `v1`, a one-minute recovery cron, and a 1,000 ms CPU cap.
The config disables its preview URLs. Application previews receive no stable data bindings.

## Publication checks

`dist/minsky-build.json` records the app build's revision, backend, config path, D1 UUID, bucket name, and origin.
The upload requires those fields to match the selected deployment.
Before a Supabase assets upload, the script reads the stable Worker's current bindings.
Any D1, R2, or Durable Object binding blocks that upload. Failed or malformed metadata also blocks it.
Before a Cloudflare upload, the script confirms current account access, D1 metadata, private R2 settings, and `AUTH_SECRET` presence.
Then it runs `wrangler d1 migrations apply` on the confirmed database.
Then it requires the applied migrations to equal the checkout's migrations. More applied migrations mean that a newer build already ran, so the older build stops.
Migrations must only add tables, columns, or indexes. A Worker rollback then still runs against the newer schema.
The bucket must have its managed public domain disabled and no custom domain attached.
Provider diagnostics and secret values are withheld.

Each upload checks that the push revision is still the branch's current revision.
Lookup errors fail the build. Deleted or outdated branches skip remaining uploads.
This check runs before the migrations.
A newer push does not cancel an upload already in progress.

For the app, `minsky-revision.json` records `sha`, `backend`, `databaseId`, `bucketName`, and `origin`.
Supabase mode uses null database and bucket values. Cloudflare mode records the exact selected targets.
The docs record contains only `sha`.
The HTTP check compares every expected field.
It retries up to 12 times with five-second intervals and a ten-second request timeout.
The build log records the URL and result.

After a Cloudflare upload, the script checks the deployed `DB`, `IMAGES`, `LIVE_UPDATES`, `AUTH_ORIGIN`, and `AUTH_SECRET` bindings.
The database UUID, bucket name, origin, and binding types must match the reviewed configuration.
The live binding must name `SessionLiveCoordinator` and a namespace within this Worker.
An anonymous `/api/auth/session` request must return `401` and `Sign in to continue.`.
A mismatch fails the deployment job. The script withholds provider diagnostics and secret values.
These checks verify publication, selection, bindings, and an anonymous denial.
Authenticated authorization, private images, recovery, and live updates require the separate application checks.

Docs previews use a normalized branch name with a 12-character SHA-256 suffix.
The preview parser accepts asset-progress lines before the JSON response. Malformed JSON and URLs outside the permitted Worker domain remain rejected.
The script runs `wrangler preview` with `--ignore-base-config`, the revision tag, and JSON output.
Stable publication uses `wrangler deploy` with the reviewed configuration.
Docs deployment never reads app backend variables or configuration.
A stable Cloudflare publication applies new development migrations. Bootstrap, secret creation, and approved activation remain separate operations.
