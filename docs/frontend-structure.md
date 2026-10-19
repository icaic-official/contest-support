# Frontend structure and navigation

The React application separates its shared workspace from its feature screens.
The screens use the same backend contracts for Supabase and Cloudflare.
Provider SDKs and provider configuration remain outside the UI.

## Application shell

[`src/main.tsx`](../src/main.tsx) creates the browser router.
[`App.tsx`](../src/app/App.tsx) restores authentication and checks account access.
It requires temporary-password changes before it renders the workspace.
An invalid login or an account without membership cannot read session data.

[`Workspace.tsx`](../src/app/Workspace.tsx) owns the selected session, authorized snapshot, live connection, and workflow requests.
It retains request IDs after an uncertain write so an explicit retry cannot duplicate an action.
It also retains issue selection, filters, and report-panel state when the user changes sections.
Screen components receive that state and the existing operations through props.
There is no second polling loop, live connection, or workflow implementation for each screen.

## Feature modules

| Directory | Responsibility |
| --- | --- |
| [`src/features/issues/`](../src/features/issues/) | Queue, reports, issue details, image UI, and team search. |
| [`src/features/administration/`](../src/features/administration/) | Session settings, accounts, membership, and administration history. |
| [`src/features/account/`](../src/features/account/) | Account details and password changes. |
| [`src/features/authentication/`](../src/features/authentication/) | Username and password sign-in. |
| [`src/features/jury/`](../src/features/jury/) | Outstanding award decisions and external confirmations. |

`src/connected/` retains shared snapshot models, image validation used by both providers, and common UI helpers.
`src/backend/` selects the provider and defines its browser contracts.
`src/server/` contains shared workflow decisions and provider implementations.
See [backend contracts](backend-contracts.md) for those boundaries.

## Browser routes

| Path | Screen and access |
| --- | --- |
| `/` | Opens `/issues` after the account and session checks pass. |
| `/issues` | Issues visible to the current membership. |
| `/administration` | Administration for a current session administrator. |
| `/account` | The current user's sign-in details and permissions. |
| `/jury` | Worklists for a current jury member. |

Sidebar links update the address and browser history.
Direct links retain their path through sign-in and required password changes.
Reload restores the section and reads current data from the backend.
It does not preserve unsent form text or queue filters across a full reload.
Browser Back and Forward restore the selected section.
Navigation closes the phone menu and focuses the screen heading.
An unknown application path shows a page-not-found message.

Route checks wait for a loaded snapshot with current membership.
Members without administration or jury permission return to `/issues` when they request those paths.
The backend independently checks every read and write.
A URL grants no permission.

Both deployment configurations already serve the application entry for browser routes.
Cloudflare API paths retain their existing handler and source-file exclusions.
The route changes require no binding, migration, secret, or provider configuration change.

## Verification

`npm run test:e2e` checks direct routes through sign-in and reload, history, navigation focus, and permission changes.
It also checks retained issue state and uncertain workflow retries with fictional responses.
`npm run test:connector:ui:local` runs the complete React journey against local Cloudflare bindings.
Protected provider checks verify the complete hosted behavior on their isolated CI targets.
These checks retain their existing assertions, target guards, and scoped fixture cleanup.
