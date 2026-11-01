const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Every use checks both identity-session and application-login expiry against
// database time, including inside write batches.
const liveLoginSql = `a.disabled = 0 AND a.must_change = 0 AND a.credential_state = 'ready'
  AND l.revoked = 0 AND l.expires_at > unixepoch() AND l.credential_generation = a.credential_generation
  AND b.expiresAt > ${nowSql}`;

// An absent settings row is the default. Both values fall back to constants, so
// a guard that compares the stamp never compares NULL.
const siteVersionSql = 'COALESCE((SELECT version FROM site_settings WHERE singleton = 1), 0)';
const readsRestrictedSql = 'COALESCE((SELECT restrict_webmaster_reads FROM site_settings WHERE singleton = 1), 0) = 1';

/**
 * How a statement selects the callers of one contest.
 * `caller` binds accountId, loginId, contestId.
 * `logins` binds contestId, then a JSON array of login IDs. One JSON value stays
 * under D1's limit of 100 bound parameters.
 */
export type ContestSelection = 'caller' | 'logins';

const selections: { readonly [S in ContestSelection]: string } = {
  caller: 'a.id = ? AND l.id = ? AND s.id = ?',
  logins: 's.id = ? AND l.id IN (SELECT value FROM json_each(?))',
};

/**
 * The one contest resolver. It is SQL, because write batches evaluate it again.
 * A row exists when the caller has a live login and holds a membership, an
 * event grant of the contest's event, or a site grant.
 *
 * Event admins and webmasters resolve to an admin staff seat in every contest
 * that they reach, so the rules for contest admins apply to them unchanged.
 * `manage` ranks authority over structure. `data` says whether the caller may
 * read contest data. Only a site grant can set it to 0: while the site restricts
 * webmaster reads, a webmaster reads a contest only after an audited join. A
 * webmaster's own membership never opens data, so an assignment cannot bypass
 * the join. `stamp` holds every version that the answer depends on. Only a
 * webmaster's answer depends on the site setting, so only a webmaster's stamp
 * reads it, and other callers read no added row.
 *
 * An account of one event never reaches a contest of another event. D1 also
 * refuses a membership or an event grant that crosses events.
 *
 * The CROSS JOIN keeps the contest and its event outside the login loop, so
 * the `logins` form reads them once and not once per login.
 */
function contestAuthoritySql(selection: ContestSelection): string {
  const admin = 'm.is_admin = 1 OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL';
  return `SELECT a.id AS account_id, a.name AS account_name, l.id AS login_id,
    l.expires_at AS login_expires_at, b.expiresAt AS identity_expires_at,
    s.id AS session_id, s.event_id, e.archived, m.team_id,
    (${admin}) AS is_admin,
    (m.team_id IS NULL AND (${admin}
      OR EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.session_id = s.id AND mr.account_id = a.id))) AS staff,
    (SELECT json_group_array(role) FROM (SELECT role FROM membership_roles mr
      WHERE mr.session_id = s.id AND mr.account_id = a.id ORDER BY role)) AS roles,
    'team' AS entrant_kind,
    CASE WHEN gs.account_id IS NOT NULL THEN 'site' WHEN ge.account_id IS NOT NULL THEN 'event'
      WHEN m.is_admin = 1 THEN 'contest' ELSE 'none' END AS manage,
    CASE WHEN gs.account_id IS NOT NULL THEN (NOT (${readsRestrictedSql}) OR EXISTS (SELECT 1 FROM grants gj
      WHERE gj.scope = 'contest' AND gj.session_id = s.id AND gj.account_id = a.id)) ELSE 1 END AS data,
    json_array(a.access_version, a.credential_generation, l.version, COALESCE(m.version, 0), s.version, e.version,
      CASE WHEN gs.account_id IS NOT NULL THEN ${siteVersionSql} ELSE 0 END) AS stamp
    FROM sessions s JOIN events e ON e.id = s.event_id
    CROSS JOIN accounts a JOIN logins l ON l.account_id = a.id
    JOIN ba_session b ON b.id = l.identity_session_id AND b.userId = a.id
    LEFT JOIN memberships m ON m.session_id = s.id AND m.account_id = a.id
    LEFT JOIN grants ge ON ge.scope = 'event' AND ge.event_id = s.event_id AND ge.account_id = a.id
    LEFT JOIN grants gs ON gs.scope = 'site' AND gs.account_id = a.id
    WHERE ${selections[selection]} AND ${liveLoginSql}
      AND (a.event_id = s.event_id OR a.event_id IS NULL)
      AND (m.account_id IS NOT NULL OR ge.account_id IS NOT NULL OR gs.account_id IS NOT NULL)`;
}

/**
 * The contest resolver with the webmaster read restriction applied. Every
 * reader of contest data embeds it.
 */
export function contestDataSql(selection: ContestSelection): string {
  return `SELECT * FROM (${contestAuthoritySql(selection)}) WHERE data = 1`;
}
