import legacyFixture from "./fixtures/v1.json" with { type: "json" };
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
      JSON.parse(localStorage.getItem("minsky.demo.v2")!).issues[0].createdAt,
  );
  await page.reload();
  await selectIssue(page);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("minsky.demo.v2")!).issues[0].createdAt,
    ),
  ).toBe(submitted);
  await persona(page, "sam");
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
  await persona(page, "aurora");
  await expect(
    page.getByText("Internal diagnostic:", { exact: false }),
  ).toHaveCount(0);
  await expect(details(page)).toContainText(
    "We are investigating your connection.",
  );
  await persona(page, "maya");
  await page.getByRole("button", { name: "Accept handoff" }).click();
  await expect(details(page).locator("dd").first()).toHaveText("Dr. Maya Rao");
  await page
    .getByRole("combobox", {
      name: "Resolution summary · visible to the team",
      exact: true,
    })
    .selectOption("custom");
  await page
    .getByLabel("Custom resolution summary", { exact: false })
    .fill("Restored the network connection and verified access.");
  await page
    .getByRole("button", { name: "Resolve issue", exact: true })
    .click();
  const stopped = await details(page).locator("dd").nth(1).textContent();
  await persona(page, "alex");
  await page
    .getByRole("combobox", { name: "Award minutes", exact: true })
    .selectOption("custom");
  await page.getByLabel("Custom award minutes").fill("7");
  await page
    .getByLabel("Public award explanation")
    .fill("Seven minutes lost to the connection interruption.");
  await page.getByRole("button", { name: "Record award" }).click();
  await expect(page.getByRole("button", { name: "Record award" })).toHaveCount(
    0,
  );
  await expect(details(page)).toContainText("Pending external application");
  await persona(page, "aurora");
  await expect(details(page)).toContainText("7 minutes awarded");
  await expect(details(page)).toContainText("Pending external application");
  await expect(
    page.getByRole("button", { name: "Confirm applied externally" }),
  ).toHaveCount(0);
  await persona(page, "sam");
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
      () => JSON.parse(localStorage.getItem("minsky.demo.v2")!).awards.length,
    ),
  ).toBe(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: /ISS-004/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ISS-001/ })).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("minsky.demo.v2")!).issues.length,
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
  await persona(page, "sam");
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
    localStorage.setItem("minsky.demo.v2", '{"version":99}'),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("incompatible");
  await expect(
    page.getByRole("button", { name: "Submit issue" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("minsky.demo.v2")),
  ).toBe('{"version":99}');
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(
    page.getByRole("button", { name: "Submit issue" }),
  ).toBeEnabled();
});

for (const actor of ["maya", "robin"]) {
  test(`${actor} can claim and resolve directly`, async ({ page }) => {
    await page.goto("/");
    await persona(page, actor);
    await page
      .getByRole("button", { name: "Claim issue", exact: true })
      .click();
    await page
      .getByRole("combobox", {
        name: "Resolution summary · visible to the team",
        exact: true,
      })
      .selectOption("custom");
    await page
      .getByLabel("Custom resolution summary", { exact: false })
      .fill("Fixed during direct triage.");
    await page
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(details(page)).toContainText("Unresolved time · stopped");
    await expect(details(page)).toContainText("Fixed during direct triage.");
    await page.reload();
    await expect(details(page).locator("dd").first()).toHaveText(
      actor === "maya" ? "Dr. Maya Rao" : "Robin Ellis",
    );
  });
}

for (const width of [390, 320]) {
  test(`combined-role handoffs and keyboard controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    await page.goto("/");
    await persona(page, "robin");
    await expect(
      page.getByLabel("Demo persona").locator("option:checked"),
    ).toHaveText("Volunteer + Technical specialist · Robin Ellis");
    const claim = page.getByRole("button", {
      name: "Claim issue",
      exact: true,
    });
    await claim.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Escalate to specialist" }).click();
    await expect(
      page.getByRole("button", { name: "Accept handoff" }),
    ).toHaveCount(0);
    await expect(details(page).locator("dd").first()).toHaveText("Robin Ellis");
    await persona(page, "maya");
    await page.getByRole("button", { name: "Accept handoff" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Escalate to specialist" }).click();
    await persona(page, "robin");
    await page.getByRole("button", { name: "Accept handoff" }).focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("combobox", {
        name: "Resolution summary · visible to the team",
        exact: true,
      })
      .selectOption("custom");
    await page
      .getByLabel("Custom resolution summary", { exact: false })
      .fill("Connection restored.");
    await page
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await page.getByLabel("Status filter").selectOption("resolved");
    await page
      .getByLabel("Public reopening reason")
      .fill("Helper found another failure.");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Reopen issue", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Status filter")).toHaveValue("claimed");
    await expect(details(page)).toContainText("ISS-001");
    await expect(details(page).locator("dd").first()).toHaveText("Robin Ellis");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("contestant and helper reopening preserves cycles, privacy and an existing award across refresh", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-02T10:00:00Z") });
  await page.goto("/");
  await page.getByLabel("What’s happening?").fill("Repeated interruption");
  await page.getByRole("button", { name: "Submit issue" }).click();
  await persona(page, "sam");
  await page.getByRole("button", { name: "Claim issue", exact: true }).click();
  await page.getByLabel("Message visibility").selectOption("internal");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Private cable diagnostic");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.clock.fastForward(5 * 60000);
  await page
    .getByRole("combobox", {
      name: "Resolution summary · visible to the team",
      exact: true,
    })
    .selectOption("custom");
  await page
    .getByLabel("Custom resolution summary", { exact: false })
    .fill("First fix");
  await page
    .getByRole("button", { name: "Resolve issue", exact: true })
    .click();
  await persona(page, "alex");
  await page
    .getByRole("combobox", { name: "Award minutes", exact: true })
    .selectOption("5");
  await page
    .getByLabel("Public award explanation")
    .fill("Initial interruption");
  await page.getByRole("button", { name: "Record award" }).click();
  await expect(page.getByRole("button", { name: "Reopen issue" })).toHaveCount(
    0,
  );
  await persona(page, "aurora");
  await page.getByLabel("Status filter").selectOption("resolved");
  const stopped = await details(page).locator("dd").nth(1).textContent();
  await page.clock.fastForward(3 * 60000);
  await expect(details(page).locator("dd").nth(1)).toHaveText(stopped!);
  await page.getByLabel("Public reopening reason").fill("Still broken");
  await page.getByRole("button", { name: "Reopen issue", exact: true }).click();
  await expect(page.getByLabel("Status filter")).toHaveValue("claimed");
  await expect(details(page)).toContainText("ISS-004");
  await expect(details(page)).toContainText("earlier resolution");
  await expect(details(page)).not.toContainText("Private cable diagnostic");
  await expect(details(page).locator("dd").first()).toHaveText("Sam Chen");
  await page.getByLabel("Reply to staff").fill("Please try again.");
  await page.getByRole("button", { name: "Send message" }).click();
  await persona(page, "alex");
  await expect(page.getByRole("button", { name: /ISS-004/ })).toHaveCount(0);
  await persona(page, "sam");
  await selectIssue(page);
  await page.getByLabel("I confirm external application").check();
  await page
    .getByRole("button", { name: "Confirm applied externally" })
    .click();
  await page.clock.fastForward(2 * 60000);
  await page
    .getByRole("combobox", {
      name: "Resolution summary · visible to the team",
      exact: true,
    })
    .selectOption("custom");
  await page
    .getByLabel("Custom resolution summary", { exact: false })
    .fill("Second fix");
  await page
    .getByRole("button", { name: "Resolve issue", exact: true })
    .click();
  await expect(details(page).locator("dd").nth(1)).toContainText("7m");
  await persona(page, "maya");
  await page
    .getByLabel("Public reopening reason")
    .fill("Helper confirmed recurrence");
  await page.getByRole("button", { name: "Reopen issue", exact: true }).click();
  await expect(page.getByLabel("Resolution summary")).toHaveCount(0);
  await page.reload();
  await selectIssue(page);
  await expect(details(page)).toContainText("First fix");
  await expect(details(page)).toContainText("Second fix");
  await expect(details(page)).toContainText("Helper confirmed recurrence");
  await expect(details(page)).not.toContainText("Private cable diagnostic");
  await persona(page, "sam");
  await page
    .getByRole("combobox", {
      name: "Resolution summary · visible to the team",
      exact: true,
    })
    .selectOption("custom");
  await page
    .getByLabel("Custom resolution summary", { exact: false })
    .fill("Third fix");
  await page
    .getByRole("button", { name: "Resolve issue", exact: true })
    .click();
  await persona(page, "alex");
  await expect(details(page)).toContainText(
    "Applied externally · simulated confirmation",
  );
  await expect(page.getByRole("button", { name: "Record award" })).toHaveCount(
    0,
  );
});

test("support plus jury fixture keeps the active queue and award controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    // Vite serves the same module used by App; this fixture adds no role editor.
    const modulePath = "/src/domain.ts";
    const { personas } = await import(modulePath);
    personas.alex.roles = ["jury", "volunteer"];
  });
  await persona(page, "alex");
  await expect(
    page.getByRole("heading", { name: "Support queue" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Claim issue", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "Resolution summary · visible to the team",
      exact: true,
    })
    .selectOption("custom");
  await page
    .getByLabel("Custom resolution summary", { exact: false })
    .fill("Support and jury fix");
  await page
    .getByRole("button", { name: "Resolve issue", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Award minutes", exact: true })
    .selectOption("custom");
  await page.getByLabel("Custom award minutes").fill("2");
  await page.getByLabel("Public award explanation").fill("Lost time");
  await page.getByRole("button", { name: "Record award" }).click();
  await expect(details(page)).toContainText("Recorded by Alex Morgan");
});

test("v1 migration persists v2, preserves source and reset overrides legacy progress", async ({
  page,
}) => {
  await page.addInitScript((legacy) => {
    if (!localStorage.getItem("minsky.demo.v1"))
      localStorage.setItem("minsky.demo.v1", JSON.stringify(legacy));
  }, legacyFixture);
  await page.goto("/");
  await persona(page, "robin");
  await page.getByRole("button", { name: /ISS-002/ }).click();
  await expect(details(page)).toContainText("Private diagnostic");
  await page.getByRole("button", { name: "Accept handoff" }).click();
  await page.getByRole("button", { name: /ISS-003/ }).click();
  await page
    .getByLabel("Public reopening reason")
    .fill("Revisit migrated resolution");
  await page.getByRole("button", { name: "Reopen issue", exact: true }).click();
  await page.reload();
  await persona(page, "robin");
  await page.getByRole("button", { name: /ISS-003/ }).click();
  await expect(details(page)).toContainText(
    "Applied externally · simulated confirmation",
  );
  await expect(details(page)).toContainText("Revisit migrated resolution");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("minsky.demo.v1")!),
    ),
  ).toEqual(legacyFixture);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.reload();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("minsky.demo.v2")!).awards,
    ),
  ).toEqual([]);
});

for (const choice of ["0", "5", "10", "15", "30", "60", "custom"]) {
  test(`award choice ${choice} records a decision that survives refresh`, async ({
    page,
  }) => {
    await page.goto("/");
    await persona(page, "maya");
    await page
      .getByRole("button", { name: "Claim issue", exact: true })
      .click();
    await page
      .getByRole("combobox", {
        name: "Resolution summary · visible to the team",
        exact: true,
      })
      .selectOption("custom");
    await page
      .getByLabel("Custom resolution summary", { exact: false })
      .fill("Fixed");
    await page
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await persona(page, "alex");
    const choices = page.getByRole("combobox", {
      name: "Award minutes",
      exact: true,
    });
    await expect(choices).toHaveValue("");
    await choices.selectOption("custom");
    await page.getByLabel("Custom award minutes").fill("99");
    await choices.selectOption(choice);
    if (choice === "custom") {
      const custom = page.getByLabel("Custom award minutes");
      await page
        .getByLabel("Public award explanation")
        .fill("No extra time needed");
      for (const invalid of ["", "-1", "1.5"]) {
        await custom.fill(invalid);
        await page.getByRole("button", { name: "Record award" }).click();
        expect(
          await custom.evaluate((input: HTMLInputElement) =>
            input.checkValidity(),
          ),
        ).toBe(false);
        await expect(
          page.getByRole("heading", { name: /minutes awarded/ }),
        ).toHaveCount(0);
      }
      await custom.fill("99");
      // A preset must replace a previously typed custom value.
      await choices.selectOption("15");
      await expect(custom).toHaveCount(0);
      await choices.selectOption("custom");
      await custom.fill("0");
    } else {
      await expect(page.getByLabel("Custom award minutes")).toHaveCount(0);
      await page.getByLabel("Public award explanation").fill("Jury decision");
    }
    const minutes = choice === "custom" ? "0" : choice;
    await page.getByRole("button", { name: "Record award" }).click();
    await expect(details(page)).toContainText(`${minutes} minutes awarded`);
    await expect(
      page.getByRole("button", { name: "Record award" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(details(page)).toContainText(`${minutes} minutes awarded`);
    await expect(details(page)).toContainText("Pending external application");
    await expect(details(page)).not.toContainText("No award recorded");
  });
}

for (const summary of [
  "Resolved without comment",
  "Service restored",
  "Device issue resolved",
  "Problem statement clarified",
]) {
  test(`common resolution: ${summary}`, async ({ page }) => {
    await page.goto("/");
    await persona(page, "maya");
    await page
      .getByRole("button", { name: "Claim issue", exact: true })
      .click();
    const choices = page.getByRole("combobox", {
      name: "Resolution summary · visible to the team",
      exact: true,
    });
    await expect(choices).toHaveValue("");
    await page
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(choices).toBeVisible();
    await choices.selectOption("custom");
    await page
      .getByLabel("Custom resolution summary")
      .fill("Discarded custom draft");
    await choices.selectOption(summary);
    await expect(page.getByLabel("Custom resolution summary")).toHaveCount(0);
    await choices.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(details(page)).toContainText(summary);
    await expect(details(page)).not.toContainText("Discarded custom draft");
    await page.getByLabel("Public reopening reason").fill("Another check");
    await page
      .getByRole("button", { name: "Reopen issue", exact: true })
      .click();
    await expect(choices).toHaveValue("");
    await choices.selectOption("custom");
    await page.getByLabel("Custom resolution summary").fill("  ");
    await page
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Enter between 1 and 2,000",
    );
    await page
      .getByLabel("Custom resolution summary")
      .fill("Fresh custom resolution");
    await page
      .getByRole("button", { name: "Resolve issue", exact: true })
      .click();
    await page.reload();
    await expect(details(page)).toContainText(summary);
    await expect(details(page)).toContainText("Fresh custom resolution");
  });
}
