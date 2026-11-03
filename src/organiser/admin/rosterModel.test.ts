import { describe, expect, it } from "vitest";
import {
  categoriesError,
  categoryUsage,
  compareNames,
  moveItem,
} from "./rosterModel";

describe("usage", () => {
  it("counts issues of each category and skips a legacy blank category", () => {
    const usage = categoryUsage([{ category: "Devices" }, { category: "Devices" }, { category: "" }]);
    expect([...usage]).toEqual([["Devices", 2]]);
  });
});

describe("categoriesError", () => {
  it.each([
    [[], "Keep at least one category."],
    [["Ok", " "], "Give every category a name."],
    [["Ok", "ok "], "Two categories have the same name."],
    [["x".repeat(201)], "Use at most 200 characters in a category."],
    [Array.from({ length: 51 }, (_, index) => `C${index}`), "Use at most 50 categories."],
    [["Network", "Power"], undefined],
  ])("checks %j", (list, message) => {
    expect(categoriesError(list)).toBe(message);
  });
});

describe("list helpers", () => {
  it("moves one item and ignores a move off the list", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 3)).toEqual(["a", "b", "c"]);
  });

  it("sorts numbers inside names by value", () => {
    expect(["Team 10", "Team 2", "team 1"].sort(compareNames)).toEqual(["team 1", "Team 2", "Team 10"]);
  });
});
