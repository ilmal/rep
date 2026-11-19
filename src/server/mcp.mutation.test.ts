// Mutation-killing tests for mcp.ts: transport, scopes, rate limit, validation limits and every tool's output.
import { afterEach, describe, expect, spyOn, test, setSystemTime } from 'bun:test';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { openDb } from './db';
import { buildApi } from './api';
import { buildMcp, TOOLS } from './mcp';
import { loadData } from './store';
import { PAUSE_FOREVER } from '../shared/planner';
import { EQUIPMENT, templateEquipment } from '../shared/catalog';
import { AREA_TEMPLATES, areaFromTemplate } from '../shared/exercises';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY = 86400000;
const NOW = new Date(2026, 10, 18, 12).getTime(); // Wed 18 Nov 2026 12:00 local, ISO week 47
afterEach(() => setSystemTime());

async function setup() {
  setSystemTime(new Date(NOW));
  const db = openDb(':memory:');
  const app = new Hono();
  app.route('/api', buildApi(db));
  app.route('/mcp', buildMcp(db));
  const j = async (path: string, init: { token?: string; body?: unknown; raw?: string; method?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const r = await app.request(path, { method: init.method ?? 'POST', headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
    return { status: r.status, body: (await r.json().catch(() => null)) as any, headers: r.headers };
  };
  const anon = (await j('/api/auth/anon', { body: {} })).body as { token: string; userId: string };
  const mk = async (scope: 'read' | 'write') => (await j('/api/tokens', { token: anon.token, body: { name: 't', scope } })).body.token as string;
  const sync = (changes: unknown[]) => j('/api/sync', { token: anon.token, body: { changes } });
  let rid = 0;
  const rpc = (token: string, method: string, params?: unknown) => j('/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });
  const call = async (token: string, name: string, args: unknown = {}) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    const text = r.body.result.content[0].text as string;
    const isError = !!r.body.result.isError;
    return { isError, text, json: isError ? null : (JSON.parse(text) as any) };
  };
  const data = () => loadData(db, anon.userId);
  return { db, j, anon, mk, sync, rpc, call, data };
}

const lower = areaFromTemplate(AREA_TEMPLATES[1], 'lower');
const upper = areaFromTemplate(AREA_TEMPLATES[0], 'upper');
const entity = (type: string, id: string, data: unknown, updatedAt = 1) => ({ type, id, updatedAt, data });
const sx = (exerciseId: string, name: string, over: Record<string, unknown> = {}) => ({
  id: `x_${exerciseId}`, exerciseId, name, order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8, plannedSets: 3, repTarget: 8,
  plannedWeight: 50, restSec: 90, estSec: 600, status: 'done', sets: [{ weight: 100, reps: 5, doneAt: 1, restSec: 90 }, { weight: 0, reps: 8, doneAt: 2 }], ...over,
});
const session = (id: string, over: Record<string, unknown> = {}) => ({
  id, seq: 1, slot: 1, areaId: 'upper', areaName: 'Upper body', gymId: 'g1', gymName: 'City', status: 'completed', startedAt: NOW - 3 * DAY - 3600_000,
  endedAt: NOW - 3 * DAY, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done', updatedAt: 1, ...over,
});

async function seeded() {
  const s = await setup();
  const gym = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id === 'g1' ? 'City' : id, lat: 1, lng: 2, radiusM: 150, equipment: templateEquipment('full'), notes: { leg_press: 'wobbly' }, brokenSince: {}, createdAt: 1, ...over });
  await s.sync([
    entity('area', 'lower', lower), entity('area', 'upper', upper),
    entity('gym', 'g1', gym('g1', { lastVisitedAt: NOW - 1000 })),
    entity('gym', 'g2', gym('g2', { name: 'Home', lastVisitedAt: NOW - 5 * DAY, equipment: { dumbbells: 'ok', leg_press: 'broken' }, radiusM: 80 })),
    entity('gym', 'gone', gym('gone', { deleted: true })),
    entity('settings', 'settings', { name: 'Alex', weeklyGoal: 2, rotation: ['upper', 'lower', 'ghost'], profileNotes: 'knee', targetMinutes: 50, warmupTargetMinutes: 8, restSec: 75, unit: 'kg' }),
  ]);
  const w = await s.mk('write');
  const r = await s.mk('read');
  return { ...s, w, r, gym };
}

describe('transport', () => {
  test('methods, CORS and auth failure shape', async () => {
    const { j, w } = await setup().then(async (s) => ({ ...s, w: await s.mk('write') }));
    const get = await j('/mcp', { method: 'GET', token: w });
    expect([get.status, get.body]).toEqual([405, { error: 'Use POST (streamable HTTP, JSON responses).' }]);
    expect((await j('/mcp', { method: 'DELETE', token: w })).status).toBe(204);
    const opt = await j('/mcp', { method: 'OPTIONS' });
    expect(opt.status).toBe(204);
    expect(opt.headers.get('access-control-allow-origin')).toBe('*');
    expect(opt.headers.get('access-control-allow-headers')).toBe('authorization, content-type, mcp-protocol-version, mcp-session-id');
    expect(opt.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    const un = await j('/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(un.status).toBe(401);
    expect(un.body).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: send "Authorization: Bearer rep_…"' } });
    expect(un.headers.get('www-authenticate')).toBe('Bearer');
    const ok = await j('/mcp', { token: w, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
  });
  test('bearer parsing: exact "Bearer " prefix, trimmed, rep_ prefix, revoked tokens rejected, last_used updated', async () => {
    const s = await setup();
    const w = await s.mk('write');
    const ping = (h?: string) => s.j('/mcp', { headers: h === undefined ? {} : { authorization: h }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect((await ping(`Bearer ${w}`)).status).toBe(200);
    expect((await ping(`Bearer   ${w}  `)).status).toBe(200);
    expect((await ping(`bearer ${w}`)).status).toBe(401);
    expect((await ping(w)).status).toBe(401);
    expect((await ping(`Bearer ${w.slice(4)}`)).status).toBe(401);
    expect((await ping(`Bearer rep_${'x'.repeat(30)}`)).status).toBe(401);
    expect((await ping('Bearer ')).status).toBe(401);
    expect((await ping()).status).toBe(401);
    expect((await ping(`Bearer ${w}x`)).status).toBe(401);
    // stored hashed, last_used touched
    const row = s.db.query('SELECT hash,last_used FROM api_tokens').get() as any;
    expect(row.hash).toBe(sha(w));
    setSystemTime(new Date(NOW + 5000));
    await ping(`Bearer ${w}`);
    expect((s.db.query('SELECT last_used FROM api_tokens').get() as any).last_used).toBe(NOW + 5000);
    const list = (await s.j('/api/tokens', { token: s.anon.token, method: 'GET' })).body.tokens;
    await s.j(`/api/tokens/${list[0].id}`, { token: s.anon.token, method: 'DELETE' });
    expect((await ping(`Bearer ${w}`)).status).toBe(401);
  });
  test('body handling: parse error, size cap (2,000,000 chars), batches and notifications', async () => {
    const s = await setup();
    const w = await s.mk('write');
    const bad = await s.j('/mcp', { token: w, raw: '{oops' });
    expect([bad.status, bad.body]).toEqual([400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }]);
    const base = '{"jsonrpc":"2.0","id":7,"method":"ping","pad":""}';
    const pad = (n: number) => base.replace('""', `"${'a'.repeat(n - base.length + 0)}"`);
    const exact = pad(2_000_000);
    expect(exact).toHaveLength(2_000_000);
    const ok = await s.j('/mcp', { token: w, raw: exact });
    expect([ok.status, ok.body]).toEqual([200, { jsonrpc: '2.0', id: 7, result: {} }]);
    const big = await s.j('/mcp', { token: w, raw: pad(2_000_001) });
    expect([big.status, big.body]).toEqual([413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Too large' } }]);
    // notifications only -> 202 with no body; batch of notification + request -> only the response
    const n = await s.j('/mcp', { token: w, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(n.status).toBe(202);
    expect(n.headers.get('access-control-allow-origin')).toBe('*');
    expect((await s.j('/mcp', { token: w, body: { jsonrpc: '2.0', method: 'notifications/cancelled' } })).status).toBe(202);
    expect((await s.j('/mcp', { token: w, body: [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }] })).status).toBe(202);
    const b = await s.j('/mcp', { token: w, body: [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', id: 'b', method: 'ping' }] });
    expect(b.status).toBe(200);
    expect(b.body).toEqual([{ jsonrpc: '2.0', id: 'a', result: {} }, { jsonrpc: '2.0', id: 'b', result: {} }]);
    expect(b.headers.get('access-control-allow-origin')).toBe('*');
    // unknown method: error with id, ignored without id
    const u = await s.j('/mcp', { token: w, body: { jsonrpc: '2.0', id: 3, method: 'nope/x' } });
    expect(u.body).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Method not found: nope/x' } });
    expect((await s.j('/mcp', { token: w, body: { jsonrpc: '2.0', method: 'nope/x' } })).status).toBe(202);
    // missing id echoes null
    expect((await s.j('/mcp', { token: w, body: { jsonrpc: '2.0', method: 'ping', id: null } })).body).toEqual({ jsonrpc: '2.0', id: null, result: {} });
  });
  test('rate limit: 180 requests per minute per token (181st -> 429), window edge exclusive, tokens independent', async () => {
    const s = await setup();
    const a = await s.mk('write'), b = await s.mk('read');
    const ping = (t: string) => s.j('/mcp', { token: t, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    for (let i = 0; i < 180; i++) expect((await ping(a)).status).toBe(200);
    const lim = await ping(a);
    expect([lim.status, lim.body]).toEqual([429, { jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Rate limited' } }]);
    expect((await ping(b)).status).toBe(200);
    setSystemTime(new Date(NOW + 60_000 - 1));
    expect((await ping(a)).status).toBe(429);
    setSystemTime(new Date(NOW + 60_000));
    expect((await ping(a)).status).toBe(429); // reset == now still counts
    setSystemTime(new Date(NOW + 60_001));
    expect((await ping(a)).status).toBe(200);
    // fresh window counts from 1
    for (let i = 0; i < 179; i++) expect((await ping(a)).status).toBe(200);
    expect((await ping(a)).status).toBe(429);
  });
  test('the endpoint answers on sub-paths too', async () => {
    const s = await setup();
    const w = await s.mk('write');
    expect((await s.j('/mcp/anything', { token: w, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).body).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect((await s.j('/mcp/anything', { method: 'GET', token: w })).status).toBe(405);
    expect((await s.j('/mcp/anything', { method: 'DELETE', token: w })).status).toBe(204);
    expect((await s.j('/mcp/anything', { method: 'OPTIONS' })).status).toBe(204);
  });
  test('initialize / ping / tools/list', async () => {
    const s = await setup();
    const w = await s.mk('write'), r = await s.mk('read');
    const init = (await s.rpc(w, 'initialize', { protocolVersion: '2024-11-05' })).body.result;
    expect(init.protocolVersion).toBe('2024-11-05');
    expect(init.capabilities).toEqual({ tools: { listChanged: false } });
    expect(init.serverInfo).toEqual({ name: 'rep-gym-tracker', version: '1.0.0' });
    expect(init.instructions).toStartWith("You are connected to the athlete's gym tracker");
    expect(init.instructions).toContain('create_coach_plan');
    expect((await s.rpc(w, 'initialize')).body.result.protocolVersion).toBe('2025-06-18');
    expect((await s.rpc(w, 'ping')).body).toMatchObject({ jsonrpc: '2.0', result: {} });
    const lw = (await s.rpc(w, 'tools/list')).body.result.tools;
    const lr = (await s.rpc(r, 'tools/list')).body.result.tools;
    expect(lw.map((t: any) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(lr.map((t: any) => t.name)).toEqual(TOOLS.filter((t) => !t.write).map((t) => t.name));
    expect(lr.length).toBeLessThan(lw.length);
    for (const t of lw) {
      const def = TOOLS.find((x) => x.name === t.name)!;
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.description.endsWith(' [write]')).toBe(!!def.write);
      expect(t.description).toBe(def.description + (def.write ? ' [write]' : ''));
      expect(t.inputSchema).toBe(t.inputSchema);
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
    }
    // the input schemas are the contract with coach agents
    expect(lw.map((t: any) => ({ name: t.name, write: t.description.endsWith(' [write]'), schema: t.inputSchema }))).toMatchSnapshot();
  });
  test('tools/call: unknown tool, scope enforcement, tool errors, internal errors, truncation, audit event', async () => {
    const s = await seeded();
    const unk = await s.rpc(s.w, 'tools/call', { name: 'nope' });
    expect(unk.body.error).toEqual({ code: -32602, message: 'Unknown tool nope' });
    expect((await s.rpc(s.w, 'tools/call', {})).body.error.message).toBe('Unknown tool undefined');
    const noParams = await s.rpc(s.w, 'tools/call');
    expect([noParams.status, noParams.body.error]).toEqual([200, { code: -32602, message: 'Unknown tool undefined' }]);
    expect((await s.rpc(s.w, 'tools/call', { name: 'get_overview' })).body.result.content[0].type).toBe('text');
    const ro = await s.call(s.r, 'set_exercise_pref', { exerciseId: 'back_squat', favorite: true });
    expect(ro.isError).toBe(true);
    expect(ro.text).toBe('This token is read-only. Create a read+write token in the app (Settings → Connect a coach) to edit.');
    expect(s.data().prefs.back_squat).toBeUndefined();
    expect((await s.call(s.r, 'get_overview')).isError).toBe(false);
    // ToolError -> isError text; success -> isError false
    const te = await s.call(s.w, 'get_exercise', { exerciseId: 'zzz' });
    expect(te).toMatchObject({ isError: true, text: 'Unknown exerciseId "zzz". Use list_exercises to find ids.' });
    // unexpected exception -> generic message (and logged)
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    const boom = await s.call(s.w, 'bulk_set_exercise_prefs', { items: [null] });
    expect(boom).toMatchObject({ isError: true, text: 'Internal error running tool.' });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe('mcp tool error');
    expect(spy.mock.calls[0][1]).toBe('bulk_set_exercise_prefs');
    spy.mockRestore();
    // missing arguments default to {}
    const noArgs = await s.rpc(s.w, 'tools/call', { name: 'get_overview' });
    expect(noArgs.body.result.isError).toBe(false);
    // audit trail: writes are recorded with the tool name and arguments, reads are not
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'back_squat', favorite: true });
    await s.call(s.w, 'get_overview');
    const ev = (await s.call(s.w, 'list_events')).json;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'mcp_write', sessionId: null, payload: { tool: 'set_exercise_pref', args: { exerciseId: 'back_squat', favorite: true } } });
    // a failed write is not recorded
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'nope' });
    expect((await s.call(s.w, 'list_events')).json).toHaveLength(1);
  });
  test('large results are truncated at 400,000 characters', async () => {
    const s = await seeded();
    await s.sync([entity('session', 'huge', session('huge', { note: 'n'.repeat(450_000) }), 5)]);
    const r = await s.rpc(s.w, 'tools/call', { name: 'get_session', arguments: { id: 'huge' } });
    const text = r.body.result.content[0].text as string;
    expect(text.length).toBe(400_000 + '…[truncated: narrow your query]'.length);
    expect(text.endsWith('…[truncated: narrow your query]')).toBe(true);
    expect(text.startsWith('{"id":"huge"')).toBe(true);
    // exactly 400,000 characters is NOT truncated; one more is
    await s.sync([entity('session', 'probe', session('probe', { note: '' }), 5)]);
    const baseLen = (await s.call(s.w, 'get_session', { id: 'probe' })).text.length;
    await s.sync([entity('session', 'exact', session('exact', { note: 'n'.repeat(400_000 - baseLen) }), 5), entity('session', 'plus1', session('plus1', { note: 'n'.repeat(400_001 - baseLen) }), 5)]);
    const exact = await s.call(s.w, 'get_session', { id: 'exact' });
    expect(exact.text.length).toBe(400_000);
    expect(exact.text.endsWith('…[truncated: narrow your query]')).toBe(false);
    expect(exact.json.id).toBe('exact');
    const plus1 = await s.rpc(s.w, 'tools/call', { name: 'get_session', arguments: { id: 'plus1' } });
    expect((plus1.body.result.content[0].text as string).endsWith('…[truncated: narrow your query]')).toBe(true);
    await s.sync([entity('session', 'ok', session('ok', { note: 'n'.repeat(1000) }), 5)]);
    const fine = (await s.call(s.w, 'get_session', { id: 'ok' }));
    expect(fine.text.endsWith('…[truncated: narrow your query]')).toBe(false);
    expect(fine.json.note).toHaveLength(1000);
  });
});

describe('read tools: overview, sessions, history', () => {
  async function withHistory() {
    const s = await seeded();
    const fb = { weight: 'light', effort: 'chill', volume: 'reps' };
    const rec = { weight: 102.5, reps: 5, sets: 3, tag: '+2.5 kg', why: 'Too light', kind: 'weight_up', ruleVersion: 1 };
    await s.sync([
      entity('session', 's1', session('s1', { seq: 1, slot: 1, startedAt: NOW - 3 * DAY - 3600_000, endedAt: NOW - 3 * DAY, warmupStartedAt: NOW - 3 * DAY - 3600_000, warmupEndedAt: NOW - 3 * DAY - 3600_000 + 300_000, note: 'good', endedEarly: true, source: 'coach',
        exercises: [sx('back_squat', 'Back squat', { feedback: fb, recommendation: rec, pr: true, swappedFrom: 'leg_press' }), sx('leg_press', 'Leg press', { status: 'skipped', sets: [] })] })),
      entity('session', 's2', session('s2', { seq: 2, slot: 2, areaId: 'lower', areaName: 'Lower body', startedAt: NOW - 1 * DAY - 5400_000, endedAt: NOW - 1 * DAY, exercises: [sx('back_squat', 'Back squat', { sets: [{ weight: 110, reps: 5, doneAt: 1 }], feedback: { weight: 'right', effort: 'hard', volume: 'sets' } })] })),
      entity('session', 's3', session('s3', { seq: 3, slot: 1, status: 'discarded', startedAt: NOW - 2 * DAY, endedAt: NOW - 2 * DAY + 60_000 })),
      entity('session', 's4', session('s4', { seq: 4, status: 'active', endedAt: undefined, startedAt: NOW - 600_000, exercises: [] })),
      entity('session', 's0', session('s0', { seq: 0, startedAt: NOW - 20 * DAY - 1800_000, endedAt: NOW - 20 * DAY, exercises: [sx('back_squat', 'Back squat', { sets: [{ weight: 90, reps: 5, doneAt: 1 }] })] })),
    ]);
    return s;
  }

  test('get_overview', async () => {
    const s = await withHistory();
    const o = (await s.call(s.r, 'get_overview')).json;
    expect(o.now).toBe(new Date(NOW).toISOString());
    expect(o.athlete).toBe('Alex');
    expect(o.profileNotes).toBe('knee');
    expect(o.weeklyGoal).toBe(2);
    expect(o.thisWeek).toEqual({ isoWeek: 47, done: 1, weekStart: new Date(2026, 10, 16).toISOString() });
    expect(o.streakWeeksHittingGoal).toBe(0); // 1 session this week and 1 last week, goal 2
    expect(o).toMatchObject({ targetMinutes: 50, warmupTargetMinutes: 8, restSec: 75, unit: 'kg' });
    expect(o.rotation).toEqual([{ slot: 1, areaId: 'upper', area: 'Upper body' }, { slot: 2, areaId: 'lower', area: 'Lower body' }, { slot: 3, areaId: 'ghost', area: '(missing)' }]);
    expect(o.nextSlot).toBe(3); // last completed slot is 2 (s2)
    expect(o.nextArea).toBe('(missing)');
    expect(o.planner.wRecency).toBe(1.2);
    expect(o.plannerDefaults.wRecency).toBe(1.2);
    expect({ ...o.counts, exercisesInLibrary: 0 }).toEqual({ completedSessions: 3, areas: 2, gyms: 2, customExercises: 0, exercisesInLibrary: 0, favorites: 0, avoided: 0 });
    expect(o.counts.exercisesInLibrary).toBeGreaterThan(50);
    expect(o.activeSession.id).toBe('s4');
    expect(o.activeSession.durationMin).toBeNull();
    expect(o.lastSessions.map((x: any) => x.id)).toEqual(['s2', 's1', 's0']);
    expect(o.pendingCoachPlans).toEqual([]);
  });
  test('get_overview with an empty rotation, no sessions, plans and prefs', async () => {
    const s = await setup();
    const w = await s.mk('write');
    await s.sync([entity('settings', 'settings', { rotation: [] }), entity('area', 'lower', lower)]);
    await s.call(w, 'set_exercise_pref', { exerciseId: 'back_squat', favorite: true });
    await s.call(w, 'set_exercise_pref', { exerciseId: 'leg_press', banned: true });
    await s.call(w, 'create_coach_plan', { title: 'P', slot: 2, areaId: 'lower', exercises: [{ exerciseId: 'back_squat' }, { exerciseId: 'leg_press' }] });
    const o = (await s.call(w, 'get_overview')).json;
    expect(o.rotation).toEqual([]);
    expect(o.nextSlot).toBeNull();
    expect(o.nextArea).toBeNull();
    expect(o.athlete).toBeNull();
    expect(o.activeSession).toBeNull();
    expect(o.lastSessions).toEqual([]);
    expect(o.counts).toMatchObject({ completedSessions: 0, areas: 1, gyms: 0, favorites: 1, avoided: 1 });
    expect(o.pendingCoachPlans).toHaveLength(1);
    expect(o.pendingCoachPlans[0].id).toMatch(/^plan_/);
    expect({ ...o.pendingCoachPlans[0], id: 'x' }).toEqual({ id: 'x', title: 'P', slot: 2, areaId: 'lower', exercises: 2 });
  });
  test('last 5 completed sessions, newest first', async () => {
    const s = await seeded();
    await s.sync(Array.from({ length: 7 }, (_, i) => entity('session', `m${i}`, session(`m${i}`, { seq: i, endedAt: NOW - (i + 1) * 3600_000, startedAt: NOW - (i + 1) * 3600_000 - 1000 }))));
    const o = (await s.call(s.r, 'get_overview')).json;
    expect(o.lastSessions.map((x: any) => x.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(o.counts.completedSessions).toBe(7);
    expect(o.thisWeek.done).toBe(7);
    expect(o.streakWeeksHittingGoal).toBe(1); // this week met the goal of 2, last week had none
  });
  test('list_sessions: ordering, filters, limit, summary shape', async () => {
    const s = await withHistory();
    const all = (await s.call(s.r, 'list_sessions')).json;
    expect(all.total).toBe(5);
    expect(all.sessions.map((x: any) => x.id)).toEqual(['s4', 's2', 's3', 's1', 's0']); // by startedAt desc
    expect((await s.call(s.r, 'list_sessions', { status: 'completed' })).json.sessions.map((x: any) => x.id)).toEqual(['s2', 's1', 's0']);
    expect((await s.call(s.r, 'list_sessions', { status: 'active' })).json.total).toBe(1);
    expect((await s.call(s.r, 'list_sessions', { areaId: 'lower' })).json.sessions.map((x: any) => x.id)).toEqual(['s2']);
    const lim = (await s.call(s.r, 'list_sessions', { limit: 2 })).json;
    expect(lim.total).toBe(5);
    expect(lim.sessions).toHaveLength(2);
    // sinceDays is inclusive at the boundary
    await s.sync([entity('session', 'edge', session('edge', { startedAt: NOW - 7 * DAY, endedAt: NOW - 7 * DAY + 1000 }), 9), entity('session', 'edge2', session('edge2', { startedAt: NOW - 7 * DAY - 1, endedAt: NOW - 7 * DAY + 1000 }), 9)]);
    const since = (await s.call(s.r, 'list_sessions', { sinceDays: 7 })).json.sessions.map((x: any) => x.id);
    expect(since).toContain('edge');
    expect(since).not.toContain('edge2');
    expect(since).not.toContain('s0');
    expect((await s.call(s.r, 'list_sessions', { limit: 21 })).json.sessions.length).toBeLessThanOrEqual(21);
    // default page is 20
    await s.sync(Array.from({ length: 25 }, (_, i) => entity('session', `p${i}`, session(`p${i}`, { startedAt: NOW - 100 * DAY - i, endedAt: NOW - 100 * DAY }), 9)));
    const page = (await s.call(s.r, 'list_sessions')).json;
    expect(page.sessions).toHaveLength(20);
    expect(page.total).toBe(32);
    const s1 = all.sessions.find((x: any) => x.id === 's1');
    expect(s1).toEqual({
      id: 's1', seq: 1, slot: 1, area: 'Upper body', areaId: 'upper', gym: 'City', gymId: 'g1', status: 'completed', source: 'coach',
      startedAt: new Date(NOW - 3 * DAY - 3600_000).toISOString(), endedAt: new Date(NOW - 3 * DAY).toISOString(), durationMin: 60, warmupMin: 5,
      endedEarly: true, note: 'good',
      exercises: [
        { exerciseId: 'back_squat', name: 'Back squat', status: 'done', sets: ['5 @ 100 kg', '8'], feedback: { weight: 'light', effort: 'chill', volume: 'reps' },
          nextTime: { weight: 102.5, reps: 5, sets: 3, tag: '+2.5 kg', why: 'Too light' }, swappedFrom: 'leg_press', pr: true },
        { exerciseId: 'leg_press', name: 'Leg press', status: 'skipped', sets: [], feedback: null, nextTime: null, swappedFrom: null, pr: false },
      ],
    });
    const s2 = all.sessions.find((x: any) => x.id === 's2');
    expect(s2).toMatchObject({ source: 'auto', warmupMin: null, endedEarly: false, note: null, durationMin: 90 });
    const act = all.sessions.find((x: any) => x.id === 's4');
    expect(act).toMatchObject({ endedAt: null, durationMin: null, status: 'active' });
  });
  test('get_session raw and not found', async () => {
    const s = await withHistory();
    expect((await s.call(s.r, 'get_session', { id: 's1' })).json.note).toBe('good');
    expect(await s.call(s.r, 'get_session', { id: 'zzz' })).toMatchObject({ isError: true, text: 'Session not found.' });
  });
  test('get_exercise_history: oldest first, limit, rows, trend', async () => {
    const s = await withHistory();
    const h = (await s.call(s.r, 'get_exercise_history', { exerciseId: 'back_squat' })).json;
    expect(h.count).toBe(3);
    expect(h.history.map((x: any) => x.session)).toEqual(['s0', 's1', 's2']);
    expect(h.history[1]).toEqual({
      date: new Date(NOW - 3 * DAY).toISOString(), session: 's1', area: 'Upper body', topWeight: 100, volume: 500, sets: [{ weight: 100, reps: 5, restSec: 90 }, { weight: 0, reps: 8, restSec: null }],
      feedback: { weight: 'light', effort: 'chill', volume: 'reps' }, nextTime: { weight: 102.5, reps: 5, sets: 3, tag: '+2.5 kg', why: 'Too light' }, pr: true,
    });
    expect(h.history[0]).toMatchObject({ feedback: null, nextTime: null, pr: false, topWeight: 90, volume: 450 });
    expect(h.trend).toEqual({ topWeightFrom: 90, topWeightTo: 110, volumeFrom: 450, volumeTo: 550 });
    expect(h.exercise.id).toBe('back_squat');
    const one = (await s.call(s.r, 'get_exercise_history', { exerciseId: 'back_squat', limit: 1 })).json;
    expect(one.history.map((x: any) => x.session)).toEqual(['s2']);
    expect(one.count).toBe(1);
    const two = (await s.call(s.r, 'get_exercise_history', { exerciseId: 'back_squat', limit: 2 })).json;
    expect(two.history.map((x: any) => x.session)).toEqual(['s1', 's2']);
    const none = (await s.call(s.r, 'get_exercise_history', { exerciseId: 'leg_ext' })).json;
    expect(none).toMatchObject({ count: 0, trend: null, history: [] });
    expect((await s.call(s.r, 'get_exercise_history', { exerciseId: 'zz' })).isError).toBe(true);
    // default limit is 30
    await s.sync(Array.from({ length: 35 }, (_, i) => entity('session', `h${i}`, session(`h${i}`, { endedAt: NOW - (100 + i) * DAY, startedAt: NOW - (100 + i) * DAY - 1000, exercises: [sx('leg_ext', 'Leg ext', { sets: [{ weight: i, reps: 10, doneAt: 1 }] })] }), 7)));
    const big = (await s.call(s.r, 'get_exercise_history', { exerciseId: 'leg_ext' })).json;
    expect(big.count).toBe(30);
    expect(big.history[0].topWeight).toBe(29); // oldest of the newest 30 (i = 29..0 -> weights 29 ... 0)
  });
});

describe('read tools: library, scoring, areas, gyms, settings', () => {
  test('list_exercises: filters, scores, sorting, limit', async () => {
    const s = await seeded();
    const names = async (a: object) => (await s.call(s.r, 'list_exercises', { includeScores: false, limit: 300, ...a })).json.exercises.map((e: any) => e.id) as string[];
    expect(await names({ query: 'BACK SQ' })).toEqual(['back_squat']);
    expect(await names({ query: 'nonexistent' })).toEqual([]);
    const chest = await names({ muscle: 'Triceps' });
    expect(chest).toContain('bench_press'); // secondary muscle counts
    expect(chest).toContain('tricep_pushdown'); // primary muscle counts
    const rows = async (a: object) => (await s.call(s.r, 'list_exercises', { includeScores: false, limit: 300, ...a })).json.exercises as any[];
    const carry = await rows({ pattern: 'carry' });
    expect(carry.length).toBeGreaterThan(0);
    expect(carry.every((e) => e.pattern === 'carry')).toBe(true);
    expect(carry.length).toBeLessThan((await rows({})).length);
    const mus = await rows({ muscle: 'Triceps' });
    expect(mus.every((e) => e.primary.includes('Triceps') || e.secondary.includes('Triceps'))).toBe(true);
    expect(mus.length).toBeLessThan((await rows({})).length);
    expect(mus.some((e) => !e.primary.includes('Triceps'))).toBe(true); // secondary-only matches are included
    const sled = await names({ equipmentId: 'leg_press' });
    expect(sled).toContain('leg_press');
    expect(sled).not.toContain('back_squat');
    // available at gym: only equipment with status "ok"
    const home = await names({ availableAtGymId: 'g2' });
    expect(home).toContain('goblet_squat');
    expect(home).not.toContain('leg_press'); // broken
    expect(home).not.toContain('back_squat');
    expect(home).toContain('glute_bridge'); // bodyweight is always possible
    expect((await s.call(s.r, 'list_exercises', { availableAtGymId: 'gone' })).text).toBe('Unknown gymId "gone". Use list_gyms.');
    // favorites / avoided / custom
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'back_squat', favorite: true });
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'leg_press', avoid: true });
    expect(await names({ favoritesOnly: true })).toEqual(['back_squat']);
    expect(await names({ includeAvoided: false })).not.toContain('leg_press');
    expect(await names({ includeAvoided: false })).toContain('back_squat');
    expect(await names({ includeAvoided: true })).toContain('leg_press');
    expect(await names({})).toContain('leg_press');
    const created = (await s.call(s.w, 'create_exercise', { name: 'Zed curl', primary: ['Biceps'], pattern: 'pull' })).json.created;
    expect(await names({ customOnly: true })).toEqual([created.id]);
    // archived exercises are hidden
    await s.call(s.w, 'archive_exercise', { exerciseId: 'hack_squat' });
    expect(await names({})).not.toContain('hack_squat');
    await s.call(s.w, 'archive_exercise', { exerciseId: 'hack_squat', restore: true });
    expect(await names({})).toContain('hack_squat');
    // limit
    expect(await names({ limit: 3 })).toHaveLength(3);
    const dflt = (await s.call(s.r, 'list_exercises', {})).json;
    expect(dflt.exercises).toHaveLength(60);
    expect(dflt.total).toBeGreaterThan(60);
  });
  test('list_exercises sorting and score fields', async () => {
    const s = await seeded();
    await s.sync([
      entity('session', 'a', session('a', { endedAt: NOW - 3 * DAY, exercises: [sx('back_squat', 'Back squat')] })),
      entity('session', 'b', session('b', { endedAt: NOW - 40 * DAY, startedAt: NOW - 40 * DAY - 1000, exercises: [sx('leg_press', 'Leg press')] })),
    ]);
    await s.call(s.w, 'bulk_set_exercise_prefs', { items: [{ exerciseId: 'leg_ext', relevance: 99 }, { exerciseId: 'goblet_squat', relevance: 1 }] });
    const q = async (a: object) => (await s.call(s.r, 'list_exercises', a)).json.exercises as any[];
    const byScore = await q({ muscle: 'Quads', limit: 300 });
    const sc = byScore.map((e) => e.score);
    expect(sc).toEqual([...sc].sort((a, b) => b - a));
    expect(byScore[0]).toHaveProperty('coolingDown');
    const bs = byScore.find((e) => e.id === 'back_squat');
    expect(bs).toMatchObject({ coolingDown: true, daysSinceLastDone: 3, timesLast28d: 1 });
    const lp = byScore.find((e) => e.id === 'leg_press');
    expect(lp).toMatchObject({ coolingDown: false, daysSinceLastDone: 40, timesLast28d: 0 });
    const nev = byScore.find((e) => e.id === 'leg_ext');
    expect(nev.daysSinceLastDone).toBeNull();
    const rel = await q({ muscle: 'Quads', sort: 'relevance', includeScores: false, limit: 300 });
    expect(rel[0].id).toBe('leg_ext');
    expect(rel.map((e) => e.relevance)).toEqual([...rel.map((e) => e.relevance)].sort((a, b) => b - a));
    expect(rel[rel.length - 1].id).toBe('goblet_squat');
    expect('score' in rel[0]).toBe(false);
    const name = await q({ muscle: 'Quads', sort: 'name', limit: 300 });
    const nm = name.map((e) => e.name);
    expect(nm).toEqual([...nm].sort((a, b) => a.localeCompare(b)));
    const last = await q({ muscle: 'Quads', sort: 'lastDone', limit: 300 });
    expect(last[0].daysSinceLastDone === null || last[0].daysSinceLastDone === 40).toBe(true);
    expect(last.slice(-1)[0].id).toBe('back_squat'); // most recent last
    // default sort is score with scores, name without
    const noScores = await q({ muscle: 'Quads', includeScores: false, limit: 300 });
    expect(noScores.map((e) => e.name)).toEqual(nm);
    // area context changes the score through focus muscles
    const inArea = (await s.call(s.r, 'list_exercises', { muscle: 'Quads', areaId: 'upper', limit: 300 })).json.exercises as any[];
    const plain = byScore.find((e) => e.id === 'leg_ext').score;
    expect(inArea.find((e) => e.id === 'leg_ext').score).toBeLessThan(plain);
    expect(inArea.find((e) => e.id === 'leg_ext').scoreBreakdown).toBeUndefined();
  });
  test('get_exercise / explain_score', async () => {
    const s = await seeded();
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'goblet_squat', favorite: true, relevance: 80, notes: 'n', cooldownSessions: 2, minDaysBetween: 4, pauseDays: 3 });
    const e = (await s.call(s.r, 'get_exercise', { exerciseId: 'goblet_squat', areaId: 'lower' })).json;
    expect(e).toMatchObject({
      id: 'goblet_squat', name: 'Goblet squat', primary: ['Quads', 'Glutes'], secondary: ['Core'], equipment: ['dumbbells'], pattern: 'squat', difficulty: 1, tracking: 'weight_reps',
      weightStep: 2, repRange: [8, 12], defaultSets: 3, perHand: false, prehab: false, custom: false, tags: [], status: 'paused', favorite: true, avoid: false, banned: false,
      pausedUntil: new Date(NOW + 3 * DAY).toISOString(), pausedUntilResumed: false, pausedSessions: 0, relevance: 80, cooldownSessions: 2, minDaysBetween: 4, notes: 'n', nextPrescription: null,
    });
    expect(e.score).toBe(e.scoreBreakdown.total);
    expect(e.scoreBreakdown.paused).toBe(true);
    expect(e.scoreBreakdown.relevance).toBe(80);
    const noArea = (await s.call(s.r, 'get_exercise', { exerciseId: 'goblet_squat' })).json;
    expect(noArea.scoreBreakdown.coverage).not.toBe(e.scoreBreakdown.coverage - 1000);
    const plain = (await s.call(s.r, 'get_exercise', { exerciseId: 'back_squat' })).json;
    expect(plain).toMatchObject({ status: 'ready', pausedUntil: null, pausedUntilResumed: false, pausedSessions: 0, cooldownSessions: null, minDaysBetween: null, notes: null, relevance: 50, perHand: false, prehab: false, tags: [] });
    expect(plain.nextPrescription).toBeNull();
    await s.call(s.w, 'set_next_prescription', { exerciseId: 'back_squat', weight: 60, reps: 6, sets: 4 });
    expect((await s.call(s.r, 'get_exercise', { exerciseId: 'back_squat' })).json.nextPrescription).toEqual({ weight: 60, reps: 6, sets: 4 });
    const ex = (await s.call(s.r, 'explain_score', { exerciseId: 'goblet_squat', areaId: 'lower' })).json;
    expect(ex.exerciseId).toBe('goblet_squat');
    expect(ex.weights.wRecency).toBe(1.2);
    expect(ex.formula).toContain('total = (wRelevance·relevance');
    expect(ex.formula).toContain('35·wVariety·similarity');
    expect(ex.total).toBe(e.score);
    expect(ex.reasons).toContain('Favorite.');
    expect((await s.call(s.r, 'explain_score', { exerciseId: 'nope' })).isError).toBe(true);
    // pause forever flags
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'back_squat', pauseDays: 0 });
    const forever = (await s.call(s.r, 'get_exercise', { exerciseId: 'back_squat' })).json;
    expect(forever).toMatchObject({ status: 'paused', pausedUntil: null, pausedUntilResumed: true });
    // an exercise with tags/perHand/prehab exposes them
    const c = (await s.call(s.w, 'create_exercise', { name: 'Tagged', primary: ['Core'], pattern: 'core', perHand: true, prehab: true, tags: ['a'], tracking: 'time', repMin: 20, repMax: 60 })).json.created;
    expect(c).toMatchObject({ perHand: true, prehab: true, tags: ['a'], custom: true, tracking: 'time', weightStep: 0 });
  });
  test('list_areas, list_gyms, list_equipment_catalog, get_settings', async () => {
    const s = await seeded();
    const a = (await s.call(s.r, 'list_areas')).json;
    expect(a.rotation).toEqual(['upper', 'lower', 'ghost']);
    expect(a.areas.map((x: any) => x.id).sort()).toEqual(['lower', 'upper']);
    expect(a.areas.find((x: any) => x.id === 'lower').poolSize).toBe(lower.poolExerciseIds.length);
    expect(a.areas.find((x: any) => x.id === 'lower').name).toBe('Lower body');
    const g = (await s.call(s.r, 'list_gyms')).json;
    expect(g.map((x: any) => x.id).sort()).toEqual(['g1', 'g2']);
    const g2 = g.find((x: any) => x.id === 'g2');
    expect(g2).toEqual({ id: 'g2', name: 'Home', lat: 1, lng: 2, radiusM: 80, lastVisitedAt: new Date(NOW - 5 * DAY).toISOString(), equipment: { dumbbells: 'ok', leg_press: 'broken' }, notes: { leg_press: 'wobbly' } });
    expect((await s.call(s.r, 'list_equipment_catalog')).json).toEqual(EQUIPMENT);
    const st = (await s.call(s.r, 'get_settings')).json;
    expect(st).toMatchObject({ name: 'Alex', weeklyGoal: 2, targetMinutes: 50 });
    expect(st.plannerDefaults.jitter).toBe(0.2);
    expect(st.planner.jitter).toBe(0.2);
  });
  test('get_muscle_report and get_stats', async () => {
    const s = await seeded();
    await s.sync([
      entity('session', 'a', session('a', { endedAt: NOW - 3 * DAY, startedAt: NOW - 3 * DAY - 3600_000, warmupStartedAt: 1000, warmupEndedAt: 601000, exercises: [sx('back_squat', 'Back squat', { feedback: { weight: 'light', effort: 'chill', volume: 'reps' }, pr: true })] })),
      entity('session', 'b', session('b', { endedAt: NOW - 10 * DAY, startedAt: NOW - 10 * DAY - 1800_000, warmupStartedAt: 1000, warmupEndedAt: 301000, exercises: [sx('leg_press', 'Leg press', { feedback: { weight: 'heavy', effort: 'normal', volume: 'sets' }, pr: true }), sx('hack_squat', 'Hack', { feedback: { weight: 'right', effort: 'hard', volume: 'ok' } })] })),
      entity('session', 'zero', session('zero', { startedAt: NOW - 200 * DAY, endedAt: NOW - 200 * DAY })),
      entity('session', 'c', session('c', { status: 'discarded', endedAt: NOW - 1 * DAY, exercises: [sx('leg_ext', 'x', { feedback: { weight: 'light', effort: 'chill', volume: 'ok' }, pr: true })] })),
    ]);
    const m = (await s.call(s.r, 'get_muscle_report')).json as any[];
    const q = m.find((x) => x.muscle === 'Quads');
    expect(q).toMatchObject({ lastTrainedDaysAgo: 3, sets: 6, sessions: 3 });
    const m7 = (await s.call(s.r, 'get_muscle_report', { windowDays: 7 })).json as any[];
    expect(m7.find((x) => x.muscle === 'Quads')).toMatchObject({ sets: 2, sessions: 1 });
    const st = (await s.call(s.r, 'get_stats')).json;
    expect(st.completedSessions).toBe(3);
    expect(st.weeklyGoal).toBe(2);
    expect(st.targetMinutes).toBe(50);
    expect(st.avgDurationMin).toBe(45); // (60 + 30) / 2
    expect(st.medianWarmupMin).toBe(7.5); // median(600 s, 300 s) = 450 s
    expect(st.weeklyCounts).toHaveLength(12);
    expect(st.weeklyCounts[11]).toEqual({ weekStart: new Date(2026, 10, 16).toISOString(), count: 0 });
    expect(st.weeklyCounts[10]).toEqual({ weekStart: new Date(2026, 10, 9).toISOString(), count: 1 }); // 3 days ago = Sun 15 Nov
    expect(st.weeklyCounts[9]).toEqual({ weekStart: new Date(2026, 10, 2).toISOString(), count: 1 }); // 10 days ago = Sun 8 Nov
    expect((await s.call(s.r, 'get_stats', { weeks: 3 })).json.weeklyCounts).toHaveLength(3);
    expect(st.recentPRs).toEqual([
      { date: new Date(NOW - 3 * DAY).toISOString(), exercise: 'Back squat', topWeight: 100 },
      { date: new Date(NOW - 10 * DAY).toISOString(), exercise: 'Leg press', topWeight: 100 },
    ]);
    expect(st.feedbackTotals).toEqual({ light: 1, right: 1, heavy: 1, chill: 1, normal: 1, hard: 1, tooManyReps: 1, tooManySets: 1 });
    const empty = await setup();
    const t = await empty.mk('read');
    const es = (await empty.call(t, 'get_stats')).json;
    expect(es).toMatchObject({ completedSessions: 0, avgDurationMin: null, medianWarmupMin: null, recentPRs: [] });
    // PR list is capped at 15, newest first
    await s.sync(Array.from({ length: 20 }, (_, i) => entity('session', `pr${i}`, session(`pr${i}`, { endedAt: NOW - (20 + i) * DAY, exercises: [sx('leg_ext', 'Ext', { pr: true })] }), 9)));
    const prs = (await s.call(s.r, 'get_stats')).json.recentPRs;
    expect(prs).toHaveLength(15);
    const dates = prs.map((p: any) => p.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(prs.slice(0, 3).map((p: any) => p.exercise)).toEqual(['Back squat', 'Leg press', 'Ext']);
  });
  test('list_coach_plans and list_events', async () => {
    const s = await seeded();
    expect((await s.call(s.r, 'list_coach_plans')).json).toEqual([]);
    setSystemTime(new Date(NOW + 1000));
    const p1 = (await s.call(s.w, 'create_coach_plan', { title: 'one', exercises: [{ exerciseId: 'back_squat' }] })).json;
    setSystemTime(new Date(NOW + 2000));
    const p2 = (await s.call(s.w, 'create_coach_plan', { title: 'two', exercises: [{ exerciseId: 'back_squat' }] })).json;
    setSystemTime(new Date(NOW + 3000));
    await s.call(s.w, 'create_coach_plan', { title: 'three', exercises: [{ exerciseId: 'back_squat' }] });
    setSystemTime(new Date(NOW + 4000));
    await s.call(s.w, 'create_coach_plan', { title: 'four', exercises: [{ exerciseId: 'back_squat' }] });
    await s.call(s.w, 'cancel_coach_plan', { id: p1.id });
    const all = (await s.call(s.r, 'list_coach_plans')).json;
    expect(all.map((p: any) => p.title)).toEqual(['four', 'three', 'two', 'one']);
    const ov = (await s.call(s.r, 'get_overview')).json.pendingCoachPlans.map((p: any) => p.title).sort();
    expect(ov).toEqual(['four', 'three', 'two']); // cancelled plans are not pending
    expect((await s.call(s.r, 'list_coach_plans', { status: 'pending' })).json.map((p: any) => p.title)).toEqual(['four', 'three', 'two']);
    expect((await s.call(s.r, 'list_coach_plans', { status: 'cancelled' })).json.map((p: any) => p.id)).toEqual([p1.id]);
    expect((await s.call(s.r, 'list_coach_plans', { status: 'used' })).json).toEqual([]);
  });
  test('list_events: sinceDays window (default 14), kind filter, limit', async () => {
    const s = await seeded();
    const ev = (id: string, daysAgo: number, kind: string) => ({ id, at: NOW - daysAgo * DAY, kind });
    await s.j('/api/sync', { token: s.anon.token, body: { events: [ev('e1', 1, 'set_logged'), ev('e2', 13, 'swap'), ev('e3', 14, 'swap'), ev('e4', 15, 'swap'), ev('e5', 100, 'old')] } });
    const ids = async (a: object) => ((await s.call(s.r, 'list_events', a)).json as any[]).map((e) => e.id);
    expect(await ids({})).toEqual(['e1', 'e2', 'e3']); // newest first; the 14-day boundary is inclusive
    expect(await ids({ sinceDays: 1 })).toEqual(['e1']);
    expect(await ids({ sinceDays: 365 })).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(await ids({ sinceDays: 365, kind: 'swap' })).toEqual(['e2', 'e3', 'e4']);
    expect(await ids({ sinceDays: 365, limit: 2 })).toEqual(['e1', 'e2']);
    expect((await s.call(s.r, 'list_events', { kind: 'set_logged' })).json[0]).toEqual({ id: 'e1', at: NOW - DAY, kind: 'set_logged', sessionId: null, payload: null });
  });
  test('list_events tolerates a legacy row whose payload is unparseable', async () => {
    const s = await seeded();
    s.db.query('INSERT INTO events(user_id,id,at,kind,session_id,payload) VALUES(?,?,?,?,?,?)').run(s.anon.userId, 'legacy', NOW - 1000, 'k', null, '{"cut":"of');
    const r = await s.call(s.r, 'list_events');
    expect(r.isError).toBe(false);
    expect(r.json).toEqual([{ id: 'legacy', at: NOW - 1000, kind: 'k', sessionId: null, payload: null }]);
  });
  test('export_all', async () => {
    const s = await seeded();
    await s.call(s.w, 'set_exercise_pref', { exerciseId: 'back_squat', favorite: true });
    await s.call(s.w, 'set_next_prescription', { exerciseId: 'leg_ext', reps: 11 });
    await s.call(s.w, 'create_exercise', { name: 'Mine', primary: ['Core'], pattern: 'core' });
    await s.call(s.w, 'create_coach_plan', { title: 'P', exercises: [{ exerciseId: 'back_squat' }] });
    const x = (await s.call(s.r, 'export_all')).json;
    expect(Object.keys(x).sort()).toEqual(['areas', 'customExercises', 'gyms', 'plans', 'prefs', 'progress', 'sessions', 'settings']);
    expect(x.prefs).toHaveLength(1);
    expect(x.progress).toHaveLength(1);
    expect(x.customExercises).toHaveLength(1);
    expect(x.plans).toHaveLength(1);
    expect(x.gyms).toHaveLength(2);
    expect(x.areas).toHaveLength(2);
    expect(x.settings.name).toBe('Alex');
  });
});

describe('preview_next_session', () => {
  test('slot / area / gym resolution and output shape', async () => {
    const s = await seeded();
    const p = (await s.call(s.r, 'preview_next_session', {})).json;
    expect(p.slot).toBe(1);
    expect(p.area).toBe('Upper body');
    expect(p.gym).toBe('City'); // most recently visited
    expect(p.source).toBe('auto');
    expect(p.coachPlan).toBeNull();
    expect(p.exercises).toHaveLength(5);
    const e0 = p.exercises[0];
    expect(typeof e0.exerciseId).toBe('string');
    expect(typeof e0.name).toBe('string');
    expect(typeof e0.pinned).toBe('boolean');
    expect(e0.restSec).toBe(75);
    expect(p.exercises.every((e: any) => e.sets >= 1 && e.reps >= 1 && e.weight >= 0 && e.estMin > 0)).toBe(true);
    expect(p.estimatedMinutes).toBeCloseTo(8 + p.exercises.reduce((a: number, e: any) => a + e.estMin, 0), 5);
    expect(p.hiddenBecauseEquipment).toEqual([]);
    expect(p.topScores.length).toBeGreaterThan(0);
    expect(p.topScores.length).toBeLessThanOrEqual(15);
    expect(p.topScores[0]).toHaveProperty('reasons');
    const scores = p.topScores.map((x: any) => x.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
    expect(p.exercises.filter((e: any) => e.pinned).map((e: any) => e.exerciseId).sort()).toEqual(['bench_press', 'seated_row']);
    expect(p.topScores).toHaveLength(15); // upper pool is larger than 15
    // slot 2 -> lower, explicit area, explicit gym
    expect((await s.call(s.r, 'preview_next_session', { slot: 2 })).json.area).toBe('Lower body');
    const g2 = (await s.call(s.r, 'preview_next_session', { slot: 2, gymId: 'g2' })).json;
    expect(g2.gym).toBe('Home');
    expect(g2.hiddenBecauseEquipment).toContain('Back squat');
    expect((await s.call(s.r, 'preview_next_session', { slot: 1, areaId: 'lower' })).json.area).toBe('Lower body');
    expect((await s.call(s.r, 'preview_next_session', { areaId: 'ghost' })).text).toBe('Unknown areaId "ghost". Use list_areas.');
    expect((await s.call(s.r, 'preview_next_session', { gymId: 'gone' })).text).toBe('Unknown gymId "gone". Use list_gyms.');
    // slot 3 is the missing area: falls back to... unknown area id "ghost"
    expect((await s.call(s.r, 'preview_next_session', { slot: 3 })).isError).toBe(true);
    // excluded exercises and variants
    const ex = (await s.call(s.r, 'preview_next_session', { excludeExerciseIds: ['bench_press'] })).json;
    expect(ex.exercises.map((e: any) => e.exerciseId)).not.toContain('bench_press');
    const v0 = (await s.call(s.r, 'preview_next_session', { variant: 0 })).json.exercises.map((e: any) => e.exerciseId).join();
    const v7 = (await s.call(s.r, 'preview_next_session', { variant: 7 })).json.exercises.map((e: any) => e.exerciseId).join();
    expect(v0).toBe(p.exercises.map((e: any) => e.exerciseId).join());
    expect(v7).not.toBe(v0);
  });
  test('rotation fallbacks and the next slot after a session', async () => {
    const s = await setup();
    const w = await s.mk('write');
    await s.sync([entity('area', 'lower', lower), entity('settings', 'settings', { rotation: [] }), entity('gym', 'g1', { id: 'g1', name: 'Only', lat: null, lng: null, radiusM: 100, equipment: templateEquipment('full'), notes: {}, brokenSince: {}, createdAt: 1 })]);
    const p = (await s.call(w, 'preview_next_session', {})).json;
    expect(p.slot).toBe(1);
    expect(p.area).toBe('Lower body'); // first area when the rotation is empty
    expect(p.gym).toBe('Only');
    // the default gym is the most recently visited one, whatever the storage order
    const gs = await setup();
    const gt = await gs.mk('write');
    const mkGym = (id: string, last?: number) => entity('gym', id, { id, name: id, lat: null, lng: null, radiusM: 100, equipment: templateEquipment('full'), notes: {}, brokenSince: {}, createdAt: 1, ...(last ? { lastVisitedAt: last } : {}) });
    await gs.sync([entity('area', 'lower', lower), mkGym('a_old', NOW - 9 * DAY), mkGym('b_never'), mkGym('c_new', NOW - 1000), mkGym('d_mid', NOW - 3 * DAY)]);
    expect((await gs.call(gt, 'preview_next_session', {})).json.gym).toBe('c_new');
    const noGym = await setup();
    const t = await noGym.mk('write');
    await noGym.sync([entity('area', 'lower', lower)]);
    expect((await noGym.call(t, 'preview_next_session', {})).json.gym).toBeNull();
    expect((await noGym.call(t, 'preview_next_session', {})).json.hiddenBecauseEquipment.length).toBeGreaterThan(0);
    const s2 = await seeded();
    await s2.sync([entity('session', 'done', session('done', { slot: 1 }), 5)]);
    expect((await s2.call(s2.r, 'preview_next_session', {})).json.slot).toBe(2);
    await s2.call(s2.w, 'create_coach_plan', { title: 'Coach says', slot: 2, exercises: [{ exerciseId: 'leg_ext', sets: 2, reps: 15 }] });
    const c = (await s2.call(s2.r, 'preview_next_session', {})).json;
    expect(c.source).toBe('coach');
    expect(c.coachPlan.id).toMatch(/^plan_/);
    expect(c.coachPlan.title).toBe('Coach says');
    expect(c.exercises).toHaveLength(1);
    expect(c.exercises[0]).toMatchObject({ exerciseId: 'leg_ext', sets: 2, reps: 15, restSec: 75 });
    expect(c.estimatedMinutes).toBeCloseTo(8 + (2 * (45 + 75)) / 60, 1);
  });
});

describe('write tools: exercises', () => {
  const base = { name: 'Sissy', primary: ['Quads'], pattern: 'squat' };
  test('create_exercise defaults and persistence', async () => {
    const s = await seeded();
    const c = (await s.call(s.w, 'create_exercise', { ...base, name: '  Sissy squat  ' })).json.created;
    expect(c.id).toMatch(/^c_[0-9a-f]{8}$/);
    expect(c).toMatchObject({ name: 'Sissy squat', primary: ['Quads'], secondary: [], equipment: [], pattern: 'squat', difficulty: 2, tracking: 'weight_reps', weightStep: 2.5, repRange: [8, 12], defaultSets: 3, custom: true, perHand: false, prehab: false, tags: [], status: 'ready', relevance: 50 });
    const stored = s.data().exercises.find((e) => e.id === c.id)!;
    expect(stored).toMatchObject({ isCustom: true, name: 'Sissy squat', difficulty: 2 });
    expect(typeof stored.updatedAt).toBe('number');
    // non weight tracking defaults the step to 0; an explicit tracking weight_reps keeps 2.5; explicit step wins
    expect((await s.call(s.w, 'create_exercise', { ...base, tracking: 'reps' })).json.created.weightStep).toBe(0);
    expect((await s.call(s.w, 'create_exercise', { ...base, tracking: 'time' })).json.created.weightStep).toBe(0);
    expect((await s.call(s.w, 'create_exercise', { ...base, tracking: 'weight_reps' })).json.created.weightStep).toBe(2.5);
    expect((await s.call(s.w, 'create_exercise', { ...base, tracking: 'reps', weightStep: 5 })).json.created.weightStep).toBe(5);
    expect((await s.call(s.w, 'create_exercise', { ...base, weightStep: 0 })).json.created.weightStep).toBe(0);
    expect((await s.call(s.w, 'create_exercise', { ...base, difficulty: 3, repMin: 3, repMax: 6, defaultSets: 5, secondary: ['Core'], equipment: ['box'], cue: 'c' })).json.created).toMatchObject({ difficulty: 3, repRange: [3, 6], defaultSets: 5, secondary: ['Core'], equipment: ['box'] });
    // shows up in the library for later calls
    expect((await s.call(s.w, 'list_exercises', { query: 'sissy squat', includeScores: false })).json.total).toBeGreaterThanOrEqual(1);
  });
  test('create_exercise validation: exact messages and boundaries', async () => {
    const s = await seeded();
    const err = async (over: object) => { const r = await s.call(s.w, 'create_exercise', { ...base, ...over }); return r.isError ? r.text : 'OK'; };
    expect(await err({ name: '' })).toBe('name is required (max 80 chars).');
    expect(await err({ name: '   ' })).toBe('name is required (max 80 chars).');
    expect(await err({ name: 'n'.repeat(81) })).toBe('name is required (max 80 chars).');
    expect(await err({ name: 'n'.repeat(80) })).toBe('OK');
    expect(await err({ primary: [] })).toBe('primary must list at least one muscle.');
    expect(await err({ primary: 'Quads' })).toBe('primary must list at least one muscle.');
    expect(await err({ primary: ['Nope'] })).toMatch(/^Unknown muscle "Nope"\. Valid: Chest, Lats/);
    expect(await err({ secondary: ['Elbows'] })).toMatch(/^Unknown muscle "Elbows"/);
    expect(await err({ equipment: ['laser'] })).toBe('Unknown equipment id "laser". Use list_equipment_catalog.');
    expect(await err({ pattern: 'dance' })).toMatch(/^pattern must be one of push, pull, squat, hinge, lunge, carry, core, mobility$/);
    expect(await err({ difficulty: 0 })).toBe('difficulty must be 1, 2 or 3.');
    expect(await err({ difficulty: 4 })).toBe('difficulty must be 1, 2 or 3.');
    expect(await err({ difficulty: 1 })).toBe('OK');
    expect(await err({ difficulty: 3 })).toBe('OK');
    expect(await err({ tracking: 'laps' })).toBe('tracking must be weight_reps, reps or time.');
    expect(await err({ repMin: 0 })).toBe('repMin/repMax invalid (1 ≤ repMin ≤ repMax ≤ 200).');
    expect(await err({ repMin: 1, repMax: 1 })).toBe('OK');
    expect(await err({ repMin: 10, repMax: 9 })).toBe('repMin/repMax invalid (1 ≤ repMin ≤ repMax ≤ 200).');
    expect(await err({ repMin: 10, repMax: 10 })).toBe('OK');
    expect(await err({ repMin: 8, repMax: 201 })).toBe('repMin/repMax invalid (1 ≤ repMin ≤ repMax ≤ 200).');
    expect(await err({ repMin: 8, repMax: 200 })).toBe('OK');
    expect(await err({ defaultSets: 0 })).toBe('defaultSets must be 1–12.');
    expect(await err({ defaultSets: 13 })).toBe('defaultSets must be 1–12.');
    expect(await err({ defaultSets: 1 })).toBe('OK');
    expect(await err({ defaultSets: 12 })).toBe('OK');
    expect(await err({ weightStep: -0.5 })).toBe('weightStep must be 0–50.');
    expect(await err({ weightStep: 50.5 })).toBe('weightStep must be 0–50.');
    expect(await err({ weightStep: 50 })).toBe('OK');
    expect((await s.call(s.w, 'create_exercise', { pattern: 'squat', primary: ['Quads'] })).text).toBe('name is required (max 80 chars).');
    // nothing was stored by failed calls
    const before = s.data().exercises.length;
    await err({ name: '' });
    expect(s.data().exercises.length).toBe(before);
  });
  test('create_exercise: favorite/relevance create a pref; addToAreaIds appends once and validates the area', async () => {
    const s = await seeded();
    const a = (await s.call(s.w, 'create_exercise', { ...base, favorite: true, relevance: 77, addToAreaIds: ['lower', 'upper'] })).json.created;
    expect(a).toMatchObject({ favorite: true, relevance: 77, status: 'favorite' });
    expect(s.data().prefs[a.id]).toMatchObject({ favorite: true, relevance: 77 });
    expect(s.data().areas.find((x) => x.id === 'lower')!.poolExerciseIds.filter((x) => x === a.id)).toHaveLength(1);
    expect(s.data().areas.find((x) => x.id === 'upper')!.poolExerciseIds).toContain(a.id);
    const rel0 = (await s.call(s.w, 'create_exercise', { ...base, relevance: 0 })).json.created;
    expect(rel0.relevance).toBe(0);
    const fav0 = (await s.call(s.w, 'create_exercise', { ...base, favorite: false })).json.created;
    expect(s.data().prefs[fav0.id]).toBeDefined();
    const none = (await s.call(s.w, 'create_exercise', base)).json.created;
    expect(s.data().prefs[none.id]).toBeUndefined();
    const bad = await s.call(s.w, 'create_exercise', { ...base, addToAreaIds: ['ghost'] });
    expect(bad.text).toBe('Unknown areaId "ghost". Use list_areas.');
    expect((await s.call(s.w, 'create_exercise', { ...base, relevance: 101 })).text).toBe('relevance must be between 0 and 100.');
  });
  test('update_exercise: patch semantics, id immutable, isCustom flag, validation', async () => {
    const s = await seeded();
    const u = (await s.call(s.w, 'update_exercise', { exerciseId: 'back_squat', repMax: 10, tags: ['legs'], name: 'Barbell squat' })).json.updated;
    expect(u).toMatchObject({ id: 'back_squat', name: 'Barbell squat', repRange: [5, 10], tags: ['legs'], custom: false, primary: ['Quads', 'Glutes'] });
    expect(s.data().exercises.find((e) => e.id === 'back_squat')).toMatchObject({ isCustom: false, repMax: 10, name: 'Barbell squat' });
    // the override is what other tools see
    expect((await s.call(s.r, 'get_exercise', { exerciseId: 'back_squat' })).json.name).toBe('Barbell squat');
    const c = (await s.call(s.w, 'create_exercise', { name: 'Custom', primary: ['Core'], pattern: 'core' })).json.created;
    const uc = (await s.call(s.w, 'update_exercise', { exerciseId: c.id, difficulty: 3 })).json.updated;
    expect(uc).toMatchObject({ id: c.id, custom: true, difficulty: 3, name: 'Custom' });
    expect(s.data().exercises.find((e) => e.id === c.id)!.isCustom).toBe(true);
    const bad = await s.call(s.w, 'update_exercise', { exerciseId: 'back_squat', difficulty: 9 });
    expect(bad.text).toBe('difficulty must be 1, 2 or 3.');
    expect((await s.call(s.w, 'update_exercise', { exerciseId: 'back_squat', repMin: 11 })).text).toBe('repMin/repMax invalid (1 ≤ repMin ≤ repMax ≤ 200).');
    expect((await s.call(s.w, 'update_exercise', { exerciseId: 'zzz' })).text).toBe('Unknown exerciseId "zzz". Use list_exercises to find ids.');
    expect(s.data().exercises.find((e) => e.id === 'back_squat')!.difficulty).toBe(3);
    // the exerciseId argument itself is not written into the entity
    expect((s.data().exercises.find((e) => e.id === 'back_squat') as any).exerciseId).toBeUndefined();
  });
  test('archive_exercise and restore', async () => {
    const s = await seeded();
    expect((await s.call(s.w, 'archive_exercise', { exerciseId: 'leg_ext' })).json).toEqual({ exerciseId: 'leg_ext', archived: true });
    expect(s.data().exercises.find((e) => e.id === 'leg_ext')!.archived).toBe(true);
    expect((await s.call(s.w, 'archive_exercise', { exerciseId: 'leg_ext', restore: true })).json).toEqual({ exerciseId: 'leg_ext', archived: false });
    expect(s.data().exercises.find((e) => e.id === 'leg_ext')!.archived).toBe(false);
    expect((await s.call(s.w, 'archive_exercise', { exerciseId: 'zzz' })).isError).toBe(true);
  });
});

describe('write tools: preferences', () => {
  const pref = async (s: Awaited<ReturnType<typeof seeded>>, args: object) => s.call(s.w, 'set_exercise_pref', { exerciseId: 'back_squat', ...args });
  test('default pref shape and the returned summary', async () => {
    const s = await seeded();
    const r = (await pref(s, { favorite: true })).json;
    expect(r).toEqual({ exerciseId: 'back_squat', name: 'Back squat', status: 'favorite', favorite: true, avoid: false, banned: false, pausedUntil: null, pausedForever: false, pausedSessions: 0, relevance: 50, cooldownSessions: null, minDaysBetween: null, notes: null });
    expect(s.data().prefs.back_squat).toMatchObject({ exerciseId: 'back_squat', favorite: true, avoid: false, relevance: 50 });
  });
  test('favorite / avoid / banned flags (banned is an alias applied after avoid; false is respected)', async () => {
    const s = await seeded();
    expect((await pref(s, { avoid: true })).json).toMatchObject({ avoid: true, banned: true, status: 'banned' });
    expect((await pref(s, { avoid: false })).json).toMatchObject({ avoid: false, status: 'ready' });
    expect((await pref(s, { banned: true })).json).toMatchObject({ avoid: true });
    expect((await pref(s, { banned: false })).json).toMatchObject({ avoid: false });
    expect((await pref(s, { avoid: true, banned: false })).json.avoid).toBe(false);
    expect((await pref(s, { avoid: false, banned: true })).json.avoid).toBe(true);
    expect((await pref(s, { favorite: true })).json).toMatchObject({ favorite: true, avoid: true, status: 'banned' }); // untouched fields persist
    expect((await pref(s, { favorite: false })).json.favorite).toBe(false);
    expect((await pref(s, { favorite: 1 })).json.favorite).toBe(true);
    expect((await pref(s, { favorite: null })).json.favorite).toBe(true); // null = unchanged
  });
  test('pauseDays: 0 = until resumed, 1..365 = N days from now, others rejected; pauseSessions 0..20; resume clears', async () => {
    const s = await seeded();
    expect((await pref(s, { pauseDays: 0 })).json).toMatchObject({ pausedForever: true, pausedUntil: null, status: 'paused' });
    expect(s.data().prefs.back_squat.pausedUntil).toBe(PAUSE_FOREVER);
    expect((await pref(s, { pauseDays: 1 })).json).toMatchObject({ pausedForever: false, pausedUntil: new Date(NOW + DAY).toISOString(), status: 'paused' });
    expect((await pref(s, { pauseDays: 365 })).json.pausedUntil).toBe(new Date(NOW + 365 * DAY).toISOString());
    expect((await pref(s, { pauseDays: 7 })).json.pausedUntil).toBe(new Date(NOW + 7 * DAY).toISOString());
    expect((await pref(s, { pauseDays: 366 })).text).toBe('pauseDays must be between 1 and 365.');
    expect((await pref(s, { pauseDays: -1 })).text).toBe('pauseDays must be between 1 and 365.');
    expect((await pref(s, { pauseDays: 'x' })).text).toBe('pauseDays must be between 1 and 365.');
    expect((await pref(s, { pauseDays: null })).json.pausedUntil).toBe(new Date(NOW + 7 * DAY).toISOString()); // null = unchanged
    expect((await pref(s, { resume: true })).json).toMatchObject({ pausedUntil: null, pausedForever: false, pausedSessions: 0, status: 'ready' });
    expect(s.data().prefs.back_squat.pausedUntil).toBeUndefined();
    expect((await pref(s, { pauseSessions: 20 })).json).toMatchObject({ pausedSessions: 20, status: 'paused' });
    expect((await pref(s, { pauseSessions: 1 })).json.pausedSessions).toBe(1);
    expect((await pref(s, { pauseSessions: 0 })).json).toMatchObject({ pausedSessions: 0, status: 'ready' });
    expect((await pref(s, { pauseSessions: 21 })).text).toBe('pauseSessions must be between 0 and 20.');
    expect((await pref(s, { pauseSessions: -1 })).text).toBe('pauseSessions must be between 0 and 20.');
    // resume clears sessions too; resume + a new pause in the same call applies the new pause
    await pref(s, { pauseSessions: 3, pauseDays: 2 });
    const both = (await pref(s, { resume: true, pauseDays: 4 })).json;
    expect(both).toMatchObject({ pausedSessions: 0, pausedUntil: new Date(NOW + 4 * DAY).toISOString() });
    expect((await pref(s, { resume: false, pauseDays: 5 })).json.pausedUntil).toBe(new Date(NOW + 5 * DAY).toISOString());
    expect((await pref(s, { resume: false })).json.pausedUntil).toBe(new Date(NOW + 5 * DAY).toISOString()); // resume:false changes nothing
  });
  test('relevance, cooldownSessions, minDaysBetween, notes: ranges, null clears, undefined keeps', async () => {
    const s = await seeded();
    expect((await pref(s, { relevance: 0 })).json.relevance).toBe(0);
    expect((await pref(s, { relevance: 100 })).json.relevance).toBe(100);
    expect((await pref(s, { relevance: 100.5 })).text).toBe('relevance must be between 0 and 100.');
    expect((await pref(s, { relevance: -1 })).text).toBe('relevance must be between 0 and 100.');
    expect((await pref(s, { relevance: 'abc' })).text).toBe('relevance must be between 0 and 100.');
    expect((await pref(s, { favorite: true })).json.relevance).toBe(100);
    expect((await pref(s, { cooldownSessions: 0 })).json.cooldownSessions).toBe(0);
    expect((await pref(s, { cooldownSessions: 20 })).json.cooldownSessions).toBe(20);
    expect((await pref(s, { cooldownSessions: 21 })).text).toBe('cooldownSessions must be between 0 and 20.');
    expect((await pref(s, { cooldownSessions: -1 })).text).toBe('cooldownSessions must be between 0 and 20.');
    expect((await pref(s, { relevance: 10 })).json.cooldownSessions).toBe(20); // undefined keeps
    expect((await pref(s, { cooldownSessions: null })).json.cooldownSessions).toBeNull();
    expect((await pref(s, { minDaysBetween: 0 })).json.minDaysBetween).toBe(0);
    expect((await pref(s, { minDaysBetween: 60 })).json.minDaysBetween).toBe(60);
    expect((await pref(s, { minDaysBetween: 61 })).text).toBe('minDaysBetween must be between 0 and 60.');
    expect((await pref(s, { minDaysBetween: -1 })).text).toBe('minDaysBetween must be between 0 and 60.');
    expect((await pref(s, { minDaysBetween: null })).json.minDaysBetween).toBeNull();
    expect((await pref(s, { notes: 'n'.repeat(1500) })).json.notes).toBe('n'.repeat(1000));
    expect((await pref(s, { notes: 'x'.repeat(1000) })).json.notes).toBe('x'.repeat(1000));
    expect((await pref(s, { notes: 12 })).json.notes).toBe('12');
    expect((await pref(s, { notes: '' })).json.notes).toBe('');
    expect((await pref(s, { notes: null })).json.notes).toBeNull();
    expect(s.data().prefs.back_squat.notes).toBeUndefined();
    expect((await s.call(s.w, 'set_exercise_pref', {})).text).toBe('Unknown exerciseId "undefined". Use list_exercises to find ids.');
  });
  test('bulk_set_exercise_prefs: max 150 items, validated before anything is written', async () => {
    const s = await seeded();
    const items = (n: number) => Array.from({ length: n }, () => ({ exerciseId: 'back_squat', relevance: 60 }));
    expect((await s.call(s.w, 'bulk_set_exercise_prefs', { items: items(151) })).text).toBe('items must be an array of at most 150.');
    expect((await s.call(s.w, 'bulk_set_exercise_prefs', { items: 'x' })).text).toBe('items must be an array of at most 150.');
    expect((await s.call(s.w, 'bulk_set_exercise_prefs', {})).text).toBe('items must be an array of at most 150.');
    expect(s.data().prefs.back_squat).toBeUndefined();
    const ok = (await s.call(s.w, 'bulk_set_exercise_prefs', { items: items(150) })).json;
    expect(ok.updated).toHaveLength(150);
    const s2 = await seeded();
    const bad = await s2.call(s2.w, 'bulk_set_exercise_prefs', { items: [{ exerciseId: 'back_squat', relevance: 10 }, { exerciseId: 'zzz' }] });
    expect(bad.text).toBe('Unknown exerciseId "zzz". Use list_exercises to find ids.');
    expect(s2.data().prefs.back_squat).toBeUndefined(); // validate-all-first: first item was not applied
    const two = (await s2.call(s2.w, 'bulk_set_exercise_prefs', { items: [{ exerciseId: 'back_squat', favorite: true }, { exerciseId: 'leg_ext', relevance: 5, avoid: true }] })).json.updated;
    expect(two.map((x: any) => [x.exerciseId, x.status, x.relevance])).toEqual([['back_squat', 'favorite', 50], ['leg_ext', 'banned', 5]]);
  });
  test('set_next_prescription', async () => {
    const s = await seeded();
    const r = (await s.call(s.w, 'set_next_prescription', { exerciseId: 'leg_ext' })).json;
    expect(r).toEqual({ exerciseId: 'leg_ext', name: 'Leg extension', weight: 0, reps: 10, sets: 3 }); // defaults: weight 0, repMin, defaultSets
    expect(s.data().progress.leg_ext).toMatchObject({ exerciseId: 'leg_ext', weight: 0, reps: 10, sets: 3 });
    expect((await s.call(s.w, 'set_next_prescription', { exerciseId: 'leg_ext', weight: 45 })).json).toMatchObject({ weight: 45, reps: 10, sets: 3 });
    expect((await s.call(s.w, 'set_next_prescription', { exerciseId: 'leg_ext', reps: 12, sets: 4 })).json).toMatchObject({ weight: 45, reps: 12, sets: 4 });
    expect((await s.call(s.w, 'set_next_prescription', { exerciseId: 'leg_ext', weight: 0 })).json.weight).toBe(0); // 0 is a real value
    expect((await s.call(s.w, 'set_next_prescription', { exerciseId: 'zzz' })).isError).toBe(true);
    expect(s.data().progress.leg_ext.weight).toBe(0);
    expect(s.data().progress.leg_ext.reps).toBe(12);
  });
});

describe('write tools: areas and rotation', () => {
  test('create_area: defaults, truncation, validation, rotation', async () => {
    const s = await seeded();
    const a = (await s.call(s.w, 'create_area', { name: 'Arms' })).json;
    expect(a).toMatchObject({ name: 'Arms', focusMuscles: [], exercisesPerSession: 5, mode: 'auto', pinnedExerciseIds: [], poolExerciseIds: [] });
    expect(a.id).toMatch(/^area_[0-9a-f]{8}$/);
    expect(s.data().areas.find((x) => x.id === a.id)).toMatchObject({ name: 'Arms' });
    expect(s.data().settings.rotation).toEqual(['upper', 'lower', 'ghost']);
    const full = (await s.call(s.w, 'create_area', { name: 'n'.repeat(80), desc: 'd', focusMuscles: ['Biceps'], exercisesPerSession: 3, mode: 'fixed', pinnedExerciseIds: ['db_curl'], poolExerciseIds: ['db_curl', 'hammer_curl'], addToRotation: true })).json;
    expect(full).toMatchObject({ name: 'n'.repeat(60), desc: 'd', focusMuscles: ['Biceps'], exercisesPerSession: 3, mode: 'fixed', pinnedExerciseIds: ['db_curl'], poolExerciseIds: ['db_curl', 'hammer_curl'] });
    expect(s.data().settings.rotation).toEqual(['upper', 'lower', 'ghost', full.id]);
    expect((await s.call(s.w, 'create_area', { name: 'X', pinnedExerciseIds: ['zzz'] })).text).toBe('Unknown exerciseId "zzz". Use list_exercises to find ids.');
    expect((await s.call(s.w, 'create_area', { name: 'X', poolExerciseIds: ['zzz'] })).isError).toBe(true);
    expect((await s.call(s.w, 'create_area', { name: 'Y', addToRotation: false })).isError).toBe(false);
    expect(s.data().settings.rotation).toHaveLength(4);
  });
  test('update_area: replace, add/remove, pin/unpin invariants', async () => {
    const s = await seeded();
    const mkArea = async () => (await s.call(s.w, 'create_area', { name: 'T', poolExerciseIds: ['db_curl', 'hammer_curl', 'ez_curl'], pinnedExerciseIds: ['db_curl'], exercisesPerSession: 4, focusMuscles: ['Biceps'], desc: 'old' })).json.id as string;
    const id = await mkArea();
    const up = async (args: object) => (await s.call(s.w, 'update_area', { areaId: id, ...args }));
    expect((await up({ name: 'Renamed', desc: 'new', exercisesPerSession: 6, mode: 'fixed', focusMuscles: ['Triceps'] })).json).toMatchObject({ id, name: 'Renamed', desc: 'new', exercisesPerSession: 6, mode: 'fixed', focusMuscles: ['Triceps'], poolExerciseIds: ['db_curl', 'hammer_curl', 'ez_curl'], pinnedExerciseIds: ['db_curl'] });
    expect((await up({ addToPool: ['cable_curl', 'db_curl'] })).json.poolExerciseIds).toEqual(['db_curl', 'hammer_curl', 'ez_curl', 'cable_curl']);
    expect((await up({ removeFromPool: ['hammer_curl'] })).json.poolExerciseIds).toEqual(['db_curl', 'ez_curl', 'cable_curl']);
    expect((await up({ pin: ['ez_curl'] })).json).toMatchObject({ pinnedExerciseIds: ['db_curl', 'ez_curl'] });
    expect((await up({ pin: ['shrug'] })).json).toMatchObject({ pinnedExerciseIds: ['db_curl', 'ez_curl', 'shrug'], poolExerciseIds: ['db_curl', 'ez_curl', 'cable_curl', 'shrug'] }); // pin adds to the pool
    expect((await up({ unpin: ['db_curl'] })).json.pinnedExerciseIds).toEqual(['ez_curl', 'shrug']);
    expect((await up({ removeFromPool: ['ez_curl'] })).json).toMatchObject({ pinnedExerciseIds: ['shrug'], poolExerciseIds: ['db_curl', 'cable_curl', 'shrug'] }); // pinned must stay in the pool
    expect((await up({ poolExerciseIds: ['db_curl'], pinnedExerciseIds: ['db_curl', 'shrug'] })).json).toMatchObject({ poolExerciseIds: ['db_curl'], pinnedExerciseIds: ['db_curl'] });
    expect((await up({ poolExerciseIds: [] })).json).toMatchObject({ poolExerciseIds: [], pinnedExerciseIds: [] });
    expect((await up({})).json.name).toBe('Renamed');
    expect((await up({ exercisesPerSession: 2 })).json.exercisesPerSession).toBe(2);
    expect((await up({ pin: ['zzz'] })).text).toBe('Unknown exerciseId "zzz". Use list_exercises to find ids.');
    expect((await up({ addToPool: ['zzz'] })).isError).toBe(true);
    expect((await up({ poolExerciseIds: ['zzz'] })).isError).toBe(true);
    expect((await up({ pinnedExerciseIds: ['zzz'] })).isError).toBe(true);
    expect((await s.call(s.w, 'update_area', { areaId: 'ghost' })).text).toBe('Unknown areaId "ghost". Use list_areas.');
    expect(s.data().areas.find((x) => x.id === id)!.exercisesPerSession).toBe(2);
  });
  test('delete_area removes it from the rotation; set_rotation validation', async () => {
    const s = await seeded();
    expect((await s.call(s.w, 'delete_area', { areaId: 'lower' })).json).toEqual({ deleted: 'lower' });
    const pull = (await s.j('/api/sync', { token: s.anon.token, body: { cursor: 0, changes: [] } })).body.changes;
    expect(pull.find((c: any) => c.type === 'area' && c.id === 'lower')).toMatchObject({ deleted: true });
    expect(pull.find((c: any) => c.type === 'area' && c.id === 'upper')).toMatchObject({ deleted: false });
    expect(s.data().areas.map((a) => a.id)).toEqual(['upper']);
    expect(s.data().settings.rotation).toEqual(['upper', 'ghost']);
    expect((await s.call(s.w, 'delete_area', { areaId: 'lower' })).text).toBe('Unknown areaId "lower". Use list_areas.');
    const s2 = await seeded();
    const rot = async (areaIds: unknown) => s2.call(s2.w, 'set_rotation', { areaIds });
    expect((await rot(['lower', 'upper', 'lower'])).json).toEqual({ rotation: ['lower', 'upper', 'lower'] });
    expect(s2.data().settings.rotation).toEqual(['lower', 'upper', 'lower']);
    expect((await rot([])).text).toBe('areaIds must have 1–14 entries.');
    expect((await rot('lower')).text).toBe('areaIds must have 1–14 entries.');
    expect((await rot(Array(15).fill('lower'))).text).toBe('areaIds must have 1–14 entries.');
    expect((await rot(Array(14).fill('lower'))).json.rotation).toHaveLength(14);
    expect((await rot(['lower'])).json.rotation).toEqual(['lower']);
    expect((await rot(['lower', 'ghost'])).text).toBe('Unknown areaId "ghost". Use list_areas.');
    expect(s2.data().settings.rotation).toEqual(['lower']);
  });
});

describe('write tools: settings', () => {
  test('scalar settings: ranges, booleans, profileNotes', async () => {
    const s = await seeded();
    const up = (args: object) => s.call(s.w, 'update_settings', args);
    const ok = (await up({ weeklyGoal: 7, targetMinutes: 180, warmupTargetMinutes: 0, restSec: 600 })).json;
    expect(ok).toMatchObject({ weeklyGoal: 7, targetMinutes: 180, warmupTargetMinutes: 0, restSec: 600, profileNotes: 'knee' });
    expect(Object.keys(ok).sort()).toEqual(['planner', 'profileNotes', 'restSec', 'targetMinutes', 'warmupTargetMinutes', 'weeklyGoal']);
    expect((await up({ weeklyGoal: 1, targetMinutes: 20, warmupTargetMinutes: 40, restSec: 15 })).json).toMatchObject({ weeklyGoal: 1, targetMinutes: 20, warmupTargetMinutes: 40, restSec: 15 });
    const bad: [string, number][] = [['weeklyGoal', 0], ['weeklyGoal', 8], ['targetMinutes', 19], ['targetMinutes', 181], ['warmupTargetMinutes', -1], ['warmupTargetMinutes', 41], ['restSec', 14], ['restSec', 601]];
    const range: Record<string, [number, number]> = { weeklyGoal: [1, 7], targetMinutes: [20, 180], warmupTargetMinutes: [0, 40], restSec: [15, 600] };
    for (const [k, v] of bad) expect([k, (await up({ [k]: v })).text]).toEqual([k, `${k} must be between ${range[k][0]} and ${range[k][1]}.`]);
    expect((await up({ weeklyGoal: 'abc' })).text).toBe('weeklyGoal must be between 1 and 7.');
    expect(s.data().settings).toMatchObject({ weeklyGoal: 1, targetMinutes: 20, fitToTime: true, suggestSwaps: true });
    await up({ fitToTime: false, suggestSwaps: false });
    expect(s.data().settings).toMatchObject({ fitToTime: false, suggestSwaps: false });
    await up({ fitToTime: 1, suggestSwaps: 'yes' });
    expect(s.data().settings).toMatchObject({ fitToTime: true, suggestSwaps: true });
    await up({});
    expect(s.data().settings).toMatchObject({ fitToTime: true, suggestSwaps: true, name: 'Alex', rotation: ['upper', 'lower', 'ghost'] });
    expect((await up({ profileNotes: 'p'.repeat(6000) })).json.profileNotes).toBe('p'.repeat(5000));
    expect((await up({ profileNotes: 'p'.repeat(5000) })).json.profileNotes).toBe('p'.repeat(5000));
    expect((await up({ profileNotes: '' })).json.profileNotes).toBe('');
    expect((await up({ profileNotes: 5 })).json.profileNotes).toBe('5');
    expect((await up({ weeklyGoal: null })).json.weeklyGoal).toBe(1);
  });
  test('planner knobs: per-key ranges, unknown keys, partial updates', async () => {
    const s = await seeded();
    const up = (planner: object) => s.call(s.w, 'update_settings', { planner });
    const ranges: Record<string, [number, number]> = {
      wRelevance: [0, 5], wRecency: [0, 5], wFrequency: [0, 5], wCoverage: [0, 5], wVariety: [0, 5], wFavorite: [0, 5], cooldownSessions: [0, 10],
      minDaysBetween: [0, 30], freshDays: [1, 90], windowDays: [7, 180], muscleOverdueDays: [2, 60], jitter: [0, 2],
    };
    for (const [k, [lo, hi]] of Object.entries(ranges)) {
      expect([k, (await up({ [k]: lo })).json.planner[k]]).toEqual([k, lo]);
      expect([k, (await up({ [k]: hi })).json.planner[k]]).toEqual([k, hi]);
      const below = lo === 0 ? -0.1 : lo - 1;
      expect([k, (await up({ [k]: below })).text]).toEqual([k, `planner.${k} must be between ${lo} and ${hi}.`]);
      expect([k, (await up({ [k]: hi + 1 })).text]).toEqual([k, `planner.${k} must be between ${lo} and ${hi}.`]);
    }
    expect((await up({ bogus: 1 })).text).toBe('Unknown planner key "bogus".');
    expect((await up({ wRecency: 'x' })).text).toBe('planner.wRecency must be between 0 and 5.');
    const r = (await up({ wVariety: 2.5, cooldownSessions: 3 })).json.planner;
    expect(r).toMatchObject({ wVariety: 2.5, cooldownSessions: 3, wRecency: 5 }); // wRecency was left at 5 by the loop above
    // a failing key leaves earlier keys of the same call unsaved
    const s2 = await seeded();
    expect((await s2.call(s2.w, 'update_settings', { weeklyGoal: 3, planner: { wVariety: 2, jitter: 99 } })).isError).toBe(true);
    expect(s2.data().settings.weeklyGoal).toBe(2);
    expect(s2.data().settings.planner.wVariety).toBe(0.7);
    // does not mutate the planner defaults that get_settings reports
    await s2.call(s2.w, 'update_settings', { planner: { wVariety: 3 } });
    expect((await s2.call(s2.r, 'get_settings')).json.plannerDefaults.wVariety).toBe(0.7);
    expect((await s2.call(s2.r, 'get_settings')).json.planner.wVariety).toBe(3);
  });
  test('reset_planner', async () => {
    const s = await seeded();
    await s.call(s.w, 'update_settings', { planner: { wVariety: 3, jitter: 1 } });
    const r = (await s.call(s.w, 'reset_planner')).json;
    expect(r.planner.wVariety).toBe(0.7);
    expect(s.data().settings.planner).toEqual(r.planner);
    expect(s.data().settings.planner.jitter).toBe(0.2);
    expect(s.data().settings.name).toBe('Alex');
  });
});

describe('write tools: gyms and plans', () => {
  test('update_gym_equipment', async () => {
    const s = await seeded();
    const r = (await s.call(s.w, 'update_gym_equipment', { gymId: 'g2', set: { dumbbells: 'none', box: 'ok', leg_press: 'ok', mat: 'ok', bands: 'broken' } })).json;
    expect(r).toEqual({ gymId: 'g2', ok: 3, broken: 1 });
    expect(s.data().gyms.find((g) => g.id === 'g2')!.equipment).toEqual({ leg_press: 'ok', box: 'ok', mat: 'ok', bands: 'broken' });
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'g2', set: {} })).json).toEqual({ gymId: 'g2', ok: 3, broken: 1 });
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'g2', set: { laser: 'ok' } })).text).toBe('Unknown equipment id "laser".');
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'g2', set: { box: 'fine' } })).text).toBe('status must be ok, broken or none.');
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'g2', set: { box: null } })).text).toBe('status must be ok, broken or none.');
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'gone', set: {} })).text).toBe('Unknown gymId "gone". Use list_gyms.');
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'nope', set: {} })).isError).toBe(true);
    expect((await s.call(s.w, 'update_gym_equipment', { gymId: 'g2' })).json).toEqual({ gymId: 'g2', ok: 3, broken: 1 });
    // the other gym is untouched
    expect(Object.keys(s.data().gyms.find((g) => g.id === 'g1')!.equipment).length).toBe(EQUIPMENT.length);
    // equipment of one gym only
    expect(s.data().gyms.find((g) => g.id === 'g2')!.notes).toEqual({ leg_press: 'wobbly' });
  });
  test('create_coach_plan: limits, validation, persisted fields', async () => {
    const s = await seeded();
    const ex = (n: number) => Array.from({ length: n }, () => ({ exerciseId: 'back_squat' }));
    const mk = (args: object) => s.call(s.w, 'create_coach_plan', { title: 'T', exercises: ex(1), ...args });
    const p = (await mk({ title: 't'.repeat(150), note: 'n'.repeat(1500), slot: 2, areaId: 'lower', exercises: [{ exerciseId: 'back_squat', sets: 5, reps: 3, weight: 100, restSec: 120, note: 'x' }] })).json;
    expect(p).toMatchObject({ title: 't'.repeat(100), note: 'n'.repeat(1000), slot: 2, areaId: 'lower', status: 'pending', createdBy: 'mcp', createdAt: NOW, exercises: [{ exerciseId: 'back_squat', sets: 5, reps: 3, weight: 100, restSec: 120, note: 'x' }] });
    expect(p.id).toMatch(/^plan_[0-9a-f]{8}$/);
    expect(s.data().plans[0]).toMatchObject({ id: p.id, status: 'pending', title: 't'.repeat(100) });
    const bare = (await mk({})).json;
    expect(bare.note).toBeUndefined();
    expect(bare.slot).toBeUndefined();
    expect(bare.areaId).toBeUndefined();
    expect((await mk({ exercises: [] })).text).toBe('exercises must have 1–14 entries.');
    expect((await mk({ exercises: 'x' })).text).toBe('exercises must have 1–14 entries.');
    expect((await mk({ exercises: ex(15) })).text).toBe('exercises must have 1–14 entries.');
    expect((await mk({ exercises: ex(14) })).json.exercises).toHaveLength(14);
    expect((await mk({ exercises: [{ exerciseId: 'back_squat' }, { exerciseId: 'zzz' }] })).text).toBe('Unknown exerciseId "zzz". Use list_exercises to find ids.');
    expect((await mk({ areaId: 'ghost' })).text).toBe('Unknown areaId "ghost". Use list_areas.');
    expect((await mk({ areaId: 'lower' })).isError).toBe(false);
    expect(s.data().plans).toHaveLength(4);
  });
  test('cancel_coach_plan and add_session_note', async () => {
    const s = await seeded();
    const p = (await s.call(s.w, 'create_coach_plan', { title: 'T', exercises: [{ exerciseId: 'back_squat' }] })).json;
    expect((await s.call(s.w, 'cancel_coach_plan', { id: p.id })).json).toEqual({ id: p.id, status: 'cancelled' });
    expect(s.data().plans[0]).toMatchObject({ id: p.id, status: 'cancelled', title: 'T' });
    expect((await s.call(s.w, 'cancel_coach_plan', { id: 'zzz' })).text).toBe('Plan not found.');
    await s.sync([entity('session', 'sess', session('sess'), 3)]);
    const long = 'n'.repeat(2500);
    const r = (await s.call(s.w, 'add_session_note', { sessionId: 'sess', note: long })).json;
    expect(r).toEqual({ sessionId: 'sess', note: long }); // the echo is the original text
    expect(s.data().sessions.find((x) => x.id === 'sess')!.note).toBe('n'.repeat(2000));
    expect((await s.call(s.w, 'add_session_note', { sessionId: 'sess', note: 'short' })).json.note).toBe('short');
    expect(s.data().sessions.find((x) => x.id === 'sess')!.note).toBe('short');
    expect(s.data().sessions.find((x) => x.id === 'sess')!.status).toBe('completed');
    expect((await s.call(s.w, 'add_session_note', { sessionId: 'zzz', note: 'x' })).text).toBe('Session not found.');
  });
  test('every write tool is refused for read-only tokens and leaves data untouched', async () => {
    const s = await seeded();
    const before = JSON.stringify(s.data());
    for (const t of TOOLS.filter((x) => x.write)) {
      const r = await s.call(s.r, t.name, {});
      expect([t.name, r.isError, r.text.startsWith('This token is read-only')]).toEqual([t.name, true, true]);
    }
    expect(JSON.stringify(s.data())).toBe(before);
    expect(TOOLS.filter((x) => x.write).map((x) => x.name)).toEqual([
      'create_exercise', 'update_exercise', 'archive_exercise', 'set_exercise_pref', 'set_exercise_content', 'add_exercise_media', 'remove_exercise_media', 'reset_exercise_content', 'bulk_set_exercise_prefs', 'set_next_prescription', 'create_area', 'update_area',
      'delete_area', 'set_rotation', 'update_settings', 'reset_planner', 'use_streak_freeze', 'undo_streak_freeze', 'update_gym_equipment', 'create_coach_plan', 'cancel_coach_plan', 'add_session_note',
    ]);
  });
});


describe('built-in No equipment location (gymId "none")', () => {
  test('preview_next_session at none plans bodyweight versions of the same area; unknown ids still fail', async () => {
    const s = await seeded();
    const gymPlan = (await s.call(s.r, 'preview_next_session', { areaId: 'lower', gymId: 'g1' })).json;
    const home = (await s.call(s.r, 'preview_next_session', { areaId: 'lower', gymId: 'none' })).json;
    expect(home.gym).toBe('No equipment');
    expect(home.area).toBe(gymPlan.area);
    expect(home.exercises.length).toBeGreaterThanOrEqual(4);
    expect(home.exercises.every((e: any) => e.weight === 0)).toBe(true);
    expect(home.hiddenBecauseEquipment).toEqual([]);
    const lib = (await s.call(s.r, 'list_exercises', { includeScores: false, limit: 300 })).json.exercises as any[];
    for (const e of home.exercises) expect(lib.find((x) => x.id === e.exerciseId).equipment.every((q: string) => q === 'mat')).toBe(true);
    expect((await s.call(s.r, 'preview_next_session', { gymId: 'nope' })).text).toBe('Unknown gymId "nope". Use list_gyms.');
  });
  test('list_exercises availableAtGymId none = bodyweight only; overview counts them; sessions expose gym + gymId', async () => {
    const s = await seeded();
    const names = (await s.call(s.r, 'list_exercises', { availableAtGymId: 'none', includeScores: false, limit: 300 })).json.exercises as any[];
    expect(names.length).toBeGreaterThanOrEqual(21);
    expect(names.every((e) => e.equipment.every((q: string) => q === 'mat'))).toBe(true);
    expect(names.map((e) => e.id)).toContain('tempo_squat');
    expect(names.find((e) => e.id === 'pushup').harderVariation).toBe('diamond_pushup');
    const ov = (await s.call(s.r, 'get_overview')).json;
    expect(ov.noEquipment).toEqual({ gymId: 'none', name: 'No equipment', bodyweightExercises: names.length });
    await s.sync([entity('session', 'h1', session('h1', { gymId: 'none', gymName: 'No equipment', startedAt: NOW - 3600_000, endedAt: NOW - 1800_000, areaId: 'lower', areaName: 'Lower body' }), 5)]);
    const ls = (await s.call(s.r, 'list_sessions', { limit: 1 })).json.sessions[0];
    expect(ls).toMatchObject({ id: 'h1', gym: 'No equipment', gymId: 'none' });
    expect((await s.call(s.r, 'get_session', { id: 'h1' })).json).toMatchObject({ gymId: 'none', gymName: 'No equipment' });
  });
  test('the built-in location is not a stored gym: not listed, cannot be edited', async () => {
    const s = await seeded();
    expect((await s.call(s.r, 'list_gyms')).json.map((g: any) => g.id)).toEqual(['g1', 'g2']);
    const r = await s.call(s.w, 'update_gym_equipment', { gymId: 'none', set: { dumbbells: 'ok' } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('built-in');
    expect(s.data().gyms.map((g) => g.id)).not.toContain('none');
    const d = TOOLS.find((t) => t.name === 'list_gyms')!.description;
    expect(d).toContain('"none"');
  });
});
