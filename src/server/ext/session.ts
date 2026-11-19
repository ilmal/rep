// Long-lived cookies so the web app never silently forgets who you are.
//   rep_session  HttpOnly, Path=/api/auth: the session token. Used ONLY by POST /api/auth/restore to re-issue the token to the app
//                when its own storage was wiped (browser eviction, cleared site data). Never accepted as auth on any other route.
//   rep_seen     readable, Path=/: "this browser has used the app". The landing page at / redirects to /app/ when it is present.
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'rep_session';
export const SEEN_COOKIE = 'rep_seen';
export const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60; // the browser maximum

const secure = (c: Context) => c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';

export function setSession(c: Context, token: string) {
  const s = secure(c);
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: s, sameSite: 'Lax', path: '/api/auth', maxAge: COOKIE_MAX_AGE_S });
  setCookie(c, SEEN_COOKIE, '1', { httpOnly: false, secure: s, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE_S });
}
export function clearSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/api/auth' });
  deleteCookie(c, SEEN_COOKIE, { path: '/' });
}
export const sessionCookie = (c: Context): string => getCookie(c, SESSION_COOKIE) ?? '';
export const hasSeen = (c: Context): boolean => getCookie(c, SEEN_COOKIE) === '1';
