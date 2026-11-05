import {
  type ContestType,
  type EntrantInput,
  type EntrantKind,
  type EventConsole,
  ISSUE_BATCH,
  type PersonInput,
  parseHandle,
  type Schedule,
} from "@/backend/contracts";
import { hasControlCharacter, rosterKey, rosterTextMax, teamsPerCommandMax } from "@/connected/roster";

/** One pasted line, "name, handle", and what is wrong with it. */
export interface PersonLine {
  /** The line number in the box, counting blank lines. */
  line: number;
  name: string;
  handle: string;
  problem: string | undefined;
}

export interface LineRules {
  /** An entrant's name is unique inside the event. A person's name is not. */
  uniqueNames: boolean;
  takenNames: readonly string[];
  takenHandles: readonly string[];
}

/**
 * Reads pasted lines of "name, handle". The handle follows the last comma or
 * tab, so a name may hold commas. A line is a problem when a part is missing,
 * the handle cannot be one, or a name or handle repeats an earlier line or one
 * that the event already holds. Blank lines are skipped.
 */
export function parsePersonLines(text: string, rules: LineRules): PersonLine[] {
  const names = new Map<string, number>(rules.takenNames.map((name) => [rosterKey(name), 0]));
  const handles = new Map<string, number>(rules.takenHandles.map((handle) => [handle.toLowerCase(), 0]));
  const lines: PersonLine[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const cut = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("\t"));
    const name = (cut >= 0 ? raw.slice(0, cut) : raw).trim();
    const typed = (cut >= 0 ? raw.slice(cut + 1) : "").trim();
    const handle = parseHandle(typed);
    const nameKey = rosterKey(name);
    let problem: string | undefined;
    if (!name) problem = "Write a name first.";
    else if (!typed) problem = "Add a comma and a username after the name.";
    else if (name.length > rosterTextMax || hasControlCharacter(name)) problem = `Use a name of at most ${rosterTextMax} characters, with no control characters.`;
    else if (!handle) problem = "Use 3 to 32 letters, digits, hyphens, or underscores for the username.";
    else if (handles.has(handle)) problem = handles.get(handle) ? `Same username as line ${handles.get(handle)}.` : "That username is already in the event.";
    else if (rules.uniqueNames && names.has(nameKey)) problem = names.get(nameKey) ? `Same name as line ${names.get(nameKey)}.` : "That name is already in the event.";
    if (!problem && handle) {
      handles.set(handle, index + 1);
      names.set(nameKey, index + 1);
    }
    lines.push({ line: index + 1, name, handle: handle ?? typed, problem });
  });
  return lines;
}

/** Why the lines cannot be sent, or undefined when they can. */
export function linesError(lines: readonly PersonLine[]): string | undefined {
  if (lines.length === 0) return "Write at least one line.";
  if (lines.length > teamsPerCommandMax) return `Use at most ${teamsPerCommandMax} lines at a time.`;
  return lines.some((line) => line.problem) ? "Fix or remove the lines with a problem." : undefined;
}

export function personInputs(lines: readonly PersonLine[]): PersonInput[] {
  return lines.map(({ name, handle }) => ({ name, handle }));
}

export function entrantInputs(lines: readonly PersonLine[], kind: EntrantKind): EntrantInput[] {
  return lines.map(({ name, handle }) => ({ kind, name, handle }));
}

/** Which entrant kinds a contest type takes. */
export function acceptsKind(type: ContestType, kind: EntrantKind): boolean {
  return type === "mixed" || (type === "teams" ? kind === "team" : kind === "single");
}

export const contestTypeLabels: Record<ContestType, string> = {
  singles: "Single contestants",
  teams: "Teams",
  mixed: "Teams and single contestants",
};

/** The IDs of the entrants that a contest already seats. */
export function seatedEntrants(console: EventConsole, contestId: string): Set<string> {
  return new Set(console.entries.filter((entry) => entry.contestId === contestId).map((entry) => entry.entrantId));
}

/** Splits account IDs into the batches that one credential request takes. */
export function issueBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let at = 0; at < ids.length; at += ISSUE_BATCH) batches.push(ids.slice(at, at + ISSUE_BATCH));
  return batches;
}

type ConsoleContest = EventConsole["contests"][number];

function windowOf({ startsAt, endsAt, graceMinutes }: Schedule): { start: number; end: number } {
  return { start: Date.parse(startsAt), end: Date.parse(endsAt) + graceMinutes * 60_000 };
}

/**
 * The other live contests that a live password for `contest` also opens, for the
 * organizer's preview. `forContestsSql` decides on the server, per account. This
 * applies the same window rule to the contests that share an entrant.
 */
export function alsoOpens(console: EventConsole, contest: ConsoleContest): ConsoleContest[] {
  if (!contest.schedule) return [];
  const target = windowOf(contest.schedule);
  const seated = seatedEntrants(console, contest.id);
  return console.contests.filter((other) => {
    if (other.id === contest.id || other.kind !== "live" || !other.schedule) return false;
    const { start, end } = windowOf(other.schedule);
    return start < target.end && target.start < end
      && console.entries.some((entry) => entry.contestId === other.id && seated.has(entry.entrantId));
  });
}

/**
 * The contest to name when an organizer resets one entrant's password: an open
 * contest of that entrant, live first, then the entrant's next live contest. The
 * server refuses a reset that would sign the contestant out of an open contest that
 * the request does not name.
 */
export function recoveryContest(console: EventConsole, entrantId: string): string | null {
  const open = console.contests.filter((contest) => contest.intake.open
    && console.entries.some((entry) => entry.contestId === contest.id && entry.entrantId === entrantId));
  const next = console.contests
    .filter((contest) => contest.kind === "live" && notEnded(contest) && isEntered(console, contest.id, entrantId))
    .sort((a, b) => Date.parse(a.schedule?.startsAt ?? "") - Date.parse(b.schedule?.startsAt ?? ""))[0];
  return (open.find((contest) => contest.kind === "live") ?? next ?? open[0])?.id ?? null;
}

function notEnded(contest: ConsoleContest): boolean {
  return !!contest.schedule && Date.now() < windowOf(contest.schedule).end;
}

function isEntered(console: EventConsole, contestId: string, entrantId: string): boolean {
  return console.entries.some((entry) => entry.contestId === contestId && entry.entrantId === entrantId);
}

/**
 * The live contests, not yet ended, where these accounts hold a password that an
 * issue for `target` would stop. `voidedScopesSql` decides on the server.
 */
export function voidedBy(console: EventConsole, target: ConsoleContest | undefined, accountIds: readonly string[]): ConsoleContest[] {
  const kept = new Set(target ? [target.id, ...alsoOpens(console, target).map((other) => other.id)] : []);
  const entrants = console.entrants.filter((entrant) => entrant.accountId && accountIds.includes(entrant.accountId));
  return console.contests.filter((contest) => contest.kind === "live" && !kept.has(contest.id) && notEnded(contest)
    && entrants.some((entrant) => isEntered(console, contest.id, entrant.id)
      && !contest.waiting.some((seat) => seat.accountId === entrant.accountId)));
}
