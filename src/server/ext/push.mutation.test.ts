// Mutation-killing tests for ext/push.ts: exhaustive address/endpoint tables, key + tz validation, VAPID, limiter edges, request bounds.
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from '../db';
import { buildApi } from '../api';
import {
  MAX_REST_AHEAD_MS, createPush, encryptPayload, inQuietHours, isPrivateAddress, isSafeEndpoint, loadVapid, localParts, makeSender, vapidHeader,
  type PushSub,
} from './push';

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

describe('isPrivateAddress', () => {
  test('IPv4 private/reserved ranges and their exact edges', () => {
    const priv = ['0.0.0.0', '0.255.255.255', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.255.255.255', '224.0.0.1', '239.1.1.1', '255.255.255.255', '100.64.0.1', '100.100.100.100', '100.127.255.255', '169.254.0.1', '169.254.255.255',
      '172.16.0.1', '172.20.1.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '192.0.0.1', '192.0.1.1', '192.0.2.1', '198.18.0.1', '198.19.255.255'];
    const pub = ['1.1.1.1', '8.8.8.8', '9.255.255.255', '11.0.0.1', '126.255.255.255', '128.0.0.1', '100.0.0.1', '100.63.255.255', '100.128.0.1', '169.253.255.255', '169.255.0.1', '172.15.255.255', '172.32.0.1', '172.0.0.1', '192.167.255.255',
      '192.169.0.1', '192.1.0.1', '192.2.0.1', '198.17.255.255', '198.20.0.1', '198.0.0.1', '223.255.255.255', '151.101.1.1', '104.16.0.1'];
    for (const a of priv) expect([a, isPrivateAddress(a)]).toEqual([a, true]);
    for (const a of pub) expect([a, isPrivateAddress(a)]).toEqual([a, false]);
  });
  test('IPv6: loopback, ULA, link-local, multicast, NAT64, documentation, v4-mapped', () => {
    const priv = ['::', '::1', 'fc00::1', 'fd12:3456::1', 'FC00::1', 'fe80::1', 'fe9a::1', 'feab::1', 'febf::1', 'ff02::1', 'FF02::1', '64:ff9b::1', '64:ff9b::7f00:1', '2001:db8::1', '2001:db8:abcd::1',
      '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', '::ffff:7f00:1', '::ffff:a00:1', '::FFFF:10.0.0.1'];
    const pub = ['2606:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '::ffff:1.1.1.1', '::2', 'fb00::1', 'fe7f::1', 'fec0::1', 'fa00::1', '2001:db9::1', '64:ff9a::1', '2001:db7::1', 'f000::1'];
    for (const a of priv) expect([a, isPrivateAddress(a)]).toEqual([a, true]);
    for (const a of pub) expect([a, isPrivateAddress(a)]).toEqual([a, false]);
  });
  test('anything that is not an IP is unsafe', () => {
    for (const a of ['example.com', '', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'zzzz']) expect([a, isPrivateAddress(a)]).toEqual([a, true]);
  });
});

describe('isSafeEndpoint', () => {
  test('accepts ordinary https push services', () => {
    for (const u of ['https://push.example.com/send/1', 'https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/Qx', 'https://push.example.com:443/x', 'https://PUSH.Example.COM./x', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://a.notlocal/x', 'https://foo.mylocal/x', 'https://localhost.example.com/x', 'https://home.example.com/x', 'https://internal.example.org/x', 'https://x-y.example.com/x?y=1', 'https://a1.b2.c3/x']) expect([u, isSafeEndpoint(u)]).toEqual([u, true]);
  });
  test('rejects everything else', () => {
    const bad: unknown[] = [undefined, null, 5, {}, [], '', 'not a url', 'http://push.example.com/x', 'ftp://push.example.com/x', 'https://user@push.example.com/x', 'https://user:pw@push.example.com/x', 'https://:pw@push.example.com/x',
      'https://push.example.com/x#frag', 'https://push.example.com:8443/x', 'https://push.example.com:80/x', 'https://localhost/x', 'https://localhost./x', 'https://my.localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://[2606:4700::1111]/x',
      'https://2130706433/x', 'https://0x7f.1/x', 'https://8.8.8.8/x', 'https://nodots/x', 'https://foo.local/x', 'https://foo.internal/x', 'https://foo.lan/x', 'https://foo.home/x', 'https://foo.corp/x', 'https://foo.intranet/x',
      'https://foo.localdomain/x', 'https://LOCALHOST/x', 'https://a_b.example.com/x', 'https://a b.example.com/x', 'javascript:alert(1)', '//push.example.com/x'];
    for (const u of bad) expect([String(u), isSafeEndpoint(u)]).toEqual([String(u), false]);
  });
  test('length cap is 1000 characters', () => {
    const base = 'https://push.example.com/';
    expect(isSafeEndpoint(base + 'a'.repeat(1000 - base.length))).toBe(true);
    expect(isSafeEndpoint(base + 'a'.repeat(1001 - base.length))).toBe(false);
  });
});

describe('time helpers', () => {
  test('localParts applies the offset (minutes, UTC − local) and wraps days', () => {
    const fri9 = Date.UTC(2026, 10, 20, 8, 5); // Friday 08:05 UTC
    expect(localParts(fri9, -60)).toEqual({ dow: 4, hour: 9, minute: 5, dayStartUtc: Date.UTC(2026, 10, 20) - 60 * 60_000 });
    expect(localParts(fri9, 0)).toEqual({ dow: 4, hour: 8, minute: 5, dayStartUtc: Date.UTC(2026, 10, 20) });
    expect(localParts(fri9, 300)).toEqual({ dow: 4, hour: 3, minute: 5, dayStartUtc: Date.UTC(2026, 10, 20) + 300 * 60_000 });
    const sat0030 = Date.UTC(2026, 10, 21, 0, 30);
    expect(localParts(sat0030, 60)).toMatchObject({ dow: 4, hour: 23, minute: 30 }); // still Friday in UTC−1
    expect(localParts(sat0030, -60)).toMatchObject({ dow: 5, hour: 1, minute: 30 });
    expect(localParts(Date.UTC(2026, 10, 22, 12), 0).dow).toBe(6); // Sunday
    expect(localParts(Date.UTC(2026, 10, 16, 12), 0).dow).toBe(0); // Monday
    expect(localParts(Date.UTC(2026, 10, 16, 12, 59), 30)).toMatchObject({ hour: 12, minute: 29 });
  });
  test('quiet hours are 22:00 ≤ h < 07:00 local', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 10, 20, h, m);
    for (const [h, m, quiet] of [[21, 59, false], [22, 0, true], [23, 59, true], [0, 0, true], [6, 59, true], [7, 0, false], [12, 0, false]] as const) {
      expect([h, m, inQuietHours(at(h, m), 0)]).toEqual([h, m, quiet]);
    }
    expect(inQuietHours(at(21, 30), -60)).toBe(true); // 22:30 local
    expect(inQuietHours(at(6, 30), -60)).toBe(false); // 07:30 local
  });
});

async function ecdsaPair() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { kp, pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), d: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d! };
}

describe('VAPID', () => {
  test('env keys, subject precedence and the persisted fallback', async () => {
    const { pub, d } = await ecdsaPair();
    const db = openDb(':memory:');
    const env = await loadVapid(db, { VAPID_PUBLIC: pub, VAPID_PRIVATE: d });
    expect(env.publicKey).toBe(pub);
    expect(env.subject).toBe('mailto:admin@example.com');
    expect((db.query("SELECT name FROM sqlite_master WHERE name='push_vapid'").get() as any)).toBeNull(); // env keys never touch the DB
    expect((await loadVapid(db, { VAPID_PUBLIC: pub, VAPID_PRIVATE: d, PUBLIC_URL: 'https://rep.example' })).subject).toBe('https://rep.example');
    expect((await loadVapid(db, { VAPID_PUBLIC: pub, VAPID_PRIVATE: d, PUBLIC_URL: 'http://rep.example' })).subject).toBe('mailto:admin@example.com');
    expect((await loadVapid(db, { VAPID_PUBLIC: pub, VAPID_PRIVATE: d, PUBLIC_URL: 'https://rep.example', VAPID_SUBJECT: 'mailto:me@rep.example' })).subject).toBe('mailto:me@rep.example');
    expect((await loadVapid(db, { VAPID_PUBLIC: pub, VAPID_PRIVATE: d, VAPID_SUBJECT: '' , PUBLIC_URL: 'https://x.example' })).subject).toBe('https://x.example');
    // only one half of the pair -> keys come from the database instead
    const half1 = await loadVapid(db, { VAPID_PUBLIC: pub });
    expect(half1.publicKey).not.toBe(pub);
    const half2 = await loadVapid(db, { VAPID_PRIVATE: d });
    expect(half2.publicKey).toBe(half1.publicKey); // generated once, then reused
    const stored = db.query('SELECT pub,d FROM push_vapid WHERE id=1').get() as any;
    expect(stored.pub).toBe(half1.publicKey);
    expect((db.query('SELECT COUNT(*) AS n FROM push_vapid').get() as any).n).toBe(1);
    expect(unb64u(half1.publicKey)).toHaveLength(65);
    expect(unb64u(half1.publicKey)[0]).toBe(4);
    expect((await loadVapid(db, {})).publicKey).toBe(half1.publicKey);
  });
  test('a malformed public key is rejected', async () => {
    const { pub, d } = await ecdsaPair();
    const raw = unb64u(pub);
    const short = b64u(raw.slice(0, 64));
    await expect(loadVapid(openDb(':memory:'), { VAPID_PUBLIC: short, VAPID_PRIVATE: d })).rejects.toThrow('VAPID_PUBLIC must be a 65-byte uncompressed P-256 point');
    const long = b64u(new Uint8Array([...raw, 0]));
    await expect(loadVapid(openDb(':memory:'), { VAPID_PUBLIC: long, VAPID_PRIVATE: d })).rejects.toThrow('VAPID_PUBLIC must be');
    const wrongTag = new Uint8Array(raw); wrongTag[0] = 3;
    await expect(loadVapid(openDb(':memory:'), { VAPID_PUBLIC: b64u(wrongTag), VAPID_PRIVATE: d })).rejects.toThrow('VAPID_PUBLIC must be');
  });
  test('the private key is not extractable and signs a verifiable ES256 JWT', async () => {
    const { pub, d, kp } = await ecdsaPair();
    const v = await loadVapid(openDb(':memory:'), { VAPID_PUBLIC: pub, VAPID_PRIVATE: d, VAPID_SUBJECT: 'mailto:a@b.se' });
    expect(v.privateKey.extractable).toBe(false);
    expect(v.privateKey.usages).toEqual(['sign']);
    const h = await vapidHeader(v, 'https://push.example.com:443/wpush/v1/abc?x=1', 1_700_000_999_999);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(pub);
    const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());
    expect(dec(m[1])).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(dec(m[2])).toEqual({ aud: 'https://push.example.com', exp: 1_700_000_999 + 12 * 3600, sub: 'mailto:a@b.se' });
    const sig = unb64u(m[3]);
    expect(sig).toHaveLength(64);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sig, new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sig, new TextEncoder().encode(`${m[1]}.${m[2]}x`))).toBe(false);
    // exp is computed from whole seconds
    const h2 = await vapidHeader(v, 'https://p.example.com/x', 1999);
    expect(dec(/t=[^.]+\.([^.]+)\./.exec(h2)![1]).exp).toBe(1 + 12 * 3600);
  });
});

describe('encryptPayload size limit', () => {
  test('3993 bytes fit one record, 3994 do not; the record layout is fixed', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const keys = { p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
    const ok = await encryptPayload(keys, new Uint8Array(3993));
    expect(ok.length).toBe(86 + 3993 + 1 + 16); // header + plaintext + delimiter + tag = one 4096-byte record
    expect(ok.length).toBe(4096);
    expect([...ok.slice(16, 20)]).toEqual([0, 0, 0x10, 0]); // record size 4096
    expect(ok[20]).toBe(65);
    expect(ok[21]).toBe(4);
    await expect(encryptPayload(keys, new Uint8Array(3994))).rejects.toThrow('payload too large');
    const empty = await encryptPayload(keys, new Uint8Array(0));
    expect(empty.length).toBe(86 + 1 + 16);
  });
});

describe('makeSender (no network needed)', () => {
  const v = async () => { const { pub, d } = await ecdsaPair(); return loadVapid(openDb(':memory:'), { VAPID_PUBLIC: pub, VAPID_PRIVATE: d }); };
  const sub = (endpoint: string): PushSub => ({ endpoint, keys: { p256dh: 'x', auth: 'y' } });
  test('unsafe stored endpoints are reported as gone (410) without any request', async () => {
    let called = 0;
    const send = makeSender(await v(), () => T0, (async () => { called++; return new Response('x'); }) as unknown as typeof fetch);
    for (const e of ['http://push.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://nodots/x', 'https://push.example.com:8443/x']) {
      expect([e, await send(sub(e), '{}', { ttl: 1, urgency: 'normal' })]).toEqual([e, { status: 410 }]);
    }
    expect(called).toBe(0);
  });
  test('an unresolvable host is a transient failure (status 0), never a request', async () => {
    let called = 0;
    const send = makeSender(await v(), () => T0, (async () => { called++; return new Response('x'); }) as unknown as typeof fetch);
    expect(await send(sub('https://no-such-host.invalid/x'), '{}', { ttl: 1, urgency: 'normal' })).toEqual({ status: 0 });
    expect(called).toBe(0);
  });
});

// ───────────────────────── HTTP surface ─────────────────────────
async function newSub(n: number) {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { p256dh, auth, endpoint: `https://push.example.com/send/${n}`, json: { endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: b64u(p256dh), auth: b64u(auth) } } };
}
function mk() {
  const db = openDb(':memory:');
  let t = T0;
  const clock = { now: () => t, set: (v: number) => { t = v; }, advance: (ms: number) => { t += ms; } };
  const sent: any[] = [];
  const push = createPush(db, { now: clock.now, auto: false, env: {}, sender: async (s, p) => { sent.push({ s, p: JSON.parse(p) }); return { status: 201 }; }, setTimer: (fn, ms) => ({ fn, ms }), clearTimer: () => {} });
  const app = new Hono();
  app.route('/api/push', push.app);
  app.route('/api', buildApi(db));
  const raw = async (method: string, path: string, token: string | null, json?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: json === undefined ? undefined : typeof json === 'string' ? json : JSON.stringify(json) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const user = async () => { const r = await raw('POST', '/auth/anon', null, {}); return { token: r.body.token as string, id: r.body.userId as string }; };
  return { db, push, clock, sent, raw, user };
}
type Ctx = ReturnType<typeof mk>;
const row = (c: Ctx, sql: string, ...a: unknown[]) => c.db.query(sql).get(...(a as [])) as any;

describe('auth middleware', () => {
  test('401 body, bearer parsing, last_used update', async () => {
    const c = mk();
    const u = await c.user();
    const r = await c.raw('GET', '/push/key', null);
    expect([r.status, r.body]).toEqual([401, { error: 'unauthorized' }]);
    expect((await c.raw('GET', '/push/key', 'nope')).body).toEqual({ error: 'unauthorized' });
    for (const h of [`bearer ${u.token}`, u.token, `Bearer  ${u.token}`, `Basic ${u.token}`, 'Bearer ']) {
      expect([h.slice(0, 8), (await c.raw('GET', '/push/key', null, undefined, { authorization: h })).status]).toEqual([h.slice(0, 8), 401]);
    }
    c.clock.set(T0 + 5000);
    expect((await c.raw('GET', '/push/key', u.token)).status).toBe(200);
    expect(row(c, 'SELECT last_used FROM tokens').last_used).toBe(T0 + 5000);
  });
});

describe('subscribe: keys, tz, prefs', () => {
  const sub = async (c: Ctx, token: string, subscription: unknown, extra: object = {}) => c.raw('POST', '/push/subscribe', token, { subscription, ...extra });
  test('key validation: types, alphabet, lengths, tag byte and curve membership', async () => {
    const c = mk(); const u = await c.user();
    const good = await newSub(1);
    const ep = (n: number) => `https://push.example.com/k/${n}`;
    const withKeys = (n: number, keys: unknown) => ({ endpoint: ep(n), keys });
    const bad: [string, unknown][] = [
      ['null', null], ['string', 'abc'], ['no auth', { p256dh: good.json.keys.p256dh }], ['no p256dh', { auth: good.json.keys.auth }],
      ['numeric auth', { p256dh: good.json.keys.p256dh, auth: 5 }], ['numeric p256dh', { p256dh: 5, auth: good.json.keys.auth }],
      ['p256dh not base64url', { p256dh: good.json.keys.p256dh + '+', auth: good.json.keys.auth }], ['auth padded', { p256dh: good.json.keys.p256dh, auth: good.json.keys.auth + '==' }],
      ['auth with space', { p256dh: good.json.keys.p256dh, auth: 'a b' }], ['empty auth', { p256dh: good.json.keys.p256dh, auth: '' }], ['empty p256dh', { p256dh: '', auth: good.json.keys.auth }],
      ['p256dh 64 bytes', { p256dh: b64u(good.p256dh.slice(0, 64)), auth: good.json.keys.auth }], ['p256dh 66 bytes', { p256dh: b64u(new Uint8Array([...good.p256dh, 1])), auth: good.json.keys.auth }],
      ['compressed tag', { p256dh: b64u(new Uint8Array([2, ...good.p256dh.slice(1)])), auth: good.json.keys.auth }],
      ['auth 15 bytes', { p256dh: good.json.keys.p256dh, auth: b64u(good.auth.slice(0, 15)) }], ['auth 17 bytes', { p256dh: good.json.keys.p256dh, auth: b64u(new Uint8Array([...good.auth, 0])) }],
      ['off-curve point', { p256dh: b64u(new Uint8Array([4, ...new Uint8Array(64).fill(7)])), auth: good.json.keys.auth }],
    ];
    for (const [i, [label, keys]] of bad.entries()) {
      const r = await sub(c, u.token, withKeys(i, keys));
      expect([label, r.status, r.body]).toEqual([label, 400, { error: 'invalid_keys' }]);
    }
    expect((await sub(c, u.token, withKeys(100, good.json.keys))).status).toBe(200);
    const u2 = await c.user();
    expect((await sub(c, u2.token, null)).body).toEqual({ error: 'invalid_endpoint' });
    expect((await sub(c, u2.token, { endpoint: 'http://x.example.com/', keys: good.json.keys })).body).toEqual({ error: 'invalid_endpoint' });
    expect((await c.raw('POST', '/push/subscribe', u2.token, 'not json')).body).toEqual({ error: 'invalid_endpoint' });
  });
  test('tz: integers within ±840 minutes are kept, anything else keeps the previous value (0 for a new device)', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    const tzOf = () => row(c, 'SELECT tz FROM push_subs').tz;
    for (const [tz, expected] of [[-840, -840], [840, 840], [0, 0], [-60, -60], [120, 120]] as const) {
      await sub(c, u.token, s.json, { tz });
      expect([tz, tzOf()]).toEqual([tz, expected]);
    }
    await sub(c, u.token, s.json, { tz: 90 });
    for (const bad of [-841, 841, 1e9, 60.5, '60', null, NaN, {}, true]) {
      await sub(c, u.token, s.json, { tz: bad });
      expect([String(bad), tzOf()]).toEqual([String(bad), 90]);
    }
    await sub(c, u.token, s.json, {});
    expect(tzOf()).toBe(90);
    const c2 = mk(); const u2 = await c2.user();
    await sub(c2, u2.token, (await newSub(2)).json, { tz: 'x' });
    expect(row(c2, 'SELECT tz FROM push_subs').tz).toBe(0);
    await sub(c2, u2.token, (await newSub(3)).json);
    expect(c2.db.query('SELECT tz FROM push_subs ORDER BY created_at').all()).toEqual([{ tz: 0 }, { tz: 0 }]);
  });
  test('prefs: only booleans count, others fall back; response and PUT /prefs shapes', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    const r = await sub(c, u.token, s.json, { prefs: { rest: false, left: 'no', nudge: true, badge: 1 } });
    expect(r.body).toEqual({ ok: true, prefs: { rest: false, left: true, nudge: true, badge: true, streak: true } });
    expect(JSON.parse(row(c, 'SELECT prefs FROM push_subs').prefs)).toEqual({ rest: false, left: true, nudge: true, badge: true, streak: true });
    // resubscribing without prefs keeps them (same user); a different user's existing row does not leak its prefs
    expect((await sub(c, u.token, s.json)).body.prefs).toEqual({ rest: false, left: true, nudge: true, badge: true, streak: true });
    const u2 = await c.user();
    expect((await sub(c, u2.token, s.json)).body.prefs).toEqual({ rest: true, left: true, nudge: false, badge: true, streak: true });
    const put = await c.raw('PUT', '/push/prefs', u2.token, { endpoint: s.endpoint, prefs: { badge: false, streak: true }, tz: 30 });
    expect(put.body).toEqual({ ok: true, prefs: { rest: true, left: true, nudge: false, badge: false, streak: true } });
    expect(row(c, 'SELECT tz FROM push_subs').tz).toBe(30);
    await c.raw('PUT', '/push/prefs', u2.token, { endpoint: s.endpoint, prefs: {}, tz: 'bad' });
    expect(row(c, 'SELECT tz FROM push_subs').tz).toBe(30);
    expect((await c.raw('PUT', '/push/prefs', u2.token, { endpoint: s.endpoint, prefs: { nudge: true } })).body.prefs).toEqual({ rest: true, left: true, nudge: true, badge: false, streak: true });
    // not found / not mine / bad body
    expect((await c.raw('PUT', '/push/prefs', u.token, { endpoint: s.endpoint, prefs: {} })).status).toBe(404); // u2 took over the endpoint
    expect((await c.raw('PUT', '/push/prefs', u2.token, { endpoint: 'https://push.example.com/send/none', prefs: {} })).body).toEqual({ error: 'not_subscribed' });
    expect((await c.raw('PUT', '/push/prefs', u2.token, { prefs: {} })).status).toBe(404);
    expect((await c.raw('PUT', '/push/prefs', u2.token, { endpoint: 5, prefs: {} })).status).toBe(404);
    expect((await c.raw('PUT', '/push/prefs', u2.token, 'zzz')).status).toBe(404);
  });
  test('status and unsubscribe', async () => {
    const c = mk(); const u = await c.user(); const o = await c.user(); const s = await newSub(1);
    await sub(c, u.token, s.json, { prefs: { badge: false, streak: true } });
    const st = await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.endpoint)}`, u.token);
    expect(st.body).toEqual({ subscribed: true, prefs: { rest: true, left: true, nudge: false, badge: false, streak: true } });
    expect((await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.endpoint)}`, o.token)).body).toEqual({ subscribed: false, prefs: { rest: true, left: true, nudge: false, badge: true, streak: true } });
    expect((await c.raw('GET', '/push/status', u.token)).body.subscribed).toBe(false);
    expect((await c.raw('GET', '/push/status?endpoint=', u.token)).body.subscribed).toBe(false);
    expect((await c.raw('POST', '/push/unsubscribe', o.token, { endpoint: s.endpoint })).body).toEqual({ ok: true });
    expect((await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.endpoint)}`, u.token)).body.subscribed).toBe(true);
    expect((await c.raw('POST', '/push/unsubscribe', u.token, { endpoint: s.endpoint })).body).toEqual({ ok: true });
    expect((await c.raw('GET', `/push/status?endpoint=${encodeURIComponent(s.endpoint)}`, u.token)).body.subscribed).toBe(false);
    expect((await c.raw('POST', '/push/unsubscribe', u.token, 'junk')).body).toEqual({ ok: true });
    expect((await c.raw('POST', '/push/unsubscribe', u.token, { endpoint: 5 })).body).toEqual({ ok: true });
  });
});

describe('rate limits', () => {
  test('subscribe 20/h: exact body, header, and window edges', async () => {
    const c = mk(); const u = await c.user();
    for (let i = 0; i < 20; i++) expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(i)).json })).status).toBe(200);
    const blocked = await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(99)).json });
    expect([blocked.status, blocked.body, blocked.headers.get('retry-after')]).toEqual([429, { error: 'rate_limited', retryAfter: 3600 }, '3600']);
    c.clock.advance(3_599_000);
    expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(99)).json })).body.retryAfter).toBe(1);
    c.clock.set(T0 + 3_600_000); // reset == now: same window, at least 1 s
    expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(99)).json })).body.retryAfter).toBe(1);
    c.clock.set(T0 + 3_600_001);
    expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(99)).json })).status).toBe(200);
    // per-user budget
    const o = await c.user();
    expect((await c.raw('POST', '/push/subscribe', o.token, { subscription: (await newSub(500)).json })).status).toBe(200);
  });
  test('the budgets are independent per kind: prefs 60, rest 300, session 240', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json });
    for (let i = 0; i < 60; i++) expect((await c.raw('PUT', '/push/prefs', u.token, { endpoint: s.endpoint, prefs: {} })).status).toBe(200);
    const pr = await c.raw('PUT', '/push/prefs', u.token, { endpoint: s.endpoint, prefs: {} });
    expect([pr.status, pr.body]).toEqual([429, { error: 'rate_limited', retryAfter: 3600 }]);
    for (let i = 0; i < 300; i++) expect((await c.raw('POST', '/push/rest', u.token, { endsAt: T0 + 60_000 })).status).toBe(200);
    const rr = await c.raw('POST', '/push/rest', u.token, { endsAt: T0 + 60_000 });
    expect([rr.status, rr.body, rr.headers.get('retry-after')]).toEqual([429, { error: 'rate_limited', retryAfter: 3600 }, '3600']);
    for (let i = 0; i < 240; i++) expect((await c.raw('POST', '/push/session', u.token, { seq: 1, startedAt: T0 - 1000 })).status).toBe(200);
    const sr = await c.raw('POST', '/push/session', u.token, { seq: 1, startedAt: T0 - 1000 });
    expect([sr.status, sr.body]).toEqual([429, { error: 'rate_limited', retryAfter: 3600 }]);
    // exhausting one kind leaves the others untouched for another user, and sub budget of this user is untouched
    expect((await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(2)).json })).status).toBe(200);
  });
});

describe('POST /rest', () => {
  const rest = (c: Ctx, token: string, body: unknown) => c.raw('POST', '/push/rest', token, body);
  async function ready() { const c = mk(); const u = await c.user(); await c.raw('POST', '/push/subscribe', u.token, { subscription: (await newSub(1)).json }); return { c, u }; }
  test('endsAt validation: number required; window [now − 5 s, now + 2 h] is inclusive', async () => {
    const { c, u } = await ready();
    for (const b of [undefined, null, 'x', {}, { endsAt: '123' }, { endsAt: null }, { endsAt: true }, { endsAt: {} }]) {
      const r = await rest(c, u.token, b === undefined ? 'nope' : b);
      expect([JSON.stringify(b), r.status, r.body]).toEqual([JSON.stringify(b), 400, { error: 'invalid_endsAt' }]);
    }
    expect((await rest(c, u.token, { endsAt: T0 - 5000 })).body).toEqual({ ok: true, scheduled: true, endsAt: T0 - 5000 });
    expect((await rest(c, u.token, { endsAt: T0 - 5001 })).body).toEqual({ error: 'endsAt_out_of_range' });
    expect((await rest(c, u.token, { endsAt: T0 + MAX_REST_AHEAD_MS })).body.scheduled).toBe(true);
    expect((await rest(c, u.token, { endsAt: T0 + MAX_REST_AHEAD_MS + 1 })).body).toEqual({ error: 'endsAt_out_of_range' });
    expect(MAX_REST_AHEAD_MS).toBe(2 * 3600_000);
    expect((await rest(c, u.token, { endsAt: T0 + 90_000.4 })).body.endsAt).toBe(T0 + 90_000); // rounded
    expect((await rest(c, u.token, { endsAt: T0 + 90_000.6 })).body.endsAt).toBe(T0 + 90_001);
  });
  test('clock skew: corrected only when the client\'s now is within 10 minutes', async () => {
    const { c, u } = await ready();
    expect((await rest(c, u.token, { endsAt: T0 - 30_000 + 90_000, now: T0 - 30_000 })).body.endsAt).toBe(T0 + 90_000); // client 30 s behind
    expect((await rest(c, u.token, { endsAt: T0 + 30_000 + 90_000, now: T0 + 30_000 })).body.endsAt).toBe(T0 + 90_000); // client 30 s ahead
    const nine = 9 * 60_000 + 59_999;
    expect((await rest(c, u.token, { endsAt: T0 - nine + 90_000, now: T0 - nine })).body.endsAt).toBe(T0 + 90_000);
    expect((await rest(c, u.token, { endsAt: T0 + nine + 90_000, now: T0 + nine })).body.endsAt).toBe(T0 + 90_000);
    const ten = 10 * 60_000;
    expect((await rest(c, u.token, { endsAt: T0 + 90_000, now: T0 - ten })).body.endsAt).toBe(T0 + 90_000); // exactly 10 min: ignored
    expect((await rest(c, u.token, { endsAt: T0 + 90_000, now: T0 + ten })).body.endsAt).toBe(T0 + 90_000);
    expect((await rest(c, u.token, { endsAt: T0 + 90_000, now: 'x' })).body.endsAt).toBe(T0 + 90_000);
    expect((await rest(c, u.token, { endsAt: T0 + 90_000, now: null })).body.endsAt).toBe(T0 + 90_000);
    expect((await rest(c, u.token, { endsAt: T0 + 90_000 })).body.endsAt).toBe(T0 + 90_000);
  });
  test('stored copy: title/label cleaned and capped; DELETE cancels; one row per user', async () => {
    const { c, u } = await ready();
    await rest(c, u.token, { endsAt: T0 + 60_000, title: '  Time\u0000to\nlift  ', label: ' Bench\tpress ' });
    expect(row(c, 'SELECT title,body FROM push_rest')).toEqual({ title: 'Time to lift', body: "Bench press. Let's go." });
    await rest(c, u.token, { endsAt: T0 + 61_000, title: 't'.repeat(100), label: 'l'.repeat(200) });
    const r2 = row(c, 'SELECT title,body,ends_at FROM push_rest');
    expect(r2.title).toBe('t'.repeat(80));
    expect(r2.body).toBe(`${'l'.repeat(120)}. Let's go.`);
    expect(r2.ends_at).toBe(T0 + 61_000);
    await rest(c, u.token, { endsAt: T0 + 62_000, title: 5, label: {} });
    expect(row(c, 'SELECT title,body FROM push_rest')).toEqual({ title: 'Rest over', body: "Your next set is ready. Let's go." });
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_rest').get() as any).n).toBe(1);
    expect((await c.raw('DELETE', '/push/rest', u.token)).body).toEqual({ ok: true });
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_rest').get() as any).n).toBe(0);
  });
  test('not scheduled (and any pending rest removed) when no device wants rest alerts', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    expect((await rest(c, u.token, { endsAt: T0 + 60_000 })).body).toEqual({ ok: true, scheduled: false }); // no devices at all
    await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json });
    await rest(c, u.token, { endsAt: T0 + 60_000 });
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_rest').get() as any).n).toBe(1);
    await c.raw('PUT', '/push/prefs', u.token, { endpoint: s.endpoint, prefs: { rest: false } });
    expect((await rest(c, u.token, { endsAt: T0 + 61_000 })).body).toEqual({ ok: true, scheduled: false });
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_rest').get() as any).n).toBe(0); // the pending one was dropped
  });
});

describe('POST /session', () => {
  const ses = (c: Ctx, token: string, body: unknown) => c.raw('POST', '/push/session', token, body);
  test('seq and timestamp bounds', async () => {
    const c = mk(); const u = await c.user();
    const ok = { seq: 1, startedAt: T0 - 1000 };
    expect((await ses(c, u.token, ok)).body).toEqual({ ok: true });
    for (const [label, body] of [
      ['seq 0', { ...ok, seq: 0 }], ['seq -1', { ...ok, seq: -1 }], ['seq float', { ...ok, seq: 1.5 }], ['seq string', { ...ok, seq: '1' }], ['seq 1e6+1', { ...ok, seq: 1_000_001 }],
      ['no startedAt', { seq: 1 }], ['startedAt string', { seq: 1, startedAt: String(T0) }], ['startedAt 24h old', { seq: 1, startedAt: T0 - 86_400_000 }], ['startedAt future', { seq: 1, startedAt: T0 + 60_001 }],
    ] as const) {
      const r = await ses(c, u.token, body);
      expect([label, r.status, r.body]).toEqual([label, 400, { error: 'invalid_session' }]);
    }
    expect((await ses(c, u.token, 'junk')).body).toEqual({ error: 'invalid_session' });
    for (const body of [{ seq: 1_000_000, startedAt: T0 }, { seq: 1, startedAt: T0 - 86_399_999 }, { seq: 1, startedAt: T0 + 60_000 }]) expect((await ses(c, u.token, body)).status).toBe(200);
  });
  test('lastLoggedAt: optional, same window as startedAt, stored rounded', async () => {
    const c = mk(); const u = await c.user();
    const base = { seq: 3, startedAt: T0 - 5000.4 };
    for (const bad of ['x', T0 - 86_400_000, T0 + 60_001, {}, true]) {
      const r = await ses(c, u.token, { ...base, lastLoggedAt: bad });
      expect([String(bad), r.status, r.body]).toEqual([String(bad), 400, { error: 'invalid_lastLoggedAt' }]);
    }
    expect((await ses(c, u.token, { ...base, lastLoggedAt: null })).status).toBe(200);
    expect(row(c, 'SELECT seq,started_at,last_logged_at,last_beat FROM push_session')).toEqual({ seq: 3, started_at: T0 - 5000, last_logged_at: null, last_beat: T0 });
    c.clock.advance(1000);
    expect((await ses(c, u.token, { ...base, lastLoggedAt: T0 - 2000.6 })).status).toBe(200);
    expect(row(c, 'SELECT last_logged_at,last_beat FROM push_session')).toEqual({ last_logged_at: T0 - 2001, last_beat: T0 + 1000 });
    expect((await ses(c, u.token, { ...base, lastLoggedAt: T0 + 61_000 })).status).toBe(200);
    expect((await ses(c, u.token, { ...base, lastLoggedAt: T0 + 61_001 })).status).toBe(400);
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_session').get() as any).n).toBe(1);
    expect((await c.raw('DELETE', '/push/session', u.token)).body).toEqual({ ok: true });
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_session').get() as any).n).toBe(0);
  });
});

describe('rest delivery wiring', () => {
  test('flushRests delivers the stored copy once and is idempotent; late/stale boundaries', async () => {
    const c = mk(); const u = await c.user(); const s = await newSub(1);
    await c.raw('POST', '/push/subscribe', u.token, { subscription: s.json });
    await c.raw('POST', '/push/rest', u.token, { endsAt: T0 + 30_000, title: 'Go', label: 'Squat' });
    expect(await c.push.flushRests()).toBe(0); // not due yet
    expect(c.sent).toHaveLength(0);
    c.clock.set(T0 + 30_000); // due exactly at endsAt
    expect(await c.push.flushRests()).toBe(1);
    expect(await c.push.flushRests()).toBe(0);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0].p).toMatchObject({ type: 'rest', title: 'Go', body: "Squat. Let's go.", tag: 'rest', url: '/app/session/live', ts: T0 + 30_000 });
    expect(c.sent[0].s.endpoint).toBe(s.endpoint);
    // overdue by exactly the stale window is still sent; one ms more is dropped
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
    c.clock.advance(1000 + 120_000);
    expect(await c.push.flushRests()).toBe(1);
    await c.raw('POST', '/push/rest', u.token, { endsAt: c.clock.now() + 1000 });
    c.clock.advance(1000 + 120_001);
    expect(await c.push.flushRests()).toBe(0);
    expect((c.db.query('SELECT COUNT(*) AS n FROM push_rest').get() as any).n).toBe(0);
  });
});
