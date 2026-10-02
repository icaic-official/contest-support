import { describe, expect, it } from "vitest";
import {
  assignmentDelay,
  canAward,
  canClaim,
  canReopen,
  canView,
  isJuryOnly,
  personas,
  roleLabel,
  stateSchema,
  type Person,
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
    "aurora",
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
    run({ type: "claim", issueId: id }, "sam", 5000);
    run({ type: "escalate", issueId: id }, "sam", 7000);
    expect(state().issues[0]).toMatchObject({
      status: "escalated",
      owner: "sam",
      firstAssignedAt: start + 5000,
    });
    run({ type: "accept", issueId: id }, "maya", 10000);
    expect(state().issues[0]).toMatchObject({
      status: "claimed",
      owner: "maya",
      firstAssignedAt: start + 5000,
    });
    run(
      { type: "resolve", issueId: id, summary: "Connection restored" },
      "maya",
      20000,
    );
    expect(elapsed(state().issues[0], start + 500000)).toBe(20000);
    expect(assignmentDelay(state().issues[0])).toBe(5000);
    expect(state().issues[0].summary).toBe("Connection restored");
    expect(state().issues[0].history.map((entry) => entry.actor)).toEqual([
      "aurora",
      "sam",
      "sam",
      "maya",
      "maya",
    ]);
  });
  it("rejects duplicate or invalid transitions without changing the input", () => {
    const { run, id, state } = journey();
    const original = structuredClone(state());
    expect(() => run({ type: "accept", issueId: id }, "maya", 1000)).toThrow();
    expect(state()).toEqual(original);
    expect(() => run({ type: "claim", issueId: id }, "aurora", 1000)).toThrow();
    run({ type: "claim", issueId: id }, "sam", 2000);
    expect(() => run({ type: "claim", issueId: id }, "sam", 3000)).toThrow();
    run({ type: "escalate", issueId: id }, "sam", 4000);
    expect(() => run({ type: "escalate", issueId: id }, "sam", 5000)).toThrow();
    run({ type: "accept", issueId: id }, "maya", 6000);
    expect(() => run({ type: "accept", issueId: id }, "maya", 7000)).toThrow();
    expect(() =>
      run({ type: "resolve", issueId: id, summary: "Done" }, "sam", 8000),
    ).toThrow();
    run({ type: "resolve", issueId: id, summary: "Done" }, "maya", 9000);
    expect(() =>
      run({ type: "resolve", issueId: id, summary: "Again" }, "maya", 10000),
    ).toThrow();
  });
  it("lets the retained owner resolve during a pending handoff", () => {
    const { run, id, state } = journey();
    run({ type: "claim", issueId: id }, "sam", 1000);
    run({ type: "escalate", issueId: id }, "sam", 2000);
    run(
      { type: "resolve", issueId: id, summary: "Fixed locally" },
      "sam",
      3000,
    );
    expect(state().issues[0].escalation).toBeUndefined();
    expect(() => run({ type: "accept", issueId: id }, "maya", 4000)).toThrow();
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
      "sam",
      1000,
    );
    run(
      {
        type: "message",
        issueId: id,
        text: "We are investigating",
        visibility: "public",
      },
      "maya",
      2000,
    );
    expect(
      visibleHistory(state().issues[0], "aurora")
        .map((entry) => entry.text)
        .join(),
    ).not.toContain("Internal diagnostic");
    expect(visibleHistory(state().issues[0], "alex")).toHaveLength(3);
    expect(() =>
      run(
        {
          type: "message",
          issueId: id,
          text: "Secret",
          visibility: "internal",
        },
        "aurora",
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
        "aurora",
        4000,
      ),
    ).toThrow();
  });
  it("validates content, categories, and monotonic timestamps", () => {
    const { run, id } = journey();
    expect(() =>
      run(
        { type: "submit", category: "Unknown", description: "Issue" },
        "aurora",
        1000,
      ),
    ).toThrow();
    expect(() =>
      run(
        { type: "submit", category: "Other", description: "  " },
        "aurora",
        1000,
      ),
    ).toThrow();
    expect(() => run({ type: "claim", issueId: id }, "sam", -1)).toThrow();
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
    state = transition(state, award, "alex", start);
    expect(state.awards[0]).toMatchObject({
      issueId: "ISS-003",
      minutes: 5,
      actor: "alex",
    });
    expect(state.awards[0].appliedAt).toBeUndefined();
    expect(() => transition(state, award, "alex", start + 1)).toThrow();
    expect(() =>
      transition(
        state,
        { type: "apply", issueId: "ISS-003" },
        "aurora",
        start + 1,
      ),
    ).toThrow();
    state = transition(
      state,
      { type: "apply", issueId: "ISS-003" },
      "sam",
      start + 1000,
    );
    expect(state.awards).toHaveLength(1);
    expect(state.awards[0]).toMatchObject({
      appliedBy: "sam",
      appliedAt: start + 1000,
    });
    expect(() =>
      transition(
        state,
        { type: "apply", issueId: "ISS-003" },
        "alex",
        start + 2000,
      ),
    ).toThrow();
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid minutes %s",
    (minutes) => {
      expect(() =>
        transition(seed(start), { ...award, minutes }, "alex", start),
      ).toThrow();
    },
  );
  it("records zero as a decision, preserving the one-award rule and separate application", () => {
    const decision = { ...award, minutes: 0 };
    let state = transition(seed(start), decision, "alex", start);
    expect(state.awards[0]).toMatchObject({ minutes: 0, actor: "alex" });
    expect(state.awards[0].appliedAt).toBeUndefined();
    expect(() => transition(state, award, "alex", start + 1)).toThrow();
    state = transition(
      state,
      { type: "reopen", issueId: "ISS-003", reason: "Recheck" },
      "sam",
      start + 2,
    );
    state = transition(
      state,
      { type: "apply", issueId: "ISS-003" },
      "maya",
      start + 3,
    );
    expect(state.awards[0]).toMatchObject({
      minutes: 0,
      appliedBy: "maya",
      appliedAt: start + 3,
    });
    expect(stateSchema.safeParse(state).success).toBe(true);
  });
  it("requires a resolved issue, jury, explanation and an existing award to apply", () => {
    const state: State = seed(start);
    expect(() =>
      transition(state, { ...award, issueId: "ISS-001" }, "alex", start),
    ).toThrow();
    expect(() => transition(state, award, "sam", start)).toThrow();
    expect(() =>
      transition(state, { ...award, explanation: " " }, "alex", start),
    ).toThrow();
    expect(() =>
      transition(state, { type: "apply", issueId: "ISS-003" }, "alex", start),
    ).toThrow();
  });
});

describe("multiple roles and reopening", () => {
  it.each<Persona>(["sam", "maya", "robin"])(
    "lets %s claim and resolve directly with one identity",
    (actor) => {
      const { run, id, state } = journey();
      run({ type: "claim", issueId: id }, actor, 1000);
      const claimed = structuredClone(state());
      expect(() => run({ type: "claim", issueId: id }, actor, 2000)).toThrow();
      expect(state()).toEqual(claimed);
      run(
        { type: "resolve", issueId: id, summary: "Fixed directly" },
        actor,
        3000,
      );
      expect(state().issues[0].owner).toBe(actor);
      expect(
        state()
          .issues[0].history.slice(1)
          .map((entry) => entry.actor),
      ).toEqual([actor, actor]);
      expect(stateSchema.safeParse(state()).success).toBe(true);
    },
  );

  it.each<Persona>(["aurora", "alex"])(
    "denies initial triage to %s",
    (actor) => {
      expect(() =>
        transition(
          seed(start),
          { type: "claim", issueId: "ISS-001" },
          actor,
          start,
        ),
      ).toThrow();
    },
  );

  it.each<Persona>(["maya", "robin"])(
    "keeps %s responsible until another specialist accepts",
    (actor) => {
      const { run, id, state } = journey();
      run({ type: "claim", issueId: id }, actor, 1000);
      run({ type: "escalate", issueId: id }, actor, 2000);
      const pending = structuredClone(state());
      expect(() => run({ type: "accept", issueId: id }, actor, 3000)).toThrow();
      expect(() => run({ type: "accept", issueId: id }, "sam", 3000)).toThrow();
      expect(state()).toEqual(pending);
      expect(stateSchema.safeParse(pending).success).toBe(true);
      const recipient = actor === "maya" ? "robin" : "maya";
      run({ type: "accept", issueId: id }, recipient, 4000);
      expect(state().issues[0]).toMatchObject({
        owner: recipient,
        firstAssignedAt: start + 1000,
      });
      expect(elapsed(state().issues[0], start + 5000)).toBe(5000);
    },
  );

  it("combines support and jury capabilities without hiding active issues", () => {
    const person: Person = { name: "Fixture", roles: ["jury", "volunteer"] };
    const state = seed(start);
    expect(roleLabel(person)).toBe("Jury + Volunteer");
    expect(isJuryOnly(person)).toBe(false);
    expect(canView(state.issues[0], person)).toBe(true);
    expect(canClaim(state.issues[0], person)).toBe(true);
    expect(canReopen(state.issues[2], person)).toBe(true);
    expect(canAward(state.issues[2], person)).toBe(true);
    expect(canAward(state.issues[0], person)).toBe(false);
    expect(canView(state.issues[0], personas.alex)).toBe(false);
    const original = personas.alex;
    try {
      personas.alex = person;
      let combined = transition(
        state,
        { type: "claim", issueId: "ISS-001" },
        "alex",
        start,
      );
      combined = transition(
        combined,
        { type: "resolve", issueId: "ISS-001", summary: "Fixed" },
        "alex",
        start + 1,
      );
      combined = transition(
        combined,
        {
          type: "award",
          issueId: "ISS-001",
          minutes: 2,
          explanation: "Lost time",
        },
        "alex",
        start + 2,
      );
      expect(combined.issues[0].owner).toBe("alex");
      expect(combined.awards[0].actor).toBe("alex");
      expect(stateSchema.safeParse(combined).success).toBe(true);
    } finally {
      personas.alex = original;
    }
  });

  it("accumulates seven unresolved minutes in the agreed example and preserves multiple cycles", () => {
    const { run, id, state } = journey();
    run({ type: "claim", issueId: id }, "robin", 60000);
    run({ type: "escalate", issueId: id }, "robin", 120000);
    run(
      { type: "resolve", issueId: id, summary: "First fix" },
      "robin",
      5 * 60000,
    );
    expect(elapsed(state().issues[0], start + 8 * 60000)).toBe(5 * 60000);
    run(
      { type: "reopen", issueId: id, reason: "  Still broken  " },
      "aurora",
      8 * 60000,
    );
    expect(state().issues[0]).toMatchObject({
      id,
      owner: "robin",
      createdAt: start,
      firstAssignedAt: start + 60000,
      status: "claimed",
    });
    expect(state().issues[0].escalation).toBeUndefined();
    expect(state().issues[0].summary).toBeUndefined();
    expect(state().issues[0].resolvedAt).toBeUndefined();
    expect(state().issues[0].resolutions[0]).toEqual({
      id: `${id}-resolution-1`,
      at: start + 5 * 60000,
      actor: "robin",
      summary: "First fix",
      reopened: {
        at: start + 8 * 60000,
        actor: "aurora",
        reason: "Still broken",
      },
    });
    run(
      { type: "message", issueId: id, text: "Retrying", visibility: "public" },
      "aurora",
      9 * 60000,
    );
    expect(() =>
      run(
        { type: "resolve", issueId: id, summary: "Not mine" },
        "maya",
        10 * 60000,
      ),
    ).toThrow();
    run(
      { type: "resolve", issueId: id, summary: "Second fix" },
      "robin",
      10 * 60000,
    );
    expect(elapsed(state().issues[0], start + 20 * 60000)).toBe(7 * 60000);
    run(
      { type: "reopen", issueId: id, reason: "Helper saw a failure" },
      "maya",
      20 * 60000,
    );
    run(
      { type: "resolve", issueId: id, summary: "Third fix" },
      "robin",
      21 * 60000,
    );
    expect(elapsed(state().issues[0], start + 30 * 60000)).toBe(8 * 60000);
    expect(assignmentDelay(state().issues[0])).toBe(60000);
    expect(
      state().issues[0].resolutions.map((record) => record.summary),
    ).toEqual(["First fix", "Second fix", "Third fix"]);
    expect(
      state().issues[0].history.filter((entry) =>
        entry.text.startsWith("Reopened:"),
      ),
    ).toHaveLength(2);
    expect(stateSchema.safeParse(state()).success).toBe(true);
  });

  it.each<Persona>(["sam", "maya", "robin"])(
    "allows %s to reopen another helper’s issue",
    (actor) => {
      const state = transition(
        seed(start),
        { type: "reopen", issueId: "ISS-003", reason: "Needs another look" },
        actor,
        start,
      );
      expect(state.issues[2].owner).toBe("sam");
      expect(state.issues[2].history.at(-1)).toMatchObject({
        actor,
        visibility: "public",
        at: start,
      });
    },
  );

  it("rejects forbidden, repeated, blank, oversized and backwards reopening without mutation", () => {
    const { run, id, state } = journey();
    run({ type: "claim", issueId: id }, "sam", 1);
    run({ type: "resolve", issueId: id, summary: "First fix" }, "sam", 2);
    const resolved = structuredClone(state());
    for (const reason of ["", "  ", "x".repeat(2001)]) {
      expect(() =>
        run({ type: "reopen", issueId: id, reason }, "aurora", 3),
      ).toThrow();
    }
    expect(() =>
      run({ type: "reopen", issueId: id, reason: "No" }, "alex", 3),
    ).toThrow();
    expect(() =>
      run({ type: "reopen", issueId: id, reason: "Too early" }, "aurora", 1),
    ).toThrow();
    expect(() =>
      run(
        { type: "reopen", issueId: "ISS-003", reason: "Other team" },
        "aurora",
        3,
      ),
    ).toThrow();
    expect(state()).toEqual(resolved);
    run({ type: "reopen", issueId: id, reason: "Try again" }, "aurora", 3);
    const reopened = structuredClone(state());
    expect(() =>
      run({ type: "reopen", issueId: id, reason: "Duplicate" }, "sam", 4),
    ).toThrow();
    expect(state()).toEqual(reopened);
  });

  it.each([false, true])(
    "preserves awards through reopening and re-resolution (already applied: %s)",
    (alreadyApplied) => {
      let state = transition(
        seed(start),
        {
          type: "award",
          issueId: "ISS-003",
          minutes: 5,
          explanation: "Lost time",
        },
        "alex",
        start,
      );
      if (alreadyApplied)
        state = transition(
          state,
          { type: "apply", issueId: "ISS-003" },
          "robin",
          start + 1,
        );
      const award = structuredClone(state.awards[0]);
      state = transition(
        state,
        { type: "reopen", issueId: "ISS-003", reason: "Again" },
        "maya",
        start + 2,
      );
      expect(state.awards[0]).toEqual(award);
      expect(stateSchema.safeParse(state).success).toBe(true);
      if (!alreadyApplied)
        state = transition(
          state,
          { type: "apply", issueId: "ISS-003" },
          "maya",
          start + 3,
        );
      state = transition(
        state,
        { type: "resolve", issueId: "ISS-003", summary: "Second fix" },
        "sam",
        start + 4,
      );
      expect(state.awards).toHaveLength(1);
      expect(state.awards[0].resolutionId).toBe("ISS-003-resolution-1");
      expect(stateSchema.safeParse(state).success).toBe(true);
      expect(() =>
        transition(
          state,
          {
            type: "award",
            issueId: "ISS-003",
            minutes: 1,
            explanation: "Duplicate",
          },
          "alex",
          start + 5,
        ),
      ).toThrow();
    },
  );
});
