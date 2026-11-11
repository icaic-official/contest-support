import { afterEach, describe, expect, it, vi } from 'vitest';
import { d1ErrorFields, logEvent, requestFields } from './log';

afterEach(() => vi.restoreAllMocks());

function captured(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

describe('operator log', () => {
  it('writes one JSON object per event with the error class and no message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logEvent('error', 'worker.unhandled_error', { route: '/api/x', status: 503, error: new TypeError('SELECT secret FROM t') });
    expect(captured(spy)).toEqual([
      { level: 'error', event: 'worker.unhandled_error', route: '/api/x', status: 503, errorName: 'TypeError' },
    ]);
  });

  it('logs the engine text of a D1 error, cut to 300 characters', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error(`D1_ERROR: VIEWs and/or subqueries nested too deep: SQLITE_ERROR ${'x'.repeat(400)}`);
    logEvent('error', 'http.unhandled_error', { route: '/api/snapshot', status: 503, error, ...d1ErrorFields(error) });
    const [line] = captured(spy);
    expect(line).toMatchObject({ errorName: 'Error' });
    expect(String(line?.errorMessage)).toHaveLength(300);
    expect(line?.errorMessage).toMatch(/^D1_ERROR: VIEWs and\/or subqueries nested too deep: SQLITE_ERROR x+$/);
  });

  it('gives no text to an error that is not from D1', () => {
    expect(d1ErrorFields(new TypeError('SELECT secret FROM t'))).toEqual({});
    expect(d1ErrorFields('D1_ERROR: a string is not an error')).toEqual({});
  });

  it('keeps only the pathname, method, and ray id of a request', () => {
    const fields = requestFields(new Request('https://a.example/api/images?token=SECRET', {
      method: 'POST', headers: { 'cf-ray': 'ray-1', Cookie: 'session=SECRET' },
    }));
    expect(fields).toEqual({ route: '/api/images', method: 'POST', requestId: 'ray-1' });
  });
});
