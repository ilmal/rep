// MCP streak tools: get_streak, use_streak_freeze, undo_streak_freeze, the streak block in overview/stats, goal history on update_settings.
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from './db';
import { buildApi } from './api';
import { buildMcp } from './mcp';
import { createPush } from './ext/push';
import { makeCal } from '../shared/streak';
import { weekStart } from '../shared/rules';

const DAY = 86400000, HOUR = 3600000;
const ago = (w: number) => { const d = new Date(weekStart(Date.now())); d.setDate(d.getDate() - 7 * w); return d.getTime(); };
const sessionAt = (id: string, ts: number) => ({ id, seq: 1, slot: 1, areaId: 'upper', areaName: 'Upper', gymId: 'g1', gymName: 'City', status: 'completed', startedAt: ts - HOUR, endedAt: ts, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done', updatedAt: ts });

async function setup(opts: { weeks?: number[]; settings?: Record<string, unknown> } = {}) {
  const db = openDb(':memory:');
  const app = new Hono();
  app.route('/api', buildApi(db));
  app.route('/mcp', buildMcp(db));
  const j = async (path: string, init: { token?: string; body?: unknown; method?: string } = {}) => {
    const r = await app.request(path, { method: init.method ?? 'POST', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const session = (await j('/api/auth/anon', { body: {} })).body.token;
  const mk = async (scope: 'read' | 'write') => (await j('/api/tokens', { token: session, body: { name: 't', scope } })).body.token as string;
  // `weeks[i]` sessions i weeks before this one is counted in: weeks = [thisWeek, 1 week ago, 2 weeks ago, ...]
  const weeks = opts.weeks ?? [1, 4, 4, 4, 4];
  const changes: unknown[] = [{ type: 'settings', id: 'settings', updatedAt: 1, data: { name: 'N', weeklyGoal: 4, rotation: ['upper'], ...opts.settings } }];
  weeks.forEach((n, w) => { for (let k = 0; k < n; k++) { const id = `s${w}_${k}`; changes.push({ type: 'session', id, updatedAt: 1, data: sessionAt(id, ago(w) + DAY * k + 10 * HOUR) }); } });
  await j('/api/sync', { token: session, body: { changes } });
  let rid = 0;
  const call = async (token: string, name: string, args: unknown = {}) => {
    const r = await j('/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } } });
    const text = r.body.result.content[0].text as string;
    return { isError: !!r.body.result.isError, text, json: r.body.result.isError ? null : JSON.parse(text) };
  };
  const settings = () => JSON.parse(db.query<{ json: string }, []>("SELECT json FROM entities WHERE type='settings'").get()!.json);
  return { db, j, session, mk, call, settings };
}

describe('get_streak', () => {
  test('full view for a read-only token', async () => {
    const { mk, call } = await setup();
    const v = (await call(await mk('read'), 'get_streak')).json;
    expect(v.current).toBe(4); expect(v.best).toBe(4); expect(v.freezes).toBe(1);
    expect(v.tier).toBe('Flame · tier 2'); expect(v.tierIndex).toBe(2);
    expect(v.weeks).toHaveLength(5); expect(v.weeks[4].status).toBe('open'); expect(v.weeks.slice(0, 4).every((w: any) => w.status === 'hit')).toBe(true);
    expect(typeof v.weeks[0].weekStart).toBe('string');
    expect(v.currentWeek).toMatchObject({ goal: 4, target: 4, done: 1 });
    expect(['onpace', 'tight', 'lastchance', 'repair']).toContain(v.currentWeek.pace);
    expect(v.badges).toHaveLength(18);
    expect(v.badges.find((b: any) => b.id === 'streak_4')).toMatchObject({ got: true });
    expect(v.nextMilestone).toMatchObject({ weeks: 8 });
    expect(v.milestones).toHaveLength(6);
    expect(v.repairOffer).toBeNull(); expect(v.canUseFreezeNow).toBe(true); expect(v.freezeTarget).toBe('current');
  });
  test('weeks argument limits the list', async () => {
    const { mk, call } = await setup();
    expect((await call(await mk('read'), 'get_streak', { weeks: 2 })).json.weeks).toHaveLength(2);
    expect((await call(await mk('read'), 'get_streak', { weeks: 0 }))).toBeDefined();
  });
  test('reports an open repair', async () => {
    const { mk, call } = await setup({ weeks: [1, 3, 4, 4, 4, 4] });
    const v = (await call(await mk('read'), 'get_streak')).json;
    expect(v.repairOffer).toMatchObject({ deficit: 1, target: 5, freezeAvailable: true });
    expect(v.current).toBe(4); expect(v.freezeTarget).toBe('missed');
  });
  test('empty athlete', async () => {
    const { mk, call } = await setup({ weeks: [] });
    const v = (await call(await mk('read'), 'get_streak')).json;
    expect(v).toMatchObject({ current: 0, best: 0, freezes: 0, atRisk: false, canUseFreezeNow: false });
  });
  test('uses the athlete tz from their push subscription (same weeks as their phone)', async () => {
    const { db, mk, call } = await setup({ weeks: [] });
    createPush(db, { auto: false }); // creates push_subs
    const uid = db.query<{ id: string }, []>('SELECT id FROM users').get()!.id;
    db.query('INSERT INTO push_subs(id,user_id,endpoint,p256dh,auth,prefs,tz,created_at) VALUES(?,?,?,?,?,?,?,?)').run('x', uid, 'https://e.example/1', 'a', 'b', '{}', -600, Date.now());
    const v = (await call(await mk('read'), 'get_streak')).json;
    expect(Date.parse(v.currentWeek.weekStart)).toBe(makeCal(-600).weekStart(Date.now()));
  });
});

describe('overview + stats carry a streak block (old field kept)', () => {
  test('get_overview and get_stats', async () => {
    const { mk, call } = await setup();
    const t = await mk('read');
    const o = (await call(t, 'get_overview')).json;
    expect(o.streakWeeksHittingGoal).toBeGreaterThanOrEqual(4);
    expect(o.streak).toMatchObject({ current: 4, best: 4, freezes: 1, tier: 'Flame · tier 2', atRisk: expect.any(Boolean) });
    expect(o.streak.week).toMatchObject({ goal: 4, done: 1 });
    const st = (await call(t, 'get_stats')).json;
    expect(st.streak.current).toBe(4);
  });
});

describe('use_streak_freeze / undo_streak_freeze', () => {
  test('write token freezes this week, read token cannot, undo restores it', async () => {
    const { mk, call, settings } = await setup();
    const w = await mk('write'), r = await mk('read');
    expect((await call(r, 'use_streak_freeze')).isError).toBe(true);
    expect((await call(r, 'undo_streak_freeze')).isError).toBe(true);
    const used = (await call(w, 'use_streak_freeze')).json;
    expect(used).toMatchObject({ used: true, covered: 'current', current: 5, freezes: 0, frozenThisWeek: true });
    expect(settings().manualFreezeWeeks).toHaveLength(1);
    expect(settings().weeklyGoal).toBe(4); // nothing else touched
    expect((await call(w, 'get_streak')).json.frozenThisWeek).toBe(true);
    const again = await call(w, 'use_streak_freeze');
    expect(again.isError).toBe(true); expect(again.text).toMatch(/already frozen/);
    const undone = (await call(w, 'undo_streak_freeze')).json;
    expect(undone).toMatchObject({ undone: true, freezes: 1, frozenThisWeek: false, current: 4 });
    expect(settings().manualFreezeWeeks).toEqual([]);
    expect((await call(w, 'undo_streak_freeze')).text).toMatch(/no manual freeze/);
  });
  test('explains why a freeze cannot be used', async () => {
    const a = await setup({ weeks: [1, 4] }); // no freeze held (1 counted week)
    expect((await call2(a, 'use_streak_freeze')).text).toMatch(/No streak freeze held/);
    const b = await setup({ weeks: [4, 4, 4, 4, 4] }); // this week secured
    expect((await call2(b, 'use_streak_freeze')).text).toMatch(/secured/);
    const c = await setup({ weeks: [] });
    expect((await call2(c, 'use_streak_freeze')).text).toMatch(/No streak freeze held|No streak to protect/);
  });
  test('while a repair is open the freeze covers last week', async () => {
    const { mk, call } = await setup({ weeks: [1, 3, 4, 4, 4, 4] });
    const w = await mk('write');
    const r = (await call(w, 'use_streak_freeze')).json;
    expect(r.covered).toBe('missed'); expect(r.repairOffer).toBeNull(); expect(r.current).toBe(5);
  });
  test('the athlete\'s app pulls the written settings (freeze reaches /api/sync)', async () => {
    const { mk, call, j, session } = await setup();
    await call(await mk('write'), 'use_streak_freeze');
    const pull = (await j('/api/sync', { token: session, body: { cursor: 0, changes: [] } })).body;
    const s = pull.changes.find((c: any) => c.type === 'settings').data;
    expect(s.manualFreezeWeeks).toHaveLength(1);
  });
});
const call2 = async (s: Awaited<ReturnType<typeof setup>>, name: string) => s.call(await s.mk('write'), name);

describe('update_settings records goal history', () => {
  test('after training the new goal applies from next Monday', async () => {
    const { mk, call, settings } = await setup();
    const w = await mk('write');
    await call(w, 'update_settings', { weeklyGoal: 3 });
    const s = settings();
    expect(s.weeklyGoal).toBe(3);
    expect(s.goalHistory).toEqual([{ from: 0, goal: 4 }, { from: makeCal().addWeeks(weekStart(Date.now()), 1), goal: 3 }]);
    const v = (await call(w, 'get_streak')).json;
    expect(v.currentWeek.goal).toBe(4); expect(v.pendingGoal).toMatchObject({ goal: 3 });
  });
  test('never trained: immediate', async () => {
    const { mk, call, settings } = await setup({ weeks: [] });
    await call(await mk('write'), 'update_settings', { weeklyGoal: 2 });
    expect(settings().goalHistory).toBeUndefined();
    expect((await call(await mk('read'), 'get_streak')).json.currentWeek.goal).toBe(2);
  });
  test('other settings changes keep history untouched', async () => {
    const { mk, call, settings } = await setup();
    const w = await mk('write');
    await call(w, 'update_settings', { weeklyGoal: 3 }); const h = settings().goalHistory;
    await call(w, 'update_settings', { restSec: 100 });
    expect(settings().goalHistory).toEqual(h);
  });
});
