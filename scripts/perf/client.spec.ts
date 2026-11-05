// Client weight benchmark. Not part of `npm test` or the default Playwright run.
//   npm run build && PERF_RUNS=5 npx playwright test -c scripts/perf/playwright.config.ts
// "load": production build, Chromium CPU 4x slowdown, slow 4G for static files.
//         API calls and the live socket come from the local fixture, so they are not throttled.
// "soak": heap after many live hints with a 500-issue queue.
// "render": React component renders per live hint (dev server, so names are readable).
import type { CDPSession, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { type LocalWorker, expect, test } from "../../tests/support/localWorker";

const prod = `http://127.0.0.1:${process.env.PERF_PROD_PORT ?? 4180}`;
const dev = `http://127.0.0.1:${process.env.PERF_DEV_PORT ?? 4181}`;
const runs = Number(process.env.PERF_RUNS ?? 5);
const issueCount = Number(process.env.PERF_ISSUES ?? 500);
const hints = Number(process.env.PERF_HINTS ?? 600);
const out = process.env.PERF_OUT;
// A phone on slow 4G waits about this long for each API answer. The fixture answers at once, so add it.
const apiDelayMs = Number(process.env.PERF_API_DELAY_MS ?? 250);
const roles = ["contestant", "volunteer", "admin"] as const;
// PERF_PHONE=1 loads the staff roles at 390 px, so they get the phone app.
const phoneRun = process.env.PERF_PHONE === "1";
const staffUi = phoneRun ? "organiser-phone" : "organiser-desktop";
const surface = { contestant: "contestant", volunteer: staffUi, admin: staffUi } as const;

test.use({ seedIssues: false, viewport: phoneRun ? { width: 390, height: 844 } : { width: 1280, height: 800 } });

const results: Record<string, unknown> = {};
test.afterAll(() => {
  const text = JSON.stringify(results, null, 2);
  console.log(`PERF_RESULT ${text}`);
  if (out) writeFileSync(out, text);
});

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const spread = (values: number[]) => ({ median: Math.round(median(values)), min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) });

async function seedQueue(local: LocalWorker, count: number): Promise<void> {
  const stamp = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  await local.run("INSERT INTO session_issue_sequences (session_id, number) VALUES (?, ?)", local.sessions[0], count);
  for (let n = 1; n <= count; n++) {
    const status = n % 10 === 0 ? "resolved" : n % 3 === 0 ? "claimed" : "open";
    const owned = status !== "open";
    const id = randomUUID();
    await local.run(
      `INSERT INTO issues (id, session_id, team_id, status, number, reporter, reporter_name, category, description,
        created_at, first_assigned_at, owner, owner_name, resolved_at) VALUES (?, ?, ?, ?, ?, ?, 'Test volunteer', 'Backend', ?, ?, ?, ?, ?, ?)`,
      id, local.sessions[0], local.teams[n % 2], status, n, local.users.volunteer,
      `Issue ${n}: the build server rejects pushes with an unexpected error and the team cannot continue until it is fixed.`,
      stamp(600 - n), owned ? stamp(590 - n) : null, owned ? local.users.volunteer : null, owned ? "Test volunteer" : null,
      status === "resolved" ? stamp(300 - n / 2) : null,
    );
    if (status === "resolved") {
      await local.run(
        "INSERT INTO resolutions (id, session_id, issue_id, actor, actor_name, at, summary) VALUES (?, ?, ?, ?, 'Test volunteer', ?, ?)",
        randomUUID(), local.sessions[0], id, local.users.volunteer, stamp(300 - n / 2), `Resolution ${n}: restarted the runner`,
      );
    }
  }
}

/** Waits without Playwright's accessibility queries, which are slow on a 500-row page and distort CPU numbers. */
async function appReady(page: Page, role: (typeof roles)[number]): Promise<void> {
  await page.waitForFunction(
    ({ ui }) => !!document.querySelector(`[data-ui="${ui}"]`) && /\bLive\b/.test(document.body.innerText),
    { ui: surface[role] },
    { timeout: 120_000, polling: 250 },
  );
}

async function signIn(page: Page, role: (typeof roles)[number]): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(role);
  await page.getByLabel("Password", { exact: true }).fill(randomUUID());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(`[data-ui="${surface[role]}"]`)).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = await cdp.send("Runtime.getHeapUsage");
  return Math.round((usage.usedSize / 1024 / 1024) * 100) / 100;
}

/** Counts snapshot reads and waits until none has started for `quiet` ms. */
function snapshotCounter(page: Page) {
  const state = { reads: 0, contests: 0, bytes: 0, gzipBytes: 0, last: Date.now() };
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/snapshot") {
      state.reads++;
      state.last = Date.now();
      const body = await response.body().catch(() => Buffer.alloc(0));
      state.bytes = body.length;
      state.gzipBytes = gzipSync(body).length;
    } else if (url.pathname === "/api/contests") {
      state.contests++;
      state.last = Date.now();
    }
  });
  return {
    state,
    reset: () => { state.reads = 0; state.contests = 0; state.last = Date.now(); },
    async settle(quiet = 800) { while (Date.now() - state.last < quiet) await page.waitForTimeout(100); },
  };
}

test.describe("load", () => {
  test.use({ baseURL: prod });
  for (const role of roles) {
    test(`first load ${role}`, async ({ local, page, context }) => {
      test.setTimeout(600_000);
      await seedQueue(local, issueCount);
      await signIn(page, role);
      // The page measures itself: first paint, long tasks, and when the role's UI first existed.
      await context.addInitScript((ui) => {
        const w = window as unknown as { __perf: { longTasks: number[]; fcp: number; ready: number } };
        w.__perf = { longTasks: [], fcp: 0, ready: 0 };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__perf.longTasks.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (entry.name === "first-contentful-paint") w.__perf.fcp = entry.startTime;
        }).observe({ type: "paint", buffered: true });
        new MutationObserver(() => {
          if (!w.__perf.ready && document.querySelector(`[data-ui="${ui}"]`)) w.__perf.ready = performance.now();
        }).observe(document, { childList: true, subtree: true });
      }, surface[role]);
      await context.route("**/api/**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, apiDelayMs));
        await route.fallback();
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const samples = { ready: [] as number[], fcp: [] as number[], tbt: [] as number[], longTasks: [] as number[], transferKb: [] as number[], scriptKb: [] as number[], requests: [] as number[] };
      const counter = snapshotCounter(page);
      for (let run = 0; run < runs + 1; run++) {
        // Run 0 is a warm-up of the server and the Brotli cache. It is not reported.
        await cdp.send("Network.clearBrowserCache");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
        counter.reset();
        await page.reload();
        await appReady(page, role);
        await counter.settle();
        const perf = await page.evaluate(() => {
          const w = window as unknown as { __perf: { longTasks: number[]; fcp: number; ready: number } };
          const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          const staticFiles = resources.filter((r) => !r.name.includes("/api/"));
          return {
            ...w.__perf,
            transfer: staticFiles.reduce((t, r) => t + r.transferSize, 0),
            scripts: staticFiles.filter((r) => r.name.endsWith(".js")).reduce((t, r) => t + r.transferSize, 0),
            requests: resources.length,
          };
        });
        if (run === 0) continue;
        samples.ready.push(perf.ready);
        samples.fcp.push(perf.fcp);
        samples.longTasks.push(perf.longTasks.length);
        samples.tbt.push(perf.longTasks.reduce((t, d) => t + Math.max(0, d - 50), 0));
        samples.transferKb.push(perf.transfer / 1024);
        samples.scriptKb.push(perf.scripts / 1024);
        samples.requests.push(counter.state.reads);
      }
      results[`load:${role}`] = {
        readyMs: spread(samples.ready), fcpMs: spread(samples.fcp), tbtMs: spread(samples.tbt), longTasks: spread(samples.longTasks),
        staticTransferKb: spread(samples.transferKb), jsTransferKb: spread(samples.scriptKb),
        snapshotReadsPerLoad: counter.state.reads, contestReadsPerLoad: counter.state.contests,
        snapshotKbRaw: Math.round(counter.state.bytes / 1024), snapshotKbGzip: Math.round(counter.state.gzipBytes / 1024),
      };
      // Heap after load, unthrottled GC.
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      results[`heapAfterLoadMb:${role}`] = await heapMb(cdp);
    });
  }

  test("snapshot reads per command", async ({ local, page }) => {
    await seedQueue(local, 50);
    await signIn(page, "volunteer");
    const counter = snapshotCounter(page);
    await counter.settle();
    counter.reset();
    // One workflow command from another account: every client gets one hint.
    await local.act("contestant", { type: "submit", category: "Backend", description: "Reads per command" }).catch(() => undefined);
    local.notify();
    await counter.settle(1500);
    results["readsPerRemoteHint:volunteer"] = { snapshots: counter.state.reads, contests: counter.state.contests };
    counter.reset();
    local.notify();
    local.notify();
    local.notify();
    await counter.settle(1500);
    results["readsPerBurstOf3Hints:volunteer"] = { snapshots: counter.state.reads, contests: counter.state.contests };
  });
});

test.describe("soak", () => {
  test.use({ baseURL: prod });
  test("heap during live updates, volunteer with a large queue", async ({ local, page, context }) => {
    test.setTimeout(900_000);
    await seedQueue(local, issueCount);
    await signIn(page, "volunteer");
    const cdp = await context.newCDPSession(page);
    const counter = snapshotCounter(page);
    const heap = [{ hints: 0, mb: await heapMb(cdp) }];
    const started = Date.now();
    for (let i = 1; i <= hints; i++) {
      local.notify();
      await page.waitForTimeout(100);
      if (i % (hints / 6) === 0) {
        await counter.settle(1500);
        heap.push({ hints: i, mb: await heapMb(cdp) });
      }
    }
    results["soak:volunteer"] = { heap, snapshotReads: counter.state.reads, seconds: Math.round((Date.now() - started) / 1000) };
  });
});

test.describe("profile", () => {
  test.use({ baseURL: prod });
  // Sampling profile of the volunteer load at 4x CPU, and of ten idle seconds after it.
  test("where the CPU goes, volunteer with a large queue", async ({ local, page, context }) => {
    test.setTimeout(300_000);
    await seedQueue(local, issueCount);
    await signIn(page, "volunteer");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    const top = async (label: string) => {
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map<string, number>();
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples?.forEach((id, i) => {
        const node = byId.get(id)!;
        const key = `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber}:${node.callFrame.columnNumber}`;
        self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[i] ?? 0));
      });
      const total = [...self.values()].reduce((a, b) => a + b, 0);
      const idle = (self.get("(idle) :-1:-1") ?? 0) + (self.get("(program) :-1:-1") ?? 0);
      results[`profile:${label}`] = {
        busyMs: Math.round((total - idle) / 1000),
        top: [...self].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, 12)
          .map(([k, v]) => `${Math.round(v / 1000)} ms  ${k}`),
      };
    };
    await cdp.send("Profiler.start");
    await page.reload();
    await appReady(page, "volunteer");
    await page.waitForTimeout(1500);
    await top("load");
    await cdp.send("Profiler.start");
    await page.waitForTimeout(10_000);
    await top("idle10s");
  });
});

test.describe("render", () => {
  test.use({ baseURL: dev });
  test("component renders per live hint, volunteer with a large queue", async ({ local, page, context }) => {
    test.setTimeout(600_000);
    await seedQueue(local, issueCount);
    await context.addInitScript(() => {
      const w = window as unknown as { __renders: Map<string, number>; __commits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
      w.__renders = new Map();
      w.__commits = 0;
      const nameOf = (fiber: { type?: { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } } }) =>
        fiber.type?.displayName ?? fiber.type?.name ?? fiber.type?.render?.name ?? fiber.type?.type?.name ?? "anonymous";
      w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        renderers: new Map(),
        inject() { return 1; },
        onScheduleFiberRoot() {},
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        onCommitFiberRoot(_id: number, root: { current: unknown }) {
          w.__commits++;
          type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null; type?: never };
          const walk = (fiber: Fiber | null) => {
            for (let f = fiber; f; f = f.sibling) {
              // Function, forwardRef, memo and simple memo components that did work in this commit.
              if ([0, 11, 14, 15].includes(f.tag) && f.alternate && (f.flags & 1) === 1) {
                const name = nameOf(f as never);
                w.__renders.set(name, (w.__renders.get(name) ?? 0) + 1);
              }
              walk(f.child);
            }
          };
          walk(root.current as Fiber);
        },
      };
    });
    await signIn(page, "volunteer");
    const counter = snapshotCounter(page);
    await counter.settle(2000);
    const snapshot = async () => page.evaluate(() => {
      const w = window as unknown as { __renders: Map<string, number>; __commits: number };
      const entries = [...w.__renders.entries()].sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((t, [, n]) => t + n, 0);
      w.__renders.clear();
      const commits = w.__commits;
      w.__commits = 0;
      return { total, commits, top: entries.slice(0, 12) };
    });
    await snapshot();
    // A hint that changes nothing, the common case: other people's activity elsewhere.
    local.notify();
    await counter.settle(1500);
    results["render:unchangedHint"] = await snapshot();
    // A change to one issue.
    const row = await local.rows<{ id: string }>("SELECT id FROM issues WHERE session_id = ? AND status = 'open' LIMIT 1", local.sessions[0]);
    await local.run("UPDATE issues SET public_revision = public_revision + 1, write_version = write_version + 1, status = 'claimed', owner = ?, owner_name = 'Test volunteer', first_assigned_at = ? WHERE id = ?",
      local.users.volunteer, new Date().toISOString(), row[0]!.id);
    local.notify();
    await counter.settle(1500);
    results["render:oneIssueChanged"] = await snapshot();
  });
});
