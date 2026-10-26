/**
 * Security headers for every response the Worker sends.
 * Cloudflare applies a `_headers` file only to assets that it serves itself. The Worker
 * runs first (`run_worker_first`), so it must set these headers.
 * https://developers.cloudflare.com/workers/static-assets/headers/
 */

/** One year. The installation serves only HTTPS, so browsers must never fall back to HTTP. */
export const strictTransportSecurity = 'max-age=31536000';

/**
 * The built app has no inline script, no eval, and no external host. It loads scripts
 * and styles from its own origin. Pictures come from the same origin or from `blob:`
 * URLs that the app builds from downloaded files.
 *
 * Two exceptions weaken the policy, and the app needs both:
 * - `style-src 'unsafe-inline'`: Sonner (toasts), Radix scroll locking, and the image
 *   cropper add `<style>` elements when they run. Their CSS changes per state, so a hash
 *   or nonce cannot cover it. Script stays strict, so this does not allow script injection.
 * - `font-src data:`: the build inlines one small JetBrains Mono subset as a `data:` URI.
 * The live-update socket uses the same origin. `connect-src 'self'` covers it in
 * current browsers. Older Safari needs the explicit `wss:` origin, so the Worker adds it.
 */
export function contentSecurityPolicy(origin: string): string {
  const socket = origin.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' ${socket}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Headers for every response, including scripts, styles, and fonts. */
export const baseSecurityHeaders: Record<string, string> = {
  'Strict-Transport-Security': strictTransportSecurity,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** One year. A new build changes the hash, so a browser never needs to ask about the old URL again. */
export const immutableCacheControl = 'public, max-age=31536000, immutable';

/** Vite names every built file `assets/<name>-<hash>.<extension>`, with an 8-character base64url hash. */
const hashedAssetPath = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

/**
 * Adds the security headers to an asset response. Only HTML documents get a CSP.
 * A hashed build file also gets a one-year cache. The single-page fallback answers a
 * missing hashed name with the HTML shell and status 200, so an HTML body never qualifies.
 */
export function withSecurityHeaders(response: Response, requestUrl: string): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(baseSecurityHeaders)) secured.headers.set(name, value);
  const html = secured.headers.get('Content-Type')?.toLowerCase().startsWith('text/html') ?? false;
  if ((response.ok || response.status === 304) && !html && hashedAssetPath.test(new URL(requestUrl).pathname)) {
    secured.headers.set('Cache-Control', immutableCacheControl);
  }
  if (html) {
    secured.headers.set('Content-Security-Policy', contentSecurityPolicy(new URL(requestUrl).origin));
    secured.headers.set('X-Frame-Options', 'DENY');
    secured.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  }
  return secured;
}
