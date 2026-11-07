import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { seatThreeContests } from "./support/contests";
import { type LocalWorker, expect, test } from "./support/localWorker";

// The picker has three shapes: a menu (contestant top bar and console
// sidebar), radio rows (phone Me tab), and a select (no-access screen). Each
// must fit a 320 px phone with a long contest name and a long event name.
// Set PICKER_SHOTS to a folder to save screenshots of every case.

test.use({ seedIssues: false });

const eventName =
  "The Annual Southeast Asia Regional Programming Contest Finals Weekend Event Name That Is Far Too Long";
const longName =
  "Internationalcollegiateprogrammingcontestregionalqualifierroundone with words that wrap";

/** Two contests share a long name, so each label also names the long event. A third is short. */
async function longContests(local: LocalWorker) {
  await local.run("UPDATE events SET name = ? WHERE id = ?", eventName, local.event);
  await seatThreeContests(local, { next: longName, ended: longName, running: "Short" });
}

async function signIn(page: Page, username: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
}

interface Overflow {
  /** Elements whose content is wider than their box, as `tag.class: scrollWidth > clientWidth`. */
  wide: string[];
  /** Elements of the root outside the viewport. */
  outside: string[];
  /** The widths of the document and the root, as `scrollWidth/clientWidth`. */
  measured: string;
}

/**
 * Finds the root, its ancestors and its descendants that clip or overflow
 * horizontally. A document-level check is not enough: a menu hides its own
 * overflow, so only its inner widths show that text is cut off.
 */
async function overflow(root: Locator): Promise<Overflow> {
  return root.evaluate((element) => {
    const describe = (node: Element) => {
      const text = node.textContent?.trim().slice(0, 24) ?? "";
      return `${node.tagName.toLowerCase()}[${node.getAttribute("role") ?? node.getAttribute("data-slot") ?? ""}] "${text}"`;
    };
    const wide: string[] = [];
    const outside: string[] = [];
    const check = (node: Element) => {
      // Text for screen readers is one pixel wide on purpose.
      if (node.closest(".sr-only")) return;
      if (node.scrollWidth > node.clientWidth) {
        wide.push(`${describe(node)}: ${node.scrollWidth} > ${node.clientWidth}`);
      }
    };
    check(document.documentElement);
    for (let node: Element | null = element; node && node !== document.body; node = node.parentElement) check(node);
    for (const node of element.querySelectorAll("*")) {
      check(node);
      const box = node.getBoundingClientRect();
      if (!node.closest(".sr-only") && box.width > 0 && (box.left < -0.5 || box.right > window.innerWidth + 0.5)) {
        outside.push(`${describe(node)}: ${Math.round(box.left)}..${Math.round(box.right)} of ${window.innerWidth}`);
      }
    }
    const box = element.getBoundingClientRect();
    if (box.left < -0.5 || box.right > window.innerWidth + 0.5) {
      outside.push(`root: ${Math.round(box.left)}..${Math.round(box.right)} of ${window.innerWidth}`);
    }
    const html = document.documentElement;
    const measured = `document ${html.scrollWidth}/${html.clientWidth}, picker ${element.scrollWidth}/${element.clientWidth}`;
    return { wide, outside, measured };
  });
}

/** Fails when the picker clips or overflows, and records the widths in the report. */
async function expectFits(root: Locator) {
  const { measured, ...found } = await overflow(root);
  test.info().annotations.push({ type: "measured", description: measured });
  expect(found).toEqual({ wide: [], outside: [] });
}

async function shot(page: Page, name: string) {
  const dir = process.env.PICKER_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  // A menu fades in. Wait for the end, so the picture shows the final colors.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
      new Promise((done) => setTimeout(done, 1000)),
    ]),
  );
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

const widths = [320, 390];
const schemes = ["light", "dark"] as const;

for (const width of widths) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const scheme of schemes) {
      test(`the contestant menu fits, in ${scheme} mode`, async ({ page, local }) => {
        await longContests(local);
        await page.emulateMedia({ colorScheme: scheme });
        await signIn(page, "contestant");
        await page.getByRole("button", { name: /^Contest session: .* Change session$/ }).click();
        const menu = page.getByRole("menu");
        await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
        await shot(page, `menu-${width}-${scheme}`);
        await expectFits(menu);
      });

      test(`the phone radio rows fit, in ${scheme} mode`, async ({ page, local }) => {
        await longContests(local);
        await page.emulateMedia({ colorScheme: scheme });
        await signIn(page, "jury");
        await page.getByRole("navigation", { name: "Organizer sections" }).getByRole("button", { name: "Me", exact: true }).click();
        const rows = page.getByRole("group", { name: "Choose a contest session" });
        await expect(rows.getByRole("radio")).toHaveCount(3);
        await rows.scrollIntoViewIfNeeded();
        await shot(page, `radios-${width}-${scheme}`);
        await expectFits(rows);
      });

      test(`the select on the no-access screen fits, in ${scheme} mode`, async ({ page, local }) => {
        await longContests(local);
        await page.emulateMedia({ colorScheme: scheme });
        await signIn(page, "contestant");
        await page.route("**/api/snapshot*", (route) => route.fulfill({ status: 500, json: { error: "Unavailable." } }));
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        const select = page.getByLabel("Contest session", { exact: true });
        await expect(select).toBeVisible();
        await shot(page, `select-${width}-${scheme}`);
        await expectFits(select.locator("xpath=.."));
      });
    }
  });
}

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const scheme of schemes) {
    test(`the console session menu fits its sidebar, in ${scheme} mode`, async ({ page, local }) => {
      await longContests(local);
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, "jury");
      await page.getByRole("button", { name: /^Contest session: .* Change session$/ }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
      await shot(page, `console-menu-1280-${scheme}`);
      await expectFits(menu);
    });

    test(`the contestant menu fits, in ${scheme} mode`, async ({ page, local }) => {
      await longContests(local);
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, "contestant");
      await page.getByRole("button", { name: /^Contest session: .* Change session$/ }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
      await shot(page, `menu-1280-${scheme}`);
      await expectFits(menu);
    });
  }
});
