import type { D1Connection } from '../../../src/server/adapters/d1/connection';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const flagNames = [
  'accountExists', 'accountDisabled', 'accountMustChange', 'accountReady',
  'wrapperExists', 'wrapperRevoked', 'wrapperUnexpired', 'credentialGenerationMatches',
  'identityExists', 'identityAccountMatches', 'identityUnexpired',
  'identityParsedUnexpired', 'currentLoginValid',
] as const;

export type AuthFlags = Record<typeof flagNames[number], boolean> & { wrapperCount: number };
export type Endpoint = 'auth_session' | 'sign_in' | 'sign_out' | 'change_password' | 'auth_sessions' |
  'accounts' | 'sessions' | 'snapshot' | 'workflow' | 'admin' | 'images' | 'image' | 'updates';
type Method = 'GET' | 'POST' | 'PUT' | 'OTHER';

export interface HttpObservation {
  method: string;
  url: string;
  status: number;
  durationMilliseconds: number;
  hasSessionCookie: boolean;
}

interface RequestSummary {
  endpoint: Endpoint;
  method: Method;
  count: number;
  totalMilliseconds: number;
  maxMilliseconds: number;
  statuses: Array<{ status: number; count: number }>;
}

interface UnauthorizedSummary {
  endpoint: Endpoint;
  method: Method;
  hasSessionCookie: boolean;
  authStateRead: 'not_requested' | 'available' | 'unavailable';
  authFlags?: AuthFlags;
}

export interface DiagnosticsSummary {
  requests: RequestSummary[];
  unauthorized?: UnauthorizedSummary;
}

function endpoint(url: string): Endpoint | undefined {
  let path: string;
  try { path = new URL(url).pathname; } catch { return undefined; }
  if (path.startsWith('/api/image/')) return 'image';
  const paths: Record<string, Endpoint> = {
    '/api/auth/session': 'auth_session', '/api/auth/sign-in': 'sign_in',
    '/api/auth/sign-out': 'sign_out', '/api/auth/change-password': 'change_password',
    '/api/auth/sessions': 'auth_sessions', '/api/accounts': 'accounts', '/api/sessions': 'sessions',
    '/api/snapshot': 'snapshot', '/api/workflow': 'workflow', '/api/admin': 'admin',
    '/api/images': 'images', '/api/updates': 'updates',
  };
  return Object.hasOwn(paths, path) ? paths[path] : undefined;
}

function safeFlags(value: unknown): AuthFlags | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.wrapperCount) || (input.wrapperCount as number) < 0 ||
      flagNames.some(name => typeof input[name] !== 'boolean')) return undefined;
  // Copy only reviewed primitive fields. Extra callback data never reaches output.
  return { ...Object.fromEntries(flagNames.map(name => [name, input[name]])), wrapperCount: input.wrapperCount } as AuthFlags;
}

/** URLs and account IDs stay private. Only fixed enums and primitive metrics survive. */
export function createDiagnostics(
  accountId?: string,
  readAuthFlags?: (accountId: string) => Promise<AuthFlags>,
) {
  if (accountId !== undefined && !uuid.test(accountId)) throw new Error('Select a fixture account by UUID for diagnostics.');
  const requests = new Map<string, RequestSummary>();
  let unauthorized: UnauthorizedSummary | undefined;
  let reading: Promise<void> | undefined;

  return {
    async observe(input: HttpObservation): Promise<void> {
      const route = endpoint(input.url);
      if (!route || !Number.isInteger(input.status) || input.status < 0 || input.status > 599 ||
          !Number.isFinite(input.durationMilliseconds) || input.durationMilliseconds < 0 ||
          input.durationMilliseconds > Number.MAX_SAFE_INTEGER || typeof input.hasSessionCookie !== 'boolean') return;
      const method: Method = ['GET', 'POST', 'PUT'].includes(input.method) ? input.method as Method : 'OTHER';
      const key = `${route}:${method}`;
      const milliseconds = Math.round(input.durationMilliseconds);
      let request = requests.get(key);
      if (!request) {
        request = { endpoint: route, method, count: 0, totalMilliseconds: 0, maxMilliseconds: 0, statuses: [] };
        requests.set(key, request);
      }
      request.count++;
      request.totalMilliseconds += milliseconds;
      request.maxMilliseconds = Math.max(request.maxMilliseconds, milliseconds);
      const status = request.statuses.find(status => status.status === input.status);
      if (status) status.count++;
      else request.statuses.push({ status: input.status, count: 1 });

      // Authentication endpoints intentionally return 401 during gate/revocation
      // scenarios. A resource 401 captures state once, before browser teardown.
      if (input.status !== 401 || unauthorized ||
          ['auth_session', 'sign_in', 'sign_out', 'change_password'].includes(route)) return;
      unauthorized = { endpoint: route, method, hasSessionCookie: input.hasSessionCookie, authStateRead: 'not_requested' };
      if (!accountId || !readAuthFlags) return;
      const record = unauthorized;
      reading = (async () => {
        try {
          const flags = safeFlags(await readAuthFlags(accountId));
          record.authStateRead = flags ? 'available' : 'unavailable';
          if (flags) record.authFlags = flags;
        } catch {
          record.authStateRead = 'unavailable';
        }
      })();
      await reading;
    },
    async flush(): Promise<void> { await reading; },
    summary(): DiagnosticsSummary {
      // Callers cannot modify internal counters or inject later output values.
      return structuredClone({ requests: [...requests.values()], ...(unauthorized ? { unauthorized } : {}) });
    },
  };
}

/**
 * Read one known fixture account. Never accept IDs recovered from browser input.
 * Wrapper flags describe the newest wrapper; wrapperCount exposes ambiguity
 * when this account has more than one browser login.
 */
export async function readD1AuthFlags(
  db: D1Connection, accountId: string, ownedAccountIds: ReadonlySet<string>,
): Promise<AuthFlags> {
  if (!uuid.test(accountId) || !ownedAccountIds.has(accountId)) {
    throw new Error('Authentication diagnostics require an account owned by this fixture.');
  }
  const row = await db.prepare(`WITH selected AS (SELECT * FROM accounts WHERE id = ?),
    wrappers AS (SELECT l.*, l.rowid AS insertion_order FROM logins l JOIN selected a ON a.id = l.account_id),
    latest AS (SELECT * FROM wrappers ORDER BY insertion_order DESC LIMIT 1),
    identity AS (SELECT b.* FROM ba_session b JOIN latest l ON b.id = l.identity_session_id)
    SELECT EXISTS(SELECT 1 FROM selected) AS accountExists,
      EXISTS(SELECT 1 FROM selected WHERE disabled = 1) AS accountDisabled,
      EXISTS(SELECT 1 FROM selected WHERE must_change = 1) AS accountMustChange,
      EXISTS(SELECT 1 FROM selected WHERE credential_state = 'ready') AS accountReady,
      (SELECT count(*) FROM wrappers) AS wrapperCount,
      EXISTS(SELECT 1 FROM latest) AS wrapperExists,
      EXISTS(SELECT 1 FROM latest WHERE revoked = 1) AS wrapperRevoked,
      EXISTS(SELECT 1 FROM latest WHERE expires_at > unixepoch()) AS wrapperUnexpired,
      EXISTS(SELECT 1 FROM latest l JOIN selected a ON l.credential_generation = a.credential_generation) AS credentialGenerationMatches,
      EXISTS(SELECT 1 FROM identity) AS identityExists,
      EXISTS(SELECT 1 FROM identity b JOIN selected a ON b.userId = a.id) AS identityAccountMatches,
      EXISTS(SELECT 1 FROM identity WHERE expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS identityUnexpired,
      EXISTS(SELECT 1 FROM identity WHERE julianday(expiresAt) > julianday('now')) AS identityParsedUnexpired,
      EXISTS(SELECT 1 FROM selected a JOIN latest l ON l.account_id = a.id JOIN identity b ON b.userId = a.id
        WHERE a.disabled = 0 AND a.must_change = 0 AND a.credential_state = 'ready' AND l.revoked = 0
          AND l.expires_at > unixepoch() AND l.credential_generation = a.credential_generation
          AND b.expiresAt > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS currentLoginValid`).bind(accountId)
    .first<Record<string, number>>();
  if (!row || flagNames.some(name => row[name] !== 0 && row[name] !== 1) || !Number.isSafeInteger(row.wrapperCount)) {
    throw new Error('Fixture authentication diagnostics are unavailable.');
  }
  return { ...Object.fromEntries(flagNames.map(name => [name, row[name] === 1])), wrapperCount: row.wrapperCount } as AuthFlags;
}
