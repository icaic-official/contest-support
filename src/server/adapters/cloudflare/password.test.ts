import { describe, expect, it } from "vitest";
import { passwordHasher, randomSecret } from "./password";

describe("Better Auth credential compatibility", () => {
  it("uses independent salts and rejects a different password", async () => {
    const password = randomSecret();
    const first = await passwordHasher.hash(password);
    const second = await passwordHasher.hash(password);
    expect(first === second).toBe(false);
    expect(await passwordHasher.verify(password, first)).toBe(true);
    expect(await passwordHasher.verify(`${password}x`, first)).toBe(false);
  });

  it("retains Better Auth's Unicode normalization during verification", async () => {
    const hash = await passwordHasher.hash("Fictional caf\u00e9 fixture 2026");
    expect(await passwordHasher.verify("Fictional cafe\u0301 fixture 2026", hash)).toBe(true);
  });

  it("rejects malformed stored hashes without a cryptographic error", async () => {
    for (const malformed of ["", "missing-salt", "abc:123", `${"00".repeat(16)}:${"ff".repeat(64)}:extra`]) {
      expect(await passwordHasher.verify(randomSecret(), malformed)).toBe(false);
    }
  });
});
