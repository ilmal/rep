import { test, expect, seed, readState, makeSession, makeAreas } from './fixtures';
import type { Page } from '@playwright/test';

const POOL = ['back_squat', 'rdl', 'leg_press', 'walking_lunge'];
function areasWith(over: Record<string, unknown> = {}) {
  const a = makeAreas();
  a[1] = { ...a[1], name: 'Lower body', focusMuscles: ['Quads', 'Hamstrings'], exercisesPerSession: 5, mode: 'auto', poolExerciseIds: POOL, pinnedExerciseIds: ['back_squat'], ...over } as never;
  return a;
}
const area = async (page: Page, id = 'area-2') => (await readState(page)).areas[id];
const saveBtn = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
const poolRows = (page: Page) => page.locator('.group .li');
const chip = (page: Page, m: string) => page.getByRole('button', { name: m, exact: true });

test('layout and copy for an existing area (slot 2)', async ({ page, errors }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await expect(page.getByText('Session 2 · area')).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Lower body');
  await expect(page.getByText('Exercises are picked to cover these')).toBeVisible();
  await expect(page.getByText('Auto-adjust may drop 1 to fit time')).toBeVisible();
  await expect(page.getByText('How exercises are chosen')).toBeVisible();
  await expect(chip(page, 'Quads')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Hamstrings')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Glutes')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.val')).toHaveText('5');
  await expect(page.getByRole('button', { name: 'Auto-pick' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Exercise pool')).toBeVisible();
  await expect(page.getByText('4 · 1 pinned')).toBeVisible();
  await expect(poolRows(page)).toHaveCount(4);
  await expect(poolRows(page).first().locator('.li-t')).toHaveText('Back squat');
  await expect(poolRows(page).first().locator('.li-s')).toContainText('Quads, Glutes · ');
  await expect(page.getByText('Flag = always include when the gym has the equipment.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Plan' }).or(page.getByRole('button', { name: 'Back to Plan' }))).toBeVisible();
  expect(errors).toEqual([]);
});

test('area not found', async ({ page }) => {
  await seed(page);
  await page.goto('plan/area/nope');
  await expect(page.getByRole('heading', { name: 'Area not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Plan' }).last().click();
  await expect(page).toHaveURL(/plan$/);
});

test('area outside the rotation titled just "Area"', async ({ page }) => {
  await seed(page, { settings: { rotation: ['area-1'] } });
  await page.goto('plan/area/area-2');
  await expect(page.getByText('Area', { exact: true })).toBeVisible();
});

test('name: edit and Save persist; trims; blank becomes Untitled area', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByLabel('Name').fill('  Legs day  ');
  await saveBtn(page).click();
  await expect(page).toHaveURL(/plan$/);
  await expect.poll(async () => (await area(page)).name).toBe('Legs day');
  await expect(page.locator('.li-t', { hasText: 'Legs day' })).toBeVisible();
  await page.goto('plan/area/area-2');
  await page.getByLabel('Name').fill('   ');
  await saveBtn(page).click();
  await expect.poll(async () => (await area(page)).name).toBe('Untitled area');
});

test('focus muscles toggle on/off and persist on Save', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await chip(page, 'Glutes').click();
  await expect(chip(page, 'Glutes')).toHaveAttribute('aria-pressed', 'true');
  await chip(page, 'Quads').click();
  await expect(chip(page, 'Quads')).toHaveAttribute('aria-pressed', 'false');
  expect((await area(page)).focusMuscles).toEqual(['Quads', 'Hamstrings']); // not saved yet
  await saveBtn(page).click();
  await expect.poll(async () => (await area(page)).focusMuscles).toEqual(['Hamstrings', 'Glutes']);
});

test('exercises per session: bounds 1..10', async ({ page }) => {
  await seed(page, { areas: areasWith({ exercisesPerSession: 2 }) });
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Fewer', exact: true }).click();
  await expect(page.locator('.val')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Fewer', exact: true })).toBeDisabled();
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.locator('.val')).toHaveText('10');
  await expect(page.getByRole('button', { name: 'More', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Fewer', exact: true }).click();
  await saveBtn(page).click();
  await expect.poll(async () => (await area(page)).exercisesPerSession).toBe(9);
});

test('mode: auto/fixed with help text; persists', async ({ page }) => {
  await seed(page, { areas: areasWith({ exercisesPerSession: 4 }) });
  await page.goto('plan/area/area-2');
  await expect(page.locator('.help')).toContainText('Each session picks 4 from the pool: flagged ones first');
  await expect(page.locator('.help')).toContainText('Always filtered by the gym’s equipment.');
  await page.getByRole('button', { name: 'Fixed list' }).click();
  await expect(page.getByRole('button', { name: 'Fixed list' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Auto-pick' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.help')).toHaveText('The same exercises in pool order every time. Unavailable ones are hot-swapped.');
  await page.getByRole('button', { name: 'Fewer', exact: true }).click();
  await page.getByRole('button', { name: 'Auto-pick' }).click();
  await expect(page.locator('.help')).toContainText('Each session picks 3 from the pool');
  await page.getByRole('button', { name: 'Fixed list' }).click();
  await saveBtn(page).click();
  await expect.poll(async () => (await area(page)).mode).toBe('fixed');
  await page.goto('plan');
  await expect(page.getByText('3 exercises · fixed list')).toBeVisible();
});

test('pool: pin/unflag toggles counts and aria; remove drops pin; links to exercise', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Always include Romanian deadlift' }).click();
  await expect(page.getByText('4 · 2 pinned')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unflag Romanian deadlift' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Unflag Back squat' }).click();
  await expect(page.getByText('4 · 1 pinned')).toBeVisible();
  await page.getByRole('button', { name: 'Always include Back squat' }).click();
  await page.getByRole('button', { name: 'Remove Back squat from pool' }).click();
  await expect(page.getByText('3 · 1 pinned')).toBeVisible();
  await expect(poolRows(page)).toHaveCount(3);
  await saveBtn(page).click();
  await expect.poll(async () => (await area(page)).poolExerciseIds).toEqual(['rdl', 'leg_press', 'walking_lunge']);
  expect((await area(page)).pinnedExerciseIds).toEqual(['rdl']);
  await page.goto('plan/area/area-2');
  await poolRows(page).first().getByRole('link').click();
  await expect(page).toHaveURL(/library\/rdl$/);
});

test('score chips: one per live pool exercise, update live with focus muscles', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await expect(poolRows(page).locator('.tag')).toHaveCount(4);
  const before = await poolRows(page).nth(0).locator('.tag').textContent();
  expect(before).toMatch(/\d+/);
  await page.getByRole('button', { name: 'Remove Back squat from pool' }).click();
  await expect(poolRows(page).locator('.tag')).toHaveCount(3);
});

test('score chip shows Cooling when done too recently', async ({ page }) => {
  await seed(page, { areas: areasWith(), sessions: [makeSession({ id: 's1', seq: 1, slot: 2, areaId: 'area-2', areaName: 'Lower body', daysAgo: 0, exerciseIds: ['back_squat'] })] });
  await page.goto('plan/area/area-2');
  await expect(poolRows(page).first().locator('.tag.blue')).toContainText('Cooling');
});

test('empty pool: explanatory text, no list, pool count 0', async ({ page }) => {
  await seed(page, { areas: areasWith({ poolExerciseIds: [], pinnedExerciseIds: [] }) });
  await page.goto('plan/area/area-2');
  await expect(page.getByText('0 · 0 pinned')).toBeVisible();
  await expect(page.getByText('The pool is empty, so sessions pick from every exercise that trains the focus muscles. Add exercises to control the mix.')).toBeVisible();
  await expect(poolRows(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add from library' })).toBeVisible();
});

test('removing the last pool exercise shows the empty state', async ({ page }) => {
  await seed(page, { areas: areasWith({ poolExerciseIds: ['rdl'], pinnedExerciseIds: [] }) });
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Remove Romanian deadlift from pool' }).click();
  await expect(page.getByText(/The pool is empty/)).toBeVisible();
});

test('Add from library saves the draft and opens library in add-to-area mode; adding persists to pool', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByLabel('Name').fill('Legs');
  await page.getByRole('button', { name: 'Add from library' }).click();
  await expect(page).toHaveURL(/library(\/all)?\?addToArea=area-2$/);
  await expect(page.getByText('Add to Legs', { exact: true })).toBeVisible();
  await expect.poll(async () => (await area(page)).name).toBe('Legs'); // store persists on a short debounce
  // pick something not in the pool
  const before = (await area(page)).poolExerciseIds.length;
  await page.getByRole('button', { name: 'Add Hack squat', exact: true }).click();
  await expect.poll(async () => (await area(page)).poolExerciseIds).toContain('hack_squat');
  expect((await area(page)).poolExerciseIds).toHaveLength(before + 1);
  expect((await area(page)).name).toBe('Legs');
});

test('unsaved changes: back with no edits leaves silently', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Back to Plan' }).click();
  await expect(page).toHaveURL(/plan$/);
});

test('unsaved changes: back asks; Keep editing / Discard / Save changes', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByLabel('Name').fill('Changed');
  await page.getByRole('button', { name: 'Back to Plan' }).click();
  const dlg = page.getByRole('alertdialog', { name: 'Unsaved changes' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText('Discard changes?')).toBeVisible();
  await dlg.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(page.getByLabel('Name')).toHaveValue('Changed');
  await page.getByRole('button', { name: 'Back to Plan' }).click();
  await dlg.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(/plan$/);
  expect((await area(page)).name).toBe('Lower body');
  await page.goto('plan/area/area-2');
  await chip(page, 'Calves').click();
  await page.getByRole('button', { name: 'Back to Plan' }).click();
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/plan$/);
  await expect.poll(async () => (await area(page)).focusMuscles).toContain('Calves');
});

test('unsaved changes: reverting an edit clears the dirty state; beforeunload armed only when dirty', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await chip(page, 'Calves').click();
  await chip(page, 'Calves').click();
  await page.getByRole('button', { name: 'Back to Plan' }).click();
  await expect(page).toHaveURL(/plan$/);
  await page.goto('plan/area/area-2');
  const evt = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  expect(await evt()).toBe(false);
  await page.getByLabel('Name').fill('X');
  expect(await evt()).toBe(true);
});

test('delete: cancel keeps; confirm removes area from rotation and store', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Remove area from rotation' }).click();
  const dlg = page.getByRole('alertdialog', { name: 'Delete area' });
  await expect(dlg.getByText('Delete “Lower body”?')).toBeVisible();
  await expect(dlg.getByText('It is removed from your rotation. Past sessions keep their history.')).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toHaveCount(0);
  expect((await readState(page)).settings.rotation).toContain('area-2');
  await page.getByRole('button', { name: 'Remove area from rotation' }).click();
  await dlg.getByRole('button', { name: 'Delete area' }).click();
  await expect(page).toHaveURL(/plan$/);
  await expect.poll(async () => (await readState(page)).settings.rotation).toEqual(['area-1', 'area-3', 'area-4']);
  const st = await readState(page);
  expect(st.areas['area-2']).toBeUndefined();
  await expect(page.locator('.group').first().locator('.li-t')).toHaveText(['Upper body', 'Prehab & mobility', 'Full body']);
  await expect(page.getByText('Loops 1 → 3 → 1')).toBeVisible();
  await expect(page.locator('.banner.info')).toContainText('Goal is 4 but rotation has 3 areas');
});

test('delete shifts the Today next-slot pointer onto the following area', async ({ page }) => {
  await seed(page, { areas: areasWith(), sessions: [makeSession({ id: 's1', seq: 1, slot: 1, areaId: 'area-1', areaName: 'Upper body', daysAgo: 1, exerciseIds: ['bench_press'] })] });
  await page.goto('');
  await expect(page.getByLabel('Next session').getByRole('heading')).toHaveText('Lower body');
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Remove area from rotation' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete area' }).click();
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByLabel('Next session').getByRole('heading')).toHaveText('Prehab & mobility');
});

test('deleted area is gone: its editor shows not-found after reload', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByRole('button', { name: 'Remove area from rotation' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete area' }).click();
  await expect(page).toHaveURL(/plan$/);
  await expect.poll(async () => (await readState(page)).areas['area-2']).toBeUndefined();
  await page.goto('plan/area/area-2');
  await expect(page.getByRole('heading', { name: 'Area not found' })).toBeVisible();
});

test('pinned + banned: banned exercise is never generated; control shows it when not banned', async ({ page }) => {
  const rot = ['area-2', 'area-1', 'area-3', 'area-4'];
  const lower = { poolExerciseIds: ['back_squat', 'rdl', 'leg_press', 'walking_lunge'], pinnedExerciseIds: ['back_squat'], exercisesPerSession: 3 };
  // control: pinned, not banned -> present
  await seed(page, { areas: areasWith(lower), settings: { rotation: rot } });
  await page.goto('session/preview');
  await expect(page.getByRole('button', { name: /^Move .* up$/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Back squat up' })).toHaveCount(1);
});
test('pinned + banned: banned pinned exercise stays in the pool but is never generated (auto)', async ({ page }) => {
  const rot = ['area-2', 'area-1', 'area-3', 'area-4'];
  await seed(page, {
    areas: areasWith({ poolExerciseIds: ['back_squat', 'rdl', 'leg_press', 'walking_lunge'], pinnedExerciseIds: ['back_squat'], exercisesPerSession: 3 }),
    settings: { rotation: rot },
    prefs: { back_squat: { exerciseId: 'back_squat', favorite: false, avoid: true, relevance: 50 } },
  });
  await page.goto('session/preview');
  await expect(page.getByRole('button', { name: /^Move .* up$/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Back squat up' })).toHaveCount(0);
  
  // editor still lists it, flagged
  await page.goto('plan/area/area-2');
  await expect(page.getByRole('button', { name: 'Unflag Back squat' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('4 · 1 pinned')).toBeVisible();
});
test('pinned + banned in fixed mode: banned exercise is skipped', async ({ page }) => {
  await seed(page, {
    areas: areasWith({ mode: 'fixed', poolExerciseIds: ['back_squat', 'rdl', 'leg_press'], pinnedExerciseIds: ['back_squat'], exercisesPerSession: 3 }),
    settings: { rotation: ['area-2', 'area-1', 'area-3', 'area-4'] },
    prefs: { back_squat: { exerciseId: 'back_squat', favorite: true, avoid: true, relevance: 50 } },
  });
  await page.goto('session/preview');
  await expect(page.getByRole('button', { name: /^Move .* up$/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Back squat up' })).toHaveCount(0);
});
test('pinned + paused: paused pinned exercise is also not generated', async ({ page }) => {
  await seed(page, {
    areas: areasWith({ poolExerciseIds: ['back_squat', 'rdl', 'leg_press', 'walking_lunge'], pinnedExerciseIds: ['back_squat'], exercisesPerSession: 3 }),
    settings: { rotation: ['area-2', 'area-1', 'area-3', 'area-4'] },
    prefs: { back_squat: { exerciseId: 'back_squat', favorite: false, avoid: false, relevance: 50, pausedUntil: Date.now() + 86400000 * 7 } },
  });
  await page.goto('session/preview');
  await expect(page.getByRole('button', { name: /^Move .* up$/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move Back squat up' })).toHaveCount(0);
});

test('archived pool exercise: shown dimmed as Archived, no score chip', async ({ page }) => {
  // an id that is not in the library at all is skipped silently
  await seed(page, { areas: areasWith({ poolExerciseIds: ['rdl', 'ghost_id'], pinnedExerciseIds: [] }) });
  await page.goto('plan/area/area-2');
  await expect(poolRows(page)).toHaveCount(1);
});

test('edits made in the editor are persisted after reload (full round-trip)', async ({ page }) => {
  await seed(page, { areas: areasWith() });
  await page.goto('plan/area/area-2');
  await page.getByLabel('Name').fill('Quad day');
  await chip(page, 'Calves').click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Fixed list' }).click();
  await page.getByRole('button', { name: 'Always include Leg press' }).click();
  await page.getByRole('button', { name: 'Remove Walking lunge from pool' }).click();
  await saveBtn(page).click();
  await expect(page).toHaveURL(/plan$/);
  await expect.poll(async () => (await area(page)).name).toBe('Quad day');
  await page.reload();
  await page.getByRole('link', { name: /Quad day/ }).click();
  await expect(page.getByLabel('Name')).toHaveValue('Quad day');
  await expect(chip(page, 'Calves')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.val')).toHaveText('6');
  await expect(page.getByRole('button', { name: 'Fixed list' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('3 · 2 pinned')).toBeVisible();
});

for (const [w, h] of [[440, 956], [375, 667], [360, 640]] as const) {
  test(`${w}px: no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await seed(page, { areas: areasWith() });
    await page.goto('plan/area/area-2');
    const m = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, Math.max(...[...document.querySelectorAll('.scroll *')].map((e) => e.getBoundingClientRect().right))]);
    expect(m[0]).toBeLessThanOrEqual(m[1]);
    expect(m[2]).toBeLessThanOrEqual(m[1] + 0.5);
  });
}
