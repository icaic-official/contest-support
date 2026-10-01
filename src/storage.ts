import { seed, stateSchema, type State } from "./domain";
export const STORAGE_KEY = "minsky.demo.v1";
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
export function loadState(
  storage: StoragePort,
  now = Date.now(),
): { state: State; error?: string } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return {
      state: raw === null ? seed(now) : stateSchema.parse(JSON.parse(raw)),
    };
  } catch {
    return {
      state: seed(now),
      error:
        "Saved demo data is unavailable or incompatible. Reset the demo to continue; this replaces the saved demo data.",
    };
  }
}
export function saveState(
  storage: StoragePort,
  state: State,
): string | undefined {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    return "Browser storage is unavailable or full. Changes are only in memory and may be lost on refresh.";
  }
}
