import { describe, expect, it } from "vitest";
import type { ContestSummary } from "@/backend/contracts";
import { contestLabel } from "./ContestPicker";

const contest = (id: string, name: string, eventName: string): ContestSummary =>
  ({
    id, name, eventId: id, eventName, timeZone: "UTC", contestType: "teams", schedule: null,
    intake: { open: true, reason: "override_open", changesAt: null }, canOpen: true, manage: "none",
  });

describe("contestLabel", () => {
  it("names the event only when two listed contests share a name", () => {
    const finals = contest("1", "Finals", "Spring");
    const other = contest("2", "Finals", "Autumn");
    const practice = contest("3", "Practice", "Spring");
    const all = [finals, other, practice];
    expect(contestLabel(all, finals)).toBe("Finals · Spring");
    expect(contestLabel(all, other)).toBe("Finals · Autumn");
    expect(contestLabel(all, practice)).toBe("Practice");
  });
});
