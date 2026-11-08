# Minsky

Minsky is a support desk for contests.
Teams report technical problems. Volunteers and specialists resolve them from one shared queue.
The jury records time awards, and staff confirm when an award reaches the contest's own clock.

Minsky runs on Cloudflare Workers, D1, R2, and Durable Objects. One installation can host many events.

**Project status.** Minsky is in development.
No production installation exists, and it has not been verified in a live contest or at its target of 800 simultaneous users.
It needs a network connection. No license has been chosen yet, so the code is not yet open for reuse.
[Feature status](site/src/content/docs/reference/status.md) lists what works and what is not built.

## What Minsky does

- Every report has a timer that starts on submission and survives a page refresh. The timer stops on resolution and resumes if the issue reopens, without counting resolved time.
- The issue owner stays responsible during a handoff until a specialist accepts it.
- Public replies and internal staff notes are separate. Contestants never see internal notes.
- Staff attach JPEG, PNG, and WebP images, and each image is either team-visible or staff-only.
- The jury records an award separately from the confirmation that staff applied it. Minsky does not change the external contest clock.
- A webmaster runs the site and creates events. Event admins create contests, accounts, and credential sheets. Contest intake follows a schedule, with a manual override.
- Contestants get one app that works on phones and laptops. Staff get a phone app below 1024 px and a desktop console at 1024 px and wider.

The [user and operator guides](https://minsky-docs.icaic-minsky.workers.dev) explain each of these tasks.

## Run the complete app locally

These steps run the real Worker on local D1, R2, and Durable Object emulation. You do not need a Cloudflare account.
You need Node.js 22.22 or later within 22.x, or Node.js 24 or later. Docker is not required.

```sh
npm ci
npx esbuild .lapiz/bootstrap.ts --bundle --platform=node --format=esm --packages=external --outfile=.lapiz/build/bootstrap.mjs --log-level=warning
npx vite build --outDir .lapiz/dist --emptyOutDir
PORT=8787 LAPIZ_PREVIEW_HOSTNAME=localhost:8787 node .lapiz/run.mjs
npx wrangler dev --config .lapiz/wrangler.preview.json --persist-to .lapiz/state --ip 127.0.0.1 --port 8787 --local-protocol https
```

The `run.mjs` step prints `username=webmaster temporary password=...` and saves the line in `.lapiz/state/admin.txt`.

1. Open <https://localhost:8787> and accept the warning for the self-signed certificate.
2. Select **Sign in**, then **Site sign-in**.
3. Enter the printed username and temporary password. Minsky then asks you for a new password.

To start again with empty data, delete `.lapiz/state/`.
Anyone who can read that folder or the start log can sign in as the webmaster, so use only fictional data.
This setup is for development only. Live updates have not been checked on it.

With [`lapiz.deploy.json`](lapiz.deploy.json), the same files run a preview on a Lapiz host, which supplies `PORT` and `LAPIZ_PREVIEW_HOSTNAME`.
On a Lapiz host, the start log shows the webmaster password on each start.
`npm run typecheck` does not check `.lapiz/bootstrap.ts`, because esbuild bundles it without type checks.

### Run only the frontend

`npm run dev` starts Vite at <http://127.0.0.1:5173>. The landing page loads, but sign-in fails because a plain Vite server has no API.
Copy the environment file first:

```sh
cp .env.example .env.local
npm run dev
```

If your shell sets `NODE_ENV=production`, unset it before `npm run dev` or `npm run test:e2e`. Otherwise the page stays blank.

## Install Minsky for a contest

Follow the [Cloudflare installation guide](site/src/content/docs/operators/installation.mdx). It needs your own Cloudflare account on the Workers Paid plan.
That guide creates the resources, applies the migrations, and creates the first webmaster.

## Commands

These commands run without cloud credentials:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend only. |
| `npm run build` | Check types and build static assets in `dist/`. |
| `npm run preview` | Serve the built assets. |
| `npm run typecheck` | Check TypeScript. |
| `npm run lint` | Run ESLint. |
| `npm test` | Run unit and script tests. Local D1 keeps its files in `/dev/shm` when `TMPDIR` is unset and `/dev/shm` has 512 MiB free, so commits do not wait for the disk. |
| `npm run ci` | Run the complete CI check: installs, types, lint, tests, both builds, audits, and the Gitleaks scan. Needs Node.js 22.23.4 or later for the docs build. |
| `npm run test:d1` | Run every D1 workflow case on local emulation. |
| `npm run test:auth` | Run account and permission tests on local D1. |
| `npm run test:auth:browser` | Check cookies, origins, and request protection with a local HTTPS Worker and Chromium. |
| `npm run test:auth:hash` | Measure the password hash cost in a temporary local Worker. |
| `npm run test:connector:runtime` | Run the complete connector on a temporary local HTTPS Worker. |
| `npm run test:connector:ui:local` | Run the complete React journey on local HTTPS and emulated bindings. |
| `npm run test:e2e` | Run every mocked browser test. See [the browser suite](CONTRIBUTING.md#run-the-mocked-browser-suite). |
| `npm run test:e2e:smoke` | Run `tests/landing.spec.ts` and `tests/journey.spec.ts`. |
| `npm run test:providers:list` | List the shared provider scenarios. |
| `node scripts/rollback-check.mjs` | Run the previous release's `npm run test:d1` against this checkout's migrations. Add `--base=<revision>` to name the release. |
| `npm run perf:reads` | Count D1 calls and rows for each API request, on a temporary local database. Add `-- --plan=base`, `-- --explain`, or `-- --out=<file.json>`. Compare saved records with `node scripts/compare-read-volume.mjs --base=<files> --head=<files>`. |
| `npm run perf:client` | Measure first load, heap, renders, and snapshot reads with a 500-issue queue. Set `PERF_RUNS` and `PERF_OUT=<file.json>`. |
| `npm run perf:size` | Print the raw, gzip, and Brotli size of each file in `dist/assets`. |
| `npm run perf:deletion` | Time the fence and rows step of a 2,000-issue event with 80,000 history rows and 140,000 outbox rows beside an equally large event, on a temporary local database. A failure or an interrupt removes the seeded rows. |
| `npm run docs:dev` | Start the documentation site. Needs Node.js 22.23.4 or later and `npm ci --prefix site`. |
| `npm run docs:build` | Build the site and check its local links and anchors. |
| `npm run docs:preview` | Serve the built site, including search. |
| `npm run docs:test` | Check navigation, search, and phone layouts with Chromium. Build the docs first. |

Before browser tests, run `npx playwright install chromium` once.
If the default browser folder is not writable, set `PLAYWRIGHT_BROWSERS_PATH` before the install and before each test run.

These commands connect to a Cloudflare account. Several of them change hosted data or deployments, so confirm the target first:

| Command | Purpose |
| --- | --- |
| `npm run cloudflare:install -- plan --settings=… --config=…` | Inspect an installation plan without changes. See the [installation guide](site/src/content/docs/operators/installation.mdx). |
| `npm run cloudflare:recover-admin -- --config <file> --username <name>` | Reset a webmaster password in the remote `DB` database that the Wrangler file names. Prints the temporary password once. See [the recovery procedure](site/src/content/docs/operators/installation.mdx#recover-a-webmaster-password). |
| `npm run cloud:hosting-login` | Sign in to Cloudflare with Wrangler. |
| `npm run load -- <command>` | Run a [load test](docs/run-load-tests.md) against an isolated installation: `site`, `setup`, `run`, `analytics`, and `cleanup`. |
| `npm run perf:deletion -- --remote --database=<name>` | Time the same deletion on a hosted database whose name starts with `minsky-preview`. Add `--cleanup=<run>` to remove what an earlier run left. |

These commands work only with the maintainers' own Cloudflare account. The hosted suites refuse any other target:

| Command | Purpose |
| --- | --- |
| `npm run deploy` | Build the app, apply new D1 migrations, and publish it. Workers Builds runs it on `minsky-dev` for each push to `main`. See [Workers Builds](docs/cloudflare-builds.md). |
| `npm run docs:deploy` | Build and publish the `minsky-docs` Worker, if Workers Builds cannot. |
| `npm run ci:worker` | Run the dry-run deploy of the `minsky-ci` Worker. |
| `npm run test:auth:hosted -- --account=… --database=…` | Run account cases on the isolated hosted D1 target. |
| `npm run test:auth:http -- --account=… --database=… --origin=…` | Check the isolated deployed authentication Worker. |
| `npm run test:connector:ui -- --config=… --account=… --database=… --origin=…` | Run the React journey against the isolated hosted application. |
| `npm run test:connector:workflow:hosted -- --config=… --account=… --database=…` | Run every workflow case on the isolated D1-only target. |
| `npm run test:connector:accounts:hosted -- --config=… --account=… --database=…` | Check account guards on the same target. |
| `npm run test:providers -- --provider=cloudflare --config=… --account=… --database=… --origin=…` | Run the [shared provider scenarios](docs/run-provider-tests.md) in a browser. |
| `npm run token:create -- <request.json> --out <file>` | Create a scoped Cloudflare API token for an agent task. See [API tokens for agents](AGENTS.md#api-tokens-for-agents). |
| `npm run token:list` | List the tokens that agents created. |
| `npm run token:delete -- <id>` | Delete a token that an agent created. |

## Repository layout

| Path | Contents |
| --- | --- |
| `src/backend/` | The `Backend` contract in `contracts.ts` and its Cloudflare client. |
| `src/connected/` | Account checks, workspace state, browser routes, and workflow retry protection. |
| `src/contestant/`, `src/organiser/`, `src/event/`, `src/site/` | The contestant app, the staff phone app and console, the event console, and the webmaster pages. |
| `src/screens/`, `src/components/` | The landing, sign-in, and password screens, and the shared UI components. |
| `src/server/` | The workflow rules and the Cloudflare and D1 adapters, with the D1 migrations in `adapters/d1/migrations/`. |
| `site/` | The documentation site. |
| `tests/` | Browser and connector tests. |
| `scripts/` | CI, deployment, load, and performance tools. |

## Documentation

- The [user and operator guides](https://minsky-docs.icaic-minsky.workers.dev) explain how to use and install Minsky. Their source is in `site/src/content/docs/`.
- The [developer documentation index](docs/README.md) lists the architecture, testing, and operations pages.
- The [roadmap](ROADMAP.md) states the project's goals and target stack.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request.

## License

No license has been chosen yet. Until one is added, the default copyright rules apply.
