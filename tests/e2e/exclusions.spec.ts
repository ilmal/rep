import { seed, makeAreas, makeSession, readState, test, expect, DAY } from './fixtures';
import type { ExercisePref } from '../../src/shared/types';

const P = (exerciseId: string, o: Partial<ExercisePref> = {}): ExercisePref => ({ exerciseId, favorite: false, avoid: false, relevance: 50, ...o });
const FOREVER = 8.64e15;

function prefs(): Record<string, ExercisePref> {
  const t = Date.now();
  return {
    ohp: P('ohp', { pausedUntil: t + 10 * DAY }),
    db_curl: P('db_curl', { pausedUntil: FOREVER, notes: 'elbow' }),
    dips: P('dips', { pausedSessions: 1 }),
    lateral_raise: P('lateral_raise', { pausedUntil: t - DAY }), // expired -> ready
    pullup: P('pullup', { avoid: true, notes: 'shoulder', updatedAt: Date.now() }),
    face_pull: P('face_pull', { avoid: true, pausedUntil: FOREVER }), // banned wins
    back_squat: P('back_squat', { favorite: true }),
    bench_press: P('bench_press', { favorite: true }),
    hip_thrust: P('hip_thrust', { favorite: true, pausedUntil: t + 3 * DAY }), // fav + paused
  };
}
const rows = (page: import('@playwright/test').Page) => page.getByTestId('row');
const tabBtn = (page: import('@playwright/test').Page, n: string) => page.getByRole('button', { name: new RegExp(`^${n} \\d+$`) });

test.describe('Exclusions: lists', () => {
  test.beforeEach(async ({ page }) => { await seed(page, { prefs: prefs() }); await page.goto('library/exclusions'); });

  test('counts, default tab and per-status rows', async ({ page }) => {
    await expect(page.getByText('Your exercise preferences')).toBeVisible();
    await expect(tabBtn(page, 'Paused')).toHaveText('Paused 4');
    await expect(tabBtn(page, 'Banned')).toHaveText('Banned 2');
    await expect(tabBtn(page, 'Favourites')).toHaveText('Favourites 3');
    await expect(tabBtn(page, 'Paused')).toHaveAttribute('aria-pressed', 'true');
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).filter({ hasText: 'Overhead press' })).toContainText(/Until \d+ \w{3}/);
    await expect(rows(page).filter({ hasText: 'Dumbbell curl' })).toContainText('Until resumed · elbow');
    await expect(rows(page).filter({ hasText: 'Dips' })).toContainText('Next session');
    await expect(rows(page).filter({ hasText: 'Lateral raise' })).toHaveCount(0);
    await expect(rows(page).filter({ hasText: 'Cable face pull' })).toHaveCount(0);
    await expect(page.getByText('Temporarily unavailable.')).toBeVisible();
  });

  test('banned tab', async ({ page }) => {
    await tabBtn(page, 'Banned').click();
    await expect(page).toHaveURL(/tab=banned/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: 'Pull-up' })).toContainText(/Banned \d+ \w{3} · shoulder/);
    await expect(rows(page).filter({ hasText: 'Cable face pull' })).toBeVisible();
    await expect(page.getByText('Never planned, generated or offered as a swap.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ban an exercise' })).toHaveAttribute('href', /library\/all/);
  });

  test('favourites tab shows muscle and areas', async ({ page }) => {
    await tabBtn(page, 'Favourites').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).filter({ hasText: 'Back squat' })).toContainText('Quads');
    await expect(rows(page).filter({ hasText: 'Back squat' })).toContainText('Lower body');
    await expect(rows(page).filter({ hasText: 'Bench press' })).toContainText('Upper body');
  });

  test('row link opens exercise detail; back goes to library', async ({ page }) => {
    await rows(page).filter({ hasText: 'Overhead press' }).getByRole('link').click();
    await expect(page).toHaveURL(/library\/ohp$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page).toHaveURL(/library$/);
  });

  test('resume, unban, unfavourite mutate state; Undo restores', async ({ page }) => {
    await page.getByRole('button', { name: 'Resume Overhead press' }).click();
    await expect(page.getByRole('status')).toContainText('Overhead press resumed');
    await expect(tabBtn(page, 'Paused')).toHaveText('Paused 3');
    await expect.poll(async () => (await readState(page)).prefs.ohp.pausedUntil).toBeUndefined();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(tabBtn(page, 'Paused')).toHaveText('Paused 4');
    await expect.poll(async () => (await readState(page)).prefs.ohp.pausedUntil).toBeGreaterThan(Date.now());

    await tabBtn(page, 'Banned').click();
    await page.getByRole('button', { name: 'Unban Pull-up' }).click();
    await expect(page.getByRole('status')).toContainText('unbanned');
    await expect(tabBtn(page, 'Banned')).toHaveText('Banned 1');
    await expect.poll(async () => (await readState(page)).prefs.pullup.avoid).toBe(false);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(tabBtn(page, 'Banned')).toHaveText('Banned 2');

    await tabBtn(page, 'Favourites').click();
    await page.getByRole('button', { name: 'Remove Back squat' }).click();
    await expect(page.getByRole('status')).toContainText('Back squat removed from favourites');
    await expect(tabBtn(page, 'Favourites')).toHaveText('Favourites 2');
    await expect.poll(async () => (await readState(page)).prefs.back_squat.favorite).toBe(false);
    await expect(page.getByRole('status')).toBeHidden({ timeout: 6000 }); // toast auto-dismisses
  });

  test('unbanning a banned+paused exercise leaves it paused (not lost)', async ({ page }) => {
    await tabBtn(page, 'Banned').click();
    await page.getByRole('button', { name: 'Unban Cable face pull' }).click();
    await tabBtn(page, 'Paused').click();
    await expect(rows(page).filter({ hasText: 'Cable face pull' })).toContainText('Until resumed');
  });

  test('change pause duration via sheet', async ({ page }) => {
    await page.getByRole('button', { name: 'Change pause for Overhead press' }).click();
    await expect(page.getByRole('dialog', { name: 'Overhead press preferences' })).toBeVisible();
    await page.getByRole('button', { name: /^Until I resume it/ }).click();
    await expect(rows(page).filter({ hasText: 'Overhead press' })).toContainText('Until resumed');
    await expect.poll(async () => (await readState(page)).prefs.ohp.pausedUntil).toBe(FOREVER);
    await page.getByRole('button', { name: 'Change pause for Overhead press' }).click();
    await page.getByRole('button', { name: /^1 week/ }).click();
    await expect.poll(async () => (await readState(page)).prefs.ohp.pausedUntil).toBeLessThan(Date.now() + 8 * DAY);
    expect((await readState(page)).prefs.ohp.pausedUntil).toBeGreaterThan(Date.now() + 6 * DAY);
    await page.getByRole('button', { name: 'Change pause for Dips' }).click();
    await page.getByRole('button', { name: /^2 weeks/ }).click();
    await expect.poll(async () => (await readState(page)).prefs.dips.pausedUntil).toBeGreaterThan(Date.now() + 13 * DAY);
    await page.getByRole('button', { name: 'Change pause for Dips' }).click();
    await page.getByRole('button', { name: /^Next session/ }).click();
    await expect.poll(async () => (await readState(page)).prefs.dips.pausedSessions).toBe(1);
    // scrim closes
    await page.getByRole('button', { name: 'Change pause for Dips' }).click();
    await page.getByRole('button', { name: 'Close' }).click({ position: { x: 10, y: 10 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('empty-state link goes to the library list', async ({ page }) => {
    await page.getByRole('link', { name: 'Pause an exercise' }).click();
    await expect(page).toHaveURL(/library\/all/);
  });

  test('no horizontal overflow at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    for (const k of ['paused', 'banned', 'fav']) {
      await page.goto(`library/exclusions?tab=${k}`);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(o).toBeLessThanOrEqual(0);
    }
  });
});

test.describe('Exclusions: empty states', () => {
  test.beforeEach(async ({ page }) => { await seed(page, {}); });
  for (const [tab, title, text, cta] of [
    ['paused', 'Nothing paused', 'Pause an exercise from the library or mid-session when you need a break from it.', 'Pause an exercise'],
    ['banned', 'Nothing banned', 'Ban exercises you never want to see.', 'Ban an exercise'],
    ['fav', 'No favourites', 'Star the exercises you enjoy and they’ll show up more often.', 'Add favourites'],
  ] as const) {
    test(`empty ${tab}`, async ({ page }) => {
      await page.goto(`library/exclusions?tab=${tab}`);
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.getByText(text)).toBeVisible();
      await expect(page.getByRole('link', { name: cta })).toBeVisible();
      await expect(rows(page)).toHaveCount(0);
      await expect(page.locator('.seg button').first()).toContainText(/\b0$/);
    });
  }
  test('unknown tab param falls back to paused; ids of unknown exercises ignored', async ({ page }) => {
    await seed(page, { prefs: { ghost_ex: P('ghost_ex', { avoid: true }) } });
    await page.goto('library/exclusions?tab=bogus');
    await expect(tabBtn(page, 'Paused')).toHaveAttribute('aria-pressed', 'true');
    await expect(tabBtn(page, 'Banned')).toHaveText('Banned 0');
  });
});

test.describe('Exclusions: time and sessions', () => {
  test('timed pause returns automatically when the clock passes the end', async ({ page }) => {
    await page.clock.install({ time: Date.now() });
    await seed(page, { prefs: { ohp: P('ohp', { pausedUntil: Date.now() + 7 * DAY }), db_curl: P('db_curl', { pausedUntil: FOREVER }) } });
    await page.goto('library/exclusions');
    await expect(tabBtn(page, 'Paused')).toHaveText('Paused 2');
    await page.clock.fastForward(8 * DAY); // 8 days
    await expect(tabBtn(page, 'Paused')).toHaveText('Paused 1');
    await expect(rows(page).filter({ hasText: 'Overhead press' })).toHaveCount(0);
    await expect(rows(page).filter({ hasText: 'Dumbbell curl' })).toContainText('Until resumed'); // forever stays
  });

  test('session pause counts down only on session completion', async ({ page }) => {
    const areas = makeAreas();
    const active = { ...makeSession({ id: 's-act', seq: 1, slot: 1, areaId: areas[0].id, areaName: areas[0].name, daysAgo: 0, exerciseIds: ['bench_press'], status: 'active' }), phase: 'done' as const, cursor: 0 };
    await seed(page, { sessions: [active], prefs: { dips: P('dips', { pausedSessions: 2 }), ohp: P('ohp', { pausedSessions: 1 }) } });
    await page.goto('library/exclusions');
    await expect(rows(page).filter({ hasText: 'Dips' })).toContainText('Next 2 sessions');
    await expect(rows(page).filter({ hasText: 'Overhead press' })).toContainText('Next session');
    await page.goto('session/live');
    await expect(page.getByRole('heading', { name: 'All exercises done' })).toBeVisible();
    expect((await readState(page)).prefs.dips.pausedSessions).toBe(2); // unchanged until completion
    await page.getByRole('button', { name: 'Finish session' }).click();
    await page.waitForURL(/session\/summary/);
    await expect.poll(async () => (await readState(page)).prefs.dips.pausedSessions).toBe(1);
    expect((await readState(page)).prefs.ohp.pausedSessions).toBe(0);
    await page.goto('library/exclusions');
    await expect(tabBtn(page, 'Paused')).toHaveText('Paused 1');
    await expect(rows(page).filter({ hasText: 'Dips' })).toContainText('Next session');
    await expect(rows(page).filter({ hasText: 'Overhead press' })).toHaveCount(0);
  });
});

test.describe('Exclusions: planner never uses paused / banned', () => {
  test('preview of an area whose pool is mostly excluded', async ({ page }) => {
    const areas = makeAreas();
    areas[0] = { ...areas[0], pinnedExerciseIds: [], poolExerciseIds: ['bench_press', 'ohp', 'db_curl', 'face_pull', 'dips'], exercisesPerSession: 5, mode: 'auto' };
    await seed(page, {
      areas, device: { gymSource: 'manual' },
      prefs: { bench_press: P('bench_press', { avoid: true }), ohp: P('ohp', { pausedUntil: Date.now() + 7 * DAY }), db_curl: P('db_curl', { pausedUntil: FOREVER }), dips: P('dips', { pausedSessions: 1 }) },
    });
    await page.goto('session/preview');
    const list = page.locator('.group .li-t');
    await expect(page.getByText('1 exercise', { exact: true }).first()).toBeVisible();
    await expect(list.filter({ hasText: 'Cable face pull' })).toHaveCount(1);
    for (const n of ['Bench press', 'Overhead press', 'Dumbbell curl', 'Dips']) await expect(list.filter({ hasText: new RegExp(`^${n}$`) })).toHaveCount(0);
    await expect(page.getByText('4 exercises left out')).toBeVisible();
    await expect(page.getByText(/is banned by you/)).toBeVisible();
    await expect(page.getByText(/are paused/)).toBeVisible();
    await page.getByRole('link', { name: 'Manage' }).click();
    await expect(page).toHaveURL(/library\/exclusions/);
  });

  test('banning the only pool entries leaves nothing planned; unban brings it back; Today preview agrees', async ({ page }) => {
    const areas = makeAreas();
    areas[0] = { ...areas[0], pinnedExerciseIds: [], poolExerciseIds: ['bench_press', 'ohp'], exercisesPerSession: 2, mode: 'auto' };
    await seed(page, { areas, device: { gymSource: 'manual' }, prefs: { bench_press: P('bench_press', { avoid: true }), ohp: P('ohp', { pausedUntil: FOREVER }) } });
    await page.goto('session/preview');
    await expect(page.getByText('0 exercises', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Nothing to plan yet.')).toBeVisible();
    await page.goto('library/exclusions');
    await page.getByRole('button', { name: 'Resume Overhead press' }).click();
    await tabBtn(page, 'Banned').click();
    await page.getByRole('button', { name: 'Unban Bench press' }).click();
    await expect.poll(async () => (await readState(page)).prefs.bench_press.avoid).toBe(false);
    await expect.poll(async () => (await readState(page)).prefs.ohp.pausedUntil).toBeUndefined();
    await page.goto('session/preview');
    await expect(page.locator('.group .li-t').filter({ hasText: /^Bench press$/ })).toHaveCount(1);
    await expect(page.locator('.group .li-t').filter({ hasText: /^Overhead press$/ })).toHaveCount(1);
  });
});
