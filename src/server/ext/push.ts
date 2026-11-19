// Web push (RFC 8030 + RFC 8291 aes128gcm + RFC 8292 VAPID), dependency-free (WebCrypto). Mounted at /api/push.
//
//   GET    /key                      → {key}                       VAPID public key (base64url, 65 bytes)
//   POST   /subscribe {subscription, prefs?, tz?}                  upsert this device's subscription
//   POST   /unsubscribe {endpoint}
//   PUT    /prefs {endpoint, prefs, tz?}
//   GET    /status?endpoint=…        → {subscribed, prefs}
//   POST   /rest {endsAt, label, title?, now?}   schedule "rest over" at endsAt (one per user; replaces)
//   DELETE /rest                     cancel it
//   POST   /session {seq, startedAt, lastLoggedAt?}   heartbeat while a session is active
//   DELETE /session                  session ended (stops the "left running" nudge)
//
// All endpoints need the app session token (same Bearer token as /api/sync).
//
// Delivery model
//  - Rest-over: persisted in push_rest and armed with an in-process timer; timers are restored on boot (overdue by more
//    than STALE_REST_MS = dropped, a late "rest over" is noise). Claiming a row is an atomic DELETE…RETURNING, so a
//    timer and the safety sweep can never double-send.
//  - Session left running: the client heartbeats (session start, every logged set, and every few minutes while the app is
//    visible). The server nudges ONCE when the last logged set (or the start) is >= LEFT_AFTER_MS old AND no heartbeat has
//    arrived for BEAT_SILENT_MS (the app is closed/backgrounded). It is skipped in quiet hours (never nag) and never repeats.
//  - Weekly nudge (opt-in, default off): daily tick; Friday 09:00-12:00 in the user's local time (tz from the client),
//    only if behind the weekly goal, at most once per ISO week. Quiet hours do not apply (09:00 is outside them).
//  - Streak reminders (pref `streak`, default on; Flows.dc.html section 5): the same sweep, every STREAK_CHECK_MS per user, only
//    08:00-20:59 in the user's local time (never 21:00-07:00). The athlete's streak is derived with computeStreak() from their
//    stored sessions/settings (same code as the app and MCP) and streakReminder() picks the ONE reminder that applies (Monday
//    repair / Monday "streak lost" / last chance / tight pace at the learned training hour). At most one per local day: the
//    push_streak row is claimed BEFORE sending. "Goal hit / repaired / milestone" is NOT a push: the app shows StreakCelebrate
//    when the session finishes (client-triggered). Payload urls: /app/ (risk + repair are states of Today) and /app/streak.
// Hardening: https-only endpoints on 443, no IP literals / localhost / internal names, DNS result re-checked against
// private ranges at send time, redirects not followed, 8 subscriptions per user (oldest evicted), per-user rate limits,
// 404/410 → subscription dropped (also after 5 consecutive failures).
import { Hono, type Context } from 'hono';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Db } from '../db';
import { nextSlot } from '../../shared/rules';
import { computeStreak, goalForWeek, inStreakQuietHours, makeCal, REMINDER_HOUR, streakReminder, usualTrainHour } from '../../shared/streak';
import type { Session } from '../../shared/types';

// ───────────────────────── constants ─────────────────────────
export const MAX_SUBS_PER_USER = 8;
export const MAX_REST_AHEAD_MS = 2 * 3600_000;
export const STALE_REST_MS = 2 * 60_000;
export const LEFT_AFTER_MS = 30 * 60_000;
export const BEAT_SILENT_MS = 5 * 60_000;
export const SESSION_FORGET_MS = 12 * 3600_000;
export const QUIET_FROM_H = 22; // local 22:00 …
export const QUIET_TO_H = 7; //   … 07:00
const FAIL_LIMIT = 5;
const SWEEP_MS = 30_000;
export const STREAK_CHECK_MS = 15 * 60_000;

export interface Prefs { rest: boolean; left: boolean; nudge: boolean; badge: boolean; streak: boolean }
export const DEFAULT_PREFS: Prefs = { rest: true, left: true, nudge: false, badge: true, streak: true };

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
export interface PushPayload { type: 'rest' | 'left' | 'nudge' | 'streak' | 'test'; title: string; body: string; tag: string; url: string; badge?: number; ts: number }
export interface SendOpts { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic?: string }
/** Delivers one encrypted-by-the-sender push. Injectable for tests. */
export type Sender = (sub: PushSub, payload: string, o: SendOpts) => Promise<{ status: number }>;

export interface PushOpts {
  now?: () => number;
  sender?: Sender;
  env?: Record<string, string | undefined>;
  /** timers for rest delivery (default setTimeout/clearTimeout) */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  /** start the background sweep interval (default true; tests pass false) */
  auto?: boolean;
}

// ───────────────────────── base64url + validation ─────────────────────────
const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const B64U_RE = /^[A-Za-z0-9_-]+$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** True for addresses a push endpoint must never resolve to. */
export function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) {
    const [a, b] = addr.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (v === 6) {
    const x = addr.toLowerCase();
    if (x === '::' || x === '::1') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7)) || !x.slice(7).includes('.'); // v4-mapped (dotted or hex form)
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('64:ff9b') || x.startsWith('2001:db8');
  }
  return true; // not an IP at all: treat as unsafe
}

/** Syntactic SSRF gate for a subscription endpoint (the DNS result is checked again at send time). */
export function isSafeEndpoint(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 1000) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.hash) return false;
  if (u.port && u.port !== '443') return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h || h.startsWith('[') || isIP(h)) return false; // IP literals (incl. every v4 spelling, which URL normalises) are never legit push hosts
  if (!h.includes('.')) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(h)) return false;
  if (!/^[a-z0-9.-]+$/.test(h)) return false;
  return true;
}

async function validKeys(k: unknown): Promise<PushSub['keys'] | null> {
  const o = k as { p256dh?: unknown; auth?: unknown } | null;
  if (!o || typeof o.p256dh !== 'string' || typeof o.auth !== 'string') return null;
  if (!B64U_RE.test(o.p256dh) || !B64U_RE.test(o.auth)) return null;
  const pub = unb64u(o.p256dh);
  if (pub.length !== 65 || pub[0] !== 4 || unb64u(o.auth).length !== 16) return null;
  try { await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch { return null; } // must be a point on the curve
  return { p256dh: o.p256dh, auth: o.auth };
}

function cleanPrefs(p: unknown, base: Prefs = DEFAULT_PREFS): Prefs {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  const pick = (k: keyof Prefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : base[k]);
  return { rest: pick('rest'), left: pick('left'), nudge: pick('nudge'), badge: pick('badge'), streak: pick('streak') };
}
const cleanTz = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isInteger(v) && v >= -840 && v <= 840 ? v : fallback);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');

// ───────────────────────── VAPID ─────────────────────────
export interface Vapid { publicKey: string; privateKey: CryptoKey; subject: string }

async function importPrivate(pubB64: string, dB64: string): Promise<CryptoKey> {
  const pub = unb64u(pubB64);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC must be a 65-byte uncompressed P-256 point (base64url)');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: dB64 };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** VAPID keys from env (VAPID_PUBLIC / VAPID_PRIVATE as raw base64url, web-push compatible) or generated once and persisted. */
export async function loadVapid(db: Db, env: Record<string, string | undefined>): Promise<Vapid> {
  const subject = env.VAPID_SUBJECT || (env.PUBLIC_URL?.startsWith('https://') ? env.PUBLIC_URL : 'mailto:admin@example.com');
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE) return { publicKey: env.VAPID_PUBLIC, privateKey: await importPrivate(env.VAPID_PUBLIC, env.VAPID_PRIVATE), subject };
  db.exec('CREATE TABLE IF NOT EXISTS push_vapid (id INTEGER PRIMARY KEY CHECK (id=1), pub TEXT NOT NULL, d TEXT NOT NULL)');
  const row = db.query<{ pub: string; d: string }, []>('SELECT pub,d FROM push_vapid WHERE id=1').get();
  if (row) return { publicKey: row.pub, privateKey: await importPrivate(row.pub, row.d), subject };
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  db.query('INSERT OR IGNORE INTO push_vapid(id,pub,d) VALUES(1,?,?)').run(pub, jwk.d!);
  const stored = db.query<{ pub: string; d: string }, []>('SELECT pub,d FROM push_vapid WHERE id=1').get()!; // lost a race → use the winner
  return { publicKey: stored.pub, privateKey: await importPrivate(stored.pub, stored.d), subject };
}

export async function vapidHeader(v: Vapid, endpoint: string, nowMs: number): Promise<string> {
  const enc = (o: unknown) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const body = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: v.subject })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.privateKey, new TextEncoder().encode(body)); // raw r||s = JWS ES256
  return `vapid t=${body}.${b64u(sig)}, k=${v.publicKey}`;
}

// ───────────────────────── RFC 8291 aes128gcm encryption ─────────────────────────
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bytes: number) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']), bytes * 8));

/** Encrypt `plain` for a subscription (single record). `eph`/`salt` are injectable only for deterministic tests. */
export async function encryptPayload(keys: PushSub['keys'], plain: Uint8Array, eph?: CryptoKeyPair, salt?: Uint8Array): Promise<Uint8Array> {
  if (plain.length > 3993) throw new Error('payload too large'); // one 4096-byte record = 86 header + 16 tag + 1 delimiter + plaintext
  const uaPub = unb64u(keys.p256dh), auth = unb64u(keys.auth);
  const as = eph ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(secret, auth, cat(new TextEncoder().encode('WebPush: info\0'), uaPub, asPub), 32);
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, s, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, s, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']), cat(plain, new Uint8Array([2]))));
  return cat(s, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

// ───────────────────────── default sender (real network) ─────────────────────────
export function makeSender(v: Vapid, clock: () => number, fetchImpl: typeof fetch = fetch): Sender {
  return async (sub, payload, o) => {
    if (!isSafeEndpoint(sub.endpoint)) return { status: 410 }; // stored before the rules tightened: drop it
    const host = new URL(sub.endpoint).hostname;
    const addrs = await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) return { status: 0 }; // transient DNS failure
    if (addrs.some((a) => isPrivateAddress(a.address))) return { status: 410 }; // resolves inside our network: never talk to it
    const body = await encryptPayload(sub.keys, new TextEncoder().encode(payload));
    const headers: Record<string, string> = {
      authorization: await vapidHeader(v, sub.endpoint, clock()), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream',
      ttl: String(o.ttl), urgency: o.urgency,
    };
    if (o.topic) headers.topic = o.topic;
    try {
      const r = await fetchImpl(sub.endpoint, { method: 'POST', headers, body: body as BodyInit, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      return { status: r.status };
    } catch { return { status: 0 }; }
  };
}

// ───────────────────────── time helpers (user-local via tz offset) ─────────────────────────
/** Fields of the user's local wall clock. `tz` = minutes from `Date#getTimezoneOffset()` (UTC − local). */
export function localParts(ts: number, tz: number) {
  const d = new Date(ts - tz * 60_000);
  return { dow: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours(), minute: d.getUTCMinutes(), dayStartUtc: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + tz * 60_000 };
}
const weekStartTz = (ts: number, tz: number) => { const p = localParts(ts, tz); return p.dayStartUtc - p.dow * 86400_000; }; // DST drift of ±1h is irrelevant at 1-week granularity
export const inQuietHours = (ts: number, tz: number) => { const h = localParts(ts, tz).hour; return h >= QUIET_FROM_H || h < QUIET_TO_H; };
const hhmm = (ts: number, tz: number) => { const p = localParts(ts, tz); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };

// ───────────────────────── module ─────────────────────────
interface SubRow { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; prefs: string; tz: number; created_at: number; fails: number }

export interface PushController {
  app: Hono;
  /** Send every rest whose time has come (timers call this; tests call it after advancing the clock). */
  flushRests(): Promise<number>;
  /** One sweep of the session-left-running + weekly nudges. */
  tick(): Promise<number>;
  /** Re-arm timers from the DB (boot). */
  restore(): void;
  /** Stop timers + interval. */
  stop(): void;
}

export function createPush(db: Db, opts: PushOpts = {}): PushController {
  const clock = opts.now ?? Date.now;
  const env = opts.env ?? process.env;
  const setT = opts.setTimer ?? ((fn: () => void, ms: number) => { const h = setTimeout(fn, ms); (h as { unref?: () => void }).unref?.(); return h; });
  const clearT = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const app = new Hono<{ Variables: { uid: string } }>();

  db.exec(`
    CREATE TABLE IF NOT EXISTS push_vapid (id INTEGER PRIMARY KEY CHECK (id=1), pub TEXT NOT NULL, d TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
      prefs TEXT NOT NULL, tz INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, fails INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
    CREATE TABLE IF NOT EXISTS push_rest (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ends_at INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_session (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, started_at INTEGER NOT NULL, last_logged_at INTEGER, last_beat INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_weekly (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, week_start INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS push_streak (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, day_start INTEGER NOT NULL, kind TEXT NOT NULL);
  `);

  let vapidP: Promise<Vapid> | null = null;
  const vapid = () => (vapidP ??= loadVapid(db, env));
  let senderP: Promise<Sender> | null = null;
  const sender = () => opts.sender ? Promise.resolve(opts.sender) : (senderP ??= vapid().then((v) => makeSender(v, clock)));

  const q = {
    tokenUser: db.query<{ user_id: string }, [string]>('SELECT user_id FROM tokens WHERE hash=?'),
    touch: db.query('UPDATE tokens SET last_used=? WHERE hash=?'),
    subsOf: db.query<SubRow, [string]>('SELECT * FROM push_subs WHERE user_id=? ORDER BY created_at'),
    subByEndpoint: db.query<SubRow, [string]>('SELECT * FROM push_subs WHERE endpoint=?'),
    delSub: db.query('DELETE FROM push_subs WHERE id=?'),
    upsertSub: db.query('INSERT INTO push_subs(id,user_id,endpoint,p256dh,auth,prefs,tz,created_at,fails) VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,prefs=excluded.prefs,tz=excluded.tz,fails=0'),
    setPrefs: db.query('UPDATE push_subs SET prefs=?, tz=? WHERE id=?'),
    fail: db.query('UPDATE push_subs SET fails=fails+1 WHERE id=?'),
    ok: db.query('UPDATE push_subs SET fails=0 WHERE id=?'),
    putRest: db.query('INSERT INTO push_rest(user_id,ends_at,title,body) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ends_at=excluded.ends_at,title=excluded.title,body=excluded.body'),
    delRest: db.query('DELETE FROM push_rest WHERE user_id=?'),
    claimDue: db.query<{ user_id: string; title: string; body: string; ends_at: number }, [number]>('DELETE FROM push_rest WHERE ends_at<=? RETURNING user_id,title,body,ends_at'),
    allRest: db.query<{ user_id: string; ends_at: number }, []>('SELECT user_id,ends_at FROM push_rest'),
    dropStaleRest: db.query('DELETE FROM push_rest WHERE ends_at<?'),
    putSession: db.query('INSERT INTO push_session(user_id,seq,started_at,last_logged_at,last_beat) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET seq=excluded.seq,started_at=excluded.started_at,last_logged_at=excluded.last_logged_at,last_beat=excluded.last_beat'),
    delSession: db.query('DELETE FROM push_session WHERE user_id=?'),
    claimStale: db.query<{ user_id: string; seq: number; started_at: number; last_logged_at: number | null }, [number, number]>(
      'DELETE FROM push_session WHERE last_beat<=? AND COALESCE(last_logged_at,started_at)<=? RETURNING user_id,seq,started_at,last_logged_at'),
    dropOldSessions: db.query('DELETE FROM push_session WHERE last_beat<?'),
    weeklyUsers: db.query<{ user_id: string }, []>("SELECT DISTINCT user_id FROM push_subs WHERE json_extract(prefs,'$.nudge')=1"),
    weeklyGet: db.query<{ week_start: number }, [string]>('SELECT week_start FROM push_weekly WHERE user_id=?'),
    weeklyPut: db.query('INSERT INTO push_weekly(user_id,week_start) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET week_start=excluded.week_start'),
    streakUsers: db.query<{ user_id: string }, []>("SELECT DISTINCT user_id FROM push_subs WHERE COALESCE(json_extract(prefs,'$.streak'),1)=1"),
    streakGet: db.query<{ day_start: number }, [string]>('SELECT day_start FROM push_streak WHERE user_id=?'),
    streakPut: db.query('INSERT INTO push_streak(user_id,day_start,kind) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET day_start=excluded.day_start,kind=excluded.kind'),
    ents: db.query<{ type: string; json: string }, [string]>("SELECT type,json FROM entities WHERE user_id=? AND deleted=0 AND type IN ('session','settings','area')"),
  };

  // ── sending ──
  const prefsOf = (r: SubRow): Prefs => { try { return cleanPrefs(JSON.parse(r.prefs)); } catch { return DEFAULT_PREFS; } };

  /** Deliver to every subscription of `uid` that has `pref` on (and `quiet` respected when asked). Returns delivered count. */
  async function deliver(uid: string, pref: keyof Prefs, payload: PushPayload, o: SendOpts, respectQuiet = false): Promise<number> {
    const send = await sender();
    let delivered = 0;
    for (const r of q.subsOf.all(uid)) {
      const p = prefsOf(r);
      if (!p[pref]) continue;
      if (respectQuiet && inQuietHours(clock(), r.tz)) continue;
      const body = JSON.stringify(p.badge ? payload : { ...payload, badge: undefined });
      let status = 0;
      try { status = (await send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, body, o)).status; } catch { status = 0; }
      if (status >= 200 && status < 300) { delivered++; if (r.fails) q.ok.run(r.id); }
      else if (status === 404 || status === 410) q.delSub.run(r.id);
      else { q.fail.run(r.id); if (r.fails + 1 >= FAIL_LIMIT) q.delSub.run(r.id); }
    }
    return delivered;
  }

  // ── rest timers ──
  const timers = new Map<string, unknown>();
  function arm(uid: string, endsAt: number) {
    const old = timers.get(uid); if (old !== undefined) clearT(old);
    timers.set(uid, setT(() => { timers.delete(uid); void flushRests(); }, Math.max(0, endsAt - clock())));
  }
  function disarm(uid: string) { const old = timers.get(uid); if (old !== undefined) { clearT(old); timers.delete(uid); } }

  async function flushRests(): Promise<number> {
    const t = clock();
    q.dropStaleRest.run(t - STALE_REST_MS);
    const due = q.claimDue.all(t);
    let n = 0;
    for (const r of due) {
      disarm(r.user_id);
      n += await deliver(r.user_id, 'rest', { type: 'rest', title: r.title, body: r.body, tag: 'rest', url: '/app/session/live', badge: weekBadge(r.user_id), ts: r.ends_at }, { ttl: 120, urgency: 'high', topic: 'rest' });
    }
    return n;
  }

  function restore() {
    const t = clock();
    q.dropStaleRest.run(t - STALE_REST_MS);
    for (const r of q.allRest.all()) arm(r.user_id, r.ends_at);
  }

  // ── session / weekly data from synced entities ──
  function userData(uid: string) {
    let settings: { weeklyGoal?: number; rotation?: string[]; targetMinutes?: number; goalHistory?: { from: number; goal: number }[]; manualFreezeWeeks?: number[]; streakLastCelebrated?: number } = {};
    const sessions: Session[] = []; const areas: Record<string, string> = {};
    for (const r of q.ents.all(uid)) {
      try {
        const j = JSON.parse(r.json);
        if (r.type === 'settings') settings = j; else if (r.type === 'session') sessions.push(j); else if (r.type === 'area' && j?.id) areas[j.id] = String(j.name ?? '');
      } catch { /* skip corrupt row */ }
    }
    return { settings, sessions, areas };
  }
  /** Sessions left this week (for the icon badge); undefined when the user has no goal/data. */
  function weekBadge(uid: string): number | undefined {
    const subs = q.subsOf.all(uid); if (!subs.length) return undefined;
    const { settings, sessions } = userData(uid);
    if (!settings.weeklyGoal) return undefined;
    const goal = goalForWeek(settings, clock(), subs[0].tz);
    const ws = weekStartTz(clock(), subs[0].tz);
    const done = sessions.filter((s) => s.status === 'completed' && (s.endedAt ?? s.startedAt) >= ws).length;
    return Math.max(0, goal - done);
  }

  // ── nudges ──
  async function leftRunning(): Promise<number> {
    const t = clock();
    q.dropOldSessions.run(t - SESSION_FORGET_MS);
    let n = 0;
    for (const r of q.claimStale.all(t - BEAT_SILENT_MS, t - LEFT_AFTER_MS)) {
      // claimed (and so removed) first: at most one nudge per session, even if delivery is skipped by quiet hours
      const tz = q.subsOf.get(r.user_id)?.tz ?? 0;
      n += await deliver(r.user_id, 'left', {
        type: 'left', title: `Session ${r.seq} is still running`,
        body: r.last_logged_at ? `Last set logged ${hhmm(r.last_logged_at, tz)}. Tap to finish and save it.` : `Started ${hhmm(r.started_at, tz)}, nothing logged yet. Tap to finish and save it.`,
        tag: 'left', url: '/app/resume', badge: weekBadge(r.user_id), ts: t,
      }, { ttl: 6 * 3600, urgency: 'normal', topic: 'left' }, true);
    }
    return n;
  }

  async function weekly(): Promise<number> {
    const t = clock();
    let n = 0;
    for (const { user_id: uid } of q.weeklyUsers.all()) {
      const subs = q.subsOf.all(uid).filter((s) => prefsOf(s).nudge);
      if (!subs.length) continue;
      const tz = subs[0].tz;
      const p = localParts(t, tz);
      if (p.dow !== 4 || p.hour < 9 || p.hour >= 12) continue; // Friday morning only
      const ws = weekStartTz(t, tz);
      if (q.weeklyGet.get(uid)?.week_start === ws) continue;
      const { settings, sessions, areas } = userData(uid);
      const goal = settings.weeklyGoal ? goalForWeek(settings, t, tz) : 0;
      const done = sessions.filter((s) => s.status === 'completed' && (s.endedAt ?? s.startedAt) >= ws).length;
      if (!goal || done >= goal) { q.weeklyPut.run(uid, ws); continue; } // not behind → say nothing
      const left = goal - done;
      const rot = settings.rotation ?? [];
      const area = rot.length ? areas[rot[nextSlot(sessions, rot.length) - 1]] : '';
      const last = sessions.filter((s) => s.status === 'completed').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
      const min = settings.targetMinutes ?? last?.targetMin;
      q.weeklyPut.run(uid, ws); // once per week, even if delivery fails: never nag
      n += await deliver(uid, 'nudge', {
        type: 'nudge', title: `${left} ${left === 1 ? 'session' : 'sessions'} left this week`,
        body: area && min ? `Next up: ${area}, about ${min} min.` : area ? `Next up: ${area}.` : 'Whenever you have a window, one is enough to stay on track.',
        tag: 'nudge', url: '/app/', badge: left, ts: t,
      }, { ttl: 6 * 3600, urgency: 'low', topic: 'nudge' });
    }
    return n;
  }
  const streakChecked = new Map<string, number>();
  async function streakReminders(): Promise<number> {
    const t = clock();
    let n = 0;
    for (const { user_id: uid } of q.streakUsers.all()) {
      const subs = q.subsOf.all(uid).filter((s) => prefsOf(s).streak);
      if (!subs.length) continue;
      const tz = subs[0].tz;
      const hour = makeCal(tz).hour(t);
      if (inStreakQuietHours(hour) || hour < REMINDER_HOUR) continue; // 08:00-20:59 local only
      const last = streakChecked.get(uid);
      if (last !== undefined && t - last < STREAK_CHECK_MS) continue;
      streakChecked.set(uid, t);
      const dayStart = makeCal(tz).dayStart(t);
      if (q.streakGet.get(uid)?.day_start === dayStart) continue; // one a day
      const { settings, sessions } = userData(uid);
      const done = sessions.filter((s) => s.status === 'completed');
      if (!done.length) continue;
      const view = computeStreak(sessions, settings, t, { tz });
      const r = streakReminder(view, { now: t, tz, trainHour: usualTrainHour(sessions, t, tz) });
      if (!r) continue;
      q.streakPut.run(uid, dayStart, r.kind); // claimed before sending: never twice in a day, even if delivery fails
      n += await deliver(uid, 'streak', { type: 'streak', title: r.title, body: r.body, tag: r.tag, url: r.url, badge: weekBadge(uid), ts: t }, { ttl: Math.max(60, Math.floor((makeCal(tz).dayStart(t) + 21 * 3600_000 - t) / 1000)), urgency: 'normal', topic: 'streak' });
    }
    if (streakChecked.size > 5000) for (const [k, v] of streakChecked) if (t - v > STREAK_CHECK_MS) streakChecked.delete(k);
    return n;
  }
  async function tick(): Promise<number> { return (await leftRunning()) + (await weekly()) + (await streakReminders()); }

  // ── auth, rate limiting ──
  const hits = new Map<string, { n: number; reset: number }>();
  const limit = (key: string, max: number, windowMs: number): number => {
    const t = clock();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < t) { hits.set(key, { n: 1, reset: t + windowMs }); return 0; }
    if (h.n >= max) return Math.max(1, Math.ceil((h.reset - t) / 1000));
    h.n++; return 0;
  };
  const limited = (c: Context, wait: number) => { c.header('Retry-After', String(wait)); return c.json({ error: 'rate_limited', retryAfter: wait }, 429); };

  app.use('*', async (c, next) => {
    const h = c.req.header('authorization') ?? '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    const row = tok ? q.tokenUser.get(sha(tok)) : null;
    if (!row) return c.json({ error: 'unauthorized' }, 401);
    q.touch.run(clock(), sha(tok));
    c.set('uid', row.user_id);
    await next();
  });

  app.get('/key', async (c) => c.json({ key: (await vapid()).publicKey }));

  app.post('/subscribe', async (c) => {
    const uid = c.get('uid');
    const wait = limit(`sub:${uid}`, 20, 3600_000); if (wait) return limited(c, wait);
    const b = await c.req.json().catch(() => null);
    const s = b?.subscription;
    if (!s || !isSafeEndpoint(s.endpoint)) return c.json({ error: 'invalid_endpoint' }, 400);
    const keys = await validKeys(s.keys);
    if (!keys) return c.json({ error: 'invalid_keys' }, 400);
    const existing = q.subByEndpoint.get(s.endpoint);
    const prefs = cleanPrefs(b.prefs, existing && existing.user_id === uid ? prefsOf(existing) : DEFAULT_PREFS);
    const tz = cleanTz(b.tz, existing?.tz ?? 0);
    db.transaction(() => {
      const mine = q.subsOf.all(uid).filter((r) => r.endpoint !== s.endpoint);
      for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_SUBS_PER_USER - 1)))) q.delSub.run(old.id); // evict oldest beyond the cap
      q.upsertSub.run(existing?.id ?? randomUUID(), uid, s.endpoint, keys.p256dh, keys.auth, JSON.stringify(prefs), tz, clock());
    })();
    return c.json({ ok: true, prefs });
  });

  app.post('/unsubscribe', async (c) => {
    const b = await c.req.json().catch(() => null);
    const r = typeof b?.endpoint === 'string' ? q.subByEndpoint.get(b.endpoint) : null;
    if (r && r.user_id === c.get('uid')) q.delSub.run(r.id);
    return c.json({ ok: true });
  });

  app.put('/prefs', async (c) => {
    const uid = c.get('uid');
    const wait = limit(`pref:${uid}`, 60, 3600_000); if (wait) return limited(c, wait);
    const b = await c.req.json().catch(() => null);
    const r = typeof b?.endpoint === 'string' ? q.subByEndpoint.get(b.endpoint) : null;
    if (!r || r.user_id !== uid) return c.json({ error: 'not_subscribed' }, 404);
    const prefs = cleanPrefs(b.prefs, prefsOf(r));
    q.setPrefs.run(JSON.stringify(prefs), cleanTz(b.tz, r.tz), r.id);
    return c.json({ ok: true, prefs });
  });

  app.get('/status', (c) => {
    const ep = c.req.query('endpoint') ?? '';
    const r = ep ? q.subByEndpoint.get(ep) : null;
    return r && r.user_id === c.get('uid') ? c.json({ subscribed: true, prefs: prefsOf(r) }) : c.json({ subscribed: false, prefs: DEFAULT_PREFS });
  });

  app.post('/rest', async (c) => {
    const uid = c.get('uid');
    const wait = limit(`rest:${uid}`, 300, 3600_000); if (wait) return limited(c, wait);
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b.endsAt !== 'number' || !Number.isFinite(b.endsAt)) return c.json({ error: 'invalid_endsAt' }, 400);
    const t = clock();
    // correct a skewed phone clock: shift by (server now − client now) when the client tells us its `now`
    const skew = typeof b.now === 'number' && Number.isFinite(b.now) && Math.abs(t - b.now) < 10 * 60_000 ? t - b.now : 0;
    const endsAt = Math.round(b.endsAt + skew);
    if (endsAt < t - 5000 || endsAt > t + MAX_REST_AHEAD_MS) return c.json({ error: 'endsAt_out_of_range' }, 400);
    if (!q.subsOf.all(uid).some((r) => prefsOf(r).rest)) { q.delRest.run(uid); disarm(uid); return c.json({ ok: true, scheduled: false }); }
    const label = clip(b.label, 120);
    q.putRest.run(uid, endsAt, clip(b.title, 80) || 'Rest over', label ? `${label}. Let's go.` : "Your next set is ready. Let's go.");
    arm(uid, endsAt);
    return c.json({ ok: true, scheduled: true, endsAt });
  });

  app.delete('/rest', (c) => { q.delRest.run(c.get('uid')); disarm(c.get('uid')); return c.json({ ok: true }); });

  app.post('/session', async (c) => {
    const uid = c.get('uid');
    const wait = limit(`sess:${uid}`, 240, 3600_000); if (wait) return limited(c, wait);
    const b = await c.req.json().catch(() => null);
    const t = clock();
    const okTs = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > t - 24 * 3600_000 && v <= t + 60_000;
    if (!b || !Number.isInteger(b.seq) || b.seq < 1 || b.seq > 1e6 || !okTs(b.startedAt)) return c.json({ error: 'invalid_session' }, 400);
    const last = b.lastLoggedAt == null ? null : okTs(b.lastLoggedAt) ? Math.round(b.lastLoggedAt) : undefined;
    if (last === undefined) return c.json({ error: 'invalid_lastLoggedAt' }, 400);
    q.putSession.run(uid, b.seq, Math.round(b.startedAt), last, t);
    return c.json({ ok: true });
  });
  app.delete('/session', (c) => { q.delSession.run(c.get('uid')); return c.json({ ok: true }); });

  // ── background ──
  let interval: ReturnType<typeof setInterval> | null = null;
  if (opts.auto !== false) {
    restore();
    interval = setInterval(() => { void flushRests().catch(() => {}); void tick().catch(() => {}); }, SWEEP_MS);
    (interval as { unref?: () => void }).unref?.();
  }
  const stop = () => { if (interval) clearInterval(interval); interval = null; for (const h of timers.values()) clearT(h); timers.clear(); };

  return { app: app as unknown as Hono, flushRests, tick, restore, stop };
}

export default function build(db: Db): Hono {
  return createPush(db).app;
}
