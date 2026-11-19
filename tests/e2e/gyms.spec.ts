import { test, expect, seed, readState, makeGym, HOME, DAY } from './fixtures';
import { templateEquipment, templateCount } from '../../src/shared/catalog';

const stored = async (page: any) => (await readState(page)).gyms;
const settle = (page: any) => page.waitForTimeout(500); // store persists on a 250 ms debounce
const far = { lat: HOME.lat + 0.019, lng: HOME.lng }; // ~2.1 km north
const GYM_ROW = 'a.li:not(:has-text("Built in"))'; // the built-in No equipment row is not a gym
const overflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test('empty: no gyms shows empty state, 0 items, add links', async ({ page, errors }) => {
  await seed(page, { gyms: null });
  await page.goto('gyms');
  await expect(page.getByRole('heading', { name: 'Gyms' })).toBeVisible();
  await expect(page.getByText('0 gyms · 0 items mapped')).toBeVisible();
  await expect(page.getByText('No gyms yet. Add one so plans match the equipment you have.')).toBeVisible();
  await expect(page.locator(GYM_ROW)).toHaveCount(0);
  await expect(page.getByText('Plans only use what a gym has')).toBeVisible();
  await expect(page.locator('a.banner.info')).toHaveCount(0); // nothing to link to
  await page.getByRole('link', { name: 'Add gym' }).first().click();
  await expect(page).toHaveURL(/gyms\/new$/);
  expect(errors).toEqual([]);
});

test('one gym: singular count, here marker from GPS, item count, geofence line', async ({ page, errors }) => {
  await seed(page, { device: { geo: 'matched', gymSource: 'gps', geoDistanceM: 40, geoAccuracyM: 12 } });
  await page.goto('gyms');
  const n = templateCount('full');
  await expect(page.getByText(`1 gym · ${n} items mapped`)).toBeVisible();
  await expect(page.getByText("You're at City Gym Odenplan")).toBeVisible();
  await expect(page.getByText('GPS ±12 m · inside 150 m geofence')).toBeVisible();
  const row = page.locator('a.li', { hasText: 'City Gym Odenplan' });
  await expect(row.locator('.tag.green')).toHaveText('Here');
  await expect(row.locator('.li-s')).toHaveText(`${n} items · 40 m away`);
  await expect(row.locator('.tile.ink')).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/gyms\/gym-city$/);
  expect(errors).toEqual([]);
});

test('manual selection shows Current tag and "Training at"', async ({ page }) => {
  await seed(page, { device: { geo: 'idle', gymSource: 'manual' } });
  await page.goto('gyms');
  await expect(page.getByText('Training at City Gym Odenplan')).toBeVisible();
  await expect(page.getByText('Selected manually')).toBeVisible();
  await expect(page.locator('a.li .tag.green')).toHaveText('Current');
});

test('many gyms: counts, distances, last visited labels, order, navigation', async ({ page, errors }) => {
  const now = Date.now();
  const office = makeGym({ id: 'g-office', name: 'Office gym', ...far, equipment: templateEquipment('basic'), createdAt: 2, lastVisitedAt: now - 21 * DAY });
  const home = makeGym({ id: 'g-home', name: 'Home', lat: null, lng: null, equipment: templateEquipment('home'), createdAt: 3 });
  const wk = makeGym({ id: 'g-wk', name: 'Weekday gym', ...far, equipment: templateEquipment('empty'), createdAt: 4, lastVisitedAt: now - 3 * DAY });
  await seed(page, { gyms: [makeGym({ createdAt: 1 }), office, home, wk], device: { geo: 'matched', gymSource: 'gps', geoDistanceM: 12 } });
  await page.goto('gyms');
  const total = templateCount('full') + templateCount('basic') + templateCount('home');
  await expect(page.getByText(`4 gyms · ${total} items mapped`)).toBeVisible();
  const rows = page.locator(GYM_ROW);
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('City Gym Odenplan');
  await expect(rows.nth(1).locator('.li-s')).toHaveText(`${templateCount('basic')} items · 2.1 km · 3 weeks ago`);
  await expect(rows.nth(2).locator('.li-s')).toHaveText(`${templateCount('home')} items · dumbbells, bench, bands`); // a small gym reads as what it has
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(now - 3 * DAY).getDay()];
  await expect(rows.nth(3).locator('.li-s')).toHaveText(`0 items · 2.1 km · ${wd}`);
  await expect(page.locator('.tag.green')).toHaveCount(1);
  await rows.nth(1).click();
  await expect(page).toHaveURL(/gyms\/g-office$/);
  await page.goBack();
  await page.getByRole('link', { name: 'Plans only use what a gym has' }).click();
  await expect(page).toHaveURL(/gyms\/gym-city$/);
  expect(errors).toEqual([]);
});

test('geolocation unavailable: no distances, still lists gyms', async ({ page, errors }) => {
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: 'denied' } as GeolocationPositionError); });
  await seed(page, { gyms: [makeGym({ lastVisitedAt: Date.now() - DAY })], device: { geo: 'denied', gymSource: 'last' } });
  await page.goto('gyms');
  await expect(page.locator(GYM_ROW).locator('.li-s')).toHaveText(`${templateCount('full')} items · yesterday`);
  expect(errors).toEqual([]);
});

test('broken banner: Mark fixed, Undo restores status and original date, multi-broken', async ({ page, errors }) => {
  const since = Date.now() - 5 * DAY;
  const g = makeGym({ equipment: { ...templateEquipment('full'), barbell: 'broken', cable_station: 'broken' }, brokenSince: { barbell: since, cable_station: since + 1000 } });
  await seed(page, { gyms: [g] });
  await page.goto('gyms');
  const warn = page.locator('.banner.warn');
  await expect(warn).toContainText('Barbell (20 kg) marked broken');
  await expect(warn).toContainText('City Gym Odenplan');
  await expect(warn).toContainText('Hidden from plans there. 1 more broken.');
  await expect(page.locator(GYM_ROW).locator('.li-s')).toContainText('2 broken');
  await page.getByRole('button', { name: 'Mark fixed' }).click();
  await settle(page);
  expect((await stored(page))['gym-city'].equipment.barbell).toBe('ok');
  expect((await stored(page))['gym-city'].brokenSince.barbell).toBeUndefined();
  await expect(warn).toContainText('Cable station marked broken');
  await expect(warn).not.toContainText('more broken');
  const ok = page.locator('.banner.ok');
  await expect(ok).toContainText('Back in rotation');
  await expect(ok).toContainText('Barbell (20 kg) is available at City Gym Odenplan again.');
  await page.locator('.banner.ok').getByRole('button', { name: 'Undo' }).click();
  await expect(ok).toHaveCount(0);
  await settle(page);
  const st = (await stored(page))['gym-city'];
  expect(st.equipment.barbell).toBe('broken');
  expect(st.brokenSince.barbell).toBe(since);
  await expect(warn).toContainText('Barbell (20 kg) marked broken');
  await expect(page.locator(GYM_ROW).locator('.li-s')).toContainText('2 broken');
  expect(errors).toEqual([]);
});

test('broken banner: fixing the last one hides warning, shows Undo only; no banner when none broken', async ({ page }) => {
  const g = makeGym({ equipment: { ...templateEquipment('full'), dumbbells: 'broken' }, brokenSince: { dumbbells: Date.now() - DAY } });
  await seed(page, { gyms: [g] });
  await page.goto('gyms');
  await expect(page.locator('.banner.warn')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark fixed' }).click();
  await expect(page.locator('.banner.warn')).toHaveCount(0);
  await expect(page.locator('.banner.ok')).toHaveCount(1);
  await expect(page.getByText(`${templateCount('full')} items`).first()).toBeVisible();
});

test('no broken: no warn banner', async ({ page }) => {
  await seed(page);
  await page.goto('gyms');
  await expect(page.locator('.banner.warn, .banner.ok')).toHaveCount(0);
});

test('tab bar present with Gyms active', async ({ page }) => {
  await seed(page);
  await page.goto('gyms');
  await expect(page.locator('.tabbar .tab.on')).toContainText('Gyms');
});

test('375px and 360px: no horizontal overflow, many gyms + broken', async ({ page }) => {
  const g = makeGym({ name: 'A very long gym name that keeps going and going for wrapping tests', equipment: { ...templateEquipment('full'), barbell: 'broken' }, brokenSince: { barbell: Date.now() } });
  await seed(page, { gyms: [g, makeGym({ id: 'b', name: 'Second', ...far, createdAt: 5 })] });
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 667 });
    await page.goto('gyms');
    await expect(page.getByRole('heading', { name: 'Gyms' })).toBeVisible();
    expect(await overflow(page)).toBe(false);
  }
});

test.describe('built-in No equipment location', () => {
  test('separate group row: Built in tag, computed bodyweight count, not counted as a gym or in items mapped', async ({ page, errors }) => {
    await seed(page, { gyms: [makeGym()] });
    await page.goto('gyms');
    const { SEED_EXERCISES } = await import('../../src/shared/exercises');
    const { bodyweightExercises } = await import('../../src/shared/location');
    const n = bodyweightExercises(SEED_EXERCISES).length;
    await expect(page.getByText(`1 gym · ${templateCount('full')} items mapped`)).toBeVisible();
    const row = page.getByRole('link', { name: /No equipment/ });
    await expect(row.locator('.li-t')).toHaveText('No equipment');
    await expect(row.locator('.li-s')).toHaveText(`Built in · always available · ${n} bodyweight exercises`);
    await expect(row.locator('.tag')).toHaveText('Built in');
    await expect(row.locator('.tile.warm .ic-user')).toHaveCount(1);
    // its own group, after the gyms group
    await expect(page.locator('.group')).toHaveCount(2);
    await expect(page.locator('.group').nth(1)).toContainText('No equipment');
    await expect(page.locator(GYM_ROW)).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('also present with no gyms at all, and tapping it opens the preview at home', async ({ page }) => {
    await seed(page, { gyms: null, device: { chosenSlot: 2, currentGymId: null, gymSource: 'none' } });
    await page.goto('gyms');
    await expect(page.getByText('0 gyms · 0 items mapped')).toBeVisible();
    await page.getByRole('link', { name: /No equipment/ }).click();
    await expect(page).toHaveURL(/session\/preview/);
    await expect(page.getByRole('button', { name: 'At home, no equipment' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Start at home' })).toBeEnabled();
    await expect.poll(async () => (await readState(page)).device.currentGymId).toBe('none');
  });

  test('current location at home: no "You\'re at" map card, gym rows are not marked Here; 375px has no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, { gyms: [makeGym()], device: { currentGymId: 'none', gymSource: 'manual' } });
    await page.goto('gyms');
    await expect(page.getByText(/You're at|Training at/)).toHaveCount(0);
    await expect(page.locator('.tag.green')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /No equipment/ })).toBeVisible();
    expect(await overflow(page)).toBe(false);
    await page.screenshot({ path: `${process.env.SHOTS_DIR ?? 'test-results/shots'}/gyms-375.png` });
  });
});
