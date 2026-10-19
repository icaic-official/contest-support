# Configure deployment after CI passes

Use this guide to configure the repository's development deployment automation.
Use [deployment settings](cloudflare-build-settings.md) for exact variables and target checks.
Use [activation](activate-cloudflare-development.md) for the separate fresh-installation approval process.

## Preserve the selected development backend

The approved development deployment uses `MINSKY_DEV_BACKEND=cloudflare`.
Its committed generated configuration selects the complete Worker and exact development resources.
`MINSKY_DEV_BACKEND` still defaults to `supabase` when absent, but the deployed-binding guard refuses an assets-only replacement of an activated Worker.
The app build sets `VITE_BACKEND` explicitly. A shell's inherited value cannot select a different backend.
A preparation PR merge does not approve a future backend switch.

## Prepare the Workers and repository settings

You need repository Actions administration and access to the confirmed Cloudflare account.
Check existing Wrangler access before requesting a new token.
Keep independent Cloudflare Git builds disabled for `minsky-dev` and `minsky-docs`.
A separate provider build could bypass CI or replace the complete application with static assets.

For docs branch previews, enable preview routing on the existing `minsky-docs` Worker.
The workflow disables application branch previews. No preview receives stable development database bindings.
A future app preview needs independent provider resources and separate verification.

Store the deployment API token privately as the repository Actions secret `CLOUDFLARE_API_TOKEN`.
Restrict it to account `458ad6a930b0fb717796dfa19ca6a2b1`.
See [the permission reference](cloudflare-build-settings.md#repository-settings).
Never put a token in chat, Git, `VITE_` variables, or build artifacts.

For the active Cloudflare application, preserve these public repository variables:

| Variable | Value |
| --- | --- |
| `MINSKY_DEV_BACKEND` | `cloudflare` |
| `MINSKY_DEV_CLOUDFLARE_CONFIG` | `src/server/adapters/cloudflare/deploy/development.wrangler.jsonc` |
| `MINSKY_DEV_DATABASE_ID` | `a1832f97-4d4c-45c2-a848-8d3dfd0b74f5` |
| `MINSKY_DEV_DATABASE_NAME` | `minsky-development` |
| `MINSKY_DEV_BUCKET_NAME` | `minsky-development-images` |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` enables eligible publishing jobs. `false` pauses both. |

Do not use service-role or `sb_secret_` keys.
The workflow fixes the account and sets `VITE_ENVIRONMENT=development`.
The docs job requires no app configuration or Supabase credentials.
A separate Supabase application build requires its public URL and publishable key.
Supabase mode remains implemented, but changing that selection does not repair or replace the activated Cloudflare installation.

## Verify eligible deployments

Push runs can publish after `checks`, `secrets`, and `dependencies` pass for that revision.
Pull request runs and manual dispatch do not publish stable sites or previews.
The manual protected cloud jobs remain separate.

On an eligible feature branch, confirm that `deploy` publishes only the docs preview.
Confirm that the script skips the app upload.
On `main`, confirm that `deploy` publishes docs and `deploy-app` publishes the selected application.
The two jobs are independent. Invalid app configuration must not block docs publication.
Check each job's run summary and `/minsky-revision.json`.

For Supabase mode, the app job first confirms the live Worker has no D1, R2, or Durable Object bindings.
If Cloudflare is already active, this check refuses the static upload.
An absent backend variable cannot silently replace an activated full Worker.

For approved Cloudflare activation, follow the exact sequence in the activation guide.
That process commits a generated public config with real identifiers and sets the required Cloudflare deployment variables.
The app job then confirms the account, database metadata, migration list, private bucket target, and `AUTH_SECRET` metadata before upload.
Its build and upload must agree on the backend, revision, config path, D1 UUID, bucket name, and origin.
No job applies development migrations, initializes an administrator, or rotates authentication secrets.
After upload, the job checks the deployed bindings and anonymous rejection at `/api/auth/session`.

After each deployment, run the appropriate application checks at the reported URL.
A matching publication record and binding check do not prove authenticated behavior.
For docs, run the read-only browser checks:

```sh
MINSKY_DOCS_URL=https://minsky-docs.icaic-minsky.workers.dev npm run docs:test
```

Record source revisions, run URLs, deployed versions, and observed results in `docs/current-state.md`.
The guarded Cloudflare deployment path requires hosted verification on the final revision.
Use the current-state record to determine which deployment checks passed.

## Pause, retry, and recover

Set `CLOUDFLARE_DEPLOY_ENABLED=false` to pause future app and docs deployments.
Cancel jobs already publishing separately.
Correct the target or backend problem before enabling publishing again.
Rerun the latest approved push run. Old revisions and deleted branches skip uploads.
If one job succeeds and the other fails, inspect both summaries before retrying.

Do not switch the backend variable to `supabase` to repair a Cloudflare application.
The binding guard rejects that assets-only replacement.
Use the [activation recovery procedure](activate-cloudflare-development.md#repair-a-failed-activation) and retain the new installation's records.

To retire a docs branch preview, use its exact name from the run summary and the Cloudflare dashboard.
Branch deletion does not remove previews automatically.
No additional paid upgrade is part of this preparation.
