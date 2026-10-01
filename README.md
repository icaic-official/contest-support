# Minsky

Minsky explores a calmer way to handle technical problems during a contest: report an issue, dispatch help, track the handoff, and record a discretionary time award.

**This is a local workflow demo**, built with React, TypeScript and Vite. It uses fictional data and four simulated personas in one group-contest session. No cloud account or paid service is required.

## Run locally

Use Node.js 22.13+ within the 22.x release line, or Node.js 24 or newer, and npm. ESLint 10 requires this updated Node version range. From the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). Use one browser tab for the demo. Select a persona at the top of the page to explore the same local dataset.

| Command             | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Start the local development server                                  |
| `npm run build`     | Type check and build to `dist/`                                     |
| `npm run preview`   | Serve the production build locally                                  |
| `npm run typecheck` | Check TypeScript without emitting files                             |
| `npm run lint`      | Run ESLint                                                          |
| `npm test`          | Run focused domain and persistence tests                            |
| `npm run test:e2e`  | Run Chromium browser tests; starts its own Vite server on port 4173 |

Install the test browser once before running browser tests:

```sh
npx playwright install chromium
```

Playwright shares browser revisions across projects in `~/.cache/ms-playwright` on Linux. For headless-only testing, `npx playwright install chromium --only-shell` downloads only the headless shell; the full Chromium install also supports interactive debugging. Different Playwright versions may need different browser revisions.

On Linux hosts missing browser system libraries, use `npx playwright install --with-deps chromium` (may require administrator privileges). Dependency and browser installation require internet access.

## Try the journey

1. As **Team contestant · Team Aurora**, submit a Backend issue.
2. As **Volunteer · Sam Chen**, claim it, send a public reply and an internal note, then escalate.
3. As **Technical specialist · Dr. Maya Rao**, accept the handoff and resolve with a summary.
4. As **Jury · Alex Morgan**, record a whole-minute award with a public explanation.
5. As any staff persona, confirm the award was applied externally in the simulation.
6. Return to the contestant to see the decision and application status. Refresh to check persistence; use **Reset demo** to restore the fictional scenario.

Timers start at submission, record first assignment separately, and stop at resolution. Escalation retains the current owner until acceptance. Awards do not change an external contest clock.

## Demo limitations

Persona switching and hidden controls are not authentication or authorization. Data is stored under `minsky.demo.v1` in this browser's local storage, scoped to its origin. Use fictional information only. Clearing browser data removes progress. Persona selection and filters reset on reload. Concurrent tabs, devices, or users are not synchronized; keep one demo tab open. Storage failures are shown in the UI; unavailable or incompatible saved data requires an explicit reset.

There are no real accounts, uploads, notifications, cloud synchronization, CSV imports, shared-incident actions, or administration interfaces. Seed categories are configurable in `src/domain.ts`, with no category editor. This demo does not validate production security, offline operation, or capacity for 800 simultaneous users.

## Project guidance

- [Initial agreed plan](PLAN.md) — scope baseline; its historical run report describes that planning run only.
- [Agent working rules](AGENTS.md)
- [Demo specification](docs/demo-spec.md)
- [Longer-term product direction](docs/product-direction.md)
- [Development tickets](docs/tickets.md)
- [Current implementation and verification](docs/current-state.md)
- [Repeatable manual walkthrough](docs/manual-verification.md)

Development ticket T0001 uses `feature/t0001-local-demo`. The user reviews and merges the PR before the next ticket begins. Outage handling remains unresolved and must be revisited before scoping a connected backend.
