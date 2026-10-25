/**
 * Structured operator log. Each event is one JSON object on one line, so Workers
 * Logs can index every field. The field list is closed on purpose. It has no
 * place for bodies, headers, cookies, tokens, IP addresses, SQL, or error
 * messages, because a message can carry user input.
 */
export interface LogFields {
  readonly route?: string;
  readonly method?: string;
  /** The Cloudflare `cf-ray` header. It links a log line to one request. */
  readonly requestId?: string | null;
  readonly status?: number;
  readonly task?: string;
  readonly delivered?: number;
  readonly failed?: number;
  readonly error?: unknown;
}

export type LogLevel = 'error' | 'warn';

const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Reduce a thrown value to its class name and, when present, a short code. */
function describeError(error: unknown): { errorName: string; errorCode?: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
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

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const { error, ...rest } = fields;
  const record = {
    level, event, ...rest, ...(error === undefined ? {} : describeError(error)),
  };
  // Logging must never turn a handled failure into a second failure.
  try { (level === 'error' ? console.error : console.warn)(JSON.stringify(record)); } catch { /* Drop the event. */ }
}
