// The built-in "At home, no equipment" location. It is a pseudo-gym that is ALWAYS available and never stored as a user gym:
// sessions planned there record gymId = NO_EQUIPMENT_GYM_ID and gymName = NO_EQUIPMENT_NAME.
// "Equipment" = bodyweight, a floor (catalog id `mat`) and a wall: every exercise whose equipment is empty or just `mat`.
import type { Exercise, Gym, ProgressEntry } from './types';
import { availableEquipment, isAvailable, rankAlternatives } from './rules';

export const NO_EQUIPMENT_GYM_ID = 'none';
/** What a session / history row / MCP calls this location. */
export const NO_EQUIPMENT_NAME = 'No equipment';
/** What the pickers and cards call it. */
export const NO_EQUIPMENT_LABEL = 'At home · no equipment';
/** Catalog equipment ids the pseudo gym provides: the floor. */
export const NO_EQUIPMENT_EQUIP = ['mat'] as const;

export const isNoEquipment = (id: string | null | undefined): boolean => id === NO_EQUIPMENT_GYM_ID;

const PSEUDO: Gym = {
  id: NO_EQUIPMENT_GYM_ID, name: NO_EQUIPMENT_NAME, lat: null, lng: null, radiusM: 0,
  equipment: Object.fromEntries(NO_EQUIPMENT_EQUIP.map((e) => [e, 'ok' as const])), notes: {}, brokenSince: {}, createdAt: 0,
};
export const noEquipmentGym = (): Gym => PSEUDO;

/** A gym by id (as stored, deleted or not: a past session keeps its gym's equipment), or the built-in no-equipment location for 'none'. */
export function resolveGym(gyms: Record<string, Gym> | Gym[], id: string | null | undefined): Gym | null {
  if (!id) return null;
  if (isNoEquipment(id)) return PSEUDO;
  return (Array.isArray(gyms) ? gyms.find((x) => x.id === id) : gyms[id]) ?? null;
}

/** Exercises that can be done with no equipment (excludes archived). */
export function bodyweightExercises(library: Exercise[]): Exercise[] {
  const avail = availableEquipment(PSEUDO);
  return library.filter((e) => !e.archived && isAvailable(e, avail));
}

/** Rest between bodyweight sets at the no-equipment location: lighter loads, so shorter plans (home sessions run well under a gym session). */
export const HOME_REST_SEC = 60;

/**
 * "A → B" pairs describing how `current` changes into `next` (both plans for the same area): every exercise that leaves the plan is
 * paired with the best-matching exercise that joins it (muscles, pattern, difficulty: the swap ranking), in plan order.
 * Used by the gym picker, so the pairs are the REAL difference between today's plan and the one the planner builds at that location.
 */
export function swapPairs(
  current: { exerciseId: string; name: string }[], next: { exerciseId: string; name: string }[], library: Exercise[], progress: Record<string, ProgressEntry> = {},
): string[] {
  const keep = new Set(next.map((e) => e.exerciseId));
  const had = new Set(current.map((e) => e.exerciseId));
  const out = current.filter((e) => !keep.has(e.exerciseId));
  const incoming = next.filter((e) => !had.has(e.exerciseId));
  const lib = new Map(library.map((e) => [e.id, e]));
  const free = incoming.map((e) => lib.get(e.exerciseId)).filter((e): e is Exercise => !!e);
  const everything = new Set(free.flatMap((e) => e.equipment));
  const used = new Set<string>();
  return out.map((o) => {
    const from = lib.get(o.exerciseId);
    const pool = free.filter((e) => !used.has(e.id));
    const best = from ? rankAlternatives(from, pool, everything, [], progress)[0]?.exercise : undefined;
    const to = best ?? pool[0];
    if (!to) return `${o.name} → no alternative, dropped`;
    used.add(to.id);
    return `${o.name} → ${to.name}`;
  });
}
