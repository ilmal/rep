import { describe, expect, test } from 'bun:test';
import { buildApp } from './index';

const cookiesOf = (res: Response) => res.headers.getSetCookie();
const jar = (res: Response) => cookiesOf(res).map((c) => c.split(';')[0]).join('; ');

describe('session cookie + landing redirect', () => {
  const { app } = buildApp();
  const post = (path: string, headers: Record<string, string> = {}, body: unknown = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  test('anon sign-up sets a 400-day HttpOnly session cookie and a readable seen cookie', async () => {
    const r = await post('/api/auth/anon');
    const cs = cookiesOf(r);
    const sess = cs.find((c) => c.startsWith('rep_session='))!;
    expect(sess).toMatch(/HttpOnly/i);
    expect(sess).toMatch(/Path=\/api\/auth/);
    expect(sess).toMatch(/Max-Age=34560000/);
    expect(sess).toMatch(/SameSite=Lax/i);
    const seen = cs.find((c) => c.startsWith('rep_seen=1'))!;
    expect(seen).not.toMatch(/HttpOnly/i);
  });

  test('restore returns the same token from the cookie; needs x-rep; bad cookie is 401 and clears', async () => {
    const a = await post('/api/auth/anon');
    const { token, userId } = await a.json() as any;
    const cookie = jar(a);
    expect((await post('/api/auth/restore', { cookie })).status).toBe(401); // no x-rep header
    const ok = await post('/api/auth/restore', { cookie, 'x-rep': '1' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ token, userId });
    const bad = await post('/api/auth/restore', { cookie: 'rep_session=nope', 'x-rep': '1' });
    expect(bad.status).toBe(401);
    expect(cookiesOf(bad).some((c) => c.startsWith('rep_session=;') || /rep_session=; /.test(c) || /Max-Age=0/.test(c))).toBe(true);
    expect((await post('/api/auth/restore', { 'x-rep': '1' })).status).toBe(401); // no cookie
  });

  test('the cookie is NOT accepted as auth on other routes', async () => {
    const a = await post('/api/auth/anon');
    const r = await app.request('/api/me', { headers: { cookie: jar(a) } });
    expect(r.status).toBe(401);
  });

  test('logout revokes the token and clears the cookies', async () => {
    const a = await post('/api/auth/anon');
    const { token } = await a.json() as any;
    const out = await post('/api/auth/logout', { authorization: `Bearer ${token}` });
    expect(out.status).toBe(200);
    expect(cookiesOf(out).length).toBeGreaterThanOrEqual(2);
    expect((await post('/api/auth/restore', { cookie: jar(a), 'x-rep': '1' })).status).toBe(401);
  });

  test('/ redirects to /app/ only for browsers that have used the app', async () => {
    const plain = await app.request('/');
    expect(plain.status).toBe(200);
    expect(plain.headers.get('vary')).toMatch(/cookie/i);
    const seen = await app.request('/', { headers: { cookie: 'rep_seen=1' } });
    expect(seen.status).toBe(302);
    expect(seen.headers.get('location')).toBe('/app/');
    expect(seen.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe('hosts: canonical landing + origin-correct sign-in links', () => {
  test('a non-canonical host forwards only its landing page; the app and API stay put', async () => {
    process.env.CANONICAL_HOST = 'rep.example.com';
    try {
      const { app } = buildApp();
      const r = await app.request('/', { headers: { host: 'old.example.com' } });
      expect(r.status).toBe(301);
      expect(r.headers.get('location')).toBe('https://rep.example.com/');
      expect((await app.request('/', { headers: { host: 'rep.example.com' } })).status).toBe(200);
      expect((await app.request('/api/health', { headers: { host: 'old.example.com' } })).status).toBe(200);
      expect((await app.request('/app/', { headers: { host: 'old.example.com' } })).status).not.toBe(301);
      const seen = await app.request('/', { headers: { host: 'old.example.com', cookie: 'rep_seen=1' } });
      expect(seen.headers.get('location')).toBe('/app/'); // people who use the app are never bounced to another origin
    } finally { delete process.env.CANONICAL_HOST; }
  });

  test('the sign-in link uses the requesting host only when it is listed in PUBLIC_HOSTS', async () => {
    const save = { ...process.env };
    process.env.PUBLIC_URL = 'https://rep.example.com'; process.env.PUBLIC_HOSTS = 'rep.example.com,old.example.com'; delete process.env.NODE_ENV;
    delete process.env.RESEND_API_KEY; delete process.env.SES_ACCESS_KEY_ID; delete process.env.AWS_ACCESS_KEY_ID;
    try {
      const { app } = buildApp();
      const link = async (host: string, ip: string) => ((await (await app.request('/api/magic/request', { method: 'POST', headers: { 'content-type': 'application/json', host, 'x-forwarded-for': ip }, body: JSON.stringify({ email: `${ip.replace(/\./g, '')}@x.se` }) })).json()) as any).devLink as string;
      expect(await link('old.example.com', '1.1.1.1')).toStartWith('https://old.example.com/app/signin?token=');
      expect(await link('rep.example.com', '1.1.1.2')).toStartWith('https://rep.example.com/app/signin?token=');
      expect(await link('evil.test', '1.1.1.3')).toStartWith('https://rep.example.com/app/signin?token='); // unlisted Host: ignored
    } finally { for (const k of ['PUBLIC_URL', 'PUBLIC_HOSTS', 'NODE_ENV', 'RESEND_API_KEY']) { if (save[k] === undefined) delete process.env[k]; else process.env[k] = save[k]; } }
  });
});

describe('landing asset caching', () => {
  test('content-hashed images are immutable for a year; other images get 30 days', async () => {
    const { app } = buildApp();
    const hashed = (await Array.fromAsync(new Bun.Glob('img/phone-today.*.webp').scan('landing'))).find((f) => !f.includes('-390'))!;
    const r = await app.request(`/${hashed}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await app.request('/img/app-icon.png')).headers.get('cache-control')).toMatch(/max-age=2592000/);
  });
});
