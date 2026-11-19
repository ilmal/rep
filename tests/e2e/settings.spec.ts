import { readFileSync } from 'node:fs';
import { test, expect, seed, readState, makeSession, makeAreas } from './fixtures';
import type { Page } from '@playwright/test';

const areas = makeAreas();
const sessions = () => [
  makeSession({ id: 's1', seq: 1, slot: 0, areaId: areas[0].id, areaName: areas[0].name, daysAgo: 9, exerciseIds: ['bench_press', 'seated_row'], weight: 60 }),
  makeSession({ id: 's2', seq: 2, slot: 1, areaId: areas[1].id, areaName: areas[1].name, daysAgo: 2, exerciseIds: ['back_squat'], weight: 100 }),
];
const SYNC_OK = { accepted: [], rejected: [], changes: [], cursor: 1, more: false };
const syncOk = (page: Page) => page.route('**/api/sync', (r) => r.fulfill({ json: SYNC_OK }));
const settled = async (page: Page, pred: (st: any) => boolean) => {
  await expect.poll(async () => { try { return pred(await readState(page)); } catch { return false; } }, { timeout: 15_000 }).toBe(true);
};
const account = { token: 'tok', userId: 'u1', email: 'alex@example.com', lastSyncAt: Date.now() - 120_000 };

test.describe('Settings', () => {
  test('renders every section and copy from the design, with real values', async ({ page, errors }) => {
    await seed(page, { sessions: sessions(), prefs: { 'bench_press': { exerciseId: 'bench_press', favorite: true, avoid: false, relevance: 50 }, 'back_squat': { exerciseId: 'back_squat', favorite: false, avoid: true, relevance: 50 }, 'seated_row': { exerciseId: 'seated_row', favorite: false, avoid: false, pausedUntil: Date.now() + 1e9, relevance: 50 } } });
    await syncOk(page);
    await page.goto('settings');
    await expect(page.locator('.title')).toHaveText('Settings');
    await expect(page.getByLabel('Your name')).toHaveValue('Alex');
    await expect(page.getByText(/Member since .* · 2 sessions/)).toBeVisible();
    for (const t of ['Training', 'Notifications', 'Location', 'Smart adjustments', 'Account', 'Data']) await expect(page.locator('.lbl', { hasText: new RegExp(`^${t}$`) })).toBeVisible();
    await expect(page.getByText('4 sessions · 60 min · 4 areas')).toBeVisible();
    await expect(page.getByText('1 favourite · 1 paused · 1 banned')).toBeVisible();
    await expect(page.getByText('1 gym', { exact: true })).toBeVisible();
    await expect(page.getByText('Smarter generation and swaps. Needs a connection. Core features work without it.')).toBeVisible();
    await expect(page.locator('.tag.blue', { hasText: 'Optional' })).toBeVisible();
    await expect(page.getByText('Not signed in')).toHaveCount(0);
    await expect(page.getByText('Save progress')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByText('CSV or JSON: sessions, sets, timing, feedback')).toBeVisible();
  });

  test('default rest segments persist', async ({ page }) => {
    await seed(page); await syncOk(page); await page.goto('settings');
    const seg = page.getByRole('group', { name: 'Default rest' });
    await expect(seg.getByRole('button', { name: '90 s' })).toHaveAttribute('aria-pressed', 'true');
    for (const [label, v] of [['60 s', 60], ['2 min', 120], ['90 s', 90]] as const) {
      await seg.getByRole('button', { name: label }).click();
      await expect(seg.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(async () => (await readState(page)).settings.restSec).toBe(v);
    }
    await seg.getByRole('button', { name: '2 min' }).click();
    await expect.poll(async () => (await readState(page)).settings.restSec).toBe(120);
    await page.reload();
    await expect(page.getByRole('group', { name: 'Default rest' }).getByRole('button', { name: '2 min' })).toHaveAttribute('aria-pressed', 'true');
  });

  const toggles: [string, string, boolean][] = [
    ['Rest timer sound & haptics', 'sound', true], ['Auto-detect gym', 'gps', true], ['Fit sessions to target time', 'fitToTime', true],
    ['Auto-swap missing equipment', 'suggestSwaps', true], ['AI assist', 'aiAssist', false],
  ];
  for (const [label, key, def] of toggles) {
    test(`toggle "${label}" flips, persists and survives reload`, async ({ page }) => {
      await seed(page); await syncOk(page); await page.goto('settings');
      const sw = page.getByRole('switch', { name: new RegExp(label.replace(/[&]/g, '.')) });
      if (def) await expect(sw).toBeChecked(); else await expect(sw).not.toBeChecked();
      await sw.click();
      if (def) await expect(sw).not.toBeChecked(); else await expect(sw).toBeChecked();
      await expect.poll(async () => (await readState(page)).settings[key]).toBe(!def);
      await page.reload();
      const sw2 = page.getByRole('switch', { name: new RegExp(label.replace(/[&]/g, '.')) });
      if (def) await expect(sw2).not.toBeChecked(); else await expect(sw2).toBeChecked();
    });
  }

  test('GPS off shows the manual-gym row; on hides it', async ({ page }) => {
    await seed(page); await syncOk(page); await page.goto('settings');
    await expect(page.getByText("You'll pick a gym manually")).toHaveCount(0);
    await page.getByRole('switch', { name: /Auto-detect gym/ }).click();
    await expect(page.getByText("You'll pick a gym manually")).toBeVisible();
    await page.getByRole('switch', { name: /Auto-detect gym/ }).click();
    await expect(page.getByText("You'll pick a gym manually")).toHaveCount(0);
  });

  test('unit switch changes display on history, persists to store', async ({ page }) => {
    await seed(page, { sessions: sessions() }); await syncOk(page);
    await page.goto('history/s2');
    await expect(page.getByText(/100 kg/).first()).toBeVisible();
    await page.goto('settings');
    const units = page.getByRole('group', { name: 'Units' });
    await expect(units.getByRole('button', { name: 'Kilograms' })).toHaveAttribute('aria-pressed', 'true');
    await units.getByRole('button', { name: 'Pounds' }).click();
    await expect.poll(async () => (await readState(page)).settings.unit).toBe('lb');
    await page.goto('history/s2');
    await expect(page.getByText(/220\.5 lb/).first()).toBeVisible();
    await expect(page.getByText(/100 kg/)).toHaveCount(0);
    await page.goto('settings');
    await page.getByRole('group', { name: 'Units' }).getByRole('button', { name: 'Kilograms' }).click();
    await expect.poll(async () => (await readState(page)).settings.unit).toBe('kg');
    await page.goto('history/s2');
    await expect(page.getByText(/100 kg/).first()).toBeVisible();
  });

  test('editing the name persists', async ({ page }) => {
    await seed(page); await syncOk(page); await page.goto('settings');
    await page.getByLabel('Your name').fill('Alex');
    await expect.poll(async () => (await readState(page)).settings.name).toBe('Alex');
    await expect(page.locator('.avatar')).toHaveText('A');
  });

  test('notifications row names the streak alert (design copy)', async ({ page }) => {
    await seed(page); await syncOk(page);
    await page.goto('settings');
    const row = page.getByRole('link', { name: /Alerts & icon badge/ });
    await expect(row).toContainText('Rest over, session left running, streak at risk');
    await expect(row).not.toContainText('weekly nudge');
  });

  test('navigation rows go to their routes', async ({ page }) => {
    await seed(page); await syncOk(page);
    const cases: [string, RegExp][] = [
      ['Weekly goal & rotation', /\/app\/plan$/], ['Exercise preferences', /\/library\/exclusions$/], ['Alerts & icon badge', /\/notifications$/],
      ['Gyms & equipment', /\/gyms$/], ['AI coach', /\/settings\/coach$/], ['Save progress', /\/signin$/],
    ];
    for (const [name, url] of cases) {
      await page.goto('settings');
      await page.getByRole('link', { name: new RegExp(name.replace(/[&]/g, '.')) }).first().click();
      await expect(page).toHaveURL(url);
    }
    await page.goto('settings');
    await expect(page.getByRole('link', { name: /Install on your home screen/ })).toHaveAttribute('href', '/app/install');
    await page.getByRole('link', { name: 'Back to Today' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test.describe('sync status', () => {
    test('up to date, then Sync now shows syncing and recovers', async ({ page }) => {
      await seed(page, { device: account });
      let release!: () => void; const gate = new Promise<void>((r) => (release = r));
      let n = 0;
      await page.route('**/api/sync', async (r) => { if (++n > 1) await gate; await r.fulfill({ json: SYNC_OK }); });
      await page.goto('settings');
      await expect(page.getByRole('status').filter({ hasText: /Up to date/ })).toBeVisible();
      await page.getByRole('button', { name: 'Sync now' }).click();
      await expect(page.getByRole('status').filter({ hasText: /Syncing/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
      await expect(page.locator('.spinning').first()).toBeVisible();
      release();
      await expect(page.getByRole('status').filter({ hasText: /Up to date · just now/ })).toBeVisible();
    });

    test('failing sync shows SyncError, details, attempts and recovery', async ({ page }) => {
      await seed(page, { device: account });
      let fail = true;
      await page.route('**/api/sync', (r) => (fail ? r.fulfill({ status: 503, json: { error: 'down' } }) : r.fulfill({ json: SYNC_OK })));
      await page.goto('settings');
      await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t back up your latest changes' })).toBeVisible();
      await expect(page.getByText('Everything is saved on this phone and nothing is lost.')).toBeVisible();
      await page.getByRole('button', { name: 'Details' }).click();
      await expect(page.getByText('SYNC_503 · server unavailable')).toBeVisible();
      await expect(page.locator('.kv', { hasText: 'Queued' })).toContainText('0 changes');
      await expect(page.locator('.kv', { hasText: 'Attempts' })).toContainText('1');
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByText('Still can’t reach the server')).toBeVisible();
      await expect(page.locator('.kv', { hasText: 'Attempts' })).toContainText('2');
      await page.getByRole('button', { name: 'Hide details' }).click();
      await expect(page.locator('.kv')).toHaveCount(0);
      fail = false;
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.locator('.banner.ok', { hasText: 'Synced' })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: 'back up' })).toHaveCount(0);
      expect((await readState(page)).device.lastSyncError ?? null).toBeNull();
    });

    test('queued changes are counted and a failure keeps them', async ({ page }) => {
      await seed(page, { device: account });
      await page.route('**/api/sync', (r) => r.fulfill({ status: 500, json: {} }));
      await page.goto('settings');
      await page.getByRole('switch', { name: /AI assist/ }).click();
      await page.getByRole('switch', { name: /Rest timer/ }).click();
      await expect(page.getByRole('status').filter({ hasText: /1 change waiting/ })).toBeVisible();
      await page.getByRole('button', { name: 'Details' }).click();
      await expect(page.locator('.kv', { hasText: 'Queued' })).toContainText('1 change');
      await expect.poll(async () => Object.keys((await readState(page)).outbox).length).toBe(1);
    });

    test('offline shows Offline and disables Sync now; back online recovers', async ({ page, context }) => {
      await seed(page, { device: account }); await syncOk(page);
      await page.goto('settings');
      await expect(page.getByRole('status').filter({ hasText: /Up to date/ })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByRole('status').filter({ hasText: /^Offline/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sync now' })).toBeDisabled();
      await page.getByRole('switch', { name: /AI assist/ }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Offline · 1 change waiting' })).toBeVisible();
      await context.setOffline(false);
      await expect(page.getByRole('status').filter({ hasText: /Up to date/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sync now' })).toBeEnabled();
    });
  });

  test.describe('account', () => {
    test('signed in shows email and no Save progress', async ({ page }) => {
      await seed(page, { device: account }); await syncOk(page); await page.goto('settings');
      await expect(page.getByText('alex@example.com')).toBeVisible();
      await expect(page.getByText('Signed in · data is backed up')).toBeVisible();
      await expect(page.getByText('Save progress')).toHaveCount(0);
    });

    test('sign out wipes local data and returns to welcome; stays signed in on cancel', async ({ page }) => {
      await seed(page, { device: account, sessions: sessions() });
      let loggedOut = 0;
      await syncOk(page);
      await page.route('**/api/auth/logout', (r) => { loggedOut++; return r.fulfill({ json: { ok: true } }); });
      await page.goto('settings');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Sign out' })).toBeVisible();
      await page.getByRole('button', { name: 'Stay signed in' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      expect(loggedOut).toBe(0);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/welcome$/);
      expect(loggedOut).toBe(1);
      await settled(page, (st) => Object.keys(st?.sessions ?? {}).length === 0 && !st?.settings?.onboarded && st?.device?.token === undefined);
    });

    test('sign out is blocked offline while changes are unsent', async ({ page, context }) => {
      await seed(page, { device: account, sessions: sessions() }); await syncOk(page);
      await page.goto('settings');
      await context.setOffline(true);
      await page.getByRole('switch', { name: /AI assist/ }).click();
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Connect first so nothing is lost' })).toBeVisible();
      await expect(page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' })).toBeDisabled();
      expect(Object.keys((await readState(page)).sessions)).toHaveLength(2);
    });
  });

  test.describe('export', () => {
    async function download(page: Page, button: string) {
      await page.getByRole('button', { name: /Export all data/ }).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()]);
      const path = await dl.path();
      return { name: dl.suggestedFilename(), text: readFileSync(path!, 'utf8') };
    }
    const parseCsv = (text: string) => {
      const rows: string[][] = []; let cur = '', row: string[] = [], q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; } else cur += c;
      }
      return rows;
    };

    test('CSV: one row per set with timing and ratings', async ({ page }) => {
      await seed(page, { sessions: sessions() }); await syncOk(page); await page.goto('settings');
      const { name, text } = await download(page, 'Download CSV');
      expect(name).toMatch(/^rep-export-\d{4}-\d{2}-\d{2}\.csv$/);
      const rows = parseCsv(text.replace(/^﻿/, ''));
      const head = rows[0];
      for (const c of ['session_id', 'date', 'area', 'gym', 'session_minutes', 'exercise', 'set_no', 'weight_kg', 'reps', 'set_done_at', 'rest_seconds', 'effort', 'weight_feedback', 'volume_feedback']) expect(head).toContain(c);
      const data = rows.slice(1);
      expect(data).toHaveLength(9); // (2 exercises + 1 exercise) x 3 sets
      expect(data.every((r) => r.length === head.length)).toBe(true);
      const col = (r: string[], c: string) => r[head.indexOf(c)];
      const s2 = data.filter((r) => col(r, 'session_id') === 's2');
      expect(s2).toHaveLength(3);
      expect(col(s2[0], 'weight_kg')).toBe('100');
      expect(col(s2[0], 'reps')).toBe('8');
      expect(col(s2[0], 'rest_seconds')).toBe('90');
      expect(col(s2[0], 'effort')).toBe('normal');
      expect(col(s2[0], 'weight_feedback')).toBe('right');
      expect(col(s2[0], 'session_minutes')).toBe('55');
      expect(col(s2[0], 'area')).toBe(areas[1].name);
      expect(col(s2[0], 'set_done_at')).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(col(s2[0], 'exercise')).toBeTruthy();
      expect(data.filter((r) => col(r, 'session_id') === 's1').map((r) => col(r, 'set_no')).sort()).toEqual(['1', '1', '2', '2', '3', '3']);
      await expect(page.getByRole('status').filter({ hasText: 'Exported your data as CSV.' })).toBeVisible();
    });

    test('CSV quotes commas/quotes and neutralises formulas', async ({ page }) => {
      const s = sessions(); s[1].gymName = '=HYPERLINK("x"),Gym'; s[1].areaName = 'Legs, "heavy"';
      await seed(page, { sessions: s }); await syncOk(page); await page.goto('settings');
      const { text } = await download(page, 'Download CSV');
      expect(text).toContain(`"'=HYPERLINK(""x""),Gym"`);
      expect(text).toContain('"Legs, ""heavy"""');
    });

    test('JSON contains sessions, sets, settings and works offline', async ({ page, context }) => {
      await seed(page, { sessions: sessions(), device: account }); await syncOk(page); await page.goto('settings');
      await context.setOffline(true);
      const { name, text } = await download(page, 'Download JSON');
      expect(name).toMatch(/\.json$/);
      const j = JSON.parse(text);
      expect(j.sessions).toHaveLength(2);
      expect(j.sessions.find((x: any) => x.id === 's2').exercises[0].sets).toHaveLength(3);
      expect(j.sessions[0].exercises[0].feedback.effort).toBe('normal');
      expect(j.settings.unit).toBe('kg');
      expect(j.gyms).toHaveLength(1);
      expect(j.account.email).toBe('alex@example.com');
    });

    test('CSV with no sessions is just the header', async ({ page }) => {
      await seed(page, { sessions: [] }); await syncOk(page); await page.goto('settings');
      const r = await download(page, 'Download CSV');
      expect(parseCsv(r.text.replace(/^\ufeff/, '')).filter((x) => x.length > 1)).toHaveLength(1);
    });

    test('export sheet closes', async ({ page }) => {
      await seed(page); await syncOk(page); await page.goto('settings');
      await page.getByRole('button', { name: /Export all data/ }).click();
      await expect(page.getByRole('dialog', { name: 'Export all data' })).toBeVisible();
      await page.getByRole('button', { name: 'Close' }).first().click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  });

  test.describe('delete data', () => {
    test('confirm dialog: keep my data cancels', async ({ page }) => {
      await seed(page, { sessions: sessions() }); await syncOk(page); await page.goto('settings');
      await page.getByRole('button', { name: 'Delete all data' }).click();
      const d = page.getByRole('alertdialog', { name: 'Delete all data' });
      await expect(d.getByText(/2 sessions, all sets, timing, feedback and gym maps will be removed from this phone/)).toBeVisible(); // + "and the cloud" when an account exists
      await expect(d.getByText('This can’t be undone.', { exact: false })).toBeVisible();
      await d.getByRole('button', { name: 'Keep my data' }).click();
      await expect(d).toHaveCount(0);
      expect(Object.keys((await readState(page)).sessions)).toHaveLength(2);
    });

    test('local-only user can delete while offline', async ({ page, context }) => {
      await seed(page, { sessions: sessions() }); await syncOk(page); await page.goto('settings');
      await context.setOffline(true);
      await page.getByRole('button', { name: 'Delete all data' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete all data' }).click();
      await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('chrome-error'); // dev server has no service worker: the post-wipe reload cannot load offline
      await context.setOffline(false);
      await page.goto('welcome');
      const st = await readState(page);
      expect(Object.keys(st?.sessions ?? {})).toHaveLength(0);
    });

    test('with an account online: deletes cloud data, keeps the account', async ({ page }) => {
      await seed(page, { device: account, sessions: sessions() }); await syncOk(page);
      const calls: string[] = [];
      await page.route('**/api/account**', (r) => { calls.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`); return r.fulfill({ json: { ok: true } }); });
      await page.goto('settings');
      await page.getByRole('button', { name: 'Delete all data' }).click();
      await expect(page.getByText(/removed from this phone and the cloud/)).toBeVisible();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete all data', exact: true }).click();
      await expect(page).toHaveURL(/\/welcome$/);
      expect(calls).toEqual(['DELETE /api/account/data']);
      await settled(page, (st) => Object.keys(st?.sessions ?? {}).length === 0);
    });

    test('with an account online: delete data and account', async ({ page }) => {
      await seed(page, { device: account, sessions: sessions() }); await syncOk(page);
      const calls: string[] = [];
      await page.route('**/api/account**', (r) => { calls.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`); return r.fulfill({ json: { ok: true } }); });
      await page.goto('settings');
      await page.getByRole('button', { name: 'Delete all data' }).click();
      await page.getByRole('button', { name: 'Delete all data and my account' }).click();
      await expect(page).toHaveURL(/\/welcome$/);
      expect(calls).toEqual(['DELETE /api/account']);
      await settled(page, (st) => st?.device?.token === undefined && Object.keys(st?.sessions ?? {}).length === 0);
    });

    test('with an account offline: delete is disabled and explains why; nothing is wiped', async ({ page, context }) => {
      await seed(page, { device: account, sessions: sessions() }); await syncOk(page); await page.goto('settings');
      await context.setOffline(true);
      await page.getByRole('button', { name: 'Delete all data' }).click();
      const d = page.getByRole('alertdialog');
      await expect(d.getByRole('alert')).toHaveText('You’re offline. Connect to also remove the cloud copy.');
      await expect(d.getByRole('button', { name: 'Delete all data', exact: true })).toBeDisabled();
      await expect(d.getByRole('button', { name: 'Delete all data and my account' })).toBeDisabled();
      expect(Object.keys((await readState(page)).sessions)).toHaveLength(2);
    });
  });

  test('375px: no horizontal overflow, controls reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, { device: account, sessions: sessions() });
    await page.route('**/api/sync', (r) => r.fulfill({ status: 503, json: {} }));
    await page.goto('settings');
    await expect(page.getByRole('alert').filter({ hasText: 'back up' })).toBeVisible();
    for (const w of [375, 360]) {
      await page.setViewportSize({ width: w, height: 667 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('*')].every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1 || getComputedStyle(e).position === 'fixed'))).toBe(true);
    }
    await page.getByRole('button', { name: 'Sign out' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Delete all data' }).click();
    const box = await page.getByRole('alertdialog').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  });
});
