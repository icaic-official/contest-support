# Connected manual verification

## Documentation site (T0011)

Run `npm run docs:build` and `npm run docs:test` after installing the separate `site/` dependencies.
For the published site, run `MINSKY_DOCS_URL=https://minsky-docs.icaic-minsky.workers.dev npm run docs:test`.
These checks only read documentation.
Check a direct guide URL after refresh, search by keyboard, phone navigation, and a missing page.
Review light and dark themes at desktop and 320px widths.
The footer on the landing and sign-in pages, the **Documentation** link in the **Help** section of the account page and the documentation link in the phone **Me** tab open the guides in a new tab.
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
Use `npm run cloudflare:recover-admin` when the Cloudflare development admin cannot sign in.
Use a separate browser or profile for each account: contestant, volunteer, specialist, jury, and admin.
Work only in a clearly identified development or test session.

T0015 replaced the earlier workspace with three UIs. The membership and the window width select the UI:

- A contestant account gets the contestant desktop app. Use a window at least 1024 px wide, such as 1280 × 800.
- A staff account below 1024 px gets the organizer phone app. Use 390 × 844, and 320 × 740 for the narrow check.
- A staff account at 1024 px and wider gets the organizer desktop console. Use 1280 × 800.

Unless a step names one UI, do the step in the organizer phone app and again in the organizer desktop console.
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

Check the admin screens of T0015 in both organizer layouts:

1. In the phone **Session** tab, check the status counts, the intake switch and the image limits with the − and + buttons.
2. Select **New account**. Create a staff account. Check that the sheet shows the username and the temporary password once, with copy buttons and **Done**.
3. Select **Done**. Open the account again. Check that the credentials do not show again.
4. Reset the password of another account. Check that a confirmation dialog shows first. Check that the new credentials show once.
5. Check that your own account has no password reset.
6. Remove session access from an account. Check that a confirmation dialog shows first.
7. In the desktop console, repeat steps 2 to 6 with **Create account** and **Manage** on **Accounts**.
8. In **Session settings**, change the image limits. Check that the phone **Session** tab shows the same values.
9. Archive the event. Check that every admin control is disabled.
10. In a session without teams, open the new account form. Check that the **Team** card is dimmed and says **Add a team first.** Add a team. Check that the card is available and says **Shared team login**.

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
The cases in `tests/workflow-session-retry.spec.ts` exercise these session checks through the Cloudflare services on local D1.

## 5. Resolution and award

1. Resolve the issue with a preset or **Custom** summary. A preset other than **Resolved without comment** shows an optional comment field. The team sees the preset followed by the comment.
2. Check that the timer stops.
3. Record an award as jury with a public explanation.
4. Repeat the award check with zero, preset, and custom whole-minute values on suitable test issues. Enter `2.5` as a custom value. The form shows a message and keeps **Record** disabled.
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

### Landing page

Review the landing page at 1280 × 800, 390 × 844 and 320 × 740, in the light and dark themes.

1. Check that the page has no horizontal overflow and that the **Sign in** and **Read the docs** buttons are at least 44 px tall.
2. Select **Sign in**. Check that the sign-in page opens. Select **Minsky** above the heading. Check that the landing page returns.
3. Select **Docs** and **Read the docs**. Check that the guides open in the same tab.
4. Watch the example issue. Check that the status, the timer and the activity change from **Open** to **Resolved**, and that the timer stops on **Resolved**.
5. Turn on the device setting that reduces motion. Reload. Check that the example issue shows the resolved state and does not change.
6. Press Tab once. Check that **Skip to main content** appears and moves focus to the main content.

### Sign-in and session access

Review the sign-in page at 1280 × 800, 390 × 844 and 320 × 740.

1. Toggle **Show password** and **Hide password** with the keyboard.
2. Check that organizer access and recovery guidance remain visible.
3. Sign in with an account without membership. Check that the access screen shows **Refresh access** and **Sign out**.
4. Sign in with a member account. Disconnect the network and wait up to 10 seconds for the access screen. Check that it asks you to check the connection and does not mention an organizer. Select **Refresh access**. Check that the button stays disabled while the read runs. Connect again and select the button. Check that the workspace returns.
5. Press Tab once after sign-in. Check that **Skip to main content** appears and moves focus to the main content.

### Organizer phone app (390 × 844)

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
11. Sign in as an admin without a support role. Open an open issue. Check that the bottom bar shows **Resolve** and no **Claim**, and that one muted line under the buttons says that claiming needs the Volunteer or Specialist role. Sign in as a volunteer. Check that the same issue shows **Claim** and no such line.
12. In a long queue, scroll to a card far down. Make its claim fail, for example when another volunteer claims the issue first. Check that the error stays pinned to the top of the list. Do the same with a lost connection. Check that **Retry last request** stays in view.
13. Select **Report**. Type a description and add a second team. Close the sheet with a swipe down or a tap on the dimmed page. Select **Report** again. Check that the description, the category and the teams are still there. Send the report. Check that the next report form is empty.

### Organizer desktop console (1280 × 800)

Sign in as the same accounts.

1. Check the sidebar pages. Volunteers and specialists get **Queue**, **Assigned to me** and **Handoffs**. Jury members get **Award review**. Every person gets **Teams & tables**. Admins also get **Overview**, **Accounts** and **Session settings**.
2. Collapse the sidebar. Reload the page. Check that it stays collapsed.
3. On the queue, press J and K. Check that focus moves between rows. Press Enter on an issue number. Check that the side sheet opens.
4. Check that J and K do nothing while a field or a dialog has focus.
5. Press ⌘K or Ctrl+K. Search for `31`, `#31` and `ISS-31`, three letters of report text, a team name and a table number. Check that each result opens the correct issue, team filter or page.
6. Claim an issue in a row. Check that the page stays. Claim another issue in the side sheet. Check that the sheet stays open.
7. Open resolve, escalate and reopen from the sheet. Check that each opens a dialog and that **Cancel** closes it without an action.
8. Check that the sheet shows one filled primary action. **Decide award** and **Confirm applied** open the **Outcome & award** tab and move focus to the heading of the award or application section. With a screen reader, check that it reads the heading.
9. On a resolved issue without an award, open **Outcome & award** and choose **Other amount**. Type an amount and an explanation. Open **Activity**, then open **Outcome & award** again. Check that the amount and the explanation are still there.
10. Sign in as an admin without a support role. Open an open issue. Check that the sheet shows **Resolve** and no **Claim**, and that one muted line under the buttons says that claiming needs the Volunteer or Specialist role.
11. In a long queue, scroll to a row far down. Make its claim fail, for example when another volunteer claims the issue first. Check that the error stays pinned to the top of the page. Do the same with a lost connection. Check that **Retry last request** stays in view.
12. Select **Report for a team**. Type a description and add a second team. Press Escape. Open the dialog again. Check that the description, the category and the teams are still there. Send the report. Check that the next report form is empty.

### Contestant desktop app (1280 × 800)

Sign in as a contestant.

1. Check the top bar: event, session, **Live** or **Reconnecting**, the theme menu and the account menu with **My account**, **Change password** and **Sign out**.
2. Open a report. Check the headline, the live unresolved timer, the four-step tracker, the resolution cards, the award card and the messages.
3. Select **Report an issue**. Check the category tiles, the description limit of 2,000 characters and the team location.
4. Send a reply with Enter. Add a line with Shift+Enter.
5. Close contestant intake as admin. Check that **Report an issue** is disabled with a reason.

### Account page (1280 × 800 and 1024 × 768)

Do these checks as a staff account with several roles, as a session admin, and as a contestant.
The desktop console and the contestant app show the page. The phone app keeps its **Me** tab.

1. In the console, select the person card at the bottom of the sidebar. Check that the address is `/account`, that focus is on **My account** and that the card shows the open page. Collapse the sidebar. Check that the card shows only the avatar and that a tooltip shows its name.
2. In the contestant app, open the account menu and select **My account**. Check the same address and focus. Check that the page has no **Skip to report details** link. Select **Minsky** in the top bar. Check that the reports page opens.
3. Select each link in the section nav. Check that the page scrolls to the section and that the nav stays in view on a wide window. Check that the layout has one column below 768 px of page width and no horizontal overflow.
4. **Profile**: check the picture, the name, the username and the account ID. Select **Copy**. Check the message and paste the ID somewhere. A team account shows its team and location. Do the checks in [Profile pictures](#profile-pictures) for the picture.
5. **Access in this session**: check that each role has a badge and a description. Only a session admin sees **Manage session accounts**. A team account shows no role and no admin link. In an archived event, check the archived notice.
6. **Sessions**: with two sessions, select **Switch** on the other one. Check that its data loads and that the open issue or report is cleared.
7. **Security**: enter a wrong current password. Check the error. Enter two different new passwords. Check the message. Enter a valid change. Check the success message and the empty fields. Reload. Check that you are still signed in on `/account`. Sign out and sign in with the new password.
8. **Appearance**: choose **Light** and **Dark**. Check that the theme changes at once and stays after a reload. Move between the options with the arrow keys.
9. **Activity**: check the three counts against the issues of this account. Check that the recent list shows the five newest replies, internal notes and resolutions of this account only. A contestant sees no internal note.
10. **Help**: check that **Documentation** opens the guides in a new tab and that the build ID shows.
11. In the console, press ⌘K or Ctrl+K and run **Change password**. In the contestant app, run **Change password** in the account menu. Check that the address is `/account#security`, that **Current password** has focus and that the section is in view. Repeat while you are on `/account`.
12. Select **Sign out** in the page header. Check that the sign-in page shows. Sign in again and select **Sign out of this device** in **Security**.
13. Press Tab from the person card or the top bar through the page. Check that every control gets focus in reading order and that every focus ring is visible. Check the light and the dark theme.

### Profile pictures

Use a real phone photo and a real phone for these checks. A generated test image does not carry the camera data or the orientation flag of a phone photo.
Do them as a staff account on the console, as a staff account on a phone, and as a contestant. The contestant app has the controls on its account page only.

1. Turn on location for the phone camera. Take a photo in portrait and one in landscape. Copy them to the computer, or choose them from the phone gallery in the phone app. An iPhone saves HEIC by default, and Minsky accepts only JPEG, PNG and WebP. Export the photo as a JPEG before you copy it.
2. Open **My account** in the console. Select **Change picture** in the **Profile** section and choose the portrait photo. Check that the preview is upright, that it shows the middle square of the photo, and that the circle shows the same part.
3. Select **Save picture**. Check the message "Profile picture updated." Check that the new picture shows in the page header, the **Profile** section and the sidebar card at once, without a reload.
4. Open the network panel and reload the page. Save the response of the request to `/api/avatar/` (Cloudflare). Run `exiftool` on the file. Check that it has no GPS tags or camera model, that it is a JPEG of at most 512 × 512 pixels, and that it is under 256 KB.
5. Choose the landscape photo and select **Cancel**. Check that the picture does not change and that focus returns to **Change picture**.
6. Choose a file larger than 2 MB. Check the alert "Choose an image of up to 2 MB." and that no preview opens. Choose a text file with the name `notes.jpg`. Check the alert "Choose a JPEG, PNG, or WebP image."
7. Choose a very detailed photo of 1 to 2 MB, such as a close photo of gravel. Check that it saves and that the stored file is under 256 KB.
8. Choose a PNG with a transparent background. Check that the saved picture has a white background.
9. With a second browser, sign in as another staff member of the same session. Check that the picture shows on an issue that the first account owns within one minute. If that account is an admin, also check the administration account list. Sign in as a contestant. Check that no staff picture shows in any contestant screen.
10. Select **Remove picture**. Select **Cancel** in the question. Check that the picture stays. Select **Remove picture** again and confirm. Check the message "Profile picture removed.", the initials in every place, and that focus is on **Change picture**. Check in the second browser that the initials return within one minute.
11. Turn the network off. Select **Save picture**. Check the error in the dialog and that the button reads **Try again**. Turn the network on and select **Try again**. Check that the account has one picture.
12. In the phone app, open **Me**. Check that **Change picture** and **Remove picture** work with the phone camera and gallery, and that the page has no horizontal scroll at 390 × 844.
13. Use only the keyboard on the console. Press Tab to **Change picture** and Enter. Choose the file. Check that **Save picture** has focus in the dialog. Press Escape and check that focus returns to **Change picture**. Repeat and press Enter to save. Press Tab to **Remove picture** and Enter, then Escape. Check that focus returns to **Remove picture**.
14. Check the light and the dark theme, and an archived event. The controls must work in an archived event, because the picture belongs to the account.

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
22. Check that its password and account ID remain unchanged.

## 9. Concurrent actions and isolation

1. Compare two simultaneous claims.
2. Compare two simultaneous awards.
3. Check state after refresh and reconnect.
4. Attempt unauthorized queries across teams and sessions.

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
37. After an upload succeeds, check that the file control shows no chosen file. Check that the visibility choice is the same as before.
38. Select **Add image** again without a new file. Check that the app asks for an image and that no second image appears.
39. Choose another file. Check that the "Image added." message goes away.

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

`tests/image-upload.spec.ts` automates steps 15, 27, and 37 to 39 on a phone with local storage.
It also checks that a failed upload keeps its file for **Try the upload again**.
It also checks that **Cancel upload** makes the visibility choice available again. It does not check that the unfinished files are deleted or that contestants cannot see the new image. Check those two results by hand (steps 28 and 29).
It also checks that a lost completion response does not attach the image twice.

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

## 14. Browser routes and workflow retry recovery

Use isolated fictional accounts for these checks. These steps do not authorize hosted fixture creation.
The [frontend architecture](frontend-architecture.md#browser-routes) lists paths and required roles.

1. Open `/jury` while signed out. Sign in as a jury member. Check that the award screen opens.
2. Refresh the page. Check that the address remains `/jury` and current session data loads.
3. Open the queue, award screen, and account screen. Use browser Back and Forward. Check each address and screen.
4. In the phone app, open **Change password** from **Me**. Check cancellation and completion. Both must retain `/account`. In the console and the contestant app, change the password in the **Security** section. Check that the address stays `/account`.
5. As support staff, open `/administration`. Check that the app returns to `/issues` without administration data.
6. Remove a jury or administrator role in another isolated client. Refresh access. Check that the restricted section closes.
7. Repeat navigation in the organizer phone layout. Check keyboard focus after a tab change and after a return from an issue.
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
10. Use only the keyboard to select **Remove** on an announcement with an image. Check that the prompt says that the announcement leaves the strip for everyone and that Minsky keeps the record.
    Check that focus is on **Keep announcement**. Select it and check that focus returns to **Remove**.
    Select **Remove**, then **Remove announcement**. Check that every member, managers included, loses the announcement, and that focus moves to **New announcement**.
11. Reload each window. Check that the state is unchanged and the reporting form never waited for announcements.
12. At 320 px and 390 px wide, check that the announcement strip wraps, scrolls inside its area, and causes no horizontal page scroll.
    In a window about 1280 by 720 px, open **New announcement** and **Edit**. Check that every field and the **Publish** or **Save changes** button shows without scrolling inside the strip.
13. Publish at least three announcements. Check that every member sees the two newest, and that **Show 1 more** and **Show fewer** work with the keyboard.
    As a reader, select **Hide**. Check that focus stays on the button, which now reads **Show**, and that the bar shows the count.
    Reload and check that the strip stays hidden. Publish another announcement and check that the strip shows again.
    As a manager, hide the strip with the new announcement form open. Select **Show** and check that the draft is still there.
14. Archive the event. Check that announcements stay readable and every management control disappears.

## 16. Motion and reduced motion

Run these checks in a window of 1280 by 800 px, in the light and dark themes.
Run the phone checks at 390 by 844 px.
Use a development or test session with staff and contestant accounts.

1. Open the issue queue in the desktop console. Select each status tab with the mouse.
   Check that the white pill slides and resizes to the selected tab, with no jump.
2. Reload the page. Check that the pill is already under **Active** and does not slide in from a corner.
3. Press Tab until a status tab has focus. Press Space.
   Check that the pill follows, the tab keeps `aria-pressed` and the focus ring is visible.
4. Select a team in **Find a team**, then select **Resolved**. Check that the empty state offers **Show active issues**.
   Select it. Check that the team filter clears, **Active** is selected and focus is on the **Active** tab.
5. Open an issue. Press the right and left arrow keys on the sheet tabs.
   Check that the selection moves, the underline slides with it and the panel fades in.
   Select **Internal note** and **Public reply** in the composer. Check that the pill slides and is amber for the internal note.
   As a jury member, open **Award review** and select each list. Check that the pill slides.
6. Check that the side sheet opens in about a quarter of a second and closes faster.
7. With a second account, report or claim an issue. Check that the row fades from a blue tint on the first screen.
   Change the status tab and check that no row fades because of that.
8. As a contestant, keep a report open. Claim it as staff. Check that the progress tracker changes color over a moment.
9. In the phone app, select each bottom tab. Check that the bar along the top edge slides to the tab.
   Press and hold a queue card and a button. Check that the card tints and the button shrinks a little.
10. Turn on **Reduce motion** in the operating system, or set `prefers-reduced-motion: reduce` in the browser developer tools.
    Repeat steps 1, 5, 7 and 9. Check that every change is instant and the **Live** dot does not pulse.
