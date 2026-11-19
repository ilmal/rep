import { test, expect, seed, readState } from './fixtures';
import { activeSession } from './x-active';
import type { Adjustment } from '../../src/shared/types';

const exOf = async (page: any) => (await readState(page)).sessions['act-1'].exercises as any[];
const adjDrop = (exId: string): Adjustment => ({ id: 'adj-drop', at: Date.now(), type: 'drop', exerciseId: exId, savedSec: 600, text: 'Warm-up ran 2 min long, so Standing calf raise was dropped.' });
const adjRest = (prev: Record<string, number>): Adjustment => ({ id: 'adj-rest', at: Date.now(), type: 'trim_rest', savedSec: 120, prevRestSec: prev, text: 'Rest trimmed by up to 30 s to save ~2 min.' });

test('overview shows elapsed / projected / target, warm-up overrun and row states', async ({ page, errors }) => {
  await seed(page, { sessions: [activeSession()] });
  await page.goto('session/plan');
  await expect(page.getByText('Session overview')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveAttribute('aria-label', /^Elapsed 0:45:/);
  const nums = page.locator('.card .t-num');
  await expect(nums.nth(0)).toContainText('45');
  await expect(nums.nth(2)).toContainText('60');
  // 45 elapsed + 2/3 of 10 min (active) + 2 x 10 min = 72
  await expect(nums.nth(1)).toContainText('72');
  await expect(page.getByText('Warm-up 12:00 (+2:00)')).toBeVisible();
  await expect(page.locator('.tl > span')).toHaveCount(3);
  const rows = page.locator('.group .li');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('Deadlift');
  await expect(rows.nth(0)).toContainText('3 × 8');
  await expect(rows.nth(0)).toContainText('Just right');
  await expect(rows.nth(0)).toContainText('+1 rep');
  await expect(rows.nth(2)).toContainText('Now · set 2 of 3');
  await expect(rows.nth(3)).toContainText('~10 min');
  await expect(rows.nth(3).getByRole('button', { name: 'Drop' })).toBeVisible();
  await expect(page.locator('.banner')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('drop and add back change projected time and persist', async ({ page }) => {
  await seed(page, { sessions: [activeSession()] });
  await page.goto('session/plan');
  const proj = page.locator('.card .t-num').nth(1);
  await expect(proj).toContainText('72');
  const row = page.locator('.group .li').nth(3);
  await row.getByRole('button', { name: 'Drop' }).click();
  await expect(proj).toContainText('62');
  await expect(row).toContainText('Dropped to save ~10 min');
  await expect(row).toHaveClass(/struck/);
  await expect.poll(async () => (await exOf(page))[3].status).toBe('dropped');
  await row.getByRole('button', { name: 'Add back' }).click();
  await expect(proj).toContainText('72');
  await expect.poll(async () => (await exOf(page))[3].status).toBe('todo');
});

test('reorder upcoming: bounds disabled, order persists, cursor row never moves', async ({ page }) => {
  await seed(page, { sessions: [activeSession()] });
  await page.goto('session/plan');
  await page.waitForTimeout(300);
  const before = (await exOf(page)).map((e) => e.name);
  await expect(page.getByRole('button', { name: `Move ${before[3]} up` })).toBeDisabled();
  await expect(page.getByRole('button', { name: `Move ${before[4]} down` })).toBeDisabled();
  await page.getByRole('button', { name: `Move ${before[3]} down` }).click();
  await expect.poll(async () => (await exOf(page)).map((e) => e.name)).toEqual([before[0], before[1], before[2], before[4], before[3]]);
  await expect(page.locator('.group .li').nth(3)).toContainText(before[4]);
  await page.getByRole('button', { name: `Move ${before[3]} up` }).click();
  await expect.poll(async () => (await exOf(page)).map((e) => e.name)).toEqual(before);
});

test('auto-adjust banner (drop): undo restores the exercise, then re-apply drops it again', async ({ page, errors }) => {
  const s = activeSession();
  s.exercises[4].status = 'dropped';
  s.adjustments = [adjDrop(s.exercises[4].id)];
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  const banner = page.locator('.banner.warn');
  await expect(banner).toContainText('Auto-adjusted to finish near 60 min');
  await expect(banner).toContainText('Standing calf raise was dropped');
  await expect(page.locator('.card .t-num').nth(1)).toContainText('62');
  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await exOf(page))[4].status).toBe('todo');
  await expect.poll(async () => (await readState(page)).sessions['act-1'].adjustments[0].undone).toBe(true);
  // back over target: error banner with Re-apply (design state)
  const err = page.locator('.banner.error');
  await expect(err).toContainText('Projected 12 min over target');
  await expect(err).toContainText('Keeping everything. You can still drop an exercise below.');
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  await expect(page.locator('.card .t-num').nth(1)).toContainText('72');
  await err.getByRole('button', { name: 'Re-apply' }).click();
  await expect.poll(async () => (await exOf(page))[4].status).toBe('dropped');
  await expect.poll(async () => (await readState(page)).sessions['act-1'].adjustments[0].undone).toBe(false);
  await expect(page.locator('.banner.warn')).toBeVisible();
  await expect(page.locator('.banner.error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('trim-rest adjustment: undo restores rest and estimate, re-apply trims again', async ({ page }) => {
  const s = activeSession();
  const e3 = s.exercises[3], e4 = s.exercises[4];
  const prev = { [e3.id]: 90, [e4.id]: 90 };
  s.exercises[3] = { ...e3, restSec: 60, estSec: 600 - 30 * (e3.plannedSets - 1) };
  s.exercises[4] = { ...e4, restSec: 60, estSec: 600 - 30 * (e4.plannedSets - 1) };
  s.adjustments = [adjRest(prev)];
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  await page.locator('.banner.warn').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await exOf(page))[3].restSec).toBe(90);
  expect((await exOf(page))[3].estSec).toBe(600);
  // not over target anymore? 72 > 60 so error banner shows
  await expect(page.locator('.banner.error')).toBeVisible();
  await page.locator('.banner.error').getByRole('button', { name: 'Re-apply' }).click();
  await expect.poll(async () => (await exOf(page))[3].restSec).toBe(60);
  const ex = await exOf(page);
  expect(ex[3].estSec).toBe(600 - 30 * (ex[3].plannedSets - 1));
});

test('undone adjustment while under target shows the info banner with Re-apply', async ({ page }) => {
  const s = activeSession({ startedMinAgo: 30, over: {} });
  s.adjustments = [{ ...adjDrop(s.exercises[4].id), undone: true }];
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  const info = page.locator('.banner.info');
  await expect(info).toContainText('Adjustment undone');
  await expect(page.locator('.banner.error')).toHaveCount(0);
  await info.getByRole('button', { name: 'Re-apply' }).click();
  await expect.poll(async () => (await exOf(page))[4].status).toBe('dropped');
  await expect(page.locator('.banner.warn')).toBeVisible();
});

test('interplay: manual add-back of an auto-dropped exercise counts as undone and can be re-applied', async ({ page }) => {
  const s = activeSession();
  s.exercises[4].status = 'dropped';
  s.adjustments = [adjDrop(s.exercises[4].id)];
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  await page.locator('.group .li').nth(4).getByRole('button', { name: 'Add back' }).click();
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  await page.locator('.banner.error').getByRole('button', { name: 'Re-apply' }).click();
  await expect.poll(async () => (await exOf(page))[4].status).toBe('dropped');
  await expect(page.locator('.banner.warn')).toBeVisible();
});

test('interplay: manual drop then re-apply of an undone drop keeps it dropped, no double counting', async ({ page }) => {
  const s = activeSession();
  s.adjustments = [{ ...adjDrop(s.exercises[4].id), undone: true }];
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  await page.locator('.group .li').nth(4).getByRole('button', { name: 'Drop' }).click();
  await expect(page.locator('.card .t-num').nth(1)).toContainText('62');
  await page.locator('.banner').getByRole('button', { name: 'Re-apply' }).first().click();
  await expect.poll(async () => (await exOf(page))[4].status).toBe('dropped');
  await expect(page.locator('.card .t-num').nth(1)).toContainText('62');
});

test('warm-up phase: up-first row, remaining warm-up counted, back goes to warm-up', async ({ page }) => {
  const s = activeSession({ noSets: true, startedMinAgo: 4, phase: 'warmup', over: { warmupEndedAt: undefined } });
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  await expect(page.locator('.group .li').first()).toContainText('Up first · 3 sets');
  await expect(page.getByText(/Warm-up 4:0\d \/ 10:00/)).toBeVisible();
  await page.getByRole('link', { name: 'Close overview' }).click();
  await expect(page).toHaveURL(/session\/warmup$/);
});

test('skipped rows are struck and navigation targets work', async ({ page }) => {
  const s = activeSession();
  s.exercises[3].status = 'skipped';
  await seed(page, { sessions: [s] });
  await page.goto('session/plan');
  const row = page.locator('.group .li').nth(3);
  await expect(row).toHaveClass(/struck/);
  await expect(row).toContainText('Skipped');
  await page.getByRole('link', { name: 'Back to workout' }).click();
  await expect(page).toHaveURL(/session\/live$/);
  await page.goto('session/plan');
  await page.getByRole('link', { name: 'Finish session now' }).click();
  await expect(page).toHaveURL(/session\/end$/);
  await page.goto('session/plan');
  await page.getByRole('link', { name: 'Close overview' }).click();
  await expect(page).toHaveURL(/session\/live$/);
  await page.goto('session/plan');
  await page.locator('.group a.li').click();
  await expect(page).toHaveURL(/session\/live$/);
});

test('no horizontal overflow at 360px and 375x667', async ({ page }) => {
  await seed(page, { sessions: [activeSession()] });
  for (const [w, h] of [[360, 800], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('session/plan');
    await expect(page.getByText('Session overview')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
