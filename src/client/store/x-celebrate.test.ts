import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { celebrateCopy, newlyUnlockedBadges, streakSpan } from './x-celebrate';
import { computeStreak } from '../../shared/streak';
import type { Session, SessionExercise, Settings } from '../../shared/types';

const OLD_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Stockholm'; });
afterAll(() => { if (OLD_TZ === undefined) delete process.env.TZ; else process.env.TZ = OLD_TZ; });

const at = (w: number, d = 0, h = 18) => new Date(2026, 0, 5 + 7 * w + d, h).getTime();
let uid = 0;
const ex = (over: Partial<SessionExercise> = {}): SessionExercise => ({ id: `e${++uid}`, exerciseId: 'sq', name: 'Squat', order: 0, tracking: 'weight_reps', weightStep: 2.5, repMin: 5, repMax: 8, plannedSets: 3, repTarget: 5, plannedWeight: 60, restSec: 90, estSec: 600, status: 'done', sets: [{ weight: 60, reps: 5, doneAt: 1 }], ...over });
const sess = (ts: number, over: Partial<Session> = {}): Session => ({ id: `s${++uid}`, seq: uid, slot: 1, areaId: 'a', areaName: 'A', gymId: 'g1', gymName: 'G', status: 'completed', startedAt: ts - 3600_000, endedAt: ts, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done', updatedAt: ts, ...over });
const build = (counts: number[]) => counts.flatMap((c, w) => Array.from({ length: c }, (_, k) => sess(at(w, k % 7, 8 + Math.floor(k / 7)))));
const settings: Partial<Settings> = { weeklyGoal: 4, rotation: [] };

describe('streakSpan', () => {
  test('weeks, months, half a year, a year', () => {
    expect(streakSpan(1)).toBe('One week');
    expect(streakSpan(2)).toBe('Two weeks');
    expect(streakSpan(7)).toBe('Seven weeks');
    expect(streakSpan(8)).toBe('Two months');
    expect(streakSpan(12)).toBe('Three months');
    expect(streakSpan(26)).toBe('Half a year');
    expect(streakSpan(52)).toBe('A full year');
    expect(streakSpan(104)).toBe('Two years');
  });
});

describe('celebrateCopy', () => {
  test('week 8: badge + freeze + next tier, as the design', () => {
    const s = build([4, 4, 4, 4, 4, 4, 4, 4]);
    const v = computeStreak(s, settings, at(7, 3, 12));
    expect(v.celebrate?.kind).toBe('milestone');
    const c = celebrateCopy(v.celebrate!, v);
    expect(c.headline).toBe('week streak!');
    expect(c.from).toBe(7);
    expect(c.body).toBe('4 of 4 this week. Two months of showing up, any day you liked.');
    expect(c.badge).toEqual({ title: 'Badge unlocked', sub: 'Two months strong' });
    expect(c.freeze?.title).toBe('+1 streak freeze');
    expect(c.freeze?.sub).toMatch(/^\d of 2\./);
    expect(c.next).toEqual({ title: 'Next tier: Blaze at 12 weeks', pct: 67, sub: '4 weeks to go · best ever: 8' });
  });
  test('plain week: no badge, no freeze rows', () => {
    const v = computeStreak(build([4, 4, 4]), settings, at(2, 3, 12));
    const c = celebrateCopy(v.celebrate!, v);
    expect(c.badge).toBeNull(); expect(c.freeze).toBeNull();
    expect(c.body).toBe('4 of 4 this week. Three weeks of showing up, any day you liked.');
  });
  test('repair: own headline, count-up starts two weeks back', () => {
    const v = computeStreak(build([4, 4, 4, 4, 4, 3, 5]), settings, at(6, 5, 12));
    expect(v.celebrate?.kind).toBe('repair');
    const c = celebrateCopy(v.celebrate!, v);
    expect(c.headline).toBe('Streak saved');
    expect(c.from).toBe(v.celebrate!.streak - 2);
    expect(c.body).toContain('made up the missed sessions'); expect(c.badge?.sub).toBe('Comeback');
  });
  test('top tier: no next-tier row; 1 week to go is singular', () => {
    const v = computeStreak(build(Array(26).fill(4)), settings, at(25, 3, 12));
    expect(celebrateCopy(v.celebrate!, v).next).toBeNull();
    const v2 = computeStreak(build(Array(11).fill(4)), settings, at(10, 3, 12));
    expect(celebrateCopy(v2.celebrate!, v2).next?.sub).toBe('1 week to go · best ever: 11');
  });
});

describe('newlyUnlockedBadges', () => {
  test('first session unlocks First session; the next one does not repeat it', () => {
    const s = build([2]);
    expect(newlyUnlockedBadges(s, settings, s[0].id).map((b) => b.id)).toContain('first_session');
    expect(newlyUnlockedBadges(s, settings, s[1].id).map((b) => b.id)).not.toContain('first_session');
  });
  test('the 10th session unlocks 10 sessions, only on that session', () => {
    const s = build([4, 4, 4]);
    const ids = (i: number) => newlyUnlockedBadges(s, settings, s[i].id).map((b) => b.id);
    expect(ids(9)).toContain('sessions_10');
    expect(ids(8)).not.toContain('sessions_10');
    expect(ids(10)).not.toContain('sessions_10');
  });
  test('later sessions do not leak into an earlier session', () => {
    const s = build([4, 4]);
    expect(newlyUnlockedBadges(s, settings, s[0].id).map((b) => b.id)).not.toContain('full_week');
    expect(newlyUnlockedBadges(s, settings, s[3].id).map((b) => b.id)).toContain('full_week');
  });
  test('unknown / not completed session: nothing', () => {
    const s = build([1]);
    expect(newlyUnlockedBadges(s, settings, 'nope')).toEqual([]);
    expect(newlyUnlockedBadges([{ ...s[0], status: 'active' }], settings, s[0].id)).toEqual([]);
  });
});
