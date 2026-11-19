import { SEED_BY_ID } from '../../src/shared/exercises';
import { availableEquipment, rankAlternatives, toSessionExercise } from '../../src/shared/rules';
import { rankWithFloor } from '../../src/client/store/x-swap';
import { BODYWEIGHT_IDS, banBodyweight, expect, GYM_ID, makeAreas, makeGym, makeSession, readState, seed, test } from './fixtures';
import type { Gym } from '../../src/shared/types';

const LIB = Object.values(SEED_BY_ID);

/** Active session: first exercise `active`, the rest `todo`. */
function active(exerciseIds: string[], gym: Gym = makeGym(), over: Record<string, unknown> = {}) {
  const areas = makeAreas();
  const base = makeSession({ id: 'sess-live', seq: 3, slot: 1, areaId: areas[1].id, areaName: 'Lower body', daysAgo: 0, exerciseIds });
  const exercises = base.exercises.map((e, i) => ({ ...e, status: (i === 0 ? 'active' : 'todo') as 'active' | 'todo', sets: [], feedback: undefined, recommendation: undefined, startedAt: i === 0 ? Date.now() : undefined, endedAt: undefined, plannedSets: 3, repTarget: 12 }));
  return { ...base, gymId: gym.id, gymName: gym.name, status: 'active' as const, phase: 'set' as const, cursor: 0, endedAt: undefined, exercises, ...over };
}
const gymWith = (ids: string[]) => makeGym({ equipment: Object.fromEntries(ids.map((i) => [i, 'ok'])) as never });
const expectedFor = (gym: Gym, current: string, exclude: string[], busy: string[] = []) =>
  rankAlternatives(SEED_BY_ID[current], LIB, availableEquipment(gym, busy), exclude);
/** Persisted state once the session reflects a completed action (persist is async). */
async function persisted(page: import('@playwright/test').Page, ready: (st: any) => boolean) {
  await expect.poll(async () => { const st = await readState(page); return !!st && ready(st); }).toBe(true);
  return readState(page);
}
const rows = (page: import('@playwright/test').Page) => page.getByRole('radiogroup', { name: 'Alternatives' }).getByRole('radio');

test.describe('swap screen', () => {
  test('route guard: no active session goes home', async ({ page }) => {
    await seed(page);
    await page.goto('session/swap');
    await expect(page).toHaveURL(/\/app\/?$/);
    await page.goto('session/swap?none=1');
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test('wrapper with the default floor equals rankAlternatives', () => {
    for (const id of ['seated_leg_curl', 'back_squat', 'hack_squat', 'bench_press']) {
      if (!SEED_BY_ID[id]) continue;
      const avail = availableEquipment(makeGym());
      expect(rankWithFloor(SEED_BY_ID[id], LIB, avail, [])).toEqual(rankAlternatives(SEED_BY_ID[id], LIB, avail, []));
    }
  });

  test('lists top alternatives ranked like rankAlternatives, with match % and carried sets x reps', async ({ page }) => {
    const sess = active(['seated_leg_curl', 'back_squat']);
    await seed(page, { sessions: [sess] });
    await page.goto('session/swap');
    await expect(page.getByRole('heading', { name: 'Swap Seated leg curl' })).toBeVisible();
    await expect(page.getByText('Ranked by muscle match, available at City Gym Odenplan')).toBeVisible();
    const want = expectedFor(makeGym(), 'seated_leg_curl', ['seated_leg_curl', 'back_squat']);
    expect(want.length).toBeGreaterThan(1);
    await expect(rows(page)).toHaveCount(want.length);
    for (let i = 0; i < want.length; i++) {
      const row = rows(page).nth(i);
      await expect(row.locator('.li-t')).toHaveText(want[i].exercise.name);
      await expect(row.locator('.match')).toContainText(`${want[i].match}%`);
      await expect(row.locator('.li-s')).toContainText('3 × ');
    }
    await expect(rows(page).first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: `Swap to ${want[0].exercise.name}` })).toBeVisible();
    await rows(page).nth(1).click();
    await expect(rows(page).nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: `Swap to ${want[1].exercise.name}` })).toBeVisible();
  });

  test('banned and paused exercises never appear', async ({ page }) => {
    const gym = makeGym();
    const base = expectedFor(gym, 'seated_leg_curl', ['seated_leg_curl']);
    const [a, b] = [base[0].exercise.id, base[1].exercise.id];
    await seed(page, {
      sessions: [active(['seated_leg_curl'])],
      prefs: { [a]: { exerciseId: a, favorite: false, avoid: true, relevance: 50 }, [b]: { exerciseId: b, favorite: false, avoid: false, relevance: 50, pausedUntil: Date.now() + 5 * 86400000 } },
    });
    await page.goto('session/swap');
    const names = await rows(page).locator('.li-t').allTextContents();
    expect(names).not.toContain(base[0].exercise.name);
    expect(names).not.toContain(base[1].exercise.name);
    const want = expectedFor(gym, 'seated_leg_curl', ['seated_leg_curl', a, b]);
    expect(names).toEqual(want.map((w) => w.exercise.name));
  });

  test('paused by session count is excluded too', async ({ page }) => {
    const first = expectedFor(makeGym(), 'seated_leg_curl', ['seated_leg_curl'])[0].exercise;
    await seed(page, { sessions: [active(['seated_leg_curl'])], prefs: { [first.id]: { exerciseId: first.id, favorite: false, avoid: false, relevance: 50, pausedSessions: 1 } } });
    await page.goto('session/swap');
    expect(await rows(page).locator('.li-t').allTextContents()).not.toContain(first.name);
  });

  test('only equipment available at this gym; missing and busy equipment is excluded', async ({ page }) => {
    const gym = gymWith(['seated_leg_curl', 'nordic_bench', 'dumbbells', 'barbell']);
    await seed(page, { gyms: [gym], sessions: [active(['seated_leg_curl'], gym, { busyEquip: ['barbell'] })] });
    await page.goto('session/swap');
    const names = await rows(page).locator('.li-t').allTextContents();
    expect(names).toEqual(expectedFor(gym, 'seated_leg_curl', ['seated_leg_curl'], ['barbell']).map((w) => w.exercise.name));
    expect(names).toContain('Nordic curl');
    expect(names).not.toContain('Lying leg curl');
    expect(names).not.toContain('Romanian deadlift');
  });

  test('reason picker: three reasons with an equipment explanation each', async ({ page }) => {
    await seed(page, { sessions: [active(['seated_leg_curl'])] });
    await page.goto('session/swap');
    const grp = page.getByRole('group', { name: 'Reason' });
    await expect(grp.getByRole('button')).toHaveText(['Taken', 'Not here', 'Don’t want']);
    await expect(grp.getByRole('button', { name: 'Taken' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.help')).toContainText('Seated leg curl is skipped for this session only. It stays in City Gym Odenplan');
    await grp.getByRole('button', { name: 'Not here' }).click();
    await expect(page.locator('.help')).toContainText('Seated leg curl is removed from City Gym Odenplan');
    await grp.getByRole('button', { name: 'Don’t want' }).click();
    await expect(page.getByRole('group', { name: 'Stop suggesting for' }).getByRole('button')).toHaveText(['Today', '2 weeks', 'Never']);
    await expect(page.locator('.help')).toContainText('paused for today');
    await page.getByRole('group', { name: 'Stop suggesting for' }).getByRole('button', { name: 'Never' }).click();
    await expect(page.locator('.help')).toContainText('banned');
    await grp.getByRole('button', { name: 'Taken' }).click();
    await expect(page.getByRole('group', { name: 'Stop suggesting for' })).toHaveCount(0);
  });

  test('Taken: swaps for this session only, carrying sets and rep target', async ({ page }) => {
    const sess = active(['seated_leg_curl', 'back_squat']);
    await seed(page, { sessions: [sess] });
    await page.goto('session/swap');
    const want = expectedFor(makeGym(), 'seated_leg_curl', ['seated_leg_curl', 'back_squat']);
    await rows(page).nth(1).click();
    await page.getByRole('button', { name: `Swap to ${want[1].exercise.name}` }).click();
    await expect(page).toHaveURL(/session\/live/);
    const st = await persisted(page, (x) => !!x.sessions['sess-live'].exercises[0].swappedFrom);
    const s = st.sessions['sess-live'];
    const cur = s.exercises[s.cursor];
    expect(cur.exerciseId).toBe(want[1].exercise.id);
    expect(cur.plannedSets).toBe(3);
    expect(cur.repTarget).toBeGreaterThanOrEqual(want[1].exercise.repMin);
    expect(cur.repTarget).toBeLessThanOrEqual(want[1].exercise.repMax);
    expect(cur.swappedFrom).toMatchObject({ exerciseId: 'seated_leg_curl', reason: 'busy' });
    expect(s.busyEquip).toContain('seated_leg_curl');
    expect(st.gyms[GYM_ID].equipment.seated_leg_curl).toBe('ok');
    expect(st.prefs.seated_leg_curl).toBeUndefined();
    expect(s.exercises).toHaveLength(2);
  });

  test('Not here: removes the equipment from the gym', async ({ page }) => {
    await seed(page, { sessions: [active(['seated_leg_curl'])] });
    await page.goto('session/swap');
    await page.getByRole('button', { name: 'Not here' }).click();
    await page.getByRole('button', { name: /^Swap to / }).click();
    await expect(page).toHaveURL(/session\/live/);
    const st = await persisted(page, (x) => !!x.sessions['sess-live'].exercises[0].swappedFrom);
    expect(st.gyms[GYM_ID].equipment.seated_leg_curl).toBeUndefined();
    expect(st.sessions['sess-live'].exercises[0].swappedFrom.reason).toBe('gone');
    expect(st.sessions['sess-live'].busyEquip).toEqual([]);
  });

  for (const [label, check] of [
    ['Today', (p: any, before: number) => { expect(p.pausedSessions).toBe(1); expect(p.avoid).toBe(false); }],
    ['2 weeks', (p: any, before: number) => { expect(p.pausedUntil).toBeGreaterThan(before + 13.9 * 86400000); expect(p.pausedUntil).toBeLessThan(Date.now() + 14.1 * 86400000); expect(p.avoid).toBe(false); }],
    ['Never', (p: any) => { expect(p.avoid).toBe(true); }],
  ] as const) {
    test(`Don't want / ${label}: writes the preference, leaves equipment alone`, async ({ page }) => {
      await seed(page, { sessions: [active(['seated_leg_curl'])] });
      await page.goto('session/swap');
      const before = Date.now();
      await page.getByRole('button', { name: 'Don’t want' }).click();
      await page.getByRole('group', { name: 'Stop suggesting for' }).getByRole('button', { name: label }).click();
      await page.getByRole('button', { name: /^Swap to / }).click();
      await expect(page).toHaveURL(/session\/live/);
      const st = await persisted(page, (x) => !!x.sessions['sess-live'].exercises[0].swappedFrom);
      check(st.prefs.seated_leg_curl, before);
      expect(st.gyms[GYM_ID].equipment.seated_leg_curl).toBe('ok');
      expect(st.sessions['sess-live'].busyEquip).toEqual([]);
      expect(st.sessions['sess-live'].exercises[0].swappedFrom.reason).toBe('dont');
    });
  }

  test('empty state: nothing fits shows NoAlternatives; Skip is recommended and advances', async ({ page }) => {
    const gym = gymWith(['seated_leg_curl']);
    // bodyweight exercises fit anywhere, so ban them to reach a real dead end
    await seed(page, { gyms: [gym], sessions: [active(['seated_leg_curl', 'back_squat'], gym)], prefs: banBodyweight() });
    expect(expectedFor(gym, 'seated_leg_curl', ['seated_leg_curl', 'back_squat', ...BODYWEIGHT_IDS])).toHaveLength(0);
    await page.goto('session/swap');
    await expect(page.getByRole('heading', { name: 'No good swap at City Gym Odenplan' })).toBeVisible();
    await expect(page.getByText('above a 35% match')).toBeVisible();
    const skip = page.getByRole('radio', { name: /Skip it today/ });
    await expect(skip).toHaveAttribute('aria-checked', 'true');
    await expect(skip).toContainText('Recommended');
    await expect(page.getByRole('radio', { name: /Pick any exercise/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /I actually have the equipment/ })).toBeVisible();
    await page.getByRole('button', { name: 'Skip Seated leg curl' }).click();
    await expect(page).toHaveURL(/session\/live/);
    const s = (await persisted(page, (x) => x.sessions['sess-live'].cursor === 1)).sessions['sess-live'];
    expect(s.exercises[0].status).toBe('skipped');
    expect(s.cursor).toBe(1);
  });

  test('Nothing fits link opens the no-alternative variant even when alternatives exist', async ({ page }) => {
    await seed(page, { sessions: [active(['seated_leg_curl'])] });
    await page.goto('session/swap');
    await page.getByRole('link', { name: 'Nothing fits' }).click();
    await expect(page).toHaveURL(/swap\?none=1/);
    await expect(page.getByRole('heading', { name: /No good swap at/ })).toBeVisible();
  });

  test('lower-match option below the 35% floor can be used', async ({ page }) => {
    const gym = gymWith([SEED_BY_ID.hack_squat.equipment[0], 'trap_bar']);
    const ex = ['hack_squat'];
    const excl = [...ex, ...BODYWEIGHT_IDS]; // bodyweight is banned in the app below, so it is out of the ranking too
    expect(expectedFor(gym, 'hack_squat', excl)).toHaveLength(0);
    const low = rankWithFloor(SEED_BY_ID.hack_squat, LIB, availableEquipment(gym), excl, {}, { floor: 1, below: 35, limit: 1 })[0];
    expect(low.match).toBeLessThan(35);
    await seed(page, { gyms: [gym], sessions: [active(ex, gym)], prefs: banBodyweight() });
    await page.goto('session/swap');
    const opt = page.getByRole('radio', { name: new RegExp(low.exercise.name) });
    await expect(opt).toContainText(`${low.match}%`);
    await opt.click();
    await page.getByRole('button', { name: `Use ${low.exercise.name}` }).click();
    await expect(page).toHaveURL(/session\/live/);
    const s = (await persisted(page, (x) => !!x.sessions['sess-live'].exercises[0].swappedFrom)).sessions['sess-live'];
    expect(s.exercises[0].exerciseId).toBe(low.exercise.id);
    expect(s.exercises[0].plannedSets).toBe(3);
    expect(s.exercises[0].swappedFrom.exerciseId).toBe('hack_squat');
  });

  test('lower-match option is absent when nothing is below the floor', async ({ page }) => {
    const gym = gymWith(['seated_leg_curl']);
    await seed(page, { gyms: [gym], sessions: [active(['seated_leg_curl'], gym)] });
    await page.goto('session/swap');
    await expect(page.getByRole('radio')).toHaveCount(3);
  });

  test('"I actually have the equipment" puts it back and clears busy', async ({ page }) => {
    const gym = makeGym({ equipment: {} });
    await seed(page, { gyms: [gym], sessions: [active(['seated_leg_curl'], gym, { busyEquip: ['seated_leg_curl'] })], prefs: banBodyweight() });
    await page.goto('session/swap');
    await page.getByRole('radio', { name: /I actually have the equipment/ }).click();
    await page.getByRole('button', { name: /Seated leg curl.*available and continue|Mark .* available and continue/ }).click();
    await expect(page).toHaveURL(/session\/live/);
    const st = await persisted(page, (x) => x.gyms[GYM_ID].equipment.seated_leg_curl === 'ok');
    expect(st.sessions['sess-live'].busyEquip).toEqual([]);
    expect(st.sessions['sess-live'].exercises[0].exerciseId).toBe('seated_leg_curl');
    expect(st.sessions['sess-live'].exercises[0].status).toBe('active');
  });

  test('"Pick any exercise" opens the library', async ({ page }) => {
    const gym = gymWith(['seated_leg_curl']);
    await seed(page, { gyms: [gym], sessions: [active(['seated_leg_curl'], gym)], prefs: banBodyweight() });
    await page.goto('session/swap');
    await page.getByRole('radio', { name: /Pick any exercise/ }).click();
    await page.getByRole('button', { name: 'Open library' }).click();
    await expect(page).toHaveURL(/library/);
  });

  test('close and browse links navigate', async ({ page }) => {
    await seed(page, { sessions: [active(['seated_leg_curl'])] });
    await page.goto('session/swap');
    await page.getByRole('link', { name: 'Browse all exercises' }).click();
    await expect(page).toHaveURL(/library/);
    await page.goto('session/swap');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/session\/live/);
    expect((await readState(page)).sessions['sess-live'].exercises[0].exerciseId).toBe('seated_leg_curl');
  });

  test('warm-up phase redirects to the warm-up', async ({ page }) => {
    await seed(page, { sessions: [active(['seated_leg_curl'], makeGym(), { phase: 'warmup' })] });
    await page.goto('session/swap');
    await expect(page).toHaveURL(/session\/warmup/);
  });

  for (const [w, h] of [[440, 956], [375, 667], [360, 740]] as const) {
    test(`no horizontal overflow at ${w}px (swap + no-alternatives)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, { sessions: [active(['seated_leg_curl'])] });
      await page.goto('session/swap');
      await page.getByRole('button', { name: 'Don’t want' }).click();
      await expect(rows(page).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.goto('session/swap?none=1');
      await expect(page.getByRole('heading', { name: /No good swap/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});
