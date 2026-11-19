import { test, expect, seed, makeSession, makeAreas, readState, DAY } from './fixtures';
import { weekStart } from '../../src/shared/rules';

const A = makeAreas();
const WS = weekStart(Date.now());
let n = 0;
/** `count` completed sessions in the week `w` weeks before this one (this week: just past Monday 00:00, so never in the future) */
function week(w: number, count: number) {
  return Array.from({ length: count }, (_, k) => {
    const s = makeSession({ id: `w${w}-${k}-${++n}`, seq: ++n, slot: 1, areaId: A[0].id, areaName: A[0].name, daysAgo: 0, exerciseIds: ['back_squat'] });
    const end = w === 0 ? WS + (k + 1) * 60_000 : WS - w * 7 * DAY + k * DAY + 10 * 3600_000;
    return { ...s, startedAt: end - 3600_000, endedAt: end, updatedAt: end };
  });
}
const weeks = (counts: number[]) => counts.flatMap((c, i) => week(counts.length - 1 - i, c)); // oldest first, last = this week
const count = (page: import('@playwright/test').Page) => page.getByTestId('streak-count');

test.describe('StreakCelebrate', () => {
  test('milestone (8 weeks): flame, count-up 7 to 8, badge + freeze + next tier rows, CTAs', async ({ page, errors }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await expect(count(page)).toHaveText('7');
    await expect(count(page)).toHaveAttribute('aria-live', 'polite');
    await expect(count(page)).toHaveText('8', { timeout: 3000 });
    await expect(page.getByRole('heading', { name: 'week streak!' })).toBeVisible();
    await expect(page.getByText('4 of 4 this week. Two months of showing up, any day you liked.')).toBeVisible();
    await expect(page.getByText('Badge unlocked')).toBeVisible();
    await expect(page.getByText('Two months strong')).toBeVisible();
    await expect(page.getByText('+1 streak freeze')).toBeVisible();
    await expect(page.getByText(/^2 of 2\. You're covered for two weeks off\.$/)).toBeVisible();
    await expect(page.getByText('Next tier: Blaze at 12 weeks')).toBeVisible();
    await expect(page.getByText('4 weeks to go · best ever: 8')).toBeVisible();
    await expect(page.locator('.fillbar.accent')).toHaveCSS('width', /^\d/);
    expect(await page.locator('.fillbar.accent').evaluate((e) => (e as HTMLElement).style.width)).toBe('67%');
    await expect(page.locator('.conf')).toHaveCount(24);
    await expect(page.getByRole('link', { name: 'Keep it going' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'See your streak' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('plain week: no badge and no freeze rows', async ({ page }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await expect(count(page)).toHaveText('6', { timeout: 3000 });
    await expect(page.getByText('Six weeks of showing up, any day you liked.')).toBeVisible();
    await expect(page.getByText('Badge unlocked')).toHaveCount(0);
    await expect(page.getByText('+1 streak freeze')).toHaveCount(0);
    await expect(page.getByText('Next tier: Blaze at 12 weeks')).toBeVisible();
    await expect(page.getByText('6 weeks to go · best ever: 6')).toBeVisible();
  });

  test('repair: "Streak saved" and the Comeback badge', async ({ page }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 3, 5]) });
    await page.goto('streak/celebrate');
    await expect(page.getByRole('heading', { name: 'Streak saved' })).toBeVisible();
    await expect(count(page)).toHaveText('5');
    await expect(count(page)).toHaveText('7', { timeout: 3000 });
    await expect(page.getByText('Badge unlocked')).toBeVisible();
    await expect(page.getByText('Comeback')).toBeVisible();
    await expect(page.getByText(/made up the missed sessions/)).toBeVisible();
  });

  test('shows once: marks the week celebrated, a reload goes to the streak page', async ({ page }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await expect(page.getByRole('heading', { name: 'week streak!' })).toBeVisible();
    await expect.poll(async () => (await readState(page)).settings.streakLastCelebrated).toBe(WS);
    await page.reload();
    await expect(page).toHaveURL(/\/streak$/);
    await expect(page.getByText('week streak!')).toHaveCount(0);
  });

  test('nothing to celebrate: redirects to /streak', async ({ page }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 1]) });
    await page.goto('streak/celebrate');
    await expect(page).toHaveURL(/\/streak$/);
    expect((await readState(page)).settings.streakLastCelebrated).toBeUndefined();
  });

  test('no sessions at all: redirects to /streak', async ({ page }) => {
    await seed(page, { sessions: [] });
    await page.goto('streak/celebrate');
    await expect(page).toHaveURL(/\/streak$/);
  });

  test('reduced motion: final count at once, no confetti, no pop animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await expect(count(page)).toHaveText('8');
    await expect(page.locator('.conf').first()).toBeHidden();
    await expect(page.locator('.bigflame')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.rw').first()).toHaveCSS('animation-name', 'none');
  });

  test('Keep it going leads to Today', async ({ page }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await page.getByRole('link', { name: 'Keep it going' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test('See your streak leads to the streak page', async ({ page }) => {
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await page.getByRole('link', { name: 'See your streak' }).click();
    await expect(page).toHaveURL(/\/streak$/);
  });

  test('375px: no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 667 });
    await seed(page, { sessions: weeks([4, 4, 4, 4, 4, 4, 4, 4]) });
    await page.goto('streak/celebrate');
    await expect(page.getByText('Badge unlocked')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
