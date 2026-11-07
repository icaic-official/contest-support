import { describe, expect, it } from "vitest";
import type { ContestSummary, IntakeReason } from "@/backend/contracts";
import { keepUnchanged } from "./keepUnchanged";
import {
  type ContestRow,
  contestLabel,
  contestRows,
  defaultContest,
  orderContests,
  rowDetail,
  rowText,
} from "./contestList";

const hour = 3_600_000;
const base = Date.parse("2026-11-03T13:00:00.000Z");
const at = (hours: number) => new Date(base + hours * hour).toISOString();

const OPEN: ReadonlySet<IntakeReason> = new Set(["running", "grace", "override_open"]);

function contest(
  id: string,
  options: {
    name?: string;
    eventName?: string;
    timeZone?: string;
    /** Hours from the base time for the start and the end, or none. */
    hours?: [start: number, end: number];
    reason?: IntakeReason;
  } = {},
): ContestSummary {
  const reason = options.reason ?? "before_start";
  return {
    id,
    name: options.name ?? id,
    eventId: "event",
    eventName: options.eventName ?? "Spring",
    timeZone: options.timeZone ?? "UTC",
    contestType: "teams",
    schedule: options.hours
      ? { startsAt: at(options.hours[0]), endsAt: at(options.hours[1]), graceMinutes: 0 }
      : null,
    intake: { open: OPEN.has(reason), reason, changesAt: null },
    canOpen: true,
    manage: "none",
  };
}

const ids = (list: readonly ContestSummary[]) => list.map((item) => item.id);

describe("contestLabel", () => {
  it("names the event only when two listed contests share a name", () => {
    const finals = contest("1", { name: "Finals", eventName: "Spring" });
    const other = contest("2", { name: "Finals", eventName: "Autumn" });
    const practice = contest("3", { name: "Practice", eventName: "Spring" });
    const all = [finals, other, practice];
    expect(contestLabel(all, finals)).toBe("Finals · Spring");
    expect(contestLabel(all, other)).toBe("Finals · Autumn");
    expect(contestLabel(all, practice)).toBe("Practice");
  });
});

describe("orderContests", () => {
  it("sorts by start time, whatever the names and the input order", () => {
    const late = contest("a", { name: "Aardvark", hours: [48, 52] });
    const early = contest("b", { name: "Zebra", hours: [0, 4] });
    const middle = contest("c", { name: "Mole", hours: [24, 28] });
    expect(ids(orderContests([late, early, middle]))).toEqual(["b", "c", "a"]);
  });

  it("breaks a tie in the start time by ID", () => {
    const second = contest("2", { hours: [0, 4] });
    const first = contest("1", { hours: [0, 6] });
    expect(ids(orderContests([second, first]))).toEqual(["1", "2"]);
  });

  it("compares instants, not text, when two zones format the start differently", () => {
    const earlier = contest("a", { hours: [0, 4], timeZone: "Asia/Singapore" });
    const later = contest("b", { hours: [1, 5], timeZone: "America/New_York" });
    expect(ids(orderContests([later, earlier]))).toEqual(["a", "b"]);
  });

  it("puts a contest with no schedule after every scheduled one, by name and then ID", () => {
    const scheduled = contest("s", { name: "Scheduled", hours: [100, 104] });
    const beta = contest("2", { name: "Beta" });
    const alpha = contest("3", { name: "Alpha" });
    const alsoBeta = contest("1", { name: "Beta" });
    expect(ids(orderContests([beta, alpha, scheduled, alsoBeta]))).toEqual(["s", "3", "1", "2"]);
  });

  it("lets a refresh with the same contests keep the list that is on screen", () => {
    const shown = orderContests([contest("a", { hours: [0, 4] }), contest("b", { hours: [5, 9] })]);
    const read = JSON.parse(JSON.stringify([...shown].reverse())) as ContestSummary[];
    expect(keepUnchanged(shown, orderContests(read))).toBe(shown);
  });

  it("returns a new list and leaves the input as it was", () => {
    const input = [contest("b", { hours: [5, 6] }), contest("a", { hours: [1, 2] })];
    const copy = [...input];
    const ordered = orderContests(input);
    expect(ordered).not.toBe(input);
    expect(input).toEqual(copy);
  });
});

describe("defaultContest", () => {
  it("is undefined for an empty list", () => {
    expect(defaultContest([], base)).toBeUndefined();
  });

  it("prefers the first contest that takes reports now", () => {
    const list = orderContests([
      contest("past", { hours: [-30, -26], reason: "ended" }),
      contest("now", { hours: [-1, 3], reason: "running" }),
      contest("next", { hours: [24, 28] }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("now");
  });

  it.each<IntakeReason>(["running", "grace", "override_open"])(
    "opens a contest with the reason %s before a later one that has not started",
    (reason) => {
      const list = orderContests([
        contest("next", { hours: [24, 28] }),
        contest("now", { hours: [30, 34], reason }),
      ]);
      expect(defaultContest(list, base)?.id).toBe("now");
    },
  );

  it.each<[IntakeReason, IntakeReason]>([
    ["override_open", "running"],
    ["grace", "running"],
    ["override_open", "grace"],
  ])("opens the later contest when the earlier one has the reason %s and the later one has %s", (first, second) => {
    const list = orderContests([
      contest("first", { hours: [-5, -4], reason: first }),
      contest("second", { hours: [-1, 3], reason: second }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("second");
  });

  it("opens the earlier of two contests with the same open reason", () => {
    const list = orderContests([
      contest("later", { hours: [-1, 3], reason: "running" }),
      contest("earlier", { hours: [-2, 3], reason: "running" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("earlier");
  });

  it("opens a contest from last month that staff hold open when nothing runs", () => {
    const list = orderContests([
      contest("held-open", { hours: [-720, -716], reason: "override_open" }),
      contest("next", { hours: [24, 28] }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("held-open");
  });

  it("opens the next scheduled contest when none takes reports", () => {
    const list = orderContests([
      contest("past", { hours: [-30, -26], reason: "ended" }),
      contest("next", { hours: [24, 28] }),
      contest("later", { hours: [48, 52] }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("next");
  });

  it.each<IntakeReason>(["override_closed", "awaiting_live_passwords"])(
    "keeps a contest with the reason %s while its window lasts",
    (reason) => {
      const list = orderContests([
        contest("past", { hours: [-30, -26], reason: "ended" }),
        contest("held", { hours: [-1, 3], reason }),
        contest("next", { hours: [24, 28] }),
      ]);
      expect(defaultContest(list, base)?.id).toBe("held");
    },
  );

  it.each<IntakeReason>(["override_closed", "awaiting_live_passwords"])(
    "skips a contest with the reason %s after its window for a future one",
    (reason) => {
      const list = orderContests([
        contest("past", { hours: [-720, -716], reason }),
        contest("next", { hours: [24, 28] }),
      ]);
      expect(defaultContest(list, base)?.id).toBe("next");
    },
  );

  it("treats a window that ends exactly now as past", () => {
    const list = orderContests([
      contest("past", { hours: [-1, 0], reason: "override_closed" }),
      contest("next", { hours: [24, 28] }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("next");
  });

  it("uses the clock it is given, and no clock of its own", () => {
    const list = orderContests([
      contest("first", { hours: [-1, 3], reason: "override_closed" }),
      contest("second", { hours: [24, 28], reason: "override_closed" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("first");
    expect(defaultContest(list, base + 4 * hour)?.id).toBe("second");
  });

  it("opens the contest that ended last when every scheduled contest has ended", () => {
    const list = orderContests([
      contest("long", { hours: [-100, -10], reason: "ended" }),
      contest("short", { hours: [-50, -20], reason: "ended" }),
      contest("first", { hours: [-120, -90], reason: "ended" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("long");
  });

  it("opens the contest that ended last when past contests are held closed or wait for passwords", () => {
    const list = orderContests([
      contest("held", { hours: [-720, -716], reason: "override_closed" }),
      contest("waiting", { hours: [-30, -26], reason: "awaiting_live_passwords" }),
      contest("ended", { hours: [-100, -96], reason: "ended" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("waiting");
  });

  it("opens the scheduled contest that ended last, not an unscheduled one, when nothing is left to wait for", () => {
    const list = orderContests([
      contest("past", { hours: [-30, -26], reason: "ended" }),
      contest("bare", { name: "Bare", reason: "override_closed" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("past");
  });

  it("falls back to the first listed contest when none has a schedule or an open intake", () => {
    const list = orderContests([
      contest("b", { name: "Beta", reason: "override_closed" }),
      contest("a", { name: "Alpha", reason: "override_closed" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("a");
  });

  it("opens an unscheduled contest that staff opened before a scheduled one that has not started", () => {
    const list = orderContests([
      contest("next", { hours: [24, 28] }),
      contest("held-open", { name: "Held open", reason: "override_open" }),
    ]);
    expect(defaultContest(list, base)?.id).toBe("held-open");
  });
});

describe("contestRows", () => {
  const notes: Array<[IntakeReason, string | null]> = [
    ["before_start", null],
    ["running", "Running now"],
    ["grace", "Intake open (grace period)"],
    ["override_open", "Intake open (set by staff)"],
    ["override_closed", "Intake closed (set by staff)"],
    ["awaiting_live_passwords", "Waiting for live passwords"],
    ["ended", "Ended"],
  ];

  it.each(notes)("marks the intake reason %s with %j", (reason, marker) => {
    const [row] = contestRows([contest("a", { hours: [0, 4], reason })]);
    expect(row?.marker).toBe(marker);
  });

  it("shows the start in the event's zone and no time for an unscheduled contest", () => {
    const rows = contestRows([
      contest("a", { hours: [0, 4], timeZone: "Asia/Singapore" }),
      contest("b", { name: "No schedule", timeZone: "Asia/Singapore" }),
    ]);
    expect(rows[0]?.start).toContain("21:00");
    expect(rows[1]?.start).toBeNull();
  });

  it("adds a zone label only when the listed contests span more than one zone", () => {
    const same = contestRows([
      contest("a", { hours: [0, 4], timeZone: "Asia/Singapore" }),
      contest("b", { hours: [5, 9], timeZone: "Asia/Singapore" }),
    ]);
    expect(same[0]?.start).not.toContain("GMT");
    const mixed = contestRows([
      contest("a", { hours: [0, 4], timeZone: "Asia/Singapore" }),
      contest("b", { hours: [5, 9], timeZone: "UTC" }),
    ]);
    expect(mixed[0]?.start).toContain("GMT+8");
    expect(mixed[0]?.start).toContain("21:00");
  });

  it("adds the year only when the listed contests start in more than one calendar year", () => {
    const same = contestRows([contest("a", { hours: [0, 4] }), contest("b", { hours: [24, 28] })]);
    expect(same[0]?.start).not.toContain("2026");
    const yearLater = 365 * 24;
    const mixed = contestRows([contest("a", { hours: [0, 4] }), contest("b", { hours: [yearLater, yearLater + 4] })]);
    expect(mixed[0]?.start).toContain("2026");
    expect(mixed[1]?.start).toContain("2027");
  });

  it("compares the years in the event's zone, and ignores a contest with no schedule", () => {
    // 2026-12-31T20:00Z is already 2027 in Singapore, and so is the second start.
    const newYearsEve = (58 * 24) + 7;
    const rows = contestRows([
      contest("a", { hours: [newYearsEve, newYearsEve + 4], timeZone: "Asia/Singapore" }),
      contest("b", { hours: [newYearsEve + 36, newYearsEve + 40], timeZone: "Asia/Singapore" }),
      contest("c", { name: "No schedule", timeZone: "Asia/Singapore" }),
    ]);
    expect(rows[0]?.start).toContain("04:00");
    expect(rows[0]?.start).not.toContain("2027");
    expect(rows[1]?.start).not.toContain("2027");
  });

  it("marks a row open exactly when the intake takes reports", () => {
    const rows = contestRows(notes.map(([reason], index) => contest(String(index), { reason })));
    expect(rows.map((row) => row.open)).toEqual(notes.map(([reason]) => OPEN.has(reason)));
  });

  it("keeps the order of its input", () => {
    const rows = contestRows([contest("b"), contest("a")]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

const row = (start: string | null, marker: string | null): ContestRow =>
  ({ id: "1", name: "Live 1", start, marker, open: false });

describe("rowDetail", () => {
  it("joins the start and the note, and is null when a row has neither", () => {
    expect(rowDetail(row("Tue 3 Nov, 13:00", "Running now"))).toBe("Tue 3 Nov, 13:00 · Running now");
    expect(rowDetail(row("Tue 3 Nov, 13:00", null))).toBe("Tue 3 Nov, 13:00");
    expect(rowDetail(row(null, "Ended"))).toBe("Ended");
    expect(rowDetail(row(null, null))).toBeNull();
  });
});

describe("rowText", () => {
  it("puts the name first and skips what a row lacks", () => {
    expect(rowText(row("Tue 3 Nov, 13:00", "Running now"))).toBe("Live 1 · Tue 3 Nov, 13:00 · Running now");
    expect(rowText(row("Tue 3 Nov, 13:00", null))).toBe("Live 1 · Tue 3 Nov, 13:00");
    expect(rowText(row(null, "Ended"))).toBe("Live 1 · Ended");
    expect(rowText(row(null, null))).toBe("Live 1");
  });
});
