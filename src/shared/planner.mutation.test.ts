// Mutation-killing tests for planner.ts: score formula, cooldown/minDays, pause/ban, coach plans, generation.
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PLANNER, DEFAULT_PREF, PAUSE_FOREVER, blockedIds, buildHistory, generateSession, isPaused, muscleReport, pickCoachPlan, prefOf, scoreAll,
  scoreExercise, statusOf, type GenInput, type ScoreContext,
} from './planner';
import type { Area, CoachPlan, Exercise, ExercisePref, Gym, PlannerConfig, Session, SessionExercise } from './types';

const DAY = 86400000;
const NOW = new Date(2026, 10, 18, 12).getTime();
let n = 0;
const newId = () => `id${++n}`;

const E = (id: string, o: Partial<Exercise> = {}): Exercise => ({
  id, name: id, primary: ['Chest'], secondary: [], equipment: [], pattern: 'push', difficulty: 2, tracking: 'weight_reps',
  weightStep: 2.5, repMin: 5, repMax: 8, defaultSets: 3, ...o,
});
const pref = (id: string, o: Partial<ExercisePref> = {}): ExercisePref => ({ exerciseId: id, favorite: false, avoid: false, relevance: 50, ...o });
const done = (ids: string[], daysAgo: number, over: Partial<Session> = {}): Session => ({
  id: newId(), seq: 1, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g', gymName: 'G', status: 'completed',
  startedAt: NOW - daysAgo * DAY - 3600000, endedAt: NOW - daysAgo * DAY, targetMin: 60, warmupTargetMin: 10, adjustments: [], busyEquip: [],
  cursor: 0, phase: 'done', updatedAt: 0,
  exercises: ids.map((id, i) => ({
    id: newId(), exerciseId: id, name: id, order: i, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8, plannedSets: 3, repTarget: 8,
    plannedWeight: 50, restSec: 90, estSec: 600, status: 'done', sets: [{ weight: 50, reps: 8, doneAt: 0 }],
  } as SessionExercise)),
  ...over,
});
const P = (o: Partial<PlannerConfig> = {}): PlannerConfig => ({ ...DEFAULT_PLANNER, ...o });
const ctx = (o: Partial<ScoreContext> = {}): ScoreContext => ({ library: [E('x')], prefs: {}, sessions: [], planner: P(), now: NOW, area: null, ...o });
// distinct weights so any swap/omission changes the total: sum = 15
const W = P({ wRelevance: 1, wRecency: 2, wFrequency: 3, wCoverage: 4, wVariety: 0.7, wFavorite: 5, cooldownSessions: 0, minDaysBetween: 0, freshDays: 10, windowDays: 28, muscleOverdueDays: 10 });

describe('constants and pref helpers', () => {
  test('DEFAULT_PLANNER values', () => {
    expect(DEFAULT_PLANNER).toEqual({
      wRelevance: 1, wRecency: 1.2, wFrequency: 0.6, wCoverage: 0.8, wVariety: 0.7, wFavorite: 0.5, cooldownSessions: 1, minDaysBetween: 2,
      freshDays: 14, windowDays: 28, muscleOverdueDays: 10, jitter: 0.2,
    });
    expect(PAUSE_FOREVER).toBe(8.64e15);
    expect(DEFAULT_PREF('q')).toEqual({ exerciseId: 'q', favorite: false, avoid: false, relevance: 50 });
  });
  test('prefOf falls back to default', () => {
    expect(prefOf({}, 'z')).toEqual({ exerciseId: 'z', favorite: false, avoid: false, relevance: 50 });
    const p = pref('z', { relevance: 9 });
    expect(prefOf({ z: p }, 'z')).toBe(p);
  });
  test('isPaused: pausedUntil strictly in the future, or sessions countdown > 0', () => {
    expect(isPaused(pref('a'), NOW)).toBe(false);
    expect(isPaused(pref('a', { pausedUntil: NOW }), NOW)).toBe(false); // expiry boundary: == now is over
    expect(isPaused(pref('a', { pausedUntil: NOW + 1 }), NOW)).toBe(true);
    expect(isPaused(pref('a', { pausedUntil: NOW - 1 }), NOW)).toBe(false);
    expect(isPaused(pref('a', { pausedUntil: PAUSE_FOREVER }), NOW)).toBe(true);
    expect(isPaused(pref('a', { pausedSessions: 1 }), NOW)).toBe(true);
    expect(isPaused(pref('a', { pausedSessions: 3 }), NOW)).toBe(true);
    expect(isPaused(pref('a', { pausedSessions: 0 }), NOW)).toBe(false);
    expect(isPaused(pref('a', { pausedSessions: 0, pausedUntil: NOW - 5 }), NOW)).toBe(false);
    expect(isPaused(pref('a', { pausedSessions: 0, pausedUntil: NOW + 5 }), NOW)).toBe(true);
    expect(isPaused(pref('a', { pausedSessions: 2, pausedUntil: NOW - 5 }), NOW)).toBe(true);
    expect(isPaused(pref('a', { pausedUntil: 0 }), NOW)).toBe(false);
    expect(isPaused(pref('a', { pausedUntil: -5 }), NOW)).toBe(false);
  });
  test('statusOf precedence: banned > paused > favorite > ready', () => {
    expect(statusOf(pref('a'), NOW)).toBe('ready');
    expect(statusOf(pref('a', { favorite: true }), NOW)).toBe('favorite');
    expect(statusOf(pref('a', { favorite: true, pausedSessions: 1 }), NOW)).toBe('paused');
    expect(statusOf(pref('a', { favorite: true, pausedSessions: 1, avoid: true }), NOW)).toBe('banned');
    expect(statusOf(pref('a', { avoid: true }), NOW)).toBe('banned');
    expect(statusOf(pref('a', { pausedUntil: NOW }), NOW)).toBe('ready');
    expect(statusOf(pref('a', { pausedUntil: NOW + 1 }), NOW)).toBe('paused');
  });
  test('blockedIds lists banned and currently paused only', () => {
    const prefs = {
      ban: pref('ban', { avoid: true }), p1: pref('p1', { pausedUntil: NOW + 1 }), p2: pref('p2', { pausedSessions: 2 }), forever: pref('forever', { pausedUntil: PAUSE_FOREVER }),
      expired: pref('expired', { pausedUntil: NOW }), fav: pref('fav', { favorite: true }), zero: pref('zero', { pausedSessions: 0 }),
    };
    expect(blockedIds(prefs, NOW)).toEqual(['ban', 'p1', 'p2', 'forever']);
    expect(blockedIds({}, NOW)).toEqual([]);
    expect(blockedIds(prefs, NOW + 10)).toEqual(['ban', 'p2', 'forever']);
  });
  test('statusOf / blockedIds use the pref.exerciseId', () => {
    expect(blockedIds({ keyIgnored: pref('real', { avoid: true }) }, NOW)).toEqual(['real']);
  });
});

describe('buildHistory', () => {
  const lib = [E('a', { primary: ['Chest', 'Triceps'] }), E('b', { primary: ['Quads'] })];
  test('lastAt/sessionsSince use the newest completed session; counts only inside the window', () => {
    const sessions = [done(['a'], 30), done(['a', 'b'], 3), done(['b'], 1), done(['a'], 0.5, { status: 'discarded' }), done(['a'], 0.4, { status: 'active' })];
    const h = buildHistory({ library: lib, sessions, planner: P(), now: NOW });
    expect(h.lastAt.get('a')).toBe(NOW - 3 * DAY);
    expect(h.sessionsSince.get('a')).toBe(1);
    expect(h.lastAt.get('b')).toBe(NOW - 1 * DAY);
    expect(h.sessionsSince.get('b')).toBe(0);
    expect(h.count.get('a')).toBe(1); // 30 d ago is outside the 28 d window
    expect(h.count.get('b')).toBe(2);
    expect(h.muscleLast.get('Chest')).toBe(NOW - 3 * DAY);
    expect(h.muscleLast.get('Triceps')).toBe(NOW - 3 * DAY);
    expect(h.muscleLast.get('Quads')).toBe(NOW - 1 * DAY);
    expect(h.lastAt.has('zzz')).toBe(false);
  });
  test('window boundary is inclusive (t >= now - windowDays)', () => {
    const edge = buildHistory({ library: lib, sessions: [done(['a'], 28)], planner: P(), now: NOW });
    expect(edge.count.get('a')).toBe(1);
    const out = buildHistory({ library: lib, sessions: [done(['a'], 28, { endedAt: NOW - 28 * DAY - 1 })], planner: P(), now: NOW });
    expect(out.count.has('a')).toBe(false);
    const w7 = buildHistory({ library: lib, sessions: [done(['a'], 7), done(['a'], 8)], planner: P({ windowDays: 7 }), now: NOW });
    expect(w7.count.get('a')).toBe(1);
  });
  test('skips exercises that are not done or have no sets; unknown library ids give no muscle info; endedAt ?? startedAt', () => {
    const s = done(['a', 'b', 'ghost'], 2);
    s.exercises[0].status = 'skipped';
    s.exercises[1].sets = [];
    const h = buildHistory({ library: lib, sessions: [s], planner: P(), now: NOW });
    expect(h.lastAt.has('a')).toBe(false);
    expect(h.lastAt.has('b')).toBe(false);
    expect(h.lastAt.get('ghost')).toBe(NOW - 2 * DAY);
    expect(h.muscleLast.size).toBe(0);
    const noEnd = done(['a'], 2, { endedAt: undefined, startedAt: NOW - 2 * DAY - 5 });
    expect(buildHistory({ library: lib, sessions: [noEnd], planner: P(), now: NOW }).lastAt.get('a')).toBe(NOW - 2 * DAY - 5);
  });
  test('sessionsSince counts completed sessions newest first regardless of input order', () => {
    const sessions = [done(['x'], 9), done(['y'], 1), done(['z'], 5), done(['a'], 7)];
    const h = buildHistory({ library: lib, sessions, planner: P(), now: NOW });
    expect(h.sessionsSince.get('y')).toBe(0);
    expect(h.sessionsSince.get('z')).toBe(1);
    expect(h.sessionsSince.get('a')).toBe(2);
    expect(h.sessionsSince.get('x')).toBe(3);
    // an exercise done multiple times keeps the newest occurrence
    const twice = buildHistory({ library: lib, sessions: [done(['a'], 9), done(['a'], 2)], planner: P(), now: NOW });
    expect(twice.lastAt.get('a')).toBe(NOW - 2 * DAY);
    expect(twice.sessionsSince.get('a')).toBe(0);
    expect(twice.count.get('a')).toBe(2);
  });
});

describe('scoreExercise: formula', () => {
  const x = E('x', { primary: ['Chest'] });
  test('never done: components and weighted total', () => {
    const s = scoreExercise(ctx({ planner: W, prefs: { x: pref('x', { relevance: 80, favorite: true }) } }), x);
    expect(s).toMatchObject({ exerciseId: 'x', name: 'x', relevance: 80, recency: 100, frequency: 100, coverage: 100, favorite: 100, coolingDown: false, avoided: false, paused: false, daysSince: null, sessionsSince: null, timesInWindow: 0 });
    expect(s.total).toBe(98.7); // (80 + 200 + 300 + 400 + 500) / 15
    expect(s.reasons).toEqual(['Favorite.', 'Never done: fresh.', 'Covers muscles that are overdue.']);
  });
  test('without favorite the favorite term is 0', () => {
    const s = scoreExercise(ctx({ planner: W, prefs: { x: pref('x', { relevance: 80 }) } }), x);
    expect(s.favorite).toBe(0);
    expect(s.total).toBe(65.3); // 980 / 15
    expect(s.reasons).toEqual(['Never done: fresh.', 'Covers muscles that are overdue.']);
  });
  test('done 5 d ago (not cooling): recency 50, frequency 50 (maxCount 1), coverage 50', () => {
    const c = ctx({ planner: W, sessions: [done(['x'], 5)], prefs: { x: pref('x', { relevance: 80, favorite: true }) } });
    const s = scoreExercise(c, x, buildHistory(c), 1);
    expect(s).toMatchObject({ relevance: 80, recency: 50, frequency: 50, coverage: 50, favorite: 100, coolingDown: false, daysSince: 5, sessionsSince: 0, timesInWindow: 1 });
    expect(s.total).toBe(68.7); // (80 + 100 + 150 + 200 + 500) / 15
    expect(s.reasons).toEqual(['Favorite.']);
  });
  test('cooling: recency 0, total -40, reason text', () => {
    const c = ctx({ planner: P({ ...W, cooldownSessions: 1 }), sessions: [done(['x'], 5)], prefs: { x: pref('x', { relevance: 80, favorite: true }) } });
    const s = scoreExercise(c, x, buildHistory(c), 1);
    expect(s.coolingDown).toBe(true);
    expect(s.recency).toBe(0);
    expect(s.total).toBe(22); // (80 + 0 + 150 + 200 + 500) / 15 - 40
    expect(s.reasons).toEqual(['Cooling down: done last session (5 d).', 'Favorite.']);
  });
  test('cooling reason for older sessions uses the count', () => {
    const c = ctx({ planner: P({ ...W, cooldownSessions: 3 }), sessions: [done(['y'], 1), done(['x'], 5)] });
    const s = scoreExercise(c, x);
    expect(s.coolingDown).toBe(true);
    expect(s.reasons[0]).toBe('Cooling down: done 1 sessions ago (5 d).');
  });
  test('cooldownSessions boundary: sinceSessions < cooldown', () => {
    const sessions = [done(['y'], 1), done(['x'], 5)]; // x is 1 session ago
    expect(scoreExercise(ctx({ planner: P({ ...W, cooldownSessions: 1 }), sessions }), x).coolingDown).toBe(false);
    expect(scoreExercise(ctx({ planner: P({ ...W, cooldownSessions: 2 }), sessions }), x).coolingDown).toBe(true);
    expect(scoreExercise(ctx({ planner: P({ ...W, cooldownSessions: 0 }), sessions }), x).coolingDown).toBe(false);
  });
  test('minDaysBetween boundary: daysSince < minDays (exactly equal is fine)', () => {
    const sessions = [done(['y'], 1), done(['x'], 5)];
    expect(scoreExercise(ctx({ planner: P({ ...W, minDaysBetween: 5 }), sessions }), x).coolingDown).toBe(false);
    expect(scoreExercise(ctx({ planner: P({ ...W, minDaysBetween: 5.01 }), sessions }), x).coolingDown).toBe(true);
    expect(scoreExercise(ctx({ planner: P({ ...W, minDaysBetween: 4.99 }), sessions }), x).coolingDown).toBe(false);
  });
  test('per-exercise cooldown/minDays overrides win, including 0', () => {
    const sessions = [done(['x'], 5)]; // sinceSessions 0
    expect(scoreExercise(ctx({ planner: P({ ...W, cooldownSessions: 1 }), sessions, prefs: { x: pref('x', { cooldownSessions: 0 }) } }), x).coolingDown).toBe(false);
    expect(scoreExercise(ctx({ planner: P({ ...W, cooldownSessions: 0 }), sessions, prefs: { x: pref('x', { cooldownSessions: 1 }) } }), x).coolingDown).toBe(true);
    expect(scoreExercise(ctx({ planner: P({ ...W, minDaysBetween: 9 }), sessions, prefs: { x: pref('x', { minDaysBetween: 0 }) } }), x).coolingDown).toBe(false);
    expect(scoreExercise(ctx({ planner: P({ ...W, minDaysBetween: 0 }), sessions, prefs: { x: pref('x', { minDaysBetween: 6 }) } }), x).coolingDown).toBe(true);
    expect(scoreExercise(ctx({ planner: P({ ...W, minDaysBetween: 0 }), sessions, prefs: { x: pref('x', { minDaysBetween: 5 }) } }), x).coolingDown).toBe(false);
  });
  test('recency scales daysSince/freshDays and clamps at 100', () => {
    const rec = (days: number, fresh = 10) => scoreExercise(ctx({ planner: P({ ...W, freshDays: fresh }), sessions: [done(['x'], days)] }), x).recency;
    expect(rec(2.5)).toBe(25);
    expect(rec(10)).toBe(100);
    expect(rec(20)).toBe(100);
    expect(rec(5, 20)).toBe(25);
  });
  test('frequency = 100 x (1 - times/(max+1)); 100 when maxCount is 0', () => {
    const sessions = [done(['x'], 3), done(['x'], 4), done(['x'], 5)];
    const c = ctx({ planner: W, sessions });
    const h = buildHistory(c);
    expect(scoreExercise(c, x, h, 3).frequency).toBe(25); // 3 of max 3 -> 1 - 3/4
    expect(scoreExercise(c, x, h, 5).frequency).toBe(50); // 1 - 3/6
    expect(scoreExercise(c, x, h, 0).frequency).toBe(100);
    expect(scoreExercise(c, x, h).frequency).toBe(100); // default maxCount 0
    expect(scoreExercise(c, E('never'), h, 3).frequency).toBe(100);
    expect(scoreExercise(c, x, h, 3).reasons).toContain('Done 3× in 28 d.');
    expect(scoreExercise(ctx({ planner: W, sessions: sessions.slice(0, 2) }), x, undefined, 2).reasons.join()).not.toContain('Done 2');
  });
  test('coverage: average over primary muscles of days-since / overdueDays, clamped', () => {
    const two = E('two', { primary: ['Chest', 'Triceps'] });
    const c = ctx({ planner: W, sessions: [done(['x'], 5)], library: [x, two] });
    // Chest 5 d -> .5, Triceps never -> 1 -> 75
    expect(scoreExercise(c, two).coverage).toBe(75);
    expect(scoreExercise(c, E('t', { primary: ['Triceps'] })).coverage).toBe(100);
    expect(scoreExercise(ctx({ planner: W, sessions: [done(['x'], 20)] }), x).coverage).toBe(100); // clamped
    expect(scoreExercise(ctx({ planner: P({ ...W, muscleOverdueDays: 20 }), sessions: [done(['x'], 5)] }), x).coverage).toBe(25);
    expect(scoreExercise(ctx({ planner: W }), E('none', { primary: [] })).coverage).toBe(0);
    expect(scoreExercise(ctx({ planner: W, area: { focusMuscles: ['Chest'] } }), E('none', { primary: [] })).coverage).toBe(0);
  });
  test('focus muscles scale coverage by 0.5 + 0.5 x fit', () => {
    const two = E('two', { primary: ['Chest', 'Triceps'] });
    const noOverlap = E('q', { primary: ['Quads'] });
    const base = ctx({ planner: W });
    expect(scoreExercise({ ...base, area: { focusMuscles: ['Chest'] } }, two).coverage).toBe(75); // fit 1/2
    expect(scoreExercise({ ...base, area: { focusMuscles: ['Chest', 'Triceps'] } }, two).coverage).toBe(100); // fit 1
    expect(scoreExercise({ ...base, area: { focusMuscles: ['Quads'] } }, two).coverage).toBe(50); // fit 0
    expect(scoreExercise({ ...base, area: { focusMuscles: ['Chest'] } }, noOverlap).coverage).toBe(50);
    expect(scoreExercise({ ...base, area: { focusMuscles: [] } }, two).coverage).toBe(100);
    expect(scoreExercise({ ...base, area: null }, two).coverage).toBe(100);
    expect(scoreExercise({ ...base, area: undefined }, two).coverage).toBe(100);
  });
  test('relevance is clamped to 0..100', () => {
    expect(scoreExercise(ctx({ planner: W, prefs: { x: pref('x', { relevance: 250 }) } }), x).relevance).toBe(100);
    expect(scoreExercise(ctx({ planner: W, prefs: { x: pref('x', { relevance: -5 }) } }), x).relevance).toBe(0);
    expect(scoreExercise(ctx({ planner: W, prefs: { x: pref('x', { relevance: 33.3 }) } }), x).relevance).toBe(33.3);
  });
  test('all weights zero -> total 0 (not NaN)', () => {
    const Z = P({ wRelevance: 0, wRecency: 0, wFrequency: 0, wCoverage: 0, wFavorite: 0 });
    expect(scoreExercise(ctx({ planner: Z }), x).total).toBe(0);
  });
  test('each weight individually drives the total', () => {
    const only = (k: keyof PlannerConfig, c: Partial<ScoreContext> = {}, maxCount = 0) =>
      scoreExercise(ctx({ planner: P({ wRelevance: 0, wRecency: 0, wFrequency: 0, wCoverage: 0, wFavorite: 0, [k]: 2 }), ...c }), x, undefined, maxCount).total;
    expect(only('wRelevance', { prefs: { x: pref('x', { relevance: 30 }) } })).toBe(30);
    expect(only('wRecency', { sessions: [done(['x'], 5)], planner: P({ wRelevance: 0, wRecency: 2, wFrequency: 0, wCoverage: 0, wFavorite: 0, freshDays: 10, cooldownSessions: 0, minDaysBetween: 0 }) })).toBe(50);
    expect(only('wFavorite', { prefs: { x: pref('x', { favorite: true }) } })).toBe(100);
    expect(only('wFrequency')).toBe(100);
    expect(only('wCoverage')).toBe(100);
    // variety weight does NOT enter the single-exercise score
    const a = scoreExercise(ctx({ planner: P({ wVariety: 0 }) }), x).total;
    const b = scoreExercise(ctx({ planner: P({ wVariety: 5 }) }), x).total;
    expect(a).toBe(b);
  });
  test('total rounds to 1 decimal; all components rounded to 1 decimal', () => {
    const c = ctx({ planner: P({ ...W, freshDays: 7 }), sessions: [done(['x'], 1.0123456)] });
    const s = scoreExercise(c, x);
    for (const v of [s.total, s.recency, s.frequency, s.coverage, s.relevance, s.daysSince!]) expect(Math.round(v * 10) / 10).toBe(v);
    expect(s.daysSince).toBe(1);
    expect(s.recency).toBe(14.5);
  });
});

describe('scoreExercise: reasons and flags', () => {
  const x = E('x', { primary: ['Chest'] });
  test('banned / paused flags and reasons (banned wins)', () => {
    const b = scoreExercise(ctx({ prefs: { x: pref('x', { avoid: true, pausedSessions: 1 }) } }), x);
    expect(b.avoided).toBe(true);
    expect(b.paused).toBe(true);
    expect(b.reasons).toContain('Banned: never planned or swapped in.');
    expect(b.reasons).not.toContain('Paused: skipped until it returns automatically.');
    const p = scoreExercise(ctx({ prefs: { x: pref('x', { pausedUntil: NOW + 1 }) } }), x);
    expect(p.paused).toBe(true);
    expect(p.avoided).toBe(false);
    expect(p.reasons).toContain('Paused: skipped until it returns automatically.');
    const e = scoreExercise(ctx({ prefs: { x: pref('x', { pausedUntil: NOW }) } }), x);
    expect(e.paused).toBe(false);
    expect(e.reasons).not.toContain('Paused: skipped until it returns automatically.');
  });
  test('"Not done for N days" only when not cooling and strictly beyond freshDays', () => {
    const at = (days: number, over: Partial<PlannerConfig> = {}) => scoreExercise(ctx({ planner: P({ ...W, ...over }), sessions: [done(['x'], days)] }), x).reasons;
    expect(at(10)).not.toContainEqual(expect.stringContaining('Not done for'));
    expect(at(10.5)).toContain('Not done for 11 days.');
    expect(at(20)).toContain('Not done for 20 days.');
    expect(at(20, { cooldownSessions: 1 })).not.toContainEqual(expect.stringContaining('Not done for')); // cooling
    expect(at(4)).not.toContainEqual(expect.stringContaining('Never done'));
  });
  test('coverage reasons: > 70 overdue, < 25 recent, thresholds exclusive', () => {
    const r = (days: number) => scoreExercise(ctx({ planner: W, sessions: [done(['x'], days)] }), x).reasons;
    expect(r(7.1)).toContain('Covers muscles that are overdue.');
    expect(r(7)).not.toContain('Covers muscles that are overdue.'); // cov = 70
    expect(r(7)).not.toContain('Covers muscles trained recently.');
    expect(r(2.4)).toContain('Covers muscles trained recently.');
    expect(r(2.5)).not.toContain('Covers muscles trained recently.'); // cov = 25
    expect(r(2.5)).not.toContain('Covers muscles that are overdue.');
    expect(r(5)).toEqual([]);
  });
  test('"Done N× in W d" from 3 times, using windowDays', () => {
    const mk = (k: number) => scoreExercise(ctx({ planner: P({ ...W, windowDays: 30 }), sessions: Array.from({ length: k }, (_, i) => done(['x'], 3 + i)) }), x).reasons;
    expect(mk(2).some((s) => s.startsWith('Done'))).toBe(false);
    expect(mk(3)).toContain('Done 3× in 30 d.');
    expect(mk(4)).toContain('Done 4× in 30 d.');
  });
});

describe('scoreAll', () => {
  test('maxCount is taken from the scored exercises, one result per exercise in input order', () => {
    const a = E('a'), b = E('b'), c = E('c');
    const c0 = ctx({ library: [a, b, c], planner: W, sessions: [done(['a'], 3), done(['a'], 4), done(['b'], 5)] });
    const all = scoreAll(c0);
    expect(all.map((s) => s.exerciseId)).toEqual(['a', 'b', 'c']);
    expect(all.map((s) => s.frequency)).toEqual([33.3, 66.7, 100]); // 1-2/3, 1-1/3, 1
    // limiting the list lowers maxCount
    expect(scoreAll(c0, [b, c]).map((s) => s.frequency)).toEqual([50, 100]);
    expect(scoreAll(ctx({ library: [a], planner: W })).map((s) => s.frequency)).toEqual([100]);
  });
});

describe('pickCoachPlan', () => {
  const plan = (id: string, o: Partial<CoachPlan> = {}): CoachPlan => ({ id, title: id, exercises: [], status: 'pending', createdBy: 'x', createdAt: 100, ...o });
  test('only pending plans matching slot and area', () => {
    expect(pickCoachPlan([], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p', { status: 'used' })], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p', { status: 'cancelled' })], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p', { slot: 2 })], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p', { slot: 1 })], 1, 'a')?.id).toBe('p');
    expect(pickCoachPlan([plan('p', { areaId: 'b' })], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p', { areaId: 'a' })], 1, 'a')?.id).toBe('p');
    expect(pickCoachPlan([plan('p', { slot: 1, areaId: 'b' })], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p', { slot: 2, areaId: 'a' })], 1, 'a')).toBeNull();
    expect(pickCoachPlan([plan('p')], 7, 'zzz')?.id).toBe('p');
    expect(pickCoachPlan([plan('p', { slot: 0 })], 0, 'a')?.id).toBe('p');
    expect(pickCoachPlan([plan('p', { slot: 0 })], 1, 'a')).toBeNull();
  });
  test('specific beats generic: slot > area > any; then oldest first', () => {
    const g = plan('generic', { createdAt: 1 });
    const a = plan('area', { areaId: 'a', createdAt: 2 });
    const s = plan('slot', { slot: 1, createdAt: 3 });
    expect(pickCoachPlan([g, a, s], 1, 'a')?.id).toBe('slot');
    expect(pickCoachPlan([g, a], 1, 'a')?.id).toBe('area');
    expect(pickCoachPlan([a, g], 1, 'a')?.id).toBe('area');
    expect(pickCoachPlan([g, a, s], 2, 'a')?.id).toBe('area');
    expect(pickCoachPlan([g, a, s], 2, 'b')?.id).toBe('generic');
    expect(pickCoachPlan([plan('new', { createdAt: 9 }), plan('old', { createdAt: 1 }), plan('mid', { createdAt: 5 })], 1, 'a')?.id).toBe('old');
    expect(pickCoachPlan([plan('s2', { slot: 1, createdAt: 5 }), plan('s1', { slot: 1, createdAt: 2, areaId: 'a' })], 1, 'a')?.id).toBe('s1');
    // slot + area both set counts as slot-specific
    expect(pickCoachPlan([plan('areaOnly', { areaId: 'a', createdAt: 1 }), plan('both', { slot: 1, areaId: 'a', createdAt: 2 })], 1, 'a')?.id).toBe('both');
  });
  test('does not reorder the caller array', () => {
    const list = [plan('b', { createdAt: 9 }), plan('a', { createdAt: 1 })];
    pickCoachPlan(list, 1, 'a');
    expect(list.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('muscleReport', () => {
  const lib = [E('a', { primary: ['Chest'], secondary: ['Triceps'] }), E('b', { primary: ['Quads', 'Glutes'], secondary: ['Calves'] })];
  test('per-muscle aggregation', () => {
    const s1 = done(['a'], 3); s1.exercises[0].sets = [{ weight: 50, reps: 8, doneAt: 0 }, { weight: 60, reps: 5, doneAt: 0 }];
    const s2 = done(['a', 'b'], 40);
    const rows = muscleReport([s1, s2], lib, NOW);
    const by = Object.fromEntries(rows.map((r) => [r.muscle, r]));
    expect(by.Chest).toEqual({ muscle: 'Chest', lastTrainedDaysAgo: 3, sets: 2, secondarySets: 0, volumeKg: 700, sessions: 1 });
    expect(by.Triceps).toEqual({ muscle: 'Triceps', lastTrainedDaysAgo: null, sets: 0, secondarySets: 2, volumeKg: 0, sessions: 0 });
    expect(by.Quads).toEqual({ muscle: 'Quads', lastTrainedDaysAgo: 40, sets: 0, secondarySets: 0, volumeKg: 0, sessions: 0 });
    expect(by.Glutes.lastTrainedDaysAgo).toBe(40);
    expect(by.Calves).toEqual({ muscle: 'Calves', lastTrainedDaysAgo: null, sets: 0, secondarySets: 0, volumeKg: 0, sessions: 0 });
    expect(rows).toHaveLength(5);
  });
  test('window boundary inclusive, custom window, min days across sessions, rounding', () => {
    const edge = muscleReport([done(['a'], 28)], lib, NOW).find((r) => r.muscle === 'Chest')!;
    expect(edge.sets).toBe(1);
    expect(edge.secondarySets).toBe(0);
    expect(muscleReport([done(['a'], 28)], lib, NOW).find((r) => r.muscle === 'Triceps')!.secondarySets).toBe(1); // inclusive for secondary muscles too
    expect(muscleReport([done(['a'], 28, { endedAt: NOW - 28 * DAY - 1 })], lib, NOW).find((r) => r.muscle === 'Triceps')!.secondarySets).toBe(0);
    const out = muscleReport([done(['a'], 28, { endedAt: NOW - 28 * DAY - 1 })], lib, NOW).find((r) => r.muscle === 'Chest')!;
    expect(out.sets).toBe(0);
    expect(muscleReport([done(['a'], 10)], lib, NOW, 7).find((r) => r.muscle === 'Chest')!.sets).toBe(0);
    expect(muscleReport([done(['a'], 10)], lib, NOW, 14).find((r) => r.muscle === 'Chest')!.sets).toBe(1);
    const triceps = muscleReport([done(['a'], 10)], lib, NOW, 14).find((r) => r.muscle === 'Triceps')!;
    expect(triceps.secondarySets).toBe(1);
    expect(muscleReport([done(['a'], 10)], lib, NOW, 7).find((r) => r.muscle === 'Triceps')!.secondarySets).toBe(0);
    // newest of several sessions wins, in any input order
    expect(muscleReport([done(['a'], 9), done(['a'], 2), done(['a'], 5)], lib, NOW).find((r) => r.muscle === 'Chest')!.lastTrainedDaysAgo).toBe(2);
    expect(muscleReport([done(['a'], 2), done(['a'], 9)], lib, NOW).find((r) => r.muscle === 'Chest')!.lastTrainedDaysAgo).toBe(2);
    expect(muscleReport([done(['a'], 2.26)], lib, NOW).find((r) => r.muscle === 'Chest')!.lastTrainedDaysAgo).toBe(2.3);
    expect(muscleReport([done(['a'], 2), done(['a'], 2)], lib, NOW).find((r) => r.muscle === 'Chest')!.sessions).toBe(2);
  });
  test('ignores discarded sessions, skipped exercises, empty sets and unknown exercises', () => {
    const skipped = done(['a'], 1); skipped.exercises[0].status = 'skipped';
    const empty = done(['a'], 1); empty.exercises[0].sets = [];
    const rows = muscleReport([done(['a'], 1, { status: 'discarded' }), skipped, empty, done(['ghost'], 1)], lib, NOW);
    expect(rows.every((r) => r.lastTrainedDaysAgo === null && r.sets === 0)).toBe(true);
  });
  test('sorted most-neglected first, never-trained (null) first of all', () => {
    const rows = muscleReport([done(['a'], 3), done(['b'], 9)], lib, NOW);
    expect(rows.map((r) => r.muscle)).toEqual(expect.arrayContaining(['Chest', 'Quads']));
    const days = rows.map((r) => r.lastTrainedDaysAgo ?? 9999);
    expect(days).toEqual([...days].sort((x, y) => y - x));
    expect(rows[0].lastTrainedDaysAgo).toBeNull();
    expect(rows[rows.length - 1].muscle).toBe('Chest');
    expect(rows[rows.length - 2].lastTrainedDaysAgo).toBe(9);
  });
});

// ───────────────────────── generateSession ─────────────────────────
const gym = (equipment: Record<string, 'ok' | 'broken'> = {}): Gym => ({ id: 'g', name: 'G', lat: null, lng: null, radiusM: 100, equipment, notes: {}, brokenSince: {}, createdAt: 0 });
const area = (o: Partial<Area> = {}): Area => ({ id: 'a', name: 'A', focusMuscles: ['Chest'], exercisesPerSession: 2, mode: 'auto', pinnedExerciseIds: [], poolExerciseIds: [], ...o });
const gen = (o: Partial<GenInput> & { library: Exercise[] }): ReturnType<typeof generateSession> =>
  generateSession({ area: area(), gym: gym(), prefs: {}, progress: {}, sessions: [], planner: P({ jitter: 0, wVariety: 0.7 }), restSec: 90, targetMin: 60, warmupMin: 10, now: NOW, newId, ...o });
const RELEVANCE_ONLY = P({ wRelevance: 1, wRecency: 0, wFrequency: 0, wCoverage: 0, wFavorite: 0, wVariety: 1, jitter: 0, cooldownSessions: 1, minDaysBetween: 2 });
const rel = (...pairs: [string, number][]) => Object.fromEntries(pairs.map(([id, r]) => [id, pref(id, { relevance: r })]));
const ids = (r: ReturnType<typeof generateSession>) => r.exercises.map((e) => e.exerciseId);

describe('generateSession: auto selection', () => {
  test('picks the best-scoring exercises when jitter is 0 and variant 0', () => {
    const library = [E('a'), E('b', { primary: ['Quads'], pattern: 'squat' }), E('c', { primary: ['Lats'], pattern: 'pull' }), E('d', { primary: ['Core'], pattern: 'core' })];
    const r = gen({ library, area: area({ poolExerciseIds: ['a', 'b', 'c', 'd'], exercisesPerSession: 2 }), planner: RELEVANCE_ONLY, prefs: rel(['a', 10], ['b', 90], ['c', 80], ['d', 20]) });
    expect(ids(r).sort()).toEqual(['b', 'c']);
    expect(r.source).toBe('auto');
    expect(r.warmupMin).toBe(10);
    expect(r.scores.map((s) => s.exerciseId)).toEqual(['b', 'c', 'd', 'a']); // sorted by total desc
  });
  test('exercisesPerSession is honoured and at least 1', () => {
    const library = ['a', 'b', 'c', 'd'].map((i, k) => E(i, { primary: ['Chest', 'Quads', 'Lats', 'Core'].slice(k, k + 1) as never, pattern: (['push', 'squat', 'pull', 'core'] as const)[k] }));
    const base = { library, area: area({ poolExerciseIds: ['a', 'b', 'c', 'd'] }), planner: RELEVANCE_ONLY };
    expect(gen({ ...base, area: area({ poolExerciseIds: ['a', 'b', 'c', 'd'], exercisesPerSession: 3 }) }).exercises).toHaveLength(3);
    expect(gen({ ...base, area: area({ poolExerciseIds: ['a', 'b', 'c', 'd'], exercisesPerSession: 0 }) }).exercises).toHaveLength(1);
    expect(gen({ ...base, area: area({ poolExerciseIds: ['a', 'b', 'c', 'd'], exercisesPerSession: 10 }) }).exercises).toHaveLength(4);
    expect(gen({ ...base, area: area({ poolExerciseIds: ['a', 'b', 'c', 'd'], exercisesPerSession: 1 }) }).exercises).toHaveLength(1);
  });
  test('pool falls back to library exercises whose primary muscles match the focus', () => {
    const library = [E('chest1', { primary: ['Chest'] }), E('chest2', { primary: ['Chest', 'Triceps'], pattern: 'pull' }), E('quad', { primary: ['Quads'] }), E('lat', { primary: ['Lats'] })];
    const r = gen({ library, area: area({ poolExerciseIds: [], focusMuscles: ['Chest', 'Lats'], exercisesPerSession: 10 }) });
    expect(ids(r).sort()).toEqual(['chest1', 'chest2', 'lat']);
    expect(ids(gen({ library, area: area({ poolExerciseIds: [], focusMuscles: ['Quads'], exercisesPerSession: 10 }) }))).toEqual(['quad']);
    expect(gen({ library, area: area({ poolExerciseIds: [], focusMuscles: [], exercisesPerSession: 10 }) }).exercises).toEqual([]);
  });
  test('archived, unknown, banned, paused and excluded exercises are never picked; hiddenNames lists unavailable pool items only', () => {
    const library = [E('ok'), E('arch', { archived: true }), E('ban'), E('pause'), E('exc'), E('need', { name: 'Needs rack', equipment: ['rack'] }), E('ok2', { primary: ['Quads'], pattern: 'squat' })];
    const r = gen({
      library, area: area({ poolExerciseIds: ['ok', 'arch', 'ghost', 'ban', 'pause', 'exc', 'need', 'ok2'], exercisesPerSession: 10 }),
      prefs: { ban: pref('ban', { avoid: true }), pause: pref('pause', { pausedSessions: 1 }) }, excludeIds: ['exc'], gym: gym({ bar: 'ok' }),
    });
    expect(ids(r).sort()).toEqual(['ok', 'ok2']);
    expect(r.hiddenNames).toEqual(['Needs rack']);
    // broken equipment is hidden too
    expect(gen({ library, area: area({ poolExerciseIds: ['need'], exercisesPerSession: 1 }), gym: gym({ rack: 'broken' }) }).hiddenNames).toEqual(['Needs rack']);
    expect(gen({ library, area: area({ poolExerciseIds: ['need'], exercisesPerSession: 1 }), gym: gym({ rack: 'ok' }) }).hiddenNames).toEqual([]);
    // busy equipment hides it
    expect(gen({ library, area: area({ poolExerciseIds: ['need'], exercisesPerSession: 1 }), gym: gym({ rack: 'ok' }), busy: ['rack'] }).hiddenNames).toEqual(['Needs rack']);
    // an expired pause is not blocked
    expect(ids(gen({ library, area: area({ poolExerciseIds: ['pause'], exercisesPerSession: 1 }), prefs: { pause: pref('pause', { pausedUntil: NOW }) } }))).toEqual(['pause']);
    expect(ids(gen({ library, area: area({ poolExerciseIds: ['pause'], exercisesPerSession: 1 }), prefs: { pause: pref('pause', { pausedUntil: NOW + 1 }) } }))).toEqual([]);
  });
  test('no gym = nothing is available', () => {
    const r = gen({ library: [E('need', { equipment: ['rack'] }), E('free')], area: area({ poolExerciseIds: ['need', 'free'] }), gym: null });
    expect(ids(r)).toEqual(['free']);
  });
  test('pinned exercises come first (up to n) and only if usable', () => {
    const library = [E('p1'), E('p2', { primary: ['Quads'], pattern: 'squat' }), E('p3', { primary: ['Lats'], pattern: 'pull' }), E('x', { primary: ['Core'], pattern: 'core' }), E('pn', { equipment: ['rack'] })];
    const pool = ['p1', 'p2', 'p3', 'x', 'pn'];
    const prefs = rel(['x', 100], ['p1', 0], ['p2', 0], ['p3', 0]);
    expect(ids(gen({ library, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: pool, pinnedExerciseIds: ['p1', 'p2', 'p3'], exercisesPerSession: 2 }) }))).toEqual(['p1', 'p2']);
    expect(ids(gen({ library, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: pool, pinnedExerciseIds: ['p3'], exercisesPerSession: 2 }) })).sort()).toEqual(['p3', 'x']);
    // pinned but unavailable -> skipped; pinned but banned -> skipped; pinned not in pool -> skipped
    expect(ids(gen({ library, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: pool, pinnedExerciseIds: ['pn'], exercisesPerSession: 1 }) }))).toEqual(['x']);
    expect(ids(gen({ library, prefs: { ...prefs, p3: pref('p3', { avoid: true }) }, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: pool, pinnedExerciseIds: ['p3'], exercisesPerSession: 1 }) }))).toEqual(['x']);
    expect(ids(gen({ library, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: ['x'], pinnedExerciseIds: ['p3'], exercisesPerSession: 1 }) }))).toEqual(['x']);
    // pinned flag is exposed on the session exercise
    const r = gen({ library, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: pool, pinnedExerciseIds: ['p3'], exercisesPerSession: 2 }) });
    expect(r.exercises.find((e) => e.exerciseId === 'p3')!.pinned).toBe(true);
    expect(r.exercises.find((e) => e.exerciseId === 'x')!.pinned).toBe(false);
  });
  test('non-cooling exercises are filled first even when a cooling one has a higher raw score', () => {
    const library = [E('hot', { primary: ['Quads'], pattern: 'squat' }), E('cool', { primary: ['Lats'], pattern: 'pull' }), E('w', { primary: ['Core'], pattern: 'core' })];
    const sessions = [done(['cool'], 1)];
    const prefs = rel(['hot', 5], ['cool', 100], ['w', 1]);
    const one = gen({ library, sessions, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: ['hot', 'cool', 'w'], exercisesPerSession: 1 }) });
    expect(ids(one)).toEqual(['hot']);
    const two = gen({ library, sessions, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: ['hot', 'cool', 'w'], exercisesPerSession: 2 }) });
    expect(ids(two).sort()).toEqual(['hot', 'w']);
    const three = gen({ library, sessions, prefs, planner: RELEVANCE_ONLY, area: area({ poolExerciseIds: ['hot', 'cool', 'w'], exercisesPerSession: 3 }) });
    expect(ids(three).sort()).toEqual(['cool', 'hot', 'w']);
  });
  test('variety penalty = 35 x wVariety x similarity to the exercises already chosen', () => {
    // first pick is the pinned X (primary Chest, pattern push). Candidate P has relevance 100 and similarity `v`; Q is unrelated.
    const X = E('X', { primary: ['Chest'], pattern: 'push' });
    const tiers: [string, Partial<Exercise>, number][] = [
      ['same primary + same pattern', { primary: ['Chest'], pattern: 'push' }, 1],
      ['overlapping primary + same pattern', { primary: ['Chest', 'Triceps'], pattern: 'push' }, 0.7],
      ['overlapping primary, other pattern', { primary: ['Chest', 'Triceps'], pattern: 'pull' }, 0.45],
      ['other primary, same pattern', { primary: ['Quads'], pattern: 'push' }, 0.2],
      ['nothing shared', { primary: ['Quads'], pattern: 'pull' }, 0],
    ];
    const extraTiers: [string, Partial<Exercise>, number][] = [
      ['same primary, other pattern', { primary: ['Chest'], pattern: 'pull' }, 0.45],
    ];
    tiers.push(...extraTiers);
    for (const [label, over, v] of tiers) {
      const lib = [X, E('P', over), E('Q', { primary: ['Core'], pattern: 'core' })];
      const run = (qRel: number, wVariety = 1) => ids(gen({
        library: lib, planner: { ...RELEVANCE_ONLY, wVariety }, prefs: rel(['X', 0], ['P', 100], ['Q', qRel]),
        area: area({ poolExerciseIds: ['X', 'P', 'Q'], pinnedExerciseIds: ['X'], exercisesPerSession: 2 }),
      })).filter((i) => i !== 'X')[0];
      // Q is dissimilar to X: 0 penalty. P scores 100 - 35 v.
      expect([label, run(100 - 35 * v - 1)]).toEqual([label, 'P']);
      if (v > 0) expect([label, run(100 - 35 * v + 1)]).toEqual([label, 'Q']);
    }
    // candidate primaries that are a strict SUBSET of the chosen exercise's primaries are not "the same" (0.7, not 1)
    const X2 = E('X', { primary: ['Chest', 'Triceps'], pattern: 'push' });
    const sub = (qRel: number) => ids(gen({
      library: [X2, E('P', { primary: ['Chest'], pattern: 'push' }), E('Q', { primary: ['Core'], pattern: 'core' })], planner: RELEVANCE_ONLY, prefs: rel(['X', 0], ['P', 100], ['Q', qRel]),
      area: area({ poolExerciseIds: ['X', 'P', 'Q'], pinnedExerciseIds: ['X'], exercisesPerSession: 2 }),
    })).filter((i) => i !== 'X')[0];
    expect(sub(100 - 35 * 0.7 - 1)).toBe('P');
    expect(sub(100 - 35 * 0.7 + 1)).toBe('Q');
    // wVariety scales the penalty
    const lib = [X, E('P', { primary: ['Chest'], pattern: 'push' }), E('Q', { primary: ['Core'], pattern: 'core' })];
    const pick = (wVariety: number, qRel: number) => ids(gen({ library: lib, planner: { ...RELEVANCE_ONLY, wVariety }, prefs: rel(['X', 0], ['P', 100], ['Q', qRel]), area: area({ poolExerciseIds: ['X', 'P', 'Q'], pinnedExerciseIds: ['X'], exercisesPerSession: 2 }) })).filter((i) => i !== 'X')[0];
    expect(pick(0, 1)).toBe('P');
    expect(pick(2, 31)).toBe('Q'); // 100 - 70 = 30 < 31
    expect(pick(2, 29)).toBe('P');
    expect(pick(0.5, 83)).toBe('Q'); // 100 - 17.5 = 82.5 < 83
    expect(pick(0.5, 82)).toBe('P');
  });
  test('variety penalty max is over every chosen (P penalised by X2, not X1)', () => {
    const lib = [E('X1', { primary: ['Chest'], pattern: 'push' }), E('X2', { primary: ['Lats'], pattern: 'pull' }), E('P', { primary: ['Lats'], pattern: 'pull' }), E('Q', { primary: ['Core'], pattern: 'core' })];
    const pick = (q: number) => ids(gen({
      library: lib, planner: RELEVANCE_ONLY, prefs: rel(['X1', 0], ['X2', 0], ['P', 100], ['Q', q]),
      area: area({ poolExerciseIds: ['X1', 'X2', 'P', 'Q'], pinnedExerciseIds: ['X1', 'X2'], exercisesPerSession: 3 }),
    })).filter((i) => !i.startsWith('X'))[0];
    expect(pick(66)).toBe('Q'); // P = 100 - 35 = 65 < 66
    expect(pick(65.5)).toBe('Q');
    expect(pick(64)).toBe('P'); // 65 > 64
  });
  test('a pinned exercise is never picked twice by the fill; ties go to the earlier pool entry', () => {
    const library = [E('p', { primary: ['Chest'] }), E('o1', { primary: ['Quads'], pattern: 'squat' }), E('o2', { primary: ['Lats'], pattern: 'pull' })];
    const r = gen({ library, planner: { ...RELEVANCE_ONLY, wVariety: 0 }, prefs: rel(['p', 100], ['o1', 10], ['o2', 10]), area: area({ poolExerciseIds: ['p', 'o1', 'o2'], pinnedExerciseIds: ['p'], exercisesPerSession: 2 }) });
    expect(ids(r).sort()).toEqual(['o1', 'p']); // not ['p', 'p'], and o1 (earlier) beats the equal-scoring o2
    const tie = gen({ library, planner: { ...RELEVANCE_ONLY, wVariety: 0 }, prefs: rel(['p', 0], ['o1', 40], ['o2', 40]), area: area({ poolExerciseIds: ['o2', 'o1', 'p'], exercisesPerSession: 1 }) });
    expect(ids(tie)).toEqual(['o2']); // first in pool order among equals
    const three = gen({ library, planner: { ...RELEVANCE_ONLY, wVariety: 0 }, prefs: rel(['p', 100], ['o1', 10], ['o2', 10]), area: area({ poolExerciseIds: ['p', 'o1', 'o2'], pinnedExerciseIds: ['p'], exercisesPerSession: 3 }) });
    expect(ids(three).sort()).toEqual(['o1', 'o2', 'p']);
    expect(three.exercises).toHaveLength(3);
  });
  test('ordering is stable within a rank and mobility/core sink to the end whatever their difficulty', () => {
    const mk = (id: string, o: Partial<Exercise>) => E(id, { primary: ['Chest'], ...o });
    const library = [
      mk('a', { difficulty: 1, primary: ['Biceps'], pattern: 'pull' }), mk('b', { difficulty: 1, primary: ['Calves'], pattern: 'lunge' }), mk('c', { difficulty: 1, primary: ['Forearms'], pattern: 'carry' }),
      mk('d', { difficulty: 1, primary: ['Delts'], pattern: 'push' }), mk('e', { difficulty: 1, primary: ['Lats'], pattern: 'pull' }), mk('f', { difficulty: 1, primary: ['Quads'], pattern: 'squat' }),
      mk('mob2', { difficulty: 2, primary: ['Glutes'], pattern: 'mobility' }), mk('core3', { difficulty: 3, primary: ['Core'], pattern: 'core' }),
    ];
    const pool = library.map((e) => e.id);
    const prefs = rel(...pool.map((id, i) => [id, 90 - i] as [string, number]));
    const r = gen({ library, prefs, planner: { ...RELEVANCE_ONLY, wVariety: 0 }, area: area({ poolExerciseIds: pool, exercisesPerSession: 8 }) });
    expect(ids(r)).toEqual(['core3', 'a', 'b', 'c', 'd', 'e', 'f', 'mob2']);
  });
  test('auto ordering: difficulty 3 first, then difficulty 2, then difficulty 1, core/mobility last; stable', () => {
    const library = [
      E('core1', { pattern: 'core', difficulty: 1, primary: ['Core'] }), E('d1', { difficulty: 1, primary: ['Biceps'], pattern: 'pull' }),
      E('d2', { difficulty: 2, primary: ['Quads'], pattern: 'squat' }), E('d3', { difficulty: 3, primary: ['Lats'], pattern: 'pull' }),
      E('mob3', { pattern: 'mobility', difficulty: 3, primary: ['Glutes'] }), E('core2', { pattern: 'core', difficulty: 2, primary: ['Lower back'] }),
      E('d1b', { difficulty: 1, primary: ['Calves'], pattern: 'lunge' }),
    ];
    const pool = library.map((e) => e.id);
    const prefs = rel(...pool.map((id, i) => [id, 90 - i] as [string, number]));
    const r = gen({ library, prefs, planner: { ...RELEVANCE_ONLY, wVariety: 0 }, area: area({ poolExerciseIds: pool, exercisesPerSession: 7 }) });
    // selection order is by relevance: core1, d1, d2, d3, mob3, core2, d1b. Ranks: 3,2,1,0,0,3,2.
    expect(ids(r)).toEqual(['d3', 'mob3', 'd2', 'd1', 'd1b', 'core1', 'core2']);
    expect(r.exercises.map((e) => e.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  test('fixed mode keeps pool order and skips ordering', () => {
    const library = [E('c', { pattern: 'core', difficulty: 1, primary: ['Core'] }), E('b', { difficulty: 3, primary: ['Lats'], pattern: 'pull' }), E('a', { difficulty: 2, primary: ['Quads'], pattern: 'squat' })];
    const r = gen({ library, area: area({ mode: 'fixed', poolExerciseIds: ['c', 'b', 'a'], exercisesPerSession: 2 }) });
    expect(ids(r)).toEqual(['c', 'b']);
    expect(ids(gen({ library, area: area({ mode: 'fixed', poolExerciseIds: ['c', 'b', 'a'], exercisesPerSession: 3 }) }))).toEqual(['c', 'b', 'a']);
  });
  test('fixed mode substitutes unavailable exercises via hot-swap (unless autoSwap=false)', () => {
    const library = [
      E('f1'), E('f2', { equipment: ['rack'], name: 'Rack press' }),
      E('alt', { name: 'Alt', primary: ['Chest'] }), E('other', { name: 'Other', primary: ['Quads'], pattern: 'squat' }),
    ];
    const a = area({ mode: 'fixed', poolExerciseIds: ['f1', 'f2'], exercisesPerSession: 2 });
    const r = gen({ library, area: a });
    expect(ids(r)).toEqual(['f1', 'alt']);
    expect(r.hiddenNames).toEqual(['Rack press']);
    expect(ids(gen({ library, area: a, autoSwap: false }))).toEqual(['f1']);
    expect(ids(gen({ library, area: a, autoSwap: true }))).toEqual(['f1', 'alt']);
    // the substitute never duplicates something already chosen or excluded
    expect(ids(gen({ library, area: a, excludeIds: ['alt'] }))).toEqual(['f1']);
    expect(ids(gen({ library, area: area({ mode: 'fixed', poolExerciseIds: ['f1', 'alt', 'f2'], exercisesPerSession: 3 }) }))).toEqual(['f1', 'alt']);
    // banned alternatives are not swapped in
    expect(ids(gen({ library, area: a, prefs: { alt: pref('alt', { avoid: true }) } }))).toEqual(['f1']);
    // only as many substitutes as slots are missing
    const lib2 = [E('f1'), E('g1', { equipment: ['rack'] }), E('g2', { equipment: ['rack'], primary: ['Chest', 'Triceps'] }), E('s1', { primary: ['Chest'] }), E('s2', { primary: ['Chest', 'Triceps'], pattern: 'pull' })];
    expect(gen({ library: lib2, area: area({ mode: 'fixed', poolExerciseIds: ['f1', 'g1', 'g2'], exercisesPerSession: 2 }) }).exercises).toHaveLength(2);
    expect(gen({ library: lib2, area: area({ mode: 'fixed', poolExerciseIds: ['f1', 'g1', 'g2'], exercisesPerSession: 3 }) }).exercises).toHaveLength(3);
  });
  test('"New mix" noise: winner matches an independent replica of the hash noise', () => {
    const fnv = (s: string, v: number) => {
      let h = 2166136261 ^ v;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0) / 4294967295;
    };
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
    const library = names.map((id, i) => E(id, { primary: [(['Chest', 'Quads', 'Lats', 'Core', 'Biceps', 'Calves', 'Glutes', 'Delts'] as const)[i]], pattern: (['push', 'squat', 'pull', 'core', 'carry', 'lunge', 'hinge', 'mobility'] as const)[i] }));
    const prefs = rel(...names.map((id, i) => [id, 50 + i * 2] as [string, number]));
    let changed = 0;
    for (const jitter of [0, 0.2, 1, 2]) {
      for (const v of [0, 1, 2, 3, 5, 9, 17, 40]) {
        const amp = 10 * jitter * 2 + (v > 0 ? 30 : 0);
        const expected = [...names].sort((a, b) => (50 + names.indexOf(b) * 2 + (fnv(b, v * 7919 + 1) - 0.5) * amp) - (50 + names.indexOf(a) * 2 + (fnv(a, v * 7919 + 1) - 0.5) * amp))[0];
        const r = gen({ library, prefs, planner: { ...RELEVANCE_ONLY, wVariety: 0, jitter }, variant: v, area: area({ poolExerciseIds: names, exercisesPerSession: 1 }) });
        expect([jitter, v, ids(r)[0]]).toEqual([jitter, v, expected]);
        if (expected !== 'hotel') changed++;
      }
    }
    expect(changed).toBeGreaterThan(8); // the noise really changes the outcome somewhere
    // jitter 0 + variant 0 is the pure score order
    expect(ids(gen({ library, prefs, planner: { ...RELEVANCE_ONLY, wVariety: 0, jitter: 0 }, area: area({ poolExerciseIds: names, exercisesPerSession: 1 }) }))).toEqual(['hotel']);
  });
});

describe('generateSession: session exercise fields', () => {
  test('prescription from progress, rest, estimate and ids', () => {
    const library = [E('a', { equipment: [], defaultSets: 4, repMin: 6, repMax: 12 })];
    const progress = { a: { exerciseId: 'a', weight: 42.5, reps: 9, sets: 5, updatedAt: 0 } };
    const r = gen({ library, area: area({ poolExerciseIds: ['a'], pinnedExerciseIds: ['a'], exercisesPerSession: 1 }), progress, restSec: 75, warmupMin: 7 });
    expect(r.warmupMin).toBe(7);
    expect(r.exercises[0]).toMatchObject({ exerciseId: 'a', plannedWeight: 42.5, repTarget: 9, plannedSets: 5, restSec: 75, estSec: 5 * (45 + 75), status: 'todo', order: 0, pinned: true });
    expect(r.exercises[0].id).toMatch(/^id\d+$/);
    const d = gen({ library, area: area({ poolExerciseIds: ['a'], exercisesPerSession: 1 }), restSec: 60 });
    expect(d.exercises[0]).toMatchObject({ plannedWeight: 25, repTarget: 8, plannedSets: 4, restSec: 60, estSec: 4 * 105, pinned: false });
    // estimate comes from history medians when available
    const hist = done(['a'], 3); hist.exercises[0].startedAt = 1000; hist.exercises[0].endedAt = 301000;
    const h = gen({ library, area: area({ poolExerciseIds: ['a'], exercisesPerSession: 1 }), sessions: [hist], planner: P({ jitter: 0, cooldownSessions: 0, minDaysBetween: 0 }) });
    expect(h.exercises[0].estSec).toBe(300);
  });
});

describe('generateSession: coach plans', () => {
  const library = [
    E('a', { name: 'A', defaultSets: 3, repMin: 6, repMax: 10 }), E('b', { name: 'B', primary: ['Quads'], pattern: 'squat' }),
    E('rk', { name: 'Rack', equipment: ['rack'], primary: ['Lats'], pattern: 'pull', defaultSets: 4, repMin: 8, repMax: 12 }),
    E('alt', { name: 'Alt', primary: ['Lats'], pattern: 'pull', repMin: 10, repMax: 15, defaultSets: 3 }), E('alt2', { name: 'Alt2', primary: ['Lats'], pattern: 'pull' }),
  ];
  const plan = (items: CoachPlan['exercises'], o: Partial<CoachPlan> = {}): CoachPlan => ({ id: 'cp', title: 'T', exercises: items, status: 'pending', createdBy: 'x', createdAt: 1, ...o });
  const g = (cp: CoachPlan, o: Partial<GenInput> = {}) => gen({ library, coachPlan: cp, area: area({ poolExerciseIds: ['b'], exercisesPerSession: 1 }), ...o });

  test('uses the plan as written: order, prescription overrides (0 respected), rest, note and ids', () => {
    const r = g(plan([{ exerciseId: 'b', sets: 5, reps: 3, weight: 0, restSec: 120 }, { exerciseId: 'a' }], { note: 'Go heavy' }));
    expect(r.source).toBe('coach');
    expect(r.coachPlanId).toBe('cp');
    expect(r.coachNote).toBe('Go heavy');
    expect(ids(r)).toEqual(['b', 'a']);
    expect(r.exercises[0]).toMatchObject({ plannedSets: 5, repTarget: 3, plannedWeight: 0, restSec: 120, order: 0 });
    expect(r.exercises[1]).toMatchObject({ plannedSets: 3, repTarget: 7, restSec: 90, order: 1 }); // defaults + planner restSec
    expect(r.exercises[1].plannedWeight).toBe(25);
    expect(r.warmupMin).toBe(10);
    expect(r.scores).toEqual([]);
    // title is the note fallback
    expect(g(plan([{ exerciseId: 'a' }], { title: 'Quad day' })).coachNote).toBe('Quad day');
    // plan weight overrides progress
    expect(g(plan([{ exerciseId: 'a', weight: 77 }]), { progress: { a: { exerciseId: 'a', weight: 40, reps: 7, sets: 4, updatedAt: 0 } } }).exercises[0]).toMatchObject({ plannedWeight: 77, repTarget: 7, plannedSets: 4 });
  });
  test('skips unknown, archived and blocked exercises; falls back to auto when nothing is usable', () => {
    const lib2 = [...library, E('arch', { archived: true })];
    const r = gen({ library: lib2, coachPlan: plan([{ exerciseId: 'ghost' }, { exerciseId: 'arch' }, { exerciseId: 'a' }, { exerciseId: 'b' }, { exerciseId: 'alt' }]), prefs: { a: pref('a', { avoid: true }), b: pref('b', { pausedSessions: 1 }) }, area: area({ poolExerciseIds: ['b'], exercisesPerSession: 1 }) });
    expect(ids(r)).toEqual(['alt']);
    expect(r.source).toBe('coach');
    const none = gen({ library: lib2, coachPlan: plan([{ exerciseId: 'ghost' }, { exerciseId: 'arch' }, { exerciseId: 'a' }]), prefs: { a: pref('a', { avoid: true }) }, area: area({ poolExerciseIds: ['alt'], exercisesPerSession: 1 }) });
    expect(none.source).toBe('auto');
    expect(none.coachPlanId).toBeUndefined();
    expect(ids(none)).toEqual(['alt']);
    expect(g(plan([])).source).toBe('auto');
  });
  test('missing equipment is hot-swapped: hidden name recorded, sets/reps carried, swap rep clamp, alt rest', () => {
    const r = g(plan([{ exerciseId: 'rk', sets: 6, reps: 20, weight: 99, restSec: 45 }]), { gym: gym({}) });
    expect(r.hiddenNames).toEqual(['Rack']);
    expect(r.exercises).toHaveLength(1);
    expect(r.exercises[0].exerciseId).toBe('alt'); // ranked best alternative (alphabetical tie-break)
    expect(r.exercises[0]).toMatchObject({ plannedSets: 6, repTarget: 15, restSec: 45 }); // 20 clamped to alt.repMax 15
    expect(r.exercises[0].plannedWeight).not.toBe(99); // weight is NOT carried over to a different exercise
    // rep target default is the original's repMin, clamped to the alternative's range
    expect(g(plan([{ exerciseId: 'rk' }]), { gym: gym({}) }).exercises[0]).toMatchObject({ plannedSets: 4, repTarget: 10, restSec: 90 });
    // item reps below alt.repMin
    expect(g(plan([{ exerciseId: 'rk', reps: 2 }]), { gym: gym({}) }).exercises[0].repTarget).toBe(10);
    // alt with its own progress keeps its own weight/reps
    expect(g(plan([{ exerciseId: 'rk', sets: 2 }]), { gym: gym({}), progress: { alt: { exerciseId: 'alt', weight: 33, reps: 11, sets: 9, updatedAt: 0 } } }).exercises[0]).toMatchObject({ plannedWeight: 33, repTarget: 11, plannedSets: 2 });
    // available equipment => no swap, no hidden name
    const ok = g(plan([{ exerciseId: 'rk' }]), { gym: gym({ rack: 'ok' }) });
    expect(ids(ok)).toEqual(['rk']);
    expect(ok.hiddenNames).toEqual([]);
  });
  test('autoSwap=false skips unavailable items; swaps never reuse picked or blocked exercises; no alt = skipped', () => {
    const r = g(plan([{ exerciseId: 'rk' }, { exerciseId: 'a' }]), { gym: gym({}), autoSwap: false });
    expect(ids(r)).toEqual(['a']);
    expect(r.hiddenNames).toEqual(['Rack']);
    // two unavailable items get two different alternatives
    const lib2 = [...library, E('rk2', { name: 'Rack2', equipment: ['rack'], primary: ['Lats'], pattern: 'pull' })];
    const two = gen({ library: lib2, coachPlan: plan([{ exerciseId: 'rk' }, { exerciseId: 'rk2' }]), area: area({ poolExerciseIds: ['b'] }), gym: gym({}) });
    expect(ids(two)).toEqual(['alt', 'alt2']);
    // an already planned exercise is not offered as alternative
    const three = gen({ library: lib2, coachPlan: plan([{ exerciseId: 'alt' }, { exerciseId: 'rk' }]), area: area({ poolExerciseIds: ['b'] }), gym: gym({}) });
    expect(ids(three)).toEqual(['alt', 'alt2']);
    // blocked alternatives are not offered
    const blocked = gen({ library: lib2, coachPlan: plan([{ exerciseId: 'rk' }]), area: area({ poolExerciseIds: ['b'] }), gym: gym({}), prefs: { alt: pref('alt', { avoid: true }), alt2: pref('alt2', { pausedSessions: 2 }) } });
    expect(blocked.source).toBe('auto'); // no alternative left -> plan unusable -> auto
    // the same plan item twice does not re-offer the first alt
    const dup = gen({ library: lib2, coachPlan: plan([{ exerciseId: 'rk' }, { exerciseId: 'rk' }]), area: area({ poolExerciseIds: ['b'] }), gym: gym({}) });
    expect(ids(dup)).toEqual(['alt', 'alt2']);
  });
});
