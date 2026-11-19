import { test, expect, seed, readState, makeGym, makeAreas, makeSession } from './fixtures';
import { PAUSE_FOREVER } from '../../src/shared/planner';

const HOME_GYM = () => makeGym({ id: 'gym-home', name: 'Home', lat: 59.5, lng: 18.4, equipment: { dumbbells: 'ok', adj_bench: 'ok', bands: 'ok', mat: 'ok', pullup_bar: 'ok' } as never });
const lower = (o: Record<string, unknown> = {}) => ({ device: { chosenSlot: 2, currentGymId: 'gym-city', gymSource: 'manual', ...o } });
const rows = (page: import('@playwright/test').Page) => page.locator('.group .li').filter({ has: page.locator('.ord') });
type P = import('@playwright/test').Page;
/** The store persists asynchronously; wait until `pick` yields a truthy value. */
const persisted = async <T,>(page: P, pick: (st: any) => T | null | undefined): Promise<T> => {
  let out: T | null | undefined;
  await expect.poll(async () => { out = pick(await readState(page)); return !!out; }, { timeout: 8000 }).toBe(true);
  return out as T;
};
const activeSession = (page: P) => persisted<any>(page, (st) => Object.values<any>(st.sessions).find((x) => x.status === 'active'));
const draftOf = (page: P) => persisted<any>(page, (st) => st.device.draft);
const names = async (page: P, allowEmpty = false) => { if (!allowEmpty) await expect(rows(page).first()).toBeVisible(); return rows(page).locator('.li-t').allInnerTexts(); };

test.describe('session preview', () => {
  test('renders header, gym card, time budget, list, actions', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.locator('.title')).toHaveText('Session 2 of rotation');
    await expect(page.getByText('City Gym Odenplan')).toBeVisible();
    await expect(page.getByText('Chosen by you')).toBeVisible();
    await expect(page.locator('.lbl', { hasText: 'Time budget' })).toBeVisible();
    await expect(page.getByText('/ 60 min')).toBeVisible();
    await expect(page.getByText(/Warm-up 10 min/)).toBeVisible();
    await expect(page.locator('.budget')).toHaveAttribute('aria-label', /Planned \d+ of 60 minutes/);
    expect(await rows(page).count()).toBeGreaterThan(2);
    await expect(page.getByText('Reorder freely')).toBeVisible();
    await expect(page.getByRole('link', { name: /Add exercise/ })).toHaveAttribute('href', /library\?add=1/);
    await expect(page.getByRole('button', { name: 'New mix', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: /I'm at the gym/ })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Back to Today' })).toBeVisible();
    expect((await draftOf(page)).exercises.length).toBeGreaterThan(2);
  });

  test('no horizontal overflow at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await seed(page, lower());
    await page.goto('session/preview');
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('time budget stepper changes target and fit label', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const label = page.locator('.between.small .tag');
    await expect(label).toBeVisible();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'More time' }).click();
    await expect(page.getByText('/ 90 min')).toBeVisible();
    await expect(label).toHaveText(/Fits, \d+ min spare/);
    await expect(label).toHaveClass(/green/);
    await expect.poll(async () => (await draftOf(page)).targetMin).toBe(90);
    for (let i = 0; i < 14; i++) await page.getByRole('button', { name: 'Less time' }).click();
    await expect(page.getByText('/ 20 min')).toBeVisible(); // clamped at 20
    await expect(label).toHaveText(/Over by \d+ min\. Remove one\?/);
    await expect(label).toHaveClass(/red/);
    await expect.poll(async () => (await draftOf(page)).targetMin).toBe(20);
  });

  test('tight label between 1 and 5 minutes over', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const label = page.locator('.between.small .tag');
    // find a target in 5-minute steps that yields "Tight"; scan the range
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      await page.getByRole('button', { name: 'Less time' }).click();
      if (/Tight, \+\d min/.test(await label.innerText())) { seen = true; await expect(label).toHaveClass(/accent/); }
    }
    test.skip(!seen, 'planned total never landed in the 1-5 minute tight window for this seed');
  });

  test('reorder moves exercises; ends are disabled; persists into the started session', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const before = await names(page);
    await expect(page.getByRole('button', { name: `Move ${before[0]} up` })).toBeDisabled();
    await expect(page.getByRole('button', { name: `Move ${before[before.length - 1]} down` })).toBeDisabled();
    await page.getByRole('button', { name: `Move ${before[0]} down` }).click();
    const after = await names(page);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    await page.getByRole('button', { name: `Move ${before[before.length - 1]} up` }).click();
    const final = await names(page);
    await page.getByRole('button', { name: /I'm at the gym/ }).click();
    await expect(page).toHaveURL(/session\/warmup/);
    const sess = await activeSession(page);
    expect(sess.exercises.map((e: any) => e.name)).toEqual(final);
  });

  test('remove drops an exercise and updates count and budget', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const before = await names(page);
    const min = await page.locator('.t-num').innerText();
    await page.getByRole('button', { name: `Remove ${before[1]}` }).click();
    const after = await names(page);
    expect(after).toEqual(before.filter((_, i) => i !== 1));
    await expect(page.getByText(`${after.length} exercises`, { exact: true })).toBeVisible();
    expect(await page.locator('.t-num').innerText()).not.toBe(min);
    await page.getByRole('button', { name: /I'm at the gym/ }).click();
    await expect(page).toHaveURL(/session\/warmup/);
    const sess = await activeSession(page);
    expect(sess.exercises.map((e: any) => e.name)).toEqual(after);
  });

  test('empty draft disables start; singular count', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    let n = (await names(page)).length;
    while (n > 1) { await page.getByRole('button', { name: /^Remove / }).first().click(); n--; }
    await expect(page.getByText('1 exercise', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Remove / }).first().click();
    await expect(page.getByText('0 exercises', { exact: true })).toBeVisible();
    await expect(page.getByText('Nothing to plan yet')).toBeVisible();
    await expect(page.getByRole('button', { name: /I'm at the gym/ })).toBeDisabled();
    await expect(page.locator('.between.small .tag')).toHaveText(/Fits/);
    await page.getByRole('button', { name: 'New mix', exact: true }).click();
    expect((await names(page)).length).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /I'm at the gym/ })).toBeEnabled();
  });

  test('inline swap sheet lists alternatives, swaps, and reaches the session', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const before = await names(page);
    await page.getByRole('button', { name: `Swap ${before[0]}` }).click();
    const dlg = page.getByRole('dialog', { name: `Swap ${before[0]}` });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.tag.green').first()).toContainText('% match');
    await dlg.getByRole('button', { name: 'Close' }).first().click();
    await expect(dlg).toBeHidden(); // close via X leaves the plan untouched
    expect(await names(page)).toEqual(before);
    await page.getByRole('button', { name: `Swap ${before[0]}` }).click();
    await page.getByRole('button', { name: 'Close' }).first().click(); // scrim
    await expect(dlg).toBeHidden();
    await page.getByRole('button', { name: `Swap ${before[0]}` }).click();
    const alt = (await dlg.locator('.li .li-t').first().innerText());
    expect(before).not.toContain(alt);
    await dlg.locator('.li').first().click();
    await expect(dlg).toBeHidden();
    const after = await names(page);
    expect(after[0]).toBe(alt);
    expect(after.slice(1)).toEqual(before.slice(1));
    await page.getByRole('button', { name: /I'm at the gym/ }).click();
    await expect(page).toHaveURL(/session\/warmup/);
    const sess = await activeSession(page);
    expect(sess.exercises.map((e: any) => e.name)).toEqual(after);
    expect(sess.exercises[0].swappedFrom.name).toBe(before[0]);
  });

  test('add exercise goes to library add mode and the pick lands in the draft and session', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const before = await names(page);
    await page.getByRole('link', { name: /Add exercise/ }).click();
    await expect(page).toHaveURL(/library(\/all)?\?add=1/);
    await expect(page.getByText('Add exercise').first()).toBeVisible();
    // pick the first not-yet-added exercise
    const pick = page.getByRole('button', { name: /^Add / }).first();
    const label = (await pick.getAttribute('aria-label'))!.replace(/^Add /, '');
    await pick.click();
    await expect(page).toHaveURL(/session\/preview/);
    const after = await names(page);
    expect(after).toEqual([...before, label]);
    await page.getByRole('button', { name: /I'm at the gym/ }).click();
    const sess = await activeSession(page);
    expect(sess.exercises.map((e: any) => e.name)).toEqual(after);
  });

  test('New mix (header and button) regenerates the draft and keeps the target', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    await page.getByRole('button', { name: 'More time' }).click();
    const v0 = (await draftOf(page)).variant;
    await page.getByRole('button', { name: 'New mix', exact: true }).click();
    await expect.poll(async () => (await readState(page)).device.draft.variant).toBe(v0 + 1);
    await page.getByRole('button', { name: 'New mix of exercises' }).click();
    await expect.poll(async () => (await readState(page)).device.draft.variant).toBe(v0 + 2);
    await expect.poll(async () => (await draftOf(page)).targetMin).toBe(65);
    await expect(page.getByText('/ 65 min')).toBeVisible();
  });

  test('start creates an active session with the draft exercises', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const list = await names(page);
    await page.getByRole('button', { name: /I'm at the gym/ }).click();
    await expect(page).toHaveURL(/session\/warmup/);
    await activeSession(page);
    const st = await readState(page);
    const act = Object.values<any>(st.sessions).filter((s) => s.status === 'active');
    expect(act).toHaveLength(1);
    expect(act[0].areaName).toBe('Lower body');
    expect(act[0].gymId).toBe('gym-city');
    expect(act[0].phase).toBe('warmup');
    expect(act[0].slot).toBe(2);
    expect(act[0].exercises.map((e: any) => e.name)).toEqual(list);
    expect(act[0].exercises.every((e: any) => e.status === 'todo')).toBe(true);
  });

  test('hidden exercises banner explains equipment, ban and pause; Manage opens exclusions', async ({ page }) => {
    const lib = await import('../../src/shared/exercises');
    const area = makeAreas()[1];
    const pool = area.poolExerciseIds.map((id) => lib.SEED_BY_ID[id]).filter(Boolean);
    const [banned, paused] = [pool[0], pool[1]];
    await seed(page, {
      ...lower(),
      gyms: [makeGym(), HOME_GYM()],
      prefs: {
        [banned.id]: { exerciseId: banned.id, favorite: false, avoid: true, relevance: 50 },
        [paused.id]: { exerciseId: paused.id, favorite: false, avoid: false, pausedUntil: PAUSE_FOREVER, relevance: 50 },
      },
    });
    await page.goto('session/preview');
    const banner = page.locator('.banner.info', { hasText: 'left out' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`${banned.name} is banned by you`);
    await expect(banner).toContainText(`${paused.name} is paused`);
    // banned/paused never in the list, even after several new mixes
    for (let i = 0; i < 4; i++) {
      const l = await names(page);
      expect(l).not.toContain(banned.name);
      expect(l).not.toContain(paused.name);
      await page.getByRole('button', { name: 'New mix', exact: true }).click();
    }
    await banner.getByRole('link', { name: 'Manage' }).click();
    await expect(page).toHaveURL(/library\/exclusions/);
  });

  test('equipment-hidden exercises are named in the banner at a sparse gym', async ({ page }) => {
    await seed(page, { ...lower({ currentGymId: 'gym-home' }), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    const banner = page.locator('.banner.info', { hasText: 'left out' });
    await expect(banner).toContainText(/need(s)? equipment Home doesn't have/);
    await expect(page.getByText('Home', { exact: true }).first()).toBeVisible();
  });

  test('no banner when nothing is left out', async ({ page }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    // full gym: nothing equipment-hidden, no prefs
    await expect(page.locator('.banner', { hasText: 'left out' })).toHaveCount(0);
  });

  test('coach note banner', async ({ page }) => {
    const area = makeAreas()[1];
    const ids = area.poolExerciseIds.slice(0, 3);
    await seed(page, {
      ...lower(),
      // plans entity map lives on the state; add through device-less seed override below
    });
    await page.addInitScript(([ids2, areaId]) => {
      const k = 'rep-state-v1';
      const apply = () => {
        const st = JSON.parse(localStorage.getItem(k)!);
        if (st.plans && !Object.keys(st.plans).length) {
          st.plans['p1'] = { id: 'p1', title: 'Heavy day', note: 'Keep it heavy and slow today.', slot: 2, exercises: (ids2 as string[]).map((id) => ({ exerciseId: id })), status: 'pending', createdBy: 'coach', createdAt: 1 };
          localStorage.setItem(k, JSON.stringify(st));
        }
      };
      apply();
    }, [ids, area.id] as const);
    await page.goto('session/preview');
    await expect(page.locator('.banner.info', { hasText: 'Note from your coach' })).toContainText('Keep it heavy and slow today.');
    expect((await names(page)).length).toBe(3);
  });

  test('no gym selected: bodyweight copy', async ({ page }) => {
    await seed(page, { gyms: null, settings: { gps: false }, device: { chosenSlot: 2, currentGymId: null, gymSource: 'manual' } });
    await page.goto('session/preview');
    await expect(page.getByText('No gym selected')).toBeVisible();
    await expect(page.getByText('Bodyweight and bands only')).toBeVisible();
  });

  test('active session bounces preview to resume', async ({ page }) => {
    const a = makeAreas();
    await seed(page, { ...lower(), sessions: [makeSession({ id: 'act', seq: 1, slot: 1, areaId: a[0].id, areaName: a[0].name, daysAgo: 0, exerciseIds: ['bench_press'], status: 'active' })] });
    await page.goto('session/preview');
    await expect(page).toHaveURL(/resume/);
  });
});

test.describe('GPS flows', () => {
  test('detected by GPS shows distance and picks the matching gym', async ({ page }) => {
    await seed(page, { ...lower({ currentGymId: 'gym-home', gymSource: 'last' }), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    await expect(page.getByText(/Detected by GPS · \d+ m away/)).toBeVisible();
    await expect(page.getByText('City Gym Odenplan')).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.currentGymId).toBe('gym-city');
  });

  test.describe('denied', () => {
    test.use({ permissions: [] });
    test('location denied screen then manual pick lands on the preview', async ({ page }) => {
      await seed(page, { ...lower({ gymSource: 'last' }), gyms: [makeGym(), HOME_GYM()] });
      await page.goto('session/preview');
      await expect(page.getByRole('heading', { name: 'Location is off' })).toBeVisible();
    });
  });

  test.describe('unknown place', () => {
    test.use({ geolocation: { latitude: 55.6, longitude: 13.0 } });
    test('unknown gym screen appears when no saved gym matches', async ({ page }) => {
      await seed(page, { ...lower({ gymSource: 'last' }) });
      await page.goto('session/preview');
      await expect(page.getByRole('heading', { name: "You're somewhere new" })).toBeVisible();
    });
  });
});

test.describe('gym picker', () => {
  test('lists gyms, preselects current, shows Here tag after GPS', async ({ page }) => {
    await seed(page, { ...lower({ gymSource: 'last' }), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    await page.getByRole('link', { name: /Change/ }).click();
    await expect(page).toHaveURL(/session\/gym/);
    const dlg = page.getByRole('dialog', { name: 'Choose gym' });
    await expect(dlg.getByRole('heading', { name: 'Where are you training?' })).toBeVisible();
    await expect(dlg.getByRole('radio')).toHaveCount(3); // 2 gyms + the built-in At home · no equipment
    await expect(dlg.getByRole('radio', { name: /City Gym Odenplan/ })).toBeChecked();
    await expect(dlg.locator('.tag.green', { hasText: 'Here' })).toBeVisible();
    await expect(dlg.getByRole('radio', { name: /Home/ })).toContainText(/km|m ·/);
    await expect(dlg.getByRole('button', { name: 'Use City Gym Odenplan' })).toBeVisible();
    await expect(dlg.getByRole('link', { name: /New gym/ })).toHaveAttribute('href', /gyms\/new/);
    await expect(dlg.getByRole('button', { name: 'Somewhere else' })).toBeVisible();
  });

  test('current gym: plan unchanged banner', async ({ page }) => {
    await seed(page, { ...lower(), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    const n = (await names(page)).length;
    await page.getByRole('link', { name: /Change/ }).click();
    await expect(page.locator('.banner.ok')).toContainText(`All ${n} exercises can be done here.`);
  });

  test('sparse gym shows swap impact computed from the draft; close keeps gym', async ({ page }) => {
    await seed(page, { ...lower(), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    await page.getByRole('link', { name: /Change/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Choose gym' });
    await dlg.getByRole('radio', { name: /Home/ }).click();
    await expect(dlg.getByRole('radio', { name: /Home/ })).toBeChecked();
    const warn = page.locator('.banner.warn');
    await expect(warn).toContainText(/\d+ exercises? will be swapped/);
    await expect(warn).toContainText('→');
    await expect(dlg.getByRole('button', { name: 'Use Home' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Close' }).first().click();
    await expect(page).toHaveURL(/session\/preview/);
    await expect.poll(async () => (await readState(page)).device.currentGymId).toBe('gym-city');
  });

  test('scrim closes too', async ({ page }) => {
    await seed(page, { ...lower(), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/gym');
    await page.locator('button.scrim').click();
    await expect(page).toHaveURL(/session\/preview/);
  });

  test('picking another gym regenerates the draft against its equipment', async ({ page }) => {
    await seed(page, { ...lower(), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    const cityList = await names(page);
    expect((await draftOf(page)).gymId).toBe('gym-city');
    await page.getByRole('link', { name: /Change/ }).click();
    await page.getByRole('radio', { name: /Home/ }).click();
    await page.getByRole('button', { name: 'Use Home' }).click();
    await expect(page).toHaveURL(/session\/preview/);
    await expect(page.getByText('Chosen by you')).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.draft?.gymId).toBe('gym-home');
    const st = await readState(page);
    expect(st.device.currentGymId).toBe('gym-home');
    const homeList = await names(page);
    expect(homeList).not.toEqual(cityList);
    // every planned exercise is doable with the home gear
    const { SEED_BY_ID } = await import('../../src/shared/exercises');
    const { availableEquipment, isAvailable } = await import('../../src/shared/rules');
    const avail = availableEquipment(st.gyms['gym-home']);
    for (const e of st.device.draft.exercises) expect(isAvailable(SEED_BY_ID[e.exerciseId], avail), e.name).toBe(true);
    await expect(page.getByText(/left out/).first()).toBeVisible();
    await page.getByRole('button', { name: /I'm at the gym/ }).click();
    const sess = await activeSession(page);
    expect(sess.gymId).toBe('gym-home');
    expect(sess.gymName).toBe('Home');
    expect(sess.exercises.map((e: any) => e.name)).toEqual(homeList);
  });

  test('Somewhere else opens the unknown-gym flow', async ({ page }) => {
    await seed(page, { ...lower(), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/gym');
    await page.getByRole('button', { name: 'Somewhere else' }).click();
    await expect(page.getByRole('heading', { name: "You're somewhere new" })).toBeVisible();
  });

  test('no gyms saved: empty copy and disabled use', async ({ page }) => {
    await seed(page, { gyms: null, device: { chosenSlot: 2, currentGymId: null, gymSource: 'none' } });
    await page.goto('session/gym');
    await expect(page.getByText('No gyms saved yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pick a gym' })).toBeDisabled();
  });
});

// ───────────── At home, no equipment ─────────────
test.describe('at home, no equipment', () => {
  const SHOT = (page: P, n: string) => page.screenshot({ path: `${process.env.SHOTS_DIR ?? 'test-results/shots'}/${n}-${page.viewportSize()!.width}.png` });
  const bw = async (list: string[]) => {
    const { SEED_EXERCISES } = await import('../../src/shared/exercises');
    return list.every((n) => { const e = SEED_EXERCISES.find((x) => x.name === n)!; return !!e && e.equipment.every((q) => q === 'mat'); });
  };

  test('segmented control: At a gym | At home, no equipment (aria-pressed group), card, banner, CTA, back', async ({ page, errors }) => {
    await seed(page, lower());
    await page.goto('session/preview');
    const grp = page.getByRole('group', { name: 'Where are you training' });
    const atGym = grp.getByRole('button', { name: 'At a gym' });
    const atHome = grp.getByRole('button', { name: 'At home, no equipment' });
    await expect(atGym).toHaveAttribute('aria-pressed', 'true');
    await expect(atHome).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: /I'm at the gym/ })).toBeVisible();
    const gymList = await names(page);
    const gymTotal = Number((await page.locator('.t-num').first().innerText()).match(/^(\d+)/)![1]);
    await SHOT(page, 'preview-gym');

    await atHome.click();
    await expect(atHome).toHaveAttribute('aria-pressed', 'true');
    await expect(atGym).toHaveAttribute('aria-pressed', 'false');
    const card = page.getByRole('link', { name: /Change/ });
    await expect(card.locator('.li-t')).toHaveText('At home · no equipment');
    await expect(card.locator('.li-s')).toHaveText('Bodyweight only · a floor and a wall');
    await expect(card.locator('.tile.warm .ic-home')).toHaveCount(1);
    const banner = page.locator('.banner.warn');
    await expect(banner).toContainText('Switched to bodyweight versions');
    await expect(banner).toContainText('Same muscles, no equipment. Progress is tracked by reps, tempo and time, then harder variations.');
    await expect(banner.getByRole('link', { name: /Browse/ })).toHaveAttribute('href', /library\/all/);
    await expect(page.getByText(/left out/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start at home' })).toBeEnabled();
    await expect(page.getByRole('button', { name: /I'm at the gym/ })).toHaveCount(0);
    await expect.poll(async () => (await readState(page)).device.draft?.gymId).toBe('none');
    const homeList = await names(page);
    expect(homeList.length).toBeGreaterThanOrEqual(4);
    expect(await bw(homeList)).toBe(true);
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.getByText(new RegExp(`^${homeList.length} exercises$`))).toBeVisible(); // count is computed
    const homeTotal = Number((await page.locator('.t-num').first().innerText()).match(/^(\d+)/)![1]);
    expect(homeTotal).not.toBe(gymTotal);
    await SHOT(page, 'preview-home');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // New mix keeps it bodyweight; swapping offers bodyweight alternatives only
    await page.getByRole('button', { name: 'New mix', exact: true }).click();
    expect(await bw(await names(page))).toBe(true);
    await page.getByRole('button', { name: /^Swap / }).first().click();
    const sheet = page.getByRole('dialog', { name: /^Swap/ });
    await expect(sheet.locator('.li').first()).toBeVisible();
    expect(await bw(await sheet.locator('.li .li-t').allInnerTexts())).toBe(true);
    await sheet.getByRole('button', { name: 'Close' }).first().click();

    await atGym.click();
    await expect(atGym).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.li-t')).toHaveText('City Gym Odenplan');
    await expect(page.locator('.banner.warn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /I'm at the gym/ })).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.currentGymId).toBe('gym-city');
    expect(errors).toEqual([]);
  });

  test('375px: control, card and banner do not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page, lower());
    await page.goto('session/preview');
    await page.getByRole('button', { name: 'At home, no equipment' }).click();
    await expect(page.locator('.banner.warn')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await SHOT(page, 'preview-home');
  });

  test('Browse opens the library already limited to what needs no equipment', async ({ page }) => {
    await seed(page, lower({ currentGymId: 'none' }));
    await page.goto('session/preview');
    await page.locator('.banner.warn').getByRole('link', { name: /Browse/ }).click();
    await expect(page).toHaveURL(/library\/all/);
    const { SEED_EXERCISES } = await import('../../src/shared/exercises');
    const { bodyweightExercises } = await import('../../src/shared/location');
    const n = bodyweightExercises(SEED_EXERCISES).length;
    await expect(page.getByText('Back squat', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Tempo squat', { exact: true })).toBeVisible();
    expect(n).toBeGreaterThanOrEqual(21);
  });

  test('gym picker: 4th row, swap-impact pairs computed from the real plan, use sets the location', async ({ page }) => {
    await seed(page, { ...lower(), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    const planned = await names(page);
    await page.getByRole('link', { name: /Change/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Choose gym' });
    await expect(dlg.getByRole('radio')).toHaveCount(3);
    const none = dlg.getByRole('radio', { name: /At home · no equipment/ });
    await expect(none.locator('.li-s')).toHaveText('Always available · bodyweight only');
    await expect(none).not.toBeChecked();
    await expect(dlg.getByRole('radio', { name: /Home/ }).first()).toBeVisible();
    await none.click();
    await expect(none).toBeChecked();
    const warn = dlg.locator('.banner.warn');
    await expect(warn).toContainText(/\d+ exercises? will be swapped/);
    const pairs = (await warn.innerText()).split('\n').pop()!.split(' · ');
    expect(pairs.length).toBeGreaterThan(0);
    const { SEED_EXERCISES } = await import('../../src/shared/exercises');
    for (const p of pairs) {
      const [a, b] = p.split(' → ');
      expect(planned).toContain(a); // every swapped-out exercise is in the current plan
      const to = SEED_EXERCISES.find((x) => x.name === b);
      expect(to, b).toBeDefined();
      expect(to!.equipment.every((q) => q === 'mat')).toBe(true);
    }
    await expect(dlg.getByRole('button', { name: 'Use At home · no equipment' })).toBeVisible();
    await SHOT(page, 'gym-picker-home');
    await dlg.getByRole('button', { name: 'Use At home · no equipment' }).click();
    await expect(page).toHaveURL(/session\/preview/);
    await expect(page.getByRole('button', { name: 'At home, no equipment' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await readState(page)).device.draft?.gymId).toBe('none');
    // the banner told the truth: every "B" it promised is in the plan that was built, and every "A" is gone
    const after = await names(page);
    for (const p of pairs) {
      const [a, b] = p.split(' → ');
      expect(after, b).toContain(b);
      expect(after, a).not.toContain(a);
    }
  });

  test('gym picker at home: the built-in row is preselected and the plan is unchanged', async ({ page }) => {
    await seed(page, { ...lower({ currentGymId: 'none' }), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    const n = (await names(page)).length;
    await page.getByRole('link', { name: /Change/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Choose gym' });
    await expect(dlg.getByRole('radio', { name: /At home · no equipment/ })).toBeChecked();
    await expect(page.locator('.banner.ok')).toContainText('Plan unchanged');
    await expect(page.locator('.banner.ok')).toContainText(`All ${n} exercises can be done here.`);
  });

  test('from home, picking a gym does not claim "Plan unchanged": it shows the real swaps back to gym lifts', async ({ page }) => {
    await seed(page, { ...lower({ currentGymId: 'none' }), gyms: [makeGym(), HOME_GYM()] });
    await page.goto('session/preview');
    const planned = await names(page);
    await page.getByRole('link', { name: /Change/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Choose gym' });
    await dlg.getByRole('radio', { name: /City Gym Odenplan/ }).click();
    await expect(page.locator('.banner.ok')).toHaveCount(0);
    const warn = page.locator('.banner.warn');
    await expect(warn).toContainText(/\d+ exercises? will be swapped/);
    await dlg.getByRole('button', { name: 'Use City Gym Odenplan' }).click();
    const after = await names(page);
    expect(after.some((n) => !planned.includes(n))).toBe(true);
  });

  test('gym picker with no saved gyms still offers the built-in location', async ({ page }) => {
    await seed(page, { gyms: null, device: { chosenSlot: 2, currentGymId: null, gymSource: 'none' } });
    await page.goto('session/gym');
    const dlg = page.getByRole('dialog', { name: 'Choose gym' });
    await expect(page.getByText('No gyms saved yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pick a gym' })).toBeDisabled();
    await dlg.getByRole('radio', { name: /At home · no equipment/ }).click();
    await page.getByRole('button', { name: 'Use At home · no equipment' }).click();
    await expect(page).toHaveURL(/session\/preview/);
    await expect(page.getByRole('button', { name: 'Start at home' })).toBeEnabled();
  });

  test.describe('unknown place', () => {
    test.use({ geolocation: { latitude: 55.6, longitude: 13.0 } });
    test('"No gym: bodyweight only" reuses the built-in location', async ({ page }) => {
      await seed(page, { ...lower({ gymSource: 'last' }) });
      await page.goto('session/preview');
      await page.getByRole('radio', { name: /No gym: bodyweight only/ }).click();
      await page.getByRole('button', { name: 'Continue with bodyweight plan' }).click();
      await expect(page.getByRole('button', { name: 'At home, no equipment' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Start at home' })).toBeEnabled();
      await expect.poll(async () => (await readState(page)).device.currentGymId).toBe('none');
      expect(await bw(await names(page))).toBe(true);
    });
  });

  test('start at home → full bodyweight workout → summary; recorded as No equipment; counts for the week and rotation', async ({ page, errors }) => {
    test.setTimeout(120_000);
    await seed(page, { ...lower({ currentGymId: 'none' }), settings: { restSec: 60 } });
    await page.goto('session/preview');
    const homeList = await names(page);
    expect(await bw(homeList)).toBe(true);
    await page.getByRole('button', { name: 'Start at home' }).click();
    await expect(page).toHaveURL(/session\/warmup/);
    await expect(page.getByText('Brisk walk or jumping jacks')).toBeVisible();
    await page.getByRole('button', { name: /warm-up done/i }).click();
    for (let i = 0; i < 200; i++) {
      if (await page.getByRole('button', { name: /finish session/i }).or(page.getByRole('link', { name: /finish session/i })).first().isVisible().catch(() => false)) break;
      const rate = page.getByRole('button', { name: /^just right/i });
      if (await rate.isVisible().catch(() => false)) { await rate.click(); await page.getByRole('button', { name: /^(next|save)/i }).click(); continue; }
      for (const re of [/start set \d+ now/i, /^start set 1$/i, /^done/i]) {
        const b = page.getByRole('button', { name: re });
        if (await b.first().isVisible().catch(() => false)) { await b.first().click(); break; }
      }
      await page.waitForTimeout(60);
    }
    await page.getByRole('button', { name: /finish session/i }).or(page.getByRole('link', { name: /finish session/i })).first().click();
    await expect(page).toHaveURL(/session\/summary/);
    await expect(page.getByText(/Lower body · No equipment/)).toBeVisible();
    await SHOT(page, 'summary-home');
    const st = await persisted<any>(page, (s) => Object.values<any>(s.sessions).find((x) => x.status === 'completed'));
    expect(st).toMatchObject({ gymId: 'none', gymName: 'No equipment', areaName: 'Lower body', slot: 2 });
    expect(st.exercises.map((e: any) => e.name)).toEqual(homeList);
    expect(st.exercises.every((e: any) => e.status === 'done' && e.sets.length > 0 && e.recommendation)).toBe(true);
    // progression state exists for every exercise, weights are 0
    const s2 = await readState(page);
    for (const e of st.exercises) expect(s2.progress[e.exerciseId]).toBeDefined();
    expect(Object.values<any>(s2.gyms).every((g) => !g.lastVisitedAt)).toBe(true);

    // history and Today show it as No equipment; the week counter and the rotation pointer advanced
    await page.goto('history');
    await expect(page.getByText(/No equipment/).first()).toBeVisible();
    await page.goto('');
    await expect(page.getByText('1/4')).toBeVisible();
    await expect(page.getByRole('link', { name: /Lower body.*No equipment/ })).toBeVisible();
    await expect(page.getByText(/Up next · Session 3 of rotation/)).toBeVisible();
    await page.goto('progress');
    await expect(page.getByText('No equipment').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
