# Frontend architecture

This reference describes the frontend modules and browser routes.
The frontend has five UIs: the contestant app, the organizer phone app, the organizer desktop console, the event console, and the site dashboard.

## Stack

The frontend uses React 19, React Router, TypeScript, and Vite. It also uses these parts:

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

The CLI can also add the wrong `cn` import or the `next-themes` package.
After you add a component, check that it imports `cn` from `@/lib/utils` and uses `useTheme` from `@/lib/theme`.

## Design tokens and fonts

`src/index.css` defines the shadcn/ui New York zinc tokens, in light and dark themes.
It adds tokens for issue states and age tiers.
Examples are `text-status-open`, `text-status-escalated`, `text-age-warn` and `text-age-critical`.
The `internal-surface` utility gives internal notes and the staff-only composer an amber striped surface.

The screens use **Inter** for text and **JetBrains Mono** for timers.
Both fonts come from `@fontsource-variable` packages and are part of the build. The app does not load fonts from a third-party server.

`src/lib/theme.ts` stores the light, dark or device theme choice in local storage.
`applyTheme()` runs in `src/main.tsx` before the first render. `ThemeToggle` in `src/components/theme-toggle.tsx` lets a person change the theme.

## Interface rules

These rules apply to every UI:

- A status has an icon or a label too. Color alone does not carry it.
- A swipe or a drag has a button that does the same action. Every sheet has a **Cancel** button or its own **Done** button.
- A button on a phone width is at least 44 px high.
- A public reply and an internal note look different. The internal note has the amber striped surface.
- The elapsed time comes from saved timestamps. The time tier is neutral below 10 minutes, amber below 20 minutes, and rose after that.
- An award decision and its external application show as two separate steps.

## Backend access

The frontend does not call a provider directly.
Hooks, screens, and the event and site modules call `backend` from `src/backend/index.ts`.
`backend` is the Cloudflare client. It implements the `Backend` contract from `src/backend/contracts.ts`.
The implementation is in `src/backend/cloudflare/`. See [backend contracts](backend-contracts.md).

## From sign-in to a UI

These steps occur in sequence:

1. `src/main.tsx` wraps `ConnectedApp` in `BrowserRouter`. `ConnectedApp` restores the session with `useAuthSession`.
2. Without a user, it shows `Landing` (`src/screens/Landing.tsx`) at `/` and `SignIn` (`src/screens/SignIn.tsx`) at every other path. `/?event=<code>`, the link on a credential sheet, also opens `SignIn`. See [Landing page](#landing-page).
3. `useAccountStatus` checks the account on the [refresh schedule](#refresh-schedule) and on window focus.
   After a password reset, the session is no longer valid and a **Sign in again** card shows.
   If the password is temporary, `PasswordForm` (`src/screens/PasswordForm.tsx`) shows. The database also enforces this change.
4. `Workspace` (`src/connected/Workspace.tsx`) loads session data with `useSessionSnapshot`. It then applies these rules in order:
   - `/event` and `/event/<id>` show the [event console](#event-console).
   - A person with no contest goes to a page that does not need one. `useNoContestLanding` sends a webmaster to `/site` and an event admin to `/event`.
   - `/site` shows the [site dashboard](#site-dashboard).
   - `/` and `/sign-in` go to `/issues`.
   - Any other unknown path shows **Page not found** with a link to `/issues`.
   - A page that the membership cannot open goes to `/issues`.
5. For the remaining pages, `Workspace` wraps the UI in `AvatarProvider`, which loads [profile pictures](#profile-pictures). `Announcements` shows above the UI. `uiKindFor` from `model.ts` selects the UI:
   - A membership with `team_id` gets `ContestantApp` (`src/contestant/ContestantApp.tsx`).
   - Every other membership gets `OrganiserApp` (`src/organiser/OrganiserApp.tsx`).
6. `OrganiserApp` uses `useMediaQuery(organiserDesktopQuery)`. At 1024 px and wider it shows `OrganiserDesktopConsole`. Below 1024 px it shows `OrganiserPhoneApp`.

Before the first snapshot, `Workspace` shows `NoSessionAccess` (`src/screens/NoSessionAccess.tsx`).
That screen shows a loading state, refresh errors, a **Refresh access** button and **Sign out**.
After a failed connection it shows the error "Minsky could not reach the server. Check your connection and try again." Without a refresh error it asks the person to contact an organizer.
**Refresh access** stays disabled while its read runs.
For a webmaster, `WebmasterAccess` (`src/site/WebmasterAccess.tsx`) also lists the contests to join when the site restricts webmaster reads, and it links to the site dashboard.

After a UI is selected, `Workspace` keeps that UI mounted when the snapshot disappears.
A refresh error or a session change can remove the snapshot. The shell then shows `NoSessionAccess` itself.
Its selection, filters and form drafts stay in memory. A shell must not unmount its state when `data.snapshot` is undefined.

## Landing page

`Landing` is the public page at `/` for signed-out visitors. It links to `/sign-in` and to the published guides (`documentationUrl`). `signInPath` in `src/connected/navigation.ts` is the one address of the sign-in page.
`ConnectedApp` derives one `layout` value (`dashboard`, `centered` or `landing`) from the account state and the path. The layout sets the `<main>` classes, the floating theme toggle and the footer. The landing page has its own header and theme toggle.
The `steps` table in `src/screens/Landing.tsx` holds one row for each issue status, with the demo activity entry and the simulated seconds on the timer. The animated demo card reads it.
The demo state is one step index and one tick. The card is decorative, so assistive technology skips it. With `prefers-reduced-motion: reduce` the demo does not run and shows the resolved issue.
The hero backdrop is the `hero-backdrop` utility in `src/index.css`.

## Browser routes

`src/connected/navigation.ts` maps browser paths to pages and phone tabs.
The same authorized snapshot selects the interface and checks route access.

| Path | Screen and access |
| --- | --- |
| `/` | Signed out: the landing page. Signed in: opens `/issues` after account and session checks. |
| `/?event=<code>` | Signed out: the sign-in page with the event code filled in. |
| `/sign-in` | Signed out: the sign-in page. Signed in: opens `/issues` after account and session checks. |
| `/issues` | The current membership's issue queue or team reports. |
| `/issues/mine` | Assigned issues for support staff. |
| `/issues/handoffs` | Handoff issues for support staff. |
| `/issues/teams` | Team search, shown in the phone **Find** tab or desktop **Teams & tables** page. |
| `/jury` | Phone **Awards** or desktop **Award review** for a current jury member. |
| `/administration` | Phone **Session** or desktop **Overview** for a current contest admin. |
| `/administration/accounts` | The accounts of the contest for a current contest admin. |
| `/administration/roster` | The desktop **Team locations** page for a current contest admin. The phone has no separate page. Its **Session** tab holds the editors. |
| `/administration/settings` | The desktop **Session settings** page for a current contest admin. |
| `/account` | Phone **Me**, or the **My account** settings page in the desktop console and the contestant app. `/account#security` opens the **Security** section and focuses **Current password**. |
| `/event` | The event console of the caller's own event, for an event admin. |
| `/event/<id>` | The event console of one event, for its event admins and for webmasters. The server refuses everyone else. |
| `/site` | The site dashboard. The server refuses everyone except a webmaster. |

Navigation controls update the address and browser history.
A signed-out visitor on any other path sees the sign-in page. A direct path works only after sign-in and any required password change.
Reload retains the section and reads current session data.
A full reload discards unsent drafts, queue filters, and uncertain requests.
Browser Back and Forward restore the section.
The desktop console and the contestant app change the password in place, in the **Security** section of `/account`. The phone **Me** tab opens a full-screen form instead. Completing or cancelling that form retains `/account`.

### The contest in the address

Minsky writes `?contest=<contest ID>` to the address only for a person with more than one contest.
A person with one contest gets no parameter from Minsky. A used tab or an old link can still carry a stale one, and that stale value stays in the address.
The hook that holds the selection, `useSessionSnapshot`, is the only authority over the contest. The address never decides it.

- **Read.** The hook reads `?contest=` once, when it starts. It ignores the value when the history entry names another account as its owner. **The owner of the choice** below explains this rule. Its first read opens that contest only if the contest is in the list. Otherwise it opens the contest that takes reports now, or the next one. `defaultContest` in `src/connected/contestList.ts` makes that choice. An unlisted or malformed value never reaches a snapshot read or the live channel. The hook forgets the value after the first read succeeds. A failed first read keeps it, so a retry still uses it. A later loss of access then falls back to the default contest. If the list arrives and only the snapshot read fails, the hook still publishes the list and the contest that it chose. The no-access screen then shows the picker, so the person can leave that contest.
- **Write.** For a person with several contests, an effect copies the choice to the address after each change of contest. It uses `navigate` with `replace`, so it adds no history entry. It keeps every other parameter, the router state, and the hash that the router knows. It makes the signed-in account the owner in the router state. When the entry that the router shows already has the open contest but not this owner, the effect writes the owner only. The account page needs the hash and the state to place focus. `useSectionFocus` runs again only for a new hash or a new focus request, so this write takes no focus from a field. The skip links are the exception. `skipToFragment` writes a fragment, such as `#main`, with `pushState`, so the router does not see the new entry. Until a reload or Back shows that entry to the router, the next write drops the fragment: `/issues?contest=A#main` becomes `/issues?contest=B`.
- **Navigation in flight.** `BrowserRouter` renders a navigation in a transition, after `history` has written it. While the rendered path or search differs from `window.location`, the effect writes nothing, because a replace from the older location would overwrite the new entry. The effect runs again when the new location commits. It does not compare the hash, because the skip links write their fragment without the router. Only a production build shows the race with `<Navigate>`, because development StrictMode runs that effect a second time. `npm run test:connector:ui:local` checks those redirects on a production build.
- **Links.** Most links and redirects inside the app drop the parameter. The effect writes it to the new address when the navigation commits. Browser Back and Forward keep the current contest in the same way. Five writers keep the search: `ContestLink`, the account section links, the phone report screen, the phone password form of staff, and the two skip links. Each one builds its entry with `keepContest` or `skipToFragment` in `src/connected/navigation.ts`. Both helpers copy the owner of the current entry to the new entry. The effect cannot do that for them. It writes nothing for a person with one contest, it never sees a skip link entry, and the password form unmounts it.
- **The lint rule.** A rule in `eslint.config.js` sends each new writer to those helpers. In `src`, outside the backend and server code, it rejects an object literal with a `search` key, a JSX `href` that starts with `#` and does not use `skipToFragment`, and `pushState` or `replaceState` outside `navigation.ts`. The write effect has one exception comment, because its write makes the signed-in account the owner. The rule does not see a search that is joined into a string, or a whole location object that is passed to `navigate`.
- **A link to the open page.** React Router opens a link to the page that is already open by replacing the history entry. It tests that by comparing the link's address with the current one, search included. A plain `<Link to="/issues">` on `/issues?contest=A` is a different address, so each click would add an entry, and Back would land on the page it left. `ContestLink` (`src/connected/ContestLink.tsx`) adds the current search, with `?contest=`, to its path. It also copies the owner to its router state. The contestant top bar uses it for the brand link and **My account**, the two links that can point at their own page. Use it for any new link that can. A `navigate` call is not affected, because it always adds an entry.
- **The owner of the choice.** Each history entry names the account whose choice its `?contest=` holds. The name is the account ID under `contestOwner` in the router state. `contestOwnerOf` and `withContestOwner` in `src/connected/navigation.ts` read and write it. `keepContest` and `skipToFragment` copy it to a new entry. The browser keeps the router state with its entry, so the owner stays after a reload and after Back, and it needs no page storage. At its first read, the hook honors `?contest=` only when the entry names the signed-in account or names no account. Otherwise it opens the default contest. For a person with several contests, the write effect then puts that contest and the new owner in the entry. Nothing removes the parameter at a sign-out. So the sign-in page can show the earlier person's `?contest=`. The next person on the tab still starts from the default contest. That holds after a sign-out, after Back, after a reload, after a page load that finds the session ended, after a page load that returns to an older entry, and after another tab changes the account. An account that signs in again on an entry that names it opens its own choice. An address from outside the app has no owner. Examples are a shared link, a typed address and a bookmark. Such an address keeps its contest for whoever signs in, also in a tab that signed out. A link of the app that someone opens in a new tab or window is such an address too, because the browser does not copy the router state to the new tab. For a person with several contests, the hook then writes the owner in the new tab. A person with one contest gets no write from the hook, so an entry keeps the owner and the value that it had. So when a person with one contest is on an entry of another account's choice and opens a link in a new tab, the next person who signs in on that new tab opens that contest, if that person is seated in it. No test pins this case. A stale value is otherwise harmless, because the next load checks it against the list.

Route checks wait for a loaded snapshot with current membership.
An unavailable section returns to `/issues`.
The backend independently checks every read and write. A URL grants no permission.
`not_found_handling` in `wrangler.jsonc` serves the application entry for browser routes.

## Workflow request lifetime

`WorkflowRetryProvider` in `src/connected/WorkflowRetry.tsx` retains uncertain requests above the account-check gate.
Each request records the authenticated actor, original contest, request ID, and command.
A transient account-check failure hides protected content and retains that metadata.
Recovery does not automatically repeat a write. The person must select **Retry last request**.
An explicit retry uses the original contest even if access removal selects another contest.
The server checks access to that original contest and can reject the retry.

A recorded command shows its result from the command response. `useCommand` calls `executeAndRead`, and `useSessionSnapshot.applySnapshot` puts the returned snapshot in the same queue as the reads.
The server time decides which snapshot is newer. An older snapshot never replaces a newer one.
The hook reads the contest list and the snapshot again only when the response has no usable snapshot, or when the command is rejected or its result is unknown.
The live hint that the commit sends still refreshes every open screen, including the actor's screen.

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
| `canChangeUsername` | True when the account may change its own username. |
| `refreshAccount()` | Reads the username again, without the full account check screen. |
| `data` | The `SessionData` from `useSessionSnapshot`. |
| `changePassword()` | Opens the full-screen password change. Only the phone **Me** tab uses it. The console and the contestant app change the password on the account page. |
| `signOut()` | Signs out. |

Each shell calls `useWorkflowState(data)` once. It calls it above any layout switch.
A pending request and the selected issue then stay the same when the viewport changes.

## Data hooks

All hooks are in `src/connected/hooks/`, except `useAvatarUrl` and `useAvatarActions`, which are in `src/connected/Avatars.tsx`.
They share session data and workflow requests across the layouts.
They call the `Backend` contracts through `backend`.

| Hook | Responsibility |
| --- | --- |
| `useAuthSession()` | Uses `backend.auth`. Restores the stored session and follows sign-in and sign-out. Returns `user`, `loading`, `error` and `signOut`. |
| `useAccountStatus(userId, live)` | Reads `backend.auth.accountStatus()` on the refresh schedule and on focus. `live` is true while the live channel is connected. Returns `account`, `error` and `recheck()`. |
| `useSessionSnapshot(userId)` | Loads the session list in start order, the memberships and the selected snapshot. The first read opens the contest from `?contest=`, or the default contest. See [The contest in the address](#the-contest-in-the-address). Reads of one generation run in sequence. A change of contest or a remount starts a new generation, and the hook discards the responses of every earlier one. A read of the new generation does not wait for a read of an earlier one. So a read that hangs does not hold back the contest that the person has just chosen. A read that is stale when its list arrives reads no snapshot. It refreshes on live changes, on focus, when the tab becomes visible and when the browser is online again. It also follows the [refresh schedule](#refresh-schedule). Each tick also adds one to `SessionData.updates`, so announcements and pictures read again. It clears the snapshot after an error. It records the server clock offset. |
| `useCommand({ sessionId, refresh, onRecorded })` | Runs one workflow command at a time. It uses the actor-bound request from `WorkflowRetryProvider`. An explicit retry retains the original session, request ID, and command. `onSuccess` clears the originating form before refresh while that form remains mounted. `running` is the command that runs now, until its refresh ends, and `busy` is true while it is set. |
| `useWorkflowState(data)` | Combines `useCommand` with the selected issue and the status filter. A recorded command selects its issue when the person did not choose an issue while it ran. An inline queue action does not select its issue. A reopened issue sets the filter to `claimed`. |
| `useAvatarEditor()` | The steps of changing the caller's own profile picture: choose, preview, save and remove. See [Profile pictures](#profile-pictures). |
| `useTeamSelection(sessionId, snapshot)` | Holds the team-search choice. A contest change clears it. A snapshot without that team, or without staff access, also clears it. |
| `useNow(clockOffset)` | Returns the server-adjusted time every second for live timers. |
| `useMediaQuery(query)` | Returns whether a CSS media query matches. |
| `useIssueImages(options)` | The upload, retry, preview, and removal logic of issue images. |
| `useAnnouncements(data, manager)` | Reads and changes the announcements of one contest. See [session announcements](session-announcements.md). |
| `useContestAwards(sessionId, refresh)` | Runs the contest-wide award commands. A repeated command keeps its request ID until it succeeds. |
| `useRefreshOnReturn(reload, running)` | Reads again when the window regains focus or the tab becomes visible, unless a command runs. The event console and the site dashboard use it. |

Use `command.locked` to disable workflow controls. It is true while a command runs or waits for a retry.
Show **Retry last request** while `command.pending` is set and `command.busy` is false.

`src/connected/labels.ts` holds the status names, the resolution summaries, the award minute presets, and the parsers for the resolve comment and the custom award minutes.
Use these values in every UI so that the text stays the same.

## Contest picker

`ContestPicker` (`src/connected/ContestPicker.tsx`) is the one list of the contests that a person may open. It has three shapes. A menu behind a trigger button serves the contestant top bar and the console sidebar. Radio rows serve the phone **Me** tab. A select serves the no-access screen. That screen shows the select only after a read has chosen a contest, because a select with no matching row shows its first row.
`src/connected/contestList.ts` holds the rules. They use no React, so the hook can use them too.

- `orderContests` sorts by start time, then by ID. A contest with no schedule comes last, by name, then ID. `useSessionSnapshot` applies it once, so every consumer sees one order.
- `defaultContest` chooses the contest to open when the person has chosen none. Among contests with an open intake, it takes the first `running`, then the first `grace`, then the first with any other open reason. Otherwise it takes the first scheduled contest whose reason is not `ended` and whose `endsAt` is after now. A contest that staff hold closed or that waits for passwords stays eligible until its `endsAt`, and a past one does not, because those reasons never expire. The grace period is not part of `endsAt`. Otherwise it takes the scheduled contest with the latest `endsAt`, then the first listed.
- The hook passes `Date.now() + clockOffset.current` to `defaultContest`. This default is the only use of a clock in these rules. The offset comes from a snapshot, so it is 0 on the first read, and the first default uses the device clock. A wrong device clock can open another contest first, and it changes no permission.
- `contestRows` gives each row a name, a start time and a note. The name has the event name only when another listed contest has the same name. The start time is in the event's time zone. It gets a zone label only when the listed contests span more than one zone. It gets the year only when the listed contests start in more than one calendar year in their events' zones. A contest with no schedule has no start time.
- The note comes from `intake.reason` of the contest list. The server derives it for the person who reads: a contestant whose confirmed extra time runs on past the scheduled end sees `running` there, as the contest's own clock says, and so does `defaultContest`. Staff see the contest alone. The browser uses no clock for it. While the tab is visible, the list reads again at least every 60 seconds, so the note can be that old. A hidden tab skips those reads and reads once when the person returns.

| `intake.reason` | Note |
| --- | --- |
| `running` | Running now |
| `grace` | Intake open (grace period) |
| `override_open` | Intake open (set by staff) |
| `override_closed` | Intake closed (set by staff) |
| `awaiting_live_passwords` | Waiting for live passwords |
| `ended` | Ended |
| `before_start` | No note. The start time says it. |

The menu and the radio rows show the name on one line, and the start time and the note on a second line. The contest that runs now, which is the reason `running`, has a heavier second line. A contest in its grace period or one that staff hold open does not, although it takes reports, because its note says so in words. The select shows one line of text, for example `Live 1 · Tue 3 Nov, 13:00 · Running now`. The note is text in every shape, so color is never the only mark.
Long names break at any letter, so a name cannot widen a 320 px phone screen. `tests/contest-picker-layout.spec.ts` measures this for every shape.

## Refresh schedule

`startRefreshSchedule` (`src/connected/hooks/refreshSchedule.ts`) owns the timer for `useSessionSnapshot` and `useAccountStatus`.

| Live channel | Timer | Also refreshes on |
| --- | --- | --- |
| Connected | Every 60 seconds (`CONNECTED_REFRESH_MS`) | A live hint, window focus, the tab becoming visible, the browser coming online |
| Down or reconnecting | Every 10 seconds (`DISCONNECTED_REFRESH_MS`) | The same events, and at once when the channel drops or reconnects |

The timer is a safety net for changes that send no hint: a picture change, an announcement expiry, and a password reset.
The server also closes a socket when access is revoked, and the drop starts a refresh.
A hidden tab skips live hints and timer reads, and it reads once when it becomes visible.

A contest's schedule changes intake with no hint. `boundaryDelay` waits for the next `changes_at` time in server time and adds a random delay of up to 15 seconds, so that 800 clients do not read in the same second.

## Contestant app

`ContestantApp` (`src/contestant/`) is the UI for team accounts and single contestants. It is one responsive layout. At 1024 px and wider it shows the report list (`ReportsPane`) beside the report. Below 1024 px it shows one screen at a time: the home (`ReportsPane` with the clock, the report button and the list), one report, or the report form.

A bottom tab bar (`TabBar` in `src/components/tab-bar.tsx`, shared with the organizer phone app) has **Report**, **My reports** and **Account**. It hides while a text field has focus (`useTyping`). **Report** shows `ReportClosed` instead of the form when intake is closed. `useMediaQuery(desktopQuery)` selects the layout, and both layouts share the same components, state and drafts.

The reply box and the form buttons stick to the bottom of the scroll area on a phone. `index.html` sets `interactive-widget=resizes-content`, so an on-screen keyboard shrinks the page and keeps them in view. While a contestant types on a short phone screen, the announcement strip hides (`src/index.css`).

| File | Content |
| --- | --- |
| `ContestantApp.tsx` | The shell and `ReportsPane`. It holds the selected report, the open report form and the drafts of reports, replies and reopen reasons. Navigation moves focus to the main heading. Errors and **Retry last request** show at the top of the report area and stay in view during scrolling. On `/account` it shows the [account page](#account-page) in a scroll container of its own, under the top bar. The **Skip to report details** link shows only on the report pages, not on `/account`. |
| `ContestantTopBar.tsx` | The **Minsky** brand mark, which links to `/issues`, the event, the contest (`ContestPicker` when the team has more than one contest), **Live** or **Reconnecting**, the theme menu and the account menu with **My account**, **Change password** and **Sign out**. **Change password** opens `/account#security`. |
| `ReportList.tsx` | The team's reports, newest first, with a status badge, timer, number, category and age. |
| `IssuePage.tsx` | A plain-language headline, the report, the unresolved timer, the tracker (**Sent**, **Helper assigned**, **Resolved**, **Time award**), resolution cards, the reopen form, the award card, messages, images and the reply box. |
| `ReportForm.tsx` | Category tiles with one generic icon, the description (up to 2,000 characters) and the team's location. |
| `contestantView.ts` | Pure functions for the headline, the tracker steps, the filters and the message list. `contestantView.test.ts` tests them. |

These rules apply:

- The contestant UI shows only public history and images with team visibility. The server already omits internal notes and staff-only images for team accounts. `publicHistory()` and `teamImages()` filter them a second time.
- The clock (`ContestClock`) shows above the report button when the contest has a schedule. See [Contest clock, calendar, and contest-wide awards](#contest-clock-calendar-and-contest-wide-awards).
- The history table has no type column. `workflowEvent()` in `src/connected/historyEvents.ts` identifies workflow events by their fixed text, or by the timestamp of the related record when the text contains free input. `conversation()` shows all other entries as chat messages. The account page uses the same rule to count messages.
- The timer uses `unresolvedTime()` from `model.ts`. It stops on resolution and continues on reopening. It does not count resolved intervals.
- **Report an issue** is disabled with a reason when contestant intake is closed or the event is archived. Reply and reopen are not available in an archived event.
- The reply box sends with Enter and adds a line with Shift+Enter. The draft clears only when the server records the message, also after **Retry last request**.
- `IssueImages` gets only the team-visible images, with `staff={false}`. It shows the image list and the preview dialog with Tailwind classes. It has no upload form. Staff upload through `OrganiserImages`.

<a id="organiser-phone-app"></a>

## Organizer phone app

`OrganiserPhoneApp` (`src/organiser/phone/`) is the organizer UI below 1024 px.
The queue shows the oldest waiting issue with **Claim and go**, status chips, and cards. Each card shows the hall and the table first.
The issue is a full-screen view with a fixed bottom bar. The bar holds **Reply** and one primary action. Other actions are in the **More actions** sheet.

| File | Content |
| --- | --- |
| `OrganiserPhoneApp.tsx` | The shell. It holds the tab, the open issue, the report sheet, the report draft and the reply drafts. The drafts stay in memory while the snapshot is missing. Closing the report sheet keeps its draft. A contest change clears the drafts. |
| `PhoneParts.tsx` | `PhoneHeader` with **Live** or **Reconnecting** and the intake state, `PhoneStatus` with the status banners, and the queue card `IssueCard`. While a refresh error or a command error shows, the banners stay pinned to the top of the scrolling list. |
| `PhoneTabs.tsx` | The Queue, Mine, Find, Awards and Me tabs. The Me tab has the [profile picture](#profile-pictures) controls, `ContestPicker`, and `Calendar`. |
| `PhoneSessionTab.tsx` | The Session tab for admins. It puts the admin parts from `src/organiser/admin/` on one page, with one sheet for one account. |
| `PhoneIssueView.tsx` | The full-screen issue view with the bottom action bar and its sheets. |

Shared organizer parts are one level up, so the desktop console can use them:

| File | Content |
| --- | --- |
| `organiserModel.ts` | Pure rules: tabs by role, jury-only visibility, the award lists (`awardLists`) and openable issues (`openableIssues`), queue chips, sort order, age tiers, hall and table from a location, issue number search, the allowed actions of an issue, its primary action and the hint for a missing action (`missingActionHint`). `organiserModel.test.ts` tests them. |
| `components/issueDisplay.tsx` | Status badge (icon and label), place tile, unresolved timer, **Live** or **Reconnecting** badge, avatar and `AwardEvidence`. |
| `components/IssueDetails.tsx` | Timers, lifecycle bar, owner, handoff banner, award receipt, resolution history and activity. |
| `actions/IssueForms.tsx` | `ReplyForm`, `ResolveForm`, `EscalateForm`, `ReopenForm`, `AwardForm` and `ApplyForm`. Each form takes the issue, the `CommandRunner` and `onDone`. |
| `actions/ReportForm.tsx` | Report for one or more teams, with `TeamSearch` and **Add another team**. It sends one submit command per team. Every staff member can open it. The shell holds the description, the category and the added teams as a `ReportDraft`. The last recorded team clears the draft. |
| `actions/OrganiserImages.tsx` | `ImageGallery`, `ImageUploadForm`, `ImagePreviewDialog` and `OrganiserImages`. They use `useIssueImages`. |
| `actions/ActionSheet.tsx` | `ActionSheet` (a vaul bottom sheet with a **Cancel** button) and `CommandFeedback` (the command error and **Retry last request**). `showCancel` hides **Cancel** when the content has its own **Done** button. `onClosed` runs after the closing animation. |
| `admin/adminModel.ts` | Pure admin rules: the username pattern, image limit bounds and steps, `limitsOfSession`, `imageLimitsInput`, `setHandleCommand`, `accountKind`, `statusCounts`, and the audit text (`auditEntryText`, `actorName`). `adminModel.test.ts` tests them. |
| `admin/useSessionAdmin.ts` | The contest admin requests through `backend.manage`: intake, image limits, categories, team locations, username changes and password reissue. One request runs at a time (a ref guard). It holds the error, the notice and the one-time credentials. A recorded request refreshes the snapshot. Accounts and assignments belong to the [event console](#event-console). |
| `admin/SessionSettings.tsx` | `StatusCounts` (icon and label per status), `IntakePanel` (the intake state with **Open now**, **Close now**, and **Return to schedule**) and `ImageLimitsForm` (number fields with labelled − and + buttons). |
| `admin/RosterEditors.tsx` | `TeamLocationEditor` (one location form per team) and `CategoryEditor` (a draft list with move, remove and add, saved as a whole). The phone **Session** tab and the desktop pages share them. |
| `admin/rosterModel.ts` | Pure roster rules: name sorting, the issues that keep a category, category checks and `moveItem`. `rosterModel.test.ts` tests them. |
| `admin/AccountForms.tsx` | `UsernameForm`. It changes a username, or gives an account without one its first username. |
| `admin/CredentialReveal.tsx` | The one-time username and temporary password, with copy buttons and **Done**. |
| `admin/AccountAccess.tsx` | `AccountList`, `MemberActions` (username change and password reset, with `ConfirmDialog`), `AdminFeedback`, `Collapsible` and `AdminActivity`. |

The forms do not depend on the sheet. The desktop console puts them in a dialog or a side sheet.
The admin parts take a `SessionAdmin` from `useSessionAdmin` or plain callbacks.

These rules apply:

- Tabs follow the combined roles (`organiserTabs`). Volunteers and specialists get Queue and Mine. Jury members get Awards. Admins without a support role still get Queue. Every staff member gets Find and Me. Admins also get Session. A jury-only member sees resolved issues only.
- The Awards tab shows the lists from `awardLists()`. See [Jury award lists](#jury-award-lists).
- The queue chips map to the shared status filter of `useWorkflowState`. Waiting is `open`, Handoffs is `escalated` and Resolved is `resolved`. Every other value, including `all` and `claimed` after a reopen, shows All active.
- Cards are sorted by unresolved time, longest first. The timer is neutral below 10 minutes, amber below 20 minutes and rose after that. A resolved issue stays neutral.
- A recorded command selects its issue, so the issue view opens. An inline **Claim** or **Accept** on a card returns to the list. **Claim and go** opens the issue.
- **Back** returns focus to the card of the issue. A tab change moves focus to the tab heading. Sheets trap focus and have a **Cancel** button, so no action needs a swipe. Buttons are at least 44 px high.
- A recorded command selects its issue only when the person did not change the selection while the command ran. So **Back** during the refresh after a command stays in effect. An inline **Claim** or **Accept** does not select its issue, so the issue view does not open and close. When the person opens an issue while that command runs, the action does not close it.
- When the open issue leaves the person's lists, for example after a live reopen, the issue view closes. The status message "ISS-N is no longer in your lists." appears and focus moves to the page heading (`useLeftIssueNotice`, `issueThatLeft()`).
- An open sheet closes when its action is no longer allowed, for example after the person loses the jury role (`sheetAllowed()`).
- A staff member without a volunteer or specialist role sees one muted line under the buttons of the bottom bar. On an open issue it says why **Claim** is missing and that the person can still reply and add images. The bar then says that no one owns the issue. A jury member also sees one on a claimed or escalated issue, because only its owner or an admin can resolve it (`missingActionHint()`). A resolved issue and an archived event have no hint.
- The Find tab keeps its query when the person goes back from a team.
- The Session tab holds status counts, the intake panel, image limits (1 to 50 MB per file, 1 to 24 images, 1 to 120 MB in total), accounts, team locations, categories and recent administration activity. It links to the event console and the site dashboard for people with that authority.
- An account sheet changes the username and resets the password. Your own account has no password reset. A team account has no username form.
- A password reset needs confirmation in a dialog. The new credentials show once, in the same sheet. If the admin closes the sheet while the request runs, the sheet opens again for the credentials. Closing the sheet discards them.
- An error from a page control stays at the top of the scroll area, so it is visible near the form that failed. An error inside the sheet shows in the sheet.
- In an archived event, every admin control is disabled. `PhoneStatus` shows the archived banner.

`OrganiserImages` uses all of `useIssueImages`. `IssueImages` shows the images and the preview, and it uses the preview and removal logic.

<a id="organiser-desktop-console"></a>

## Organizer desktop console

`OrganiserDesktopConsole` (`src/organiser/desktop/`) is the organizer UI at 1024 px and wider.
It has a collapsible sidebar, a breadcrumb top bar, a command palette, a queue table, and an issue side sheet.
It uses the same hooks, rules and forms as the phone app. It adds no workflow rules of its own.

| File | Content |
| --- | --- |
| `OrganiserDesktopConsole.tsx` | The shell. It holds the page, the sidebar state, the sheet tab, the command palette, the report dialog, the report draft, the queue team filter and the reply drafts. These stay in memory while the snapshot is missing. It also handles ⌘K or Ctrl+K and the J and K keys. |
| `ConsoleChrome.tsx` | `ConsoleSidebar` (contest switcher, pages by role, intake switch and `EventLink` and `SiteLink` for admins, and the person card that opens `/account`), `ConsoleTopBar` (sidebar button, breadcrumb, palette button, **Live** or **Reconnecting**, theme menu) and `CommandPalette`. |
| `QueuePages.tsx` | `QueuePage` (contest-wide awards to confirm, status cards, status tabs with counts, team filter, issue table), `MinePage`, `HandoffsPage`, `TeamsPage` and the shared `PageHeader`. |
| `IssueTable.tsx` | `IssueTable` (number, status with icon and label, report and category, team and location, owner, aging timer, **Claim** or **Accept**) and `StatCards`. `queueSort.ts` holds the sort order. |
| `IssueSheet.tsx` | The issue side sheet: timer cards, owner, lifecycle steps with times, handoff banner, actions, the Activity, Images and Outcome & award tabs and the reply composer. |
| `AwardReviewPage.tsx` | The contest-wide award panel and the lists from `awardLists()`: To decide, To apply and Applied. Each card shows `AwardEvidence` and has the award form or the confirmation form. |
| `AdminPages.tsx` | `OverviewPage`, `AccountsPage` (table, filter, and the **Manage** dialog with the one-time credentials), `RosterPage` (the **Team locations** page) and `SettingsPage` (intake, image limits, the category editor, and the **Archive** panel for a seat that has `export_contest`). |
| `consoleModel.ts` | Pure rules: pages by role, sidebar counts, queue tabs, status card numbers, category counts, award totals, owner workload and palette search. `consoleModel.test.ts` tests them. |
| `consoleProps.ts` | `ConsolePageProps`, which every page receives, and the heading id. |

The console also uses these shared parts:

- `actions/ActionDialog.tsx` is a centered dialog with the props of `ActionSheet`. The console uses it for resolve, escalate, reopen, report, accounts and image upload.
- `OrganiserImages` takes `surface="dialog"` to show the upload form in an `ActionDialog`.
- `ReplyForm` takes `layout="composer"`: the message first, then the audience switch and **Send**. Ctrl+Enter or ⌘+Enter sends in both layouts.
- `ReplyForm` takes `onAttachImage` when the person can upload. It adds a camera button, **Attach an image**, before **Send** in both layouts. The button opens the issue's image upload. The image belongs to the issue, not to the message, and the upload keeps its own visibility choice. On a phone, the upload goes back to the Reply sheet and its draft when it closes.
- `LifecycleBar` takes `details`. `lifecycleDetails()` gives the submission and first assignment times, "Requested" during a handoff and the resolution time.

These rules apply:

- The sidebar pages follow the combined roles (`consoleNavGroups`). Volunteers and specialists get Queue, Assigned to me and Handoffs. Jury members get Award review. Every staff member gets Teams & tables. Admins also get Overview, Accounts, Team locations and Session settings. Admins without support roles still get Queue. A jury-only member sees resolved issues only.
- The queue tabs use the shared status filter of `useWorkflowState`. Active is `all`, All is `everything` and the other tabs are statuses. The phone app shows All active for `everything`. A reopened issue sets `claimed`, so In progress shows it.
- Rows start sorted by unresolved time, longest first. The Issue, Status, Report, Team, Owner and Unresolved headers sort the table. A first click sorts ascending and a second click sorts descending. Unassigned owners always sort last. The timer colors are the same as in the phone app.
- The issue number in each row is a button. Tab reaches it and Enter opens the sheet. A click on the row also opens it. J and K move focus between rows when no field or dialog has focus.
- **Claim** or **Accept** in a row stays on the page and does not open the sheet. When the person opens an issue while that command runs, the row action does not close it. **Claim** or **Accept handoff** in the sheet keeps the sheet open. A recorded report opens its issue in the sheet.
- When the sheet closes, focus goes back to the control that opened it, then to the issue row, then to the page heading. Radix returns focus only to a `Dialog.Trigger`, so the console moves focus itself. The sheet keeps the last issue on screen while it slides out.
- When the open issue leaves the person's lists, the sheet closes with the same status message as the phone app.
- The queue team filter and the **Report for a team** dialog keep separate team choices.
- The sheet shows one filled primary action from `primaryAction()`. Other allowed actions are outlined. **Decide award** and **Confirm applied** open the Outcome & award tab and move focus to the heading of the award or application section. Resolve, escalate and reopen open a dialog.
- A refresh error or a command error stays pinned to the top of the scrolling page, so the error of a row far down the list stays in view.
- The Images tab and the Outcome & award tab stay mounted while another tab is open. An upload continues, and a typed award explanation or an apply confirmation stays when the person opens another tab and comes back. Only the Activity tab unmounts, because it has no form.
- A staff member without a volunteer or specialist role sees one muted line under the action buttons with the same rule and text as the phone app (`missingActionHint()`).
- The composer has **Public reply** and **Internal note**. An internal note has the amber striped surface. The draft clears only when the server records the message, also after **Retry last request**.
- The command palette finds issues by number (`31`, `#31`, `ISS-31`) or by report text from three characters, teams and tables with the fuzzy team search, pages and actions. A team opens the queue with that team filter. A jury-only member goes to Teams & tables instead.
- The intake switch in the sidebar and the admin pages share one `useSessionAdmin`, so one admin request runs at a time. Admin errors and notices show at the top of the page and in the open dialog.
- The sidebar choice (expanded or collapsed) is kept in local storage under `minsky:console-sidebar`.

## Event console

`EventConsolePage` (`src/event/`) is the page of one event at `/event` and `/event/<id>`, for its event admins and for webmasters. It has four tabs: **People**, **Entrants**, **Contests** and **Assignments**. An event with no contest opens on **Contests**. A contest admin reaches no event console.

| File | Content |
| --- | --- |
| `EventConsole.tsx` | The page, the header with the event code, and the tabs. |
| `useEventConsole.ts` | The console read, the commands and the credential issue. It keeps the last overview when a read fails. A retry after a lost answer sends the same request ID. It reads again when the window regains focus. |
| `PeopleTabs.tsx` | `PeopleTab` (**Add people**, the **Event admin** switch, username changes, **Issue password** and **Reset password**) and `EntrantsTab` (**Import entrants**, the team or single contestant kind, renames, **Add sign-in**). |
| `ContestTabs.tsx` | `ContestsTab` (**Create a contest**, **Edit contest**, **Download archive**, `LivePasswords`) and `AssignmentsTab` (entrants and staff of one contest, with roles and **Contest admin**). |
| `CredentialSheet.tsx` | The sign-in link, one row per account, **Copy all**, **Print sheets** and **Done**. Each password shows once. `ISSUE_BATCH` (`src/backend/contracts.ts`) limits one request to eight accounts, so a larger issue runs in batches. |
| `ScheduleFields.tsx`, `scheduleForm.ts` | The start, end and grace fields, in the event's time zone. |
| `eventModel.ts` | Pure rules: the pasted `name, username` lines (`parsePersonLines`), the entrant kinds that a contest type accepts, `issueBatches`, and the contests that a live password also opens (`alsoOpens`, `voidedBy`). `eventModel.test.ts` tests them. |
| `forms.tsx` | `Panel`, `CommandError` and `LinesForm`. |
| `EventLink.tsx` | The link to the console. Only a caller with event authority over the open contest sees it. |
| `useOwnEvent.ts` | `useNoContestLanding`, which chooses the page for a person with no contest. |

These rules apply:

- An archived event disables every control, except **Download archive**. That button only reads. Today only a deletion archives an event, and the Worker then refuses the read.
- A new person or entrant has no password until the credential sheet issues one. The sheet opens after the import.
- A live contest stays closed until every sign-in has a live password. `LivePasswords` shows **Waiting for live passwords** with the count and **Issue live passwords for** the contest. It also lists the other live contests that the new passwords open.
- A command that would close reporting in an open live contest asks first. `closeReporting` carries the answer.

## Contest archive

**Download archive** gives staff one zip file of a contest's support record and its images, so the record survives outside Minsky. Export is allowed at any time. The webmaster's deletion of an event does not wait for an export, so each contest needs its download first.
`ContestArchiveButton` (`src/connected/ContestArchiveButton.tsx`) is the only control. It stands on each contest row of the event console, and in the **Archive** panel of **Session settings** in the desktop console. The panel shows only when `can(seat, "export_contest")` holds. The server checks that capability again.

The browser builds the zip. The Worker has a CPU limit of 1,000 ms, and a zip costs about 1.9 ms of CPU for each MiB, while one issue can hold 120 MB of images. So the Worker gives one read, and the browser does the rest:

1. `backend.manage.contestRecord(sessionId)` reads `GET /api/contest-record`. It parses the reply with `contestRecordSchema` (`src/connected/contestRecord.ts`). The record keeps every row: internal notes, withdrawn awards, removed announcements, removed images, and the whole audit.
2. `buildContestArchive` (`src/connected/buildContestArchive.ts`) downloads each image through the routes that the screens use. Issue images use `backend.images.download`. Announcement images use `backend.announcements.downloadImage`. Three images download at the same time, and they enter the zip in a fixed order. The builder checks each image against its stored SHA-256 digest. An image that fails to download, or does not match, is skipped and listed as missing. The archive still completes.
3. The builder writes the zip with fflate. Text files use `ZipDeflate` and images use `ZipPassThrough`, because they are compressed already. Output chunks stay in a list of Blob parts, and one Blob is built at the end. fflate writes no ZIP64, so a contest with more than 4 GB of images gets an error and no file.
4. `ContestArchiveButton` saves the Blob with an object URL and a link with `download`. The URL is revoked after 60 seconds.

The builder and fflate load on the first click. No screen carries them. `npm run perf:size` lists them as lazy chunks. The record schema stays in the backend chunk.

| File | Content |
| --- | --- |
| `contestArchive.ts` | Pure layout. `archiveEntries(record)` returns every file except `README.txt` and `manifest.json`. `imageEntries` places images. `teamViews` builds the record of each team in one pass. `readmeEntry` and `manifestEntry` run after the images. |
| `contestArchiveLog.ts` | `renderLog` writes `log.html`. The `html` template escapes every value. The page has inline CSS, no script, and a Content-Security-Policy that forbids scripts. |
| `contestArchiveCsv.ts` | `issues.csv` and `awards.csv`. RFC 4180 quoting, a byte order mark, and a leading apostrophe for a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return. |
| `archiveFormat.ts` | Times in the event time zone plus ISO, `safeName` and `slug`. |
| `contestRecordFixture.ts` | A fictional record for tests. |

The zip has one root folder, `minsky-<event code or event>-<contest slug>-<YYYYMMDD>`. The date is the export day in the event time zone. Paths below are relative to it.

| Path | Content |
| --- | --- |
| `README.txt` | What each file is, the format version, the export time, a warning about staff-only content, and the missing files. |
| `manifest.json` | The format, the record format, the counts of each record section, every file with its size and SHA-256 digest, and the missing files. |
| `staff-only/record.json` | The whole record, pretty-printed. |
| `staff-only/log.html` | Every issue in number order with its whole timeline. Internal notes have the label **Staff note**. It also holds resolutions, awards with the withdrawn ones, contest-wide awards, announcements with the removed ones, the images of each issue, and the audit. |
| `staff-only/issues.csv`, `staff-only/awards.csv` | One row for each issue. One row for each award, with a `status` of `pending`, `applied` or `withdrawn`. |
| `staff-only/images/issue-<NNNN>/<id8>-<name>` | Ready images with staff-only visibility. |
| `staff-only/announcements/<id8>-<name>` | Images of removed announcements. |
| `contestant-visible/teams/<team>/log.html` | What that team could see. It holds the issues of the team with the public timeline, the resolutions, and the awards that are not withdrawn. It also holds the contest-wide awards that staff confirmed and the announcements that are not removed, because every team saw them. A team with no issues still has a log. |
| `contestant-visible/teams/<team>/images/issue-<NNNN>/<id8>-<name>` | Ready images with team visibility, of the issues of that team. |
| `contestant-visible/announcements/<id8>-<name>` | Images of announcements that are not removed. Every team log links to them, so the zip holds one copy. |

`<team>` is the slug of the team name, a hyphen, and the first 8 characters of the team ID. A name that reduces to nothing becomes `team`. If two teams still get the same folder name, the second one ends with `-2`. The teams are sorted first, so a team keeps its number on every export. `README.txt` lists each team folder with the team name and location.

`teamViews(record)` builds the view of each team from the record before any file is rendered. So no renderer can put an internal note, a staff-only image, the audit, a withdrawn award record, a removed announcement, or an issue of another team into the folder of a team. The public timeline keeps the lines that announced an award and its withdrawal, because contestants saw them in the app. An announcement image whose announcement the record lacks goes to `staff-only/`. A team-visible image whose issue team the record lacks goes to `staff-only/` too. An image that is not `ready` has no file. The logs and `record.json` list it as metadata.

To give a team its record, copy `contestant-visible/`, then delete the other teams' folders from `teams/`. The team log opens announcement images with the relative path `../../announcements/`, so the `announcements/` folder must stay beside `teams/`. The view runs once for each team, and each run reads every row of the record. So the time to build the file list grows with the number of teams times the number of rows.

`<id8>` is the first 8 characters of the image ID. `safeName` removes control characters, path separators, characters that Windows refuses, `..`, leading dots, and trailing dots and spaces. It caps the length and keeps a short extension. A path that equals an earlier path, ignoring case, gets a number.

`src/connected/contestArchive.test.ts` and `src/connected/buildContestArchive.test.ts` test the files and the zip. `tests/contest-archive.spec.ts` tests the button in a browser and unzips the file that the browser saved. It answers `/api/contest-record` with a fixed record, so it does not test the Worker route.

## Site dashboard

`SiteDashboard` (`src/site/SiteDashboard.tsx`) is the webmasters' page at `/site`. It shows the calendar of every event, **Create an event**, the event list with **Open console**, the webmasters, and the setting **Webmasters read contest data only after joining**. While that setting is on, `JoinContests` lists the contests to join. `DeleteEventDialog` asks for the event's name, or its code when it has no name, before it deletes an event. It tells the webmaster to download the archive of each contest first, and it links to `/event/<id>`. The link never blocks or disables the deletion.

| File | Content |
| --- | --- |
| `useSite.ts` | The site read, the commands and `joinContest`. |
| `SiteLink.tsx` | The link to the page. Only a webmaster sees it. |
| `WebmasterAccess.tsx` | What a webmaster sees on `NoSessionAccess`. |
| `JoinContests.tsx` | The contests that the webmaster has not joined. |

The last webmaster cannot be removed. The server enforces this rule.

## Contest clock, calendar, and contest-wide awards

These modules are in `src/connected/`. D1 derives every time. The browser only displays it.

| File | Content |
| --- | --- |
| `contestClock.ts`, `ContestClock.tsx` | The contestant's clock as lines of text: when reporting opens or closes, a countdown, and the personal end time. |
| `intakeText.ts` | The short intake state for a badge, such as "Intake open (grace period)" or "Waiting for live passwords". |
| `Calendar.tsx`, `calendarModel.ts` | The contests of the person's own events for seven days, grouped by event and by day in the event's time zone. A webmaster sees every event. The calendar is in the account page's **Sessions** section, the phone **Me** tab, and the site dashboard. |
| `zonedTime.ts` | Time zone conversion and the **Your time** note for a device in another zone. |
| `ContestAwards.tsx` | `ContestAwardsPanel`. Jury decide an award of 1 to 1,440 minutes for every contestant of the contest. Volunteers, specialists, and jury confirm that staff applied it in the external contest system. **Time awards to confirm** shows above the queue. Jury can withdraw an unconfirmed award. |
| `ContestPicker.tsx` | The one picker for the contests that a person can open, as a menu, as radio rows, or as a select. A person with one contest sees the name instead. |

## Account page

`AccountPage` is the settings page at `/account` for the signed-in person in the selected contest.
The desktop console and the contestant app both render it. The caller provides the scroll container and the page padding.
The phone app keeps its own **Me** tab.

| File | Content |
| --- | --- |
| `src/connected/AccountPage.tsx` | The page header (avatar, name or team name, login, role badges and **Sign out**), the section nav, and the focus rules for `#section` addresses. It also exports `useOpenPasswordChange()`. |
| `src/connected/AccountSections.tsx` | One component for each section: Profile, Access, Sessions, Security, Appearance, Activity and Help. The Sessions section also holds `Calendar`. |
| `src/connected/accountModel.ts` | Pure rules: `accountKind()`, the role descriptions in `capabilityInfo`, the section list `accountSections`, `accountName()` and `accountActivity()`. `accountModel.test.ts` tests them. |
| `src/connected/historyEvents.ts` | `workflowEvent()`, which tells a workflow step from a message that a person wrote. |
| `src/screens/PasswordForm.tsx` | `PasswordChangeForm`, the password fields and their checks. The full-screen `PasswordForm` and the Security section both use it. |
| `src/lib/links.ts` | `documentationUrl`, the one address of the published guides. |
| `src/components/theme-toggle.tsx` | `themeOptions`, the one list of theme choices for every theme picker. |

These rules apply:

- The page shows only data that the account and the session snapshot already hold. It changes no profile data except the [picture](#profile-pictures) and the username. The name and the account ID cannot be edited. The Profile section shows `UsernameForm` when `canChangeUsername` is true. A team account cannot change its own username, because venue staff read it from the sign-in sheet. A webmaster cannot either, because a webmaster belongs to no event.
- `accountSections` gives the section order and the section nav. A team account has no staff roles. Its **Access** section describes what a team account can do. It shows no role badges and no link to **Accounts**.
- A contest admin sees **Manage session accounts**. The link goes to `/administration/accounts`. The backend still checks every request.
- **Sessions** lists the contests that the account can open. **Switch** is disabled while a workflow command runs. After the switch, the caller clears its own selection. The console passes `changeSession`. The contestant app passes `resetForSession`.
- **Security** changes the password in place. On success the fields clear and a status message shows. The person stays on `/account` and stays signed in. The Cloudflare adapter replaces the login cookie and checks the new session, so the page does not check the account status again.
- An address with a fragment, such as `/account#security`, names a place inside the page. `useRouteFocus` then leaves focus to the page. `useSectionFocus` focuses and scrolls to the section. A router state from `focusRequest()` picks one control inside it. `useOpenPasswordChange()` uses this for **Change password** in the command palette and the contestant menu. It also works when the person is already on `/account`, because each `focusRequest()` carries a new token, and `useSectionFocus` runs for a new token. A replace of the entry that keeps the hash and the state, such as the write of `?contest=`, does not run it.
- **Activity** counts open work, resolutions and messages from the snapshot that the person can see. For staff, open work means unresolved issues that the person owns. For a team account, it means unresolved team issues. The list shows the five newest replies, internal notes and resolutions of this person. A team account never sees internal notes.
- The layout follows the width of the page, not of the window. The section nav stands beside the sections from 768 px of page width.

## Profile pictures

A picture belongs to an account, not to a contest. The visibility rule is in [Avatars](backend-contracts.md#avatars). The server enforces it. The frontend shows what the server returns.

`Workspace` wraps both apps in `AvatarProvider`. The provider reads the pictures that the caller can see in the selected contest and keeps one downloaded copy of each.

| File | Content |
| --- | --- |
| `src/connected/Avatars.tsx` | `AvatarProvider`, `useAvatarUrl(personId)` and `useAvatarActions()`. |
| `src/connected/avatarImages.ts` | `avatarMap()`, which maps each person ID to a picture, and `AvatarImageCache`. Neither uses React. `avatarImages.test.ts` tests them. |
| `src/connected/avatarPicture.ts` | Pure rules: the centered square, the encodings to try, the editor states and the state after a failed upload. `avatarPicture.test.ts` tests them. |
| `src/connected/imageUpload.ts` | `avatarBlob()`, which crops and encodes a chosen file in the browser. |
| `src/connected/hooks/useAvatarEditor.ts` | The editor state and its steps. |
| `src/connected/PictureEditor.tsx` | The file input, the preview dialog, the removal question, the status line and the alert. |

These rules apply:

- The provider calls `avatars.list(sessionId)` when the session or `SessionData.updates` changes. `updates` counts live signals and session timer ticks. A picture change sends no live signal, so the timer shows the change of another person. A failed read keeps the earlier list. A contest change or lost access drops the list. An unchanged list keeps the same map object, so the avatars do not render again.
- Only the newest read or change sets the list. An upload and a removal set the list themselves. A read that started earlier then cannot bring back the old picture.
- `PersonAvatar` takes an optional `personId`. It shows the picture through `useAvatarUrl`, and it shows initials when the person has no picture, when the caller cannot see it, or when the browser cannot decode it. The picture has an empty `alt`, because the name stands next to it. A call site that has no person ID shows initials.
- `AvatarImageCache` downloads a picture when the first avatar on screen asks for it. Every other avatar of that picture shares its object URL. The avatar ID is the cache key. It changes on every upload, so a cached picture never goes stale. The cache revokes the URL of a picture that left the list, and all URLs when the contest changes or the provider unmounts. After an upload the cache holds the encoded file, so the new picture needs no download.
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

The phone **Awards** tab (`AwardsTab` in `PhoneTabs.tsx`) and the desktop `AwardReviewPage` are the jury worklist. There is no separate worklist page.

`awardLists(state)` in `organiserModel.ts` uses `juryWorklists()` from `src/connected/jury.ts`. It gives three lists:

- **To decide**: resolved issues without an award, oldest resolution first.
- **To apply**: every award that waits for external application, oldest decision first. This includes zero-minute awards and awards on reopened issues.
- **Applied**: resolved issues with an applied award, latest confirmation first.

These rules apply:

- `AwardEvidence` shows the resolution summary of the award, the resolver and the time.
  When an issue with an award is not resolved, it shows a **Reopened** badge with the current status.
  When the award resolution was reopened, it also shows "This award relates to an earlier resolution."
- `openableIssues(state, member)` adds reopened issues with a pending award for a jury-only member, so that member can open the issue and confirm the application.
  The ordinary queue of a jury-only member still shows resolved issues only.
- The desktop award and confirmation forms stay on the **Award review** cards.

## Render errors

A render error unmounts the React tree above it. Without a boundary, the page goes blank.
`RenderErrorBoundary` (`src/components/render-error-boundary.tsx`) catches the error and shows a recovery card.
The card says what happened, says that sent work is saved on the server and that unsent text may be lost, and has a **Reload** button.
It uses no router, provider, or backend state, so it still works when those fail.

The app has three boundaries:

| Boundary | Where | What stays usable |
| --- | --- | --- |
| `app` | `src/main.tsx`, around the router | Nothing. This is the last resort. It shows the brand header and the card. |
| `region` | `Workspace`, around the contestant or organizer UI | The announcement banner and the build ID. |
| `region` | The desktop console, around the page body | The sidebar and the top bar. |

A region boundary clears its failure when its `resetKey` changes. The `Workspace` boundary uses the path. The console boundary uses the page. A person can leave a failed page without a reload.
The event console and the site dashboard have no region boundary. An error there reaches the `app` boundary.
The boundary writes the error and the component stack to the console. It sends nothing to the server.
`tests/error-boundary.spec.ts` forces a render error and checks the card and **Reload**.

## Root elements

The root element of each layout has `data-ui="contestant"`, `data-ui="organiser-phone"` or `data-ui="organiser-desktop"`.
`tests/ui-selection.spec.ts` uses this attribute to check the UI selection. Keep it on the root element of each layout.

Put components that both organizer layouts use in `src/organiser/`.

## Local checks

`npm run dev` and `npm run test:e2e` need a development build of React.
If your shell sets `NODE_ENV=production`, unset it first. Otherwise the page stays blank with the error `$RefreshReg$ is not defined`.

Playwright needs its matching Chromium build. If the default browser folder is not writable, set `PLAYWRIGHT_BROWSERS_PATH` to a writable folder and install Chromium there:

```sh
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
npx playwright install chromium
```

## Client weight

The app loads each role's screens on demand. `src/connected/lazyScreens.tsx` holds the lazy imports for the contestant app, the organizer app, the event console and the site page. `src/organiser/layouts.ts` does the same for the organizer desktop console and the phone app. A contestant does not download the staff console, and a phone does not download the desktop console. `tests/contestant-chunks.spec.ts` checks that a contestant downloads no staff screen.
The site page and the event console are staff screens too. `Workspace` asks `levelScreenAccess` (`src/connected/navigation.ts`) before it mounts one, so that a seated contestant who types `/site`, `/event` or `/event/<id>` does not download them. The contest list gives each contest a `manage` level, and an event admin or a webmaster has `event` or `site` over a listed contest. While the person has no chosen contest, `useSessionSnapshot` publishes the list when it arrives, before the snapshot read, so a slow snapshot read does not hold the page. That covers the first read and every later read that starts with no chosen contest. Once a contest is chosen, a read publishes the list before its snapshot only when that contest stays in it. Otherwise it publishes the list and the new contest together, after the snapshot read, so the picker never lacks its open row. While the first read of the list has not ended, the page shows the wait for the first session, which has **Sign out**. A read that hangs leaves the person that way out. A list with no `event` or `site` level shows `NoLevelAccess`, an eager page that says what the staff screen says when the server refuses its read. An empty list decides nothing, so the screen mounts and its own read decides. A webmaster who joined no contest has an empty list, and so has an event admin whose event has no contest. A person with no seat has one too, such as an entrant with a sign-in and no entry. That person downloads the screen and sees its refusal. A failed read of the list leaves the list empty, so the screen opens then too.
`Workspace` remembers the screens that the account used last. It writes the record to `localStorage` under `minsky-screen`, as `{ "account": "<account ID>", "kind": "contestant" | "organiser" }`. A device keeps one record, so the record names only the last account. `ConnectedApp` starts the download when the session check names the account, and only when the record names that same account. The download then runs while the browser checks the account status and reads the snapshot. Before the session check, the device does not know who opened the app, so nothing downloads early.
A contestant on a device that last showed the organiser screen therefore downloads no staff screen. This holds after an organiser signs out, after an organiser's session ends, and on `/issues`, `/site` and `/event`. A person whose role changed since the last visit downloads the old role's screens once, and then the record is replaced. An earlier release wrote the bare word `organiser` or `contestant`. The app ignores that value, so the first visit after the upgrade downloads on demand and writes the new record.
`tests/contestant-chunks.spec.ts` checks these cases. It also checks that an organiser's next visit still requests a staff screen while the snapshot read is held.

Every module that builds a zod schema imports `src/lib/zodConfig.ts` before it imports `zod`. The Content-Security-Policy forbids `eval`, and zod probes for it when it builds its first schema. With several chunks, the import order of `main.tsx` alone does not decide which chunk runs first. `npm run test:connector:ui:local` fails on a policy violation.

Long lists keep their cost low in three ways:

- `useSessionSnapshot` keeps the identity of every object that did not change between two snapshots (`keepUnchanged`).
- Queue rows and phone cards are memoized. Each timer subscribes to one shared clock (`useTick`), so a clock tick renders the timers and not the rows.
- Reads run one at a time. A read that has not started yet serves every caller that arrives before it starts (`refreshQueue.ts`). A page in the background skips live hints and timer reads, and reads once when it becomes visible.

`npm run perf:client` measures this. It builds the app, serves it with Brotli, and runs `scripts/perf/client.spec.ts` against the local fixture with Chromium at 4x CPU slowdown and slow 4G. Set `PERF_RUNS` for the number of loads and `PERF_OUT` for a JSON file. `npm run perf:size` prints the size of each built script and stylesheet. The first number to read is the median of several runs. The machine must be quiet, because the timings share its CPU.

## Motion

This section is a reference for the motion of the frontend and the rules for new motion.
Every timing and the reduced-motion rule are in `src/index.css`.

### Timing tokens

| Token | Value | Use |
| --- | --- | --- |
| `--motion-fast` | 120 ms | Press feedback, exits, panel fades. |
| `--motion-base` | 180 ms | Tab indicators, color changes, overlays, dialog entry, side sheet exit. |
| `--motion-slow` | 250 ms | Side sheet entry. This is the longest transition. |
| `--motion-highlight` | 1400 ms | The fade of a row that a live update changed. It is not a transition. The person must have time to see it. |

Write a duration as `duration-(--motion-base)` with Tailwind's `ease-out` curve.
Do not write a millisecond value in a component.

### Reduced motion

One `@media (prefers-reduced-motion: reduce)` rule in `src/index.css` sets every animation and transition to 0.01 ms and one iteration.
It covers Tailwind transitions, tw-animate-css, Radix, vaul and the pulsing dots.
The duration is not zero and the rule does not set `animation: none`. `animationend` still fires, so Radix removes a closing dialog.
Do not add a reduced-motion class to a component. Do not start a motion with `element.animate()`, because the rule does not cover it.

### Sliding indicator

`SlidingIndicator` in `src/components/ui/sliding-indicator.tsx` is a decorative marker behind the active item of its parent.
Render it as the first child of a container with `relative isolate`.
The active item is the first descendant with `data-state="active"` or `data-state="on"`, `aria-selected="true"`, `aria-pressed="true"` or `aria-current="page"`.
The component reads these attributes. It adds no role or attribute to the active item, so it works with Radix and with plain buttons.

These rules apply:

- The marker slides only when another item becomes active. A resize, a new font or a new count inside a tab moves it without animation.
- The first placement does not animate.
- The marker uses `offsetLeft`, `offsetTop`, `offsetWidth` and `offsetHeight`. A parent that scales in, such as a dialog, does not move it.
- A `ResizeObserver` watches the container and each item. A `MutationObserver` watches the active attributes and the list of items.
- The marker is `aria-hidden` and has `data-slot="sliding-indicator"`.

Six places use it:

| Place | Style |
| --- | --- |
| `TabsList` with the default variant in `src/components/ui/tabs.tsx`, used by the event console | The white pill (`pillIndicator`). |
| `TabsList` with the `line` variant, used by the tabs of the desktop issue sheet | A 2 px underline. |
| The status filter of the desktop queue in `QueuePages.tsx` | The same pill. The filter keeps `role="group"` and `aria-pressed`. |
| The award list switch of the desktop **Award review** page | The same pill. |
| The audience switch of `ReplyForm` in `IssueForms.tsx` | The pill turns amber for **Internal note**. The labels carry `data-state="on"`, because radio buttons have no attribute for the checked item. |
| `TabBar` in `src/components/tab-bar.tsx`, used by the organizer phone app and the contestant app | A 3 px bar along the top edge. |

`TabsContent` fades in over `--motion-fast` when its tab becomes active.

### Highlight of live updates

`IssueTable` highlights a row that a live update added or changed.
`changedIssueIds()` in `organiserModel.ts` compares two issue lists by id, status and revision.
`useChangedIssues()` in `src/organiser/useChangedIssues.ts` applies it to the whole session list, not to the filtered rows.
A change of status tab, team filter or page highlights nothing. The first list of a session highlights nothing.
A reply, a claim or a resolution that the person made also raises the revision, so it highlights the row.
The row has `data-changed` and the `animate-row-flash` utility. The phone queue does not use the hook.

The hook keeps the time at which each highlight began. `recentChanges()` drops entries older than `--motion-highlight` at each update, so ids from earlier updates never pile up.
The page clock `now` advances once each second, so a row keeps `data-changed` for up to two seconds.
A row that changes again during its highlight does not start the highlight again.
A row that mounts during that time, for example after a change of status tab, shows the tint again.

### Spinner

`Spinner` in `src/components/ui/spinner.tsx` is a spinning icon for a wait. It is decorative and has `aria-hidden`. Put the status text next to it.
The reduced-motion rule above stops the spin, so the icon stays still and the text carries the state. The component has no reduced-motion class.
The sign-in button and the Sonner loading toast use the same component.

Two cases use it:

- **A button whose action runs.** Set `loading` on `Button`. The button shows the spinner in place of its icon and sets `aria-busy`. It does not disable the button, so keep the `disabled` rule of the caller.
  `loading` has no effect with `asChild`.
  A workflow command has one flag, `command.busy`, for the whole contest. Do not use it for `loading`, because every locked control would spin.
  Use `isRunning(command.running, type, issueId)` from `src/connected/model.ts` instead. The spinner then shows only on the control that started the running command.
- **A wait with no content yet.** Put the spinner before the status text, for example "Restoring your session…" in `ConnectedApp.tsx`, the session card in `NoSessionAccess.tsx`, "Loading announcements…" for a manager and "Opening image." in the image preview.

Do not add hidden status text inside a button. A button exposes only its name to a screen reader, so a live region inside it is not announced, and a longer name breaks the exact names that the browser tests use.

### Rules for new motion

- Animate transform, opacity and color. Do not animate the layout of a list.
- Do not delay input or focus.
- Do not move text that a person can be reading. Fade it instead.
- Keep a transition at 250 ms or less.
