// The built-in "At home · no equipment" location in the store: choosing, toggling, planning, running a session, history, sync, progression.
import { describe, expect, test } from 'bun:test';
import { FB, active, doAllSets, ex, onboard, ready, S, startLive, tick, useHarness, invariants, queued, T0, DAY, setClock } from './state-kit';
import * as A from './actions';
import { mutate, putEntity } from './core';
import { computeStreak } from '../../shared/streak';
import { NO_EQUIPMENT_GYM_ID, NO_EQUIPMENT_NAME } from '../../shared/location';
import { SEED_BY_ID } from '../../shared/exercises';
import { gymShares } from './x-progress';
useHarness();

const isBodyweight = (id: string) => SEED_BY_ID[id].equipment.every((q) => q === 'mat');

describe('choosing the no-equipment location', () => {
  test('chooseNoEquipment sets the current location, remembers the gym, and never creates a gym entity', () => {
    onboard();
    const gym = S().device.currentGymId!;
    A.prepareDraft(true);
    const gymsBefore = S().gyms;
    A.chooseNoEquipment();
    expect(S().device).toMatchObject({ currentGymId: NO_EQUIPMENT_GYM_ID, gymSource: 'manual', homeReturn: { gymId: gym } });
    expect(S().gyms).toBe(gymsBefore);
    expect(Object.keys(S().gyms)).not.toContain(NO_EQUIPMENT_GYM_ID);
    expect(S().device.draft).toBeNull(); // plan was for the gym: regenerate
    expect(queued('gym', NO_EQUIPMENT_GYM_ID)).toBeUndefined();
  });
  test('the draft is bodyweight, same area, with updated minutes; New mix and draft edits keep working', () => {
    onboard();
    A.prepareDraft(true);
    const gymDraft = S().device.draft!;
    A.chooseNoEquipment(); A.prepareDraft();
    const d = S().device.draft!;
    expect(d.gymId).toBe(NO_EQUIPMENT_GYM_ID);
    expect(d.areaId).toBe(gymDraft.areaId);
    expect(d.slot).toBe(gymDraft.slot);
    expect(d.exercises.length).toBeGreaterThanOrEqual(4);
    expect(d.exercises.every((e) => isBodyweight(e.exerciseId) && e.plannedWeight === 0)).toBe(true);
    expect(d.hiddenNames).toEqual([]);
    const min = (x: typeof d) => x.exercises.reduce((a, e) => a + e.estSec, 0);
    expect(min(d)).not.toBe(min(gymDraft));
    A.newMix();
    expect(S().device.draft!.gymId).toBe(NO_EQUIPMENT_GYM_ID);
    expect(S().device.draft!.exercises.every((e) => isBodyweight(e.exerciseId))).toBe(true);
    A.draftRemove(S().device.draft!.exercises[0].id);
    expect(invariants()).toEqual([]);
  });
  test('previewDraftAt is a dry run: stores nothing, and is exactly the plan you get after choosing that location', () => {
    onboard();
    A.prepareDraft(true);
    const before = S().device;
    const preview = A.previewDraftAt(NO_EQUIPMENT_GYM_ID)!;
    expect(S().device).toBe(before);
    expect(preview.gymId).toBe(NO_EQUIPMENT_GYM_ID);
    A.chooseNoEquipment(); A.prepareDraft();
    expect(S().device.draft!.exercises.map((e) => e.exerciseId)).toEqual(preview.exercises.map((e) => e.exerciseId));
    // and back: the preview at the gym is the plan the gym gets again
    const backPreview = A.previewDraftAt(Object.keys(S().gyms)[0])!;
    A.leaveNoEquipment(); A.prepareDraft();
    expect(S().device.draft!.exercises.map((e) => e.exerciseId)).toEqual(backPreview.exercises.map((e) => e.exerciseId));
  });
  test('toggle goes back to the gym it came from (and keeps GPS source); no gyms at all → null', () => {
    onboard();
    const gym = S().device.currentGymId!;
    A.toggleNoEquipment();
    expect(S().device.currentGymId).toBe(NO_EQUIPMENT_GYM_ID);
    A.toggleNoEquipment();
    expect(S().device).toMatchObject({ currentGymId: gym, gymSource: 'last' });
    expect(S().device.homeReturn).toBeUndefined();
    A.leaveNoEquipment(); // not at home: no-op
    expect(S().device.currentGymId).toBe(gym);
    // deleted gym: falls back to the first remaining one, else null
    A.toggleNoEquipment();
    A.deleteGym(gym);
    A.toggleNoEquipment();
    expect(S().device.currentGymId).toBeNull();
    expect(S().device.gymSource).toBe('none');
  });
  test('useAtHome-style selector: currentGymId none; deleting a gym does not touch the built-in location', () => {
    onboard();
    A.chooseNoEquipment();
    const g = Object.keys(S().gyms)[0];
    A.deleteGym(g);
    expect(S().device.currentGymId).toBe(NO_EQUIPMENT_GYM_ID);
  });
});

describe('a session at home', () => {
  test('is recorded as "No equipment", runs through every exercise, counts for streak, rotation and history', () => {
    onboard();
    A.chooseNoEquipment();
    A.prepareDraft(true);
    const slot = S().device.draft!.slot;
    const s = startLive();
    expect(s).toMatchObject({ gymId: NO_EQUIPMENT_GYM_ID, gymName: NO_EQUIPMENT_NAME, slot });
    expect(s.warmupItems![0].name).toBe('Brisk walk or jumping jacks');
    for (let g = 0; g < 30 && active() && active()!.phase !== 'done'; g++) {
      const a = active()!;
      if (a.phase === 'set') doAllSets(0, 10);
      else if (a.phase === 'rest') A.endRest();
      if (active()!.phase === 'fb') { tick(); A.saveFeedback(FB); }
    }
    tick();
    const id = A.finishSession('home')!;
    const done = S().sessions[id];
    expect(done).toMatchObject({ status: 'completed', gymId: NO_EQUIPMENT_GYM_ID, gymName: NO_EQUIPMENT_NAME });
    expect(done.exercises.every((e) => e.status === 'done' && e.sets.length > 0 && e.recommendation)).toBe(true);
    expect(S().progress[done.exercises[0].exerciseId]).toBeDefined();
    expect(Object.keys(S().gyms).every((k) => S().gyms[k].lastVisitedAt === undefined)).toBe(true); // no real gym "visited"
    expect(S().device.draft).toBeNull();
    const view = computeStreak(Object.values(S().sessions), S().settings, Date.now());
    expect(view.currentWeek.done).toBe(1);
    A.prepareDraft(true);
    expect(S().device.draft!.slot).toBe(slot === S().settings.rotation.length ? 1 : slot + 1); // rotation advanced as normal
    expect(invariants()).toEqual([]);
  });
  test('swap during the session offers bodyweight alternatives; nothing throws on "equipment gone"', async () => {
    onboard();
    A.chooseNoEquipment(); A.prepareDraft(true);
    startLive();
    const { swapAlternatives } = await import('./x-live');
    const alts = swapAlternatives(active()!, ex()!);
    expect(alts.every((a) => isBodyweight(a.exercise.id))).toBe(true);
    if (alts[0]) { A.swapCurrent('gone', alts[0].exercise.id); expect(ex().exerciseId).toBe(alts[0].exercise.id); }
    expect(invariants()).toEqual([]);
  });
  test('progress "by gym" aggregation and gym-hopper badge cope with the pseudo location', () => {
    onboard();
    A.chooseNoEquipment(); A.prepareDraft(true); startLive();
    for (let g = 0; g < 30 && active() && active()!.phase !== 'done'; g++) {
      const a = active()!;
      if (a.phase === 'set') doAllSets(0, 10); else if (a.phase === 'rest') A.endRest();
      if (active()!.phase === 'fb') { tick(); A.saveFeedback(FB); }
    }
    tick(); A.finishSession();
    expect(gymShares(Object.values(S().sessions))).toEqual([{ name: NO_EQUIPMENT_NAME, n: 1, pct: 100 }]);
  });
  test('the home session syncs like any other (gymId none), survives a reload round trip', () => {
    onboard();
    A.chooseNoEquipment(); A.prepareDraft(true);
    const s = startLive();
    expect(queued('session', s.id)?.data).toMatchObject({ gymId: 'none', gymName: 'No equipment' });
  });
});

describe('bodyweight progression across sessions', () => {
  test('reps climb to the ceiling, then tempo, then the harder variation is planned', () => {
    onboard({ areaNames: ['Push'] });
    // run one exercise through the progression rules with synthetic "hit every set at the ceiling" feedback
    A.setPref('wall_pushup', { relevance: 100 });
    const area = Object.values(S().areas).find((a) => a.name === 'Push')!;
    A.saveArea({ ...area, poolExerciseIds: ['wall_pushup', 'chair_dips', 'pike_pushup', 'plank_tap', 'diamond_pushup'], pinnedExerciseIds: [], mode: 'auto', exercisesPerSession: 5 });
    mutate((st) => putEntity(st, 'progress', 'wall_pushup', { exerciseId: 'wall_pushup', weight: 0, reps: 24, sets: 3 })); // one rep below the ceiling
    A.chooseNoEquipment();
    const kinds: string[] = [];
    let weeks = 0;
    for (let i = 0; i < 20; i++) {
      setClock(T0 + (weeks++) * 3 * DAY);
      A.prepareDraft(true);
      const d = S().device.draft!;
      if (!d.exercises.some((e) => e.exerciseId === 'wall_pushup' || e.exerciseId === 'pushup')) break;
      startLive();
      for (let g = 0; g < 40 && active() && active()!.phase !== 'done'; g++) {
        const a = active()!;
        if (a.phase === 'set') { const e = ex(); for (let k = 0; k < 10 && active()!.phase === 'set'; k++) { tick(30_000); A.logSet(0, e.exerciseId === 'wall_pushup' ? 25 : e.repMax); if (active()!.phase === 'rest') { tick(60_000); A.endRest(); } } }
        else if (a.phase === 'rest') A.endRest();
        if (active()!.phase === 'fb') { tick(); A.saveFeedback(FB); }
      }
      tick();
      const id = A.finishSession()!;
      const rec = S().sessions[id].exercises.find((e) => e.exerciseId === 'wall_pushup')?.recommendation;
      if (rec) kinds.push(rec.kind);
      if (rec?.kind === 'tempo') mutate((st) => putEntity(st, 'progress', 'wall_pushup', { ...st.progress.wall_pushup, reps: 24 })); // skip ahead: tempo reps climb back to the ceiling
      if (rec?.kind === 'harder') break;
    }
    expect(kinds.slice(0, 2)).toEqual(['rep_up', 'tempo']);
    expect(S().progress.wall_pushup.tempo).toBeUndefined(); // cleared when it graduated
    expect(kinds).toContain('harder');
    expect(S().progress.wall_pushup.lastRec?.harderId).toBe('pushup');
    A.prepareDraft(true);
    expect(S().device.draft!.exercises.map((e) => e.exerciseId)).not.toContain('wall_pushup');
  });
});
