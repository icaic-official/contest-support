import { expect, it } from "vitest";
import { elapsed, seed, transition } from "./domain";
import { loadState, saveState, STORAGE_KEY, type StoragePort } from "./storage";
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
    "volunteer",
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
    "jury",
    1000000,
  );
  saveState(storage, state);
  expect(loadState(storage).state.awards[0].appliedAt).toBeUndefined();
  state = transition(
    state,
    { type: "apply", issueId: "ISS-003" },
    "specialist",
    1001000,
  );
  saveState(storage, state);
  expect(loadState(storage).state).toEqual(state);
});
it.each([
  "{",
  '{"version":2,"issues":[],"awards":[]}',
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
  invalidHandoff.issues[1].owner = "specialist";
  expect(loadState(memory(JSON.stringify(invalidHandoff))).error).toBeDefined();
});
it("reset replaces local progress with the seed scenario", () => {
  const storage = memory();
  saveState(
    storage,
    transition(
      seed(1000000),
      { type: "submit", category: "Other", description: "New" },
      "contestant",
      1000000,
    ),
  );
  saveState(storage, seed(2000000));
  expect(loadState(storage).state).toEqual(seed(2000000));
});
