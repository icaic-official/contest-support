# Configure Cloudflare builds

Use this guide to create branch previews and deploy both stable sites after merges to `main`.
The user selected this workflow on 2026-10-17.
The repository configuration is ready for review. The Git connections and first automatic builds remain unverified.

## Prepare the source

Prepare the repository before connecting either Worker:

1. Merge the reviewed T0011 files into `main` through the normal review process.
2. Update older feature branches from `main` before expecting documentation previews on those branches.
3. Check the [build settings](cloudflare-build-settings.md) for both Workers.
4. Read the [preview backend limits](cloudflare-preview-behavior.md) before testing app accounts or images.

Do not merge a frontend that requires backend changes until the compatible development backend is ready.
If the deployments need coordination, pause automatic app builds for that release.

## Connect each Worker to GitHub

Repeat these steps for `minsky-dev` and `minsky-docs`:

1. Open Cloudflare **Workers & Pages**.
2. Select the existing Worker in account `458ad6a930b0fb717796dfa19ca6a2b1`.
3. Open **Settings**, then **Build**.
4. Connect the `GiftedNovaHD/minsky` GitHub repository.
5. If GitHub requests authorization, grant the Cloudflare Workers & Pages App access to this repository.
6. Enter the commands and build variables from the [settings reference](cloudflare-build-settings.md).
7. Set the production branch to `main`.
8. In **Branch control**, enable **Preview Builds**.
9. Keep all source paths eligible if every branch push must trigger a build.
10. Save the settings and check the first build log.

Use the existing Workers. You do not need a permanent preview branch.
If Cloudflare offers **Set up Worker Previews**, review the existing configuration before switching.
Cloudflare states that this migration from its older preview model cannot be reversed.
See [Cloudflare branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

## Enable account and image checks on an app preview

After the preview build succeeds, prepare the function checks:

1. Copy the stable preview origin from the successful Cloudflare build.
2. Confirm that the app uses the Minsky development backend.
3. Have an authorized operator add the origin to the development functions' `ALLOWED_ORIGINS` secret.
4. Preserve every existing allowed origin when updating the secret.
5. Check any Auth URL settings required by the flow under test.
6. Use fictional development accounts to check account administration and both image visibility modes.

Use the complete origin, including `https://`, without a path.
Do not replace the origin list with a wildcard.
See [why preview origin setup remains separate](cloudflare-preview-behavior.md#why-an-app-preview-can-load-but-reject-function-calls).

## Verify automatic builds

Use one feature branch to check the complete build workflow:

1. Push a reviewed commit to an existing feature branch that contains both site configurations.
2. Check that both Cloudflare build logs identify that branch and commit.
3. Open the preview URLs from the build results.
4. Check a docs deep link, search, and a missing page.
5. Check the app's configured backend before testing its workflow.
6. Push another commit and check that each preview URL updates.
7. After the user merges, check the `main` builds and both stable URLs.
8. Record the source revision, deployment result, and observed checks in `docs/current-state.md`.

Use the preview URLs that Cloudflare returns. Do not guess their hostname format.
If a build fails, correct the failed step before retrying it.
To stop deployments, disable automatic builds in that Worker's build settings before a manual recovery deployment.
Keep the app and docs controls separate.

## Check the pending setup

Complete these checks before reporting the automation as active:

- Confirm that both Workers connect to the intended GitHub repository.
- Confirm that a branch push creates both previews.
- Confirm that another branch push updates the same preview URLs.
- Confirm that a merge triggers both stable deployments.
- Confirm that app function requests accept the approved preview origin.

Check the account's build usage after enabling builds for every branch.
The user did not request a paid upgrade.
