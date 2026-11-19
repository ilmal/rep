// Today-screen helpers that need store internals the shared actions do not export.
//  - startExpress(): the streak-risk "30-min express". There is no one-off target override in the pre-session flow
//    (draftSetTarget only edits the number, it does not re-plan), so this builds the draft exactly like prepareDraft()
//    does (same inputs, same coach-plan rule) but with a 30 min budget. generateSession does not shrink a plan to the target
//    (only the live auto-adjust does), so the express plan drops the last (lowest-priority) exercises until warm-up + sets fit
//    30 min, never below one exercise; a queued coach plan is left as written. PreSession/beginSession then honour
//    draft.targetMin everywhere (budget bar, auto-adjust, live top bar), so nothing downstream needs to change.
//  - clearExpressDraft(): an express draft is a one-off; Today drops it when it is shown again so "Start session n"
//    never silently stays a 30-minute plan after the user backed out of the preview.
import { getState, mutate, now, uid, type Draft } from './core';
import { areaForSlot, effectiveSlot, libraryOf, prepareDraft, sessionsList } from './actions';
import { generateSession, pickCoachPlan } from '../../shared/planner';
import { totalPlannedSec } from '../../shared/rules';
import { resolveGym } from '../../shared/location';

export const EXPRESS_MIN = 30;
let expressStamp = 0;

export function startExpress(): boolean {
  let ok = false;
  mutate((s) => {
    const slot = effectiveSlot(s);
    const area = areaForSlot(s, slot);
    if (!area) return;
    const gym = resolveGym(s.gyms, s.device.currentGymId);
    const plan = pickCoachPlan(Object.values(s.plans), slot, area.id);
    const r = generateSession({
      area, gym, library: libraryOf(s).filter((e) => !e.archived), prefs: s.prefs, progress: s.progress, sessions: sessionsList(s), planner: s.settings.planner,
      restSec: s.settings.restSec, targetMin: EXPRESS_MIN, warmupMin: s.settings.warmupTargetMinutes, now: now(), variant: 0, coachPlan: plan, autoSwap: s.settings.suggestSwaps, slot, newId: uid,
    });
    let exercises = r.exercises;
    if (r.source !== 'coach') {
      while (exercises.length > 1 && totalPlannedSec(exercises, s.settings.warmupTargetMinutes) > EXPRESS_MIN * 60) exercises = exercises.slice(0, -1);
    }
    const createdAt = now();
    expressStamp = createdAt;
    const draft = {
      slot, areaId: area.id, gymId: gym?.id ?? null, variant: 0, targetMin: EXPRESS_MIN, exercises, hiddenNames: r.hiddenNames,
      createdAt, source: r.source, coachPlanId: r.coachPlanId, coachNote: r.coachNote,
    } as Draft;
    s.device = { ...s.device, draft };
    ok = true;
  });
  return ok;
}

/** If the current draft is a leftover express draft, rebuild it at the normal target. */
export function clearExpressDraft() {
  const d = getState().device.draft;
  if (d && expressStamp && d.createdAt === expressStamp) { expressStamp = 0; prepareDraft(true); }
}
