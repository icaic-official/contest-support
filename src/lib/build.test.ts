import { describe, expect, it } from "vitest";
import { shortBuildId } from "./build";

describe("shortBuildId", () => {
  it("keeps the first seven characters of a commit hash", () => {
    expect(shortBuildId("224c3fa8ab8921b56fb5d4e678040537289b11d9")).toBe("224c3fa");
  });

  it("leaves a value that is not a full hash unchanged", () => {
    expect(shortBuildId("unknown")).toBe("unknown");
  });
});
