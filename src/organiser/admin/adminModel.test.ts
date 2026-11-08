import { describe, expect, it } from "vitest";
import type { Handle } from "@/backend/contracts";
import type { Issue, Membership, Snapshot } from "@/connected/model";
import {
  accountKind,
  actorName,
  auditEntryText,
  imageLimitsInput,
  isValidLimit,
  limitsOfSession,
  setHandleCommand,
  statusCounts,
  stepLimit,
  usernamePattern,
} from "./adminModel";

const sessionId = "00000000-0000-4000-8000-0000000000a1";
const userId = "00000000-0000-4000-8000-000000000001";
const teamId = "00000000-0000-4000-8000-0000000000b1";

function member(overrides: Partial<Membership> = {}): Membership {
  return {
    session_id: sessionId,
    user_id: userId,
    team_id: null,
    roles: [],
    is_admin: false,
    ...overrides,
  };
}

describe("usernames", () => {
  it("gives the form the same username rule as the admin function", () => {
    // A browser matches the pattern attribute against the whole value.
    const accepts = (value: string) => new RegExp(`^(?:${usernamePattern})$`, "u").test(value);
    expect(accepts("team-aurora")).toBe(true);
    expect(accepts("Alex_Morgan")).toBe(true);
    expect(accepts("ab")).toBe(false);
    expect(accepts("-abc")).toBe(false);
    expect(accepts("a".repeat(33))).toBe(false);
    expect(accepts("team aurora")).toBe(false);
  });
});

describe("image limits", () => {
  const session: NonNullable<Snapshot["session"]> = {
    id: "00000000-0000-4000-8000-000000000100",
    event_id: "00000000-0000-4000-8000-000000000010",
    name: "Fictional session",
    intake_open: true,
    categories: ["Backend"],
    revision: 0,
    max_image_bytes: 10 * 1048576,
    max_images_per_issue: 6,
    max_image_bytes_per_issue: 40 * 1048576,
  };

  it("converts bytes to megabytes", () => {
    expect(limitsOfSession(session)).toEqual({
      fileMb: 10,
      count: 6,
      totalMb: 40,
    });
  });

  it("keeps the account form bounds", () => {
    expect(isValidLimit("fileMb", 1)).toBe(true);
    expect(isValidLimit("fileMb", 50)).toBe(true);
    expect(isValidLimit("fileMb", 51)).toBe(false);
    expect(isValidLimit("count", 0)).toBe(false);
    expect(isValidLimit("count", 24)).toBe(true);
    expect(isValidLimit("count", 25)).toBe(false);
    expect(isValidLimit("totalMb", 120)).toBe(true);
    expect(isValidLimit("totalMb", 121)).toBe(false);
    expect(isValidLimit("totalMb", 2.5)).toBe(false);
    expect(isValidLimit("totalMb", Number.NaN)).toBe(false);
  });

  it("steps inside the bounds", () => {
    expect(stepLimit("count", 6, 1)).toBe(7);
    expect(stepLimit("count", 24, 1)).toBe(24);
    expect(stepLimit("count", 1, -1)).toBe(1);
    expect(stepLimit("fileMb", 80, -1)).toBe(50);
    expect(stepLimit("fileMb", Number.NaN, 1)).toBe(2);
  });

  it("maps the limits to the administration contract", () => {
    expect(imageLimitsInput({ fileMb: 5, count: 4, totalMb: 20 })).toEqual({
      fileMegabytes: 5,
      count: 4,
      totalMegabytes: 20,
    });
  });
});

describe("account commands", () => {
  it("changes a username", () => {
    expect(setHandleCommand("event", userId, "alex" as Handle)).toEqual({
      type: "set_handle",
      eventId: "event",
      accountId: userId,
      handle: "alex",
    });
  });
});

describe("display helpers", () => {
  const teams = [
    { id: teamId, name: "Team Aurora", location: "Hall A · Table 4" },
  ] as Snapshot["teams"];

  it("describes team and staff accounts", () => {
    expect(accountKind(member({ team_id: teamId }), teams)).toEqual({
      team: "Team Aurora",
      labels: [],
    });
    expect(
      accountKind(
        member({ team_id: "00000000-0000-4000-8000-0000000000b2" }),
        teams,
      ).team,
    ).toBe("Team contestant");
    expect(
      accountKind(member({ roles: ["jury", "volunteer"], is_admin: true }), teams),
    ).toEqual({ labels: ["Volunteer", "Jury", "Admin"] });
  });

  it("counts issues per status in status order", () => {
    const issues = [
      { status: "open" },
      { status: "open" },
      { status: "resolved" },
    ] as Issue[];
    expect(statusCounts(issues)).toEqual([
      { status: "open", label: "Open", count: 2 },
      { status: "claimed", label: "In progress", count: 0 },
      { status: "escalated", label: "Awaiting specialist", count: 0 },
      { status: "resolved", label: "Resolved", count: 1 },
    ]);
  });

  it("describes audit entries", () => {
    const members = [
      { membership: member(), person: { id: userId, name: "Alex", username: null } },
    ];
    expect(actorName(members, { action: "set_intake", actor: userId })).toBe("Alex");
    expect(actorName(members, { action: "set_intake", actor: "someone" })).toBe("An organizer");
  });

  it("describes a webmaster's join without the webmaster's account ID", () => {
    const webmaster = "00000000-0000-4000-8000-0000000000d1";
    const join = { action: "webmaster_join", actor: webmaster, target: webmaster };
    expect(auditEntryText([], join)).toBe("joined to read this contest");
    expect(actorName([], join)).toBe("A webmaster");
    const members = [
      { membership: member(), person: { id: webmaster, name: "Alex", username: null } },
    ];
    expect(actorName(members, join)).toBe("Alex");
  });

  it("names the person that an audit entry changed", () => {
    const members = [
      { membership: member(), person: { id: userId, name: "Alex", username: null } },
    ];
    expect(auditEntryText(members, { action: "reset_password", target: userId })).toBe(
      "reset password for Alex",
    );
  });

  it("shows no name when the person left the session or the action has no target", () => {
    const members = [
      { membership: member(), person: { id: userId, name: "Alex", username: null } },
    ];
    const gone = "00000000-0000-4000-8000-0000000000c9";
    expect(auditEntryText(members, { action: "revoke_membership", target: gone })).toBe(
      "revoke membership",
    );
    expect(auditEntryText([], { action: "set_intake", target: null })).toBe("set intake");
  });
});
