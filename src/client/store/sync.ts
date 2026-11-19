// Sync engine: outbox → POST /api/sync (push+pull, LWW per entity). Works offline; retries when back online.
import { getState, setState, now, resetLocal, persistNow, resetEpoch, type State } from './core';
import { withDefaults } from '../../shared/defaults';
import { sanitizeContent } from '../../shared/content';
import { DEFAULT_PREF } from '../../shared/planner';
import type { EntityChange } from '../../shared/types';

const COLL = { gym: 'gyms', area: 'areas', exercise: 'exercises', progress: 'progress', session: 'sessions', pref: 'prefs', plan: 'plans' } as const;

async function api<T>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const token = init.token === undefined ? getState().device.token : init.token;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
export { api };

const cleanRemotePref = (d: unknown): unknown => {
  if (!d || typeof d !== 'object' || !('content' in d)) return d;
  const { content, ...rest } = d as Record<string, unknown>;
  const clean = sanitizeContent(content);
  return clean ? { ...rest, content: clean } : rest;
};
/** True when two pref records differ only in `content` / `updatedAt`: nothing the planner reads changed. */
function onlyContentChanged(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const strip = (o: object) => { const { content: _c, updatedAt: _u, ...rest } = o as Record<string, unknown>; return JSON.stringify(rest, Object.keys(rest).sort()); };
  return strip(a) === strip(b);
}

function applyRemote(s: State, ch: EntityChange) {
  const key = `${ch.type}:${ch.id}`;
  const pending = s.outbox[key];
  if (pending && pending.updatedAt >= ch.updatedAt) return; // our unsent edit is newer or equal: it will overwrite the server copy
  if (ch.type === 'settings') {
    if (!ch.deleted && ch.updatedAt >= s.settings.updatedAt) { s.settings = withDefaults(ch.data as never); s.device = { ...s.device, draft: null }; }
    return;
  }
  const coll = { ...(s[COLL[ch.type] as 'gyms'] as Record<string, { updatedAt?: number }>) };
  const local = coll[ch.id];
  if (local && (local.updatedAt ?? 0) > ch.updatedAt) return;
  if (ch.deleted) delete coll[ch.id]; else coll[ch.id] = (ch.type === 'pref' ? cleanRemotePref(ch.data) : ch.data) as never;
  (s as unknown as Record<string, unknown>)[COLL[ch.type]] = coll;
  // remote edits may invalidate a local draft (e.g. coach plan queued, equipment changed)
  if (ch.type === 'pref' && !ch.deleted && onlyContentChanged(local ?? DEFAULT_PREF(ch.id), coll[ch.id])) return; // a how-to edit never invalidates the planned session
  if (ch.type === 'plan' || ch.type === 'pref' || ch.type === 'gym' || ch.type === 'area' || ch.type === 'exercise') s.device = { ...s.device, draft: null };
}

let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(ms = 1500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void syncNow(); }, ms);
}

/** Ask the server to re-issue our token from the long-lived session cookie (storage was wiped / token lost). */
export async function restoreSession(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const res = await fetch('/api/auth/restore', { method: 'POST', credentials: 'same-origin', headers: { 'x-rep': '1' } });
    if (!res.ok) return false;
    const d = await res.json() as { token: string; userId: string; email: string | null };
    if (!d.token) return false;
    setState((s) => {
      const changed = s.device.userId !== d.userId;
      s.device = { ...s.device, token: d.token, userId: d.userId, email: d.email, wasSignedIn: s.device.wasSignedIn || !!d.email, ...(changed ? { cursor: 0 } : {}), lastSyncError: undefined };
    });
    return true;
  } catch { return false; }
}

export async function ensureAccount(): Promise<boolean> {
  if (getState().device.token) return true;
  if (!navigator.onLine) return false;
  if (await restoreSession()) return true;
  // Was signed in once: never silently start a blank account (the data would fork). The router sends them to sign in.
  if (getState().device.wasSignedIn) return false;
  try {
    const r = await api<{ token: string; userId: string }>('/auth/anon', { body: { name: getState().settings.name }, token: null });
    if (!r.ok) return false;
    setState((s) => { s.device = { ...s.device, token: r.data.token, userId: r.data.userId }; });
    return true;
  } catch { return false; }
}

export function syncNow(): Promise<void> {
  if (inflight) return inflight;
  let aborted = false;
  const run = (async () => {
    const st = getState();
    if (!st.hydrated) return;
    if (!navigator.onLine) { setState((s) => { s.online = false; }); return; }
    if (!(await ensureAccount())) { setState((s) => { s.device = { ...s.device, lastSyncError: 'no_account' }; }); return; }
    setState((s) => { s.syncing = true; s.online = true; });
    try {
      for (let round = 0; round < 20; round++) {
        const epoch = resetEpoch;
        const cur = getState();
        const changes = Object.values(cur.outbox).slice(0, 400);
        const events = cur.events.slice(0, 1500);
        const r = await api<{ accepted: string[]; rejected: { type: string; id: string; reason: string }[]; changes: EntityChange[]; cursor: number; more: boolean }>('/sync', {
          body: { cursor: cur.device.cursor, changes, events, name: cur.settings.name },
        });
        if (epoch !== resetEpoch) { aborted = true; break; } // local data was wiped (sign out / delete) while this request was in flight: drop the response
        if (r.status === 401) {
          // token unknown to the server: try the session cookie first; otherwise keep the identity hint so the app asks to sign in
          setState((s) => { s.device = { ...s.device, token: undefined, wasSignedIn: s.device.wasSignedIn || !!s.device.email }; });
          if (await restoreSession()) continue;
          setState((s) => { if (!s.device.wasSignedIn) s.device = { ...s.device, userId: undefined, email: null }; });
          break;
        }
        if (!r.ok) throw new Error(`sync ${r.status}`);
        const sentKeys = new Set(changes.map((c) => `${c.type}:${c.id}`));
        const sentAt = new Map(changes.map((c) => [`${c.type}:${c.id}`, c.updatedAt]));
        setState((s) => {
          // drop outbox entries that were sent and not edited again since
          const ob = { ...s.outbox };
          for (const k of sentKeys) if (ob[k] && ob[k].updatedAt === sentAt.get(k)) delete ob[k];
          s.outbox = ob;
          s.events = s.events.slice(events.length);
          for (const ch of r.data.changes) applyRemote(s, ch);
          s.device = { ...s.device, cursor: r.data.cursor, lastSyncAt: now(), lastSyncError: undefined };
        });
        if (!r.data.more && Object.keys(getState().outbox).length === 0) break;
        if (!r.data.more && !changes.length) break;
      }
      await persistNow();
    } catch (e) {
      setState((s) => { s.device = { ...s.device, lastSyncError: String((e as Error).message ?? e) }; });
    } finally {
      setState((s) => { s.syncing = false; });
    }
  })();
  // Always release the in-flight guard, including on the early offline/no-account returns above.
  inflight = run.finally(() => { inflight = null; if (aborted) setTimeout(() => { void syncNow(); }, 0); }); // fresh sync for the new local state
  return inflight;
}

export function startSyncLoop() {
  const kick = () => { setState((s) => { s.online = navigator.onLine; }); if (navigator.onLine) void syncNow(); };
  window.addEventListener('online', kick);
  window.addEventListener('offline', () => setState((s) => { s.online = false; }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  setInterval(() => { if (document.visibilityState === 'visible') kick(); }, 60_000);
  // any local change → debounced sync
  let last = Object.keys(getState().outbox).length;
  import('./core').then(({ subscribe }) => subscribe(() => {
    const n = Object.keys(getState().outbox).length;
    if (n !== last && n > 0) scheduleSync();
    last = n;
  }));
  kick();
}

export const pendingCount = (s: State) => Object.keys(s.outbox).length;

// ── accounts ──
export async function register(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await ensureAccount())) return { ok: false, error: 'offline' };
  const r = await api<{ error?: string }>('/auth/register', { body: { email, password } });
  if (!r.ok) return { ok: false, error: r.data.error ?? 'failed' };
  setState((s) => { s.device = { ...s.device, email: email.trim().toLowerCase(), wasSignedIn: true }; });
  return { ok: true };
}

/** Sign in to an existing account: local data is replaced by the account's data. */
export async function login(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!navigator.onLine) return { ok: false, error: 'offline' };
  const r = await api<{ token: string; userId: string; error?: string }>('/auth/login', { body: { email, password }, token: null });
  if (!r.ok) return { ok: false, error: r.data.error ?? 'failed' };
  await resetLocal(false);
  setState((s) => { s.device = { ...s.device, token: r.data.token, userId: r.data.userId, email: email.trim().toLowerCase(), wasSignedIn: true, cursor: 0 }; });
  await syncNow();
  await syncNow(); // an in-flight sync from before the reset may have aborted; make sure the new account is pulled
  // account data may legitimately contain no settings (never onboarded): leave onboarding to the router
  return { ok: true };
}

export async function logout() {
  const tok = getState().device.token;
  if (tok && navigator.onLine) { try { await api('/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } }
  await resetLocal(false);
}

export async function deleteAllData(deleteAccount = false) {
  if (navigator.onLine && getState().device.token) {
    const r = await api(deleteAccount ? '/account' : '/account/data', { method: 'DELETE' });
    // never wipe the local copy if the server refused: the data would be orphaned in the cloud with no way to retry
    if (!r.ok) throw new Error(`delete failed (${r.status})`);
  }
  await resetLocal(!deleteAccount);
  if (!deleteAccount) setState((s) => { s.device = { ...s.device, cursor: 0 }; });
}

export async function exportData(): Promise<Blob> {
  const r = await fetch('/api/export', { headers: { authorization: `Bearer ${getState().device.token}` } });
  if (r.ok) return r.blob();
  const s = getState();
  return new Blob([JSON.stringify({ settings: s.settings, gyms: s.gyms, areas: s.areas, exercises: s.exercises, prefs: s.prefs, progress: s.progress, sessions: s.sessions, plans: s.plans }, null, 2)], { type: 'application/json' });
}

// ── coach (MCP) tokens ──
export interface ApiTokenRow { id: string; name: string; scope: 'read' | 'write'; prefix: string; createdAt: number; lastUsed: number | null }
export const listTokens = async () => (await api<{ tokens: ApiTokenRow[] }>('/tokens')).data.tokens ?? [];
export const createToken = async (name: string, scope: 'read' | 'write') => (await api<{ token: string; id: string }>('/tokens', { body: { name, scope } })).data;
export const revokeToken = (id: string) => api(`/tokens/${id}`, { method: 'DELETE' });
