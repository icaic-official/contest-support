# Minsky frontend redesign: concepts and directions

Status: **proposal for review** (2026-10-17). Nothing here is implemented in the app.
The mockups use fictional sample data. They do not connect to Supabase.

## 1. What the app does today

The whole interface lives in `src/connected/ConnectedApp.tsx` (about 2,100 lines) and `src/styles.css`.
It has these surfaces:

| Surface | Who uses it | Current form |
| --- | --- | --- |
| Sign-in and password change | Everyone | Centered forms |
| Sidebar | Everyone | Brand, session picker, intake dot, 3 nav buttons, person card |
| Issue queue | Contestant, support, jury | Table of buttons with a status `<select>` filter and team search |
| Report form | Contestant, support | Panel that opens inline above the queue |
| Issue detail | Everyone | One long column: facts, handoff, actions, images, activity, reply, resolve, resolution history, reopen, award |
| Administration | Session admin | One long page: status counts, intake, image limits, create account, account list |
| My account | Everyone | Three facts and a password button |

The main problems:

- **One long detail column.** Every action form stays open on the page, so the page is long and the next step is not clear.
- **`<select>` for important choices.** The status filter, reply audience, resolution summary and award minutes are drop-down lists. This hides the choices and costs extra clicks.
- **One screen for every role.** The contestant, volunteer, jury member and admin all see the same layout with some parts hidden. Each role has a different job.
- **The live timer is not prominent.** Elapsed time is the central fact of an issue, but the queue shows it as small text with no sign of age.
- **The public/internal split is weak.** One drop-down sets the audience. A wrong choice can send a staff note to the team.

## 2. Core concepts and how to show them

| Concept (data) | What it means to people | Better UI pattern |
| --- | --- | --- |
| **Issue lifecycle** `open → claimed → escalated → resolved`, plus reopen | "Where is my problem now?" | A **stepper** (segmented progress bar) on the issue. For contestants, a **delivery-style tracker**: Sent → Helper on the way → Fixed → Time award. |
| **Unresolved timer** (from saved timestamps, resolved intervals excluded) | Urgency, fairness | A **large monospaced live clock** with an **age tier**: neutral under 10 min, amber under 20, rose after. Use the same tier on rows, cards and map pins. The thresholds could become a session setting. |
| **First assignment time** | Helper response speed | A second smaller fact beside the clock, and a "median first assignment" tile for leads. |
| **Ownership and handoff** (owner keeps the issue until a specialist accepts) | "Who is responsible right now?" | An **owner avatar** on every row. A **handoff banner** that names the current owner, with one "Accept handoff" action for specialists. A separate **Handoffs** inbox. |
| **Public replies vs internal notes** | Safety: never leak staff notes | A **two-mode composer** (segmented control). Internal mode recolors the whole composer amber with a lock icon. Internal notes in the thread look like **sticky notes**. A contestant view never contains them. |
| **Resolution** (summary visible to the team, history kept) | Closure | A **resolve dialog** with radio cards for the preset summaries and a custom option. In the timeline, a green **milestone card**. Reopen events appear in the same timeline. |
| **Award ledger** (decision, then separate confirmation of external application) | Fairness and audit | A **two-step receipt**: "Decided by X" ✓ then "Applied by Y" ✓ or pending. The jury gets **preset minute chips** (0/5/10/15/30, custom) instead of a drop-down. Leads get a **To decide → To apply → Applied** pipeline. |
| **Team and location** | "Where do I walk?" | Show the **table number first**. Use **⌘K fuzzy search** for teams, tables and issue numbers (T0008 logic). Optional **floor map** with pins. |
| **Session context** (event, session, intake open/closed, archived) | Global mode | A **session switcher** in the sidebar header, an **intake switch** with a one-line explanation, and an archived banner. |
| **Roles** (volunteer, specialist, jury, admin; combined per person; contestant team accounts) | Different jobs | **Role-specific home screens**: contestants get a help page, support gets a queue/inbox, jury gets award review, admins get overview and accounts. People with several roles see the union of the navigation items. |
| **Images** (fixed visibility chosen at upload, limits per session) | Evidence | A **thumbnail grid** with a visibility badge on each image, a drop zone that shows the limits, and a lightbox. |
| **Accounts and credentials** | Organizer setup | A **data table** of accounts with role badges, a **create-account dialog** with staff/team type cards, and a **one-time credential reveal** with copy buttons. |
| **Live connection** | Trust in the data | A small **Live** badge in the top bar. It changes to "Reconnecting" when Realtime drops. |

## 3. The four directions

Every mockup is a self-contained HTML file in this folder. Each has working navigation, live timers and sample interactions.

### A. Console: shadcn/ui, Linear-style (`a-console.html`)

- Uses shadcn/ui "New York" design tokens (zinc), Inter and lucide icons. It has dark and light themes.
- Collapsible **sidebar** with role-aware navigation and the intake switch. **Breadcrumb** top bar.
- **⌘K command palette** for teams, tables, issues and actions.
- The queue is a **data table** with tab filters, counts, stat cards and aging timers.
- A row opens an **issue sheet** (side drawer) with the lifecycle stepper, the timer cards, Activity / Images / Outcome tabs and a two-mode composer.
- Shows every persona: Support, Contestant help page with tracker, Jury award review, Admin accounts, session settings with sliders, and an overview.
- **Best for:** a general, accessible desktop product that maps directly to real shadcn components.

### B. Ops board: mission control (`b-ops-board.html`)

- Dark glass design with Space Grotesk and IBM Plex Mono.
- **KPI strip** (unresolved, waiting, oldest, median first assignment, awards to apply).
- **Kanban lanes** per status. Each card has an aging bar, table chip and owner avatar. Critical cards glow.
- **Floor map** of the halls. Table pins show the color of their worst open issue and pulse after 20 minutes.
- **Awards pipeline** board: To decide → Decided, not applied → Applied.
- **Wall mode** for a large screen at the help desk. The issue opens in a focus modal with chat and facts.
- **Best for:** leads and the help desk during a busy contest.
- **Needs new data:** table coordinates for the map.

### C. Conversation inbox: editorial light (`c-inbox.html`)

- Warm paper palette, Instrument Serif headings, Geist text.
- Front/Intercom-style **three-pane inbox**: smart inboxes (Mine, Unassigned, Handoffs, All active, Resolved) → list with the last message preview → thread → context rail.
- The **thread is the issue**. System events are dividers, internal notes are sticky notes and the resolution is a milestone card.
- The **context rail** contains the clock, team, owner and handoff, the journey, the actions, the images and the award receipt.
- **Contestant view:** a calm single-column page with a large reassuring headline, a delivery-style tracker and chat bubbles.
- **Best for:** communication-heavy support and the most humane contestant experience.

### D. Field mode: phone-first (`d-field-mobile.html`)

- iOS-like, Plus Jakarta Sans, large touch targets.
- **Queue:** "Near me / Unclaimed / All active" chips, a "Next issue" hero, the **table number as the main visual element**, and **slide to claim**.
- **Issue:** the thumb-zone action bar (reply, camera, primary action) and a **bottom-sheet composer** with quick replies and a To team / Staff only toggle.
- **Jury:** a large minute counter with preset chips and one confirm button.
- **Best for:** volunteers who walk the hall, as the mobile layout of A or C.
- **Needs new data:** "Near me" needs the helper's hall or zone. Quick replies would be a new session setting.

## 4. Recommendation

Use a combination. Each direction solves a different problem, and the same component set can implement all of them:

1. **Foundation: A (shadcn/ui).** Real components (Sidebar, Sheet, Command, Tabs, Dialog, Table, Badge, Switch) and accessible Radix primitives.
2. **Issue view: C's thread and context rail** inside A's sheet or as a full page. It shows the public/internal split most clearly.
3. **Contestant home: C's tracker page.** It is calm and clear.
4. **Phone layout: D**, for the queue and issue at phone widths. AGENTS.md requires phone-width volunteer screens.
5. **Optional later: B's board and wall mode** as an extra view for leads. Add the floor map only if venue coordinates become part of the roster.

## 5. Implementation notes for the next step

- **Stack change.** The app uses plain CSS today. shadcn/ui needs Tailwind CSS (v4 with Vite) and Radix UI packages. shadcn copies component source into the repository (for example `src/components/ui/`), so it adds no runtime dependency on shadcn itself. Expect these new dependencies: `tailwindcss`, `@tailwindcss/vite`, `radix-ui` (or `@radix-ui/*`), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` and `cmdk`. Optional: `vaul` for mobile drawers and `sonner` for toasts.
- **Split `ConnectedApp.tsx`** into route-level views (queue, issue, award review, admin, account) and shared hooks (`useSnapshot`, `useCommand`, `useNow`). Keep `model.ts`, `client.ts`, `teamSearch.ts` and the image modules as they are.
- **Behavior to preserve** (AGENTS.md): timers from persisted timestamps, separate first assignment, the owner keeps the issue during escalation, internal notes absent from contestant views, the award separate from external application, retry with the same request UUID, and no duplicate actions from repeated clicks.
- **Accessibility:** every drag or slide gesture (boards, slide to claim) needs a button alternative. Status always has an icon and a label, never color alone. Keep the focus management that exists today.
- **Not in the current schema:** venue coordinates (floor map), helper zone ("Near me"), saved replies, configurable aging thresholds, and a team's display order. Treat these as separate follow-up decisions.
- **Tests:** the Playwright journey test uses current labels and roles. A redesign needs selector updates in the same change.
- **Size:** the full redesign is several tickets: foundation and shell, issue view, queue and search, contestant view, admin, mobile, and tests and docs. Plan to split it.

## Files

| File | Content |
| --- | --- |
| `a-console.html` | Direction A (built file) |
| `b-ops-board.html` | Direction B (built file) |
| `c-inbox.html` | Direction C (built file) |
| `d-field-mobile.html` | Direction D (built file) |
| `src/*.html`, `src/data.js` | Mockup sources and shared sample data |
| `build.py` | Inlines `src/data.js` into each mockup: `python3 design/redesign/build.py` |
