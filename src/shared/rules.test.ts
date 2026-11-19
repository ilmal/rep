import { describe, expect, test } from 'bun:test';
import { generateSession, scoreAll, DEFAULT_PLANNER, pickCoachPlan } from './planner';
import {
  autoAdjust, matchGyms, nextSlot, rankAlternatives, recommend, undoAdjustment, weekCount, weekStart,
  swapPrescription, isPR, availableEquipment,
} from './rules';
import { SEED_EXERCISES, SEED_BY_ID, AREA_TEMPLATES, areaFromTemplate } from './exercises';
import { templateEquipment } from './catalog';
import type { Gym, Session, SessionExercise, SetLog } from './types';

const gym = (equipment = templateEquipment('full')): Gym => ({
  id: 'g1', name: 'Test', lat: 59.34, lng: 18.05, radiusM: 150, equipment, notes: {}, brokenSince: {}, createdAt: 0,
});
const set = (weight: number, reps: number): SetLog => ({ weight, reps, doneAt: 0 });
let n = 0;
const newId = () => `id${++n}`;
const sess = (over: Partial<Session>): Session => ({
  id: newId(), seq: 1, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g1', gymName: 'Test', status: 'completed',
  startedAt: 0, endedAt: 1, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [],
  cursor: 0, phase: 'done', updatedAt: 0, ...over,
});

describe('week counter', () => {
  test('weekStart is Monday 00:00 local', () => {
    const wed = new Date(2026, 10, 18, 15, 30).getTime();
    const ws = new Date(weekStart(wed));
    expect(ws.getDay()).toBe(1);
    expect(ws.getHours()).toBe(0);
    expect(ws.getDate()).toBe(16);
  });
  test('Sunday belongs to the week that started the previous Monday', () => {
    const sun = new Date(2026, 10, 22, 23, 0).getTime();
    expect(new Date(weekStart(sun)).getDate()).toBe(16);
  });
  test('counts completed only, can exceed goal, discarded excluded', () => {
    const now = new Date(2026, 10, 18, 12).getTime();
    const mon = new Date(2026, 10, 16, 18).getTime();
    const list = [
      sess({ endedAt: mon }), sess({ endedAt: mon + 1 }), sess({ endedAt: mon + 2 }), sess({ endedAt: mon + 3 }),
      sess({ endedAt: mon + 4 }), sess({ endedAt: mon + 5, status: 'discarded' }),
      sess({ endedAt: new Date(2026, 10, 15, 12).getTime() }), // previous week
    ];
    expect(weekCount(list, now)).toBe(5);
  });
});

describe('rotation pointer', () => {
  test('starts at 1, follows last completed slot, wraps, ignores week', () => {
    expect(nextSlot([], 4)).toBe(1);
    expect(nextSlot([sess({ slot: 1, endedAt: 10 })], 4)).toBe(2);
    expect(nextSlot([sess({ slot: 1, endedAt: 10 }), sess({ slot: 4, endedAt: 20 })], 4)).toBe(1);
    // user chose slot 3 out of order: pointer continues after 3
    expect(nextSlot([sess({ slot: 1, endedAt: 10 }), sess({ slot: 3, endedAt: 20 })], 4)).toBe(4);
    expect(nextSlot([sess({ slot: 2, endedAt: 10, status: 'discarded' })], 4)).toBe(1);
    // ended early with "repeat next": pointer stays on the same slot
    expect(nextSlot([sess({ slot: 2, endedAt: 10, repeatNext: true })], 4)).toBe(2);
    expect(nextSlot([sess({ slot: 2, endedAt: 10, repeatNext: true }), sess({ slot: 2, endedAt: 20 })], 4)).toBe(3);
  });
});

describe('progression rules', () => {
  const ex = { tracking: 'weight_reps' as const, weightStep: 2.5, repMin: 5, repMax: 8 };
  const prev = { weight: 80, reps: 6, sets: 4 };
  const all6 = [set(80, 6), set(80, 6), set(80, 6), set(80, 6)];
  test('too light → +1 step', () => {
    const r = recommend(ex, prev, all6, { effort: 'normal', weight: 'light', volume: 'ok' });
    expect(r.weight).toBe(82.5);
    expect(r.kind).toBe('weight_up');
  });
  test('too heavy → −1 step even when chill', () => {
    const r = recommend(ex, prev, all6, { effort: 'chill', weight: 'heavy', volume: 'ok' });
    expect(r.weight).toBe(77.5);
  });
  test('just right + all hit → +1 rep', () => {
    const r = recommend(ex, prev, all6, { effort: 'normal', weight: 'right', volume: 'ok' });
    expect(r.reps).toBe(7);
    expect(r.weight).toBe(80);
  });
  test('just right but missed reps → hold', () => {
    const r = recommend(ex, prev, [set(80, 6), set(80, 5), set(80, 4), set(80, 4)], { effort: 'normal', weight: 'right', volume: 'ok' });
    expect(r.reps).toBe(6);
    expect(r.kind).toBe('hold');
  });
  test('top of range → +1 step, reps reset to min', () => {
    const r = recommend(ex, { weight: 80, reps: 8, sets: 4 }, [set(80, 8), set(80, 8), set(80, 8), set(80, 8)], { effort: 'normal', weight: 'right', volume: 'ok' });
    expect(r.weight).toBe(82.5);
    expect(r.reps).toBe(5);
  });
  test('chill holds progression', () => {
    const r = recommend(ex, prev, all6, { effort: 'chill', weight: 'light', volume: 'ok' });
    expect(r.weight).toBe(80);
    expect(r.reps).toBe(6);
    expect(r.kind).toBe('hold');
  });
  test('hard allows progression', () => {
    expect(recommend(ex, prev, all6, { effort: 'hard', weight: 'light', volume: 'ok' }).weight).toBe(82.5);
  });
  test('volume: too many reps −2, too many sets −1 (min 2)', () => {
    expect(recommend(ex, prev, all6, { effort: 'normal', weight: 'right', volume: 'reps' }).reps).toBe(5);
    expect(recommend(ex, prev, all6, { effort: 'normal', weight: 'right', volume: 'sets' }).sets).toBe(3);
    expect(recommend(ex, { ...prev, sets: 2 }, all6.slice(0, 2), { effort: 'normal', weight: 'right', volume: 'sets' }).sets).toBe(2);
  });
  test('rule version recorded', () => {
    expect(recommend(ex, prev, all6, { effort: 'normal', weight: 'right', volume: 'ok' }).ruleVersion).toBe(1);
  });
});

describe('geo', () => {
  test('matches inside radius, ranks by distance, ignores outside', () => {
    const a = gym(); const b = { ...gym(), id: 'g2', lat: 59.3405, lng: 18.0505 }; const far = { ...gym(), id: 'g3', lat: 59.5, lng: 18.5 };
    const m = matchGyms({ lat: 59.3401, lng: 18.0501 }, [far, b, a]);
    expect(m.map((x) => x.gym.id)).toEqual(['g1', 'g2']);
    expect(matchGyms({ lat: 0, lng: 0 }, [a])).toEqual([]);
  });
});

describe('generation + availability', () => {
  const lower = areaFromTemplate(AREA_TEMPLATES[1], 'lower');
  const base = { area: lower, library: SEED_EXERCISES, prefs: {}, progress: {}, sessions: [] as Session[], planner: DEFAULT_PLANNER, now: Date.now(), restSec: 90, targetMin: 60, warmupMin: 10, newId };
  test('only exercises available at the gym', () => {
    const eq = templateEquipment('full');
    delete eq.hack_squat; eq.leg_press = 'broken';
    const g = gym(eq);
    const r = generateSession({ ...base, gym: g });
    const avail = availableEquipment(g);
    expect(r.exercises.length).toBeGreaterThan(0);
    for (const e of r.exercises) expect(SEED_BY_ID[e.exerciseId].equipment.every((x) => avail.has(x))).toBe(true);
    expect(r.hiddenNames).toContain('Hack squat');
    expect(r.hiddenNames).toContain('Leg press');
  });
  test('pinned exercise included, count honoured', () => {
    const r = generateSession({ ...base, gym: gym() });
    expect(r.exercises.length).toBe(5);
    expect(r.exercises.some((e) => e.exerciseId === 'back_squat')).toBe(true);
  });
  test('home gym with no barbell still yields a session', () => {
    const r = generateSession({ ...base, gym: gym(templateEquipment('home')) });
    expect(r.exercises.length).toBeGreaterThan(0);
  });
  test('"new mix" variant changes the mix', () => {
    const a = generateSession({ ...base, gym: gym() }).exercises.map((e) => e.exerciseId).join();
    const b = generateSession({ ...base, gym: gym(), variant: 3 }).exercises.map((e) => e.exerciseId).join();
    expect(a).not.toBe(b);
  });
});

describe('hot-swap', () => {
  test('alternatives target the same muscles, are available, exclude busy equipment, top 4', () => {
    const g = gym();
    const avail = availableEquipment(g, ['seated_leg_curl']);
    const alts = rankAlternatives(SEED_BY_ID.seated_leg_curl, SEED_EXERCISES, avail, []);
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.length).toBeLessThanOrEqual(4);
    expect(alts[0].exercise.id).toBe('lying_leg_curl');
    for (const a of alts) {
      expect(a.exercise.primary.some((m) => SEED_BY_ID.seated_leg_curl.primary.includes(m))).toBe(true);
      expect(a.exercise.equipment.every((x) => avail.has(x))).toBe(true);
      expect(a.exercise.id).not.toBe('seated_leg_curl');
    }
    expect(alts.map((a) => a.match)).toEqual([...alts.map((a) => a.match)].sort((x, y) => y - x));
  });
  test('excludes ones already in the session', () => {
    const alts = rankAlternatives(SEED_BY_ID.seated_leg_curl, SEED_EXERCISES, availableEquipment(gym()), ['lying_leg_curl']);
    expect(alts.find((a) => a.exercise.id === 'lying_leg_curl')).toBeUndefined();
  });
  test('swap carries sets and rep target', () => {
    const from = { plannedSets: 3, repTarget: 12 } as SessionExercise;
    const rx = swapPrescription(from, SEED_BY_ID.lying_leg_curl, {});
    expect(rx.sets).toBe(3);
    expect(rx.reps).toBe(12);
  });
  test('none available → empty', () => {
    expect(rankAlternatives(SEED_BY_ID.seated_leg_curl, SEED_EXERCISES.filter((e) => e.equipment.length > 0), new Set(), [])).toEqual([]);
  });
});

describe('auto-adjust', () => {
  const mk = (id: string, est: number, status: SessionExercise['status'] = 'todo', pinned = false): SessionExercise => ({
    id, exerciseId: id, name: id, order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8,
    plannedSets: 3, repTarget: 8, plannedWeight: 20, restSec: 120, estSec: est, status, sets: [], pinned,
  });
  test('no change when within tolerance', () => {
    const r = autoAdjust({ now: 600_000, sessionStartedAt: 0, targetMin: 60, exercises: [mk('a', 600), mk('b', 600)], cursor: 0, newId });
    expect(r.applied).toBe(false);
  });
  test('trims rest first, then drops lowest priority, never the current exercise', () => {
    const exs = [mk('cur', 600, 'active'), mk('a', 900), mk('b', 900), mk('c', 900, 'todo', false)];
    const r = autoAdjust({ now: 3000_000, sessionStartedAt: 0, targetMin: 60, exercises: exs, cursor: 0, newId });
    expect(r.applied).toBe(true);
    expect(r.adjustments[0].type).toBe('trim_rest');
    expect(r.exercises.find((e) => e.id === 'cur')!.status).toBe('active');
    expect(r.exercises.some((e) => e.status === 'dropped')).toBe(true);
    // last unpinned dropped first
    expect(r.exercises.find((e) => e.id === 'c')!.status).toBe('dropped');
    expect(r.projectedEndSec - 3600).toBeLessThanOrEqual(300);
  });
  test('pinned dropped last', () => {
    const exs = [mk('cur', 100, 'active'), mk('p', 2400, 'todo', true), mk('x', 600)];
    const r = autoAdjust({ now: 3000_000, sessionStartedAt: 0, targetMin: 60, exercises: exs, cursor: 0, newId });
    expect(r.exercises.find((e) => e.id === 'x')!.status).toBe('dropped');
  });
  test('undo restores rest and dropped exercises', () => {
    const exs = [mk('cur', 600, 'active'), mk('a', 900), mk('c', 900)];
    const r = autoAdjust({ now: 3000_000, sessionStartedAt: 0, targetMin: 60, exercises: exs, cursor: 0, newId });
    let back = r.exercises;
    for (const a of r.adjustments) back = undoAdjustment(back, a);
    expect(back.map((e) => e.status)).toEqual(['active', 'todo', 'todo']);
    expect(back.map((e) => e.restSec)).toEqual([120, 120, 120]);
    expect(back.map((e) => e.estSec)).toEqual([600, 900, 900]);
  });
});

describe('PR detection', () => {
  const done = (w: number, r: number): SessionExercise => ({
    id: 'x', exerciseId: 'bench_press', name: 'Bench', order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8,
    plannedSets: 1, repTarget: r, plannedWeight: w, restSec: 90, estSec: 0, status: 'done', sets: [set(w, r)],
  });
  test('first time is baseline; heavier is PR', () => {
    const s1 = sess({ endedAt: 1, exercises: [done(60, 8)] });
    expect(isPR([], done(60, 8))).toBe(false);
    expect(isPR([s1], done(65, 8))).toBe(true);
    expect(isPR([s1], done(55, 8))).toBe(false);
  });
});

describe('planner scoring', () => {
  const lower = areaFromTemplate(AREA_TEMPLATES[1], 'lower');
  const NOW = new Date(2026, 10, 18, 12).getTime();
  const done = (ids: string[], daysAgo: number, slot = 2): Session =>
    sess({ slot, areaId: 'lower', endedAt: NOW - daysAgo * 86400000, startedAt: NOW - daysAgo * 86400000 - 3600000, exercises: ids.map((id) => ({
      id: newId(), exerciseId: id, name: id, order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8, plannedSets: 3, repTarget: 8,
      plannedWeight: 50, restSec: 90, estSec: 600, status: 'done', sets: [set(50, 8)],
    } as SessionExercise)) });
  const base = { area: lower, gym: gym(), library: SEED_EXERCISES, prefs: {}, progress: {}, planner: DEFAULT_PLANNER, now: NOW, restSec: 90, targetMin: 60, warmupMin: 10, newId };

  test('exercise done last session is not picked again directly', () => {
    const last = done(['back_squat', 'rdl', 'leg_press', 'leg_ext', 'hip_thrust'], 1);
    const r = generateSession({ ...base, sessions: [last] });
    const ids = r.exercises.map((e) => e.exerciseId);
    for (const x of ['rdl', 'leg_press', 'leg_ext', 'hip_thrust']) expect(ids).not.toContain(x);
    // pinned stays (explicit user choice)
    expect(ids).toContain('back_squat');
    expect(r.exercises.length).toBe(5);
  });
  test('cooling exercises are scored lower with an explanation', () => {
    const s = scoreAll({ library: SEED_EXERCISES, prefs: {}, sessions: [done(['leg_press'], 1)], planner: DEFAULT_PLANNER, now: NOW, area: lower });
    const lp = s.find((x) => x.exerciseId === 'leg_press')!;
    expect(lp.coolingDown).toBe(true);
    expect(lp.reasons.join(' ')).toMatch(/Cooling down/);
    expect(lp.total).toBeLessThan(s.find((x) => x.exerciseId === 'hack_squat')!.total);
  });
  test('relevance and favorite raise the score; avoid excludes from auto picks', () => {
    const none = scoreAll({ library: SEED_EXERCISES, prefs: {}, sessions: [], planner: DEFAULT_PLANNER, now: NOW, area: lower });
    const tuned = scoreAll({ library: SEED_EXERCISES, prefs: { goblet_squat: { exerciseId: 'goblet_squat', favorite: true, avoid: false, relevance: 100 } }, sessions: [], planner: DEFAULT_PLANNER, now: NOW, area: lower });
    expect(tuned.find((x) => x.exerciseId === 'goblet_squat')!.total).toBeGreaterThan(none.find((x) => x.exerciseId === 'goblet_squat')!.total);
    const r = generateSession({ ...base, sessions: [], prefs: { leg_ext: { exerciseId: 'leg_ext', favorite: true, avoid: true, relevance: 100 } } });
    expect(r.exercises.map((e) => e.exerciseId)).not.toContain('leg_ext');
  });
  test('rotates: consecutive generations cover different exercises', () => {
    let sessions: Session[] = [];
    const seen = new Set<string>();
    for (let d = 8; d >= 1; d -= 2) {
      const r = generateSession({ ...base, sessions, now: NOW - (d - 1) * 86400000 });
      r.exercises.forEach((e) => seen.add(e.exerciseId));
      sessions = [...sessions, done(r.exercises.map((e) => e.exerciseId), d)];
    }
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });
  test('coach plan is used, hot-swapped when equipment is missing', () => {
    const eq = templateEquipment('full'); delete eq.hack_squat;
    const plan = { id: 'p1', title: 'Quad day', note: 'Go heavy', status: 'pending' as const, createdBy: 'grok', createdAt: 1, exercises: [{ exerciseId: 'hack_squat', sets: 5, reps: 6 }, { exerciseId: 'leg_ext', sets: 2 }] };
    const r = generateSession({ ...base, gym: gym(eq), sessions: [], coachPlan: plan });
    expect(r.source).toBe('coach');
    expect(r.coachNote).toBe('Go heavy');
    expect(r.exercises.length).toBe(2);
    expect(r.exercises[0].exerciseId).not.toBe('hack_squat');
    expect(r.exercises[0].plannedSets).toBe(5);
    expect(r.exercises[1].plannedSets).toBe(2);
    expect(pickCoachPlan([plan], 2, 'lower')?.id).toBe('p1');
    expect(pickCoachPlan([{ ...plan, status: 'used' as const }], 2, 'lower')).toBeNull();
  });
});
