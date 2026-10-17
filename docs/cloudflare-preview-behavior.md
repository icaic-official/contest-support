# Why CI controls Worker deployment

Minsky needs previews for branch work and stable sites after merges.
Both must use source that passed the repository checks.
GitHub Actions can express that dependency directly with `needs` in the same workflow.
A separate Cloudflare Git build starts independently and can publish before those checks finish.
For this reason, automatic Cloudflare Git builds must remain disabled for these two Workers.

The selected workflow rebuilds the exact checked commit with the development app's public settings.
Tests and builds use committed dependency lockfiles.
The browser tests use mocked responses. They do not prove that the hosted backend matches a new frontend contract.
The frontend deployment does not replace the separate cloud integration tests.

## Why previews share development data

Cloudflare hosts Minsky's static frontend. Supabase stores its accounts, issues, history, awards, and images.
A new frontend preview changes website assets. It does not copy the Supabase database.
The selected build variables point previews at the existing Minsky development project.
An authenticated preview action therefore changes that project's shared data.
The isolated CI project remains reserved for automated fixtures.

## Why an app preview can load but reject function calls

The `admin` and `attachments` functions check `ALLOWED_ORIGINS` against the browser's origin.
A new preview address does not appear in that list automatically.
The page can load while account and image requests fail.
The [setup guide](cloudflare-builds.md#enable-account-and-image-checks-on-an-app-preview) includes origin registration before those checks.

A proposed improvement is a reviewed registry of app preview origins.
An operator-controlled process could synchronize approved entries to the development functions and remove them when previews retire.
That process needs separate backend changes and authorization tests.
This workflow does not implement the registry or broaden accepted origins.

## Why fork pull requests do not deploy

Public contributors can change build commands in a pull request.
Those commands must not receive credentials for Minsky's Cloudflare account.
Pull request jobs run checks without deployment credentials.
Publishing requires a branch push in `GiftedNovaHD/minsky` from an actor other than Dependabot.
Maintainers can copy reviewed external changes to a repository branch when they need a preview.

Users with write access to repository branches remain trusted publishers.
Passing tests does not prove that a branch's code is safe.
The repository's review rules still apply, and the user still merges changes.
This setup does not establish remote merge enforcement.

## Why backend deployment remains separate

The automatic commands publish static assets only.
They do not apply SQL migrations, deploy Supabase functions, or change backend secrets.
A frontend that depends on a new backend contract needs that backend in place before the frontend deploys.
Maintainers can pause frontend deployment through `CLOUDFLARE_DEPLOY_ENABLED` when the release needs coordinated steps.

App and docs uploads are separate operations.
If the second upload fails, the first site can already contain the new commit.
The run summary identifies each completed upload. A retry publishes the current branch revision again.
An old run cannot deliberately roll a branch back because the script checks the current commit before each upload.
A push that arrives during an upload can make that upload briefly outdated until the newer run completes.
