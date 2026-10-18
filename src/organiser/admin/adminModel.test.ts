import { describe, expect, it } from "vitest";
import type { Issue, Membership, Snapshot } from "@/connected/model";
import {
  accountKind,
  actorName,
  auditActionText,
  createAccountCommand,
  draftOfMembership,
  imageLimitsInput,
  isCompleteMembership,
  isValidLimit,
  isValidUsername,
  limitsOfSession,
  membershipInput,
  resetPasswordCommand,
  setUsernameCommand,
  statusCounts,
  stepLimit,
  toggleRole,
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
  it("accepts the same usernames as the admin function", () => {
    expect(isValidUsername("team-aurora")).toBe(true);
    expect(isValidUsername("Alex_Morgan")).toBe(true);
    expect(isValidUsername(" abc ")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("-abc")).toBe(false);
    expect(isValidUsername("a".repeat(33))).toBe(false);
    expect(isValidUsername("team aurora")).toBe(false);
  });
});

describe("image limits", () => {
  const session = {
    max_image_bytes: 10 * 1048576,
    max_images_per_issue: 6,
    max_image_bytes_per_issue: 40 * 1048576,
  } as NonNullable<Snapshot["session"]>;

  it("converts bytes to megabytes", () => {
    expect(limitsOfSession(session)).toEqual({
      fileMb: 10,
      count: 6,
      totalMb: 40,
    });
  });

  it("keeps the bounds of the form from before T0015", () => {
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

describe("membership drafts", () => {
  it("starts a new account as staff with the default roles", () => {
    expect(draftOfMembership(undefined, ["volunteer"])).toEqual({
      kind: "staff",
      teamId: "",
      roles: ["volunteer"],
      isAdmin: false,
    });
  });

  it("reads an existing membership in form order", () => {
    expect(
      draftOfMembership(member({ roles: ["jury", "volunteer"], is_admin: true })),
    ).toEqual({
      kind: "staff",
      teamId: "",
      roles: ["volunteer", "jury"],
      isAdmin: true,
    });
    expect(draftOfMembership(member({ team_id: teamId }))).toMatchObject({
      kind: "team",
      teamId,
    });
  });

  it("needs a team for a team account", () => {
    const staff = draftOfMembership();
    expect(isCompleteMembership(staff)).toBe(true);
    expect(isCompleteMembership({ ...staff, kind: "team" })).toBe(false);
    expect(isCompleteMembership({ ...staff, kind: "team", teamId })).toBe(true);
  });

  it("toggles roles and keeps form order", () => {
    const draft = draftOfMembership(undefined, ["jury"]);
    const added = toggleRole(draft, "volunteer", true);
    expect(added.roles).toEqual(["volunteer", "jury"]);
    expect(toggleRole(added, "jury", false).roles).toEqual(["volunteer"]);
  });

  it("maps a staff draft to a membership", () => {
    expect(
      membershipInput({
        kind: "staff",
        teamId: "",
        roles: ["specialist"],
        isAdmin: true,
      }),
    ).toEqual({ teamId: null, roles: ["specialist"], isAdmin: true });
  });

  it("drops staff roles and admin rights from a team account", () => {
    expect(
      membershipInput({
        kind: "team",
        teamId,
        roles: ["volunteer"],
        isAdmin: true,
      }),
    ).toEqual({ teamId, roles: [], isAdmin: false });
    expect(
      membershipInput({
        kind: "staff",
        teamId,
        roles: ["jury"],
        isAdmin: false,
      }),
    ).toEqual({ teamId: null, roles: ["jury"], isAdmin: false });
  });
});

describe("account commands", () => {
  it("creates a staff account", () => {
    expect(
      createAccountCommand({
        name: " Alex Morgan ",
        username: " alex-morgan ",
        membership: {
          kind: "staff",
          teamId: "",
          roles: ["volunteer", "jury"],
          isAdmin: false,
        },
      }),
    ).toEqual({
      action: "create_account",
      username: "alex-morgan",
      name: "Alex Morgan",
      teamId: null,
      roles: ["volunteer", "jury"],
      isAdmin: false,
    });
  });

  it("creates a team account without staff roles", () => {
    expect(
      createAccountCommand({
        name: "Team Aurora",
        username: "team-aurora",
        membership: {
          kind: "team",
          teamId,
          roles: ["volunteer"],
          isAdmin: true,
        },
      }),
    ).toMatchObject({ teamId, roles: [], isAdmin: false });
  });

  it("sets a username and resets a password", () => {
    expect(setUsernameCommand(userId, " alex ")).toEqual({
      action: "set_username",
      userId,
      username: "alex",
    });
    expect(resetPasswordCommand(userId)).toEqual({
      action: "reset_password",
      userId,
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
    expect(auditActionText("reset_password")).toBe("reset password");
    const members = [
      { membership: member(), person: { id: userId, name: "Alex", username: null } },
    ];
    expect(actorName(members, userId)).toBe("Alex");
    expect(actorName(members, "someone")).toBe("someone");
  });
});
