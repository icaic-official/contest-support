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

## 10. Team search

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
12. Open **Report for team**.
13. Check that the same team is already selected.
14. Edit the team text.
15. Check that **Submit issue** stays unavailable until you choose a suggestion.
16. Submit the issue.
17. Check that the new issue belongs to that team.
18. Type a table number, a reordered name, and a small spelling mistake.
19. Check that the intended team appears before weaker matches.
20. Type a query that matches nothing.
21. Check that the message says no team matches and that no team is selected for you.
22. Repeat the queue search at 390px and 320px widths.
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

## 11. Workspace refresh and cloud fixture recovery

Use isolated test accounts for these checks.

1. Open the issue queue as support staff without selecting a row.
2. Enter a reply on the displayed issue.
3. Submit another issue from a second client.
4. Check that the first client still shows the original issue and reply text.
5. Send the reply. Check that it belongs to the original issue.
6. Open a membership form as an administrator.
7. Change that member's roles or team from a second administrator account.
8. Return focus to the first client so it receives the current membership.
9. Check that both the summary and form show the current roles or team.
10. Save the form. Check that it preserves the second administrator's change.

The credential-free tests in `tests/workspace-refresh.spec.ts` cover these UI effects and exact write requests.
The cleanup tests in `scripts/cloud-test.test.mjs` check a failed deletion, a successful retry, and the retained recovery file.
They use mocked cloud responses and a local child process. They do not access hosted data.
See [fixture recovery](cloud-onboarding.md#fixture-recovery) for failed cloud cleanup.

Record observed results in [current-state.md](current-state.md).
Suggested manual checks are not completed checks.
Browser automation does not establish results for real devices, assistive technology, or capacity.
