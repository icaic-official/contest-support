# Configure deployment after CI passes

Use this guide to configure the repository's development deployment automation.
Use [deployment settings](cloudflare-build-settings.md) for exact variables and target checks.
Use [activation](activate-cloudflare-development.md) for the separate fresh-installation approval process.

## Keep the current backend until activation

`MINSKY_DEV_BACKEND` defaults to `supabase` when absent.
This preserves the current development application during preparation.
The app build sets `VITE_BACKEND` explicitly. A shell's inherited value cannot select a different backend.

Before activation, do not set `MINSKY_DEV_BACKEND=cloudflare` or deploy a full Worker to `minsky-dev`.
The T0021 branch blocks all publishing while PR #42 is under review.
Preparation PR merge does not approve the backend switch.

## Prepare the Workers and repository settings

You need repository Actions administration and access to the confirmed Cloudflare account.
Check existing Wrangler access before requesting a new token.
Keep independent Cloudflare Git builds disabled for `minsky-dev` and `minsky-docs`.
A separate provider build could bypass CI or replace the complete application with static assets.

For docs branch previews, enable preview routing on the existing `minsky-docs` Worker.
Application branch previews are disabled. No preview receives stable development database bindings.
A future app preview needs independent provider resources and separate verification.

Store the deployment API token privately as the repository Actions secret `CLOUDFLARE_API_TOKEN`.
Restrict it to account `458ad6a930b0fb717796dfa19ca6a2b1`.
See [the permission reference](cloudflare-build-settings.md#repository-settings).
Never put a token in chat, Git, `VITE_` variables, or build artifacts.

For the current Supabase application, set these public repository variables:

| Variable | Value |
| --- | --- |
| `MINSKY_DEV_BACKEND` | `supabase`, or absent before activation. |
| `VITE_SUPABASE_URL` | `https://ovymmobupzowotvrywek.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The development project's public publishable key or legacy `anon` key. |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` enables eligible publishing jobs. `false` pauses both. |

Do not use service-role or `sb_secret_` keys.
The workflow fixes the account and sets `VITE_ENVIRONMENT=development`.
The docs job requires no app configuration or Supabase credentials.

## Verify eligible deployments

Push runs can publish after `checks`, `secrets`, and `dependencies` pass for that revision.
Pull request runs and manual dispatch do not publish stable sites or previews.
The manual protected cloud jobs remain separate.

On an eligible feature branch, confirm that `deploy` publishes only the docs preview.
Confirm that the app upload is skipped.
On `main`, confirm that `deploy` publishes docs and `deploy-app` publishes the selected application.
The two jobs are independent. Invalid app configuration must not block docs publication.
Check each job's run summary and `/minsky-revision.json`.

For the active Supabase mode, the app job first confirms the live Worker has no D1, R2, or Durable Object bindings.
If Cloudflare is already active, this check refuses the static upload.
An absent backend variable cannot silently replace an activated full Worker.

For approved Cloudflare activation, follow the exact sequence in the activation guide.
That process commits a generated public config with real identifiers and sets the five Cloudflare target variables.
The app job then confirms the account, database metadata, migration list, private bucket target, and `AUTH_SECRET` metadata before upload.
Its build and upload must agree on the backend, source revision, configuration, and D1 UUID.
No job applies development migrations, initializes an administrator, or rotates authentication secrets.

After each deployment, run the appropriate application checks at the reported URL.
A matching revision proves publication only. It does not prove authenticated behavior or private bucket settings.
For docs, run the read-only browser checks:

```sh
MINSKY_DOCS_URL=https://minsky-docs.icaic-minsky.workers.dev npm run docs:test
```

Record source revisions, run URLs, deployed versions, and observed results in `docs/current-state.md`.
The new guarded Cloudflare deployment path remains unverified on hosted resources during parallel preparation.

## Pause, retry, and recover

Set `CLOUDFLARE_DEPLOY_ENABLED=false` to pause future app and docs deployments.
Cancel jobs already publishing separately.
Correct the target or backend problem before enabling publishing again.
Rerun the latest approved push run. Old revisions and deleted branches skip uploads.
If one job succeeds and the other fails, inspect both summaries before retrying.

Do not switch the backend variable to `supabase` to repair a Cloudflare application.
The binding guard rejects that assets-only replacement.
Use the [activation recovery procedure](activate-cloudflare-development.md#recover-a-failed-activation) and retain the new installation's records.

To retire a docs branch preview, use its exact name from the run summary and the Cloudflare dashboard.
Branch deletion does not remove previews automatically.
No additional paid upgrade is part of this preparation.
