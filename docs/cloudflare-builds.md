# Run checks on Workers Builds

Use this guide to connect repository checks to Cloudflare Workers Builds.
Use [deployment settings](cloudflare-build-settings.md) for commands, limits, and checks that stay on demand.
Use [activation](activate-cloudflare-development.md) for the separate development-installation approval.

On `minsky-ci`, Workers Builds runs `npm run ci` and then `npm run ci:worker`.
It does not publish `minsky-dev` or `minsky-docs`.
On `minsky-docs`, Workers Builds publishes the docs. See [Publish the docs](#publish-the-docs).
GitHub Actions no longer runs checks or publication. The GitHub account stays on the free plan.

## Keep the application Worker disconnected

The approved development application uses `MINSKY_DEV_BACKEND=cloudflare`.
Its committed configuration selects the complete Worker and the exact development resources.
Keep Workers Builds disconnected on `minsky-dev`.
A build on that Worker can replace the application or publish before the checks finish.

`MINSKY_DEV_BACKEND` defaults to `cloudflare` when absent.
Supabase mode requires `MINSKY_DEV_BACKEND=supabase`.
A missing Cloudflare configuration does not fall back to a static upload.
The deployed-binding guard still refuses an assets-only replacement of an activated Worker.
The app build sets `VITE_BACKEND` explicitly. A shell's inherited value cannot select a different backend.
A preparation PR merge does not approve a future backend switch.

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

Push a commit to any branch in this repository.
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

## Application publication

Automatic application publication is removed with the GitHub Actions workflow.
`CLOUDFLARE_DEPLOY_ENABLED` no longer starts a job.
Publish the application only with the guarded script in [deployment settings](cloudflare-build-settings.md#publication-commands), and only for an approved revision.
The script still requires a repository branch-push context.
This CI setup does not provide that context.

## Checks that stay on demand

Browser tests need Chromium libraries that the [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) does not install.
Hosted Supabase and Cloudflare suites also exceed the 20 minute build limit, or they change isolated CI resources.
Coding agents run those commands when the change needs them.
The exact commands are in [deployment settings](cloudflare-build-settings.md#on-demand-checks).
