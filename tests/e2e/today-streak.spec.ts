// Today × streak: every state of the home screen that the streak system adds (Main, StreakRisk, StreakRepair, WeekDone boards).
// Clock is pinned; history is replayed from seeded sessions (the streak is derived, nothing derived is stored).
import { test, expect, seed, placedSession, readState, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';
import type { Session } from '../../src/shared/types';

const SHOTS = (process.env.SHOTS_DIR ?? 'test-results/shots');
// Mon 16 Nov 2026 = ISO week 47 (local time). `day` may be <= 0 / > 30 (Date rolls over).
const at = (day: number, h = 18, m = 0) => new Date(2026, 10, day, h, m).getTime();
const MON47 = at(16, 0);
const MON46 = at(9, 0);

/** `counts` = sessions per week, oldest → newest; the LAST entry is the week starting Monday `lastMonday` (Nov day number). */
function history(lastMonday: number, counts: number[]): Session[] {
  const out: Session[] = [];
  counts.forEach((c, idx) => {
    const mon = lastMonday - 7 * (counts.length - 1 - idx);
    for (let i = 0; i < c; i++) out.push(placedSession({ slot: (i % 4) + 1, endMs: at(mon + i, 18) }));
  });
  return out;
}
/** `n` sessions of week 47 (Mon, Tue, …). */
const week47 = (n: number): Session[] => history(16, [n]);
/** 7 weeks of 4 (weeks 40–46) before this one: a 7-week streak holding one freeze. */
const streak7 = () => history(9, Array(7).fill(4));

async function go(page: Page, now: number, o: SeedOpts = {}) {
  await page.clock.install({ time: new Date(now) });
  await seed(page, o);
  await page.goto('');
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/today-${name}-${page.viewportSize()!.width}.png` });
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
async function narrow(page: Page, name: string) {
  await shot(page, name); await noOverflow(page);
  await page.setViewportSize({ width: 375, height: 667 }); await shot(page, name); await noOverflow(page);
  await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(page);
  await page.setViewportSize({ width: 440, height: 956 });
}
const chip = (page: Page) => page.locator('a.schip');

test.describe('header chip', () => {
  test('normal: real streak number, plain, links to /streak', async ({ page, errors }) => {
    await go(page, at(17, 10), { sessions: [...streak7(), ...week47(1)] });
    await expect(chip(page)).toHaveAttribute('aria-label', '7-week streak');
    await expect(chip(page)).toHaveText('7');
    await expect(chip(page)).not.toHaveClass(/ring/);
    await expect(chip(page).locator('.ic-flame-fill')).toHaveCount(1);
    await chip(page).click();
    await expect(page).toHaveURL(/\/streak$/);
    expect(errors).toEqual([]);
  });

  test('zero streak and never had one: no chip, banner, risk or lost card', async ({ page, errors }) => {
    await go(page, at(17, 10), { sessions: [...history(9, [2]), ...week47(1)] });
    await expect(page.getByRole('heading', { name: 'Hi Alex' })).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByText(/-week streak/)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toHaveCount(0);
    await expect(page.getByText('New streak starts today')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'On track' })).toBeVisible();
    await narrow(page, 'zero-streak');
    expect(errors).toEqual([]);
  });

  test('first home has no chip', async ({ page }) => {
    await go(page, at(17, 10));
    await expect(page.getByRole('heading', { name: 'Welcome, Alex' })).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Profile and settings' })).toBeVisible();
  });
});

test.describe('normal week with a streak', () => {
  test('banner: sessions left, next streak number and the freeze it earns', async ({ page, errors }) => {
    await go(page, at(17, 10), { sessions: [...streak7(), ...week47(1)] });
    const banner = page.getByRole('link', { name: /7-week streak\. 3 more sessions this week makes it 8 and earns a freeze\./ });
    await expect(banner).toBeVisible();
    await expect(page.getByText('3 sessions left before Sunday. No set days.')).toBeVisible();
    await expect(page.locator('.wdn')).toHaveText(['16', '17', '18', '19', '20', '21', '22']);
    await narrow(page, 'normal');
    await banner.click();
    await expect(page).toHaveURL(/\/streak$/);
    expect(errors).toEqual([]);
  });

  test('banner: singular, and no freeze when the week would not earn one', async ({ page }) => {
    // 6 weeks of 4: counted 6 -> this week is the 7th, the next freeze comes with the 8th
    await go(page, at(17, 10), { sessions: [...history(9, Array(6).fill(4)), ...week47(3)] });
    await expect(page.getByText(/6-week streak\. 1 more session this week makes it 7\./)).toBeVisible();
    await expect(page.getByText(/earns a freeze/)).toHaveCount(0);
  });

  test('banner does not promise a freeze when two are already held (earn would be wasted)', async ({ page }) => {
    // 11 straight weeks of 4: counted 11 -> two freezes held (earned at 4 and 8); the 12th week would earn a third, wasted at the cap
    await go(page, at(17, 10), { sessions: [...history(9, Array(11).fill(4)), ...week47(1)] });
    await expect(page.getByText(/11-week streak\. 3 more sessions this week makes it 12\./)).toBeVisible();
    await expect(page.getByText(/earns a freeze/)).toHaveCount(0);
  });
});

test.describe('streak at risk', () => {
  test('Wednesday 0/4: card, chip ring, slim next-session card, plan text', async ({ page, errors }) => {
    await go(page, at(18, 10), { sessions: streak7() });
    const risk = page.getByRole('region', { name: 'Streak at risk' });
    await expect(risk).toBeVisible();
    await expect(page.getByText('Wednesday, 18 November')).toBeVisible();
    await expect(risk.getByText('Your 7-week streak is at risk')).toBeVisible();
    await expect(risk.getByText('0 of 4 done · 5 days left')).toBeVisible();
    await expect(chip(page)).toHaveAttribute('aria-label', '7-week streak, at risk');
    await expect(chip(page)).toHaveClass(/ring/);
    await expect(chip(page).locator('.ic-flame-fill')).toHaveCount(1);
    await expect(risk.getByText('4 days picked, starting today. That gets you to 4/4 and an 8-week streak.')).toBeVisible();
    await expect(risk.getByText('Plan your week · tap days')).toBeVisible();
    await expect(risk.locator('.day')).toHaveCount(5);
    await expect(risk.locator('.day span')).toHaveText(['Today', 'Thu', 'Fri', 'Sat', 'Sun']);
    await expect(risk.locator('.day b')).toHaveText(['18', '19', '20', '21', '22']);
    await expect(risk.getByRole('button', { name: /Start session \d now/ })).toBeEnabled();
    await expect(risk.getByRole('button', { name: '30-min express' })).toBeVisible();
    await expect(risk.getByRole('button', { name: 'Use a freeze' })).toBeVisible();
    // slim next-session card, no week card, no start button inside it
    const next = page.getByRole('region', { name: 'Next session' });
    await expect(next.getByText(/^Up next · Session \d$/)).toBeVisible();
    await expect(next.getByText(/≈ \d+ min · or 30 min express/)).toBeVisible();
    await expect(next.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'This week' })).toHaveCount(0);
    await narrow(page, 'risk');
    expect(errors).toEqual([]);
  });

  test('day toggles: copy follows the artboard logic exactly', async ({ page }) => {
    await go(page, at(18, 10), { sessions: streak7() });
    const risk = page.getByRole('region', { name: 'Streak at risk' });
    const days = risk.getByRole('button', { name: /^(Today|Thu|Fri|Sat|Sun) \d+$/ });
    await expect(days).toHaveCount(5);
    await expect(days.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(days.nth(4)).toHaveAttribute('aria-pressed', 'false');
    await days.nth(0).click(); // drop today -> 3 picked
    await expect(risk.getByText('Pick 1 more day to reach 4. Only 2 left to choose from.')).toBeVisible();
    await days.nth(4).click(); // Sun -> 4 picked but not today
    await expect(risk.getByText(/Picked 4 days but not today, so there.s no room for a missed day\. Starting today is safer\./)).toBeVisible();
    await days.nth(0).click(); // today back -> 5 picked
    await expect(risk.getByText('5 days picked, starting today. That gets you to 4/4 and an 8-week streak.')).toBeVisible();
    await days.nth(1).click(); await days.nth(2).click(); await days.nth(3).click(); await days.nth(4).click(); // only today
    await expect(risk.getByText('Pick 3 more days to reach 4. Only 4 left to choose from.')).toBeVisible();
    // local UI state only: nothing was written
    expect((await readState(page)).settings.manualFreezeWeeks ?? []).toEqual([]);
  });

  test('tight on Thursday after one session, last chance on Friday', async ({ page }) => {
    await go(page, at(19, 10), { sessions: [...streak7(), ...week47(1)] }); // left 3, 4 days left = tight
    await expect(page.getByText('1 of 4 done · 4 days left')).toBeVisible();
    const p2 = await (await page.context().browser()!.newContext({ viewport: { width: 440, height: 956 } })).newPage();
    await p2.clock.install({ time: new Date(at(20, 10)) }); // Friday: left 3 (1 done), 3 days left = last chance
    await seed(p2, { sessions: [...streak7(), ...week47(1)] });
    await p2.goto('');
    await expect(p2.getByText('1 of 4 done · 3 days left')).toBeVisible();
    await expect(p2.locator('.day')).toHaveCount(3);
    await expect(p2.getByText('Pick 0 more days')).toHaveCount(0);
    await expect(p2.getByText('3 days picked, starting today. That gets you to 4/4 and an 8-week streak.')).toBeVisible();
  });

  test('last day: one day left, one session left', async ({ page }) => {
    await go(page, at(22, 9), { sessions: [...streak7(), ...week47(3)] });
    const risk = page.getByRole('region', { name: 'Streak at risk' });
    await expect(risk.getByText('3 of 4 done · 1 day left')).toBeVisible();
    await expect(risk.locator('.day')).toHaveCount(1);
    await expect(risk.getByText('1 day picked, starting today. That gets you to 4/4 and an 8-week streak.')).toBeVisible();
    await noOverflow(page);
  });

  test('cannot reach the goal any more (Sunday 1/4): still offers a freeze, never guilt', async ({ page, errors }) => {
    await go(page, at(22, 9), { sessions: [...streak7(), ...week47(1)] });
    const risk = page.getByRole('region', { name: 'Streak at risk' });
    await expect(risk.getByText('1 of 4 done · 1 day left')).toBeVisible();
    await expect(risk.getByText(/Can.t reach 4 this week/)).toBeVisible();
    await expect(risk.getByRole('button', { name: 'Use a freeze' })).toBeVisible();
    await expect(page.getByText(/guilt|lazy|fail/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('start now goes to the preview with the planned session', async ({ page, errors }) => {
    await go(page, at(18, 10), { sessions: streak7() });
    await page.getByRole('region', { name: 'Streak at risk' }).getByRole('button', { name: /Start session \d now/ }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    const st = await readState(page);
    expect(st.device.draft.exercises.length).toBeGreaterThan(0);
    expect(st.device.draft.targetMin).toBe(60);
    expect(errors).toEqual([]);
  });

  test('30-min express: preview plans against 30 min, and Today forgets the one-off when shown again', async ({ page, errors }) => {
    await go(page, at(18, 10), { sessions: streak7() });
    await page.getByRole('button', { name: '30-min express' }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    await expect(page.getByText(/\/ 30 min/)).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.draft?.targetMin).toBe(30);
    const st = await readState(page);
    expect(st.device.draft.exercises.length).toBeGreaterThan(0);
    expect(st.settings.targetMinutes).toBe(60); // the one-off never touches the setting
    // a 30 min plan has fewer exercises than the 60 min one, and the budget bar does not say "Over"
    await expect(page.getByText(/Over by/)).toHaveCount(0);
    const express = st.device.draft.exercises.length;
    await page.goBack();
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.draft.targetMin).toBe(60);
    const normal = (await readState(page)).device.draft.exercises.length;
    expect(express).toBeLessThan(normal);
    expect(errors).toEqual([]);
  });

  test('freeze: confirm card, keep it, use it, frozen card, undo', async ({ page, errors }) => {
    await go(page, at(18, 10), { sessions: streak7() });
    const risk = page.getByRole('region', { name: 'Streak at risk' });
    await risk.getByRole('button', { name: 'Use a freeze' }).click();
    const confirm = risk.getByRole('group', { name: 'Confirm freeze' });
    await expect(confirm.getByText('Use your only freeze on this week?')).toBeVisible();
    await expect(confirm.getByText(/Your streak is safe even at 0\/4\. You'll have no freeze left until week \d+\. Starting a session today is usually the better deal\./)).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep it' }).click();
    await expect(confirm).toHaveCount(0);
    expect((await readState(page)).settings.manualFreezeWeeks ?? []).toEqual([]);
    await risk.getByRole('button', { name: 'Use a freeze' }).click();
    await page.getByRole('button', { name: 'Use freeze' }).click();
    // frozen card replaces the risk card
    const frozen = page.getByRole('region', { name: 'Week frozen' });
    await expect(frozen).toBeVisible();
    await expect(frozen.getByText('Week frozen. Streak safe')).toBeVisible();
    await expect(frozen.getByText(/^\d+ weeks · 0 freezes left$/)).toBeVisible();
    await expect(frozen.getByText('Sessions this week still count toward your rotation and progress. Changed your mind? Hit 4 and the freeze is refunded.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toHaveCount(0);
    await expect(chip(page)).not.toHaveClass(/ring/);
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([MON47]);
    // normal home underneath: week card + full next session card with a start button
    await expect(page.getByRole('region', { name: 'This week' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start session \d/ })).toBeVisible();
    await narrow(page, 'frozen');
    await frozen.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toBeVisible();
    await expect(frozen).toHaveCount(0);
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('no freeze left: the freeze button is hidden and express fills the row', async ({ page }) => {
    await go(page, at(18, 10), { sessions: history(9, [4, 4, 4]) }); // 3 weeks: no freeze earned yet
    const risk = page.getByRole('region', { name: 'Streak at risk' });
    await expect(risk.getByText('Your 3-week streak is at risk')).toBeVisible();
    await expect(risk.getByRole('button', { name: 'Use a freeze' })).toHaveCount(0);
    await expect(risk.getByRole('button', { name: '30-min express' })).toBeVisible();
    await noOverflow(page);
  });

  test('a secured week is never at risk; a streak of 0 is never at risk', async ({ page }) => {
    await go(page, at(22, 9), { sessions: [...streak7(), ...week47(4)] });
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toHaveCount(0);
    await expect(page.getByText('Weekly goal reached')).toBeVisible();
  });
});

test.describe('streak repair', () => {
  // Week 46 was 3/4 after 7 good weeks; now it is Monday of week 48... the missed week is week 47.
  const missedLastWeek = () => [...history(9, [...Array(7).fill(4)]), ...week47(3)];

  test('Monday: save card, options, radio, CTA to start', async ({ page, errors }) => {
    await go(page, at(23, 10), { sessions: missedLastWeek() });
    await expect(page.getByText('Monday, 23 November · Week 48')).toBeVisible();
    const card = page.getByRole('region', { name: 'Save your streak' });
    await expect(card.getByText('Save your 7-week streak')).toBeVisible();
    await expect(card.getByText('Last week: 3 of 4 · one session short')).toBeVisible();
    await expect(card.getByText(/Do 5 sessions this week: your 4, plus 1 to make up for last week\. Both weeks count and your streak keeps going\./)).toBeVisible();
    await expect(card.locator('.segs span')).toHaveCount(5);
    await expect(card.locator('.segs span.make')).toHaveCount(1);
    await expect(card.getByText('0 of 5 · 7 days left')).toBeVisible();
    await expect(card.getByText('Make-up session')).toBeVisible();
    await expect(chip(page)).toHaveAttribute('aria-label', '7-week streak, on the line');
    await expect(chip(page)).toHaveClass(/ring/);
    await expect(chip(page).locator('.ic-flame')).toHaveCount(1);
    await expect(chip(page).locator('.ic-flame-fill')).toHaveCount(0);
    await expect(page.getByText('How do you want to keep it?')).toBeVisible();
    const repair = page.getByRole('radio', { name: /Repair it: 5 sessions this week/ });
    const freeze = page.getByRole('radio', { name: /Use a freeze on last week/ });
    await expect(repair).toHaveAttribute('aria-checked', 'true');
    await expect(freeze).toHaveAttribute('aria-checked', 'false');
    await expect(repair).toContainText('Keeps your freeze for a real week off. Unlocks the Comeback badge.');
    await expect(freeze).toContainText(/Back to a normal 4 this week\. 0 freezes left until week \d+\./);
    await expect(page.getByText('If you don’t reach 5 by Sunday, your freeze is used automatically, so the streak still survives.')).toBeVisible();
    // no week card / next-session card on this board
    await expect(page.getByRole('region', { name: 'This week' })).toHaveCount(0);
    await narrow(page, 'repair');
    await page.getByRole('button', { name: /^Start session \d now$/ }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    expect((await readState(page)).settings.manualFreezeWeeks ?? []).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('progress: sessions done this week fill the segments', async ({ page }) => {
    await go(page, at(24, 10), { sessions: [...missedLastWeek(), placedSession({ slot: 1, endMs: at(23, 8) })] });
    const card = page.getByRole('region', { name: 'Save your streak' });
    await expect(card.getByText('1 of 5 · 6 days left')).toBeVisible();
    await expect(card.locator('.segs span.on')).toHaveCount(1);
  });

  test('freeze option: applies to the MISSED week, shows frozen card, undo brings the repair back', async ({ page, errors }) => {
    await go(page, at(23, 10), { sessions: missedLastWeek() });
    await page.getByRole('radio', { name: /Use a freeze on last week/ }).click();
    await expect(page.getByRole('radio', { name: /Use a freeze on last week/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Last week becomes frozen and the streak continues\. You need 4 this week to make it \d+\./)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start session/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Use freeze' }).click();
    await expect(page.getByRole('region', { name: 'Save your streak' })).toHaveCount(0);
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([MON47]); // the missed week, not week 48
    const frozen = page.getByRole('region', { name: 'Last week frozen' });
    await expect(frozen.getByText('Last week frozen. Streak safe')).toBeVisible();
    await expect(page.getByRole('region', { name: 'This week' })).toBeVisible();
    await expect(page.getByText(/0 of 4|0\/4/).first()).toBeVisible();
    await frozen.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('region', { name: 'Save your streak' })).toBeVisible();
    await expect.poll(async () => (await readState(page)).settings.manualFreezeWeeks).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('no freeze held: only the repair option, with the honest fallback note', async ({ page }) => {
    await go(page, at(23, 10), { sessions: [...history(9, [4, 4, 4]), ...week47(3)] });
    const card = page.getByRole('region', { name: 'Save your streak' });
    await expect(card.getByText('Save your 3-week streak')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: /Use a freeze/ })).toHaveCount(0);
    await expect(page.getByText(/the streak starts over\. Your best stays\./)).toBeVisible();
    await expect(page.getByText(/your freeze is used automatically/)).toHaveCount(0);
  });

  test('deficit 2 on a day the make-up no longer fits: only the freeze is offered', async ({ page }) => {
    // 2/4 last week -> needs 6 this week; Friday (3 days left) cannot do 6
    await go(page, at(27, 10), { sessions: [...history(9, Array(7).fill(4)), ...week47(2)] });
    const card = page.getByRole('region', { name: 'Save your streak' });
    await expect(card.getByText('Last week: 2 of 4 · two sessions short')).toBeVisible();
    await expect(card.getByText('Make-up sessions')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Repair it/ })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: /Use a freeze on last week/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Use freeze' })).toBeVisible();
    await noOverflow(page);
  });

  test('repair impossible and no freeze: nothing to offer, no risk card either', async ({ page, errors }) => {
    await go(page, at(27, 10), { sessions: [...history(9, [4, 4, 4]), ...week47(2)] });
    await expect(page.getByRole('heading', { name: 'Hi Alex' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Save your streak' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Next session' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('repair done (5 of 5 reached): week done, repair card gone', async ({ page }) => {
    await go(page, at(27, 10), { sessions: [...history(9, Array(7).fill(4)), ...week47(3), ...history(23, [4]), placedSession({ slot: 1, endMs: at(27, 8) })] });
    await expect(page.getByRole('region', { name: 'Save your streak' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Weekly goal reached' })).toBeVisible();
  });
});

test.describe('lost streak', () => {
  // 2 weeks of 4, then a week with nothing: reset (no freeze, deficit 4), best stays 2
  const lost = () => history(9, [4, 4, 0]);

  test('gentle banner with best, chip shows 0, no risk/repair', async ({ page, errors }) => {
    await go(page, at(18, 10), { sessions: lost() });
    await expect(page.getByText('New streak starts today. Your best is 2.')).toBeVisible();
    await expect(chip(page)).toHaveText('0');
    await expect(chip(page)).toHaveAttribute('aria-label', '0-week streak');
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Save your streak' })).toHaveCount(0);
    await expect(page.getByText(/-week streak\./)).toHaveCount(0);
    await expect(page.getByText(/guilt|behind|missed|lost/i)).toHaveCount(0);
    await narrow(page, 'lost');
    expect(errors).toEqual([]);
  });

  test('dismiss hides it for this week and survives a reload', async ({ page, errors }) => {
    await go(page, at(18, 10), { sessions: lost() });
    await expect(page.getByText('New streak starts today. Your best is 2.')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('New streak starts today')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('rep-streak-lost-dismissed'))).toBe(String(MON47));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hi Alex' })).toBeVisible();
    await expect(page.getByText('New streak starts today')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a blocked localStorage never breaks the screen', async ({ page, errors }) => {
    await page.addInitScript(() => { const bad = () => { throw new Error('blocked'); }; try { Storage.prototype.getItem = new Proxy(Storage.prototype.getItem, { apply: (t, th, a) => (a[0] === 'rep-streak-lost-dismissed' ? bad() : Reflect.apply(t, th, a)) }); } catch { /* ignore */ } });
    await go(page, at(18, 10), { sessions: history(9, [4, 4, 0]) });
    await expect(page.getByText('New streak starts today. Your best is 2.')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('week secured', () => {
  const secured = () => [...streak7(), ...week47(4)];

  test('goal reached: ring check, copy, strip, 8-week streak card -> celebrate when unseen', async ({ page, errors }) => {
    await go(page, at(19, 21), { sessions: secured() });
    await expect(page.getByRole('heading', { name: 'Weekly goal reached' })).toBeVisible();
    await expect(page.getByRole('img', { name: '4 of 4 sessions, goal reached' })).toBeVisible();
    await expect(page.locator('.wd.trained')).toHaveCount(4);
    await expect(chip(page)).toHaveCount(0); // WeekDone board: the streak card carries it
    const card = page.getByRole('link', { name: /8-week streak.*Tap to celebrate\./ });
    await expect(card).toBeVisible();
    await expect(card).toContainText('New badge and +1 freeze. Tap to celebrate.');
    await expect(card).toHaveAttribute('href', /\/streak\/celebrate$/);
    await expect(page.locator('.stat-v')).toHaveCount(3);
    await expect(page.getByText('Feeling good? Rotation continues')).toBeVisible();
    await expect(page.getByText("This would be session 5 this week. It counts toward the rotation, not next week's goal.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Week recap' })).toHaveAttribute('aria-expanded', 'true');
    await narrow(page, 'week-done');
    await card.click();
    await expect(page).toHaveURL(/\/streak\/celebrate$/);
    expect(errors).toEqual([]);
  });

  test('already celebrated: the card goes to the streak page', async ({ page }) => {
    await go(page, at(19, 21), { sessions: secured(), settings: { streakLastCelebrated: MON47 } });
    const card = page.getByRole('link', { name: /8-week streak/ });
    await expect(card).toContainText(/Week secured\. Next badge at 12 weeks\./);
    await expect(card).toHaveAttribute('href', /\/streak$/);
    await card.click();
    await expect(page).toHaveURL(/\/streak$/);
  });

  test('recap rows open the session; collapse hides them; real stat numbers', async ({ page }) => {
    const s = secured();
    await go(page, at(19, 21), { sessions: s });
    const row = page.getByRole('link', { name: /Upper body.*Mon/ });
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: 'Week recap' }).click();
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: 'Week recap' }).click();
    const first = s.filter((x) => x.endedAt! >= MON47).sort((a, b) => a.endedAt! - b.endedAt!)[0];
    await page.getByRole('link', { name: /Upper body.*Mon/ }).click();
    await expect(page).toHaveURL(new RegExp(`/history/${first.id}$`));
  });

  test('a first-ever secured week (1-week streak) says so', async ({ page }) => {
    await go(page, at(19, 21), { sessions: week47(4) });
    await expect(page.getByRole('link', { name: /1-week streak/ })).toBeVisible();
  });
});

test.describe('priority and layout', () => {
  test('repair beats risk; only one streak card at a time', async ({ page }) => {
    // Monday after a 3/4 week: pace is not "at risk" yet and the repair card owns the screen
    await go(page, at(23, 10), { sessions: [...history(9, Array(7).fill(4)), ...week47(3)] });
    await expect(page.getByRole('region', { name: 'Save your streak' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Streak at risk' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /frozen/i })).toHaveCount(0);
    await expect(page.getByText('New streak starts today')).toHaveCount(0);
  });

  test('week-done start bonus session still works with a streak', async ({ page, errors }) => {
    await go(page, at(19, 21), { sessions: [...streak7(), ...week47(4)] });
    await page.getByRole('button', { name: 'Start bonus session' }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    expect(errors).toEqual([]);
  });
});
