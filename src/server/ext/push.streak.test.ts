// Streak reminders (Flows.dc.html section 5) inside the push sweep: triggers, quiet hours, one per day, prefs, tz.
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from '../db';
import { buildApi } from '../api';
import { createPush, STREAK_CHECK_MS, type PushPayload, type PushSub } from './push';

const MIN = 60_000, H = 3_600_000, DAY = 86_400_000;
const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
// CET (tz -60). Mon 2026-11-16 00:00 CET = 2026-11-15 23:00 UTC. `at(day, h, m)` = local time of week day `day` (0 = Mon).
const WEEK0 = Date.UTC(2026, 10, 15, 23, 0, 0);
const at = (week: number, day: number, h: number, m = 0) => WEEK0 + (week * 7 + day) * DAY + h * H + m * MIN; // week 0 = current week; negative = past

async function newSub(n: number) {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}

async function world(o: { start: number; weeks: number[]; prefs?: object; tz?: number; goal?: number; settings?: object }) {
  const db = openDb(':memory:');
  let t = o.start;
  const sent: { payload: PushPayload; sub: PushSub }[] = [];
  const push = createPush(db, { now: () => t, auto: false, env: {}, sender: async (sub, p) => { sent.push({ payload: JSON.parse(p), sub }); return { status: 201 }; } });
  const app = new Hono();
  app.route('/api/push', push.app);
  app.route('/api', buildApi(db));
  const raw = async (method: string, path: string, token: string | null, json?: unknown) => {
    const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: json === undefined ? undefined : JSON.stringify(json) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const token = (await raw('POST', '/auth/anon', null, {})).body.token as string;
  expect((await raw('POST', '/push/subscribe', token, { subscription: await newSub(1), prefs: o.prefs, tz: o.tz ?? -60 })).status).toBe(200);
  // weeks[i] = sessions in the week i weeks BEFORE the current one (index 0 = last week); the current week is empty
  const changes: any[] = [{ type: 'settings', id: 'settings', updatedAt: 1, data: { weeklyGoal: o.goal ?? 4, rotation: [], updatedAt: 1, ...(o.settings ?? {}) } }];
  o.weeks.forEach((n, i) => { for (let k = 0; k < n; k++) { const ts = at(-(i + 1), k, 12); changes.push({ type: 'session', id: `s${i}_${k}`, updatedAt: 1, data: { id: `s${i}_${k}`, seq: 1, slot: 1, areaId: 'a', status: 'completed', startedAt: ts - H, endedAt: ts, exercises: [] } }); } });
  expect((await raw('POST', '/sync', token, { cursor: 0, changes })).body.rejected).toEqual([]);
  return { db, push, sent, set: (v: number) => { t = v; }, advance: (ms: number) => { t += ms; }, now: () => t, raw, token };
}
const HITS = [4, 4, 4, 4]; // four hit weeks before this one

describe('streak reminders', () => {
  test('last chance: Thursday 08:30 local with 4 to go and 4 days left', async () => {
    const w = await world({ start: at(0, 3, 8, 30), weeks: HITS });
    expect(await w.push.tick()).toBe(1);
    expect(w.sent[0].payload).toMatchObject({ type: 'streak', title: 'Last chance this week.', body: '4 to go, 4 days left.', tag: 'streak', url: '/app/', badge: 4 });
  });
  test('at most one a day, even when the sweep keeps running; the next day is a fresh day', async () => {
    const w = await world({ start: at(0, 2, 17, 5), weeks: HITS }); // Wed: tight (4 left, 5 days) after 17:00
    expect(await w.push.tick()).toBe(1);
    for (let i = 0; i < 8; i++) { w.advance(20 * MIN); await w.push.tick(); }
    expect(w.sent).toHaveLength(1);
    w.set(at(0, 3, 8, 30)); // Thu -> last chance
    expect(await w.push.tick()).toBe(1);
    expect(w.sent.map((s) => s.payload.title)).toEqual(['Your 4-week streak is at risk.', 'Last chance this week.']);
    expect(w.sent[0].payload.body).toBe('4 sessions, 5 days left.');
  });
  test('tight pace waits for the usual training hour (17:00 by default)', async () => {
    const w = await world({ start: at(0, 5, 16, 30), weeks: [1, 1], goal: 1 }); // too little history to learn from: Saturday, 1 left, 2 days
    expect(await w.push.tick()).toBe(0);
    w.set(at(0, 5, 17, 0)); expect(await w.push.tick()).toBe(1);
    expect(w.sent[0].payload).toMatchObject({ title: 'Your 2-week streak is at risk.', body: '1 session, 2 days left.' });
  });
  test('learns the usual hour from the sessions of the last weeks', async () => {
    const w = await world({ start: at(0, 2, 10, 0), weeks: HITS }); // sessions started 11:00 local (CET) -> usual hour 11
    expect(await w.push.tick()).toBe(0);
    w.set(at(0, 2, 11, 30)); expect(await w.push.tick()).toBe(1);
  });
  test('never between 21:00 and 07:00 local, nor before 08:00', async () => {
    const w = await world({ start: at(0, 3, 21, 0), weeks: HITS });
    expect(await w.push.tick()).toBe(0);
    w.set(at(0, 3, 23, 30)); expect(await w.push.tick()).toBe(0);
    w.set(at(0, 3, 6, 59)); expect(await w.push.tick()).toBe(0);
    w.set(at(0, 3, 7, 30)); expect(await w.push.tick()).toBe(0);
    w.set(at(0, 3, 20, 59)); expect(await w.push.tick()).toBe(1); // still allowed until 21:00
    expect(w.sent).toHaveLength(1);
  });
  test('Monday 08:00: repair offer, "Save your streak"', async () => {
    const w = await world({ start: at(0, 0, 8, 5), weeks: [3, 4, 4, 4, 4] });
    expect(await w.push.tick()).toBe(1);
    expect(w.sent[0].payload).toMatchObject({ title: 'Save your streak.', body: 'Do 5 this week and your 4 weeks stay.', url: '/app/' });
  });
  test('Monday: a lost streak gets the gentle message and opens the Streak page', async () => {
    const w = await world({ start: at(0, 0, 8, 5), weeks: [0, 4, 4] });
    expect(await w.push.tick()).toBe(1);
    expect(w.sent[0].payload).toMatchObject({ title: 'New streak starts today.', body: 'Your best is 2.', url: '/app/streak' });
  });
  test('silent when secured, with nothing to lose, on pace, or for someone who never trained', async () => {
    expect(await (await world({ start: at(0, 3, 9), weeks: [] })).push.tick()).toBe(0);
    expect(await (await world({ start: at(0, 0, 9), weeks: HITS })).push.tick()).toBe(0); // Monday, 4 left, 7 days: on pace
    expect(await (await world({ start: at(0, 4, 9), weeks: [1] })).push.tick()).toBe(0); // no streak
  });
  test('preference `streak` off silences it; default is on', async () => {
    expect(await (await world({ start: at(0, 3, 9), weeks: HITS, prefs: { streak: false } })).push.tick()).toBe(0);
    expect(await (await world({ start: at(0, 3, 9), weeks: HITS, prefs: {} })).push.tick()).toBe(1);
  });
  test('uses the tz stored with the subscription', async () => {
    // 07:30 UTC Thursday: 08:30 in CET, 02:30 in UTC-5
    const t = at(0, 3, 8, 30);
    expect(await (await world({ start: t, weeks: HITS, tz: -60 })).push.tick()).toBe(1);
    expect(await (await world({ start: t, weeks: HITS, tz: 300 })).push.tick()).toBe(0);
  });
  test('the sweep re-evaluates a user at most every 15 minutes (cheap), and claims the day before sending', async () => {
    const w = await world({ start: at(0, 3, 8, 30), weeks: HITS });
    expect(STREAK_CHECK_MS).toBe(15 * MIN);
    await w.push.tick();
    expect(w.db.query('SELECT COUNT(*) n FROM push_streak').get()).toEqual({ n: 1 });
    expect(w.db.query<{ kind: string }, []>('SELECT kind FROM push_streak').get()!.kind).toBe('lastchance');
  });
  test('after the week is secured nothing is sent', async () => {
    const w = await world({ start: at(0, 3, 8, 30), weeks: HITS });
    const changes = [0, 1, 2, 3].map((k) => ({ type: 'session', id: `c${k}`, updatedAt: 2, data: { id: `c${k}`, seq: 9, slot: 1, areaId: 'a', status: 'completed', startedAt: at(0, k, 7), endedAt: at(0, k, 8), exercises: [] } }));
    await w.raw('POST', '/sync', w.token, { cursor: 0, changes });
    expect(await w.push.tick()).toBe(0);
  });
  test('a goal change that starts next Monday does not change this week: copy and icon badge use the goal in force', async () => {
    const w = await world({ start: at(0, 3, 8, 30), weeks: HITS, settings: { weeklyGoal: 2, goalHistory: [{ from: 0, goal: 4 }, { from: at(1, 0, 0), goal: 2 }] } });
    expect(await w.push.tick()).toBe(1);
    expect(w.sent[0].payload).toMatchObject({ title: 'Last chance this week.', body: '4 to go, 4 days left.', badge: 4 });
  });
});
