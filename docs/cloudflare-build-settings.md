# Worker deployment settings

This reference describes `.github/workflows/checks.yml` and `scripts/deploy-workers.mjs`.
The [setup guide](cloudflare-builds.md) contains the activation procedure.

## Events and prerequisites

| Event | Checks | Frontend deployment |
| --- | --- | --- |
| Push to `main` | `checks`, `secrets`, `dependencies` | Both stable Workers after all three jobs pass. |
| Push to another branch in `GiftedNovaHD/minsky` | All three jobs | Both branch previews after all three jobs pass. |
| Pull request, including a fork | All three jobs | None. |
| Dependabot branch push | All three jobs | None. A maintainer can copy reviewed changes to a trusted branch for a preview. |
| Weekly schedule | `secrets`, `dependencies` | None. |
| Manual workflow dispatch | All three jobs, then the separate protected `cloud` job | None. |
| Tag push or branch deletion | No deployment | None. |

Deployment also requires `CLOUDFLARE_DEPLOY_ENABLED=true`.
The `deploy` job declares `needs: [checks, secrets, dependencies]`.
GitHub skips that job if any prerequisite fails or is cancelled.
The required status names remain `checks`, `secrets`, and `dependencies`.
The previous `Security` workflow's jobs and weekly schedule now belong to `Checks`.
See [GitHub job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).

## Repository settings

| Kind | Name | Value |
| --- | --- | --- |
| Actions secret | `CLOUDFLARE_API_TOKEN` | Account-scoped token with Worker deployment permission. |
| Actions variable | `CLOUDFLARE_DEPLOY_ENABLED` | `true` enables publishing. Missing or `false` disables publishing. |
| Actions variable | `VITE_SUPABASE_URL` | `https://ovymmobupzowotvrywek.supabase.co` |
| Actions variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Development public publishable key or legacy `anon` key. |

The workflow sets `CLOUDFLARE_ACCOUNT_ID=458ad6a930b0fb717796dfa19ca6a2b1` and `VITE_ENVIRONMENT=development`.
Node.js 22 and the committed npm lockfiles supply the build tools.
Wrangler is pinned to `4.149.0`.
The Cloudflare token is available only in the publishing step.
`GH_TOKEN` uses the run's read-only GitHub token to check the current branch revision.

The app URL and public key become browser assets at build time.
Runtime Worker variables cannot replace these build variables.
The deployment script rejects missing settings, other backend URLs, and privileged key formats.
A publishable key's project must still match the selected development project.
Its opaque value does not identify that project to the local validator.

## Commands and targets

Both builds run from the repository root after `npm ci` and `npm ci --prefix site`.

| Site | Build command | Configuration | Asset directory | Stable Worker |
| --- | --- | --- | --- | --- |
| App | `npm run build` | `wrangler.jsonc` | `dist` | `minsky-dev` |
| Docs | `npm run docs:build` | `wrangler.docs.jsonc` | `site/dist` | `minsky-docs` |

For `main`, the script runs `wrangler deploy --config` with each configuration path.
For other branches, the script runs `wrangler preview --config` with these arguments:

- `--name` uses a stable branch name with a 12-character SHA-256 suffix.
- `--tag` records the complete Git commit ID.
- `--ignore-base-config` excludes dashboard defaults from the static preview configuration.
- `--json` returns the actual preview address for the run summary.

The name contains `branch-`, up to 24 normalized branch characters, and the hash suffix.
The hash distinguishes names that normalize to the same text.
Both configurations contain `previews: {}` and `preview_urls: true`.
The `previews` block enables Worker Previews configuration.
The `preview_urls` setting enables preview routing on `workers.dev` after it reaches the deployed Worker.
An existing Worker needs that route enabled before its first branch preview.
See [preview configuration](https://developers.cloudflare.com/workers/previews/configuration/) and [preview routing](https://developers.cloudflare.com/workers/previews/custom-domains/).

The older `npm run deploy:preview` command still uses `wrangler versions upload`.
The automatic workflow uses the newer `wrangler preview` command.
The stable app address is `https://minsky-dev.icaic-minsky.workers.dev`.
The stable docs address is `https://minsky-docs.icaic-minsky.workers.dev`.
Both remain development resources.

## Revision checks and retries

Push runs for one branch execute in sequence.
A newer push does not interrupt an active upload.
GitHub can replace pending runs when more pushes arrive.
Before each upload, the script checks that the run's commit is still the branch's current commit.
Deleted branches and outdated commits skip remaining uploads.
GitHub API errors fail the job.

Each build receives `minsky-revision.json` with its Git commit ID before upload.
After each upload, the script requests that file from the published URL.
The check requires an HTTP success response and the expected commit ID.
It retries up to 12 times, with five seconds between attempts and a ten-second timeout per request.
The run summary records each published URL and its revision-check result.
The check verifies static publication. It does not verify Supabase functions or authenticated user workflows.
