import { seed, makeGym, readState, test, expect, GYM_ID } from './fixtures';
import { SEED_BY_ID } from '../../src/shared/exercises';
import { templateEquipment } from '../../src/shared/catalog';
import { availableEquipment, isAvailable } from '../../src/shared/rules';
import { mergeLibrary } from '../../src/shared/exercises';

const URL = `gyms/${GYM_ID}`;
const row = (page: any, name: string) => page.locator('label.li', { hasText: name }).first();
const gymOf = async (page: any) => (await readState(page)).gyms[GYM_ID];
// persistence is async: wait until the stored gym satisfies the predicate, then return it
const settled = async (page: any, ok: (g: any) => boolean) => { await expect.poll(async () => ok(await gymOf(page))).toBe(true); return gymOf(page); };

test.describe('GymDetail', () => {
  test('renders stats, notes, categories and counts from real data', async ({ page, errors }) => {
    await seed(page, { gyms: [makeGym({ equipment: { barbell: 'ok', dumbbells: 'ok', squat_rack: 'ok' } })] });
    await page.goto(URL);
    await expect(page.locator('.title')).toHaveText('City Gym Odenplan');
    const av = availableEquipment(makeGym({ equipment: { barbell: 'ok', dumbbells: 'ok', squat_rack: 'ok' } }));
    const exN = mergeLibrary([]).filter((e) => !e.archived && isAvailable(e, av)).length;
    await expect(page.locator('.stat').nth(0).locator('.stat-v')).toHaveText('3');
    await expect(page.locator('.stat').nth(0).locator('.stat-l')).toHaveText('Available here');
    await expect(page.locator('.stat').nth(1).locator('.stat-v')).toHaveText(String(exN));
    await expect(page.locator('.stat').nth(1).locator('.stat-l')).toHaveText('Exercises you can do here');
    await expect(page.getByText('Free weights')).toBeVisible();
    await expect(page.getByText('2 of 2').first()).toBeVisible();
    await expect(row(page, 'Barbell')).toContainText(/Used by \d+ exercises/);
    await expect(page.getByText("Turn off anything this gym doesn't have. Exercises that need it won't be planned here.")).toBeVisible();
    await expect(page.locator('input.switch[aria-label="Barbell (20 kg) available"]')).toBeChecked();
    await expect(page.locator('.li', { hasText: 'Leg press' })).toHaveCount(0);
  });

  test('every status transition is persisted (ok -> off -> on -> broken -> fixed)', async ({ page, errors }) => {
    await seed(page, { gyms: [makeGym({ equipment: { barbell: 'ok', dumbbells: 'ok' } })] });
    await page.goto(URL);
    const sw = page.locator('input.switch[aria-label="Barbell (20 kg) available"]');
    // ok -> none
    await sw.click();
    await expect(sw).not.toBeChecked();
    await expect(row(page, 'Barbell')).toContainText(/Not here: \d+ exercises hidden/);
    await expect(page.locator('.toast')).toContainText('Barbell (20 kg) off:');
    await expect(page.locator('.stat-v').first()).toHaveText('1');
    await expect.poll(async () => (await gymOf(page)).equipment.barbell).toBeUndefined();
    // none -> ok
    await sw.click();
    await expect(sw).toBeChecked();
    await expect(page.locator('.toast')).toContainText('Barbell (20 kg) on:');
    await expect.poll(async () => (await gymOf(page)).equipment.barbell).toBe('ok');
    // ok -> broken
    await row(page, 'Barbell').getByRole('button', { name: 'Barbell (20 kg) broken' }).click();
    await expect(row(page, 'Barbell')).toContainText(/Since \w+ \d+ \w+: \d+ exercises hidden/);
    await expect(sw).not.toBeChecked();
    await expect(page.locator('.stat-v').first()).toHaveText('1');
    let g = await settled(page, (x) => x.equipment.barbell === 'broken');
    expect(g.equipment.barbell).toBe('broken');
    expect(Date.now() - g.brokenSince.barbell).toBeLessThan(60000);
    // broken -> ok (via the broken toggle)
    await row(page, 'Barbell').getByRole('button', { name: 'Barbell (20 kg) broken' }).click();
    g = await settled(page, (x) => x.equipment.barbell === 'ok' && x.brokenSince.barbell === undefined);
    expect(g.equipment.barbell).toBe('ok');
    expect(g.brokenSince.barbell).toBeUndefined();
    // broken -> ok via the switch
    await row(page, 'Barbell').getByRole('button', { name: 'Barbell (20 kg) broken' }).click();
    await sw.click();
    g = await settled(page, (x) => x.equipment.barbell === 'ok' && x.brokenSince.barbell === undefined);
    expect(g.equipment.barbell).toBe('ok');
    expect(g.brokenSince.barbell).toBeUndefined();
    // none rows have no broken button
    await sw.click();
    await expect(row(page, 'Barbell').getByRole('button', { name: /broken/ })).toHaveCount(0);
  });

  test('search filters, shows off-catalog items to enable, and empty state', async ({ page, errors }) => {
    await seed(page, { gyms: [makeGym({ equipment: { barbell: 'ok', dumbbells: 'ok' } })] });
    await page.goto(URL);
    const s = page.getByLabel('Search equipment');
    await s.fill('dumb');
    await expect(page.locator('label.li')).toHaveCount(1);
    await expect(page.getByText('Free weights')).toBeVisible();
    await s.fill('leg press');
    await expect(row(page, 'Leg press')).toContainText('Not here');
    await row(page, 'Leg press').locator('input.switch').click();
    await settled(page, (x) => x.equipment.leg_press === 'ok');
    await s.fill('zzzz');
    await expect(page.getByText('No equipment matches.')).toBeVisible();
    await s.fill('');
    await expect(row(page, 'Leg press')).toBeVisible();
  });

  test('radius chips persist and move the map fence', async ({ page, errors }) => {
    await seed(page);
    await page.goto(URL);
    const fence = page.locator('.fence');
    await expect(page.getByRole('button', { name: '150 m' })).toHaveAttribute('aria-pressed', 'true');
    await expect(fence).toHaveCSS('width', '90px');
    await page.getByRole('button', { name: '100 m' }).click();
    await expect(page.getByRole('button', { name: '100 m' })).toHaveAttribute('aria-pressed', 'true');
    await expect(fence).toHaveCSS('width', '64px');
    await settled(page, (x) => x.radiusM === 100);
    await page.getByRole('button', { name: '250 m' }).click();
    await expect(fence).toHaveCSS('width', '128px');
    await settled(page, (x) => x.radiusM === 250);
  });

  test('update location to here stores coordinates', async ({ page, context, errors }) => {
    await seed(page, { gyms: [makeGym({ lat: null, lng: null })] });
    await context.setGeolocation({ latitude: 59.1234, longitude: 18.5678 });
    await page.goto(URL);
    await expect(page.getByText("No location set. This gym can't be detected automatically.")).toBeVisible();
    await page.getByRole('button', { name: 'Update location to here' }).click();
    await expect(page.getByText('Location updated.')).toBeVisible();
    await expect(page.getByText('59.1234, 18.5678')).toBeVisible();
    const g = await settled(page, (x) => x.lat != null && Math.abs(x.lat - 59.1234) < 0.001);
    expect(g.lat).toBeCloseTo(59.1234, 3);
    expect(g.lng).toBeCloseTo(18.5678, 3);
  });

  test('update location shows an error when denied', async ({ page, context, errors }) => {
    await seed(page);
    await context.clearPermissions();
    await page.goto(URL);
    await page.getByRole('button', { name: 'Update location to here' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't get your location");
    expect((await gymOf(page)).lat).toBeCloseTo(59.343, 3);
  });

  test('rename validates and persists', async ({ page, errors }) => {
    await seed(page);
    await page.goto(URL);
    await page.getByRole('button', { name: 'Rename gym' }).click();
    const input = page.getByRole('dialog', { name: 'Rename gym' }).locator('input');
    await expect(input).toHaveValue('City Gym Odenplan');
    await input.fill('   ');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await input.fill('Basement Iron');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.title')).toHaveText('Basement Iron');
    await settled(page, (x) => x.name === 'Basement Iron');
    await page.getByRole('button', { name: 'Rename gym' }).click();
    await page.getByRole('button', { name: 'Cancel' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await gymOf(page)).name).toBe('Basement Iron');
  });

  test('delete asks for confirmation; keep cancels; delete removes and navigates', async ({ page, errors }) => {
    await seed(page);
    await page.goto(URL);
    await page.getByRole('button', { name: 'Delete gym' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Delete City Gym Odenplan?');
    await page.getByRole('button', { name: 'Keep gym' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await gymOf(page)).deleted).toBeFalsy();
    await page.getByRole('button', { name: 'Delete gym' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete gym' }).click();
    await expect(page).toHaveURL(/\/gyms$/);
    await settled(page, (x) => x.deleted === true);
  });

  test('add equipment sheet lists missing items and adds them', async ({ page, errors }) => {
    await seed(page, { gyms: [makeGym({ equipment: { barbell: 'ok' } })] });
    await page.goto(URL);
    await expect(row(page, 'Mat')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add equipment' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add equipment' });
    await expect(sheet.getByText('Barbell (20 kg)')).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Add Mat' }).click();
    await expect(sheet.getByText('Mat')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Mat on:');
    await settled(page, (x) => x.equipment.mat === 'ok');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(row(page, 'Mat')).toBeVisible();
    await expect(page.locator('.stat-v').first()).toHaveText('2');
  });

  test('add sheet reports when everything is already here', async ({ page, errors }) => {
    const all = Object.keys(templateEquipment('full'));
    const eq: Record<string, 'ok'> = {};
    for (const id of all) eq[id] = 'ok';
    await seed(page, { gyms: [makeGym({ equipment: { ...eq, ...Object.fromEntries(Object.keys((await import('../../src/shared/catalog')).EQUIP_BY_ID).map((k) => [k, 'ok'])) } as any })] });
    await page.goto(URL);
    await page.getByRole('button', { name: 'Add equipment' }).click();
    await expect(page.getByText('Everything in the catalog is already at this gym.')).toBeVisible();
  });

  test('a gym without a barbell yields no barbell exercise in the Today draft', async ({ page, errors }) => {
    await seed(page);
    await page.goto('');
    await expect.poll(async () => (await readState(page)).device.draft?.exercises.length ?? 0).toBeGreaterThan(0);
    const before = (await readState(page)).device.draft.exercises as { exerciseId: string }[];
    expect(before.some((e) => SEED_BY_ID[e.exerciseId]?.equipment.includes('barbell'))).toBe(true);
    await page.goto(URL);
    await page.locator('input.switch[aria-label="Barbell (20 kg) available"]').click();
    await expect.poll(async () => (await readState(page)).device.draft).toBeNull();
    await page.goto('');
    await expect.poll(async () => (await readState(page)).device.draft?.exercises.length ?? 0).toBeGreaterThan(0);
    const after = (await readState(page)).device.draft.exercises as { exerciseId: string }[];
    expect(after.some((e) => SEED_BY_ID[e.exerciseId]?.equipment.includes('barbell'))).toBe(false);
  });

  test('unknown and deleted gym id show the not-found state', async ({ page, errors }) => {
    await seed(page, { gyms: [makeGym({ deleted: true })] });
    await page.goto('gyms/nope');
    await expect(page.getByText("This gym doesn't exist any more.")).toBeVisible();
    await page.getByRole('link', { name: 'Back to Gyms' }).first().click();
    await expect(page).toHaveURL(/\/gyms$/);
    await page.goto(URL);
    await expect(page.getByText("This gym doesn't exist any more.")).toBeVisible();
  });

  test('back link goes to gyms', async ({ page, errors }) => {
    await seed(page);
    await page.goto(URL);
    await page.getByRole('link', { name: 'Back to Gyms' }).click();
    await expect(page).toHaveURL(/\/gyms$/);
  });

  test('375px: no horizontal overflow, targets reachable', async ({ page, errors }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page);
    await page.goto(URL);
    await expect(page.locator('.title')).toBeVisible();
    for (const w of [375, 360]) {
      await page.setViewportSize({ width: w, height: 667 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.screenshot({ path: '/tmp/gd-375.png', fullPage: false });
  });
});
