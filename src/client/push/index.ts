// Web push client: support detection, permission + subscription flow, per-type prefs, and the small functions the
// live session uses. Everything here is best-effort: push is an enhancement, the app must behave the same without it,
// so nothing below ever throws into UI code.
import { api, ensureAccount } from '../store/sync';
import { getState, subscribe } from '../store/core';
import { selectStreak } from '../store/x-streak';
import { setAppBadge } from '../pwa/badge';
import { defaultsFor } from '../store/x-live';
import { fmtLoad } from '../lib/format';
import { installState, detectPlatform } from '../pwa/install';
import type { Session } from '../../shared/types';

export interface PushPrefs { rest: boolean; left: boolean; nudge: boolean; badge: boolean; /** streak reminders (at risk / last chance / repair): max one a day, never 21:00-07:00 */ streak: boolean }
export const DEFAULT_PREFS: PushPrefs = { rest: true, left: true, nudge: false, badge: true, streak: true };
/** `ios-install`: iPhone/iPad in a Safari tab, where web push only exists for the installed Home Screen app. */
export type Support = 'ok' | 'unsupported' | 'ios-install';

const LS_PREFS = 'rep-push-prefs';
const LS_ENDPOINT = 'rep-push-endpoint';
const LS_TZ = 'rep-push-tz';

// ───────────────────────── local flags ─────────────────────────
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

export function loadPrefs(): PushPrefs {
  try {
    const o = JSON.parse(lsGet(LS_PREFS) ?? '{}') as Partial<PushPrefs>;
    return { rest: o.rest ?? DEFAULT_PREFS.rest, left: o.left ?? DEFAULT_PREFS.left, nudge: o.nudge ?? DEFAULT_PREFS.nudge, badge: o.badge ?? DEFAULT_PREFS.badge, streak: o.streak ?? DEFAULT_PREFS.streak };
  } catch { return { ...DEFAULT_PREFS }; }
}
const savePrefs = (p: PushPrefs) => lsSet(LS_PREFS, JSON.stringify(p));
/** This device finished the subscribe flow (cheap, synchronous gate for the live-session helpers). */
const enabled = () => !!lsGet(LS_ENDPOINT);

// ───────────────────────── capability ─────────────────────────
export function pushSupport(): Support {
  const has = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  const ios = detectPlatform() === 'ios';
  if (ios && !installState().standalone) return 'ios-install'; // Safari tab: even if the API object exists, push only works from the Home Screen app
  return has ? 'ok' : 'unsupported';
}
export const permissionState = (): NotificationPermission | 'unsupported' => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

const tz = () => new Date().getTimezoneOffset();
const readyReg = (): Promise<ServiceWorkerRegistration | null> =>
  Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]).catch(() => null);

export async function currentSubscription(): Promise<PushSubscription | null> {
  try { return (await (await readyReg())?.pushManager.getSubscription()) ?? null; } catch { return null; }
}

const urlB64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const subJson = (s: PushSubscription) => { const j = s.toJSON(); return { endpoint: j.endpoint!, keys: j.keys! }; };

// ───────────────────────── status ─────────────────────────
export type PushStatus = 'unsupported' | 'ios-install' | 'denied' | 'idle' | 'on';
/** Where the device stands right now. Also reconciles the local flag + prefs with the browser and the server. */
let statusInflight: Promise<{ status: PushStatus; prefs: PushPrefs }> | null = null;
export function pushStatus(): Promise<{ status: PushStatus; prefs: PushPrefs }> {
  return (statusInflight ??= computeStatus().finally(() => { statusInflight = null; })); // shared, so a double mount cannot register twice
}
async function computeStatus(): Promise<{ status: PushStatus; prefs: PushPrefs }> {
  const sup = pushSupport();
  if (sup !== 'ok') return { status: sup, prefs: loadPrefs() };
  if (Notification.permission === 'denied') { lsSet(LS_ENDPOINT, null); return { status: 'denied', prefs: loadPrefs() }; }
  const sub = Notification.permission === 'granted' ? await currentSubscription() : null;
  if (!sub) { lsSet(LS_ENDPOINT, null); return { status: 'idle', prefs: loadPrefs() }; }
  lsSet(LS_ENDPOINT, sub.endpoint);
  let prefs = loadPrefs();
  try {
    const r = await api<{ subscribed: boolean; prefs: PushPrefs }>(`/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`);
    if (r.ok && r.data.subscribed) {
      prefs = { ...prefs, ...r.data.prefs }; savePrefs(prefs);
      await refreshTz(sub.endpoint, prefs);
    }
    else if (r.ok && !r.data.subscribed && navigator.onLine) await registerOnServer(sub, prefs); // server lost it (e.g. 410 purge): re-register quietly
  } catch { /* offline: keep local prefs */ }
  return { status: 'on', prefs };
}

/**
 * The server decides "never after 21:00" with the zone offset we last told it, so re-send it whenever the phone's offset differs
 * (DST change, travel). Runs on every app start (startPushBackground), not only when the notifications screen opens.
 */
async function refreshTz(endpoint: string | null = lsGet(LS_ENDPOINT), prefs: PushPrefs = loadPrefs()): Promise<void> {
  try {
    if (!endpoint || lsGet(LS_TZ) === String(tz()) || !(typeof navigator !== 'undefined' && navigator.onLine) || !getState().device.token) return;
    const u = await api('/push/prefs', { method: 'PUT', body: { endpoint, prefs, tz: tz() } });
    if (u.ok) lsSet(LS_TZ, String(tz()));
  } catch { /* retried on the next start */ }
}

async function registerOnServer(sub: PushSubscription, prefs: PushPrefs): Promise<boolean> {
  if (!(await ensureAccount())) return false;
  const r = await api('/push/subscribe', { body: { subscription: subJson(sub), prefs, tz: tz() } });
  if (r.ok) lsSet(LS_TZ, String(tz()));
  return r.ok;
}

// ───────────────────────── enable / disable ─────────────────────────
export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'dismissed' | 'unsupported' | 'ios-install' | 'offline' | 'error' };

/** Must be called from a user gesture (iOS requires it for the permission prompt). */
export async function enablePush(prefs: PushPrefs): Promise<EnableResult> {
  const sup = pushSupport();
  if (sup !== 'ok') return { ok: false, reason: sup };
  try {
    const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (perm === 'denied') return { ok: false, reason: 'denied' };
    if (perm !== 'granted') return { ok: false, reason: 'dismissed' };
    if (!navigator.onLine) return { ok: false, reason: 'offline' };
    if (!(await ensureAccount())) return { ok: false, reason: 'offline' };
    const reg = await readyReg();
    if (!reg) return { ok: false, reason: 'error' };
    const k = await api<{ key?: string }>('/push/key');
    if (!k.ok || !k.data.key) return { ok: false, reason: 'error' };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(k.data.key) as BufferSource });
    savePrefs(prefs);
    if (!(await registerOnServer(sub, prefs))) { return { ok: false, reason: 'error' }; }
    lsSet(LS_ENDPOINT, sub.endpoint);
    return { ok: true };
  } catch { return { ok: false, reason: 'error' }; }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  lsSet(LS_ENDPOINT, null);
  if (!sub) return;
  try { await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }); } catch { /* server will purge on 410 */ }
  try { await sub.unsubscribe(); } catch { /* ignore */ }
  syncBadge();
}

/** Persist prefs locally and, when subscribed, on the server. */
export async function savePrefsEverywhere(prefs: PushPrefs): Promise<void> {
  savePrefs(prefs);
  syncBadge(); // the icon badge does not need a push subscription
  const ep = lsGet(LS_ENDPOINT);
  if (!ep) return;
  try { const u = await api('/push/prefs', { method: 'PUT', body: { endpoint: ep, prefs, tz: tz() } }); if (u.ok) lsSet(LS_TZ, String(tz())); } catch { /* retried on the next status() */ }
}

// ───────────────────────── live-session helpers ─────────────────────────
// Calls are chained so a cancel can never overtake the schedule that preceded it.
let chain: Promise<unknown> = Promise.resolve();
const queue = (fn: () => Promise<unknown>) => { chain = chain.then(fn, fn).catch(() => {}); };
const ready = () => enabled() && !!getState().device.token && typeof navigator !== 'undefined' && navigator.onLine;

/**
 * Ask the server to push "rest over" at `endsAt` (ms epoch). iOS web apps cannot schedule local notifications, so the
 * server sends it. `label` is the set detail ("Back squat · 82.5 kg × 6"); `title` defaults to "Rest over".
 * Idempotent: calling again (e.g. after ±15 s) replaces the pending one. No-op when push is off on this device.
 */
export function scheduleRestPush(endsAt: number, label: string, title?: string): void {
  if (!enabled() || !loadPrefs().rest) return;
  queue(async () => { if (ready()) await api('/push/rest', { method: 'POST', body: { endsAt, label, title, now: Date.now() } }); });
}
/** Cancel the pending rest push (rest skipped/ended in the app, session ended). */
export function cancelRestPush(): void {
  if (!enabled()) return;
  queue(async () => { if (ready()) await api('/push/rest', { method: 'DELETE' }); });
}
/** Heartbeat for the "session left running" nudge: call on session start, after each logged set, and periodically while visible. */
export function pushSessionBeat(info: { seq: number; startedAt: number; lastLoggedAt?: number | null }): void {
  if (!enabled() || !loadPrefs().left) return;
  queue(async () => { if (ready()) await api('/push/session', { method: 'POST', body: { seq: info.seq, startedAt: info.startedAt, lastLoggedAt: info.lastLoggedAt ?? null } }); });
}
export function pushSessionEnd(): void {
  if (!enabled()) return;
  queue(async () => { if (ready()) await api('/push/session', { method: 'DELETE' }); });
}

/** Lock-screen copy for the rest push from the current set position: "Rest over: set 3 of 4" / "Back squat · 82.5 kg × 6". */
export function restPushText(s: Session, unit: 'kg' | 'lb'): { title: string; label: string } {
  const ex = s.exercises[s.cursor];
  if (!ex) return { title: 'Rest over', label: '' };
  const n = ex.sets.length + 1;
  const { w, r } = defaultsFor(ex);
  const detail = ex.tracking === 'weight_reps' && w > 0 ? `${fmtLoad(w, unit)} × ${r}` : ex.tracking === 'time' ? '' : `${r} reps`;
  return { title: n <= ex.plannedSets ? `Rest over: set ${n} of ${ex.plannedSets}` : 'Rest over', label: detail ? `${ex.name} · ${detail}` : ex.name };
}

// ───────────────────────── icon badge: sessions left this week ─────────────────────────
/** Sessions still needed this week (a repair target counts); 0 once the week is secured. */
export function sessionsLeft(): number { return selectStreak().currentWeek.left; }
export async function clearBadge() { await setAppBadge(0); }
/** Mirror "sessions left this week" onto the app icon when the user wants it (pref `badge`); clear it otherwise or once the week is secured. */
export function syncBadge() {
  try {
    const st = getState();
    void setAppBadge(st.hydrated && st.settings.onboarded && loadPrefs().badge ? sessionsLeft() : 0);
  } catch { /* unsupported */ }
}

/**
 * Optional store-driven wiring (call once from the app shell): derives everything from the store, so Live.tsx does not
 * have to call the helpers above — rest push follows `session.restEndsAt` (reschedules on ±15 s, cancels when the rest
 * ends), the "left running" heartbeat follows the active session, and the badge follows completed sessions.
 * Calling the helpers from Live as well is harmless (the server keeps one rest/session per user).
 */
let started = false;
export function startPushBackground(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  let restKey = '', sessKey = '';
  let badgeSessions: unknown, badgeSettings: unknown;
  const run = () => {
    const st = getState();
    if (!st.hydrated) return;
    const act = Object.values(st.sessions).find((x) => x.status === 'active');
    const endsAt = act && act.phase === 'rest' ? act.restEndsAt : undefined;
    const rk = endsAt ? `${act!.id}:${endsAt}` : '';
    if (rk !== restKey) {
      restKey = rk;
      if (endsAt) { const t = restPushText(act!, st.settings.unit); scheduleRestPush(endsAt, t.label, t.title); } else cancelRestPush();
    }
    const last = act ? act.exercises.reduce((m, e) => e.sets.reduce((mm, x) => Math.max(mm, x.doneAt), m), 0) || null : null;
    const sk = act ? `${act.id}:${last ?? ''}` : '';
    if (sk !== sessKey) {
      const wasActive = sessKey !== '';
      sessKey = sk;
      if (act) pushSessionBeat({ seq: act.seq, startedAt: act.startedAt, lastLoggedAt: last }); else if (wasActive) pushSessionEnd();
    }
    // the badge only depends on sessions + settings (goal history, freezes): skip the replay when neither changed
    if (st.sessions !== badgeSessions || st.settings !== badgeSettings) { badgeSessions = st.sessions; badgeSettings = st.settings; syncBadge(); }
  };
  const un = subscribe(run);
  // while the app is on screen the session is obviously alive: keep the heartbeat fresh so the nudge only fires once it is closed
  const beat = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const act = Object.values(getState().sessions).find((x) => x.status === 'active');
    if (act) { const last = act.exercises.reduce((m, e) => e.sets.reduce((mm, x) => Math.max(mm, x.doneAt), m), 0) || null; pushSessionBeat({ seq: act.seq, startedAt: act.startedAt, lastLoggedAt: last }); }
  }, 2 * 60_000);
  // fallback for notificationclick when the SW cannot navigate an open window itself
  const onMsg = (e: MessageEvent) => { const d = e.data as { type?: string; url?: string } | null; if (d?.type === 'push-open' && typeof d.url === 'string' && d.url.startsWith('/app/')) location.assign(d.url); };
  navigator.serviceWorker?.addEventListener('message', onMsg);
  // Monday rolls the week over without any store change: refresh the badge whenever the app comes back to the foreground
  const onVis = () => { if (document.visibilityState === 'visible') syncBadge(); };
  document.addEventListener('visibilitychange', onVis);
  run();
  return () => { un(); document.removeEventListener('visibilitychange', onVis); navigator.serviceWorker?.removeEventListener('message', onMsg); clearInterval(beat); started = false; };
}
