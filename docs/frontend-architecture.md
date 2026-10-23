# Frontend architecture

This page describes how the T0015 frontend is organized.
It records the foundation (step 1 of T0015) and the three layouts that replaced the placeholders: the organiser phone app, the organiser desktop console and the contestant app.
It also records the step 5 integration with `main` on 2026-10-18: the backend contracts and the T0009 jury rules.
See [T0015](tickets.md#t0015--organiser-and-contestant-frontend-redesign) for scope and decisions.

## Stack

The frontend uses React 19, TypeScript and Vite.
The redesigned screens use these parts:

- **Tailwind CSS v4** through `@tailwindcss/vite`. The entry stylesheet is `src/index.css`. It scans only `src/` for class names (`source(".")`). Put class names only in files under `src/`.
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
The image preview page still uses Public Sans from `public/fonts/`, through `src/styles.css`.

`src/lib/theme.ts` stores the light, dark or device theme choice in local storage.
`applyTheme()` runs in `src/main.tsx` before the first render. `ThemeToggle` in `src/components/theme-toggle.tsx` lets a person change the theme.

## Older workflow styles

`src/styles.css` holds the styles of the workflow screens from before T0015.
Every rule applies only inside an element with the `legacy-ui` class.
`src/index.css` imports the file into the `legacy` cascade layer. That layer is above Tailwind's base styles and below shadcn components and Tailwind utilities.
Thus the older element rules, such as `button` and `input`, cannot change shadcn components outside `.legacy-ui`.

Do not put shadcn components inside a `.legacy-ui` element.
No workspace screen uses `legacy-ui` any more. Only the image preview page (`src/connected/imagePreview.tsx`, `image-preview.html`) still uses it.
The plan was that step 5 of T0015 removes the rules that the preview page does not use.
This did not occur. On 2026-10-18, `src/styles.css` still has all 1,748 lines, and the Public Sans font in `public/fonts/` is still part of the build.
The removal is a follow-up. Before you remove a rule, check the preview page in the browser.

## Backend access

The frontend does not call Supabase directly.
Hooks, `SignIn`, `PasswordForm`, `useSessionAdmin` and `useIssueImages` call `requireBackend()` from `src/backend/index.ts`.
That function returns the `Backend` from `src/backend/contracts.ts`, or it throws the setup message when `.env.local` has no public connection settings.
The current implementation is in `src/backend/supabase/`. See [backend contracts](backend-contracts.md).
The old `src/connected/client.ts` was removed on `main` and is not part of T0015.

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
| `user` | The `AccountIdentity` from `src/backend/contracts.ts`: `id`, with optional `email` and `name`. |
| `username` | The organizer-assigned username, or `null` for an older email login. |
| `data` | The `SessionData` from `useSessionSnapshot`. |
| `changePassword()` | Opens the voluntary password change screen. |
| `signOut()` | Signs out. |

Each shell calls `useWorkflowState(data)` once. It calls it above any layout switch.
Thus a pending request and the selected issue stay the same when the viewport changes.

## Data hooks

All hooks are in `src/connected/hooks/`.
They contain the data behavior that existed in `ConnectedApp.tsx` before T0015. The behavior did not change.
Since the step 5 merge, they call the `Backend` contracts through `requireBackend()`.

| Hook | Responsibility |
| --- | --- |
| `useAuthSession()` | Uses `requireBackend().auth`. Restores the stored session and follows sign-in and sign-out. Returns `user`, `loading`, `error` and `signOut`. |
| `useAccountStatus(userId)` | Reads `account_status` every 10 seconds and on focus. Returns `account`, `error` and `recheck()`. |
| `useSessionSnapshot(userId)` | Loads memberships, the session list and the selected snapshot. Reads run in sequence. A generation counter discards responses for an earlier session. It refreshes on Realtime changes, every 10 seconds, on focus and when the browser is online again. It clears the snapshot after an error. It records the server clock offset. |
| `useCommand({ sessionId, refresh, onRecorded })` | Runs workflow commands one at a time. A second click while a command runs does nothing. After a transport failure, the command keeps its request UUID until `retry()`. A server rejection clears it. `onSuccess` clears the form before the refresh, including after a retry (T0012). |
| `useWorkflowState(data)` | Combines `useCommand` with the selected issue and the status filter. A recorded command selects its issue when the person did not choose an issue while it ran. That selection does not count as the person's choice. A reopened issue sets the filter to `claimed`. |
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
| `PhoneTabs.tsx` | The Queue, Mine, Find, Awards and Me tabs. |
| `PhoneSessionTab.tsx` | The Session tab for admins. It puts the admin parts from `src/organiser/admin/` on one page, with one sheet for a new account or one account. |
| `PhoneIssueView.tsx` | The full-screen issue view with the bottom action bar and its sheets. |

Shared organiser parts are one level up, so the desktop console can use them:

| File | Content |
| --- | --- |
| `organiserModel.ts` | Pure rules: tabs by role, jury-only visibility, the T0009 award lists (`awardLists`) and openable issues (`openableIssues`), queue chips, sort order, age tiers, hall and table from a location, issue number search, the allowed actions of an issue and its primary action. `organiserModel.test.ts` tests them. |
| `components/issueDisplay.tsx` | Status badge (icon and label), place tile, unresolved timer, **Live** or **Reconnecting** badge, avatar and `AwardEvidence`. |
| `components/IssueDetails.tsx` | Timers, lifecycle bar, owner, handoff banner, award receipt, resolution history and activity. |
| `actions/IssueForms.tsx` | `ReplyForm`, `ResolveForm`, `EscalateForm`, `ReopenForm`, `AwardForm` and `ApplyForm`. Each form takes the issue, the `CommandRunner` and `onDone`. |
| `actions/ReportForm.tsx` | Report for a team, with `TeamSearch`. |
| `actions/OrganiserImages.tsx` | `ImageGallery`, `ImageUploadForm`, `ImagePreviewDialog` and `OrganiserImages`. They use `useIssueImages`. |
| `actions/ActionSheet.tsx` | `ActionSheet` (a vaul bottom sheet with a **Cancel** button) and `CommandFeedback` (the command error and **Retry last request**). `showCancel` hides **Cancel** when the content has its own **Done** button. `onClosed` runs after the closing animation. |
| `admin/adminModel.ts` | Pure admin rules: the username pattern, image limit bounds and steps, the membership draft (Staff or Team, roles, Admin), and the request inputs for the `Backend` admin contract. `createAccountCommand`, `setUsernameCommand` and `resetPasswordCommand` build an `AccountCommand`. `membershipInput` builds a `MembershipInput`. `imageLimitsInput` builds the image limits. `adminModel.test.ts` tests them. |
| `admin/useSessionAdmin.ts` | The admin requests through `requireBackend().admin`: intake, image limits, create account, set username, membership, password reset and removal. One request runs at a time (a ref guard). It holds the error, the notice and the one-time credentials. A recorded request refreshes the snapshot. |
| `admin/SessionSettings.tsx` | `StatusCounts` (icon and label per status), `IntakeSwitch` and `ImageLimitsForm` (number fields with labelled − and + buttons). |
| `admin/AccountForms.tsx` | `MembershipFields`, `CreateAccountForm`, `UsernameForm`, `MembershipForm` and `AssignByIdForm`. |
| `admin/CredentialReveal.tsx` | The one-time username and temporary password, with copy buttons and **Done**. |
| `admin/AccountAccess.tsx` | `AccountList`, `MemberActions` (username, membership, password reset and removal, with `ConfirmDialog`), `AdminFeedback`, `Collapsible` and `AdminActivity`. |

The forms do not depend on the sheet. The desktop console can put them in a dialog or a side sheet.
The admin parts take a `SessionAdmin` from `useSessionAdmin` or plain callbacks. The desktop console can use them on its admin pages.

These rules apply:

- Tabs follow the combined roles. Volunteers and specialists get Queue, Mine, Find and Me. Jury members get Awards. A jury-only member sees resolved issues only, as before T0015. Admins also get Session.
- The Awards tab shows the lists from `awardLists()`. See [Jury award lists](#jury-award-lists).
- The queue chips map to the shared status filter of `useWorkflowState`. Waiting is `open`, Handoffs is `escalated` and Resolved is `resolved`. Every other value, including `all` and `claimed` after a reopen, shows All active.
- Cards are sorted by unresolved time, longest first. The timer is neutral below 10 minutes, amber below 20 minutes and rose after that. A resolved issue stays neutral.
- A recorded command selects its issue, so the issue view opens. An inline **Claim** or **Accept** on a card returns to the list. **Claim and go** opens the issue.
- **Back** returns focus to the card of the issue. A tab change moves focus to the tab heading. Sheets trap focus and have a **Cancel** button, so no action needs a swipe. Buttons are at least 44 px high.
- A recorded command selects its issue only when the person did not change the selection while the command ran. Thus **Back** during the refresh after a command is not undone. An inline **Claim** or **Accept** uses the same check. When the person opens an issue while that command runs, the action does not close it.
- When the open issue leaves the person's lists, for example after a live reopen, the issue view closes. The status message "ISS-N is no longer in your lists." appears and focus moves to the page heading (`useLeftIssueNotice`, `issueThatLeft()`).
- An open sheet closes when its action is no longer allowed, for example after the person loses the jury role (`sheetAllowed()`).
- The Find tab keeps its query when the person goes back from a team.
- The Session tab keeps the behavior of the `AdminPanel` from before T0015: status counts, the intake switch, image limits (1–50 MB, 1–24 images, 1–120 MB), accounts, a username for accounts without one, membership changes, password reset (not for your own account), removal of session access, assignment by user ID and recent administration activity.
- A new account and a password reset show the credentials once, in the same sheet. If the admin closes the sheet while the request runs, the sheet opens again for the credentials. Closing the sheet discards them.
- A password reset and a removal need confirmation in a dialog. The text keeps the meaning of the earlier `window.confirm` text.
- A Team account needs a team. The form sends no staff roles and no Admin for it, as before.
- An error from a page control stays at the top of the scroll area, so it is visible near the form that failed. An error inside the sheet shows in the sheet.
- In an archived event, every admin control is disabled. `PhoneStatus` shows the archived banner.

`useIssueImages` (`src/connected/hooks/`) holds the upload, retry, preview and removal logic of `IssueImages`. `IssueImages` uses it with its existing markup.

## Organiser desktop console

`OrganiserDesktopConsole` (`src/organiser/desktop/`) is the organiser UI at 1024 px and wider. It follows `design/redesign/a-console.html`.
It uses the same hooks, rules and forms as the phone app. It adds no workflow rules of its own.

| File | Content |
| --- | --- |
| `OrganiserDesktopConsole.tsx` | The shell. It holds the page, the sidebar state, the sheet tab, the command palette, the report dialog, the queue team filter and the reply drafts. These stay in memory while the snapshot is missing. It also handles ⌘K or Ctrl+K and the J and K keys. |
| `ConsoleChrome.tsx` | `ConsoleSidebar` (session switcher, pages by role, intake switch for admins, person menu with **Change password**, **Documentation** and **Sign out**), `ConsoleTopBar` (sidebar button, breadcrumb, palette button, **Live** or **Reconnecting**, theme menu) and `CommandPalette`. |
| `QueuePages.tsx` | `QueuePage` (status cards, status tabs with counts, T0008 team filter, issue table), `MinePage`, `HandoffsPage`, `TeamsPage` and the shared `PageHeader`. |
| `IssueTable.tsx` | `IssueTable` (number, status with icon and label, report and category, team and location, owner, aging timer, **Claim** or **Accept**) and `StatCards`. |
| `IssueSheet.tsx` | The issue side sheet: timer cards, owner, lifecycle steps with times, handoff banner, actions, the Activity, Images and Outcome & award tabs and the reply composer. |
| `AwardReviewPage.tsx` | The lists from `awardLists()`: To decide, To apply and Applied. Each card shows `AwardEvidence` and has the award form or the confirmation form. |
| `AdminPages.tsx` | `OverviewPage`, `AccountsPage` (table, filter, **Create account** and **Manage** dialogs with the one-time credentials) and `SettingsPage` (intake, image limits, categories). |
| `consoleModel.ts` | Pure rules: pages by role, sidebar counts, queue tabs, status card numbers, category counts, award totals, owner workload and palette search. `consoleModel.test.ts` tests them. |
| `consoleProps.ts` | `ConsolePageProps`, which every page receives, and the heading id. |

Shared parts that the console added or changed:

- `actions/ActionDialog.tsx` is a centred dialog with the props of `ActionSheet`. The console uses it for resolve, escalate, reopen, report, accounts and image upload.
- `OrganiserImages` takes `surface="dialog"` to show the upload form in an `ActionDialog`.
- `ReplyForm` takes `layout="composer"`: the message first, then the audience switch and **Send**. Ctrl+Enter or ⌘+Enter sends in both layouts.
- `LifecycleBar` takes `details`. `lifecycleDetails()` gives the submission and first assignment times, "Requested" during a handoff and the resolution time.

These rules apply:

- The sidebar pages follow the combined roles. Volunteers and specialists get Queue, Assigned to me and Handoffs. Jury members get Award review. Every person gets Teams & tables. Admins also get Overview, Accounts and Session settings. Admins without support roles still get Queue. A jury-only member sees resolved issues only.
- The queue tabs use the shared status filter of `useWorkflowState`. Active is `all`, All is `everything` and the other tabs are statuses. The phone app shows All active for `everything`. A reopened issue sets `claimed`, so In progress shows it.
- Rows are sorted by unresolved time, longest first. The timer colors are the same as in the phone app.
- The issue number in each row is a button. Tab reaches it and Enter opens the sheet. A click on the row also opens it. J and K move focus between rows when no field or dialog has focus.
- **Claim** or **Accept** in a row stays on the page. When the person opens an issue while that command runs, the row action does not close it. **Claim** or **Accept handoff** in the sheet keeps the sheet open. A recorded report opens its issue in the sheet.
- When the sheet closes, focus goes back to the control that opened it, then to the issue row, then to the page heading. Radix returns focus only to a `Dialog.Trigger`, so the console moves focus itself. The sheet keeps the last issue on screen while it slides out.
- When the open issue leaves the person's lists, the sheet closes with the same status message as the phone app.
- The queue team filter and the **Report for a team** dialog keep separate team choices. The UI before T0015 shared one choice.
- The sheet shows one filled primary action from `primaryAction()`. Other allowed actions are outlined. **Decide award** and **Confirm applied** open the Outcome & award tab. Resolve, escalate and reopen open a dialog.
- The composer has **Public reply** and **Internal note**. An internal note has the amber striped surface. The draft clears only when the server records the message, also after **Retry last request** (T0012).
- The command palette finds issues by number (`31`, `#31`, `ISS-31`) or by report text from three characters, teams and tables with the T0008 search, pages and actions. A team opens the queue with that team filter. A jury-only member goes to Teams & tables instead.
- The intake switch in the sidebar and the admin pages share one `useSessionAdmin`, so one admin request runs at a time. Admin errors and notices show at the top of the page and in the open dialog.
- The sidebar choice (expanded or collapsed) is kept in local storage under `minsky:console-sidebar`.

## Jury award lists

T0009 added a separate jury worklist on `main`. See [the worklist specification](jury-worklist.md).
The step 5 merge moved its rules into the phone Awards tab (`AwardsTab` in `PhoneTabs.tsx`) and the desktop `AwardReviewPage`.
The legacy `src/connected/JuryWorklist.tsx` and its styles were removed.

`awardLists(state)` in `organiserModel.ts` uses `juryWorklists()` from `src/connected/jury.ts`. It gives three lists:

- **To decide**: resolved issues without an award, oldest resolution first.
- **To apply**: every award that waits for external application, oldest decision first. This includes zero-minute awards and awards on reopened issues.
- **Applied**: resolved issues with an applied award, latest confirmation first.

These rules apply:

- `AwardEvidence` shows the resolution summary of the award, the resolver and the time.
  When an issue with an award is not resolved, it shows a **Reopened** badge with the current status.
  When the award resolution was reopened, it also shows "This award relates to an earlier resolution."
- `openableIssues(state, member)` adds reopened issues with a pending award for a jury-only member. Thus that member can open the issue and confirm the application.
  The ordinary queue of a jury-only member still shows resolved issues only.
- The T0015 design differs from `docs/jury-worklist.md` in two ways.
  The desktop award and confirmation forms stay on the Award review cards.
  There is no separate **Jury worklist** sidebar entry and no **Back to jury worklist** button. The Award review page and the Awards tab are the worklist.

## Root elements

The root element of each layout has `data-ui="contestant"`, `data-ui="organiser-phone"` or `data-ui="organiser-desktop"`.
`tests/ui-selection.spec.ts` uses this attribute to check the UI selection. Keep it on the root element of each layout.

Put components that both organiser layouts use in `src/organiser/`.
Keep `IssueImages`, `TeamSearch`, `teamSearch.ts`, `model.ts`, `jury.ts` and the image modules. Restyle them only.
The legacy workspace (`src/connected/legacy/`) was removed with the desktop console.

## Local checks

`npm run dev` and `npm run test:e2e` need a development build of React.
If your shell sets `NODE_ENV=production`, unset it first. Otherwise the page stays blank with the error `$RefreshReg$ is not defined`.

Playwright 1.64 needs its matching Chromium build. If the default browser folder is not writable, set `PLAYWRIGHT_BROWSERS_PATH` to a writable folder and install Chromium there:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
npx playwright install chromium
```

`npm run build` reports a warning: the main JavaScript chunk is about 511 kB, above the 500 kB warning limit. The build still passes. Code splitting is a follow-up.
