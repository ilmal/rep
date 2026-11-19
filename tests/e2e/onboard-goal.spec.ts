import { test, expect, seed, readState } from './fixtures';

const HINTS: Record<number, string> = {
  1: 'A light week. Every session counts.', 2: 'Good for maintenance.', 3: 'Solid, balanced progress.', 4: 'Recommended. Room to hit every area.',
  5: 'High volume. Recovery matters.', 6: 'Very high volume.', 7: 'Every day. Mix in prehab and mobility.',
};
const wiz = (page: any) => page.evaluate(() => JSON.parse(sessionStorage.getItem('rep-onboarding-v1') || 'null'));

test.beforeEach(async ({ page }) => { await seed(page, { onboarded: false, gyms: null, areas: null }); await page.goto('onboarding/goal'); });

test('defaults and static copy', async ({ page, errors }) => {
  await expect(page.getByRole('heading', { name: 'Your weekly goal' })).toBeVisible();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByText('No fixed days. Train whenever, and the week counter fills up. You can change this anytime.')).toBeVisible();
  await expect(page.locator('.t-num')).toHaveText('4');
  await expect(page.getByText(HINTS[4])).toBeVisible();
  await expect(page.locator('.segs span.now')).toHaveCount(4);
  await expect(page.locator('.topbar .segs span')).toHaveCount(3);
  await expect(page.locator('.topbar .segs span.on')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '60 min' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.val.sm')).toHaveText('10min');
  await expect(page.getByLabel(/first name/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('every goal 1-7 shows its hint, dots and bounds', async ({ page }) => {
  const dec = page.getByRole('button', { name: 'Fewer sessions' }), inc = page.getByRole('button', { name: 'More sessions' });
  for (let i = 0; i < 3; i++) await dec.click();
  await expect(page.locator('.t-num')).toHaveText('1');
  await expect(dec).toBeDisabled();
  for (let g = 1; g <= 7; g++) {
    await expect(page.locator('.t-num')).toHaveText(String(g));
    await expect(page.getByText(HINTS[g], { exact: true })).toBeVisible();
    await expect(page.locator('.segs span.now')).toHaveCount(g);
    if (g < 7) await inc.click();
  }
  await expect(inc).toBeDisabled();
  expect((await wiz(page)).goal).toBe(7);
});

test('target minute chips', async ({ page }) => {
  for (const m of [45, 75, 90, 60]) {
    await page.getByRole('button', { name: `${m} min` }).click();
    await expect(page.getByRole('button', { name: `${m} min` })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.seg.c4 button.on')).toHaveCount(1);
    expect((await wiz(page)).targetMinutes).toBe(m);
  }
});

test('warm-up stepper bounds 0 and 30', async ({ page }) => {
  const sh = page.getByRole('button', { name: 'Shorter warm-up' }), lo = page.getByRole('button', { name: 'Longer warm-up' });
  await sh.click();
  await expect(page.locator('.val.sm')).toHaveText('9min');
  for (let i = 0; i < 9; i++) await sh.click();
  await expect(page.locator('.val.sm')).toHaveText('0min');
  await expect(sh).toBeDisabled();
  for (let i = 0; i < 30; i++) await lo.click();
  await expect(page.locator('.val.sm')).toHaveText('30min');
  await expect(lo).toBeDisabled();
  expect((await wiz(page)).warmupMinutes).toBe(30);
});

test('choices survive reload, Continue and Back', async ({ page }) => {
  await page.getByRole('button', { name: 'More sessions' }).click();
  await page.getByRole('button', { name: 'More sessions' }).click();
  await page.getByRole('button', { name: '90 min' }).click();
  await page.getByRole('button', { name: 'Longer warm-up' }).click();
  await page.reload();
  await expect(page.locator('.t-num')).toHaveText('6');
  await expect(page.getByText(HINTS[6], { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '90 min' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.val.sm')).toHaveText('11min');
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/onboarding\/gyms$/);
  await page.goBack();
  await expect(page).toHaveURL(/onboarding\/goal$/);
  await expect(page.locator('.t-num')).toHaveText('6');
  await expect(page.getByRole('button', { name: '90 min' })).toHaveAttribute('aria-pressed', 'true');
});

test('Back goes to welcome', async ({ page }) => {
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/welcome$/);
});

test('375px: no horizontal overflow, controls usable', async ({ page }) => {
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 667 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(page.getByRole('link', { name: 'Continue' })).toBeVisible();
  await page.getByRole('button', { name: 'More sessions' }).click();
  await expect(page.locator('.t-num')).toHaveText('5');
  const box = await page.getByRole('button', { name: 'More sessions' }).boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test('not-onboarded state is untouched in the store', async ({ page }) => {
  await page.getByRole('button', { name: 'More sessions' }).click();
  expect((await readState(page)).settings.onboarded).toBe(false);
});
