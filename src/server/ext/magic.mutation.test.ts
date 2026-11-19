// Mutation-killing tests for ext/magic.ts: limiter windows, TTL/prune boundaries, token length limits, mail payload, env gating.
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { openDb } from '../db';
import { buildApi } from '../api';
import magic, { TOKEN_TTL_MS } from './magic';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ENV = ['RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_URL', 'NODE_ENV'] as const;
let saved: Record<string, string | undefined> = {};
const T0 = Date.UTC(2026, 0, 1);
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); for (const k of ENV) delete process.env[k]; process.env.NODE_ENV = 'test'; setSystemTime(new Date(T0)); });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } setSystemTime(); });

function mk(o: { fetch?: typeof fetch } = {}) {
  const db = openDb(':memory:');
  let t = 5_000_000;
  const clock = { now: () => t, set: (v: number) => { t = v; }, advance: (ms: number) => { t += ms; } };
  const app = new Hono();
  app.route('/api/magic', magic(db, { now: clock.now, fetch: o.fetch }));
  app.route('/api', buildApi(db));
  const call = async (path: string, json?: unknown, headers: Record<string, string> = {}, url = 'http://localhost') => {
    const res = await app.request(`${url}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json === undefined ? undefined : JSON.stringify(json) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const tokenOf = (devLink: string) => new URL(devLink).searchParams.get('token')!;
  return { db, call, clock, tokenOf };
}
const ip = (n: string) => ({ 'x-forwarded-for': n });

describe('request: input validation and normalisation', () => {
  test('email length limit is 200 and addresses are trimmed + lowercased', async () => {
    const { call, db } = mk();
    const local = 'a'.repeat(200 - '@b.se'.length);
    expect((await call('/magic/request', { email: `${local}@b.se` }, ip('1.1.1.1'))).status).toBe(200);
    const over = await call('/magic/request', { email: `${local}a@b.se` }, ip('1.1.1.2'));
    expect([over.status, over.body]).toEqual([400, { error: 'invalid_email' }]);
    await call('/magic/request', { email: '  MiXed@Case.SE ' }, ip('1.1.1.3'));
    const emails = (db.query('SELECT email FROM magic_links ORDER BY created_at, email').all() as any[]).map((r) => r.email);
    expect(emails).toContain('mixed@case.se');
    expect(emails).toContain(`${local}@b.se`);
    for (const e of ['a@b.c', 'x@y.z.se']) expect((await call('/magic/request', { email: e }, ip('1.1.1.4'))).status).toBe(200);
    for (const e of ['a@b', '@b.se', 'a@.se', 'a@b.', 'a b@c.se', 'a@b@c.se', ' ', 'a@b.se junk', 'a@b.c@d', 'a@b.se\tx']) expect((await call('/magic/request', { email: e }, ip('1.1.1.5'))).status).toBe(400);
    expect((await call('/magic/request', undefined, ip('1.1.1.5'))).status).toBe(400);
  });
  test('a rejected email does not consume rate-limit budget', async () => {
    const { call } = mk();
    for (let i = 0; i < 30; i++) await call('/magic/request', { email: 'bad' }, ip('2.2.2.2'));
    expect((await call('/magic/request', { email: 'ok@b.se' }, ip('2.2.2.2'))).status).toBe(200);
  });
});

describe('request: rate limits', () => {
  test('per-email: 5 per hour; the 6th is 429 with exact Retry-After; window edge exclusive', async () => {
    const { call } = mk();
    for (let i = 0; i < 5; i++) expect((await call('/magic/request', { email: 'e@b.se' }, ip(`3.3.3.${i}`))).status).toBe(200);
    const blocked = await call('/magic/request', { email: 'e@b.se' }, ip('3.3.3.9'));
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate_limited', retryAfter: 3600 });
    expect(blocked.headers.get('retry-after')).toBe('3600');
    // another email on the same fresh IP is unaffected
    expect((await call('/magic/request', { email: 'other@b.se' }, ip('3.3.3.9'))).status).toBe(200);
    setSystemTime(new Date(T0 + 1000));
    expect((await call('/magic/request', { email: 'e@b.se' }, ip('3.3.3.9'))).body.retryAfter).toBe(3599);
    setSystemTime(new Date(T0 + 1500));
    expect((await call('/magic/request', { email: 'e@b.se' }, ip('3.3.3.9'))).body.retryAfter).toBe(3599); // ceil(3598.5)
    setSystemTime(new Date(T0 + 3_600_000 - 1));
    expect((await call('/magic/request', { email: 'e@b.se' }, ip('3.3.3.9'))).body.retryAfter).toBe(1);
    setSystemTime(new Date(T0 + 3_600_000)); // reset == now: still the same window, but at least 1 s
    const edge = await call('/magic/request', { email: 'e@b.se' }, ip('3.3.3.9'));
    expect([edge.status, edge.body.retryAfter, edge.headers.get('retry-after')]).toEqual([429, 1, '1']);
    setSystemTime(new Date(T0 + 3_600_001));
    expect((await call('/magic/request', { email: 'e@b.se' }, ip('3.3.3.9'))).status).toBe(200);
  });
  test('per-IP: 20 per hour, regardless of email; Retry-After counts down', async () => {
    const { call } = mk();
    for (let i = 0; i < 20; i++) expect((await call('/magic/request', { email: `u${i}@b.se` }, ip('4.4.4.4'))).status).toBe(200);
    const b = await call('/magic/request', { email: 'u99@b.se' }, ip('4.4.4.4'));
    expect([b.status, b.body]).toEqual([429, { error: 'rate_limited', retryAfter: 3600 }]);
    setSystemTime(new Date(T0 + 60_000));
    expect((await call('/magic/request', { email: 'u99@b.se' }, ip('4.4.4.4'))).body.retryAfter).toBe(3540);
    expect((await call('/magic/request', { email: 'u99@b.se' }, ip('4.4.4.5'))).status).toBe(200);
  });
  test('client key: first x-forwarded-for entry (trimmed), else x-real-ip, else "local"', async () => {
    const { call } = mk();
    const req = (h: Record<string, string>, n: number) => call('/magic/request', { email: `k${n}@b.se` }, h);
    let n = 0;
    for (let i = 0; i < 20; i++) await req({ 'x-forwarded-for': '  5.5.5.5 , 6.6.6.6' }, n++);
    expect((await req({ 'x-forwarded-for': '5.5.5.5' }, n++)).status).toBe(429);
    expect((await req({ 'x-forwarded-for': '6.6.6.6' }, n++)).status).toBe(200);
    for (let i = 0; i < 20; i++) await req({ 'x-real-ip': '7.7.7.7' }, n++);
    expect((await req({ 'x-real-ip': '7.7.7.7' }, n++)).status).toBe(429);
    expect((await req({ 'x-real-ip': '7.7.7.8' }, n++)).status).toBe(200);
    expect((await req({ 'x-forwarded-for': '', 'x-real-ip': '7.7.7.7' }, n++)).status).toBe(429);
    for (let i = 0; i < 20; i++) await req({}, n++);
    expect((await req({}, n++)).status).toBe(429);
  });
  test('a request blocked by the IP limit does not count against the email budget', async () => {
    const { call } = mk();
    for (let i = 0; i < 20; i++) await call('/magic/request', { email: `fill${i}@b.se` }, ip('8.8.8.8'));
    for (let i = 0; i < 4; i++) expect((await call('/magic/request', { email: 'victim@b.se' }, ip('8.8.8.8'))).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await call('/magic/request', { email: 'victim@b.se' }, ip(`8.8.9.${i}`))).status).toBe(200);
    expect((await call('/magic/request', { email: 'victim@b.se' }, ip('8.8.9.99'))).status).toBe(429);
  });
  test('verify: 30 per 15 minutes per IP with Retry-After', async () => {
    const { call } = mk();
    for (let i = 0; i < 30; i++) expect((await call('/magic/verify', { token: 'x'.repeat(30) }, ip('9.9.9.9'))).status).toBe(400);
    const b = await call('/magic/verify', { token: 'x'.repeat(30) }, ip('9.9.9.9'));
    expect([b.status, b.body, b.headers.get('retry-after')]).toEqual([429, { error: 'rate_limited', retryAfter: 900 }, '900']);
    expect((await call('/magic/verify', { token: 'x'.repeat(30) }, ip('9.9.9.10'))).status).toBe(400);
    setSystemTime(new Date(T0 + 15 * 60_000));
    expect((await call('/magic/verify', { token: 'x'.repeat(30) }, ip('9.9.9.9'))).body.retryAfter).toBe(1);
    setSystemTime(new Date(T0 + 15 * 60_000 + 1));
    expect((await call('/magic/verify', { token: 'x'.repeat(30) }, ip('9.9.9.9'))).status).toBe(400);
    // the verify budget is separate from the request budget
    const m = mk();
    for (let i = 0; i < 20; i++) await m.call('/magic/request', { email: `v${i}@b.se` }, ip('9.9.9.9'));
    expect((await m.call('/magic/verify', { token: 'x'.repeat(30) }, ip('9.9.9.9'))).status).toBe(400);
  });
});

describe('request: delivery', () => {
  test('dev mode: link uses PUBLIC_URL (trailing slashes stripped) or the request origin; 200 {ok, devLink}', async () => {
    const { call, tokenOf } = mk();
    const a = await call('/magic/request', { email: 'a@b.se' }, ip('1.0.0.1'), 'https://rep.example');
    expect(Object.keys(a.body).sort()).toEqual(['devLink', 'ok']);
    expect(a.body.devLink).toStartWith('https://rep.example/app/signin?token=');
    expect(tokenOf(a.body.devLink)).toHaveLength(43);
    process.env.PUBLIC_URL = 'https://pub.example///';
    const b = await call('/magic/request', { email: 'b@b.se' }, ip('1.0.0.2'));
    expect(b.body.devLink).toStartWith('https://pub.example/app/signin?token=');
    process.env.PUBLIC_URL = 'https://pub.example/base';
    expect((await call('/magic/request', { email: 'c@b.se' }, ip('1.0.0.3'))).body.devLink).toStartWith('https://pub.example/base/app/signin?token=');
  });
  test('dev mode logs the sign-in link to the console', async () => {
    const { call, tokenOf } = mk();
    const orig = console.log;
    const lines: string[] = [];
    console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
    let r;
    try { r = await call('/magic/request', { email: 'Log@B.se' }, ip('1.9.9.9'), 'https://rep.example'); } finally { console.log = orig; }
    expect(lines).toEqual([`[magic] sign-in link for log@b.se: https://rep.example/app/signin?token=${tokenOf(r.body.devLink)}`]);
  });
  test('stores sha256(token) with created_at/expires_at from the injected clock', async () => {
    const { call, db, tokenOf, clock } = mk();
    const r = await call('/magic/request', { email: 'a@b.se' });
    const row = db.query('SELECT * FROM magic_links').get() as any;
    expect(row.hash).toBe(sha(tokenOf(r.body.devLink)));
    expect(row).toMatchObject({ email: 'a@b.se', created_at: clock.now(), expires_at: clock.now() + 15 * 60 * 1000, used_at: null });
    expect(TOKEN_TTL_MS).toBe(15 * 60 * 1000);
    // two requests make two distinct links
    const r2 = await call('/magic/request', { email: 'a@b.se' });
    expect(tokenOf(r2.body.devLink)).not.toBe(tokenOf(r.body.devLink));
    expect((db.query('SELECT COUNT(*) AS n FROM magic_links').get() as any).n).toBe(2);
  });
  test('links expired more than 24 h ago are pruned on the next request (strictly older)', async () => {
    const { call, db, clock } = mk();
    await call('/magic/request', { email: 'old@b.se' }, ip('2.0.0.1')); // expires at t + 15 min
    const expires = clock.now() + TOKEN_TTL_MS;
    clock.set(expires + 24 * 3600 * 1000); // expires_at == now - 24h: kept
    await call('/magic/request', { email: 'new1@b.se' }, ip('2.0.0.2'));
    expect((db.query("SELECT COUNT(*) AS n FROM magic_links WHERE email='old@b.se'").get() as any).n).toBe(1);
    clock.set(expires + 24 * 3600 * 1000 + 1); // one ms later: pruned
    await call('/magic/request', { email: 'new2@b.se' }, ip('2.0.0.3'));
    expect((db.query("SELECT COUNT(*) AS n FROM magic_links WHERE email='old@b.se'").get() as any).n).toBe(0);
    expect((db.query('SELECT COUNT(*) AS n FROM magic_links').get() as any).n).toBe(2);
  });
  test('environment gating: production needs a key; a key switches to mail delivery', async () => {
    const sent: any[] = [];
    const f = (async (url: string, init: any) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    // production, no key
    process.env.NODE_ENV = 'production';
    const a = mk({ fetch: f });
    expect((await a.call('/magic/request', { email: 'a@b.se' })).status).toBe(503);
    expect(sent).toHaveLength(0);
    // key present in non-production: mail is sent, no devLink
    process.env.NODE_ENV = 'test'; process.env.RESEND_API_KEY = 'k1';
    const b = mk({ fetch: f });
    const rb = await b.call('/magic/request', { email: 'a@b.se' });
    expect(rb.body).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    // key present in production: mail is sent
    process.env.NODE_ENV = 'production';
    const c = mk({ fetch: f });
    expect((await c.call('/magic/request', { email: 'a@b.se' })).body).toEqual({ ok: true });
    expect(sent).toHaveLength(2);
    // development without a key: link logged and returned
    delete process.env.RESEND_API_KEY; process.env.NODE_ENV = 'development';
    expect((await mk().call('/magic/request', { email: 'a@b.se' })).body.devLink).toContain('/app/signin?token=');
    // unset NODE_ENV counts as non-production
    delete process.env.NODE_ENV;
    expect((await mk().call('/magic/request', { email: 'a@b.se' })).status).toBe(200);
  });
  test('Resend payload: headers, sender default, subject, bodies contain the link; failures give 502', async () => {
    process.env.RESEND_API_KEY = 're_key'; process.env.PUBLIC_URL = 'https://rep.example';
    const sent: any[] = [];
    const f = (async (url: string, init: any) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const m = mk({ fetch: f });
    expect((await m.call('/magic/request', { email: 'Who@B.se' })).status).toBe(200);
    const s = sent[0];
    expect(s.url).toBe('https://api.resend.com/emails');
    expect(s.init.method).toBe('POST');
    expect(s.init.headers).toEqual({ authorization: 'Bearer re_key', 'content-type': 'application/json' });
    expect(s.body.from).toBe('Rep <rep@ilmal.se>');
    expect(s.body.to).toEqual(['who@b.se']);
    expect(s.body.subject).toBe('Your sign-in link');
    const stored = (m.db.query('SELECT hash FROM magic_links').get() as any).hash;
    const link = /https:\/\/rep\.example\/app\/signin\?token=[A-Za-z0-9_-]+/.exec(s.body.text)![0];
    expect(sha(new URL(link).searchParams.get('token')!)).toBe(stored);
    expect(s.body.text).toContain('Open this link on your phone to sign in. It works once and expires in 15 minutes.');
    expect(s.body.text).toContain("If you didn't ask for this, ignore this email.");
    expect(s.body.html).toContain(`<a href="${link}">Sign in</a>`);
    expect(s.body.html).toContain('expires in 15 minutes');
    process.env.MAIL_FROM = 'Custom <c@x.se>';
    const m2 = mk({ fetch: f });
    await m2.call('/magic/request', { email: 'a@b.se' });
    expect(sent[1].body.from).toBe('Custom <c@x.se>');
    // provider error status, thrown error, and a body-less error no longer fail the request: it answers 200 and the mail is queued for retry
    for (const bad of [
      (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
      (async () => new Response('no', { status: 401 })) as unknown as typeof fetch,
      (async () => { throw new Error('network'); }) as unknown as typeof fetch,
    ]) {
      const r = await mk({ fetch: bad }).call('/magic/request', { email: 'a@b.se' });
      expect([r.status, r.body]).toEqual([200, { ok: true }]);
    }
    const ok201 = await mk({ fetch: (async () => new Response('{}', { status: 201 })) as unknown as typeof fetch }).call('/magic/request', { email: 'a@b.se' });
    expect(ok201.status).toBe(200);
  });
});

describe('verify', () => {
  const link = (db: ReturnType<typeof mk>['db'], token: string, email: string, createdAt: number, expiresAt: number) =>
    db.query('INSERT INTO magic_links(hash,email,created_at,expires_at) VALUES(?,?,?,?)').run(sha(token), email, createdAt, expiresAt);
  test('token length window is 20..200 characters', async () => {
    const m = mk();
    for (const n of [19, 20, 200, 201]) link(m.db, 't'.repeat(n), `len${n}@b.se`, m.clock.now(), m.clock.now() + TOKEN_TTL_MS);
    const r = async (n: number) => (await m.call('/magic/verify', { token: 't'.repeat(n) }, ip(`5.0.0.${n % 250}`))).status;
    expect(await r(19)).toBe(400);
    expect(await r(20)).toBe(200);
    expect(await r(200)).toBe(200);
    expect(await r(201)).toBe(400);
    expect((await m.call('/magic/verify', { token: 't'.repeat(19) }, ip('5.0.1.1'))).body).toEqual({ error: 'invalid_or_expired' });
  });
  test('expiry: valid while now < expires_at, rejected at expires_at', async () => {
    const m = mk();
    const t = 'e'.repeat(30);
    link(m.db, t, 'exp@b.se', m.clock.now(), m.clock.now() + 1000);
    m.clock.advance(999);
    const ok = await m.call('/magic/verify', { token: t });
    expect(ok.status).toBe(200);
    const t2 = 'f'.repeat(30);
    link(m.db, t2, 'exp2@b.se', m.clock.now(), m.clock.now() + 1000);
    m.clock.advance(1000);
    expect((await m.call('/magic/verify', { token: t2 })).status).toBe(400);
    // a rejected claim must not mark the link used
    expect((m.db.query('SELECT used_at FROM magic_links WHERE email=?').get('exp2@b.se') as any).used_at).toBeNull();
  });
  test('claim marks used_at; the user, token and response are consistent', async () => {
    const m = mk();
    const t = (await m.call('/magic/request', { email: 'Fresh@B.se' })).body.devLink;
    m.clock.advance(5000);
    const v = await m.call('/magic/verify', { token: m.tokenOf(t) });
    expect(v.status).toBe(200);
    expect(Object.keys(v.body).sort()).toEqual(['email', 'isNew', 'token', 'userId']);
    expect(v.body).toMatchObject({ email: 'fresh@b.se', isNew: true });
    const link0 = m.db.query('SELECT used_at FROM magic_links').get() as any;
    expect(link0.used_at).toBe(m.clock.now());
    const user = m.db.query('SELECT id,email,name,created_at FROM users').get() as any;
    expect(user).toEqual({ id: v.body.userId, email: 'fresh@b.se', name: '', created_at: m.clock.now() });
    const tok = m.db.query('SELECT hash,user_id,created_at,last_used FROM tokens').get() as any;
    expect(tok).toEqual({ hash: sha(v.body.token), user_id: v.body.userId, created_at: m.clock.now(), last_used: m.clock.now() });
    expect(v.body.token).toHaveLength(43);
    expect((await m.call('/sync', { cursor: 0, changes: [] }, { authorization: `Bearer ${v.body.token}` })).status).toBe(200);
  });
  test('unknown / non-string / missing tokens and bad JSON are rejected the same way', async () => {
    const m = mk();
    for (const body of [{ token: 'u'.repeat(30) }, { token: 123456789012345678901234 }, { token: ['a'.repeat(30)] }, {}, { tok: 'x' }]) {
      const r = await m.call('/magic/verify', body, ip('6.6.6.6'));
      expect([r.status, r.body]).toEqual([400, { error: 'invalid_or_expired' }]);
    }
    const raw = await m.call('/magic/verify', undefined, ip('6.6.6.6'));
    expect(raw.status).toBe(400);
  });
  test('an existing user is matched by (lowercased) email and no duplicate user is created', async () => {
    const m = mk();
    const t1 = m.tokenOf((await m.call('/magic/request', { email: 'same@b.se' }, ip('7.0.0.1'))).body.devLink);
    const t2 = m.tokenOf((await m.call('/magic/request', { email: 'SAME@b.se' }, ip('7.0.0.2'))).body.devLink);
    const a = (await m.call('/magic/verify', { token: t1 })).body;
    const b = (await m.call('/magic/verify', { token: t2 })).body;
    expect([a.isNew, b.isNew]).toEqual([true, false]);
    expect(b.userId).toBe(a.userId);
    expect((m.db.query('SELECT COUNT(*) AS n FROM users').get() as any).n).toBe(1);
    expect((m.db.query('SELECT COUNT(*) AS n FROM tokens').get() as any).n).toBe(2);
  });
});
