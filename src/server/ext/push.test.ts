import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { openDb } from '../db';
import { buildApi } from '../api';
import { Hono } from 'hono';
import {
  BEAT_SILENT_MS, LEFT_AFTER_MS, MAX_SUBS_PER_USER, STALE_REST_MS, createPush, encryptPayload, inQuietHours, isPrivateAddress, isSafeEndpoint, loadVapid, localParts, vapidHeader,
  type PushPayload, type PushSub, type SendOpts,
} from './push';

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const MIN = 60_000;
// 2026-11-20 is a Friday. 08:00 UTC = 09:00 in Stockholm (tz offset −60).
const FRI_09_SE = Date.UTC(2026, 10, 20, 8, 0, 0);

interface Sent { sub: PushSub; payload: PushPayload; opts: SendOpts }
async function newSub(n: number) {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, auth, json: { endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64u(auth) } } };
}

function mk(start = FRI_09_SE - 3 * 86400_000) {
  const db = openDb(':memory:');
  let t = start;
  const clock = { now: () => t, set: (v: number) => { t = v; }, advance: (ms: number) => { t += ms; } };
  const sent: Sent[] = [];
  const status = { next: 201 as number | ((s: PushSub) => number) };
  const timers: { fn: () => void; ms: number; id: number; live: boolean }[] = [];
  const push = createPush(db, {
    now: clock.now, auto: false, env: {},
    sender: async (sub, payload, opts) => { sent.push({ sub, payload: JSON.parse(payload), opts }); return { status: typeof status.next === 'function' ? status.next(sub) : status.next }; },
    setTimer: (fn, ms) => { const h = { fn, ms, id: timers.length, live: true }; timers.push(h); return h; },
    clearTimer: (h) => { (h as { live: boolean }).live = false; },
  });
  const app = new Hono();
  app.route('/api/push', push.app); // extensions are mounted before buildApi (its catch-all would shadow them)
  app.route('/api', buildApi(db));
  const raw = async (method: string, path: string, token: string | null, json?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: json === undefined ? undefined : JSON.stringify(json) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const user = async () => {
    const r = await raw('POST', '/auth/anon', null, {});
    return { token: r.body.token as string, id: r.body.userId as string };
  };
  return { db, push, clock, sent, status, timers, raw, user };
}
type Ctx = ReturnType<typeof mk>;

async function subscribed(c: Ctx, n = 1, prefs?: object, tz = -60) {
  const u = await c.user();
  const s = await newSub(n);
  const r = await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json, prefs, tz });
  expect(r.status).toBe(200);
  return { u, s };
}

describe('auth + key', () => {
  test('every endpoint needs the session token', async () => {
    const c = mk();
    for (const [m, p] of [['GET', '/push/key'], ['POST', '/push/subscribe'], ['POST', '/push/unsubscribe'], ['PUT', '/push/prefs'], ['GET', '/push/status'], ['POST', '/push/rest'], ['DELETE', '/push/rest'], ['POST', '/push/session'], ['DELETE', '/push/session']] as const) {
      expect((await c.raw(m, p, null, {})).status).toBe(401);
      expect((await c.raw(m, p, 'nope', {})).status).toBe(401);
    }
  });
  test('VAPID key is generated once and persisted; env keys win', async () => {
    const c = mk(); const u = await c.user();
    const k1 = (await c.raw('GET', '/push/key', u.token)).body.key as string;
    expect(unb64u(k1).length).toBe(65);
    expect(unb64u(k1)[0]).toBe(4);
    expect((await c.raw('GET', '/push/key', u.token)).body.key).toBe(k1);
    const again = createPush(c.db, { auto: false, env: {} }); // "reboot": same DB
    const a2 = new Hono(); a2.route('/api/push', again.app);
    const r = await a2.request('/api/push/key', { headers: { authorization: `Bearer ${u.token}` } });
    expect((await r.json() as any).key).toBe(k1);

    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])) as CryptoKeyPair;
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    const d = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d!;
    const env = await loadVapid(openDb(':memory:'), { VAPID_PUBLIC: pub, VAPID_PRIVATE: d, VAPID_SUBJECT: 'mailto:a@b.se' });
    expect(env.publicKey).toBe(pub);
    expect(env.subject).toBe('mailto:a@b.se');
  });
  test('VAPID JWT verifies against the public key and carries aud/sub/exp', async () => {
    const db = openDb(':memory:');
    const v = await loadVapid(db, { VAPID_SUBJECT: 'mailto:ops@example.com' });
    const h = await vapidHeader(v, 'https://fcm.googleapis.com/fcm/send/abc', 1_700_000_000_000);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    expect(m[4]).toBe(v.publicKey);
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:ops@example.com' });
    const pub = await crypto.subtle.importKey('raw', unb64u(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true);
  });
});

describe('RFC 8291 encryption', () => {
  test('round-trips through an independent user-agent-side decryptor', async () => {
    const s = await newSub(1);
    const plain = new TextEncoder().encode(JSON.stringify({ title: 'Rest over', body: 'Back squat · 82.5 kg × 6. Let\'s go.' }));
    const body = await encryptPayload(s.json.keys, plain);
    // header: salt(16) rs(4) idlen(1) keyid(65)
    const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20];
    expect(rs).toBe(4096); expect(idlen).toBe(65);
    const asPub = body.slice(21, 86), ct = body.slice(86);
    const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, s.kp.privateKey, 256));
    const uaPub = unb64u(s.json.keys.p256dh);
    const info = new Uint8Array([...new TextEncoder().encode('WebPush: info\0'), ...uaPub, ...asPub]);
    const hk = async (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']), n * 8));
    const ikm = await hk(secret, s.auth, info, 32);
    const cek = await hk(ikm, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hk(ikm, salt, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
    const out = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
    expect(out[out.length - 1]).toBe(2); // last-record delimiter
    expect(new TextDecoder().decode(out.slice(0, -1))).toBe(new TextDecoder().decode(plain));
  });
  test('rejects payloads that do not fit one record', async () => {
    const s = await newSub(1);
    expect(encryptPayload(s.json.keys, new Uint8Array(4000))).rejects.toThrow();
  });
});

describe('SSRF / validation', () => {
  test('endpoint gate', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://a.notify.windows.com:443/w'])
      expect(isSafeEndpoint(ok)).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/x', 'ftp://a.b.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x',
      'https://169.254.169.254/latest/meta-data', 'https://2130706433/x', 'https://0x7f.1/x', 'https://017700000001/x', 'https://foo.internal/x', 'https://foo.local/x', 'https://intranet/x',
      'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://fcm.googleapis.com/x#frag', 'not a url', '', 'https://' + 'a'.repeat(1100) + '.com/x', 42, null, undefined,
    ]) expect(isSafeEndpoint(bad)).toBe(false);
  });
  test('private address ranges', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'])
      expect(isPrivateAddress(a)).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '142.250.74.14', '2a00:1450:4001:81b::200e']) expect(isPrivateAddress(a)).toBe(false);
  });
  test('subscribe rejects bad endpoints and keys', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    const bad = async (sub: unknown) => (await c.raw('POST', '/push/subscribe', u.token, { subscription: sub })).body?.error;
    expect(await bad({ ...s.json, endpoint: 'http://push.example.com/x' })).toBe('invalid_endpoint');
    expect(await bad({ ...s.json, endpoint: 'https://127.0.0.1/x' })).toBe('invalid_endpoint');
    expect(await bad(null)).toBe('invalid_endpoint');
    expect(await bad({ endpoint: s.json.endpoint })).toBe('invalid_keys');
    expect(await bad({ endpoint: s.json.endpoint, keys: { p256dh: 'AAAA', auth: s.json.keys.auth } })).toBe('invalid_keys');
    expect(await bad({ endpoint: s.json.endpoint, keys: { p256dh: s.json.keys.p256dh, auth: 'AAAA' } })).toBe('invalid_keys');
    const offCurve = b64u(new Uint8Array([4, ...new Uint8Array(64).fill(1)]));
    expect(await bad({ endpoint: s.json.endpoint, keys: { p256dh: offCurve, auth: s.json.keys.auth } })).toBe('invalid_keys');
    expect((await c.raw('POST', '/push/subscribe', u.token)).status).toBe(400);
    expect(c.db.query('SELECT COUNT(*) n FROM push_subs').get()).toEqual({ n: 0 });
  });
  test('per-user cap evicts the oldest; resubscribing the same endpoint is idempotent', async () => {
    const c = mk(); const u = await c.user();
    const subs = [];
    for (let i = 0; i < MAX_SUBS_PER_USER + 2; i++) { const s = await newSub(i); subs.push(s); c.clock.advance(1000); expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json })).status).toBe(200); }
    const rows = c.db.query<{ endpoint: string }, []>('SELECT endpoint FROM push_subs ORDER BY created_at').all().map((r) => r.endpoint);
    expect(rows).toHaveLength(MAX_SUBS_PER_USER);
    expect(rows[0]).toBe(subs[2].json.endpoint);
    await c.raw('POST', '/push/subscribe', u.token, { subscription: subs[5].json });
    expect(c.db.query('SELECT COUNT(*) n FROM push_subs').get()).toEqual({ n: MAX_SUBS_PER_USER });
  });
  test('rate limits subscribe and returns Retry-After; window resets with the clock', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    let last: any;
    for (let i = 0; i < 21; i++) last = await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json });
    expect(last.status).toBe(429);
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    c.clock.advance(3600_000 + 1);
    expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json })).status).toBe(200);
  });
  test('users cannot read or change each other\'s subscription', async () => {
    const c = mk(); const { s } = await subscribed(c); const other = await c.user();
    expect((await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.json.endpoint)}`, other.token)).body.subscribed).toBe(false);
    expect((await c.raw('PUT', '/push/prefs', other.token, { endpoint: s.json.endpoint, prefs: { rest: false } })).status).toBe(404);
    await c.raw('POST', '/push/unsubscribe', other.token, { endpoint: s.json.endpoint });
    expect(c.db.query('SELECT COUNT(*) n FROM push_subs').get()).toEqual({ n: 1 });
  });
});

describe('subscription + prefs', () => {
  test('defaults: rest/left/badge on, weekly nudge off; prefs update; unsubscribe', async () => {
    const c = mk(); const { u, s } = await subscribed(c);
    const st = async () => (await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.json.endpoint)}`, u.token)).body;
    expect(await st()).toEqual({ subscribed: true, prefs: { rest: true, left: true, nudge: false, badge: true, streak: true } });
    expect((await c.raw('PUT', '/push/prefs', u.token, { endpoint: s.json.endpoint, prefs: { nudge: true, rest: false, junk: 1, left: 'yes' } })).body.prefs).toEqual({ rest: false, left: true, nudge: true, badge: true, streak: true });
    expect((await st()).prefs.nudge).toBe(true);
    await c.raw('POST', '/push/unsubscribe', u.token, { endpoint: s.json.endpoint });
    expect((await st()).subscribed).toBe(false);
    expect((await c.raw('PUT', '/push/prefs', u.token, { endpoint: s.json.endpoint, prefs: {} })).status).toBe(404);
  });
  test('resubscribing keeps existing prefs unless new ones are given', async () => {
    const c = mk(); const { u, s } = await subscribed(c, 1, { rest: false });
    await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json });
    expect((await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.json.endpoint)}`, u.token)).body.prefs.rest).toBe(false);
  });
  test('deleting the user cascades to subscriptions, rests and sessions', async () => {
    const c = mk(); const { u } = await subscribed(c);
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 90_000, label: 'x' });
    await c.raw('POST', '/push/session', u.token, { seq: 1, startedAt: c.clock.now() });
    await c.raw('DELETE', '/account', u.token);
    for (const t of ['push_subs', 'push_rest', 'push_session']) expect(c.db.query(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
  });
});

describe('rest-over', () => {
  test('is sent once at endsAt with the lock-screen copy; not before', async () => {
    const c = mk(); const { u, s } = await subscribed(c);
    const ends = c.clock.now() + 90_000;
    const r = await c.raw('POST', '/push/rest', u.token, { endsAt: ends, title: 'Rest over: set 3 of 4', label: 'Back squat · 82.5 kg × 6' });
    expect(r.body).toEqual({ ok: true, scheduled: true, endsAt: ends });
    expect(c.timers.at(-1)!.ms).toBe(90_000);
    c.clock.advance(89_000); expect(await c.push.flushRests()).toBe(0); expect(c.sent).toHaveLength(0);
    c.clock.advance(1_000); expect(await c.push.flushRests()).toBe(1);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0].sub.endpoint).toBe(s.json.endpoint);
    expect(c.sent[0].payload).toMatchObject({ type: 'rest', title: 'Rest over: set 3 of 4', body: "Back squat · 82.5 kg × 6. Let's go.", tag: 'rest', url: '/app/session/live' });
    expect(c.sent[0].opts).toEqual({ ttl: 120, urgency: 'high', topic: 'rest' });
    expect(await c.push.flushRests()).toBe(0); // claimed: never twice
    expect(c.sent).toHaveLength(1);
  });
  test('defaults for missing title/label; control chars stripped; length capped', async () => {
    const c = mk(); const { u } = await subscribed(c);
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
    c.clock.advance(1000); await c.push.flushRests();
    expect(c.sent[0].payload).toMatchObject({ title: 'Rest over', body: "Your next set is ready. Let's go." });
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000, label: 'a\nb\u0000' + 'z'.repeat(500) });
    c.clock.advance(1000); await c.push.flushRests();
    expect(c.sent[1].payload.body.startsWith('a b ')).toBe(true);
    expect(c.sent[1].payload.body.length).toBeLessThan(140);
  });
  test('idempotent per user: a new rest replaces the old; cancel removes it', async () => {
    const c = mk(); const { u } = await subscribed(c);
    const t0 = c.clock.now();
    await c.raw('POST', '/push/rest', u.token, { endsAt: t0 + 60_000, label: 'first' });
    await c.raw('POST', '/push/rest', u.token, { endsAt: t0 + 90_000, label: 'second' });
    expect(c.db.query('SELECT COUNT(*) n FROM push_rest').get()).toEqual({ n: 1 });
    expect(c.timers.filter((t) => t.live)).toHaveLength(1);
    c.clock.advance(100_000); await c.push.flushRests();
    expect(c.sent.map((x) => x.payload.body)).toEqual(["second. Let's go."]);
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 60_000, label: 'third' });
    expect((await c.raw('DELETE', '/push/rest', u.token)).status).toBe(200);
    expect(c.timers.filter((t) => t.live)).toHaveLength(0);
    c.clock.advance(120_000); expect(await c.push.flushRests()).toBe(0);
    expect(c.sent).toHaveLength(1);
  });
  test('validation: endsAt must be a number in [now−5s, now+2h]', async () => {
    const c = mk(); const { u } = await subscribed(c); const t = c.clock.now();
    for (const endsAt of ['x', null, NaN, t - 6000, t + 2 * 3600_000 + 1000]) expect((await c.raw('POST', '/push/rest', u.token, { endsAt })).status).toBe(400);
    expect((await c.raw('POST', '/push/rest', u.token, {})).status).toBe(400);
    expect((await c.raw('POST', '/push/rest', u.token, { endsAt: t - 1000 })).status).toBe(200);
  });
  test('client clock skew is corrected using the client\'s `now`', async () => {
    const c = mk(); const { u } = await subscribed(c); const t = c.clock.now();
    const r = await c.raw('POST', '/push/rest', u.token, { endsAt: t + 5 * MIN + 90_000, now: t + 5 * MIN }); // phone is 5 min fast
    expect(r.body.endsAt).toBe(t + 90_000);
  });
  test('not scheduled when no subscription wants rest alerts', async () => {
    const c = mk(); const none = await c.user();
    expect((await c.raw('POST', '/push/rest', none.token, { endsAt: c.clock.now() + 5000 })).body.scheduled).toBe(false);
    const { u } = await subscribed(c, 2, { rest: false });
    expect((await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 5000 })).body.scheduled).toBe(false);
    c.clock.advance(6000); await c.push.flushRests(); expect(c.sent).toHaveLength(0);
  });
  test('reaches every device with rest on, skips devices with it off', async () => {
    const c = mk(); const { u } = await subscribed(c, 1); const s2 = await newSub(2); const s3 = await newSub(3);
    await c.raw('POST', '/push/subscribe', u.token, { subscription: s2.json, prefs: { rest: false } });
    await c.raw('POST', '/push/subscribe', u.token, { subscription: s3.json });
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
    c.clock.advance(1000); await c.push.flushRests();
    expect(c.sent.map((x) => x.sub.endpoint).sort()).toEqual(['https://push.example.com/send/1', 'https://push.example.com/send/3']);
  });
  test('boot: pending rests are re-armed; slightly overdue ones fire; stale ones are dropped', async () => {
    const c = mk(); const a = await subscribed(c, 1); const b = await subscribed(c, 2); const d = await subscribed(c, 3);
    const t = c.clock.now();
    await c.raw('POST', '/push/rest', a.u.token, { endsAt: t + 60_000 });
    await c.raw('POST', '/push/rest', b.u.token, { endsAt: t + 5_000 });
    await c.raw('POST', '/push/rest', d.u.token, { endsAt: t + 1_000 });
    // server down for a while …
    c.clock.advance(1_000 + STALE_REST_MS + 10_000);
    c.timers.length = 0;
    c.push.restore();
    expect(c.db.query('SELECT COUNT(*) n FROM push_rest').get()).toEqual({ n: 1 }); // a still pending (60s − 131s <0 …)
  });
  test('boot restore arms a timer for a still-future rest', async () => {
    const c = mk(); const { u } = await subscribed(c);
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 60_000 });
    c.timers.length = 0; c.clock.advance(20_000);
    c.push.restore();
    expect(c.timers).toHaveLength(1); expect(c.timers[0].ms).toBe(40_000);
    c.timers[0].fn(); await new Promise((r) => setTimeout(r, 0));
    expect(c.sent).toHaveLength(0); // timer fired early on purpose: nothing due yet
    c.clock.advance(40_000);
    c.timers[0].fn(); await new Promise((r) => setTimeout(r, 10));
    expect(c.sent).toHaveLength(1);
  });
  test('an overdue-but-fresh rest sends on restore; one overdue beyond STALE_REST_MS is dropped', async () => {
    const c = mk(); const a = await subscribed(c, 1); const b = await subscribed(c, 2); const t = c.clock.now();
    await c.raw('POST', '/push/rest', a.u.token, { endsAt: t + 1_000 });
    await c.raw('POST', '/push/rest', b.u.token, { endsAt: t + 1_000 });
    c.clock.set(t + 1_000 + 30_000);
    c.db.run('UPDATE push_rest SET ends_at=? WHERE user_id=?', [t - STALE_REST_MS - 1000, b.u.id]);
    c.push.restore(); await c.push.flushRests();
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0].sub.endpoint).toContain('/1');
  });
  test('badge carries sessions left this week (and is omitted when the device turned badge off)', async () => {
    const c = mk(); const { u } = await subscribed(c, 1, { badge: true });
    await seedWeek(c, u.token, { goal: 4, doneThisWeek: 2, rotation: ['a1'], areas: { a1: 'Upper body' } });
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
    c.clock.advance(1000); await c.push.flushRests();
    expect(c.sent[0].payload.badge).toBe(2);
    const s2 = await newSub(9);
    await c.raw('PUT', '/push/prefs', u.token, { endpoint: c.sent[0].sub.endpoint, prefs: { badge: false } });
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
    c.clock.advance(1000); await c.push.flushRests();
    expect(c.sent[1].payload.badge).toBeUndefined();
    void s2;
  });
});

describe('delivery failures', () => {
  test('404 and 410 drop the subscription immediately', async () => {
    for (const code of [404, 410]) {
      const c = mk(); const { u } = await subscribed(c);
      c.status.next = code;
      await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
      c.clock.advance(1000); await c.push.flushRests();
      expect(c.db.query('SELECT COUNT(*) n FROM push_subs').get()).toEqual({ n: 0 });
    }
  });
  test('transient failures keep the subscription until 5 in a row; success resets the count', async () => {
    const c = mk(); const { u } = await subscribed(c);
    const fire = async () => { await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 }); c.clock.advance(1000); await c.push.flushRests(); };
    const count = () => c.db.query<{ n: number }, []>('SELECT COUNT(*) n FROM push_subs').get()!.n;
    c.status.next = 503;
    for (let i = 0; i < 4; i++) await fire();
    expect(count()).toBe(1);
    c.status.next = 201; await fire();
    expect(c.db.query<{ fails: number }, []>('SELECT fails FROM push_subs').get()!.fails).toBe(0);
    c.status.next = 0;
    for (let i = 0; i < 5; i++) await fire();
    expect(count()).toBe(0);
  });
  test('a throwing sender never breaks the sweep', async () => {
    const db = openDb(':memory:');
    const p = createPush(db, { auto: false, env: {}, sender: async () => { throw new Error('boom'); } });
    const a = new Hono(); a.route('/api/push', p.app); a.route('/api', buildApi(db));
    const tok = ((await (await a.request('/api/auth/anon', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).json()) as any).token;
    const s = await newSub(1);
    await a.request('/api/push/subscribe', { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ subscription: s.json }) });
    await a.request('/api/push/rest', { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ endsAt: Date.now() }) });
    expect(await p.flushRests()).toBe(0);
  });
});

describe('session still running', () => {
  const beat = (c: Ctx, tok: string, o: object = {}) => c.raw('POST', '/push/session', tok, { seq: 2, startedAt: c.clock.now() - 40 * MIN, ...o });
  test('nudges once when nothing was logged for 30 min and the app has gone quiet', async () => {
    const c = mk(FRI_09_SE + 10 * 3600_000); // 19:00 Stockholm
    const { u } = await subscribed(c);
    const t0 = c.clock.now();
    await beat(c, u.token, { seq: 2, startedAt: t0 - 5 * MIN, lastLoggedAt: t0 });
    c.clock.advance(LEFT_AFTER_MS - 1); expect(await c.push.tick()).toBe(0);
    c.clock.advance(1); expect(await c.push.tick()).toBe(1);
    expect(c.sent[0].payload).toMatchObject({ type: 'left', title: 'Session 2 is still running', body: 'Last set logged 19:00. Tap to finish and save it.', url: '/app/resume' });
    c.clock.advance(5 * 3600_000); expect(await c.push.tick()).toBe(0); // never repeats
    expect(c.sent).toHaveLength(1);
  });
  test('a recent heartbeat (app still open) suppresses it; going silent releases it', async () => {
    const c = mk(FRI_09_SE + 10 * 3600_000);
    const { u } = await subscribed(c);
    const t0 = c.clock.now();
    await beat(c, u.token, { startedAt: t0 - 40 * MIN, lastLoggedAt: t0 - 35 * MIN });
    expect(await c.push.tick()).toBe(0); // beat just now
    c.clock.advance(BEAT_SILENT_MS - 1); expect(await c.push.tick()).toBe(0);
    c.clock.advance(1); expect(await c.push.tick()).toBe(1);
  });
  test('uses the start time when nothing was logged', async () => {
    const c = mk(FRI_09_SE + 10 * 3600_000);
    const { u } = await subscribed(c);
    await beat(c, u.token, { startedAt: c.clock.now() - 31 * MIN });
    c.clock.advance(BEAT_SILENT_MS);
    await c.push.tick();
    expect(c.sent[0].payload.body).toBe('Started 18:29, nothing logged yet. Tap to finish and save it.');
  });
  test('DELETE /session (session ended) cancels it; a new heartbeat extends it', async () => {
    const c = mk(FRI_09_SE + 10 * 3600_000);
    const { u } = await subscribed(c);
    await beat(c, u.token, { lastLoggedAt: c.clock.now() - 31 * MIN });
    await c.raw('DELETE', '/push/session', u.token);
    c.clock.advance(10 * MIN); expect(await c.push.tick()).toBe(0);
    await beat(c, u.token, { lastLoggedAt: c.clock.now() });
    c.clock.advance(20 * MIN); expect(await c.push.tick()).toBe(0);
    c.clock.advance(11 * MIN); expect(await c.push.tick()).toBe(1);
  });
  test('quiet hours: skipped (and not retried later) between 22:00 and 07:00 local', async () => {
    const c = mk(FRI_09_SE + 13 * 3600_000 - 10 * MIN); // 21:50 Stockholm
    const { u } = await subscribed(c);
    await beat(c, u.token, { startedAt: c.clock.now() - 60 * MIN, lastLoggedAt: c.clock.now() - 35 * MIN });
    c.clock.advance(BEAT_SILENT_MS + 15 * MIN); // 22:10
    expect(inQuietHours(c.clock.now(), -60)).toBe(true);
    expect(await c.push.tick()).toBe(0);
    c.clock.advance(12 * 3600_000); expect(await c.push.tick()).toBe(0);
    expect(c.sent).toHaveLength(0);
  });
  test('respects the per-device `left` toggle and forgets abandoned sessions', async () => {
    const c = mk(FRI_09_SE + 10 * 3600_000);
    const { u } = await subscribed(c, 1, { left: false });
    await beat(c, u.token, { lastLoggedAt: c.clock.now() - 31 * MIN });
    c.clock.advance(BEAT_SILENT_MS); expect(await c.push.tick()).toBe(0);
    await beat(c, u.token); c.clock.advance(13 * 3600_000); await c.push.tick();
    expect(c.db.query('SELECT COUNT(*) n FROM push_session').get()).toEqual({ n: 0 });
  });
  test('validation', async () => {
    const c = mk(); const { u } = await subscribed(c); const t = c.clock.now();
    for (const b of [{}, { seq: 0, startedAt: t }, { seq: 1.5, startedAt: t }, { seq: 1, startedAt: 'x' }, { seq: 1, startedAt: t + 3600_000 }, { seq: 1, startedAt: t - 3 * 86400_000 }, { seq: 1, startedAt: t, lastLoggedAt: 'y' }, { seq: 1, startedAt: t, lastLoggedAt: t + 3600_000 }])
      expect((await c.raw('POST', '/push/session', u.token, b)).status).toBe(400);
    expect((await c.raw('POST', '/push/session', u.token, { seq: 1, startedAt: t, lastLoggedAt: null })).status).toBe(200);
  });
});

async function seedWeek(c: Ctx, tok: string, o: { goal: number; doneThisWeek: number; rotation: string[]; areas: Record<string, string>; lastSlot?: number }) {
  const t = c.clock.now();
  const wk = localParts(t, -60);
  const weekStart = wk.dayStartUtc - wk.dow * 86400_000;
  const changes: any[] = [
    { type: 'settings', id: 'settings', updatedAt: 1, data: { weeklyGoal: o.goal, rotation: o.rotation, targetMinutes: 40, updatedAt: 1 } },
    ...Object.entries(o.areas).map(([id, name]) => ({ type: 'area', id, updatedAt: 1, data: { id, name } })),
  ];
  for (let i = 0; i < o.doneThisWeek; i++) changes.push({ type: 'session', id: `s${i}`, updatedAt: 1, data: { id: `s${i}`, seq: i + 1, slot: o.lastSlot ?? 1, status: 'completed', startedAt: weekStart + i * 3600_000 + 1000, endedAt: weekStart + i * 3600_000 + 2000 } });
  const r = await c.raw('POST', '/sync', tok, { cursor: 0, changes });
  expect(r.body.rejected).toEqual([]);
}

describe('weekly nudge', () => {
  const setup = async (o: { done: number; goal?: number; prefs?: object; start?: number }) => {
    const c = mk(o.start ?? FRI_09_SE + 5 * MIN);
    const { u } = await subscribed(c, 1, o.prefs ?? { nudge: true }, -60);
    await seedWeek(c, u.token, { goal: o.goal ?? 4, doneThisWeek: o.done, rotation: ['a1', 'a2', 'a3'], areas: { a1: 'Upper body', a2: 'Lower body', a3: 'Prehab & mobility' }, lastSlot: 2 });
    return { c, u };
  };
  test('Friday 09:00 local, only if behind: copy matches the lock-screen design', async () => {
    const { c } = await setup({ done: 2 });
    expect(await c.push.tick()).toBe(1);
    expect(c.sent[0].payload).toMatchObject({ type: 'nudge', title: '2 sessions left this week', body: 'Next up: Prehab & mobility, about 40 min.', badge: 2 });
    expect(c.sent[0].opts.urgency).toBe('low');
  });
  test('singular copy', async () => {
    const { c } = await setup({ done: 3 }); await c.push.tick();
    expect(c.sent[0].payload.title).toBe('1 session left this week');
  });
  test('once per week, even if the tick runs all morning', async () => {
    const { c } = await setup({ done: 1 });
    await c.push.tick(); c.clock.advance(60 * MIN); await c.push.tick(); c.clock.advance(60 * MIN); await c.push.tick();
    expect(c.sent).toHaveLength(1);
    c.clock.advance(7 * 86400_000 - 2 * 3600_000 - 5 * MIN + 5 * MIN); await c.push.tick(); // next Friday
    expect(c.sent).toHaveLength(2);
  });
  test('silent when on track, when off by default, outside the Friday-morning window, or opted out', async () => {
    expect(await (await setup({ done: 4 })).c.push.tick()).toBe(0);
    expect(await (await setup({ done: 5 })).c.push.tick()).toBe(0);
    expect(await (await setup({ done: 0, prefs: {} })).c.push.tick()).toBe(0); // default: off
    expect(await (await setup({ done: 0, prefs: { nudge: false } })).c.push.tick()).toBe(0);
    expect(await (await setup({ done: 0, start: FRI_09_SE - 60 * MIN })).c.push.tick()).toBe(0); // 08:00
    expect(await (await setup({ done: 0, start: FRI_09_SE + 3 * 3600_000 })).c.push.tick()).toBe(0); // 12:00
    expect(await (await setup({ done: 0, start: FRI_09_SE + 86400_000 })).c.push.tick()).toBe(0); // Saturday
    expect(await (await setup({ done: 0, start: FRI_09_SE - 86400_000 })).c.push.tick()).toBe(0); // Thursday
  });
  test('uses the user\'s timezone, not the server\'s', async () => {
    const c = mk(Date.UTC(2026, 10, 20, 14, 0, 0)); // Friday 09:00 in New York (tz +300)
    const { u } = await subscribed(c, 1, { nudge: true }, 300);
    await seedWeek(c, u.token, { goal: 3, doneThisWeek: 0, rotation: ['a1'], areas: { a1: 'Upper body' } });
    expect(await c.push.tick()).toBe(1);
  });
  test('no data → still honest (no fabricated "next up")', async () => {
    const c = mk(FRI_09_SE + 5 * MIN);
    const { u } = await subscribed(c, 1, { nudge: true });
    await c.raw('POST', '/sync', u.token, { cursor: 0, changes: [{ type: 'settings', id: 'settings', updatedAt: 1, data: { weeklyGoal: 3, rotation: [], updatedAt: 1 } }] });
    await c.push.tick();
    expect(c.sent[0].payload.body).toBe('Whenever you have a window, one is enough to stay on track.');
  });
});

describe('helpers', () => {
  test('localParts / quiet hours', () => {
    expect(localParts(FRI_09_SE, -60)).toMatchObject({ dow: 4, hour: 9, minute: 0 });
    expect(localParts(FRI_09_SE, 0)).toMatchObject({ dow: 4, hour: 8 });
    expect(inQuietHours(Date.UTC(2026, 10, 20, 21, 0), -60)).toBe(true); // 22:00
    expect(inQuietHours(Date.UTC(2026, 10, 20, 20, 59), -60)).toBe(false);
    expect(inQuietHours(Date.UTC(2026, 10, 21, 5, 59), -60)).toBe(true);
    expect(inQuietHours(Date.UTC(2026, 10, 21, 6, 0), -60)).toBe(false); // 07:00
  });
  test('sha sanity (token hashing matches api.ts)', () => {
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });
});
