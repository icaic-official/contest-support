import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAgentToken, readAdminKey, resolveAccount, tokenBody } from "./cloudflare-token.mjs";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

const groups = [
  { id: "g-d1", name: "D1 Write" },
  { id: "g-workers", name: "Workers Scripts Write" },
  { id: "g-admin", name: "Workers Admin" },
  { id: "g-ci", name: "Workers CI Write" },
  { id: "g-access", name: "Access: Users Write" },
  { id: "g-tokens", name: "Account API Tokens Write" },
  { id: "g-members", name: "Account Members Write" },
];
const account = `com.cloudflare.api.account.${ACCOUNT_ID}`;
const now = new Date("2026-10-25T03:00:00.000Z");
const request = (overrides = {}) => ({
  purpose: "preview-check",
  policies: [{ permissions: ["Workers Scripts Write"], resources: { [account]: "*" } }],
  ...overrides,
});

describe("token requests", () => {
  it("builds a named, expiring token from permission names", () => {
    expect(tokenBody(request(), groups, { accountId: ACCOUNT_ID, now })).toEqual({
      name: "minsky-agent-preview-check-20261025",
      policies: [{ effect: "allow", permission_groups: [{ id: "g-workers" }], resources: { [account]: "*" } }],
      expires_on: "2026-11-24T03:00:00Z",
    });
  });

  it("accepts one zone and one R2 bucket in this account", () => {
    const resources = {
      "com.cloudflare.api.account.zone.0123456789abcdef0123456789abcdef": "*",
      [`com.cloudflare.edge.r2.bucket.${ACCOUNT_ID}_default_minsky-prod-images`]: "*",
    };
    const body = tokenBody(request({ policies: [{ permissions: ["D1 Write"], resources }] }), groups, { accountId: ACCOUNT_ID, now });
    expect(body.policies[0].resources).toEqual(resources);
  });

  it.each([
    ["a token permission", { policies: [{ permissions: ["Account API Tokens Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["a member permission", { policies: [{ permissions: ["Account Members Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["Workers Admin", { policies: [{ permissions: ["Workers Admin"], resources: { [account]: "*" } }] }, /may not grant/],
    ["a build trigger permission", { policies: [{ permissions: ["Workers CI Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["an Access permission", { policies: [{ permissions: ["Access: Users Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["an unknown permission", { policies: [{ permissions: ["Workers Tail Write"], resources: { [account]: "*" } }] }, /Unknown permission/],
    ["all accounts", { policies: [{ permissions: ["D1 Write"], resources: { "com.cloudflare.api.account.*": "*" } }] }, /not this account/],
    ["all zones", { policies: [{ permissions: ["D1 Write"], resources: { "com.cloudflare.api.account.zone.*": "*" } }] }, /not this account/],
    ["another account", { policies: [{ permissions: ["D1 Write"], resources: { "com.cloudflare.api.account.ffffffffffffffffffffffffffffffff": "*" } }] }, /not this account/],
    ["a nested scope", { policies: [{ permissions: ["D1 Write"], resources: { [account]: { "com.cloudflare.api.account.zone.*": "*" } } }] }, /Nested/],
    ["no resources", { policies: [{ permissions: ["D1 Write"], resources: {} }] }, /at least one resource/],
    ["no policies", { policies: [] }, /at least one policy/],
    ["no expiry limit", { days: 91 }, /from 1 to 90/],
    ["a free-form name", { purpose: "Prod Token!" }, /purpose/],
  ])("refuses %s", (_, overrides, message) => {
    expect(() => tokenBody(request(overrides), groups, { accountId: ACCOUNT_ID, now })).toThrow(message);
  });
});

describe("account", () => {
  it("takes CLOUDFLARE_ACCOUNT_ID without calling Cloudflare", async () => {
    await expect(resolveAccount("unused", { CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID })).resolves.toBe(ACCOUNT_ID);
  });

  it("refuses a malformed account ID", async () => {
    await expect(resolveAccount("unused", { CLOUDFLARE_ACCOUNT_ID: "not-an-account" })).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
    expect(() => tokenBody(request(), groups, { accountId: "", now })).toThrow(/accountId/);
  });
});

describe("token ownership", () => {
  it("treats only minsky-agent tokens as agent tokens", () => {
    expect(isAgentToken({ name: "minsky-agent-preview-check-20261025" })).toBe(true);
    expect(isAgentToken({ name: "minsky-dev builds" })).toBe(false);
  });
});

describe("admin key", () => {
  it("prefers the environment and otherwise reads only CLOUDFLARE_TOKEN_ADMIN from .env.local", () => {
    expect(readAdminKey({ CLOUDFLARE_TOKEN_ADMIN: "from-env" }, tmpdir())).toBe("from-env");
    const dir = mkdtempSync(join(tmpdir(), "minsky-token-"));
    try {
      writeFileSync(join(dir, ".env.local"), "CLOUDFLARE_API_TOKEN=wrangler\nCLOUDFLARE_TOKEN_ADMIN=admin\n");
      expect(readAdminKey({}, dir)).toBe("admin");
      writeFileSync(join(dir, ".env.local"), "CLOUDFLARE_API_TOKEN=wrangler\n");
      expect(() => readAdminKey({}, dir)).toThrow(/CLOUDFLARE_TOKEN_ADMIN/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
