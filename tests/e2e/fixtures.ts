// Shared E2E fixtures. `seed()` writes app state straight into the store's localStorage fallback
// (hydrate() reads it when IndexedDB is empty), so a page test never has to walk onboarding.
import { test as base, expect, type Page } from '@playwright/test';
import { AREA_TEMPLATES, areaFromTemplate } from '../../src/shared/exercises';
import { templateEquipment } from '../../src/shared/catalog';
import { withDefaults } from '../../src/shared/defaults';
import { toSessionExercise } from '../../src/shared/rules';
import { SEED_BY_ID, SEED_EXERCISES } from '../../src/shared/exercises';
import type { Area, Gym, Session, SessionExercise, SetLog, ExercisePref } from '../../src/shared/types';

export const GYM_ID = 'gym-city';
/** Every no-equipment exercise: always doable anywhere, so tests about "nothing fits here" must ban them to get a dead end. */
export const BODYWEIGHT_IDS = SEED_EXERCISES.filter((e) => e.equipment.every((q) => q === 'mat')).map((e) => e.id);
export const banBodyweight = (): Record<string, ExercisePref> => Object.fromEntries(BODYWEIGHT_IDS.map((id) => [id, { exerciseId: id, favorite: false, avoid: true, relevance: 50 }]));
export const HOME = { lat: 59.343, lng: 18.055 };
export const DAY = 86400000;

export function makeGym(over: Partial<Gym> = {}): Gym {
  return { id: GYM_ID, name: 'City Gym Odenplan', lat: HOME.lat, lng: HOME.lng, radiusM: 150, equipment: templateEquipment('full'), notes: {}, brokenSince: {}, createdAt: 1, ...over };
}
export function makeAreas(): Area[] {
  return ['Upper body', 'Lower body', 'Prehab & mobility', 'Full body'].map((n, i) => areaFromTemplate(AREA_TEMPLATES.find((t) => t.name === n)!, `area-${i + 1}`));
}
/** A completed session `daysAgo` days ago with real-looking sets. */
export function makeSession(o: { id: string; seq: number; slot: number; areaId: string; areaName: string; daysAgo: number; exerciseIds: string[]; minutes?: number; weight?: number; status?: Session['status'] }): Session {
  const end = Date.now() - o.daysAgo * DAY;
  const start = end - (o.minutes ?? 55) * 60000;
  const exercises: SessionExercise[] = o.exerciseIds.map((eid, i) => {
    const ex = SEED_BY_ID[eid];
    const base = toSessionExercise(ex, i, { weight: o.weight ?? 40, reps: 8, sets: 3 }, 90, 600, false, `${o.id}-e${i}`);
    const sets: SetLog[] = [0, 1, 2].map((k) => ({ weight: o.weight ?? 40, reps: 8, doneAt: start + (i * 10 + k * 3) * 60000, restSec: 90 }));
    return { ...base, status: 'done' as const, sets, startedAt: start + i * 600000, endedAt: start + (i + 1) * 600000 - 30000, feedback: { effort: 'normal', weight: 'right', volume: 'ok' }, recommendation: { weight: (o.weight ?? 40), reps: 9, sets: 3, kind: 'rep_up', tag: '+1 rep', why: 'Just right, all sets hit: +1 rep.', ruleVersion: 1 } };
  });
  return { id: o.id, seq: o.seq, slot: o.slot, areaId: o.areaId, areaName: o.areaName, gymId: GYM_ID, gymName: 'City Gym Odenplan', status: o.status ?? 'completed', startedAt: start, warmupStartedAt: start, warmupEndedAt: start + 9 * 60000, endedAt: end, targetMin: 60, warmupTargetMin: 10, exercises, adjustments: [], busyEquip: [], cursor: exercises.length, phase: 'done', updatedAt: end };
}

/** A completed session ending exactly at `endMs` (all inner timestamps shifted): for pinned-clock streak/week tests. */
export function placedSession(o: { slot: number; endMs: number; areaName?: string; areaId?: string; exerciseIds?: string[]; minutes?: number; weight?: number; warmMin?: number }): Session {
  const areas = makeAreas();
  const a = areas[o.slot - 1] ?? areas[0];
  const s = makeSession({ id: `s-${o.slot}-${o.endMs}`, seq: o.slot, slot: o.slot, areaId: o.areaId ?? a.id, areaName: o.areaName ?? a.name, daysAgo: 0, exerciseIds: o.exerciseIds ?? ['bench_press', 'seated_row', 'ohp'], minutes: o.minutes, weight: o.weight });
  const delta = o.endMs - s.endedAt!;
  const sh = (x?: number) => (x == null ? x : x + delta);
  const out: Session = { ...s, startedAt: s.startedAt + delta, warmupStartedAt: s.startedAt + delta, endedAt: o.endMs, updatedAt: o.endMs,
    exercises: s.exercises.map((e) => ({ ...e, startedAt: sh(e.startedAt), endedAt: sh(e.endedAt), sets: e.sets.map((x) => ({ ...x, doneAt: x.doneAt + delta })) })) };
  out.warmupEndedAt = out.warmupStartedAt! + (o.warmMin ?? 9) * 60000;
  return out;
}

export interface SeedOpts {
  onboarded?: boolean;
  name?: string;
  settings?: Record<string, unknown>;
  gyms?: Gym[] | null;
  areas?: Area[] | null;
  sessions?: Session[];
  prefs?: Record<string, ExercisePref>;
  device?: Record<string, unknown>;
}
export function buildState(o: SeedOpts = {}) {
  const gyms = o.gyms === null ? [] : o.gyms ?? [makeGym()];
  const areas = o.areas === null ? [] : o.areas ?? makeAreas();
  const onboarded = o.onboarded ?? true;
  const settings = withDefaults({ name: o.name ?? 'Alex', onboarded, rotation: onboarded ? areas.map((a) => a.id) : [], updatedAt: 1, ...(o.settings ?? {}) } as never);
  return {
    settings,
    gyms: Object.fromEntries(gyms.map((g) => [g.id, g])), areas: Object.fromEntries(areas.map((a) => [a.id, a])),
    exercises: {}, progress: {}, sessions: Object.fromEntries((o.sessions ?? []).map((s) => [s.id, s])), prefs: o.prefs ?? {}, plans: {},
    device: { cursor: 0, currentGymId: gyms[0]?.id ?? null, gymSource: gyms[0] ? 'last' : 'none', geo: 'idle', chosenSlot: null, draft: null, resumeShown: false, ...(o.device ?? {}) },
    outbox: {}, events: [],
  };
}
export async function seed(page: Page, o: SeedOpts = {}) {
  const state = buildState(o);
  await page.addInitScript(([k, v]) => { if (!localStorage.getItem('__seeded')) { localStorage.setItem(k as string, v as string); localStorage.setItem('__seeded', '1'); } }, ['rep-state-v1', JSON.stringify(state)]);
}
/** Read the persisted store back (IndexedDB first, localStorage fallback) to assert on state. */
export async function readState(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const fromIdb = await new Promise<any>((res) => { const r = indexedDB.open('keyval-store'); r.onerror = () => res(null); r.onsuccess = () => { try { const g = r.result.transaction('keyval').objectStore('keyval').get('rep-state-v1'); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); } catch { res(null); } }; });
    if (fromIdb) return fromIdb;
    const raw = localStorage.getItem('rep-state-v1'); return raw ? JSON.parse(raw) : null;
  });
}
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errs.push('console: ' + m.text()); });
    await use(errs);
    expect(errs, 'no page/console errors').toEqual([]);
  },
});
export { expect };
