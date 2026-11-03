import { describe, expect, it } from "vitest";
import {
  acceptsKind,
  entrantInputs,
  issueBatches,
  linesError,
  parsePersonLines,
  personInputs,
} from "./eventModel";

const rules = { uniqueNames: true, takenNames: ["Aurora"], takenHandles: ["aurora"] };

describe("parsePersonLines", () => {
  it("reads a name and a handle, and lets the name hold commas", () => {
    const lines = parsePersonLines("Cedar School, North, cedar\n\n Delta ,DELTA-1\r\nEcho\techo", rules);
    expect(lines.map(({ line, name, handle, problem }) => [line, name, handle, problem])).toEqual([
      [1, "Cedar School, North", "cedar", undefined],
      [3, "Delta", "delta-1", undefined],
      [4, "Echo", "echo", undefined],
    ]);
    expect(linesError(lines)).toBeUndefined();
  });

  it("flags missing parts, bad handles, and repeats", () => {
    const lines = parsePersonLines(
      ", x1y\nFoo\nBar, a\nBaz, baz\nBaz, baz2\nQux, baz\nAurora, other\nNew, aurora",
      rules,
    );
    expect(lines.map((line) => line.problem)).toEqual([
      "Write a name first.",
      "Add a comma and a username after the name.",
      "Use 3 to 32 letters, digits, hyphens, or underscores for the username.",
      undefined,
      "Same name as line 4.",
      "Same username as line 4.",
      "That name is already in the event.",
      "That username is already in the event.",
    ]);
    expect(linesError(lines)).toBe("Fix or remove the lines with a problem.");
  });

  it("allows repeated names for people", () => {
    const lines = parsePersonLines("Sam Lee, sam-1\nSam Lee, sam-2", { ...rules, uniqueNames: false });
    expect(lines.every((line) => !line.problem)).toBe(true);
  });

  it("builds the command inputs", () => {
    const lines = parsePersonLines("Cedar, cedar", rules);
    expect(personInputs(lines)).toEqual([{ name: "Cedar", handle: "cedar" }]);
    expect(entrantInputs(lines, "team")).toEqual([{ kind: "team", name: "Cedar", handle: "cedar" }]);
  });

  it("needs a line and refuses too many", () => {
    expect(linesError([])).toBe("Write at least one line.");
    const many = parsePersonLines(Array.from({ length: 301 }, (_, i) => `N${i}, h-${i}x`).join("\n"), rules);
    expect(linesError(many)).toBe("Use at most 300 lines at a time.");
  });
});

describe("contest types and batches", () => {
  it("matches entrant kinds to contest types", () => {
    expect(acceptsKind("teams", "team")).toBe(true);
    expect(acceptsKind("teams", "single")).toBe(false);
    expect(acceptsKind("singles", "single")).toBe(true);
    expect(acceptsKind("singles", "team")).toBe(false);
    expect(acceptsKind("mixed", "team")).toBe(true);
    expect(acceptsKind("mixed", "single")).toBe(true);
  });

  it("splits account IDs into batches of eight", () => {
    const ids = Array.from({ length: 19 }, (_, index) => `a${index}`);
    expect(issueBatches(ids).map((batch) => batch.length)).toEqual([8, 8, 3]);
    expect(issueBatches([])).toEqual([]);
  });
});
