import { test, expect, seed, readState, makeGym, makeAreas, makeSession, buildState, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';

const FAR = { latitude: 59.62, longitude: 18.6 };
const HOME_GYM = () => makeGym({ id: 'gym-home', name: 'Home', lat: 59.5, lng: 18.4, equipment: { dumbbells: 'ok', adj_bench: 'ok', bands: 'ok', mat: 'ok', pullup_bar: 'ok' } as never });
const start = (o: Record<string, unknown> = {}) => ({ device: { chosenSlot: 2, currentGymId: 'gym-city', gymSource: 'last', ...o } });
/** Store persists on a 250 ms debounce: wait until the persisted copy satisfies `ok`, then return it. */
async function settled(page: Page, ok: (st: any) => boolean) {
  await expect.poll(async () => { const st = await readState(page); return !!st && ok(st); }).toBe(true);
  return readState(page);
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ─────────────────────────── Location denied ───────────────────────────
test.describe('location denied', () => {
  test.use({ permissions: [], viewport: { width: 375, height: 667 } });
  const gyms = () => [makeGym({ lastVisitedAt: Date.now() - 2 * 86400000 } as never), HOME_GYM()];

  test('renders the artboard: copy, gym list, no pre-selection, CTA disabled', async ({ page, errors }) => {
    await seed(page, { gyms: gyms(), ...start() });
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: 'Location is off' })).toBeVisible();
    await expect(page.locator('.title')).toHaveText('Start session 2');
    await expect(page.getByText("We can't detect your gym, so pick it yourself. Plans will only include exercises that gym's equipment supports.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on in phone settings' })).toBeVisible();
    await expect(page.locator('.lbl', { hasText: 'Where are you?' })).toBeVisible();
    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(2);
    await expect(radios.first()).toContainText('City Gym Odenplan');
    await expect(radios.first()).toContainText(/Last used 2 days ago|Last used/);
    await expect(radios.nth(1)).toContainText('Not used yet');
    for (const r of await radios.all()) await expect(r).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('link', { name: 'Somewhere new' })).toHaveAttribute('href', /gyms\/new/);
    await expect(page.getByRole('button', { name: /Continue without gym/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pick a gym to continue' })).toBeDisabled();
    expect(await noOverflow(page)).toBe(true);
    await page.setViewportSize({ width: 360, height: 700 });
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('picking a gym enables "Continue at <gym>" and carries on to the plan with that gym', async ({ page }) => {
    await seed(page, { gyms: gyms(), ...start() });
    await page.goto('session/preview');
    await page.getByRole('radio', { name: /Home/ }).click();
    await expect(page.getByRole('radio', { name: /Home/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /City Gym/ })).toHaveAttribute('aria-checked', 'false');
    const cta = page.getByRole('button', { name: 'Continue at Home' });
    await expect(cta).toBeEnabled();
    await cta.click();
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.getByText('Chosen by you')).toBeVisible();
    await expect(page.locator('.li-t', { hasText: 'Home' }).first()).toBeVisible();
    const st = await settled(page, (x) => x.device.currentGymId === 'gym-home');
    expect(st.device.gymSource).toBe('manual');
  });

  test('"Turn on in phone settings" shows a hint toast that OK dismisses', async ({ page }) => {
    await seed(page, { gyms: gyms(), ...start() });
    await page.goto('session/preview');
    await page.getByRole('button', { name: 'Turn on in phone settings' }).click();
    const toast = page.locator('.toast');
    await expect(toast).toContainText('Open your phone');
    await toast.getByRole('button', { name: 'OK' }).click();
    await expect(toast).toHaveCount(0);
  });

  test.describe('on iOS', () => {
    test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
    test('toast uses the artboard iOS settings path', async ({ page }) => {
      await seed(page, { gyms: gyms(), ...start() });
      await page.goto('session/preview');
      await page.getByRole('button', { name: 'Turn on in phone settings' }).click();
      await expect(page.locator('.toast')).toHaveText('Opens iOS Settings › Rep › LocationOK');
    });
  });

  test('"Somewhere new" opens Add gym; Back returns to Today', async ({ page }) => {
    await seed(page, { gyms: gyms(), ...start() });
    await page.goto('session/preview');
    await page.getByRole('link', { name: 'Somewhere new' }).click();
    await expect(page).toHaveURL(/gyms\/new/);
    await page.goto('session/preview');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/app\/?$/);
  });

  test('a manually chosen gym skips the screen entirely', async ({ page }) => {
    await seed(page, { gyms: gyms(), ...start({ gymSource: 'manual' }) });
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Location is off' })).toHaveCount(0);
  });
});

// ─────────────────────────── Unknown gym ───────────────────────────
test.describe('unknown gym', () => {
  test.use({ geolocation: FAR, viewport: { width: 375, height: 667 } });
  const two = () => ({ gyms: [makeGym(), HOME_GYM()], ...start() });

  test('renders the artboard: map, heading, nearest distance, three options, new preselected', async ({ page, errors }) => {
    await seed(page, two());
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: "You're somewhere new" })).toBeVisible();
    await expect(page.locator('.title')).toHaveText('Start session 2');
    await expect(page.locator('.map')).toBeVisible();
    await expect(page.locator('.sub').first()).toHaveText(/^Nearest saved gym is \d+(\.\d)? km away\. Where are you training\?$/);
    const opts = page.getByRole('radio');
    await expect(opts).toHaveCount(3);
    await expect(opts.nth(0)).toContainText('Save as a new gym');
    await expect(opts.nth(0)).toContainText('Map its equipment once and it’s detected from now on');
    await expect(opts.nth(1)).toContainText('It’s one of my gyms');
    await expect(opts.nth(1)).toContainText('GPS was off target');
    await expect(opts.nth(2)).toContainText('No gym: bodyweight only');
    await expect(opts.nth(2)).toContainText('Plan uses bodyweight and bands. Hotel room, park…');
    await expect(opts.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(opts.nth(0)).toHaveClass(/\bon\b/);
    await expect(page.getByRole('button', { name: 'Set up this gym' })).toBeEnabled();
    await expect(page.locator('.group')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    await page.setViewportSize({ width: 360, height: 700 });
    expect(await noOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('save as new gym: CTA opens Add gym', async ({ page }) => {
    await seed(page, two());
    await page.goto('session/preview');
    await page.getByRole('button', { name: 'Set up this gym' }).click();
    await expect(page).toHaveURL(/gyms\/new/);
  });

  test('one of my gyms: list + update switch; continue sets gym and updates its location to here', async ({ page }) => {
    await seed(page, two());
    await page.goto('session/preview');
    await page.getByRole('radio', { name: /one of my gyms/ }).click();
    await expect(page.getByRole('radio', { name: /one of my gyms/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: /Save as a new gym/ })).toHaveAttribute('aria-checked', 'false');
    const list = page.locator('.group');
    await expect(list.locator('button.li')).toHaveCount(2);
    await expect(list.getByText('Update its location to here')).toBeVisible();
    await expect(list.getByText("Next time it's detected automatically")).toBeVisible();
    const sw = list.getByRole('checkbox');
    await expect(sw).toBeChecked();
    // nearest gym (Home) is preselected
    await expect(list.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Continue at Home' })).toBeVisible();
    await list.getByRole('button', { name: 'City Gym Odenplan' }).click();
    await expect(page.getByRole('button', { name: 'Continue at City Gym Odenplan' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue at City Gym Odenplan' }).click();
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    const st = await settled(page, (x) => x.gyms['gym-city'].lat !== makeGym().lat);
    expect(st.device.currentGymId).toBe('gym-city');
    expect(st.device.gymSource).toBe('manual');
    expect(st.gyms['gym-city'].lat).toBeCloseTo(FAR.latitude, 4);
    expect(st.gyms['gym-city'].lng).toBeCloseTo(FAR.longitude, 4);
    expect(st.gyms['gym-home'].lat).toBe(59.5);
  });

  test('one of my gyms with the update switch off leaves the gym location alone', async ({ page }) => {
    await seed(page, two());
    await page.goto('session/preview');
    await page.getByRole('radio', { name: /one of my gyms/ }).click();
    await page.locator('.group').getByRole('checkbox').uncheck();
    await page.getByRole('button', { name: 'Continue at Home' }).click();
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    const st = await settled(page, (x) => x.device.currentGymId === 'gym-home');
    expect(st.gyms['gym-home'].lat).toBe(59.5);
    expect(st.gyms['gym-home'].lng).toBe(18.4);
  });

  test('no gym: bodyweight only picks the built-in At home · no equipment location and still plans a session', async ({ page }) => {
    await seed(page, two());
    await page.goto('session/preview');
    await page.getByRole('radio', { name: /bodyweight only/ }).click();
    await expect(page.locator('.group')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue with bodyweight plan' }).click();
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.getByText('At home · no equipment', { exact: true })).toBeVisible();
    await expect(page.getByText('Bodyweight only · a floor and a wall')).toBeVisible();
    await expect(page.getByRole('button', { name: 'At home, no equipment' })).toHaveAttribute('aria-pressed', 'true');
    const st = await settled(page, (x) => x.device.currentGymId === 'none');
    expect(st.device.currentGymId).toBe('none');
    expect(st.device.gymSource).toBe('manual');
    expect(st.gyms['gym-city'].lat).toBe(makeGym().lat);
    expect(st.gyms.none).toBeUndefined();
  });

  test('without any saved gym there is no "one of my gyms" option', async ({ page }) => {
    await seed(page, { gyms: null, device: { chosenSlot: 2, currentGymId: null, gymSource: 'none' } });
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: "You're somewhere new" })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(2);
    await expect(page.getByText('It’s one of my gyms')).toHaveCount(0);
    await expect(page.locator('.sub').first()).toHaveText("This spot doesn't match a saved gym. Where are you training?");
  });

  test('Back returns to Today', async ({ page }) => {
    await seed(page, two());
    await page.goto('session/preview');
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/app\/?$/);
  });
});

// ─────────────────────────── Loading ───────────────────────────
/** Delays every IndexedDB open by `ms` so hydration is slow. */
async function slowIdb(page: Page, ms: number) {
  await page.addInitScript((delay) => {
    const real = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, ...args: [string, number?]) {
      const fake: any = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => {
        const r = real.apply(this, args as any);
        r.onsuccess = (e) => { fake.result = r.result; fake.onsuccess?.(e); };
        r.onerror = (e) => { fake.error = r.error; fake.onerror?.(e); };
        r.onupgradeneeded = (e) => { fake.result = r.result; fake.transaction = r.transaction; fake.onupgradeneeded?.(e); };
      }, delay);
      return fake;
    } as never;
  }, ms);
}

test.describe('loading', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('skeleton shows while hydrating, then Today replaces it; slow banner after 4 s with "Use it"', async ({ page, errors }) => {
    await seed(page, start());
    await slowIdb(page, 5500);
    await page.goto('');
    const app = page.locator('.app[aria-busy="true"]');
    await expect(app).toBeVisible();
    await expect(app.locator('.skel').first()).toBeVisible();
    expect(await app.locator('.skel').count()).toBeGreaterThanOrEqual(8);
    await expect(page.getByText('Loading your data')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0); // tab bar is decorative (aria-hidden) while loading
    await expect(page.getByText('Taking longer than usual')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
    const banner = page.locator('.banner.info');
    await expect(banner).toBeVisible({ timeout: 6000 });
    await expect(banner).toContainText('Taking longer than usual');
    await expect(banner).toContainText('Slow connection. Your last synced data is ready to use.');
    await expect(banner.getByRole('link', { name: 'Use it' })).toHaveAttribute('href', /app\/?$/);
    // hydrate finishes: real Today, skeleton gone
    await expect(page.locator('.app[aria-busy="true"]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a fast hydrate never shows the slow banner', async ({ page }) => {
    await seed(page, start());
    await page.goto('');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByText('Taking longer than usual')).toHaveCount(0);
  });

  test('loading shows on deep routes too and resolves to that route', async ({ page }) => {
    await seed(page, start());
    await slowIdb(page, 1500);
    await page.goto('gyms');
    await expect(page.locator('.app[aria-busy="true"]')).toBeVisible();
    await expect(page.locator('.app[aria-busy="true"]')).toHaveCount(0, { timeout: 8000 });
    await expect(page).toHaveURL(/gyms$/);
  });
});

// ─────────────────────────── Error screen (real render errors) ───────────────────────────
// A gym whose name is an object (valid shape for hydrate, but React throws when rendering it as a child) crashes GymDetail.
// (A null equipment map is now repaired by hydrate's sanitizer, so it no longer reaches render.)
const brokenGym = () => makeGym({ id: 'gym-bad', name: { broken: true } as never });
async function crash(page: Page) {
  await seed(page, { gyms: [makeGym(), brokenGym()], ...start() });
  await page.goto('gyms/gym-bad');
}

test.describe('error screen', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('a render error shows the artboard error screen with an error ID', async ({ page }) => {
    await crash(page);
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await expect(page.getByText("This screen couldn't load. Your workouts are safe: everything is saved on this phone.")).toBeVisible();
    await expect(page.locator('.tag.outline')).toHaveText(/^Error ID [0-9A-F]{4}-[0-9A-F]{4}$/);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Go to Today' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Report this problem' })).toBeEnabled();
    await expect(page.locator('.banner.ok')).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
  });

  test('Try again shows a busy state, re-renders, and the same crash keeps the same error ID', async ({ page }) => {
    await crash(page);
    const id = await page.locator('.tag.outline').innerText();
    await page.getByRole('button', { name: 'Try again' }).click();
    const busy = page.getByRole('button', { name: 'Trying again…' });
    await expect(busy).toBeDisabled();
    await expect(busy.locator('.ic-refresh')).toHaveClass(/spinning/);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled({ timeout: 5000 });
    await expect(page.locator('.tag.outline')).toHaveText(id);
  });

  test('Try again recovers once the cause is gone', async ({ page }) => {
    test.skip(!!process.env.E2E_PROD, 'needs the Vite dev server (imports app source modules / dev-only UI)');
    await crash(page);
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    // fix the data underneath (store is the module-level singleton; repair through the persisted copy + reload-free retry)
    await page.evaluate(async () => {
      const mod = await import('/app/src/client/store/core.ts' as string);
      mod.setState((s: any) => { s.gyms = { ...s.gyms, 'gym-bad': { ...s.gyms['gym-bad'], name: 'Broken gym' } }; });
    });
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Broken gym' }).or(page.getByText('Broken gym').first())).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
  });

  test('Go to Today leaves the error screen and renders Today', async ({ page }) => {
    await crash(page);
    await page.getByRole('link', { name: 'Go to Today' }).click();
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
    await expect(page).toHaveURL(/app\/?$/);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('Report this problem confirms, disables itself and logs an event with the error ID', async ({ page }) => {
    await crash(page);
    const id = (await page.locator('.tag.outline').innerText()).replace('Error ID ', '');
    await page.getByRole('button', { name: 'Report this problem' }).click();
    await expect(page.locator('.banner.ok')).toHaveText('Report sent with the error ID. Thanks, this helps fix it.');
    await expect(page.getByRole('button', { name: 'Reported' })).toBeDisabled();
    await expect.poll(async () => (await readState(page))?.events?.some((e: any) => e.kind === 'error_reported' && e.payload?.errorId === id)).toBe(true);
  });
});

// ─────────────────────────── Offline mid-session ───────────────────────────
function activeLive() {
  const a = makeAreas()[1];
  const base = makeSession({ id: 'act', seq: 2, slot: 2, areaId: a.id, areaName: a.name, daysAgo: 0, exerciseIds: ['back_squat', 'leg_press', 'seated_leg_curl'] });
  const start = Date.now() - 20 * 60000;
  return {
    ...base, status: 'active' as const, startedAt: start, warmupStartedAt: start, warmupEndedAt: start + 8 * 60000, endedAt: undefined, phase: 'set' as const, cursor: 0, targetMin: 60, updatedAt: start,
    exercises: base.exercises.map((e, i) => ({ ...e, status: i === 0 ? ('active' as const) : ('todo' as const), sets: [], startedAt: i === 0 ? start : undefined, endedAt: undefined, feedback: undefined, recommendation: undefined, estSec: 600, restSec: 90, plannedSets: 3, order: i, id: `x${i}` })),
  };
}
/** Open the live screen and get past the "Up next" card to the set inputs. */
async function openLive(page: Page) {
  await page.goto('session/live');
  await page.getByRole('button', { name: 'Start set 1' }).click();
  await expect(page.getByRole('button', { name: /Done · set 1/ })).toBeVisible();
}
const live = (page: Page, o: SeedOpts = {}) => seed(page, { sessions: [activeLive() as never], device: { currentGymId: 'gym-city', gymSource: 'manual', resumeShown: true }, ...o });

test.describe('offline mid-session', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('no strip while online', async ({ page }) => {
    await live(page);
    await openLive(page);
    await expect(page.locator('.strip')).toHaveCount(0);
  });

  test('going offline shows the black strip; logging a set raises "n queued"; back online confirms with the synced count', async ({ page, context, errors }) => {
    await live(page);
    await openLive(page);
    await context.setOffline(true);
    const off = page.locator('.strip.off');
    await expect(off).toBeVisible();
    await expect(off).toContainText('Offline. Every set is saved on this phone.');
    await expect(off.locator('.tag')).toHaveText(/^\d+ queued$/);
    const before = Number((await off.locator('.tag').innerText()).split(' ')[0]);
    expect(await noOverflow(page)).toBe(true);
    // the workout keeps working offline
    await page.getByRole('button', { name: /Done · set 1/ }).click();
    await expect(page.getByRole('button', { name: /Start set 2 now/ })).toBeVisible();
    const after = Number((await off.locator('.tag').innerText()).split(' ')[0]);
    expect(after).toBeGreaterThanOrEqual(1);
    expect(after).toBeGreaterThanOrEqual(before);
    const st = await settled(page, (x) => x.sessions['act'].exercises[0].sets.length === 1);
    expect(Object.keys(st.outbox).length).toBe(after);
    await context.setOffline(false);
    const on = page.locator('.strip.on');
    await expect(on).toBeVisible();
    await expect(on).toHaveText(new RegExp(`^Back online\\. ${after} ${after === 1 ? 'change' : 'changes'} synced\\.$`));
    await expect(page.locator('.strip.off')).toHaveCount(0);
    // confirmation is temporary
    await expect(on).toHaveCount(0, { timeout: 8000 });
    expect(errors).toEqual([]);
  });

  test('offline with nothing pending reads "0 queued"; reconnect says there is nothing to sync', async ({ page, context }) => {
    const s = activeLive();
    await seed(page, { sessions: [{ ...s, phase: 'warmup', warmupEndedAt: undefined, warmupItems: [{ name: 'Bike', meta: '5 min', done: false }] } as never], device: { currentGymId: 'gym-city', gymSource: 'manual', resumeShown: true } });
    await page.goto('session/warmup');
    await expect(page.getByRole('timer', { name: 'Session time' })).toBeVisible();
    await context.setOffline(true);
    await expect(page.locator('.strip.off .tag')).toHaveText('0 queued');
    await context.setOffline(false);
    await expect(page.locator('.strip.on')).toHaveText('Back online. Nothing to sync.');
  });

  test('starting the page already offline shows the strip on the warm-up screen too', async ({ page, context }) => {
    const s = activeLive();
    await seed(page, { sessions: [{ ...s, phase: 'warmup', warmupEndedAt: undefined, warmupItems: [{ name: 'Bike', meta: '5 min', done: false }] } as never], device: { currentGymId: 'gym-city', gymSource: 'manual', resumeShown: true } });
    await page.goto('session/warmup');
    await context.setOffline(true);
    await expect(page.locator('.strip.off')).toContainText('Offline. Every set is saved on this phone.');
  });
});

// ─────────────────────────── Corrupt / partial persisted state ───────────────────────────
async function plant(page: Page, raw: string) {
  await page.addInitScript((v) => { try { localStorage.setItem('rep-state-v1', v); } catch { /* ignore */ } }, raw);
}
const good = () => buildState({ gyms: [makeGym()], ...start() }) as Record<string, any>;
const blank = async (page: Page) => (await page.evaluate(() => (document.getElementById('root')?.innerText ?? '').trim().length)) > 0;

test.describe('corrupt persisted state never white-screens', () => {
  test.use({ viewport: { width: 375, height: 667 } });
  const cases: [string, (g: Record<string, any>) => unknown][] = [
    ['not JSON at all', () => '{{{not json'],
    ['JSON null', () => null],
    ['a number', () => 42],
    ['an array', () => []],
    ['empty object', () => ({})],
    ['settings missing, rest intact', (g) => ({ ...g, settings: undefined })],
    ['gyms/areas/sessions/prefs null', (g) => ({ ...g, gyms: null, areas: null, sessions: null, prefs: null, plans: null })],
    ['outbox and events null', (g) => ({ ...g, outbox: null, events: null })],
    ['device null', (g) => ({ ...g, device: null })],
  ];
  for (const [name, mk] of cases) {
    test(`${name}: app still renders something`, async ({ page }) => {
      const v = mk(good());
      await plant(page, typeof v === 'string' ? v : JSON.stringify(v));
      await page.goto('');
      // Either a normal screen (welcome / Today) or the error screen, never an empty page or endless skeleton.
      await expect(page.locator('.app[aria-busy="true"]')).toHaveCount(0, { timeout: 8000 });
      await expect.poll(() => blank(page)).toBe(true);
      const ok = (await page.getByRole('heading').count()) > 0;
      expect(ok).toBe(true);
    });
  }

  const corruptSession = () => {
    const g = good();
    const s = makeSession({ id: 'bad', seq: 1, slot: 1, areaId: 'area-1', areaName: 'Upper body', daysAgo: 2, exerciseIds: ['back_squat'] }) as any;
    s.exercises = null;
    g.sessions = { bad: s };
    return JSON.stringify(g);
  };

  // hydrate() drops individually malformed entities (keeping a backup), so one bad record can never lock the user out.
  test('a session with no exercises is dropped by hydrate: no crash, a backup copy is kept', async ({ page }) => {
    await plant(page, corruptSession());
    await page.goto('history/bad');
    await expect(page.locator('.app[aria-busy="true"]')).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!localStorage.getItem('rep-state-v1-corrupt'))).toBe(true);
  });

  test('a malformed session does not take Today down', async ({ page }) => {
    await plant(page, corruptSession());
    await page.goto('');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
  });
});
