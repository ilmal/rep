// Live-session extensions (own file; shared stores/rules are untouched).
// The shared Session.phase has no "up next" state, so it is derived: phase 'set' + no sets logged + no `begunAt` on the exercise.
// `begunAt` / `lighterAt` are extra fields stored on the SessionExercise (the sync layer keeps session JSON as-is).
import { useSyncExternalStore } from 'react';
import { blockedIds } from '../../shared/planner';
import { resolveGym } from '../../shared/location';
import {
  autoAdjust, availableEquipment, estimateExerciseSec, exerciseHistory, isPR, rankAlternatives, swapPrescription, toSessionExercise, volumeOf,
  type Alternative,
} from '../../shared/rules';
import type { Exercise, Feedback, Session, SessionExercise, Unit } from '../../shared/types';
import { fromDisplay, toDisplay } from '../lib/format';
import { banExercise, libraryOf, pauseExercise, sessionsList, skipCurrent, swapCurrent } from './actions';
import { getState, logEvent, mutate, now, persistNow, putEntity, uid, type State } from './core';

export type LiveEx = SessionExercise & { begunAt?: number; lighterAt?: number };
export type SwapReason = 'busy' | 'gone' | 'nope' | 'pain';
export type NopeFor = 'today' | '2w' | 'never';
export const PAUSE_2W_DAYS = 14;

const active = (s: State) => Object.values(s.sessions).find((x) => x.status === 'active');
function patchActive(fn: (x: Session, s: State) => Session, event?: [string, unknown?]) {
  mutate((s) => {
    const a = active(s);
    if (!a) return;
    putEntity(s, 'session', a.id, fn(a, s));
    if (event) logEvent(s, event[0], a.id, event[1]);
  });
  void persistNow();
}

/** Up-next screen: the exercise is active, nothing logged and the athlete has not pressed Start yet. */
export const isIntro = (session: Session, ex: SessionExercise | undefined) =>
  !!ex && session.phase === 'set' && ex.sets.length === 0 && !(ex as LiveEx).begunAt;

export function beginExercise() {
  patchActive((x) => ({ ...x, exercises: x.exercises.map((e, i) => (i === x.cursor && !(e as LiveEx).begunAt ? { ...e, begunAt: now() } as LiveEx : e)) }));
}

/** Append a line to the session note (never overwrite: Summary edits the same note). */
function addNote(a: Session, line: string): Session {
  return { ...a, note: a.note ? `${a.note}\n${line}` : line };
}
const noteLine = (kind: string, name: string) => `${new Date(now()).toTimeString().slice(0, 5)} ${name}: ${kind}`;

// ───────────────────────── set inputs (kg), device-local draft so a reload restores the steppers ─────────────────────────
export interface SetDraft { key: string; w: number; r: number }
const LS_DRAFT = 'rep-live-draft';
let draft: SetDraft | null = (() => { try { const raw = localStorage.getItem(LS_DRAFT); return raw ? (JSON.parse(raw) as SetDraft) : null; } catch { return null; } })();
const dl = new Set<() => void>();
export const draftKey = (sessionId: string, ex: SessionExercise, n = ex.sets.length) => `${sessionId}:${ex.id}:${n}`;
export function putDraft(d: SetDraft) {
  draft = d;
  try { localStorage.setItem(LS_DRAFT, JSON.stringify(d)); } catch { /* private mode */ }
  for (const l of dl) l();
}
export const useDraft = (): SetDraft | null => useSyncExternalStore((l) => { dl.add(l); return () => { dl.delete(l); }; }, () => draft, () => draft);

// feedback ratings in progress (device-local, survives a reload)
export type FbDraft = { effort: Feedback['effort']; weight: Feedback['weight'] | null; volume: Feedback['volume'] };
const LS_FB = 'rep-live-fb';
let fbd: { key: string; fb: FbDraft } | null = (() => { try { const raw = localStorage.getItem(LS_FB); return raw ? JSON.parse(raw) : null; } catch { return null; } })();
const fl = new Set<() => void>();
export const fbKey = (sessionId: string, ex: SessionExercise) => `${sessionId}:${ex.id}`;
export function putFbDraft(key: string, fb: FbDraft) {
  fbd = { key, fb };
  try { localStorage.setItem(LS_FB, JSON.stringify(fbd)); } catch { /* private mode */ }
  for (const l of fl) l();
}
export const useFbDraft = (key: string): FbDraft => {
  const d = useSyncExternalStore((l) => { fl.add(l); return () => { fl.delete(l); }; }, () => fbd, () => fbd);
  return d && d.key === key ? d.fb : FEEDBACK_NONE;
};

/** Weight / reps to prefill: last logged set's weight (unless "go lighter" lowered it since), else the planned weight. */
export function defaultsFor(ex: SessionExercise) {
  const e = ex as LiveEx;
  const last = ex.sets[ex.sets.length - 1];
  const useLast = !!last && (e.lighterAt == null || ex.sets.length > e.lighterAt);
  return { w: useLast ? last.weight : ex.plannedWeight, r: ex.repTarget };
}

/** One tap on the weight stepper, in display units so lb users step in plates (5 lb), not 5.5. */
export function stepWeight(kg: number, dir: 1 | -1, stepKg: number, unit: Unit): number {
  if (unit === 'kg') return Math.max(0, Math.round((kg + dir * stepKg) * 100) / 100);
  const lbStep = Math.max(2.5, Math.round((stepKg / 0.45359237) / 2.5) * 2.5);
  return Math.max(0, fromDisplay(toDisplay(kg, 'lb') + dir * lbStep, 'lb'));
}

// ───────────────────────── first time / last time ─────────────────────────
export function isFirstTime(ex: SessionExercise): boolean {
  const s = getState();
  return !s.progress[ex.exerciseId] && exerciseHistory(sessionsList(s), ex.exerciseId).length === 0;
}

export interface LastTime { text: string; dir: 'up' | 'same' | 'down' }
export function lastTime(session: Session, ex: SessionExercise, unit: Unit): LastTime | null {
  const hist = exerciseHistory(sessionsList(getState()), ex.exerciseId).filter((h) => h.session.id !== session.id);
  const h = hist[hist.length - 1];
  if (!h) return null;
  const sets = h.ex.sets;
  const reps = new Set(sets.map((x) => x.reps));
  const rl = reps.size === 1 ? String(sets[0].reps) : `${Math.min(...reps)}–${Math.max(...reps)}`;
  const t = ex.tracking;
  const lastW = sets[sets.length - 1].weight;
  const load = t === 'weight_reps' && lastW ? ` @ ${toDisplay(lastW, unit)} ${unit}${ex.perHand ? ' each' : ''}` : t === 'time' ? ' s' : '';
  const felt = h.ex.feedback?.weight;
  const feltTxt = felt ? ` felt ${felt === 'light' ? 'too light' : felt === 'heavy' ? 'too heavy' : 'just right'}` : '';
  let dir: LastTime['dir'] = 'same';
  let tail = `Same weight, aim for all ${ex.repTarget}s.`;
  if (t === 'weight_reps') {
    const d = ex.plannedWeight - lastW;
    if (d > 0.001) { dir = 'up'; tail = `+${toDisplay(d, unit)} ${unit} today.`; }
    else if (d < -0.001) { dir = 'down'; tail = `−${toDisplay(-d, unit)} ${unit} today.`; }
    else if (ex.repTarget > sets[0].reps) { dir = 'up'; tail = `Same weight, +${ex.repTarget - sets[0].reps} rep${ex.repTarget - sets[0].reps === 1 ? '' : 's'} today.`; }
  } else {
    const d = ex.repTarget - sets[0].reps;
    if (d > 0) { dir = 'up'; tail = `+${d}${t === 'time' ? ' s' : ' rep' + (d === 1 ? '' : 's')} today.`; }
    else if (d < 0) { dir = 'down'; tail = `${d}${t === 'time' ? ' s' : ' reps'} today.`.replace('-', '−'); }
    else tail = `Aim for all ${ex.repTarget}${t === 'time' ? ' s' : 's'}.`;
  }
  const swapped = ex.swappedFrom ? `Swapped in for ${ex.swappedFrom.name}. ` : '';
  return { text: `${swapped}Last time ${sets.length} × ${rl}${load}${feltTxt}. ${tail}`, dir };
}

// ───────────────────────── feedback ─────────────────────────
function nextTodo(exs: SessionExercise[], from: number) {
  for (let i = from; i < exs.length; i++) if (exs[i].status === 'todo') return i;
  return -1;
}
/** "Skip feedback": the exercise counts as done but writes no recommendation, so next time keeps today's numbers. */
export function skipFeedback() {
  mutate((s) => {
    const a = active(s);
    if (!a || a.phase !== 'fb') return;
    const t = now();
    const cur = a.exercises[a.cursor];
    const pr = isPR(sessionsList(s), { ...cur, status: 'done' });
    let y: Session = { ...a, exercises: a.exercises.map((e, i) => (i === a.cursor ? { ...e, status: 'done', pr, endedAt: e.endedAt ?? t } : e)) };
    const n = nextTodo(y.exercises, y.cursor + 1);
    if (n < 0) y = { ...y, phase: 'done', restEndsAt: undefined };
    else {
      y = { ...y, cursor: n, phase: 'set', restEndsAt: undefined, exercises: y.exercises.map((e, k) => (k === n ? { ...e, status: 'active', startedAt: t } : e)) };
      if (s.settings.fitToTime) {
        const r = autoAdjust({ now: t, sessionStartedAt: y.startedAt, targetMin: y.targetMin, exercises: y.exercises, cursor: n, newId: uid });
        if (r.applied) y = { ...y, exercises: r.exercises, adjustments: [...y.adjustments, ...r.adjustments] };
      }
    }
    putEntity(s, 'session', a.id, y);
    logEvent(s, 'feedback_skipped', a.id, { exerciseId: cur.exerciseId });
  });
  void persistNow();
}

export const FEEDBACK_NONE: { effort: Feedback['effort']; weight: Feedback['weight'] | null; volume: Feedback['volume'] } = { effort: 'normal', weight: null, volume: 'ok' };
export const fmtTonnage = (kg: number, unit: Unit) => {
  const v = unit === 'lb' ? kg / 0.45359237 : kg;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k ${unit}` : `${Math.round(v)} ${unit}`;
};
export const tonnageOf = (e: SessionExercise) => volumeOf(e);

// ───────────────────────── It hurts ─────────────────────────
/** Lower the load 20% for the remaining sets. Weighted lifts lose weight; bodyweight / time lifts lose 20% of the rep / second target. */
export function goLighter(): { weight?: number; reps?: number } {
  let out: { weight?: number; reps?: number } = {};
  patchActive((x) => {
    const ex = x.exercises[x.cursor];
    const draftNow = draft && draft.key === draftKey(x.id, ex) ? draft : null;
    const base = draftNow ? draftNow.w : defaultsFor(ex).w;
    const step = ex.weightStep || 2.5;
    let patch: Partial<LiveEx>;
    if (ex.tracking === 'weight_reps' && base > 0) {
      const w = Math.max(0, Math.round((base * 0.8) / step) * step);
      out = { weight: w };
      patch = { plannedWeight: w, lighterAt: ex.sets.length };
    } else {
      const unit = ex.tracking === 'time' ? 5 : 1;
      const r = Math.max(unit, Math.round((ex.repTarget * 0.8) / unit) * unit);
      out = { reps: r };
      patch = { repTarget: r };
    }
    const exercises = x.exercises.map((e, i) => (i === x.cursor ? { ...e, ...patch } : e));
    return addNote({ ...x, exercises }, noteLine(out.weight != null ? 'felt off, went lighter (−20% weight)' : 'felt off, went lighter (−20% reps)', ex.name));
  }, ['pain_lighter']);
  const a = active(getState());
  if (a) {
    const ex = a.exercises[a.cursor];
    const d = defaultsFor(ex);
    putDraft({ key: draftKey(a.id, ex), w: out.weight ?? (draft && draft.key === draftKey(a.id, ex) ? draft.w : d.w), r: out.reps ?? ex.repTarget });
  }
  return out;
}

/** Skip the current exercise because it hurts; optionally pause it for 2 weeks. Appends a note to the session. */
export function painSkip(pause: boolean): number | null {
  const a = active(getState());
  if (!a) return null;
  const ex = a.exercises[a.cursor];
  patchActive((x) => addNote(x, noteLine(pause ? 'hurt, skipped and paused for 2 weeks' : 'hurt, skipped', ex.name)), ['pain_skip', { exerciseId: ex.exerciseId, pause }]);
  let until: number | null = null;
  if (pause) { pauseExercise(ex.exerciseId, { days: PAUSE_2W_DAYS }); until = now() + PAUSE_2W_DAYS * 86400000; }
  skipCurrent();
  void persistNow();
  return until;
}

// ───────────────────────── swap ─────────────────────────
function alternativesRaw(session: Session, ex: SessionExercise, limit: number): Alternative[] {
  const s = getState();
  const lib = libraryOf(s).filter((e) => !e.archived);
  const cur = lib.find((e) => e.id === ex.exerciseId);
  if (!cur) return [];
  const gym = resolveGym(s.gyms, session.gymId);
  return rankAlternatives(cur, lib, availableEquipment(gym, session.busyEquip), [...session.exercises.map((e) => e.exerciseId), ...blockedIds(s.prefs, now())], s.progress, sessionsList(s), limit);
}
/** Top 3 alternatives at the session's gym (busy equipment, paused / banned and already-planned exercises excluded). */
export const swapAlternatives = (session: Session, ex: SessionExercise, avoidEquip?: string | null): Alternative[] =>
  alternativesRaw(session, ex, 12).filter((a) => !avoidEquip || !a.exercise.equipment.includes(avoidEquip)).slice(0, 3);
/** Gentler first: same-or-easier difficulty, easiest then best match. Falls back to the normal list if nothing is gentler. */
export function gentlerAlternatives(session: Session, ex: SessionExercise): Alternative[] {
  const all = alternativesRaw(session, ex, 12);
  const cur = libraryOf(getState()).find((e) => e.id === ex.exerciseId);
  const lower = all.filter((a) => a.exercise.difficulty <= (cur?.difficulty ?? 3));
  const pool = lower.length ? lower : all;
  return [...pool].sort((p, q) => p.exercise.difficulty - q.exercise.difficulty || q.match - p.match).slice(0, 3);
}
export const prescriptionFor = (ex: SessionExercise, to: Exercise) => swapPrescription(ex, to, getState().progress);

function replaceCurrent(toId: string, reason: 'dont' | 'pain', note?: string) {
  patchActive((a, s) => {
    const from = a.exercises[a.cursor];
    const to = libraryOf(s).find((e) => e.id === toId);
    if (!from || !to) return a;
    const t = now();
    const rx = swapPrescription(from, to, s.progress);
    const fresh: SessionExercise = {
      ...toSessionExercise(to, from.order, rx, from.restSec, estimateExerciseSec(sessionsList(s), to, rx.sets, from.restSec), false, uid()),
      status: 'active', startedAt: t, swappedFrom: { exerciseId: from.exerciseId, name: from.name, reason: reason as never },
    };
    const keepOld = from.sets.length > 0;
    const exercises = [...a.exercises];
    if (keepOld) { exercises[a.cursor] = { ...from, status: 'skipped', endedAt: t }; exercises.splice(a.cursor + 1, 0, fresh); } else exercises[a.cursor] = fresh;
    const y: Session = { ...a, exercises, cursor: keepOld ? a.cursor + 1 : a.cursor, phase: 'set', restEndsAt: undefined };
    return note ? addNote(y, note) : y;
  }, ['exercise_swapped', { to: toId, reason }]);
}

/**
 * Swap the current exercise. Taken = busy this session (equipment goes in session.busyEquip), Not here = remove the equipment from the gym,
 * Don't want = write an exercise preference, no equipment change. pain = gentler alternative, no equipment change, note saved.
 */
export function swapExercise(reason: SwapReason, toId: string, nope: NopeFor = 'today') {
  const a = active(getState());
  if (!a) return;
  const from = a.exercises[a.cursor];
  if (reason === 'busy' || reason === 'gone') { swapCurrent(reason, toId); void persistNow(); return; }
  if (reason === 'nope') {
    if (nope === 'never') banExercise(from.exerciseId, true);
    else if (nope === 'today') pauseExercise(from.exerciseId, { sessions: 1 }); // blocked now, counts down when this session completes
    else pauseExercise(from.exerciseId, { days: PAUSE_2W_DAYS });
    replaceCurrent(toId, 'dont');
    return;
  }
  const to = libraryOf(getState()).find((e) => e.id === toId);
  replaceCurrent(toId, 'pain', noteLine(`hurt, swapped to ${to?.name ?? 'a gentler exercise'}`, from.name));
}
