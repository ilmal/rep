import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  MILESTONES, TIERS, applyGoalChange, celebratedPatch, computeStreak, freezePatch, inStreakQuietHours, last16Of, makeCal, paceCopy, paceOf,
  goalForWeek, streakReminder, tierOf, undoFreezePatch, usualTrainHour, weekLabel, weeksUntilFreeze, type StreakView,
} from './streak';
import { streakWeeks } from './rules';
import type { Session, SessionExercise, Settings } from './types';

const OLD_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Stockholm'; });
afterAll(() => { if (OLD_TZ === undefined) delete process.env.TZ; else process.env.TZ = OLD_TZ; });

// ───────────────────────── fixtures ─────────────────────────
// Week 0 = Monday 2026-01-05 (local). Week w, day d (0 = Mon), hour h.
const at = (w: number, d = 0, h = 18) => new Date(2026, 0, 5 + 7 * w + d, h).getTime();
const wk = (w: number) => at(w, 0, 0);
let uid = 0;
const mkEx = (over: Partial<SessionExercise> = {}): SessionExercise => ({
  id: `e${++uid}`, exerciseId: 'sq', name: 'Squat', order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8, plannedSets: 3, repTarget: 5,
  plannedWeight: 60, restSec: 90, estSec: 600, status: 'done', sets: [{ weight: 60, reps: 5, doneAt: 1 }], ...over,
});
const sess = (ts: number, over: Partial<Session> = {}): Session => ({
  id: `s${++uid}`, seq: uid, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g1', gymName: 'G', status: 'completed', startedAt: ts - 3600_000, endedAt: ts,
  targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done', updatedAt: ts, ...over,
});
/** counts[i] sessions in week i (spread over the days of that week). The LAST entry is the current week. */
const build = (counts: number[]): Session[] =>
  counts.flatMap((c, w) => Array.from({ length: c }, (_, k) => sess(at(w, k % 7, 8 + Math.floor(k / 7)))));
const base = (over: Partial<Settings> = {}): Partial<Settings> => ({ weeklyGoal: 4, rotation: [], ...over });
/** `now` = weekday `dow` (0 = Mon) of the last week, noon */
const run = (counts: number[], settings: Partial<Settings> = base(), dow = 3, tz?: number): StreakView =>
  computeStreak(build(counts), settings, at(counts.length - 1, dow, 12), { tz });
const statuses = (v: StreakView) => v.weeks.map((w) => w.status);
const rep = <T = number,>(n: number, c: T): T[] => Array(n).fill(c);

// ───────────────────────── empty / basics ─────────────────────────
describe('empty history and basics', () => {
  test('no sessions: one open week, nothing unlocked, nothing to celebrate', () => {
    const v = computeStreak([], base(), at(0, 2, 12));
    expect(v.current).toBe(0); expect(v.best).toBe(0); expect(v.freezes).toBe(0);
    expect(v.weeks).toHaveLength(1);
    expect(v.weeks[0]).toMatchObject({ status: 'open', done: 0, goal: 4, weekStart: wk(0) });
    expect(v.tier).toBe('none'); expect(v.tierIndex).toBe(0); expect(v.tierText).toBe('No streak yet');
    expect(v.celebrate).toBeNull(); expect(v.repairOffer).toBeNull(); expect(v.lost).toBe(false); expect(v.atRisk).toBe(false);
    expect(v.canUseFreezeNow).toBe(false); expect(v.badgesGot).toBe(0); expect(v.badges).toHaveLength(18);
    expect(v.nextMilestone).toMatchObject({ weeks: 2, name: '2 weeks', progress: { n: 0, of: 2, unit: 'weeks' } });
    expect(v.last16).toHaveLength(1);
  });
  test('garbage input never throws', () => {
    const bad = { weeklyGoal: NaN, goalHistory: 'x', manualFreezeWeeks: [NaN, 'a', null], rotation: 5, streakLastCelebrated: 'y' } as unknown as Partial<Settings>;
    expect(() => computeStreak([null, { status: 'completed' }, sess(NaN)] as unknown as Session[], bad, NaN)).not.toThrow();
    expect(() => computeStreak(undefined as unknown as Session[], {}, 1)).not.toThrow();
    const v = computeStreak([], { goalHistory: [{ from: NaN, goal: 3 }, null, { from: 5, goal: 0 }] } as unknown as Partial<Settings>, at(3));
    expect(v.currentWeek.goal).toBe(4);
  });
  test('discarded / active sessions never count; sessions without endedAt use startedAt', () => {
    const s = [sess(at(0, 0), { status: 'discarded' }), sess(at(0, 1), { status: 'active' }), sess(at(0, 2), { status: 'planned' }), sess(at(0, 3), { endedAt: undefined, startedAt: at(0, 3) })];
    const v = computeStreak(s, base(), at(0, 4));
    expect(v.currentWeek.done).toBe(1);
  });
  test('first completed session starts the replay: earlier weeks are not "missed"', () => {
    const v = run([4, 4]); expect(v.weeks).toHaveLength(2);
    const w = computeStreak(build([4]), base(), at(5, 2)); // 5 weeks later, nothing since
    expect(w.weeks).toHaveLength(6);
    expect(statuses(w)).toEqual(['hit', 'missed', 'missed', 'missed', 'missed', 'open']);
  });
  test('sessions after the current week are ignored', () => {
    const v = computeStreak([...build([4]), sess(at(2, 0))], base(), at(0, 3));
    expect(v.weeks).toHaveLength(1);
  });
  test('current week reaching the goal is added; in progress it is not', () => {
    expect(run([4, 4, 3]).current).toBe(2);
    expect(run([4, 4, 4]).current).toBe(3);
    expect(statuses(run([4, 4, 4]))).toEqual(['hit', 'hit', 'hit']);
    expect(statuses(run([4, 4, 3]))).toEqual(['hit', 'hit', 'open']);
  });
  test('extra sessions beyond the goal count as a hit', () => { expect(statuses(run([6, 9]))).toEqual(['hit', 'hit']); });
  test('weeks list is oldest -> newest, week starts are Mondays, last16Of', () => {
    const v = run(rep(20, 4));
    expect(v.weeks).toHaveLength(20);
    expect(v.last16).toHaveLength(16);
    expect(v.last16[15].weekStart).toBe(wk(19));
    expect(last16Of(v.weeks.slice(0, 3))).toHaveLength(3);
    for (const w of v.weeks) expect(new Date(w.weekStart).getDay()).toBe(1);
    expect(weekLabel(v.weeks[19], true)).toBe('Now');
    expect(weekLabel(v.weeks[0], false)).toBe('W2');
  });
  test('streakAfter tracks the running streak', () => {
    const v = run([4, 4, 1, 0, 4]);
    expect(v.weeks.map((w) => w.streakAfter)).toEqual([1, 2, 0, 0, 1]);
  });
});

// ───────────────────────── repair ─────────────────────────
describe('repair', () => {
  test.each([
    // [label, counts, expected statuses, current, best]
    ['miss by 1, repaired with goal+1', [4, 4, 3, 5], ['hit', 'hit', 'repaired', 'hit'], 4, 4],
    ['miss by 2, repaired with goal+2', [4, 4, 2, 6], ['hit', 'hit', 'repaired', 'hit'], 4, 4],
    ['repair with more than needed', [4, 4, 3, 8], ['hit', 'hit', 'repaired', 'hit'], 4, 4],
  ] as const)('%s', (_l, counts, st, cur, best) => {
    const v = run([...counts]);
    expect(statuses(v)).toEqual([...st]); expect(v.current).toBe(cur); expect(v.best).toBe(best);
    expect(v.repairOffer).toBeNull();
    expect(v.weeks[2].repairTarget).toBe(counts[2] === 3 ? 5 : 6);
  });
  test('open repair: missed week not in current ("7 weeks stay 7"), target = goal + deficit', () => {
    const v = run([4, 4, 4, 4, 4, 4, 4, 3, 2], base(), 2);
    expect(v.current).toBe(7);
    expect(v.weeks[7]).toMatchObject({ status: 'missed', repairTarget: 5 });
    expect(v.repairOffer).toEqual({ missedWeekStart: wk(7), deficit: 1, target: 5, done: 2, left: 3, daysLeft: 5, freezeAvailable: true, canRepair: true });
    expect(v.currentWeek).toMatchObject({ goal: 4, target: 5, left: 3, secured: false, pace: 'onpace' });
    expect(v.weeks[8].status).toBe('open');
  });
  test('goal reached but repair target not: week stays open, not secured, no celebration', () => {
    const v = run([4, 4, 3, 4]);
    expect(v.weeks[3].status).toBe('open'); expect(v.currentWeek.secured).toBe(false); expect(v.currentWeek.left).toBe(1);
    expect(v.celebrate).toBeNull(); expect(v.current).toBe(2);
  });
  test('repair completed in the current week: both weeks count, celebrate kind repair + Comeback', () => {
    const v = run([4, 4, 4, 4, 4, 3, 5]);
    expect(v.celebrate?.kind).toBe('repair');
    expect(v.celebrate?.badge?.id).toBe('comeback');
    expect(v.badges.find((b) => b.id === 'comeback')?.got).toBe(true);
  });
  test('repair fails (repair week ended below target), no freeze: streak resets, repair week starts a new streak', () => {
    const v = run([4, 4, 3, 4, 0]);
    expect(statuses(v)).toEqual(['hit', 'hit', 'missed', 'hit', 'open']);
    expect(v.current).toBe(1); expect(v.best).toBe(2); expect(v.lost).toBe(false);
  });
  test('repair fails, freeze held: missed week frozen automatically, streak continues', () => {
    const v = run([4, 4, 4, 4, 3, 4, 0]);
    expect(statuses(v)).toEqual(['hit', 'hit', 'hit', 'hit', 'frozen', 'hit', 'open']);
    expect(v.weeks[4]).toMatchObject({ freezeUsed: true, freezeKind: 'auto' });
    expect(v.current).toBe(6); expect(v.freezes).toBe(0);
  });
  test('repair week also missed (deficit 1-2 again): chain via the second week', () => {
    const v = run([4, 4, 3, 3, 5]); // week2 missed by 1; week3 3 < 5 fails -> reset (no freeze); week3 is itself missed with streak 0
    expect(statuses(v)).toEqual(['hit', 'hit', 'missed', 'missed', 'hit']);
    expect(v.current).toBe(1);
  });
  test('repair fails with a freeze: week 3 itself missed by 1 and repairable next', () => {
    const v = run([4, 4, 4, 4, 3, 3, 5]);
    expect(statuses(v)).toEqual(['hit', 'hit', 'hit', 'hit', 'frozen', 'repaired', 'hit']);
    expect(v.current).toBe(7);
  });
  test('deficit 3+ cannot be repaired: no offer, auto-freeze if held', () => {
    const v = run([4, 4, 4, 4, 1, 0]);
    expect(v.repairOffer).toBeNull();
    expect(statuses(v)).toEqual(['hit', 'hit', 'hit', 'hit', 'frozen', 'open']);
    expect(v.weeks[4].repairTarget).toBeUndefined();
    expect(v.current).toBe(5); expect(v.freezes).toBe(0);
  });
  test('deficit 3+ with no freeze: streak resets, best is kept, lost = true on the following week', () => {
    const v = run([4, 4, 1, 0]);
    expect(statuses(v)).toEqual(['hit', 'hit', 'missed', 'open']);
    expect(v.current).toBe(0); expect(v.best).toBe(2); expect(v.lost).toBe(true); expect(v.lostStreak).toBe(2);
    expect(v.repairOffer).toBeNull();
  });
  test('lost is only for the Monday after the reset, and goes away when the new week hits', () => {
    expect(run([4, 4, 1, 0, 0]).lost).toBe(false); // a week later: not news any more
    expect(run([4, 4, 1, 4]).lost).toBe(false); // new streak started
    expect(run([4, 4, 1, 4]).current).toBe(1);
  });
  test('zero sessions in a week with a streak (deficit = goal): reset without freeze', () => {
    const v = run([4, 4, 4, 0, 0]); // gap week 3 -> no sessions? week 3 has 0 sessions: deficit 4
    expect(statuses(v)).toEqual(['hit', 'hit', 'hit', 'missed', 'open']);
    expect(v.current).toBe(0); expect(v.lostStreak).toBe(3);
  });
  test('goal 1: missing the only session is deficit 1 and repairable (needs 2)', () => {
    const s = base({ weeklyGoal: 1 });
    const v = run([1, 1, 0, 0], s);
    expect(v.weeks[2]).toMatchObject({ status: 'missed', repairTarget: 2 });
    expect(v.repairOffer?.target).toBe(2);
  });
  test('a missed week with no running streak offers nothing', () => {
    const v = run([1, 0, 0]);
    expect(v.repairOffer).toBeNull(); expect(v.current).toBe(0);
    expect(v.weeks[0].repairTarget).toBeUndefined();
  });
  test('repairOffer.canRepair flips when the target is out of reach', () => {
    // goal 4, deficit 2 -> target 6; on Saturday (2 days left) with 2 done: left 4 > 2
    const v = run([4, 4, 2, 2], base(), 5);
    expect(v.repairOffer).toMatchObject({ target: 6, left: 4, daysLeft: 2, canRepair: false });
    const w = run([4, 4, 2, 4], base(), 5);
    expect(w.repairOffer).toMatchObject({ left: 2, canRepair: true });
  });
  test('repairOffer.freezeAvailable reflects the pool', () => {
    expect(run([4, 4, 3, 0]).repairOffer?.freezeAvailable).toBe(false);
    expect(run([4, 4, 4, 4, 3, 0]).repairOffer?.freezeAvailable).toBe(true);
  });
});

// ───────────────────────── freezes ─────────────────────────
describe('freezes', () => {
  test.each([
    [3, 0], [4, 1], [7, 1], [8, 2], [11, 2], [12, 2],
  ])('%i hit weeks -> %i freezes (cap 2)', (weeks, expected) => {
    const v = run([...rep(weeks, 4), 0]);
    expect(v.freezes).toBe(expected);
  });
  test('earn flags: freezeEarned on weeks 4 and 8, freezeWasted on week 12 (at cap)', () => {
    const v = run(rep(12, 4));
    expect(v.weeks.map((w, i) => (w.freezeEarned ? i + 1 : 0)).filter(Boolean)).toEqual([4, 8]);
    expect(v.weeks[11].freezeWasted).toBe(true);
    expect(v.freezeCapped).toBe(true);
  });
  test('weeksUntilFreeze / nextFreezeAtWeek match "Next at week 8" for a 7-week streak', () => {
    const v = run([...rep(7, 4), 0]);
    expect(v.weeksUntilFreeze).toBe(1); expect(v.nextFreezeAtWeek).toBe(8); expect(v.countedWeeks).toBe(7);
    expect([0, 1, 2, 3, 4, 5].map(weeksUntilFreeze)).toEqual([4, 3, 2, 1, 4, 3]);
  });
  test('repaired weeks count towards freezes, frozen weeks do not', () => {
    const v = run([4, 4, 3, 5, 4, 0]); // hit hit repaired hit hit => 5 counted
    expect(v.countedWeeks).toBe(5);
    const f = run([4, 4, 4, 4, 1, 4, 4, 4, 0]); // 4 hit + frozen + 3 hit -> counted 7 (frozen skipped)
    expect(f.countedWeeks).toBe(7);
  });
  test('earned freeze is consumed by auto-freeze and the counter keeps running', () => {
    const v = run([...rep(4, 4), 1, ...rep(4, 4), 0]); // freeze earned at 4, used on the 3+ miss, next earned at counted 8
    expect(v.freezes).toBe(1);
    expect(v.weeks[4].status).toBe('frozen');
    expect(v.current).toBe(9);
  });
  test('reset restarts the freeze counter', () => {
    const v = run([4, 4, 4, 0, 4, 4, 0]);
    expect(v.countedWeeks).toBe(2);
    expect(v.freezes).toBe(0);
  });
  test('manual freeze on the open week: counts now, costs a freeze', () => {
    const s = base({ manualFreezeWeeks: [wk(4)] });
    const v = run([4, 4, 4, 4, 1], s);
    expect(v.weeks[4]).toMatchObject({ status: 'frozen', freezeUsed: true, freezeKind: 'manual' });
    expect(v.current).toBe(5); expect(v.freezes).toBe(0); expect(v.frozenThisWeek).toBe(true);
    expect(v.atRisk).toBe(false); expect(v.canUseFreezeNow).toBe(false); expect(v.undoFreezeWeek).toBe(wk(4));
  });
  test('manual freeze is refunded when the goal is still hit', () => {
    const s = base({ manualFreezeWeeks: [wk(4)] });
    const v = run([4, 4, 4, 4, 4], s);
    expect(v.weeks[4]).toMatchObject({ status: 'hit', freezeUsed: false });
    expect(v.freezes).toBe(1);
    expect(v.current).toBe(5);
    expect(v.undoFreezeWeek).toBeNull();
  });
  test('manual freeze ended the week short: stays frozen (counts) and is spent', () => {
    const s = base({ manualFreezeWeeks: [wk(4)] });
    const v = run([4, 4, 4, 4, 1, 0], s);
    expect(v.weeks[4].status).toBe('frozen'); expect(v.current).toBe(5); expect(v.freezes).toBe(0);
  });
  test('manual freeze you cannot afford, or with no streak, is ignored (never negative)', () => {
    expect(run([4, 1], base({ manualFreezeWeeks: [wk(1)] })).weeks[1].status).toBe('open');
    const v = run([4, 4, 4, 4, 1, 1, 0], base({ manualFreezeWeeks: [wk(4), wk(5)] }));
    expect(v.freezes).toBeGreaterThanOrEqual(0);
    expect(v.weeks[5].status).not.toBe('frozen');
    expect(run([1, 0], base({ manualFreezeWeeks: [wk(1)] })).weeks[1].status).toBe('open'); // no streak to protect
  });
  test('with a repair open the freeze covers the MISSED week and drops the repair target', () => {
    const open = run([4, 4, 4, 4, 3, 1]);
    expect(open.freezeTarget).toBe('missed'); expect(open.canUseFreezeNow).toBe(true);
    const frozen = run([4, 4, 4, 4, 3, 1], base({ manualFreezeWeeks: [wk(4)] }));
    expect(frozen.weeks[4]).toMatchObject({ status: 'frozen', freezeKind: 'manual' });
    expect(frozen.repairOffer).toBeNull(); expect(frozen.current).toBe(5);
    expect(frozen.currentWeek.target).toBe(4);
    expect(frozen.undoFreezeWeek).toBe(wk(4));
  });
  test('freezeTarget: current when open and not secured, null when none held / secured / no streak', () => {
    expect(run([4, 4, 4, 4, 0]).freezeTarget).toBe('current');
    expect(run([4, 4, 4, 0]).freezeTarget).toBeNull(); // no freeze held
    expect(run([4, 4, 4, 4, 4]).freezeTarget).toBeNull(); // secured
    expect(run([0]).freezeTarget).toBeNull();
  });
  test('freezePatch / undoFreezePatch round-trip', () => {
    const s = base();
    let v = run([4, 4, 4, 4, 1], s);
    const p = freezePatch(s, v)!;
    expect(p.manualFreezeWeeks).toEqual([wk(4)]);
    const s2 = { ...s, ...p };
    v = run([4, 4, 4, 4, 1], s2);
    expect(v.frozenThisWeek).toBe(true);
    expect(freezePatch(s2, v)).toBeNull();
    const u = undoFreezePatch(s2, v)!;
    expect(u.manualFreezeWeeks).toEqual([]);
    expect(run([4, 4, 4, 4, 1], { ...s2, ...u }).frozenThisWeek).toBe(false);
    expect(undoFreezePatch(s, run([4, 4, 4, 4, 1], s))).toBeNull();
    expect(freezePatch(s, run([4, 4, 0], s))).toBeNull();
    // missed-week freeze uses the missed week key
    const v3 = run([4, 4, 4, 4, 3, 1], s);
    expect(freezePatch(s, v3)?.manualFreezeWeeks).toEqual([wk(4)]);
  });
  test('manual freeze keys written by another zone / DST still resolve to the week', () => {
    const s = base({ manualFreezeWeeks: [wk(4) + 3600_000, wk(4) - 3600_000] });
    expect(run([4, 4, 4, 4, 1], s).weeks[4].status).toBe('frozen');
  });
  test('undo for the previous week works when the freeze covered a missed week', () => {
    const s = base({ manualFreezeWeeks: [wk(4)] });
    const v = run([4, 4, 4, 4, 3, 1], s);
    expect(undoFreezePatch(s, v)?.manualFreezeWeeks).toEqual([]);
    // ...but not once that week is two weeks old
    expect(run([4, 4, 4, 4, 3, 4, 1], s).undoFreezeWeek).toBeNull();
  });
});

// ───────────────────────── goal changes ─────────────────────────
describe('goal history (changes apply from next Monday)', () => {
  test('each week uses the goal that was in force', () => {
    const s = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }, { from: wk(3), goal: 3 }] });
    const v = run([4, 4, 4, 3, 3], s);
    expect(v.weeks.map((w) => w.goal)).toEqual([4, 4, 4, 3, 3]);
    expect(statuses(v)).toEqual(['hit', 'hit', 'hit', 'hit', 'hit']);
    expect(v.current).toBe(5);
  });
  test('the old goal still applies to past weeks (retroactive lowering must not rescue them)', () => {
    const s = base({ weeklyGoal: 2, goalHistory: [{ from: 0, goal: 4 }, { from: wk(3), goal: 2 }] });
    const v = run([4, 4, 3, 2, 2], s); // week 2: 3 < 4 -> repair; target next week (goal 2) + 1 = 3 but only 2 -> fails
    expect(v.weeks[2].goal).toBe(4);
    expect(v.weeks[2].repairTarget).toBe(3);
    expect(v.weeks[2].status).toBe('missed');
  });
  test('a pending change is visible but does not touch this week', () => {
    const s = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }, { from: wk(6), goal: 3 }] });
    const v = run([4, 4, 4, 4, 4, 3], s);
    expect(v.currentWeek.goal).toBe(4); expect(v.goalPending).toEqual({ from: wk(6), goal: 3 });
    expect(v.current).toBe(5);
    expect(run([4, 4, 4, 4, 4, 3], s, 3).currentWeek.left).toBe(1);
    expect(run([4, 4, 4, 4, 4, 4, 3], s).currentWeek.goal).toBe(3);
  });
  test('weeklyGoal edited without history applies from the current week on (past stays)', () => {
    const s = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }] });
    const v = run([4, 4, 3], s);
    expect(v.weeks.map((w) => w.goal)).toEqual([4, 4, 3]);
    expect(statuses(v)).toEqual(['hit', 'hit', 'hit']);
  });
  test('no history: every week uses weeklyGoal; unsorted history is sorted; a lone old entry is the base', () => {
    expect(run([3, 3, 3], base({ weeklyGoal: 3 })).current).toBe(3);
    const s = base({ weeklyGoal: 3, goalHistory: [{ from: wk(2), goal: 3 }, { from: 0, goal: 4 }] });
    expect(run([4, 4, 3, 3], s).weeks.map((w) => w.goal)).toEqual([4, 4, 3, 3]);
  });
  test('applyGoalChange: first change seeds history with the old goal, effective next Monday', () => {
    const now = at(2, 3, 12);
    const p = applyGoalChange(base({ weeklyGoal: 4 }), 3, now);
    expect(p).toEqual({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }, { from: wk(3), goal: 3 }] });
  });
  test('applyGoalChange: second change in the same week replaces the pending one; changing back cancels it', () => {
    const now = at(2, 5, 12);
    const s1 = { ...base({ weeklyGoal: 4 }), ...applyGoalChange(base({ weeklyGoal: 4 }), 3, now) };
    const p2 = applyGoalChange(s1, 5, now);
    expect(p2.goalHistory).toEqual([{ from: 0, goal: 4 }, { from: wk(3), goal: 5 }]);
    const p3 = applyGoalChange(s1, 4, now);
    expect(p3.weeklyGoal).toBe(4); expect(p3.goalHistory).toBeUndefined();
  });
  test('applyGoalChange: next week a new change keeps the entry that took effect', () => {
    const s1 = { ...base({ weeklyGoal: 4 }), ...applyGoalChange(base({ weeklyGoal: 4 }), 3, at(2, 3, 12)) };
    const p = applyGoalChange(s1, 5, at(3, 1, 12)); // week 3: goal 3 in force
    expect(p.goalHistory).toEqual([{ from: 0, goal: 4 }, { from: wk(3), goal: 3 }, { from: wk(4), goal: 5 }]);
  });
  test('applyGoalChange: no-ops and immediate', () => {
    expect(applyGoalChange(base({ weeklyGoal: 4 }), 4, at(1))).toEqual({});
    const p = applyGoalChange(base({ weeklyGoal: 4, goalHistory: [{ from: 0, goal: 4 }, { from: wk(9), goal: 3 }] }), 3, at(1), { immediate: true });
    expect(p.weeklyGoal).toBe(3); expect(p.goalHistory).toBeUndefined();
    expect(applyGoalChange(base({ weeklyGoal: 4 }), 4, at(1), { immediate: true })).toEqual({});
    expect(applyGoalChange(base({ weeklyGoal: 4 }), 99, at(1), { immediate: true }).weeklyGoal).toBe(14);
  });
  test('applyGoalChange caps the history length', () => {
    let s: Partial<Settings> = base({ weeklyGoal: 4 });
    for (let i = 0; i < 130; i++) s = { ...s, ...applyGoalChange(s, i % 2 ? 4 : 3, at(i, 2, 12)) };
    expect((s.goalHistory ?? []).length).toBeLessThanOrEqual(100);
  });
});

// ───────────────────────── pace ─────────────────────────
describe('pace', () => {
  // expected pace for goal 4 by [done][dow] where days = 7 - dow (independent of paceOf)
  const expected = (done: number, dow: number) => {
    const left = Math.max(0, 4 - done), days = 7 - dow;
    if (left === 0) return 'secured';
    if (left === days) return 'lastchance';
    if (left === days - 1) return 'tight';
    if (left > days) return 'repair';
    return 'onpace';
  };
  test.each([0, 1, 2, 3, 4].flatMap((d) => [0, 1, 2, 3, 4, 5, 6].map((dow) => [d, dow] as const)))('done %i on weekday %i', (done, dow) => {
    // a streak behind it (4 hit weeks) so the current week is a normal open week
    const v = run([4, 4, 4, 4, done], base(), dow);
    expect(v.currentWeek.pace).toBe(expected(done, dow));
    expect(v.currentWeek.daysLeft).toBe(7 - dow);
    expect(v.currentWeek.left).toBe(Math.max(0, 4 - done));
    expect(v.currentWeek.secured).toBe(done >= 4);
  });
  test('paceOf boundaries', () => {
    expect(paceOf(0, 7)).toBe('secured'); expect(paceOf(-1, 3)).toBe('secured');
    expect(paceOf(2, 4)).toBe('onpace'); expect(paceOf(3, 4)).toBe('tight'); expect(paceOf(4, 4)).toBe('lastchance'); expect(paceOf(5, 4)).toBe('repair');
    expect(paceOf(1, 3)).toBe('onpace'); expect(paceOf(1, 2)).toBe('tight'); expect(paceOf(1, 1)).toBe('lastchance'); expect(paceOf(2, 1)).toBe('repair');
  });
  test('paceCopy (strings from Streak.dc.html)', () => {
    expect(paceCopy('secured', { left: 0, daysLeft: 5, goal: 4, streak: 8 })).toEqual({ tone: 'green', label: 'Secured', text: 'Week secured. Your streak is now 8 weeks. Anything extra is a bonus.' });
    expect(paceCopy('secured', { left: 0, daysLeft: 5, goal: 4, streak: 1 }).text).toContain('1 week.');
    expect(paceCopy('onpace', { left: 3, daysLeft: 5, goal: 4, streak: 7, dayRange: 'Wed–Sun' })).toEqual({ tone: 'green', label: 'On pace', text: '3 more in 5 days (Wed–Sun). Room for rest days.' });
    expect(paceCopy('onpace', { left: 3, daysLeft: 5, goal: 4, streak: 7 }).text).toBe('3 more in 5 days. Room for rest days.');
    expect(paceCopy('tight', { left: 4, daysLeft: 5, goal: 4, streak: 7 })).toEqual({ tone: 'accent', label: 'Tight', text: '4 more in 5 days. Train today to keep a rest day.' });
    expect(paceCopy('lastchance', { left: 5, daysLeft: 5, goal: 4, streak: 7 })).toEqual({ tone: 'red', label: 'Last chance', text: '5 sessions in 5 days: one every day from today.' });
    expect(paceCopy('lastchance', { left: 1, daysLeft: 1, goal: 4, streak: 7 }).text).toBe('Last day: 1 session today.');
    expect(paceCopy('repair', { left: 5, daysLeft: 3, goal: 4, streak: 7 })).toEqual({ tone: 'red', label: 'Repair next week', text: 'Can’t reach 4 this week. Make up the rest next week to keep the streak.' });
  });
  test('currentWeek carries the copy for the real pace (Wed, 1/4 = onpace, Wed–Sun)', () => {
    const v = run([4, 4, 4, 4, 1], base(), 2);
    expect(v.currentWeek).toMatchObject({ pace: 'onpace', paceLabel: 'On pace', paceTone: 'green', dayRange: 'Wed–Sun', daysLeft: 5 });
    expect(v.currentWeek.paceText).toBe('3 more in 5 days (Wed–Sun). Room for rest days.');
  });
  test('secured copy shows the streak including this week', () => {
    expect(run([4, 4, 4, 4, 4], base(), 2).currentWeek.paceText).toContain('streak is now 5 weeks');
  });
  test('atRisk: tight / lastchance / repair pace with a streak; not secured, not frozen, not without a streak', () => {
    expect(run([4, 4, 4, 4, 0], base(), 3).atRisk).toBe(true); // 4 left in 4 days = last chance
    expect(run([4, 4, 4, 4, 1], base(), 3).atRisk).toBe(true); // 3 left in 4 days = tight
    expect(run([4, 4, 4, 4, 2], base(), 3).atRisk).toBe(false); // on pace
    expect(run([4, 4, 4, 4, 0], base(), 5).atRisk).toBe(true); // repair pace
    expect(run([4, 4, 4, 4, 4], base(), 6).atRisk).toBe(false);
    expect(run([0], base(), 6).atRisk).toBe(false);
    expect(run([4, 4, 4, 4, 0], base({ manualFreezeWeeks: [wk(4)] }), 3).atRisk).toBe(false);
  });
  test('pace in a repair week measures against goal + deficit', () => {
    const v = run([4, 4, 3, 4], base(), 6); // Sunday: needs 5, has 4 -> left 1, days 1 = last chance
    expect(v.currentWeek).toMatchObject({ goal: 4, target: 5, left: 1, pace: 'lastchance', secured: false });
  });
  test('daysLeft Mon = 7 … Sun = 1, using the tz option as well', () => {
    const now = at(2, 0, 9); // Monday 09:00 Stockholm (+1h) = 08:00 UTC
    expect(computeStreak([], base(), now).currentWeek.daysLeft).toBe(7);
    expect(computeStreak([], base(), now, { tz: 0 }).currentWeek.daysLeft).toBe(7);
    // Sunday 23:30 Stockholm = 22:30 UTC: still Sunday in both
    expect(computeStreak([], base(), at(2, 6, 23) + 1800_000, { tz: 0 }).currentWeek.daysLeft).toBe(1);
    // ...but in UTC+3 (tz -180) it is already Monday of the next week
    expect(computeStreak([], base(), at(2, 6, 23) + 1800_000, { tz: -180 }).currentWeek.daysLeft).toBe(7);
  });
});

// ───────────────────────── tiers, milestones ─────────────────────────
describe('tiers and milestones', () => {
  test.each([
    [0, 'none', 0, 'No streak'], [1, 'spark', 1, 'Spark'], [3, 'spark', 1, 'Spark'], [4, 'flame', 2, 'Flame'], [11, 'flame', 2, 'Flame'],
    [12, 'blaze', 3, 'Blaze'], [25, 'blaze', 3, 'Blaze'], [26, 'inferno', 4, 'Inferno'], [200, 'inferno', 4, 'Inferno'],
  ])('%i weeks -> %s', (w, tier, idx, label) => {
    const t = tierOf(w);
    expect([t.tier, t.index, t.label] as unknown[]).toEqual([tier, idx, label]);
  });
  test('TIERS table', () => { expect(TIERS.map((t) => t.from)).toEqual([0, 1, 4, 12, 26]); });
  test('view: Flame · tier 2 at 7 weeks, next tier Blaze in 5, next milestone Two months strong 7/8', () => {
    const v = run([...rep(7, 4), 0]);
    expect(v).toMatchObject({ tier: 'flame', tierIndex: 2, tierLabel: 'Flame', tierText: 'Flame · tier 2' });
    expect(v.nextTier).toEqual({ tier: 'blaze', tierIndex: 3, label: 'Blaze', at: 12, weeksToGo: 5 });
    expect(v.nextMilestone).toEqual({ weeks: 8, name: 'Two months strong', badgeId: 'streak_8', progress: { n: 7, of: 8, unit: 'weeks' } });
    expect(v.milestones.map((m) => m.state)).toEqual(['got', 'got', 'next', 'lock', 'lock', 'lock']);
    expect(v.milestones.map((m) => m.short)).toEqual(['2 weeks', '1 month', '2 months', '3 months', '6 months', '1 year']);
  });
  test('inferno has no next tier; 52+ weeks has no next milestone', () => {
    const v = run(rep(53, 4));
    expect(v.nextTier).toBeNull(); expect(v.nextMilestone).toBeNull(); expect(v.tier).toBe('inferno');
    expect(v.milestones.every((m) => m.state === 'got')).toBe(true);
  });
  test('MILESTONES', () => { expect([...MILESTONES]).toEqual([2, 4, 8, 12, 26, 52]); });
  test('milestones stay unlocked after a reset; progress follows the new streak', () => {
    const v = run([...rep(4, 4), 0, 0, 4]); // 4 weeks (a freeze is earned), week 4 frozen, week 5 resets, new streak 1
    expect(v.current).toBe(1); expect(v.best).toBe(5);
    expect(v.milestones[1].state).toBe('got');
    expect(v.badges.find((b) => b.id === 'streak_4')?.got).toBe(true);
  });
  test('a repair that jumps over a milestone still unlocks it (7 -> 9 passes 8)', () => {
    const v = run([...rep(7, 4), 3, 5]);
    expect(v.current).toBe(9);
    expect(v.badges.find((b) => b.id === 'streak_8')?.got).toBe(true);
    expect(v.celebrate?.kind).toBe('milestone');
  });
});

// ───────────────────────── badges ─────────────────────────
describe('badges', () => {
  const B = (v: StreakView, id: string) => v.badges.find((b) => b.id === id)!;
  test('catalogue: 18 badges in design order with name, icon, how', () => {
    const v = run([0]);
    expect(v.badges.map((b) => b.id)).toEqual(['streak_2', 'streak_4', 'streak_8', 'streak_12', 'streak_26', 'streak_52', 'first_session', 'full_week', 'comeback', 'sessions_10', 'sessions_50', 'perfect_month', 'first_pr', 'triple_digits', 'prs_10', 'full_rotation', 'gym_hopper', 'variety']);
    expect(v.badges.map((b) => b.category as string)).toEqual([...rep(6, 'Streaks'), ...rep(6, 'Consistency'), ...rep(3, 'Strength'), ...rep(3, 'Explorer')]);
    for (const b of v.badges) { expect(b.name).toBeTruthy(); expect(b.icon).toMatch(/^ic-/); expect(b.how).toBeTruthy(); expect(b.got).toBe(false); expect(b.unlockedAt).toBeUndefined(); }
    expect(B(v, 'streak_8').name).toBe('Two months strong'); expect(B(v, 'streak_52').how).toBe('52-week streak. A full year.');
  });
  test.each([[2, 'streak_2'], [4, 'streak_4'], [8, 'streak_8'], [12, 'streak_12'], [26, 'streak_26'], [52, 'streak_52']] as const)('%i weeks unlocks %s with the date the streak reached it', (w, id) => {
    const v = run(rep(w, 4));
    expect(B(v, id).got).toBe(true);
    expect(B(v, id).unlockedAt).toBe(at(w - 1, 3, 8)); // 4th session of week w-1 (days 0..3 at 08:00)
    const lacking = run([...rep(w - 1, 4), 3]);
    expect(B(lacking, id).got).toBe(false);
    expect(B(lacking, id).progress).toEqual({ n: w - 1, of: w, unit: 'weeks' });
  });
  test('first session / 10 / 50 sessions with progress', () => {
    const v = run([9]); expect(B(v, 'first_session').got).toBe(true); expect(B(v, 'sessions_10').progress).toEqual({ n: 9, of: 10, unit: 'sessions' });
    const w = run([5, 5]); expect(B(w, 'sessions_10').got).toBe(true); expect(B(w, 'sessions_10').unlockedAt).toBe(at(1, 4, 8));
    const x = run(rep(13, 4)); expect(B(x, 'sessions_50').got).toBe(true);
    expect(B(run(rep(12, 4)), 'sessions_50').progress).toEqual({ n: 48, of: 50, unit: 'sessions' });
  });
  test('full week: needs a week at the goal', () => {
    expect(B(run([3]), 'full_week').got).toBe(false);
    expect(B(run([3]), 'full_week').progress).toEqual({ n: 3, of: 4, unit: 'sessions' });
    const v = run([3, 4]); expect(B(v, 'full_week').got).toBe(true); expect(B(v, 'full_week').unlockedAt).toBe(at(1, 3, 8));
  });
  test('comeback = first repair', () => {
    expect(B(run([4, 4, 3, 4, 0]), 'comeback').got).toBe(false);
    const v = run([4, 4, 3, 5, 0]); expect(B(v, 'comeback').got).toBe(true); expect(B(v, 'comeback').unlockedAt).toBe(at(3, 4, 8));
  });
  test('perfect month: every Monday-week of a calendar month at goal', () => {
    // Jan 2026 Mondays: 5, 12, 19, 26 -> weeks 0..3
    const v = run([4, 4, 4, 4, 0]);
    expect(B(v, 'perfect_month').got).toBe(true);
    expect(B(v, 'perfect_month').unlockedAt).toBe(at(3, 3, 8));
    const miss = run([4, 4, 3, 4, 0]); expect(B(miss, 'perfect_month').got).toBe(false);
    expect(B(miss, 'perfect_month').progress).toEqual({ n: 0, of: 4, unit: 'weeks' }); // progress is for the current month (Feb)
  });
  test('perfect month: a month you joined mid-way cannot be perfect; progress is for the current month', () => {
    const v = computeStreak([sess(at(1, 0)), sess(at(1, 1)), sess(at(1, 2)), sess(at(1, 3)), ...build([0, 0, 4, 4])], base(), at(3, 4, 12));
    expect(B(v, 'perfect_month').got).toBe(false); // Jan weeks 0 is missing from the replay
    const w = computeStreak(build([4, 4, 4, 4]), base(), at(2, 2, 12));
    expect(B(w, 'perfect_month').progress).toEqual({ n: 3, of: 4, unit: 'weeks' }); // Jan 5/12/19/26, three hit by Jan 28
  });
  test('first PR / 10 PRs', () => {
    const pr = (ts: number) => sess(ts, { exercises: [mkEx({ pr: true })] });
    expect(B(run([1]), 'first_pr').got).toBe(false);
    const s = [pr(at(0, 1)), ...Array.from({ length: 9 }, (_, i) => pr(at(1, i % 7, 9 + Math.floor(i / 7))))];
    const v = computeStreak(s, base(), at(2));
    expect(B(v, 'first_pr').unlockedAt).toBe(at(0, 1)); expect(B(v, 'prs_10').got).toBe(true);
    expect(B(computeStreak(s.slice(0, 9), base(), at(2)), 'prs_10').progress).toEqual({ n: 9, of: 10, unit: 'PRs' });
  });
  test('triple digits: 100 kg on weight x reps only', () => {
    const heavy = (w: number, tracking: SessionExercise['tracking'] = 'weight_reps') => sess(at(0, 2), { exercises: [mkEx({ tracking, sets: [{ weight: w, reps: 3, doneAt: at(0, 2, 19) }] })] });
    expect(B(computeStreak([heavy(99.5)], base(), at(1)), 'triple_digits')).toMatchObject({ got: false, progress: { n: 99.5, of: 100, unit: 'kg' } });
    expect(B(computeStreak([heavy(100)], base(), at(1)), 'triple_digits')).toMatchObject({ got: true, unlockedAt: at(0, 2, 19) });
    expect(B(computeStreak([heavy(120, 'reps')], base(), at(1)), 'triple_digits').got).toBe(false);
  });
  test('full rotation: all rotation areas in one calendar week (needs >= 2 areas)', () => {
    const s = base({ rotation: ['a', 'b', 'c', 'd'] });
    const areas = (w: number, ids: string[]) => ids.map((id, i) => sess(at(w, i, 18), { areaId: id }));
    expect(B(computeStreak(areas(0, ['a', 'b', 'c']), s, at(0, 6)), 'full_rotation')).toMatchObject({ got: false, progress: { n: 3, of: 4, unit: 'areas' } });
    expect(B(computeStreak([...areas(0, ['a', 'b']), ...areas(1, ['c', 'd'])], s, at(1, 6)), 'full_rotation').got).toBe(false); // split across weeks
    const v = computeStreak(areas(0, ['a', 'b', 'c', 'd']), s, at(1, 1));
    expect(B(v, 'full_rotation')).toMatchObject({ got: true, unlockedAt: at(0, 3, 18) });
    expect(B(computeStreak(areas(0, ['a']), base({ rotation: ['a'] }), at(0, 6)), 'full_rotation').got).toBe(false);
  });
  test('gym hopper: 3 different gyms', () => {
    const g = (id: string | null, w: number) => sess(at(w, 0), { gymId: id });
    expect(B(computeStreak([g('a', 0), g('b', 1), g('a', 2), g(null, 3)], base(), at(4)), 'gym_hopper')).toMatchObject({ got: false, progress: { n: 2, of: 3, unit: 'gyms' } });
    expect(B(computeStreak([g('a', 0), g('b', 1), g('c', 2)], base(), at(4)), 'gym_hopper')).toMatchObject({ got: true, unlockedAt: at(2, 0) });
  });
  test('variety: 25 different exercises that were actually performed', () => {
    const exs = (n: number, from = 0) => Array.from({ length: n }, (_, i) => mkEx({ exerciseId: `x${from + i}` }));
    const skipped = mkEx({ exerciseId: 'skip', sets: [], status: 'skipped' });
    const s24 = [sess(at(0, 0), { exercises: [...exs(12), skipped] }), sess(at(0, 1), { exercises: exs(12, 0) })];
    expect(B(computeStreak(s24, base(), at(1)), 'variety')).toMatchObject({ got: false, progress: { n: 12, of: 25, unit: 'exercises' } });
    const s25 = [sess(at(0, 0), { exercises: exs(12) }), sess(at(0, 1), { exercises: exs(13, 12) })];
    expect(B(computeStreak(s25, base(), at(1)), 'variety')).toMatchObject({ got: true, unlockedAt: at(0, 1) });
  });
  test('badgesGot counts the unlocked ones', () => {
    const v = run([4, 4]);
    expect(v.badgesGot).toBe(v.badges.filter((b) => b.got).length);
    expect(v.badgesGot).toBeGreaterThanOrEqual(3); // streak_2, first_session, full_week
  });
});

// ───────────────────────── celebrate ─────────────────────────
describe('celebrate', () => {
  test('null until the week is secured; week kind for a plain hit', () => {
    expect(run([4, 4, 3]).celebrate).toBeNull();
    const c = run([4, 4, 4]).celebrate!;
    expect(c).toMatchObject({ kind: 'week', streak: 3, freezeEarned: false, freezes: 0, tier: 'spark', tierChanged: false, unseen: true, weekStart: wk(2) });
    expect(c.badge).toBeUndefined();
    expect(c.nextTier).toEqual({ tier: 'flame', tierIndex: 2, label: 'Flame', at: 4, weeksToGo: 1 });
  });
  test('milestone kind carries the badge; freezeEarned at the 4th counted week; tier change', () => {
    const c = run(rep(4, 4)).celebrate!;
    expect(c.kind).toBe('milestone'); expect(c.badge?.id).toBe('streak_4'); expect(c.freezeEarned).toBe(true); expect(c.freezes).toBe(1);
    expect(c.tierChanged).toBe(true); expect(c.tier).toBe('flame');
    expect(run(rep(2, 4)).celebrate?.badge?.id).toBe('streak_2');
  });
  test('is shown once: markCelebrated (streakLastCelebrated) makes it seen; a new week is unseen again', () => {
    const v = run(rep(3, 4));
    expect(v.celebrate?.unseen).toBe(true);
    const patch = celebratedPatch(v);
    expect(patch).toEqual({ streakLastCelebrated: wk(2) });
    expect(run(rep(3, 4), base(patch)).celebrate?.unseen).toBe(false);
    expect(run(rep(4, 4), base(patch)).celebrate?.unseen).toBe(true);
  });
  test('celebrations survive a reset: 1 -> miss -> 1 celebrates again', () => {
    const v1 = run([4]); const seen = celebratedPatch(v1);
    expect(v1.celebrate?.unseen).toBe(true);
    expect(run([4, 1, 1, 4], base(seen)).celebrate?.unseen).toBe(true);
  });
  test('a different-week key from another zone still counts as seen', () => {
    const s = base({ streakLastCelebrated: wk(2) + 3600_000 });
    expect(run(rep(3, 4), s).celebrate?.unseen).toBe(false);
  });
  test('stays available (unseen false) later in the same week', () => {
    const v = run(rep(3, 4), base({ streakLastCelebrated: wk(2) }), 6);
    expect(v.celebrate).not.toBeNull(); expect(v.celebrate?.unseen).toBe(false);
  });
});

// ───────────────────────── DST ─────────────────────────
describe('DST and time zones', () => {
  test('60 consecutive weeks across both DST changes stay one streak (local Sunday-night sessions)', () => {
    const w0 = new Date(2025, 2, 3).getTime(); // Monday before the March 30 2025 spring-forward
    const s: Session[] = [];
    for (let i = 0; i < 60; i++) {
      for (const d of [0, 2, 4, 6]) s.push(sess(new Date(2025, 2, 3 + 7 * i + d, d === 6 ? 23 : 0, d === 6 ? 30 : 30).getTime()));
    }
    const v = computeStreak(s, base(), new Date(2025, 2, 3 + 7 * 59 + 6, 23, 45).getTime());
    expect(v.weeks).toHaveLength(60);
    expect(v.current).toBe(60);
    expect(v.weeks.every((w) => w.status === 'hit')).toBe(true);
    expect(v.weeks[0].weekStart).toBe(w0);
    expect(v.current).toBe(streakWeeks(s, 4, new Date(2025, 2, 3 + 7 * 59 + 6, 23, 45).getTime()));
  });
  test('a session at 00:30 Monday after the spring-forward Sunday belongs to the new week', () => {
    const s = [sess(new Date(2026, 2, 29, 23, 30).getTime()), sess(new Date(2026, 2, 30, 0, 30).getTime())];
    const v = computeStreak(s, base({ weeklyGoal: 1 }), new Date(2026, 2, 30, 12).getTime());
    expect(v.weeks).toHaveLength(2);
    expect(v.weeks.map((w) => w.done)).toEqual([1, 1]);
  });
  test('fall-back week (25h Sunday) is still seven calendar days', () => {
    const v = computeStreak([sess(new Date(2026, 9, 25, 12).getTime())], base({ weeklyGoal: 1 }), new Date(2026, 9, 26, 12).getTime());
    expect(v.weeks.map((w) => w.status)).toEqual(['hit', 'open']);
    expect(new Date(v.weeks[1].weekStart).getDate()).toBe(26);
  });
  test('fixed-offset calendar (server with a stored tz) buckets like a local one in the same zone', () => {
    const win = [sess(Date.UTC(2026, 0, 4, 23, 30)), sess(Date.UTC(2026, 0, 5, 23, 30))]; // Sun 00:30 and Mon 00:30 in UTC+1
    const utc = computeStreak(win, base({ weeklyGoal: 1 }), Date.UTC(2026, 0, 6, 12), { tz: 0 });
    const cet = computeStreak(win, base({ weeklyGoal: 1 }), Date.UTC(2026, 0, 6, 12), { tz: -60 });
    expect(utc.weeks.map((w) => w.done)).toEqual([1, 1]); // Sun 23:30 UTC / Mon 23:30 UTC
    expect(cet.weeks.map((w) => w.done)).toEqual([2]); // Mon 00:30 + Tue 00:30 CET: both in the week of Jan 5
    const cal = makeCal(-60);
    expect(cal.weekStart(Date.UTC(2026, 0, 4, 23, 30))).toBe(Date.UTC(2026, 0, 4, 23)); // Monday 00:00 CET
    expect(cal.hour(Date.UTC(2026, 0, 4, 23, 30))).toBe(0);
    expect(cal.addWeeks(Date.UTC(2026, 0, 4, 23), 2)).toBe(Date.UTC(2026, 0, 18, 23));
    expect(cal.dayStart(Date.UTC(2026, 0, 4, 23, 30))).toBe(Date.UTC(2026, 0, 4, 23));
    expect(cal.mondaysIn(2026, 0)).toBe(4);
    expect(makeCal().mondaysIn(2026, 0)).toBe(4); expect(makeCal(0).mondaysIn(2026, 2)).toBe(5);
    expect(cal.ym(Date.UTC(2026, 0, 31, 23, 30))).toEqual([2026, 1]);
  });
  test('invalid tz falls back to local', () => {
    const a = computeStreak(build([4, 4]), base(), at(1, 3), { tz: 99999 });
    const b = computeStreak(build([4, 4]), base(), at(1, 3));
    expect(a.weeks).toEqual(b.weeks);
  });
});

// ───────────────────────── lost / copy flags ─────────────────────────
describe('lost and flags', () => {
  test('lost needs best > 0', () => { expect(run([1, 0]).lost).toBe(false); });
  test('goalPending null when none', () => { expect(run([4]).goalPending).toBeNull(); });
});

// ───────────────────────── reminders ─────────────────────────
describe('streakReminder (Flows section 5)', () => {
  const H = (w: number, d: number, h: number, m = 0) => at(w, d, h) + m * 60_000;
  const rem = (counts: number[], d: number, h: number, s: Partial<Settings> = base(), tz?: number) => {
    const now = H(counts.length - 1, d, h);
    return streakReminder(computeStreak(build(counts), s, now, { tz }), { now, tz });
  };
  test('quiet hours 21:00-07:00', () => {
    expect([6, 7, 20].map(inStreakQuietHours)).toEqual([true, false, false]);
    expect([21, 23, 0, 6].every(inStreakQuietHours)).toBe(true);
    expect(rem([4, 4, 4, 4, 0], 3, 22)).toBeNull();
    expect(rem([4, 4, 4, 4, 0], 3, 6)).toBeNull();
  });
  test('last chance: from 08:00, left == days left', () => {
    expect(rem([4, 4, 4, 4, 0], 3, 7)).toBeNull();
    const r = rem([4, 4, 4, 4, 0], 3, 8)!; // Thu: 4 left, 4 days
    expect(r).toMatchObject({ kind: 'lastchance', title: 'Last chance this week.', body: '4 to go, 4 days left.', url: '/app/' });
    expect(rem([4, 4, 4, 4, 3], 6, 9)).toMatchObject({ kind: 'lastchance', body: '1 to go, 1 day left.' });
  });
  test('tight pace: only from the usual training hour, with the design copy', () => {
    expect(rem([...rep(7, 4), 0], 2, 12)).toBeNull(); // Wed 12:00 before 17:00 -> default hour
    const r = rem([...rep(7, 4), 0], 1, 17)!; // Tue: 4 left, 6 days -> onpace? left 4 <= 4 -> onpace
    expect(r).toBeNull();
    const t = rem([...rep(7, 4), 0], 2, 17)!; // Wed: 4 left, 5 days -> tight
    expect(t).toMatchObject({ kind: 'tight', title: 'Your 7-week streak is at risk.', body: '4 sessions, 5 days left.' });
  });
  test('tight pace honours a learned hour', () => {
    const now = H(7, 2, 10);
    const v = computeStreak(build([...rep(7, 4), 0]), base(), now);
    expect(streakReminder(v, { now, trainHour: 9 })?.kind).toBe('tight');
    expect(streakReminder(v, { now, trainHour: 12 })).toBeNull();
  });
  test('Monday repair: "Save your streak", copy depends on reachability', () => {
    const r = rem([...rep(7, 4), 3, 0], 0, 8)!;
    expect(r).toMatchObject({ kind: 'repair', title: 'Save your streak.', body: 'Do 5 this week and your 7 weeks stay.', url: '/app/' });
    expect(rem([...rep(7, 4), 3, 0], 1, 8)).toBeNull(); // only Monday
    const hard = rem([...rep(4, 4), 2, 0], 0, 8, base({ weeklyGoal: 7 }));
    expect(hard).toBeNull(); // goal 7 -> weeks are all missed -> no streak at all
  });
  test('Monday repair that cannot be reached falls back to the freeze line (or nothing)', () => {
    const s = base({ weeklyGoal: 7 });
    const counts = [...rep(4, 7), 5, 0];
    const r = rem(counts, 0, 8, s)!; // target 9 > 7 days, freeze held
    expect(r.body).toBe('Use a freeze to keep your 4 weeks.');
    const none = rem([...rep(3, 7), 5, 0], 0, 8, s); // no freeze
    expect(none).toBeNull();
  });
  test('Monday lost: gentle copy, opens the Streak page', () => {
    const r = rem([4, 4, 1, 0], 0, 8)!;
    expect(r).toMatchObject({ kind: 'lost', title: 'New streak starts today.', body: 'Your best is 2.', url: '/app/streak' });
    expect(rem([4, 4, 1, 0], 2, 8)).toBeNull();
  });
  test('nothing when secured, frozen, on pace, or without a streak', () => {
    expect(rem([4, 4, 4, 4, 4], 3, 12)).toBeNull();
    expect(rem([4, 4, 4, 4, 0], 3, 12, base({ manualFreezeWeeks: [wk(4)] }))).toBeNull();
    expect(rem([4, 4, 4, 4, 2], 3, 12)).toBeNull();
    expect(rem([0], 3, 12)).toBeNull();
  });
  test('no last-chance reminder while a repair is open (the Monday one covers it)', () => {
    expect(rem([4, 4, 3, 0], 4, 9)).toBeNull();
  });
  test('uses the user tz offset, not the server zone', () => {
    const now = Date.UTC(2026, 1, 5, 7, 30); // Thu 07:30 UTC = 08:30 CET (-60) but 02:30 in UTC-5 (300)
    const v = computeStreak(build([4, 4, 4, 4, 0]), base(), now, { tz: -60 });
    expect(streakReminder(v, { now, tz: -60 })?.kind).toBe('lastchance');
    const w = computeStreak(build([4, 4, 4, 4, 0]), base(), now, { tz: 300 });
    expect(streakReminder(w, { now, tz: 300 })).toBeNull();
  });
  test('usualTrainHour: median start hour of the last 8 weeks, clamped; default without data', () => {
    const now = at(10, 2, 12);
    const at18 = Array.from({ length: 5 }, (_, i) => sess(at(8, i, 19), { startedAt: at(8, i, 18) }));
    expect(usualTrainHour(at18, now)).toBe(18);
    expect(usualTrainHour([], now)).toBe(17);
    expect(usualTrainHour(at18.slice(0, 2), now)).toBe(17);
    const early = Array.from({ length: 5 }, (_, i) => sess(at(8, i, 6), { startedAt: at(8, i, 5) }));
    expect(usualTrainHour(early, now)).toBe(8); // never before the 08:00 reminder window
    const late = Array.from({ length: 5 }, (_, i) => sess(at(8, i, 23), { startedAt: at(8, i, 22) }));
    expect(usualTrainHour(late, now)).toBe(20);
    expect(usualTrainHour(at18, at(30, 0, 12))).toBe(17); // older than 8 weeks
  });
});

// ───────────────────────── details pinned by mutation testing ─────────────────────────
describe('details', () => {
  const B = (v: StreakView, id: string) => v.badges.find((b) => b.id === id)!;
  test('dayRange names every weekday', () => {
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    names.forEach((n, d) => expect(run([4, 4, 4, 4, 0], base(), d).currentWeek.dayRange).toBe(`${n}–Sun`));
  });
  test('calendar helpers: tz validity, month lengths, day start', () => {
    const t = Date.UTC(2026, 0, 14, 15, 45);
        expect(makeCal(841).weekStart(t)).toBe(makeCal().weekStart(t));
    expect(makeCal(NaN).weekStart(t)).toBe(makeCal().weekStart(t));
    expect(makeCal(Infinity).weekStart(t)).toBe(makeCal().weekStart(t));
    expect(makeCal('60' as unknown as number).weekStart(t)).toBe(makeCal().weekStart(t));
    expect(makeCal(840).weekStart(t)).toBe(Date.UTC(2026, 0, 12, 14)); // Monday 00:00 in UTC-14 (tz 840)
    expect(makeCal().mondaysIn(2026, 7)).toBe(5); expect(makeCal(0).mondaysIn(2026, 7)).toBe(5); // Aug 31 is a Monday
    expect(makeCal(0).mondaysIn(2026, 1)).toBe(4); expect(makeCal().mondaysIn(2026, 1)).toBe(4);
    expect(makeCal().dayStart(new Date(2026, 0, 14, 15, 45, 30, 500).getTime())).toBe(new Date(2026, 0, 14).getTime());
    expect(makeCal(-60).dayStart(Date.UTC(2026, 0, 14, 14, 45, 30, 500))).toBe(Date.UTC(2026, 0, 13, 23)); // 15:45 CET -> 00:00 CET
  });
  test('goal 1 in history is honoured; entries exactly at the current Monday are in force, not pending', () => {
    const s = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 1 }, { from: wk(2), goal: 3 }] });
    expect(run([1, 1, 3, 3], s).weeks.map((w) => w.goal)).toEqual([1, 1, 3, 3]);
    const t = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }, { from: wk(5), goal: 3 }] });
    const v = run([4, 4, 4, 4, 4, 3], t);
    expect(v.goalPending).toBeNull(); expect(v.currentWeek.goal).toBe(3);
  });
  test('weeklyGoal edited without history drops stale pending entries', () => {
    const s = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }, { from: wk(8), goal: 5 }] });
    const v = run([4, 4, 4, 4, 4, 3], s);
    expect(v.goalPending).toBeNull(); expect(v.currentWeek.goal).toBe(3);
  });
  test('week key resolution looks at mid-week (a Sunday-23:00 key means the NEXT week)', () => {
    expect(run([4, 4, 4, 4, 1], base({ manualFreezeWeeks: [wk(4) - 3600_000] })).weeks[4].status).toBe('frozen');
  });
  test('sessions exactly at next Monday 00:00 belong to the next week', () => {
    const v = computeStreak([sess(at(1, 0, 0))], base(), at(0, 3));
    expect(B(v, 'first_session').got).toBe(false);
    expect(v.badges.every((b) => !b.got)).toBe(true);
  });
  test('absurd gaps are capped: 2000 weeks, last one is still the current week', () => {
    const now = at(2600, 3);
    const v = computeStreak([sess(at(0, 1))], base(), now);
    expect(v.weeks).toHaveLength(2000);
    expect(v.weeks[1999].weekStart).toBe(v.currentWeek.weekStart);
    expect(computeStreak([sess(at(600, 1))], base(), at(2599, 3)).weeks).toHaveLength(2000);
    expect(computeStreak([sess(at(601, 1))], base(), at(2599, 3)).weeks).toHaveLength(1999);
  });
  test('repair celebrated only in the week it happened; an old repair does not make later weeks "repair"', () => {
    expect(run([4, 4, 3, 5, 4]).celebrate?.kind).toBe('week');
    const second = run([4, 4, 3, 5, 4, 3, 6]).celebrate!;
    expect(second.kind).toBe('repair'); expect(second.badge).toBeUndefined(); // Comeback was unlocked weeks ago
  });
  test('milestone detection works for a session exactly at Monday 00:00', () => {
    const s = [...[0, 0, 0, 0].map(() => sess(at(0, 0, 8))), ...[0, 0, 0, 0].map(() => sess(wk(1)))];
    const v = computeStreak(s, base(), at(1, 3));
    expect(v.celebrate?.kind).toBe('milestone');
  });
  test('lost after a failed repair (the repair week itself also short, no freeze)', () => {
    const v = run([4, 4, 3, 2, 0]);
    expect(v.lost).toBe(true); expect(v.lostStreak).toBe(2); expect(v.current).toBe(0); expect(v.best).toBe(2);
  });
  test('frozen weeks never count towards the next freeze (auto, manual)', () => {
    expect(run([4, 4, 4, 4, 3, 4, 0]).countedWeeks).toBe(5);
    expect(run([4, 4, 4, 4, 1, 0]).countedWeeks).toBe(4);
    expect(run([4, 4, 4, 4, 1], base({ manualFreezeWeeks: [wk(4)] })).countedWeeks).toBe(4);
    expect(run([4, 4, 4, 4, 1], base({ manualFreezeWeeks: [wk(4)] })).weeksUntilFreeze).toBe(4);
  });
  test('auto freeze on deficit 3+ is marked auto', () => {
    expect(run([4, 4, 4, 4, 1, 0]).weeks[4]).toMatchObject({ status: 'frozen', freezeUsed: true, freezeKind: 'auto' });
  });
  test('freezeTarget: none during a repair without a freeze; none when the week is already frozen even with a spare', () => {
    const v = run([4, 4, 3, 0]);
    expect(v.freezeTarget).toBeNull(); expect(v.canUseFreezeNow).toBe(false);
    const two = run([...rep(8, 4), 1], base({ manualFreezeWeeks: [wk(8)] }));
    expect(two.freezes).toBe(1); expect(two.frozenThisWeek).toBe(true); expect(two.freezeTarget).toBeNull();
    expect(run([...rep(8, 4), 1]).freezeTarget).toBe('current');
  });
  test('nextMilestone moves on once a milestone is reached; freezeCapped', () => {
    expect(run(rep(2, 4)).nextMilestone?.weeks).toBe(4);
    expect(run(rep(4, 4)).nextMilestone?.weeks).toBe(8);
    expect(run([...rep(4, 4), 0]).freezeCapped).toBe(false);
    expect(run([...rep(8, 4), 0]).freezeCapped).toBe(true);
  });
  test('optional week fields are absent, not undefined', () => {
    const w = run([4, 4]).weeks[0];
    expect(Object.keys(w).sort()).toEqual(['done', 'freezeUsed', 'goal', 'status', 'streakAfter', 'weekStart']);
    expect(Object.keys(run(rep(4, 4)).weeks[3])).toContain('freezeEarned');
  });
  test('badge progress units and counts', () => {
    const v = run([1]);
    expect(B(v, 'first_session').progress).toEqual({ n: 1, of: 1, unit: 'sessions' });
    expect(B(v, 'comeback').progress).toEqual({ n: 0, of: 1, unit: 'repairs' });
    expect(B(run([4, 4, 3, 5]), 'comeback').progress).toEqual({ n: 1, of: 1, unit: 'repairs' });
    expect(B(v, 'first_pr').progress).toEqual({ n: 0, of: 1, unit: 'PRs' });
    expect(B(run(rep(10, 5)), 'sessions_50').got).toBe(true); // exactly 50
    expect(B(run([...rep(9, 5), 4]), 'sessions_50').got).toBe(false); // 49
  });
  test('perfect month in a 5-Monday month (March 2026) and the first complete month wins', () => {
    const v = run([3, 4, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(B(v, 'perfect_month')).toMatchObject({ got: true, unlockedAt: at(12, 3, 8) });
    const w = run(rep(8, 4)); // Jan and Feb both perfect: unlocked with January
    expect(B(w, 'perfect_month').unlockedAt).toBe(at(3, 3, 8));
  });
  test('PRs: only flagged exercises; triple digits uses the first heavy set', () => {
    const plain = sess(at(0, 1), { exercises: [mkEx({ pr: false })] });
    expect(B(computeStreak([plain], base(), at(1)), 'first_pr').got).toBe(false);
    const two = sess(at(0, 1), { exercises: [mkEx({ sets: [{ weight: 105, reps: 3, doneAt: at(0, 1, 17) }, { weight: 110, reps: 3, doneAt: at(0, 1, 18) }] })] });
    expect(B(computeStreak([two], base(), at(1)), 'triple_digits').unlockedAt).toBe(at(0, 1, 17));
    expect(B(computeStreak([two], base(), at(1)), 'triple_digits').progress).toEqual({ n: 100, of: 100, unit: 'kg' });
  });
  test('explorer badges keep their first unlock time and ignore foreign areas / blank ids', () => {
    const s = base({ rotation: ['a', 'b', 'c'] });
    const list = [sess(at(0, 0), { areaId: 'a' }), sess(at(0, 1), { areaId: 'z' }), sess(at(0, 2), { areaId: 'b' }), sess(at(0, 3), { areaId: 'c' }), sess(at(0, 4), { areaId: 'a' })];
    expect(B(computeStreak(list.slice(0, 3), s, at(1)), 'full_rotation').got).toBe(false);
    expect(B(computeStreak(list, s, at(1)), 'full_rotation').unlockedAt).toBe(at(0, 3));
    expect(B(computeStreak(list, base({ rotation: ['a', 'b'] }), at(1)), 'full_rotation').got).toBe(true); // exactly two areas
    const gyms = ['a', 'b', 'c', 'd'].map((g, i) => sess(at(i, 0), { gymId: g }));
    expect(B(computeStreak(gyms, base(), at(5)), 'gym_hopper').unlockedAt).toBe(at(2, 0));
    const exs = (n: number, from: number) => Array.from({ length: n }, (_, i) => mkEx({ exerciseId: `x${from + i}` }));
    const withJunk = [sess(at(0, 0), { exercises: [...exs(25, 0), mkEx({ exerciseId: '' }), { ...mkEx(), sets: undefined } as unknown as SessionExercise] }), sess(at(0, 1), { exercises: exs(2, 25) })];
    expect(B(computeStreak(withJunk, base(), at(1)), 'variety')).toMatchObject({ got: true, unlockedAt: at(0, 0), progress: { n: 25, of: 25, unit: 'exercises' } });
    expect(B(computeStreak([sess(at(0, 0), { exercises: [mkEx({ exerciseId: '' })] })], base(), at(1)), 'variety').progress?.n).toBe(0);
  });
  test('applyGoalChange: capped history keeps a seed and stays ascending; stale pending entry is cleared', () => {
    let s: Partial<Settings> = base({ weeklyGoal: 4 });
    for (let i = 0; i < 130; i++) s = { ...s, ...applyGoalChange(s, i % 2 ? 4 : 3, at(i, 2, 12)) };
    const h = s.goalHistory!;
    expect(h).toHaveLength(100); expect(h[0].from).toBe(0);
    for (let i = 1; i < h.length; i++) expect(h[i].from).toBeGreaterThan(h[i - 1].from);
    const stale = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 3 }, { from: wk(5), goal: 5 }] });
    expect(applyGoalChange(stale, 3, at(1, 2))).toEqual({ weeklyGoal: 3, goalHistory: undefined });
  });
  test('freezePatch keeps numbers only, sorted, unique and at most 52', () => {
    const many = Array.from({ length: 60 }, (_, i) => wk(i + 10));
    const s = base({ manualFreezeWeeks: ['x', NaN, ...many.reverse(), wk(10)] as unknown as number[] });
    const v = run([4, 4, 4, 4, 1], base());
    const p = freezePatch(s, v)!.manualFreezeWeeks!;
    expect(p).toHaveLength(52);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
    expect(new Set(p).size).toBe(52);
    expect(p[p.length - 1]).toBe(wk(69));
    expect(freezePatch(base({ manualFreezeWeeks: [wk(2), 7 as number] }), v)!.manualFreezeWeeks).toEqual([7, wk(2), wk(4)]);
  });
  test('undoFreezePatch removes only the undone week', () => {
    const s = base({ manualFreezeWeeks: [wk(2), wk(4)] });
    const v = run([4, 4, 4, 4, 1], s);
    expect(undoFreezePatch(s, v)?.manualFreezeWeeks).toEqual([wk(2)]);
  });
  test('usualTrainHour: three sessions are enough, unsorted hours, ignores discarded / future / old / junk', () => {
    const now = at(10, 2, 12);
    const st = (h: number, o: Partial<Session> = {}) => sess(at(9, 0, h + 1), { startedAt: at(9, 0, h), ...o });
    expect(usualTrainHour([st(20), st(8), st(9)], now)).toBe(9);
    expect(usualTrainHour([st(12), st(12)], now)).toBe(17);
    expect(usualTrainHour([st(10), st(10), st(10, { status: 'discarded' }), st(20, { status: 'discarded' }), st(20, { status: 'discarded' })], now)).toBe(17); // only 2 count
    expect(usualTrainHour([st(10), st(10), st(10), sess(at(10, 5, 20), { startedAt: at(10, 5, 19) }), sess(at(10, 5, 20), { startedAt: at(10, 5, 19) })], now)).toBe(10); // future ones are ignored
    expect(usualTrainHour([st(10), st(10), st(10), { ...st(5), startedAt: NaN }, null as unknown as Session], now)).toBe(10);
    expect(usualTrainHour([st(10), st(10), sess(at(1, 0, 11), { startedAt: at(1, 0, 3) })], now)).toBe(17); // older than 8 weeks
    expect(usualTrainHour([st(10), st(10), sess(at(2, 0, 11), { startedAt: at(2, 0, 3) })], now)).toBe(10); // inside the window: median of 3,10,10
  });
  test('reminders: complete objects (kind, tag, url, texts)', () => {
    const now = (w: number, d: number, h: number) => at(w, d, h);
    const R = (counts: number[], d: number, h: number, s: Partial<Settings> = base()) => { const n = now(counts.length - 1, d, h); return streakReminder(computeStreak(build(counts), s, n), { now: n }); };
    expect(R([...rep(7, 4), 3, 0], 0, 8)).toEqual({ kind: 'repair', title: 'Save your streak.', body: 'Do 5 this week and your 7 weeks stay.', url: '/app/', tag: 'streak' });
    expect(R([4, 4, 1, 0], 0, 8)).toEqual({ kind: 'lost', title: 'New streak starts today.', body: 'Your best is 2.', url: '/app/streak', tag: 'streak' });
    expect(R([4, 4, 4, 4, 0], 3, 8)).toEqual({ kind: 'lastchance', title: 'Last chance this week.', body: '4 to go, 4 days left.', url: '/app/', tag: 'streak' });
    expect(R([...rep(7, 4), 0], 2, 17)).toEqual({ kind: 'tight', title: 'Your 7-week streak is at risk.', body: '4 sessions, 5 days left.', url: '/app/', tag: 'streak' });
    expect(R([4, 3, 0], 0, 8, base({ weeklyGoal: 7 }))).toBeNull(); // no streak: nothing to save
    const hard = R([...rep(4, 7), 5, 0], 0, 8, base({ weeklyGoal: 7 }));
    expect(hard).toEqual({ kind: 'repair', title: 'Save your streak.', body: 'Use a freeze to keep your 4 weeks.', url: '/app/', tag: 'streak' });
    const one = R([...rep(1, 7), 6, 0], 0, 8, base({ weeklyGoal: 7 }));
    expect(one).toBeNull(); // no freeze, target out of reach
    expect(R([...rep(4, 7), 5, 0], 0, 8, base({ weeklyGoal: 7 }))?.body).not.toContain('1 weeks');
  });
});

describe('goalForWeek', () => {
  const s = base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }, { from: wk(5), goal: 3 }] });
  test('the goal in force for the week of a timestamp (a pending change is not in force yet)', () => {
    expect(goalForWeek(s, at(4, 3))).toBe(4);
    expect(goalForWeek(s, at(4, 6, 23))).toBe(4);
    expect(goalForWeek(s, at(5, 0, 0))).toBe(3);
    expect(goalForWeek(s, at(9, 2))).toBe(3);
    expect(goalForWeek(s, at(0, 1))).toBe(4);
  });
  test('no history = weeklyGoal; weeklyGoal edited without history applies from this week; garbage is safe', () => {
    expect(goalForWeek(base({ weeklyGoal: 5 }), at(2))).toBe(5);
    expect(goalForWeek(base({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 4 }] }), at(2))).toBe(3);
    expect(goalForWeek({}, NaN)).toBe(4);
  });
  test('agrees with computeStreak for every week', () => {
    const v = run(rep(8, 4), s);
    for (const w of v.weeks) expect(goalForWeek(s, w.weekStart + 3600_000 * 30, undefined)).toBe(w.goal);
  });
  test('tz option', () => { expect(goalForWeek(s, Date.UTC(2026, 1, 1, 22, 30), -120)).toBe(goalForWeek(s, Date.UTC(2026, 1, 2, 0, 30), 0)); });
});
