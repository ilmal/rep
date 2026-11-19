// Heart rate: Settings screen, key + status, live chip, summary / detail card. Runs against the REAL server: an account and an ingest
// key are created through the API, readings are posted to /api/hr/ingest exactly like the iPhone automation would.
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, seed, makeSession, makeAreas } from './fixtures';
import { live, open as openLive } from './live-helpers';

test.use({ serviceWorkers: 'block' });
const origin = () => new URL(process.env.E2E_BASE ?? 'http://localhost:5173/app/').origin;

async function account(request: APIRequestContext) {
  const r = await (await request.post(`${origin()}/api/auth/anon`, { data: { name: 'hr' } })).json();
  return { token: r.token as string, userId: r.userId as string };
}
async function newKey(request: APIRequestContext, token: string) {
  return (await (await request.post(`${origin()}/api/hr/key`, { headers: { authorization: `Bearer ${token}` } })).json()).key as string;
}
const ingest = (request: APIRequestContext, key: string, json: unknown) => request.post(`${origin()}/api/hr/ingest`, { headers: { authorization: `Bearer ${key}` }, data: json as never });
const asUser = (page: Page, a: { token: string; userId: string }, extra: Record<string, unknown> = {}) => ({ device: { token: a.token, userId: a.userId, email: null, ...extra } });

test.describe('settings screen', () => {
  test('link from Settings, toggle / interval / max HR persist as settings', async ({ page, request, errors }) => {
    const a = await account(request);
    await seed(page, asUser(page, a));
    await page.goto('settings');
    await expect(page.getByRole('link', { name: /Heart rate/ })).toContainText('Pulse from your AirPods');
    await page.getByRole('link', { name: /Heart rate/ }).click();
    await expect(page).toHaveURL(/settings\/heart-rate$/);
    await expect(page.getByRole('switch')).not.toBeChecked();
    await page.getByRole('switch').check();
    await page.getByRole('button', { name: '30 min' }).click();
    await expect(page.getByRole('button', { name: '30 min' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Max heart rate').fill('190');
    await page.getByLabel('Max heart rate').fill('19x0'); // digits only
    await expect.poll(async () => (await page.evaluate(async () => { const g = await new Promise<any>((res) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => { const q = r.result.transaction('keyval').objectStore('keyval').get('rep-state-v1'); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null); }); return g?.settings?.heartRate; }))).toEqual({ enabled: true, intervalMin: 30, maxHr: 190 });
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('link', { name: /Heart rate/ })).toContainText('On · reading every 30 min');
    expect(errors).toEqual([]);
  });

  test('create key (shown once, only a write-only key), status flips to "Last reading" after the iPhone posts', async ({ page, request }) => {
    const a = await account(request);
    await seed(page, asUser(page, a));
    await page.goto('settings/heart-rate');
    await expect(page.getByTestId('hr-status')).toContainText('Not connected yet');
    await page.getByRole('button', { name: 'Create key' }).click();
    const key = (await page.getByTestId('hr-fresh-key').locator('code').innerText()).trim();
    expect(key).toMatch(/^rephr_/);
    await expect(page.getByTestId('hr-url')).toHaveText(`${origin()}/api/hr/ingest`);
    await expect(page.getByTestId('hr-status')).toContainText('Waiting for the first reading');
    const r = await ingest(request, key, { bpm: 64 });
    expect(r.ok()).toBe(true);
    await expect(page.getByTestId('hr-status')).toContainText('Last reading just now', { timeout: 12_000 });
    await expect(page.getByTestId('hr-status')).toContainText('1 readings stored');
    // the key is not accepted for anything else
    expect((await request.get(`${origin()}/api/hr`, { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);
    // rotating makes the old key useless
    await page.getByRole('button', { name: 'Create a new key' }).click();
    await expect(page.getByTestId('hr-fresh-key')).not.toContainText(key);
    expect((await ingest(request, key, { bpm: 65 })).status()).toBe(401);
    await page.getByRole('button', { name: 'Turn off sending' }).click();
    await expect(page.getByTestId('hr-status')).toContainText('Not connected yet');
  });
});

test.describe('live session', () => {
  test('hidden when off; shows the latest reading with its zone when on; "--" when nothing recent', async ({ page, request, errors }) => {
    const a = await account(request); const key = await newKey(request, a.token);
    await ingest(request, key, { bpm: 150 });
    await openLive(page, live({ phase: 'set', ago: 600 }), asUser(page, a), false);
    await expect(page.getByTestId('time-left')).toBeVisible();
    await expect(page.getByTestId('hr-chip')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test('on: shows bpm and zone colour', async ({ page, request }) => {
    const a = await account(request); const key = await newKey(request, a.token);
    await ingest(request, key, { bpm: 152.4 });
    await openLive(page, live({ phase: 'set', ago: 600 }), { ...asUser(page, a), settings: { heartRate: { enabled: true, intervalMin: 15, maxHr: 190 } } }, false);
    const chip = page.getByTestId('hr-chip');
    await expect(chip).toContainText('152');
    await expect(chip).toHaveAttribute('data-zone', '4'); // 152/190 = 80%
    await expect(chip).toHaveAttribute('data-state', 'live');
    await expect(chip).toHaveAttribute('title', '152 bpm · Hard');
  });
  test('on but nothing recent (old reading) -> "--" with a clear label', async ({ page, request }) => {
    const a = await account(request); const key = await newKey(request, a.token);
    await ingest(request, key, { bpm: 150, at: Date.now() - 30 * 60_000 });
    await openLive(page, live({ phase: 'set', ago: 600 }), { ...asUser(page, a), settings: { heartRate: { enabled: true, intervalMin: 15 } } }, false);
    const chip = page.getByTestId('hr-chip');
    await expect(chip).toContainText('--');
    await expect(chip).toHaveAttribute('data-state', 'none');
    await expect(chip).toHaveAttribute('data-zone', '');
  });
  test('a new reading arrives while the screen is open', async ({ page, request }) => {
    const a = await account(request); const key = await newKey(request, a.token);
    await openLive(page, live({ phase: 'set', ago: 600 }), { ...asUser(page, a), settings: { heartRate: { enabled: true, intervalMin: 15 } } }, false);
    await expect(page.getByTestId('hr-chip')).toContainText('--');
    await ingest(request, key, { bpm: 101 });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // same trigger as returning to the app
    await expect(page.getByTestId('hr-chip')).toContainText('101', { timeout: 20_000 });
  });
  test('signed out / no account: chip shows "--", no errors', async ({ page, errors }) => {
    await openLive(page, live({ phase: 'set', ago: 600 }), { settings: { heartRate: { enabled: true, intervalMin: 15 } } }, false);
    await expect(page.getByTestId('hr-chip')).toContainText('--');
    expect(errors).toEqual([]);
  });
});

test.describe('session summary and detail', () => {
  const sess = () => { const a = makeAreas()[0]; return makeSession({ id: 'hs1', seq: 1, slot: 1, areaId: a.id, areaName: a.name, daysAgo: 0, exerciseIds: ['bench_press'], minutes: 40 }); };
  async function withReadings(request: APIRequestContext, s: ReturnType<typeof sess>) {
    const a = await account(request); const key = await newKey(request, a.token);
    const from = s.warmupStartedAt ?? s.startedAt;
    await ingest(request, key, { samples: [
      { bpm: 62, at: from - 10 * 60_000 },                  // before the session: excluded
      { bpm: 100, at: from + 5 * 60_000 }, { bpm: 140, at: from + 15 * 60_000 }, { bpm: 180, at: from + 25 * 60_000 },
      { bpm: 70, at: (s.endedAt ?? 0) + 3 * 60_000 },       // after: excluded
    ] });
    return a;
  }
  test('summary and detail show avg / max / min for the session window only', async ({ page, request }) => {
    const s = sess(); const a = await withReadings(request, s);
    await seed(page, { ...asUser(page, a), sessions: [s], settings: { heartRate: { enabled: true, intervalMin: 15 } } });
    await page.goto(`session/summary/${s.id}`);
    const card = page.getByTestId('hr-card');
    await expect(card.getByTestId('hr-avg')).toHaveText('140');
    await expect(card.getByTestId('hr-max')).toHaveText('180');
    await expect(card.getByTestId('hr-min')).toHaveText('100');
    await expect(card.getByRole('img', { name: 'Heart rate over the session' })).toBeVisible();
    await page.goto(`history/${s.id}`);
    await expect(page.getByTestId('hr-card').getByTestId('hr-avg')).toHaveText('140');
  });
  test('off: no card', async ({ page, request }) => {
    const s = sess(); const a = await account(request);
    await seed(page, { ...asUser(page, a), sessions: [s] });
    await page.goto(`session/summary/${s.id}`);
    await expect(page.getByText('Where the time went')).toBeVisible();
    await expect(page.getByTestId('hr-card')).toHaveCount(0);
  });
  test('on with no readings in the window: a quiet note', async ({ page, request }) => {
    const s = sess(); const a = await account(request);
    await seed(page, { ...asUser(page, a), sessions: [s], settings: { heartRate: { enabled: true, intervalMin: 15 } } });
    await page.goto(`session/summary/${s.id}`);
    await expect(page.getByTestId('hr-card')).toHaveAttribute('data-empty', '1');
  });
});
