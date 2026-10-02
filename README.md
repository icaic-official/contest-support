# Minsky
Minsky is a platform to help competition organizers triage technical problems during programming contests. Moreover, it also includes other helpful features such as:
- handing over to or bringing in other people/parties to provide extra assistance  
- ability to record time taken for problem resolution and award discretionary time extensions
- supporting modular roles and events  

## Problem
During previous iterations of international AI contests, when contestants face a technical problem, they usually raise a card or fill up a Google Form to alert an on-site competition volunteer to attend to them. 
While assisting the contestant(s), the volunteers also have to note down the problem, the time taken to triage and resolve the problem, and also additional information like photos. 
This is tedious and slows down the process of solving problems. 
Hence, Minsky was created in hopes of addressing some of these challenges. 

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
| `npm run test:e2e`  | Run Chromium browser tests. Starts its own Vite server on port 4173 |

Install the test browser once before running browser tests:

```sh
npx playwright install chromium
```

Playwright shares browser revisions across projects in `~/.cache/ms-playwright` on Linux. For headless-only testing, `npx playwright install chromium --only-shell` downloads only the headless shell. The full Chromium install also supports interactive debugging. Different Playwright versions may need different browser revisions.

On Linux hosts missing browser system libraries, use `npx playwright install --with-deps chromium` (may require administrator privileges). Dependency and browser installation require internet access.

## Try the journey

1. As **Team contestant · Team Aurora**, submit a Backend issue.
2. As **Volunteer · Sam Chen**, claim it, send a public reply and an internal note, then escalate.
3. As **Technical specialist · Dr. Maya Rao**, accept the handoff and choose a common resolution summary or Custom. “Resolved without comment” records that explicit public summary.
4. As **Jury · Alex Morgan**, choose 0, 5, 10, 15, 30 or 60 award minutes, or Custom for another non-negative whole number. A public explanation is required, including for zero-minute decisions.
5. As any staff persona, confirm the award was applied externally in the simulation.
6. Return to the contestant to see the decision and application status. Refresh to check persistence. Use **Reset demo** to restore the fictional scenario.

Timers start at submission, record first assignment separately, and stop at resolution. Reopening resumes accumulated unresolved time and excludes time spent resolved. Escalation retains the current owner until acceptance. Awards do not change an external contest clock.

Specialists can also claim open issues directly. **Volunteer + Technical specialist · Robin Ellis** has both roles under one identity and can accept another person's handoff. Owners cannot accept their own handoffs. A support role combined with jury membership has both capabilities; the five seeded personas do not include that combination.

Contestants can reopen their own team's resolved issues; any support helper can reopen a session issue. Enter a public reopening reason. The same issue and previous owner remain, earlier summaries stay visible, and a new resolution needs a new summary. Existing awards and application confirmations remain unchanged. The demo still permits only one award per issue.

## Demo limitations

Persona switching and hidden controls are not authentication or authorization. The demo stores data under `minsky.demo.v2` in this browser's local storage. Valid v1 progress migrates when v2 is absent; the v1 source remains untouched. Existing v2 data takes priority, including after reset. The browser scopes this storage to its origin. Use fictional information only. Clearing browser data removes progress. Persona selection and filters reset on reload. The demo does not synchronize concurrent tabs, devices, or users. Keep one demo tab open. The interface shows storage failures. Unavailable or incompatible saved data requires an explicit reset.

There are no real accounts, uploads, notifications, cloud synchronization, CSV imports, shared-incident actions, or administration interfaces. Seed categories are configurable in `src/domain.ts`, with no category editor. This demo does not validate production security, offline operation, or capacity for 800 simultaneous users.

## Project guidance

- [Initial agreed plan](PLAN.md) — scope baseline. Its historical run report describes that planning run only.
- [Agent working rules](AGENTS.md)
- [Demo specification](docs/demo-spec.md)
- [Longer-term product direction](docs/product-direction.md)
- [Development tickets](docs/tickets.md)
- [Current implementation and verification](docs/current-state.md)
- [Repeatable manual walkthrough](docs/manual-verification.md)

Development tickets T0001 and T0002 share `feature/t0001-local-demo` at the user's request. The user accepted the T0001 proof of concept. [T0002](docs/tickets.md#t0002--multiple-staff-roles-triage-and-reopening) implements multiple staff roles, support-staff triage, reopening by contestants/helpers, and validated v1 migration. UI redesign is deferred. The user still reviews and merges. Later tickets return to the normal workflow in [AGENTS.md](AGENTS.md). Outage handling remains unresolved and must be revisited before scoping a connected backend.
