import { test, expect, seed, readState } from './fixtures';
import { describeSyncError } from '../../src/client/screens/SyncError';

const device = { token: 'tok', userId: 'u1', email: 'a@b.co', lastSyncAt: Date.now() - 5 * 60_000 };
const OK = { accepted: [], rejected: [], changes: [], cursor: 1, more: false };

test.describe('SyncError', () => {
  test('describeSyncError maps raw errors', () => {
    expect(describeSyncError('sync 503')).toBe('SYNC_503 · server unavailable');
    expect(describeSyncError('sync 429')).toBe('SYNC_429 · too many requests');
    expect(describeSyncError('sync 400')).toBe('SYNC_400 · request rejected');
    expect(describeSyncError('no_account')).toMatch(/^NO_ACCOUNT/);
    expect(describeSyncError('Failed to fetch')).toMatch(/^NETWORK/);
    expect(describeSyncError('weird')).toBe('weird');
  });

  test('not shown when sync is healthy', async ({ page }) => {
    await seed(page, { device }); await page.route('**/api/sync', (r) => r.fulfill({ json: OK }));
    await page.goto('settings');
    await expect(page.getByRole('status').filter({ hasText: 'Up to date' })).toBeVisible();
    await expect(page.locator('.banner.error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('error banner copy, last-synced and next-retry details', async ({ page }) => {
    await seed(page, { device }); await page.route('**/api/sync', (r) => r.fulfill({ status: 503, json: {} }));
    await page.goto('settings');
    const b = page.locator('.banner.error');
    await expect(b.locator('.b-t')).toHaveText('Couldn’t back up your latest changes');
    await expect(b).toContainText('Everything is saved on this phone and nothing is lost. We’ll keep trying in the background.');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: /^Couldn’t sync · last synced/ })).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('.kv', { hasText: 'Last synced' })).toContainText(/min ago|just now/);
    await expect(page.locator('.kv', { hasText: 'Next auto-retry' })).toContainText('On next app open or within a minute');
    await expect(page.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('Try again shows Retrying… while in flight and keeps the data', async ({ page }) => {
    await seed(page, { device });
    let n = 0, release!: () => void; const gate = new Promise<void>((r) => (release = r));
    await page.route('**/api/sync', async (r) => { if (++n === 1) return r.fulfill({ status: 500, json: {} }); await gate; return r.fulfill({ status: 500, json: {} }); });
    await page.goto('settings');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    release();
    await expect(page.getByText('Still can’t reach the server')).toBeVisible();
    expect((await readState(page)).settings.name).toBe('Alex');
  });

  test('success after failure shows the green Synced state with disabled retry', async ({ page }) => {
    await seed(page, { device });
    let fail = true;
    await page.route('**/api/sync', (r) => (fail ? r.fulfill({ status: 502, json: {} }) : r.fulfill({ json: OK })));
    await page.goto('settings');
    await expect(page.locator('.banner.error')).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    const ok = page.locator('.banner.ok', { hasText: 'Synced' });
    await expect(ok).toBeVisible();
    await expect(page.getByRole('button', { name: 'Synced' })).toBeDisabled();
    await expect(page.locator('.banner.error')).toHaveCount(0);
  });

  test('network failure (route aborted) is reported as a sync error', async ({ page }) => {
    await seed(page, { device }); await page.route('**/api/sync', (r) => r.abort('failed'));
    await page.goto('settings');
    await expect(page.locator('.banner.error')).toBeVisible();
    await page.getByRole('button', { name: 'Details' }).click();
    await expect(page.locator('.kv', { hasText: 'Error' }).first()).toContainText(/NETWORK|fetch/i);
  });

  test('no horizontal overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, { device }); await page.route('**/api/sync', (r) => r.fulfill({ status: 503, json: {} }));
    await page.goto('settings');
    await page.getByRole('button', { name: 'Details' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
