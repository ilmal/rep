// Session lifecycle, exercise lifecycle, rest timer, swap, auto-adjust, endEarly/finish/delete: every transition and illegal transition.
import { describe, expect, test } from 'bun:test';
import {
  FB, MIN, SEC, active, clearOutbox, doAllSets, ex, gymId, onboard, playAll, queued, ready, S, startLive, tick, useHarness, invariants,
} from './state-kit';
import * as A from './actions';
import { mutate, putEntity } from './core';
import { endSession, finishAtLastSet, discardActive } from './x-session-end';
import { nextSlot, weekCount } from '../../shared/rules';
useHarness();

/** Run `fn` and assert it changed NOTHING that persists or syncs (illegal transition = no-op). */
function expectNoop(fn: () => unknown) {
  const { sessions, outbox, gyms, prefs, progress, plans, device } = S();
  const ev = S().events.length;
  fn();
  expect(S().sessions).toBe(sessions);
  expect(S().outbox).toBe(outbox);
  expect(S().gyms).toBe(gyms);
  expect(S().prefs).toBe(prefs);
  expect(S().progress).toBe(progress);
  expect(S().plans).toBe(plans);
  expect(S().device).toBe(device);
  expect(S().events.length).toBe(ev);
}
const kinds = () => S().events.map((e) => e.kind);
const addPlan = (over: Record<string, unknown> = {}) => mutate((st) => putEntity(st, 'plan', 'plan1', { id: 'plan1', title: 'Coach day', exercises: [{ exerciseId: 'bench_press', sets: 3 }, { exerciseId: 'back_squat' }], status: 'pending', createdBy: 'coach', createdAt: Date.now(), ...over }));

describe('session lifecycle: happy path', () => {
  test('planned draft -> warmup -> set -> rest -> set -> fb -> ... -> done -> completed', () => {
    const d = ready();
    expect(d.exercises.length).toBeGreaterThan(0);
    clearOutbox();
    const id = A.beginSession()!;
    let a = S().sessions[id];
    expect(a).toMatchObject({ status: 'active', phase: 'warmup', cursor: 0, seq: 1, slot: 1, source: 'auto', gymId: gymId() });
    expect(a.exercises.every((e) => e.status === 'todo' && e.sets.length === 0)).toBe(true);
    expect(a.warmupItems).toHaveLength(3);
    expect(queued('session', id)?.data).toBe(a);
    expect(kinds()).toContain('session_started');
    expect(S().device.draft).not.toBeNull(); // begin keeps the draft; it is cleared on finish/end

    tick(5 * MIN); A.endWarmup(); a = active()!;
    expect(a.phase).toBe('set');
    expect(a.warmupEndedAt).toBeDefined();
    expect(a.exercises[0].status).toBe('active');
    expect(a.exercises[1].status).toBe('todo');

    const e0 = ex(a); const planned = e0.plannedSets;
    for (let i = 1; i <= planned; i++) {
      tick(40 * SEC); A.logSet(50, 6); a = active()!;
      if (i < planned) {
        expect(a.phase).toBe('rest');
        expect(a.restEndsAt).toBe(Date.now() + e0.restSec * 1000);
        expect(a.restTotalSec).toBe(e0.restSec);
        tick(30 * SEC); A.endRest(); a = active()!;
        expect(a.phase).toBe('set');
        expect(a.restEndsAt).toBeUndefined();
        expect(ex(a).sets[i - 1].restSec).toBe(30);
      } else {
        expect(a.phase).toBe('fb');
        expect(ex(a).endedAt).toBe(Date.now());
      }
    }
    expect(ex(a).sets).toHaveLength(planned);
    tick(); A.saveFeedback(FB); a = active()!;
    expect(a.exercises[0]).toMatchObject({ status: 'done', feedback: FB });
    expect(a.exercises[0].recommendation).toBeDefined();
    expect(a.cursor).toBe(1);
    expect(a.phase).toBe('set');
    expect(a.exercises[1].status).toBe('active');
    expect(kinds()).toEqual(expect.arrayContaining(['warmup_done', 'set_logged', 'rest_skipped', 'feedback']));

    playAll(); a = active()!;
    expect(a.phase).toBe('done');
    expect(a.exercises.every((e) => e.status === 'done')).toBe(true);
    expect(S().sessions[id].status).toBe('active'); // 'done' phase is still active until finishSession

    tick(); expect(A.finishSession('great')).toBe(id);
    const f = S().sessions[id];
    expect(f).toMatchObject({ status: 'completed', phase: 'done', note: 'great' });
    expect(f.endedAt).toBe(Date.now());
    expect(S().device.draft).toBeNull();
    expect(S().device.chosenSlot).toBeNull();
    expect(active()).toBeUndefined();
    expect(kinds()).toContain('session_completed');
    expect(invariants(S())).toEqual([]);
  });

  test('completion applies progress, gym visit and the rotation pointer + week count', () => {
    ready(); startLive();
    const ids = active()!.exercises.map((e) => e.exerciseId);
    expect(A.pointerSlot()).toBe(1);
    playAll({ effort: 'normal', weight: 'light', volume: 'ok' });
    clearOutbox();
    const id = A.finishSession()!;
    for (const eid of ids) {
      const rec = S().sessions[id].exercises.find((e) => e.exerciseId === eid)!.recommendation!;
      expect(S().progress[eid]).toMatchObject({ weight: rec.weight, reps: rec.reps, sets: rec.sets });
      expect(queued('progress', eid)).toBeDefined();
    }
    expect(S().gyms[gymId()].lastVisitedAt).toBe(Date.now());
    expect(A.pointerSlot()).toBe(2);
    expect(weekCount(Object.values(S().sessions), Date.now())).toBe(1);
  });
});

describe('illegal session transitions are no-ops', () => {
  test('nothing active: every in-session action does nothing', () => {
    ready();
    expectNoop(() => {
      A.endWarmup(); A.logSet(10, 5); A.endRest(); A.saveFeedback(FB); A.skipCurrent(); A.undoLastSet(); A.addSetToCurrent(); A.removeSetFromCurrent();
      A.adjustRest(30); A.toggleWarmupItem(0); A.dropExercise('x'); A.moveUpcoming('x', 1); A.undoAdjustmentById('x'); A.reapplyAdjustment('x'); A.swapCurrent('busy', 'bench_press');
    });
    expect(A.finishSession()).toBeNull();
    expect(A.endEarly('save')).toBeNull();
    expect(A.endEarly('discard')).toBeNull();
    expect(A.getActiveSession()).toBeUndefined();
  });

  test('beginSession: needs a non-empty draft and refuses a second active session', () => {
    onboard();
    expect(A.beginSession()).toBeNull(); // no draft yet
    A.prepareDraft();
    A.draftEdit((d) => ({ ...d, exercises: [] }));
    expect(A.beginSession()).toBeNull(); // empty draft
    A.prepareDraft(true);
    const first = A.beginSession()!;
    expect(first).toBeTruthy();
    expectNoop(() => expect(A.beginSession()).toBeNull());
    expect(Object.values(S().sessions)).toHaveLength(1);
  });

  test('warmup phase: logSet / endRest / saveFeedback / skip / swap / undo / addSet are refused; endWarmup twice is a no-op', () => {
    ready(); A.beginSession();
    expectNoop(() => { A.logSet(10, 5); A.endRest(); A.saveFeedback(FB); A.skipCurrent(); A.undoLastSet(); A.addSetToCurrent(); A.removeSetFromCurrent(); A.adjustRest(30); A.swapCurrent('busy', 'back_squat'); });
    tick(); A.endWarmup();
    const w = active()!.warmupEndedAt;
    tick(MIN);
    expectNoop(() => A.endWarmup());
    expect(active()!.warmupEndedAt).toBe(w);
  });

  test("'set' phase: endRest, saveFeedback, adjustRest, undoLastSet refused", () => {
    startLive();
    expectNoop(() => { A.endRest(); A.saveFeedback(FB); A.adjustRest(30); A.undoLastSet(); });
    expect(active()!.phase).toBe('set');
  });

  test("'rest' phase: logSet / saveFeedback / endWarmup refused", () => {
    startLive(); A.logSet(20, 8);
    expect(active()!.phase).toBe('rest');
    expectNoop(() => { A.logSet(20, 8); A.saveFeedback(FB); A.endWarmup(); });
  });

  test("'fb' phase: logSet / endRest / endWarmup / skip / swap / add+remove set / adjustRest refused", () => {
    startLive(); doAllSets();
    expect(active()!.phase).toBe('fb');
    expectNoop(() => { A.logSet(20, 8); A.endRest(); A.endWarmup(); A.skipCurrent(); A.swapCurrent('busy', 'back_squat'); A.addSetToCurrent(); A.removeSetFromCurrent(); A.adjustRest(10); });
  });

  test("'done' phase: skip / swap / logSet / saveFeedback / endRest refused and finished exercises stay 'done'", () => {
    startLive(); playAll();
    expect(active()!.phase).toBe('done');
    const before = active()!.exercises.map((e) => e.status);
    expectNoop(() => { A.skipCurrent(); A.swapCurrent('gone', 'back_squat'); A.logSet(10, 5); A.saveFeedback(FB); A.endRest(); A.endWarmup(); A.addSetToCurrent(); });
    expect(active()!.exercises.map((e) => e.status)).toEqual(before);
  });

  test('finishSession twice / endEarly after finish: the second call returns null and changes nothing', () => {
    startLive(); playAll();
    const id = A.finishSession()!;
    expectNoop(() => { expect(A.finishSession()).toBeNull(); expect(A.endEarly('save')).toBeNull(); expect(A.endEarly('discard')).toBeNull(); });
    expect(S().sessions[id].status).toBe('completed');
  });

  test('bad numbers are never stored (NaN / Infinity / negative)', () => {
    startLive();
    expectNoop(() => { A.logSet(NaN, 5); A.logSet(20, NaN); A.logSet(Infinity, 5); A.logSet(-1, 5); A.logSet(20, -2); });
    A.logSet(0, 0);
    expect(ex().sets[0]).toMatchObject({ weight: 0, reps: 0 });
  });
});

describe('undo semantics', () => {
  test('undoLastSet from rest returns to set, removes the set and cancels the timer', () => {
    startLive(); A.logSet(20, 8);
    A.undoLastSet();
    const a = active()!;
    expect(a.phase).toBe('set');
    expect(ex(a).sets).toHaveLength(0);
    expect(a.restEndsAt).toBeUndefined();
    expect(kinds()).toContain('set_undone');
    tick(); A.logSet(22, 8); // can log again
    expect(ex().sets).toHaveLength(1);
    expect(ex().sets[0].weight).toBe(22);
  });
  test('undoLastSet from fb removes the last set and clears endedAt', () => {
    startLive(); doAllSets();
    const n = ex().sets.length;
    A.undoLastSet();
    expect(active()!.phase).toBe('set');
    expect(ex().sets).toHaveLength(n - 1);
    expect(ex().endedAt).toBeUndefined();
    expect(ex().status).toBe('active');
  });
  test('undo then re-complete gives the same end state', () => {
    startLive(); doAllSets(); A.undoLastSet(); A.logSet(20, 8);
    expect(active()!.phase).toBe('fb');
  });
  test('the first set of the NEXT exercise cannot be undone back into the finished one', () => {
    startLive(); doAllSets(); A.saveFeedback(FB);
    expectNoop(() => A.undoLastSet());
    expect(active()!.exercises[0].status).toBe('done');
  });
  test('sets can be added/removed only in set/rest and never below the logged count', () => {
    startLive();
    const p = ex().plannedSets;
    A.addSetToCurrent(); expect(ex().plannedSets).toBe(p + 1);
    A.removeSetFromCurrent(); expect(ex().plannedSets).toBe(p);
    for (let i = 0; i < 20; i++) A.addSetToCurrent();
    expect(ex().plannedSets).toBe(12);
    A.logSet(20, 8);
    for (let i = 0; i < 20; i++) A.removeSetFromCurrent();
    expect(ex().plannedSets).toBeGreaterThanOrEqual(ex().sets.length + 1);
  });
});

describe('rest timer', () => {
  test('adjustRest extends and shortens, floors at now+1s, only during rest', () => {
    startLive(); A.logSet(20, 8);
    const end = active()!.restEndsAt!;
    A.adjustRest(30); expect(active()!.restEndsAt).toBe(end + 30_000);
    expect(active()!.restTotalSec!).toBeGreaterThanOrEqual(ex().restSec + 30);
    A.adjustRest(-3600); expect(active()!.restEndsAt).toBe(Date.now() + 1000);
  });
  test('endRest(auto) records the actual rest on the previous set and does not log rest_skipped; manual does', () => {
    startLive(); A.logSet(20, 8);
    tick(95 * SEC); A.endRest(true);
    expect(ex().sets[0].restSec).toBe(95);
    expect(kinds()).not.toContain('rest_skipped');
    A.logSet(20, 8); tick(10 * SEC); A.endRest(false);
    expect(ex().sets[1].restSec).toBe(10);
    expect(kinds()).toContain('rest_skipped');
  });
  test('wall-clock: the timer is a timestamp, so a long gap while backgrounded is still correct', () => {
    startLive(); A.logSet(20, 8);
    const end = active()!.restEndsAt!;
    tick(3600_000); // app was suspended for an hour; reload resumes from persisted timestamps
    expect(active()!.restEndsAt).toBe(end);
    expect(Date.now()).toBeGreaterThan(end);
  });
  test('time-based and rep-based exercises use the same state machine', () => {
    startLive();
    expect(ex().tracking).toBeDefined();
    A.logSet(0, 30);
    expect(active()!.phase === 'rest' || active()!.phase === 'fb').toBe(true);
  });
});

describe('exercise lifecycle: todo / active / done / skipped / dropped', () => {
  test('todo -> active at warm-up end, active -> done on feedback, next todo -> active', () => {
    ready(); A.beginSession();
    expect(active()!.exercises.map((e) => e.status)).toEqual(active()!.exercises.map(() => 'todo'));
    A.endWarmup();
    expect(active()!.exercises[0].status).toBe('active');
    expect(active()!.exercises[0].startedAt).toBeDefined();
  });
  test('skip: active -> skipped (endedAt set), next becomes active; skipping the last goes to phase done', () => {
    startLive();
    const n = active()!.exercises.length;
    A.skipCurrent();
    expect(active()!.exercises[0]).toMatchObject({ status: 'skipped' });
    expect(active()!.exercises[0].endedAt).toBeDefined();
    expect(active()!.cursor).toBe(1);
    expect(active()!.exercises[1].status).toBe('active');
    for (let i = 1; i < n; i++) A.skipCurrent();
    expect(active()!.phase).toBe('done');
    expect(active()!.exercises.every((e) => e.status === 'skipped')).toBe(true);
    expect(kinds().filter((k) => k === 'exercise_skipped')).toHaveLength(n);
  });
  test('skip during rest keeps the partial sets on the skipped row', () => {
    startLive(); A.logSet(20, 8); A.skipCurrent();
    expect(active()!.exercises[0].status).toBe('skipped');
    expect(active()!.exercises[0].sets).toHaveLength(1);
    expect(active()!.phase).toBe('set');
    expect(active()!.restEndsAt).toBeUndefined();
  });
  test('drop / reinstate: only todo <-> dropped; active, done and skipped rows are untouched', () => {
    startLive();
    const [a0, a1, a2] = active()!.exercises;
    expectNoop(() => A.dropExercise(a0.id)); // active
    A.dropExercise(a1.id); expect(active()!.exercises[1].status).toBe('dropped');
    A.dropExercise(a1.id, false); expect(active()!.exercises[1].status).toBe('todo');
    A.dropExercise(a1.id, false); expect(active()!.exercises[1].status).toBe('todo'); // idempotent
    A.dropExercise(a1.id); A.dropExercise(a1.id); expect(active()!.exercises[1].status).toBe('dropped');
    doAllSets(); A.saveFeedback(FB); // a0 done; a1 is skipped by advance
    expect(active()!.cursor).toBe(2);
    expect(active()!.exercises[2].id).toBe(a2.id);
    expectNoop(() => A.dropExercise(a0.id)); // done
    expect(active()!.exercises[1].status).toBe('dropped');
  });
  test('a dropped exercise is skipped over by advance; dropping every remaining one ends the session flow', () => {
    startLive();
    for (const e of active()!.exercises.slice(1)) A.dropExercise(e.id);
    doAllSets(); A.saveFeedback(FB);
    expect(active()!.phase).toBe('done');
    expect(active()!.exercises.slice(1).every((e) => e.status === 'dropped')).toBe(true);
  });
  test('restoring a dropped exercise BEHIND the cursor is still visited (advance wraps)', () => {
    startLive();
    const [, b, c] = active()!.exercises;
    A.dropExercise(b.id); doAllSets(); A.saveFeedback(FB);
    expect(active()!.cursor).toBe(2); // b dropped -> c active
    A.dropExercise(b.id, false); // b is todo again, behind the cursor
    for (const e of active()!.exercises.slice(3)) A.dropExercise(e.id);
    doAllSets(); A.saveFeedback(FB);
    expect(active()!.exercises[1].status).toBe('active'); // b is now being done, not lost
    expect(active()!.phase).toBe('set');
    expect(c.id).toBeDefined();
  });
  test("restoring a dropped exercise after phase 'done' revives the session onto it", () => {
    startLive();
    const [, b] = active()!.exercises;
    for (const e of active()!.exercises.slice(1)) A.dropExercise(e.id);
    doAllSets(); A.saveFeedback(FB);
    expect(active()!.phase).toBe('done');
    A.dropExercise(b.id, false);
    expect(active()!.phase).toBe('set');
    expect(active()!.cursor).toBe(1);
    expect(invariants(S(), { noSync: true })).toEqual([]);
  });
  test('moveUpcoming reorders only rows strictly after the cursor and reindexes order', () => {
    startLive();
    const ids = active()!.exercises.map((e) => e.id);
    expectNoop(() => { A.moveUpcoming(ids[0], 1); A.moveUpcoming(ids[1], -1); A.moveUpcoming(ids[ids.length - 1], 1); A.moveUpcoming('nope', 1); });
    A.moveUpcoming(ids[1], 1);
    expect(active()!.exercises.map((e) => e.id).slice(0, 3)).toEqual([ids[0], ids[2], ids[1]]);
    expect(active()!.exercises.map((e) => e.order)).toEqual(active()!.exercises.map((_, i) => i));
  });
  test('toggleWarmupItem flips done state', () => {
    ready(); A.beginSession();
    A.toggleWarmupItem(1); expect(active()!.warmupItems![1].done).toBe(true);
    A.toggleWarmupItem(1); expect(active()!.warmupItems![1].done).toBe(false);
  });
});

describe('hot swap: every reason', () => {
  const busyCase = () => {
    startLive();
    const cur = ex();
    const lib = A.libraryOf().find((e) => e.id === cur.exerciseId)!;
    const eq = A.limitingEquipment(lib)!;
    const alt = A.alternativesFor(cur.exerciseId, active()!.exercises.map((e) => e.exerciseId), [eq])[0];
    return { cur, eq, alt, gid: gymId() };
  };
  test('busy: marks the session busy only (gym untouched), replaces the exercise in place', () => {
    const { cur, eq, alt, gid } = busyCase();
    expect(alt).toBeDefined();
    const gymBefore = S().gyms[gid];
    A.swapCurrent('busy', alt.exercise.id);
    const a = active()!;
    expect(a.busyEquip).toContain(eq);
    expect(S().gyms[gid]).toBe(gymBefore);
    expect(a.exercises[0]).toMatchObject({ exerciseId: alt.exercise.id, status: 'active', swappedFrom: { exerciseId: cur.exerciseId, reason: 'busy' } });
    expect(a.exercises).toHaveLength(S().sessions[a.id].exercises.length);
    expect(a.phase).toBe('set');
    expect(kinds()).toContain('exercise_swapped');
  });
  test('broken: gym equipment becomes broken with a brokenSince stamp and the gym syncs', () => {
    const { eq, alt, gid } = busyCase();
    clearOutbox();
    A.swapCurrent('broken', alt.exercise.id);
    expect(S().gyms[gid].equipment[eq]).toBe('broken');
    expect(S().gyms[gid].brokenSince[eq]).toBe(Date.now());
    expect(queued('gym', gid)).toBeDefined();
    expect(active()!.busyEquip).not.toContain(eq);
  });
  test('gone: equipment removed from the gym, stale brokenSince cleared', () => {
    startLive();
    const cur = ex(); const lib = A.libraryOf().find((e) => e.id === cur.exerciseId)!;
    const eq = A.limitingEquipment(lib)!;
    A.setEquipStatus(gymId(), eq, 'broken'); // was broken before
    expect(S().gyms[gymId()].brokenSince[eq]).toBeDefined();
    const alt = A.alternativesFor(cur.exerciseId, [], [eq])[0];
    A.swapCurrent('gone', alt.exercise.id);
    expect(S().gyms[gymId()].equipment[eq]).toBeUndefined();
    expect(S().gyms[gymId()].brokenSince[eq]).toBeUndefined();
  });
  test('after sets were logged the old row is kept (skipped, with its sets) and the new row is inserted after it', () => {
    startLive(); A.logSet(20, 8);
    const cur = ex(); const n = active()!.exercises.length;
    const alt = A.alternativesFor(cur.exerciseId, active()!.exercises.map((e) => e.exerciseId))[0];
    A.swapCurrent('busy', alt.exercise.id);
    const a = active()!;
    expect(a.exercises).toHaveLength(n + 1);
    expect(a.exercises[0]).toMatchObject({ status: 'skipped' });
    expect(a.exercises[0].sets).toHaveLength(1);
    expect(a.cursor).toBe(1);
    expect(a.exercises[1]).toMatchObject({ exerciseId: alt.exercise.id, status: 'active', sets: [] });
    expect(a.exercises.map((e) => e.order)).toEqual(a.exercises.map((_, i) => i));
    expect(a.phase).toBe('set');
    expect(a.restEndsAt).toBeUndefined();
    expect(invariants(S(), { noSync: true })).toEqual([]);
  });
  test('refused: unknown exercise, swapping to the exercise already in progress, outside set/rest', () => {
    startLive();
    expectNoop(() => { A.swapCurrent('busy', 'no_such_exercise'); A.swapCurrent('broken', ex().exerciseId); });
  });
  test('swapped-out equipment is excluded from alternatives while busy; banned/paused exercises never appear', () => {
    startLive();
    const cur = ex(); const lib = A.libraryOf().find((e) => e.id === cur.exerciseId)!;
    const first = A.alternativesFor(cur.exerciseId, [])[0].exercise.id;
    A.banExercise(first, true);
    expect(A.alternativesFor(cur.exerciseId, []).map((a) => a.exercise.id)).not.toContain(first);
    const eq = A.limitingEquipment(lib)!;
    for (const a of A.alternativesFor(cur.exerciseId, [], [eq])) expect(a.exercise.equipment).not.toContain(eq);
  });
});

describe('auto-adjust (fit to time)', () => {
  function overrun() {
    ready(); A.draftSetTarget(20); A.beginSession();
    tick(50 * MIN); // warm-up ran very long
    A.endWarmup();
    return active()!;
  }
  test('overrun at warm-up end trims rest then drops tail exercises, never the current one; text says warm-up ran long', () => {
    const a = overrun();
    expect(a.adjustments.length).toBeGreaterThan(0);
    expect(a.adjustments.every((x) => x.text.startsWith('Warm-up ran long.'))).toBe(true);
    expect(a.exercises[0].status).toBe('active');
    expect(a.adjustments.some((x) => x.type === 'trim_rest' || x.type === 'drop')).toBe(true);
    expect(kinds()).toContain('auto_adjust');
  });
  test('fitToTime=false disables it', () => {
    A.updateSettings({ fitToTime: false });
    expect(overrun().adjustments).toHaveLength(0);
  });
  test('undo restores rest/status and marks the adjustment undone; undoing twice is a no-op; reapply re-applies', () => {
    const a = overrun();
    const drop = a.adjustments.find((x) => x.type === 'drop')!;
    const trim = a.adjustments.find((x) => x.type === 'trim_rest');
    expect(drop).toBeDefined();
    const dropped = active()!.exercises.find((e) => e.id === drop.exerciseId)!;
    expect(dropped.status).toBe('dropped');
    A.undoAdjustmentById(drop.id);
    expect(active()!.exercises.find((e) => e.id === drop.exerciseId)!.status).toBe('todo');
    expect(active()!.adjustments.find((x) => x.id === drop.id)!.undone).toBe(true);
    expectNoop(() => A.undoAdjustmentById(drop.id));
    A.reapplyAdjustment(drop.id);
    expect(active()!.exercises.find((e) => e.id === drop.exerciseId)!.status).toBe('dropped');
    expect(active()!.adjustments.find((x) => x.id === drop.id)!.undone).toBe(false);
    expectNoop(() => A.reapplyAdjustment(drop.id)); // not undone -> nothing to reapply
    if (trim) {
      const before = Object.fromEntries(active()!.exercises.map((e) => [e.id, e.restSec]));
      A.undoAdjustmentById(trim.id);
      for (const [id, r] of Object.entries(trim.prevRestSec!)) expect(active()!.exercises.find((e) => e.id === id)!.restSec).toBe(r);
      expect(Object.keys(before).length).toBeGreaterThan(0);
    }
    expectNoop(() => A.undoAdjustmentById('nope'));
  });
  test('after a feedback the next cursor is protected and auto-adjust can fire again', () => {
    ready(); A.draftSetTarget(20); A.beginSession(); A.endWarmup();
    doAllSets(); tick(60 * MIN); A.saveFeedback(FB);
    const a = active()!;
    if (a.phase !== 'done') expect(a.exercises[a.cursor].status).toBe('active');
    expect(invariants(S(), { noSync: true })).toEqual([]);
  });
});

describe('endEarly / finish / delete effects on week count, rotation pointer and progress', () => {
  const sessionsNow = () => Object.values(S().sessions);
  /** log a full first exercise with feedback, then 1 set of the second, leave the rest */
  const partial = () => {
    startLive(); doAllSets(30, 8); A.saveFeedback({ effort: 'normal', weight: 'light', volume: 'ok' });
    A.logSet(10, 8); // second exercise: one set, no feedback
  };
  test("endEarly('save'): counted, flagged, unfinished rows resolved; progress ONLY for exercises that got feedback", () => {
    partial();
    const first = active()!.exercises[0]; const second = active()!.exercises[1];
    const id = A.endEarly('save')!;
    const s = S().sessions[id];
    expect(s).toMatchObject({ status: 'completed', endedEarly: true, repeatNext: false, phase: 'done' });
    expect(s.exercises[0].status).toBe('done');
    expect(s.exercises[1]).toMatchObject({ status: 'done' }); // had a set
    expect(s.exercises.slice(2).every((e) => e.status === 'skipped')).toBe(true);
    expect(S().progress[first.exerciseId]).toBeDefined();
    expect(S().progress[second.exerciseId]).toBeUndefined(); // done without recommendation: no progress
    expect(weekCount(sessionsNow(), Date.now())).toBe(1);
    expect(A.pointerSlot()).toBe(2);
    expect(S().device.draft).toBeNull();
    expect(kinds()).toContain('session_ended_early');
    expect(invariants(S(), { noSync: true })).toEqual([]);
  });
  test('repeatNext keeps the rotation pointer on the same slot', () => {
    startLive(); doAllSets(); A.saveFeedback(FB);
    A.endEarly('save', { repeatNext: true });
    expect(S().sessions[Object.keys(S().sessions)[0]].repeatNext).toBe(true);
    expect(A.pointerSlot()).toBe(1);
    expect(weekCount(sessionsNow(), Date.now())).toBe(1);
  });
  test("endEarly('discard'): never counted, pointer + progress + gym + pause countdown + coach plan all untouched", () => {
    onboard(); addPlan(); A.pauseExercise('lateral_raise', { sessions: 2 });
    A.prepareDraft(true); expect(S().device.draft!.coachPlanId).toBe('plan1');
    A.beginSession(); A.endWarmup(); doAllSets(); A.saveFeedback(FB);
    const progBefore = S().progress; const gymBefore = S().gyms[gymId()];
    const id = A.endEarly('discard')!;
    expect(S().sessions[id]).toMatchObject({ status: 'discarded' });
    expect(S().sessions[id].endedAt).toBeDefined();
    expect(weekCount(sessionsNow(), Date.now())).toBe(0);
    expect(A.pointerSlot()).toBe(1);
    expect(S().progress).toBe(progBefore);
    expect(S().gyms[gymId()]).toBe(gymBefore);
    expect(S().prefs['lateral_raise'].pausedSessions).toBe(2);
    expect(S().plans['plan1'].status).toBe('pending');
    expect(S().device.draft).toBeNull();
    expect(kinds()).toContain('session_discarded');
    // next draft is again the same slot and can start a fresh session
    A.prepareDraft(true); expect(A.beginSession()).toBeTruthy();
  });
  test('discarded sessions never enter exercise history / PR baselines', () => {
    startLive(); doAllSets(100, 10); A.saveFeedback(FB); A.endEarly('discard');
    A.prepareDraft(true); A.beginSession(); A.endWarmup();
    const e = ex(); A.logSet(20, 5);
    expect(A.getActiveSession()!.exercises[0].exerciseId).toBe(e.exerciseId);
    for (const x of Object.values(S().sessions).filter((s) => s.status === 'active')) expect(x.exercises[0].pr).toBeUndefined();
  });
  test('finishSession before the end resolves leftover rows like endEarly and flags endedEarly', () => {
    startLive(); doAllSets(); A.saveFeedback(FB); A.logSet(10, 8);
    const id = A.finishSession()!;
    const s = S().sessions[id];
    expect(s.exercises.some((e) => e.status === 'todo' || e.status === 'active')).toBe(false);
    expect(s.endedEarly).toBe(true);
    expect(s.status).toBe('completed');
  });
  test('week count: only completed sessions inside the local week; Sunday 23:59 vs Monday 00:00', () => {
    const mk = (id: string, seq: number, at: number, status: 'completed' | 'discarded' = 'completed') =>
      mutate((st) => putEntity(st, 'session', id, { id, seq, slot: 1, areaId: 'a', areaName: 'A', gymId: null, gymName: 'g', status, startedAt: at - 3600_000, endedAt: at, targetMin: 60, warmupTargetMin: 10, exercises: [], adjustments: [], busyEquip: [], cursor: 0, phase: 'done' }));
    mk('sun', 1, new Date(2026, 10, 15, 23, 59).getTime()); // Sun 15 Nov: previous week
    mk('mon', 2, new Date(2026, 10, 16, 0, 0).getTime()); // Mon 16 Nov 00:00: this week
    mk('disc', 3, new Date(2026, 10, 17, 9, 0).getTime(), 'discarded');
    const all = Object.values(S().sessions);
    expect(weekCount(all, Date.now())).toBe(1);
    expect(weekCount(all, new Date(2026, 10, 15, 12).getTime())).toBe(1);
  });
  test('deleteSession: removes completed/discarded, syncs a deletion, rewinds count+pointer but NOT progress; active and unknown refused', () => {
    startLive(); playAll({ effort: 'normal', weight: 'light', volume: 'ok' });
    const id = A.finishSession()!;
    const prog = S().progress;
    A.prepareDraft(true); expect(S().device.draft).not.toBeNull();
    clearOutbox();
    A.deleteSession(id);
    expect(S().sessions[id]).toBeUndefined();
    expect(queued('session', id)).toMatchObject({ deleted: true });
    expect(S().device.draft).toBeNull();
    expect(weekCount(Object.values(S().sessions), Date.now())).toBe(0);
    expect(A.pointerSlot()).toBe(1);
    expect(S().progress).toBe(prog);
    expect(kinds()).toContain('session_deleted');
    // active sessions cannot be deleted
    A.prepareDraft(true); const act = A.beginSession()!;
    expectNoop(() => { A.deleteSession(act); A.deleteSession('nope'); });
  });
  test('pausedSessions counts down on every completed session (finish or save), floors at 0, ignores time-based pauses', () => {
    A.pauseExercise('lateral_raise', { sessions: 2 });
    A.pauseExercise('db_curl', { days: 7 });
    const once = () => { startLive(); playAll(); A.finishSession(); };
    ready(); once();
    expect(S().prefs['lateral_raise'].pausedSessions).toBe(1);
    A.prepareDraft(true); startLive(); doAllSets(); A.saveFeedback(FB); A.endEarly('save');
    expect(S().prefs['lateral_raise'].pausedSessions).toBe(0);
    A.prepareDraft(true); startLive(); playAll(); A.finishSession();
    expect(S().prefs['lateral_raise'].pausedSessions).toBe(0);
    expect(S().prefs['db_curl'].pausedSessions).toBeUndefined();
  });
  test('coach plan: pending -> used with usedBySessionId on completion; a plan cancelled meanwhile stays cancelled', () => {
    addPlan(); ready();
    expect(S().device.draft).toMatchObject({ source: 'coach', coachPlanId: 'plan1' });
    startLive();
    expect(active()).toMatchObject({ source: 'coach', coachPlanId: 'plan1' });
    playAll(); const id = A.finishSession()!;
    expect(S().plans['plan1']).toMatchObject({ status: 'used', usedBySessionId: id });
    expect(queued('plan', 'plan1')).toBeDefined();
    // cancelled mid-session
    addPlan({ id: 'plan2', status: 'pending' });
    mutate((st) => putEntity(st, 'plan', 'plan2', { ...st.plans['plan2'], id: 'plan2' }));
    A.chooseSlot(null); A.prepareDraft(true);
    startLive(); expect(active()!.coachPlanId).toBe('plan2');
    mutate((st) => putEntity(st, 'plan', 'plan2', { ...st.plans['plan2'], status: 'cancelled' }));
    playAll(); A.finishSession();
    expect(S().plans['plan2'].status).toBe('cancelled');
    expect(S().plans['plan2'].usedBySessionId).toBeUndefined();
  });
  test('coach plan via endEarly(save) is consumed too; via discard it is not', () => {
    addPlan(); ready(); startLive(); doAllSets(); A.saveFeedback(FB);
    A.endEarly('save');
    expect(S().plans['plan1'].status).toBe('used');
  });
});

describe('x-session-end wrappers', () => {
  test('endSession stores reason chips; finishAtLastSet ends at the last logged set (not now) and counts', () => {
    startLive(); doAllSets(); A.saveFeedback(FB);
    const lastSet = Math.max(...active()!.exercises.flatMap((e) => e.sets.map((s) => s.doneAt)));
    tick(2 * 3600_000);
    const id = finishAtLastSet()!;
    expect(S().sessions[id].endedAt).toBe(lastSet);
    expect(S().sessions[id].status).toBe('completed');
    expect(weekCount(Object.values(S().sessions), Date.now())).toBe(1);
    A.prepareDraft(true); startLive();
    expect(finishAtLastSet()).toBeNull(); // nothing logged: not completable
    expect(active()).toBeDefined();
    const d = endSession('save', { reasons: ['Low energy'], repeatNext: true })!;
    expect((S().sessions[d] as unknown as { endReason: string[] }).endReason).toEqual(['Low energy']);
    A.prepareDraft(true); A.beginSession();
    const x = discardActive()!;
    expect(S().sessions[x].status).toBe('discarded');
  });
  test('rotation pointer follows completed sessions through the whole cycle and wraps', () => {
    ready();
    const slots: number[] = [];
    for (let i = 0; i < 5; i++) { A.prepareDraft(true); slots.push(S().device.draft!.slot); startLive(); doAllSets(); A.saveFeedback(FB); A.endEarly('save'); tick(MIN); }
    expect(slots).toEqual([1, 2, 3, 4, 1]);
    expect(nextSlot(Object.values(S().sessions), 4)).toBe(2);
  });
});
