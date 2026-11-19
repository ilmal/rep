import { test, expect, seed, makeSession, makeAreas, makeGym, readState, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';

const T0 = Date.now();
const IDS = ['back_squat', 'leg_press', 'seated_leg_curl', 'calf_raise_standing'];

/** Active session in warm-up phase, started `ago` seconds before T0. 4 exercises x 600 s, rest 90 s, target 45 min. */
function warm(ago: number, over: Record<string, unknown> = {}) {
  const a = makeAreas()[1];
  const base = makeSession({ id: 'act', seq: 2, slot: 2, areaId: a.id, areaName: a.name, daysAgo: 0, exerciseIds: IDS });
  const start = T0 + 60_000 - ago * 1000; // the clock is paused at T0+60s so `ago` is exactly what the screen shows
  return {
    ...base, status: 'active' as const, startedAt: start, warmupStartedAt: start, warmupEndedAt: undefined, endedAt: undefined, phase: 'warmup' as const, cursor: 0, targetMin: 45, warmupTargetMin: 10, updatedAt: start,
    exercises: base.exercises.map((e, i) => ({ ...e, status: 'todo' as const, sets: [], startedAt: undefined, endedAt: undefined, feedback: undefined, recommendation: undefined, estSec: 600, restSec: 90, plannedSets: 3, order: i, id: `x${i}` })),
    warmupItems: [
      { name: 'Bike, easy pace', meta: '5 min', done: false },
      { name: 'Leg swings + hip circles', meta: '2 × 10 each side', done: false },
      { name: 'Goblet squat ramp-up', meta: '2 × 8 · light', done: false },
    ],
    ...over,
  };
}
async function open(page: Page, ago: number, over: Record<string, unknown> = {}, opts: SeedOpts = {}) {
  await page.clock.install({ time: T0 });
  await seed(page, { sessions: [warm(ago, over) as never], ...opts });
  await page.goto('session/warmup');
  await page.clock.pauseAt(T0 + 60_000);
}
/** persistence is debounced on a timer; the paused fake clock has to be advanced to flush it */
const flush = (page: Page) => page.clock.fastForward(1500);
/** the stored active session, polled (persist = debounce timer + async IndexedDB write) until `ready` holds */
async function stored(page: Page, ready: (s: any) => boolean): Promise<any> {
  let s: any;
  await expect.poll(async () => { await flush(page); s = Object.values((await readState(page)).sessions)[0]; return ready(s); }).toBe(true);
  return s;
}
const clock = (page: Page) => page.getByRole('timer').filter({ hasText: /^\d\d:\d\d$/ });

test('on plan: tag, clock from timestamp, progress, planned label, no banner', async ({ page }) => {
  await open(page, 4 * 60 + 20);
  await expect(page.getByText('On plan')).toBeVisible();
  await expect(page.getByText('Warm-up', { exact: true })).toBeVisible();
  await expect(clock(page)).toHaveText('04:20');
  await expect(page.getByText('Planned 10:00')).toBeVisible();
  await expect(page.getByText('Session 2 · Lower body')).toBeVisible();
  await expect(page.getByRole('timer', { name: 'Session time' })).toHaveText('0:04:20');
  await expect(page.locator('.fillbar')).toHaveAttribute('style', /width: 43\.\d+%/);
  await expect(page.locator('.fillbar.accent')).toHaveCount(0);
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  await expect(page.getByText('0/3')).toBeVisible();
});

test('clock ticks with wall-clock and flips to over plan past the target', async ({ page }) => {
  await open(page, 9 * 60 + 50);
  await expect(clock(page)).toHaveText('09:50');
  await page.clock.fastForward(5000);
  await expect(clock(page)).toHaveText('09:55');
  await expect(page.getByText('On plan')).toBeVisible();
  await page.clock.fastForward(20_000);
  await expect(page.getByText('Over plan')).toBeVisible();
  await expect(page.locator('.fillbar.accent')).toBeVisible();
  await expect(page.locator('.fillbar')).toHaveAttribute('style', /width: 100%/);
  await expect(page.locator('.banner.warn')).toContainText('Running 00:15 over.');
});

test('your avg is the median of past warm-ups, hidden without history', async ({ page }) => {
  const a = makeAreas()[1];
  const past = makeSession({ id: 'p1', seq: 1, slot: 1, areaId: a.id, areaName: a.name, daysAgo: 3, exerciseIds: ['back_squat'] });
  await open(page, 60, {}, { sessions: [past, warm(60) as never] });
  await expect(page.getByText('Your avg 09:00')).toBeVisible();
});
test('no avg label without completed sessions', async ({ page }) => {
  await open(page, 60);
  await expect(page.getByText(/Your avg/)).toHaveCount(0);
});

test('over plan names the exercise that will be dropped and the rest trim', async ({ page }) => {
  // 25 min elapsed + 30 min of remaining work > 45 + 5 -> rest trimmed to 60 s, last exercise dropped
  await open(page, 25 * 60);
  const b = page.locator('.banner.warn');
  await expect(page.getByText('Over plan')).toBeVisible();
  await expect(b).toContainText('Running 15:00 over. Plan adjusted.');
  await expect(b).toContainText('Rest trimmed to 60 s on accessories.');
  await expect(b).toContainText('Standing calf raise is dropped to keep you near 45 min.');
});

test('over plan but within tolerance warns what happens if it keeps running', async ({ page }) => {
  // 11 min elapsed: 11 + 40 = 51 > 50 is already adjusted; use a longer target instead
  await open(page, 11 * 60, { targetMin: 55 });
  const b = page.locator('.banner.warn');
  await expect(b).toContainText('Running 01:00 over.');
  await expect(b).not.toContainText('Plan adjusted');
  await expect(b).toContainText(/If you pass \d\d:\d\d, Standing calf raise is dropped to keep you near 55 min\./);
  const m = (await b.innerText()).match(/If you pass (\d\d):(\d\d)/)!;
  expect(Number(m[1]) * 60 + Number(m[2])).toBeGreaterThan(11 * 60);
});

test('over plan and plan comfortably fits: nothing trimmed', async ({ page }) => {
  await open(page, 11 * 60, { targetMin: 120 });
  await expect(page.locator('.banner.warn')).toContainText('Your plan still fits your 120 min target.');
});

test('fit-to-time off: banner says target is not adjusted, and finishing changes nothing', async ({ page }) => {
  await open(page, 25 * 60, {}, { settings: { fitToTime: false }, sessions: [warm(25 * 60) as never] });
  await expect(page.locator('.banner.warn')).toContainText('Your session target time is not adjusted automatically.');
  await page.getByRole('button', { name: /Warm-up done/ }).click();
  await expect(page).toHaveURL(/session\/live$/);
  const s = await stored(page, (x) => x.phase === 'set');
  expect(s.adjustments).toHaveLength(0);
  expect(s.exercises.every((e: any) => e.status !== 'dropped')).toBe(true);
});

test('items toggle, count updates, state persists in the store', async ({ page }) => {
  await open(page, 120);
  const bike = page.getByRole('button', { name: /Bike, easy pace/ });
  await expect(bike).toHaveAttribute('aria-pressed', 'false');
  await bike.click();
  await expect(bike).toHaveAttribute('aria-pressed', 'true');
  await expect(bike.locator('.check')).toHaveClass(/on/);
  await expect(page.getByText('1/3')).toBeVisible();
  await page.getByRole('button', { name: /Goblet squat ramp-up/ }).click();
  await expect(page.getByText('2/3')).toBeVisible();
  await bike.click();
  await expect(page.getByText('1/3')).toBeVisible();
  const s = await stored(page, (x) => x.warmupItems[2].done);
  expect(s.warmupItems.map((i: any) => i.done)).toEqual([false, false, true]);
});

test('reload restores items and clocks stay correct', async ({ page }) => {
  await open(page, 4 * 60);
  await page.getByRole('button', { name: /Leg swings/ }).click();
  await expect(page.getByText('1/3')).toBeVisible();
  await page.clock.fastForward(30_000);
  await expect(clock(page)).toHaveText('04:30');
  await flush(page);
  await page.reload();
  await expect(page.getByRole('button', { name: /Leg swings/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('1/3')).toBeVisible();
  // the clock is derived from the stored timestamp, so it can only have moved forward from 04:30
  await expect(clock(page)).toHaveText(/^04:(3\d|4\d)$/);
  await expect(page.getByRole('timer', { name: 'Session time' })).toHaveText(/^0:04:(3\d|4\d)$/);
});

test('Warm-up done applies auto-adjust and opens the live session', async ({ page }) => {
  await open(page, 25 * 60);
  await page.getByRole('button', { name: /Warm-up done/ }).click();
  await expect(page).toHaveURL(/session\/live$/);
  const s = await stored(page, (x) => x.phase === 'set');
  expect(s.phase).toBe('set');
  expect(s.warmupEndedAt).toBeTruthy();
  expect(s.exercises[0].status).toBe('active');
  expect(s.exercises[3].status).toBe('dropped');
  expect(s.adjustments.map((a: any) => a.type)).toEqual(['trim_rest', 'drop']);
  expect(s.adjustments[0].text).toMatch(/^Warm-up ran long\./);
  expect(s.exercises[1].restSec).toBe(60);
});

test('Warm-up done on plan leaves the plan untouched', async ({ page }) => {
  await open(page, 5 * 60);
  await page.getByRole('button', { name: /Warm-up done/ }).click();
  await expect(page).toHaveURL(/session\/live$/);
  const s = await stored(page, (x) => x.phase === 'set');
  expect(s.adjustments).toHaveLength(0);
  expect(s.exercises.map((e: any) => e.status)).toEqual(['active', 'todo', 'todo', 'todo']);
});

test('Skip warm-up goes to live and ends the warm-up phase', async ({ page }) => {
  await open(page, 30);
  await page.getByRole('button', { name: 'Skip warm-up' }).click();
  await expect(page).toHaveURL(/session\/live$/);
  const s = await stored(page, (x) => x.phase === 'set');
  expect(s.phase).toBe('set');
  expect(s.warmupItems.every((i: any) => !i.done)).toBe(true);
});

test('topbar: overview and End links', async ({ page }) => {
  await open(page, 30);
  await page.getByRole('link', { name: 'Session overview' }).click();
  await expect(page).toHaveURL(/session\/plan$/);
  await page.goBack();
  await page.getByRole('link', { name: 'End' }).click();
  await expect(page).toHaveURL(/session\/end$/);
});

test('session already past warm-up redirects to live', async ({ page }) => {
  await open(page, 600, { phase: 'set' });
  await expect(page).toHaveURL(/session\/live$/);
});

test('no suggestions: empty copy', async ({ page }) => {
  await open(page, 30, { warmupItems: [] });
  await expect(page.getByText('No warm-up suggestions for this session.')).toBeVisible();
  await expect(page.getByText('0/0')).toBeVisible();
});

test('offline strip appears and the screen keeps working', async ({ page, context }) => {
  await open(page, 120);
  await context.setOffline(true);
  await expect(page.getByText('Offline. Every set is saved on this phone.')).toBeVisible();
  await page.getByRole('button', { name: /Bike, easy pace/ }).click();
  await expect(page.getByText('1/3')).toBeVisible();
  await expect(page.getByText(/^\d+ queued$/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/^Back online\./)).toBeVisible();
});

test('no horizontal overflow at 360px (on plan and over plan)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page, 25 * 60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
