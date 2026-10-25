import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvent, requestFields } from './log';

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

  it('keeps only the pathname, method, and ray id of a request', () => {
    const fields = requestFields(new Request('https://a.example/api/images?token=SECRET', {
      method: 'POST', headers: { 'cf-ray': 'ray-1', Cookie: 'session=SECRET' },
    }));
    expect(fields).toEqual({ route: '/api/images', method: 'POST', requestId: 'ray-1' });
  });
});
