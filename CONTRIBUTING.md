# Contribute to Minsky

Use this guide to set up a checkout, change Minsky, and open a pull request.
You do not need access to any Cloudflare account for ordinary changes.

## Set up

1. Fork the repository and clone your fork.
2. Run `npm ci`.
3. To work on the documentation site, also run `npm ci --prefix site`.
4. To run browser tests, run `npx playwright install chromium`.
5. To use the app, follow [Run the complete app locally](README.md#run-the-complete-app-locally).

## Make a change

1. Start a branch from updated `main`. Name it `<type>/<title>`, for example `bugfix/race-request-fix`.
   The types include `bugfix`, `build`, `feature`, `style`, `refactor`, `perf`, `test`, `ci`, `chore`, and `docs`.
2. Implement the change and its tests. Test lifecycle transitions, ownership during a handoff, timestamps, persistence, awards, and external application status when your change touches them.
3. Update the affected guides in the same change.
4. Run the checks in the next section.
5. Open a draft pull request into `main` with [the pull request template](.github/pull_request_template.md). A maintainer reviews and merges it.

Write each commit message in this form, with the first letter of the type in capitals:

```text
[Type]: <description>

[optional body]

[optional footer(s)]
```

## Run the checks

Run these commands before you ask for a review:

```sh
npm run typecheck
npm run lint
npm test
npm run test:d1
npm run build
```

`npm run ci` runs the same checks that Workers Builds runs on each branch, and it adds audits and a Gitleaks scan. It needs Node.js 22.23.4 or later and a network connection, and its Gitleaks step supports only Linux x64.
If your change affects a screen, also run `npm run test:e2e` and `npm run test:connector:ui:local`.
If your change adds a D1 migration, also run `node scripts/rollback-check.mjs`.
The [README](README.md#commands) lists every command.

Browser suites and hosted suites do not run automatically. Hosted suites accept only the maintainers' isolated CI resources, so a maintainer runs them when a change needs them.

### Run the mocked browser suite

`npm run test:e2e` starts a Vite server, and Playwright routes each `/api` request to the Worker HTTP handlers in `src/server`.
UI specs use in-memory data from `tests/support/worker.ts`.
Workflow specs use the real Cloudflare services on a local D1 database from `tests/support/localWorker.ts`.
Identity and the live socket are simulated. A test fails if a page requests another host.

The server uses port 4173. To run two checkouts at the same time, give each one its own port:

```sh
PLAYWRIGHT_PORT=4401 npm run test:e2e
```

Outside CI, Playwright reuses a server that already listens on the port, so a shared port can test the other checkout's code.

## Follow the project rules

- Write TypeScript by the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), and state any deliberate exception in the pull request. The [code quality guide](docs/code-quality.md) lists the type rules.
- Write documentation by the [writing guide](docs/writing-guide.md).
- Keep provider code inside `src/backend/<provider>/` and `src/server/adapters/<provider>/`. Shared code uses the contracts in `src/backend/contracts.ts`. To add a provider, read [Add a backend provider](docs/add-provider.md).
- Write D1 migrations that only add tables, columns, or indexes. `npm test` and the deploy reject a migration that drops or renames schema.
- Use only fictional data in tests and examples. Test fixtures delete only their own records.
- Never commit a credential. `.gitignore` excludes `.env*` files, except `.env.example`, and `.dev.vars*` files.

The [agent rules](AGENTS.md) add rules for coding agents and for the maintainers' Cloudflare account. They also list the product behavior that every change must preserve.
