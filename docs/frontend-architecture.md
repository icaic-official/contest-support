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

## Contestant app

`ContestantApp` (`src/contestant/`) is the UI for team accounts. It is a desktop layout and has no phone layout. It needs a window that is at least 1024 px wide.

| File | Content |
| --- | --- |
| `ContestantApp.tsx` | The shell. It holds the selected report, the open report form and the drafts of reports, replies and reopen reasons. Navigation moves focus to the main heading. Errors and **Retry last request** show at the top of the report area and stay in view during scrolling. |
| `ContestantTopBar.tsx` | Event, session (a session menu when the team has more than one session), **Live** or **Reconnecting**, theme menu and the account menu with **Change password** and **Sign out**. |
| `ReportList.tsx` | The team's reports, newest first, with a status badge, timer, number, category and age. |
| `IssuePage.tsx` | The headline, report, unresolved timer, tracker, resolution cards, reopen form, award card, messages, images and the reply box. |
| `ReportForm.tsx` | Category tiles with one generic icon, the description (up to 2,000 characters) and the team's location. |
| `contestantView.ts` | Pure functions for the headline, the tracker steps, the filters and the message list. `contestantView.test.ts` tests them. |

These rules apply:

- The contestant UI shows only public history and images with team visibility. The server already omits internal notes and staff-only images for team accounts. `publicHistory()` and `teamImages()` filter them a second time.
- The history table has no type column. `conversation()` identifies workflow events by their fixed text, or by the timestamp of the related record when the text contains free input. All other entries show as chat messages.
- The timer uses `unresolvedTime()` from `model.ts`. It stops on resolution and continues on reopening. Resolved intervals are not counted.
- **Report an issue** is disabled with a reason when contestant intake is closed or the event is archived. Reply and reopen are not available in an archived event.
- The reply box sends with Enter and adds a line with Shift+Enter. The draft is cleared only when the server records the message, also after **Retry last request** (T0012).
- `IssueImages` gets only the team-visible images, with `staff={false}` and `canUpload={false}`. Its image list and preview dialog use Tailwind classes. The upload form is not restyled yet. The organiser steps restyle it. The old class names, such as `image-thumb`, stay because tests use them.

## Organiser phone app

`OrganiserPhoneApp` (`src/organiser/phone/`) is the organiser UI below 1024 px. It follows `design/redesign/e-organiser-phone.html`.

| File | Content |
| --- | --- |
| `OrganiserPhoneApp.tsx` | The shell. It holds the tab, the open issue, the report sheet and the reply drafts. The drafts stay in memory while the snapshot is missing. |
| `PhoneParts.tsx` | Tab bar, tab header with **Live** or **Reconnecting** and the intake state, the status banners and the queue card. |
| `PhoneTabs.tsx` | The Queue, Mine, Find, Awards, Me and Session tabs. |
| `PhoneIssueView.tsx` | The full-screen issue view with the bottom action bar and its sheets. |

Shared organiser parts are one level up, so the desktop console can use them:

| File | Content |
| --- | --- |
| `organiserModel.ts` | Pure rules: tabs by role, jury-only visibility, queue chips, sort order, age tiers, hall and table from a location, issue number search, the allowed actions of an issue and its primary action. `organiserModel.test.ts` tests them. |
| `components/issueDisplay.tsx` | Status badge (icon and label), place tile, unresolved timer, **Live**/**Reconnecting** badge and avatar. |
| `components/IssueDetails.tsx` | Timers, lifecycle bar, owner, handoff banner, award receipt, resolution history and activity. |
| `actions/IssueForms.tsx` | `ReplyForm`, `ResolveForm`, `EscalateForm`, `ReopenForm`, `AwardForm` and `ApplyForm`. Each form takes the issue, the `CommandRunner` and `onDone`. |
| `actions/ReportForm.tsx` | Report for a team, with `TeamSearch`. |
| `actions/OrganiserImages.tsx` | `ImageGallery`, `ImageUploadForm`, `ImagePreviewDialog` and `OrganiserImages`. They use `useIssueImages`. |
| `actions/ActionSheet.tsx` | `ActionSheet` (a vaul bottom sheet with a **Cancel** button) and `CommandFeedback` (the command error and **Retry last request**). |

The forms do not depend on the sheet. The desktop console can put them in a dialog or a side sheet.

These rules apply:

- Tabs follow the combined roles. Volunteers and specialists get Queue, Mine, Find and Me. Jury members get Awards. A jury-only member sees resolved issues only, as before T0015. Admins also get Session.
- The queue chips map to the shared status filter of `useWorkflowState`. Waiting is `open`, Handoffs is `escalated` and Resolved is `resolved`. Every other value, including `all` and `claimed` after a reopen, shows All active.
- Cards are sorted by unresolved time, longest first. The timer is neutral below 10 minutes, amber below 20 minutes and rose after that. A resolved issue stays neutral.
- A recorded command selects its issue, so the issue view opens. An inline **Claim** or **Accept** on a card returns to the list. **Claim and go** opens the issue.
- **Back** returns focus to the card of the issue. A tab change moves focus to the tab heading. Sheets trap focus and have a **Cancel** button, so no action needs a swipe. Buttons are at least 44 px high.
- The Session tab still shows the `AdminPanel` from before T0015 inside a `.legacy-ui` element. A later step replaces it.

`useIssueImages` (`src/connected/hooks/`) holds the upload, retry, preview and removal logic of `IssueImages`. `IssueImages` uses it with its existing markup.

## Where later steps plug in

The organiser shells currently render `LegacyWorkspace` (`src/connected/legacy/`). This is the workflow UI from before T0015, with the same markup and selectors.
Its root element has `data-ui="contestant"`, `data-ui="organiser-phone"` or `data-ui="organiser-desktop"`.
`tests/ui-selection.spec.ts` uses this attribute to check the UI selection. Keep the attribute on the root element of each new layout.

| Step | Replace | Mockup |
| --- | --- | --- |
| Organiser phone app (done, except the Session tab) | `src/organiser/phone/OrganiserPhoneApp.tsx` | `design/redesign/e-organiser-phone.html` |
| Contestant desktop app (done) | `src/contestant/ContestantApp.tsx` | `design/redesign/f-contestant-desktop.html` |
| Organiser desktop console | `src/organiser/desktop/OrganiserDesktopConsole.tsx` | `design/redesign/a-console.html` |
| Integration | Playwright selectors, `docs/manual-verification.md`, README | — |

Put components that both organiser layouts use in `src/organiser/` (for example, the sheets for reply, resolve and award).
When no shell uses `src/connected/legacy/` any more, delete that directory and `src/styles.css`.
Keep `IssueImages`, `TeamSearch`, `teamSearch.ts`, `model.ts`, `client.ts` and the image modules. Restyle them only.

## Local checks

`npm run dev` and `npm run test:e2e` need a development build of React.
If your shell sets `NODE_ENV=production`, unset it first. Otherwise the page stays blank with the error `$RefreshReg$ is not defined`.
