# Report an issue

A contestant describes a problem for their own team. Sending the report closes the form, selects the new report, and starts the unresolved timer. The team and table come from the roster. The contestant cannot file the report for another team.

## Sub-features

- `report-open` opens a blank report from the contestant sidebar.
- `report-category` selects one of the session categories.
- `report-describe` records what is happening.
- `report-send` saves the report and shows it as the current report.
- `report-timer` shows the unresolved timer as running.

## How to get to it (user POV)

- Sign in as `contestant` and choose **Report an issue** in **Your reports**.
- When the team has no report yet, **Report details** also has a **Report an issue** button.
- There is no phone layout for contestants. The window must be at least 1024 px wide.

## Driving it with minsky-verify

Preconditions:

- `serve --seed empty` is ready and `doctor` reports `"ok": true`.
- The viewport is `1280x800`.
- The **Sign in** heading is visible, and this database has no issues.
- The evidence directory exists: `mkdir -p .verify-minsky/evidence/report-an-issue`.

- **Sign in.** Enter the contestant username and password, then choose **Sign in**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Username --value contestant --exact`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label Password --value verification-only --exact`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Sign in" --exact`. Then run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role complementary --name "Your reports" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait-text --text Live --exact`. Both waits print `{"ok":true}`. Aurora and **Live** are visible.
- **Open the form.** Choose **Report an issue** in **Your reports**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Report an issue" --exact --within-role complementary --within-name "Your reports" --within-exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role heading --name "Report an issue" --exact`. The heading **Report an issue** is visible.
- **Choose the category.** Choose **Devices**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click-text --text Devices --exact`. The command prints `{"ok":true}`.
- **Describe the problem.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts fill --label "What is happening?" --value "Keyboard stopped responding after the IDE froze" --exact`. The field shows that sentence, and **Send report** can be used.
- **Capture the form.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/report-an-issue/01-form.png`. The file shows **Devices** and the description before you send.
- **Send the report.** Choose **Send report**. Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts click --role button --name "Send report" --exact` and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts wait --role region --name "Your report" --exact`. The region **Your report** is visible.
- **Read the screen.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts text --role region --name "Your report" --exact`. The printed `text` contains `Keyboard stopped responding after the IDE froze` and `running`.
- **Proof.** Run `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts screenshot --out .verify-minsky/evidence/report-an-issue/02-submitted.png`, `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts aria --out .verify-minsky/evidence/report-an-issue/submitted.aria.txt`, and `node .cursor/skills/verify-minsky/scripts/minsky-verify.ts snapshot --user contestant --out .verify-minsky/evidence/report-an-issue/snapshot.json`. The screenshot and the ARIA file show the description. The snapshot JSON has one issue, status `open`, category `Devices`, that description, `owner` null, and `first_assigned_at` null. Append every JSON line to `.verify-minsky/evidence/report-an-issue/transcript.jsonl`.

## Gotchas

- The empty seed has no issues. A second send in the same database creates ISS-2. Start a new `serve --seed empty` when the recipe requires the first issue.
- **Send report** stays unavailable while the description is empty. Fill the description before you look for an enabled send button.
- Closing intake blocks a new report. This seed leaves intake open. If the form shows a blocker, stop and report it. Do not bypass the form.
- The timer text `running` is part of the report region. A screenshot of the form before **Send report** does not prove the save.
- Two **Report an issue** buttons are visible before the first report. The sidebar click must use `--within-role complementary`. A click without that scope fails. The empty-state button is a separate entry and is not proved by the sidebar click.
- Contestant proof uses the `contestant` snapshot. A snapshot for `admin` is a different view. Do not replace the contestant snapshot with a direct insert.
