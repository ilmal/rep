import { test, expect, seed, readState, makeGym, makeAreas } from './fixtures';
import { EQUIPMENT } from '../../src/shared/catalog';
import { ALL_MUSCLES, SEED_BY_ID, mergeLibrary } from '../../src/shared/exercises';
import { DEFAULT_PREF, generateSession } from '../../src/shared/planner';
import { withDefaults } from '../../src/shared/defaults';
import type { Area } from '../../src/shared/types';

const NAME = page_name();
function page_name() { return 'Kneeling Zottman press'; }
const exercises = async (page: any) => Object.values((await readState(page)).exercises ?? {}) as any[];
const byName = (page: any, n: string) => expect.poll(async () => (await exercises(page)).find((e) => e.name === n));
const grp = (page: any, n: string) => page.getByRole('group', { name: n, exact: true });
const nameInput = (page: any) => page.getByPlaceholder('e.g. Landmine press');
const save = (page: any) => page.getByRole('button', { name: 'Save exercise' }).click();

/** What the planner would pick for an area that wants calves, from the persisted state. */
async function plannedIds(page: any, prefs: Record<string, any> = {}): Promise<string[]> {
  const st = await readState(page);
  const calf: Area = { id: 'area-calf', name: 'Calves', focusMuscles: ['Calves'], exercisesPerSession: 60, mode: 'auto', pinnedExerciseIds: [], poolExerciseIds: [] };
  const r = generateSession({
    area: calf, gym: Object.values(st.gyms)[0] as any, library: mergeLibrary(Object.values(st.exercises ?? {}) as any), prefs: { ...st.prefs, ...prefs },
    progress: st.progress ?? {}, sessions: Object.values(st.sessions ?? {}) as any, planner: withDefaults(st.settings).planner,
    restSec: 90, targetMin: 600, warmupMin: 0, now: Date.now(), newId: () => Math.random().toString(36).slice(2),
  });
  return r.exercises.map((e) => e.exerciseId);
}

test.beforeEach(async ({ page }, info) => { if (!info.title.startsWith('equipment chips')) await seed(page); });

test('new form: defaults, copy, catalog-backed chips', async ({ page, errors }) => {
  await page.goto('exercise/new');
  await expect(page.locator('.topbar .title')).toHaveText('New exercise');
  await expect(nameInput(page)).toHaveValue('');
  await expect(page.getByText('Required', { exact: true })).toBeVisible();
  await expect(page.getByText('Used to filter by gym')).toBeVisible();
  await expect(grp(page, 'Primary muscles').getByRole('button')).toHaveCount(ALL_MUSCLES.length);
  await expect(grp(page, 'Movement pattern').getByRole('button')).toHaveCount(8);
  // every catalog item is offered as an equipment chip
  const eq = page.locator('.card', { hasText: 'Equipment needed' });
  await expect(eq.locator('button.chip')).toHaveCount(EQUIPMENT.length);
  await expect(eq.getByRole('button', { name: 'Barbell (20 kg)', exact: true })).toBeVisible();
  await expect(grp(page, 'Difficulty').getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
  await expect(grp(page, 'Track as').getByRole('button', { name: 'Weight × reps' })).toHaveAttribute('aria-pressed', 'true');
  await expect(grp(page, 'Weight step').getByRole('button', { name: '2.5 kg' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', /library$/);
  await expect(page.locator('.toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('prefills name from ?name=', async ({ page }) => {
  await page.goto('exercise/new?name=Zottman%20curl');
  await expect(nameInput(page)).toHaveValue('Zottman curl');
});

test('validation: every error shows, clears, and nothing is saved', async ({ page }) => {
  await page.goto('exercise/new');
  await save(page);
  await expect(page.getByText('Give the exercise a name.')).toBeVisible();
  await expect(page.getByText('Pick at least one primary muscle. Swaps and generation depend on it.')).toBeVisible();
  await expect(page.getByText('Pick a movement pattern. Swaps rank alternatives by it.')).toBeVisible();
  await expect(nameInput(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(nameInput(page)).toHaveClass(/err/);
  await expect(page.locator('.toast')).toHaveCount(0);
  // whitespace-only name still invalid
  await nameInput(page).fill('   ');
  await expect(page.getByText('Give the exercise a name.')).toBeVisible();
  await nameInput(page).fill(NAME);
  await expect(page.getByText('Give the exercise a name.')).toHaveCount(0);
  await grp(page, 'Primary muscles').getByRole('button', { name: 'Chest' }).click();
  await expect(page.getByText('Pick at least one primary muscle.')).toHaveCount(0);
  await save(page);
  await expect(page.getByText('Pick a movement pattern.')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await exercises(page)).toHaveLength(0);
  // toggling a chip off restores the error
  await grp(page, 'Primary muscles').getByRole('button', { name: 'Chest' }).click();
  await expect(page.getByText('Pick at least one primary muscle.')).toBeVisible();
});

test('chips toggle; pattern is single-select; secondary dropped when also primary', async ({ page }) => {
  await page.goto('exercise/new');
  const push = grp(page, 'Movement pattern').getByRole('button', { name: 'Push', exact: true });
  const pull = grp(page, 'Movement pattern').getByRole('button', { name: 'Pull', exact: true });
  await push.click();
  await pull.click();
  await expect(push).toHaveAttribute('aria-pressed', 'false');
  await expect(pull).toHaveAttribute('aria-pressed', 'true');
  await pull.click();
  await expect(pull).toHaveAttribute('aria-pressed', 'false');
  await pull.click();
  await nameInput(page).fill('Pull test');
  await grp(page, 'Primary muscles').getByRole('button', { name: 'Lats' }).click();
  await grp(page, 'Secondary muscles').getByRole('button', { name: 'Lats' }).click();
  await grp(page, 'Secondary muscles').getByRole('button', { name: 'Biceps' }).click();
  await save(page);
  const e = await byName(page, 'Pull test').toBeTruthy().then(async () => (await exercises(page)).find((x) => x.name === 'Pull test'));
  expect(e.primary).toEqual(['Lats']);
  expect(e.secondary).toEqual(['Biceps']);
});

test('tracking modes change which fields exist and the rep-range unit', async ({ page }) => {
  await page.goto('exercise/new');
  const track = grp(page, 'Track as');
  await expect(page.getByText('Min reps')).toBeVisible();
  await expect(page.getByText('Weight step', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Weight is per hand')).toBeVisible();
  await track.getByRole('button', { name: 'Reps only' }).click();
  await expect(page.getByText('Weight step', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Weight is per hand')).toHaveCount(0);
  await track.getByRole('button', { name: 'Time' }).click();
  await expect(page.getByText('Min duration')).toBeVisible();
  await expect(page.getByText('Max duration')).toBeVisible();
  await expect(page.locator('.val.sm .unit', { hasText: 's' }).first()).toBeVisible();
  await expect(page.getByText('Weight step', { exact: true })).toBeVisible();
  await track.getByRole('button', { name: 'Weight × reps' }).click();
  await expect(page.getByText('Min reps')).toBeVisible();
});

test('rep range, default sets steppers respect bounds', async ({ page }) => {
  await page.goto('exercise/new');
  const vals = page.locator('.val.sm');
  // order: min reps, max reps, sets
  await expect(vals.nth(0)).toHaveText('8');
  await expect(vals.nth(1)).toHaveText('12');
  await expect(vals.nth(2)).toHaveText('3');
  const lowerMin = page.getByRole('button', { name: 'Lower minimum' }), higherMin = page.getByRole('button', { name: 'Higher minimum' });
  const lowerMax = page.getByRole('button', { name: 'Lower maximum' }), higherMax = page.getByRole('button', { name: 'Higher maximum' });
  for (let i = 0; i < 4; i++) await higherMin.click();
  await expect(vals.nth(0)).toHaveText('12');
  await expect(higherMin).toBeDisabled();
  await expect(lowerMax).toBeDisabled();
  await higherMax.click();
  await expect(vals.nth(1)).toHaveText('13');
  for (let i = 0; i < 20; i++) if (await lowerMin.isEnabled()) await lowerMin.click();
  await expect(vals.nth(0)).toHaveText('1');
  await expect(lowerMin).toBeDisabled();
  const fewer = page.getByRole('button', { name: 'Fewer sets' }), more = page.getByRole('button', { name: 'More sets' });
  for (let i = 0; i < 5; i++) if (await fewer.isEnabled()) await fewer.click();
  await expect(vals.nth(2)).toHaveText('1');
  await expect(fewer).toBeDisabled();
  for (let i = 0; i < 12; i++) if (await more.isEnabled()) await more.click();
  await expect(vals.nth(2)).toHaveText('10');
  await expect(more).toBeDisabled();
});

test('custom exercise lifecycle: create -> toast -> library -> planner -> edit -> ban -> archive', async ({ page, errors }) => {
  await page.goto('exercise/new');
  await nameInput(page).fill(`  ${NAME}  `);
  await grp(page, 'Primary muscles').getByRole('button', { name: 'Calves' }).click();
  await grp(page, 'Secondary muscles').getByRole('button', { name: 'Core' }).click();
  await grp(page, 'Movement pattern').getByRole('button', { name: 'Push' }).click();
  await grp(page, 'Difficulty').getByRole('button', { name: 'Advanced' }).click();
  await grp(page, 'Weight step').getByRole('button', { name: '5 kg', exact: true }).click();
  await page.getByLabel('Weight is per hand').check();
  await page.getByLabel('Counts as prehab').check();
  await page.getByPlaceholder('How to do it, in one or two lines').fill('Brace and press.');
  await page.getByRole('button', { name: 'Higher maximum' }).click();
  await page.getByRole('button', { name: 'More sets' }).click();
  expect(await plannedIds(page)).not.toContain('x');
  await save(page);
  await expect(page.locator('.toast')).toContainText(`${NAME} added to your library`);
  await byName(page, NAME).toBeTruthy();
  const ex = (await exercises(page)).find((e) => e.name === NAME);
  expect(ex).toMatchObject({ name: NAME, primary: ['Calves'], secondary: ['Core'], equipment: [], pattern: 'push', difficulty: 3, tracking: 'weight_reps', weightStep: 5, repMin: 8, repMax: 13, defaultSets: 4, perHand: true, prehab: true, cue: 'Brace and press.', isCustom: true });
  expect(ex.id).toBeTruthy();
  expect(SEED_BY_ID[ex.id]).toBeUndefined();

  // saving again updates the same entity (no duplicate)
  await page.getByRole('button', { name: 'Higher maximum' }).click();
  await expect(page.locator('.toast')).toHaveCount(0);
  await save(page);
  await expect.poll(async () => (await exercises(page)).find((e) => e.name === NAME)?.repMax).toBe(14);
  expect((await exercises(page)).filter((e) => e.name === NAME)).toHaveLength(1);
  expect((await exercises(page)).find((e) => e.name === NAME).id).toBe(ex.id);

  // appears in Library
  await page.getByRole('link', { name: 'View' }).click();
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await expect(page.locator('dl.labels').getByText('Calves')).toBeVisible();
  await expect(page.locator('dl.labels').getByText('8–14 reps · 4 sets · per hand')).toBeVisible();
  await page.goto('library/all');
  await page.getByLabel('Search exercises').fill('zottman');
  const row = page.locator('.exrow', { hasText: NAME });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Custom', { exact: true })).toBeVisible();

  // pickable by the planner
  expect(await plannedIds(page)).toContain(ex.id);
  // banned -> not planned; paused -> not planned; archived -> not planned
  expect(await plannedIds(page, { [ex.id]: { ...DEFAULT_PREF(ex.id), avoid: true } })).not.toContain(ex.id);
  expect(await plannedIds(page, { [ex.id]: { ...DEFAULT_PREF(ex.id), pausedSessions: 1 } })).not.toContain(ex.id);

  // archive via detail removes it from library and planner
  await page.goto(`library/${ex.id}`);
  await page.getByRole('button', { name: 'Archive exercise' }).click();
  await expect.poll(async () => (await exercises(page)).find((e) => e.id === ex.id)?.archived).toBe(true);
  expect(await plannedIds(page)).not.toContain(ex.id);
  await page.goto('library/all');
  await page.getByLabel('Search exercises').fill('zottman');
  await expect(page.locator('.exrow', { hasText: NAME })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('edit custom exercise: prefilled, saves in place, toast says saved', async ({ page }) => {
  await page.goto('exercise/new');
  await nameInput(page).fill('Cable fly mod');
  await grp(page, 'Primary muscles').getByRole('button', { name: 'Chest' }).click();
  await grp(page, 'Movement pattern').getByRole('button', { name: 'Push' }).click();
  await grp(page, 'Track as').getByRole('button', { name: 'Reps only' }).click();
  await save(page);
  await byName(page, 'Cable fly mod').toBeTruthy();
  const id = (await exercises(page)).find((e) => e.name === 'Cable fly mod').id;
  await page.goto(`exercise/${id}/edit`);
  await expect(page.locator('.topbar .title')).toHaveText('Edit exercise');
  await expect(page.getByText('This is a built-in exercise')).toHaveCount(0);
  await expect(nameInput(page)).toHaveValue('Cable fly mod');
  await expect(grp(page, 'Primary muscles').getByRole('button', { name: 'Chest' })).toHaveAttribute('aria-pressed', 'true');
  await expect(grp(page, 'Track as').getByRole('button', { name: 'Reps only' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', new RegExp(`library/${id}$`));
  await nameInput(page).fill('Cable fly renamed');
  await save(page);
  await expect(page.locator('.toast')).toContainText('Cable fly renamed saved');
  await expect.poll(async () => (await exercises(page)).find((e) => e.id === id)?.name).toBe('Cable fly renamed');
  expect((await exercises(page)).filter((e) => e.id === id)).toHaveLength(1);
  await page.getByRole('link', { name: 'View' }).click();
  await expect(page).toHaveURL(new RegExp(`library/${id}$`));
});

test('built-in override keeps its id, shows the notice, planner uses the override', async ({ page }) => {
  await page.goto('exercise/back_squat/edit');
  await expect(page.getByText('This is a built-in exercise. Saving creates your personal version of it; the original is untouched.')).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Back squat');
  await expect(grp(page, 'Primary muscles').getByRole('button', { name: 'Quads' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Weight is per hand')).not.toBeChecked();
  await nameInput(page).fill('Back squat (mine)');
  await page.getByRole('button', { name: 'More sets' }).click();
  await save(page);
  await expect(page.locator('.toast')).toContainText('Back squat (mine) saved');
  await expect.poll(async () => (await readState(page)).exercises.back_squat?.name).toBe('Back squat (mine)');
  const st = await readState(page);
  expect(Object.keys(st.exercises)).toEqual(['back_squat']);
  expect(st.exercises.back_squat).toMatchObject({ id: 'back_squat', isCustom: false, defaultSets: 5 });
  expect(st.exercises.back_squat.equipment).toEqual(SEED_BY_ID.back_squat.equipment);
  // detail and library reflect it
  await page.goto('library/back_squat');
  await expect(page.getByRole('heading', { name: 'Back squat (mine)' })).toBeVisible();
  await page.goto('library/all');
  await page.getByLabel('Search exercises').fill('Back squat');
  await expect(page.locator('.exrow', { hasText: 'Back squat (mine)' })).toHaveCount(1);
  await expect(page.locator('.exrow', { hasText: 'Back squat (mine)' }).getByText('Custom', { exact: true })).toHaveCount(0);
});

test('equipment chips: selected equipment is stored by catalog id and filters by gym', async ({ page }) => {
  const home = makeGym({ id: 'gym-b', name: 'Basement', equipment: { dumbbells: 'ok' } });
  await seed(page, { gyms: [makeGym(), home], areas: makeAreas() });
  await page.goto('exercise/new');
  await nameInput(page).fill('Rack curl');
  await grp(page, 'Primary muscles').getByRole('button', { name: 'Biceps' }).click();
  await grp(page, 'Movement pattern').getByRole('button', { name: 'Pull' }).click();
  await page.locator('.card', { hasText: 'Equipment needed' }).getByRole('button', { name: 'Barbell (20 kg)', exact: true }).click();
  await save(page);
  await byName(page, 'Rack curl').toBeTruthy();
  const ex = (await exercises(page)).find((e) => e.name === 'Rack curl');
  expect(ex.equipment).toEqual(['barbell']);
  await page.getByRole('link', { name: 'View' }).click();
  await expect(page.locator('.group .li', { hasText: 'City Gym Odenplan' }).locator('.dot.green')).toBeVisible();
  await expect(page.locator('.group .li', { hasText: 'Basement' }).locator('.dot.red')).toBeVisible();
});

test('unknown id on edit shows not-found', async ({ page, errors }) => {
  await page.goto('exercise/does-not-exist/edit');
  await expect(page.getByRole('heading', { name: 'Exercise not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Open library' }).click();
  await expect(page).toHaveURL(/library$/);
  expect(errors).toEqual([]);
});

test('375px: form fits, bottom bar reachable, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('exercise/new');
  for (const w of [375, 360]) {
    await page.setViewportSize({ width: w, height: 667 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => [...document.querySelectorAll('.scroll')].every((e) => e.scrollWidth <= e.clientWidth))).toBe(true);
  }
  await expect(page.getByRole('button', { name: 'Save exercise' })).toBeInViewport();
  await save(page);
  await expect(page.getByText('Give the exercise a name.')).toBeVisible();
  await page.goto('exercise/back_squat/edit');
  expect(await page.evaluate(() => [...document.querySelectorAll('.scroll')].every((e) => e.scrollWidth <= e.clientWidth))).toBe(true);
});
