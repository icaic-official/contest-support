/**
 * Structured operator log. Each event is one JSON object on one line, so Workers
 * Logs can index every field. The field list is closed on purpose. It has no
 * place for bodies, headers, cookies, tokens, IP addresses, SQL, or error
 * messages, because a message can carry user input. The one exception is the
 * engine text of a D1 error, which `d1ErrorFields` adds.
 */
export interface LogFields {
  readonly route?: string;
  readonly method?: string;
  /** The Cloudflare `cf-ray` header. It links a log line to one request. */
  readonly requestId?: string | null;
  readonly status?: number;
  readonly task?: string;
  /** The event of a deletion that failed. An operator can read it, and it names no person. */
  readonly eventId?: string;
  /**
   * The part of a deletion that failed, or the step of a workflow command that
   * ended with an unknown outcome. `retries` means that every attempt asked for another.
   */
  readonly phase?: 'contests' | 'accounts' | 'event' | 'live' | 'files' | 'unknown' | 'read' | 'commit' | 'retries';
  /** What the error of a failed deletion says, as a fixed word and never as its text. */
  readonly cause?: 'foreign_key' | 'internal' | 'other';
  readonly delivered?: number;
  readonly failed?: number;
  readonly error?: unknown;
  /** The engine text of a D1 error, cut short. Set it only with `d1ErrorFields`. */
  readonly errorMessage?: string;
}

export type LogLevel = 'error' | 'warn';

const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Reduce a thrown value to its class name and, when present, a short code. */
function describeError(error: unknown): { errorName: string; errorCode?: string } {
  if (error instanceof Error) {
    const code = 'code' in error ? error.code : undefined;
    return { errorName: error.name, ...(typeof code === 'string' && SAFE_CODE.test(code) ? { errorCode: code } : {}) };
  }
  return { errorName: typeof error };
}

/** The pathname only. The query string can carry tokens. */
export function requestFields(request: Request): Pick<LogFields, 'route' | 'method' | 'requestId'> {
  let route = 'unparseable';
  try { route = new URL(request.url).pathname.slice(0, 120); } catch { /* Keep the placeholder. */ }
  return { route, method: request.method, requestId: request.headers.get('cf-ray') };
}

const D1_MESSAGE_LIMIT = 300;

/**
 * The text of a D1 error, which names a SQLite problem and no bound value, so a
 * failed statement shows why in the log. Every statement is static, so the text
 * carries no user input. Another error gets no text, because its message can.
 */
export function d1ErrorFields(error: unknown): Pick<LogFields, 'errorMessage'> {
  return error instanceof Error && error.message.startsWith('D1_ERROR: ')
    ? { errorMessage: error.message.slice(0, D1_MESSAGE_LIMIT) }
    : {};
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const { error, ...rest } = fields;
  const record = {
    level, event, ...rest, ...(error === undefined ? {} : describeError(error)),
  };
  // Logging must never turn a handled failure into a second failure.
  try { (level === 'error' ? console.error : console.warn)(JSON.stringify(record)); } catch { /* Drop the event. */ }
}
