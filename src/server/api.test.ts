import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from './db';
import { buildApi } from './api';

function mk() {
  const app = new Hono();
  app.route('/api', buildApi(openDb(':memory:')));
  const call = async (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as any) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const res = await app.request(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  return call;
}

describe('api', () => {
  test('auth required for sync', async () => {
    const call = mk();
    expect((await call('/sync', { method: 'POST', json: {} })).status).toBe(401);
  });

  test('anon → push → pull on second device via login', async () => {
    const call = mk();
    const a = (await call('/auth/anon', { method: 'POST', json: { name: 'N' } })).body;
    expect(a.token).toBeTruthy();
    const reg = await call('/auth/register', { method: 'POST', token: a.token, json: { email: 'A@b.se', password: 'longenough1' } });
    expect(reg.status).toBe(200);
    const push = await call('/sync', { method: 'POST', token: a.token, json: { cursor: 0, changes: [
      { type: 'gym', id: 'g1', updatedAt: 100, data: { name: 'City' } },
      { type: 'session', id: 's1', updatedAt: 100, data: { seq: 1 } },
    ], events: [{ id: 'e1', at: 5, kind: 'set_logged' }] } });
    expect(push.body.accepted.length).toBe(2);
    expect(push.body.changes.length).toBe(0); // own writes not echoed

    const login = await call('/auth/login', { method: 'POST', json: { email: 'a@B.se', password: 'longenough1' } });
    expect(login.status).toBe(200);
    const pull = await call('/sync', { method: 'POST', token: login.body.token, json: { cursor: 0, changes: [] } });
    expect(pull.body.changes.map((c: any) => c.id).sort()).toEqual(['g1', 's1']);
    const again = await call('/sync', { method: 'POST', token: login.body.token, json: { cursor: pull.body.cursor, changes: [] } });
    expect(again.body.changes).toEqual([]);
  });

  test('last-write-wins: stale write rejected and newer copy returned', async () => {
    const call = mk();
    const t = (await call('/auth/anon', { method: 'POST', json: {} })).body.token;
    await call('/sync', { method: 'POST', token: t, json: { cursor: 0, changes: [{ type: 'gym', id: 'g', updatedAt: 200, data: { v: 'new' } }] } });
    const r = await call('/sync', { method: 'POST', token: t, json: { cursor: 0, changes: [{ type: 'gym', id: 'g', updatedAt: 100, data: { v: 'old' } }] } });
    expect(r.body.rejected[0].reason).toBe('stale');
    expect(r.body.changes[0].data.v).toBe('new');
  });

  test('users are isolated', async () => {
    const call = mk();
    const a = (await call('/auth/anon', { method: 'POST', json: {} })).body.token;
    const b = (await call('/auth/anon', { method: 'POST', json: {} })).body.token;
    await call('/sync', { method: 'POST', token: a, json: { cursor: 0, changes: [{ type: 'gym', id: 'g', updatedAt: 1, data: { secret: 1 } }] } });
    const r = await call('/sync', { method: 'POST', token: b, json: { cursor: 0, changes: [] } });
    expect(r.body.changes).toEqual([]);
  });

  test('validation: bad type / duplicate email / weak password / wrong login', async () => {
    const call = mk();
    const t = (await call('/auth/anon', { method: 'POST', json: {} })).body.token;
    const bad = await call('/sync', { method: 'POST', token: t, json: { changes: [{ type: 'nope', id: 'x', updatedAt: 1, data: 1 }] } });
    expect(bad.body.rejected[0].reason).toBe('invalid');
    expect((await call('/auth/register', { method: 'POST', token: t, json: { email: 'x@y.se', password: 'short' } })).status).toBe(400);
    expect((await call('/auth/register', { method: 'POST', token: t, json: { email: 'x@y.se', password: 'longenough1' } })).status).toBe(200);
    const t2 = (await call('/auth/anon', { method: 'POST', json: {} })).body.token;
    expect((await call('/auth/register', { method: 'POST', token: t2, json: { email: 'X@y.se', password: 'longenough1' } })).status).toBe(409);
    expect((await call('/auth/login', { method: 'POST', json: { email: 'x@y.se', password: 'wrong-password' } })).status).toBe(401);
  });

  test('delete data and export', async () => {
    const call = mk();
    const t = (await call('/auth/anon', { method: 'POST', json: {} })).body.token;
    await call('/sync', { method: 'POST', token: t, json: { changes: [{ type: 'gym', id: 'g', updatedAt: 1, data: {} }], events: [{ id: 'e', at: 1, kind: 'k' }] } });
    const ex = await call('/export', { token: t });
    expect(ex.body.entities.length).toBe(1);
    expect(ex.body.events.length).toBe(1);
    await call('/account/data', { method: 'DELETE', token: t });
    expect((await call('/export', { token: t })).body.entities.length).toBe(0);
    await call('/account', { method: 'DELETE', token: t });
    expect((await call('/me', { token: t })).status).toBe(401);
  });
});
