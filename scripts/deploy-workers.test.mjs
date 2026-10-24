import { readFileSync } from "node:fs";
import { currentMigrationNames } from "../src/server/adapters/cloudflare/tooling/migrations.mjs";
import { describe, expect, it, vi } from "vitest";
import {
  buildWorkers, prepareApplication,
  deploymentPlan, deploymentTargets, deployWorkers, isCurrentRevision, previewAddress,
  validateBuildSettings, verifyApplicationDeployment, verifyRevision, wranglerArguments,
} from "./deploy-workers.mjs";

const sha = "a".repeat(40);
const env = {
  WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature/docs", WORKERS_CI_COMMIT_SHA: sha,
  CLOUDFLARE_ACCOUNT_ID: "458ad6a930b0fb717796dfa19ca6a2b1",
  VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", VITE_ENVIRONMENT: "development",
  CLOUDFLARE_API_TOKEN: "fixture-token", GH_TOKEN: "fixture-github-token",
};

describe("deployment selection", () => {
  it.each([
    { WORKERS_CI_BRANCH: undefined }, { WORKERS_CI_BRANCH: "" }, { WORKERS_CI_BRANCH: "main\n" },
    { WORKERS_CI_COMMIT_SHA: undefined }, { WORKERS_CI_COMMIT_SHA: "0".repeat(40) },
    { WORKERS_CI_COMMIT_SHA: "" }, { WORKERS_CI_COMMIT_SHA: "A".repeat(40) },
    { WORKERS_CI_COMMIT_SHA: "a".repeat(39) },
  ])("rejects missing or invalid branches and revisions: %j", (change) => {
    expect(() => deploymentPlan({ ...env, ...change })).toThrow();
  });

  it("publishes main to the stable Worker and all other branches to previews", () => {
    const worker = { config: "wrangler.docs.jsonc" };
    const main = deploymentPlan({ ...env, WORKERS_CI_BRANCH: "main" });
    expect(wranglerArguments(worker, main)).toEqual(["deploy", "--config", worker.config]);
    for (const branch of ["Main", "main-fix", "feature/docs", "release/1.0"]) {
      const plan = deploymentPlan({ ...env, WORKERS_CI_BRANCH: branch });
      expect(plan.preview).toBe(true);
      expect(wranglerArguments(worker, plan)).toContain("preview");
      expect(wranglerArguments(worker, plan)).not.toContain("deploy");
    }
  });

  it("keeps preview names stable, short, and distinct after normalization", () => {
    const names = ["feature/docs", "feature-docs", "Feature/docs", "文档", "a".repeat(200),
      "feature/$(touch${IFS}/tmp/never);echo", "a`id`"].map((branch) => {
      const plan = deploymentPlan({ ...env, WORKERS_CI_BRANCH: branch });
      expect(plan.name).toMatch(/^[a-z0-9-]{1,63}$/);
      expect(deploymentPlan({ ...env, WORKERS_CI_BRANCH: branch }).name).toBe(plan.name);
      return plan.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("frontend settings", () => {
  it("accepts only the development account and environment", () => {
    expect(() => validateBuildSettings(env)).not.toThrow();
    for (const change of [{ CLOUDFLARE_ACCOUNT_ID: "another-account" }, { VITE_ENVIRONMENT: "production" }]) {
      expect(() => validateBuildSettings({ ...env, ...change })).toThrow(/development/);
    }
  });
});

it("skips stale and deleted branches, and stops on GitHub errors", () => {
  const plan = deploymentPlan(env);
  const ref = "refs/heads/feature/docs";
  const execute = vi.fn().mockReturnValue(`${sha}\t${ref}\n`);
  expect(isCurrentRevision(plan, execute)).toBe(true);
  expect(execute.mock.calls[0][0]).toBe("git");
  expect(execute.mock.calls[0][1]).toEqual(["ls-remote", "--exit-code", "https://github.com/GiftedNovaHD/minsky.git", ref]);
  expect(execute.mock.calls[0][2].env.GIT_TERMINAL_PROMPT).toBe("0");
  execute.mockReturnValue(`${"b".repeat(40)}\t${ref}\n`);
  expect(isCurrentRevision(plan, execute)).toBe(false);
  // A longer ref that ends with the same path does not count as this branch.
  execute.mockReturnValue(`${sha}\trefs/heads/other/${ref}\n`);
  expect(isCurrentRevision(plan, execute)).toBe(false);
  execute.mockImplementation(() => { throw Object.assign(new Error("no match"), { status: 2 }); });
  expect(isCurrentRevision(plan, execute)).toBe(false);
  execute.mockImplementation(() => { throw Object.assign(new Error("private network detail"), { status: 128 }); });
  expect(() => isCurrentRevision(plan, execute)).toThrow("The GitHub branch lookup failed.");
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

it("reads preview JSON after asset progress and rejects malformed responses", async () => {
  const url = "https://branch-minsky-docs.icaic-minsky.workers.dev";
  const payload = JSON.stringify({ preview: { urls: [url] } }, null, 2);
  const output = `🌀 Building list of assets...\n🌀 Starting asset upload...\n${payload}\n`;
  expect(previewAddress(output)).toBe(url);
  for (const invalid of [
    `Progress without JSON: ${url}`, `Progress\n{broken JSON`, `${output}trailing output`,
    JSON.stringify({ preview: { urls: url } }),
    JSON.stringify({ preview: { urls: ["https://evil.example"] } }),
  ]) {
    expect(() => previewAddress(invalid)).toThrow(/Cloudflare did not return/);
  }
  const mocks = deploymentMocks();
  mocks.execute.mockReturnValue(output);
  await deployWorkers(env, { ...mocks, site: "docs" });
  expect(mocks.verify).toHaveBeenCalledWith(url, { sha });
  mocks.verify.mockClear();
  mocks.execute.mockReturnValue(`Progress\n{broken JSON`);
  await expect(deployWorkers(env, { ...mocks, site: "docs" })).rejects.toThrow("valid preview JSON");
  expect(mocks.verify).not.toHaveBeenCalled();
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

const development = { ...env, WORKERS_CI_BRANCH: "main" };
const settings = {
  accountId: env.CLOUDFLARE_ACCOUNT_ID, workerName: "minsky-dev",
  databaseName: "minsky-development", databaseId: "c26de6ab-c28d-4522-9b77-25b6b5034edb",
  bucketName: "minsky-development-images", origin: "https://minsky-dev.icaic-minsky.workers.dev",
};
const cloudflare = {
  ...development,
  MINSKY_DEV_CLOUDFLARE_CONFIG: "cloudflare-development.wrangler.jsonc",
  MINSKY_DEV_DATABASE_ID: settings.databaseId, MINSKY_DEV_DATABASE_NAME: settings.databaseName,
  MINSKY_DEV_BUCKET_NAME: settings.bucketName,
};
const installation = vi.fn().mockResolvedValue(settings);
const build = { sha, backend: "cloudflare", config: cloudflare.MINSKY_DEV_CLOUDFLARE_CONFIG,
  databaseId: settings.databaseId, bucketName: settings.bucketName, origin: settings.origin };

function deploymentMocks() {
  return {
    current: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockReturnValue(JSON.stringify({ preview: {
      urls: ["https://branch-minsky-dev.icaic-minsky.workers.dev"],
    } })),
    verify: vi.fn(), write: vi.fn(), report: vi.fn(),
    application: vi.fn(), deployedApplication: vi.fn(),
    targets: (target, site, options) => deploymentTargets(target, site, { ...options, installation }),
    read: (path, encoding) => path === "dist/minsky-build.json"
      ? JSON.stringify(build)
      : readFileSync(path, encoding),
  };
}

it("publishes both exact build directories without passing GitHub credentials to Wrangler", async () => {
  const mocks = deploymentMocks();
  await deployWorkers(cloudflare, mocks);
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
  await deployWorkers(cloudflare, stale);
  expect(stale.execute).not.toHaveBeenCalled();
  const failed = deploymentMocks();
  failed.execute.mockImplementation(() => { throw new Error("Cloudflare rejected upload"); });
  await expect(deployWorkers(cloudflare, failed)).rejects.toThrow("Provider output was withheld");
  expect(failed.execute).toHaveBeenCalledTimes(1);
  expect(failed.verify).not.toHaveBeenCalled();
});

it("checks the branch again between Workers and rejects changed targets before any upload", async () => {
  const moved = deploymentMocks();
  moved.current.mockResolvedValueOnce(true).mockResolvedValue(false);
  await deployWorkers(cloudflare, moved);
  expect(moved.execute).toHaveBeenCalledTimes(1);
  const wrong = { ...deploymentMocks(), read: vi.fn().mockReturnValue('{"name":"other"}') };
  await expect(deployWorkers(cloudflare, wrong)).rejects.toThrow(/Unexpected deployment target/);
  expect(wrong.execute).not.toHaveBeenCalled();
});


it("requires the complete Cloudflare target for the stable application", async () => {
  await expect(deploymentTargets(development, "app")).rejects.toThrow(/provider-generated configuration/);
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
  const brokenApplication = { ...development, VITE_ENVIRONMENT: "", MINSKY_DEV_CLOUDFLARE_CONFIG: "" };
  expect((await deploymentTargets(brokenApplication, "docs")).map((target) => target.name)).toEqual(["minsky-docs"]);
  expect(await deploymentTargets(env, "app")).toEqual([]);
  const mocks = deploymentMocks();
  await deployWorkers(env, mocks);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0][1]).toContain("wrangler.docs.jsonc");
  expect(mocks.application).not.toHaveBeenCalled();
});

it("builds the Cloudflare backend without private tokens or Supabase settings and records the build revision", async () => {
  const target = (await deploymentTargets(cloudflare, "app", { installation }))[0];
  const execute = vi.fn();
  const write = vi.fn();
  await buildWorkers({ ...development, VITE_BACKEND: "supabase", AUTH_SECRET: "private-secret" }, {
    execute, write, targets: async () => [target],
  });
  const buildEnv = execute.mock.calls[0][2].env;
  expect(buildEnv.VITE_BACKEND).toBe("cloudflare");
  for (const key of ["CLOUDFLARE_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "AUTH_SECRET",
    "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
    expect(buildEnv[key]).toBeUndefined();
  }
  expect(JSON.parse(write.mock.calls[0][1])).toEqual(build);
});

it("requires an exact build match before upload", async () => {
  for (const change of [
    { sha: "old" }, { backend: "supabase" }, { config: "other.json" }, { databaseId: "other" }, { bucketName: "other" }, { origin: "https://wrong.example" },
  ]) {
    const mocks = deploymentMocks();
    const read = mocks.read;
    mocks.read = (path, encoding) => path === "dist/minsky-build.json"
      ? JSON.stringify({ ...build, ...change })
      : read(path, encoding);
    await expect(deployWorkers(cloudflare, mocks)).rejects.toThrow(/guarded deployment build/);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.application).not.toHaveBeenCalled();
  }
});

it("uses the complete generated configuration for Cloudflare uploads and confirms its live target first", async () => {
  const worker = (await deploymentTargets(cloudflare, "app", { installation }))[0];
  const mocks = deploymentMocks();
  mocks.targets = async () => [worker];
  mocks.read = () => JSON.stringify({ sha, backend: "cloudflare", config: worker.config, databaseId: settings.databaseId,
    bucketName: settings.bucketName, origin: settings.origin });
  await deployWorkers(cloudflare, mocks);
  expect(mocks.application).toHaveBeenCalledTimes(1);
  expect(mocks.application.mock.calls[0][4]).toBe(mocks.report);
  expect(mocks.deployedApplication).toHaveBeenCalledTimes(1);
  expect(mocks.verify.mock.calls[0][1]).toEqual({ sha, backend: "cloudflare", databaseId: settings.databaseId,
    bucketName: settings.bucketName, origin: settings.origin });
  expect(mocks.execute.mock.calls[0][1]).toEqual(["deploy", "--config", worker.config]);
  expect(mocks.execute.mock.calls[0][2].env.WRANGLER_WRITE_LOGS).toBe("false");
  mocks.execute.mockClear();
  mocks.application.mockRejectedValue(new Error("Target mismatch"));
  await expect(deployWorkers(cloudflare, mocks)).rejects.toThrow("Target mismatch");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("confirms the live target before it applies migrations and requires the checkout's schema", async () => {
  const worker = (await deploymentTargets(cloudflare, "app", { installation }))[0];
  const migrations = JSON.stringify([{ success: true, results: (await currentMigrationNames()).map((name) => ({ name })) }]);
  const bucket = (rejected) => async (url) => ({ ok: true, json: async () => ({ success: true,
    result: url.endsWith("/managed") ? { enabled: rejected === "managed" }
      : url.endsWith("/custom") ? { domains: rejected === "custom" ? [{ enabled: true }] : [] }
        : { name: rejected === "bucket" ? "different-bucket" : settings.bucketName },
  }) });
  const request = vi.fn(bucket());
  const bookmark = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
  const provider = ({ secrets = [{ name: "AUTH_SECRET", type: "secret_text" }], applied = migrations,
    apply = () => "Migrations applied", travel = () => JSON.stringify({ bookmark }) } = {}) => (command, args) => {
    if (args[0] === "whoami") return settings.accountId;
    if (args[0] === "d1" && args[1] === "time-travel") return travel();
    if (args[0] === "d1" && args[1] === "info") return JSON.stringify({ uuid: settings.databaseId, name: settings.databaseName });
    if (args[0] === "secret") return JSON.stringify(secrets);
    if (args[0] === "d1" && args[1] === "migrations") return apply();
    if (args[0] === "d1" && args[1] === "execute") return applied;
    throw new Error("Unexpected command");
  };
  const applies = (execute) => execute.mock.calls.filter(([, args]) => args[1] === "migrations");

  const execute = vi.fn(provider());
  const report = vi.fn();
  await prepareApplication(worker, cloudflare, execute, request, report);
  expect(execute.mock.calls.map(([, args]) => args.slice(0, 2).join(" "))).toEqual([
    "whoami --config", "d1 info", "secret list", "d1 time-travel", "d1 migrations", "d1 execute",
  ]);
  expect(execute.mock.calls[3][1]).toEqual(["d1", "time-travel", "info", settings.databaseName, "--json",
    "--config", worker.config]);
  expect(report).toHaveBeenCalledWith(`Restore point before migrations: ${bookmark}. To restore it, run: ` +
    `npx wrangler d1 time-travel restore ${settings.databaseName} --bookmark=${bookmark} --config ${worker.config}`);
  expect(applies(execute)[0][1]).toEqual(["d1", "migrations", "apply", settings.databaseName, "--remote",
    "--config", worker.config]);
  expect(execute.mock.calls[0][2].stdio).toEqual(["ignore", "pipe", "pipe"]);
  expect(execute.mock.calls[0][2].env.CI).toBe("true");

  const unconfirmed = vi.fn(() => "private rejected provider detail");
  await expect(prepareApplication(worker, cloudflare, unconfirmed, request)).rejects.toThrow(/could not be confirmed/);
  expect(applies(unconfirmed)).toHaveLength(0);

  const noSecret = vi.fn(provider({ secrets: [] }));
  await expect(prepareApplication(worker, cloudflare, noSecret, request)).rejects.toThrow(/Confirm AUTH_SECRET/);
  expect(applies(noSecret)).toHaveLength(0);

  for (const rejected of ["bucket", "managed", "custom"]) {
    const publicBucket = vi.fn(provider());
    await expect(prepareApplication(worker, cloudflare, publicBucket, vi.fn(bucket(rejected))))
      .rejects.toThrow(/R2 bucket could not be confirmed/);
    expect(applies(publicBucket)).toHaveLength(0);
  }

  // Without a recorded restore point, no migration starts.
  for (const travel of [() => { throw new Error("private provider detail"); }, () => "{}",
    () => JSON.stringify({ bookmark: "$(touch /tmp/never)" })]) {
    const unrecorded = vi.fn(provider({ travel }));
    await expect(prepareApplication(worker, cloudflare, unrecorded, request, vi.fn()))
      .rejects.toThrow("The D1 restore point could not be recorded. No migration started.");
    expect(applies(unrecorded)).toHaveLength(0);
  }

  const failed = vi.fn(provider({ apply: () => { throw new Error("private migration detail"); } }));
  await expect(prepareApplication(worker, cloudflare, failed, request, vi.fn())).rejects.toThrow(/migration outcome is unknown/);

  // An older build after a newer migration sees extra hosted migrations and stops.
  const ahead = vi.fn(provider({ applied: JSON.stringify([{ success: true, results: [
    ...(await currentMigrationNames()), "9999_newer.sql"].map((name) => ({ name })) }]) }));
  await expect(prepareApplication(worker, cloudflare, ahead, request, vi.fn())).rejects.toThrow(/hosted migrations differ/);
});

it("accepts the former preparation branch after its dependency merged while omitting its app preview", async () => {
  const prepared = { ...env, WORKERS_CI_BRANCH: "feature/t0021-cloudflare-development-install" };
  expect(deploymentPlan(prepared).preview).toBe(true);
  expect((await deploymentTargets(prepared)).map((target) => target.name)).toEqual(["minsky-docs"]);
});

it("rejects an app marker with the right revision and the wrong backend or data target", async () => {
  const expected = { sha, backend: "cloudflare", databaseId: settings.databaseId,
    bucketName: settings.bucketName, origin: settings.origin };
  const request = vi.fn().mockResolvedValue({ ok: true, json: async () => expected });
  const pause = vi.fn();
  await verifyRevision(settings.origin, expected, request, pause);
  for (const change of [{ backend: "supabase" }, { databaseId: "other" }, { bucketName: "other" },
    { origin: "https://wrong.example" }]) {
    request.mockResolvedValue({ ok: true, json: async () => ({ ...expected, ...change }) });
    await expect(verifyRevision(settings.origin, expected, request, pause)).rejects.toThrow(/could not be verified/);
  }
});

function deployedBindings() {
  return [
    { name: "DB", type: "d1", id: settings.databaseId },
    { name: "IMAGES", type: "r2_bucket", bucket_name: settings.bucketName },
    { name: "LIVE_UPDATES", type: "durable_object_namespace", class_name: "SessionLiveCoordinator", namespace_id: "namespace" },
    { name: "AUTH_ORIGIN", type: "plain_text", text: settings.origin },
    { name: "AUTH_SECRET", type: "secret_text" },
  ];
}

it("verifies live application bindings and the anonymous API denial after upload", async () => {
  const worker = (await deploymentTargets(cloudflare, "app", { installation }))[0];
  const request = vi.fn(async (url) => url.endsWith("/settings")
    ? { ok: true, json: async () => ({ success: true, result: { bindings: deployedBindings() } }) }
    : { status: 401, json: async () => ({ error: "Sign in to continue." }) });
  await verifyApplicationDeployment(worker, cloudflare, request);
  expect(request.mock.calls[1][0]).toBe(`${settings.origin}/api/auth/session`);
  expect(request.mock.calls[1][1].headers).toEqual({ Origin: settings.origin });
  expect(request.mock.calls[1][1].headers.Authorization).toBeUndefined();
  for (const [name, change] of [
    ["DB", { id: "wrong-database" }], ["IMAGES", { bucket_name: "wrong-bucket" }],
    ["LIVE_UPDATES", { class_name: "WrongClass" }], ["LIVE_UPDATES", { namespace_id: "" }],
    ["LIVE_UPDATES", { script_name: "other-worker" }], ["AUTH_ORIGIN", { text: "https://wrong.example" }],
    ["AUTH_SECRET", { type: "plain_text" }],
  ]) {
    request.mockResolvedValue({ ok: true, json: async () => ({ success: true, result: {
      bindings: deployedBindings().map((binding) => binding.name === name ? { ...binding, ...change } : binding),
    } }) });
    await expect(verifyApplicationDeployment(worker, cloudflare, request)).rejects.toThrow(/could not be verified/);
  }
  for (const bindings of [[], [...deployedBindings(), deployedBindings()[0]], [null]]) {
    request.mockResolvedValue({ ok: true, json: async () => ({ success: true, result: { bindings } }) });
    await expect(verifyApplicationDeployment(worker, cloudflare, request)).rejects.toThrow(/could not be verified/);
  }
  for (const status of [200, 403, 503]) {
    request.mockImplementation(async (url) => url.endsWith("/settings")
      ? { ok: true, json: async () => ({ success: true, result: { bindings: deployedBindings() } }) }
      : { status, json: async () => ({ error: "Sign in to continue." }) });
    await expect(verifyApplicationDeployment(worker, cloudflare, request)).rejects.toThrow(/could not be verified/);
  }
});

it("selects the committed Cloudflare target and ignores a retired Supabase selection", async () => {
  const config = "src/server/adapters/cloudflare/deploy/development.wrangler.jsonc";
  const expected = {
    accountId: "458ad6a930b0fb717796dfa19ca6a2b1", workerName: "minsky-dev",
    databaseName: "minsky-development", databaseId: "a1832f97-4d4c-45c2-a848-8d3dfd0b74f5",
    bucketName: "minsky-development-images", origin: "https://minsky-dev.icaic-minsky.workers.dev",
  };
  const prepared = {
    ...development, CLOUDFLARE_API_TOKEN: "", GH_TOKEN: "",
    MINSKY_DEV_CLOUDFLARE_CONFIG: config, MINSKY_DEV_DATABASE_ID: expected.databaseId,
    MINSKY_DEV_DATABASE_NAME: expected.databaseName, MINSKY_DEV_BUCKET_NAME: expected.bucketName,
  };
  const enabled = await deploymentTargets(prepared, "app");
  expect(enabled).toHaveLength(1);
  expect(enabled[0]).toMatchObject({ name: "minsky-dev", config, backend: "cloudflare", settings: expected });
  expect(enabled[0].settings).toEqual(JSON.parse(readFileSync(
    "src/server/adapters/cloudflare/deploy/development.settings.json", "utf8",
  )));
  expect(await deploymentTargets({ ...prepared, MINSKY_DEV_BACKEND: "supabase" }, "app")).toEqual(enabled);
});
