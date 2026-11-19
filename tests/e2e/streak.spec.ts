import { test, expect, seed, readState, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';
import { NOW, MON, week } from './streak-seed';

const SHOTS = (process.env.SHOTS_DIR ?? 'test-results/shots');
const GOAL2 = { weeklyGoal: 2 };

async function open(page: Page, o: SeedOpts = {}, path = 'streak') {
  await page.clock.install({ time: new Date(NOW) });
  await seed(page, { ...o, settings: { ...GOAL2, ...(o.settings ?? {}) } });
  await page.goto(path);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png`, fullPage: true });
const num = (page: Page) => page.getByTestId('streak-num');

test.describe('Streak: empty / new user', () => {
  test('friendly empty state keeps the full layout', async ({ page, errors }) => {
    await open(page);
    await expect(page.getByRole('heading', { name: 'Streak' }).or(page.locator('.title', { hasText: 'Streak' }))).toBeVisible();
    await expect(num(page)).toHaveText('0');
    await expect(page.getByText('Best 0')).toBeVisible();
    await expect(page.getByText('No streak yet')).toBeVisible();
    await expect(page.getByText('Start your streak', { exact: true })).toBeVisible();
    await expect(page.getByText('Hit your goal this week.')).toBeVisible();
    await expect(page.getByText('Reward for 2/2')).toBeVisible();
    await expect(page.getByText('1-week streak', { exact: true })).toBeVisible();
    await expect(page.getByText('0 of 2')).toBeVisible();
    await expect(page.getByLabel('Empty freeze slot')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /use a freeze/i })).toHaveCount(0); // nothing to protect
    await expect(page.locator('.wkc')).toHaveCount(1);
    await expect(page.locator('.wkc > span').last()).toHaveText('Now');
    await expect(page.locator('.mbadge')).toHaveCount(6);
    await shot(page, 'streak-empty');
    expect(errors).toEqual([]);
  });
});

test.describe('Streak: in progress', () => {
  const o = () => ({ sessions: [...week(3, 2), ...week(2, 2), ...week(1, 2), ...week(0, 1)] });

  test('hero, make-it card and pace', async ({ page }) => {
    await open(page, o());
    await expect(num(page)).toHaveText('3');
    await expect(page.getByText('week streak', { exact: true })).toBeVisible();
    await expect(page.getByText('Spark · tier 1')).toBeVisible();
    await expect(page.getByText('Best 3')).toBeVisible();
    await expect(page.getByText('Make it 4 this week')).toBeVisible();
    await expect(page.getByText('Tight', { exact: true })).toBeVisible();
    await expect(page.getByText('1 more in 2 days. Train today to keep a rest day.')).toBeVisible();
    await expect(page.locator('.segs span')).toHaveCount(2);
    await expect(page.locator('.segs span.now')).toHaveCount(1);
    await expect(page.getByText('Reward for 2/2')).toBeVisible();
    await expect(page.getByText('4-week streak', { exact: true })).toBeVisible();
    await expect(page.getByText('+1 streak freeze (every 4 weeks)')).toBeVisible(); // 3 counted + this one = 4
    await expect(page.getByText(/Badge:/)).toBeVisible(); // 4 weeks is the next milestone
    await expect(page.getByText('Next at week 4.')).toBeVisible();
    await shot(page, 'streak-progress');
  });

  test('milestone strip reflects real progress and links to badges', async ({ page }) => {
    await open(page, o());
    const cards = page.locator('.mbadge');
    await expect(cards).toHaveCount(6);
    await expect(cards.nth(0)).toHaveAttribute('data-state', 'got');
    await expect(cards.nth(0)).toContainText('Got it');
    await expect(cards.nth(1)).toHaveAttribute('data-state', 'next');
    await expect(cards.nth(1)).toContainText('3 / 4 weeks');
    await expect(cards.nth(2)).toHaveAttribute('data-state', 'lock');
    await page.getByRole('link', { name: 'All badges', exact: true }).first().click();
    await expect(page).toHaveURL(/\/streak\/badges$/);
  });

  test('navigation: back to Today, trophy to badges, History link', async ({ page }) => {
    await open(page, o());
    await page.getByRole('link', { name: 'All badges' }).first().click(); // trophy (aria-label) or text link
    await expect(page).toHaveURL(/streak\/badges/);
    await page.goBack();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/history$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Back to Today' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test('freeze control is hidden when the streak is not at risk (secured week)', async ({ page }) => {
    await open(page, { sessions: [...week(3, 2), ...week(2, 2), ...week(1, 2), ...week(0, 2)] });
    await expect(num(page)).toHaveText('4');
    await expect(page.getByText('Week secured', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Reward for/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /use a freeze/i })).toHaveCount(0);
  });

  test('best above current is kept after a reset', async ({ page }) => {
    // 3 hit weeks, then 2 empty weeks (deficit 2 unrepaired, no freeze) -> streak resets, best stays 3
    await open(page, { sessions: [...week(6, 2), ...week(5, 2), ...week(4, 2)] });
    await expect(num(page)).toHaveText('0');
    await expect(page.getByText('Best 3')).toBeVisible();
    await expect(page.locator('.wkc')).toHaveCount(7);
    await expect(page.locator('.wk .w-miss .ic-x').first()).toBeVisible();
  });
});

test.describe('Streak: grid with repaired + frozen weeks', () => {
  // 4 hit weeks, 1 short + repaired, a fully missed week whose repair fails (auto freeze), a 1-short week repaired again
  const o = () => ({ sessions: [...week(9, 2), ...week(8, 2), ...week(7, 2), ...week(6, 2), ...week(5, 1), ...week(4, 3), ...week(2, 1), ...week(1, 3)] });

  test('statuses, icons and labels', async ({ page }) => {
    await open(page, o());
    const grid = page.locator('.wk');
    await expect(grid.locator('.w-hit').first()).toBeVisible();
    await expect(grid.locator('.w-rep')).toHaveCount(2);
    await expect(grid.locator('.w-rep .ic-wrench')).toHaveCount(2);
    await expect(grid.locator('.w-frz')).toHaveCount(1);
    await expect(grid.locator('.w-frz .ic-snow')).toHaveCount(1);
    await expect(grid.locator('.w-now .ic-flame')).toHaveCount(1);
    await expect(grid.locator('.wkc > span').last()).toHaveText('Now');
    await expect(grid.locator('.wkc > span').first()).toHaveText(/^W\d+$/);
    await expect(grid).toHaveAttribute('aria-label', /9-week streak, 2 repaired and 1 frozen weeks/);
    await expect(page.getByText('Goal hit')).toBeVisible();
    await expect(page.getByText('Repaired', { exact: true })).toBeVisible();
    await expect(page.getByText('Frozen', { exact: true })).toBeVisible();
    await expect(page.getByText('Missed', { exact: true })).toBeVisible();
    await shot(page, 'streak-grid');
  });
});

test.describe('Streak: freeze use, undo and refund', () => {
  // 4 hit weeks -> 1 freeze held; nothing done on Saturday of a goal-2 week -> last chance
  const o = () => ({ sessions: [...week(4, 2), ...week(3, 2), ...week(2, 2), ...week(1, 2)] });

  test('use a freeze (confirm card), undo it', async ({ page, errors }) => {
    await open(page, o());
    await expect(num(page)).toHaveText('4');
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect(page.getByLabel('Freeze available')).toHaveCount(1);
    await expect(page.getByText('Last chance')).toBeVisible();
    await page.getByRole('button', { name: 'Use a freeze this week' }).click();
    const confirm = page.getByRole('group', { name: 'Confirm freeze' });
    await expect(confirm).toContainText('Use your only freeze on this week?');
    await expect(confirm).toContainText('You\'ll have no freeze left until week 8.');
    await shot(page, 'streak-freeze-confirm');
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(confirm).toHaveCount(0);
    expect((await readState(page)).settings.manualFreezeWeeks ?? []).toEqual([]);

    await page.getByRole('button', { name: 'Use a freeze this week' }).click();
    await page.getByRole('button', { name: 'Use freeze' }).click();
    await expect(page.getByText('Week frozen. Streak safe')).toBeVisible();
    await expect(page.getByText('Week frozen', { exact: true })).toBeVisible();
    await expect(page.getByText(/Reward for/)).toHaveCount(0);
    await expect(page.getByText('0 of 2')).toBeVisible();
    await expect(page.getByLabel('Freeze available')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use a freeze this week' })).toHaveCount(0);
    await expect(page.getByText('Changed your mind? Hit 2 and the freeze is refunded.')).toBeVisible();
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([MON]);
    await shot(page, 'streak-frozen');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Week frozen. Streak safe')).toHaveCount(0);
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a frozen week refunds the freeze when the goal is hit anyway', async ({ page }) => {
    await open(page, { sessions: [...o().sessions, ...week(0, 2)], settings: { manualFreezeWeeks: [MON] } });
    await expect(page.getByText('1 of 2')).toBeVisible();
    await expect(page.getByLabel('Freeze available')).toHaveCount(1);
    await expect(page.getByText('Week secured', { exact: true }).first()).toBeVisible();
  });

  test('freeze persists across reload', async ({ page }) => {
    await open(page, o());
    await page.getByRole('button', { name: 'Use a freeze this week' }).click();
    await page.getByRole('button', { name: 'Use freeze' }).click();
    await expect(page.getByText('Week frozen. Streak safe')).toBeVisible();
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([MON]);
    await page.reload();
    await expect(page.getByText('Week frozen. Streak safe')).toBeVisible();
  });

  test('with two freezes the confirm copy counts them', async ({ page }) => {
    // 8 hit weeks -> 2 freezes
    const s = [8, 7, 6, 5, 4, 3, 2, 1].flatMap((k) => week(k, 2));
    await open(page, { sessions: s });
    await expect(page.getByText('2 of 2')).toBeVisible();
    await expect(page.getByText('You’re holding the maximum.')).toBeVisible();
    await page.getByRole('button', { name: 'Use a freeze this week' }).click();
    const c = page.getByRole('group', { name: 'Confirm freeze' });
    await expect(c).toContainText('Use one of your 2 freezes on this week?');
    await expect(c).toContainText('1 freeze left');
  });
});

test.describe('Streak: how it works accordion', () => {
  test('one rule open at a time with aria-expanded', async ({ page }) => {
    await open(page);
    const rules = page.locator('.group .li');
    await expect(rules).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(rules.nth(i)).toHaveAttribute('aria-expanded', 'false');
    await rules.nth(0).click();
    await expect(rules.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Any days you like. Extra sessions count too.')).toBeVisible();
    await rules.nth(1).click();
    await expect(rules.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(rules.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Make up the missing sessions on top of')).toBeVisible();
    await expect(page.getByText('Any days you like.')).toHaveCount(0);
    await rules.nth(1).click();
    await expect(rules.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await rules.nth(3).click();
    await expect(page.getByText('never after 21:00.')).toBeVisible();
    await rules.nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(rules.nth(3)).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Streak: guard + layout', () => {
  test('not onboarded redirects to welcome', async ({ page }) => {
    await seed(page, { onboarded: false });
    await page.goto('streak');
    await expect(page).toHaveURL(/\/welcome/);
  });

  for (const w of [375, 360]) {
    test(`no horizontal overflow at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      const s = [...week(9, 2), ...week(8, 2), ...week(7, 2), ...week(6, 2), ...week(5, 1), ...week(4, 3), ...week(2, 1), ...week(1, 3)];
      await open(page, { sessions: s });
      const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, body: document.body.scrollWidth - window.innerWidth }));
      expect(o.doc).toBeLessThanOrEqual(0);
      expect(o.body).toBeLessThanOrEqual(0);
      await shot(page, 'streak-layout');
    });
  }
});
