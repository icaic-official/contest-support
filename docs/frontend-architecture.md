# Frontend architecture

This reference describes the shared frontend, its three layouts, and its browser routes.
T0015 provides the contestant desktop app, organiser phone app, and organiser desktop console.
PR #45 added browser routes and workflow retry protections to the redesigned shells.
See [T0015](tickets.md#t0015--organiser-and-contestant-frontend-redesign) and [T0021](tickets.md#t0021-fresh-cloudflare-development-installation) for the recorded scope.

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
Hooks, `SignIn`, `PasswordForm`, `useSessionAdmin`, `useIssueImages` and `AvatarProvider` call `requireBackend()` from `src/backend/index.ts`.
That function returns the `Backend` from `src/backend/contracts.ts`, or it throws the setup message when `.env.local` has no public connection settings.
The implementations are in `src/backend/supabase/` and `src/backend/cloudflare/`. See [backend contracts](backend-contracts.md).

## From sign-in to a UI

These steps occur in sequence:

1. `src/main.tsx` wraps `ConnectedApp` in `BrowserRouter`. `ConnectedApp` restores the session with `useAuthSession`.
2. Without a user, it shows `Landing` (`src/screens/Landing.tsx`) at `/` and `SignIn` (`src/screens/SignIn.tsx`) at every other path. See [Landing page](#landing-page).
3. `useAccountStatus` checks the account every 10 seconds and on window focus.
   If the password is temporary, `PasswordForm` (`src/screens/PasswordForm.tsx`) shows. The database also enforces this change.
4. `Workspace` (`src/connected/Workspace.tsx`) loads session data with `useSessionSnapshot`. It wraps the UI in `AvatarProvider`, which loads [profile pictures](#profile-pictures). It selects the UI with `uiKindFor` from `model.ts`:
   - A membership with `team_id` gets `ContestantApp` (`src/contestant/ContestantApp.tsx`).
   - Every other membership gets `OrganiserApp` (`src/organiser/OrganiserApp.tsx`).
5. `OrganiserApp` uses `useMediaQuery(organiserDesktopQuery)`. At 1024 px and wider it shows `OrganiserDesktopConsole`. Below 1024 px it shows `OrganiserPhoneApp`.

Before the first snapshot, `Workspace` shows `NoSessionAccess` (`src/screens/NoSessionAccess.tsx`).
That screen shows a loading state, refresh errors, a **Refresh access** button and **Sign out**.

After a UI is selected, `Workspace` keeps that UI mounted when the snapshot disappears.
A refresh error or a session change can remove the snapshot. The shell then shows `NoSessionAccess` itself.
Its selection, filters and form drafts stay in memory. A shell must not unmount its state when `data.snapshot` is undefined.

## Landing page

`Landing` is the public page at `/` for signed-out visitors. It links to `/sign-in` and to the published guides (`documentationUrl`). `signInPath` in `src/connected/navigation.ts` is the one address of the sign-in page.
`ConnectedApp` derives one `layout` value (`dashboard`, `centered` or `landing`) from the account state and the path. The layout sets the `<main>` classes, the floating theme toggle and the footer. The landing page has its own header and theme toggle.
The `steps` table in `src/screens/Landing.tsx` holds one row for each issue status, with the lifecycle text, the demo activity entry and the simulated seconds on the timer. The animated demo card and the lifecycle rail both read it.
The demo state is one step index and one tick. The card is decorative, so assistive technology skips it. With `prefers-reduced-motion: reduce` the demo does not run and shows the resolved issue.
The hero backdrop is the `hero-backdrop` utility in `src/index.css`.

## Browser routes

`src/connected/navigation.ts` maps browser paths to the existing pages and phone tabs.
The same authorized snapshot selects the interface and checks route access.

| Path | Screen and access |
| --- | --- |
| `/` | Signed out: the landing page. Signed in: opens `/issues` after account and session checks. |
| `/sign-in` | Signed out: the sign-in page. Signed in: opens `/issues` after account and session checks. |
| `/issues` | The current membership's issue queue or team reports. |
| `/issues/mine` | Assigned issues for support staff. |
| `/issues/handoffs` | Handoff issues for support staff. |
| `/issues/teams` | Team search, shown in the phone **Find** tab or desktop **Teams & tables** page. |
| `/jury` | Phone **Awards** or desktop **Award review** for a current jury member. |
| `/administration` | Phone **Session** or desktop **Overview** for a current session administrator. |
| `/administration/accounts` | Account administration for a current session administrator. |
| `/administration/settings` | Session settings for a current session administrator. |
| `/account` | Phone **Me**, or the **My account** settings page in the desktop console and the contestant app. `/account#security` opens the **Security** section and focuses **Current password**. |

Navigation controls update the address and browser history.
A signed-out visitor on any other path sees the sign-in page. Direct paths remain through sign-in and required password changes.
Reload retains the section and reads current session data.
A full reload discards unsent drafts, queue filters, and uncertain requests.
Browser Back and Forward restore the section.
The desktop console and the contestant app change the password in place, in the **Security** section of `/account`. The phone **Me** tab opens a full-screen form instead. Completion and cancellation of that form retain `/account`.

Route checks wait for a loaded snapshot with current membership.
An unavailable section returns to `/issues`.
The backend independently checks every read and write. A URL grants no permission.
Both deployment configurations serve the application entry for browser routes.
API paths keep their existing handler and source-file exclusions.
The routes require no binding, migration, secret, or provider setting change.

## Workflow request lifetime

`WorkflowRetryProvider` in `src/connected/WorkflowRetry.tsx` retains uncertain requests above the account-check gate.
Each request records the authenticated actor, original contest session, request ID, and command.
A transient account-check failure hides protected content and retains that metadata.
Recovery does not automatically repeat a write. The person must select **Retry last request**.
An explicit retry uses the original session even if access removal selects another session.
The server checks access to that original session and can reject the retry.

A successful command or definitive server rejection clears the pending request.
Signing out or changing the actor also clears it.
A transport failure retains the request ID, so the server can reject a duplicate write.
The metadata stays in memory. A full page reload discards it.
Late responses from an unmounted workspace cannot complete another request or run callbacks into old forms.

## Shell contract

Each shell receives `ShellProps` from `src/connected/shell.ts`:

| Prop | Meaning |
| --- | --- |
| `user` | The `AccountIdentity` from `src/backend/contracts.ts`: `id`, with optional `email` and `name`. |
| `username` | The organizer-assigned username, or `null` for an older email login. |
| `data` | The `SessionData` from `useSessionSnapshot`. |
| `changePassword()` | Opens the full-screen password change. Only the phone **Me** tab uses it. The console and the contestant app change the password on the account page. |
| `signOut()` | Signs out. |

Each shell calls `useWorkflowState(data)` once. It calls it above any layout switch.
Thus a pending request and the selected issue stay the same when the viewport changes.

## Data hooks

All hooks are in `src/connected/hooks/`, except `useAvatarUrl` and `useAvatarActions`, which are in `src/connected/Avatars.tsx`.
They share session data and workflow requests across the layouts.
They call the `Backend` contracts through `requireBackend()`.

| Hook | Responsibility |
| --- | --- |
| `useAuthSession()` | Uses `requireBackend().auth`. Restores the stored session and follows sign-in and sign-out. Returns `user`, `loading`, `error` and `signOut`. |
| `useAccountStatus(userId)` | Reads `account_status` every 10 seconds and on focus. Returns `account`, `error` and `recheck()`. |
| `useSessionSnapshot(userId)` | Loads memberships, the session list and the selected snapshot. Reads run in sequence. A generation counter discards responses for an earlier session. It refreshes on Realtime changes, every 10 seconds, on focus and when the browser is online again. It clears the snapshot after an error. It records the server clock offset. |
| `useCommand({ sessionId, refresh, onRecorded })` | Runs one workflow command at a time. It uses the actor-bound request from `WorkflowRetryProvider`. An explicit retry retains the original session, request ID, and command. `onSuccess` clears the originating form before refresh while that form remains mounted. |
| `useWorkflowState(data)` | Combines `useCommand` with the selected issue and the status filter. A recorded command selects its issue when the person did not choose an issue while it ran. An inline queue action does not select its issue. A reopened issue sets the filter to `claimed`. |
| `useAvatarEditor()` | The steps of changing the caller's own profile picture: choose, preview, save and remove. See [Profile pictures](#profile-pictures). |
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
| `ContestantApp.tsx` | The shell. It holds the selected report, the open report form and the drafts of reports, replies and reopen reasons. Navigation moves focus to the main heading. Errors and **Retry last request** show at the top of the report area and stay in view during scrolling. On `/account` it shows the [account page](#account-page) in a scroll container of its own, under the top bar. |
| `ContestantTopBar.tsx` | Event, session (a session menu when the team has more than one session), **Live** or **Reconnecting**, theme menu and the account menu with **My account**, **Change password** and **Sign out**. **Change password** opens `/account#security`. |
| `ReportList.tsx` | The team's reports, newest first, with a status badge, timer, number, category and age. |
| `IssuePage.tsx` | The headline, report, unresolved timer, tracker, resolution cards, reopen form, award card, messages, images and the reply box. |
| `ReportForm.tsx` | Category tiles with one generic icon, the description (up to 2,000 characters) and the team's location. |
| `contestantView.ts` | Pure functions for the headline, the tracker steps, the filters and the message list. `contestantView.test.ts` tests them. |

These rules apply:

- The contestant UI shows only public history and images with team visibility. The server already omits internal notes and staff-only images for team accounts. `publicHistory()` and `teamImages()` filter them a second time.
- The history table has no type column. `workflowEvent()` in `src/connected/historyEvents.ts` identifies workflow events by their fixed text, or by the timestamp of the related record when the text contains free input. `conversation()` shows all other entries as chat messages. The account page uses the same rule to count messages.
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
| `PhoneTabs.tsx` | The Queue, Mine, Find, Awards and Me tabs. The Me tab has the [profile picture](#profile-pictures) controls. |
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
- A recorded command selects its issue only when the person did not change the selection while the command ran. Thus **Back** during the refresh after a command is not undone. An inline **Claim** or **Accept** does not select its issue, so the issue view does not open and close. When the person opens an issue while that command runs, the action does not close it.
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
| `ConsoleChrome.tsx` | `ConsoleSidebar` (session switcher, pages by role, intake switch for admins, and the person card that opens `/account`), `ConsoleTopBar` (sidebar button, breadcrumb, palette button, **Live** or **Reconnecting**, theme menu) and `CommandPalette`. |
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
- **Claim** or **Accept** in a row stays on the page and does not open the sheet. When the person opens an issue while that command runs, the row action does not close it. **Claim** or **Accept handoff** in the sheet keeps the sheet open. A recorded report opens its issue in the sheet.
- When the sheet closes, focus goes back to the control that opened it, then to the issue row, then to the page heading. Radix returns focus only to a `Dialog.Trigger`, so the console moves focus itself. The sheet keeps the last issue on screen while it slides out.
- When the open issue leaves the person's lists, the sheet closes with the same status message as the phone app.
- The queue team filter and the **Report for a team** dialog keep separate team choices. The UI before T0015 shared one choice.
- The sheet shows one filled primary action from `primaryAction()`. Other allowed actions are outlined. **Decide award** and **Confirm applied** open the Outcome & award tab. Resolve, escalate and reopen open a dialog.
- The composer has **Public reply** and **Internal note**. An internal note has the amber striped surface. The draft clears only when the server records the message, also after **Retry last request** (T0012).
- The command palette finds issues by number (`31`, `#31`, `ISS-31`) or by report text from three characters, teams and tables with the T0008 search, pages and actions. A team opens the queue with that team filter. A jury-only member goes to Teams & tables instead.
- The intake switch in the sidebar and the admin pages share one `useSessionAdmin`, so one admin request runs at a time. Admin errors and notices show at the top of the page and in the open dialog.
- The sidebar choice (expanded or collapsed) is kept in local storage under `minsky:console-sidebar`.

## Account page

`AccountPage` is the settings page at `/account` for the signed-in person in the selected session.
The desktop console and the contestant app both render it. The caller provides the scroll container and the page padding.
The phone app keeps its own **Me** tab.

| File | Content |
| --- | --- |
| `src/connected/AccountPage.tsx` | The page header (avatar, name or team name, login, role badges and **Sign out**), the section nav, and the focus rules for `#section` addresses. It also exports `useOpenPasswordChange()`. |
| `src/connected/AccountSections.tsx` | One component for each section: Profile, Access, Sessions, Security, Appearance, Activity and Help. |
| `src/connected/accountModel.ts` | Pure rules: `accountKind()`, the role descriptions in `capabilityInfo`, the section list `accountSections`, `accountName()` and `accountActivity()`. `accountModel.test.ts` tests them. |
| `src/connected/historyEvents.ts` | `workflowEvent()`, which tells a workflow step from a message that a person wrote. |
| `src/screens/PasswordForm.tsx` | `PasswordChangeForm`, the password fields and their checks. The full-screen `PasswordForm` and the Security section both use it. |
| `src/lib/links.ts` | `documentationUrl`, the one address of the published guides. |
| `src/components/theme-toggle.tsx` | `themeOptions`, the one list of theme choices for every theme picker. |

These rules apply:

- The page shows only data that the account and the session snapshot already hold. It changes no profile data except the [picture](#profile-pictures). The name, the username and the account ID cannot be edited.
- `accountSections` gives the section order and the section nav. A team account has no staff roles. Its **Access** section describes what a team account can do. It shows no role badges and no link to **Accounts**.
- A session admin sees **Manage session accounts**. The link goes to `/administration/accounts`. The backend still checks every request.
- **Sessions** lists the sessions that the account can open. **Switch** is disabled while a workflow command runs. After the switch, the caller clears its own selection. The console passes `changeSession`. The contestant app passes `resetForSession`.
- **Security** changes the password in place. On success the fields clear and a status message shows. The person stays on `/account` and stays signed in. The Supabase adapter keeps the current session. The Cloudflare adapter replaces the login cookie and checks the new session. Thus the page does not check the account status again.
- An address with a fragment, such as `/account#security`, names a place inside the page. `useRouteFocus` then leaves focus to the page. `useSectionFocus` focuses and scrolls to the section. A router state from `focusRequest()` picks one control inside it. `useOpenPasswordChange()` uses this for **Change password** in the command palette and the contestant menu. It also works when the person is already on `/account`.
- **Activity** counts open work, resolutions and messages from the snapshot that the person can see. For staff, open work means unresolved issues that the person owns. For a team account, it means unresolved team issues. The list shows the five newest replies, internal notes and resolutions of this person. A team account never sees internal notes.
- The layout follows the width of the page, not of the window. The section nav stands beside the sections from 768 px of page width.

## Profile pictures

A picture belongs to an account, not to a session. The visibility rule is in [Avatars](backend-contracts.md#avatars). The server enforces it. The frontend shows what the server returns.

`Workspace` wraps both apps in `AvatarProvider`. The provider reads the pictures that the caller can see in the selected session and keeps one downloaded copy of each.

| File | Content |
| --- | --- |
| `src/connected/Avatars.tsx` | `AvatarProvider`, `useAvatarUrl(personId)` and `useAvatarActions()`. |
| `src/connected/avatarImages.ts` | `avatarMap()`, which maps each person ID to a picture, and `AvatarImageCache`. Neither uses React. `avatarImages.test.ts` tests them. |
| `src/connected/avatarPicture.ts` | Pure rules: the centered square, the encodings to try, the editor states and the state after a failed upload. `avatarPicture.test.ts` tests them. |
| `src/connected/imageUpload.ts` | `avatarBlob()`, which crops and encodes a chosen file in the browser. |
| `src/connected/hooks/useAvatarEditor.ts` | The editor state and its steps. |
| `src/connected/PictureEditor.tsx` | The file input, the preview dialog, the removal question, the status line and the alert. |

These rules apply:

- The provider calls `avatars.list(sessionId)` when the session or `SessionData.updates` changes, and every 10 seconds. A picture change sends no live signal, so the poll shows the change of another person. A failed read keeps the earlier list. A session change or lost access drops the list. An unchanged list keeps the same map object, so the avatars do not render again.
- Only the newest read or change sets the list. An upload and a removal set the list themselves. A read that started earlier then cannot bring back the old picture.
- `PersonAvatar` takes an optional `personId`. It shows the picture through `useAvatarUrl`, and it shows initials when the person has no picture, when the caller cannot see it, or when the browser cannot decode it. The picture has an empty `alt`, because the name stands next to it. A call site that has no person ID shows initials.
- `AvatarImageCache` downloads a picture when the first avatar on screen asks for it. Every other avatar of that picture shares its object URL. The avatar ID is the cache key. It changes on every upload, so a cached picture never goes stale. The cache revokes the URL of a picture that left the list, and all URLs when the session changes or the provider unmounts. After an upload the cache holds the encoded file, so the new picture needs no download.
- Pictures show in the account page header and **Profile** section, the console sidebar card, the phone **Me** tab, the issue owner in the queue table, the phone queue cards and the issue owner card, the activity entries, and the administration account lists and owner workload. The contestant app shows the picture of the team account on its account page only. The server never returns staff pictures to a team account. The top bar menu of the contestant app shows initials.
- An avatar belongs to the account, so the controls work in an archived event too.

The steps of a change are in `useAvatarEditor`. The state is one of `idle`, `preparing`, `preview`, `uploading`, `confirmRemoval` and `removing`.

1. **Change picture** opens the file picker. It is in the **Profile** section, on the header avatar and in the phone **Me** tab. The input accepts JPEG, PNG and WebP.
2. The browser checks the file with `checkImageFile`: the signature, a size of up to 2 MB and a successful decode. A failure shows an alert.
3. `avatarBlob` crops the middle square and encodes it as a JPEG of at most 512 by 512 pixels. It lowers the quality and then the size until the file fits `AVATAR_MAX_BYTES`. It fills the canvas with white first, because JPEG has no transparency. Decoding follows the EXIF orientation. The canvas keeps no metadata, so the new file has no EXIF or location data.
4. A dialog shows the encoded square and how it looks as a circle. **Save picture** uploads it.
5. Each chosen file gets one request ID. After an unknown outcome, such as a lost response, **Try again** sends the same bytes with the same ID, so the server stores one picture. A rejected or expired upload ends the attempt. The person then chooses the file again.
6. A success shows the toast "Profile picture updated." and shows the new picture at once.
7. **Remove picture** asks first. A success shows the toast "Profile picture removed." and returns to initials.

Controls are disabled while a step runs. After each step, focus returns to the control that began it. After a removal it goes to **Change picture**, because the **Remove picture** button is gone.

## Jury award lists

T0009 added a separate jury worklist on `main`. See [the worklist specification](history/t0009-jury-worklist.md).
The step 5 merge moved its rules into the phone Awards tab (`AwardsTab` in `PhoneTabs.tsx`) and the desktop `AwardReviewPage`.

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
- The T0015 design differs from the T0009 specification in two ways.
  The desktop award and confirmation forms stay on the Award review cards.
  There is no separate **Jury worklist** sidebar entry and no **Back to jury worklist** button. The Award review page and the Awards tab are the worklist.

## Root elements

The root element of each layout has `data-ui="contestant"`, `data-ui="organiser-phone"` or `data-ui="organiser-desktop"`.
`tests/ui-selection.spec.ts` uses this attribute to check the UI selection. Keep it on the root element of each layout.

Put components that both organiser layouts use in `src/organiser/`.
Keep `IssueImages`, `TeamSearch`, `teamSearch.ts`, `model.ts`, `jury.ts` and the image modules. Restyle them only.

## Local checks

`npm run dev` and `npm run test:e2e` need a development build of React.
If your shell sets `NODE_ENV=production`, unset it first. Otherwise the page stays blank with the error `$RefreshReg$ is not defined`.

Playwright 1.64 needs its matching Chromium build. If the default browser folder is not writable, set `PLAYWRIGHT_BROWSERS_PATH` to a writable folder and install Chromium there:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
npx playwright install chromium
```

`npm run build` reports a warning: the main JavaScript chunk is about 511 kB, above the 500 kB warning limit. The build still passes. Code splitting is a follow-up.
