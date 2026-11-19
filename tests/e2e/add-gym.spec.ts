import { test, expect, seed, readState, makeGym, HOME } from './fixtures';
import { templateCount, templateEquipment, TEMPLATE_META, type GymTemplate } from '../../src/shared/catalog';

const gymsNow = async (page: any) => Object.values((await readState(page))?.gyms ?? {}) as any[];
/** The store persists on a 250 ms debounce: poll until at least n gyms are stored. */
const gymsOf = async (page: any, n = 1) => { await expect.poll(async () => (await gymsNow(page)).length).toBeGreaterThanOrEqual(n); return gymsNow(page); };
const overflow = (page: any) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const save = (page: any) => page.getByRole('button', { name: 'Save and review equipment' }).click();
const TPLS: GymTemplate[] = ['full', 'basic', 'home', 'empty'];

test.beforeEach(async ({ page }) => { await seed(page, { gyms: null }); await page.goto('gyms/new'); });

test('initial state: copy, templates with real counts, basic preselected, no radius yet', async ({ page, errors }) => {
  await expect(page.getByText('Add gym', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('e.g. Hotel gym Gothenburg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my current location' })).toBeVisible();
  await expect(page.getByText('Start from a template, then fine-tune')).toBeVisible();
  for (const t of TPLS) {
    const row = page.getByRole('radio', { name: new RegExp(TEMPLATE_META[t].label) });
    await expect(row).toContainText(t === 'empty' ? 'Add items one by one' : `${templateCount(t)} items`);
  }
  expect(templateCount('full')).toBe(Object.keys(templateEquipment('full')).length);
  await expect(page.getByRole('radio', { name: /Basic/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.seg.c3')).toHaveCount(0);
  await expect(page.getByLabel('Search address')).toHaveCount(0); // needs an external geocoder: omitted
  expect(errors).toEqual([]);
});

test('validation: empty name and missing location show errors and do not save', async ({ page }) => {
  await save(page);
  await expect(page.getByText('Name the gym so you can tell them apart.')).toBeVisible();
  await expect(page.getByText("Set a location. It's how the gym is detected.")).toBeVisible();
  await expect(page.locator('input.input.err')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(await gymsNow(page)).toHaveLength(0);
  await expect(page).toHaveURL(/gyms\/new$/);
  await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill('   ');
  await page.getByRole('button', { name: 'Skip location for now' }).click();
  await save(page);
  await expect(page.getByText('Name the gym so you can tell them apart.')).toBeVisible(); // whitespace-only
  await page.waitForTimeout(500);
  expect(await gymsNow(page)).toHaveLength(0);
});

test('location: real geolocation fills coordinates, Change returns', async ({ page }) => {
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByText(`${HOME.lat.toFixed(4)}° N, ${HOME.lng.toFixed(4)}° E`)).toBeVisible();
  await expect(page.locator('.map')).toBeVisible();
  await expect(page.locator('.seg.c3 button')).toHaveText(['100 m', '150 m', '250 m']);
  await expect(page.getByRole('button', { name: '150 m' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('button', { name: 'Use my current location' })).toBeVisible();
});

for (const t of TPLS) {
  for (const r of [100, 150, 250]) {
    test(`add with template ${t} and radius ${r} -> persisted, opens gym detail`, async ({ page, errors }) => {
      await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill(`  Gym ${t} ${r}  `);
      await page.getByRole('button', { name: 'Use my current location' }).click();
      await page.getByRole('button', { name: `${r} m` }).click();
      await expect(page.getByRole('button', { name: `${r} m` })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('radio', { name: new RegExp(TEMPLATE_META[t].label) }).click();
      await expect(page.getByRole('radio', { name: new RegExp(TEMPLATE_META[t].label) })).toHaveAttribute('aria-checked', 'true');
      await save(page);
      const gyms = await gymsOf(page);
      expect(gyms).toHaveLength(1);
      const g = gyms[0];
      expect(g.name).toBe(`Gym ${t} ${r}`);
      expect(g.radiusM).toBe(r);
      expect(g.lat).toBeCloseTo(HOME.lat, 3);
      expect(g.lng).toBeCloseTo(HOME.lng, 3);
      expect(Object.keys(g.equipment).length).toBe(templateCount(t));
      expect(Object.values(g.equipment).every((s) => s === 'ok')).toBe(true);
      await expect(page).toHaveURL(new RegExp(`gyms/${g.id}$`));
      expect((await readState(page)).device.currentGymId).toBe(g.id); // first gym becomes current
      expect(errors).toEqual([]);
    });
  }
}

test('skip location: saves with null coordinates, undo skip re-requires location', async ({ page }) => {
  await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill('Hotel gym');
  await page.getByRole('button', { name: 'Skip location for now' }).click();
  await expect(page.getByRole('button', { name: 'Saving without a location (undo)' })).toBeVisible();
  await page.getByRole('button', { name: 'Saving without a location (undo)' }).click();
  await save(page);
  await expect(page.getByText("Set a location. It's how the gym is detected.")).toBeVisible();
  await page.getByRole('button', { name: 'Skip location for now' }).click();
  await save(page);
  const g = (await gymsOf(page))[0];
  expect(g.lat).toBeNull();
  expect(g.lng).toBeNull();
  await expect(page).toHaveURL(new RegExp(`gyms/${g.id}$`));
});

test('denied geolocation: warning shown, no coordinates, can retry or skip', async ({ page, errors }) => {
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: 'denied' } as GeolocationPositionError); });
  await page.goto('gyms/new');
  await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill('No GPS gym');
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByRole('alert')).toContainText("Couldn't get your location");
  await expect(page.getByRole('button', { name: 'Use my current location' })).toBeEnabled();
  await save(page);
  await page.waitForTimeout(500);
  expect(await gymsNow(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Skip location for now' }).click();
  await save(page);
  const g = (await gymsOf(page))[0];
  expect(g.lat).toBeNull();
  expect(g.name).toBe('No GPS gym');
  expect(errors).toEqual([]);
});

test('duplicate names are allowed and stored as separate gyms', async ({ page }) => {
  for (let i = 0; i < 2; i++) {
    await page.goto('gyms/new');
    await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill('Twin');
    await page.getByRole('button', { name: 'Skip location for now' }).click();
    await save(page);
    await expect(page).toHaveURL(/gyms\/[^/]+$/);
    await gymsOf(page, i + 1); // wait for the debounced persist before reloading
  }
  const gyms = await gymsOf(page, 2);
  expect(gyms.map((g) => g.name)).toEqual(['Twin', 'Twin']);
  expect(new Set(gyms.map((g) => g.id)).size).toBe(2);
  await page.goto('gyms');
  await expect(page.locator('.group a.li', { hasText: 'Twin' })).toHaveCount(2);
});

test('adding a second gym keeps the current gym and lists both', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 440, height: 956 } });
  const page = await ctx.newPage();
  await seed(page, { gyms: [makeGym()] });
  await page.goto('gyms/new');
  await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill('Second');
  await page.getByRole('button', { name: 'Skip location for now' }).click();
  await save(page);
  await expect(page).toHaveURL(/gyms\/[^/]+$/);
  await gymsOf(page, 2);
  const st = await readState(page);
  expect(Object.keys(st.gyms)).toHaveLength(2);
  expect(st.device.currentGymId).toBe('gym-city');
  await ctx.close();
});

test('cancel returns to gyms without saving', async ({ page }) => {
  await page.getByPlaceholder('e.g. Hotel gym Gothenburg').fill('Never');
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/gyms$/);
  await page.waitForTimeout(500);
  expect(await gymsNow(page)).toHaveLength(0);
});

test('375px and 360px: no horizontal overflow, bottom bar reachable', async ({ page }) => {
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 667 });
    await page.goto('gyms/new');
    await page.getByRole('button', { name: 'Use my current location' }).click();
    await expect(page.locator('.map')).toBeVisible();
    expect(await overflow(page)).toBe(false);
    await expect(page.getByRole('button', { name: 'Save and review equipment' })).toBeInViewport();
  }
});
