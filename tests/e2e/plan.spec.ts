import { test, expect, seed, readState, makeSession, makeAreas } from './fixtures';
import type { Page } from '@playwright/test';

const NAMES = ['Upper body', 'Lower body', 'Prehab & mobility', 'Full body'];
const rows = (page: Page) => page.locator('.group').first().locator('.li');
const rowNames = (page: Page) => rows(page).locator('.li-t').allTextContents();
const rotNames = async (page: Page) => { const st = await readState(page); return st.settings.rotation.map((id: string) => st.areas[id].name); };
const press = async (page: Page, name: string, times = 1) => { for (let i = 0; i < times; i++) await page.getByRole('button', { name, exact: true }).click(); };
const mismatch = (page: Page) => page.locator('.banner.info');

test('layout, copy, rotation rows, Next tag on slot 1 with no history', async ({ page, errors }) => {
  await seed(page);
  await page.goto('plan');
  await expect(page.getByRole('heading', { name: 'Plan', exact: true })).toBeVisible();
  await expect(page.locator('.eyebrow').first()).toHaveText(/^Week \d+ · 0 of 4 done$/);
  await expect(page.getByText('Weekly goal')).toBeVisible();
  await expect(page.getByText('Sessions per week')).toBeVisible();
  await expect(page.getByText('Warm-up included')).toBeVisible();
  await expect(page.getByText('Loops 1 → 4 → 1')).toBeVisible();
  expect(await rowNames(page)).toEqual(NAMES);
  await expect(rows(page).locator('.tile')).toHaveText(['1', '2', '3', '4']);
  await expect(rows(page).nth(0).locator('.li-s')).toHaveText('5 exercises · auto-pick · 2 pinned');
  await expect(page.locator('.tag.accent', { hasText: 'Next' })).toHaveCount(1);
  await expect(rows(page).nth(0).locator('.tag.accent')).toHaveText('Next');
  await expect(rows(page).nth(0).locator('.tile')).toHaveClass(/accent/);
  await expect(rows(page).nth(1).locator('.tile')).toHaveClass(/ink/);
  await expect(page.getByRole('button', { name: 'Move Upper body up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Full body down' })).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('weekly goal stepper: bounds 1..7, persists, eyebrow follows', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await press(page, 'Fewer sessions', 3);
  await expect(page.getByRole('button', { name: 'Fewer sessions' })).toBeDisabled();
  await expect(page.locator('.eyebrow').first()).toContainText('0 of 1 done');
  await expect.poll(async () => (await readState(page)).settings.weeklyGoal).toBe(1);
  await press(page, 'More sessions', 6);
  await expect(page.getByRole('button', { name: 'More sessions' })).toBeDisabled();
  await expect(page.locator('.eyebrow').first()).toContainText('0 of 7 done');
  await expect.poll(async () => (await readState(page)).settings.weeklyGoal).toBe(7);
  await page.reload();
  await expect(page.locator('.eyebrow').first()).toContainText('0 of 7 done');
});

test('target time stepper: step 5, bounds 20..150, persists', async ({ page }) => {
  await seed(page, { settings: { targetMinutes: 30 } });
  await page.goto('plan');
  const val = page.locator('.val', { hasText: 'min' }).first();
  await expect(val).toHaveText('30min');
  await press(page, 'More time');
  await expect(val).toHaveText('35min');
  await press(page, 'Less time', 3);
  await expect(val).toHaveText('20min');
  await expect(page.getByRole('button', { name: 'Less time' })).toBeDisabled();
  await expect.poll(async () => (await readState(page)).settings.targetMinutes).toBe(20);
  await press(page, 'More time', 26);
  await expect(val).toHaveText('150min');
  await expect(page.getByRole('button', { name: 'More time' })).toBeDisabled();
  await expect.poll(async () => (await readState(page)).settings.targetMinutes).toBe(150);
  await page.reload();
  await expect(page.locator('.val', { hasText: 'min' }).first()).toHaveText('150min');
});

test('warm-up stepper: step 1, bounds 0..30, persists', async ({ page }) => {
  await seed(page, { settings: { warmupTargetMinutes: 2 } });
  await page.goto('plan');
  const val = page.locator('.val', { hasText: 'min' }).nth(1);
  await expect(val).toHaveText('2min');
  await press(page, 'Shorter warm-up', 2);
  await expect(val).toHaveText('0min');
  await expect(page.getByRole('button', { name: 'Shorter warm-up' })).toBeDisabled();
  await expect.poll(async () => (await readState(page)).settings.warmupTargetMinutes).toBe(0);
  await press(page, 'Longer warm-up', 30);
  await expect(val).toHaveText('30min');
  await expect(page.getByRole('button', { name: 'Longer warm-up' })).toBeDisabled();
  await expect.poll(async () => (await readState(page)).settings.warmupTargetMinutes).toBe(30);
});

test('warm-up average line: hidden without history, real minutes with history', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await expect(page.getByText(/Avg last 5/)).toHaveCount(0);
});
test('warm-up average line shows real minutes from history', async ({ page }) => {
  await seed(page, { sessions: [makeSession({ id: 's1', seq: 1, slot: 1, areaId: 'area-1', areaName: 'Upper body', daysAgo: 1, exerciseIds: ['bench_press'] })] });
  await page.goto('plan');
  await expect(page.getByText('Avg last 5: 9 min')).toBeVisible();
});

test('week counter in eyebrow counts completed sessions this week only', async ({ page }) => {
  await seed(page, { sessions: [
    makeSession({ id: 's1', seq: 1, slot: 1, areaId: 'area-1', areaName: 'Upper body', daysAgo: 0, exerciseIds: ['bench_press'] }),
    makeSession({ id: 's0', seq: 0, slot: 4, areaId: 'area-4', areaName: 'Full body', daysAgo: 30, exerciseIds: ['bench_press'] }),
  ] });
  await page.goto('plan');
  await expect(page.locator('.eyebrow').first()).toContainText('1 of 4 done');
});

test('rotation reorder: up/down persist; slot numbers follow; ends disabled', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await page.getByRole('button', { name: 'Move Lower body up' }).click();
  expect(await rowNames(page)).toEqual(['Lower body', 'Upper body', 'Prehab & mobility', 'Full body']);
  await expect(page.getByRole('button', { name: 'Move Lower body up' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Upper body down' }).click();
  expect(await rowNames(page)).toEqual(['Lower body', 'Prehab & mobility', 'Upper body', 'Full body']);
  await page.getByRole('button', { name: 'Move Full body up' }).click();
  expect(await rowNames(page)).toEqual(['Lower body', 'Prehab & mobility', 'Full body', 'Upper body']);
  await expect(page.getByRole('button', { name: 'Move Upper body down' })).toBeDisabled();
  await expect.poll(() => rotNames(page)).toEqual(['Lower body', 'Prehab & mobility', 'Full body', 'Upper body']);
  await page.reload();
  expect(await rowNames(page)).toEqual(['Lower body', 'Prehab & mobility', 'Full body', 'Upper body']);
});

test('rotation order drives the Next tag and Today next-slot pointer', async ({ page }) => {
  // slot 1 done -> next is slot 2
  await seed(page, { sessions: [makeSession({ id: 's1', seq: 1, slot: 1, areaId: 'area-1', areaName: 'Upper body', daysAgo: 1, exerciseIds: ['bench_press'] })] });
  await page.goto('plan');
  await expect(rows(page).nth(1).locator('.tag.accent')).toHaveText('Next');
  await expect(rows(page).nth(0).locator('.tag.accent')).toHaveCount(0);
  await page.goto('');
  await expect(page.getByLabel('Next session').getByRole('heading')).toHaveText('Lower body');
  await expect(page.getByText('Up next · Session 2 of rotation')).toBeVisible();
  // swap: Lower up -> slot 2 is now Upper body
  await page.goto('plan');
  await page.getByRole('button', { name: 'Move Lower body up' }).click();
  await expect(rows(page).nth(1).locator('.li-t')).toHaveText('Upper body');
  await expect(rows(page).nth(1).locator('.tag.accent')).toHaveText('Next');
  await expect.poll(() => rotNames(page)).toEqual(['Lower body', 'Upper body', 'Prehab & mobility', 'Full body']);
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByLabel('Next session').getByRole('heading')).toHaveText('Upper body');
  await expect(page.getByText('Up next · Session 2 of rotation')).toBeVisible();
});

test('pointer wraps: last slot done -> Next on slot 1', async ({ page }) => {
  await seed(page, { sessions: [makeSession({ id: 's4', seq: 4, slot: 4, areaId: 'area-4', areaName: 'Full body', daysAgo: 1, exerciseIds: ['bench_press'] })] });
  await page.goto('plan');
  await expect(rows(page).nth(0).locator('.tag.accent')).toHaveText('Next');
});

test('mismatch banner: matching goal shows none', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await expect(mismatch(page)).toHaveCount(0);
});

test('mismatch banner texts: rotation > goal and rotation < goal', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await press(page, 'Fewer sessions');
  await expect(mismatch(page)).toHaveText('Your rotation has 4 areas but the goal is 3 a week, so a full cycle takes more than a week. That’s fine: numbering just continues.');
  await press(page, 'More sessions', 2);
  await expect(mismatch(page)).toHaveText('Goal is 5 but rotation has 4 areas, so some areas repeat within a week.');
  await press(page, 'Fewer sessions');
  await expect(mismatch(page)).toHaveCount(0);
});

test('add area sheet: templates, existing areas, blank; max 7 disables', async ({ page }) => {
  const areas = makeAreas();
  await seed(page, { areas, settings: { rotation: ['area-1', 'area-2'], weeklyGoal: 2 } });
  await page.goto('plan');
  expect(await rowNames(page)).toEqual(['Upper body', 'Lower body']);
  await page.getByRole('button', { name: 'Add area to rotation' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add area to rotation' });
  await expect(sheet.getByText('Your areas')).toBeVisible();
  await expect(sheet.getByText('Templates')).toBeVisible();
  // existing, not-in-rotation areas
  await expect(sheet.locator('.li-t')).toContainText(['Prehab & mobility', 'Full body', 'Push', 'Pull', 'Core', 'Conditioning']);
  // closing via scrim
  await page.getByRole('button', { name: 'Close' }).click({ position: { x: 10, y: 10 } });
  await expect(sheet).toHaveCount(0);
  expect(await rotNames(page)).toEqual(['Upper body', 'Lower body']);
  // add existing
  await page.getByRole('button', { name: 'Add area to rotation' }).click();
  await sheet.locator('.li', { hasText: 'Prehab & mobility' }).first().click();
  await expect(sheet).toHaveCount(0);
  expect(await rowNames(page)).toEqual(['Upper body', 'Lower body', 'Prehab & mobility']);
  await expect(page.getByText('Loops 1 → 3 → 1')).toBeVisible();
  // add a template: creates a NEW area with template data
  await page.getByRole('button', { name: 'Add area to rotation' }).click();
  await sheet.locator('.li', { hasText: 'Conditioning' }).click();
  await expect.poll(async () => (await readState(page)).settings.rotation.length).toBe(4);
  const st = await readState(page);
  const cond = st.areas[st.settings.rotation[3]];
  expect(cond.name).toBe('Conditioning');
  expect(cond.poolExerciseIds.length).toBeGreaterThan(0);
  expect(await rowNames(page)).toContain('Conditioning');
});

test('add blank area navigates to editor; rotation reaches 7 and add is disabled', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await page.getByRole('button', { name: 'Add area to rotation' }).click();
  await page.getByRole('button', { name: 'Blank area' }).click();
  await expect(page).toHaveURL(/plan\/area\/.+/);
  await expect(page.getByLabel('Name')).toHaveValue('New area');
  await page.getByRole('link', { name: 'Back to Plan' }).or(page.getByRole('button', { name: 'Back to Plan' })).click();
  await expect(page).toHaveURL(/plan$/);
  await expect(rows(page)).toHaveCount(5);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Add area to rotation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Blank area' }).click();
    await expect(page).toHaveURL(/plan\/area\//);
    await page.getByRole('button', { name: 'Back to Plan' }).click();
    await expect(page).toHaveURL(/plan$/);
  }
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Add area to rotation' })).toBeDisabled();
  await expect(page.getByText('Loops 1 → 7 → 1')).toBeVisible();
});

test('empty rotation: empty state, no Next tag, no mismatch banner, add works', async ({ page, errors }) => {
  await seed(page, { settings: { rotation: [] } });
  await page.goto('plan');
  await expect(page.getByRole('heading', { name: 'No areas yet' })).toBeVisible();
  await expect(page.getByText(/Loops 1/)).toHaveCount(0);
  await expect(mismatch(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add area to rotation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add area to rotation' }).click();
  await page.getByRole('dialog').locator('.li', { hasText: 'Upper body' }).first().click();
  expect(await rowNames(page)).toEqual(['Upper body']);
  expect(errors).toEqual([]);
});

test('rotation row opens the area editor', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await rows(page).nth(2).getByRole('link').click();
  await expect(page).toHaveURL(/plan\/area\/area-3$/);
  await expect(page.getByLabel('Name')).toHaveValue('Prehab & mobility');
  await expect(page.getByText('Session 3 · area')).toBeVisible();
});

test('exercise rows: library count, exclusions counts (favourite/paused/banned), create, planner links', async ({ page }) => {
  const now = Date.now();
  await seed(page, { prefs: {
    bench_press: { exerciseId: 'bench_press', favorite: true, avoid: false, relevance: 50 },
    back_squat: { exerciseId: 'back_squat', favorite: true, avoid: false, relevance: 50 },
    rdl: { exerciseId: 'rdl', favorite: false, avoid: false, relevance: 50, pausedUntil: now + 7 * 86400000 },
    deadlift: { exerciseId: 'deadlift', favorite: true, avoid: false, relevance: 50, pausedSessions: 1 },
    leg_press: { exerciseId: 'leg_press', favorite: false, avoid: true, relevance: 50 },
    hack_squat: { exerciseId: 'hack_squat', favorite: true, avoid: true, relevance: 50 },
    pullup: { exerciseId: 'pullup', favorite: false, avoid: false, relevance: 50, pausedUntil: now - 1000 },
  } });
  await page.goto('plan');
  const total = await page.getByRole('link', { name: /Exercise library/ }).locator('.li-s').textContent();
  expect(total).toMatch(/^\d+ exercises · browse by muscle or equipment$/);
  // favourites: bench, squat only (deadlift paused, hack banned); paused: rdl + deadlift (expired pause ignored); banned: leg_press + hack
  await expect(page.getByRole('link', { name: /Favourites, paused & banned/ }).locator('.li-s')).toHaveText('2 favourites · 2 paused · 2 banned');
  await page.getByRole('link', { name: /Favourites, paused & banned/ }).click();
  await expect(page).toHaveURL(/library\/exclusions$/);
  await page.goBack();
  await page.getByRole('link', { name: /Exercise library/ }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.goBack();
  await page.getByRole('link', { name: /Create exercise/ }).click();
  await expect(page).toHaveURL(/exercise\/new$/);
  await page.goBack();
  await expect(page.getByRole('link', { name: /Create exercise/ }).locator('.li-s')).toHaveText('With muscles, equipment and pattern labels');
  await page.getByRole('link', { name: /Planner & scoring/ }).click();
  await expect(page).toHaveURL(/plan\/planner$/);
});

test('exclusion counts start at zero', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await expect(page.getByRole('link', { name: /Favourites, paused & banned/ }).locator('.li-s')).toHaveText('0 favourites · 0 paused · 0 banned');
  await expect(page.getByRole('link', { name: /Planner & scoring/ }).locator('.li-s')).toContainText('cooldown');
});

test('tab bar: Plan is current; other tabs navigate', async ({ page }) => {
  await seed(page);
  await page.goto('plan');
  await expect(page.getByRole('link', { name: 'Plan', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Gyms' }).click();
  await expect(page).toHaveURL(/gyms$/);
});

test('area meta: fixed list drops pinned count; singular exercise', async ({ page }) => {
  const areas = makeAreas();
  areas[0] = { ...areas[0], mode: 'fixed', exercisesPerSession: 1 };
  await seed(page, { areas });
  await page.goto('plan');
  await expect(rows(page).nth(0).locator('.li-s')).toHaveText('1 exercise · fixed list');
});

for (const [w, h] of [[440, 956], [375, 667], [360, 640]] as const) {
  test(`${w}px: no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await seed(page);
    await page.goto('plan');
    await press(page, 'Fewer sessions');
    const m = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, Math.max(...[...document.querySelectorAll('.scroll *')].map((e) => e.getBoundingClientRect().right))]);
    expect(m[0]).toBeLessThanOrEqual(m[1]);
    expect(m[2]).toBeLessThanOrEqual(m[1] + 0.5);
  });
}
