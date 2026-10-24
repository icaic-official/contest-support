# Connected manual verification

## Documentation site (T0011)

Run `npm run docs:build` and `npm run docs:test` after installing the separate `site/` dependencies.
For the published site, run `MINSKY_DOCS_URL=https://minsky-docs.icaic-minsky.workers.dev npm run docs:test`.
These checks only read documentation.
Check a direct guide URL after refresh, search by keyboard, phone navigation, and a missing page.
Review light and dark themes at desktop and 320px widths.
The sign-in footer, the **Documentation** item in the desktop console account menu and the documentation link in the phone **Me** tab open the guides in a new tab.
Those links reach the development app only after its separate frontend deployment.

## Cloudflare authentication

Follow [Verify Cloudflare authentication](verify-cloudflare-authentication.md) for isolated HTTPS browser checks.
These checks use fictional local accounts.
The account reference records current cookie, origin, recovery, and session restrictions.

## Connected application

The live development app is the Cloudflare Worker at https://minsky-dev.icaic-minsky.workers.dev.
Use an organizer-provided username and password.
Docker and persona switching are not required.
For a separate Cloudflare installation, create the first admin through its bootstrap step.
For the Supabase adapter on your own project, follow [Run the Supabase adapter](supabase-provider.md).
`npm run cloud:recover-admin` is that adapter's administrator recovery.
Use `npm run cloudflare:recover-admin` when the Cloudflare development admin cannot sign in.
Use a separate browser or profile for each account: contestant, volunteer, specialist, jury, and admin.
Work only in a clearly identified development or test session.

T0015 replaced the earlier workspace with three UIs. The membership and the window width select the UI:

- A contestant account gets the contestant desktop app. Use a window at least 1024 px wide, such as 1280 × 800.
- A staff account below 1024 px gets the organiser phone app. Use 390 × 844, and 320 × 740 for the narrow check.
- A staff account at 1024 px and wider gets the organiser desktop console. Use 1280 × 800.

Unless a step names one UI, do the step in the organiser phone app and again in the organiser desktop console.
Section 7 lists the checks for each UI.

## 1. Login and session access

1. Sign in with a username that uses different letter case.
2. Refresh the page.
3. Check that the session returns.
4. Sign out.
5. Check that contest data disappears.
6. Sign in with an account that has no membership.
7. Check that the access message appears.
8. Change your password through the labeled form.

## 2. Account administration

1. Sign in as admin.
2. Open the **Session** tab in the phone app, or **Accounts** in the desktop console sidebar.
3. Create a contestant username account for a roster team.
4. Give its temporary password to the account holder through a secure channel.
5. Assign individual staff accounts.
6. Assign combined specialist, volunteer, and jury roles.
7. Check the membership list.
8. Revoke one session membership.
9. Query the database directly with the revoked account.
10. Check that the query returns no session data.
11. Refresh that account's page.
12. Check that the UI clears the data.
13. Repeat the UI check when the page receives focus.
14. Attempt to remove the last admin.

Expected result: the app rejects removal of the last admin.

Check the admin screens of T0015 in both organiser layouts:

1. In the phone **Session** tab, check the status counts, the intake switch and the image limits with the − and + buttons.
2. Select **New account**. Create a staff account. Check that the sheet shows the username and the temporary password once, with copy buttons and **Done**.
3. Select **Done**. Open the account again. Check that the credentials do not show again.
4. Reset the password of another account. Check that a confirmation dialog shows first. Check that the new credentials show once.
5. Check that your own account has no password reset.
6. Remove session access from an account. Check that a confirmation dialog shows first.
7. In the desktop console, repeat steps 2 to 6 with **Create account** and **Manage** on **Accounts**.
8. In **Session settings**, change the image limits. Check that the phone **Session** tab shows the same values.
9. Archive the event. Check that every admin control is disabled.

## 3. Contestant intake

1. Close contestant intake as admin.
2. Attempt a new contestant submission.
3. Check that the submission fails.
4. Submit an issue as staff on behalf of a roster team.
5. Reopen an existing resolved issue.
6. Check that staff submission and reopening still work.
7. Open contestant intake again.

## 4. Submission, replies, and handoff

1. Select **Report an issue** as a contestant, or **Report for a team** as support.
2. Complete the form.
3. Submit the report.

Expected result: successful submission closes the form and selects the new report.

1. Open the report form again.
2. Select **Cancel**.
3. Check that focus returns to the report button.
4. Claim the issue as a volunteer in another signed-in browser.
5. Add a public reply. Choose **To the team** in the phone app, or **Public reply** in the desktop composer.
6. Add an internal note. Choose **Staff only** in the phone app, or **Internal note** in the desktop composer. Check that the message field has the amber striped surface.
7. Request a specialist handoff.
8. Check that the volunteer remains the owner.
9. Accept the handoff as another specialist with **Accept handoff**.
10. Check that the contestant cannot see the internal note.
11. Repeat the privacy check through direct API and history queries.
12. Leave the reply input blank.
13. Check that the send button remains disabled. It is **Send to team** or **Add internal note** in the phone app, and **Send** or **Add note** in the desktop composer.

Check reply retries with isolated accounts and controlled request failures:

1. Enter a public reply and cause its response to be lost after the server records it.
2. Select **Retry last request**. Repeat a transport failure and check that the text remains.
3. Let the next retry succeed. Check that the text clears and the send button is disabled.
4. Check that history contains one copy of the reply.
5. Enter a fresh reply. Check that it sends and clears normally.
6. Repeat with an internal note. Check that a successful retry clears the note.
7. Reject a reply at the server. Check that its text remains editable and no history entry appears.

The retry cases in `tests/workspace-refresh.spec.ts` automate these checks with mocked responses.

Check submission retries through account-check failures:

1. Lose a submission response after the server records the issue.
2. Fail the next account check. Check that contest data disappears.
3. Restore the account check. Check that **Retry last request** returns without an automatic write.
4. Select **Retry last request**. Check that one issue exists and the request ID stays the same.
5. Repeat with a response delayed until after account-check recovery. Check that focus stays on the current page.
6. Sign out with an uncertain request. Sign in again and check that the old retry is absent.

With isolated contestant memberships in two sessions, lose a submission response and remove the original session membership.
Let the page select the remaining session. Retry the request and check that the server rejects access to the original session.
Check that the remaining session contains no copy of the submitted issue.
The cases in `tests/workflow-session-retry.spec.ts` exercise these session checks through the embedded PostgreSQL fixture.

## 5. Resolution and award

1. Resolve the issue with a preset or **Custom** summary.
2. Check that the timer stops.
3. Record an award as jury with a public explanation.
4. Repeat the award check with zero, preset, and custom whole-minute values on suitable test issues.
5. Confirm external application as staff.

Expected result: Minsky records application status without changing an external contest clock.

## 6. Reopening and persistence

1. Reopen the issue as its contestant or a helper.
2. Check that the prior owner remains assigned.
3. Check that all previous resolution summaries remain available.
4. Check that the existing award remains intact.
5. Check that unresolved time excludes resolved intervals.
6. Resolve the issue again.
7. Refresh each browser.
8. Compare the shared state.

## 7. Interface and accessibility (T0015)

Do these checks in the light theme and again in the dark theme.
Change the theme with the theme menu. Check that the choice stays after a page reload.
Check that each status shows an icon or a label, not only a color.
Check that the page has no horizontal overflow and that focus is always visible.

### Sign-in and session access

Review the sign-in page at 1280 × 800, 390 × 844 and 320 × 740.

1. Toggle **Show password** and **Hide password** with the keyboard.
2. Check that organizer access and recovery guidance remain visible.
3. Sign in with an account without membership. Check that the access screen shows **Refresh access** and **Sign out**.
4. Press Tab once after sign-in. Check that **Skip to main content** appears and moves focus to the main content.

### Organiser phone app (390 × 844)

Sign in as a volunteer, a specialist, a jury member and an admin.

1. Check the bottom tabs. Volunteers and specialists get **Queue**, **Mine**, **Find** and **Me**. Jury members get **Awards**. Admins also get **Session**.
2. Check that a jury-only member sees resolved issues only, except a reopened issue with a pending award.
3. In **Queue**, check the chips, the cards sorted by unresolved time and the timer colors. The timer is neutral below 10 minutes, amber below 20 minutes and rose after that.
4. Claim an issue on its card. Check that the list stays. Use **Claim and go** on another issue. Check that the issue view opens.
5. In the issue view, use the bottom action bar. Open each sheet: reply, resolve, escalate, image, award, confirmation and reopen.
6. In each sheet, select **Cancel**. Check that the sheet closes without a swipe and that no action is recorded.
7. Select **Back**. Check that focus returns to the card of the issue.
8. Change the tab. Check that focus moves to the tab heading.
9. Check that buttons are at least 44 px high.
10. Repeat steps 3 to 8 at 320 × 740.

### Organiser desktop console (1280 × 800)

Sign in as the same accounts.

1. Check the sidebar pages. Volunteers and specialists get **Queue**, **Assigned to me** and **Handoffs**. Jury members get **Award review**. Every person gets **Teams & tables**. Admins also get **Overview**, **Accounts** and **Session settings**.
2. Collapse the sidebar. Reload the page. Check that it stays collapsed.
3. On the queue, press J and K. Check that focus moves between rows. Press Enter on an issue number. Check that the side sheet opens.
4. Check that J and K do nothing while a field or a dialog has focus.
5. Press ⌘K or Ctrl+K. Search for `31`, `#31` and `ISS-31`, three letters of report text, a team name and a table number. Check that each result opens the correct issue, team filter or page.
6. Claim an issue in a row. Check that the page stays. Claim another issue in the side sheet. Check that the sheet stays open.
7. Open resolve, escalate and reopen from the sheet. Check that each opens a dialog and that **Cancel** closes it without an action.
8. Check that the sheet shows one filled primary action. **Decide award** and **Confirm applied** open the **Outcome & award** tab.

### Contestant desktop app (1280 × 800)

Sign in as a contestant.

1. Check the top bar: event, session, **Live** or **Reconnecting**, the theme menu and the account menu with **Change password** and **Sign out**.
2. Open a report. Check the headline, the live unresolved timer, the four-step tracker, the resolution cards, the award card and the messages.
3. Select **Report an issue**. Check the category tiles, the description limit of 2,000 characters and the team location.
4. Send a reply with Enter. Add a line with Shift+Enter.
5. Close contestant intake as admin. Check that **Report an issue** is disabled with a reason.

### Refresh persistence

1. Note the unresolved timer of an open issue. Reload the page. Check that the timer continues from the same value and does not reset.
2. Resolve the issue. Check that the timer stops. Reopen it. Check that the timer continues and excludes the resolved interval.
3. Type a reply draft. Do not send it. From a second browser, record a change on another issue. Check that the draft and the selected issue stay in the first browser.
4. Disconnect the network until **Reconnecting** shows. Connect again. Check that **Live** returns and that the draft stays.

A page reload discards an unsent draft. The drafts stay only during the automatic snapshot refresh.

### Public replies and internal notes

1. As staff, add a public reply and an internal note to the same issue.
2. As the contestant, check that the public reply shows and the internal note does not show.
3. Add a staff-only image and a team-visible image. As the contestant, check that only the team-visible image shows.
4. Repeat the privacy check through direct API and history queries.

### Real devices

Use a real phone and a screen reader when available.
Review the contestant, jury and admin views at 1280 × 800 and at 200% zoom.

**Live** shows a subscribed Realtime connection.
**Reconnecting** shows that the connection is down and the app tries again.

## 8. Temporary passwords and recovery

1. Sign in as a new username account with its temporary password.
2. Check that contest data remains blocked.
3. Check that direct API reads and writes remain blocked.
4. Refresh the page.
5. Check that refresh does not bypass the password requirement.
6. Change the temporary password through the required form.
7. Check that contest access works.
8. Verify the requester's identity as admin.
9. Reset that account.
10. Give the replacement temporary password to the account holder through a secure channel.
11. Check that old sessions and refresh tokens lose access.
12. Sign in again with the replacement temporary password.
13. Change that temporary password.
14. Check that access returns.
15. Dismiss the displayed credentials.
16. Check that existing passwords are not visible.
17. Attempt to create a duplicate username.
18. Check that the app rejects it.
19. Attempt a password reset as a non-admin.
20. Check that the app rejects it.
21. Assign a username to an existing development account.
22. Check that its password and Auth UUID remain unchanged.

## 9. Concurrent actions and isolation

1. Compare two simultaneous claims.
2. Compare two simultaneous awards.
3. Check state after refresh and reconnect.
4. Attempt unauthorized queries across teams and sessions.
5. For the Supabase adapter, run `MINSKY_TEST_PROJECT_REF=<your-test-project-ref> npm run test:cloud` for repeatable checks with real accounts on your isolated test project.
   The suite requires `MINSKY_TEST_PROJECT_REF`. It does not fall back to the linked project.

The suite creates isolated test fixtures and deletes only those fixtures.
It does not reset the project.

## 10. Issue images

Use an active event unless a step says the event is archived.

1. As a volunteer, specialist, jury member, and admin, add a JPEG, PNG, or WebP image from the issue detail.
2. Check the progress text, thumbnail, uploader, and time.
3. Open the full-size preview with the keyboard.
4. Download the image.
5. Close the preview and check that focus returns to the thumbnail.
6. Keep the default **Staff only** choice for one image.
7. Choose **Visible to the team** for another image.
8. As a contestant on that team, check that only the team-visible image appears.
9. Check that the contestant has no image file control.
10. As a contestant on another team, check that neither image appears.
11. As a staff member who did not upload the image, check that removal is refused.
12. As the uploader, remove the image.
13. Check that activity records the removal at the same visibility.
14. Retry a failed transfer with **Try the upload again**.
15. Reject a file that is not a JPEG, PNG, or WebP image.
16. Reject an image above the current size limit.
17. As admin, save lower image limits.
18. Check that existing images remain and that the next upload must fit.
19. Resolve the issue.
20. Check that the images remain and that an authorized upload still works.
21. Archive the event.
22. Check that preview and download still work.
23. Check that upload, removal, and limit changes are refused.
24. Repeat the image controls at 390×844 and 320×740.
25. Check that the page does not scroll horizontally.
26. Start a team-visible upload and cause a transfer failure in an isolated test.
27. Check that **Who can see this image** remains locked to **Visible to the team**.
28. Select **Cancel upload**. Check that the unfinished files are deleted before the choice becomes available.
29. Select **Staff only** and start a new upload. Check that contestants cannot see it.
30. Cause file deletion to fail. Check that the app reports the failure and shows **Retry removal**.
31. Refresh the page. Check that the uploader still has **Retry removal**, even though the image is no longer listed.
32. Retry removal. Check that both stored files are gone and the retry control disappears.
33. Start an upload, then remove that member's session access before completion. Check that unfinished-file access and completion fail.
34. Repeat with a password reset and with event archival.
35. Start two uploads, then lower the count limit to one. Check that only one can become attached.
36. Try a file path with an extra folder. Check that Storage refuses it.

Check delayed previews with two different images, A and B, in an isolated test:

1. Delay the original-file response for A, then open A.
2. Close its preview and open B. Let B finish first.
3. Release A's delayed response. Check that B's image, uploader, time, and download file still match B.
4. Repeat with a failed response for A. Check that it does not report an error for the closed preview.
5. Repeat with Escape to close A. Check that focus returns to A's thumbnail before opening B.
6. Fail the response for the current preview. Check that the error still appears.

`tests/images.spec.ts` automates these response-order checks with the development image harness.
It also checks that closing the preview releases its temporary browser URL.
These tests do not access hosted data.

## 11. Team search

Use a volunteer or specialist account, then repeat the queue search as jury and as a session admin.
Use a contestant account to confirm that team search stays hidden.

1. Open the issue queue.
2. Type part of a team name.
3. Check that suggestions update and that none is selected by itself.
4. Check that each suggestion shows the team name, location, and unresolved-issue count.
5. Choose a suggestion with the keyboard and again with a pointer.
6. Check that the queue shows that team's issues.
7. Change the status filter to **Resolved**.
8. Check that the same team's resolved issues remain available.
9. Clear the team.
10. Check that the previous queue returns.
11. Select the team again.
12. Open **Report for a team**.
13. Check that the same team is already selected.
14. Edit the team text.
15. Check that **Submit issue** stays unavailable until you choose a suggestion.
16. Submit the issue.
17. Check that the new issue belongs to that team.
18. Type a table number, a reordered name, and a small spelling mistake.
19. Check that the intended team appears before weaker matches.
20. Type a query that matches nothing.
21. Check that the message says no team matches and that no team is selected for you.
22. Repeat the queue search in the phone app at 390px and 320px widths. In the desktop console, also search for the team with ⌘K or Ctrl+K.
23. Sign in as a contestant.
24. Check that **Report an issue** does not ask for a team.

Expected result: the submission stores the chosen team's database id. Contestants remain limited to their own team. Jury members can filter the resolved queue and do not gain the other status filters.

Also check these regressions with isolated fixtures:

- With locations `Desk 1234` and `Desk 1235`, `123` matches neither. `1234` and `001234` match only the first number. A spelling mistake in a word can still match beside an exact number.
- Type a query with suggestions, then press Tab. Queue focus moves to **Status**; report-form focus moves to **Category**. The popup closes and no team is chosen. Arrow keys and Enter still choose a team; pointer selection still works.
- Choose a team, Tab from the input to **Clear team**, and activate it with Enter, then repeat with Space in both controls. Both team fields clear, focus returns to the initiating input, and the queue shows all teams under the existing status filter. The report draft and category stay intact; **Submit issue** stays disabled until another team is chosen. Repeat clearing with a pointer.
- Select a team as staff, then assign that account to a different contestant team. Trigger the normal refresh by focusing the window. The search disappears and the contestant's own issues remain visible without reloading.
- Revoke access to the selected session while another session remains accessible. The automatic fallback clears the query and chosen team. Removing the chosen team from the next snapshot also clears it and disables staff submission until another team is chosen.

`tests/team-search.spec.ts` runs the focus and refreshed-snapshot checks using mocked Auth and session responses.
These fixtures do not connect to a hosted backend or verify database authorization.

## 12. Workspace refresh and cloud fixture recovery

Use isolated test accounts for these checks.

1. Open the issue queue as support staff without selecting a row.
2. Enter a reply on the displayed issue.
3. Submit another issue from a second client.
4. Check that the first client still shows the original issue and reply text.
5. Send the reply. Check that it belongs to the original issue.
6. Open a membership form as an administrator. Use **Manage** on **Accounts** in the desktop console, or an account in the **Session** tab.
7. Change that member's roles or team from a second administrator account.
8. Return focus to the first client so it receives the current membership.
9. Check that both the summary and form show the current roles or team.
10. Save the form. Check that it preserves the second administrator's change.

The credential-free tests in `tests/workspace-refresh.spec.ts` cover these UI effects and exact write requests.
The cleanup tests in `scripts/cloud-test.test.mjs` check a failed deletion, a successful retry, and the retained recovery file.
They use mocked cloud responses and a local child process. They do not access hosted data.
See [Recover test:cloud fixtures](run-provider-tests.md#recover-testcloud-fixtures) for failed cloud cleanup.

Record observed results in [run log](history/run-log.md).
Suggested manual checks are not completed checks.
Browser automation does not establish results for real devices, assistive technology, or capacity.

## 13. Jury worklist (T0009)

Run these checks on the current T0009 revision after merging current `main`.
For hosted acceptance, confirm your isolated test target before creating UUID-owned fictional accounts and records.
Delete only that run's fixtures. Verify cleanup after the run. Use jury-only, combined jury/support, support-only,
admin-only, and contestant accounts. Do not use real contest reports as fixtures.
This is a checklist, not evidence that hosted or physical-device checks have passed.

T0015 moved the worklist into the phone **Awards** tab and the desktop **Award review** page.
The lists are **To decide**, **To apply** and **Applied**. There is no separate **Jury worklist** entry.
See [frontend architecture](frontend-architecture.md#jury-award-lists).

1. As jury or a combined-role member, open **Awards** on a phone or **Award review** in the desktop console.
   Other roles must not have this entry. Admin alone does not grant jury powers.
2. Prepare resolved issues without decisions, a zero-minute pending award, a
   pending award on a reopened issue, an applied award, and a reopened issue with
   no award. Compare **To decide** and **To apply** and their counts with the specification's
   eligibility table. Order decisions by resolution time and applications by award time.
   Check that **Applied** shows the applied award, latest confirmation first.
3. As a combined-role member, filter the ordinary queue by team, then open the award lists.
   The lists must still cover the entire authorized session.
   Return to the queue. Check that its filter and selected issue remain.
4. Check the team, location, status, resolution summary, resolver and time, and the unresolved duration.
   A pending award on a reopened issue shows a **Reopened** badge with the current status.
   When the award resolution was reopened, the row shows "This award relates to an earlier resolution."
   Resolved intervals are excluded from the duration. The first-assignment delay is separate.
5. Record an explicit zero-minute decision with a public explanation.
   It must leave **To decide** and enter **To apply**. Zero is not a missing award and is not automatically applied.
6. As support, reopen an issue with a pending award. As jury-only, open it from **To apply**.
   Confirm external application with the required checkbox. It leaves **To apply**.
   Minsky does not change the external clock.
   Resolve it again. Its existing award and confirmation remain, with no second decision.
7. Open two signed-in browser contexts. In one, edit an explanation draft. In
   the other, award a different issue. The lists and counts update without clearing the
   unrelated draft or moving focus. Confirm an award in one context and check that it
   leaves **To apply** in the other. Check refresh and reconnect. Use the automated retry
   cases to verify that lost award and confirmation responses reuse the request ID.
   Confirm one award, one confirmation, and one history entry for each action.
8. Switch sessions. Check that the records belong only to the next session.
   Losing the jury role removes the award lists. Losing membership clears protected records.
   Password setup and reset must keep the existing account-readiness gate.
9. Check the award lists with the keyboard only. Check that a reopened issue without an award leaves **To decide**.
   Archived records remain readable while decisions and confirmations are unavailable.
10. Check the desktop console at 1280 × 800, the phone app at 390 px and 320 px, native browser 200% zoom, and screen-reader
    labels. No text or control should clip or cause horizontal overflow. Distinguish
    loading and read errors from valid empty lists. Failed reads must clear stale data.

Record results and remaining limits in [run log](history/run-log.md#t0009-parallel-maintenance-2026-10-18).
The credential-free browser harness exercises actual migrations and RLS with
simulated hosted transport. It does not establish real Auth, Storage, Realtime,
deployment, offline operation, or capacity results.

For isolated hosted acceptance of the Supabase adapter from a local CLI, prepare your own test project and credentials as [Run against the Supabase provider](run-provider-tests.md#run-against-the-supabase-provider) states.
Then run the current cloud suite against that explicit target:

```sh
MINSKY_TEST_PROJECT_REF=<your-test-project-ref> npm run test:cloud
```

Do not apply unrelated remote migrations or change provider configuration for this test.
If cleanup retains a recovery file, follow [Recover test:cloud fixtures](run-provider-tests.md#recover-testcloud-fixtures).
Record local simulations and hosted-service CLI results separately.


## 14. Browser routes and workflow retry recovery

Use isolated fictional accounts for these checks. These steps do not authorize hosted fixture creation.
The [frontend architecture](frontend-architecture.md#browser-routes) lists paths and required roles.

1. Open `/jury` while signed out. Sign in as a jury member. Check that the award screen opens.
2. Refresh the page. Check that the address remains `/jury` and current session data loads.
3. Open the queue, award screen, and account screen. Use browser Back and Forward. Check each address and screen.
4. Open **Change password**. Check cancellation and completion. Both must retain `/account`.
5. As support staff, open `/administration`. Check that the app returns to `/issues` without administration data.
6. Remove a jury or administrator role in another isolated client. Refresh access. Check that the restricted section closes.
7. Repeat navigation in the organiser phone layout. Check keyboard focus after a tab change and after a return from an issue.
8. Use the existing fictional-response retry cases to interrupt a workflow response and account check.
   Check that protected content hides while the account check fails.
   After recovery, select **Retry last request**. Check that it reuses the original actor, session, request ID, and command.
9. Repeat with access to the original session removed. Check that the retry reaches that session's server access check.
10. Sign out while a response is pending. Sign in with another account. Check that no old request or protected record remains.

A full reload discards in-memory drafts, filters, and retry metadata.
Record observed results separately from these instructions. Historical runs do not verify the combined frontend.

## 15. Session announcements (T0006)

Use an active event with an admin, a jury member, a volunteer, and a contestant.
Use two browser windows for the live checks. Run these checks after a reviewed deployment.

1. As the admin, publish an announcement with a title, details, and no expiry.
   Check that the contestant and volunteer see the title above the workspace without a refresh.
2. As the contestant, start a report and leave it unsent. Publish another announcement. Check that the report text stays.
3. Use only the keyboard. Open and close the details with Enter and Space. Check that the focus ring is visible.
4. Check that the contestant and volunteer have no **New announcement**, **Edit**, or **Remove** controls.
5. As the jury member, edit the announcement. Check that the original publisher and time remain, and the editor and time appear.
6. Open the same edit in two manager windows. Save in the first window. In the second, check the review panel.
   Choose **Keep my draft**, change the text again in the first window, and check that the second window asks for another review.
   Choose **Load latest text** and save.
7. Add a JPEG, PNG, and WebP image. Check progress, the inline image, and download.
   Try a text file renamed to `.png`, an image above 10 MB, and a fifth image. Each must fail with a clear message and leave the text available.
8. Remove one image. Check that readers lose it and the manager list shows one fewer.
9. Set an expiry about one minute ahead. After it passes, check that readers lose the announcement within 15 seconds and the manager still sees **Expired**.
   Clear the expiry and check that readers see it again.
10. Remove an announcement. Check that readers lose it, the manager sees **Removed** with the remover, and it has no **Edit** control.
11. Reload each window. Check that the state is unchanged and the reporting form never waited for announcements.
12. At 320 px and 390 px wide, check that the announcement strip wraps, scrolls inside its area, and causes no horizontal page scroll.
13. Archive the event. Check that announcements stay readable and every management control disappears.
14. Repeat the checks on a Supabase build when you run the adapter on your own project.
