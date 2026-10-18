# Worker deployment settings

This reference describes `.github/workflows/checks.yml` and `scripts/deploy-workers.mjs`.
The [setup guide](cloudflare-builds.md) owns configuration steps.
The [activation guide](activate-cloudflare-development.md) owns the backend switch approval.

## Events and prerequisites

| Event | Publication after passing checks |
| --- | --- |
| Push to `main` | Stable docs and selected development application, in independent jobs. |
| Trusted repository branch push | Docs preview only. Application previews are disabled. |
| T0021 preparation branch push | None, while the dependent preparation hold remains. |
| Pull request, fork, or Dependabot push | None. |
| Weekly schedule | None. Security jobs only. |
| Manual workflow dispatch | None. Separate protected cloud checks can run. |
| Tag push or branch deletion | None. |

Both `deploy` and `deploy-app` require `checks`, `secrets`, and `dependencies`.
Both require `CLOUDFLARE_DEPLOY_ENABLED=true`.
The preparation branch guard blocks `feature/t0021-cloudflare-development-install` in both the workflow and script.
Remove that hold only after PR #42 merges and T0021 reconciles its changes.
No protected environment rule or branch allowlist changes belong to this preparation.

## Repository settings

| Kind | Name | Value |
| --- | --- | --- |
| Actions secret | `CLOUDFLARE_API_TOKEN` | Private account-scoped deployment token. |
| Actions variable | `CLOUDFLARE_DEPLOY_ENABLED` | `true` enables eligible publishing; missing or `false` disables it. |
| Actions variable | `MINSKY_DEV_BACKEND` | Missing or `supabase` preserves the current frontend. `cloudflare` selects the complete Worker after approval. |
| Actions variable | `VITE_SUPABASE_URL` | `https://ovymmobupzowotvrywek.supabase.co`, required in Supabase mode. |
| Actions variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Development public publishable key or legacy `anon` key, required in Supabase mode. |
| Actions variable | `MINSKY_DEV_CLOUDFLARE_CONFIG` | Repository-relative generated Wrangler path, required in Cloudflare mode. |
| Actions variable | `MINSKY_DEV_DATABASE_ID` | Exact approved development D1 UUID. |
| Actions variable | `MINSKY_DEV_DATABASE_NAME` | Exact approved development D1 name. |
| Actions variable | `MINSKY_DEV_BUCKET_NAME` | Exact approved private development bucket name. |

The workflow fixes `CLOUDFLARE_ACCOUNT_ID=458ad6a930b0fb717796dfa19ca6a2b1` and `VITE_ENVIRONMENT=development`.
The token needs Worker publication and settings inspection access.
Cloudflare app checks also need D1 metadata and migration-query access, R2 bucket and public-domain metadata access, and Worker secret-name inspection.
Review these permissions against the exact account before activation. Do not grant access to another account.
The deployment token never becomes a frontend variable. Its secret value reaches only the publishing step.
The build child excludes Cloudflare, GitHub, and authentication secrets.

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

These commands require a valid repository branch-push context, including its exact Git revision.
They are deployment commands, not substitutes for local `npm run build`.
The removed `deploy:preview` command cannot upload an assets-only app version.

| Site and mode | Configuration | Worker | Assets |
| --- | --- | --- | --- |
| Supabase app | `wrangler.jsonc` | `minsky-dev` | `dist` |
| Cloudflare app | `MINSKY_DEV_CLOUDFLARE_CONFIG`, validated by the provider generator | `minsky-dev` | `dist` |
| Docs | `wrangler.docs.jsonc` | `minsky-docs` | `site/dist` |

The stable URLs are `https://minsky-dev.icaic-minsky.workers.dev` and `https://minsky-docs.icaic-minsky.workers.dev`.
The app build always sets `VITE_BACKEND` from `MINSKY_DEV_BACKEND`.
Cloudflare mode omits Supabase public settings and uses same-origin cookie authentication.
The selected Cloudflare config must have the exact stable name, origin, account, D1 UUID/name, and bucket name.
CI, test, and installation resource names are rejected.
The provider validator rejects extra bindings, unknown variables, and environment overrides.

The generated full Worker includes application code, static assets, `DB`, `IMAGES`, `LIVE_UPDATES`, and `ASSETS`.
It includes Durable Object migration tag `v1`, a one-minute recovery cron, and a 1,000 ms CPU cap.
Its preview URLs are disabled. Application previews receive no stable data bindings.

## Publication checks

`dist/minsky-build.json` records the app build's revision, backend, config path, and D1 UUID.
The upload requires those fields to match the selected deployment.
Before a Supabase assets upload, the script reads the stable Worker's current bindings.
Any D1, R2, or Durable Object binding blocks that upload. Failed or malformed metadata also blocks it.
Before a Cloudflare upload, the script confirms current account access, D1 metadata and migration versions, private R2 settings, and `AUTH_SECRET` presence.
The bucket must have its managed public domain disabled and no custom domain attached.
Provider diagnostics and secret values are withheld.

Each upload checks that the push revision is still the branch's current revision.
GitHub errors fail the job. Deleted or outdated branches skip remaining uploads.
Uploads for one push branch run in sequence across push runs.
A newer push does not cancel an upload already in progress.

`minsky-revision.json` records the published Git revision.
Its HTTP check retries up to 12 times with five-second intervals and a ten-second request timeout.
The summary records the URL and result.
The app build record also identifies the backend and D1 UUID.
These checks verify publication and selection. Authentication, authorization, private images, recovery, and live updates require application checks.

Docs previews use a normalized branch name with a 12-character SHA-256 suffix.
The script runs `wrangler preview` with `--ignore-base-config`, the revision tag, and JSON output.
Stable publication uses `wrangler deploy` with the reviewed configuration.
Docs deployment never reads app backend variables or configuration.
Development migrations, bootstrap, secret creation, and approved activation remain separate operations.
