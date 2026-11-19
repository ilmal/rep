// Mutation-killing tests for api.ts: auth, limits, rate limiters, sync pagination/validation, tokens.
import { afterEach, describe, expect, test, setSystemTime } from 'bun:test';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { openDb } from './db';
import { buildApi } from './api';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
afterEach(() => setSystemTime());

function mk() {
  const db = openDb(':memory:');
  const app = new Hono();
  app.route('/api', buildApi(db));
  const call = async (path: string, init: { method?: string; token?: string; json?: unknown; raw?: string; headers?: Record<string, string>; authHeader?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.authHeader !== undefined) headers.authorization = init.authHeader;
    const res = await app.request(`/api${path}`, { method: init.method ?? 'POST', headers, body: init.raw ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const anon = async (name?: string, headers?: Record<string, string>) => (await call('/auth/anon', { json: name === undefined ? {} : { name }, headers })).body as { token: string; userId: string };
  return { db, call, anon };
}
const gym = (id: string, updatedAt = 1, data: unknown = { n: id }, extra: object = {}) => ({ type: 'gym', id, updatedAt, data, ...extra });

describe('routing and auth', () => {
  test('health and unknown paths', async () => {
    const { call } = mk();
    const h = await call('/health', { method: 'GET' });
    expect(h.status).toBe(200);
    expect(h.body.ok).toBe(true);
    expect(Math.abs(h.body.time - Date.now())).toBeLessThan(5000);
    const nf = await call('/nope/deeper', { method: 'GET' });
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual({ error: 'not_found' });
    expect((await call('/health', { method: 'POST' })).status).toBe(404);
  });
  test('every protected route needs a valid bearer token', async () => {
    const { call, anon } = mk();
    const t = await anon();
    const routes: [string, string][] = [['GET', '/me'], ['POST', '/sync'], ['DELETE', '/account'], ['DELETE', '/account/data'], ['GET', '/export'], ['GET', '/tokens'], ['POST', '/tokens'], ['DELETE', '/tokens/x'], ['POST', '/auth/register'], ['POST', '/auth/logout']];
    for (const [method, path] of routes) {
      const none = await call(path, { method, json: {} });
      expect([method, path, none.status, none.body]).toEqual([method, path, 401, { error: 'unauthorized' }]);
      expect((await call(path, { method, json: {}, authHeader: 'Bearer ' })).status).toBe(401);
      expect((await call(path, { method, json: {}, authHeader: 'Bearer nope' })).body).toEqual({ error: 'unauthorized' });
      expect((await call(path, { method, json: {}, authHeader: `bearer ${t.token}` })).status).toBe(401);
      expect((await call(path, { method, json: {}, authHeader: t.token })).status).toBe(401);
      expect((await call(path, { method, json: {}, authHeader: `Basic ${t.token}` })).status).toBe(401);
    }
    expect((await call('/me', { method: 'GET', token: t.token })).status).toBe(200);
  });
  test('public routes do not need a token', async () => {
    const { call } = mk();
    expect((await call('/health', { method: 'GET' })).status).toBe(200);
    expect((await call('/auth/anon', { json: {} })).status).toBe(200);
    expect((await call('/auth/login', { json: {} })).status).toBe(401);
  });
  test('token use updates last_used; only the hash is stored', async () => {
    const { call, anon, db } = mk();
    const t = await anon();
    const row = () => db.query('SELECT hash,created_at,last_used FROM tokens').get() as any;
    expect(row().hash).toBe(sha(t.token));
    expect(row().hash).not.toBe(t.token);
    setSystemTime(new Date(Date.now() + 3_600_000));
    const later = Date.now();
    await call('/me', { method: 'GET', token: t.token });
    expect(Math.abs(row().last_used - later)).toBeLessThan(2000);
    expect(row().created_at).toBeLessThan(later - 3_000_000);
  });
});

describe('anon / me / logout / delete', () => {
  test('anon: name sliced to 60 chars, non-string ignored, returns userId matching /me', async () => {
    const { call, anon } = mk();
    const long = await anon('x'.repeat(100));
    const me = (await call('/me', { method: 'GET', token: long.token })).body;
    expect(me.name).toBe('x'.repeat(60));
    expect(me).toEqual({ userId: long.userId, email: null, name: 'x'.repeat(60), seq: 0 });
    const exact = await anon('y'.repeat(60));
    expect((await call('/me', { method: 'GET', token: exact.token })).body.name).toBe('y'.repeat(60));
    const num = (await call('/auth/anon', { json: { name: 42 } })).body;
    expect((await call('/me', { method: 'GET', token: num.token })).body.name).toBe('');
    const bad = (await call('/auth/anon', { raw: 'not json' })).body;
    expect(bad.token).toBeTruthy();
    expect(long.userId).not.toBe(exact.userId);
    expect(long.token).not.toBe(exact.token);
    expect(long.token.length).toBeGreaterThanOrEqual(40);
  });
  test('logout revokes only that token', async () => {
    const { call, anon } = mk();
    const a = await anon();
    const reg = await call('/auth/register', { token: a.token, json: { email: 'a@b.se', password: 'longenough1' } });
    expect(reg.status).toBe(200);
    const second = (await call('/auth/login', { json: { email: 'a@b.se', password: 'longenough1' } })).body;
    expect((await call('/auth/logout', { token: a.token })).body).toEqual({ ok: true });
    expect((await call('/me', { method: 'GET', token: a.token })).status).toBe(401);
    expect((await call('/me', { method: 'GET', token: second.token })).status).toBe(200);
  });
  test('delete account removes the user and cascades their data', async () => {
    const { call, anon, db } = mk();
    const a = await anon(), b = await anon();
    await call('/sync', { token: a.token, json: { changes: [gym('g')], events: [{ id: 'e', at: 1, kind: 'k' }] } });
    await call('/sync', { token: b.token, json: { changes: [gym('g2')] } });
    expect((await call('/account', { method: 'DELETE', token: a.token })).body).toEqual({ ok: true });
    expect((await call('/me', { method: 'GET', token: a.token })).status).toBe(401);
    expect((await call('/me', { method: 'GET', token: b.token })).status).toBe(200);
    expect(db.query('SELECT COUNT(*) AS n FROM entities').get()).toEqual({ n: 1 });
    expect(db.query('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 0 });
  });
  test('delete data keeps the account, resets seq, and only touches the caller', async () => {
    const { call, anon } = mk();
    const a = await anon(), b = await anon();
    await call('/sync', { token: a.token, json: { changes: [gym('g'), gym('h')], events: [{ id: 'e', at: 1, kind: 'k' }] } });
    await call('/sync', { token: b.token, json: { changes: [gym('other')], events: [{ id: 'eb', at: 1, kind: 'k' }] } });
    expect((await call('/me', { method: 'GET', token: a.token })).body.seq).toBe(2);
    expect((await call('/account/data', { method: 'DELETE', token: a.token })).body).toEqual({ ok: true });
    expect((await call('/me', { method: 'GET', token: a.token })).body.seq).toBe(0);
    const ea = (await call('/export', { method: 'GET', token: a.token })).body;
    expect(ea.entities).toEqual([]);
    expect(ea.events).toEqual([]);
    const eb = (await call('/export', { method: 'GET', token: b.token })).body;
    expect(eb.entities).toHaveLength(1);
    expect(eb.events).toHaveLength(1);
    expect((await call('/me', { method: 'GET', token: b.token })).body.seq).toBe(1);
  });
});

describe('register / login validation', () => {
  let ipn = 0; // register shares the per-IP login budget, so every call comes from a fresh address
  const reg = async (m: ReturnType<typeof mk>, token: string, email: unknown, password: unknown) =>
    m.call('/auth/register', { token, json: { email, password }, headers: { 'x-forwarded-for': `10.0.${Math.floor(++ipn / 250)}.${ipn % 250}` } });
  test('email format and length', async () => {
    const m = mk();
    const { token } = await m.anon();
    for (const e of ['', 'plain', 'a@b', 'a@@b.se', '@b.se', 'a@.se', 'a b@c.se', 'a@b c.se', 'a@b.s e', 'a@b.', undefined, null, 5]) {
      const r = await reg(m, token, e, 'longenough1');
      expect([String(e), r.status, r.body]).toEqual([String(e), 400, { error: 'invalid_email' }]);
    }
    const ok200 = 'a'.repeat(200 - '@b.se'.length) + '@b.se';
    expect(ok200).toHaveLength(200);
    const tooLong = 'a'.repeat(201 - '@b.se'.length) + '@b.se';
    expect((await reg(m, token, tooLong, 'longenough1')).body).toEqual({ error: 'invalid_email' });
    const r = await reg(m, token, `  ${ok200.toUpperCase()}  `, 'longenough1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, email: ok200 });
  });
  test('accepts realistic multi-character domains', async () => {
    const m = mk();
    for (const [i, e] of ['someone@example.com', 'a.b+c@sub.example.co.uk', 'x@yy.zz'].entries()) {
      const { token } = await m.anon();
      expect([e, (await reg(m, token, e, 'longenough1')).status]).toEqual([e, 200]);
      void i;
    }
  });
  test('password length 8..200', async () => {
    const m = mk();
    const { token } = await m.anon();
    for (const p of ['', 'short', '1234567', 'x'.repeat(201), undefined]) {
      const r = await reg(m, token, 'w@b.se', p);
      expect([String(p).length, r.status, r.body]).toEqual([String(p).length, 400, { error: 'weak_password' }]);
    }
    expect((await reg(m, token, 'w@b.se', '12345678')).status).toBe(200);
    const m2 = mk();
    expect((await reg(m2, (await m2.anon()).token, 'w@b.se', 'x'.repeat(200))).status).toBe(200);
  });
  test('duplicate email -> 409, case-insensitive; the email is bound to the account', async () => {
    const m = mk();
    const a = await m.anon(), b = await m.anon();
    expect((await reg(m, a.token, 'dup@b.se', 'longenough1')).status).toBe(200);
    const r = await reg(m, b.token, ' DUP@b.se', 'longenough1');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: 'email_taken' });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.email).toBe('dup@b.se');
    expect((await m.call('/me', { method: 'GET', token: b.token })).body.email).toBeNull();
  });
  test('login: normalises email, verifies password, anon accounts and unknown emails fail identically', async () => {
    const m = mk();
    const a = await m.anon();
    await reg(m, a.token, 'log@b.se', 'longenough1');
    const ok = await m.call('/auth/login', { json: { email: '  LOG@B.se ', password: 'longenough1' } });
    expect(ok.status).toBe(200);
    expect(ok.body.userId).toBe(a.userId);
    expect(ok.body.token).toBeTruthy();
    const wrong = await m.call('/auth/login', { json: { email: 'log@b.se', password: 'longenough2' } });
    const unknown = await m.call('/auth/login', { json: { email: 'zzz@b.se', password: 'longenough1' } });
    const empty = await m.call('/auth/login', { json: { email: '', password: 'longenough1' } });
    const noPw = await m.call('/auth/login', { json: { email: 'log@b.se' } });
    for (const r of [wrong, unknown, empty, noPw]) expect([r.status, r.body]).toEqual([401, { error: 'invalid_credentials' }]);
    // an account created through /auth/anon has no password: it can never log in
    const m2 = mk();
    await m2.anon();
    expect((await m2.call('/auth/login', { json: { email: 'null', password: '' } })).status).toBe(401);
    // an account with an email but NO password (created by magic-link sign-in) must not accept any password
    m.db.query('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').run('ml-user', 'magic@b.se', '', 1);
    for (const password of ['', 'anything', 'longenough1']) {
      const r = await m.call('/auth/login', { json: { email: 'magic@b.se', password }, headers: { 'x-forwarded-for': `1.2.3.${password.length}` } });
      expect([password, r.status, r.body]).toEqual([password, 401, { error: 'invalid_credentials' }]);
    }
    // password is stored hashed
    expect((m.db.query('SELECT pass_hash FROM users WHERE email=?').get('log@b.se') as any).pass_hash).toStartWith('$argon2');
  });
});

describe('rate limiters (fixed window per client key)', () => {
  const T0 = Date.UTC(2026, 0, 1);
  const ANON = Number(process.env.ANON_RATE_LIMIT ?? 60); // anonymous sign-ups per hour per IP (env-tunable, default 60)
  test('anon: ANON_RATE_LIMIT (60) per hour per IP; the next one is 429; window edge is exclusive; other IPs unaffected', async () => {
    const m = mk();
    setSystemTime(new Date(T0));
    for (let i = 0; i < ANON; i++) expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(200);
    const blocked = await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate_limited' });
    expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.2' } })).status).toBe(200);
    setSystemTime(new Date(T0 + 3_600_000 - 1));
    expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(429);
    setSystemTime(new Date(T0 + 3_600_000)); // reset == now: window not yet over
    expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(429);
    setSystemTime(new Date(T0 + 3_600_001));
    expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(200);
    // a fresh window starts counting from 1 again
    for (let i = 0; i < ANON - 1; i++) expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(200);
    expect((await m.call('/auth/anon', { json: {}, headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(429);
  });
  test('client key: first x-forwarded-for entry (trimmed), then x-real-ip, then shared "local"', async () => {
    const m = mk();
    const hit = (headers: Record<string, string>) => m.call('/auth/anon', { json: {}, headers });
    for (let i = 0; i < ANON; i++) await hit({ 'x-forwarded-for': ' 5.5.5.5 , 6.6.6.6' });
    expect((await hit({ 'x-forwarded-for': '5.5.5.5' })).status).toBe(429); // same first entry, trimmed
    expect((await hit({ 'x-forwarded-for': '6.6.6.6' })).status).toBe(200); // second entry is not the key
    for (let i = 0; i < ANON; i++) await hit({ 'x-real-ip': '7.7.7.7' });
    expect((await hit({ 'x-real-ip': '7.7.7.7' })).status).toBe(429);
    expect((await hit({ 'x-real-ip': '7.7.7.8' })).status).toBe(200);
    expect((await hit({ 'x-forwarded-for': '', 'x-real-ip': '7.7.7.7' })).status).toBe(429); // empty xff falls through to x-real-ip
    for (let i = 0; i < ANON; i++) await hit({});
    expect((await hit({})).status).toBe(429); // "local"
    expect((await hit({ 'x-forwarded-for': '5.5.5.9' })).status).toBe(200);
  });
  test('login and register share a 10 / 15 min budget per IP', async () => {
    const m = mk();
    setSystemTime(new Date(T0));
    const h = { 'x-forwarded-for': '8.8.8.8' };
    for (let i = 0; i < 10; i++) expect((await m.call('/auth/login', { json: { email: 'x@y.se', password: 'p' }, headers: h })).status).toBe(401);
    const blocked = await m.call('/auth/login', { json: { email: 'x@y.se', password: 'p' }, headers: h });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate_limited' });
    const { token } = await m.anon();
    const reg = await m.call('/auth/register', { token, json: { email: 'a@b.se', password: 'longenough1' }, headers: h });
    expect([reg.status, reg.body]).toEqual([429, { error: 'rate_limited' }]);
    expect((await m.call('/auth/login', { json: { email: 'x@y.se', password: 'p' }, headers: { 'x-forwarded-for': '8.8.8.9' } })).status).toBe(401);
    setSystemTime(new Date(T0 + 15 * 60_000));
    expect((await m.call('/auth/login', { json: { email: 'x@y.se', password: 'p' }, headers: h })).status).toBe(429);
    setSystemTime(new Date(T0 + 15 * 60_000 + 1));
    expect((await m.call('/auth/login', { json: { email: 'x@y.se', password: 'p' }, headers: h })).status).toBe(401);
  });
  test('register is limited before validating', async () => {
    const m = mk();
    const { token } = await m.anon();
    const h = { 'x-forwarded-for': '4.4.4.4' };
    for (let i = 0; i < 10; i++) expect((await m.call('/auth/register', { token, json: { email: 'bad', password: 'x' }, headers: h })).status).toBe(400);
    expect((await m.call('/auth/register', { token, json: { email: 'bad', password: 'x' }, headers: h })).status).toBe(429);
  });
});

describe('sync: request limits', () => {
  test('invalid json and body size boundary (8 MiB)', async () => {
    const m = mk();
    const { token } = await m.anon();
    expect((await m.call('/sync', { token, raw: '{nope' })).body).toEqual({ error: 'bad_json' });
    expect((await m.call('/sync', { token, raw: '' })).status).toBe(400);
    const limit = 8 * 1024 * 1024;
    const frame = (n: number) => `{"name":"${'a'.repeat(n - '{"name":""}'.length)}"}`;
    const exact = frame(limit);
    expect(exact).toHaveLength(limit);
    expect((await m.call('/sync', { token, raw: exact })).status).toBe(200);
    const over = frame(limit + 1);
    const r = await m.call('/sync', { token, raw: over });
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: 'too_large' });
  });
  test('at most 500 changes and 2000 events per request', async () => {
    const m = mk();
    const { token } = await m.anon();
    const changes = (n: number) => Array.from({ length: n }, (_, i) => gym(`g${i}`));
    const events = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, at: i, kind: 'k' }));
    const over = await m.call('/sync', { token, json: { changes: changes(501) } });
    expect([over.status, over.body]).toEqual([413, { error: 'too_many' }]);
    const ok = await m.call('/sync', { token, json: { changes: changes(500) } });
    expect(ok.status).toBe(200);
    expect(ok.body.accepted).toHaveLength(500);
    expect((await m.call('/sync', { token, json: { events: events(2001) } })).status).toBe(413);
    expect((await m.call('/sync', { token, json: { events: events(2000) } })).status).toBe(200);
    expect((await m.call('/export', { method: 'GET', token })).body.events).toHaveLength(2000);
    // non-array changes/events are treated as empty
    const odd = await m.call('/sync', { token, json: { changes: 'x', events: { a: 1 } } });
    expect(odd.status).toBe(200);
    expect(odd.body.accepted).toEqual([]);
    expect(odd.body.rejected).toEqual([]);
  });
});

describe('sync: change validation', () => {
  test('rejects bad types, ids, timestamps and nulls with reason invalid', async () => {
    const m = mk();
    const { token } = await m.anon();
    const types = ['settings', 'gym', 'area', 'exercise', 'progress', 'session', 'pref', 'plan'];
    const good = types.map((t) => ({ type: t, id: `${t}1`, updatedAt: 1, data: { t } }));
    const bad = [
      { type: 'nope', id: 'x', updatedAt: 1 }, { type: 'gym', id: 5, updatedAt: 1 }, { type: 'gym', id: 'x'.repeat(81), updatedAt: 1 },
      { type: 'gym', id: 'x', updatedAt: '5' }, { type: 'gym', id: 'x', updatedAt: Infinity }, { type: 'gym', id: 'x' }, { type: 'gym', id: 'x', updatedAt: null }, null,
    ];
    const r = await m.call('/sync', { token, json: { changes: [...bad, ...good] } });
    expect(r.body.accepted).toEqual(types.map((t) => `${t}:${t}1`));
    expect(r.body.rejected).toHaveLength(bad.length);
    expect(r.body.rejected.every((x: any) => x.reason === 'invalid')).toBe(true);
    expect(r.body.rejected[0]).toEqual({ type: 'nope', id: 'x', reason: 'invalid' });
    expect(r.body.rejected[1]).toEqual({ type: 'gym', id: '5', reason: 'invalid' });
    expect(r.body.rejected[7]).toEqual({ type: 'undefined', id: 'undefined', reason: 'invalid' });
    // id length 80 is fine; updatedAt 0 and negative are finite numbers
    const edge = await m.call('/sync', { token, json: { changes: [gym('y'.repeat(80), 0), gym('neg', -5)] } });
    expect(edge.body.accepted).toEqual([`gym:${'y'.repeat(80)}`, 'gym:neg']);
  });
  test('entity size cap: JSON up to 512 KiB is stored, 1 byte more is rejected as too_large', async () => {
    const m = mk();
    const { token } = await m.anon();
    const cap = 512 * 1024;
    const exact = 'a'.repeat(cap - 2); // JSON.stringify adds two quotes
    const r = await m.call('/sync', { token, json: { changes: [gym('ok', 1, exact), gym('big', 1, exact + 'a')] } });
    expect(r.body.accepted).toEqual(['gym:ok']);
    expect(r.body.rejected).toEqual([{ type: 'gym', id: 'big', reason: 'too_large' }]);
  });
  test('missing data is stored as null; deleted flag round-trips to other devices', async () => {
    const m = mk();
    const a = await m.anon();
    await m.call('/sync', { token: a.token, json: { changes: [{ type: 'gym', id: 'n', updatedAt: 1 }, gym('d', 1, { z: 1 }, { deleted: true }), gym('live', 1, { z: 2 }, { deleted: false })] } });
    const ex = (await m.call('/export', { method: 'GET', token: a.token })).body;
    const by = Object.fromEntries(ex.entities.map((e: any) => [e.id, e]));
    expect(by.n.data).toBeNull();
    expect(by.n.deleted).toBe(false);
    expect(by.d.deleted).toBe(true);
    expect(by.live.deleted).toBe(false);
    expect(by.d.updatedAt).toBe(1);
    expect(by.d.type).toBe('gym');
    expect(by.d.data).toEqual({ z: 1 });
  });
  test('last-write-wins: equal timestamp overwrites, older is rejected as stale and the newer copy returns', async () => {
    const m = mk();
    const a = await m.anon();
    await m.call('/sync', { token: a.token, json: { changes: [gym('g', 100, { v: 'one' })] } });
    const same = await m.call('/sync', { token: a.token, json: { cursor: 1, changes: [gym('g', 100, { v: 'two' })] } });
    expect(same.body.accepted).toEqual(['gym:g']);
    const newer = await m.call('/sync', { token: a.token, json: { cursor: 2, changes: [gym('g', 101, { v: 'three' })] } });
    expect(newer.body.accepted).toEqual(['gym:g']);
    const stale = await m.call('/sync', { token: a.token, json: { cursor: 0, changes: [gym('g', 100, { v: 'old' })] } });
    expect(stale.body.accepted).toEqual([]);
    expect(stale.body.rejected).toEqual([{ type: 'gym', id: 'g', reason: 'stale' }]);
    expect(stale.body.changes).toHaveLength(1);
    expect(stale.body.changes[0]).toEqual({ type: 'gym', id: 'g', updatedAt: 101, deleted: false, data: { v: 'three' } });
    // the same id under another type is a different entity
    const other = await m.call('/sync', { token: a.token, json: { changes: [{ type: 'area', id: 'g', updatedAt: 1, data: {} }] } });
    expect(other.body.accepted).toEqual(['area:g']);
  });
});

describe('sync: cursor, pagination, echo suppression', () => {
  test('cursor handling: non-finite cursors count as 0; response cursor equals the user seq', async () => {
    const m = mk();
    const a = await m.anon();
    const first = await m.call('/sync', { token: a.token, json: { cursor: 0, changes: [gym('a'), gym('b'), gym('c')] } });
    expect(first.body.cursor).toBe(3);
    expect(first.body.more).toBe(false);
    expect(typeof first.body.serverTime).toBe('number');
    expect(Math.abs(first.body.serverTime - Date.now())).toBeLessThan(5000);
    const b = await m.anon();
    await m.call('/sync', { token: b.token, json: { changes: [gym('b1')] } });
    for (const cursor of ['2', 'x', null, undefined, NaN, {}]) {
      const r = await m.call('/sync', { token: a.token, json: { cursor, changes: [] } });
      expect([String(cursor), r.body.changes.length]).toEqual([String(cursor), 3]);
    }
    expect((await m.call('/sync', { token: a.token, json: { cursor: 1, changes: [] } })).body.changes.map((c: any) => c.id)).toEqual(['b', 'c']);
    expect((await m.call('/sync', { token: a.token, json: { cursor: 3, changes: [] } })).body).toMatchObject({ changes: [], cursor: 3, more: false });
    expect((await m.call('/sync', { token: a.token, json: { cursor: 99, changes: [] } })).body).toMatchObject({ changes: [], cursor: 99, more: false });
    expect((await m.call('/sync', { token: a.token, json: { cursor: -4, changes: [] } })).body.changes).toHaveLength(3);
  });
  test('pages of 500: more=true with the page cursor, then the remainder', async () => {
    const m = mk();
    const a = await m.anon();
    const b = await m.anon();
    for (let k = 0; k < 2; k++) await m.call('/sync', { token: a.token, json: { changes: Array.from({ length: 500 }, (_, i) => gym(`g${k}_${i}`)) } });
    await m.call('/sync', { token: a.token, json: { changes: [gym('last1'), gym('last2')] } });
    await m.call('/sync', { token: b.token, json: { changes: [gym('b-only')] } });
    const p1 = (await m.call('/sync', { token: a.token, json: { cursor: 0, changes: [] } })).body;
    expect(p1.changes).toHaveLength(500);
    expect(p1.more).toBe(true);
    expect(p1.cursor).toBe(500);
    const p2 = (await m.call('/sync', { token: a.token, json: { cursor: p1.cursor, changes: [] } })).body;
    expect(p2.changes).toHaveLength(500);
    expect(p2.more).toBe(true);
    expect(p2.cursor).toBe(1000);
    const p3 = (await m.call('/sync', { token: a.token, json: { cursor: p2.cursor, changes: [] } })).body;
    expect(p3.changes.map((c: any) => c.id)).toEqual(['last1', 'last2']);
    expect(p3.more).toBe(false);
    expect(p3.cursor).toBe(1002);
    // exactly one full page is not "more"
    const c = await m.anon();
    await m.call('/sync', { token: c.token, json: { changes: Array.from({ length: 500 }, (_, i) => gym(`e${i}`)) } });
    const full = (await m.call('/sync', { token: c.token, json: { cursor: 0, changes: [] } })).body;
    expect(full.changes).toHaveLength(500);
    expect(full.more).toBe(false);
    expect(full.cursor).toBe(500);
  });
  test('own just-accepted writes are not echoed, but other devices writes (and stale-rejected copies) are', async () => {
    const m = mk();
    const a = await m.anon();
    const r = await m.call('/sync', { token: a.token, json: { cursor: 0, changes: [gym('x', 5, { v: 1 }), gym('y', 5, { v: 2 })] } });
    expect(r.body.changes).toEqual([]);
    expect(r.body.accepted).toEqual(['gym:x', 'gym:y']);
    expect(r.body.cursor).toBe(2);
    const mixed = await m.call('/sync', { token: a.token, json: { cursor: 0, changes: [gym('x', 4, { v: 'stale' }), gym('z', 5, { v: 3 })] } });
    expect(mixed.body.accepted).toEqual(['gym:z']);
    expect(mixed.body.changes.map((c: any) => c.id)).toEqual(['x', 'y']); // z is own write, x/y come back from the server
    expect(mixed.body.cursor).toBe(3);
  });
  test('accepted changes bump seq per change in order and users are isolated', async () => {
    const m = mk();
    const a = await m.anon(), b = await m.anon();
    await m.call('/sync', { token: a.token, json: { changes: [gym('1'), gym('2'), gym('3')] } });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.seq).toBe(3);
    expect((await m.call('/me', { method: 'GET', token: b.token })).body.seq).toBe(0);
    await m.call('/sync', { token: a.token, json: { changes: [gym('2', 9, { v: 'again' })] } });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.seq).toBe(4);
    // rejected changes do not bump seq
    await m.call('/sync', { token: a.token, json: { changes: [gym('2', 1)] } });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.seq).toBe(4);
    const pull = (await m.call('/sync', { token: a.token, json: { cursor: 0 } })).body;
    expect(pull.changes.map((c: any) => c.id)).toEqual(['1', '3', '2']); // ordered by seq; id 2 moved to the end
  });
});

describe('sync: events and name', () => {
  test('valid events are stored (deduped by id), invalid ones skipped, long fields trimmed', async () => {
    const m = mk();
    const a = await m.anon();
    const events = [
      { id: 'e1', at: 10, kind: 'set_logged', sessionId: 's1', payload: { w: 50 } }, { id: 'e1', at: 99, kind: 'dup' },
      { id: 5, at: 1, kind: 'k' }, { id: 'e3', at: 1, kind: 7 }, { id: 'e4', at: 'x', kind: 'k' }, { id: 'e5', at: Infinity, kind: 'k' }, null,
      { id: 'i'.repeat(100), at: 1, kind: 'k'.repeat(100), sessionId: 's'.repeat(100) }, { id: 'e7', at: 0, kind: 'zero' },
    ];
    await m.call('/sync', { token: a.token, json: { events } });
    const ex = (await m.call('/export', { method: 'GET', token: a.token })).body.events;
    expect(ex.map((e: any) => e.id)).toEqual(['e7', 'i'.repeat(80), 'e1']); // ordered by `at`
    const e1 = ex.find((e: any) => e.id === 'e1');
    expect(e1).toEqual({ id: 'e1', at: 10, kind: 'set_logged', sessionId: 's1', payload: { w: 50 } });
    const long = ex.find((e: any) => e.id.startsWith('iii'));
    expect(long.kind).toBe('k'.repeat(60));
    expect(long.sessionId).toBe('s'.repeat(80));
    expect(long.payload).toBeNull();
    expect(ex.find((e: any) => e.id === 'e7').sessionId).toBeNull();
    // events are per user
    const b = await m.anon();
    expect((await m.call('/export', { method: 'GET', token: b.token })).body.events).toEqual([]);
  });
  test('payload up to 20000 chars is kept verbatim; larger payloads become a valid marker (export must not crash)', async () => {
    const m = mk();
    const a = await m.anon();
    const fits = { s: 'x'.repeat(20000 - '{"s":""}'.length) };
    expect(JSON.stringify(fits)).toHaveLength(20000);
    const over = { s: 'x'.repeat(20000 - '{"s":""}'.length + 1) };
    await m.call('/sync', { token: a.token, json: { events: [{ id: 'fit', at: 1, kind: 'k', payload: fits }, { id: 'over', at: 2, kind: 'k', payload: over }, { id: 'nopay', at: 3, kind: 'k' }, { id: 'zero', at: 4, kind: 'k', payload: 0 }] } });
    const ex = await m.call('/export', { method: 'GET', token: a.token });
    expect(ex.status).toBe(200);
    const by = Object.fromEntries(ex.body.events.map((e: any) => [e.id, e]));
    expect(by.fit.payload).toEqual(fits);
    expect(by.over.payload).toEqual({ truncated: true });
    expect(by.nopay.payload).toBeNull();
    expect(by.zero.payload).toBe(0);
  });
  test('rows stored with an unparseable (legacy, truncated) payload export as null instead of failing', async () => {
    const m = mk();
    const a = await m.anon();
    m.db.query('INSERT INTO events(user_id,id,at,kind,session_id,payload) VALUES(?,?,?,?,?,?)').run(a.userId, 'legacy', 1, 'k', null, '{"cut":"of');
    m.db.query('INSERT INTO events(user_id,id,at,kind,session_id,payload) VALUES(?,?,?,?,?,?)').run(a.userId, 'fine', 2, 'k', null, '{"a":1}');
    m.db.query('INSERT INTO events(user_id,id,at,kind,session_id,payload) VALUES(?,?,?,?,?,?)').run(a.userId, 'empty', 3, 'k', null, '');
    const r = await m.call('/export', { method: 'GET', token: a.token });
    expect(r.status).toBe(200);
    expect(r.body.events.map((e: any) => [e.id, e.payload])).toEqual([['legacy', null], ['fine', { a: 1 }], ['empty', null]]);
  });
  test('events keep chronological order in export; name is trimmed to 60 chars; non-string names ignored', async () => {
    const m = mk();
    const a = await m.anon('start');
    await m.call('/sync', { token: a.token, json: { name: 'N'.repeat(70), events: [{ id: 'b', at: 20, kind: 'k' }, { id: 'a', at: 10, kind: 'k' }] } });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.name).toBe('N'.repeat(60));
    await m.call('/sync', { token: a.token, json: { name: 5 } });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.name).toBe('N'.repeat(60));
    await m.call('/sync', { token: a.token, json: { name: '' } });
    expect((await m.call('/me', { method: 'GET', token: a.token })).body.name).toBe('');
    expect((await m.call('/export', { method: 'GET', token: a.token })).body.events.map((e: any) => e.id)).toEqual(['a', 'b']);
  });
});

describe('export', () => {
  test('shape, headers and email', async () => {
    const m = mk();
    const a = await m.anon();
    await m.call('/auth/register', { token: a.token, json: { email: 'ex@b.se', password: 'longenough1' } });
    await m.call('/sync', { token: a.token, json: { changes: [gym('g', 7, { k: 1 }, { deleted: true })] } });
    const r = await m.call('/export', { method: 'GET', token: a.token });
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="rep-export.json"');
    expect(r.body.user).toEqual({ id: a.userId, email: 'ex@b.se' });
    expect(Math.abs(r.body.exportedAt - Date.now())).toBeLessThan(5000);
    expect(r.body.entities).toEqual([{ type: 'gym', id: 'g', updatedAt: 7, deleted: true, data: { k: 1 } }]);
    const anon = await m.anon();
    expect((await m.call('/export', { method: 'GET', token: anon.token })).body.user).toEqual({ id: anon.userId, email: null });
  });
});

describe('api tokens', () => {
  test('create: defaults, scope mapping, name trimming, prefix and hashed storage', async () => {
    const m = mk();
    const s = (await m.anon()).token;
    const def = (await m.call('/tokens', { token: s, json: {} })).body;
    expect(def).toMatchObject({ name: 'Coach', scope: 'write' });
    expect(def.token).toStartWith('rep_');
    expect(def.token.length).toBeGreaterThanOrEqual(40);
    expect(def.id).toBeTruthy();
    const row = m.db.query('SELECT hash,prefix,scope,name FROM api_tokens WHERE id=?').get(def.id) as any;
    expect(row.hash).toBe(sha(def.token));
    expect(row.prefix).toBe(def.token.slice(0, 8));
    expect(row.prefix).toHaveLength(8);
    const rd = (await m.call('/tokens', { token: s, json: { name: '  Reader  ', scope: 'read' } })).body;
    expect(rd).toMatchObject({ name: 'Reader', scope: 'read' });
    expect((await m.call('/tokens', { token: s, json: { scope: 'admin' } })).body.scope).toBe('write');
    expect((await m.call('/tokens', { token: s, json: { scope: 'READ' } })).body.scope).toBe('write');
    expect((await m.call('/tokens', { token: s, json: { name: '   ' } })).body.name).toBe('Coach');
    expect((await m.call('/tokens', { token: s, json: { name: 'n'.repeat(80) } })).body.name).toBe('n'.repeat(60));
    expect((await m.call('/tokens', { token: s, raw: 'garbage' })).body.name).toBe('Coach');
    expect((await m.call('/tokens', { token: s, json: { name: null } })).body.name).toBe('Coach');
  });
  test('at most 10 active tokens per user; revoking frees a slot; users are independent', async () => {
    const m = mk();
    const s = (await m.anon()).token;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await m.call('/tokens', { token: s, json: { name: `t${i}` } })).body.id);
    const over = await m.call('/tokens', { token: s, json: {} });
    expect([over.status, over.body]).toEqual([400, { error: 'too_many_tokens' }]);
    await m.call(`/tokens/${ids[3]}`, { method: 'DELETE', token: s });
    expect((await m.call('/tokens', { token: s, json: {} })).status).toBe(200);
    const other = (await m.anon()).token;
    expect((await m.call('/tokens', { token: other, json: {} })).status).toBe(200);
  });
  test('list: own, non-revoked, newest first, with metadata and no secrets', async () => {
    const m = mk();
    const s = (await m.anon()).token;
    const other = (await m.anon()).token;
    setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    const a = (await m.call('/tokens', { token: s, json: { name: 'A', scope: 'read' } })).body;
    setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 5)));
    const b = (await m.call('/tokens', { token: s, json: { name: 'B' } })).body;
    setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 9)));
    const c = (await m.call('/tokens', { token: s, json: { name: 'C' } })).body;
    await m.call('/tokens', { token: other, json: { name: 'Other' } });
    await m.call(`/tokens/${c.id}`, { method: 'DELETE', token: s });
    const l = (await m.call('/tokens', { method: 'GET', token: s })).body.tokens;
    expect(l.map((t: any) => t.name)).toEqual(['B', 'A']);
    expect(l[1]).toEqual({ id: a.id, name: 'A', scope: 'read', prefix: a.token.slice(0, 8), createdAt: Date.UTC(2026, 0, 1, 0, 0, 0), lastUsed: null });
    expect(l[0].createdAt).toBe(Date.UTC(2026, 0, 1, 0, 0, 5));
    expect(JSON.stringify(l)).not.toContain(b.token);
    expect(Object.keys(l[0]).sort()).toEqual(['createdAt', 'id', 'lastUsed', 'name', 'prefix', 'scope']);
  });
  test('revoking is idempotent and limited to the owner', async () => {
    const m = mk();
    const s1 = (await m.anon()).token, s2 = (await m.anon()).token;
    const t = (await m.call('/tokens', { token: s1, json: {} })).body;
    const mine = () => m.db.query('SELECT revoked FROM api_tokens WHERE id=?').get(t.id) as any;
    expect((await m.call(`/tokens/${t.id}`, { method: 'DELETE', token: s2 })).body).toEqual({ ok: true });
    expect(mine().revoked).toBe(0); // another user cannot revoke it
    expect((await m.call(`/tokens/${t.id}`, { method: 'DELETE', token: s1 })).body).toEqual({ ok: true });
    expect(mine().revoked).toBe(1);
    expect((await m.call(`/tokens/${t.id}`, { method: 'DELETE', token: s1 })).status).toBe(200);
    expect((await m.call('/tokens/does-not-exist', { method: 'DELETE', token: s1 })).status).toBe(200);
  });
});
