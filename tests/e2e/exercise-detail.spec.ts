import { test, expect, seed, readState, makeGym, makeAreas, makeSession } from './fixtures';
import { templateEquipment } from '../../src/shared/catalog';
import { DEFAULT_PREF, PAUSE_FOREVER } from '../../src/shared/planner';

const areas = makeAreas();
const hist = (n: number, base = 60) =>
  Array.from({ length: n }, (_, i) => makeSession({ id: `s${i}`, seq: i + 1, slot: 0, areaId: areas[1].id, areaName: 'Lower body', daysAgo: (n - i) * 7, exerciseIds: ['back_squat'], weight: base + i * 2.5 }));
const prefsOf = async (page: any) => (await readState(page)).prefs;
const pf = (page: any, k: string) => expect.poll(async () => (await prefsOf(page)).back_squat?.[k]);

test('unknown id shows not-found with a way back', async ({ page, errors }) => {
  await seed(page);
  await page.goto('library/nope');
  await expect(page.getByRole('heading', { name: 'Exercise not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Open library' }).click();
  await expect(page).toHaveURL(/\/app\/library$/);
  expect(errors).toEqual([]);
});

test('empty history: no chart, "Not done yet", labels, no next-time card', async ({ page }) => {
  await seed(page);
  await page.goto('library/back_squat');
  await expect(page.getByRole('heading', { name: 'Back squat' })).toBeVisible();
  await expect(page.getByText('Not done yet')).toBeVisible();
  await expect(page.getByText('No completed sets yet')).toBeVisible();
  await expect(page.locator('.bars')).toHaveCount(0);
  await expect(page.getByText('Next time', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Nothing recorded yet.')).toBeVisible();
  const labels = page.locator('dl.labels');
  await expect(labels.getByText('Quads', { exact: true })).toBeVisible();
  await expect(labels.getByText('Squat rack')).toBeVisible();
  await expect(labels.getByText('Advanced')).toBeVisible();
  await expect(labels.getByText('Weight × reps · 2.5 kg steps')).toBeVisible();
  await expect(page.getByText('How to', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit exercise' })).toHaveAttribute('href', /exercise\/back_squat\/edit$/);
  await expect(page.getByRole('link', { name: 'Back to library' })).toHaveAttribute('href', /library$/);
  await expect(page.locator('.banner')).toHaveCount(0);
});

test('history: 8 most recent sessions, metric tabs, next time, feedback rows', async ({ page }) => {
  await seed(page, { sessions: hist(10), areas });
  await page.goto('library/back_squat');
  await expect(page.locator('.bars .bar')).toHaveCount(8);
  await expect(page.locator('.bars .bar.last')).toHaveCount(1);
  await expect(page.locator('.t-num').first()).toHaveText(/^82\.5 kg$/);
  await expect(page.getByText('+17.5 kg over 8 sessions')).toBeVisible();
  await expect(page.getByText(/^Last done .* · 3 × 8 @ 82\.5 kg · felt just right$/)).toBeVisible();
  const top = page.getByRole('button', { name: 'Top weight' });
  await expect(top).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Volume' }).click();
  await expect(page.getByRole('button', { name: 'Volume' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.t-num').first()).toHaveText(/1,980 kg/);
  await page.getByRole('button', { name: 'Time' }).click();
  await expect(page.locator('.t-num').first()).toHaveText(/^\d+:\d\d$/);
  await expect(page.locator('.bars')).toHaveAttribute('aria-label', 'Last 8 sessions, Time');
  // feedback rows link to the session
  const rows = page.locator('a.li');
  await expect(rows).toHaveCount(5);
  await expect(rows.first().locator('.li-s')).toHaveText('Normal effort · just right · right volume');
  await rows.first().click();
  await expect(page).toHaveURL(/history\/s9$/);
});

test('single session: first-session delta', async ({ page }) => {
  await seed(page, { sessions: hist(1), areas });
  await page.goto('library/back_squat');
  await expect(page.locator('.bars .bar')).toHaveCount(1);
  await expect(page.getByText('First session')).toBeVisible();
});

test('favourite toggles, shows banner and persists', async ({ page }) => {
  await seed(page);
  await page.goto('library/back_squat');
  const fav = page.getByRole('button', { name: 'Favourite' });
  await expect(fav).toHaveAttribute('aria-pressed', 'false');
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.banner.ok')).toContainText('Picked first when it fits the area, gym and time.');
  await pf(page, 'favorite').toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Favourite' }).click();
  await expect(page.locator('.banner')).toHaveCount(0);
  await pf(page, 'favorite').toBe(false);
});

test('pause sheet: every option, status banner with return date, resume', async ({ page }) => {
  await seed(page);
  await page.goto('library/back_squat');
  const want = [1, 7, 14, 30, PAUSE_FOREVER];
  const opts: [string, (p: any) => unknown][] = [
    ['Next session', (p) => p.pausedSessions],
    ['1 week', (p) => Math.round((p.pausedUntil - Date.now()) / 86400000)],
    ['2 weeks', (p) => Math.round((p.pausedUntil - Date.now()) / 86400000)],
    ['1 month', (p) => Math.round((p.pausedUntil - Date.now()) / 86400000)],
    ['Until I resume it', (p) => p.pausedUntil],
  ];
  for (const [i, [label, check]] of opts.entries()) {
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: new RegExp('^' + label) }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.banner.warn')).toContainText('Not planned or swapped in. Your history is kept.');
    await expect.poll(async () => check((await prefsOf(page)).back_squat ?? {})).toBe(want[i]);
    if (label === '1 week') await expect(page.locator('.banner.warn .b-t')).toHaveText(/^Paused until \d+ \w{3}$/);
    if (label === 'Next session') await expect(page.locator('.banner.warn .b-t')).toHaveText('Paused for the next session');
    if (label.startsWith('Until')) await expect(page.locator('.banner.warn .b-t')).toHaveText('Paused until you resume');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.locator('.banner')).toHaveCount(0);
    await pf(page, 'pausedUntil').toBeUndefined();
    await pf(page, 'pausedSessions').toBeUndefined();
  }
});

test('pause sheet closes via scrim without changes', async ({ page }) => {
  await seed(page);
  await page.goto('library/back_squat');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect((await readState(page)).prefs.back_squat).toBeUndefined();
});

test('already-expired pause is not shown as paused', async ({ page }) => {
  await seed(page, { prefs: { back_squat: { ...DEFAULT_PREF('back_squat'), pausedUntil: Date.now() - 1000 } } });
  await page.goto('library/back_squat');
  await expect(page.locator('.banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('ban / unban and the banned banner; favourite+ban shows banned', async ({ page }) => {
  await seed(page, { prefs: { back_squat: { ...DEFAULT_PREF('back_squat'), favorite: true } } });
  await page.goto('library/back_squat');
  await page.getByRole('button', { name: 'Ban', exact: true }).click();
  await expect(page.locator('.banner.error')).toContainText('Never planned, generated or offered as a swap. History is kept.');
  await expect(page.locator('.banner.error .b-t')).toHaveText('Banned');
  await pf(page, 'avoid').toBe(true);
  await page.getByRole('button', { name: 'Unban' }).click();
  await expect(page.locator('.banner.error')).toHaveCount(0);
  await expect(page.locator('.banner.ok')).toBeVisible();
  await pf(page, 'avoid').toBe(false);
});

test('coach tuning: score breakdown, relevance, cooldown, min days, notes persist', async ({ page }) => {
  await seed(page, { sessions: hist(2), areas });
  await page.goto('library/back_squat');
  await expect(page.getByText('Planner score')).toBeVisible();
  await expect(page.getByText('Coach tuning')).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Relevance to my plan' });
  await expect(slider).toHaveValue('50');
  await slider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Home');
  await expect.poll(async () => (await prefsOf(page)).back_squat?.relevance).toBe(0);
  await page.keyboard.press('End');
  await expect.poll(async () => (await prefsOf(page)).back_squat?.relevance).toBe(100);
  // cooldown
  await expect(page.getByText(/^Default · \d+ sessions?$/)).toBeVisible();
  await page.getByRole('button', { name: 'More cooldown sessions' }).click();
  await expect.poll(async () => (await prefsOf(page)).back_squat?.cooldownSessions).toBeGreaterThan(0);
  const cd = (await prefsOf(page)).back_squat.cooldownSessions;
  await page.getByRole('button', { name: 'More cooldown sessions' }).click();
  await pf(page, 'cooldownSessions').toBe(cd + 1);
  await page.getByRole('button', { name: 'Fewer cooldown sessions' }).click();
  await pf(page, 'cooldownSessions').toBe(cd);
  await page.getByRole('button', { name: 'Use default' }).first().click();
  await pf(page, 'cooldownSessions').toBeUndefined();
  // min days
  await page.getByRole('button', { name: 'More days' }).click();
  await expect.poll(async () => (await prefsOf(page)).back_squat?.minDaysBetween).toBeGreaterThan(0);
  const md = (await prefsOf(page)).back_squat.minDaysBetween;
  await page.getByRole('button', { name: 'Fewer days' }).click();
  await pf(page, 'minDaysBetween').toBe(md - 1);
  await page.getByRole('button', { name: 'Use default' }).click();
  await pf(page, 'minDaysBetween').toBeUndefined();
  // notes
  await page.getByPlaceholder('Cues, injuries, preferences…').fill('Left knee: stay above parallel');
  await page.getByPlaceholder('Cues, injuries, preferences…').blur();
  await expect.poll(async () => (await prefsOf(page)).back_squat.notes).toBe('Left knee: stay above parallel');
  await page.reload();
  await expect(page.getByPlaceholder('Cues, injuries, preferences…')).toHaveValue('Left knee: stay above parallel');
  await expect(page.getByRole('slider', { name: 'Relevance to my plan' })).toHaveValue('100');
});

test('gyms: availability per gym with swap suggestion', async ({ page }) => {
  const home = makeGym({ id: 'gym-home', name: 'Home', equipment: templateEquipment('empty') });
  await seed(page, { gyms: [makeGym(), home] });
  await page.goto('library/back_squat');
  const rows = page.locator('.group .li', { hasText: /City Gym|Home/ });
  await expect(rows.filter({ hasText: 'City Gym Odenplan' }).locator('.dot.green')).toBeVisible();
  await expect(rows.filter({ hasText: 'City Gym Odenplan' })).toContainText('Available');
  await expect(rows.filter({ hasText: 'Home' }).locator('.dot.red')).toBeVisible();
  await expect(rows.filter({ hasText: 'Home' })).toContainText(/^Home\s*No .*/i);
});

test('archive and restore a custom exercise', async ({ page }) => {
  await seed(page);
  await page.goto('exercise/new');
  await page.getByPlaceholder('e.g. Landmine press').fill('Zercher squat');
  await page.getByRole('group', { name: 'Primary muscles' }).getByRole('button', { name: 'Quads' }).click();
  await page.getByRole('group', { name: 'Movement pattern' }).getByRole('button', { name: 'Squat' }).click();
  await page.getByRole('button', { name: 'Save exercise' }).click();
  await page.getByRole('link', { name: 'View' }).click();
  await expect(page.getByRole('heading', { name: 'Zercher squat' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive exercise' }).click();
  await expect(page).toHaveURL(/library$/);
  const find = async () => Object.values((await readState(page)).exercises as Record<string, any>).find((e) => e.name === 'Zercher squat') as any;
  await expect.poll(async () => (await find())?.archived).toBe(true);
  const ex = await find();
  await page.goto(`library/${ex.id}`);
  await expect(page.getByText('This exercise is archived and hidden from the library and planner.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archive exercise' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('This exercise is archived')).toHaveCount(0);
  await expect.poll(async () => (await find())?.archived).toBe(false);
});

test('375px: no horizontal overflow, controls stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seed(page, { sessions: hist(8), areas, prefs: { back_squat: { ...DEFAULT_PREF('back_squat'), favorite: true } } });
  await page.goto('library/back_squat');
  await expect(page.locator('.bars .bar')).toHaveCount(8);
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 667 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => [...document.querySelectorAll('.scroll')].every((e) => e.scrollWidth <= e.clientWidth))).toBe(true);
  }
  for (const n of ['Favourite', 'Pause', 'Ban']) {
    const b = await page.getByRole('button', { name: n, exact: true }).boundingBox();
    expect(b!.height).toBeGreaterThanOrEqual(36);
  }
});
