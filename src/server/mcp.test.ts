import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { openDb } from './db';
import { buildApi } from './api';
import { buildMcp } from './mcp';
import { areaFromTemplate, AREA_TEMPLATES } from '../shared/exercises';
import { templateEquipment } from '../shared/catalog';

async function setup() {
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
  // seed: areas, gym, rotation via normal sync
  const lower = areaFromTemplate(AREA_TEMPLATES[1], 'lower');
  const upper = areaFromTemplate(AREA_TEMPLATES[0], 'upper');
  await j('/api/sync', { token: session, body: { changes: [
    { type: 'area', id: 'lower', updatedAt: 1, data: lower }, { type: 'area', id: 'upper', updatedAt: 1, data: upper },
    { type: 'gym', id: 'g1', updatedAt: 1, data: { id: 'g1', name: 'City', lat: 1, lng: 1, radiusM: 150, equipment: templateEquipment('full'), notes: {}, brokenSince: {}, createdAt: 1 } },
    { type: 'settings', id: 'settings', updatedAt: 1, data: { name: 'Alex', weeklyGoal: 4, rotation: ['upper', 'lower'] } },
  ] } });
  let rid = 0;
  const rpc = (token: string, method: string, params?: unknown) => j('/mcp', { token, body: { jsonrpc: '2.0', id: ++rid, method, params } });
  const call = async (token: string, name: string, args: unknown = {}) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    const c = r.body.result.content[0].text as string;
    return { isError: !!r.body.result.isError, text: c, json: r.body.result.isError ? null : JSON.parse(c) };
  };
  return { j, session, mk, rpc, call, db };
}

describe('mcp', () => {
  test('rejects missing/bad/session tokens', async () => {
    const { j, session } = await setup();
    expect((await j('/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(401);
    expect((await j('/mcp', { token: 'rep_nope', body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(401);
    expect((await j('/mcp', { token: session, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(401); // app session token is not an API token
  });

  test('initialize + tools/list; read token hides write tools', async () => {
    const { mk, rpc } = await setup();
    const w = await mk('write'), r = await mk('read');
    const init = await rpc(w, 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.body.result.serverInfo.name).toBe('rep-gym-tracker');
    const lw = (await rpc(w, 'tools/list')).body.result.tools.map((t: any) => t.name);
    const lr = (await rpc(r, 'tools/list')).body.result.tools.map((t: any) => t.name);
    expect(lw).toContain('set_exercise_pref');
    expect(lr).not.toContain('set_exercise_pref');
    expect(lr).toContain('get_overview');
  });

  test('read token cannot write even by calling directly', async () => {
    const { mk, call } = await setup();
    const r = await call(await mk('read'), 'set_exercise_pref', { exerciseId: 'back_squat', favorite: true });
    expect(r.isError).toBe(true);
  });

  test('overview reads synced data', async () => {
    const { mk, call } = await setup();
    const o = (await call(await mk('read'), 'get_overview')).json;
    expect(o.athlete).toBe('Alex');
    expect(o.rotation.map((x: any) => x.area)).toEqual(['Upper body', 'Lower body']);
    expect(o.nextArea).toBe('Upper body');
  });

  test('prefs: favorite/avoid/relevance change scores and persist to sync stream', async () => {
    const { mk, call, j, session } = await setup();
    const t = await mk('write');
    const before = (await call(t, 'get_exercise', { exerciseId: 'goblet_squat', areaId: 'lower' })).json.score;
    await call(t, 'set_exercise_pref', { exerciseId: 'goblet_squat', favorite: true, relevance: 95 });
    const after = (await call(t, 'get_exercise', { exerciseId: 'goblet_squat', areaId: 'lower' })).json;
    expect(after.score).toBeGreaterThan(before);
    expect(after.favorite).toBe(true);
    // app pulls it
    const pull = (await j('/api/sync', { token: session, body: { cursor: 0, changes: [] } })).body;
    const pref = pull.changes.find((c: any) => c.type === 'pref' && c.id === 'goblet_squat');
    expect(pref.data.relevance).toBe(95);
    // bad input
    expect((await call(t, 'set_exercise_pref', { exerciseId: 'nope' })).isError).toBe(true);
    expect((await call(t, 'set_exercise_pref', { exerciseId: 'goblet_squat', relevance: 500 })).isError).toBe(true);
  });

  test('create/update exercise, add to area pool, validation, override built-in', async () => {
    const { mk, call } = await setup();
    const t = await mk('write');
    const created = (await call(t, 'create_exercise', { name: 'Sissy squat', primary: ['Quads'], pattern: 'squat', equipment: ['box'], favorite: true, addToAreaIds: ['lower'] })).json.created;
    expect(created.favorite).toBe(true);
    expect(created.custom).toBe(true);
    const area = (await call(t, 'list_areas')).json.areas.find((a: any) => a.id === 'lower');
    expect(area.poolExerciseIds).toContain(created.id);
    expect((await call(t, 'create_exercise', { name: 'X', primary: ['Nope'], pattern: 'squat' })).isError).toBe(true);
    expect((await call(t, 'create_exercise', { name: 'X', primary: ['Quads'], pattern: 'squat', equipment: ['laser'] })).isError).toBe(true);
    const upd = (await call(t, 'update_exercise', { exerciseId: 'back_squat', repMax: 10, tags: ['legs'] })).json.updated;
    expect(upd.repRange).toEqual([5, 10]);
    const found = (await call(t, 'list_exercises', { query: 'back squat', includeScores: false })).json.exercises[0];
    expect(found.repRange).toEqual([5, 10]);
  });

  test('preview_next_session respects cooldown after history, coach plan overrides', async () => {
    const { mk, call } = await setup();
    const t = await mk('write');
    const p1 = (await call(t, 'preview_next_session', { slot: 2 })).json;
    expect(p1.area).toBe('Lower body');
    expect(p1.exercises.length).toBe(5);
    await call(t, 'create_coach_plan', { title: 'Quad focus', note: 'Heavy day', slot: 2, exercises: [{ exerciseId: 'hack_squat', sets: 5, reps: 5 }, { exerciseId: 'leg_ext' }] });
    const p2 = (await call(t, 'preview_next_session', { slot: 2 })).json;
    expect(p2.source).toBe('coach');
    expect(p2.exercises.map((e: any) => e.exerciseId)).toEqual(['hack_squat', 'leg_ext']);
    expect((await call(t, 'create_coach_plan', { title: 'bad', exercises: [{ exerciseId: 'nope' }] })).isError).toBe(true);
  });

  test('settings: planner weights validated and applied; rotation; equipment', async () => {
    const { mk, call } = await setup();
    const t = await mk('write');
    const s = (await call(t, 'update_settings', { weeklyGoal: 5, planner: { wVariety: 2, cooldownSessions: 2 }, profileNotes: 'Bad left shoulder' })).json;
    expect(s.weeklyGoal).toBe(5);
    expect(s.planner.wVariety).toBe(2);
    expect(s.planner.wRecency).toBe(1.2); // untouched
    expect((await call(t, 'update_settings', { planner: { bogus: 1 } })).isError).toBe(true);
    expect((await call(t, 'update_settings', { weeklyGoal: 12 })).isError).toBe(true);
    expect((await call(t, 'set_rotation', { areaIds: ['lower', 'upper', 'lower'] })).json.rotation.length).toBe(3);
    expect((await call(t, 'set_rotation', { areaIds: ['ghost'] })).isError).toBe(true);
    await call(t, 'update_gym_equipment', { gymId: 'g1', set: { hack_squat: 'none', leg_press: 'broken' } });
    const av = (await call(t, 'list_exercises', { availableAtGymId: 'g1', includeScores: false, limit: 300 })).json.exercises.map((e: any) => e.id);
    expect(av).not.toContain('hack_squat');
    expect(av).not.toContain('leg_press');
    expect(av).toContain('back_squat');
  });

  test('batch + notifications + unknown tool', async () => {
    const { mk, j } = await setup();
    const t = await mk('read');
    const r = await j('/mcp', { token: t, body: [{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 1, method: 'ping' }] });
    expect(r.body.length).toBe(1);
    const n = await j('/mcp', { token: t, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    expect(n.status).toBe(202);
    const u = await j('/mcp', { token: t, body: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } } });
    expect(u.body.error.code).toBe(-32602);
  });

  test('revoked token stops working', async () => {
    const { j, session, mk, rpc } = await setup();
    const t = await mk('write');
    const list = (await j('/api/tokens', { token: session, method: 'GET' })).body.tokens;
    await j(`/api/tokens/${list[0].id}`, { token: session, method: 'DELETE' });
    expect((await rpc(t, 'ping')).status).toBe(401);
  });
});

describe('mcp settings guard', () => {
  test('refuses to create settings for an athlete whose app never synced them', async () => {
    const db = openDb(':memory:');
    const app = new Hono();
    app.route('/api', buildApi(db));
    app.route('/mcp', buildMcp(db));
    const post = async (path: string, token: string | null, body: unknown) => (await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
    const anon = await post('/api/auth/anon', null, {});
    const tok = (await post('/api/tokens', anon.token, { name: 't', scope: 'write' })).token;
    const call = async (name: string, args: unknown) => (await post('/mcp', tok, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
    const r = await call('update_settings', { weeklyGoal: 5 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/finished setup/);
    expect((await call('reset_planner', {})).isError).toBe(true);
    // non-settings writes still work
    expect((await call('set_exercise_pref', { exerciseId: 'back_squat', favorite: true })).isError).toBe(false);
  });
});
