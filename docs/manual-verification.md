# Manual verification guide

Use `npm ci`, `npm run dev`, and the printed local URL in one browser tab. Use fictional data only. Reset first; accept the reset confirmation. Persona changes are simulated, not sign-ins.

## Complete journey

1. Select **Team contestant · Team Aurora**. Confirm the roster location is Hall A · Desk 12 and only Aurora's seeded issue is shown. Submit a Backend issue with “The code environment cannot connect.” Expected: a new issue, `ISS-004`, shows a running timer and no first assignment.
2. Wait a few seconds, refresh, and select `ISS-004` again. Expected: the issue remains, and elapsed time includes time before refresh. View selections reset on reload.
3. Select **Volunteer · Sam Chen**, select `ISS-004`, and claim. Expected: Sam owns it and first-assignment delay is recorded separately.
4. Choose **Internal note · staff only** and send “Check switch port 17.” Then send a public reply, “We are investigating your connection.” Switch to contestant. Expected: the public reply appears, and the private text and its activity entry do not. Cedar and Orbit issues are absent.
5. Return to volunteer and escalate `ISS-004`. Expected: awaiting specialist; Sam still owns the issue. Select **Technical specialist · Dr. Maya Rao**, then accept. Expected: Maya becomes owner; first-assignment delay is unchanged.
6. Resolve with “Restored the network connection and verified access.” Expected: summary retained and elapsed time stops. Refresh, reselect the issue, and check the stopped value remains unchanged.
7. Select **Jury · Alex Morgan**, select `ISS-004`. Enter 7 minutes and “Seven minutes lost to the connection interruption.” Record the award. Expected: one award references `ISS-004`, pending external application. The award button disappears. Contestant sees the same pending decision.
8. Select volunteer (or another staff persona), check the simulation confirmation, and select **Confirm applied externally**. Expected: separate confirmation actor/time and applied status. Contestant sees the applied status after refresh. No actual contest clock changes.
9. Reset and first cancel the dialog. Expected: progress remains. Reset again and accept. Expected: exactly the three seed issues, no awards, and renewed seed timestamps after reload.

## Phone and keyboard

- At 390 × 844 and 320 × 740 CSS pixels, select volunteer. Read queue cards and details; filter statuses; claim, message and escalate. Expected: no horizontal page scrolling, readable owner/location/timer, stacked panels, usable controls.
- Use Tab from a fresh page: activate **Skip to main content**. Tab through persona, reset, forms, filter and issue buttons. Expected: visible focus and associated labels; Enter activates buttons and submits valid forms. Use Space to toggle the application checkbox. Test the native reset dialog with keyboard.
- Try blank/whitespace messages or summaries and fractional/zero award minutes. Expected: browser validation or a visible error, with no completed transition or invalid award.
- Review laptop contestant and desktop jury layouts, plus browser zoom at 200%. Verify public/internal messages are clear in staff views.

## Persistence failures and limits

In developer tools, change the value for `minsky.demo.v1` to `{"version":99}` and refresh. Expected: a warning, disabled workflow controls, preserved stored value, and an enabled reset control. Reset restores operation. If browser storage is denied or full, the UI reports that changes may remain only in memory.

The automated browser suite covers the full journey, refresh, visibility, awards, reset, a 390px volunteer layout, keyboard entry points and incompatible-storage recovery. Automation is not a substitute for real-device, screen-reader or cross-browser review. Record actual observed results in [current-state.md](current-state.md); never mark suggested checks as completed.
