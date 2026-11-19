// Mutation-killing tests for rules.ts: exact boundaries, exact strings and exact numeric results.
import { describe, expect, test } from 'bun:test';
import {
  FALLBACK_SET_SEC, MIN_REST_SEC, OVERRUN_TOLERANCE_SEC, RULES_VERSION, autoAdjust, availableEquipment, completed, defaultPrescription,
  defaultStartWeight, e1rm, estimateExerciseSec, exerciseHistory, exerciseSeconds, fbIncomplete, fmtWeight, haversineM, isAvailable, isPR,
  isoWeek, matchGyms, median, missingEquipment, nextSeq, nextSlot, prescriptionFor, rankAlternatives, recommend, round1, sessionDurationSec,
  sessionsInWeek, streakWeeks, swapPrescription, toSessionExercise, topWeight, totalPlannedSec, undoAdjustment, volumeOf, warmupMedianSec,
  weekCount, weekStart, weeklyCounts,
} from './rules';
import type { Exercise, Gym, Session, SessionExercise, SetLog } from './types';

let n = 0;
const newId = () => `id${++n}`;
const set = (weight: number, reps: number): SetLog => ({ weight, reps, doneAt: 0 });
const sess = (over: Partial<Session>): Session => ({
  id: newId(), seq: 1, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g1', gymName: 'Test', status: 'completed',
  startedAt: 0, endedAt: 1, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [],
  cursor: 0, phase: 'done', updatedAt: 0, ...over,
});
const sx = (over: Partial<SessionExercise> = {}): SessionExercise => ({
  id: over.id ?? newId(), exerciseId: 'bench', name: over.id ?? 'Bench', order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8,
  plannedSets: 3, repTarget: 8, plannedWeight: 20, restSec: 120, estSec: 600, status: 'todo', sets: [], pinned: false, ...over,
});
const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'e', name: 'E', primary: ['Chest'], secondary: [], equipment: [], pattern: 'push', difficulty: 2, tracking: 'weight_reps',
  weightStep: 2.5, repMin: 5, repMax: 8, defaultSets: 3, ...over,
});
const D = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, m, d, h, mi, s, ms).getTime();

describe('constants', () => {
  test('values', () => {
    expect(RULES_VERSION).toBe(1);
    expect(MIN_REST_SEC).toBe(60);
    expect(OVERRUN_TOLERANCE_SEC).toBe(300);
    expect(FALLBACK_SET_SEC).toBe(45);
  });
});

describe('helpers', () => {
  test('round1 / fmtWeight', () => {
    expect(round1(1.25)).toBe(1.3);
    expect(round1(1.24)).toBe(1.2);
    expect(round1(2)).toBe(2);
    expect(round1(-1.26)).toBe(-1.3);
    expect(fmtWeight(2.5)).toBe('2.5');
    expect(fmtWeight(5)).toBe('5');
    expect(fmtWeight(2.54)).toBe('2.5');
  });
  test('median', () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([10, 0])).toBe(5);
    expect(median([1, 100, 2, 3, 4, 5, 6])).toBe(4);
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]); // input not mutated
  });
});

describe('weekStart / isoWeek / sessionsInWeek', () => {
  test('every weekday of a week maps to its Monday 00:00:00.000', () => {
    for (let day = 16; day <= 22; day++) {
      const w = new Date(weekStart(D(2026, 10, day, 13, 45, 12, 345)));
      expect(w.getFullYear()).toBe(2026);
      expect(w.getMonth()).toBe(10);
      expect(w.getDate()).toBe(16);
      expect([w.getHours(), w.getMinutes(), w.getSeconds(), w.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    }
  });
  test('week edges: Monday 00:00:00.000 starts, Sunday 23:59:59.999 still previous', () => {
    expect(weekStart(D(2026, 10, 16))).toBe(D(2026, 10, 16));
    expect(weekStart(D(2026, 10, 16, 0, 0, 0, 1))).toBe(D(2026, 10, 16));
    expect(weekStart(D(2026, 10, 15, 23, 59, 59, 999))).toBe(D(2026, 10, 9));
    expect(weekStart(D(2026, 10, 22, 23, 59, 59, 999))).toBe(D(2026, 10, 16));
    expect(weekStart(D(2026, 10, 23))).toBe(D(2026, 10, 23));
  });
  test('weekStart crosses month and year', () => {
    expect(weekStart(D(2027, 0, 1, 12))).toBe(D(2026, 11, 28));
    expect(weekStart(D(2026, 2, 1, 12))).toBe(D(2026, 1, 23));
  });
  test('isoWeek matches an independent day-of-year reference for 3 years', () => {
    const ref = (y: number, m: number, d: number) => {
      const t = new Date(Date.UTC(y, m, d));
      const dn = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dn + 3); // Thursday of this week
      const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
      return Math.floor((t.getTime() - jan1) / 86400000 / 7) + 1;
    };
    for (let day = new Date(2024, 0, 1); day.getFullYear() < 2027; day.setDate(day.getDate() + 1)) {
      const y = day.getFullYear(), m = day.getMonth(), dd = day.getDate();
      expect(isoWeek(new Date(y, m, dd, 15, 30).getTime())).toBe(ref(y, m, dd));
      expect(isoWeek(new Date(y, m, dd, 0, 0, 0, 0).getTime())).toBe(ref(y, m, dd));
      expect(isoWeek(new Date(y, m, dd, 23, 59, 59, 999).getTime())).toBe(ref(y, m, dd));
    }
  });
  test('isoWeek known values', () => {
    expect(isoWeek(D(2026, 10, 18, 12))).toBe(47);
    expect(isoWeek(D(2026, 0, 1))).toBe(1);
    expect(isoWeek(D(2025, 11, 29))).toBe(1);
    expect(isoWeek(D(2027, 0, 1))).toBe(53);
    expect(isoWeek(D(2026, 11, 31))).toBe(53);
    expect(isoWeek(D(2024, 11, 30))).toBe(1);
  });
  test('completed filters by status', () => {
    const list = [sess({ status: 'completed' }), sess({ status: 'active' }), sess({ status: 'discarded' })];
    expect(completed(list)).toHaveLength(1);
    expect(completed([])).toEqual([]);
  });
  test('sessionsInWeek: [Mon 00:00, next Mon 00:00) half-open, endedAt ?? startedAt', () => {
    const mon = D(2026, 10, 16), nextMon = D(2026, 10, 23);
    const now = D(2026, 10, 18, 12);
    const at = (t: number) => sess({ endedAt: t, startedAt: t - 1000 });
    expect(sessionsInWeek([at(mon)], now)).toHaveLength(1);
    expect(sessionsInWeek([at(mon - 1)], now)).toHaveLength(0);
    expect(sessionsInWeek([at(nextMon - 1)], now)).toHaveLength(1);
    expect(sessionsInWeek([at(nextMon)], now)).toHaveLength(0);
    // endedAt missing -> startedAt used
    expect(sessionsInWeek([sess({ endedAt: undefined, startedAt: mon + 5 })], now)).toHaveLength(1);
    expect(sessionsInWeek([sess({ endedAt: undefined, startedAt: mon - 5 })], now)).toHaveLength(0);
    // endedAt (not startedAt) decides
    expect(sessionsInWeek([sess({ startedAt: mon - 5000, endedAt: mon + 5 })], now)).toHaveLength(1);
    expect(sessionsInWeek([sess({ startedAt: mon + 5, endedAt: nextMon + 5 })], now)).toHaveLength(0);
    // non-completed ignored
    expect(sessionsInWeek([sess({ status: 'active', endedAt: mon + 5 })], now)).toHaveLength(0);
    expect(weekCount([at(mon), at(mon + 10), at(nextMon)], now)).toBe(2);
  });
});

describe('rotation', () => {
  test('nextSlot edge cases', () => {
    expect(nextSlot([sess({ slot: 1, endedAt: 5 })], 0)).toBe(1);
    expect(nextSlot([sess({ slot: 1, endedAt: 5 })], -3)).toBe(1);
    expect(nextSlot([sess({ slot: 3, endedAt: 5 })], 3)).toBe(1);
    expect(nextSlot([sess({ slot: 2, endedAt: 5 })], 3)).toBe(3);
    // newest by endedAt wins regardless of array order
    expect(nextSlot([sess({ slot: 1, endedAt: 50 }), sess({ slot: 2, endedAt: 10 })], 4)).toBe(2);
    expect(nextSlot([sess({ slot: 2, endedAt: 10 }), sess({ slot: 1, endedAt: 50 })], 4)).toBe(2);
    // repeatNext: stays on same slot, only while slot is still within the rotation
    expect(nextSlot([sess({ slot: 4, endedAt: 5, repeatNext: true })], 4)).toBe(4);
    expect(nextSlot([sess({ slot: 5, endedAt: 5, repeatNext: true })], 4)).toBe(2);
    expect(nextSlot([sess({ slot: 2, endedAt: 5, repeatNext: false })], 4)).toBe(3);
    // does not mutate the caller's array order
    const list = [sess({ slot: 1, endedAt: 5 }), sess({ slot: 2, endedAt: 50 })];
    nextSlot(list, 4);
    expect(list.map((s) => s.slot)).toEqual([1, 2]);
    // missing endedAt counts as 0 (oldest)
    expect(nextSlot([sess({ slot: 1, endedAt: undefined }), sess({ slot: 3, endedAt: 1 })], 4)).toBe(4);
    expect(nextSlot([sess({ slot: 3, endedAt: 1 }), sess({ slot: 1, endedAt: undefined })], 4)).toBe(4);
  });
  test('nextSeq', () => {
    expect(nextSeq([])).toBe(1);
    expect(nextSeq([sess({ seq: 7 }), sess({ seq: 3 })])).toBe(8);
    expect(nextSeq([sess({ seq: 3 }), sess({ seq: 7 }), sess({ seq: 5 })])).toBe(8);
  });
});

describe('geo', () => {
  const sphere = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const r = (x: number) => (x * Math.PI) / 180;
    return 6371000 * Math.acos(Math.sin(r(a.lat)) * Math.sin(r(b.lat)) + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng)));
  };
  test('haversine agrees with an independent formula', () => {
    const pts = [
      [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }], [{ lat: 60, lng: 10 }, { lat: 60, lng: 11 }],
      [{ lat: 59.34, lng: 18.05 }, { lat: 59.3405, lng: 18.0505 }], [{ lat: 59.33, lng: 18.06 }, { lat: 57.7, lng: 11.97 }],
      [{ lat: -30, lng: 150 }, { lat: 40, lng: -70 }], [{ lat: 10, lng: 10 }, { lat: -10, lng: -10 }],
    ] as const;
    for (const [a, b] of pts) {
      expect(Math.abs(haversineM(a, b) - sphere(a, b))).toBeLessThan(0.5);
      expect(haversineM(b, a)).toBeCloseTo(haversineM(a, b), 6);
    }
    expect(haversineM({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111194.93, 1);
    // latitude only
    expect(haversineM({ lat: 10, lng: 5 }, { lat: 11, lng: 5 })).toBeCloseTo(111194.93, 1);
  });

  const gymAt = (over: Partial<Gym> = {}): Gym => ({ id: 'g', name: 'G', lat: 59, lng: 18, radiusM: 100, equipment: {}, notes: {}, brokenSince: {}, createdAt: 0, ...over });
  const POS = { lat: 59, lng: 18 };
  const north = (m: number) => ({ lat: 59 + m / 111194.9266, lng: 18 }); // ~m metres north of POS

  test('fence boundary is inclusive', () => {
    const g = gymAt({ lat: north(100).lat, radiusM: 0 });
    const d = haversineM(POS, { lat: g.lat!, lng: g.lng! });
    expect(matchGyms(POS, [{ ...g, radiusM: d }])).toHaveLength(1);
    expect(matchGyms(POS, [{ ...g, radiusM: d - 0.001 }])).toHaveLength(0);
    expect(matchGyms(POS, [{ ...g, radiusM: d + 0.001 }])).toHaveLength(1);
  });
  test('accuracy widens the fence but is capped at 50 m', () => {
    const g = gymAt({ lat: north(125).lat, radiusM: 100 });
    expect(matchGyms({ ...POS, accuracyM: 30 }, [g])).toHaveLength(1); // fence 130
    expect(matchGyms({ ...POS, accuracyM: 20 }, [g])).toHaveLength(0); // fence 120
    expect(matchGyms(POS, [g])).toHaveLength(0);
    expect(matchGyms({ ...POS, accuracyM: 0 }, [g])).toHaveLength(0);
    const far = gymAt({ lat: north(160).lat, radiusM: 100 });
    expect(matchGyms({ ...POS, accuracyM: 100 }, [far])).toHaveLength(0); // fence 150, not 200
    const mid = gymAt({ lat: north(145).lat, radiusM: 100 });
    expect(matchGyms({ ...POS, accuracyM: 100 }, [mid])).toHaveLength(1);
    expect(matchGyms({ ...POS, accuracyM: 50 }, [mid])).toHaveLength(1);
    expect(matchGyms({ ...POS, accuracyM: 40 }, [mid])).toHaveLength(0);
  });
  test('confidence = 1 - d/fence, results sorted nearest first, distance reported', () => {
    const a = gymAt({ id: 'a', lat: north(50).lat, radiusM: 100 });
    const b = gymAt({ id: 'b', lat: north(20).lat, radiusM: 40 });
    const c = gymAt({ id: 'c', lat: 59, radiusM: 100 });
    const m = matchGyms({ ...POS, accuracyM: 10 }, [a, b, c]);
    expect(m.map((x) => x.gym.id)).toEqual(['c', 'b', 'a']);
    expect(m[0].distanceM).toBe(0);
    expect(m[0].confidence).toBe(1);
    expect(m[1].distanceM).toBeCloseTo(20, 2);
    expect(m[1].confidence).toBeCloseTo(1 - 20 / 50, 6);
    expect(m[2].confidence).toBeCloseTo(1 - 50 / 110, 6);
    // order of input does not matter
    expect(matchGyms(POS, [c, a, b]).map((x) => x.gym.id)).toEqual(['c', 'b', 'a']);
  });
  test('deleted gyms and gyms without coordinates are skipped; 0,0 is a valid coordinate', () => {
    expect(matchGyms(POS, [gymAt({ deleted: true })])).toHaveLength(0);
    expect(matchGyms(POS, [gymAt({ lat: undefined })])).toHaveLength(0);
    expect(matchGyms(POS, [gymAt({ lng: undefined })])).toHaveLength(0);
    expect(matchGyms(POS, [gymAt({ lat: null as never })])).toHaveLength(0);
    // a null coordinate must not be read as 0 (position 0,0 would otherwise sit on top of the gym)
    expect(matchGyms({ lat: 0, lng: 0 }, [gymAt({ lat: null as never, lng: 0 })])).toHaveLength(0);
    expect(matchGyms({ lat: 0, lng: 0 }, [gymAt({ lat: 0, lng: null as never })])).toHaveLength(0);
    expect(matchGyms({ lat: 0, lng: 0 }, [gymAt({ deleted: true, lat: 0, lng: 0 })])).toHaveLength(0);
    expect(matchGyms({ lat: 0, lng: 0 }, [gymAt({ lat: 0, lng: 0 })])).toHaveLength(1);
    expect(matchGyms({ lat: 0, lng: 0 }, [gymAt({ lat: 0, lng: 0, radiusM: 0 })])).toHaveLength(1); // d=0 <= fence=0
  });
});

describe('availability', () => {
  test('availableEquipment', () => {
    const g = { equipment: { a: 'ok', b: 'broken', c: 'ok', d: 'none' } } as unknown as Gym;
    expect([...availableEquipment(g)].sort()).toEqual(['a', 'c']);
    expect([...availableEquipment(g, ['a'])]).toEqual(['c']);
    expect([...availableEquipment(g, ['zzz'])].sort()).toEqual(['a', 'c']);
    expect(availableEquipment(null).size).toBe(0);
    expect(availableEquipment(undefined, ['a']).size).toBe(0);
  });
  test('isAvailable / missingEquipment', () => {
    const e = ex({ equipment: ['a', 'b'] });
    expect(isAvailable(e, new Set(['a', 'b', 'c']))).toBe(true);
    expect(isAvailable(e, new Set(['a']))).toBe(false);
    expect(isAvailable(ex({ equipment: [] }), new Set())).toBe(true);
    expect(missingEquipment(e, new Set(['a']))).toEqual(['b']);
    expect(missingEquipment(e, new Set(['a', 'b']))).toEqual([]);
    expect(missingEquipment(e, new Set())).toEqual(['a', 'b']);
  });
});

describe('recommend: exact outputs', () => {
  const wr = { tracking: 'weight_reps' as const, weightStep: 2.5, repMin: 5, repMax: 8 };
  const prev = { weight: 80, reps: 6, sets: 4 };
  const hit = [set(80, 6), set(80, 6), set(80, 6), set(80, 6)];
  const OK = { effort: 'normal', weight: 'right', volume: 'ok' } as const;
  const fb = (o: Partial<{ effort: 'chill' | 'normal' | 'hard'; weight: 'light' | 'right' | 'heavy'; volume: 'ok' | 'reps' | 'sets' }>) => ({ ...OK, ...o });

  test('too light (weight_reps)', () => {
    expect(recommend(wr, prev, hit, fb({ weight: 'light' }))).toEqual({
      weight: 82.5, reps: 6, sets: 4, kind: 'weight_up', tag: '+2.5 kg', why: 'Too light: +2.5 kg.', ruleVersion: 1,
    });
  });
  test('too heavy (weight_reps), uses unicode minus', () => {
    expect(recommend(wr, prev, hit, fb({ weight: 'heavy' }))).toEqual({
      weight: 77.5, reps: 6, sets: 4, kind: 'weight_down', tag: '−2.5 kg', why: 'Too heavy: −2.5 kg.', ruleVersion: 1,
    });
  });
  test('weight never below 0; weightStep 0 falls back to 2.5; rounds to 0.1', () => {
    expect(recommend(wr, { ...prev, weight: 1 }, hit, fb({ weight: 'heavy' })).weight).toBe(0);
    expect(recommend(wr, { ...prev, weight: 0 }, hit, fb({ weight: 'heavy' })).weight).toBe(0);
    expect(recommend({ ...wr, weightStep: 0 }, prev, hit, fb({ weight: 'light' })).weight).toBe(82.5);
    expect(recommend({ ...wr, weightStep: 1.25 }, { ...prev, weight: 10.05 }, hit, fb({ weight: 'light' })).weight).toBe(11.3);
    expect(recommend({ ...wr, weightStep: 1.25 }, prev, hit, fb({ weight: 'light' })).why).toBe('Too light: +1.3 kg.');
    expect(recommend({ ...wr, weightStep: 1 }, prev, hit, fb({ weight: 'light' })).tag).toBe('+1 kg');
  });
  test('reps tracking: light/heavy change reps by 1, floor 1, unit "reps"', () => {
    const r = { tracking: 'reps' as const, weightStep: 0, repMin: 8, repMax: 20 };
    const p = { weight: 0, reps: 10, sets: 3 };
    const sets = [set(0, 10), set(0, 10), set(0, 10)];
    expect(recommend(r, p, sets, fb({ weight: 'light' }))).toEqual({ weight: 0, reps: 11, sets: 3, kind: 'weight_up', tag: '+1 reps', why: 'Too light: +1 reps.', ruleVersion: 1 });
    expect(recommend(r, p, sets, fb({ weight: 'heavy' }))).toEqual({ weight: 0, reps: 9, sets: 3, kind: 'weight_down', tag: '−1 reps', why: 'Too heavy: −1 reps.', ruleVersion: 1 });
    expect(recommend(r, { ...p, reps: 1 }, sets, fb({ weight: 'heavy' })).reps).toBe(1);
    expect(recommend(r, { ...p, reps: 2 }, sets, fb({ weight: 'heavy' })).reps).toBe(1);
  });
  test('time tracking: step 5 s, unit "s"', () => {
    const t = { tracking: 'time' as const, weightStep: 0, repMin: 30, repMax: 90 };
    const p = { weight: 0, reps: 40, sets: 3 };
    const sets = [set(0, 40), set(0, 40), set(0, 40)];
    expect(recommend(t, p, sets, fb({ weight: 'light' }))).toEqual({ weight: 0, reps: 45, sets: 3, kind: 'weight_up', tag: '+5 s', why: 'Too light: +5 s.', ruleVersion: 1 });
    expect(recommend(t, p, sets, fb({ weight: 'heavy' }))).toEqual({ weight: 0, reps: 35, sets: 3, kind: 'weight_down', tag: '−5 s', why: 'Too heavy: −5 s.', ruleVersion: 1 });
    expect(recommend(t, p, sets, fb({})).reps).toBe(45); // all hit: +5 s
    expect(recommend(t, p, sets, fb({})).tag).toBe('+5 s');
    expect(recommend(t, p, sets, fb({})).why).toBe('Just right, all sets hit: +5 s.');
    expect(recommend(t, p, sets, fb({})).kind).toBe('rep_up');
    // volume "reps" never applies to time exercises
    expect(recommend(t, p, [set(0, 10)], fb({ volume: 'reps' }))).toMatchObject({ reps: 40, kind: 'hold', tag: 'Hold', why: 'Not every set hit target: hold the same.' });
  });
  test('chill holds unless heavy', () => {
    const r = recommend(wr, prev, hit, fb({ effort: 'chill' }));
    expect(r).toEqual({ weight: 80, reps: 6, sets: 4, kind: 'hold', tag: 'Hold', why: 'Held: you took it easy today.', ruleVersion: 1 });
    expect(recommend(wr, prev, hit, fb({ effort: 'chill', weight: 'light' })).kind).toBe('hold');
    expect(recommend(wr, prev, hit, fb({ effort: 'chill', weight: 'heavy' })).kind).toBe('weight_down');
    expect(recommend(wr, prev, hit, fb({ effort: 'hard' })).kind).toBe('rep_up');
    expect(recommend(wr, prev, hit, fb({ effort: 'hard', weight: 'heavy' })).kind).toBe('weight_down');
  });
  test('just right: all sets hit boundary (>= prev.reps), empty sets is not a hit', () => {
    expect(recommend(wr, prev, hit, OK)).toEqual({ weight: 80, reps: 7, sets: 4, kind: 'rep_up', tag: '+1 rep', why: 'Just right, all sets hit: +1 rep.', ruleVersion: 1 });
    expect(recommend(wr, prev, [set(80, 7), set(80, 6)], OK).kind).toBe('rep_up'); // 7 >= 6 and 6 >= 6
    expect(recommend(wr, prev, [set(80, 6), set(80, 5)], OK)).toMatchObject({ kind: 'hold', reps: 6, tag: 'Hold', why: 'Not every set hit target: hold the same.' });
    expect(recommend(wr, prev, [], OK)).toMatchObject({ kind: 'hold', reps: 6, why: 'Not every set hit target: hold the same.' });
  });
  test('top of range: reps >= repMax; weight_reps bumps weight and resets reps; others hold', () => {
    const top = { weight: 80, reps: 8, sets: 3 };
    const s8 = [set(80, 8), set(80, 8), set(80, 8)];
    expect(recommend(wr, top, s8, OK)).toEqual({ weight: 82.5, reps: 5, sets: 3, kind: 'weight_up', tag: '+2.5 kg', why: 'Top of the range: +2.5 kg, reps reset.', ruleVersion: 1 });
    // reps beyond max also counts as top
    expect(recommend(wr, { ...top, reps: 9 }, [set(80, 9)], OK).reps).toBe(5);
    // one below max: simple +1 rep
    expect(recommend(wr, { ...top, reps: 7 }, [set(80, 7)], OK)).toMatchObject({ reps: 8, weight: 80, kind: 'rep_up' });
    // step default and rounding
    expect(recommend({ ...wr, weightStep: 0 }, top, s8, OK).weight).toBe(82.5);
    expect(recommend({ ...wr, weightStep: 1.25 }, { ...top, weight: 10.05 }, s8, OK).weight).toBe(11.3);
    const r = { tracking: 'reps' as const, weightStep: 0, repMin: 8, repMax: 20 };
    expect(recommend(r, { weight: 0, reps: 20, sets: 3 }, [set(0, 20)], OK, { tempo: true })).toEqual({ weight: 0, reps: 20, sets: 3, kind: 'hold', tag: 'Hold', why: 'Top of the range: you are at the ceiling. Hold.', ruleVersion: 1, tempo: true });
    expect(recommend({ ...r, tracking: 'time' }, { weight: 0, reps: 20, sets: 3 }, [set(0, 20)], OK)).toEqual({ weight: 0, reps: 20, sets: 3, kind: 'hold', tag: 'Hold', why: 'Top of the range: you are at the ceiling. Hold.', ruleVersion: 1 });
    const t = { tracking: 'time' as const, weightStep: 0, repMin: 30, repMax: 60 };
    expect(recommend(t, { weight: 0, reps: 60, sets: 3 }, [set(0, 60)], OK)).toMatchObject({ reps: 60, kind: 'hold', why: 'Top of the range: you are at the ceiling. Hold.' });
    expect(recommend(r, { weight: 0, reps: 19, sets: 3 }, [set(0, 19)], OK)).toMatchObject({ reps: 20, kind: 'rep_up', tag: '+1 rep' });
  });
  test('volume: too many reps (-2, floor min(3,repMin)) and sets (-1, floor 2)', () => {
    const v = recommend(wr, prev, [set(80, 5)], fb({ volume: 'reps' })); // hold at 6 -> 4
    expect(v).toEqual({ weight: 80, reps: 4, sets: 4, kind: 'volume_down', tag: '−2 reps', why: 'Not every set hit target: hold the same. Fewer reps.', ruleVersion: 1 });
    expect(recommend(wr, prev, hit, fb({ volume: 'reps' }))).toMatchObject({ reps: 5, kind: 'rep_up', tag: '+1 rep', why: 'Just right, all sets hit: +1 rep. Fewer reps.' });
    // floor: min(3, repMin)
    expect(recommend({ ...wr, repMin: 8 }, { ...prev, reps: 5 }, [set(80, 1)], fb({ volume: 'reps' })).reps).toBe(3);
    expect(recommend({ ...wr, repMin: 2 }, { ...prev, reps: 3 }, [set(80, 1)], fb({ volume: 'reps' })).reps).toBe(2);
    expect(recommend({ ...wr, repMin: 2 }, { ...prev, reps: 4 }, [set(80, 1)], fb({ volume: 'reps' })).reps).toBe(2);
    expect(recommend({ ...wr, repMin: 3 }, { ...prev, reps: 6 }, [set(80, 1)], fb({ volume: 'reps' })).reps).toBe(4);
    const s = recommend(wr, prev, [set(80, 5)], fb({ volume: 'sets' }));
    expect(s).toEqual({ weight: 80, reps: 6, sets: 3, kind: 'volume_down', tag: '−1 set', why: 'Not every set hit target: hold the same. One set less.', ruleVersion: 1 });
    expect(recommend(wr, { ...prev, sets: 3 }, hit, fb({ volume: 'sets' })).sets).toBe(2);
    expect(recommend(wr, { ...prev, sets: 2 }, hit, fb({ volume: 'sets' })).sets).toBe(2);
    expect(recommend(wr, { ...prev, sets: 1 }, hit, fb({ volume: 'sets' })).sets).toBe(2);
    expect(recommend(wr, prev, hit, fb({ volume: 'sets' }))).toMatchObject({ kind: 'rep_up', tag: '+1 rep', sets: 3, why: 'Just right, all sets hit: +1 rep. One set less.' });
    expect(recommend(wr, prev, hit, fb({ weight: 'light', volume: 'sets' }))).toMatchObject({ kind: 'weight_up', sets: 3, why: 'Too light: +2.5 kg. One set less.' });
    expect(recommend(wr, prev, hit, fb({ weight: 'light', volume: 'reps' }))).toMatchObject({ kind: 'weight_up', reps: 4, why: 'Too light: +2.5 kg. Fewer reps.' });
    // chill + volume reps: held, then volume_down
    expect(recommend(wr, prev, hit, fb({ effort: 'chill', volume: 'reps' }))).toMatchObject({ kind: 'volume_down', tag: '−2 reps', reps: 4 });
    // volume 'ok' never touches reps/sets
    expect(recommend(wr, prev, hit, fb({ volume: 'ok' })).sets).toBe(4);
    // reps tracking + volume reps
    const r = { tracking: 'reps' as const, weightStep: 0, repMin: 8, repMax: 20 };
    expect(recommend(r, { weight: 0, reps: 10, sets: 3 }, [set(0, 1)], fb({ volume: 'reps' }))).toMatchObject({ reps: 8, kind: 'volume_down', tag: '−2 reps' });
  });
  test('fbIncomplete', () => {
    expect(fbIncomplete({ weight: 'light', effort: 'normal', volume: 'ok' })).toBe(true);
    expect(fbIncomplete({ effort: 'normal', volume: 'ok' })).toBe(false);
    expect(fbIncomplete({ weight: 'light', volume: 'ok' })).toBe(false);
    expect(fbIncomplete({ weight: 'light', effort: 'normal' })).toBe(false);
    expect(fbIncomplete({})).toBe(false);
  });
});

describe('prescriptions', () => {
  test('defaultStartWeight: equipment base x difficulty multiplier, snapped to step, >= step', () => {
    expect(defaultStartWeight(ex({ equipment: ['barbell'], difficulty: 2 }))).toBe(40);
    expect(defaultStartWeight(ex({ equipment: ['smith'], difficulty: 2 }))).toBe(40);
    expect(defaultStartWeight(ex({ equipment: ['trap_bar'], difficulty: 2 }))).toBe(40);
    expect(defaultStartWeight(ex({ equipment: ['barbell'], difficulty: 3 }))).toBe(50);
    expect(defaultStartWeight(ex({ equipment: ['barbell'], difficulty: 1 }))).toBe(32.5); // 32 -> nearest 2.5
    expect(defaultStartWeight(ex({ equipment: ['dumbbells'], difficulty: 2, weightStep: 2 }))).toBe(10);
    expect(defaultStartWeight(ex({ equipment: ['kettlebells'], difficulty: 2, weightStep: 2 }))).toBe(10);
    expect(defaultStartWeight(ex({ equipment: ['dumbbells'], difficulty: 1, weightStep: 2 }))).toBe(8);
    expect(defaultStartWeight(ex({ equipment: ['dumbbells'], difficulty: 3, weightStep: 2 }))).toBe(12);
    expect(defaultStartWeight(ex({ equipment: ['cable'], difficulty: 2 }))).toBe(25);
    expect(defaultStartWeight(ex({ equipment: [], difficulty: 3 }))).toBe(32.5); // 31.25/2.5=12.5 -> 13 -> 32.5
    expect(defaultStartWeight(ex({ equipment: [], difficulty: 1 }))).toBe(20);
    expect(defaultStartWeight(ex({ equipment: ['barbell'], difficulty: 2, weightStep: 0 }))).toBe(40); // step falls back to 2.5
    expect(defaultStartWeight(ex({ equipment: ['dumbbells'], difficulty: 1, weightStep: 10 }))).toBe(10); // 8 -> 10
    expect(defaultStartWeight(ex({ equipment: ['dumbbells'], difficulty: 1, weightStep: 20 }))).toBe(20); // rounds to 0, floor at step
    expect(defaultStartWeight(ex({ equipment: ['barbell', 'dumbbells'], difficulty: 2 }))).toBe(40);
  });
  test('defaultPrescription', () => {
    expect(defaultPrescription(ex({ repMin: 5, repMax: 8, defaultSets: 4, equipment: ['barbell'] }))).toEqual({ weight: 40, reps: 6, sets: 4 });
    expect(defaultPrescription(ex({ repMin: 8, repMax: 12, defaultSets: 3, equipment: [] }))).toEqual({ weight: 25, reps: 9, sets: 3 });
    expect(defaultPrescription(ex({ repMin: 8, repMax: 20 }))).toMatchObject({ reps: 12 }); // floor(12/3)=4
    expect(defaultPrescription(ex({ repMin: 10, repMax: 14 }))).toMatchObject({ reps: 11 }); // floor(4/3)=1
    expect(defaultPrescription(ex({ tracking: 'reps', repMin: 10, repMax: 20 }))).toEqual({ weight: 0, reps: 13, sets: 3 });
    expect(defaultPrescription(ex({ tracking: 'time', repMin: 30, repMax: 60 })).weight).toBe(0);
  });
  test('prescriptionFor', () => {
    const e = ex({ id: 'x' });
    expect(prescriptionFor(e, { x: { exerciseId: 'x', weight: 70, reps: 7, sets: 5, updatedAt: 0 } as never })).toEqual({ weight: 70, reps: 7, sets: 5 });
    expect(prescriptionFor(e, { y: { weight: 1, reps: 1, sets: 1 } as never })).toEqual(defaultPrescription(e));
  });
  test('toSessionExercise maps every field', () => {
    const e = ex({ id: 'x', name: 'X', perHand: true, weightStep: 5, repMin: 4, repMax: 9, tracking: 'reps' });
    expect(toSessionExercise(e, 3, { weight: 12, reps: 6, sets: 4 }, 75, 500, true, 'sid')).toEqual({
      id: 'sid', exerciseId: 'x', name: 'X', order: 3, tracking: 'reps', perHand: true, weightStep: 5, repMin: 4, repMax: 9,
      plannedSets: 4, repTarget: 6, plannedWeight: 12, restSec: 75, estSec: 500, status: 'todo', sets: [], pinned: true,
    });
    const d = toSessionExercise(e, 0, { weight: 1, reps: 1, sets: 1 }, 1, 1);
    expect(d.pinned).toBe(false);
    expect(d.id).toBe('');
  });
});

describe('history helpers', () => {
  const done = (id: string, at: number, sets: SetLog[], status: SessionExercise['status'] = 'done') =>
    sess({ endedAt: at, exercises: [sx({ exerciseId: id, status, sets })] });
  test('exerciseHistory: oldest first; only done exercises with sets of the right id from completed sessions', () => {
    const s1 = done('a', 30, [set(1, 1)]), s2 = done('a', 10, [set(2, 2)]), s3 = done('a', 20, [set(3, 3)]);
    const h = exerciseHistory([s1, s2, s3], 'a');
    expect(h.map((x) => x.ex.sets[0].weight)).toEqual([2, 3, 1]);
    expect(exerciseHistory([done('a', 10, [set(1, 1)], 'skipped')], 'a')).toEqual([]);
    expect(exerciseHistory([done('a', 10, [])], 'a')).toEqual([]);
    expect(exerciseHistory([done('b', 10, [set(1, 1)])], 'a')).toEqual([]);
    expect(exerciseHistory([{ ...done('a', 10, [set(1, 1)]), status: 'discarded' }], 'a')).toEqual([]);
    expect(exerciseHistory([done('a', 10, [set(1, 1)], 'dropped')], 'a')).toEqual([]);
    // missing endedAt sorts as 0
    const noEnd = sess({ endedAt: undefined, exercises: [sx({ exerciseId: 'a', status: 'done', sets: [set(9, 9)] })] });
    expect(exerciseHistory([s2, noEnd], 'a').map((x) => x.ex.sets[0].weight)).toEqual([9, 2]);
    expect(exerciseHistory([noEnd, s2], 'a').map((x) => x.ex.sets[0].weight)).toEqual([9, 2]);
  });
  test('topWeight / volumeOf / exerciseSeconds / e1rm', () => {
    expect(topWeight(sx({ sets: [set(50, 5), set(70, 3), set(60, 1)] }))).toBe(70);
    expect(topWeight(sx({ sets: [] }))).toBe(0);
    expect(volumeOf(sx({ sets: [set(50, 5), set(70, 3)] }))).toBe(460);
    expect(volumeOf(sx({ sets: [] }))).toBe(0);
    expect(exerciseSeconds(sx({ startedAt: 1000, endedAt: 61000 }))).toBe(60);
    expect(exerciseSeconds(sx({ startedAt: 1, endedAt: 1500 }))).toBe(1);
    expect(exerciseSeconds(sx({ startedAt: 1, endedAt: 1501 }))).toBe(2); // 1.5 rounds up
    expect(exerciseSeconds(sx({ startedAt: 1000 }))).toBe(0);
    expect(exerciseSeconds(sx({ endedAt: 1000 }))).toBe(0);
    expect(exerciseSeconds(sx({}))).toBe(0);
    expect(e1rm(100, 0)).toBe(100);
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 2)).toBeCloseTo(106.6667, 3);
    expect(e1rm(60, 30)).toBe(120);
  });
  test('isPR', () => {
    const w = (wt: number, r: number, over: Partial<SessionExercise> = {}) => sx({ exerciseId: 'bp', status: 'done', sets: [set(wt, r)], ...over });
    const prior = [sess({ endedAt: 1, exercises: [w(100, 5)] })];
    expect(isPR(prior, w(101, 5))).toBe(true);
    expect(isPR(prior, w(100, 5))).toBe(false); // equal is not a PR
    expect(isPR(prior, w(99, 5))).toBe(false);
    expect(isPR(prior, w(100, 6))).toBe(true); // better e1rm
    expect(isPR(prior, w(90, 12))).toBe(true); // e1rm 126 > 116.7
    expect(isPR(prior, sx({ exerciseId: 'bp', status: 'done', sets: [set(100, 5), set(120, 5)] }))).toBe(true); // best set counts
    expect(isPR([], w(100, 5))).toBe(false);
    expect(isPR(prior, w(500, 5, { tracking: 'time' }))).toBe(false);
    // reps tracking compares reps only
    const rp = [sess({ endedAt: 1, exercises: [sx({ exerciseId: 'pu', tracking: 'reps', status: 'done', sets: [set(0, 10), set(0, 8)] })] })];
    expect(isPR(rp, sx({ exerciseId: 'pu', tracking: 'reps', sets: [set(50, 11)] }))).toBe(true);
    expect(isPR(rp, sx({ exerciseId: 'pu', tracking: 'reps', sets: [set(50, 10)] }))).toBe(false);
    expect(isPR(rp, sx({ exerciseId: 'pu', tracking: 'reps', sets: [set(500, 9)] }))).toBe(false);
    // best prior across several sessions
    const two = [sess({ endedAt: 1, exercises: [w(100, 5)] }), sess({ endedAt: 2, exercises: [w(110, 5)] })];
    expect(isPR(two, w(105, 5))).toBe(false);
    // tiny float epsilon difference is not a PR
    expect(isPR(prior, w(100 + 1e-12, 5))).toBe(false);
    // an improvement of exactly the 1e-9 epsilon is still not a PR (strict >)
    const one = [sess({ endedAt: 1, exercises: [sx({ exerciseId: 'bp', status: 'done', sets: [set(100, 1)] })] })];
    expect(isPR(one, sx({ exerciseId: 'bp', status: 'done', sets: [set(100 + 1e-9, 1)] }))).toBe(false);
    expect(isPR(one, sx({ exerciseId: 'bp', status: 'done', sets: [set(100.001, 1)] }))).toBe(true);
  });
});

describe('duration estimates', () => {
  const dur = (id: string, endedAt: number, secs: number) =>
    sess({ endedAt, exercises: [sx({ exerciseId: id, status: 'done', sets: [set(1, 1)], startedAt: 1000, endedAt: 1000 + secs * 1000 })] });
  test('fallback = sets x (45 + rest) when no history', () => {
    expect(estimateExerciseSec([], { id: 'a' }, 3, 90)).toBe(405);
    expect(estimateExerciseSec([], { id: 'a' }, 1, 0)).toBe(45);
    expect(estimateExerciseSec([dur('b', 1, 100)], { id: 'a' }, 2, 60)).toBe(210);
  });
  test('median of the last 5 positive durations, rounded', () => {
    const s = [dur('a', 1, 1000), dur('a', 2, 100), dur('a', 3, 200), dur('a', 4, 300), dur('a', 5, 400), dur('a', 6, 500)];
    expect(estimateExerciseSec(s, { id: 'a' }, 3, 90)).toBe(300); // last five 100..500 -> 300 (the 1000 is excluded)
    expect(estimateExerciseSec([dur('a', 1, 100), dur('a', 2, 200)], { id: 'a' }, 3, 90)).toBe(150);
    expect(estimateExerciseSec([dur('a', 1, 1), dur('a', 2, 2)], { id: 'a' }, 3, 90)).toBe(2); // 1.5 -> 2
    // zero-length durations are ignored
    const zero = sess({ endedAt: 9, exercises: [sx({ exerciseId: 'a', status: 'done', sets: [set(1, 1)] })] });
    expect(estimateExerciseSec([zero, dur('a', 1, 100)], { id: 'a' }, 3, 90)).toBe(100);
    expect(estimateExerciseSec([zero], { id: 'a' }, 2, 0)).toBe(90);
  });
  test('warmupMedianSec: last 5 completed sessions by endedAt, positive only', () => {
    const w = (endedAt: number, secs: number | null, status: Session['status'] = 'completed') =>
      sess({ endedAt, status, warmupStartedAt: secs == null ? undefined : 1000, warmupEndedAt: secs == null ? undefined : 1000 + secs * 1000 });
    expect(warmupMedianSec([])).toBeNull();
    expect(warmupMedianSec([w(1, null)])).toBeNull();
    expect(warmupMedianSec([w(1, 600), w(2, 120), w(3, 180), w(4, 240), w(5, 300), w(6, 360)])).toBe(240); // 600 falls out of the window
    expect(warmupMedianSec([w(6, 360), w(2, 120), w(3, 180), w(1, 600), w(4, 240), w(5, 300)])).toBe(240); // order independent
    // the oldest session (900 s) is the LAST element of the input: only sorting keeps it out of the window
    expect(warmupMedianSec([w(2, 100), w(3, 110), w(4, 120), w(5, 130), w(6, 140), w(1, 900)])).toBe(120);
    expect(warmupMedianSec([w(1, 100), w(2, 200)])).toBe(150);
    expect(warmupMedianSec([w(1, 1), w(2, 2)])).toBe(1.5);
    expect(warmupMedianSec([w(1, 100), w(2, null), w(3, 300)])).toBe(200); // missing ones are dropped
    expect(warmupMedianSec([w(1, 100), w(2, 900, 'discarded')])).toBe(100);
    expect(warmupMedianSec([sess({ endedAt: 1, warmupStartedAt: 0, warmupEndedAt: 5000 })])).toBeNull(); // startedAt 0 is falsy
    expect(warmupMedianSec([sess({ endedAt: 1, warmupStartedAt: 1000, warmupEndedAt: undefined })])).toBeNull();
  });
  test('totalPlannedSec skips dropped and skipped', () => {
    const list = [sx({ estSec: 100 }), sx({ estSec: 200, status: 'dropped' }), sx({ estSec: 400, status: 'skipped' }), sx({ estSec: 800, status: 'done' }), sx({ estSec: 1600, status: 'active' })];
    expect(totalPlannedSec(list, 10)).toBe(600 + 100 + 800 + 1600);
    expect(totalPlannedSec([], 0)).toBe(0);
    expect(totalPlannedSec([], 5)).toBe(300);
  });
});

describe('rankAlternatives scoring', () => {
  const cur = ex({ id: 'cur', primary: ['Chest', 'Triceps'], secondary: ['Delts', 'Core'], pattern: 'push', difficulty: 2 });
  const same: Partial<Exercise> = { primary: ['Chest', 'Triceps'], secondary: ['Delts', 'Core'], pattern: 'push', difficulty: 2 };
  const avail = new Set<string>();
  const score = (c: Partial<Exercise>, hist = false, current = cur) =>
    rankAlternatives(current, [ex({ id: 'c0', name: 'N0', ...c })], avail, [], hist ? { c0: {} as never } : {})[0]?.score;

  test('weights: 0.45 primary jaccard, 0.25 pattern, 0.15 secondary jaccard, 0.10 difficulty, 0.05 history', () => {
    expect(score(same, true)).toBeCloseTo(1, 9);
    expect(score(same)).toBeCloseTo(0.95, 9); // no history
    expect(score({ ...same, pattern: 'pull' })).toBeCloseTo(0.7, 9); // no pattern match
    expect(score({ ...same, difficulty: 3 })).toBeCloseTo(0.9, 9); // 1 apart -> half of 0.10
    expect(score({ ...same, difficulty: 1 })).toBeCloseTo(0.9, 9);
    expect(score({ ...same, secondary: ['Delts'] })).toBeCloseTo(0.95 - 0.15 * 0.5, 9); // jaccard 1/2
    expect(score({ ...same, secondary: [] })).toBeCloseTo(0.8, 9); // jaccard 0
    expect(score({ ...same, secondary: ['Quads'] })).toBeCloseTo(0.8, 9);
    expect(score({ ...same, primary: ['Chest'] })).toBeCloseTo(0.95 - 0.45 * 0.5, 9); // jaccard 1/2
    expect(score({ ...same, primary: ['Chest', 'Triceps', 'Delts'] })).toBeCloseTo(0.95 - 0.45 / 3, 9); // 2/3 drift penalty
    // two apart: current easy vs candidate hard -> no difficulty credit
    const easy = ex({ id: 'cur', primary: ['Chest', 'Triceps'], secondary: ['Delts', 'Core'], pattern: 'push', difficulty: 1 });
    expect(score({ ...same, difficulty: 3 }, false, easy)).toBeCloseTo(0.85, 9);
    // match = round(score x 100)
    const r = rankAlternatives(cur, [ex({ id: 'c0', name: 'N0', ...same, primary: ['Chest', 'Triceps', 'Delts'] })], avail, [])[0];
    expect(r.match).toBe(Math.round(r.score * 100));
    expect(r.match).toBe(80);
    expect(r.exercise.id).toBe('c0');
  });
  test('35% floor is inclusive; 34 is dropped', () => {
    const cur3 = ex({ id: 'cur', primary: ['Chest'], secondary: ['Delts', 'Rear delts'], pattern: 'push', difficulty: 2 });
    // primary 1/3 -> .15; secondary 1/3 -> .05; difficulty .10; history .05 => .35
    const c35 = ex({ id: 'k35', name: 'K', primary: ['Chest', 'Biceps', 'Lats'], secondary: ['Delts', 'Forearms'], pattern: 'pull', difficulty: 2 });
    expect(rankAlternatives(cur3, [c35], avail, [], { k35: {} as never }).map((a) => a.match)).toEqual([35]);
    expect(rankAlternatives(cur3, [c35], avail, [])).toEqual([]); // .30 without history
    // secondary 1/4 -> .0375 => .3375 -> 34 -> dropped
    const c34 = ex({ id: 'k34', name: 'K', primary: ['Chest', 'Biceps', 'Lats'], secondary: ['Delts', 'Forearms', 'Quads'], pattern: 'pull', difficulty: 2 });
    expect(rankAlternatives(cur3, [c34], avail, [], { k34: {} as never })).toEqual([]);
    // secondary jaccard 2/6 -> same .35 via a different overlap shape
    const c = ex({ id: 'k36', name: 'K', primary: ['Chest', 'Biceps', 'Lats'], secondary: ['Delts', 'Rear delts', 'Forearms', 'Quads', 'Calves', 'Core'], pattern: 'pull', difficulty: 2 });
    const r = rankAlternatives(cur3, [c], avail, [], { k36: {} as never });
    expect(r.map((a) => a.match)).toEqual([35]);
  });
  test('filters: self, excluded ids, archived, unavailable equipment, no primary overlap', () => {
    const good = { primary: ['Chest', 'Triceps'] as Exercise['primary'], secondary: [] as Exercise['secondary'], pattern: 'push' as const };
    const all = [
      ex({ id: 'cur', ...good }), ex({ id: 'ex1', name: 'ex1', ...good }), ex({ id: 'arch', name: 'arch', ...good, archived: true }),
      ex({ id: 'need', name: 'need', ...good, equipment: ['rack'] }), ex({ id: 'miss', name: 'miss', primary: ['Quads'], pattern: 'push', secondary: ['Chest'] }),
      ex({ id: 'ok', name: 'ok', ...good }),
    ];
    expect(rankAlternatives(cur, all, avail, ['ex1']).map((a) => a.exercise.id)).toEqual(['ok']);
    expect(rankAlternatives(cur, all, new Set(['rack']), ['ex1']).map((a) => a.exercise.id).sort()).toEqual(['need', 'ok']);
    // current-list cur is never offered; its own id absent
    expect(rankAlternatives(cur, all, avail, []).map((a) => a.exercise.id)).not.toContain('cur');
  });
  test('sorted by score desc then name; limit defaults to 4 and is configurable', () => {
    const mk = (id: string, name: string, extra: Partial<Exercise> = {}) => ex({ id, name, primary: ['Chest', 'Triceps'], secondary: ['Delts', 'Core'], pattern: 'push', ...extra });
    const lib2 = [mk('z', 'Zed'), mk('a', 'Alpha'), mk('m', 'Mid'), mk('b', 'Beta'), mk('q', 'Quirk'), mk('lo', 'Low', { pattern: 'pull' })];
    const r = rankAlternatives(cur, lib2, avail, []);
    expect(r.map((a) => a.exercise.name)).toEqual(['Alpha', 'Beta', 'Mid', 'Quirk']);
    expect(rankAlternatives(cur, lib2, avail, [], {}, [], 2).map((a) => a.exercise.name)).toEqual(['Alpha', 'Beta']);
    expect(rankAlternatives(cur, lib2, avail, [], {}, [], 10).map((a) => a.exercise.name)).toEqual(['Alpha', 'Beta', 'Mid', 'Quirk', 'Zed', 'Low']);
    // a higher score beats alphabetical order
    const lib3 = [mk('a', 'Alpha', { pattern: 'pull' }), mk('z', 'Zed')];
    expect(rankAlternatives(cur, lib3, avail, []).map((a) => a.exercise.name)).toEqual(['Zed', 'Alpha']);
    // progress bonus can flip the order of otherwise-equal candidates
    expect(rankAlternatives(cur, [mk('a', 'Alpha'), mk('z', 'Zed')], avail, [], { z: {} as never }).map((a) => a.exercise.name)).toEqual(['Zed', 'Alpha']);
  });
  test('candidate/current with empty primary or secondary does not divide by zero', () => {
    const none = ex({ id: 'n', primary: [], secondary: [] });
    expect(rankAlternatives(none, [ex({ id: 'x' })], avail, [])).toEqual([]);
    const c2 = ex({ id: 'cur', primary: ['Chest'], secondary: [] });
    const r = rankAlternatives(c2, [ex({ id: 'x', primary: ['Chest'], secondary: [] })], avail, []);
    expect(r[0].score).toBeCloseTo(0.45 + 0.25 + 0.1, 9);
  });
});

describe('swapPrescription', () => {
  const from = sx({ plannedSets: 4, repTarget: 10 });
  test('own progress wins (weight/reps) but sets come from the swapped-out exercise', () => {
    expect(swapPrescription(from, ex({ id: 't' }), { t: { exerciseId: 't', weight: 33, reps: 7, sets: 2, updatedAt: 0 } as never })).toEqual({ weight: 33, reps: 7, sets: 4 });
  });
  test('no history: rep target clamped to [repMin, repMax], default weight, sets carried', () => {
    const to = ex({ id: 't', repMin: 6, repMax: 12, equipment: ['barbell'] });
    expect(swapPrescription(from, to, {})).toEqual({ weight: 40, reps: 10, sets: 4 });
    expect(swapPrescription(sx({ plannedSets: 3, repTarget: 4 }), to, {}).reps).toBe(6);
    expect(swapPrescription(sx({ plannedSets: 3, repTarget: 20 }), to, {}).reps).toBe(12);
    expect(swapPrescription(sx({ plannedSets: 3, repTarget: 6 }), to, {}).reps).toBe(6);
    expect(swapPrescription(sx({ plannedSets: 3, repTarget: 12 }), to, {}).reps).toBe(12);
    expect(swapPrescription(from, ex({ id: 't', tracking: 'reps' }), {}).weight).toBe(0);
  });
});

describe('autoAdjust', () => {
  const run = (exercises: SessionExercise[], over: Partial<Parameters<typeof autoAdjust>[0]> = {}) =>
    autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 10, exercises, cursor: 0, newId, ...over });

  test('tolerance is exactly 300 s: 300 over = untouched, 301 over = adjusted', () => {
    const at = (est: number) => run([sx({ id: 'a', estSec: est })]);
    const r300 = at(600 + 300);
    expect(r300.applied).toBe(false);
    expect(r300.overrunBeforeSec).toBe(300);
    expect(r300.projectedEndSec).toBe(900);
    expect(r300.adjustments).toEqual([]);
    expect(r300.exercises[0].restSec).toBe(120);
    const r301 = at(600 + 301);
    expect(r301.overrunBeforeSec).toBe(301);
    expect(r301.applied).toBe(true);
    expect(r301.adjustments[0].type).toBe('trim_rest');
  });
  test('elapsed time counts: rounded to seconds, never negative', () => {
    const r = run([sx({ estSec: 100 })], { now: 1500, sessionStartedAt: 0 });
    expect(r.projectedEndSec).toBe(102); // round(1.5)
    expect(run([sx({ estSec: 100 })], { now: 1499, sessionStartedAt: 0 }).projectedEndSec).toBe(101);
    expect(run([sx({ estSec: 100 })], { now: 0, sessionStartedAt: 5000 }).projectedEndSec).toBe(100);
    expect(run([sx({ estSec: 100 })], { now: 61000, sessionStartedAt: 1000 }).projectedEndSec).toBe(160);
    // target uses minutes x 60
    expect(run([sx({ estSec: 100 })], { targetMin: 2 }).overrunBeforeSec).toBe(-20);
  });
  test('only todo exercises count towards projected time', () => {
    const r = run([sx({ estSec: 1000, status: 'done' }), sx({ estSec: 1000, status: 'active' }), sx({ estSec: 1000, status: 'dropped' }), sx({ estSec: 50 })]);
    expect(r.projectedEndSec).toBe(50);
    expect(r.applied).toBe(false);
  });
  test('rest trim: cut = min(rest-60, 30); rest <= 60 untouched; saved = cut x (sets-1)', () => {
    const exs = [
      sx({ id: 'r120', restSec: 120, plannedSets: 3, estSec: 1000 }),
      sx({ id: 'r90', restSec: 90, plannedSets: 4, estSec: 1000 }),
      sx({ id: 'r75', restSec: 75, plannedSets: 2, estSec: 1000 }),
      sx({ id: 'r61', restSec: 61, plannedSets: 6, estSec: 1000 }),
      sx({ id: 'r60', restSec: 60, plannedSets: 3, estSec: 1000 }),
      sx({ id: 'r30', restSec: 30, plannedSets: 3, estSec: 1000 }),
      sx({ id: 'act', restSec: 120, plannedSets: 3, estSec: 1000, status: 'active' }),
      sx({ id: 'one', restSec: 120, plannedSets: 1, estSec: 1000 }),
    ];
    const r = run(exs, { targetMin: 1000 }); // not over -> nothing
    expect(r.applied).toBe(false);
    const big = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 2, exercises: exs, cursor: 7, newId });
    const by = Object.fromEntries(big.exercises.map((e) => [e.id, e]));
    expect(by.r120.restSec).toBe(90); expect(by.r120.estSec).toBe(1000 - 60);
    expect(by.r90.restSec).toBe(60); expect(by.r90.estSec).toBe(1000 - 90);
    expect(by.r75.restSec).toBe(60); expect(by.r75.estSec).toBe(1000 - 15);
    expect(by.r61.restSec).toBe(60); expect(by.r61.estSec).toBe(1000 - 5);
    expect(by.r60.restSec).toBe(60); expect(by.r60.estSec).toBe(1000);
    expect(by.r30.restSec).toBe(30); expect(by.r30.estSec).toBe(1000);
    expect(by.act.restSec).toBe(120);
    expect(by.one.restSec).toBe(90); expect(by.one.estSec).toBe(1000);
    const trim = big.adjustments[0];
    expect(trim.type).toBe('trim_rest');
    expect(trim.savedSec).toBe(60 + 90 + 15 + 5);
    expect(trim.prevRestSec).toEqual({ r120: 120, r90: 90, r75: 75, r61: 61, one: 120 });
    expect(trim.text).toBe('Rest trimmed by up to 30 s to save ~3 min.'); // 170 s -> 2.83 -> 3
    expect(trim.at).toBe(0);
    expect(typeof trim.id).toBe('string');
    // originals untouched
    expect(exs[0].restSec).toBe(120);
    expect(exs[0].estSec).toBe(1000);
  });
  test('estSec never goes negative when trim saves more than the estimate', () => {
    const trimOnly = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'a', restSec: 200, plannedSets: 10, estSec: 305 }), sx({ id: 'cur', status: 'active', estSec: 0 })], cursor: 1, newId });
    expect(trimOnly.exercises[0].estSec).toBe(35); // 305 - 270, then within tolerance
    expect(trimOnly.adjustments).toHaveLength(1);
    const neg = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'a', restSec: 200, plannedSets: 10, estSec: 400 }), sx({ id: 'b', restSec: 200, plannedSets: 10, estSec: 100 }), sx({ id: 'cur', status: 'active' })], cursor: 2, newId });
    expect(neg.exercises.every((e) => e.estSec >= 0)).toBe(true);
    expect(neg.exercises.find((e) => e.id === 'a')!.estSec).toBe(130);
    expect(neg.adjustments[0].savedSec).toBe(540); // saved reports the nominal cut even when estimate floors at 0
    expect(neg.exercises.find((e) => e.id === 'b')!.estSec).toBe(0);
  });
  test('no trim adjustment when nothing can be trimmed; then drop', () => {
    const exs = [sx({ id: 'cur', status: 'active', estSec: 0, restSec: 60 }), sx({ id: 'a', restSec: 60, estSec: 400 }), sx({ id: 'b', restSec: 45, estSec: 400 })];
    const r = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: exs, cursor: 0, newId });
    expect(r.adjustments.map((a) => a.type)).toEqual(['drop', 'drop']); // 800 -> 400 (still > 300) -> 0
  });
  test('drops: last unpinned first, pinned last, never the cursor, only todo, until within tolerance', () => {
    const exs = [
      sx({ id: 'cur', status: 'active', estSec: 0, restSec: 60 }),
      sx({ id: 'p1', pinned: true, estSec: 400, restSec: 60 }),
      sx({ id: 'u2', estSec: 400, restSec: 60 }),
      sx({ id: 'u3', estSec: 400, restSec: 60 }),
      sx({ id: 'dn', status: 'done', estSec: 999, restSec: 60 }),
    ];
    // projected 1200 vs target 0: need <= 300 -> drop u3 (800), u2 (400), p1 (0)
    const r = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: exs, cursor: 0, newId });
    const drops = r.adjustments.filter((a) => a.type === 'drop');
    expect(drops.map((d) => d.exerciseId)).toEqual(['u3', 'u2']);
    expect(drops.map((d) => d.savedSec)).toEqual([400, 400]);
    expect(drops[0].text).toBe('u3 dropped to save ~7 min.');
    expect(r.exercises.map((e) => e.status)).toEqual(['active', 'todo', 'dropped', 'dropped', 'done']);
    expect(r.projectedEndSec).toBe(400);
    // 400 > 300 still, so the pinned one is next -> but it is the only candidate and pinned -> stop
    expect(r.exercises.find((e) => e.id === 'p1')!.status).toBe('todo');
    expect(r.applied).toBe(true);
  });
  test('cursor exercise is never dropped even when it is the only todo', () => {
    const r = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'a', estSec: 2000, restSec: 60 })], cursor: 0, newId });
    expect(r.exercises[0].status).toBe('todo');
    expect(r.applied).toBe(false);
    // but when the cursor is elsewhere it is droppable (unpinned single candidate)
    const r2 = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'c', status: 'active', estSec: 0 }), sx({ id: 'a', estSec: 2000, restSec: 60 })], cursor: 0, newId });
    expect(r2.exercises[1].status).toBe('dropped');
    expect(r2.projectedEndSec).toBe(0);
    // cursor index decides, not status
    const r3 = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'a', estSec: 2000, restSec: 60 }), sx({ id: 'b', estSec: 2000, restSec: 60 })], cursor: 1, newId });
    expect(r3.exercises.map((e) => e.status)).toEqual(['dropped', 'todo']);
  });
  test('pinned single candidate is kept; with an unpinned peer, the unpinned goes first even if earlier', () => {
    const r = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'cur', status: 'active', estSec: 0 }), sx({ id: 'p', pinned: true, estSec: 2000, restSec: 60 })], cursor: 0, newId });
    expect(r.exercises[1].status).toBe('todo');
    expect(r.adjustments).toEqual([]);
    expect(r.applied).toBe(false);
    const r2 = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'cur', status: 'active', estSec: 0 }), sx({ id: 'u', estSec: 400, restSec: 60 }), sx({ id: 'p', pinned: true, estSec: 400, restSec: 60 })], cursor: 0, newId });
    expect(r2.exercises.map((e) => e.status)).toEqual(['active', 'dropped', 'todo']);
    // pinned peers: highest index dropped first
    const r3 = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'cur', status: 'active', estSec: 0 }), sx({ id: 'p1', pinned: true, estSec: 400, restSec: 60 }), sx({ id: 'p2', pinned: true, estSec: 400, restSec: 60 })], cursor: 0, newId });
    expect(r3.exercises.map((e) => e.status)).toEqual(['active', 'todo', 'dropped']);
  });
  test('stops dropping as soon as projected is within tolerance (strictly > 300 keeps dropping)', () => {
    const base = (est: number) => autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'cur', status: 'active', estSec: 0 }), sx({ id: 'a', estSec: 300 + est, restSec: 60 }), sx({ id: 'b', estSec: 0, restSec: 60 })], cursor: 0, newId });
    // projected = 300 + est; est=0 => exactly 300 => no action at all
    expect(base(0).applied).toBe(false);
    expect(base(1).applied).toBe(true);
    // after dropping b (est 0) projected is still 301 -> a is dropped as well
    expect(base(1).exercises.map((e) => e.status)).toEqual(['active', 'dropped', 'dropped']);
    // exactly 300 after a drop: stop
    const r = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'cur', status: 'active', estSec: 0 }), sx({ id: 'a', estSec: 300, restSec: 60 }), sx({ id: 'b', estSec: 100, restSec: 60 })], cursor: 0, newId });
    expect(r.exercises.map((e) => e.status)).toEqual(['active', 'todo', 'dropped']);
    expect(r.projectedEndSec).toBe(300);
  });
  test('the drop loop compares projected - target (not + target) against the tolerance', () => {
    const exs = [sx({ id: 'cur', status: 'active', estSec: 0, restSec: 60 }), sx({ id: 'a', estSec: 500, restSec: 60 }), sx({ id: 'b', estSec: 500, restSec: 60 })];
    const r = autoAdjust({ now: 0, sessionStartedAt: 0, targetMin: 10, exercises: exs, cursor: 0, newId }); // projected 1000, target 600
    expect(r.overrunBeforeSec).toBe(400);
    expect(r.exercises.map((e) => e.status)).toEqual(['active', 'todo', 'dropped']);
    expect(r.projectedEndSec).toBe(500);
  });
  test('adjustment ids come from newId and timestamps from now', () => {
    const ids = ['T', 'D1'];
    const r = autoAdjust({ now: 777, sessionStartedAt: 0, targetMin: 0, exercises: [sx({ id: 'cur', status: 'active', estSec: 0 }), sx({ id: 'a', estSec: 2000, restSec: 100 })], cursor: 0, newId: () => ids.shift()! });
    expect(r.adjustments.map((a) => a.id)).toEqual(['T', 'D1']);
    expect(r.adjustments.every((a) => a.at === 777)).toBe(true);
    expect(r.adjustments[1].exerciseId).toBe('a');
  });
});

describe('undoAdjustment', () => {
  test('drop: only restores dropped exercises with that id', () => {
    const exs = [sx({ id: 'a', status: 'dropped' }), sx({ id: 'b', status: 'dropped' }), sx({ id: 'a2', status: 'done' })];
    const out = undoAdjustment(exs, { id: 'x', at: 0, type: 'drop', exerciseId: 'a', savedSec: 1, text: '' });
    expect(out.map((e) => e.status)).toEqual(['todo', 'dropped', 'done']);
    expect(undoAdjustment([sx({ id: 'a', status: 'done' })], { id: 'x', at: 0, type: 'drop', exerciseId: 'a', savedSec: 1, text: '' })[0].status).toBe('done');
    // no exerciseId -> unchanged
    expect(undoAdjustment(exs, { id: 'x', at: 0, type: 'drop', savedSec: 1, text: '' })).toBe(exs);
  });
  test('trim_rest: restores rest and time for todo/dropped only, scaled by sets-1', () => {
    const exs = [
      sx({ id: 'a', restSec: 90, plannedSets: 3, estSec: 540 }), sx({ id: 'b', restSec: 60, plannedSets: 1, estSec: 100, status: 'dropped' }),
      sx({ id: 'c', restSec: 90, plannedSets: 3, estSec: 540, status: 'active' }), sx({ id: 'd', restSec: 90, plannedSets: 3, estSec: 540, status: 'done' }),
      sx({ id: 'e', restSec: 90, plannedSets: 3, estSec: 540 }),
    ];
    const adj = { id: 'x', at: 0, type: 'trim_rest' as const, savedSec: 1, text: '', prevRestSec: { a: 120, b: 90, c: 120, d: 120 } };
    const out = undoAdjustment(exs, adj);
    expect(out[0]).toMatchObject({ restSec: 120, estSec: 540 + 60 });
    expect(out[1]).toMatchObject({ restSec: 90, estSec: 100 }); // 1 set -> nothing to restore
    expect(out[2]).toBe(exs[2]);
    expect(out[3]).toBe(exs[3]);
    expect(out[4]).toBe(exs[4]);
    expect(out[0].status).toBe('todo');
    // no prevRestSec -> unchanged
    expect(undoAdjustment(exs, { ...adj, prevRestSec: undefined })).toBe(exs);
    // unknown id with no rest entry untouched; rest value of 0 is respected (r == null check)
    expect(undoAdjustment([sx({ id: 'z', restSec: 30, plannedSets: 2, estSec: 10 })], { ...adj, prevRestSec: { z: 0 } })[0]).toMatchObject({ restSec: 0, estSec: 10 - 30 });
  });
  test('adjustment kind decides the branch even when the other kind\'s fields are present', () => {
    const exs = [sx({ id: 'a', restSec: 90, plannedSets: 3, estSec: 540, status: 'dropped' })];
    // trim_rest carrying an exerciseId must NOT un-drop; it restores rest only
    const t = undoAdjustment(exs, { id: 'x', at: 0, type: 'trim_rest', exerciseId: 'a', savedSec: 1, text: '', prevRestSec: { a: 120 } });
    expect(t[0]).toMatchObject({ status: 'dropped', restSec: 120, estSec: 600 });
    // a drop with a prevRestSec map must NOT touch rest
    const d = undoAdjustment(exs, { id: 'x', at: 0, type: 'drop', exerciseId: 'a', savedSec: 1, text: '', prevRestSec: { a: 120 } });
    expect(d[0]).toMatchObject({ status: 'todo', restSec: 90, estSec: 540 });
    const d2 = undoAdjustment(exs, { id: 'x', at: 0, type: 'drop', savedSec: 1, text: '', prevRestSec: { a: 120 } });
    expect(d2).toBe(exs);
  });
  test('other adjustment kinds are a no-op', () => {
    const exs = [sx({ id: 'a' })];
    expect(undoAdjustment(exs, { id: 'x', at: 0, type: 'swap' as never, savedSec: 0, text: '' })).toBe(exs);
  });
});

describe('stats', () => {
  test('sessionDurationSec', () => {
    expect(sessionDurationSec(sess({ startedAt: 1000, endedAt: 61000 }))).toBe(60);
    expect(sessionDurationSec(sess({ startedAt: 0, endedAt: 1500 }))).toBe(2);
    expect(sessionDurationSec(sess({ startedAt: 0, endedAt: 1499 }))).toBe(1);
    expect(sessionDurationSec(sess({ startedAt: 5000, endedAt: 1000 }))).toBe(0);
    expect(sessionDurationSec(sess({ startedAt: 1000, endedAt: undefined }))).toBe(0);
  });
  const at = (y: number, m: number, d: number, h = 12) => sess({ endedAt: D(y, m, d, h), startedAt: D(y, m, d, h) - 3600000 });
  test('weeklyCounts: oldest first, aligned to Monday, n entries', () => {
    const now = D(2026, 10, 18, 12);
    const sessions = [at(2026, 10, 16, 0), at(2026, 10, 18), at(2026, 10, 15), at(2026, 10, 9, 9), at(2026, 9, 28)];
    const w = weeklyCounts(sessions, now, 4);
    expect(w).toHaveLength(4);
    expect(w.map((x) => x.start)).toEqual([D(2026, 9, 26), D(2026, 10, 2), D(2026, 10, 9), D(2026, 10, 16)]);
    expect(w.map((x) => x.count)).toEqual([1, 0, 2, 2]);
    expect(weeklyCounts(sessions, now, 1)).toEqual([{ start: D(2026, 10, 16), count: 2 }]);
    expect(weeklyCounts(sessions, now, 0)).toEqual([]);
  });
  test('streakWeeks: >= goal per week, current week in progress is skipped, a missed past week breaks', () => {
    const now = D(2026, 10, 18, 12); // week of Nov 16
    const week = (monthDay: [number, number], count: number) => Array.from({ length: count }, (_, i) => at(2026, monthDay[0], monthDay[1] + (i % 5), 10 + i));
    // current week: 1 session (goal 2) -> in progress; previous two weeks hit
    const s = [...week([10, 16], 1), ...week([10, 9], 2), ...week([10, 2], 3)];
    expect(streakWeeks(s, 2, now)).toBe(2);
    // current week hits goal too
    expect(streakWeeks([...s, at(2026, 10, 17)], 2, now)).toBe(3);
    // exactly goal counts (>=), one less breaks
    expect(streakWeeks([...week([10, 9], 2)], 2, now)).toBe(1);
    expect(streakWeeks([...week([10, 9], 1)], 2, now)).toBe(0);
    // gap breaks: weeks 0 ok, 1 missed, 2 ok -> 1
    expect(streakWeeks([...week([10, 16], 2), ...week([10, 2], 2)], 2, now)).toBe(1);
    // nothing at all
    expect(streakWeeks([], 2, now)).toBe(0);
    // not-completed ignored
    expect(streakWeeks([{ ...at(2026, 10, 9), status: 'discarded' }], 1, now)).toBe(0);
  });
  test('streakWeeks looks back at most 520 weeks', () => {
    const now = D(2026, 10, 18, 12);
    const list: Session[] = [];
    for (let i = 0; i < 560; i++) { const d = new Date(now); d.setDate(d.getDate() - 7 * i); list.push(sess({ endedAt: d.getTime(), startedAt: d.getTime() - 1000 })); }
    expect(streakWeeks(list, 1, now)).toBe(520);
  });
});
