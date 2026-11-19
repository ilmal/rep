import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from '../db';
import { buildApi } from '../api';
import magic, { TOKEN_TTL_MS } from './magic';

const ENV = ['RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_URL', 'NODE_ENV'] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => { saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); for (const k of ENV) delete process.env[k]; process.env.NODE_ENV = 'test'; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function mk(o: { fetch?: typeof fetch } = {}) {
  const db = openDb(':memory:');
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const app = new Hono();
  // NB: extensions must be mounted BEFORE buildApi, whose `api.all('*')` 404 would otherwise shadow them.
  app.route('/api/magic', magic(db, { now: clock.now, fetch: o.fetch }));
  app.route('/api', buildApi(db));
  const call = async (path: string, json?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: json === undefined ? undefined : JSON.stringify(json) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  };
  const tokenOf = (devLink: string) => new URL(devLink).searchParams.get('token')!;
  return { db, call, clock, tokenOf };
}

describe('magic /request', () => {
  test('validates the email', async () => {
    const { call } = mk();
    for (const e of ['', 'nope', 'a@b', 'a b@c.se', 42, null]) expect((await call('/magic/request', { email: e })).status).toBe(400);
    expect((await call('/magic/request', {})).status).toBe(400);
  });

  test('dev mode returns devLink and stores only a hash', async () => {
    const { call, db, tokenOf } = mk();
    const r = await call('/magic/request', { email: ' Me@Example.COM ' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.devLink).toContain('/app/signin?token=');
    const tok = tokenOf(r.body.devLink);
    const rows = db.query('SELECT hash,email FROM magic_links').all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe('me@example.com');
    expect(rows[0].hash).not.toBe(tok);
    expect(rows[0].hash).toHaveLength(64);
  });

  test('production without email config -> 503 and nothing stored', async () => {
    process.env.NODE_ENV = 'production';
    const { call, db } = mk();
    const r = await call('/magic/request', { email: 'a@b.se' });
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'email_not_configured' });
    expect(db.query('SELECT COUNT(*) AS n FROM magic_links').get()).toEqual({ n: 0 });
  });

  test('sends through Resend when configured and never exposes the link', async () => {
    process.env.RESEND_API_KEY = 're_test'; process.env.PUBLIC_URL = 'https://rep.example/'; process.env.MAIL_FROM = 'Rep <hi@rep.example>';
    process.env.NODE_ENV = 'production';
    const sent: any[] = [];
    const f = (async (url: string, init: any) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const { call } = mk({ fetch: f });
    const r = await call('/magic/request', { email: 'a@b.se' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(sent[0].url).toBe('https://api.resend.com/emails');
    expect(sent[0].init.headers.authorization).toBe('Bearer re_test');
    expect(sent[0].body.to).toEqual(['a@b.se']);
    expect(sent[0].body.from).toBe('Rep <hi@rep.example>');
    expect(sent[0].body.text).toContain('https://rep.example/app/signin?token=');
  });

  test('provider failure: the request still answers 200 (queued) and the mail is retried with backoff, then delivered', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const db = openDb(':memory:');
    let t = 1_000_000; let calls = 0;
    const f = (async () => (++calls < 3 ? new Response('x', { status: 500 }) : new Response('{}', { status: 200 }))) as unknown as typeof fetch;
    const inner = magic(db, { now: () => t, fetch: f }) as unknown as { flushMail: () => Promise<void>; request: Hono['request'] };
    const res = await (inner as unknown as Hono).request('/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.se' }) });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(db.query('SELECT count(*) AS n FROM mail_queue').get()).toEqual({ n: 1 }); // failed once, still queued
    await inner.flushMail(); expect(calls).toBe(1); // not due yet (backoff)
    t += 20_000; await inner.flushMail(); expect(calls).toBe(2);
    t += 40_000; await inner.flushMail(); expect(calls).toBe(3);
    expect(db.query('SELECT count(*) AS n FROM mail_queue').get()).toEqual({ n: 0 }); // delivered and removed
  });

  test('gives up after the maximum number of attempts', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const db = openDb(':memory:');
    let t = 1_000_000;
    const inner = magic(db, { now: () => t, fetch: (async () => new Response('x', { status: 500 })) as unknown as typeof fetch }) as unknown as Hono & { flushMail: () => Promise<void> };
    await inner.request('/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.se' }) });
    for (let i = 0; i < 8; i++) { t += 700_000; await inner.flushMail(); }
    expect(db.query('SELECT count(*) AS n FROM mail_queue').get()).toEqual({ n: 0 });
  });

  test('rate limit per email and per IP', async () => {
    const { call } = mk();
    for (let i = 0; i < 5; i++) expect((await call('/magic/request', { email: 'x@y.se' }, { 'x-forwarded-for': '1.1.1.1' })).status).toBe(200);
    const blocked = await call('/magic/request', { email: 'x@y.se' }, { 'x-forwarded-for': '2.2.2.2' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('rate_limited');
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    // another email from a fresh IP is fine; the same IP gets cut off after 20 total
    expect((await call('/magic/request', { email: 'other@y.se' }, { 'x-forwarded-for': '2.2.2.2' })).status).toBe(200);
    for (let i = 0; i < 20; i++) await call('/magic/request', { email: `u${i}@y.se` }, { 'x-forwarded-for': '3.3.3.3' });
    expect((await call('/magic/request', { email: 'u99@y.se' }, { 'x-forwarded-for': '3.3.3.3' })).status).toBe(429);
  });

  test('does not disclose whether an email has an account', async () => {
    const { call } = mk();
    const anon = (await call('/auth/anon', { name: 'N' })).body;
    const reg = await app_register(call, anon.token, 'known@b.se');
    expect(reg).toBe(200);
    const known = await call('/magic/request', { email: 'known@b.se' });
    const unknown = await call('/magic/request', { email: 'unknown@b.se' });
    expect(known.status).toBe(unknown.status);
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
  });
});

async function app_register(call: ReturnType<typeof mk>['call'], token: string, email: string) {
  return (await call('/auth/register', { email, password: 'longenough1' }, { authorization: `Bearer ${token}` })).status;
}

describe('magic /verify', () => {
  async function issue(m: ReturnType<typeof mk>, email: string) {
    return m.tokenOf((await m.call('/magic/request', { email })).body.devLink);
  }

  test('creates a user, returns a working session token, isNew true', async () => {
    const m = mk();
    const t = await issue(m, 'New@Me.se');
    const v = await m.call('/magic/verify', { token: t });
    expect(v.status).toBe(200);
    expect(v.body.isNew).toBe(true);
    expect(v.body.email).toBe('new@me.se');
    expect(v.body.userId).toBeTruthy();
    const sync = await m.call('/sync', { cursor: 0, changes: [] }, { authorization: `Bearer ${v.body.token}` });
    expect(sync.status).toBe(200);
  });

  test('single use: second verify fails, even concurrently', async () => {
    const m = mk();
    const t = await issue(m, 'a@b.se');
    const [x, y] = await Promise.all([m.call('/magic/verify', { token: t }), m.call('/magic/verify', { token: t })]);
    expect([x.status, y.status].sort()).toEqual([200, 400]);
    const again = await m.call('/magic/verify', { token: t });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_or_expired');
  });

  test('expires after 15 minutes', async () => {
    const m = mk();
    const t = await issue(m, 'a@b.se');
    m.clock.advance(TOKEN_TTL_MS + 1);
    expect((await m.call('/magic/verify', { token: t })).status).toBe(400);
    const t2 = await issue(m, 'a@b.se');
    m.clock.advance(TOKEN_TTL_MS - 1000);
    expect((await m.call('/magic/verify', { token: t2 })).status).toBe(200);
  });

  test('rejects garbage, missing and wrong-type tokens', async () => {
    const m = mk();
    await issue(m, 'a@b.se');
    for (const tok of [undefined, '', 'short', 'x'.repeat(43), 12345, { a: 1 }]) expect((await m.call('/magic/verify', { token: tok })).status).toBe(400);
  });

  test('existing account: same user, isNew false; a second link also works', async () => {
    const m = mk();
    const first = (await m.call('/magic/verify', { token: await issue(m, 'me@b.se') })).body;
    const second = (await m.call('/magic/verify', { token: await issue(m, 'ME@b.se') })).body;
    expect(second.isNew).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.token).not.toBe(first.token);
  });

  test('links an email registered with a password to that same account', async () => {
    const m = mk();
    const anon = (await m.call('/auth/anon', { name: 'N' })).body;
    await app_register(m.call, anon.token, 'pw@b.se');
    const v = (await m.call('/magic/verify', { token: await issue(m, 'pw@b.se') })).body;
    expect(v.isNew).toBe(false);
    expect(v.userId).toBe(anon.userId);
  });

  test('merge semantics: pushing local data after verify lands in the account, LWW keeps newer remote, other devices pull everything', async () => {
    const m = mk();
    // device A signs in and has account data
    const a = (await m.call('/magic/verify', { token: await issue(m, 'me@b.se') })).body;
    const authA = { authorization: `Bearer ${a.token}` };
    await m.call('/sync', { cursor: 0, changes: [{ type: 'gym', id: 'acct-gym', updatedAt: 100, data: { name: 'Account gym' } }, { type: 'pref', id: 'p1', updatedAt: 500, data: { v: 'remote-newer' } }] }, authA);
    // device B: anonymous local data re-queued after signing in (what x-signin does)
    const b = (await m.call('/magic/verify', { token: await issue(m, 'me@b.se') })).body;
    const authB = { authorization: `Bearer ${b.token}` };
    const r = await m.call('/sync', { cursor: 0, changes: [
      { type: 'gym', id: 'local-gym', updatedAt: 50, data: { name: 'Local gym' } },
      { type: 'pref', id: 'p1', updatedAt: 400, data: { v: 'local-older' } },
    ] }, authB);
    expect(r.body.accepted).toEqual(['gym:local-gym']);
    expect(r.body.rejected.map((x: any) => x.id)).toEqual(['p1']);
    const ids = r.body.changes.map((c: any) => c.id).sort();
    expect(ids).toEqual(['acct-gym', 'p1']);
    expect(r.body.changes.find((c: any) => c.id === 'p1').data.v).toBe('remote-newer');
    // device A now sees the local-only entity
    const pull = await m.call('/sync', { cursor: 0, changes: [] }, authA);
    expect(pull.body.changes.map((c: any) => c.id).sort()).toEqual(['acct-gym', 'local-gym', 'p1']);
  });

  test('verify is rate limited per IP', async () => {
    const m = mk();
    for (let i = 0; i < 30; i++) await m.call('/magic/verify', { token: 'x'.repeat(30) }, { 'x-forwarded-for': '9.9.9.9' });
    const r = await m.call('/magic/verify', { token: 'x'.repeat(30) }, { 'x-forwarded-for': '9.9.9.9' });
    expect(r.status).toBe(429);
  });
});
