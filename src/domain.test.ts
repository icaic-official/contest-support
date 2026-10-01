import { describe, expect, it } from "vitest";
import {
  assignmentDelay,
  duration,
  elapsed,
  seed,
  transition,
  visibleHistory,
  type Action,
  type Persona,
  type State,
} from "./domain";
const start = 1_000_000;
function journey() {
  let state = seed(start);
  const run = (action: Action, actor: Persona, after: number) => {
    state = transition(state, action, actor, start + after);
    return state;
  };
  run(
    { type: "submit", category: "Backend", description: "  Cannot connect  " },
    "contestant",
    0,
  );
  const id = state.issues[0].id;
  return { run, id, state: () => state };
}
describe("issue lifecycle", () => {
  it("tracks submission, first assignment, handoff ownership, and a stopped timer", () => {
    const { run, id, state } = journey();
    expect(state().issues[0]).toMatchObject({
      createdAt: start,
      description: "Cannot connect",
      status: "open",
      teamId: "aurora",
    });
    expect(assignmentDelay(state().issues[0])).toBeUndefined();
    expect(elapsed(state().issues[0], start + 3000)).toBe(3000);
    run({ type: "claim", issueId: id }, "volunteer", 5000);
    run({ type: "escalate", issueId: id }, "volunteer", 7000);
    expect(state().issues[0]).toMatchObject({
      status: "escalated",
      owner: "volunteer",
      firstAssignedAt: start + 5000,
    });
    run({ type: "accept", issueId: id }, "specialist", 10000);
    expect(state().issues[0]).toMatchObject({
      status: "claimed",
      owner: "specialist",
      firstAssignedAt: start + 5000,
    });
    run(
      { type: "resolve", issueId: id, summary: "Connection restored" },
      "specialist",
      20000,
    );
    expect(elapsed(state().issues[0], start + 500000)).toBe(20000);
    expect(assignmentDelay(state().issues[0])).toBe(5000);
    expect(state().issues[0].summary).toBe("Connection restored");
    expect(state().issues[0].history.map((entry) => entry.actor)).toEqual([
      "contestant",
      "volunteer",
      "volunteer",
      "specialist",
      "specialist",
    ]);
  });
  it("rejects duplicate or invalid transitions without changing the input", () => {
    const { run, id, state } = journey();
    const original = structuredClone(state());
    expect(() =>
      run({ type: "accept", issueId: id }, "specialist", 1000),
    ).toThrow();
    expect(state()).toEqual(original);
    expect(() =>
      run({ type: "claim", issueId: id }, "contestant", 1000),
    ).toThrow();
    run({ type: "claim", issueId: id }, "volunteer", 2000);
    expect(() =>
      run({ type: "claim", issueId: id }, "volunteer", 3000),
    ).toThrow();
    run({ type: "escalate", issueId: id }, "volunteer", 4000);
    expect(() =>
      run({ type: "escalate", issueId: id }, "volunteer", 5000),
    ).toThrow();
    run({ type: "accept", issueId: id }, "specialist", 6000);
    expect(() =>
      run({ type: "accept", issueId: id }, "specialist", 7000),
    ).toThrow();
    expect(() =>
      run({ type: "resolve", issueId: id, summary: "Done" }, "volunteer", 8000),
    ).toThrow();
    run({ type: "resolve", issueId: id, summary: "Done" }, "specialist", 9000);
    expect(() =>
      run(
        { type: "resolve", issueId: id, summary: "Again" },
        "specialist",
        10000,
      ),
    ).toThrow();
  });
  it("lets the retained owner resolve during a pending handoff", () => {
    const { run, id, state } = journey();
    run({ type: "claim", issueId: id }, "volunteer", 1000);
    run({ type: "escalate", issueId: id }, "volunteer", 2000);
    run(
      { type: "resolve", issueId: id, summary: "Fixed locally" },
      "volunteer",
      3000,
    );
    expect(state().issues[0].escalation).toBeUndefined();
    expect(() =>
      run({ type: "accept", issueId: id }, "specialist", 4000),
    ).toThrow();
  });
  it("separates public replies from internal notes and blocks invalid messages", () => {
    const { run, id, state } = journey();
    run(
      {
        type: "message",
        issueId: id,
        text: "Internal diagnostic",
        visibility: "internal",
      },
      "volunteer",
      1000,
    );
    run(
      {
        type: "message",
        issueId: id,
        text: "We are investigating",
        visibility: "public",
      },
      "specialist",
      2000,
    );
    expect(
      visibleHistory(state().issues[0], "contestant")
        .map((entry) => entry.text)
        .join(),
    ).not.toContain("Internal diagnostic");
    expect(visibleHistory(state().issues[0], "jury")).toHaveLength(3);
    expect(() =>
      run(
        {
          type: "message",
          issueId: id,
          text: "Secret",
          visibility: "internal",
        },
        "contestant",
        3000,
      ),
    ).toThrow();
    expect(() =>
      run(
        {
          type: "message",
          issueId: "ISS-002",
          text: "Other team",
          visibility: "public",
        },
        "contestant",
        4000,
      ),
    ).toThrow();
  });
  it("validates content, categories, and monotonic timestamps", () => {
    const { run, id } = journey();
    expect(() =>
      run(
        { type: "submit", category: "Unknown", description: "Issue" },
        "contestant",
        1000,
      ),
    ).toThrow();
    expect(() =>
      run(
        { type: "submit", category: "Other", description: "  " },
        "contestant",
        1000,
      ),
    ).toThrow();
    expect(() =>
      run({ type: "claim", issueId: id }, "volunteer", -1),
    ).toThrow();
    expect(duration(61500)).toBe("1m 01s");
  });
});
describe("award ledger", () => {
  const award: Action = {
    type: "award",
    issueId: "ISS-003",
    minutes: 5,
    explanation: "Time lost to clarification",
  };
  it("records one discretionary decision and a separate application, rejecting repetitions", () => {
    let state = seed(start);
    state = transition(state, award, "jury", start);
    expect(state.awards[0]).toMatchObject({
      issueId: "ISS-003",
      minutes: 5,
      actor: "jury",
    });
    expect(state.awards[0].appliedAt).toBeUndefined();
    expect(() => transition(state, award, "jury", start + 1)).toThrow();
    expect(() =>
      transition(
        state,
        { type: "apply", issueId: "ISS-003" },
        "contestant",
        start + 1,
      ),
    ).toThrow();
    state = transition(
      state,
      { type: "apply", issueId: "ISS-003" },
      "volunteer",
      start + 1000,
    );
    expect(state.awards).toHaveLength(1);
    expect(state.awards[0]).toMatchObject({
      appliedBy: "volunteer",
      appliedAt: start + 1000,
    });
    expect(() =>
      transition(
        state,
        { type: "apply", issueId: "ISS-003" },
        "jury",
        start + 2000,
      ),
    ).toThrow();
  });
  it.each([0, -1, 1.5, NaN, Infinity])(
    "rejects invalid minutes %s",
    (minutes) => {
      expect(() =>
        transition(seed(start), { ...award, minutes }, "jury", start),
      ).toThrow();
    },
  );
  it("requires a resolved issue, jury, explanation and an existing award to apply", () => {
    const state: State = seed(start);
    expect(() =>
      transition(state, { ...award, issueId: "ISS-001" }, "jury", start),
    ).toThrow();
    expect(() => transition(state, award, "volunteer", start)).toThrow();
    expect(() =>
      transition(state, { ...award, explanation: " " }, "jury", start),
    ).toThrow();
    expect(() =>
      transition(state, { type: "apply", issueId: "ISS-003" }, "jury", start),
    ).toThrow();
  });
});
