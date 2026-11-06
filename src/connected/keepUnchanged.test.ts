import { describe, expect, it } from "vitest";
import { keepUnchanged } from "./keepUnchanged";

const issue = (id: string, status = "open") => ({
  id,
  status,
  notes: [{ id: `${id}-n`, text: "x" }],
});

describe("keepUnchanged", () => {
  it("returns the previous object when nothing changed", () => {
    const previous = { issues: [issue("a"), issue("b")], at: "t" };
    const next = structuredClone(previous);
    expect(keepUnchanged(previous, next)).toBe(previous);
  });

  it("keeps the identity of issues that did not change", () => {
    const previous = { issues: [issue("a"), issue("b")] };
    const next = { issues: [issue("a"), issue("b", "claimed")] };
    const result = keepUnchanged(previous, next);
    expect(result).not.toBe(previous);
    expect(result.issues[0]).toBe(previous.issues[0]);
    expect(result.issues[1]).not.toBe(previous.issues[1]);
    expect(result.issues[1]).toEqual(next.issues[1]);
  });

  it("matches rows by id when one is added in front", () => {
    const previous = { issues: [issue("a"), issue("b")] };
    const next = { issues: [issue("c"), issue("a"), issue("b")] };
    const result = keepUnchanged(previous, next);
    expect(result.issues[1]).toBe(previous.issues[0]);
    expect(result.issues[2]).toBe(previous.issues[1]);
  });

  it("never returns data that differs from next", () => {
    const previous = { a: 1, list: [1, 2, 3], gone: true, nested: { x: null } };
    const next = { a: 1, list: [1, 2], nested: { x: 0 }, added: "y" };
    expect(keepUnchanged(previous, next)).toEqual(next);
  });

  it("detects a removed key and a shorter list", () => {
    expect(keepUnchanged({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(keepUnchanged([1, 2], [1])).toEqual([1]);
  });

  it("handles a missing previous value", () => {
    const next = { a: [1] };
    expect(keepUnchanged(undefined, next)).toBe(next);
  });
});
