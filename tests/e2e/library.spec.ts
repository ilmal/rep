import type { Page } from '@playwright/test';
import { test, expect, seed, readState as readRaw, makeGym, makeAreas, makeSession, GYM_ID } from './fixtures';
import { SEED_EXERCISES } from '../../src/shared/exercises';
import { PAUSE_FOREVER } from '../../src/shared/planner';

// the store persists on a 250 ms debounce: wait it out before reading back
const readState = async (p: Page) => { await p.waitForTimeout(400); return readRaw(p); };
const TOTAL = SEED_EXERCISES.length;
const HOME_GYM = () => makeGym({ id: 'gym-home', name: 'Home', lat: 59.5, lng: 18.4, equipment: { dumbbells: 'ok', adj_bench: 'ok', bands: 'ok', mat: 'ok', pullup_bar: 'ok' } as never });
const pref = (id: string, o: Record<string, unknown> = {}) => ({ exerciseId: id, favorite: false, avoid: false, relevance: 50, ...o });
const rows = (p: Page) => p.locator('.exrow');
const rowOf = (p: Page, name: string) => p.locator('.exrow').filter({ has: p.locator('.li-t', { hasText: new RegExp(`^${name}$`) }) });
const eyebrow = (p: Page) => p.locator('.eyebrow').first();
const PREFS = {
  bench_press: pref('bench_press', { favorite: true }),
  pullup: pref('pullup', { favorite: true }),
  ohp: pref('ohp', { pausedUntil: Date.now() + 10 * 864e5 }),
  plank: pref('plank', { pausedUntil: PAUSE_FOREVER }),
  dips: pref('dips', { pausedSessions: 1 }),
  skullcrusher: pref('skullcrusher', { avoid: true }),
  deadlift: pref('deadlift', { avoid: true }),
};
const count = (id: string) => SEED_EXERCISES.filter((e) => e.id === id).length;

test.describe('library browse', () => {
  test('tiles, groups, equipment, favourites are computed from the store', async ({ page }) => {
    await seed(page, { prefs: PREFS });
    await page.goto('library');
    await expect(page.locator('.title')).toHaveText('Exercise library');
    await expect(page.locator('.fakesearch')).toHaveText(`Search ${TOTAL} exercises`);
    const tiles = page.locator('.pref');
    await expect(tiles.nth(0)).toContainText('2');
    await expect(tiles.nth(0)).toContainText('Favourites');
    await expect(tiles.nth(1)).toContainText('3');
    await expect(tiles.nth(2)).toContainText('2');
    for (let i = 0; i < 3; i++) await expect(tiles.nth(i)).toHaveAttribute('href', /library\/exclusions/);
    const sum = (await page.locator('.mgroup b').allInnerTexts()).map(Number).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL);
    await expect(page.locator('.mgroup', { hasText: 'Chest' })).toContainText(/ready/);
    await expect(page.locator('.mgroup', { hasText: 'Arms' })).toContainText('1 banned');
    await expect(page.locator('.favcard')).toHaveCount(2);
    await expect(page.locator('.favcard', { hasText: 'Bench press' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create your own exercise' })).toHaveAttribute('href', /exercise\/new/);
    await expect(page.getByRole('link', { name: 'Create exercise' })).toHaveAttribute('href', /exercise\/new/);
    await expect(page.getByRole('link', { name: 'Back to Plan' })).toHaveAttribute('href', /plan/);
  });

  test('no favourites shows a hint; no gym still renders', async ({ page }) => {
    await seed(page, { gyms: null, device: { currentGymId: null } });
    await page.goto('library');
    await expect(page.getByText('No favourites yet')).toBeVisible();
    await expect(page.locator('.favcard')).toHaveCount(0);
  });

  test('muscle tile opens the list on that group; equipment chip filters', async ({ page }) => {
    await seed(page);
    await page.goto('library');
    const n = Number(await page.locator('.mgroup', { hasText: 'Core' }).locator('b').innerText());
    await page.locator('.mgroup', { hasText: 'Core' }).click();
    await expect(page).toHaveURL(/library\/all/);
    await expect(page.locator('.title')).toHaveText('Core');
    await expect(rows(page)).toHaveCount(n);
    await page.goBack();
    await page.getByRole('link', { name: /^Band/ }).click();
    await expect(eyebrow(page)).toHaveText(/^\d+ of \d+ exercises$/);
    const bandN = SEED_EXERCISES.filter((e) => e.equipment.includes('bands')).length;
    await expect(rows(page)).toHaveCount(bandN);
    await page.goBack();
    await page.getByRole('link', { name: 'See all' }).click();
    await expect(rows(page)).toHaveCount(TOTAL);
  });

  test('fake search opens the list; 375px no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, { prefs: PREFS });
    await page.goto('library');
    await expect(page.locator('.mgroup').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('.fakesearch').click();
    await expect(page.getByRole('searchbox', { name: 'Search exercises' })).toBeVisible();
  });
});

test.describe('library list', () => {
  test('whole library renders grouped with real counts', async ({ page }) => {
    await seed(page, { prefs: PREFS });
    await page.goto('library/all');
    await expect(page.locator('.title')).toHaveText('All exercises');
    await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', `Search ${TOTAL} exercises`);
    await expect(eyebrow(page)).toHaveText(`${TOTAL} of ${TOTAL} exercises`);
    await expect(rows(page)).toHaveCount(TOTAL);
    const tabs = page.getByRole('group', { name: 'Status' }).getByRole('button');
    await expect(tabs.nth(0)).toHaveText(`All ${TOTAL}`);
    await expect(tabs.nth(1)).toHaveText(`Ready ${TOTAL - 5}`);
    await expect(tabs.nth(2)).toHaveText('Paused 3');
    await expect(tabs.nth(3)).toHaveText('Banned 2');
    // paused / banned remain visible with status
    await expect(rowOf(page, 'Overhead press')).toContainText(/Paused until \d+ \w+/);
    await expect(rowOf(page, 'Plank')).toContainText('Paused until you resume');
    await expect(rowOf(page, 'Dips')).toContainText('Paused after next session');
    await expect(rowOf(page, 'Deadlift')).toContainText('Banned');
    await expect(rowOf(page, 'Overhead press')).toHaveClass(/dim/);
    await expect(rowOf(page, 'Bench press').getByRole('img', { name: 'Favourite' })).toBeVisible();
    await expect(rowOf(page, 'Bench press').getByRole('img', { name: 'Advanced' })).toBeVisible();
    // section headers sum
    const heads = await page.locator('.sechead .small').allInnerTexts();
    expect(heads.map((h) => parseInt(h)).reduce((a, b) => a + b, 0)).toBe(TOTAL);
  });

  test('score chip and cooling indicator', async ({ page }) => {
    await seed(page, { sessions: [makeSession({ id: 's1', seq: 1, slot: 0, areaId: 'area-1', areaName: 'Upper body', daysAgo: 0.2, exerciseIds: ['bench_press'] })] });
    await page.goto('library/all');
    await expect(rowOf(page, 'Bench press')).toContainText(/Cooling · \d+/);
    await expect(rowOf(page, 'Back squat').locator('.tag').first()).toHaveText(/^\d+$/);
  });

  test('search by name, muscle, equipment; empty result; clear', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    const s = page.getByRole('searchbox', { name: 'Search exercises' });
    await s.fill('bench');
    const benchN = SEED_EXERCISES.filter((e) => `${e.name} ${e.primary.join(' ')} ${e.pattern}`.toLowerCase().includes('bench') || e.equipment.some((q) => q.includes('bench'))).length;
    expect(benchN).toBeGreaterThan(2);
    await expect(rowOf(page, 'Bench press')).toBeVisible();
    await expect(rowOf(page, 'Back squat')).toHaveCount(0);
    await s.fill('  CALVES ');
    await expect(rowOf(page, 'Standing calf raise')).toBeVisible();
    await s.fill('nordic');
    await expect(rowOf(page, 'Nordic curl')).toBeVisible();
    await s.fill('zzzz');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
    await expect(eyebrow(page)).toHaveText(`0 of ${TOTAL} exercises`);
    await expect(page.getByRole('link', { name: 'Create “zzzz”' })).toHaveAttribute('href', /exercise\/new\?name=zzzz/);
    await page.getByRole('button', { name: 'Clear search & filters' }).click();
    await expect(rows(page)).toHaveCount(TOTAL);
    await expect(s).toHaveValue('');
  });

  test('status tabs filter and show empty states', async ({ page }) => {
    await seed(page, { prefs: PREFS });
    await page.goto('library/all');
    const tab = (n: string) => page.getByRole('group', { name: 'Status' }).getByRole('button', { name: new RegExp(`^${n}`) });
    await tab('Paused').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(tab('Paused')).toHaveAttribute('aria-pressed', 'true');
    await tab('Banned').click();
    await expect(rows(page)).toHaveCount(2);
    await tab('Ready').click();
    await expect(rows(page)).toHaveCount(TOTAL - 5);
    await expect(rowOf(page, 'Deadlift')).toHaveCount(0);
    await tab('All').click();
    await expect(rows(page)).toHaveCount(TOTAL);
  });

  test('empty paused / banned tabs explain themselves', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    await page.getByRole('button', { name: /^Paused/ }).click();
    await expect(page.getByRole('heading', { name: 'Nothing paused' })).toBeVisible();
    await expect(page.getByText('It comes back on its own.')).toBeVisible();
    await page.getByRole('button', { name: /^Banned/ }).click();
    await expect(page.getByRole('heading', { name: 'Nothing banned' })).toBeVisible();
    await page.getByRole('searchbox').fill('xyz');
    await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
  });

  test('quick chips: favourites, current gym, muscle group', async ({ page }) => {
    await seed(page, { prefs: PREFS });
    await page.goto('library/all');
    const chips = page.getByRole('group', { name: 'Filters' });
    await chips.getByRole('button', { name: 'Favourites' }).click();
    await expect(rows(page)).toHaveCount(2);
    await chips.getByRole('button', { name: 'Favourites' }).click();
    await chips.getByRole('button', { name: 'City Gym Odenplan' }).click();
    await expect(rows(page)).toHaveCount(TOTAL); // full gym: nothing missing
    await expect(chips.getByRole('link', { name: /Filters, 1 active/ })).toBeVisible();
    await chips.getByRole('button', { name: 'City Gym Odenplan' }).click();
    await chips.getByRole('button', { name: 'Chest', exact: true }).click();
    await expect(page.locator('.title')).toHaveText('Chest');
    await expect(page.locator('.sechead')).toHaveCount(1);
    await chips.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.locator('.title')).toHaveText('All exercises');
  });

  test('"Not at gym" tag and gym chip use the real equipment of the current gym', async ({ page }) => {
    await seed(page, { gyms: [HOME_GYM()], device: { currentGymId: 'gym-home' } });
    await page.goto('library/all');
    await expect(rowOf(page, 'Back squat')).toContainText('Not at Home');
    await expect(rowOf(page, 'Dumbbell curl')).not.toContainText('Not at');
    const here = SEED_EXERCISES.filter((e) => e.equipment.every((q) => ['dumbbells', 'adj_bench', 'bands', 'mat', 'pullup_bar'].includes(q))).length;
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(rows(page)).toHaveCount(here);
  });

  test('multi-select: select, count, bulk favourite writes prefs, undo restores', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await expect(page.locator('.title')).toHaveText('Select exercises');
    await expect(page.locator('.bottombar').getByRole('button', { name: 'Favourite', exact: true })).toBeDisabled();
    await expect(page.locator('.bottombar').getByRole('button', { name: 'Ban', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Options for/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Select Back squat' }).click();
    await rowOf(page, 'Plank').locator('.exmain').click(); // row tap toggles too
    await expect(page.locator('.title')).toHaveText('2 selected');
    await expect(page.getByRole('button', { name: 'Select Back squat' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Select Back squat' }).click();
    await expect(page.locator('.title')).toHaveText('1 selected');
    await page.getByRole('button', { name: 'Select Back squat' }).click();
    await page.locator('.bottombar').getByRole('button', { name: 'Favourite', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('2 added to favourites');
    await expect(page.locator('.title')).toHaveText('All exercises');
    let st = await readState(page);
    expect(st.prefs.back_squat.favorite).toBe(true);
    expect(st.prefs.plank.favorite).toBe(true);
    await expect(rowOf(page, 'Plank').getByRole('img', { name: 'Favourite' })).toBeVisible();
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    st = await readState(page);
    expect(st.prefs.back_squat.favorite).toBe(false);
    expect(st.prefs.plank.favorite).toBe(false);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('bulk pause (2 weeks), bulk ban, bulk resume/unban', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    const selectAndAct = async (names: string[], action: string) => {
      await page.getByRole('button', { name: 'Select', exact: true }).click();
      for (const n of names) await page.getByRole('button', { name: `Select ${n}`, exact: true }).click();
      await page.getByRole('button', { name: action, exact: true }).click();
    };
    const t0 = Date.now();
    await selectAndAct(['Leg press', 'Plank'], 'Pause');
    await expect(page.getByRole('status')).toContainText('2 paused for 2 weeks');
    let st = await readState(page);
    for (const id of ['leg_press', 'plank']) {
      expect(st.prefs[id].pausedUntil).toBeGreaterThan(t0 + 13.9 * 864e5);
      expect(st.prefs[id].pausedUntil).toBeLessThan(t0 + 14.1 * 864e5);
      expect(st.prefs[id].avoid).toBe(false);
    }
    await expect(rowOf(page, 'Plank')).toContainText('Paused until');
    await selectAndAct(['Deadlift', 'Dips'], 'Ban');
    await expect(page.getByRole('status')).toContainText('2 banned');
    st = await readState(page);
    expect(st.prefs.deadlift.avoid).toBe(true);
    expect(st.prefs.dips.avoid).toBe(true);
    await expect(page.getByRole('button', { name: /^Banned 2/ })).toBeVisible();
    // resume appears only when the selection holds paused/banned items
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Select Back squat', exact: true }).click();
    await expect(page.locator('.bottombar').getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Select Back squat', exact: true }).click();
    for (const n of ['Plank', 'Deadlift']) await page.getByRole('button', { name: `Select ${n}`, exact: true }).click();
    await page.locator('.bottombar').getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('2 back in rotation');
    st = await readState(page);
    expect(st.prefs.plank.pausedUntil ?? null).toBeNull();
    expect(st.prefs.deadlift.avoid).toBe(false);
    expect(st.prefs.leg_press.pausedUntil).toBeGreaterThan(t0);
    expect(st.prefs.dips.avoid).toBe(true);
    // Cancel leaves select mode without changes
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  });

  test('bulk ban undo restores previous pause state', async ({ page }) => {
    await seed(page, { prefs: { plank: PREFS.plank } });
    await page.goto('library/all');
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Select Plank', exact: true }).click();
    await page.locator('.bottombar').getByRole('button', { name: 'Ban', exact: true }).click();
    expect((await readState(page)).prefs.plank.avoid).toBe(true);
    await page.getByRole('button', { name: 'Undo' }).click();
    const st = await readState(page);
    expect(st.prefs.plank.avoid).toBe(false);
    expect(st.prefs.plank.pausedUntil).toBe(PAUSE_FOREVER);
  });

  test('row options sheet: favourite, pause options, ban, resume, details', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    await page.getByRole('button', { name: 'Options for Bench press' }).click();
    const sheet = page.getByRole('dialog', { name: 'Exercise options' });
    await expect(sheet.getByRole('heading', { name: 'Bench press' })).toBeVisible();
    await sheet.getByRole('button', { name: /Add to favourites/ }).click();
    await expect(page.getByRole('status')).toContainText('Bench press is a favourite');
    expect((await readState(page)).prefs.bench_press.favorite).toBe(true);
    await page.getByRole('button', { name: 'Options for Bench press' }).click();
    await expect(sheet.getByRole('button', { name: /Remove from favourites/ })).toBeVisible();
    await sheet.getByRole('button', { name: /Pause for a while/ }).click();
    await expect(sheet.getByRole('button', { name: /Next session only/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Until I resume it/ })).toBeVisible();
    await sheet.getByRole('button', { name: 'Back', exact: true }).click();
    await sheet.getByRole('button', { name: /Pause for a while/ }).click();
    await sheet.getByRole('button', { name: /1 week/ }).click();
    let st = await readState(page);
    expect(st.prefs.bench_press.pausedUntil).toBeGreaterThan(Date.now() + 6.9 * 864e5);
    await expect(rowOf(page, 'Bench press')).toContainText('Paused until');
    await page.getByRole('button', { name: 'Options for Bench press' }).click();
    await expect(sheet.getByRole('button', { name: /Pause for a while/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: /Resume now/ }).click();
    st = await readState(page);
    expect(st.prefs.bench_press.pausedUntil ?? null).toBeNull();
    // next session / forever / ban / unban
    await page.getByRole('button', { name: 'Options for Plank', exact: true }).click();
    await sheet.getByRole('button', { name: /Pause for a while/ }).click();
    await sheet.getByRole('button', { name: /Next session only/ }).click();
    expect((await readState(page)).prefs.plank.pausedSessions).toBe(1);
    await page.getByRole('button', { name: 'Options for Leg press' }).click();
    await sheet.getByRole('button', { name: /Pause for a while/ }).click();
    await sheet.getByRole('button', { name: /Until I resume it/ }).click();
    expect((await readState(page)).prefs.leg_press.pausedUntil).toBe(PAUSE_FOREVER);
    await page.getByRole('button', { name: 'Options for Deadlift' }).click();
    await sheet.getByRole('button', { name: /Ban this exercise/ }).click();
    expect((await readState(page)).prefs.deadlift.avoid).toBe(true);
    await page.getByRole('button', { name: 'Options for Deadlift' }).click();
    await expect(sheet.getByRole('button', { name: /Ban this exercise/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: /^Unban/ }).click();
    expect((await readState(page)).prefs.deadlift.avoid).toBe(false);
    // close via scrim, details link
    await page.getByRole('button', { name: 'Options for Deadlift' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole('button', { name: 'Options for Deadlift' }).click();
    await sheet.getByRole('link', { name: /Details, how-to/ }).click();
    await expect(page).toHaveURL(/library\/deadlift$/);
  });

  test('row opens detail; back goes to browse; create link', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    await rowOf(page, 'Plank').locator('.exmain').click();
    await expect(page).toHaveURL(/library\/plank$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page).toHaveURL(/library$/);
  });

  test('filter state survives navigating to the filters sheet and back', async ({ page }) => {
    await seed(page);
    await page.goto('library/all');
    await page.getByRole('searchbox').fill('press');
    await page.getByRole('link', { name: 'Filters' }).click();
    await expect(page).toHaveURL(/library\/filters/);
    await page.getByRole('button', { name: 'Show', exact: false }).click();
    await expect(page).toHaveURL(/library\/all/);
    await expect(page.getByRole('searchbox')).toHaveValue('press');
  });

  test('performance: whole library renders and filters quickly', async ({ page }) => {
    await seed(page, { prefs: PREFS, sessions: [makeSession({ id: 's1', seq: 1, slot: 0, areaId: 'area-1', areaName: 'Upper body', daysAgo: 3, exerciseIds: ['bench_press', 'pullup'] })] });
    const t0 = Date.now();
    await page.goto('library/all');
    await expect(rows(page)).toHaveCount(TOTAL);
    expect(Date.now() - t0).toBeLessThan(8000);
    const t = await page.evaluate(async () => {
      const el = document.querySelector('input[type=search]') as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const t1 = performance.now();
      for (const v of ['p', 'pr', 'pre', 'pres', 'press', '']) { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => requestAnimationFrame(() => r(null))); }
      return performance.now() - t1;
    });
    expect(t).toBeLessThan(1500);
    await expect(rows(page)).toHaveCount(TOTAL);
  });

  test('375px: no horizontal overflow in list, select mode, sheet', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, { prefs: PREFS });
    await page.goto('library/all');
    await expect(rows(page).first()).toBeVisible();
    const ok = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await ok()).toBe(true);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Select Plank', exact: true }).click();
    await expect(page.locator('.bottombar').getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    expect(await ok()).toBe(true);
    const bar = await page.locator('.bottombar').boundingBox();
    expect(bar!.width).toBeLessThanOrEqual(375);
    for (const b of await page.locator('.bottombar .btn').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Options for Plank', exact: true }).click();
    expect(await ok()).toBe(true);
    await page.screenshot({ path: 'test-results/library-375.png' });
  });
});

test.describe('library filters', () => {
  const open = async (page: Page, o: Parameters<typeof seed>[1] = {}) => {
    await seed(page, o);
    await page.goto('library/filters');
    await expect(page.getByRole('dialog', { name: 'Filter exercises' })).toBeVisible();
  };
  const cta = (p: Page) => p.getByRole('dialog').locator('.btn-primary');
  const toList = async (p: Page) => { await cta(p).click(); await expect(p).toHaveURL(/library\/all/); };

  test('renders sections, default CTA shows whole library, switches reflect prefs counts', async ({ page }) => {
    await open(page, { prefs: PREFS, gyms: [makeGym(), HOME_GYM()] });
    const d = page.getByRole('dialog');
    for (const l of ['Can do at', 'Equipment', 'Movement', 'Difficulty']) await expect(d.locator('.lbl', { hasText: l })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Any gym' })).toHaveAttribute('aria-pressed', 'true');
    await expect(d.getByRole('button', { name: 'Home', exact: true })).toBeVisible();
    await expect(d.getByText('3 paused')).toBeVisible();
    await expect(d.getByText('2 banned')).toBeVisible();
    await expect(cta(page)).toHaveText(`Show ${TOTAL} exercises`);
    for (const l of ['Favourites only', 'Show paused', 'Show banned']) await expect(d.getByRole('checkbox', { name: new RegExp(l) })).toBeVisible();
  });

  test('can do at: specific gym narrows to what it can do', async ({ page }) => {
    await open(page, { gyms: [makeGym(), HOME_GYM()] });
    const here = SEED_EXERCISES.filter((e) => e.equipment.every((q) => ['dumbbells', 'adj_bench', 'bands', 'mat', 'pullup_bar'].includes(q))).length;
    await page.getByRole('dialog').getByRole('button', { name: 'Home', exact: true }).click();
    await expect(cta(page)).toHaveText(`Show ${here} exercises`);
    await toList(page);
    await expect(rows(page)).toHaveCount(here);
    await expect(page.getByRole('link', { name: /Filters, 1 active/ })).toBeVisible();
  });

  test('equipment (any-of), movement (any-of), difficulty (exact)', async ({ page }) => {
    await open(page);
    const d = page.getByRole('dialog');
    const eqLabel = (e: (typeof SEED_EXERCISES)[number]) => (e.equipment.length ? e.equipment : ['none']);
    await d.getByRole('button', { name: 'Bodyweight' }).click();
    const bw = SEED_EXERCISES.filter((e) => eqLabel(e)[0] === 'none').length;
    await expect(cta(page)).toHaveText(`Show ${bw} exercises`);
    await d.getByRole('button', { name: 'Band', exact: true }).click();
    const bands = SEED_EXERCISES.filter((e) => e.equipment.includes('bands')).length;
    await expect(cta(page)).toHaveText(`Show ${bw + bands} exercises`);
    await d.getByRole('button', { name: 'Bodyweight' }).click();
    await d.getByRole('button', { name: 'Band', exact: true }).click();
    await d.getByRole('button', { name: 'Push', exact: true }).click();
    const push = SEED_EXERCISES.filter((e) => e.pattern === 'push').length;
    await expect(cta(page)).toHaveText(`Show ${push} exercises`);
    await d.getByRole('button', { name: 'Pull', exact: true }).click();
    const pp = SEED_EXERCISES.filter((e) => e.pattern === 'push' || e.pattern === 'pull').length;
    await expect(cta(page)).toHaveText(`Show ${pp} exercises`);
    await d.getByRole('button', { name: 'Push', exact: true }).click();
    await d.getByRole('button', { name: 'Pull', exact: true }).click();
    for (const lvl of [1, 2, 3]) {
      await d.getByRole('button', { name: ['Beginner', 'Intermediate', 'Advanced'][lvl - 1] }).click();
      const n = SEED_EXERCISES.filter((e) => e.difficulty === lvl).length;
      await expect(cta(page)).toHaveText(`Show ${n} exercises`);
    }
    await d.getByRole('button', { name: 'Any difficulty' }).click();
    await expect(cta(page)).toHaveText(`Show ${TOTAL} exercises`);
    await d.getByRole('button', { name: 'Advanced' }).click();
    await toList(page);
    const n3 = SEED_EXERCISES.filter((e) => e.difficulty === 3).length;
    await expect(rows(page)).toHaveCount(n3);
    await expect(page.getByRole('link', { name: /Filters, 1 active/ })).toBeVisible();
  });

  test('favourites only / show paused / show banned', async ({ page }) => {
    await open(page, { prefs: PREFS });
    const d = page.getByRole('dialog');
    await d.getByRole('checkbox', { name: /Show paused/ }).uncheck();
    await expect(cta(page)).toHaveText(`Show ${TOTAL - 3} exercises`);
    await d.getByRole('checkbox', { name: /Show banned/ }).uncheck();
    await expect(cta(page)).toHaveText(`Show ${TOTAL - 5} exercises`);
    await d.getByRole('checkbox', { name: /Favourites only/ }).check();
    await expect(cta(page)).toHaveText('Show 2 exercises');
    await toList(page);
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('link', { name: /Filters, 3 active/ })).toBeVisible();
  });

  test('combined filters to zero disables the CTA; reset restores everything', async ({ page }) => {
    await open(page);
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Band', exact: true }).click();
    await d.getByRole('button', { name: 'Advanced' }).click();
    await expect(cta(page)).toHaveText('No exercises match');
    await expect(cta(page)).toBeDisabled();
    await d.getByRole('button', { name: 'Reset' }).click();
    await expect(cta(page)).toHaveText(`Show ${TOTAL} exercises`);
    await expect(d.getByRole('button', { name: 'Band', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(d.getByRole('button', { name: 'Any gym' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('scrim closes without losing state; list shows no badge after reset', async ({ page }) => {
    await open(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Core', exact: true }).click();
    await page.getByRole('link', { name: 'Close' }).click({ position: { x: 200, y: 20 } });
    await expect(page).toHaveURL(/library\/all/);
    await expect(page.getByRole('link', { name: /^Filters, 1 active/ })).toBeVisible();
    await page.getByRole('link', { name: /^Filters/ }).click();
    await page.getByRole('button', { name: 'Reset' }).click();
    await page.getByRole('link', { name: 'Close' }).click({ position: { x: 200, y: 20 } });
    await expect(page.getByRole('link', { name: 'Filters', exact: true })).toBeVisible();
  });

  test('filters apply together with search and status tab (CTA == list count)', async ({ page }) => {
    await seed(page, { prefs: PREFS });
    await page.goto('library/all');
    await page.getByRole('searchbox').fill('press');
    await page.getByRole('button', { name: /^Ready/ }).click();
    const listN = await rows(page).count();
    await page.getByRole('link', { name: /^Filters/ }).click();
    await expect(cta(page)).toHaveText(`Show ${listN} ${listN === 1 ? 'exercise' : 'exercises'}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Barbell' }).click();
    const n2 = Number((await cta(page).innerText()).match(/\d+/)![0]);
    await toList(page);
    await expect(rows(page)).toHaveCount(n2);
    expect(n2).toBeLessThan(listN);
  });

  test('375px: sheet fits and has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page, { gyms: [makeGym(), HOME_GYM()] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    await expect(cta(page)).toBeInViewport();
    await page.screenshot({ path: 'test-results/library-filters-375.png' });
  });
});

test.describe('library add modes', () => {
  test('?add=1 from PreSession: browse redirects to list, picking adds to the draft and returns', async ({ page }) => {
    await seed(page, { device: { chosenSlot: 2, currentGymId: GYM_ID, gymSource: 'manual' } });
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    const before = (await readState(page)).device.draft.exercises.map((e: { exerciseId: string }) => e.exerciseId) as string[];
    const target = SEED_EXERCISES.find((e) => !before.includes(e.id) && e.equipment.length === 0 && e.name !== 'Plank')!;
    await page.getByRole('link', { name: /Add exercise/ }).click();
    await expect(page).toHaveURL(/library\/all\?add=1/);
    await expect(page.locator('.title')).toHaveText('Add exercise');
    await expect(page.getByRole('button', { name: /^Options for/ })).toHaveCount(0);
    const inSession = page.locator('.exrow').filter({ hasText: 'In session' });
    await expect(inSession).toHaveCount(before.length);
    await page.getByRole('button', { name: `Add ${target.name}`, exact: true }).click();
    await expect(page).toHaveURL(/session\/preview/);
    const after = (await readState(page)).device.draft.exercises.map((e: { exerciseId: string }) => e.exerciseId);
    expect(after).toContain(target.id);
    expect(after.length).toBe(before.length + 1);
  });

  test('?add=1 keeps the mode through the filters sheet', async ({ page }) => {
    await seed(page, { device: { chosenSlot: 2, currentGymId: GYM_ID, gymSource: 'manual' } });
    await page.goto('library/all?add=1');
    await page.getByRole('link', { name: /^Filters/ }).click();
    await expect(page).toHaveURL(/library\/filters\?add=1/);
    await page.getByRole('button', { name: /^Show/ }).click();
    await expect(page).toHaveURL(/library\/all\?add=1/);
    await expect(page.locator('.title')).toHaveText('Add exercise');
  });

  test('?addToArea=<id> from AreaEdit adds to the area pool then returns; already-in-pool is tagged', async ({ page }) => {
    await seed(page);
    await page.goto('plan/area/area-1');
    const area = (await readState(page)).areas['area-1'];
    const target = SEED_EXERCISES.find((e) => !area.poolExerciseIds.includes(e.id))!;
    await page.getByRole('button', { name: /Add from library/ }).click();
    await expect(page).toHaveURL(/library\/all\?addToArea=area-1/);
    await expect(page.locator('.title')).toHaveText(`Add to ${area.name}`);
    await expect(page.getByRole('button', { name: /^Options for/ })).toHaveCount(0);
    await expect(page.locator('.exrow').filter({ hasText: 'In pool' })).toHaveCount(area.poolExerciseIds.length);
    await page.getByRole('button', { name: `Add ${target.name}`, exact: true }).click();
    await expect(page).toHaveURL(/plan\/area\/area-1/);
    const st = await readState(page);
    expect(st.areas['area-1'].poolExerciseIds).toContain(target.id);
    expect(st.areas['area-1'].poolExerciseIds.length).toBe(area.poolExerciseIds.length + 1);
    await page.getByRole('button', { name: /Add from library/ }).click();
    await expect(page.getByRole('button', { name: `Already added: ${target.name}`, exact: true })).toBeVisible();
    await expect(page.locator('.exrow').filter({ hasText: target.name }).first()).toContainText('In pool');
    // picking an already-added exercise does not duplicate it
    await page.getByRole('button', { name: `Already added: ${target.name}`, exact: true }).click();
    await expect(page).toHaveURL(/plan\/area\/area-1/);
    expect((await readState(page)).areas['area-1'].poolExerciseIds.filter((x: string) => x === target.id)).toHaveLength(1);
  });

  test('add mode empty search offers to create', async ({ page }) => {
    await seed(page, { device: { chosenSlot: 2, currentGymId: GYM_ID, gymSource: 'manual' } });
    await page.goto('library/all?add=1');
    await page.getByRole('searchbox').fill('qqq');
    await expect(page.getByRole('heading', { name: 'No matches' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create “qqq”' })).toBeVisible();
  });
});
