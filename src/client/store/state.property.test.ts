// Property-style randomized tests: seeded random action sequences against the REAL store, global invariants after every step.
// A failure prints the seed, the step and the last actions so it can be replayed: run(seed, steps).
import { describe, expect, test } from 'bun:test';
import { invariants, mulberry32, onboard, ready, S, tick, useHarness, SEC, MIN, DAY } from './state-kit';
import * as A from './actions';
import { libraryOf } from './actions';
import { mutate, putEntity, setState } from './core';
import { EQUIPMENT } from '../../shared/catalog';
import type { Feedback } from '../../shared/types';
useHarness();

type Rnd = () => number;
const pick = <T,>(r: Rnd, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const FBS: Feedback[] = [
  { effort: 'normal', weight: 'right', volume: 'ok' }, { effort: 'chill', weight: 'light', volume: 'reps' }, { effort: 'hard', weight: 'heavy', volume: 'sets' },
  { effort: 'normal', weight: 'light', volume: 'ok' }, { effort: 'hard', weight: 'right', volume: 'ok' },
];
const WEIRD = [NaN, Infinity, -5, 0, 0.5, 20, 22.5, 100];

function actions(r: Rnd): [string, () => unknown][] {
  const s = () => S();
  const exIds = () => libraryOf(s()).map((e) => e.id);
  const upcoming = () => (A.getActiveSession()?.exercises ?? []).filter((e) => e.status === 'todo' || e.status === 'dropped');
  const adjIds = () => (A.getActiveSession()?.adjustments ?? []).map((a) => a.id);
  const doneSessions = () => Object.values(s().sessions).filter((x) => x.status !== 'active');
  const gid = () => s().device.currentGymId ?? Object.keys(s().gyms)[0] ?? 'none';
  /** One step along the happy path, whatever phase we are in (biases the walk towards completed sessions). */
  const happy = () => {
    const a = A.getActiveSession();
    if (!a) { A.prepareDraft(); A.beginSession(); return; }
    if (a.phase === 'warmup') A.endWarmup();
    else if (a.phase === 'set') A.logSet(20, 8);
    else if (a.phase === 'rest') A.endRest();
    else if (a.phase === 'fb') A.saveFeedback(pick(r, FBS));
    else A.finishSession();
  };
  const H = Array.from({ length: 14 }, () => ['happy', happy] as [string, () => unknown]);
  return [
    ...H,
    ['prepareDraft', () => A.prepareDraft(r() < 0.3)], ['newMix', () => A.newMix()], ['prepareDraft', () => A.prepareDraft()],
    ['chooseSlot', () => A.chooseSlot(pick(r, [null, 1, 2, 3, 4, 5, 0, -1, 1.5]))],
    ['draftMove', () => A.draftMove(Math.floor(r() * 6), pick(r, [-1, 1] as const))],
    ['draftRemove', () => { const d = s().device.draft; if (d?.exercises.length) A.draftRemove(pick(r, d.exercises).id); }],
    ['draftAdd', () => A.draftAddExercise(pick(r, exIds()))],
    ['draftSwap', () => { const d = s().device.draft; if (d?.exercises.length) A.draftSwap(pick(r, d.exercises).id, pick(r, exIds())); }],
    ['draftTarget', () => A.draftSetTarget(Math.floor(r() * 200))],
    ['begin', () => A.beginSession()], ['begin', () => A.beginSession()], ['begin', () => A.beginSession()],
    ['endWarmup', () => A.endWarmup()], ['endWarmup', () => A.endWarmup()], ['toggleWarmup', () => A.toggleWarmupItem(Math.floor(r() * 4))],
    ['logSet', () => A.logSet(pick(r, WEIRD), pick(r, [0, 5, 8, 12, NaN, -1]))], ['logSet', () => A.logSet(20, 8)], ['logSet', () => A.logSet(20, 8)], ['logSet', () => A.logSet(22.5, 6)], ['logSet', () => A.logSet(20, 8)],
    ['endRest', () => A.endRest(r() < 0.5)], ['endRest', () => A.endRest()], ['endRest', () => A.endRest()],
    ['adjustRest', () => A.adjustRest(pick(r, [-30, 15, 30, -500, 500]))],
    ['undoLastSet', () => A.undoLastSet()], ['addSet', () => A.addSetToCurrent()], ['removeSet', () => A.removeSetFromCurrent()],
    ['saveFeedback', () => A.saveFeedback(pick(r, FBS))], ['saveFeedback', () => A.saveFeedback(pick(r, FBS))], ['saveFeedback', () => A.saveFeedback(pick(r, FBS))],
    ['skipCurrent', () => A.skipCurrent()],
    ['swap', () => {
      const a = A.getActiveSession(); if (!a) return;
      const e = a.exercises[a.cursor];
      const alts = e ? A.alternativesFor(e.exerciseId, a.exercises.map((q) => q.exerciseId), a.busyEquip) : [];
      A.swapCurrent(pick(r, ['busy', 'broken', 'gone'] as const), alts.length && r() < 0.9 ? pick(r, alts).exercise.id : pick(r, exIds()));
    }],
    ['drop', () => { const u = upcoming(); if (u.length) A.dropExercise(pick(r, u).id, r() < 0.7); }],
    ['move', () => { const u = upcoming(); if (u.length) A.moveUpcoming(pick(r, u).id, pick(r, [-1, 1] as const)); }],
    ['undoAdj', () => { const i = adjIds(); if (i.length) A.undoAdjustmentById(pick(r, i)); }],
    ['reapplyAdj', () => { const i = adjIds(); if (i.length) A.reapplyAdjustment(pick(r, i)); }],
    ['finish', () => { if (r() < 0.5) A.finishSession(); }], ['endSave', () => { if (r() < 0.3) A.endEarly('save', { repeatNext: r() < 0.5 }); }], ['endDiscard', () => { if (r() < 0.15) A.endEarly('discard'); }],
    ['deleteSession', () => { const d = doneSessions(); if (d.length && r() < 0.4) A.deleteSession(pick(r, d).id); }],
    ['setPref', () => A.setPref(pick(r, exIds()), pick(r, [{ favorite: true }, { favorite: false }, { relevance: 80 }, { avoid: true }, { avoid: false }, { notes: 'x' }]))],
    ['pause', () => A.pauseExercise(pick(r, exIds()), pick(r, [{ days: 7 }, { days: null }, { sessions: 1 }, { sessions: 2 }, { sessions: 0 }, { resume: true }]))],
    ['ban', () => A.banExercise(pick(r, exIds()), r() < 0.6)], ['fav', () => A.toggleFavorite(pick(r, exIds()))],
    ['equip', () => A.setEquipStatus(gid(), pick(r, EQUIPMENT).id, pick(r, ['ok', 'broken', 'none'] as const))],
    ['updateGym', () => A.updateGym(gid(), pick(r, [{ name: 'Renamed' }, { radiusM: 300 }, { equipment: {} }]))],
    ['addGym', () => { if (Object.keys(s().gyms).length < 4) A.addGym({ name: 'G' + Math.floor(r() * 99), template: pick(r, ['full', 'basic', 'home', 'empty'] as const), lat: r() < 0.5 ? 59.3 : null, lng: 18 }); }],
    ['deleteGym', () => { const g = Object.keys(s().gyms); if (g.length > 1 && r() < 0.3) A.deleteGym(pick(r, g)); }],
    ['chooseGym', () => { const g = Object.values(s().gyms).filter((x) => !x.deleted); if (g.length) A.chooseGym(pick(r, g).id); }],
    ['setRotation', () => { const ids = Object.keys(s().areas); if (ids.length) A.setRotation([...ids].sort(() => r() - 0.5).slice(0, 1 + Math.floor(r() * ids.length))); }],
    ['deleteArea', () => { const ids = Object.keys(s().areas); if (ids.length > 2 && r() < 0.2) A.deleteArea(pick(r, ids)); }],
    ['saveArea', () => { const a = Object.values(s().areas)[0]; if (a) A.saveArea({ ...a, exercisesPerSession: 3 + Math.floor(r() * 4) }); }],
    ['archive', () => { const c = Object.keys(s().exercises); if (c.length) A.archiveExercise(pick(r, c), r() < 0.5); }],
    ['saveExercise', () => A.saveExercise({ id: '', name: 'Custom ' + Math.floor(r() * 5), primary: ['Chest'], secondary: [], equipment: [], pattern: 'push', difficulty: 1, tracking: 'weight_reps', weightStep: 2.5, repMin: 6, repMax: 10, defaultSets: 3 })],
    ['coachPlan', () => mutate((st) => {
      const id = 'plan' + Math.floor(r() * 3); const ids = exIds();
      putEntity(st, 'plan', id, { id, title: 'P', exercises: [{ exerciseId: pick(r, ids), sets: 3 }, { exerciseId: pick(r, ids) }], status: 'pending', createdBy: 'coach', createdAt: Date.now(), slot: r() < 0.5 ? 1 : undefined });
    })],
    ['settings', () => A.updateSettings(pick(r, [{ unit: 'lb' as const }, { unit: 'kg' as const }, { fitToTime: r() < 0.5 }, { targetMinutes: pick(r, [20, 30, 45, 60]) }, { restSec: pick(r, [60, 90, 150]) }, { suggestSwaps: r() < 0.5 }]))],
    ['planner', () => A.updatePlanner({ jitter: r() })],
    ['note', () => { const x = Object.values(s().sessions); if (x.length) A.setSessionNote(pick(r, x).id, 'n'); }],
    ['time', () => tick(pick(r, [5 * SEC, 30 * SEC, 2 * MIN, 10 * MIN, 25 * MIN, 3 * 60 * MIN, DAY, 3 * DAY]))],
    ['time', () => tick(pick(r, [5 * SEC, 30 * SEC, 2 * MIN]))], ['time', () => tick(pick(r, [5 * SEC, 30 * SEC, 2 * MIN]))],
  ];
}

export function run(seed: number, steps: number) {
  onboard();
  const r = mulberry32(seed);
  const log: string[] = [];
  const acts = actions(r);
  for (let i = 0; i < steps; i++) {
    const [name, fn] = pick(r, acts);
    log.push(name);
    try { fn(); } catch (e) { throw new Error(`seed ${seed} step ${i} ${name} threw ${(e as Error).stack}\nlog: ${log.slice(-15).join(' > ')}`); }
    tick(1000);
    const bad = invariants(S(), { noSync: true });
    if (bad.length) throw new Error(`seed ${seed} step ${i} after ${name}: ${bad.slice(0, 5).join(' | ')}\nlog: ${log.slice(-25).join(' > ')}`);
  }
}

describe('random action sequences keep every invariant', () => {
  for (let seed = 1; seed <= 60; seed++) test(`seed ${seed} (250 steps)`, () => { run(seed, 250); });
  test('long runs (4 x 1500 steps) reach completed sessions', () => {
    let completed = 0, discarded = 0;
    for (const seed of [1001, 1002, 1003, 1004]) {
      setState((st) => { Object.assign(st, { sessions: {}, outbox: {}, gyms: {}, areas: {}, prefs: {}, plans: {}, progress: {}, exercises: {}, device: { ...st.device, draft: null, chosenSlot: null, currentGymId: null } }); });
      run(seed, 1500);
      const ss = Object.values(S().sessions);
      completed += ss.filter((x) => x.status === 'completed').length; discarded += ss.filter((x) => x.status === 'discarded').length;
    }
    console.log(`property coverage: ${completed} completed, ${discarded} discarded`);
    expect(completed).toBeGreaterThan(3);
  });
  test('unit switch never rewrites stored (kg) numbers', () => {
    ready(); A.beginSession(); A.endWarmup(); A.logSet(42.5, 5);
    A.updateSettings({ unit: 'lb' });
    expect(A.getActiveSession()!.exercises[0].sets[0].weight).toBe(42.5);
    A.updateSettings({ unit: 'kg' });
    expect(A.getActiveSession()!.exercises[0].sets[0].weight).toBe(42.5);
  });
});
