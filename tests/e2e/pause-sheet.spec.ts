// PauseSheet is shared; it is exercised through its hosts: Exclusions (paused rows) and ExerciseDetail (Pause button).
import { seed, readState, test, expect, DAY } from './fixtures';
import type { ExercisePref } from '../../src/shared/types';

const P = (exerciseId: string, o: Partial<ExercisePref> = {}): ExercisePref => ({ exerciseId, favorite: false, avoid: false, relevance: 50, ...o });
const FOREVER = 8.64e15;
const sheet = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Overhead press preferences' });
const pref = async (page: import('@playwright/test').Page, id: string) => (await readState(page)).prefs[id];

test.describe('PauseSheet from exercise detail (ready exercise)', () => {
  test.beforeEach(async ({ page }) => { await seed(page, {}); await page.goto('library/ohp'); await page.getByRole('button', { name: 'Pause', exact: true }).click(); });

  test('lists all options and no resume row for a ready exercise', async ({ page }) => {
    await expect(sheet(page)).toBeVisible();
    for (const l of ['Favourite', 'Next session', '1 week', '2 weeks', '1 month', 'Until I resume it']) await expect(sheet(page).getByRole('button', { name: new RegExp(`^${l}`) })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: /^(Resume now|Unban)/ })).toHaveCount(0);
    await expect(sheet(page).getByRole('button', { name: /Ban: never again/ })).toBeVisible();
  });

  for (const [label, days] of [['1 week', 7], ['2 weeks', 14], ['1 month', 30]] as const) {
    test(`pause ${label}`, async ({ page }) => {
      await sheet(page).getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await expect(sheet(page)).toHaveCount(0);
      await expect.poll(async () => (await pref(page, 'ohp'))?.pausedUntil).toBeGreaterThan(Date.now() + (days - 1) * DAY);
      expect((await pref(page, 'ohp')).pausedUntil).toBeLessThan(Date.now() + (days + 1) * DAY);
    });
  }
  test('pause next session', async ({ page }) => {
    await sheet(page).getByRole('button', { name: /^Next session/ }).click();
    await expect.poll(async () => (await pref(page, 'ohp'))?.pausedSessions).toBe(1);
    expect((await pref(page, 'ohp')).pausedUntil).toBeUndefined();
  });
  test('pause until resumed', async ({ page }) => {
    await sheet(page).getByRole('button', { name: /^Until I resume it/ }).click();
    await expect.poll(async () => (await pref(page, 'ohp'))?.pausedUntil).toBe(FOREVER);
  });
  test('ban', async ({ page }) => {
    await sheet(page).getByRole('button', { name: /Ban: never again/ }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(async () => (await pref(page, 'ohp'))?.avoid).toBe(true);
  });
  test('favourite toggles on', async ({ page }) => {
    await sheet(page).getByRole('button', { name: /^Favourite/ }).click();
    await expect.poll(async () => (await pref(page, 'ohp'))?.favorite).toBe(true);
  });
  test('scrim closes without changes', async ({ page }) => {
    await page.getByRole('button', { name: 'Close' }).click({ position: { x: 10, y: 10 } });
    await expect(sheet(page)).toHaveCount(0);
    expect((await readState(page)).prefs.ohp).toBeUndefined();
  });
});

test.describe('PauseSheet states from Exclusions', () => {
  test('paused: Resume now row, favourite label flips, resume clears pause', async ({ page }) => {
    await seed(page, { prefs: { ohp: P('ohp', { pausedUntil: FOREVER, favorite: true }) } });
    await page.goto('library/exclusions');
    await page.getByRole('button', { name: 'Change pause for Overhead press' }).click();
    await expect(sheet(page).getByRole('button', { name: /^Remove favourite/ })).toBeVisible();
    await sheet(page).getByRole('button', { name: /^Resume now/ }).click();
    await expect(page.getByRole('status')).toContainText('Back in rotation');
    await expect.poll(async () => (await pref(page, 'ohp')).pausedUntil).toBeUndefined();
    expect((await pref(page, 'ohp')).favorite).toBe(true);
  });
  test('sessions pause: Resume now clears pausedSessions', async ({ page }) => {
    await seed(page, { prefs: { ohp: P('ohp', { pausedSessions: 2 }) } });
    await page.goto('library/exclusions');
    await page.getByRole('button', { name: 'Change pause for Overhead press' }).click();
    await sheet(page).getByRole('button', { name: /^Resume now/ }).click();
    await expect.poll(async () => (await pref(page, 'ohp')).pausedSessions).toBeUndefined();
  });
});

test.describe('PauseSheet banned exercise (ExerciseDetail)', () => {
  test('banned detail offers Unban and no Ban row', async ({ page }) => {
    await seed(page, { prefs: { ohp: P('ohp', { avoid: true }) } });
    await page.goto('library/ohp');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(sheet(page).getByRole('button', { name: /Ban: never again/ })).toHaveCount(0);
    await sheet(page).getByRole('button', { name: /^Unban/ }).click();
    await expect.poll(async () => (await pref(page, 'ohp')).avoid).toBe(false);
  });
});
