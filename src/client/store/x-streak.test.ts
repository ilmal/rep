// Streak store layer: goal history on weekly-goal changes, freeze / undo, celebrate-once, sync carrying the new settings fields,
// tolerance for old persisted settings. Domain maths are covered in src/shared/streak*.test.ts.
import { describe, expect, test } from 'bun:test';
import { onboard, queued, S, server, setClock, tick, useHarness, DAY, HOUR, T0, MIN } from './state-kit';
import * as A from './actions';
import { initialState, mutate, putEntity, sanitizeSaved, setState } from './core';
import { markStreakCelebrated, selectStreak, undoFreezeThisWeek, freezeThisWeek, useFreezeThisWeek } from './x-streak';
import { syncNow } from './sync';
import { withDefaults } from '../../shared/defaults';
import { weekStart } from '../../shared/rules';
import type { Session } from '../../shared/types';
useHarness();

const WS = () => weekStart(T0); // Mon 16 Nov 2026
const mkSession = (seq: number, endedAt: number) =>
  mutate((st) => putEntity(st, 'session', 's' + seq, { id: 's' + seq, seq, slot: 1, areaId: 'a', areaName: 'A', gymId: null, gymName: 'g', status: 'completed', startedAt: endedAt - HOUR, endedAt, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done' } as unknown as Session));
/** `n` completed sessions in the week `w` weeks before the current one */
let seq = 0;
const week = (w: number, n: number) => { for (let i = 0; i < n; i++) mkSession(++seq, WS() - w * 7 * DAY + i * DAY + 10 * HOUR); };
/** 4 hit weeks (freeze earned) before this week, `cur` sessions this week */
const withStreak = (cur = 1) => { onboard(); seq = 0; for (const w of [4, 3, 2, 1]) week(w, 4); for (let i = 0; i < cur; i++) mkSession(++seq, WS() + i * HOUR + 8 * HOUR); };

describe('selectStreak', () => {
  test('derives from sessions + settings at the clock', () => {
    withStreak(1);
    const v = selectStreak();
    expect(v.current).toBe(4); expect(v.freezes).toBe(1); expect(v.currentWeek.done).toBe(1); expect(v.tierLabel).toBe('Flame');
    expect(selectStreak(S(), T0 + 7 * DAY).currentWeek.done).toBe(0);
  });
});

describe('weekly goal change writes goalHistory (applies from next Monday)', () => {
  test('after training: pending until next Monday; this week keeps the old goal', () => {
    withStreak(1);
    A.updateSettings({ weeklyGoal: 3 });
    expect(S().settings.weeklyGoal).toBe(3);
    expect(S().settings.goalHistory).toEqual([{ from: 0, goal: 4 }, { from: WS() + 7 * DAY, goal: 3 }]);
    const v = selectStreak();
    expect(v.currentWeek.goal).toBe(4); expect(v.goalPending).toEqual({ from: WS() + 7 * DAY, goal: 3 });
    expect(selectStreak(S(), T0 + 7 * DAY).currentWeek.goal).toBe(3);
    expect(v.weeks.slice(0, 4).every((w) => w.goal === 4)).toBe(true); // history untouched
  });
  test('second change the same week replaces the pending one; changing back drops it', () => {
    withStreak(0);
    A.updateSettings({ weeklyGoal: 3 }); A.updateSettings({ weeklyGoal: 5 });
    expect(S().settings.goalHistory).toEqual([{ from: 0, goal: 4 }, { from: WS() + 7 * DAY, goal: 5 }]);
    A.updateSettings({ weeklyGoal: 4 });
    expect(S().settings.goalHistory).toBeUndefined();
    expect(S().settings.weeklyGoal).toBe(4);
  });
  test('never trained: immediate, no history', () => {
    onboard(); A.updateSettings({ weeklyGoal: 2 });
    expect(S().settings.goalHistory).toBeUndefined(); expect(selectStreak().currentWeek.goal).toBe(2);
  });
  test('onboarding itself writes the goal immediately; other settings leave history alone', () => {
    onboard({ goal: 3 }); expect(S().settings.goalHistory).toBeUndefined(); expect(S().settings.weeklyGoal).toBe(3);
    withStreak(0); A.updateSettings({ weeklyGoal: 2 }); const h = S().settings.goalHistory;
    A.updateSettings({ restSec: 120 }); expect(S().settings.goalHistory).toEqual(h);
  });
  test('an explicit goalHistory in the patch wins (sync/import paths)', () => {
    withStreak(0);
    A.updateSettings({ weeklyGoal: 3, goalHistory: [{ from: 0, goal: 3 }] });
    expect(S().settings.goalHistory).toEqual([{ from: 0, goal: 3 }]);
  });
  test('the change is queued for sync with the settings entity', () => {
    withStreak(1); A.updateSettings({ weeklyGoal: 3 });
    expect((queued('settings', 'settings')!.data as { goalHistory: unknown[] }).goalHistory).toHaveLength(2);
  });
});

describe('freeze / undo', () => {
  test('use a freeze on the open week, then undo', () => {
    withStreak(1);
    expect(selectStreak().canUseFreezeNow).toBe(true);
    expect(freezeThisWeek()).toBe(true);
    expect(S().settings.manualFreezeWeeks).toEqual([WS()]);
    let v = selectStreak();
    expect(v.frozenThisWeek).toBe(true); expect(v.freezes).toBe(0); expect(v.current).toBe(5); expect(v.atRisk).toBe(false);
    expect(freezeThisWeek()).toBe(false); // already frozen
    expect(S().events.some((e) => e.kind === 'streak_freeze')).toBe(true);
    expect(undoFreezeThisWeek()).toBe(true);
    v = selectStreak();
    expect(v.frozenThisWeek).toBe(false); expect(v.freezes).toBe(1); expect(v.current).toBe(4);
    expect(S().events.some((e) => e.kind === 'streak_unfreeze')).toBe(true);
    expect(undoFreezeThisWeek()).toBe(false);
  });
  test('refunded when the goal is still hit', () => {
    withStreak(1); freezeThisWeek();
    for (let i = 0; i < 3; i++) { tick(MIN); mkSession(++seq, T0 - 2 * HOUR + i * MIN); }
    const v = selectStreak();
    expect(v.currentWeek.done).toBe(4); expect(v.weeks[v.weeks.length - 1]).toMatchObject({ status: 'hit', freezeUsed: false }); expect(v.freezes).toBe(1);
  });
  test('no freeze held / secured week: nothing is written, nothing queued', () => {
    onboard(); seq = 0; week(1, 4); mkSession(++seq, WS() + 9 * HOUR);
    const before = S().outbox['settings:settings']?.updatedAt;
    expect(freezeThisWeek()).toBe(false);
    expect(S().outbox['settings:settings']?.updatedAt).toBe(before);
    expect(S().settings.manualFreezeWeeks).toBeUndefined();
  });
  test('useFreezeThisWeek() returns the action and spends nothing by itself', () => {
    withStreak(1);
    const act = useFreezeThisWeek();
    expect(act).toBe(freezeThisWeek); expect(S().settings.manualFreezeWeeks).toBeUndefined();
  });
  test('with a repair open the freeze covers the missed week', () => {
    onboard(); seq = 0; for (const w of [5, 4, 3, 2]) week(w, 4); week(1, 3); mkSession(++seq, WS() + 9 * HOUR);
    const v = selectStreak();
    expect(v.repairOffer).not.toBeNull(); expect(v.freezeTarget).toBe('missed');
    expect(freezeThisWeek()).toBe(true);
    expect(S().settings.manualFreezeWeeks).toEqual([WS() - 7 * DAY]);
    const w = selectStreak();
    expect(w.repairOffer).toBeNull(); expect(w.weeks[w.weeks.length - 2].status).toBe('frozen');
    expect(undoFreezeThisWeek()).toBe(true); expect(selectStreak().repairOffer).not.toBeNull();
  });
});

describe('celebrate once', () => {
  test('markStreakCelebrated flips unseen for this week only and is idempotent', () => {
    onboard(); seq = 0; week(1, 4); week(0, 4);
    expect(selectStreak().celebrate?.unseen).toBe(true);
    markStreakCelebrated();
    expect(S().settings.streakLastCelebrated).toBe(WS());
    expect(selectStreak().celebrate?.unseen).toBe(false);
    const stamp = queued('settings', 'settings')!.updatedAt;
    markStreakCelebrated(); // no churn
    expect(queued('settings', 'settings')!.updatedAt).toBe(stamp);
    expect(selectStreak(S(), T0 + 7 * DAY).celebrate).toBeNull();
  });
  test('an explicit week start is stored as given', () => {
    onboard(); markStreakCelebrated(123456);
    expect(S().settings.streakLastCelebrated).toBe(123456);
  });
});

describe('persistence + sync tolerate the new fields', () => {
  test('old settings without them hydrate to a working streak', () => {
    const old = { name: 'x', weeklyGoal: 3, rotation: [] } as never;
    const s = withDefaults(old);
    expect(s.goalHistory).toBeUndefined();
    setState(() => ({ ...initialState(), hydrated: true, settings: s }));
    expect(selectStreak().currentWeek.goal).toBe(3);
  });
  test('sanitizeSaved keeps sessions; settings with garbage streak fields never crash the view', () => {
    const clean = sanitizeSaved({ sessions: {}, settings: {} });
    expect(clean.sessions).toEqual({});
    setState((st) => { st.settings = withDefaults({ weeklyGoal: 4, goalHistory: 'nope', manualFreezeWeeks: [null, 'x'], streakLastCelebrated: 'q' } as never); });
    expect(() => selectStreak()).not.toThrow();
  });
  test('goalHistory / manualFreezeWeeks / streakLastCelebrated round-trip through sync and survive a pull on another device', async () => {
    withStreak(1);
    A.updateSettings({ weeklyGoal: 3 }); freezeThisWeek(); markStreakCelebrated(WS());
    await syncNow();
    const uid = S().device.userId!;
    const ent = server.entity(uid, 'settings', 'settings')!;
    const data = ent.data as Record<string, unknown>;
    expect(data.goalHistory).toEqual([{ from: 0, goal: 4 }, { from: WS() + 7 * DAY, goal: 3 }]);
    expect(data.manualFreezeWeeks).toEqual([WS()]);
    expect(data.streakLastCelebrated).toBe(WS());
    // a second device that pulls it computes the same view
    const mine = selectStreak();
    const dev = S().device;
    setState(() => ({ ...initialState(), hydrated: true, device: { ...initialState().device, token: dev.token, userId: dev.userId } }));
    setClock(T0);
    await syncNow();
    expect(S().settings.manualFreezeWeeks).toEqual([WS()]);
    expect(selectStreak().current).toBe(mine.current);
    expect(selectStreak().goalPending).toEqual(mine.goalPending);
    expect(selectStreak().weeks).toEqual(mine.weeks);
  });
});
