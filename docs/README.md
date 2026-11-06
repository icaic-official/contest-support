# Developer documentation

This index lists the pages for people who change or operate Minsky's code.
The [user and operator guides](https://minsky-docs.icaic-minsky.workers.dev) are on the documentation site, and their source is in [`site/src/content/docs/`](../site/src/content/docs/).

## Understand the system

| Page | Contents |
| --- | --- |
| [Product direction](product-direction.md) | What Minsky does, what it deliberately does not do, and what is agreed but not built. |
| [Frontend architecture](frontend-architecture.md) | Layout selection, routes, data hooks, access checks, and the design system. |
| [Cloudflare backend design](cloudflare-backend-design.md) | Why the Worker, D1, R2, and Durable Objects are arranged as they are. |
| [Webmaster, event, and contest platform](event-platform-design.md) | The design of one shared site, and the phases that are not built yet. Its [sketches page](event-platform-sketches.md) holds the type and migration sketches. |
| [Cloudflare authentication choice](cloudflare-authentication-choice.md) | Why Minsky uses Better Auth, and what the design costs. |
| [Scaling design](scaling-design.md) | Where one installation saturates under load, and which changes raise capacity. |

## Look up behavior

| Page | Contents |
| --- | --- |
| [Backend contracts](backend-contracts.md) | The provider interfaces and their behavior. |
| [Server workflow](server-workflow.md) | Workflow rules and the service and persistence boundaries. |
| [Session announcements](session-announcements.md) | Announcement behavior. |
| [Cloudflare authentication](cloudflare-authentication.md) | The authentication API and its rules. |
| [Provider test contracts](provider-test-contracts.md) | What the shared provider scenarios check. |

## Test Minsky

| Page | Contents |
| --- | --- |
| [Manual verification](manual-verification.md) | Workflow and interface checks that a person runs. |
| [Run the shared provider tests](run-provider-tests.md) | Hosted provider, store, and application checks, and fixture recovery. |
| [Verify Cloudflare authentication](verify-cloudflare-authentication.md) | Local and hosted authentication checks. |
| [Run a load test](run-load-tests.md) | A load test against an isolated installation. |

## Contribute and maintain

| Page | Contents |
| --- | --- |
| [Contribute to Minsky](../CONTRIBUTING.md) | Set up a checkout and open a pull request. |
| [Code quality](code-quality.md) | Type rules, dependency policy, and secret scanning. |
| [Writing guide](writing-guide.md) | Rules for documentation, pull requests, and commit messages. |
| [Add a backend provider](add-provider.md) | The interfaces and checks for a new provider. |
| [Run checks on Workers Builds](cloudflare-builds.md) | The maintainers' CI and publication triggers. |
| [Worker deployment and CI settings](cloudflare-build-settings.md) | The commands, limits, and target checks behind those triggers. |
| [Documentation release plan](documentation-release-plan.md) | The work that remains before a public release. |

## Measurements

These pages are dated records. They hold the evidence that the scaling and platform designs cite, and they do not describe the current code.

- [D1 read-volume baseline, 2026-10-26](measurements/read-volume-baseline-2026-10-26.md)
- [Scoped authority read gate, 2026-11-01](measurements/scoped-authority-gate.md)
