import { test, expect, seed, readState, makeAreas, makeSession } from './fixtures';
import { activeSession, IDS } from './x-active';
import { nextSlot, weekCount, completed } from '../../src/shared/rules';

const areas = makeAreas();
/** One finished session today (slot 1) + the running one (slot 2, seq 2). */
const prior = () => makeSession({ id: 'prior', seq: 1, slot: 1, areaId: areas[0].id, areaName: areas[0].name, daysAgo: 0.02, exerciseIds: IDS });
const running = () => activeSession({ seq: 2, slot: 2 });
const all = async (page: any) => Object.values((await readState(page)).sessions) as any[];
const act = async (page: any) => (await readState(page)).sessions['act-1'];
const sheet = (page: any) => page.getByRole('dialog', { name: 'End session early' });

test.beforeEach(async ({ page }) => { await seed(page, { sessions: [prior(), running()] }); await page.goto('session/end'); });

test('sheet copy: counts, week counter, next-up and defaults', async ({ page, errors }) => {
  const sh = sheet(page);
  await expect(sh.getByRole('heading', { name: 'End session early?' })).toBeVisible();
  await expect(sh.getByText(/^3 of 5 exercises done · 45 min · 2 not started$/)).toBeVisible();
  const goal = (await readState(page)).settings.weeklyGoal;
  await expect(sh.getByText(`Counts this week (2/${goal}). Next up: session 3.`)).toBeVisible();
  await expect(sh.getByText(`Save, but repeat session 2 next`)).toBeVisible();
  await expect(sh.getByText(`Counts this week. Rotation stays on ${areas[1].name}.`)).toBeVisible();
  await expect(sh.getByText('Deletes logged sets. Doesn’t count.')).toBeVisible();
  await expect(sh.getByRole('radio', { name: /Save as completed/ })).toHaveAttribute('aria-checked', 'true');
  await expect(sh.getByText('Why? (optional, helps planning)')).toBeVisible();
  await expect(sh.locator('.chip')).toHaveText(['Out of time', 'Low energy', 'Pain / niggle', 'Gym too busy', 'Other']);
  await expect(sh.getByRole('button', { name: 'End & save' })).toHaveClass(/btn-primary/);
  // the dimmed screen behind shows the current exercise
  await expect(page.getByRole('heading', { name: 'Exercise' }).or(page.locator('h1.t-display'))).toContainText(/\w/);
  expect(errors).toEqual([]);
});

test('radio selection swaps the CTA between End & save and Discard session', async ({ page }) => {
  const sh = sheet(page);
  await sh.getByRole('radio', { name: /Discard session/ }).click();
  await expect(sh.getByRole('radio', { name: /Discard session/ })).toHaveAttribute('aria-checked', 'true');
  await expect(sh.getByRole('radio', { name: /Save as completed/ })).toHaveAttribute('aria-checked', 'false');
  await expect(sh.getByRole('button', { name: 'Discard session', exact: true }).last()).toHaveClass(/btn-danger/);
  await sh.getByRole('radio', { name: /repeat session 2/ }).click();
  await expect(sh.getByRole('button', { name: 'End & save' })).toHaveClass(/btn-primary/);
});

test('Save as completed: counted, partial exercises finalised, pointer advances, summary opens', async ({ page }) => {
  await sheet(page).getByRole('button', { name: 'End & save' }).click();
  await expect(page).toHaveURL(/session\/summary\/act-1$/);
  await expect.poll(async () => (await act(page)).status).toBe('completed');
  const s = await act(page);
  expect(s.endedEarly).toBe(true);
  expect(s.repeatNext).toBe(false);
  expect(s.endReason).toBeUndefined();
  expect(s.endedAt).toBeGreaterThan(s.startedAt);
  expect(s.exercises.map((e: any) => e.status)).toEqual(['done', 'done', 'done', 'skipped', 'skipped']);
  expect(s.exercises[2].sets).toHaveLength(1); // logged set kept
  const list = await all(page);
  expect(weekCount(list, Date.now())).toBe(2);
  expect(nextSlot(list, 4)).toBe(3);
  expect((await readState(page)).device.draft).toBeNull();
});

test('Save but repeat: counted, repeatNext set, rotation pointer stays on this slot', async ({ page }) => {
  await sheet(page).getByRole('radio', { name: /repeat session 2/ }).click();
  await sheet(page).getByRole('button', { name: 'End & save' }).click();
  await expect(page).toHaveURL(/session\/summary\/act-1$/);
  await expect.poll(async () => (await act(page)).status).toBe('completed');
  const s = await act(page);
  expect(s.repeatNext).toBe(true);
  expect(s.endedEarly).toBe(true);
  const list = await all(page);
  expect(weekCount(list, Date.now())).toBe(2);
  expect(nextSlot(list, 4)).toBe(2); // stays on slot 2, not 3
  // Next session after that one completes normally moves on again
  expect(nextSlot([...list.filter((x) => x.id !== 'act-1'), { ...s, repeatNext: false }], 4)).toBe(3);
});

test('Discard: not counted, nothing completes, pointer unchanged, lands on Today', async ({ page }) => {
  await sheet(page).getByRole('radio', { name: /Discard session/ }).click();
  await sheet(page).getByRole('button', { name: 'Discard session', exact: true }).last().click();
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect.poll(async () => (await act(page)).status).toBe('discarded');
  const list = await all(page);
  expect(completed(list).map((x) => x.id)).toEqual(['prior']);
  expect(weekCount(list, Date.now())).toBe(1);
  expect(nextSlot(list, 4)).toBe(2); // slot 2 is still next
  expect(list.some((x) => x.status === 'active')).toBe(false);
  expect((await act(page)).repeatNext).toBeFalsy();
  // no ghost redirect to /resume after discarding
  await page.reload();
  await expect(page).not.toHaveURL(/resume/);
});

test('reason chips toggle, are stored on the saved session in pick order', async ({ page }) => {
  const sh = sheet(page);
  const chip = (n: string) => sh.getByRole('button', { name: n, exact: true });
  await chip('Low energy').click();
  await chip('Out of time').click();
  await chip('Pain / niggle').click();
  await expect(chip('Low energy')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Low energy')).toHaveClass(/on/);
  await chip('Pain / niggle').click(); // toggle off
  await expect(chip('Pain / niggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('Gym too busy')).toHaveAttribute('aria-pressed', 'false');
  await sh.getByRole('button', { name: 'End & save' }).click();
  await expect(page).toHaveURL(/summary/);
  await expect.poll(async () => (await act(page)).endReason).toEqual(['Low energy', 'Out of time']);
});

test('reason chips also saved with repeat and with discard', async ({ page }) => {
  const sh = sheet(page);
  await sh.getByRole('button', { name: 'Other', exact: true }).click();
  await sh.getByRole('radio', { name: /Discard session/ }).click();
  await sh.getByRole('button', { name: 'Discard session', exact: true }).last().click();
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect.poll(async () => (await act(page)).endReason).toEqual(['Other']);
});

test('Keep training and the scrim return without changing anything', async ({ page }) => {
  await page.goto('session/plan');
  await page.getByRole('link', { name: 'Finish session now' }).click();
  await expect(page).toHaveURL(/session\/end$/);
  await sheet(page).getByRole('button', { name: 'Keep training' }).click();
  await expect(page).toHaveURL(/session\/plan$/);
  await page.getByRole('link', { name: 'Finish session now' }).click();
  await page.locator('button.scrim').click({ position: { x: 20, y: 20 } });
  await expect(page).toHaveURL(/session\/plan$/);
  expect((await act(page)).status).toBe('active');
});

test('no active session: the end screen is not reachable (guard sends you to Today)', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 440, height: 956 } });
  const p2 = await ctx.newPage();
  await seed(p2, { sessions: [prior()] });
  await p2.goto('session/end');
  await expect(p2).toHaveURL(/\/app\/?$/);
  await expect(p2.getByRole('dialog', { name: 'End session early' })).toHaveCount(0);
  await ctx.close();
});

test('no horizontal overflow at 360px and 375x667', async ({ page }) => {
  for (const [w, h] of [[360, 800], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('session/end');
    await expect(sheet(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(sheet(page).getByRole('button', { name: 'Keep training' })).toBeInViewport();
  }
});
