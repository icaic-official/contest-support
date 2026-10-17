# Why frontend previews share backend limits

Cloudflare hosts Minsky's static frontend. Supabase stores its accounts, issues, history, awards, and images.
A new frontend preview changes the website assets. It does not copy the Supabase database.
The selected build variables point previews at the existing Minsky development project.
An authenticated action in a preview therefore changes that project's shared data.
The isolated CI project remains reserved for automated fixtures.

## Why an app preview can load but reject function calls

The `admin` and `attachments` functions check `ALLOWED_ORIGINS` against the browser's origin.
A new preview address does not appear in that list automatically.
The page can load while account and image requests fail.
The [setup guide](cloudflare-builds.md#enable-account-and-image-checks-on-an-app-preview) includes origin registration before those checks.

A proposed improvement is a reviewed registry of app preview origins.
An operator-controlled process could synchronize approved entries to the development functions and remove them when previews retire.
That process needs separate backend changes and authorization tests.
The current work does not implement it or broaden the functions' accepted origins.

## Why merges deploy frontends but not backend changes

The selected Workers Builds commands publish static assets only.
They do not apply SQL migrations or deploy Supabase functions.
A frontend that depends on a new backend contract needs that backend in place before the frontend deploys.
The release procedure can pause automatic app builds when deployment order needs coordination.

Cloudflare starts builds after pushes to its connected repository.
With preview builds enabled, branch pushes update previews and pushes to `main` deploy the stable sites.
A branch that exists only on a local computer triggers nothing.
Cloudflare documents this behavior in its [branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

The new preview model gives a branch a stable preview URL and each deployment its own URL.
The [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) adds preview links to its build results.
Outside-fork behavior remains unverified for this repository.

## Why existing CI still matters

Workers Builds does not wait for the repository's GitHub Actions jobs.
The existing project workflow requires passing checks before the user merges.
This setup does not configure or establish remote branch protection.
A successful static build alone does not verify the authenticated contest workflow.
