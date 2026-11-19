import { test, expect, seed, makeSession, makeAreas, makeGym, readState, GYM_ID, DAY, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';
import { SEED_BY_ID } from '../../src/shared/exercises';
import { toSessionExercise } from '../../src/shared/rules';

export const T0 = Date.now();
type Spec = { id: string; sets: number; reps: number; w: number; rest?: number };
export const LOWER: Spec[] = [
  { id: 'back_squat', sets: 4, reps: 6, w: 82.5, rest: 120 },
  { id: 'rdl', sets: 3, reps: 8, w: 70, rest: 90 },
  { id: 'bulgarian_split', sets: 3, reps: 10, w: 10, rest: 90 },
  { id: 'seated_leg_curl', sets: 3, reps: 12, w: 40, rest: 60 },
];

/** An active session in the live phases. `ago` = seconds since the session started (relative to T0). */
export function live(o: { base?: number; ex?: Spec[]; ago?: number; phase?: string; cursor?: number; over?: Record<string, unknown>; exOver?: (i: number) => Record<string, unknown> } = {}) {
  const a = makeAreas()[1];
  const specs = o.ex ?? LOWER;
  const base = makeSession({ id: 'act', seq: 2, slot: 2, areaId: a.id, areaName: a.name, daysAgo: 0, exerciseIds: specs.map((s) => s.id) });
  const B = o.base ?? T0;
  const start = B - (o.ago ?? 600) * 1000;
  const exercises = specs.map((s, i) => ({
    ...toSessionExercise(SEED_BY_ID[s.id], i, { weight: s.w, reps: s.reps, sets: s.sets }, s.rest ?? 90, 600, false, `x${i}`),
    status: i === 0 ? 'active' as const : 'todo' as const, ...(i === 0 ? { startedAt: start } : {}), ...(o.exOver?.(i) ?? {}),
  }));
  return {
    ...base, status: 'active' as const, startedAt: start, warmupStartedAt: start, warmupEndedAt: start + 60000, endedAt: undefined, phase: (o.phase ?? 'set') as never,
    cursor: o.cursor ?? 0, targetMin: 60, warmupTargetMin: 10, updatedAt: start, exercises, adjustments: [], busyEquip: [], ...(o.over ?? {}),
  };
}
/** Completed history session for one exercise (3 × 8 @ weight) with the given weight feedback. */
export function history(id: string, weight: number, fb: 'light' | 'right' | 'heavy') {
  const a = makeAreas()[1];
  const s = makeSession({ id: `h-${id}`, seq: 1, slot: 1, areaId: a.id, areaName: a.name, daysAgo: 3, exerciseIds: [id], weight });
  s.exercises[0].feedback = { effort: 'normal', weight: fb, volume: 'ok' };
  return s;
}

/** Fake clock installed and PAUSED at exactly T0 (timers only run on fastForward / runFor), so every timestamp assertion is exact. */
export async function open(page: Page, s: ReturnType<typeof live>, opts: SeedOpts = {}, clock = true) {
  if (clock) { await page.clock.install({ time: T0 - 1000 }); await page.clock.pauseAt(T0); }
  await seed(page, { ...opts, sessions: [s as never, ...((opts.sessions ?? []) as never[])] });
  await page.goto('session/live');
}
export const sess = async (page: Page) => { await page.clock.runFor(300).catch(() => {}); return (await readState(page)).sessions.act; };
/** The store persists 250 ms after a change: poll before asserting / reloading. */
export async function settled(page: Page, pred: (s: any) => boolean) {
  await page.clock.runFor(300).catch(() => {}); // fires the store's persist debounce when the clock is paused
  await expect.poll(async () => pred((await readState(page)).sessions.act), { timeout: 5000 }).toBe(true);
}
export async function stubVibrate(page: Page) {
  await page.addInitScript(() => { (window as any).__vib = []; (navigator as any).vibrate = (p: unknown) => { (window as any).__vib.push(p); return true; }; });
}
export const vibrations = (page: Page) => page.evaluate(() => (window as any).__vib?.length ?? 0);
export const startSet = (page: Page) => page.getByRole('button', { name: 'Start set 1' }).click();
export const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

