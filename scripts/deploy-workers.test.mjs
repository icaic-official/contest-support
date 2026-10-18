import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { currentMigrationNames } from "../src/server/adapters/cloudflare/tooling/migrations.mjs";
import { describe, expect, it, vi } from "vitest";
import {
  applicationBackend, assertStaticApplication, buildWorkers, confirmApplication,
  deploymentPlan, deploymentTargets, deployWorkers, isCurrentRevision, previewAddress,
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
    { GITHUB_REF: "refs/heads/feature/t0021-cloudflare-development-install" },
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
    staticApplication: vi.fn(), application: vi.fn(),
    read: (path, encoding) => path === "dist/minsky-build.json"
      ? JSON.stringify({ sha, backend: "supabase", config: "wrangler.jsonc", databaseId: null })
      : readFileSync(path, encoding),
  };
}

it("publishes both exact build directories without passing GitHub credentials to Wrangler", async () => {
  const mocks = deploymentMocks();
  await deployWorkers({ ...env, GITHUB_REF: "refs/heads/main" }, mocks);
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
  await deployWorkers({ ...env, GITHUB_REF: "refs/heads/main" }, stale);
  expect(stale.execute).not.toHaveBeenCalled();
  const failed = deploymentMocks();
  failed.execute.mockImplementation(() => { throw new Error("Cloudflare rejected upload"); });
  await expect(deployWorkers({ ...env, GITHUB_REF: "refs/heads/main" }, failed)).rejects.toThrow("Provider output was withheld");
  expect(failed.execute).toHaveBeenCalledTimes(1);
  expect(failed.verify).not.toHaveBeenCalled();
});

it("checks the branch again between Workers and rejects changed targets before any upload", async () => {
  const moved = deploymentMocks();
  moved.current.mockResolvedValueOnce(true).mockResolvedValue(false);
  await deployWorkers({ ...env, GITHUB_REF: "refs/heads/main" }, moved);
  expect(moved.execute).toHaveBeenCalledTimes(1);
  const wrong = { ...deploymentMocks(), read: vi.fn().mockReturnValue('{"name":"other"}') };
  await expect(deployWorkers({ ...env, GITHUB_REF: "refs/heads/main" }, wrong)).rejects.toThrow(/Unexpected deployment target/);
  expect(wrong.execute).not.toHaveBeenCalled();
});

const development = { ...env, GITHUB_REF: "refs/heads/main" };
const settings = {
  accountId: env.CLOUDFLARE_ACCOUNT_ID, workerName: "minsky-dev",
  databaseName: "minsky-development", databaseId: "c26de6ab-c28d-4522-9b77-25b6b5034edb",
  bucketName: "minsky-development-images", origin: "https://minsky-dev.icaic-minsky.workers.dev",
};
const cloudflare = {
  ...development, MINSKY_DEV_BACKEND: "cloudflare",
  MINSKY_DEV_CLOUDFLARE_CONFIG: "cloudflare-development.wrangler.jsonc",
  MINSKY_DEV_DATABASE_ID: settings.databaseId, MINSKY_DEV_DATABASE_NAME: settings.databaseName,
  MINSKY_DEV_BUCKET_NAME: settings.bucketName,
};
const installation = vi.fn().mockResolvedValue(settings);

it("preserves Supabase by default and requires an explicit Cloudflare selection", async () => {
  expect(applicationBackend(development)).toBe("supabase");
  expect(() => applicationBackend({ ...development, MINSKY_DEV_BACKEND: "typo" })).toThrow();
  const target = (await deploymentTargets(development, "app"))[0];
  expect(target).toMatchObject({ backend: "supabase", config: "wrangler.jsonc" });
  expect(await deploymentTargets(cloudflare, "app", { installation })).toEqual([
    { name: "minsky-dev", assets: "dist", backend: "cloudflare", settings,
      config: "cloudflare-development.wrangler.jsonc" },
  ]);
  for (const change of [
    { MINSKY_DEV_DATABASE_ID: "other" }, { MINSKY_DEV_BUCKET_NAME: "other" },
    { MINSKY_DEV_DATABASE_NAME: "other" }, { MINSKY_DEV_CLOUDFLARE_CONFIG: "../external.json" },
    { MINSKY_DEV_CLOUDFLARE_CONFIG: "/tmp/external.json" },
  ]) {
    await expect(deploymentTargets({ ...cloudflare, ...change }, "app", { installation })).rejects.toThrow();
  }
  for (const change of [
    { workerName: "minsky-docs" }, { origin: "https://wrong.example" }, { accountId: "other" },
    { databaseName: "minsky-connector-ci" }, { bucketName: "minsky-install-images" },
  ]) {
    await expect(deploymentTargets(cloudflare, "app", {
      installation: async () => ({ ...settings, ...change }),
    })).rejects.toThrow();
  }
});

it("keeps docs deployment independent and omits all app previews", async () => {
  const brokenApplication = { ...env, MINSKY_DEV_BACKEND: "invalid", VITE_SUPABASE_URL: "" };
  expect((await deploymentTargets(brokenApplication, "docs")).map((target) => target.name)).toEqual(["minsky-docs"]);
  for (const backend of ["supabase", "cloudflare"]) {
    expect(await deploymentTargets({ ...env, MINSKY_DEV_BACKEND: backend }, "app")).toEqual([]);
    const mocks = deploymentMocks();
    await deployWorkers({ ...env, MINSKY_DEV_BACKEND: backend }, mocks);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][1]).toContain("wrangler.docs.jsonc");
    expect(mocks.application).not.toHaveBeenCalled();
    expect(mocks.staticApplication).not.toHaveBeenCalled();
  }
});

it("refuses to overwrite an activated Worker or unconfirmed settings with static assets", async () => {
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    success: true, result: { bindings: [] },
  }) });
  await assertStaticApplication(development, request);
  expect(request.mock.calls[0][0]).toBe(`https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/workers/scripts/minsky-dev/settings`);
  for (const type of ["d1", "r2_bucket", "durable_object_namespace"]) {
    request.mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { bindings: [{ type }] } }) });
    await expect(assertStaticApplication(development, request)).rejects.toThrow(/asset upload is forbidden/);
  }
  for (const response of [
    { ok: false, json: async () => ({ errors: ["private provider detail"] }) },
    { ok: true, json: async () => ({ success: true, result: {} }) },
    { ok: true, json: async () => { throw new Error("private provider detail"); } },
  ]) {
    request.mockResolvedValue(response);
    await expect(assertStaticApplication(development, request)).rejects.toThrow(/asset upload is forbidden/);
  }
  request.mockRejectedValue(new Error("private provider detail"));
  await expect(assertStaticApplication(development, request)).rejects.toThrow(/asset upload is forbidden/);
  const mocks = deploymentMocks();
  mocks.staticApplication.mockRejectedValue(new Error("Already activated"));
  await expect(deployWorkers(development, mocks)).rejects.toThrow("Already activated");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("builds the selected backend without private tokens and records the build revision", async () => {
  for (const backend of ["supabase", "cloudflare"]) {
    const target = backend === "cloudflare"
      ? (await deploymentTargets(cloudflare, "app", { installation }))[0]
      : (await deploymentTargets(development, "app"))[0];
    const execute = vi.fn();
    const write = vi.fn();
    await buildWorkers({ ...development, VITE_BACKEND: "wrong", AUTH_SECRET: "private-secret" }, {
      execute, write, targets: async () => [target],
    });
    const buildEnv = execute.mock.calls[0][2].env;
    expect(buildEnv.VITE_BACKEND).toBe(backend);
    for (const key of ["CLOUDFLARE_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "AUTH_SECRET"]) {
      expect(buildEnv[key]).toBeUndefined();
    }
    if (backend === "cloudflare") expect(buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY).toBeUndefined();
    expect(JSON.parse(write.mock.calls[0][1])).toMatchObject({ sha, backend, config: target.config });
  }
});

it("requires an exact build match before either deployment mode can upload", async () => {
  for (const change of [
    { sha: "old" }, { backend: "cloudflare" }, { config: "other.json" }, { databaseId: "other" },
  ]) {
    const mocks = deploymentMocks();
    const read = mocks.read;
    mocks.read = (path, encoding) => path === "dist/minsky-build.json"
      ? JSON.stringify({ sha, backend: "supabase", config: "wrangler.jsonc", databaseId: null, ...change })
      : read(path, encoding);
    await expect(deployWorkers(development, mocks)).rejects.toThrow(/guarded deployment build/);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.staticApplication).not.toHaveBeenCalled();
  }
});

it("uses the complete generated configuration for Cloudflare uploads and confirms its live target first", async () => {
  const worker = (await deploymentTargets(cloudflare, "app", { installation }))[0];
  const mocks = deploymentMocks();
  mocks.targets = async () => [worker];
  mocks.read = () => JSON.stringify({ sha, backend: "cloudflare", config: worker.config, databaseId: settings.databaseId });
  await deployWorkers(cloudflare, mocks);
  expect(mocks.application).toHaveBeenCalledTimes(1);
  expect(mocks.staticApplication).not.toHaveBeenCalled();
  expect(mocks.execute.mock.calls[0][1]).toEqual(["deploy", "--config", worker.config]);
  expect(mocks.execute.mock.calls[0][2].env.WRANGLER_WRITE_LOGS).toBe("false");
  mocks.execute.mockClear();
  mocks.application.mockRejectedValue(new Error("Target mismatch"));
  await expect(deployWorkers(cloudflare, mocks)).rejects.toThrow("Target mismatch");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("confirms live account, D1 identifiers, and authentication secret metadata before deployment", async () => {
  const worker = (await deploymentTargets(cloudflare, "app", { installation }))[0];
  const migrations = JSON.stringify([{ success: true, results: (await currentMigrationNames()).map((name) => ({ name })) }]);
  const request = vi.fn(async (url) => ({ ok: true, json: async () => ({ success: true,
    result: url.endsWith("/managed") ? { enabled: false } : url.endsWith("/custom")
      ? { domains: [] } : { name: settings.bucketName },
  }) }));
  const execute = vi.fn((command, args) => {
    if (args[0] === "d1" && args[1] === "execute") return migrations;
    if (args[0] === "whoami") return settings.accountId;
    if (args[0] === "d1") return JSON.stringify({ uuid: settings.databaseId, name: settings.databaseName });
    if (args[0] === "secret") return JSON.stringify([{ name: "AUTH_SECRET", type: "secret_text" }]);
    throw new Error("Unexpected command");
  });
  await confirmApplication(worker, cloudflare, execute, request);
  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute.mock.calls[0][2].stdio).toEqual(["ignore", "pipe", "pipe"]);
  execute.mockImplementation(() => "private rejected provider detail");
  await expect(confirmApplication(worker, cloudflare, execute, request)).rejects.toThrow(/could not be confirmed/);
  execute.mockImplementation((command, args) => {
    if (args[0] === "d1" && args[1] === "execute") return migrations;
    if (args[0] === "whoami") return settings.accountId;
    if (args[0] === "d1") return JSON.stringify({ uuid: settings.databaseId, name: settings.databaseName });
    return "[]";
  });
  await expect(confirmApplication(worker, cloudflare, execute, request)).rejects.toThrow(/Confirm AUTH_SECRET/);
  for (const rejected of ["bucket", "managed", "custom"]) {
    request.mockImplementation(async (url) => ({ ok: true, json: async () => ({ success: true,
      result: url.endsWith("/managed") ? { enabled: rejected === "managed" }
        : url.endsWith("/custom") ? { domains: rejected === "custom" ? [{ enabled: true }] : [] }
          : { name: rejected === "bucket" ? "different-bucket" : settings.bucketName },
    }) }));
    await expect(confirmApplication(worker, cloudflare, execute, request)).rejects.toThrow(/R2 bucket could not be confirmed/);
  }
  execute.mockImplementation((command, args) => {
    if (args[0] === "whoami") return settings.accountId;
    if (args[0] === "d1" && args[1] === "execute") return JSON.stringify([{ success: true, results: [] }]);
    return JSON.stringify({ uuid: settings.databaseId, name: settings.databaseName });
  });
  request.mockClear();
  await expect(confirmApplication(worker, cloudflare, execute, request)).rejects.toThrow(/hosted migrations differ/);
  expect(request).not.toHaveBeenCalled();
});
