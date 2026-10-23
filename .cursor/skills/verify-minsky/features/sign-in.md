# Sign in

Sign in opens the contest workspace for an organizer-created username. The account and the window width choose the contestant desktop, the organiser phone layout, or the organiser desktop console. Sign out returns to the sign-in form and clears the contest data from the page.

## Sub-features

- `sign-in-submit` accepts the username and password and leaves the form.
- `sign-in-workspace` shows the contestant workspace for `contestant`, including **Live**.
- `sign-out` returns to the **Sign in** heading.
- `reject-wrong-password` keeps the person on **Sign in** and shows an alert.

## How to get to it (user POV)

- Open the app origin. The first screen is the sign-in form.
- After sign-in, open **Account menu for Aurora** and choose **Sign out**.
- Staff use **Account menu for Test volunteer**, **Account menu for Test specialist**, **Account menu for Test jury**, **Account menu for Test admin**, or **Account menu for Test combined**, then **Sign out**.

## Driving it with minsky-verify

Preconditions:

- `serve --seed empty` is ready and `doctor` reports `"ok": true`.
- The viewport is `1280x800`.
- The **Sign in** heading is visible.
- The evidence directory exists: `mkdir -p .verify-minsky/evidence/sign-in`.

- **Enter the username.** Use the contestant account. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Username --value contestant --exact`. The command prints `{"ok":true}`.
- **Enter the password.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Password --value verification-only --exact`. The command prints `{"ok":true}`.
- **Submit.** Choose **Sign in**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Sign in" --exact`. The command prints `{"ok":true}`.
- **Reach the workspace.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role complementary --name "Your reports" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text Live --exact`. Both commands print `{"ok":true}`. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/sign-in/workspace.png` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out .verify-minsky/evidence/sign-in/workspace.aria.txt`. The contestant workspace shows Aurora and **Live**.
- **Sign out.** Open the account menu and choose **Sign out**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Account menu for Aurora" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role menuitem --name "Sign out" --exact`. Then run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role heading --name "Sign in" --exact`. The heading **Sign in** is visible.
- **Proof.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/sign-in/signed-out.png`. The new screenshot shows **Sign in**. `workspace.png` and `workspace.aria.txt` from the earlier bullet show Aurora, **Live**, and `Your reports`. Append every JSON line to `.verify-minsky/evidence/sign-in/transcript.jsonl`.

## Gotchas

- `reject-wrong-password` is a separate attempt after sign-out. Enter `contestant` and `wrong-password`, choose **Sign in**, and expect an alert with the **Sign in** heading still visible. This local session accepts any password, so the workspace opens instead. Report that sub-feature as unverified. Do not treat the opened workspace as a passed password check.
- The password `verification-only` is the recipe value. It is not an organizer password.
- The **Live** badge has role `status` and no accessible name. Wait for the visible text with `wait-text --text Live --exact`.
- A contestant window narrower than 1024 px is not a supported contestant layout. Keep `1280x800` for this journey.
- Staff sign-in uses the same form and a different account menu name. Do not look for **Account menu for Aurora** after signing in as `volunteer`.
- Capture the workspace proof before **Sign out**. After sign-out the contest data is off the page.
