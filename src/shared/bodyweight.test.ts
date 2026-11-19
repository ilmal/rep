// "At home, no equipment": the built-in location, bodyweight catalog coverage, the planner at that location and bodyweight progression.
import { describe, expect, test } from 'bun:test';
import { DEFAULT_PLANNER, generateSession } from './planner';
import { SEED_BY_ID, SEED_EXERCISES, AREA_TEMPLATES, areaFromTemplate } from './exercises';
import { templateEquipment } from './catalog';
import {
  NO_EQUIPMENT_GYM_ID, NO_EQUIPMENT_NAME, bodyweightExercises, isNoEquipment, noEquipmentGym, resolveGym, swapPairs,
} from './location';
import { availableEquipment, isAvailable, prescriptionFor, rankAlternatives, recommend, swapPrescription, toSessionExercise } from './rules';
import type { Area, Feedback, Gym, ProgressEntry, SetLog } from './types';

const NOW = new Date(2026, 10, 18, 12).getTime();
let n = 0;
const newId = () => `id${++n}`;
const areas = (): Area[] => AREA_TEMPLATES.map((t, i) => areaFromTemplate(t, `a${i}`));
const fullGym: Gym = { id: 'g1', name: 'Full', lat: null, lng: null, radiusM: 100, equipment: templateEquipment('full'), notes: {}, brokenSince: {}, createdAt: 0 };
const gen = (area: Area, gym: Gym | null, over: Partial<Parameters<typeof generateSession>[0]> = {}) => generateSession({
  area, gym, library: SEED_EXERCISES, prefs: {}, progress: {}, sessions: [], planner: DEFAULT_PLANNER, restSec: 90, targetMin: 60, warmupMin: 10, now: NOW, newId, ...over,
});
const set = (reps: number): SetLog => ({ weight: 0, reps, doneAt: 0 });
const OK: Feedback = { effort: 'normal', weight: 'right', volume: 'ok' };

describe('built-in no-equipment location', () => {
  test('is a pseudo gym with only the floor, never "deleted", resolvable by id', () => {
    const g = noEquipmentGym();
    expect(g.id).toBe(NO_EQUIPMENT_GYM_ID);
    expect(g.name).toBe(NO_EQUIPMENT_NAME);
    expect([...availableEquipment(g)]).toEqual(['mat']);
    expect(isNoEquipment('none')).toBe(true);
    expect(isNoEquipment('g1')).toBe(false);
    expect(isNoEquipment(null)).toBe(false);
    expect(resolveGym({}, 'none')).toBe(g);
    expect(resolveGym([], 'none')).toBe(g);
    expect(resolveGym({ g1: fullGym }, 'g1')).toBe(fullGym);
    expect(resolveGym({ g1: { ...fullGym, deleted: true } }, 'g1')?.id).toBe('g1');
    expect(resolveGym({}, null)).toBeNull();
    expect(resolveGym({}, 'zzz')).toBeNull();
  });
  test('catalog: plenty of bodyweight exercises, every harder link resolves, no cycles, labels and tracking are sane', () => {
    const bw = bodyweightExercises(SEED_EXERCISES);
    expect(bw.length).toBeGreaterThanOrEqual(21);
    expect(bodyweightExercises([{ ...bw[0], archived: true }])).toEqual([]);
    for (const e of SEED_EXERCISES) {
      if (e.harder) {
        expect(SEED_BY_ID[e.harder]).toBeDefined();
        const seen = new Set([e.id]);
        for (let c: string | undefined = e.harder; c; c = SEED_BY_ID[c].harder) { expect(seen.has(c)).toBe(false); seen.add(c); }
      }
    }
    for (const e of bw) {
      expect(e.weightStep).toBe(0);
      expect(['reps', 'time']).toContain(e.tracking);
      expect(e.primary.length).toBeGreaterThan(0);
      expect(e.equipment.every((q) => q === 'mat')).toBe(true);
    }
    expect(new Set(SEED_EXERCISES.map((e) => e.id)).size).toBe(SEED_EXERCISES.length);
    expect(new Set(SEED_EXERCISES.map((e) => e.name)).size).toBe(SEED_EXERCISES.length);
    // stable ids that existed before
    for (const id of ['glute_bridge', 'pushup', 'plank', 'dead_bug', 'reverse_lunge', 'calf_raise_bw']) expect(SEED_BY_ID[id]).toBeDefined();
  });
  test('every default area yields at least 4 bodyweight exercises (its own count at most), same muscles, no gym equipment', () => {
    for (const a of areas()) {
      for (const variant of [0, 1, 2]) {
        const r = gen(a, noEquipmentGym(), { variant });
        expect(r.exercises.length).toBeGreaterThanOrEqual(Math.min(4, a.exercisesPerSession));
        expect(r.exercises.length).toBeLessThanOrEqual(a.exercisesPerSession);
        expect(new Set(r.exercises.map((e) => e.exerciseId)).size).toBe(r.exercises.length);
        for (const e of r.exercises) {
          const ex = SEED_BY_ID[e.exerciseId];
          expect(isAvailable(ex, availableEquipment(noEquipmentGym()))).toBe(true);
          expect(e.tracking === 'weight_reps').toBe(false);
          expect(e.plannedWeight).toBe(0);
          expect(a.poolExerciseIds.includes(ex.id) || ex.primary.some((m) => a.focusMuscles.includes(m))).toBe(true);
        }
        expect(r.hiddenNames).toEqual([]); // swapped, not "left out"
      }
    }
  });
  test('Pull and Core areas with an area-specific count still fill up; coach plan items are swapped to bodyweight versions', () => {
    const pull = areas().find((a) => a.name === 'Pull')!;
    expect(gen(pull, noEquipmentGym()).exercises.length).toBe(pull.exercisesPerSession);
    const a = areas()[1];
    const r = gen(a, noEquipmentGym(), { coachPlan: { id: 'p', title: 't', exercises: [{ exerciseId: 'back_squat' }, { exerciseId: 'rdl' }], status: 'pending', createdBy: 'x', createdAt: 0 } });
    expect(r.source).toBe('coach');
    expect(r.exercises.map((e) => SEED_BY_ID[e.exerciseId].equipment.length)).toEqual([0, 0]);
  });
  test('the same area at a full gym is NOT bodyweight (no regression); home plans are strictly shorter, computed by the planner', () => {
    const total = (r: ReturnType<typeof gen>) => r.exercises.reduce((a, e) => a + e.estSec, 0);
    for (const a of areas()) {
      const gymPlan = gen(a, fullGym);
      const homePlan = gen(a, noEquipmentGym());
      if (a.name !== 'Core' && a.name !== 'Prehab & mobility') expect(gymPlan.exercises.some((e) => SEED_BY_ID[e.exerciseId].equipment.length > 0)).toBe(true);
      expect(total(homePlan), a.name).toBeLessThan(total(gymPlan));
      expect(homePlan.exercises.every((e) => e.restSec === 60)).toBe(true); // HOME_REST_SEC, capped by the user's rest setting
    }
    expect(gen(areas()[1], noEquipmentGym(), { restSec: 45 }).exercises.every((e) => e.restSec === 45)).toBe(true);
    // Lower body: roughly 12 min shorter than at the gym (design), never invented: it falls out of rest + sets
    const lower = areas()[1];
    expect((total(gen(lower, fullGym)) - total(gen(lower, noEquipmentGym()))) / 60).toBeGreaterThan(5);
  });
  test('banned / excluded bodyweight exercises are respected at home', () => {
    const upper = areas()[0];
    const first = gen(upper, noEquipmentGym()).exercises.map((e) => e.exerciseId);
    const r = gen(upper, noEquipmentGym(), { excludeIds: first });
    expect(r.exercises.some((e) => first.includes(e.exerciseId))).toBe(false);
    const banned = gen(upper, noEquipmentGym(), { prefs: Object.fromEntries(first.map((id) => [id, { exerciseId: id, favorite: false, avoid: true, relevance: 50 }])) });
    expect(banned.exercises.some((e) => first.includes(e.exerciseId))).toBe(false);
  });
  test('swapPairs: leaving exercises are paired with the best-matching one that joins; same plans give no pairs', () => {
    const cur = ['back_squat', 'rdl', 'walking_lunge', 'seated_leg_curl', 'calf_raise_standing'].map((id) => ({ exerciseId: id, name: SEED_BY_ID[id].name }));
    const next = ['tempo_squat', 'single_leg_rdl', 'bw_reverse_lunge', 'sl_glute_bridge', 'calf_raise_bw'].map((id) => ({ exerciseId: id, name: SEED_BY_ID[id].name }));
    const pairs = swapPairs(cur, next, SEED_EXERCISES);
    expect(pairs).toEqual([
      'Back squat → Tempo squat', 'Romanian deadlift → Single-leg RDL', 'Walking lunge → Reverse lunge', 'Seated leg curl → Single-leg glute bridge', 'Standing calf raise → Single-leg calf raise',
    ]);
    expect(swapPairs(cur, cur, SEED_EXERCISES)).toEqual([]);
    expect(swapPairs(cur, next.slice(0, 2), SEED_EXERCISES).slice(2)).toEqual(['Walking lunge → no alternative, dropped', 'Seated leg curl → no alternative, dropped', 'Standing calf raise → no alternative, dropped']);
    // a shared exercise stays out of the pairs
    expect(swapPairs(cur, [cur[0], ...next.slice(1)], SEED_EXERCISES).some((p) => p.startsWith('Back squat'))).toBe(false);
  });
  test('rankAlternatives at the no-equipment location pairs lifts with bodyweight versions', () => {
    const avail = availableEquipment(noEquipmentGym());
    expect(rankAlternatives(SEED_BY_ID.back_squat, SEED_EXERCISES, avail, [])[0].exercise.equipment).toEqual([]);
    const alts = rankAlternatives(SEED_BY_ID.back_squat, SEED_EXERCISES, avail, []).map((a) => a.exercise.id);
    expect(alts).toContain('tempo_squat');
  });
  test('swapPrescription into a bodyweight exercise has weight 0', () => {
    const from = toSessionExercise(SEED_BY_ID.back_squat, 0, { weight: 80, reps: 6, sets: 4 }, 90, 600, false, 'x');
    const rx = swapPrescription(from, SEED_BY_ID.tempo_squat, {});
    expect(rx.weight).toBe(0);
    expect(rx.sets).toBe(4);
    expect(rx.reps).toBe(10); // clamped to the bodyweight rep range
  });
});

describe('bodyweight progression: reps → tempo or time → harder variation', () => {
  const sq = SEED_BY_ID.bw_squat; // reps 12–25, harder → tempo_squat
  const prev = (reps: number) => ({ weight: 0, reps, sets: 3 });
  test('below the ceiling: +1 rep (time: +5 s)', () => {
    const r = recommend(sq, prev(15), [set(15), set(15), set(15)], OK);
    expect(r).toMatchObject({ kind: 'rep_up', reps: 16, weight: 0, tag: '+1 rep' });
    const t = recommend(SEED_BY_ID.plank, prev(40), [set(40)], OK);
    expect(t).toMatchObject({ kind: 'rep_up', reps: 45, tag: '+5 s' });
  });
  test('at the ceiling a reps exercise goes to a slow 3 s tempo with reps reset (stage persisted on the rec)', () => {
    const r = recommend(sq, prev(25), [set(25), set(25), set(25)], OK, { harder: 'tempo_squat', harderName: 'Tempo squat' });
    expect(r).toMatchObject({ kind: 'tempo', tag: '3 s tempo', reps: 12, weight: 0, tempo: true });
    expect(r.harderId).toBeUndefined();
  });
  test('at the ceiling AT tempo it moves to the harder variation (reps reset, tempo cleared)', () => {
    const r = recommend(sq, prev(25), [set(25)], OK, { tempo: true, harder: 'tempo_squat', harderName: 'Tempo squat' });
    expect(r).toMatchObject({ kind: 'harder', tag: 'Harder variation', harderId: 'tempo_squat', reps: 12 });
    expect(r.tempo).toBeUndefined();
    expect(r.why).toContain('Tempo squat');
  });
  test('time exercises skip tempo and go straight to the harder variation', () => {
    const r = recommend(SEED_BY_ID.plank, prev(90), [set(90)], OK, { harder: 'plank_tap' });
    expect(r).toMatchObject({ kind: 'harder', harderId: 'plank_tap', reps: 30 });
  });
  test('no harder variation: hold at the ceiling (tempo stage is kept)', () => {
    const r = recommend(SEED_BY_ID.pistol_squat, prev(8), [set(8)], OK, { tempo: true });
    expect(r).toMatchObject({ kind: 'hold', reps: 8, tempo: true });
    const t = recommend(SEED_BY_ID.hollow_hold, prev(45), [set(45)], OK);
    expect(t.kind).toBe('hold');
  });
  test('not every set hit, easy effort, too heavy: no stage change; tempo flag carried', () => {
    expect(recommend(sq, prev(25), [set(25), set(20)], OK, { tempo: true }).kind).toBe('hold');
    expect(recommend(sq, prev(25), [set(25)], { ...OK, effort: 'chill' }, {}).kind).toBe('hold');
    expect(recommend(sq, prev(25), [set(25)], { ...OK, weight: 'heavy' }, { tempo: true })).toMatchObject({ kind: 'weight_down', reps: 24, tempo: true });
  });
  test('weight_reps lifts are untouched by the bodyweight state', () => {
    const r = recommend(SEED_BY_ID.back_squat, { weight: 80, reps: 8, sets: 4 }, [{ weight: 80, reps: 8, doneAt: 0 }], OK, { tempo: true, harder: 'tempo_squat' });
    expect(r).toMatchObject({ kind: 'weight_up', weight: 82.5, reps: 5 });
  });
  test('tempo is carried into the next prescription and session exercise', () => {
    const progress: Record<string, ProgressEntry> = { bw_squat: { exerciseId: 'bw_squat', weight: 0, reps: 12, sets: 3, tempo: true, updatedAt: 0 } };
    expect(prescriptionFor(sq, progress)).toEqual({ weight: 0, reps: 12, sets: 3, tempo: true });
    expect(prescriptionFor(sq, {})).not.toHaveProperty('tempo');
    expect(toSessionExercise(sq, 0, prescriptionFor(sq, progress), 90, 100).tempo).toBe(true);
  });
  test('an exercise whose last recommendation was "harder variation" is planned as that variation', () => {
    const upper = areas()[0];
    const progress: Record<string, ProgressEntry> = {
      pushup: { exerciseId: 'pushup', weight: 0, reps: 8, sets: 3, updatedAt: 0, lastRec: { weight: 0, reps: 8, sets: 3, kind: 'harder', tag: 'Harder variation', why: '', ruleVersion: 1, harderId: 'diamond_pushup' } },
    };
    const lib = SEED_EXERCISES.filter((e) => e.id !== 'wall_pushup');
    const r = gen({ ...upper, poolExerciseIds: ['pushup', 'chair_dips', 'towel_row', 'pike_pushup', 'plank_tap'], pinnedExerciseIds: [] }, noEquipmentGym(), { progress, library: lib });
    const ids = r.exercises.map((e) => e.exerciseId);
    expect(ids).not.toContain('pushup');
    expect(ids).toContain('diamond_pushup');
  });
});
