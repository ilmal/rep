import { test, expect, seed, readState, makeAreas, makeSession } from './fixtures';
import type { Page } from '@playwright/test';

const DEF = { wRelevance: 1, wRecency: 1.2, wFrequency: 0.6, wCoverage: 0.8, wVariety: 0.7, wFavorite: 0.5, cooldownSessions: 1, minDaysBetween: 2, freshDays: 14, windowDays: 28, muscleOverdueDays: 10, jitter: 0.2 };
const planner = async (page: Page) => (await readState(page)).settings.planner;
const order = (page: Page) => page.locator('.group').first().locator('a.li').locator('.li-t').allTextContents();
const hrefs = (page: Page) => page.locator('.group').first().locator('a.li').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!.split('/').pop()!));
const area0 = makeAreas()[0];
const slide = async (page: Page, name: string, key: 'Home' | 'End') => { const s = page.getByRole('slider', { name, exact: true }); await s.focus(); await page.keyboard.press(key); await s.blur(); };
const area1 = makeAreas()[1];
const recent = () => [makeSession({ id: 's1', seq: 1, slot: 1, areaId: area0.id, areaName: area0.name, daysAgo: 10, exerciseIds: area1.poolExerciseIds.slice(0, 3) })];

test('layout, copy and explanation of banned/paused', async ({ page, errors }) => {
  await seed(page);
  await page.goto('plan/planner');
  await expect(page.locator('.topbar .title')).toHaveText('Planner & scoring');
  await expect(page.getByText(/Banned and paused exercises are never picked/)).toBeVisible();
  for (const t of ['Top picks for next session', 'Weights', 'Timing']) await expect(page.getByText(t, { exact: true })).toBeVisible();
  await expect(page.locator('.section-h', { hasText: 'Muscle coverage' })).toBeVisible();
  for (const w of ['Relevance', 'Recency', 'Frequency', 'Muscle coverage', 'Variety', 'Favorites']) await expect(page.getByRole('slider', { name: w === 'Muscle coverage' ? 'Muscle coverage weight' : `${w} weight` })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Randomness' })).toBeVisible();
  expect((await order(page)).length).toBeGreaterThan(0);
  expect((await order(page)).length).toBeLessThanOrEqual(8);
  await expect(page.getByText(/^Upper body at City Gym Odenplan\./)).toBeVisible();
  await expect(page.getByText('Finish a session and this shows which muscles are due.')).toBeVisible();
  await page.setViewportSize({ width: 360, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
  expect(errors).toEqual([]);
});

test('every weight slider writes its planner key (full range 0..5) and persists', async ({ page }) => {
  await seed(page);
  await page.goto('plan/planner');
  const keys: [string, string][] = [['Relevance weight', 'wRelevance'], ['Recency weight', 'wRecency'], ['Frequency weight', 'wFrequency'], ['Muscle coverage weight', 'wCoverage'], ['Variety weight', 'wVariety'], ['Favorites weight', 'wFavorite']];
  for (const [label, k] of keys) {
    await slide(page, label, 'End');
    await expect.poll(async () => (await planner(page))[k]).toBe(5);
    await slide(page, label, 'Home');
    await expect.poll(async () => (await planner(page))[k]).toBe(0);
  }
  await expect(page.getByText('0.0 · Off').first()).toBeVisible();
  await slide(page, 'Randomness', 'End');
  await expect.poll(async () => (await planner(page)).jitter).toBe(2);
  await expect(page.getByText('2.00 · Wild')).toBeVisible();
  await slide(page, 'Randomness', 'Home');
  await expect.poll(async () => (await planner(page)).jitter).toBe(0);
  await expect(page.getByText('0.00 · Deterministic')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('slider', { name: 'Recency weight' })).toHaveValue('0');
  expect(await planner(page)).toMatchObject({ wRelevance: 0, wFavorite: 0, jitter: 0 });
});

test('timing steppers: step, bounds, disabled ends, persistence', async ({ page }) => {
  await seed(page);
  await page.goto('plan/planner');
  const cases: [string, string, number, number, number][] = [
    ['Cooldown', 'cooldownSessions', 0, 10, 1], ['Min days between', 'minDaysBetween', 0, 30, 1], ['Fresh after', 'freshDays', 1, 90, 1],
    ['History window', 'windowDays', 7, 180, 7], ['Muscle overdue after', 'muscleOverdueDays', 2, 60, 1],
  ];
  for (const [label, k, min, max, step] of cases) {
    const dec = page.getByRole('button', { name: `Decrease ${label}` }), inc = page.getByRole('button', { name: `Increase ${label}` });
    const start = DEF[k as keyof typeof DEF];
    await inc.click();
    await expect.poll(async () => (await planner(page))[k]).toBe(start + step);
    await dec.click(); await dec.click();
    await expect.poll(async () => (await planner(page))[k]).toBe(Math.max(min, start - step));
    for (let i = 0; i < 12 && await dec.isEnabled(); i++) await dec.click();
    await expect(dec).toBeDisabled();
    await expect.poll(async () => (await planner(page))[k]).toBe(min);
    for (let i = 0; i < 100 && await inc.isEnabled(); i++) await inc.click();
    await expect(inc).toBeDisabled();
    await expect.poll(async () => (await planner(page))[k]).toBe(max);
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'Increase Muscle overdue after' })).toBeDisabled();
  expect(await planner(page)).toMatchObject({ cooldownSessions: 10, minDaysBetween: 30, freshDays: 90, windowDays: 180, muscleOverdueDays: 60 });
});

test('knob changes alter the live top-picks preview order', async ({ page }) => {
  await seed(page, { sessions: recent(), settings: { planner: { ...DEF, cooldownSessions: 0, minDaysBetween: 0 } } });
  await page.goto('plan/planner');
  const base = await hrefs(page);
  expect(base.length).toBeGreaterThan(2);
  // ignore recency/frequency/coverage entirely: recently done exercises no longer sink
  for (const w of ['Recency weight', 'Frequency weight', 'Muscle coverage weight']) await slide(page, w, 'Home');
  await expect.poll(async () => (await hrefs(page)).join()).not.toBe(base.join());
  const flat = await hrefs(page);
  // and turning recency way up changes it again
  await slide(page, 'Recency weight', 'End');
  await expect.poll(async () => (await hrefs(page)).join()).not.toBe(flat.join());
  // scores shown are real numbers
  await expect(page.locator('.group').first().locator('a.li').first()).toContainText(/\d/);
});

test('favorites weight lifts a starred exercise up the preview', async ({ page }) => {
  const star = area0.poolExerciseIds[area0.poolExerciseIds.length - 1];
  await seed(page, { prefs: { [star]: { exerciseId: star, favorite: true, avoid: false, relevance: 50 } } });
  await page.goto('plan/planner');
  await slide(page, 'Favorites weight', 'Home');
  await expect.poll(async () => (await planner(page)).wFavorite).toBe(0);
  const low = (await hrefs(page)).indexOf(star);
  await slide(page, 'Favorites weight', 'End');
  await expect.poll(async () => (await planner(page)).wFavorite).toBe(5);
  await expect.poll(async () => (await hrefs(page)).indexOf(star)).not.toBe(low);
  expect((await hrefs(page)).indexOf(star)).toBeLessThan(low === -1 ? 99 : low);
});

test('banned and paused exercises never appear in the preview', async ({ page }) => {
  const [ban, pauseT, pauseS] = area0.poolExerciseIds;
  const P = (id: string, o: object) => ({ exerciseId: id, favorite: true, avoid: false, relevance: 100, ...o });
  await seed(page, { prefs: { [ban]: P(ban, { avoid: true }), [pauseT]: P(pauseT, { pausedUntil: Date.now() + 7 * 86400000 }), [pauseS]: P(pauseS, { pausedSessions: 2 }) } });
  await page.goto('plan/planner');
  const ids = await hrefs(page);
  expect(ids.length).toBeGreaterThan(0);
  for (const id of [ban, pauseT, pauseS]) expect(ids).not.toContain(id);
  await expect(page.getByText(/3 banned or paused exercises are left out/)).toBeVisible();
});

test('reset restores every default and is disabled at defaults', async ({ page }) => {
  await seed(page, { settings: { planner: { ...DEF, wRecency: 3, cooldownSessions: 4, jitter: 0.9, windowDays: 56 } } });
  await page.goto('plan/planner');
  const reset = page.getByRole('button', { name: 'Reset to defaults' });
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect.poll(() => planner(page)).toEqual(DEF);
  await expect(reset).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Recency weight' })).toHaveValue('1.2');
  await page.reload();
  await expect(reset).toBeDisabled();
});

test('muscle coverage list from history, overdue tags follow the threshold', async ({ page }) => {
  await seed(page, { sessions: recent(), settings: { planner: { ...DEF, muscleOverdueDays: 5 } } });
  await page.goto('plan/planner');
  await expect(page.getByText('Finish a session')).toHaveCount(0);
  const rows = page.locator('.group').last().locator('.li');
  expect(await rows.count()).toBeGreaterThan(3);
  await expect(rows.first()).toContainText(/ago|Today|Never/);
  const due = () => page.locator('.group').last().locator('.tag.accent', { hasText: 'Due' }).count();
  const before = await due();
  expect(before).toBeGreaterThan(0);
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Increase Muscle overdue after' }).click();
  await expect.poll(async () => (await planner(page)).muscleOverdueDays).toBe(12);
  // trained 10 days ago is no longer overdue at 12 days; never-trained muscles stay due
  await expect.poll(due).toBeLessThan(before);
});

test('empty states: no rotation / back button / pick links to the exercise', async ({ page }) => {
  await seed(page, { areas: null });
  await page.goto('plan/planner');
  await expect(page.getByText('Add an area to your rotation to see a preview.')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
});

test('pick row navigates to the exercise detail', async ({ page }) => {
  await seed(page);
  await page.goto('plan/planner');
  const id = (await hrefs(page))[0];
  await page.locator('.group').first().locator('a.li').first().click();
  await expect(page).toHaveURL(new RegExp(`/library/${id}$`));
});
