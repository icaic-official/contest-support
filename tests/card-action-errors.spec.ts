import type { Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

test.use({ seedIssues: false });

const viewports = [
  { name: "phone", size: { width: 390, height: 844 } },
  { name: "desktop", size: { width: 1280, height: 600 } },
] as const;

/** Sixteen open issues, so that the last card is far below the first screen. */
async function openIssues(local: LocalWorker): Promise<void> {
  for (let n = 1; n <= 16; n++) {
    await local.act(local.users.specialist, {
      type: "submit",
      category: "Backend",
      description: `Queue item ${n}`,
      team_id: local.teams[n % 2],
    });
  }
}

async function signInAsVolunteer(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill("volunteer");
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

for (const viewport of viewports) {
  test.describe(`on the ${viewport.name}`, () => {
    test.beforeEach(async ({ page, local }) => {
      await openIssues(local);
      await page.setViewportSize(viewport.size);
      await signInAsVolunteer(page);
    });

    test("a claim that lost the race shows its error in view", async ({
      page,
      local,
    }) => {
      const claim = page.getByRole("button", { name: /^Claim ISS-/ }).last();
      await expect(claim).toBeVisible();
      const number = (await claim.getAttribute("aria-label"))!.match(/\d+/)![0];
      // A direct write reaches no live client, so the page keeps the old revision.
      await local.run(
        `UPDATE issues SET write_version = write_version + 1, public_revision = public_revision + 1
         WHERE session_id = ? AND number = ?`,
        local.sessions[0],
        Number(number),
      );
      await claim.click();

      const error = page.locator("p[role=alert]");
      await expect(error).toBeVisible();
      await expect(error).toBeInViewport({ ratio: 1 });
    });

    test("the retry button of a lost claim stays in view", async ({
      page,
      local,
    }) => {
      const claim = page.getByRole("button", { name: /^Claim ISS-/ }).last();
      await expect(claim).toBeVisible();
      local.loseNext("/api/workflow", "request");
      await claim.click();

      const retry = page.getByRole("button", { name: "Retry last request" });
      await expect(retry).toBeVisible();
      await expect(retry).toBeInViewport({ ratio: 1 });
    });
  });
}
