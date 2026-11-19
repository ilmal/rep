// Sync engine: outbox draining, offline stall regression, applyRemote LWW rules, auth (anon / register / login / logout / delete).
// Uses the in-memory FakeServer from state-kit (same LWW + echo-suppression semantics as src/server/api.ts).
import { describe, expect, test } from 'bun:test';
import { clearOutbox, nav, onboard, playAll, queued, ready, S, server, startLive, tick, useHarness, SEC, HOUR, T0, setClock, invariants } from './state-kit';
import * as A from './actions';
import { getState, mutate, putEntity, resetLocal, setState } from './core';
import { deleteAllData, ensureAccount, login, logout, pendingCount, register, syncNow } from './sync';
import { DEFAULT_PLANNER } from '../../shared/planner';
useHarness();

const dev = () => S().device;
const remoteGym = (id: string, over: Record<string, unknown> = {}) => ({ id, name: 'Remote gym', lat: null, lng: null, radiusM: 100, equipment: { dumbbells: 'ok' }, notes: {}, brokenSince: {}, createdAt: 1, ...over });
/** account exists + everything pushed; returns the server-side user id */
async function synced() { onboard(); await syncNow(); expect(pendingCount(S())).toBe(0); return dev().userId!; }
const push = (uid: string, type: string, id: string, updatedAt: number, data: unknown, deleted = false) => server.putRemote(uid, { type: type as never, id, updatedAt, data, deleted });

describe('sync status machine: online / syncing / error', () => {
  test('not hydrated: syncNow does nothing', async () => {
    onboard(); setState((s) => { s.hydrated = false; });
    await syncNow();
    expect(server.calls).toHaveLength(0);
  });
  test('offline -> online: THE STALL REGRESSION. syncNow while offline must not poison later syncs', async () => {
    onboard(); nav.onLine = false;
    await syncNow(); await syncNow();
    const p1 = syncNow(); const p2 = syncNow(); // concurrent callers share the in-flight guard
    await Promise.all([p1, p2]);
    expect(server.calls).toHaveLength(0);
    expect(S().online).toBe(false);
    expect(pendingCount(S())).toBeGreaterThan(0);
    nav.onLine = true;
    await syncNow();
    expect(server.calls.some((c) => c.path === '/sync')).toBe(true);
    expect(pendingCount(S())).toBe(0);
    expect(S().online).toBe(true);
    expect(dev().token).toBeDefined();
    expect(dev().lastSyncAt).toBeDefined();
    expect(dev().lastSyncError).toBeUndefined();
    expect(S().syncing).toBe(false);
  });
  test('offline with no account yet then online: account is created on the first online sync', async () => {
    onboard(); nav.onLine = false;
    expect(await ensureAccount()).toBe(false);
    nav.onLine = true;
    expect(await ensureAccount()).toBe(true);
    const calls = server.calls.length;
    expect(await ensureAccount()).toBe(true); // already has a token: no new request
    expect(server.calls).toHaveLength(calls);
  });
  test('account creation failing -> lastSyncError no_account, outbox kept, next attempt works', async () => {
    onboard(); server.mode = 'down';
    await syncNow();
    expect(dev().lastSyncError).toBe('no_account'); expect(S().syncing).toBe(false); expect(pendingCount(S())).toBeGreaterThan(0);
    server.mode = 'ok'; await syncNow();
    expect(dev().lastSyncError).toBeUndefined(); expect(pendingCount(S())).toBe(0);
  });
  test('network error mid-sync: lastSyncError set, syncing false, outbox intact; retry drains and clears the error', async () => {
    await synced(); A.toggleFavorite('bench_press'); const n = pendingCount(S());
    server.mode = 'down'; await syncNow();
    expect(dev().lastSyncError).toContain('network down'); expect(S().syncing).toBe(false); expect(pendingCount(S())).toBe(n);
    server.mode = 'ok'; await syncNow();
    expect(dev().lastSyncError).toBeUndefined(); expect(pendingCount(S())).toBe(0);
  });
  test('HTTP 500: error recorded, nothing dropped', async () => {
    await synced(); A.toggleFavorite('bench_press'); server.status = 500;
    await syncNow();
    expect(dev().lastSyncError).toBe('sync 500'); expect(pendingCount(S())).toBe(1);
    server.status = null; await syncNow(); expect(pendingCount(S())).toBe(0);
  });
  test('401 (token revoked): credentials cleared, outbox kept, next sync registers a fresh anonymous account and pushes', async () => {
    await synced(); const old = dev().token; A.toggleFavorite('bench_press');
    server.tokens.clear();
    await syncNow();
    expect(dev().token).toBeUndefined(); expect(pendingCount(S())).toBe(1);
    await syncNow();
    expect(dev().token).toBeDefined(); expect(dev().token).not.toBe(old); expect(pendingCount(S())).toBe(0);
    expect(server.entity(dev().userId!, 'pref', 'bench_press')).toBeDefined();
  });
  test('syncing flag is true only while a round trip is in flight', async () => {
    await synced(); A.toggleFavorite('bench_press'); server.mode = 'hold';
    const p = syncNow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(S().syncing).toBe(true);
    server.mode = 'ok'; server.release(); await p;
    expect(S().syncing).toBe(false);
  });
});

describe('outbox draining', () => {
  test('accepted changes + events leave the queue; the server stores them; cursor advances', async () => {
    const uid = await synced();
    expect(S().events).toHaveLength(0);
    expect(server.entity(uid, 'settings', 'settings')).toBeDefined();
    expect(server.users.get(uid)!.events.length).toBeGreaterThan(0);
    expect(dev().cursor).toBeGreaterThan(0);
  });
  test('an edit made while a sync is in flight (a later millisecond) stays queued and is pushed next round', async () => {
    await synced(); A.toggleFavorite('bench_press'); server.mode = 'hold';
    const p = syncNow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    tick(5); A.toggleFavorite('db_curl'); A.setPref('bench_press', { relevance: 77 });
    const newest = queued('pref', 'bench_press')!.updatedAt;
    server.mode = 'ok'; server.release(); await p;
    expect(pendingCount(S())).toBe(0); // the loop kept going until the outbox drained
    expect(server.entity(dev().userId!, 'pref', 'bench_press')!.updatedAt).toBe(newest);
    expect(server.entity(dev().userId!, 'pref', 'db_curl')).toBeDefined();
  });
  test('an edit made in the SAME millisecond as the in-flight push must not be lost', async () => {
    const uid = await synced(); A.setPref('bench_press', { relevance: 10 }); server.mode = 'hold';
    const p = syncNow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    A.setPref('bench_press', { relevance: 99 }); // frozen clock: identical updatedAt, different data
    server.mode = 'ok'; server.release(); await p;
    expect(S().prefs['bench_press'].relevance).toBe(99);
    expect((server.entity(uid, 'pref', 'bench_press')!.data as { relevance: number }).relevance).toBe(99);
  });
  test('more than 400 pending changes are sent in several rounds', async () => {
    await synced();
    mutate((s) => { for (let i = 0; i < 450; i++) putEntity(s, 'pref', 'ex' + i, { exerciseId: 'ex' + i, favorite: true, avoid: false, relevance: 50 }); });
    server.calls = [];
    await syncNow();
    const sizes = server.calls.filter((c) => c.path === '/sync').map((c) => c.body.changes.length);
    expect(sizes[0]).toBe(400); expect(sizes[1]).toBe(50); expect(pendingCount(S())).toBe(0);
  });
  test('server pagination (more=true) is followed to the end', async () => {
    const uid = await synced(); server.pageSize = 2;
    for (let i = 0; i < 7; i++) push(uid, 'gym', 'g' + i, T0 + i, remoteGym('g' + i, { updatedAt: T0 + i }));
    await syncNow();
    for (let i = 0; i < 7; i++) expect(S().gyms['g' + i]).toBeDefined();
  });
  test('a rejected (stale) push is dropped from the outbox and the newer server copy replaces the local one', async () => {
    const uid = await synced();
    A.setPref('db_curl', { relevance: 20 }); // local pending, updatedAt = T0
    push(uid, 'pref', 'db_curl', Date.now() + 10 * SEC, { exerciseId: 'db_curl', favorite: true, avoid: false, relevance: 90, updatedAt: Date.now() + 10 * SEC });
    await syncNow();
    expect(pendingCount(S())).toBe(0);
    expect(S().prefs['db_curl'].relevance).toBe(90);
  });
});

describe('applyRemote last-write-wins rules (through a real sync)', () => {
  test('unknown remote entities of every type are added', async () => {
    const uid = await synced(); const t = Date.now() + SEC;
    push(uid, 'gym', 'rg', t, remoteGym('rg', { updatedAt: t }));
    push(uid, 'area', 'ra', t, { id: 'ra', name: 'Remote', focusMuscles: [], exercisesPerSession: 4, mode: 'auto', pinnedExerciseIds: [], poolExerciseIds: [], updatedAt: t });
    push(uid, 'pref', 'bench_press', t, { exerciseId: 'bench_press', favorite: true, avoid: false, relevance: 50, updatedAt: t });
    push(uid, 'progress', 'bench_press', t, { exerciseId: 'bench_press', weight: 70, reps: 5, sets: 3, updatedAt: t });
    push(uid, 'plan', 'rp', t, { id: 'rp', title: 'x', exercises: [], status: 'pending', createdBy: 'c', createdAt: t, updatedAt: t });
    push(uid, 'exercise', 'cx', t, { id: 'cx', name: 'Cx', primary: ['Chest'], secondary: [], equipment: [], pattern: 'push', difficulty: 1, tracking: 'reps', weightStep: 0, repMin: 5, repMax: 8, defaultSets: 3, updatedAt: t });
    await syncNow();
    expect(Object.keys(S().gyms)).toContain('rg'); expect(S().areas['ra']).toBeDefined(); expect(S().prefs['bench_press'].favorite).toBe(true);
    expect(S().progress['bench_press'].weight).toBe(70); expect(S().plans['rp']).toBeDefined(); expect(S().exercises['cx']).toBeDefined();
    expect(pendingCount(S())).toBe(0); // remote applies do not re-queue themselves
  });
  test('stale remote (older than the local copy) is ignored', async () => {
    const uid = await synced(); A.setPref('bench_press', { relevance: 70 }); await syncNow();
    const local = S().prefs['bench_press'];
    push(uid, 'pref', 'bench_press', local.updatedAt! - 1000, { exerciseId: 'bench_press', favorite: true, avoid: true, relevance: 1, updatedAt: local.updatedAt! - 1000 });
    await syncNow();
    expect(S().prefs['bench_press']).toBe(local);
  });
  test('newer remote replaces the local copy', async () => {
    const uid = await synced(); A.setPref('bench_press', { relevance: 70 }); await syncNow();
    const t = S().prefs['bench_press'].updatedAt! + 1000;
    push(uid, 'pref', 'bench_press', t, { exerciseId: 'bench_press', favorite: true, avoid: false, relevance: 12, updatedAt: t });
    await syncNow();
    expect(S().prefs['bench_press']).toMatchObject({ relevance: 12, favorite: true });
  });
  test('a pending local edit NEWER than the remote copy wins (remote ignored while the edit is still queued)', async () => {
    const uid = await synced(); A.setPref('bench_press', { relevance: 10 }); await syncNow();
    A.toggleFavorite('db_curl'); await syncNow(); // keep cursor moving
    server.mode = 'hold';
    A.setPref('bench_press', { relevance: 20 }); const p = syncNow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    tick(50); A.setPref('bench_press', { relevance: 30 }); // newer edit while the response is on its way
    const newest = S().prefs['bench_press'].updatedAt!;
    push(uid, 'pref', 'bench_press', newest - 10, { exerciseId: 'bench_press', favorite: false, avoid: false, relevance: 99, updatedAt: newest - 10 });
    server.mode = 'ok'; server.release(); await p;
    expect(S().prefs['bench_press'].relevance).toBe(30);
    expect((server.entity(uid, 'pref', 'bench_press')!.data as { relevance: number }).relevance).toBe(30);
  });
  test('a pending local edit OLDER than the remote copy loses (server rejects it, remote applies)', async () => {
    const uid = await synced(); A.setPref('bench_press', { relevance: 10 });
    const t = Date.now() + 5 * SEC; push(uid, 'pref', 'bench_press', t, { exerciseId: 'bench_press', favorite: false, avoid: false, relevance: 88, updatedAt: t });
    await syncNow();
    expect(S().prefs['bench_press'].relevance).toBe(88); expect(pendingCount(S())).toBe(0);
  });
  test('equal timestamps: the local copy and its queued change stay consistent (no client/server divergence)', async () => {
    const uid = await synced(); server.mode = 'hold';
    A.setPref('bench_press', { relevance: 10 }); const p = syncNow();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    tick(1); A.setPref('bench_press', { relevance: 20 });
    const t = S().prefs['bench_press'].updatedAt!;
    push(uid, 'pref', 'bench_press', t, { exerciseId: 'bench_press', favorite: false, avoid: false, relevance: 55, updatedAt: t });
    server.mode = 'ok'; server.release(); await p;
    // either side may win, but they must agree
    const local = S().prefs['bench_press'].relevance; const srv = (server.entity(uid, 'pref', 'bench_press')!.data as { relevance: number }).relevance;
    expect(local).toBe(srv);
  });
  test('remote deletion: newer removes the entity, older is ignored', async () => {
    const uid = await synced(); const g = A.addGym({ name: 'Tmp', template: 'basic' }); await syncNow();
    const t = S().gyms[g].updatedAt!;
    push(uid, 'gym', g, t - 500, {}, true); await syncNow();
    expect(S().gyms[g]).toBeDefined();
    push(uid, 'gym', g, t + 500, {}, true); await syncNow();
    expect(S().gyms[g]).toBeUndefined();
  });
  test('remote session deletion removes it locally (history delete on another device)', async () => {
    const uid = await synced(); ready(); startLive(); playAll(); const id = A.finishSession()!; await syncNow();
    push(uid, 'session', id, Date.now() + SEC, {}, true); await syncNow();
    expect(S().sessions[id]).toBeUndefined();
  });
  test('settings: newer remote applies and merges planner defaults; older / equal-or-pending-newer / deleted are ignored', async () => {
    const uid = await synced(); const cur = S().settings;
    const old = { ...cur, weeklyGoal: 6, updatedAt: cur.updatedAt - 1 };
    push(uid, 'settings', 'settings', cur.updatedAt - 1, old); await syncNow();
    expect(S().settings.weeklyGoal).toBe(cur.weeklyGoal);
    push(uid, 'settings', 'settings', cur.updatedAt + 100, { ...cur, weeklyGoal: 5, planner: { wRecency: 9 }, updatedAt: cur.updatedAt + 100 }); await syncNow();
    expect(S().settings.weeklyGoal).toBe(5);
    expect(S().settings.planner).toMatchObject({ ...DEFAULT_PLANNER, wRecency: 9 });
    push(uid, 'settings', 'settings', cur.updatedAt + 500, {}, true); await syncNow();
    expect(S().settings.weeklyGoal).toBe(5); // deletion of settings is ignored
  });
  test('remote changes that affect planning invalidate the draft; progress/session/settings echoes do not', async () => {
    const uid = await synced(); const t = () => Date.now() + SEC;
    const cases: [string, string, string, unknown, boolean][] = [
      ['plan', 'rp', 'plan', { id: 'rp', title: 'x', exercises: [], status: 'pending', createdBy: 'c', createdAt: 1 }, true],
      ['pref', 'bench_press', 'pref', { exerciseId: 'bench_press', favorite: false, avoid: true, relevance: 50 }, true],
      ['gym', 'rg', 'gym', remoteGym('rg'), true],
      ['area', 'ra', 'area', { id: 'ra', name: 'R', focusMuscles: [], exercisesPerSession: 4, mode: 'auto', pinnedExerciseIds: [], poolExerciseIds: [] }, true],
      ['exercise', 'cx', 'exercise', { id: 'cx', name: 'C', primary: ['Chest'], secondary: [], equipment: [], pattern: 'push', difficulty: 1, tracking: 'reps', weightStep: 0, repMin: 5, repMax: 8, defaultSets: 3 }, true],
      ['progress', 'bench_press', 'progress', { exerciseId: 'bench_press', weight: 60, reps: 5, sets: 3 }, false],
    ];
    for (const [type, id, , data, invalidates] of cases) {
      A.prepareDraft(true); const d = S().device.draft; expect(d).not.toBeNull();
      push(uid, type, id, t(), { ...(data as object), updatedAt: t() }); await syncNow();
      expect(S().device.draft === null).toBe(invalidates);
      tick(2 * SEC);
    }
  });
  test('a remote settings change to rotation/planner invalidates the draft', async () => {
    const uid = await synced(); A.prepareDraft(true);
    const cur = S().settings; const t = Date.now() + SEC;
    push(uid, 'settings', 'settings', t, { ...cur, rotation: [...cur.rotation].reverse(), updatedAt: t }); await syncNow();
    expect(S().device.draft).toBeNull();
  });
  test('a coach plan arriving remotely is used by the next draft', async () => {
    const uid = await synced(); A.prepareDraft(true); expect(S().device.draft!.source).toBe('auto');
    const t = Date.now() + SEC;
    push(uid, 'plan', 'cp', t, { id: 'cp', title: 'Coach', slot: 1, exercises: [{ exerciseId: 'bench_press', sets: 5 }], status: 'pending', createdBy: 'grok', createdAt: t, updatedAt: t });
    await syncNow(); A.prepareDraft();
    expect(S().device.draft).toMatchObject({ source: 'coach', coachPlanId: 'cp' });
  });
  test.todo('two devices both start a session offline: after sync there must still be at most one active session (applyRemote currently allows two)');
});

describe('accounts: register / login / logout / delete', () => {
  test('register keeps local data, stores the lowercased email on the device', async () => {
    onboard();
    expect(await register(' Me@Example.COM ', 'password123')).toEqual({ ok: true });
    expect(dev().email).toBe('me@example.com'); expect(S().settings.onboarded).toBe(true);
  });
  test('register offline fails with "offline" and changes nothing', async () => {
    onboard(); nav.onLine = false;
    expect(await register('a@b.se', 'password123')).toEqual({ ok: false, error: 'offline' });
    expect(dev().email).toBeUndefined();
  });
  test('login: wrong credentials leave local data alone; offline refused; success REPLACES local data with the account and syncs', async () => {
    // device A builds an account
    ready(); startLive(); playAll(); const id = A.finishSession()!; await register('a@b.se', 'password123'); await syncNow();
    const progress = S().progress;
    // device B (fresh) has its own unsynced junk
    await resetLocal(false); onboard(); A.toggleFavorite('db_curl'); const junk = Object.keys(S().areas);
    expect(await login('a@b.se', 'nope')).toMatchObject({ ok: false, error: 'invalid_credentials' });
    expect(Object.keys(S().areas)).toEqual(junk);
    nav.onLine = false; expect(await login('a@b.se', 'password123')).toEqual({ ok: false, error: 'offline' }); nav.onLine = true;
    expect(await login(' A@B.se ', 'password123')).toEqual({ ok: true });
    expect(dev().email).toBe('a@b.se');
    expect(S().sessions[id]).toMatchObject({ status: 'completed' });
    expect(S().progress).toEqual(progress);
    expect(S().prefs['db_curl']).toBeUndefined(); // B's unsynced junk is gone by design
    expect(S().settings.onboarded).toBe(true);
    expect(pendingCount(S())).toBe(0);
    expect(invariants(S())).toEqual([]);
  });
  test('login to an account that never onboarded leaves onboarded=false (router sends the user to onboarding)', async () => {
    await register('new@b.se', 'password123'); await resetLocal(false);
    expect(await login('new@b.se', 'password123')).toEqual({ ok: true });
    expect(S().settings.onboarded).toBe(false);
  });
  test('logout online: server token revoked, local state fully reset (no auth, no data, hydrated)', async () => {
    onboard(); await register('a@b.se', 'password123'); await syncNow(); const tok = dev().token!;
    await logout();
    expect(server.tokens.has(tok)).toBe(false);
    expect(S()).toMatchObject({ hydrated: true, sessions: {}, areas: {}, outbox: {}, events: [] });
    expect(S().settings.onboarded).toBe(false);
    expect(dev()).toMatchObject({ cursor: 0, currentGymId: null, draft: null, chosenSlot: null });
    expect(dev().token).toBeUndefined(); expect(dev().email).toBeUndefined();
  });
  test('logout offline still resets locally', async () => {
    onboard(); await syncNow(); nav.onLine = false;
    await logout();
    expect(S().settings.onboarded).toBe(false); expect(dev().token).toBeUndefined();
  });
  test('resetLocal(keepDeviceAuth) keeps token/userId/email only', async () => {
    onboard(); await register('a@b.se', 'password123'); const { token, userId } = dev();
    await resetLocal(true);
    expect(dev()).toMatchObject({ token, userId, email: 'a@b.se', cursor: 0 }); expect(S().areas).toEqual({});
  });
  test('deleteAllData(false): server data wiped, auth kept, cursor 0; deleteAllData(true): auth dropped too', async () => {
    const uid = await synced();
    await deleteAllData(false);
    expect(server.users.get(uid)!.ents.size).toBe(0); expect(dev().token).toBeDefined(); expect(dev().cursor).toBe(0); expect(S().settings.onboarded).toBe(false);
    await deleteAllData(true); expect(dev().token).toBeUndefined();
  });
  test('full round trip: everything the device produced is on the server and survives a wipe + login', async () => {
    ready(); startLive(); playAll(); A.finishSession(); A.toggleFavorite('bench_press'); A.setEquipStatus(S().device.currentGymId!, 'dumbbells', 'broken');
    await register('rt@b.se', 'password123'); await syncNow();
    const snap = JSON.stringify({ s: S().settings, g: S().gyms, a: S().areas, p: S().prefs, pr: S().progress, x: S().sessions });
    await resetLocal(false); await login('rt@b.se', 'password123');
    expect(JSON.stringify({ s: S().settings, g: S().gyms, a: S().areas, p: S().prefs, pr: S().progress, x: S().sessions })).toBe(snap);
  });
});
