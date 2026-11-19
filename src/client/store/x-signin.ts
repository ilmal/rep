// Email magic-link sign-in (client side). Own file: shared store/sync stay untouched.
import { getState, setState, persistNow, type State } from './core';
import { api, syncNow } from './sync';
import type { EntityChange, EntityType } from '../../shared/types';

export type RequestResult =
  | { ok: true; devLink?: string }
  | { ok: false; error: 'invalid_email' | 'rate_limited' | 'offline' | 'email_not_configured' | 'send_failed' | 'failed'; retryAfter?: number };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string) => EMAIL_RE.test(v.trim());

export async function requestLink(email: string): Promise<RequestResult> {
  if (!isEmail(email)) return { ok: false, error: 'invalid_email' };
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  try {
    const r = await api<{ error?: string; retryAfter?: number; devLink?: string }>('/magic/request', { body: { email: email.trim() }, token: null });
    if (r.ok) return { ok: true, devLink: r.data.devLink };
    const e = r.data.error;
    if (r.status === 429 || e === 'rate_limited') return { ok: false, error: 'rate_limited', retryAfter: r.data.retryAfter };
    if (e === 'invalid_email' || e === 'email_not_configured' || e === 'send_failed') return { ok: false, error: e };
    return { ok: false, error: 'failed' };
  } catch { return { ok: false, error: 'offline' }; }
}

const COLL: [Exclude<EntityType, 'settings'>, keyof State][] = [
  ['gym', 'gyms'], ['area', 'areas'], ['exercise', 'exercises'], ['progress', 'progress'], ['session', 'sessions'], ['pref', 'prefs'], ['plan', 'plans'],
];

/**
 * Queue every local entity for push. Original `updatedAt` stamps are kept, so the server's
 * last-write-wins decides per entity: local-only entities are added to the account, newer
 * local edits win, newer account copies come back on pull. Nothing is wiped.
 */
export function requeueAllLocal(s: State): number {
  const ob = { ...s.outbox };
  let n = 0;
  const put = (type: EntityType, id: string, data: { updatedAt?: number }) => {
    const key = `${type}:${id}`;
    if (ob[key]) return; // already queued with its own (possibly newer) change
    ob[key] = { type, id, updatedAt: data.updatedAt ?? 0, deleted: false, data } as EntityChange;
    n++;
  };
  if (s.settings.onboarded || (s.settings.updatedAt ?? 0) > 0) put('settings', 'settings', s.settings);
  for (const [type, key] of COLL) for (const [id, v] of Object.entries(s[key] as Record<string, { updatedAt?: number }>)) put(type, id, v);
  s.outbox = ob;
  return n;
}

export type VerifyResult =
  | { ok: true; isNew: boolean; email: string; onboarded: boolean }
  | { ok: false; error: 'invalid_or_expired' | 'rate_limited' | 'offline' | 'failed' };

const verifying = new Map<string, Promise<VerifyResult>>();

/** Idempotent per token (React StrictMode / double effects can't burn a single-use link twice). */
export function verifyLink(token: string): Promise<VerifyResult> {
  let p = verifying.get(token);
  if (!p) { p = doVerify(token); verifying.set(token, p); }
  return p;
}

async function doVerify(token: string): Promise<VerifyResult> {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  let r;
  try { r = await api<{ token: string; userId: string; email: string; isNew: boolean; error?: string }>('/magic/verify', { body: { token }, token: null }); }
  catch { return { ok: false, error: 'offline' }; }
  if (!r.ok) return { ok: false, error: r.status === 429 ? 'rate_limited' : r.data.error === 'invalid_or_expired' ? 'invalid_or_expired' : 'failed' };

  // Let any sync round using the old (anonymous) token finish so it cannot overwrite the new cursor.
  await syncNow().catch(() => undefined);
  setState((s) => {
    s.device = { ...s.device, token: r.data.token, userId: r.data.userId, email: r.data.email, wasSignedIn: true, cursor: 0, lastSyncError: undefined };
    requeueAllLocal(s);
  });
  await persistNow();
  await syncNow();
  return { ok: true, isNew: r.data.isNew, email: r.data.email, onboarded: getState().settings.onboarded };
}
