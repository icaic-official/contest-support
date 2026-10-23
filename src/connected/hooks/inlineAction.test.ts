import { describe, expect, it } from "vitest";
import { inlineActionReturnsToList } from "./inlineAction";

describe("inlineActionReturnsToList", () => {
  it("returns to the list when the command is recorded and the person did not choose an issue", () => {
    expect(inlineActionReturnsToList(true, 2, 2)).toBe(true);
  });

  it("keeps the issue the person opened while the command ran", () => {
    expect(inlineActionReturnsToList(true, 2, 3)).toBe(false);
  });

  it("does not move the list when the command was not recorded", () => {
    expect(inlineActionReturnsToList(false, 2, 2)).toBe(false);
    expect(inlineActionReturnsToList(false, 2, 3)).toBe(false);
  });
});
