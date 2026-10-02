# Connected manual verification (T0003)

Use the linked development project and organizer-provided username/password accounts. The first admin is bootstrapped explicitly. No Docker or persona switching is needed. Use separate browsers/profiles for contestant, volunteer, specialist, jury and admin. Work only in a clearly identified development/test session. See [onboarding](cloud-onboarding.md).

1. Sign in with a username (case-insensitive), refresh and verify session restoration. Sign out and verify contest data disappears. An account without membership sees the access message. Change the password through the labeled form.
2. As admin, create a contestant username account for a roster team, securely hand off its temporary password, assign individual staff and combined specialist/volunteer/jury roles, and check the membership list. Revoke a session membership and verify subsequent direct database reads return no session data. Verify the UI clears data after refresh/focus. Attempt to remove the last admin: it must fail.
3. Close contestant intake. New contestant submission must fail. Staff submissions on behalf of roster teams and reopening must still work. Reopen intake.
4. Submit as a contestant. In another signed-in browser, claim as volunteer, add a public reply and an internal note, then escalate. The volunteer remains owner until another specialist accepts. Verify the contestant cannot see the private note, including through direct API/history queries.
5. Resolve with a preset or Custom. The timer stops. Award zero/preset/custom whole minutes with a public explanation as jury. Confirm application as staff; Minsky must not change an external contest clock.
6. Reopen as the contestant or a helper. The prior owner and all summaries remain, the existing award stays intact, and resolved intervals are excluded. Resolve again. Refresh each browser and compare shared state.
7. Repeat support actions at 390×844 and 320×740. Check no horizontal overflow, readable owners/timers, keyboard skip link, visible focus, native select/checkbox behavior and valid form submission. On desktop, verify the queue sits beside the selected issue and the reporting form is aligned. On phones, verify both stack and account controls wrap. Review sign-in at desktop/800px/390px/320px; open and close **Forgot password?** with the keyboard and verify organizer recovery instructions. Review contestant/jury/admin at desktop widths and 200% zoom; use a real phone and screen reader when available.
8. Sign in as a newly created username account with its temporary password. Contest data and direct API reads/writes must be blocked until the password changes; refresh must not bypass this. Change it through the required form and verify access. As admin, verify the requester’s identity, then reset the account and hand off the newly generated temporary password. Old sessions and refresh tokens must lose access. Sign in again, change the replacement temporary password and verify access resumes. Dismiss credentials; existing passwords must not be visible. Verify duplicate usernames and non-admin resets fail. Existing development accounts can assign a username without changing their password or Auth UUID.
9. Compare two simultaneous claims/awards, refresh/reconnect, and unauthorized team/session queries. Run `npm run test:cloud` for repeatable real-account checks. It creates and removes isolated test fixtures, without resetting the shared project.

Record observed results in [current-state.md](current-state.md). Suggested manual checks are not completed checks. Real devices, assistive technology and capacity must not be inferred from browser automation.

---

# Manual verification guide

## Historical local-demo preparation

1. Run `npm ci`.
2. Run `npm run dev:demo`.
3. Open the printed local URL in one browser tab.
4. Use fictional data only.
5. Select **Reset demo**.
6. Accept the reset confirmation.

Persona changes simulate roles. They do not sign users into accounts.

## Complete journey

### 1. Submit an issue

1. Select **Team contestant · Team Aurora**.
2. Check that the roster location is Hall A · Desk 12.
3. Check that the view shows only Aurora's seeded issue.
4. Submit a Backend issue with “The code environment cannot connect.”

Expected: the new issue, `ISS-004`, shows a running timer and no first assignment.

### 2. Check persistence

1. Wait a few seconds.
2. Refresh the page.
3. Select `ISS-004` again.

Expected: the issue remains. Elapsed time includes time before refresh. View selections reset on reload.

### 3. Claim the issue

1. Select **Volunteer · Sam Chen**.
2. Select `ISS-004`.
3. Claim the issue.

Expected: Sam owns the issue. The demo records first-assignment delay separately.

### 4. Check message visibility

1. Choose **Internal note · staff only**.
2. Send “Check switch port 17.”
3. Send the public reply “We are investigating your connection.”
4. Select the contestant persona.

Expected: the contestant sees the public reply. The view omits the internal note and its activity entry. It also omits Cedar and Orbit issues.

### 5. Transfer ownership

1. Select the volunteer persona.
2. Escalate `ISS-004`.
3. Check that the issue awaits a specialist and Sam still owns it.
4. Select **Technical specialist · Dr. Maya Rao**.
5. Accept the handoff.

Expected: Maya becomes the owner. The first-assignment delay does not change.

### 6. Resolve the issue

1. Choose Custom in **Resolution summary**, then enter “Restored the network connection and verified access.” in **Custom resolution summary** and resolve.
2. Check that the demo retains the summary and stops unresolved time.
3. Refresh the page.
4. Select the issue again.
5. Check that elapsed time remains at the stopped value.

### 7. Record an award

1. Select **Jury · Alex Morgan**.
2. Select `ISS-004`.
3. Choose Custom in **Award minutes**, then enter 7 in **Custom award minutes**.
4. Enter the explanation “Seven minutes lost to the connection interruption.”
5. Record the award.
6. Select the contestant persona.

Expected: one award references `ISS-004` and awaits external application. The award button disappears. The contestant sees the same pending decision.

### 8. Confirm external application

1. Select the volunteer persona or another staff persona.
2. Select the simulation confirmation checkbox.
3. Select **Confirm applied externally**.
4. Select the contestant persona.
5. Refresh the page.

Expected: the demo records a separate confirmation actor and timestamp. The contestant sees the applied status after refresh. No actual contest clock changes.

### 9. Check reset

1. Select **Reset demo**.
2. Cancel the dialog.
3. Check that progress remains.
4. Select **Reset demo** again.
5. Accept the dialog.
6. Reload the page.

Expected: the demo contains exactly three seeded issues and no awards. Seed timestamps reflect the reset time.

## Phone and keyboard

### Phone layout

Repeat these checks at 390 × 844 and 320 × 740 CSS pixels:

1. Select the volunteer persona.
2. Read the queue cards and issue details.
3. Filter by status.
4. Claim an open issue.
5. Send a message.
6. Escalate the issue.

Expected: the page needs no horizontal scrolling. Owner, location, and timer remain readable. Panels stack vertically. Controls remain usable.

### Keyboard navigation

1. Open a fresh page.
2. Press Tab.
3. Activate **Skip to main content**.
4. Use Tab to reach the persona selector, reset control, forms, filter, and issue buttons.
5. Check that each control has a visible focus indicator and an associated label.
6. Use Enter to activate buttons and submit valid forms.
7. Use Space to toggle the application checkbox.
8. Test the native reset dialog with the keyboard.

### Validation and desktop layout

1. Try blank messages and messages that contain only whitespace.
2. Try blank summaries and summaries that contain only whitespace.
3. Choose Custom award minutes and try negative, fractional and empty values.

Expected: browser validation or a visible error prevents the action. The demo records no completed transition or invalid award.

1. Review the contestant layout on a laptop.
2. Review the jury layout on a desktop.
3. Review both layouts at 200% browser zoom.
4. Check that staff views clearly distinguish public replies from internal notes.

## Persistence failures and limits

1. Open browser developer tools.
2. Change the stored value for `minsky.demo.v2` to `{"version":99}`.
3. Refresh the page.

Expected: the interface shows a warning. The demo disables workflow controls. The stored value remains unchanged. The reset control remains enabled.

4. Reset the demo.

Expected: reset restores operation. If the browser denies storage or storage is full, the interface reports that changes may remain only in memory.

The automated browser suite covers:

- The complete journey across personas.
- Refresh persistence.
- Message visibility.
- Awards.
- Reset.
- A volunteer layout at 390px width.
- Keyboard entry points.
- Recovery from incompatible stored data.

Automation does not replace review on real devices, with screen readers, or across browser engines.

Record observed results in [current-state.md](current-state.md). Never mark suggested checks as completed.

## T0002 roles, handoffs and reopening

### Direct triage and combined roles

1. Reset. Select **Technical specialist · Dr. Maya Rao**, claim Aurora's `ISS-001`, and resolve it with “Direct specialist fix.” No handoff is required.
2. Reset. Select **Volunteer + Technical specialist · Robin Ellis**. Both roles appear in the persona label and page heading. Claim `ISS-001`.
3. Escalate. Robin remains owner and has no **Accept handoff** button. Robin can still resolve while awaiting help.
4. Select Maya and accept. First-assignment delay stays unchanged. Escalate again as Maya.
5. Select Robin and accept Maya's handoff. Resolve with “Combined-role fix.” Refresh and check that the owner and public history identify Robin.
6. Repeat claiming, handoff acceptance and reopening with the keyboard at 390 × 844 and 320 × 740. The heading displays both roles even if the native select truncates its option text. Check no horizontal overflow and visible keyboard focus.

Jury-only Alex has a resolved-only queue, no claim/reopen controls, and award controls for unawarded resolved issues. The automated support + jury fixture checks the union of active-queue and award capabilities; that fixture is not an extra demo persona.

### Reopen with an award and retained history

1. Reset. As Maya, claim Aurora's `ISS-001`. Send an internal note “Private diagnostic.” Resolve with “First fix.” Record the stopped **Unresolved time** and first-assignment delay.
2. As Alex, record 5 minutes with explanation “Initial interruption.” Leave application pending.
3. As Aurora, filter to Resolved. Wait while resolved and verify the timer stays stopped. Enter “Still broken” in **Public reopening reason** and select **Reopen issue**.
4. Expect the filter to change to In progress with `ISS-001` selected. Maya remains owner. The first summary remains visible, the public reason identifies Aurora, replies resume, and the internal note remains absent. The timer resumes from its stopped value, excluding the resolved interval.
5. As Sam, confirm the pending award's external application. Sam cannot resolve Maya's issue. As Alex, verify the reopened issue is absent from the resolved-only queue.
6. As Maya, resolve with “Second fix.” As Robin, reopen with “Helper found another failure.” The helper does not take ownership.
7. Refresh, select `ISS-001`, and verify both prior summaries and the applied award remain. Maya can resolve with “Third fix.” Alex sees the issue again but cannot add another award.
8. Repeat with no award and with an award applied before reopening. Reasons containing only spaces must produce an error without changing history. Empty reasons are blocked by the browser.

Focused tests verify the exact 10:00 → 10:05 → 10:08 → 10:10 seven-minute example, cross-team rejection, duplicate actions, backwards timestamps, and invalid cycle/award data. Browser tests verify cycles and accumulated time across personas and refresh.

### Legacy migration and reset

1. In a fresh demo origin, use developer tools to store the contents of `tests/fixtures/v1.json` under `minsky.demo.v1`, with `minsky.demo.v2` absent. Refresh.
2. As Robin, check Cedar's pending handoff remains owned by Sam; internal/public messages keep their attribution. Accept the handoff.
3. Select Orbit's resolved `ISS-003`. Its summary, 3-minute award and Maya's external-application confirmation remain. Reopen with a public reason, refresh, and check those records persist.
4. Verify storage now contains v2 and the unchanged v1 source. Reset, refresh, and verify three seed issues and no awards. Old v1 progress must not return.
5. The focused tests cover invalid v1/v2, preference for existing v2, unsupported versions, failed reads/writes and source preservation. The browser recovery test covers an invalid v2 value and explicit reset.

Record completed checks and remaining manual work in [current-state.md](current-state.md).

## Common resolutions and award amounts

When another walkthrough asks for a specific resolution message, choose Custom first. When it asks for a non-preset award such as 7 minutes, choose Custom first.

1. Reset and claim Aurora's `ISS-001` as Maya. The resolution dropdown starts with **Choose a response**; an explicit choice is required.
2. Choose **Resolved without comment** and resolve. Check that this exact public summary appears for Aurora and survives refresh.
3. Reopen as Aurora with a public reason. Return to Maya: the resolution choice must be empty. Try each other common response on later cycles: **Service restored**, **Device issue resolved**, **Problem statement clarified**. Earlier summaries must remain visible.
4. Choose Custom and enter your own summary. Whitespace-only custom summaries must fail; a valid custom summary must be retained. Switching back to a common response hides the custom field and uses the selected response.
5. On an unawarded resolved issue, select Alex. Check the award dropdown offers **0, 5, 10, 15, 30, 60, Custom** and requires a selection. Custom reveals the whole-minute input; negative, fractional and empty values fail.
6. Record **0 minutes** with explanation “No extra time needed.” Refresh as Aurora and verify **0 minutes awarded**, the explanation and pending application status. The award must not revert to “No award recorded.” Confirm application as staff separately; reopening must preserve the zero-minute decision and still prevent a second award.
7. Reset between checks of other preset amounts. Check a custom amount such as 7 and custom zero. Verify switching from Custom to a preset uses the preset, then check keyboard access to both dropdowns and conditional fields on desktop and phone widths.
