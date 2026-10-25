import type { Page } from "@playwright/test";
import { type LocalWorker, expect, test } from "./support/localWorker";

// The `local` fixture seeds the Worker and routes the page to it. A test that
// reads no data from it still requests it, then marks it with `void local`.
test.use({ seedIssues: false });

/** Holds every workflow request until the returned function runs. */
async function holdWorkflow(page: Page): Promise<() => void> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/workflow", async (route) => {
    await gate;
    await route.fallback();
  });
  return release;
}

async function signIn(page: Page, name: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function reportFor(local: LocalWorker, team: string, text: string) {
  await local.act(local.users.combined, {
    type: "submit",
    category: "Devices",
    description: text,
    team_id: team,
  });
}

test("Send report shows one spinner in place of its icon while the report is sent", async ({
  page,
  local,
}) => {
  void local;
  const release = await holdWorkflow(page);
  try {
    await signIn(page, "contestant");
    await page
      .getByRole("complementary", { name: "Your reports" })
      .getByRole("button", { name: "Report an issue" })
      .click();
    await page
      .getByLabel("What is happening?", { exact: true })
      .fill("The projector shows no signal.");
    const send = page.getByRole("button", { name: "Send report", exact: true });
    await expect(send.locator('[data-slot="spinner"]')).toHaveCount(0);

    await send.click();
    await expect(send).toHaveAttribute("aria-busy", "true");
    await expect(send).toBeDisabled();
    await expect(send.locator('[data-slot="spinner"]')).toBeVisible();
    // The spinner replaces the send icon, so the button does not grow.
    await expect(send.locator("svg:visible")).toHaveCount(1);

    release();
    await expect(
      page.getByRole("region", { name: "Your report" }),
    ).toContainText("The projector shows no signal.");
    await expect(send).toHaveCount(0);
  } finally {
    release();
  }
});

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone", size: { width: 390, height: 844 } },
]) {
  test(`only the Claim button that was pressed spins on the ${viewport.name} queue`, async ({
    page,
    local,
  }) => {
    await reportFor(local, local.teams[0], "First table has no network.");
    await reportFor(local, local.teams[1], "Second table lost power.");
    await page.setViewportSize(viewport.size);
    const release = await holdWorkflow(page);
    try {
      await signIn(page, "volunteer");
      const first = page.getByRole("button", { name: "Claim ISS-1", exact: true });
      const second = page.getByRole("button", { name: "Claim ISS-2", exact: true });
      await expect(first).toBeEnabled();

      await first.click();
      await expect(first.locator('[data-slot="spinner"]')).toBeVisible();
      await expect(first).toHaveAttribute("aria-busy", "true");
      // The other Claim button is locked, but its command is not the one that runs.
      await expect(second).toBeDisabled();
      await expect(second.locator('[data-slot="spinner"]')).toHaveCount(0);
      await expect(second).not.toHaveAttribute("aria-busy");

      release();
      await expect(first).toHaveCount(0);
      await expect(second).toBeEnabled();
      await expect(page.locator('[data-slot="spinner"]')).toHaveCount(0);
    } finally {
      release();
    }
  });
}

test("Sign in shows a spinner while the credentials are checked", async ({ page, local }) => {
  void local;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/sign-in", async (route) => {
    await gate;
    await route.fallback();
  });
  try {
    await page.goto("/sign-in");
    await page.getByLabel("Username", { exact: true }).fill("contestant");
    await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const busy = page.getByRole("button", { name: "Signing in…", exact: true });
    await expect(busy.locator('[data-slot="spinner"]')).toBeVisible();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    release();
    await expect(busy).toHaveCount(0);
  } finally {
    release();
  }
});

test("a manager sees a spinner while announcements load and while one publishes", async ({
  page,
  local,
}) => {
  void local;
  let releaseLoad = () => {};
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let releasePublish = () => {};
  const publishGate = new Promise<void>((resolve) => {
    releasePublish = resolve;
  });
  await page.route(
    (url) => url.pathname === "/api/announcements",
    async (route) => {
      await (route.request().method() === "GET" ? loadGate : publishGate);
      await route.fallback();
    },
  );
  try {
    await signIn(page, "admin");
    const loading = page.getByRole("status").filter({ hasText: "Loading announcements…" });
    await expect(loading.locator('[data-slot="spinner"]')).toBeVisible();
    releaseLoad();
    await expect(loading).toHaveCount(0);

    await page.getByRole("button", { name: "New announcement" }).click();
    const form = page.locator("form").filter({ hasText: "New announcement" });
    await form.getByLabel("Title").fill("Lunch moves");
    await form.getByLabel("Details").fill("Lunch is at noon.");
    const publish = form.getByRole("button", { name: "Publish", exact: true });
    await publish.click();
    await expect(publish.locator('[data-slot="spinner"]')).toBeVisible();
    await expect(publish).toHaveAttribute("aria-busy", "true");
    releasePublish();
    await expect(page.getByRole("button", { name: "Lunch moves" })).toBeVisible();
  } finally {
    releaseLoad();
    releasePublish();
  }
});
