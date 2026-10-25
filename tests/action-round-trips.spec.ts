import type { Browser, Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

// A user action must cost one request. The Worker has no live hints in these
// tests, so the response alone must carry the result onto the screen.

test.use({ seedIssues: false });

async function signIn(
  browser: Browser,
  local: LocalWorker,
  name: string,
  viewport: { width: number; height: number },
): Promise<{ page: Page; requests: string[] }> {
  const context = await browser.newContext({ viewport });
  await local.attach(context);
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/")) {
      requests.push(`${request.method()} ${pathname}`);
    }
  });
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  // Wait until the first reads are done.
  let seen = -1;
  while (seen !== requests.length) {
    seen = requests.length;
    await page.waitForTimeout(700);
  }
  requests.length = 0;
  return { page, requests };
}

test("a report and a claim each send one request and show the result", async ({
  browser,
  local,
}) => {
  local.notify = () => {};
  const contestant = await signIn(browser, local, "contestant", {
    width: 1280,
    height: 800,
  });
  await contestant.page
    .getByRole("complementary", { name: "Your reports" })
    .getByRole("button", { name: "Report an issue" })
    .click();
  await contestant.page.getByText("Devices", { exact: true }).click();
  await contestant.page
    .getByLabel("What is happening?")
    .fill("Keyboard stopped responding after the IDE froze");
  await contestant.page.getByRole("button", { name: "Send report" }).click();
  await expect(
    contestant.page.getByRole("region", { name: "Your report" }),
  ).toContainText("Keyboard stopped responding after the IDE froze");
  expect(contestant.requests).toEqual(["POST /api/workflow"]);

  const volunteer = await signIn(browser, local, "volunteer", {
    width: 390,
    height: 844,
  });
  await volunteer.page.getByRole("button", { name: "Claim ISS-1" }).click();
  await expect(
    volunteer.page.getByRole("button", { name: "Claim ISS-1" }),
  ).toHaveCount(0);
  expect(volunteer.requests).toEqual(["POST /api/workflow"]);
  const { issues } = await local.snapshot(local.users.admin);
  expect(issues[0]).toMatchObject({ status: "claimed", owner: local.users.volunteer });
});

test("a live hint still refreshes another person's screen", async ({
  browser,
  local,
}) => {
  const contestant = await signIn(browser, local, "contestant", {
    width: 1280,
    height: 800,
  });
  await local.act(local.users.contestant, {
    type: "submit",
    category: "Devices",
    description: "Printer jam reported by another tab",
  });
  await expect(
    contestant.page.getByRole("region", { name: "Your report" }),
  ).toContainText("Printer jam reported by another tab");
  expect(contestant.requests).toContain("GET /api/snapshot");
});
