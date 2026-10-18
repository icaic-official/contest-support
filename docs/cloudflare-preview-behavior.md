# Why deployment separates docs and application previews

GitHub Actions publishes reviewed revisions only after `checks`, `secrets`, and `dependencies` pass.
Independent Cloudflare Git builds could publish before those jobs finish or replace a full application with static assets.
Keep those builds disabled.

## Why app previews are disabled

A frontend preview can change shared data when it uses a stable backend.
Earlier Supabase previews used the development project directly.
The fresh-installation preparation stops automatic application previews in both backend modes.
Cloudflare previews receive no stable D1, R2, or Durable Object bindings.
A future preview implementation needs its own resources, credentials, fixture ownership, and cleanup checks.
That implementation is outside T0021.

Docs contain no authenticated application data.
Their branch previews remain independent and continue to use `minsky-docs`.

## Why backend selection needs a deployment guard

The browser selects its backend at build time through `VITE_BACKEND`.
The app deployment command sets that value from the explicit deployment setting.
A Cloudflare app also needs its API code, database, private image bucket, and live coordinator.
An assets-only upload would remove that application code and its bindings.

The Supabase upload path therefore inspects the deployed Worker before changing it.
If application bindings exist, it refuses the upload even when a repository variable is absent or changed.
The Cloudflare path validates the provider-generated config and exact hosted targets before publishing.
The same command checks the built revision and backend before upload.
After upload, it checks the published targets, live bindings, and anonymous rejection at the authentication API.

## Why docs and application jobs are independent

A broken app target must not block documentation publication.
Separate jobs share the same required CI checks but validate only their own settings.
One site can publish while the other fails. Each job reports its own revision and URL.

Neither publication result verifies authenticated behavior.
The installation and activation procedures require full application checks.
Migrations, bootstrap, and secret creation stay explicit provider operations.
The owner must approve the concrete backend switch even after the preparation PR merges.

## Why contributor pull requests do not publish

Pull request code can change build commands.
Pull request jobs receive no deployment credentials.
Publishing requires a trusted repository branch push from an actor other than Dependabot.
Repository write access remains a trusted publishing capability.
Passing checks does not replace review or establish remote merge enforcement.

See [deployment settings](cloudflare-build-settings.md) for exact events, variables, and commands.
