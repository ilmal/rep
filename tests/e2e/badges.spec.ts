import { test, expect, seed, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';
import { NOW, week } from './streak-seed';

const SHOTS = (process.env.SHOTS_DIR ?? 'test-results/shots');
async function open(page: Page, o: SeedOpts = {}) {
  await page.clock.install({ time: new Date(NOW) });
  await seed(page, { ...o, settings: { weeklyGoal: 2, ...(o.settings ?? {}) } });
  await page.goto('streak/badges');
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png`, fullPage: true });
const prog = () => ({ sessions: [...week(3, 2), ...week(2, 2), ...week(1, 2), ...week(0, 1)] });
const badge = (page: Page, name: string) => page.locator('button.bd', { has: page.locator('.bn', { hasText: new RegExp(`^${name}$`) }) });

test.describe('Badges', () => {
  test('empty state: nothing unlocked, 18 badges in 4 categories with progress', async ({ page, errors }) => {
    await open(page);
    await expect(page.locator('.title', { hasText: 'Badges' })).toBeVisible();
    await expect(page.getByTestId('badge-count')).toHaveText('0 / 18');
    await expect(page.getByText('badges unlocked · next: 2 weeks (2 weeks)')).toBeVisible();
    await expect(page.locator('button.bd')).toHaveCount(18);
    for (const c of ['Streaks', 'Consistency', 'Strength', 'Explorer']) await expect(page.getByRole('group', { name: c })).toBeVisible();
    await expect(page.locator('button.bd[data-got="true"]')).toHaveCount(0);
    await expect(page.locator('.bd .medal.lock').first()).toBeVisible();
    await expect(page.locator('.bd .mini').first()).toBeVisible();
    await expect(page.getByText(/^\d+ \/ \d+ (weeks|sessions|PRs|exercises)$/).first()).toBeVisible();
    await shot(page, 'badges-empty');
    expect(errors).toEqual([]);
  });

  test('progress state: unlocked badges show a date, locked show n / m', async ({ page }) => {
    await open(page, prog());
    const got = page.locator('button.bd[data-got="true"]');
    await expect(got.first()).toBeVisible();
    const n = await got.count();
    await expect(page.getByTestId('badge-count')).toHaveText(`${n} / 18`);
    await expect(page.getByText('badges unlocked · next: One month (1 week)')).toBeVisible();
    await expect(badge(page, '2 weeks').locator('.bs')).toHaveText(/^\d{1,2} [A-Z][a-z]{2}$/);
    await expect(badge(page, '2 weeks')).toHaveAttribute('aria-label', /^2 weeks, unlocked \d/);
    await expect(badge(page, 'One month')).toContainText('3 / 4 weeks');
    await expect(badge(page, 'One month')).toHaveAttribute('aria-label', 'One month, 3 of 4');
    await expect(badge(page, 'One month').locator('.mini i')).toHaveAttribute('style', /width: 75%/);
    await expect(badge(page, 'First session')).toHaveAttribute('data-got', 'true');
    await shot(page, 'badges-progress');
  });

  test('All / Unlocked toggle filters and hides empty categories', async ({ page }) => {
    await open(page, prog());
    const all = page.getByRole('button', { name: 'All', exact: true });
    const unl = page.getByRole('button', { name: 'Unlocked', exact: true });
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect(unl).toHaveAttribute('aria-pressed', 'false');
    await unl.click();
    await expect(unl).toHaveAttribute('aria-pressed', 'true');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    const n = await page.locator('button.bd[data-got="true"]').count();
    await expect(page.locator('button.bd')).toHaveCount(n);
    await expect(page.locator('button.bd[data-got="false"]')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Strength' })).toHaveCount(0); // nothing unlocked there yet
    await all.click();
    await expect(page.locator('button.bd')).toHaveCount(18);
  });

  test('Unlocked with nothing unlocked shows a friendly note', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Unlocked', exact: true }).click();
    await expect(page.locator('button.bd')).toHaveCount(0);
    await expect(page.getByText('No badges unlocked yet.')).toBeVisible();
  });

  test('sheet: open, close via Got it, scrim and Escape; focus returns', async ({ page }) => {
    await open(page, prog());
    const opener = badge(page, 'One month');
    await opener.click();
    const dlg = page.getByRole('dialog', { name: 'Badge' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('heading', { name: 'One month' })).toBeVisible();
    await expect(dlg).toContainText('4-week streak.');
    await expect(dlg).toContainText('3 / 4 weeks');
    await expect(dlg.getByRole('button', { name: 'Got it' })).toBeFocused();
    await shot(page, 'badges-sheet-locked');
    await dlg.getByRole('button', { name: 'Got it' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await page.locator('button.scrim').click({ position: { x: 10, y: 10 } });
    await expect(dlg).toHaveCount(0);

    await badge(page, '2 weeks').click();
    await expect(dlg).toContainText('Hit your goal two weeks in a row.');
    await expect(dlg.locator('.tag.green')).toContainText(/^Unlocked \d/);
    await expect(dlg.locator('.medal.big.got')).toBeVisible();
  });

  test('sheet traps Tab focus inside the dialog', async ({ page }) => {
    await open(page, prog());
    await badge(page, 'Blaze').click();
    const dlg = page.getByRole('dialog', { name: 'Badge' });
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
  });

  test('back goes to the streak page', async ({ page }) => {
    await open(page);
    await page.getByRole('link', { name: 'Back to streak' }).click();
    await expect(page).toHaveURL(/\/streak$/);
  });

  test('not onboarded redirects to welcome', async ({ page }) => {
    await seed(page, { onboarded: false });
    await page.goto('streak/badges');
    await expect(page).toHaveURL(/\/welcome/);
  });

  for (const w of [375, 360]) {
    test(`no horizontal overflow at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await open(page, prog());
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(o).toBeLessThanOrEqual(0);
      await shot(page, 'badges-layout');
    });
  }
});
