import { seed, stateSchema, type Persona, type State } from "./domain";
import { legacyStateSchema } from "./legacy-state";
export const STORAGE_KEY = "minsky.demo.v2";
export const LEGACY_STORAGE_KEY = "minsky.demo.v1";
const legacyPeople = {
  contestant: "aurora",
  volunteer: "sam",
  specialist: "maya",
  jury: "alex",
} satisfies Record<string, Persona>;

function migrateV1(value: unknown): State {
  const legacy = legacyStateSchema.parse(value);
  return stateSchema.parse({
    version: 2,
    issues: legacy.issues.map((issue) => ({
      ...issue,
      owner: issue.owner ? legacyPeople[issue.owner] : undefined,
      history: issue.history.map((entry) => ({
        ...entry,
        actor: legacyPeople[entry.actor],
      })),
      resolutions:
        issue.status === "resolved"
          ? [
              {
                id: `${issue.id}-resolution-1`,
                at: issue.resolvedAt,
                actor: issue.owner ? legacyPeople[issue.owner] : undefined,
                summary: issue.summary,
              },
            ]
          : [],
    })),
    awards: legacy.awards.map((award) => ({
      ...award,
      actor: legacyPeople[award.actor],
      appliedBy: award.appliedBy ? legacyPeople[award.appliedBy] : undefined,
      resolutionId: `${award.issueId}-resolution-1`,
    })),
  });
}
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
export function loadState(
  storage: StoragePort,
  now = Date.now(),
): { state: State; error?: string } {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) return { state: stateSchema.parse(JSON.parse(raw)) };
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    // The app persists successful loads to v2. Never remove or overwrite v1.
    return {
      state: legacy === null ? seed(now) : migrateV1(JSON.parse(legacy)),
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
