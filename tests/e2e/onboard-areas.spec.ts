import { test, expect, seed, readState } from './fixtures';
import type { Page } from '@playwright/test';

const ALL = ['Upper body', 'Lower body', 'Prehab & mobility', 'Full body', 'Push', 'Pull', 'Core', 'Conditioning'];
const DESC: Record<string, string> = {
  'Upper body': 'Chest, back, shoulders, arms', 'Lower body': 'Quads, hamstrings, glutes, calves', 'Prehab & mobility': 'Shoulders, hips, core stability',
  'Full body': 'Big compound lifts', Push: 'Chest, shoulders, triceps', Pull: 'Back, biceps, rear delts', Core: 'Abs, obliques, anti-rotation', Conditioning: 'Intervals and carries',
};

async function setup(page: Page, ob: Record<string, unknown> = {}) {
  await seed(page, { onboarded: false, gyms: null, areas: null, name: '' });
  await page.addInitScript((v) => { if (!sessionStorage.getItem('__ob')) { sessionStorage.setItem('rep-onboarding-v1', JSON.stringify(v)); sessionStorage.setItem('__ob', '1'); } }, ob);
  await page.goto('onboarding/areas');
}
const slotBtn = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Session ${n}:`) });

test('default: 4 slots, first expanded, copy and descriptions', async ({ page, errors }) => {
  await setup(page);
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set your rotation' })).toBeVisible();
  await expect(page.getByText('Each session is a focus area, not a fixed list.')).toBeVisible();
  await expect(page.locator('.card.tight')).toHaveCount(4);
  const names = ['Upper body', 'Lower body', 'Prehab & mobility', 'Full body'];
  for (let i = 0; i < 4; i++) {
    await expect(slotBtn(page, i + 1)).toContainText(names[i]);
    await expect(slotBtn(page, i + 1)).toContainText(DESC[names[i]]);
  }
  await expect(slotBtn(page, 1)).toHaveAttribute('aria-expanded', 'true');
  await expect(slotBtn(page, 2)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.chip')).toHaveCount(8);
  await expect(page.getByText('Session 5 loops back to Session 1.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('toggle expand/collapse; options list all templates with current on', async ({ page }) => {
  await setup(page);
  await slotBtn(page, 1).click();
  await expect(page.locator('.chip')).toHaveCount(0);
  await slotBtn(page, 3).click();
  await expect(slotBtn(page, 3)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.chip')).toHaveText(ALL);
  await expect(page.locator('.chip.on')).toHaveText('Prehab & mobility');
});

test('change each slot', async ({ page }) => {
  await setup(page);
  const picks = ['Push', 'Pull', 'Core', 'Conditioning'];
  for (let i = 0; i < 4; i++) {
    if ((await slotBtn(page, i + 1).getAttribute('aria-expanded')) !== 'true') await slotBtn(page, i + 1).click();
    await page.locator('.chip', { hasText: new RegExp(`^${picks[i]}$`) }).click();
    await expect(page.locator('.chip')).toHaveCount(0);
    await expect(slotBtn(page, i + 1)).toContainText(picks[i]);
    await expect(slotBtn(page, i + 1)).toContainText(DESC[picks[i]]);
  }
});

test('goal 1 and goal 7 slot counts', async ({ page }) => {
  await setup(page, { goal: 1 });
  await expect(page.locator('.card.tight')).toHaveCount(1);
  await expect(page.getByText('Session 2 loops back to Session 1.')).toBeVisible();
});
test('goal 7 slot counts', async ({ page }) => {
  await setup(page, { goal: 7 });
  await expect(page.locator('.card.tight')).toHaveCount(7);
  await expect(page.getByText('Session 8 loops back to Session 1.')).toBeVisible();
  await expect(slotBtn(page, 5)).toContainText('Push');
});

test('finish creates areas, rotation, settings and gym', async ({ page, errors }) => {
  await setup(page, { name: 'Sam', goal: 3, targetMinutes: 45, warmupMinutes: 8, primary: { name: 'Iron Hut', template: 'full', lat: 59.3, lng: 18.0 }, extra: [{ name: '', template: 'home', lat: null, lng: null }] });
  await page.locator('.chip', { hasText: /^Push$/ }).click();
  await slotBtn(page, 3).click();
  await page.locator('.chip', { hasText: /^Core$/ }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page).not.toHaveURL(/onboarding/);
  await expect(page).toHaveURL(/\/app(\/signin)?\/?$/);
  await expect.poll(async () => (await readState(page))?.settings?.onboarded).toBe(true);
  const st = await readState(page);
  const areas = Object.values(st.areas).filter((a: any) => !a.deleted) as any[];
  expect(st.settings.rotation).toHaveLength(3);
  expect(st.settings.rotation.map((id: string) => st.areas[id].name)).toEqual(['Push', 'Lower body', 'Core']);
  expect(areas).toHaveLength(3);
  expect(st.settings).toMatchObject({ weeklyGoal: 3, targetMinutes: 45, warmupTargetMinutes: 8, name: 'Sam' });
  const gyms = Object.values(st.gyms) as any[];
  expect(gyms.map((g) => g.name).sort()).toEqual(['Gym', 'Iron Hut']);
  expect(st.device.currentGymId).toBe(gyms.find((g) => g.name === 'Iron Hut').id);
  expect(errors).toEqual([]);
});

test('finish with defaults creates default rotation and My gym', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect.poll(async () => (await readState(page))?.settings?.onboarded).toBe(true);
  const st = await readState(page);
  expect(st.settings.rotation.map((id: string) => st.areas[id].name)).toEqual(['Upper body', 'Lower body', 'Prehab & mobility', 'Full body']);
  expect(Object.values(st.gyms).map((g: any) => g.name)).toEqual(['My gym']);
});

test('back keeps selections', async ({ page }) => {
  await setup(page);
  await page.locator('.chip', { hasText: /^Conditioning$/ }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/onboarding\/gyms$/);
  await page.goBack();
  await expect(page).toHaveURL(/onboarding\/areas$/);
  await expect(slotBtn(page, 1)).toContainText('Conditioning');
  await page.reload();
  await expect(slotBtn(page, 1)).toContainText('Conditioning');
});

test('375px: no horizontal overflow, finish reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await setup(page, { goal: 7 });
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
  await expect(page.getByRole('button', { name: 'Finish setup' })).toBeInViewport();
  await page.setViewportSize({ width: 360, height: 640 });
  const w2 = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w2[0]).toBeLessThanOrEqual(w2[1]);
});
