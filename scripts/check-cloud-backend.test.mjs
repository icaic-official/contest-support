import { expect, it, vi } from "vitest";
import { checkCloudBackend } from "./check-cloud-backend.mjs";

const env = { MINSKY_TEST_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ACCESS_TOKEN: "fixture-token" };
const migrations = ["202610110001", "202610140001"];
const active = ["admin", "attachments", "announcement-images"].map(slug => ({ slug, status: "ACTIVE" }));
function responses(rows, functions = active) {
  return vi.fn().mockResolvedValueOnce({ ok: true, json: async () => rows })
    .mockResolvedValueOnce({ ok: true, json: async () => functions });
}

it.each(["", "invalid", "ovymmobupzowotvrywek"])("rejects an unsafe target before network access: %s", async project => {
  const request = vi.fn();
  await expect(checkCloudBackend({ env: { ...env, MINSKY_TEST_PROJECT_REF: project }, request, migrations })).rejects.toThrow("isolated");
  expect(request).not.toHaveBeenCalled();
});

it("rejects missing credentials before network access", async () => {
  const request = vi.fn();
  await expect(checkCloudBackend({ env: { ...env, SUPABASE_ACCESS_TOKEN: "" }, request, migrations })).rejects.toThrow("SUPABASE_ACCESS_TOKEN");
  expect(request).not.toHaveBeenCalled();
});

it("rejects missing image migrations even when an unrelated migration is present", async () => {
  const request = responses([{ version: "202610110002" }]);
  await expect(checkCloudBackend({ env, request, migrations })).rejects.toThrow("202610110001, 202610140001");
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["attachments", "announcement-images"])("rejects an absent or inactive %s function", async slug => {
  const others = active.filter(fn => fn.slug !== slug);
  for (const functions of [others, [...others, { slug, status: "FAILED" }]]) {
    const request = responses(migrations.map(version => ({ version })), functions);
    await expect(checkCloudBackend({ env, request, migrations })).rejects.toThrow(`active functions: ${slug}.`);
  }
});

it("checks the selected project with a read-only query and reports additional migrations", async () => {
  const request = responses([...migrations, "202610110002"].map(version => ({ version })));
  const report = vi.fn();
  await checkCloudBackend({ env, request, migrations, report });
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query",
    "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/functions",
  ]);
  expect(JSON.parse(request.mock.calls[0][1].body).read_only).toBe(true);
  expect(report).toHaveBeenCalledWith("Additional remote migration versions: 202610110002.");
  expect(JSON.stringify(report.mock.calls)).not.toContain(env.SUPABASE_ACCESS_TOKEN);
});

it("fails on provider errors without printing the response body", async () => {
  const json = vi.fn().mockResolvedValue({ credential: "private-value" });
  const request = vi.fn().mockResolvedValue({ ok: false, status: 403, json });
  await expect(checkCloudBackend({ env, request, migrations })).rejects.toThrow("HTTP 403");
  expect(json).not.toHaveBeenCalled();
});

it("rejects an invalid metadata response", async () => {
  await expect(checkCloudBackend({ env, request: responses({}), migrations })).rejects.toThrow("Invalid CI backend metadata");
});
