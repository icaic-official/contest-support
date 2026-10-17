import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  deploymentPlan, deployWorkers, isCurrentRevision, previewAddress,
  validateBuildSettings, verifyRevision, wranglerArguments,
} from "./deploy-workers.mjs";

const sha = "a".repeat(40);
const env = {
  GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "GiftedNovaHD/minsky",
  GITHUB_REF: "refs/heads/feature/docs", GITHUB_SHA: sha, GITHUB_ACTOR: "maintainer",
  CLOUDFLARE_ACCOUNT_ID: "458ad6a930b0fb717796dfa19ca6a2b1",
  VITE_SUPABASE_URL: "https://ovymmobupzowotvrywek.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", VITE_ENVIRONMENT: "development",
  CLOUDFLARE_API_TOKEN: "fixture-token", GH_TOKEN: "fixture-github-token",
};

describe("deployment selection", () => {
  it.each([
    { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" }, { GITHUB_EVENT_NAME: "schedule" },
    { GITHUB_REPOSITORY: "contributor/minsky" }, { GITHUB_ACTOR: "dependabot[bot]" },
    { GITHUB_REF: "refs/tags/main" }, { GITHUB_REF: "refs/heads/" },
    { GITHUB_SHA: "0".repeat(40) }, { GITHUB_SHA: "" },
  ])("rejects unsupported events and revisions: %j", (change) => {
    expect(() => deploymentPlan({ ...env, ...change })).toThrow();
  });

  it("publishes main to the stable Worker and all other branches to previews", () => {
    const worker = { config: "wrangler.docs.jsonc" };
    const main = deploymentPlan({ ...env, GITHUB_REF: "refs/heads/main" });
    expect(wranglerArguments(worker, main)).toEqual(["deploy", "--config", worker.config]);
    for (const branch of ["Main", "main-fix", "feature/docs", "release/1.0"]) {
      const plan = deploymentPlan({ ...env, GITHUB_REF: `refs/heads/${branch}` });
      expect(plan.preview).toBe(true);
      expect(wranglerArguments(worker, plan)).toContain("preview");
      expect(wranglerArguments(worker, plan)).not.toContain("deploy");
    }
  });

  it("keeps preview names stable, short, and distinct after normalization", () => {
    const names = ["feature/docs", "feature-docs", "Feature/docs", "文档", "a".repeat(200),
      "feature/$(touch${IFS}/tmp/never);echo", "a`id`"].map((branch) => {
      const plan = deploymentPlan({ ...env, GITHUB_REF: `refs/heads/${branch}` });
      expect(plan.name).toMatch(/^[a-z0-9-]{1,63}$/);
      expect(deploymentPlan({ ...env, GITHUB_REF: `refs/heads/${branch}` }).name).toBe(plan.name);
      return plan.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("frontend settings", () => {
  function jwt(payload) {
    return `fixture.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture`;
  }
  it("accepts public keys and rejects privileged or wrong-project configuration", () => {
    expect(() => validateBuildSettings(env)).not.toThrow();
    expect(() => validateBuildSettings({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY:
      jwt({ role: "anon", ref: "ovymmobupzowotvrywek" }) })).not.toThrow();
    for (const key of ["", "sb_secret_fixture", "malformed", jwt({ role: "service_role",
      ref: "ovymmobupzowotvrywek" }), jwt({ role: "anon", ref: "another-project" })]) {
      expect(() => validateBuildSettings({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow(/key/);
    }
    for (const change of [{ CLOUDFLARE_ACCOUNT_ID: "another-account" },
      { VITE_SUPABASE_URL: "https://ghtztmovdkhuketcbjmq.supabase.co" }, { VITE_ENVIRONMENT: "production" }]) {
      expect(() => validateBuildSettings({ ...env, ...change })).toThrow(/development/);
    }
  });
});

it("skips stale and deleted branches, and stops on GitHub errors", async () => {
  const plan = deploymentPlan(env);
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ object: { sha } }) });
  expect(await isCurrentRevision(plan, env, request)).toBe(true);
  expect(request.mock.calls[0][0]).toContain("heads/feature%2Fdocs");
  request.mockResolvedValue({ ok: true, json: async () => ({ object: { sha: "b".repeat(40) } }) });
  expect(await isCurrentRevision(plan, env, request)).toBe(false);
  request.mockResolvedValue({ status: 404 });
  expect(await isCurrentRevision(plan, env, request)).toBe(false);
  request.mockResolvedValue({ status: 403 });
  await expect(isCurrentRevision(plan, env, request)).rejects.toThrow("HTTP 403");
});

it("uses Cloudflare's preview URL and rejects missing or unrelated URLs", () => {
  const url = "https://branch-minsky-docs.icaic-minsky.workers.dev";
  expect(previewAddress(JSON.stringify({ preview: { urls: [url] } }))).toBe(url);
  for (const value of ["https://evil.example", "https://icaic-minsky.workers.dev.evil.example",
    "https://user:pass@branch-minsky-docs.icaic-minsky.workers.dev", "http://branch-minsky-docs.icaic-minsky.workers.dev"]) {
    expect(() => previewAddress(JSON.stringify({ preview: { urls: [value] } }))).toThrow();
  }
  expect(() => previewAddress("{}")).toThrow();
});

it("verifies the deployed revision and fails when propagation never completes", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("DNS pending"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: "older" }) })
    .mockResolvedValue({ ok: true, json: async () => ({ sha }) });
  const pause = vi.fn();
  await verifyRevision("https://example.test", sha, request, pause);
  expect(request).toHaveBeenCalledTimes(3);
  request.mockReset().mockResolvedValue({ ok: false });
  await expect(verifyRevision("https://example.test", sha, request, pause)).rejects.toThrow(/could not be verified/);
  expect(request).toHaveBeenCalledTimes(12);
});

function deploymentMocks() {
  return {
    current: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockReturnValue(JSON.stringify({ preview: {
      urls: ["https://branch-minsky-dev.icaic-minsky.workers.dev"],
    } })),
    verify: vi.fn(), write: vi.fn(), report: vi.fn(),
  };
}

it("publishes both exact build directories without passing GitHub credentials to Wrangler", async () => {
  const mocks = deploymentMocks();
  await deployWorkers(env, mocks);
  expect(mocks.write.mock.calls.map(([file]) => file)).toEqual([
    "dist/minsky-revision.json", "site/dist/minsky-revision.json",
  ]);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  expect(mocks.execute.mock.calls[0][2].env.GH_TOKEN).toBeUndefined();
  expect(mocks.verify).toHaveBeenCalledTimes(2);
});

it("does not publish a stale revision or continue after a failed upload", async () => {
  const stale = deploymentMocks();
  stale.current.mockResolvedValue(false);
  await deployWorkers(env, stale);
  expect(stale.execute).not.toHaveBeenCalled();
  const failed = deploymentMocks();
  failed.execute.mockImplementation(() => { throw new Error("Cloudflare rejected upload"); });
  await expect(deployWorkers(env, failed)).rejects.toThrow("Cloudflare rejected upload");
  expect(failed.execute).toHaveBeenCalledTimes(1);
  expect(failed.verify).not.toHaveBeenCalled();
});

it("checks the branch again between Workers and rejects changed targets before any upload", async () => {
  const moved = deploymentMocks();
  moved.current.mockResolvedValueOnce(true).mockResolvedValue(false);
  await deployWorkers(env, moved);
  expect(moved.execute).toHaveBeenCalledTimes(1);
  const wrong = { ...deploymentMocks(), read: vi.fn().mockReturnValue('{"name":"other"}') };
  await expect(deployWorkers(env, wrong)).rejects.toThrow(/Unexpected deployment target/);
  expect(wrong.execute).not.toHaveBeenCalled();
});
