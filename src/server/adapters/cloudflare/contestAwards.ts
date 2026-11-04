import { z } from 'zod';
import type { ContestAwardCommand } from '../../../backend/contracts';
import { can } from '../../../connected/capabilities';
import type { Caller } from '../../authentication';
import { AuthenticationError } from '../../authentication';
import type { D1Connection, D1Statement, D1Value } from '../d1/connection';
import { currentReadyLoginBindings, currentReadyLoginSql, notificationStatements } from './application';
import { type ContestAuthorityRow, contestDataBindings, contestDataSql, seatFromRow } from './authority';
import { announcementAssertion, sessionAudiences } from './announcements';

const uuid = z.uuid();
// SQLite length() stops at U+0000, so the length CHECK on stored text would fail with the wrong error.
const noNul = (value: string) => !value.includes('\u0000');
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('grant'), minutes: z.number().int().min(1).max(1440),
    explanation: z.string().trim().min(1).max(2000).refine(noNul),
  }),
  z.strictObject({ type: z.literal('apply'), awardId: uuid }),
]) satisfies z.ZodType<ContestAwardCommand>;

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * The capabilities `award` and `apply` in SQL, for the guard inside the batch.
 * `row` names a resolver row. Jury grant. Volunteers, specialists, and jury confirm.
 */
const roleSql = (row: string, roles: readonly string[]) => `(${row}.staff = 1 AND EXISTS (SELECT 1 FROM json_each(${row}.roles)
  WHERE value IN (${roles.map((role) => `'${role}'`).join(', ')})))`;
const guardSql = { grant: roleSql('c', ['jury']), apply: roleSql('c', ['jury', 'volunteer', 'specialist']) } as const;

interface AwardRow {
  id: string; session_id: string; minutes: number; explanation: string; actor: string;
  applied_at: string | null; applied_request: string | null; applied_by: string | null;
}

/**
 * A contest-wide time award gives minutes to every contestant of one contest.
 * The decision and the confirmation of its external application are separate
 * records. Minsky changes no external contest clock. Staff apply the minutes
 * outside Minsky, and only confirmed minutes extend a personal end time.
 * A repeated grant or confirmation never writes twice.
 */
export class D1ContestAwardService {
  constructor(private readonly db: D1Connection) {}

  private statement(sql: string, ...values: D1Value[]): D1Statement {
    return this.db.prepare(sql).bind(...values);
  }

  private award(id: string, sessionId: string): Promise<AwardRow | null> {
    return this.statement(`SELECT id, session_id, minutes, explanation, actor, applied_at, applied_request, applied_by
      FROM contest_awards WHERE id = ? AND session_id = ?`, id, sessionId).first<AwardRow>();
  }

  /** Resolves to the award ID. */
  async execute(caller: Caller, sessionId: string, requestId: string, input: unknown): Promise<string> {
    const parsed = commandSchema.safeParse(input);
    if (!uuid.safeParse(sessionId).success || !uuid.safeParse(requestId).success || !parsed.success) {
      throw new AuthenticationError(400, 'Check the minutes and the explanation.');
    }
    const command = parsed.data;
    const current = await this.statement(contestDataSql('caller'), ...contestDataBindings(caller, sessionId)).first<ContestAuthorityRow>();
    if (!current || !can(seatFromRow(current), command.type === 'grant' ? 'award' : 'apply')) {
      throw new AuthenticationError(403, command.type === 'grant'
        ? 'Only jury can grant a time award to the whole contest.'
        : 'Only support and jury can confirm that a time award was applied.');
    }
    if (current.archived) throw new AuthenticationError(409, 'This event is archived.');

    const guardId = crypto.randomUUID();
    const audiences = await sessionAudiences(this.db, sessionId);
    const audit = (action: string, detail: object) => this.statement(
      'INSERT INTO admin_audit (id, session_id, actor, action, target, detail) VALUES (?, ?, ?, ?, NULL, ?)',
      crypto.randomUUID(), sessionId, caller.accountId, action, JSON.stringify(detail));
    const guard = announcementAssertion(this.db, guardId,
      `SELECT 1 FROM (${contestDataSql('caller')}) c WHERE c.archived = 0 AND ${guardSql[command.type]}`,
      ...contestDataBindings(caller, sessionId));
    const finish = [
      announcementAssertion(this.db, `${guardId}:access`, currentReadyLoginSql, ...currentReadyLoginBindings(caller)),
      this.statement('DELETE FROM command_assertions WHERE id IN (?, ?, ?)', guardId, `${guardId}:state`, `${guardId}:access`),
    ];

    if (command.type === 'grant') {
      const prior = await this.statement(`SELECT id, session_id, minutes, explanation FROM contest_awards
        WHERE actor = ? AND request_id = ?`, caller.accountId, requestId)
        .first<Pick<AwardRow, 'id' | 'session_id' | 'minutes' | 'explanation'>>();
      const replay = (row: NonNullable<typeof prior>) => {
        if (row.session_id !== sessionId || row.minutes !== command.minutes || row.explanation !== command.explanation) {
          throw new AuthenticationError(409, 'This request was already used for another award. Refresh and try again.');
        }
        return row.id;
      };
      if (prior) return replay(prior);
      const id = crypto.randomUUID();
      try {
        await this.db.batch([
          guard,
          this.statement(`INSERT INTO contest_awards (id, session_id, request_id, minutes, explanation, actor, actor_name, at)
            SELECT ?, ?, ?, ?, ?, id, name, ${now} FROM accounts WHERE id = ?`,
          id, sessionId, requestId, command.minutes, command.explanation, caller.accountId),
          audit('contest_award', { award: id, minutes: command.minutes }),
          ...notificationStatements(this.db, sessionId, audiences),
          ...finish,
        ]);
      } catch (error) {
        // A concurrent copy of this request can commit first, and a lost response can hide a commit.
        const committed = await this.statement(`SELECT id, session_id, minutes, explanation FROM contest_awards
          WHERE actor = ? AND request_id = ?`, caller.accountId, requestId)
          .first<Pick<AwardRow, 'id' | 'session_id' | 'minutes' | 'explanation'>>();
        if (committed) return replay(committed);
        throw refusal(error);
      }
      return id;
    }

    const award = await this.award(command.awardId, sessionId);
    if (!award) throw new AuthenticationError(409, 'That award is not in this contest. Refresh the page.');
    const confirmedBy = (row: AwardRow) => {
      if (row.applied_request === requestId && row.applied_by === caller.accountId) return row.id;
      throw new AuthenticationError(409, 'Someone already confirmed that this award was applied.');
    };
    if (award.applied_at !== null) return confirmedBy(award);
    try {
      await this.db.batch([
        guard,
        this.statement(`UPDATE contest_awards SET applied_at = ${now}, applied_by = ?,
          applied_name = (SELECT name FROM accounts WHERE id = ?), applied_request = ?
          WHERE id = ? AND session_id = ? AND applied_at IS NULL`,
        caller.accountId, caller.accountId, requestId, award.id, sessionId),
        announcementAssertion(this.db, `${guardId}:state`, 'SELECT 1 WHERE changes() = 1'),
        audit('contest_award_applied', { award: award.id, minutes: award.minutes }),
        ...notificationStatements(this.db, sessionId, audiences),
        ...finish,
      ]);
    } catch (error) {
      const latest = await this.award(award.id, sessionId);
      if (latest?.applied_at) return confirmedBy(latest);
      throw refusal(error);
    }
    return award.id;
  }
}

/** A failed guard means access or the event changed. Anything else is an unknown outcome. */
function refusal(error: unknown): Error {
  return error instanceof Error && /(?:CHECK|UNIQUE|FOREIGN KEY|NOT NULL) constraint failed/.test(error.message)
    ? new AuthenticationError(409, 'Your access or the event changed. Refresh and try again.')
    : error instanceof Error ? error : new Error('The request could not be completed.');
}
