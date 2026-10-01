import { test, expect, type Page } from "@playwright/test";
const persona = (page: Page, value: string) =>
  page.getByLabel("Demo persona").selectOption(value);
const details = (page: Page) =>
  page.getByRole("region", { name: /Issue details/ });
const selectIssue = (page: Page) =>
  page.getByRole("button", { name: /ISS-004/ }).click();

test("complete contestant → volunteer → specialist → jury journey with persistence and reset", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Backend");
  await page
    .getByLabel("What’s happening?")
    .fill("Our code environment cannot connect.");
  await page.getByRole("button", { name: "Submit issue" }).click();
  await expect(details(page)).toContainText("ISS-004");
  const submitted = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("minsky.demo.v1")!).issues[0].createdAt,
  );
  await page.reload();
  await selectIssue(page);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("minsky.demo.v1")!).issues[0].createdAt,
    ),
  ).toBe(submitted);
  await persona(page, "volunteer");
  await page.getByRole("button", { name: "Claim issue", exact: true }).click();
  await page.getByLabel("Message visibility").selectOption("internal");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Internal diagnostic: switch port 17.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("We are investigating your connection.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Escalate to specialist" }).click();
  await expect(
    details(page).getByText("Sam Chen", { exact: true }).first(),
  ).toBeVisible();
  await expect(details(page)).toContainText(
    "remains responsible until acceptance",
  );
  await persona(page, "contestant");
  await expect(
    page.getByText("Internal diagnostic:", { exact: false }),
  ).toHaveCount(0);
  await expect(details(page)).toContainText(
    "We are investigating your connection.",
  );
  await persona(page, "specialist");
  await page.getByRole("button", { name: "Accept handoff" }).click();
  await expect(details(page).locator("dd").first()).toHaveText("Dr. Maya Rao");
  await page
    .getByLabel("Resolution summary")
    .fill("Restored the network connection and verified access.");
  await page
    .getByRole("button", { name: "Resolve issue", exact: true })
    .click();
  const stopped = await details(page).locator("dd").nth(1).textContent();
  await persona(page, "jury");
  await page.getByLabel("Award minutes").fill("7");
  await page
    .getByLabel("Public award explanation")
    .fill("Seven minutes lost to the connection interruption.");
  await page.getByRole("button", { name: "Record award" }).click();
  await expect(page.getByRole("button", { name: "Record award" })).toHaveCount(
    0,
  );
  await expect(details(page)).toContainText("Pending external application");
  await persona(page, "contestant");
  await expect(details(page)).toContainText("7 minutes awarded");
  await expect(details(page)).toContainText("Pending external application");
  await expect(
    page.getByRole("button", { name: "Confirm applied externally" }),
  ).toHaveCount(0);
  await persona(page, "volunteer");
  await page.getByLabel("I confirm external application").check();
  await page
    .getByRole("button", { name: "Confirm applied externally" })
    .click();
  await page.reload();
  await selectIssue(page);
  await expect(details(page)).toContainText(
    "Applied externally · simulated confirmation",
  );
  await expect(details(page).locator("dd").nth(1)).toHaveText(stopped!);
  await expect(
    page.getByText("Internal diagnostic:", { exact: false }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("minsky.demo.v1")!).awards.length,
    ),
  ).toBe(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: /ISS-004/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ISS-001/ })).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("minsky.demo.v1")!).issues.length,
    ),
  ).toBe(3);
});

test("phone volunteer queue and keyboard entry points", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to main content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await persona(page, "volunteer");
  await page.getByLabel("Status filter").selectOption("open");
  await page.getByRole("button", { name: /ISS-001/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Claim issue", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Status filter").selectOption("claimed");
  await expect(details(page)).toContainText("Sam Chen");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("incompatible storage requires explicit reset and remains intact until then", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("minsky.demo.v1", '{"version":99}'),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("incompatible");
  await expect(
    page.getByRole("button", { name: "Submit issue" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("minsky.demo.v1")),
  ).toBe('{"version":99}');
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(
    page.getByRole("button", { name: "Submit issue" }),
  ).toBeEnabled();
});
