// Domain actions. Every mutation goes through mutate()/putEntity so it is persisted and queued for sync.
import { useMemo } from 'react';
import {
  type Draft, type State, getState, logEvent, mutate, now, putEntity, setState, uid, useStore,
} from './core';
import { areaFromTemplate, AREA_TEMPLATES, DEFAULT_ROTATION_NAMES, mergeLibrary } from '../../shared/exercises';
import { EQUIP_BY_ID, templateEquipment, type GymTemplate } from '../../shared/catalog';
import { DEFAULT_PREF, PAUSE_FOREVER, blockedIds, generateSession, isPaused, pickCoachPlan, prefOf, statusOf } from '../../shared/planner';
import {
  autoAdjust, availableEquipment, completed, isPR, matchGyms, nextSeq, nextSlot, rankAlternatives, recommend, swapPrescription,
  toSessionExercise, undoAdjustment as undoAdj, estimateExerciseSec, warmupMedianSec, weekCount, prescriptionFor, type BodyweightState,
} from '../../shared/rules';
import { applyGoalChange, goalForWeek } from '../../shared/streak';
import { NO_EQUIPMENT_GYM_ID, isNoEquipment, resolveGym } from '../../shared/location';
import type {
  Area, Exercise, ExercisePref, Feedback, Gym, Session, SessionExercise, Settings, EquipStatus, Muscle, PlannerConfig,
} from '../../shared/types';

// ───────────────────────── selectors / hooks ─────────────────────────
export const useSettings = () => useStore((s) => s.settings);
export const useLibrary = (): Exercise[] => {
  const custom = useStore((s) => s.exercises);
  return useMemo(() => mergeLibrary(Object.values(custom)).filter((e) => !e.archived), [custom]);
};
export const useAllLibrary = (): Exercise[] => {
  const custom = useStore((s) => s.exercises);
  return useMemo(() => mergeLibrary(Object.values(custom)), [custom]);
};
export const libraryOf = (s: State = getState()): Exercise[] => mergeLibrary(Object.values(s.exercises));
export const sessionsList = (s: State = getState()): Session[] => Object.values(s.sessions);
export function useSessions(): Session[] {
  const m = useStore((s) => s.sessions);
  return useMemo(() => Object.values(m), [m]);
}
export function useGyms(): Gym[] {
  const m = useStore((s) => s.gyms);
  return useMemo(() => Object.values(m).filter((g) => !g.deleted).sort((a, b) => a.createdAt - b.createdAt), [m]);
}
export function useAreas(): Area[] {
  const m = useStore((s) => s.areas);
  return useMemo(() => Object.values(m), [m]);
}
export function useRotation(): Area[] {
  const areas = useStore((s) => s.areas);
  const rot = useStore((s) => s.settings.rotation);
  return useMemo(() => rot.map((id) => areas[id]).filter(Boolean), [areas, rot]);
}
export function useActiveSession(): Session | undefined {
  const m = useStore((s) => s.sessions);
  return useMemo(() => Object.values(m).find((x) => x.status === 'active'), [m]);
}
export const getActiveSession = (): Session | undefined => Object.values(getState().sessions).find((s) => s.status === 'active');
export function useCurrentGym(): Gym | null {
  const gyms = useStore((s) => s.gyms);
  const id = useStore((s) => s.device.currentGymId);
  return (id && gyms[id] && !gyms[id].deleted ? gyms[id] : null);
}
/** True while the built-in "At home · no equipment" location is the current one. */
export const useAtHome = (): boolean => useStore((s) => isNoEquipment(s.device.currentGymId));
export function usePrefs() { return useStore((s) => s.prefs); }
export function useDraft(): Draft | null { return useStore((s) => s.device.draft); }
export function useWeek() {
  const sessions = useSessions();
  const settings = useStore((s) => s.settings);
  const goal = goalForWeek(settings, now()); // the goal IN FORCE this week (a change applies from next Monday)
  const rot = useStore((s) => s.settings.rotation.length);
  return { count: weekCount(sessions, now()), goal, next: nextSlot(sessions, rot || 1), rotationSize: rot };
}

// ───────────────────────── settings ─────────────────────────
/** Settings keys that change what generateSession() would produce: a draft built before the change is stale. */
const PLANNING_KEYS: (keyof Settings)[] = ['rotation', 'planner', 'restSec', 'targetMinutes', 'warmupTargetMinutes', 'suggestSwaps'];
export function updateSettings(patch: Partial<Settings>) {
  mutate((s) => {
    // A weekly-goal change applies from NEXT Monday (streak rules): record it in goalHistory. Immediate for someone who has never trained.
    if (typeof patch.weeklyGoal === 'number' && patch.weeklyGoal !== s.settings.weeklyGoal && !('goalHistory' in patch)) {
      patch = { ...patch, ...applyGoalChange(s.settings, patch.weeklyGoal, now(), { immediate: !s.settings.onboarded || completed(Object.values(s.sessions)).length === 0 }) };
    }
    putEntity(s, 'settings', 'settings', { ...s.settings, ...patch });
    if (PLANNING_KEYS.some((k) => k in patch)) s.device = { ...s.device, draft: null };
  });
}
export function updatePlanner(patch: Partial<PlannerConfig>) {
  mutate((s) => { putEntity(s, 'settings', 'settings', { ...s.settings, planner: { ...s.settings.planner, ...patch } }); s.device = { ...s.device, draft: null }; });
}

// ───────────────────────── onboarding ─────────────────────────
export interface OnboardInput {
  name?: string;
  goal: number;
  targetMinutes: number;
  warmupMinutes: number;
  gyms: { name: string; template: GymTemplate; lat?: number | null; lng?: number | null; radiusM?: number }[];
  areaNames: string[];
}

export function completeOnboarding(inp: OnboardInput) {
  mutate((s) => {
    const rotation: string[] = [];
    const names = inp.areaNames.length ? inp.areaNames : DEFAULT_ROTATION_NAMES;
    for (const n of names) {
      const t = AREA_TEMPLATES.find((x) => x.name === n) ?? AREA_TEMPLATES[0];
      const a = areaFromTemplate(t, uid());
      putEntity(s, 'area', a.id, a);
      rotation.push(a.id);
    }
    let firstGym: string | null = null;
    for (const g of inp.gyms) {
      const gym: Gym = { id: uid(), name: g.name || 'My gym', lat: g.lat ?? null, lng: g.lng ?? null, radiusM: g.radiusM ?? 150, equipment: templateEquipment(g.template), notes: {}, brokenSince: {}, createdAt: now() };
      putEntity(s, 'gym', gym.id, gym);
      firstGym ??= gym.id;
    }
    putEntity(s, 'settings', 'settings', {
      ...s.settings, name: inp.name ?? s.settings.name, weeklyGoal: inp.goal, targetMinutes: inp.targetMinutes, warmupTargetMinutes: inp.warmupMinutes, rotation, onboarded: true,
    });
    s.device = { ...s.device, currentGymId: firstGym, gymSource: firstGym ? 'last' : 'none' };
    logEvent(s, 'onboarded', undefined, { gyms: inp.gyms.length, areas: rotation.length });
  });
}

// ───────────────────────── gyms ─────────────────────────
export function addGym(g: { name: string; template: GymTemplate; lat?: number | null; lng?: number | null; radiusM?: number }): string {
  const id = uid();
  mutate((s) => {
    const gym: Gym = { id, name: g.name.trim(), lat: g.lat ?? null, lng: g.lng ?? null, radiusM: g.radiusM ?? 150, equipment: templateEquipment(g.template), notes: {}, brokenSince: {}, createdAt: now() };
    putEntity(s, 'gym', id, gym);
    if (!s.device.currentGymId) s.device = { ...s.device, currentGymId: id, gymSource: 'manual' };
  });
  return id;
}
export function updateGym(id: string, patch: Partial<Gym>) {
  mutate((s) => {
    const g = s.gyms[id];
    if (!g) return;
    putEntity(s, 'gym', id, { ...g, ...patch });
    if ('equipment' in patch && s.device.draft?.gymId === id) s.device = { ...s.device, draft: null }; // inventory changed
  });
}
export function deleteGym(id: string) {
  mutate((s) => {
    const g = s.gyms[id];
    if (g) putEntity(s, 'gym', id, { ...g, deleted: true });
    if (s.device.currentGymId === id) s.device = { ...s.device, currentGymId: null, gymSource: 'none', draft: null };
  });
}
export function setEquipStatus(gymId: string, equipId: string, status: EquipStatus) {
  mutate((s) => {
    const g = s.gyms[gymId];
    if (!g || !EQUIP_BY_ID[equipId]) return;
    const equipment = { ...g.equipment };
    const brokenSince = { ...g.brokenSince };
    if (status === 'none') delete equipment[equipId]; else equipment[equipId] = status;
    if (status === 'broken') brokenSince[equipId] = g.equipment[equipId] === 'broken' && g.brokenSince[equipId] ? g.brokenSince[equipId] : now(); else delete brokenSince[equipId]; // re-marking keeps the original 'since'
    putEntity(s, 'gym', gymId, { ...g, equipment, brokenSince });
    logEvent(s, 'equipment_marked', undefined, { gymId, equipId, status });
    if (s.device.draft?.gymId === gymId) s.device = { ...s.device, draft: null }; // regenerate against new inventory
  });
}

// ───────────────────────── areas / rotation / exercises ─────────────────────────
export function saveArea(a: Area) { mutate((s) => { putEntity(s, 'area', a.id, a); s.device = { ...s.device, draft: null }; }); }
export function newAreaId() { return uid(); }
export function deleteArea(id: string) {
  mutate((s) => {
    if (!s.areas[id]) return;
    putEntity(s, 'area', id, s.areas[id], true);
    putEntity(s, 'settings', 'settings', { ...s.settings, rotation: s.settings.rotation.filter((r) => r !== id) });
    s.device = { ...s.device, draft: null };
  });
}
export function setRotation(ids: string[]) {
  mutate((s) => { putEntity(s, 'settings', 'settings', { ...s.settings, rotation: ids.filter((id) => !!s.areas[id]) }); s.device = { ...s.device, draft: null }; });
}
export function saveExercise(e: Exercise): string {
  const id = e.id || uid();
  mutate((s) => { putEntity(s, 'exercise', id, { ...e, id, isCustom: e.isCustom ?? true }); if (s.exercises[id] && s.device.draft) s.device = { ...s.device, draft: null }; });
  return id;
}
export function archiveExercise(id: string, archived = true) {
  mutate((s) => {
    const cur = libraryOf(s).find((e) => e.id === id);
    if (cur) putEntity(s, 'exercise', id, { ...cur, archived });
    if (cur && archived) s.device = { ...s.device, draft: null }; // an archived exercise must not be startable from a stale draft
  });
}
export function setPref(exerciseId: string, patch: Partial<ExercisePref>) {
  mutate((s) => {
    putEntity(s, 'pref', exerciseId, { ...prefOf(s.prefs, exerciseId), ...patch, exerciseId });
    // any planning-relevant pref change (ban, favourite, relevance, cooldowns) makes the draft stale; notes do not
    if (Object.keys(patch).some((k) => k !== 'notes')) s.device = { ...s.device, draft: null };
  });
}
export const toggleFavorite = (exerciseId: string) => setPref(exerciseId, { favorite: !prefOf(getState().prefs, exerciseId).favorite });

// ───────────────────────── gym detection ─────────────────────────
export function detectGym(): Promise<void> {
  const st = getState();
  if (!st.settings.gps) { setState((s) => { s.device = { ...s.device, geo: 'idle' }; }); return Promise.resolve(); }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setState((s) => { s.device = { ...s.device, geo: 'unavailable' }; });
    return Promise.resolve();
  }
  setState((s) => { s.device = { ...s.device, geo: 'locating' }; });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const gyms = Object.values(getState().gyms).filter((g) => !g.deleted);
        const m = matchGyms({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }, gyms);
        mutate((s) => {
          if (m[0]) {
            s.device = { ...s.device, geo: 'matched', currentGymId: m[0].gym.id, gymSource: 'gps', geoDistanceM: Math.round(m[0].distanceM), geoAccuracyM: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : undefined, draft: s.device.draft && s.device.draft.gymId !== m[0].gym.id ? null : s.device.draft };
            logEvent(s, 'gym_detected', undefined, { gymId: m[0].gym.id, distanceM: Math.round(m[0].distanceM) });
          } else {
            s.device = { ...s.device, geo: 'nomatch', currentPos: { lat: p.coords.latitude, lng: p.coords.longitude } } as typeof s.device;
            logEvent(s, 'gym_unknown_location');
          }
        });
        resolve();
      },
      (err) => {
        setState((s) => { s.device = { ...s.device, geo: err.code === 1 ? 'denied' : 'unavailable' }; });
        resolve();
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60_000 },
    );
  });
}

/** One-shot position (for "Use my location" in Add gym / onboarding). */
export function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 10000 });
  });
}

export function chooseGym(id: string) {
  mutate((s) => {
    // remember the real gym we came from so "Switch to gym" can return to it
    const from = s.device.currentGymId;
    const homeReturn = isNoEquipment(id) && !isNoEquipment(from) ? { gymId: from, source: s.device.gymSource } : isNoEquipment(id) ? s.device.homeReturn : undefined;
    s.device = { ...s.device, currentGymId: id, gymSource: 'manual', homeReturn, draft: s.device.draft && s.device.draft.gymId !== id ? null : s.device.draft };
  });
}
/** Pick the built-in "At home · no equipment" location (always available; plans use bodyweight versions). */
export const chooseNoEquipment = () => chooseGym(NO_EQUIPMENT_GYM_ID);
/** Back from "At home" to the gym we were at (else the first saved gym, else none). */
export function leaveNoEquipment() {
  mutate((s) => {
    if (!isNoEquipment(s.device.currentGymId)) return;
    const r = s.device.homeReturn;
    const back = r?.gymId && s.gyms[r.gymId] && !s.gyms[r.gymId].deleted ? r.gymId : Object.values(s.gyms).filter((g) => !g.deleted).sort((a, b) => a.createdAt - b.createdAt)[0]?.id ?? null;
    s.device = { ...s.device, currentGymId: back, gymSource: back ? (back === r?.gymId ? r.source : 'last') : 'none', homeReturn: undefined, draft: null };
  });
}
/** Today card / PreSession toggle between the gym and the built-in no-equipment location. */
export function toggleNoEquipment() { if (isNoEquipment(getState().device.currentGymId)) leaveNoEquipment(); else chooseNoEquipment(); }

// ───────────────────────── planning (draft) ─────────────────────────
export function areaForSlot(s: State, slot: number): Area | undefined {
  const id = s.settings.rotation[slot - 1];
  return id ? s.areas[id] : undefined;
}
export const pointerSlot = (s: State = getState()) => nextSlot(sessionsList(s), s.settings.rotation.length || 1);
export const effectiveSlot = (s: State = getState()) => {
  const c = s.device.chosenSlot;
  return c != null && Number.isInteger(c) && c >= 1 && c <= (s.settings.rotation.length || 1) ? c : pointerSlot(s);
};

function buildDraft(s: State, slot: number, variant: number, keepTarget?: number, atGymId: string | null = s.device.currentGymId): Draft | null {
  const area = areaForSlot(s, slot);
  if (!area) return null;
  const gym = resolveGym(s.gyms, atGymId);
  const plan = pickCoachPlan(Object.values(s.plans), slot, area.id);
  const r = generateSession({
    area, gym, library: libraryOf(s).filter((e) => !e.archived), prefs: s.prefs, progress: s.progress, sessions: sessionsList(s), planner: s.settings.planner,
    restSec: s.settings.restSec, targetMin: keepTarget ?? s.settings.targetMinutes, warmupMin: s.settings.warmupTargetMinutes, now: now(), variant, coachPlan: variant === 0 ? plan : null, autoSwap: s.settings.suggestSwaps, slot, newId: uid,
  });
  return {
    slot, areaId: area.id, gymId: gym?.id ?? null, variant, targetMin: keepTarget ?? s.settings.targetMinutes, exercises: r.exercises, hiddenNames: r.hiddenNames,
    createdAt: now(), source: r.source, coachPlanId: r.coachPlanId, coachNote: r.coachNote,
  } as Draft;
}

/** The plan the planner WOULD build at `gymId` (or the built-in 'none') right now: a dry run for the gym picker's swap impact. Nothing is stored. */
export function previewDraftAt(gymId: string): Draft | null {
  const s = getState();
  return buildDraft(s, effectiveSlot(s), 0, s.device.draft?.targetMin, gymId);
}

/** Make sure a draft exists for the chosen slot + gym. */
export function prepareDraft(force = false) {
  mutate((s) => {
    const slot = effectiveSlot(s);
    const d = s.device.draft;
    const stale = !d || force || d.slot !== slot || d.gymId !== (s.device.currentGymId ?? null) || now() - d.createdAt > 6 * 3600_000;
    if (stale) s.device = { ...s.device, draft: buildDraft(s, slot, 0) };
  });
}
export function chooseSlot(slot: number | null) {
  mutate((s) => {
    const ok = slot == null || (Number.isInteger(slot) && slot >= 1 && slot <= (s.settings.rotation.length || 1));
    s.device = { ...s.device, chosenSlot: !ok || slot === pointerSlot(s) ? null : slot, draft: null };
  });
}
export function newMix() {
  mutate((s) => {
    const d = s.device.draft;
    if (d) s.device = { ...s.device, draft: buildDraft(s, d.slot, d.variant + 1, d.targetMin) };
  });
}
export function draftEdit(fn: (d: Draft) => Draft) {
  mutate((s) => { if (s.device.draft) s.device = { ...s.device, draft: fn(s.device.draft) }; });
}
export const draftMove = (i: number, dir: -1 | 1) => draftEdit((d) => {
  const l = [...d.exercises]; const j = i + dir;
  if (i < 0 || i >= l.length || j < 0 || j >= l.length) return d;
  [l[i], l[j]] = [l[j], l[i]];
  return { ...d, exercises: l.map((e, k) => ({ ...e, order: k })) };
});
export const draftRemove = (id: string) => draftEdit((d) => ({ ...d, exercises: d.exercises.filter((e) => e.id !== id).map((e, k) => ({ ...e, order: k })) }));
export const draftSetTarget = (min: number) => draftEdit((d) => ({ ...d, targetMin: Math.max(20, Math.min(150, min)) }));
export function draftAddExercise(exerciseId: string) {
  mutate((s) => {
    const d = s.device.draft;
    const ex = libraryOf(s).find((e) => e.id === exerciseId);
    if (!d || !ex || d.exercises.some((e) => e.exerciseId === exerciseId)) return;
    const rx = prescriptionFor(ex, s.progress);
    const est = estimateExerciseSec(sessionsList(s), ex, rx.sets, s.settings.restSec);
    s.device = { ...s.device, draft: { ...d, exercises: [...d.exercises, toSessionExercise(ex, d.exercises.length, rx, s.settings.restSec, est, false, uid())] } };
  });
}
/** Swap inside the preview (equipment busy etc. noticed before starting). */
export function draftSwap(sessionExId: string, newExerciseId: string) {
  mutate((s) => {
    const d = s.device.draft;
    const to = libraryOf(s).find((e) => e.id === newExerciseId);
    if (!d || !to) return;
    s.device = { ...s.device, draft: { ...d, exercises: d.exercises.map((e) => {
      if (e.id !== sessionExId) return e;
      const rx = swapPrescription(e, to, s.progress);
      return { ...toSessionExercise(to, e.order, rx, e.restSec, estimateExerciseSec(sessionsList(s), to, rx.sets, e.restSec), false, uid()), swappedFrom: { exerciseId: e.exerciseId, name: e.name, reason: 'busy' as const } };
    }) } };
  });
}

/** Alternatives for any exercise at the *current* gym, honouring busy equipment. */
export function alternativesFor(exerciseId: string, excludeIds: string[], busy: string[] = []) {
  const s = getState();
  const lib = libraryOf(s).filter((e) => !e.archived);
  const cur = lib.find((e) => e.id === exerciseId);
  const gym = resolveGym(s.gyms, s.device.currentGymId);
  if (!cur) return [];
  return rankAlternatives(cur, lib, availableEquipment(gym, busy), [...excludeIds, ...blockedIds(s.prefs, now())], s.progress, sessionsList(s));
}

// ───────────────────────── session lifecycle ─────────────────────────
const patchSession = (s: State, id: string, fn: (x: Session) => Session) => {
  const cur = s.sessions[id];
  if (!cur) return;
  const next = fn(cur);
  if (next !== cur) putEntity(s, 'session', id, next); // a no-op must not bump updatedAt or queue a sync
};

function warmupItemsFor(s: State, area: Area, first?: SessionExercise, gym?: Gym | null) {
  const hasBike = !!gym && gym.equipment.bike === 'ok';
  return [
    { name: hasBike ? 'Bike, easy pace' : 'Brisk walk or jumping jacks', meta: '5 min', done: false },
    { name: `Dynamic mobility: ${area.focusMuscles.slice(0, 3).join(', ').toLowerCase() || area.name.toLowerCase()}`, meta: '2 × 10 each side', done: false },
    { name: first ? `Ramp-up sets: ${first.name}` : 'Ramp-up sets', meta: '2 × 8 · light', done: false },
  ];
}

export function beginSession(): string | null {
  let id: string | null = null;
  mutate((st) => {
    const d = st.device.draft;
    if (!d || !d.exercises.length || getActiveSessionIn(st)) return;
    const area = st.areas[d.areaId];
    const gym = resolveGym(st.gyms, d.gymId);
    id = uid();
    const t = now();
    const exercises = d.exercises.map((e, i) => ({ ...e, order: i, status: 'todo' as const, sets: [] }));
    const sess: Session = {
      id, seq: nextSeq(sessionsList(st)), slot: d.slot, areaId: d.areaId, areaName: area?.name ?? 'Session', gymId: d.gymId, gymName: gym?.name ?? 'Unknown gym',
      status: 'active', startedAt: t, warmupStartedAt: t, warmupItems: warmupItemsFor(st, area, exercises[0], gym), targetMin: d.targetMin,
      warmupTargetMin: st.settings.warmupTargetMinutes, exercises, adjustments: [], busyEquip: [], cursor: 0, phase: 'warmup', updatedAt: t,
      source: (d as Draft & { source?: 'auto' | 'coach' }).source ?? 'auto', coachPlanId: (d as Draft & { coachPlanId?: string }).coachPlanId,
    };
    putEntity(st, 'session', id, sess);
    logEvent(st, 'session_started', id, { slot: d.slot, area: sess.areaName, gymId: d.gymId, exercises: exercises.length, source: sess.source });
  });
  return id;
}
const getActiveSessionIn = (s: State) => Object.values(s.sessions).find((x) => x.status === 'active');

export function toggleWarmupItem(i: number) {
  mutate((s) => { const a = getActiveSessionIn(s); if (a) patchSession(s, a.id, (x) => ({ ...x, warmupItems: x.warmupItems?.map((w, k) => (k === i ? { ...w, done: !w.done } : w)) })); });
}

function runAutoAdjust(s: State, sess: Session, cursor: number, warmupOverrun = false): Session {
  if (!s.settings.fitToTime) return sess;
  const r = autoAdjust({ now: now(), sessionStartedAt: sess.startedAt, targetMin: sess.targetMin, exercises: sess.exercises, cursor, newId: uid });
  if (!r.applied) return sess;
  const adjustments = r.adjustments.map((a) => (warmupOverrun ? { ...a, text: `Warm-up ran long. ${a.text}` } : a));
  logEvent(s, 'auto_adjust', sess.id, { adjustments: adjustments.map((a) => a.type), overrunSec: r.overrunBeforeSec });
  return { ...sess, exercises: r.exercises, adjustments: [...sess.adjustments, ...adjustments] };
}

export function endWarmup() {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || a.phase !== 'warmup') return;
    const t = now();
    patchSession(s, a.id, (x) => {
      let y: Session = { ...x, warmupEndedAt: t, phase: 'set', cursor: 0 };
      y = { ...y, exercises: y.exercises.map((e, i) => (i === 0 ? { ...e, status: 'active', startedAt: t } : e)) };
      y = runAutoAdjust(s, y, 0, true);
      // if exercise 0 got dropped (can't: cursor protected)
      return y;
    });
    logEvent(s, 'warmup_done', a.id, { seconds: Math.round((t - (a.warmupStartedAt ?? t)) / 1000) });
  });
}

function nextTodoIndex(exs: SessionExercise[], from: number): number {
  for (let i = from; i < exs.length; i++) if (exs[i].status === 'todo') return i;
  return -1;
}

function advance(x: Session, t: number): Session {
  let i = nextTodoIndex(x.exercises, x.cursor + 1);
  if (i < 0) i = nextTodoIndex(x.exercises, 0); // an exercise restored (undo drop) behind the cursor is still owed
  if (i < 0) return { ...x, phase: 'done', restEndsAt: undefined };
  return { ...x, cursor: i, phase: 'set', restEndsAt: undefined, exercises: x.exercises.map((e, k) => (k === i ? { ...e, status: 'active', startedAt: t } : e)) };
}

export function logSet(weight: number, reps: number) {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight < 0 || reps < 0) return; // never store NaN/negative
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || a.phase !== 'set') return;
    const t = now();
    patchSession(s, a.id, (x) => {
      const ex = x.exercises[x.cursor];
      const prev = ex.sets[ex.sets.length - 1];
      const log = { weight, reps, doneAt: t, startedAt: prev ? prev.doneAt + (prev.restSec ?? 0) * 1000 : ex.startedAt };
      const sets = [...ex.sets, log];
      const last = sets.length >= ex.plannedSets;
      const exercises = x.exercises.map((e, i) => (i === x.cursor ? { ...e, sets, endedAt: last ? t : undefined } : e));
      if (last) return { ...x, exercises, phase: 'fb' as const, restEndsAt: undefined };
      return { ...x, exercises, phase: 'rest' as const, restEndsAt: t + ex.restSec * 1000, restTotalSec: ex.restSec };
    });
    logEvent(s, 'set_logged', a.id, { exerciseId: a.exercises[a.cursor].exerciseId, weight, reps });
  });
}

/** Finish rest (timer ran out or user tapped "start now"). Records the actual rest on the previous set. */
export function endRest(auto = false) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || a.phase !== 'rest') return;
    const t = now();
    patchSession(s, a.id, (x) => {
      const exercises = x.exercises.map((e, i) => {
        if (i !== x.cursor || !e.sets.length) return e;
        const sets = e.sets.map((st, k) => (k === e.sets.length - 1 ? { ...st, restSec: Math.round((t - st.doneAt) / 1000) } : st));
        return { ...e, sets };
      });
      return { ...x, exercises, phase: 'set', restEndsAt: undefined };
    });
    if (!auto) logEvent(s, 'rest_skipped', a.id, { exerciseId: a.exercises[a.cursor].exerciseId });
  });
}
export function adjustRest(deltaSec: number) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || a.phase !== 'rest' || !a.restEndsAt) return;
    patchSession(s, a.id, (x) => ({ ...x, restEndsAt: Math.max(now() + 1000, (x.restEndsAt ?? now()) + deltaSec * 1000), restTotalSec: Math.max(x.restTotalSec ?? 0, Math.round(((x.restEndsAt ?? now()) + deltaSec * 1000 - now()) / 1000)) }));
  });
}
export function undoLastSet() {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || (a.phase !== 'rest' && a.phase !== 'fb')) return;
    patchSession(s, a.id, (x) => ({
      ...x, phase: 'set', restEndsAt: undefined,
      exercises: x.exercises.map((e, i) => (i === x.cursor ? { ...e, sets: e.sets.slice(0, -1), endedAt: undefined } : e)),
    }));
    logEvent(s, 'set_undone', a.id);
  });
}
export function addSetToCurrent() {
  mutate((s) => { const a = getActiveSessionIn(s); if (a && (a.phase === 'set' || a.phase === 'rest')) patchSession(s, a.id, (x) => (x.exercises[x.cursor].plannedSets >= 12 ? x : { ...x, exercises: x.exercises.map((e, i) => (i === x.cursor ? { ...e, plannedSets: e.plannedSets + 1 } : e)) })); });
}
export function removeSetFromCurrent() {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (a && (a.phase === 'set' || a.phase === 'rest')) patchSession(s, a.id, (x) => { const c = x.exercises[x.cursor]; return c.plannedSets > Math.max(1, c.sets.length + 1) ? { ...x, exercises: x.exercises.map((e, i) => (i === x.cursor ? { ...e, plannedSets: e.plannedSets - 1 } : e)) } : x; });
  });
}

/** Preview of the recommendation for the exercise at the cursor given draft feedback. */
/** Bodyweight progression context: the stage this exercise is at and its next-harder variation (if any). */
function bodyweightState(s: State, ex: SessionExercise): BodyweightState {
  const lib = libraryOf(s);
  const harder = lib.find((e) => e.id === ex.exerciseId)?.harder;
  const next = harder ? lib.find((e) => e.id === harder && !e.archived) : undefined;
  return { tempo: ex.tempo, ...(next ? { harder: next.id, harderName: next.name } : {}) };
}
export function previewRecommendation(ex: SessionExercise, fb: Feedback) {
  return recommend(ex, { weight: ex.plannedWeight, reps: ex.repTarget, sets: ex.plannedSets }, ex.sets, fb, bodyweightState(getState(), ex));
}

export function saveFeedback(fb: Feedback) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || a.phase !== 'fb') return;
    const t = now();
    patchSession(s, a.id, (x) => {
      const ex = x.exercises[x.cursor];
      const rec = recommend(ex, { weight: ex.plannedWeight, reps: ex.repTarget, sets: ex.plannedSets }, ex.sets, fb, bodyweightState(s, ex));
      const pr = isPR(sessionsList(s), { ...ex, status: 'done' });
      let y: Session = { ...x, exercises: x.exercises.map((e, i) => (i === x.cursor ? { ...e, status: 'done', feedback: fb, recommendation: rec, pr, endedAt: e.endedAt ?? t } : e)) };
      y = advance(y, t);
      if (y.phase !== 'done') y = runAutoAdjust(s, y, y.cursor);
      return y;
    });
    logEvent(s, 'feedback', a.id, { exerciseId: a.exercises[a.cursor].exerciseId, ...fb });
  });
}

export function skipCurrent() {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || (a.phase !== 'set' && a.phase !== 'rest')) return; // not during warm-up, feedback or when everything is done
    const t = now();
    patchSession(s, a.id, (x) => advance({ ...x, exercises: x.exercises.map((e, i) => (i === x.cursor ? { ...e, status: 'skipped', endedAt: t } : e)) }, t));
    logEvent(s, 'exercise_skipped', a.id, { exerciseId: a.exercises[a.cursor].exerciseId });
  });
}

/** The equipment id most likely meant by "this machine is busy/broken". */
export function limitingEquipment(ex: Exercise): string | null {
  const pref = ['Machines', 'Cables', 'Racks & benches', 'Free weights', 'Other'];
  return [...ex.equipment].sort((p, q) => pref.indexOf(EQUIP_BY_ID[p]?.category ?? 'Other') - pref.indexOf(EQUIP_BY_ID[q]?.category ?? 'Other'))[0] ?? null;
}

export function swapCurrent(reason: 'busy' | 'broken' | 'gone', newExerciseId: string) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a || (a.phase !== 'set' && a.phase !== 'rest')) return;
    const lib = libraryOf(s);
    const from = a.exercises[a.cursor];
    const fromEx = lib.find((e) => e.id === from.exerciseId);
    const to = lib.find((e) => e.id === newExerciseId);
    if (!to || to.id === from.exerciseId) return;
    const eq = fromEx ? limitingEquipment(fromEx) : null;
    const t = now();
    // mark equipment
    if (eq) {
      if (reason === 'busy') patchSession(s, a.id, (x) => ({ ...x, busyEquip: [...new Set([...x.busyEquip, eq])] }));
      else if (a.gymId && s.gyms[a.gymId]) {
        const g = s.gyms[a.gymId];
        const equipment = { ...g.equipment };
        const brokenSince = { ...g.brokenSince };
        if (reason === 'broken') { equipment[eq] = 'broken'; brokenSince[eq] = t; } else { delete equipment[eq]; delete brokenSince[eq]; }
        putEntity(s, 'gym', g.id, { ...g, equipment, brokenSince });
      }
      logEvent(s, 'equipment_marked', a.id, { equipId: eq, reason });
    }
    patchSession(s, a.id, (x) => {
      const rx = swapPrescription(from, to, s.progress);
      const fresh: SessionExercise = {
        ...toSessionExercise(to, from.order, rx, from.restSec, estimateExerciseSec(sessionsList(s), to, rx.sets, from.restSec), false, uid()),
        status: 'active', startedAt: t, swappedFrom: { exerciseId: from.exerciseId, name: from.name, reason },
      };
      const keepOld = from.sets.length > 0;
      const exercises = [...x.exercises];
      if (keepOld) { exercises[x.cursor] = { ...from, status: 'skipped', endedAt: t }; exercises.splice(x.cursor + 1, 0, fresh); }
      else exercises[x.cursor] = fresh;
      return { ...x, exercises: exercises.map((e, k) => ({ ...e, order: k })), cursor: keepOld ? x.cursor + 1 : x.cursor, phase: 'set', restEndsAt: undefined };
    });
    logEvent(s, 'exercise_swapped', a.id, { from: from.exerciseId, to: newExerciseId, reason });
  });
}

/** A restored (todo) exercise in a session that had reached 'done' puts the session back on that exercise. */
const reviveIfOwed = (x: Session): Session => (x.phase === 'done' && x.exercises.some((e) => e.status === 'todo') ? advance(x, now()) : x);

export function dropExercise(id: string, drop = true) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a) return;
    const want = drop ? 'dropped' : 'todo';
    patchSession(s, a.id, (x) => {
      if (!x.exercises.some((e) => e.id === id && (e.status === 'todo' || e.status === 'dropped') && e.status !== want)) return x;
      return reviveIfOwed({ ...x, exercises: x.exercises.map((e) => (e.id === id && (e.status === 'todo' || e.status === 'dropped') ? { ...e, status: want } : e)) });
    });
  });
}
export function moveUpcoming(id: string, dir: -1 | 1) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a) return;
    patchSession(s, a.id, (x) => {
      const l = [...x.exercises];
      const i = l.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j <= x.cursor || j >= l.length || i <= x.cursor) return x;
      [l[i], l[j]] = [l[j], l[i]];
      return { ...x, exercises: l.map((e, k) => ({ ...e, order: k })) };
    });
  });
}
export function undoAdjustmentById(adjId: string) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a) return;
    const adj0 = a.adjustments.find((q) => q.id === adjId);
    if (!adj0 || adj0.undone) return; // unknown or already undone: nothing to write or log
    patchSession(s, a.id, (x) => reviveIfOwed({ ...x, exercises: undoAdj(x.exercises, adj0), adjustments: x.adjustments.map((q) => (q.id === adjId ? { ...q, undone: true } : q)) }));
    logEvent(s, 'auto_adjust_undone', a.id, { adjId });
  });
}

/** Pause an exercise for N days (null = until resumed) or for the next N sessions; pass `resume` to clear. */
export function pauseExercise(exerciseId: string, opt: { days?: number | null; sessions?: number; resume?: boolean }) {
  mutate((s) => {
    const cur = prefOf(s.prefs, exerciseId);
    const next = { ...cur, exerciseId };
    if (opt.resume) { delete next.pausedUntil; delete next.pausedSessions; }
    else if (opt.sessions !== undefined) { next.pausedSessions = Math.max(0, Math.floor(opt.sessions)); delete next.pausedUntil; }
    else { next.pausedUntil = opt.days == null ? PAUSE_FOREVER : now() + opt.days * 86400000; delete next.pausedSessions; }
    putEntity(s, 'pref', exerciseId, next);
    s.device = { ...s.device, draft: null };
  });
}
export const banExercise = (exerciseId: string, banned = true) => setPref(exerciseId, { avoid: banned });
export { isPaused, statusOf };

function applyCompletion(s: State, sess: Session) {
  // session-based pauses count down on completion
  for (const p of Object.values(s.prefs)) if ((p.pausedSessions ?? 0) > 0) putEntity(s, 'pref', p.exerciseId, { ...p, pausedSessions: (p.pausedSessions ?? 1) - 1 });
  // progression state for next time
  for (const e of sess.exercises) {
    if (e.status === 'done' && e.recommendation) {
      putEntity(s, 'progress', e.exerciseId, { exerciseId: e.exerciseId, weight: e.recommendation.weight, reps: e.recommendation.reps, sets: e.recommendation.sets, ...(e.recommendation.tempo ? { tempo: true } : {}), lastRec: e.recommendation });
    }
  }
  if (sess.gymId && s.gyms[sess.gymId]) putEntity(s, 'gym', sess.gymId, { ...s.gyms[sess.gymId], lastVisitedAt: now() });
  if (sess.coachPlanId && s.plans[sess.coachPlanId]?.status === 'pending') putEntity(s, 'plan', sess.coachPlanId, { ...s.plans[sess.coachPlanId], status: 'used', usedBySessionId: sess.id });
}

export function finishSession(note?: string): string | null {
  let id: string | null = null;
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a) return;
    id = a.id;
    const t = now();
    // finishing before every exercise was visited must not leave todo/active rows in a completed session (same rule as endEarly)
    const unfinished = a.exercises.some((e) => e.status === 'todo' || e.status === 'active');
    const exercises = a.exercises.map((e) => (e.status === 'todo' || e.status === 'active' ? (e.sets.length ? { ...e, status: 'done' as const, endedAt: e.endedAt ?? t } : { ...e, status: 'skipped' as const }) : e));
    const done: Session = { ...a, exercises, status: 'completed', ...(unfinished ? { endedEarly: true } : {}), endedAt: t, phase: 'done', note: note ?? a.note, warmupEndedAt: a.warmupEndedAt ?? t };
    putEntity(s, 'session', a.id, done);
    applyCompletion(s, done);
    logEvent(s, 'session_completed', a.id, { minutes: Math.round((t - a.startedAt) / 60000) });
    s.device = { ...s.device, draft: null, chosenSlot: null };
  });
  return id;
}

/** End now. mode "save" counts the session (partial); "discard" does not. */
export function endEarly(mode: 'save' | 'discard', opts: { repeatNext?: boolean } = {}): string | null {
  let id: string | null = null;
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a) return;
    id = a.id;
    const t = now();
    if (mode === 'discard') {
      putEntity(s, 'session', a.id, { ...a, status: 'discarded', endedAt: t });
      logEvent(s, 'session_discarded', a.id);
    } else {
      const exercises = a.exercises.map((e) => (e.status === 'todo' || e.status === 'active' ? (e.sets.length ? { ...e, status: 'done' as const, endedAt: e.endedAt ?? t } : { ...e, status: 'skipped' as const }) : e));
      const done: Session = { ...a, exercises, status: 'completed', endedEarly: true, repeatNext: !!opts.repeatNext, endedAt: t, phase: 'done', warmupEndedAt: a.warmupEndedAt ?? t };
      putEntity(s, 'session', a.id, done);
      applyCompletion(s, done);
      logEvent(s, 'session_ended_early', a.id);
    }
    s.device = { ...s.device, draft: null, chosenSlot: null };
  });
  return id;
}

export function setSessionNote(id: string, note: string) {
  mutate((s) => patchSession(s, id, (x) => ({ ...x, note })));
}

export const sessionsDone = () => completed(sessionsList());
export const warmupMedian = () => warmupMedianSec(sessionsList());
export { DEFAULT_PREF };
export type { Muscle };

/** Permanently delete a past session (syncs as a deletion). Progression state is not rewound. */
export function deleteSession(id: string) {
  mutate((s) => {
    const x = s.sessions[id];
    if (!x || x.status === 'active') return;
    putEntity(s, 'session', id, x, true);
    logEvent(s, 'session_deleted', id);
    s.device = { ...s.device, draft: null };
  });
}

/** Re-apply an adjustment the athlete undid (drop the exercise again / trim the rest again). */
export function reapplyAdjustment(adjId: string) {
  mutate((s) => {
    const a = getActiveSessionIn(s);
    if (!a) return;
    patchSession(s, a.id, (x) => {
      const adj = x.adjustments.find((q) => q.id === adjId);
      if (!adj || !adj.undone) return x;
      let exercises = x.exercises;
      if (adj.type === 'drop' && adj.exerciseId) exercises = exercises.map((e) => (e.id === adj.exerciseId && e.status === 'todo' ? { ...e, status: 'dropped' as const } : e));
      if (adj.type === 'trim_rest' && adj.prevRestSec) {
        exercises = exercises.map((e) => {
          if (adj.prevRestSec![e.id] == null || e.status !== 'todo' || e.restSec <= 60) return e;
          const cut = Math.min(e.restSec - 60, 30);
          return { ...e, restSec: e.restSec - cut, estSec: Math.max(0, e.estSec - cut * Math.max(0, e.plannedSets - 1)) };
        });
      }
      return { ...x, exercises, adjustments: x.adjustments.map((q) => (q.id === adjId ? { ...q, undone: false } : q)) };
    });
  });
}
