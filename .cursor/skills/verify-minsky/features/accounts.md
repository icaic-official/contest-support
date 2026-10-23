# Accounts

An administrator creates a team account and receives a temporary password once. The password is for the organizer to share with the team. After the administrator leaves that screen, the password is not shown again. The new person must change it before using the contest.

## Sub-features

- `accounts-open` opens the account list for the session.
- `accounts-create-team` submits a new team username for Aurora.
- `accounts-reveal` shows the username and the temporary password once.

## How to get to it (user POV)

- Sign in as `admin` on a window at least 1024 px wide. Choose **Accounts** in **Console pages**, then **Create account**.
- On a window narrower than 1024 px, open the **Session** tab in **Organiser sections** and choose **New account**.

## Driving it with minsky-verify

Preconditions:

- `serve --seed empty` is ready and `doctor` reports `"ok": true`.
- The viewport is `1280x800`.
- The **Sign in** heading is visible.
- The evidence directory exists: `mkdir -p .verify-minsky/evidence/accounts`.

- **Sign in as the administrator.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Username --value admin --exact`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Password --value verification-only --exact`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Sign in" --exact`. Then run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role navigation --name "Console pages" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text Live --exact`. The desktop console is visible.
- **Open accounts.** Choose **Accounts**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name Accounts --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role heading --name Accounts --exact`. The heading **Accounts** is visible.
- **Start a new account.** Choose **Create account**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Create account" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role dialog --name "Create account" --exact`. The dialog **Create account** is visible.
- **Choose the team account.** Choose **Team**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click-text --text Team --exact --within-role dialog --within-name "Create account" --within-exact`. The command prints `{"ok":true}`.
- **Choose Aurora.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts select --label "Contestant team" --option "Aurora · A12" --exact --within-role dialog --within-name "Create account" --within-exact`. The command prints `{"ok":true}`.
- **Name the account.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label "Display name" --value "River Team" --exact --within-role dialog --within-name "Create account" --within-exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Username --value river --exact --within-role dialog --within-name "Create account" --within-exact`. Both commands print `{"ok":true}`.
- **Create the account.** Choose **Create account** inside the dialog. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Create account" --exact --within-role dialog --within-name "Create account" --within-exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role region --name "Temporary account credentials" --exact`. The region shows the username `river` and a temporary password.
- **Proof.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/accounts/credentials.png` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out .verify-minsky/evidence/accounts/credentials.aria.txt` while that region is visible. Both files show username `river` and a password value. Append every JSON line to `.verify-minsky/evidence/accounts/transcript.jsonl`. Do not copy the password into a second document.

## Gotchas

- Account creation runs through the local account API. The password hash can take several seconds. Wait for **Temporary account credentials**. Do not insert the account by hand.
- The phone entry is **New account** on the **Session** tab. The desktop recipe does not verify it.
- The page and the dialog both have a **Create account** button. The submit click must use `--within-role dialog`. Without that scope the click is ambiguous and fails.
- The team option text is `Aurora · A12`, including the middle dot. A hyphen or a different team fails the select.
- The credential screen is shown once. A later open of the account must not be used as proof that the password is still visible.
