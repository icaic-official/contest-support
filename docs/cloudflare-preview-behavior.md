# Why deployment separates docs and application previews

On `minsky-ci`, Workers Builds runs checks and does not publish the application.
A Git build on `minsky-dev` could publish before checks finish or replace a full application with static assets.
Keep that build disabled.
The docs Worker `minsky-docs` is static and separate. Workers Builds publishes it from `main` and uploads preview versions for other branches.

## Why app previews are disabled

A frontend preview can change shared data when it uses a stable backend.
Earlier Supabase previews used the development project directly.
The fresh-installation preparation stops automatic application previews in both backend modes.
Cloudflare previews receive no stable D1, R2, or Durable Object bindings.
A future preview implementation needs its own resources, credentials, fixture ownership, and cleanup checks.
That implementation is outside T0021.

Docs contain no authenticated application data.
Workers Builds uploads a docs preview version for each push to a branch other than `main`.
Each preview targets `minsky-docs` and stays independent of the application.

## Why backend selection needs a deployment guard

The browser selects its backend at build time through `VITE_BACKEND`.
The app deployment command sets that value from `MINSKY_DEV_BACKEND`.
An absent deployment setting selects Cloudflare.
A Cloudflare app also needs its API code, database, private image bucket, and live coordinator.
An assets-only upload would remove that application code and its bindings.

The Supabase upload path runs only when `MINSKY_DEV_BACKEND=supabase`.
It inspects the deployed Worker before changing it.
If application bindings exist, it refuses the upload.
The Cloudflare path validates the provider-generated config and exact hosted targets before publishing.
The same command checks the built revision and backend before upload.
After upload, it checks the published targets, live bindings, and anonymous rejection at the authentication API.

## Why docs and application publication are independent

A broken app target must not block documentation publication.
Workers Builds publishes the docs from the `minsky-docs` Worker. The app publishes only through the guarded script.
One site can publish while the other fails. Each publication reports its own revision and URL.

Neither publication result verifies authenticated behavior.
The installation and activation procedures require full application checks.
Migrations, bootstrap, and secret creation stay explicit provider operations.
A later backend switch needs separate owner approval, even after its preparation PR merges.

## Why pushes and pull requests do not publish the application

Pull request code can change build commands.
`minsky-dev` is not connected to Workers Builds, so no push or pull request publishes the application.
The guarded script also rejects pushes by Dependabot.
Workers Builds uploads a docs preview version for each push to a branch in this repository. Preview versions receive no traffic.
A push to `main` publishes the docs. The docs contain no application data.
Repository write access remains a trusted publishing capability.
Passing checks does not replace review or establish remote merge enforcement.

See [deployment settings](cloudflare-build-settings.md) for exact events, variables, and commands.
