# Connected manual verification (T0003/T0004)

Use the linked development project and organizer-provided username and password accounts.
Create the first admin through the explicit bootstrap process.
Docker and persona switching are not required.
Use a separate browser or profile for each account: contestant, volunteer, specialist, jury, and admin.
Work only in a clearly identified development or test session.
See [onboarding](cloud-onboarding.md).

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
2. Select **Administration** in the sidebar.
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

## 3. Contestant intake

1. Close contestant intake as admin.
2. Attempt a new contestant submission.
3. Check that the submission fails.
4. Submit an issue as staff on behalf of a roster team.
5. Reopen an existing resolved issue.
6. Check that staff submission and reopening still work.
7. Open contestant intake again.

## 4. Submission, replies, and handoff

1. Select **Report an issue** as a contestant, or **Report for team** as support.
2. Complete the form.
3. Submit the report.

Expected result: successful submission closes the form and selects the new report.

1. Open the report form again.
2. Select **Cancel report**.
3. Check that focus returns to the report button.
4. Claim the issue as a volunteer in another signed-in browser.
5. Use **Audience** to add a public reply.
6. Use **Audience** to add an internal note.
7. Request a specialist handoff.
8. Check that the volunteer remains the owner.
9. Accept the handoff as another specialist in the amber panel.
10. Check that the contestant cannot see the internal note.
11. Repeat the privacy check through direct API and history queries.
12. Leave the reply input blank.
13. Check that **Send reply** remains disabled.

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

## 7. Interface and accessibility

Compare the dark green interface with the T0004 references at 1505×1045 and 1280×900.
Check these elements:

- The compact sidebar.
- The four queue columns.
- The selected green row.
- The issue details.
- The owner and timing facts.
- The amber handoff panel.
- The chronological activity.
- The lock marker and separate panel for staff notes.

Reference labels and example values must come from actual session data.

Repeat support actions at 390×844 and 320×740.
Check these results:

- The page has no horizontal overflow.
- Owner names and timers remain readable.
- The keyboard skip link works.
- Focus remains visible.
- Native select and checkbox controls work.
- Valid forms submit.
- Queue rows become cards.
- Issue details stack below the queue.

1. Select a queue row on a narrow screen.
2. Check that focus moves to the detail heading.
3. Select **Back to queue**.
4. Check that focus returns to the queue heading.
5. Open **Menu** with the keyboard.
6. Switch between issues and **My account**.
7. Check that the menu closes and focus moves to the new page heading.
8. Check that **Sign out** appears inside the expanded phone menu.
9. Check that admins can see **Administration**.
10. Check that other accounts cannot see that section.
11. Change a password from **My account**.
12. Sign out.
13. Check that the sidebar disappears.
14. Reload the authenticated workspace after signing in again.
15. Check that the workspace returns to issues.

Review the centered sign-in page at desktop, 800px, 390px, and 320px widths.

1. Toggle **Show password** and **Hide password** with the keyboard.
2. Check that organizer access and recovery guidance remain visible.
3. Review contestant, jury, and admin views at desktop widths and 200% zoom.
4. Use a real phone and screen reader when available.
5. Check that the development label remains visible.

**Live** indicates a subscribed Realtime connection.
**Connecting** indicates a pending connection.

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
5. Run `npm run test:cloud` for repeatable checks with real accounts.

The suite creates isolated test fixtures and deletes only those fixtures.
It does not reset the shared project.

Record observed results in [current-state.md](current-state.md).
Suggested manual checks are not completed checks.
Browser automation does not establish results for real devices, assistive technology, or capacity.
