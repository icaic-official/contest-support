import { describe, expect, it } from "vitest";
import type { ManageLevel } from "@/backend/contracts";
import { contestOfSearch, levelScreenAccess, searchWithContest, searchWithoutContest } from "./navigation";

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

describe("searchWithoutContest", () => {
  it("drops the parameter and keeps every other one", () => {
    expect(searchWithoutContest("?a=1&contest=old&b=2")).toBe("?a=1&b=2");
  });

  it("returns an empty search when the parameter was the only one", () => {
    expect(searchWithoutContest("?contest=old")).toBe("");
    expect(searchWithoutContest("?contest=")).toBe("");
  });

  it("leaves a search without the parameter as it is", () => {
    expect(searchWithoutContest("")).toBe("");
    expect(searchWithoutContest("?a=1")).toBe("?a=1");
  });

  it("drops every copy of the parameter", () => {
    expect(searchWithoutContest("?contest=a&x=1&contest=b")).toBe("?x=1");
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
