import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  addDays, avgSessionMin, chartFor, chartScale, countPRs, fmtVol, gymShares, liftProgress, monthAvg, rangeStart, streak,
  swapStats, topProgress, volumePerWeek, warmupNudge, warmupStats, weekBuckets,
} from './x-progress';
import { streakWeeks, weekStart } from '../../shared/rules';
import type { Session, SessionExercise } from '../../shared/types';

const OLD_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Stockholm'; });
afterAll(() => { if (OLD_TZ === undefined) delete process.env.TZ; else process.env.TZ = OLD_TZ; });

const L = (y: number, m: number, d: number, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
let n = 0;
const ex = (o: Partial<SessionExercise> & { weights?: number[] } = {}): SessionExercise => {
  const w = o.weights ?? [40, 40, 40];
  return {
    id: `e${++n}`, exerciseId: 'squat', name: 'Back squat', order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8,
    plannedSets: 3, repTarget: 8, plannedWeight: 40, restSec: 90, estSec: 600, status: 'done', pinned: false,
    sets: w.map((x) => ({ weight: x, reps: 8, doneAt: 0 })), ...o,
  } as SessionExercise;
};
const S = (end: number, o: Partial<Session> = {}): Session => ({
  id: `s${++n}`, seq: n, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g1', gymName: 'City', status: 'completed',
  startedAt: end - 55 * 60000, endedAt: end, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [],
  cursor: 0, phase: 'done', updatedAt: end, ...o,
});

describe('weekBuckets', () => {
  const now = L(2026, 11, 18); // Wednesday
  test('Monday start; Sunday 23:59 belongs to the previous week, Monday 00:00 to the next', () => {
    const b = weekBuckets([S(L(2026, 11, 15, 23, 59)), S(L(2026, 11, 16, 0, 0)), S(L(2026, 11, 16, 0, 1))], now, 2);
    expect(b.map((x) => x.count)).toEqual([1, 2]);
    expect(new Date(b[1].start).getDay()).toBe(1);
  });
  test('zero weeks are present and order is oldest to current', () => {
    const b = weekBuckets([S(L(2026, 11, 17))], now, 4);
    expect(b.map((x) => x.count)).toEqual([0, 0, 0, 1]);
    expect(b[0].start).toBeLessThan(b[3].start);
  });
  test('uses completed-at (endedAt) not start; session started Sunday night ending Monday counts Monday', () => {
    const s = S(L(2026, 11, 16, 0, 20), { startedAt: L(2026, 11, 15, 23, 30) });
    expect(weekBuckets([s], now, 2).map((x) => x.count)).toEqual([0, 1]);
  });
  test('every bucket is a distinct Monday 00:00 across spring-forward (Mar 29 2026)', () => {
    const b = weekBuckets([], L(2026, 4, 8), 8);
    for (const w of b) { const d = new Date(w.start); expect(d.getDay()).toBe(1); expect(d.getHours()).toBe(0); }
    expect(new Set(b.map((x) => x.start)).size).toBe(8);
  });
  test('sessions around the DST night land in the right weeks (spring forward)', () => {
    const sat = S(L(2026, 3, 28, 23, 30)), sun = S(L(2026, 3, 29, 3, 30)), mon = S(L(2026, 3, 30, 0, 5));
    const b = weekBuckets([sat, sun, mon], L(2026, 4, 1), 2);
    expect(b.map((x) => x.count)).toEqual([2, 1]);
  });
  test('fall-back (Oct 25 2026, 25h day): Sunday 23:59 stays in old week, Monday 00:01 in the new', () => {
    const b = weekBuckets([S(L(2026, 10, 25, 23, 59)), S(L(2026, 10, 25, 2, 30)), S(L(2026, 10, 26, 0, 1))], L(2026, 10, 28), 2);
    expect(b.map((x) => x.count)).toEqual([2, 1]);
  });
  test('year boundary: week spanning Dec 29 - Jan 4', () => {
    const b = weekBuckets([S(L(2026, 12, 31)), S(L(2027, 1, 1)), S(L(2027, 1, 4, 0, 1))], L(2027, 1, 5), 2);
    expect(b.map((x) => x.count)).toEqual([2, 1]);
  });
  test('addDays is calendar based across DST', () => {
    const d = new Date(addDays(L(2026, 3, 28, 0), 2));
    expect(d.getDate()).toBe(30);
    expect(d.getHours()).toBe(0);
  });
  test('matches shared weekStart', () => {
    const s = S(L(2026, 11, 20));
    expect(weekBuckets([s], now, 1)[0].start).toBe(weekStart(s.endedAt!));
  });
});

describe('streak', () => {
  const now = L(2026, 11, 18);
  const week = (monday: number, k: number) => Array.from({ length: k }, (_, i) => S(L(2026, 11, monday + (i % 5))));
  test('counts consecutive weeks at goal; in-progress week below goal does not break it', () => {
    const done = [...week(9, 2), ...week(2, 2)]; // wk Nov2: 2, wk Nov9: 2, current none
    expect(streak(done, 2, now)).toBe(2);
  });
  test('current week at goal adds one', () => {
    expect(streak([...week(16, 2), ...week(9, 2)], 2, now)).toBe(2);
  });
  test('a missed full week stops the run', () => {
    expect(streak([...week(2, 2), ...week(16, 2)], 2, now)).toBe(1);
  });
  test('goal change re-evaluates', () => {
    const done = [...week(9, 3), ...week(2, 3)];
    expect(streak(done, 3, now)).toBe(2);
    expect(streak(done, 4, now)).toBe(0);
  });
  test('empty / goal 0', () => { expect(streak([], 3, now)).toBe(0); expect(streak([S(now)], 0, now)).toBe(0); });
  test('agrees with shared streakWeeks across DST (many weeks)', () => {
    const t = L(2026, 11, 18);
    const done: Session[] = [];
    for (let w = 0; w < 30; w++) for (let k = 0; k < 3; k++) done.push(S(addDays(weekStart(addDays(t, -7 * w)), k * 2 + 1) + 12 * 3600000));
    expect(streak(done, 3, t)).toBe(streakWeeks(done, 3, t));
    expect(streak(done, 3, t)).toBe(30);
  });
});

describe('chartFor w8', () => {
  const now = L(2026, 11, 18);
  const mk = (weeksAgo: number, k: number) => Array.from({ length: k }, (_, i) => S(addDays(weekStart(now), -7 * weeksAgo + (i % 7)) + 12 * 3600000));
  test('values, labels (W<iso> first, Now last), hit text', () => {
    const done = [...mk(7, 4), ...mk(6, 3), ...mk(5, 5), ...mk(4, 4), ...mk(3, 4), ...mk(2, 2), ...mk(1, 4), ...mk(0, 1)];
    const c = chartFor(done, 'w8', now, 4);
    expect(c.vals).toEqual([4, 3, 5, 4, 4, 2, 4, 1]);
    expect(c.labels).toEqual(['W40', '41', '42', '43', '44', '45', '46', 'Now']);
    expect(c.hit).toBe('5 of 7 weeks hit');
    expect(c.label).toBe('Last 8 weeks');
    expect(c.lastIsNow).toBe(true);
  });
  test('extra sessions above goal count as hit and scale the chart', () => {
    const c = chartFor([...mk(1, 8)], 'w8', now, 4);
    expect(c.vals[6]).toBe(8);
    expect(c.hit).toBe('1 of 1 weeks hit');
    expect(chartScale(c.vals, 4).max).toBe(8);
  });
  test('weeks before the first-ever session are not misses', () => {
    expect(chartFor([...mk(2, 4), ...mk(1, 4)], 'w8', now, 4).hit).toBe('2 of 2 weeks hit');
  });
  test('zero weeks in the middle count as misses', () => {
    expect(chartFor([...mk(3, 4), ...mk(1, 4)], 'w8', now, 4).hit).toBe('2 of 3 weeks hit');
  });
  test('goal change only changes the hit text, never the counts', () => {
    const done = [...mk(2, 3), ...mk(1, 3)];
    expect(chartFor(done, 'w8', now, 3).hit).toBe('2 of 2 weeks hit');
    expect(chartFor(done, 'w8', now, 5).hit).toBe('0 of 2 weeks hit');
  });
  test('only the first week: "First week"', () => {
    expect(chartFor([S(now)], 'w8', now, 4).hit).toBe('First week');
  });
  test('label W52/W53/W1 around the year boundary', () => {
    const c = chartFor([S(L(2027, 1, 5))], 'w8', L(2027, 1, 6), 4);
    expect(c.labels[c.labels.length - 2]).toBe('53');
    expect(c.labels[c.labels.length - 1]).toBe('Now');
  });
});

describe('chartScale', () => {
  test('matches artboard geometry for goal 4 and max 6', () => {
    const s = chartScale([4, 3, 5, 4, 4, 2, 4, 1], 4);
    expect(s.max).toBe(6);
    expect(s.goalPos).toBeCloseTo((4 / 6) * 82 + 12, 6);
    expect(s.barH(6)).toBeCloseTo(82, 6);
  });
  test('zero bars keep a 3% stub, goal above 6 grows the axis, empty data ok', () => {
    expect(chartScale([0], 4).barH(0)).toBe(3);
    expect(chartScale([], 7).max).toBe(8);
    expect(chartScale([2.4], 1).max).toBe(6);
  });
});

describe('months', () => {
  test('monthAvg: full past month uses days/7', () => {
    const now = L(2026, 11, 18);
    const done = Array.from({ length: 8 }, (_, i) => S(L(2026, 10, 1 + i * 3)));
    expect(monthAvg(done, 2026, 9, now)).toBeCloseTo(8 / (31 / 7), 6);
  });
  test('current month divides by elapsed days but never below one week', () => {
    expect(monthAvg([S(L(2026, 11, 2)), S(L(2026, 11, 3))], 2026, 10, L(2026, 11, 3))).toBe(2);
    expect(monthAvg([S(L(2026, 11, 2))], 2026, 10, L(2026, 11, 14))).toBeCloseTo(1 / 2, 6);
  });
  test('m6: six month labels ending this month, empty months are 0, Avg / week skips pre-history', () => {
    const now = L(2026, 11, 18);
    const done = [S(L(2026, 9, 10)), S(L(2026, 9, 12)), S(L(2026, 11, 5))];
    const c = chartFor(done, 'm6', now, 4);
    expect(c.labels).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(c.vals.slice(0, 3)).toEqual([0, 0, 0]);
    expect(c.vals[4]).toBe(0);
    // Sep(30)+Oct(31)+Nov(18)=79 days -> 3 / (79/7)
    expect(c.hit).toBe(`Avg ${Math.round((3 / (79 / 7)) * 10) / 10} / week`);
  });
  test('m6 crossing a year boundary labels Dec/Jan correctly', () => {
    const c = chartFor([S(L(2027, 1, 5))], 'm6', L(2027, 1, 10), 4);
    expect(c.labels).toEqual(['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan']);
    expect(c.start).toBe(L(2026, 8, 1, 0));
  });
  test('m6 with no sessions in window', () => { expect(chartFor([], 'm6', L(2026, 11, 18), 4).hit).toBe('Avg 0 / week'); });
  test('y1: 12 columns, future months 0, total sessions text, singular', () => {
    const now = L(2026, 11, 18);
    const c = chartFor([S(L(2026, 1, 3)), S(L(2025, 12, 31))], 'y1', now, 4);
    expect(c.vals).toHaveLength(12);
    expect(c.vals[11]).toBe(0);
    expect(c.labels.join('')).toBe('JFMAMJJASOND');
    expect(c.hit).toBe('1 session');
    expect(c.label).toBe('This year');
  });
  test('y1 on Jan 1 only has January; Dec 31 the year before is excluded', () => {
    const now = L(2027, 1, 1, 10);
    const c = chartFor([S(L(2026, 12, 31, 23, 59)), S(L(2027, 1, 1, 8))], 'y1', now, 4);
    expect(c.hit).toBe('1 session');
    expect(c.vals[0]).toBeCloseTo(1, 6);
    expect(c.vals.slice(1).every((v) => v === 0)).toBe(true);
    expect(rangeStart('y1', now)).toBe(L(2027, 1, 1, 0));
  });
  test('rangeStart for each range', () => {
    const now = L(2026, 11, 18);
    expect(rangeStart('w8', now)).toBe(addDays(weekStart(now), -49));
    expect(rangeStart('m6', now)).toBe(L(2026, 6, 1, 0));
  });
});

describe('tiles', () => {
  test('avgSessionMin: ignores zero durations, null when none', () => {
    const a = S(L(2026, 11, 1), { startedAt: L(2026, 11, 1) - 60 * 60000 });
    const b = S(L(2026, 11, 2), { startedAt: L(2026, 11, 2) - 55 * 60000 });
    expect(avgSessionMin([a, b])).toBe(58);
    expect(avgSessionMin([{ ...a, endedAt: undefined }])).toBeNull();
    expect(avgSessionMin([])).toBeNull();
  });
  const wu = (end: number, min: number) => S(end, { warmupStartedAt: end - 3600000, warmupEndedAt: end - 3600000 + min * 60000 });
  test('warmupStats: median of last 5 timed, untimed ignored', () => {
    const xs = [wu(1e9, 30), wu(2e9, 12), wu(3e9, 14), wu(4e9, 10), wu(5e9, 12), wu(6e9, 13), S(7e9)];
    const w = warmupStats(xs)!;
    expect(w.samples).toHaveLength(5);
    expect(w.medianSec).toBe(12 * 60);
    expect(warmupStats([S(1)])).toBeNull();
  });
  test('nudge: needs 3 samples and a >=2 min gap', () => {
    const mk = (mins: number[]) => warmupStats(mins.map((m, i) => wu((i + 1) * 1e9, m)));
    expect(warmupNudge(mk([12, 12]), 10)).toBeNull();
    expect(warmupNudge(mk([11, 11, 11]), 10)).toBeNull();
    const nz = warmupNudge(mk([12, 13, 12, 9, 12]), 10)!;
    expect(nz.title).toBe('Warm-up target nudged to 12 min?');
    expect(nz.body).toContain('Only 1 of your last 5 warm-ups came in under the 10-min plan');
    expect(warmupNudge(mk([13, 13, 13]), 10)!.body).toContain('None of your last 3');
    const short = warmupNudge(mk([6, 6, 7]), 10)!;
    expect(short.minutes).toBe(6);
    expect(short.body).toContain('All 3 warm-ups');
    expect(warmupNudge(null, 10)).toBeNull();
  });
  test('volumePerWeek: per week and delta vs previous window', () => {
    const now = L(2026, 11, 18);
    const start = rangeStart('w8', now); // 50 days -> span 50
    const vol = (end: number, w: number) => S(end, { exercises: [ex({ weights: [w] })] }); // w*8 kg
    const done = [vol(start + 3 * 86400000, 100), vol(addDays(start, -10), 50)];
    const v = volumePerWeek(done, start, now);
    const weeks = (Math.round((now - start) / 86400000) + 1) / 7;
    expect(v.perWeek).toBeCloseTo(800 / weeks, 6);
    expect(v.deltaPct).toBe(100);
  });
  test('volume delta null with no previous data; dropped/skipped exercises add nothing', () => {
    const now = L(2026, 11, 18);
    const s = S(now, { exercises: [ex({ weights: [10] }), ex({ weights: [1000], status: 'skipped' })] });
    const v = volumePerWeek([s], rangeStart('w8', now), now);
    expect(v.deltaPct).toBeNull();
    expect(v.perWeek * ((Math.round((now - rangeStart('w8', now)) / 86400000) + 1) / 7)).toBeCloseTo(80, 6);
    expect(volumePerWeek([], 0, now).perWeek).toBe(0);
  });
  test('fmtVol', () => { expect(fmtVol(31400)).toBe('31.4k'); expect(fmtVol(950)).toBe('950'); expect(fmtVol(0)).toBe('0'); expect(fmtVol(999.6)).toBe('1k'); });
  test('countPRs / swapStats', () => {
    const a = S(1, { exercises: [ex({ pr: true }), ex({ pr: true }), ex()] });
    const b = S(2, { gymName: 'Office', exercises: [ex({ swappedFrom: { exerciseId: 'x', name: 'X', reason: 'busy' } }), ex({ swappedFrom: { exerciseId: 'y', name: 'Y', reason: 'busy' } })] });
    const c = S(3, { gymName: 'City', exercises: [ex({ swappedFrom: { exerciseId: 'y', name: 'Y', reason: 'gone' } })] });
    expect(countPRs([a, b, c])).toBe(2);
    expect(swapStats([a, b, c])).toEqual({ count: 3, topGym: { name: 'Office', n: 2 } });
    expect(swapStats([a])).toEqual({ count: 0, topGym: null });
  });
});

describe('gymShares', () => {
  const g = (id: string, name: string, k: number) => Array.from({ length: k }, () => S(1e9, { gymId: id, gymName: name }));
  test('empty', () => expect(gymShares([])).toEqual([]));
  test('single gym 100%', () => expect(gymShares(g('a', 'City', 3))).toEqual([{ name: 'City', n: 3, pct: 100 }]));
  test('percentages always sum to 100 (thirds)', () => {
    const r = gymShares([...g('a', 'A', 1), ...g('b', 'B', 1), ...g('c', 'C', 1)]);
    expect(r.reduce((x, y) => x + y.pct, 0)).toBe(100);
  });
  test('7/1.5/1.5 split and ordering', () => {
    const r = gymShares([...g('a', 'City', 14), ...g('b', 'Office', 3), ...g('c', 'Home', 3)]);
    expect(r.map((x) => [x.name, x.pct])).toEqual([['City', 70], ['Home', 15], ['Office', 15]]);
  });
  test('more than 3 gyms fold into Other', () => {
    const r = gymShares([...g('a', 'A', 4), ...g('b', 'B', 3), ...g('c', 'C', 2), ...g('d', 'D', 1), ...g('e', 'E', 1)]);
    expect(r.map((x) => x.name)).toEqual(['A', 'B', 'C', 'Other']);
    expect(r[3].n).toBe(2);
    expect(r.reduce((x, y) => x + y.pct, 0)).toBe(100);
  });
  test('same gym id with renamed gym merges under the latest name; null gymId groups by name', () => {
    const r = gymShares([S(1, { gymId: 'a', gymName: 'Old' }), S(5, { gymId: 'a', gymName: 'New' }), S(3, { gymId: null, gymName: 'Pop-up' })]);
    expect(r[0]).toMatchObject({ name: 'New', n: 2 });
    expect(r[1]).toMatchObject({ name: 'Pop-up', n: 1 });
  });
});

describe('lift progress', () => {
  const sq = (t: number, w: number, o: Partial<SessionExercise> = {}) => S(t, { exercises: [ex({ weights: [w - 10, w], ...o })] });
  test('first vs latest top weight, pct rounded', () => {
    const l = liftProgress([sq(1, 70), sq(2, 75), sq(3, 82.5)]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ first: 70, last: 82.5, pct: 18, stalled: false });
  });
  test('needs two data points; ignores non weight lifts, undone and zero weight', () => {
    expect(liftProgress([sq(1, 70)])).toEqual([]);
    expect(liftProgress([sq(1, 70, { tracking: 'reps' }), sq(2, 80, { tracking: 'reps' })])).toEqual([]);
    expect(liftProgress([sq(1, 70, { status: 'skipped' }), sq(2, 80, { status: 'skipped' })])).toEqual([]);
    expect(liftProgress([sq(1, 0), sq(2, 0)])).toEqual([]);
  });
  test('stalled: last 3 equal; counts too-heavy feedback', () => {
    const heavy = { feedback: { effort: 'normal', weight: 'heavy', volume: 'ok' } as const };
    const l = liftProgress([sq(1, 37.5), sq(2, 37.5, heavy), sq(3, 37.5, heavy)])[0];
    expect(l).toMatchObject({ stalled: true, pct: 0, heavy: 2 });
  });
  test('order independent of input order', () => {
    expect(liftProgress([sq(3, 82.5), sq(1, 70), sq(2, 75)])[0]).toMatchObject({ first: 70, last: 82.5 });
  });
  const L1 = (id: string, pct: number, stalled = false, heavy = 0) => ({ id, name: id, first: 10, last: 10, pct, stalled, heavy });
  test('topProgress: best gains, keeps one slot for a stall, max 3', () => {
    expect(topProgress([L1('a', 5), L1('b', 18), L1('c', 13), L1('d', 2), L1('s', 0, true)]).map((x) => x.id)).toEqual(['b', 'c', 's']);
    expect(topProgress([L1('a', 5), L1('b', 18), L1('c', 13)]).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(topProgress([L1('s1', 0, true, 1), L1('s2', 0, true, 3), L1('s3', 0, true), L1('s4', 0, true)]).map((x) => x.id)).toEqual(['s2', 's1', 's3']);
    expect(topProgress([L1('neg', -5)])).toEqual([]);
    expect(topProgress([])).toEqual([]);
  });
});
