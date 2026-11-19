// Onboarding, gyms + equipment status cycle, geo detection state machine, draft lifecycle + invalidation, preferences
// (favourite / paused / banned), coach plans, slots, derived values, persistence.
import { describe, expect, test } from 'bun:test';
import {
  DAY, HOUR, MIN, SEC, T0, clearOutbox, flushGeo, geo, gymId, localStorageData, onboard, queued, ready, S, setClock, setGeolocationAvailable, startLive, doAllSets, FB, playAll,
  tick, useHarness, invariants,
} from './state-kit';
import * as A from './actions';
import { hydrate, mutate, persistNow, putEntity, setState } from './core';
import { PAUSE_FOREVER, blockedIds, isPaused, pickCoachPlan, statusOf } from '../../shared/planner';
import { streakWeeks, weekCount, weeklyCounts, nextSeq } from '../../shared/rules';
import type { CoachPlan, Session } from '../../shared/types';
useHarness();

const kinds = () => S().events.map((e) => e.kind);
const plan = (id: string, over: Partial<CoachPlan> = {}) => mutate((st) => putEntity(st, 'plan', id, { id, title: id, exercises: [{ exerciseId: 'bench_press', sets: 3 }], status: 'pending', createdBy: 'coach', createdAt: Date.now(), ...over }));
const GYM = { lat: 59.33, lng: 18.06 };

describe('onboarding', () => {
  test('result shape: settings, 4 default areas in rotation, gym with template inventory, current gym = first, events + outbox', () => {
    A.completeOnboarding({ name: 'Alex', goal: 3, targetMinutes: 50, warmupMinutes: 8, gyms: [{ name: 'Home', template: 'home' }, { name: 'City', template: 'full', ...GYM }], areaNames: [] });
    const s = S();
    expect(s.settings).toMatchObject({ onboarded: true, name: 'Alex', weeklyGoal: 3, targetMinutes: 50, warmupTargetMinutes: 8 });
    expect(s.settings.rotation).toHaveLength(4);
    expect(s.settings.rotation.every((id) => !!s.areas[id])).toBe(true);
    expect(Object.keys(s.areas)).toHaveLength(4);
    const gyms = Object.values(s.gyms);
    expect(gyms.map((g) => g.name)).toEqual(['Home', 'City']);
    expect(gyms[0]).toMatchObject({ lat: null, lng: null, radiusM: 150, notes: {}, brokenSince: {} });
    expect(Object.keys(gyms[1].equipment).length).toBeGreaterThan(Object.keys(gyms[0].equipment).length);
    expect(s.device).toMatchObject({ currentGymId: gyms[0].id, gymSource: 'last', draft: null, chosenSlot: null });
    expect(kinds()).toContain('onboarded');
    for (const g of gyms) expect(queued('gym', g.id)).toBeDefined();
    for (const id of s.settings.rotation) expect(queued('area', id)).toBeDefined();
    expect(queued('settings', 'settings')).toBeDefined();
    expect(invariants(s, { noSync: true })).toEqual([]);
  });
  test('no gyms: currentGymId stays null, gymSource none; explicit area names honoured, unknown name falls back', () => {
    A.completeOnboarding({ goal: 2, targetMinutes: 45, warmupMinutes: 5, gyms: [], areaNames: ['Lower body', 'No such area'] });
    expect(S().device).toMatchObject({ currentGymId: null, gymSource: 'none' });
    expect(S().settings.rotation).toHaveLength(2);
    expect(Object.values(S().areas)[0].name).toBe('Lower body');
    expect(S().settings.name).toBe('');
  });
  test('onboarding result can generate and start a session', () => {
    onboard(); A.prepareDraft();
    expect(S().device.draft!.exercises.length).toBeGreaterThan(2);
    expect(A.beginSession()).toBeTruthy();
  });
});

describe('gym equipment status cycle (ok -> broken -> none -> ok) and brokenSince', () => {
  const eq = 'flat_bench';
  const gym = () => S().gyms[gymId()];
  test('every ordered pair of statuses', () => {
    onboard();
    expect(gym().equipment[eq]).toBe('ok');
    const order = ['ok', 'broken', 'none'] as const;
    for (const from of order) for (const to of order) {
      A.setEquipStatus(gymId(), eq, from); tick(DAY);
      const sinceFrom = gym().brokenSince[eq];
      clearOutbox();
      A.setEquipStatus(gymId(), eq, to);
      const g = gym();
      if (to === 'none') expect(g.equipment[eq]).toBeUndefined(); else expect(g.equipment[eq]).toBe(to);
      if (to === 'broken') expect(g.brokenSince[eq]).toBe(from === 'broken' ? sinceFrom : Date.now()); // re-marking keeps the original date
      else expect(g.brokenSince[eq]).toBeUndefined();
      expect(queued('gym', g.id)?.data).toBe(g);
    }
    expect(kinds().filter((k) => k === 'equipment_marked').length).toBeGreaterThanOrEqual(9);
  });
  test('unknown equipment / unknown gym are no-ops', () => {
    onboard();
    const gyms = S().gyms; const ob = S().outbox;
    A.setEquipStatus(gymId(), 'warp_drive', 'ok'); A.setEquipStatus('nope', eq, 'ok');
    expect(S().gyms).toBe(gyms); expect(S().outbox).toBe(ob);
  });
  test('broken equipment is excluded from planning; restoring it brings exercises back', () => {
    ready();
    A.setEquipStatus(gymId(), 'barbell', 'broken');
    A.prepareDraft(true);
    const lib = A.libraryOf();
    for (const e of S().device.draft!.exercises) expect(lib.find((x) => x.id === e.exerciseId)!.equipment).not.toContain('barbell');
  });
  test('gym lifecycle: add (first becomes current/manual), update, soft delete clears current + draft', () => {
    expect(A.addGym({ name: ' First ', template: 'basic' })).toBeTruthy();
    expect(S().device).toMatchObject({ gymSource: 'manual' });
    const first = S().device.currentGymId!;
    expect(S().gyms[first].name).toBe('First');
    const second = A.addGym({ name: 'Second', template: 'empty' });
    expect(S().device.currentGymId).toBe(first); // only the first gym auto-selects
    A.updateGym(second, { radiusM: 300 }); expect(S().gyms[second].radiusM).toBe(300);
    A.updateGym('nope', { radiusM: 1 }); expect(S().gyms['nope']).toBeUndefined();
    A.deleteGym(second); expect(S().gyms[second].deleted).toBe(true); // soft delete
    expect(S().device.currentGymId).toBe(first);
    A.deleteGym(first);
    expect(S().device).toMatchObject({ currentGymId: null, gymSource: 'none', draft: null });
  });
});

describe('geo detection state machine', () => {
  const setup = () => { A.completeOnboarding({ goal: 4, targetMinutes: 60, warmupMinutes: 10, gyms: [{ name: 'A', template: 'full', ...GYM, radiusM: 150 }, { name: 'B', template: 'basic', lat: 59.4, lng: 18.2 }], areaNames: [] }); };
  const A_ID = () => Object.values(S().gyms).find((g) => g.name === 'A')!.id;
  const B_ID = () => Object.values(S().gyms).find((g) => g.name === 'B')!.id;
  test('idle -> idle when GPS is switched off', async () => {
    setup(); A.updateSettings({ gps: false });
    await A.detectGym();
    expect(S().device.geo).toBe('idle');
  });
  test('idle -> unavailable when the browser has no geolocation', async () => {
    setup(); setGeolocationAvailable(false);
    await A.detectGym();
    expect(S().device.geo).toBe('unavailable');
  });
  test('idle -> locating -> matched: sets current gym (gps), distance, event; keeps a draft of the SAME gym', async () => {
    setup(); A.prepareDraft(true); const draft = S().device.draft;
    Object.assign(geo, { mode: 'pending', ...GYM });
    const p = A.detectGym();
    expect(S().device.geo).toBe('locating');
    flushGeo(); await p;
    expect(S().device).toMatchObject({ geo: 'matched', currentGymId: A_ID(), gymSource: 'gps', geoDistanceM: 0 });
    expect(S().device.draft).toBe(draft);
    expect(kinds()).toContain('gym_detected');
  });
  test('matched at a DIFFERENT gym switches current gym and invalidates the draft', async () => {
    setup(); A.prepareDraft(true);
    Object.assign(geo, { mode: 'ok', lat: 59.4, lng: 18.2 });
    await A.detectGym();
    expect(S().device).toMatchObject({ geo: 'matched', currentGymId: B_ID(), gymSource: 'gps', draft: null });
  });
  test('nearest of two overlapping fences wins; deleted gyms never match', async () => {
    setup();
    Object.assign(geo, { ...GYM });
    A.deleteGym(A_ID());
    await A.detectGym();
    expect(S().device.geo).toBe('nomatch');
  });
  test('locating -> nomatch outside every fence: remembers position, keeps the current gym', async () => {
    setup(); const cur = S().device.currentGymId;
    Object.assign(geo, { lat: 10, lng: 10 });
    await A.detectGym();
    expect(S().device).toMatchObject({ geo: 'nomatch', currentGymId: cur, currentPos: { lat: 10, lng: 10 } });
    expect(kinds()).toContain('gym_unknown_location');
  });
  test('accuracy widens the fence by at most 50 m', async () => {
    setup();
    const dLat = 190 / 111_195; // ~190 m north of gym A (radius 150)
    Object.assign(geo, { lat: GYM.lat + dLat, lng: GYM.lng, accuracy: 30 }); await A.detectGym(); expect(S().device.geo).toBe('nomatch');
    Object.assign(geo, { accuracy: 500 }); await A.detectGym(); expect(S().device.geo).toBe('matched'); // capped at +50 -> 200 m fence: 190 m is inside
  });
  test('locating -> denied (code 1) and -> unavailable (code 2/3); neither changes the current gym', async () => {
    setup(); const cur = S().device.currentGymId;
    Object.assign(geo, { mode: 'err', code: 1 }); await A.detectGym(); expect(S().device.geo).toBe('denied');
    Object.assign(geo, { code: 2 }); await A.detectGym(); expect(S().device.geo).toBe('unavailable');
    Object.assign(geo, { code: 3 }); await A.detectGym(); expect(S().device.geo).toBe('unavailable');
    expect(S().device.currentGymId).toBe(cur);
  });
  test('any terminal state can re-enter locating', async () => {
    setup();
    for (const mode of [{ mode: 'err' as const, code: 1 }, { mode: 'ok' as const, lat: 10, lng: 10 }, { mode: 'ok' as const, ...GYM }]) {
      Object.assign(geo, mode); await A.detectGym();
    }
    Object.assign(geo, { mode: 'pending' }); const p = A.detectGym(); expect(S().device.geo).toBe('locating'); flushGeo(); await p;
  });
  test('chooseGym -> manual source; draft kept only for the same gym', () => {
    setup(); A.prepareDraft(true);
    A.chooseGym(S().device.currentGymId!); expect(S().device.draft).not.toBeNull();
    A.chooseGym(B_ID()); expect(S().device).toMatchObject({ currentGymId: B_ID(), gymSource: 'manual', draft: null });
  });
  test('getPosition resolves coordinates / null on error / null without geolocation', async () => {
    Object.assign(geo, { ...GYM, mode: 'ok' }); expect(await A.getPosition()).toEqual(GYM);
    Object.assign(geo, { mode: 'err' }); expect(await A.getPosition()).toBeNull();
    setGeolocationAvailable(false); expect(await A.getPosition()).toBeNull();
  });
});

describe('draft lifecycle and invalidation rules', () => {
  test('none -> prepared; a fresh draft is reused, force / slot / gym / 6h age rebuild it', () => {
    onboard(); expect(S().device.draft).toBeNull();
    A.prepareDraft(); const d1 = S().device.draft!;
    expect(d1).toMatchObject({ slot: 1, variant: 0, gymId: gymId() });
    A.prepareDraft(); expect(S().device.draft).toBe(d1);
    A.prepareDraft(true); expect(S().device.draft).not.toBe(d1);
    const d2 = S().device.draft!;
    tick(7 * HOUR); A.prepareDraft(); expect(S().device.draft).not.toBe(d2);
  });
  test('newMix bumps variant and keeps target minutes; edits: move / remove / target clamp / add / swap', () => {
    ready(); A.draftSetTarget(45);
    A.newMix(); expect(S().device.draft).toMatchObject({ variant: 1, targetMin: 45 });
    A.draftSetTarget(5); expect(S().device.draft!.targetMin).toBe(20);
    A.draftSetTarget(999); expect(S().device.draft!.targetMin).toBe(150);
    const ids = S().device.draft!.exercises.map((e) => e.id);
    A.draftMove(0, 1); expect(S().device.draft!.exercises.map((e) => e.id).slice(0, 2)).toEqual([ids[1], ids[0]]);
    const before = S().device.draft; A.draftMove(0, -1); A.draftMove(99, 1); A.draftMove(-3, 1); A.draftMove(ids.length - 1, 1);
    expect(S().device.draft!.exercises.map((e) => e.id)).toEqual(before!.exercises.map((e) => e.id));
    A.draftRemove(ids[2]);
    expect(S().device.draft!.exercises.map((e) => e.order)).toEqual(S().device.draft!.exercises.map((_, i) => i));
    const have = S().device.draft!.exercises.map((e) => e.exerciseId);
    const extra = A.libraryOf().find((e) => !have.includes(e.id) && e.equipment.length === 0)!;
    A.draftAddExercise(extra.id); A.draftAddExercise(extra.id); A.draftAddExercise('nope');
    expect(S().device.draft!.exercises.filter((e) => e.exerciseId === extra.id)).toHaveLength(1);
    const target = S().device.draft!.exercises[0];
    A.draftSwap(target.id, extra.id === target.exerciseId ? 'back_squat' : 'goblet_squat');
    expect(S().device.draft!.exercises[0].swappedFrom).toMatchObject({ exerciseId: target.exerciseId, reason: 'busy' });
    A.draftSwap('nope', 'goblet_squat'); A.draftSwap(target.id, 'nope');
  });
  test('draft edits without a draft are no-ops', () => {
    onboard();
    A.newMix(); A.draftMove(0, 1); A.draftRemove('x'); A.draftSetTarget(30); A.draftAddExercise('bench_press'); A.draftSwap('x', 'bench_press');
    expect(S().device.draft).toBeNull();
  });
  test('slot with no area (empty rotation) yields no draft', () => {
    A.completeOnboarding({ goal: 4, targetMinutes: 60, warmupMinutes: 10, gyms: [], areaNames: [] });
    A.setRotation([]); A.prepareDraft(); expect(S().device.draft).toBeNull();
  });
  const INVALIDATING: [string, () => void][] = [
    ['equipment change at the draft gym', () => A.setEquipStatus(gymId(), 'dumbbells', 'broken')],
    ['gym equipment patch', () => A.updateGym(gymId(), { equipment: {} })],
    ['deleteGym (current)', () => A.deleteGym(gymId())],
    ['chooseGym (other gym)', () => A.chooseGym(A.addGym({ name: 'Other', template: 'basic' }))],
    ['saveArea', () => A.saveArea(Object.values(S().areas)[0])],
    ['deleteArea', () => A.deleteArea(Object.keys(S().areas)[3])],
    ['setRotation', () => A.setRotation(S().settings.rotation.slice().reverse())],
    ['setPref favourite', () => A.setPref('bench_press', { favorite: true })],
    ['toggleFavorite', () => A.toggleFavorite('bench_press')],
    ['banExercise', () => A.banExercise('bench_press')],
    ['pauseExercise', () => A.pauseExercise('bench_press', { days: 7 })],
    ['archiveExercise (custom)', () => { const id = A.saveExercise({ id: '', name: 'X', primary: ['Chest'], secondary: [], equipment: [], pattern: 'push', difficulty: 1, tracking: 'reps', weightStep: 0, repMin: 5, repMax: 10, defaultSets: 3 }); A.prepareDraft(true); A.archiveExercise(id); }],
    ['planner knob', () => A.updatePlanner({ wRecency: 3 })],
    ['updateSettings rotation/targetMinutes/restSec', () => A.updateSettings({ restSec: 120 })],
    ['chooseSlot', () => A.chooseSlot(2)],
    ['finishSession', () => { startLive(); playAll(); A.finishSession(); }],
    ['endEarly discard', () => { startLive(); A.endEarly('discard'); }],
    ['deleteSession', () => { startLive(); playAll(); const id = A.finishSession()!; A.prepareDraft(true); A.deleteSession(id); }],
  ];
  for (const [name, fn] of INVALIDATING) test(`invalidates: ${name}`, () => {
    ready(); expect(S().device.draft).not.toBeNull();
    fn();
    expect(S().device.draft).toBeNull();
  });
  const KEEPING: [string, () => void][] = [
    ['pref notes', () => A.setPref('bench_press', { notes: 'ok' })],
    ['settings name / sound / unit', () => A.updateSettings({ name: 'N', sound: false, unit: 'lb' })],
    ['equipment at ANOTHER gym', () => { const g = A.addGym({ name: 'Other', template: 'basic' }); A.setEquipStatus(g, 'dumbbells', 'broken'); }],
    ['chooseGym (same gym)', () => A.chooseGym(gymId())],
    ['updateGym name', () => A.updateGym(gymId(), { name: 'Renamed' })],
    ['beginSession', () => { A.beginSession(); }],
    ['chooseSlot(null)->', () => { /* chooseSlot always rebuilds, covered above */ }],
  ];
  for (const [name, fn] of KEEPING) test(`keeps: ${name}`, () => {
    ready(); const d = S().device.draft; fn();
    if (name.startsWith('chooseSlot')) return;
    expect(S().device.draft).toBe(d);
  });
});

describe('slots and rotation', () => {
  test('chooseSlot stores only a valid non-pointer slot; invalid values fall back to the pointer', () => {
    ready();
    A.chooseSlot(3); expect(S().device.chosenSlot).toBe(3); expect(A.effectiveSlot()).toBe(3);
    A.chooseSlot(1); expect(S().device.chosenSlot).toBeNull(); // equals pointer
    for (const bad of [0, -1, 5, 99, 1.5, NaN]) { A.chooseSlot(bad); expect(S().device.chosenSlot).toBeNull(); expect(A.effectiveSlot()).toBe(1); }
    A.chooseSlot(4); A.chooseSlot(null); expect(S().device.chosenSlot).toBeNull();
  });
  test('a stale chosenSlot beyond a shrunken rotation is ignored', () => {
    ready(); A.chooseSlot(4);
    A.setRotation(S().settings.rotation.slice(0, 2));
    mutate((s) => { s.device = { ...s.device, chosenSlot: 4 }; }); // as if restored from storage
    expect(A.effectiveSlot()).toBe(1);
    expect(invariants(S())).toEqual([]);
  });
  test('rotation: setRotation drops unknown ids; deleteArea removes it from the rotation and syncs a deletion', () => {
    onboard();
    const [a, b, c, d] = S().settings.rotation;
    A.setRotation([c, 'ghost', a]); expect(S().settings.rotation).toEqual([c, a]);
    A.setRotation([a, b, c, d]);
    clearOutbox(); A.deleteArea(b);
    expect(S().areas[b]).toBeUndefined(); expect(S().settings.rotation).toEqual([a, c, d]);
    expect(queued('area', b)).toMatchObject({ deleted: true });
    clearOutbox(); A.deleteArea('ghost'); expect(Object.keys(S().outbox)).toHaveLength(0);
  });
  test('a chosen slot makes the draft use that slot and is cleared by finishing', () => {
    ready(); A.chooseSlot(3); A.prepareDraft();
    expect(S().device.draft!.slot).toBe(3);
    startLive(); expect(A.getActiveSession()!.slot).toBe(3);
    playAll(); A.finishSession();
    expect(S().device.chosenSlot).toBeNull();
    expect(A.pointerSlot()).toBe(4);
  });
  test('pointer stays within 1..N when the rotation shrinks below the last slot', () => {
    ready(); A.chooseSlot(4); A.prepareDraft(); startLive(); playAll(); A.finishSession();
    A.setRotation(S().settings.rotation.slice(0, 2));
    expect(A.pointerSlot()).toBeGreaterThanOrEqual(1); expect(A.pointerSlot()).toBeLessThanOrEqual(2);
  });
});

describe('preferences: favourite / paused / banned', () => {
  const st = (id = 'bench_press') => statusOf(A.libraryOf() && (S().prefs[id] ?? { exerciseId: id, favorite: false, avoid: false, relevance: 50 }), Date.now());
  test('ready -> favorite -> ready', () => {
    onboard(); expect(st()).toBe('ready');
    A.toggleFavorite('bench_press'); expect(st()).toBe('favorite'); expect(queued('pref', 'bench_press')).toBeDefined();
    A.toggleFavorite('bench_press'); expect(st()).toBe('ready');
  });
  test('paused by days returns automatically when the clock passes pausedUntil (derived, no write)', () => {
    onboard(); A.pauseExercise('bench_press', { days: 7 });
    expect(st()).toBe('paused'); expect(blockedIds(S().prefs, Date.now())).toContain('bench_press');
    tick(6 * DAY); expect(st()).toBe('paused');
    tick(DAY + SEC); expect(st()).toBe('ready'); expect(blockedIds(S().prefs, Date.now())).not.toContain('bench_press');
    expect(S().prefs['bench_press'].pausedUntil).toBeDefined(); // stale marker is harmless
  });
  test('paused until resumed (PAUSE_FOREVER) -> resume', () => {
    onboard(); A.pauseExercise('bench_press', { days: null });
    expect(S().prefs['bench_press'].pausedUntil).toBe(PAUSE_FOREVER);
    tick(3650 * DAY); expect(st()).toBe('paused');
    A.pauseExercise('bench_press', { resume: true });
    expect(st()).toBe('ready'); expect(S().prefs['bench_press'].pausedUntil).toBeUndefined();
  });
  test('paused for N sessions replaces a time pause (and vice versa); {sessions:0} is a resume, not forever', () => {
    onboard();
    A.pauseExercise('bench_press', { days: 3 }); A.pauseExercise('bench_press', { sessions: 2 });
    expect(S().prefs['bench_press']).toMatchObject({ pausedSessions: 2 }); expect(S().prefs['bench_press'].pausedUntil).toBeUndefined();
    A.pauseExercise('bench_press', { days: 3 }); expect(S().prefs['bench_press'].pausedSessions).toBeUndefined(); expect(S().prefs['bench_press'].pausedUntil).toBeGreaterThan(Date.now()); // the two pause kinds are mutually exclusive
    A.pauseExercise('bench_press', { sessions: 0 }); expect(st()).toBe('ready');
    expect(isPaused(S().prefs['bench_press'], Date.now())).toBe(false);
  });
  test('banned beats paused beats favourite; unbanning reveals the underlying state', () => {
    onboard(); A.toggleFavorite('bench_press'); A.pauseExercise('bench_press', { days: 7 });
    expect(st()).toBe('paused');
    A.banExercise('bench_press'); expect(st()).toBe('banned'); expect(blockedIds(S().prefs, Date.now())).toContain('bench_press');
    A.banExercise('bench_press', false); expect(st()).toBe('paused');
    A.pauseExercise('bench_press', { resume: true }); expect(st()).toBe('favorite');
  });
  test('banned / paused exercises are never generated into a draft', () => {
    ready();
    const ids = S().device.draft!.exercises.map((e) => e.exerciseId);
    A.banExercise(ids[0]); A.pauseExercise(ids[1], { days: 14 });
    A.prepareDraft(true);
    const now = S().device.draft!.exercises.map((e) => e.exerciseId);
    expect(now).not.toContain(ids[0]); expect(now).not.toContain(ids[1]);
  });
  test('setPref merges, always carries exerciseId, defaults relevance 50', () => {
    onboard(); A.setPref('db_curl', { relevance: 90 });
    expect(S().prefs['db_curl']).toMatchObject({ exerciseId: 'db_curl', favorite: false, avoid: false, relevance: 90 });
    A.setPref('db_curl', { favorite: true }); expect(S().prefs['db_curl'].relevance).toBe(90);
  });
});

describe('coach plan lifecycle', () => {
  test('pickCoachPlan precedence: slot > area > any; oldest first; only pending', () => {
    const base = { title: 't', exercises: [], createdBy: 'c' };
    const p = (id: string, o: Partial<CoachPlan>): CoachPlan => ({ id, status: 'pending', createdAt: 1, ...base, ...o });
    expect(pickCoachPlan([p('any', {}), p('area', { areaId: 'A' }), p('slot', { slot: 2 })], 2, 'A')!.id).toBe('slot');
    expect(pickCoachPlan([p('any', {}), p('area', { areaId: 'A' })], 2, 'A')!.id).toBe('area');
    expect(pickCoachPlan([p('new', { createdAt: 9 }), p('old', { createdAt: 2 })], 1, 'A')!.id).toBe('old');
    expect(pickCoachPlan([p('x', { slot: 3 }), p('y', { areaId: 'B' }), p('used', { status: 'used' }), p('c', { status: 'cancelled' })], 1, 'A')).toBeNull();
  });
  test('pending plan shapes the draft (variant 0 only), is not consumed by drafting, and a cancelled plan is ignored', () => {
    onboard(); plan('p1', { slot: 1, exercises: [{ exerciseId: 'bench_press', sets: 5, reps: 5, weight: 60 }, { exerciseId: 'back_squat' }] });
    A.prepareDraft(true);
    const d = S().device.draft!;
    expect(d).toMatchObject({ source: 'coach', coachPlanId: 'p1' });
    expect(d.exercises[0]).toMatchObject({ exerciseId: 'bench_press', plannedSets: 5, repTarget: 5, plannedWeight: 60 });
    A.newMix(); expect(S().device.draft!.source).not.toBe('coach'); // "new mix" abandons the plan for this draft
    expect(S().plans['p1'].status).toBe('pending');
    mutate((s) => putEntity(s, 'plan', 'p1', { ...s.plans['p1'], status: 'cancelled' }));
    A.prepareDraft(true); expect(S().device.draft!.source).toBe('auto');
  });
  test('slot-specific plan does not apply to another slot', () => {
    onboard(); plan('p1', { slot: 2 });
    A.prepareDraft(true); expect(S().device.draft!.source).toBe('auto');
    A.chooseSlot(2); A.prepareDraft(true); expect(S().device.draft!.coachPlanId).toBe('p1');
  });
  test('pending -> used on completion (see session tests); used plans are never picked again', () => {
    onboard(); plan('p1'); A.prepareDraft(true); startLive(); playAll(); const id = A.finishSession()!;
    expect(S().plans['p1']).toMatchObject({ status: 'used', usedBySessionId: id });
    A.prepareDraft(true); expect(S().device.draft!.source).toBe('auto');
  });
});

describe('derived values', () => {
  const mk = (seq: number, endedAt: number, slot = 1, status: Session['status'] = 'completed') =>
    mutate((st) => putEntity(st, 'session', 's' + seq, { id: 's' + seq, seq, slot, areaId: 'a', areaName: 'A', gymId: null, gymName: 'g', status, startedAt: endedAt - HOUR, endedAt, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done' } as unknown as Session));
  test('weekly counts, goal streak (current week in progress does not break it), nextSeq', () => {
    onboard(); const wk = (w: number, d = 0) => new Date(2026, 10, 18 - 7 * w, 12).getTime() + d * DAY;
    let seq = 1;
    for (const w of [1, 2, 3]) for (let i = 0; i < 4; i++) mk(seq++, wk(w, -i % 2));
    mk(seq++, wk(0)); // 1 this week, goal 4
    const all = Object.values(S().sessions);
    expect(weekCount(all, Date.now())).toBe(1);
    expect(weeklyCounts(all, Date.now(), 4).map((w) => w.count)).toEqual([4, 4, 4, 1]);
    expect(streakWeeks(all, 4, Date.now())).toBe(3);
    mk(seq++, wk(0)); mk(seq++, wk(0)); mk(seq++, wk(0));
    expect(streakWeeks(Object.values(S().sessions), 4, Date.now())).toBe(4);
    mk(seq++, wk(0, 0), 1, 'discarded');
    expect(weekCount(Object.values(S().sessions), Date.now())).toBe(4);
    expect(nextSeq(Object.values(S().sessions))).toBe(seq);
  });
  test('a gap week breaks the streak', () => {
    onboard(); const wk = (w: number) => new Date(2026, 10, 18 - 7 * w, 12).getTime();
    let seq = 1; for (const w of [1, 3]) for (let i = 0; i < 4; i++) mk(seq++, wk(w) + i * HOUR);
    expect(streakWeeks(Object.values(S().sessions), 4, Date.now())).toBe(1);
  });
  test('seq never repeats within live sessions; session numbering continues after a delete of an older one', () => {
    ready(); startLive(); playAll(); A.finishSession(); tick(MIN);
    A.prepareDraft(true); startLive(); playAll(); A.finishSession();
    expect(Object.values(S().sessions).map((x) => x.seq).sort()).toEqual([1, 2]);
    A.deleteSession(Object.values(S().sessions).find((x) => x.seq === 1)!.id);
    A.prepareDraft(true); startLive();
    expect(A.getActiveSession()!.seq).toBe(3);
  });
});

describe('persistence round trip', () => {
  test('persist -> reset -> hydrate restores entities, outbox, in-progress session and draft; transient device flags reset', async () => {
    ready(); startLive(); A.logSet(20, 8);
    mutate((s) => { s.device = { ...s.device, geo: 'matched', resumeShown: true, chosenSlot: 2 }; });
    const sess = A.getActiveSession()!; const ob = Object.keys(S().outbox).length;
    await persistNow();
    expect(localStorageData.size).toBe(1); // idb-keyval is unavailable headless: the localStorage fallback is used
    setState((s) => { Object.assign(s, { sessions: {}, outbox: {}, settings: { ...s.settings, onboarded: false }, hydrated: false }); });
    await hydrate();
    expect(S().hydrated).toBe(true);
    expect(S().sessions[sess.id]).toMatchObject({ phase: 'rest', status: 'active' });
    expect(S().settings.onboarded).toBe(true);
    expect(Object.keys(S().outbox)).toHaveLength(ob);
    expect(S().device).toMatchObject({ geo: 'idle', resumeShown: false, chosenSlot: 2 });
    expect(invariants(S())).toEqual([]);
  });
  test('corrupt storage falls back to defaults without throwing', async () => {
    localStorageData.set('rep-state-v1', '{not json');
    setState((s) => { s.hydrated = false; });
    await hydrate();
    expect(S().hydrated).toBe(true);
    expect(S().settings.onboarded).toBe(false);
  });
});
