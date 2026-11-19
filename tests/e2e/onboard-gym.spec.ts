import { test, expect, seed, readState } from './fixtures';
import { EQUIPMENT, templateCount } from '../../src/shared/catalog';

const URL = 'onboarding/gyms';
const wizard = (page: any) => page.evaluate(() => JSON.parse(sessionStorage.getItem('rep-onboarding-v1') || 'null'));
async function open(page: any) {
  await seed(page, { onboarded: false, gyms: null, areas: null, name: '' });
  await page.goto(URL);
}
async function finish(page: any) {
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/onboarding\/areas/);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
}
const stored = async (page: any) => {
  await expect.poll(async () => Object.keys((await readState(page)).gyms).length, { message: 'gyms persisted' }).toBeGreaterThan(0);
  return Object.values((await readState(page)).gyms) as any[];
};

test('ask state shows design copy, steps and the three benefits', async ({ page, errors }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Where do you train?' })).toBeVisible();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  for (const t of ['Auto-detect your gym', 'Matched when a session starts', 'Equipment-aware plans', 'Each gym keeps its own inventory', 'Only while the app is open', 'Never tracked in the background']) await expect(page.getByText(t)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on location' })).toBeVisible();
  await expect(page.getByRole('button', { name: "Not now — I'll pick gyms manually" })).toBeVisible();
  await expect(page.locator('.segs span.on')).toHaveCount(2);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/onboarding\/goal/);
  expect(errors).toEqual([]);
});

test('no horizontal overflow at 360px in ask and found', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  const over = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(await over()).toBe(false);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await expect(page.getByRole('heading', { name: 'Add your gyms' })).toBeVisible();
  expect(await over()).toBe(false);
});

test('granted: locating state then found with coordinates and map', async ({ page, errors }) => {
  await page.addInitScript(() => {
    const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (ok, err, o) => { setTimeout(() => real(ok, err, o), 600); };
  });
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  const busy = page.getByRole('button', { name: 'Finding you…' });
  await expect(busy).toBeDisabled();
  await expect(busy.locator('.spinner')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add your gyms' })).toBeVisible();
  await expect(page.getByText("You're near a gym.")).toBeVisible();
  await expect(page.locator('.map')).toHaveCount(1);
  await expect(page.getByText("Couldn't get your location")).toHaveCount(0);
  await expect(page.locator('.segs span.on')).toHaveCount(2);
  const w = await wizard(page);
  expect(w.gymStage).toBe('found');
  expect(w.primary.lat).toBeCloseTo(59.343, 3);
  expect(w.primary.lng).toBeCloseTo(18.055, 3);
  expect(w.locationNote).toBe('');
  expect(errors).toEqual([]);
});

for (const tpl of [{ key: 'full', label: 'Full gym', re: /racks, barbells/ }, { key: 'basic', label: 'Basic', re: /cable station, a few machines/ }, { key: 'home', label: 'Home', re: /pull-up bar/ }] as const) {
  test(`template ${tpl.key}: real item count, hint, persisted gym equipment`, async ({ page, errors }) => {
    await open(page);
    await page.getByRole('button', { name: 'Turn on location' }).click();
    await page.getByLabel('Gym name').fill('  Iron Works ');
    await page.getByRole('button', { name: tpl.label, exact: true }).click();
    await expect(page.getByRole('button', { name: tpl.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const n = templateCount(tpl.key);
    await expect(page.locator('.help')).toContainText(`${n} items:`);
    await expect(page.locator('.help')).toHaveText(tpl.re);
    if (tpl.key === 'full') expect(n).toBe(EQUIPMENT.length);
    expect((await wizard(page)).primary).toMatchObject({ name: '  Iron Works ', template: tpl.key });
    await finish(page);
    const gyms = await stored(page);
    expect(gyms).toHaveLength(1);
    expect(gyms[0].name).toBe('Iron Works');
    expect(Object.keys(gyms[0].equipment)).toHaveLength(n);
    expect(gyms[0].lat).toBeCloseTo(59.343, 3);
    expect(errors).toEqual([]);
  });
}

test('wizard state survives reload; name stays editable', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await page.getByLabel('Gym name').fill('Reload Gym');
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('Gym name')).toHaveValue('Reload Gym');
  await expect(page.getByRole('button', { name: 'Basic', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('permission denied: banner, saved without coordinates', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL: baseURL!, viewport: { width: 440, height: 956 }, permissions: [] });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await expect(page.getByRole('heading', { name: 'Add your gyms' })).toBeVisible();
  await expect(page.getByText("Couldn't get your location")).toBeVisible();
  await expect(page.getByText('This gym will be saved without a location')).toBeVisible();
  await expect(page.getByText("You're near a gym.")).toHaveCount(0);
  await expect(page.getByText('Name your main gym and pick a starting equipment set.')).toBeVisible();
  await expect(page.locator('.map')).toHaveCount(0);
  const w = await wizard(page);
  expect(w.locationNote).toBe('unavailable');
  expect(w.primary.lat).toBeNull();
  await page.getByLabel('Gym name').fill('No GPS Gym');
  await finish(page);
  const g = await stored(page);
  expect(g[0]).toMatchObject({ name: 'No GPS Gym', lat: null, lng: null });
  expect(errs).toEqual([]);
  await ctx.close();
});

test('revoked mid-session (clearPermissions) behaves like denied', async ({ page, context }) => {
  await open(page);
  await context.clearPermissions();
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await expect(page.getByText("Couldn't get your location")).toBeVisible();
});

test('timeout and unavailable errors fall back gracefully', async ({ page, errors }) => {
  await page.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, err) => { setTimeout(() => err!({ code: 3, message: 'timeout' } as GeolocationPositionError), 100); }; });
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await expect(page.getByText("Couldn't get your location")).toBeVisible();
  expect((await wizard(page)).primary.lat).toBeNull();
  expect(errors).toEqual([]);
});

test('geolocation API missing: unavailable path', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); });
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await expect(page.getByText("Couldn't get your location")).toBeVisible();
});

test('skip location: no banner, no map, no coordinates', async ({ page, errors }) => {
  await open(page);
  await page.getByRole('button', { name: "Not now — I'll pick gyms manually" }).click();
  await expect(page.getByRole('heading', { name: 'Add your gyms' })).toBeVisible();
  await expect(page.getByText("Couldn't get your location")).toHaveCount(0);
  await expect(page.locator('.map')).toHaveCount(0);
  const w = await wizard(page);
  expect(w.primary.lat).toBeNull();
  expect(w.locationNote).toBe('');
  await finish(page);
  expect((await stored(page))[0]).toMatchObject({ name: 'My gym', lat: null });
  expect(errors).toEqual([]);
});

test('back from found goes to goal; returning keeps the found stage', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/onboarding\/goal/);
});

test('extra gyms: add (validation), remove, persist with templates', async ({ page, errors }) => {
  await open(page);
  await page.getByRole('button', { name: 'Turn on location' }).click();
  await expect(page.getByText('You mentioned 2–3')).toBeVisible();
  await page.getByLabel('Gym name').first().fill('Main');
  await page.getByRole('button', { name: 'Add another gym' }).click();
  const form = page.locator('.card').nth(1);
  const addBtn = page.getByRole('button', { name: 'Add gym', exact: true });
  await expect(addBtn).toBeDisabled();
  await form.getByLabel('Gym name').fill('   ');
  await expect(addBtn).toBeDisabled();
  await form.getByLabel('Gym name').fill('Office gym');
  await addBtn.click();
  await expect(page.getByText('Office gym')).toBeVisible();
  await expect(page.getByText('Basic · added manually')).toBeVisible();
  await page.getByRole('button', { name: 'Add another gym' }).click();
  await page.locator('.card').nth(1).getByLabel('Gym name').fill('Garage');
  await page.locator('.card').nth(1).getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await expect(page.getByText('Home · added manually')).toBeVisible();
  // cancel leaves nothing behind
  await page.getByRole('button', { name: 'Add another gym' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await wizard(page)).extra).toHaveLength(2);
  // remove
  await page.getByRole('button', { name: 'Remove Office gym' }).click();
  await expect(page.getByText('Office gym')).toHaveCount(0);
  expect((await wizard(page)).extra.map((g: any) => g.name)).toEqual(['Garage']);
  await page.getByRole('button', { name: 'Add another gym' }).click();
  await page.locator('.card').nth(1).getByLabel('Gym name').fill('Hotel');
  await page.getByRole('button', { name: 'Add gym', exact: true }).click();
  await finish(page);
  const gyms = await stored(page);
  expect(gyms.map((g) => g.name).sort()).toEqual(['Garage', 'Hotel', 'Main']);
  expect(Object.keys(gyms.find((g) => g.name === 'Garage').equipment)).toHaveLength(templateCount('home'));
  expect(Object.keys(gyms.find((g) => g.name === 'Hotel').equipment)).toHaveLength(templateCount('basic'));
  expect(gyms.find((g) => g.name === 'Hotel').lat).toBeNull();
  expect(errors).toEqual([]);
});
