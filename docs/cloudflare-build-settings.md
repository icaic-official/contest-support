# Cloudflare build settings

This reference describes the selected settings for the two existing static Workers.
The dashboard setup remains unverified.
The [setup guide](cloudflare-builds.md) contains the procedure.

## Worker commands

Both builds run at the repository root.
The docs build depends on the root scripts, the locked Wrangler dependency, and the shared font.

| Setting | `minsky-dev` | `minsky-docs` |
| --- | --- | --- |
| Repository | `GiftedNovaHD/minsky` | `GiftedNovaHD/minsky` |
| Production branch | `main` | `main` |
| Root directory | Repository root | Repository root |
| Build command | `npm ci && npm run build` | `npm ci && npm ci --prefix site && npm run docs:build` |
| Deploy command | `npx --no-install wrangler deploy --config wrangler.jsonc` | `npx --no-install wrangler deploy --config wrangler.docs.jsonc` |
| Preview command | `npx --no-install wrangler preview --config wrangler.jsonc` | `npx --no-install wrangler preview --config wrangler.docs.jsonc` |
| Preview builds | Enabled | Enabled |

The commands use Wrangler `4.149.0` from the root lockfile.
The local CLI help confirms that this version supports `preview`.
The deploy commands use the assets created by the build command.
Cloudflare describes these fields in its [build configuration reference](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

## Build variables

These variables apply to both sites:

| Name | Value | Meaning |
| --- | --- | --- |
| `NODE_VERSION` | `22.22.1` | The Node.js version already checked with this repository. |
| `SKIP_DEPENDENCY_INSTALL` | `true` | The explicit `npm ci` commands control dependency installation. |

These additional variables apply only to the app:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://ovymmobupzowotvrywek.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The development project's public publishable key. |
| `VITE_ENVIRONMENT` | `development` |

The URL and publishable key become public browser assets.
A service-role key and database password are not valid frontend values.
The static frontend reads build variables during compilation. Runtime Worker variables do not replace them.
The docs site needs no Supabase variables.
Cloudflare documents Node.js selection and dependency installation in its [build image reference](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/).

## Preview configuration

Both Wrangler files contain `"previews": {}`.
These static sites have no separate Worker bindings or runtime secrets.
The top-level `assets` setting applies to the branch build.
Cloudflare documents these fields in its [Preview configuration reference](https://developers.cloudflare.com/workers/previews/configuration/).

The `preview_urls` field controls older version URLs. It does not replace the `previews` block.
The docs configuration retains `preview_urls: false`.
The existing `deploy:preview` npm script uses `versions upload`, the older mechanism.
The selected Git build commands use `wrangler preview`.

## Stable addresses

The stable app address is `https://minsky-dev.icaic-minsky.workers.dev`.
The stable docs address is `https://minsky-docs.icaic-minsky.workers.dev`.
Both Workers belong to account `458ad6a930b0fb717796dfa19ca6a2b1`.
Cloudflare's "production branch" setting names the deployment branch. Both Minsky sites remain development resources.
