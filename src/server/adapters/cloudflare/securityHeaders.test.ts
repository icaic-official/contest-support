import { describe, expect, it, vi } from 'vitest';
import applicationWorker, { type ApplicationEnvironment } from './applicationWorker';
import { privateJson } from './http';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const origin = 'https://installation.example.invalid';
const html = '<!doctype html><title>Minsky</title>';

function environment(): ApplicationEnvironment {
  const assets = async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === '/assets/app.js') {
      return new Response('console.log(1)', { headers: { 'Content-Type': 'text/javascript', ETag: '"x"' } });
    }
    // Cloudflare answers the default Cache-Control for every static file. Vite names built files <name>-<hash>.<ext>.
    const platformCache = 'public, max-age=0, must-revalidate';
    if (path === '/assets/index--SUA_P84.js') {
      return new Response('console.log(2)', { headers: { 'Content-Type': 'text/javascript', ETag: '"h"', 'Cache-Control': platformCache } });
    }
    if (path === '/assets/index-BTbW9TP5.css') {
      return new Response('body{}', { headers: { 'Content-Type': 'text/css', 'Cache-Control': platformCache } });
    }
    if (path === '/assets/inter-latin-wght-normal-Dx4kXJAl.woff2') {
      return new Response('font', { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': platformCache } });
    }
    if (path === '/favicon.svg') {
      return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': platformCache } });
    }
    if (path === '/assets/gone-AbCd1234.js') {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
    // The single-page-application fallback serves the shell for every other path.
    return new Response(html, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
  };
  return { AUTH_ORIGIN: origin, ASSETS: { fetch: assets } } as unknown as ApplicationEnvironment;
}

async function get(path: string): Promise<Response> {
  return applicationWorker.fetch(new Request(`${origin}${path}`), environment(), { waitUntil: () => {} });
}

describe('Worker security headers', () => {
  it('sends a strict policy with every HTML document, including the single-page fallback', async () => {
    for (const path of ['/', '/organiser/issues']) {
      const response = await get(path);
      expect(await response.text()).toBe(html);
      const policy = response.headers.get('Content-Security-Policy') ?? '';
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain(`connect-src 'self' wss://installation.example.invalid`);
      expect(policy).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
      expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    }
  });

  it('keeps asset headers and adds the transport headers to scripts without a document policy', async () => {
    const response = await get('/assets/app.js');
    expect(response.headers.get('ETag')).toBe('"x"');
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBeNull();
  });

  describe('asset caching', () => {
    const immutable = 'public, max-age=31536000, immutable';
    const revalidate = 'public, max-age=0, must-revalidate';

    it.each([
      '/assets/index--SUA_P84.js',
      '/assets/index-BTbW9TP5.css',
      '/assets/inter-latin-wght-normal-Dx4kXJAl.woff2',
    ])('caches the hashed file %s for a year', async (path) => {
      const response = await get(path);
      expect(response.headers.get('Cache-Control')).toBe(immutable);
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('keeps the validators of a hashed file', async () => {
      expect((await get('/assets/index--SUA_P84.js')).headers.get('ETag')).toBe('"h"');
    });

    it.each(['/', '/index.html', '/favicon.svg'])('keeps revalidating %s', async (path) => {
      expect((await get(path)).headers.get('Cache-Control')).toBe(revalidate);
    });

    it('does not cache a file under /assets/ whose name has no hash', async () => {
      expect((await get('/assets/app.js')).headers.get('Cache-Control') ?? '').not.toContain('immutable');
    });

    it('does not cache the app shell that the fallback serves for a hashed name that does not exist', async () => {
      const response = await get('/assets/index-MISSING1.js');
      expect(await response.text()).toBe(html);
      expect(response.headers.get('Cache-Control')).toBe(revalidate);
    });

    it('does not cache an error response for a hashed name', async () => {
      const response = await get('/assets/gone-AbCd1234.js');
      expect(response.status).toBe(404);
      expect(response.headers.get('Cache-Control') ?? '').not.toContain('immutable');
    });

    it('never caches an API response, even for a path that looks like a hashed file', async () => {
      const response = await get('/api/assets/index-BTbW9TP5.css');
      expect(response.headers.get('Cache-Control') ?? '').not.toContain('immutable');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });
  });

  it('secures blocked paths', async () => {
    const response = await get('/src/main.tsx');
    expect(response.status).toBe(404);
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('gives API responses transport headers and a policy that forbids all loading', () => {
    const response = privateJson({ ok: true });
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
