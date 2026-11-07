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
 * Tests pick names that sort the other way round from the start times, so a
 * list that is still alphabetical fails them.
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
