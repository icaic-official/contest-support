import { randomUUID } from "node:crypto";
import type { LocalWorker } from "./localWorker";

const minutes = (n: number) =>
  `strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '${n >= 0 ? "+" : ""}${n} minutes')`;

export interface ContestNames {
  /** Starts in 2031, so its intake has not opened. */
  next: string;
  /** Started in 2020, so its intake has ended. */
  ended: string;
  /** Started 30 minutes ago, so its intake is open. */
  running: string;
}

/**
 * Gives the fixture event three contests and seats the contestant and the jury
 * member in all of them. The event is in Singapore, eight hours ahead of UTC.
 * The server lists contests by name. A test of the default contest picks names
 * that put the contest it expects after the first.
 */
export async function seatThreeContests(local: LocalWorker, names: ContestNames) {
  const ids = { next: local.sessions[0], ended: local.sessions[1], running: randomUUID() };
  await local.run("UPDATE events SET time_zone = 'Asia/Singapore' WHERE id = ?", local.event);
  await local.run(
    `UPDATE sessions SET name = ?, starts_at = '2031-03-04T13:00:00.000Z',
       ends_at = '2031-03-04T17:00:00.000Z', grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
    names.next,
    ids.next,
  );
  await local.run(
    `UPDATE sessions SET name = ?, starts_at = '2020-01-06T09:00:00.000Z',
       ends_at = '2020-01-06T11:00:00.000Z', grace_minutes = 0, intake_follows_schedule = 1 WHERE id = ?`,
    names.ended,
    ids.ended,
  );
  await local.run(
    `INSERT INTO sessions (id, event_id, name, intake_open, starts_at, ends_at, grace_minutes, intake_follows_schedule)
     VALUES (?, ?, ?, 1, ${minutes(-30)}, ${minutes(90)}, 0, 1)`,
    ids.running,
    local.event,
    names.running,
  );
  await local.seatContestantInSecondSession();
  await local.run(
    "INSERT INTO teams (id, session_id, name, location, entrant_id) VALUES (?, ?, 'Aurora', 'A12', ?)",
    randomUUID(),
    ids.running,
    local.teams[0],
  );
  await local.run("INSERT INTO memberships (session_id, account_id) VALUES (?, ?)", ids.running, local.users.jury);
  await local.run(
    "INSERT INTO membership_roles (session_id, account_id, role) VALUES (?, ?, 'volunteer')",
    ids.running,
    local.users.jury,
  );
  return ids;
}

/** Moves the running contest's window so that it ended `ago` minutes ago. */
export async function endRunningContest(local: LocalWorker, contestId: string, ago = 200) {
  await local.run(
    `UPDATE sessions SET starts_at = ${minutes(-ago - 100)}, ends_at = ${minutes(-ago)} WHERE id = ?`,
    contestId,
  );
}

/**
 * Gives every contestant of the contest `extra` confirmed minutes, as a
 * contest-wide award that the jury member granted and applied.
 */
export async function confirmExtraTime(local: LocalWorker, contestId: string, extra: number) {
  await local.run(
    `INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at, applied_at, applied_by, applied_name, applied_request)
     SELECT ?, ?, ?, ?, 'Power cut', id, name, ${minutes(0)}, ${minutes(0)}, id, name, ?
     FROM accounts WHERE id = ?`,
    randomUUID(),
    contestId,
    randomUUID(),
    extra,
    randomUUID(),
    local.users.jury,
  );
}

/**
 * Adds a contest that starts in 2032, after every contest that `seatThreeContests`
 * makes, and seats the contestant in it. It has not started, so its intake is
 * closed, and it ends later than any other contest.
 */
export async function addLaterContest(local: LocalWorker, name: string) {
  const id = randomUUID();
  await local.run(
    `INSERT INTO sessions (id, event_id, name, intake_open, starts_at, ends_at, grace_minutes, intake_follows_schedule)
     VALUES (?, ?, ?, 0, '2032-03-04T13:00:00.000Z', '2032-03-04T17:00:00.000Z', 0, 1)`,
    id,
    local.event,
    name,
  );
  await local.run(
    "INSERT INTO teams (id, session_id, name, location, entrant_id) VALUES (?, ?, 'Aurora', 'A12', ?)",
    randomUUID(),
    id,
    local.teams[0],
  );
  return id;
}
