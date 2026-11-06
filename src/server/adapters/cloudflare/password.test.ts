import { describe, expect, it } from "vitest";
import { passwordHasher, randomSecret, readablePassword } from "./password";

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

describe("readablePassword", () => {
  it("has 16 characters from an alphabet without look-alike characters", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(readablePassword()).toMatch(/^[2-9A-HJ-NP-Za-km-np-z]{16}$/);
    }
  });

  it("meets the password length rule and differs between calls", () => {
    const seen = new Set(Array.from({ length: 50 }, readablePassword));
    expect(seen.size).toBe(50);
  });

  it("uses every character of the alphabet with roughly equal frequency", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 20000; i += 1) {
      for (const char of readablePassword()) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(56);
    const expected = (20000 * 16) / 56;
    for (const count of counts.values()) expect(Math.abs(count - expected)).toBeLessThan(expected * 0.1);
  });
});
