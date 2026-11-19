// Library helpers: shared filter state (list <-> filters sheet), grouping, display labels, bulk preference actions.
import { resolveGym } from '../../shared/location';
import { useSyncExternalStore } from 'react';
import { EQUIP_BY_ID } from '../../shared/catalog';
import { PAUSE_FOREVER, isPaused, prefOf, statusOf, type ExerciseStatus } from '../../shared/planner';
import { availableEquipment, isAvailable } from '../../shared/rules';
import type { Exercise, ExercisePref, Gym } from '../../shared/types';
import { banExercise, pauseExercise, setPref } from './actions';
import { getState } from './core';

// ───────────── groups (design: nine muscle groups, one per exercise) ─────────────
export const LIB_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Quads', 'Hamstrings & glutes', 'Calves', 'Core', 'Prehab & mobility'] as const;
export type LibGroup = (typeof LIB_GROUPS)[number];

export function groupOf(e: Exercise): LibGroup {
  if (e.prehab || e.pattern === 'mobility') return 'Prehab & mobility';
  const p = e.primary;
  const m = p[0];
  if (m === 'Lower back') return p.some((x) => x === 'Hamstrings' || x === 'Glutes') ? 'Hamstrings & glutes' : 'Back';
  switch (m) {
    case 'Chest': return 'Chest';
    case 'Lats': case 'Upper back': return 'Back';
    case 'Delts': case 'Rear delts': case 'Rotator cuff': return 'Shoulders';
    case 'Biceps': case 'Triceps': case 'Forearms': return 'Arms';
    case 'Quads': return 'Quads';
    case 'Hamstrings': case 'Glutes': case 'Adductors': return 'Hamstrings & glutes';
    case 'Calves': return 'Calves';
    default: return 'Core';
  }
}

// ───────────── equipment / pattern / level labels ─────────────
export const EQUIP_FILTERS = ['Barbell', 'Dumbbells', 'Kettlebell', 'Cable', 'Machine', 'Bodyweight', 'Bench', 'Rack', 'Band', 'Pull-up bar'] as const;
export const PATTERN_FILTERS = ['Push', 'Pull', 'Squat', 'Hinge', 'Lunge', 'Carry', 'Core', 'Mobility'] as const;
export const LEVEL_LABELS = ['Beginner', 'Intermediate', 'Advanced'];

function equipLabel(id: string): string {
  switch (id) {
    case 'barbell': case 'ez_bar': case 'trap_bar': return 'Barbell';
    case 'dumbbells': return 'Dumbbells';
    case 'kettlebells': return 'Kettlebell';
    case 'cable_station': case 'lat_pulldown': case 'seated_row': return 'Cable';
    case 'flat_bench': case 'adj_bench': return 'Bench';
    case 'squat_rack': return 'Rack';
    case 'bands': return 'Band';
    case 'pullup_bar': return 'Pull-up bar';
    default: {
      const it = EQUIP_BY_ID[id];
      return it?.category === 'Machines' ? 'Machine' : it?.name ?? id;
    }
  }
}
/** Distinct short equipment labels for an exercise ("Bodyweight" when it needs none). */
export function equipLabels(e: Exercise): string[] {
  if (!e.equipment.length) return ['Bodyweight'];
  return [...new Set(e.equipment.map(equipLabel))];
}
export const patternLabel = (e: Exercise) => e.pattern.charAt(0).toUpperCase() + e.pattern.slice(1);

// ───────────── filter state (module-level, survives list -> filters -> list) ─────────────
export interface LibFilter {
  q: string;
  tab: 'all' | 'ready' | 'paused' | 'banned';
  group: 'All' | LibGroup;
  /** gym id to restrict to ('' = any gym) */
  gymId: string;
  eq: string[];
  pat: string[];
  /** 0 = any, 1..3 = exact difficulty */
  lvl: number;
  fav: boolean;
  showPaused: boolean;
  showBanned: boolean;
}
export const DEFAULT_FILTER: LibFilter = { q: '', tab: 'all', group: 'All', gymId: '', eq: [], pat: [], lvl: 0, fav: false, showPaused: true, showBanned: true };

let filter: LibFilter = DEFAULT_FILTER;
const subs = new Set<() => void>();
export const getFilter = () => filter;
export function setFilter(patch: Partial<LibFilter>) { filter = { ...filter, ...patch }; subs.forEach((f) => f()); }
export function resetFilter(keep: Partial<LibFilter> = {}) { filter = { ...DEFAULT_FILTER, ...keep }; subs.forEach((f) => f()); }
/** Reset only what the filters sheet owns (design: Reset). */
export const resetSheetFilters = () => setFilter({ gymId: '', eq: [], pat: [], lvl: 0, fav: false, showPaused: true, showBanned: true });
export function useLibFilter(): LibFilter {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, getFilter, getFilter);
}
/** How many sheet filters deviate from their default. */
export function activeFilterCount(f: LibFilter): number {
  return (f.gymId ? 1 : 0) + (f.eq.length ? 1 : 0) + (f.pat.length ? 1 : 0) + (f.lvl ? 1 : 0) + (f.fav ? 1 : 0) + (f.showPaused ? 0 : 1) + (f.showBanned ? 0 : 1);
}

// ───────────── status + filtering ─────────────
export type LibStatus = ExerciseStatus;
export const toggleIn = (a: string[], v: string) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);

export function haystack(e: Exercise): string {
  return `${e.name} ${e.primary.join(' ')} ${equipLabels(e).join(' ')} ${e.pattern}`.toLowerCase();
}

export interface FilterCtx { prefs: Record<string, ExercisePref>; gyms: Gym[]; now: number }

export function filterExercises(lib: Exercise[], f: LibFilter, ctx: FilterCtx): Exercise[] {
  const needle = f.q.trim().toLowerCase();
  const gym = f.gymId ? resolveGym(ctx.gyms, f.gymId) ?? undefined : undefined;
  const avail = gym ? availableEquipment(gym) : null;
  const out: Exercise[] = [];
  for (const e of lib) {
    const st = statusOf(prefOf(ctx.prefs, e.id), ctx.now);
    const blocked = st === 'paused' || st === 'banned';
    if (f.tab === 'ready' && blocked) continue;
    if (f.tab === 'paused' && st !== 'paused') continue;
    if (f.tab === 'banned' && st !== 'banned') continue;
    if (f.tab !== 'paused' && st === 'paused' && !f.showPaused) continue;
    if (f.tab !== 'banned' && st === 'banned' && !f.showBanned) continue;
    if (f.group !== 'All' && groupOf(e) !== f.group) continue;
    if (f.fav && !prefOf(ctx.prefs, e.id).favorite) continue;
    if (avail && !isAvailable(e, avail)) continue;
    if (f.eq.length && !equipLabels(e).some((x) => f.eq.includes(x))) continue;
    if (f.pat.length && !f.pat.includes(patternLabel(e))) continue;
    if (f.lvl && e.difficulty !== f.lvl) continue;
    if (needle && !haystack(e).includes(needle)) continue;
    out.push(e);
  }
  return out;
}

/** "after next session" / "until 1 Dec" / "until you resume" */
export function pausedUntilText(p: ExercisePref, fmtDate: (t: number) => string): string {
  if ((p.pausedSessions ?? 0) > 0) return p.pausedSessions === 1 ? 'after next session' : `for ${p.pausedSessions} sessions`;
  if (p.pausedUntil != null && p.pausedUntil >= PAUSE_FOREVER / 2) return 'until you resume';
  return p.pausedUntil ? `until ${fmtDate(p.pausedUntil)}` : '';
}
export { isPaused };

// ───────────── bulk actions (undoable) ─────────────
type Snap = { id: string; had: boolean; favorite: boolean; avoid: boolean; pausedUntil?: number; pausedSessions?: number };
export function snapshotPrefs(ids: string[]): Snap[] {
  const prefs = getState().prefs;
  return ids.map((id) => { const p = prefs[id]; return { id, had: !!p, favorite: !!p?.favorite, avoid: !!p?.avoid, pausedUntil: p?.pausedUntil, pausedSessions: p?.pausedSessions }; });
}
export function restorePrefs(snaps: Snap[]) {
  for (const s of snaps) setPref(s.id, { favorite: s.favorite, avoid: s.avoid, pausedUntil: s.pausedUntil, pausedSessions: s.pausedSessions });
}
export const bulkFavourite = (ids: string[]) => ids.forEach((id) => setPref(id, { favorite: true }));
export const bulkPause = (ids: string[], days: number | null = 14) => ids.forEach((id) => pauseExercise(id, { days }));
export const bulkBan = (ids: string[]) => ids.forEach((id) => banExercise(id, true));
export const bulkResume = (ids: string[]) => ids.forEach((id) => { if (prefOf(getState().prefs, id).avoid) banExercise(id, false); pauseExercise(id, { resume: true }); });
