# Enable deployment after CI passes

Use this guide to publish both static Workers after GitHub Actions checks pass.
Branch pushes update previews. Pushes to `main`, including merges, update the stable sites.
Use the [settings reference](cloudflare-build-settings.md) for exact names and values.

## Prepare the two Workers

Complete these steps in the existing Minsky Cloudflare account:

1. Open **Workers & Pages**.
2. Select `minsky-dev`.
3. Under **Settings**, open **Builds**.
4. If automatic Git builds are connected, disable their automatic builds or disconnect the repository.
5. On the **Domains** tab, under **Worker URL**, turn on **Preview**.
6. Repeat the steps for `minsky-docs`.

Keep the stable `workers.dev` addresses enabled.
Enable preview routing in the dashboard before the first branch preview.
Do not deploy a feature branch to the stable Worker to change this setting.
The next `main` deployment preserves the setting through `preview_urls: true` in both Wrangler files.
See [Cloudflare preview routing](https://developers.cloudflare.com/workers/previews/custom-domains/).

## Add the GitHub settings

You need permission to manage repository Actions secrets and variables.
Complete these steps for `GiftedNovaHD/minsky`:

1. In Cloudflare, create an API token with the **Edit Cloudflare Workers** template.
2. Restrict the token to account `458ad6a930b0fb717796dfa19ca6a2b1`.
3. Open GitHub **Settings**, then **Secrets and variables**, then **Actions**.
4. Add the token as the repository secret `CLOUDFLARE_API_TOKEN`.
5. Add the repository variable `VITE_SUPABASE_URL` with `https://ovymmobupzowotvrywek.supabase.co`.
6. Add the repository variable `VITE_SUPABASE_PUBLISHABLE_KEY` with the development project's public key.
7. Add the repository variable `CLOUDFLARE_DEPLOY_ENABLED` with `true`.

Keep the token out of chat, Git, and frontend variables.
Use the Supabase publishable key or legacy `anon` key. Never use a service-role key or `sb_secret_` key.
`VITE_ENVIRONMENT` and the Cloudflare account ID are already set in the workflow.
The docs site requires no Supabase credentials.
See [Cloudflare token setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## Verify the T0011 preview first

Use the open T0011 branch before merging it:

1. Open **Actions**, then **Checks** in GitHub.
2. Select the latest successful **push** run for `feature/t0011-documentation-site`.
3. Select **Re-run all jobs** after adding the settings.
4. Wait for `checks`, `secrets`, and `dependencies` to pass.
5. Confirm that `deploy` publishes both Workers and passes both revision checks.
6. Open both URLs in the run summary.
7. Check a docs deep link, search, phone navigation, and a missing page.
8. Check that the app loads with its development backend settings.

Select the push run. Pull request runs never deploy.
Manual **Run workflow** dispatch runs the protected Supabase cloud job and does not publish either frontend.
If a newer commit exists, rerun that commit's push run. The deployment script skips old revisions.
A failed or cancelled prerequisite prevents deployment.

## Enable account and image checks on an app preview

Before testing account or image operations, register the app preview origin:

1. Copy the app preview origin from the successful run summary.
2. Confirm that the app uses the Minsky development backend.
3. Have an authorized operator add the origin to the development functions' `ALLOWED_ORIGINS` secret.
4. Preserve every existing allowed origin when updating the secret.
5. Check any Auth URL settings required by the flow under test.
6. Use fictional development accounts to check account administration and both image visibility modes.

Use the complete origin, including `https://`, without a path.
Do not replace the origin list with a wildcard.
See [why preview origins need separate setup](cloudflare-preview-behavior.md#why-an-app-preview-can-load-but-reject-function-calls).

## Review and merge T0011

Before the merge, confirm that the development backend matches the frontend revision.
The merged app includes `supabase/migrations/202610140001_attachment_fixes.sql` and its matching attachment function.
The latest recorded hosted attachment verification predates that correction.
Check the backend deployment record before enabling a stable app update.
If the backend is not ready, set `CLOUDFLARE_DEPLOY_ENABLED=false` before merging.
Complete the separate backend release before re-enabling deployment and rerunning the latest `main` push.
The automation publishes only static assets.

1. Review PR #29 and its latest CI results.
2. Have the user merge the approved PR into `main`.
3. Open the new `main` **Checks** run.
4. Confirm that all three prerequisite jobs pass before `deploy` starts.
5. Confirm that both stable URLs report the merged revision in `/minsky-revision.json`.
6. Run the read-only docs browser checks against the stable site.

```sh
MINSKY_DOCS_URL=https://minsky-docs.icaic-minsky.workers.dev npm run docs:test
```

Record the source revision, run URL, site URLs, and observed results in `docs/current-state.md`.
Update older feature branches from `main` before expecting them to use this workflow.
No permanent preview branch is needed.

## Stop or retry deployment

To pause future deployments, set `CLOUDFLARE_DEPLOY_ENABLED` to `false`.
Cancel any deployment already in progress separately.
Resolve the backend or hosting problem before enabling the variable again.
If an upload or revision check fails, inspect the `deploy` log.
Rerun the latest push run after correcting the problem.
The app and docs uploads are separate operations, so one can succeed before the other fails.

To retire a branch preview, copy its preview name from the run summary.
Delete that preview from each Worker in the Cloudflare dashboard after the branch no longer needs it.
Branch deletion does not delete Cloudflare previews automatically.
Check GitHub Actions and Cloudflare usage after activation.
No paid upgrade is part of this setup.
