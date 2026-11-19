import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from '../db';
import { buildApi } from '../api';
import hr from './hr';

const NOW = 1_800_000_000_000;
function mk() {
  const db = openDb(':memory:');
  let t = NOW;
  const app = new Hono();
  app.route('/api/hr', hr(db, { now: () => t }));
  app.route('/api', buildApi(db));
  const call = async (method: string, path: string, o: { token?: string; json?: unknown; text?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.json !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(`/api${path}`, { method, headers, body: o.json !== undefined ? JSON.stringify(o.json) : o.text });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const user = async () => (await call('POST', '/auth/anon', { json: {} })).body as { token: string; userId: string };
  return { db, call, user, advance: (ms: number) => { t += ms; } };
}

describe('hr key', () => {
  test('create (shown once), status, rotate invalidates the old key, revoke', async () => {
    const { call, user } = mk();
    const u = await user();
    expect((await call('GET', '/hr/key', { token: u.token })).body).toMatchObject({ hasKey: false, count: 0 });
    const k1 = (await call('POST', '/hr/key', { token: u.token })).body.key as string;
    expect(k1).toMatch(/^rephr_[\w-]{20,}/);
    expect((await call('GET', '/hr/key', { token: u.token })).body).toMatchObject({ hasKey: true, prefix: k1.slice(0, 10) });
    expect((await call('POST', '/hr/ingest', { token: k1, json: { bpm: 70 } })).status).toBe(200);
    const k2 = (await call('POST', '/hr/key', { token: u.token })).body.key as string;
    expect(k2).not.toBe(k1);
    expect((await call('POST', '/hr/ingest', { token: k1, json: { bpm: 70 } })).status).toBe(401);
    expect((await call('POST', '/hr/ingest', { token: k2, json: { bpm: 70 } })).status).toBe(200);
    await call('DELETE', '/hr/key', { token: u.token });
    expect((await call('POST', '/hr/ingest', { token: k2, json: { bpm: 70 } })).status).toBe(401);
  });
  test('the ingest key can only ingest; the session token cannot ingest; nothing works without auth', async () => {
    const { call, user } = mk();
    const u = await user();
    const k = (await call('POST', '/hr/key', { token: u.token })).body.key as string;
    for (const [m, p] of [['GET', '/hr'], ['GET', '/hr/latest'], ['GET', '/hr/key'], ['POST', '/hr/key'], ['GET', '/me'], ['POST', '/sync']] as const) expect((await call(m, p, { token: k, json: {} })).status).toBe(401);
    expect((await call('POST', '/hr/ingest', { token: u.token, json: { bpm: 70 } })).status).toBe(401);
    expect((await call('POST', '/hr/ingest', { json: { bpm: 70 } })).status).toBe(401);
    expect((await call('GET', '/hr')).status).toBe(401);
    expect((await call('POST', '/hr/ingest', { token: 'rephr_nope', json: { bpm: 70 } })).status).toBe(401);
  });
});

describe('ingest + read', () => {
  test('stores, dedupes and returns readings per user only', async () => {
    const { call, user, advance } = mk();
    const a = await user(), b = await user();
    const ka = (await call('POST', '/hr/key', { token: a.token })).body.key;
    const kb = (await call('POST', '/hr/key', { token: b.token })).body.key;
    expect((await call('POST', '/hr/ingest', { token: ka, json: { samples: [{ bpm: 60, at: NOW - 60_000 }, { bpm: 62, at: NOW - 60_000 }, { bpm: 90, at: NOW - 30_000, source: 'Watch' }] } })).body).toEqual({ accepted: 2, rejected: 0 }); // the two readings at the same instant collapse to one
    await call('POST', '/hr/ingest', { token: kb, json: { bpm: 111 } });
    advance(1000);
    const r = (await call('GET', '/hr?from=0', { token: a.token })).body;
    expect(r.samples.map((s: any) => [s.bpm, s.source ?? null])).toEqual([[62, null], [90, 'Watch']]);
    expect(r.latest).toMatchObject({ bpm: 90, source: 'Watch' });
    expect((await call('GET', '/hr/latest', { token: b.token })).body.latest.bpm).toBe(111);
    const st = (await call('GET', '/hr/key', { token: a.token })).body;
    expect(st).toMatchObject({ hasKey: true, count: 2, lastSampleAt: NOW - 30_000 });
    expect(st.lastUsedAt).toBe(NOW);
  });
  test('accepts Health Auto Export, a bare number body and an x-api-key header', async () => {
    const { call, user, advance } = mk();
    const u = await user(); const k = (await call('POST', '/hr/key', { token: u.token })).body.key;
    const hae = { data: { metrics: [{ name: 'heart_rate', data: [{ date: new Date(NOW - 120_000).toISOString().replace('T', ' ').slice(0, 19) + ' +0000', Min: 55, Avg: 61, Max: 70 }] }] } };
    expect((await call('POST', '/hr/ingest', { token: k, json: hae })).body.accepted).toBe(1);
    expect((await call('POST', '/hr/ingest', { token: k, text: '88' })).body.accepted).toBe(1);
    advance(1000);
    expect((await call('POST', '/hr/ingest', { headers: { 'x-api-key': k }, json: { bpm: 91 } })).status).toBe(200);
    expect((await call('GET', '/hr', { token: u.token })).body.samples).toHaveLength(3);
  });
  test('rejects bad bodies and out-of-range data', async () => {
    const { call, user } = mk();
    const u = await user(); const k = (await call('POST', '/hr/key', { token: u.token })).body.key;
    expect((await call('POST', '/hr/ingest', { token: k, text: 'not json' })).status).toBe(400);
    expect((await call('POST', '/hr/ingest', { token: k, json: { bpm: 999 } })).status).toBe(422);
    expect((await call('POST', '/hr/ingest', { token: k, json: {} })).status).toBe(422); // an object with no usable reading
    expect((await call('POST', '/hr/ingest', { token: k, json: [] })).body).toEqual({ accepted: 0, rejected: 0 }); // an empty batch is fine (nothing new in Health)
    expect((await call('GET', '/hr', { token: u.token })).body.samples).toEqual([]);
  });
  test('ingest is rate limited per user', async () => {
    const { call, user } = mk();
    const u = await user(); const k = (await call('POST', '/hr/key', { token: u.token })).body.key;
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await call('POST', '/hr/ingest', { token: k, json: { bpm: 70, at: NOW - i * 1000 } })).status;
    expect(last).toBe(429);
  });
  test('"Delete my data" and account deletion remove the readings; export includes them', async () => {
    const { call, user, db } = mk();
    const u = await user(); const k = (await call('POST', '/hr/key', { token: u.token })).body.key;
    await call('POST', '/hr/ingest', { token: k, json: { bpm: 70 } });
    expect((await call('GET', '/export', { token: u.token })).body.heartRate).toHaveLength(1);
    await call('DELETE', '/account/data', { token: u.token });
    expect(db.query('SELECT count(*) AS n FROM heart_rate').get()).toEqual({ n: 0 });
    await call('POST', '/hr/ingest', { token: k, json: { bpm: 70 } });
    await call('DELETE', '/account', { token: u.token });
    expect(db.query('SELECT count(*) AS n FROM heart_rate').get()).toEqual({ n: 0 });
    expect(db.query('SELECT count(*) AS n FROM hr_keys').get()).toEqual({ n: 0 });
  });
});
