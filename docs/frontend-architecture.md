# Frontend architecture

This page describes how the T0015 frontend is organized.
It records the foundation step (step 1 of T0015). Later T0015 steps replace the placeholder layouts.
See [T0015](tickets.md#t0015--organiser-and-contestant-frontend-redesign) for scope and decisions.

## Stack

The frontend uses React 19, TypeScript and Vite.
The redesigned screens use these parts:

- **Tailwind CSS v4** through `@tailwindcss/vite`. The entry stylesheet is `src/index.css`.
- **shadcn/ui** components, copied into `src/components/ui/`. They use Radix primitives from the `radix-ui` package.
- **lucide-react** icons, `class-variance-authority`, `clsx` and `tailwind-merge`.
- **cmdk** for command menus, **vaul** for phone drawers and **sonner** for toasts.

`components.json` configures the shadcn CLI. It uses the "New York" style with zinc colors.
The `@/` import alias points to `src/` in `tsconfig.json` and `vite.config.ts`.
`cn()` in `src/lib/utils.ts` joins class names and resolves conflicting Tailwind classes.

To add a shadcn component, run this command:

```sh
npx shadcn@latest add <component>
```

The CLI finds `deno.lock` and can try to install packages with Deno. If it does, install the packages with npm.
The CLI can also add the wrong `cn` import or the `next-themes` package.
After you add a component, check that it imports `cn` from `@/lib/utils` and uses `useTheme` from `@/lib/theme`.

## Design tokens and fonts

`src/index.css` defines the shadcn zinc tokens from `design/redesign/src/_shadcn-head.html`, in light and dark themes.
It adds tokens for issue states and age tiers.
Examples are `text-status-open`, `text-status-escalated`, `text-age-warn` and `text-age-critical`.
The `internal-surface` utility gives internal notes the amber striped surface from the mockups.
Always show a status with an icon or a label too. Do not use color alone.

The redesigned screens use **Inter** for text and **JetBrains Mono** for timers.
Both fonts come from `@fontsource-variable` packages and are part of the build. The app does not load fonts from a third-party server.
The older workflow screens still use Public Sans from `public/fonts/`.

`src/lib/theme.ts` stores the light, dark or device theme choice in local storage.
`applyTheme()` runs in `src/main.tsx` before the first render. `ThemeToggle` in `src/components/theme-toggle.tsx` lets a person change the theme.

## Older workflow styles

`src/styles.css` holds the styles of the workflow screens from before T0015.
Every rule applies only inside an element with the `legacy-ui` class.
`src/index.css` imports the file into the `legacy` cascade layer. That layer is above Tailwind's base styles and below shadcn components and Tailwind utilities.
Thus the older element rules, such as `button` and `input`, cannot change shadcn components outside `.legacy-ui`.

Do not put shadcn components inside a `.legacy-ui` element.
When a later step replaces a legacy screen, remove the CSS rules that no other screen uses.

## From sign-in to a UI

These steps occur in sequence:

1. `ConnectedApp` (`src/connected/ConnectedApp.tsx`) restores the session with `useAuthSession`.
2. Without a user, it shows `SignIn` (`src/screens/SignIn.tsx`).
3. `useAccountStatus` checks the account every 10 seconds and on window focus.
   If the password is temporary, `PasswordForm` (`src/screens/PasswordForm.tsx`) shows. The database also enforces this change.
4. `Workspace` (`src/connected/Workspace.tsx`) loads session data with `useSessionSnapshot` and selects the UI with `uiKindFor` from `model.ts`:
   - A membership with `team_id` gets `ContestantApp` (`src/contestant/ContestantApp.tsx`).
   - Every other membership gets `OrganiserApp` (`src/organiser/OrganiserApp.tsx`).
5. `OrganiserApp` uses `useMediaQuery(organiserDesktopQuery)`. At 1024 px and wider it shows `OrganiserDesktopConsole`. Below 1024 px it shows `OrganiserPhoneApp`.

Before the first snapshot, `Workspace` shows `NoSessionAccess` (`src/screens/NoSessionAccess.tsx`).
That screen shows a loading state, refresh errors, a **Refresh access** button and **Sign out**.

After a UI is selected, `Workspace` keeps that UI mounted when the snapshot disappears.
A refresh error or a session change can remove the snapshot. The shell then shows `NoSessionAccess` itself.
Its selection, filters and form drafts stay in memory. A shell must not unmount its state when `data.snapshot` is undefined.

## Shell contract

Each shell receives `ShellProps` from `src/connected/shell.ts`:

| Prop | Meaning |
| --- | --- |
| `user` | The Supabase user. |
| `username` | The organizer-assigned username, or `null` for an older email login. |
| `data` | The `SessionData` from `useSessionSnapshot`. |
| `changePassword()` | Opens the voluntary password change screen. |
| `signOut()` | Signs out. |

Each shell calls `useWorkflowState(data)` once. It calls it above any layout switch.
Thus a pending request and the selected issue stay the same when the viewport changes.

## Data hooks

All hooks are in `src/connected/hooks/`.
They contain the data behavior that existed in `ConnectedApp.tsx` before T0015. The behavior did not change.

| Hook | Responsibility |
| --- | --- |
| `useAuthSession()` | Restores the stored session and follows sign-in and sign-out. Returns `user`, `loading`, `error` and `signOut`. |
| `useAccountStatus(userId)` | Reads `account_status` every 10 seconds and on focus. Returns `account`, `error` and `recheck()`. |
| `useSessionSnapshot(userId)` | Loads memberships, the session list and the selected snapshot. Reads run in sequence. A generation counter discards responses for an earlier session. It refreshes on Realtime changes, every 10 seconds, on focus and when the browser is online again. It clears the snapshot after an error. It records the server clock offset. |
| `useCommand({ sessionId, refresh, onRecorded })` | Runs workflow commands one at a time. A second click while a command runs does nothing. After a transport failure, the command keeps its request UUID until `retry()`. A server rejection clears it. `onSuccess` clears the form before the refresh, including after a retry (T0012). |
| `useWorkflowState(data)` | Combines `useCommand` with the selected issue and the status filter. A recorded command selects its issue. A reopened issue sets the filter to `claimed`. |
| `useTeamSelection(sessionId, snapshot)` | Holds the team-search choice. A session change clears it. A snapshot without that team, or without staff access, also clears it. |
| `useNow(clockOffset)` | Returns the server-adjusted time every second for live timers. |
| `useMediaQuery(query)` | Returns whether a CSS media query matches. |

Use `command.locked` to disable workflow controls. It is true while a command runs or waits for a retry.
Show **Retry last request** while `command.pending` is set and `command.busy` is false.

`src/connected/labels.ts` holds the status names, the resolution summaries and the award minute presets.
Use these values in every UI so that the text stays the same.

## Where later steps plug in

The shells currently render `LegacyWorkspace` (`src/connected/legacy/`). This is the workflow UI from before T0015, with the same markup and selectors.
Its root element has `data-ui="contestant"`, `data-ui="organiser-phone"` or `data-ui="organiser-desktop"`.
`tests/ui-selection.spec.ts` uses this attribute to check the UI selection. Keep the attribute on the root element of each new layout.

| Step | Replace | Mockup |
| --- | --- | --- |
| Organiser phone app | `src/organiser/phone/OrganiserPhoneApp.tsx` | `design/redesign/e-organiser-phone.html` |
| Contestant desktop app | `src/contestant/ContestantApp.tsx` | `design/redesign/f-contestant-desktop.html` |
| Organiser desktop console | `src/organiser/desktop/OrganiserDesktopConsole.tsx` | `design/redesign/a-console.html` |
| Integration | Playwright selectors, `docs/manual-verification.md`, README | — |

Put components that both organiser layouts use in `src/organiser/` (for example, the sheets for reply, resolve and award).
When no shell uses `src/connected/legacy/` any more, delete that directory and `src/styles.css`.
Keep `IssueImages`, `TeamSearch`, `teamSearch.ts`, `model.ts`, `client.ts` and the image modules. Restyle them only.

## Local checks

`npm run dev` and `npm run test:e2e` need a development build of React.
If your shell sets `NODE_ENV=production`, unset it first. Otherwise the page stays blank with the error `$RefreshReg$ is not defined`.
