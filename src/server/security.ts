// Security headers for the web app (/app/*). Deliberately a PARTIAL policy (no default-src/script-src): it constrains only what
// exercise media can reach, so it cannot break the app shell. User/coach media may be https images, https video files and the
// two privacy-friendly embed hosts; nothing else may be framed or embedded.
export const MEDIA_FRAME_HOSTS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'] as const;

export const APP_CSP = [
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `frame-src ${MEDIA_FRAME_HOSTS.join(' ')}`,
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/** Hono middleware: set the CSP (and a few cheap hardening headers) on every response under it. */
export async function appSecurityHeaders(c: { header: (k: string, v: string) => void }, next: () => Promise<void>) {
  await next();
  c.header('Content-Security-Policy', APP_CSP);
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
}
