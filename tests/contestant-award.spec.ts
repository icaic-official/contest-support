import type { Page } from "@playwright/test";
import { expect, test } from "./support/localWorker";

// The default fixture gives Aurora, the contestant's team, issue 5 with a
// five-minute award. Each case changes the minutes before the contestant signs in.

async function openReport(page: Page, number: number) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("contestant");
  await page
    .getByLabel("Password", { exact: true })
    .fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator('[data-ui="contestant"]')).toBeVisible({
    timeout: 15_000,
  });
  await page
    .getByRole("navigation", { name: "Reports" })
    .getByRole("button", { name: new RegExp(`ISS-${number}\\s*,`) })
    .click();
}

const cases = [
  { minutes: 0, heading: "No time added", figure: /^0\s*minutes$/, step: "Decided: No time added" },
  { minutes: 1, heading: "1 minute", figure: /^\+1\s*minute$/, step: "Decided: 1 minute" },
  { minutes: 5, heading: "5 minutes", figure: /^\+5\s*minutes$/, step: "Decided: 5 minutes" },
];

for (const { minutes, heading, figure, step } of cases) {
  test(`a ${minutes}-minute award reads correctly to the contestant`, async ({
    page,
    local,
  }) => {
    await local.run(
      "UPDATE awards SET minutes = ? WHERE issue_id = ?",
      minutes,
      local.issues[4]!,
    );
    await openReport(page, 5);
    const card = page.getByRole("region", {
      name: new RegExp(`^Time award\\s*, ${heading}$`),
    });
    await expect(card).toContainText("Decision 5 explanation");
    await expect(card.locator('[aria-hidden="true"]').first()).toHaveText(figure);
    const progress = page.getByRole("list", { name: "Progress" });
    await expect(progress).toContainText(step);
    await expect(progress).not.toContainText("+");
  });
}
