import legacyData from "../tests/fixtures/v1.json";
import { expect, it } from "vitest";
import { elapsed, seed, transition } from "./domain";
import { legacyStateSchema } from "./legacy-state";
import {
  loadState,
  saveState,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  type StoragePort,
} from "./storage";
// Captured from the T0001 seed and transitions, before the v2 implementation.
const legacyFixture = legacyStateSchema.parse(legacyData);

function memory(raw: string | null = null): StoragePort {
  const data = new Map<string, string>(
    raw === null ? [] : [[STORAGE_KEY, raw]],
  );
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}
it("seeds a new browser and preserves submission and assignment times through refresh", () => {
  const storage = memory();
  const { state } = loadState(storage, 1000000);
  const claimed = transition(
    state,
    { type: "claim", issueId: "ISS-001" },
    "sam",
    1010000,
  );
  expect(saveState(storage, claimed)).toBeUndefined();
  const restored = loadState(storage, 2000000);
  expect(restored.state).toEqual(claimed);
  expect(elapsed(restored.state.issues[0], 2000000)).toBe(1360000);
  expect(restored.state.issues[0].firstAssignedAt).toBe(1010000);
});
it("preserves resolution, award and separate application timestamps", () => {
  const storage = memory();
  let state = transition(
    seed(1000000),
    {
      type: "award",
      issueId: "ISS-003",
      minutes: 3,
      explanation: "Fair adjustment",
    },
    "alex",
    1000000,
  );
  saveState(storage, state);
  expect(loadState(storage).state.awards[0].appliedAt).toBeUndefined();
  state = transition(
    state,
    { type: "apply", issueId: "ISS-003" },
    "maya",
    1001000,
  );
  saveState(storage, state);
  expect(loadState(storage).state).toEqual(state);
});
it.each([
  "{",
  '{"version":99,"issues":[],"awards":[]}',
  '{"version":1,"issues":[{}],"awards":[]}',
])("flags corrupt or incompatible data without overwriting it", (raw) => {
  const storage = memory(raw);
  expect(loadState(storage).error).toContain("Reset");
  expect(storage.getItem(STORAGE_KEY)).toBe(raw);
});
it("reports inaccessible storage and failed writes", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  };
  expect(loadState(storage).error).toBeDefined();
  expect(saveState(storage, seed())).toContain("only in memory");
});
it("rejects structurally valid data with broken roster or lifecycle references", () => {
  const state = seed(1000000);
  state.issues[0].teamId = "missing-team";
  expect(loadState(memory(JSON.stringify(state))).error).toBeDefined();
  const invalidHandoff = seed(1000000);
  invalidHandoff.issues[1].owner = "alex";
  expect(loadState(memory(JSON.stringify(invalidHandoff))).error).toBeDefined();
});
it("reset replaces local progress with the seed scenario", () => {
  const storage = memory();
  saveState(
    storage,
    transition(
      seed(1000000),
      { type: "submit", category: "Other", description: "New" },
      "aurora",
      1000000,
    ),
  );
  saveState(storage, seed(2000000));
  expect(loadState(storage).state).toEqual(seed(2000000));
});

it.each([false, true])(
  "migrates validated v1 handoffs, messages and awards (applied: %s), preserving the source",
  (applied) => {
    const legacy = structuredClone(legacyFixture);
    if (!applied) {
      delete legacy.awards[0].appliedAt;
      delete legacy.awards[0].appliedBy;
    }
    const storage = memory();
    const raw = JSON.stringify(legacy);
    storage.setItem(LEGACY_STORAGE_KEY, raw);
    const result = loadState(storage, 2000000);
    expect(result.error).toBeUndefined();
    expect(result.state.version).toBe(2);
    expect(result.state.issues[1]).toMatchObject({
      id: "ISS-002",
      owner: "sam",
      status: "escalated",
      escalation: "specialist",
      createdAt: 760000,
      firstAssignedAt: 820000,
    });
    expect(result.state.issues[1].history.slice(-2)).toMatchObject([
      {
        actor: "sam",
        text: "Internal note: Private diagnostic",
        visibility: "internal",
      },
      {
        actor: "maya",
        text: "Public reply: Investigating",
        visibility: "public",
      },
    ]);
    expect(result.state.issues[2].resolutions).toEqual([
      {
        id: "ISS-003-resolution-1",
        at: 400000,
        actor: "sam",
        summary: legacy.issues[2].summary,
      },
    ]);
    expect(result.state.awards[0]).toMatchObject({
      actor: "alex",
      at: 1000002,
      minutes: 3,
      resolutionId: "ISS-003-resolution-1",
    });
    expect(result.state.awards[0].appliedBy).toBe(applied ? "maya" : undefined);
    expect(result.state.awards[0].appliedAt).toBe(
      applied ? 1000003 : undefined,
    );
    const reopened = transition(
      result.state,
      { type: "reopen", issueId: "ISS-003", reason: "Check again" },
      "robin",
      2000000,
    );
    saveState(storage, reopened);
    expect(loadState(storage).state).toEqual(reopened);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
    // Reset must shadow legacy progress even when the v1 source remains.
    saveState(storage, seed(3000000));
    expect(loadState(storage).state).toEqual(seed(3000000));
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
  },
);

it("prefers v2 and never falls back from invalid v2 to valid legacy progress", () => {
  const storage = memory();
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacyFixture));
  storage.setItem(STORAGE_KEY, '{"version":99}');
  expect(loadState(storage).error).toBeDefined();
  expect(storage.getItem(STORAGE_KEY)).toBe('{"version":99}');
  saveState(storage, seed(3000000));
  expect(loadState(storage).state).toEqual(seed(3000000));
});

it.each(["{", '{"version":99}', '{"version":1,"issues":[{}],"awards":[]}'])(
  "preserves invalid legacy data and requires reset: %s",
  (raw) => {
    const storage = memory();
    storage.setItem(LEGACY_STORAGE_KEY, raw);
    expect(loadState(storage).error).toBeDefined();
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  },
);

it("rejects inconsistent v1 before migration", () => {
  const legacy = structuredClone(legacyFixture);
  legacy.issues[1].owner = "specialist";
  const storage = memory();
  storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
  expect(loadState(storage).error).toBeDefined();
  expect(storage.getItem(STORAGE_KEY)).toBeNull();
});

it("preserves cycles and unresolved time through refresh", () => {
  let state = seed(1000000);
  state = transition(
    state,
    { type: "reopen", issueId: "ISS-003", reason: "First retry" },
    "maya",
    1000000,
  );
  state = transition(
    state,
    { type: "resolve", issueId: "ISS-003", summary: "Second fix" },
    "sam",
    1100000,
  );
  state = transition(
    state,
    { type: "reopen", issueId: "ISS-003", reason: "Second retry" },
    "robin",
    1200000,
  );
  const storage = memory();
  saveState(storage, state);
  const restored = loadState(storage).state;
  expect(restored).toEqual(state);
  expect(elapsed(restored.issues[2], 1300000)).toBe(500000);
});

it("reports a failed migration write and preserves the legacy source", () => {
  const raw = JSON.stringify(legacyFixture);
  const storage: StoragePort = {
    getItem: (key) => (key === LEGACY_STORAGE_KEY ? raw : null),
    setItem: () => {
      throw new Error("quota");
    },
  };
  const result = loadState(storage);
  expect(result.error).toBeUndefined();
  expect(saveState(storage, result.state)).toContain("only in memory");
  expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
});

it.each(["actor", "time", "summary", "reopen", "award"])(
  "rejects inconsistent v2 lifecycle data: %s",
  (fault) => {
    const state = loadState({
      getItem: (key) =>
        key === LEGACY_STORAGE_KEY ? JSON.stringify(legacyFixture) : null,
      setItem: () => {},
    }).state;
    const issue = state.issues[2];
    switch (fault) {
      case "actor":
        issue.resolutions[0].actor = "alex";
        break;
      case "time":
        issue.resolutions[0].at = 0;
        break;
      case "summary":
        issue.resolutions[0].summary = "Wrong summary";
        break;
      case "reopen":
        issue.resolutions[0].reopened = {
          at: 0,
          actor: "aurora",
          reason: "Cross-team, backwards",
        };
        break;
      case "award":
        state.awards[0].resolutionId = "missing";
        break;
    }
    expect(loadState(memory(JSON.stringify(state))).error).toBeDefined();
  },
);

it("reloads a zero-minute decision without confusing it with an absent award", () => {
  const storage = memory();
  const state = transition(
    seed(1000000),
    {
      type: "award",
      issueId: "ISS-003",
      minutes: 0,
      explanation: "No extra time needed",
    },
    "alex",
    1000000,
  );
  saveState(storage, state);
  expect(loadState(storage).error).toBeUndefined();
  expect(loadState(storage).state).toEqual(state);
  const invalid = structuredClone(state);
  invalid.awards[0].minutes = -1;
  saveState(storage, invalid);
  expect(loadState(storage).error).toBeDefined();
});
