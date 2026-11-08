import { describe, expect, it } from "vitest";
import type { ManageLevel } from "@/backend/contracts";
import { contestOfSearch, contestOwnerOf, levelScreenAccess, requestedFocus, searchWithContest, withContestOwner } from "./navigation";

describe("contestOfSearch", () => {
  it("reads the contest parameter", () => {
    expect(contestOfSearch("?contest=abc")).toBe("abc");
    expect(contestOfSearch("?tab=1&contest=abc&x=y")).toBe("abc");
  });

  it("reads a percent-encoded value as typed", () => {
    expect(contestOfSearch("?contest=a%20b")).toBe("a b");
  });

  it("returns undefined when the parameter is missing or empty", () => {
    expect(contestOfSearch("")).toBeUndefined();
    expect(contestOfSearch("?other=1")).toBeUndefined();
    expect(contestOfSearch("?contest=")).toBeUndefined();
  });

  it("reads the first of two parameters", () => {
    expect(contestOfSearch("?contest=a&contest=b")).toBe("a");
  });
});

describe("contestOwnerOf", () => {
  it("reads the owner that withContestOwner writes", () => {
    expect(contestOwnerOf(withContestOwner(undefined, "a1"))).toBe("a1");
    expect(contestOwnerOf(withContestOwner({ contestOwner: "a1" }, "b2"))).toBe("b2");
  });

  it("finds no owner in a state that the app did not write", () => {
    expect(contestOwnerOf(undefined)).toBeUndefined();
    expect(contestOwnerOf(null)).toBeUndefined();
    expect(contestOwnerOf("a1")).toBeUndefined();
    expect(contestOwnerOf({ focusId: "x", token: "t" })).toBeUndefined();
    expect(contestOwnerOf({ contestOwner: 7 })).toBeUndefined();
  });
});

describe("withContestOwner", () => {
  it("keeps the focus request and every other field", () => {
    const state = withContestOwner({ focusId: "current-password", token: "t1", screen: true }, "a1");
    expect(requestedFocus(state)).toEqual({ focusId: "current-password", token: "t1" });
    expect(state).toMatchObject({ screen: true });
  });

  it("leaves the state as it is without an owner", () => {
    const state = { focusId: "x", token: "t" };
    expect(withContestOwner(state, undefined)).toBe(state);
    expect(withContestOwner(undefined, undefined)).toBeUndefined();
  });
});

describe("searchWithContest", () => {
  it("adds the parameter to an empty search", () => {
    expect(searchWithContest("", "abc")).toBe("?contest=abc");
  });

  it("replaces the parameter and keeps every other one in its place", () => {
    expect(searchWithContest("?a=1&contest=old&b=2", "new")).toBe("?a=1&contest=new&b=2");
  });

  it("keeps other parameters when it adds the parameter", () => {
    expect(searchWithContest("?a=1&b=two", "abc")).toBe("?a=1&b=two&contest=abc");
  });

  it("round-trips the value it writes", () => {
    const search = searchWithContest("?a=1", "a b&c");
    expect(contestOfSearch(search)).toBe("a b&c");
    expect(new URLSearchParams(search).get("a")).toBe("1");
  });
});

describe("levelScreenAccess", () => {
  const list = (...levels: ManageLevel[]) => levels.map((manage) => ({ manage }));

  it("waits for the first read of an empty list, and then leaves the decision to the screen", () => {
    expect(levelScreenAccess([], false)).toBe("wait");
    expect(levelScreenAccess([], true)).toBe("open");
  });

  it("opens for a person with the level event or site over any listed contest", () => {
    expect(levelScreenAccess(list("none", "event"), true)).toBe("open");
    expect(levelScreenAccess(list("site"), true)).toBe("open");
    expect(levelScreenAccess(list("none", "contest", "site"), false)).toBe("open");
  });

  it("denies a person with no such level, even before the read of the snapshot ends", () => {
    expect(levelScreenAccess(list("none"), true)).toBe("deny");
    expect(levelScreenAccess(list("none", "contest"), false)).toBe("deny");
  });
});
