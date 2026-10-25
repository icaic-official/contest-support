import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ID, isAgentToken, readAdminKey, tokenBody } from "./cloudflare-token.mjs";

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
    expect(tokenBody(request(), groups, now)).toEqual({
      name: "minsky-agent-preview-check-20261025",
      policies: [{ effect: "allow", permission_groups: [{ id: "g-workers" }], resources: { [account]: "*" } }],
      expires_on: "2026-11-24T03:00:00Z",
    });
  });

  it("accepts one zone and one R2 bucket in the Minsky account", () => {
    const resources = {
      "com.cloudflare.api.account.zone.0123456789abcdef0123456789abcdef": "*",
      [`com.cloudflare.edge.r2.bucket.${ACCOUNT_ID}_default_minsky-prod-images`]: "*",
    };
    const body = tokenBody(request({ policies: [{ permissions: ["D1 Write"], resources }] }), groups, now);
    expect(body.policies[0].resources).toEqual(resources);
  });

  it.each([
    ["a token permission", { policies: [{ permissions: ["Account API Tokens Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["a member permission", { policies: [{ permissions: ["Account Members Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["Workers Admin", { policies: [{ permissions: ["Workers Admin"], resources: { [account]: "*" } }] }, /may not grant/],
    ["a build trigger permission", { policies: [{ permissions: ["Workers CI Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["an Access permission", { policies: [{ permissions: ["Access: Users Write"], resources: { [account]: "*" } }] }, /may not grant/],
    ["an unknown permission", { policies: [{ permissions: ["Workers Tail Write"], resources: { [account]: "*" } }] }, /Unknown permission/],
    ["all accounts", { policies: [{ permissions: ["D1 Write"], resources: { "com.cloudflare.api.account.*": "*" } }] }, /not the Minsky account/],
    ["all zones", { policies: [{ permissions: ["D1 Write"], resources: { "com.cloudflare.api.account.zone.*": "*" } }] }, /not the Minsky account/],
    ["another account", { policies: [{ permissions: ["D1 Write"], resources: { "com.cloudflare.api.account.ffffffffffffffffffffffffffffffff": "*" } }] }, /not the Minsky account/],
    ["a nested scope", { policies: [{ permissions: ["D1 Write"], resources: { [account]: { "com.cloudflare.api.account.zone.*": "*" } } }] }, /Nested/],
    ["no resources", { policies: [{ permissions: ["D1 Write"], resources: {} }] }, /at least one resource/],
    ["no policies", { policies: [] }, /at least one policy/],
    ["no expiry limit", { days: 91 }, /from 1 to 90/],
    ["a free-form name", { purpose: "Prod Token!" }, /purpose/],
  ])("refuses %s", (_, overrides, message) => {
    expect(() => tokenBody(request(overrides), groups, now)).toThrow(message);
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
    writeFileSync(join(dir, ".env.local"), "CLOUDFLARE_API_TOKEN=wrangler\nCLOUDFLARE_TOKEN_ADMIN=admin\n");
    expect(readAdminKey({}, dir)).toBe("admin");
    writeFileSync(join(dir, ".env.local"), "CLOUDFLARE_API_TOKEN=wrangler\n");
    expect(() => readAdminKey({}, dir)).toThrow(/CLOUDFLARE_TOKEN_ADMIN/);
  });
});
