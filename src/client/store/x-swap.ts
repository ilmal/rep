// Swap-screen extensions (own file; shared stores/rules are untouched).
import { blockedIds } from '../../shared/planner';
import { resolveGym } from '../../shared/location';
import { availableEquipment, estimateExerciseSec, isAvailable, rankAlternatives, swapPrescription, toSessionExercise, type Alternative } from '../../shared/rules';
import type { Exercise, Session, SessionExercise } from '../../shared/types';
import { banExercise, libraryOf, limitingEquipment, pauseExercise, sessionsList, setEquipStatus, swapCurrent } from './actions';
import { getState, logEvent, mutate, now, putEntity, uid } from './core';

export type Reason = 'busy' | 'broken' | 'gone' | 'dont';
export type DontFor = 'today' | '2w' | 'never';
export const DONT_OPTIONS: { key: DontFor; label: string; word: string }[] = [
  { key: 'today', label: 'Today', word: 'paused for today' },
  { key: '2w', label: '2 weeks', word: 'paused for 2 weeks' },
  { key: 'never', label: 'Never', word: 'banned, never planned again' },
];

// Same formula as rankAlternatives (shared/rules.ts) but with a caller-chosen floor, so the
// "below the usual 35%" fallback can be offered without touching the shared file.
const overlap = (a: string[], b: string[]) => { if (!a.length) return 0; const s = new Set(b); return a.filter((x) => s.has(x)).length / a.length; };
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
};
export function rankWithFloor(
  current: Exercise, library: Exercise[], avail: Set<string>, excludeIds: string[], progress: Parameters<typeof rankAlternatives>[4] = {},
  opts: { floor?: number; below?: number; limit?: number } = {},
): Alternative[] {
  const { floor = 35, below = Infinity, limit = 4 } = opts;
  const ex = new Set(excludeIds);
  const out: Alternative[] = [];
  for (const c of library) {
    if (c.id === current.id || ex.has(c.id) || c.archived || !isAvailable(c, avail)) continue;
    if (overlap(current.primary, c.primary) === 0) continue;
    const score = 0.45 * jaccard(current.primary, c.primary) + 0.25 * (c.pattern === current.pattern ? 1 : 0) + 0.15 * jaccard(current.secondary, c.secondary)
      + 0.1 * (1 - Math.abs(current.difficulty - c.difficulty) / 2) + 0.05 * (progress[c.id] ? 1 : 0);
    out.push({ exercise: c, score, match: Math.round(score * 100) });
  }
  return out.filter((a) => a.match >= floor && a.match < below).sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name)).slice(0, limit);
}

function context(session: Session, exerciseId: string) {
  const s = getState();
  const lib = libraryOf(s).filter((e) => !e.archived);
  const cur = lib.find((e) => e.id === exerciseId);
  const gym = resolveGym(s.gyms, session.gymId);
  return { s, lib, cur, avail: availableEquipment(gym, session.busyEquip), blocked: blockedIds(s.prefs, now()) };
}

/** Top alternatives at the session's gym: available equipment only, paused/banned and already-planned exercises excluded. */
export function swapAlternatives(session: Session, exerciseId: string): Alternative[] {
  const { s, lib, cur, avail, blocked } = context(session, exerciseId);
  if (!cur) return [];
  return rankAlternatives(cur, lib, avail, [...session.exercises.map((e) => e.exerciseId), ...blocked], s.progress, sessionsList(s));
}

/** Best option under the 35% floor (shown on the "No good swap" sheet). */
export function lowerMatchAlternative(session: Session, exerciseId: string): Alternative | null {
  const { s, lib, cur, avail, blocked } = context(session, exerciseId);
  if (!cur) return null;
  return rankWithFloor(cur, lib, avail, [...session.exercises.map((e) => e.exerciseId), ...blocked], s.progress, { floor: 1, below: 35, limit: 1 })[0] ?? null;
}

/** Write the "Don't want" preference for the exercise being swapped out. */
export function applyDontWant(exerciseId: string, how: DontFor) {
  if (how === 'never') banExercise(exerciseId, true);
  else if (how === 'today') pauseExercise(exerciseId, { sessions: 1 }); // counts down when this session completes
  else pauseExercise(exerciseId, { days: 14 });
}

/** Swap the current exercise. busy/broken/gone mark equipment (shared action); dont writes a preference and touches no equipment. */
export function swapWithReason(reason: Reason, newExerciseId: string, dontFor: DontFor = 'today') {
  const sess = Object.values(getState().sessions).find((x) => x.status === 'active');
  if (!sess) return;
  const fromId = sess.exercises[sess.cursor]?.exerciseId;
  if (reason !== 'dont') { swapCurrent(reason, newExerciseId); return; }
  if (fromId) applyDontWant(fromId, dontFor);
  mutate((s) => {
    const a = Object.values(s.sessions).find((x) => x.status === 'active');
    if (!a) return;
    const from = a.exercises[a.cursor];
    const to = libraryOf(s).find((e) => e.id === newExerciseId);
    if (!from || !to) return;
    const t = now();
    const rx = swapPrescription(from, to, s.progress);
    const fresh: SessionExercise = {
      ...toSessionExercise(to, from.order, rx, from.restSec, estimateExerciseSec(sessionsList(s), to, rx.sets, from.restSec), false, uid()),
      status: 'active', startedAt: t, swappedFrom: { exerciseId: from.exerciseId, name: from.name, reason: 'dont' as never },
    };
    const keepOld = from.sets.length > 0;
    const exercises = [...a.exercises];
    if (keepOld) { exercises[a.cursor] = { ...from, status: 'skipped', endedAt: t }; exercises.splice(a.cursor + 1, 0, fresh); } else exercises[a.cursor] = fresh;
    putEntity(s, 'session', a.id, { ...a, exercises, cursor: keepOld ? a.cursor + 1 : a.cursor, phase: 'set', restEndsAt: undefined });
    logEvent(s, 'exercise_swapped', a.id, { from: from.exerciseId, to: newExerciseId, reason: 'dont', dontFor });
  });
}

/** "I do have it": put the equipment back in the gym inventory and clear this session's busy flag. */
export function restoreEquipment(session: Session, equipId: string) {
  if (session.gymId) setEquipStatus(session.gymId, equipId, 'ok');
  mutate((s) => {
    const a = s.sessions[session.id];
    if (a && a.busyEquip.includes(equipId)) putEntity(s, 'session', a.id, { ...a, busyEquip: a.busyEquip.filter((q) => q !== equipId) });
  });
}

export { limitingEquipment };
