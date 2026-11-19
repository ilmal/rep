import { test, expect, seed, makeSession, makeAreas, makeGym, readState, GYM_ID, type SeedOpts } from './fixtures';
import { templateCount } from '../../src/shared/catalog';
import type { Page } from '@playwright/test';
import type { Session } from '../../src/shared/types';

const SHOTS = (process.env.SHOTS_DIR ?? 'test-results/shots');
const areas = makeAreas();
const EX = ['bench_press', 'seated_row', 'ohp'];
// Local-time anchors: Mon 16 Nov 2026 is ISO week 47.
const at = (d: number, h = 18, m = 0, mo = 10) => new Date(2026, mo, d, h, m).getTime();

/** A completed session ending exactly at `endMs` (all inner timestamps shifted). */
function placed(slot: number, endMs: number, o: { minutes?: number; weight?: number; warmMin?: number; ids?: string[] } = {}): Session {
  const s = makeSession({ id: `s-${slot}-${endMs}`, seq: slot, slot, areaId: areas[slot - 1].id, areaName: areas[slot - 1].name, daysAgo: 0, exerciseIds: o.ids ?? EX, minutes: o.minutes, weight: o.weight });
  const delta = endMs - s.endedAt!;
  const sh = (x?: number) => (x == null ? x : x + delta);
  const out: Session = { ...s, startedAt: s.startedAt + delta, warmupStartedAt: s.startedAt + delta, endedAt: endMs, updatedAt: endMs,
    exercises: s.exercises.map((e) => ({ ...e, startedAt: sh(e.startedAt), endedAt: sh(e.endedAt), sets: e.sets.map((x) => ({ ...x, doneAt: x.doneAt + delta })) })) };
  out.warmupEndedAt = out.warmupStartedAt! + (o.warmMin ?? 9) * 60000;
  return out;
}
const week47 = (n: number) => [placed(1, at(16)), placed(2, at(17, 9)), placed(3, at(19)), placed(4, at(20)), placed(1, at(20, 20))].slice(0, n);

async function setup(page: Page, now: number | null, o: SeedOpts = {}, plans?: unknown[]) {
  if (now != null) await page.clock.install({ time: new Date(now) });
  await seed(page, o);
  if (plans) await page.addInitScript((p) => { const st = JSON.parse(localStorage.getItem('rep-state-v1')!); st.plans = Object.fromEntries((p as any[]).map((x) => [x.id, x])); localStorage.setItem('rep-state-v1', JSON.stringify(st)); }, plans);
  await page.goto('');
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png` });
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
const dayCell = (page: Page, n: number) => page.getByRole('listitem', { name: new RegExp(`^${n}(,|$)`) });

test.describe('first home (0 sessions)', () => {
  test('welcome, calibration steps, nudges and start', async ({ page, errors }) => {
    await setup(page, at(17, 10));
    await expect(page.getByRole('heading', { name: 'Welcome, Alex' })).toBeVisible();
    await expect(page.getByText('Tuesday, 17 November')).toBeVisible();
    await expect(page.getByText('Week 47 · your first week')).toBeVisible();
    await expect(page.getByText('0/4')).toBeVisible();
    await expect(page.getByText('4 sessions, any days')).toBeVisible();
    await expect(page.getByText('Even 2 this week is a good start.')).toBeVisible();
    await expect(page.getByText('Your first session')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upper body' })).toBeVisible();
    await expect(page.getByText('Weights are starting guesses. Pick what feels right on set 1.')).toBeVisible();
    await expect(page.getByText('Rate each exercise when you finish it. Three quick taps.')).toBeVisible();
    await expect(page.getByText('After about 3 sessions, weights and timing fit you.')).toBeVisible();
    await expect(page.getByText('City Gym Odenplan').first()).toBeVisible();
    await expect(page.getByText(/≈ \d+ min · \d+ exercises?/)).toBeVisible();
    await expect(page.getByText(/guilt|behind|missed/i)).toHaveCount(0);
    await expect(page.getByText(`Template: full gym · ${templateCount('full')} items`)).toBeVisible();
    await expect(page.getByText('Do a different session')).toHaveCount(0);
    await shot(page, 'first-home'); await noOverflow(page);
    await page.setViewportSize({ width: 375, height: 667 }); await shot(page, 'first-home'); await noOverflow(page);
    await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(page);
    const start = page.getByRole('button', { name: /See today's plan/ });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    expect(errors).toEqual([]);
  });

  test('nudges link to library and the gym; avatar opens settings', async ({ page }) => {
    await setup(page, at(17, 10));
    await page.getByRole('link', { name: /Make it yours/ }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.goBack();
    await page.getByRole('link', { name: /Check City Gym Odenplan's equipment/ }).click();
    await expect(page).toHaveURL(new RegExp(`/gyms/${GYM_ID}$`));
    await page.goBack();
    await page.getByRole('link', { name: 'Profile and settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('no gym: asks for one and links to gyms list', async ({ page }) => {
    await setup(page, at(17, 10), { gyms: null });
    await page.getByRole('link', { name: 'Choose a gym' }).click();
    await expect(page).toHaveURL(/\/session\/gym$/);
    await page.goBack();
    await page.getByRole('link', { name: /Add your gym/ }).click();
    await expect(page).toHaveURL(/\/gyms$/);
  });

  test('custom equipment label and no name', async ({ page }) => {
    await setup(page, at(17, 10), { name: '', gyms: [makeGym({ equipment: { barbell: 'ok', dumbbells: 'ok', flat_bench: 'ok', squat_rack: 'ok', plates: 'ok' } })] });
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(page.getByText('Custom equipment · 5 items')).toBeVisible();
  });

  test('empty rotation shows no-plan card', async ({ page, errors }) => {
    await setup(page, at(17, 10), { areas: [] });
    await expect(page.getByText('No sessions planned')).toBeVisible();
    await page.getByRole('link', { name: 'Open plan' }).click();
    await expect(page).toHaveURL(/\/plan$/);
    expect(errors).toEqual([]);
  });

  test('a discarded session does not end the first-week state', async ({ page }) => {
    const d = { ...placed(1, at(16)), status: 'discarded' as const };
    await setup(page, at(17, 10), { sessions: [d] });
    await expect(page.getByRole('heading', { name: 'Welcome, Alex' })).toBeVisible();
  });
});

test.describe('normal today', () => {
  test('1/4 on Tuesday: ring, strip, next session, week list, start', async ({ page, errors }) => {
    await setup(page, at(17, 10), { sessions: week47(1) });
    await expect(page.getByRole('heading', { name: 'Hi Alex' })).toBeVisible();
    await expect(page.getByText('Tuesday, 17 November')).toBeVisible();
    await expect(page.getByText('Week 47', { exact: true })).toBeVisible();
    await expect(page.getByText('1/4')).toBeVisible();
    await expect(page.getByRole('img', { name: '1 of 4 sessions this week' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'On track' })).toBeVisible();
    await expect(page.getByText('3 sessions left before Sunday. No set days.')).toBeVisible();
    await expect(dayCell(page, 16)).toHaveClass(/trained/);
    await expect(dayCell(page, 17)).toHaveClass(/today/);
    await expect(dayCell(page, 17)).not.toHaveClass(/trained/);
    await expect(dayCell(page, 22)).not.toHaveClass(/trained/);
    await expect(page.locator('.wdn')).toHaveText(['16', '17', '18', '19', '20', '21', '22']);
    // rotation: last done slot 1 -> next is session 2
    await expect(page.getByText('Up next · Session 2 of rotation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.getByText('City Gym Odenplan').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /City Gym Odenplan.*At home\? Tap/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText(/target 60 min/)).toBeVisible();
    await expect(page.getByText('Plan trimmed')).toHaveCount(0);
    await expect(page.getByText(/Install|notification/i)).toHaveCount(0);
    // this week list
    await expect(page.getByText('This week', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Upper body.*Mon 16 · .*City Gym Odenplan/ })).toBeVisible();
    await shot(page, 'today-1of4'); await noOverflow(page);
    await page.setViewportSize({ width: 375, height: 667 }); await shot(page, 'today-1of4'); await noOverflow(page);
    await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(page);
    const start = page.getByRole('button', { name: 'Start session 2' });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    const st = await readState(page);
    expect(st.device.draft.slot).toBe(2);
    expect(errors).toEqual([]);
  });

  test('week list row opens the session and History link works', async ({ page }) => {
    const s = week47(1);
    await setup(page, at(17, 10), { sessions: s });
    await page.getByRole('link', { name: /Upper body.*Mon 16/ }).click();
    await expect(page).toHaveURL(new RegExp(`/history/${s[0].id}$`));
    await page.goBack();
    await page.getByRole('link', { name: 'History', exact: true }).first().click();
    await expect(page).toHaveURL(/\/history$/);
  });

  test('3/4: one session left', async ({ page }) => {
    await setup(page, at(20, 10), { sessions: week47(3) });
    await expect(page.getByText('3/4')).toBeVisible();
    await expect(page.getByText('1 session left before Sunday. No set days.')).toBeVisible();
    await expect(page.getByText('Up next · Session 4 of rotation')).toBeVisible();
    await expect(dayCell(page, 19)).toHaveClass(/trained/);
    await expect(dayCell(page, 18)).not.toHaveClass(/trained/);
  });

  test('behind the goal late in the week gets the neutral copy', async ({ page }) => {
    await setup(page, at(22, 10), { sessions: week47(1) });
    await expect(page.getByRole('heading', { name: 'Every session counts' })).toBeVisible();
    await expect(page.getByText('3 sessions to go with 1 day left. Fit in what you can, extra sessions carry on the rotation.')).toBeVisible();
    await expect(dayCell(page, 22)).toHaveClass(/today/);
  });

  test('location line is a toggle button with an "At home? Tap" tag, whatever the gym source', async ({ page }) => {
    await setup(page, at(17, 10), { sessions: week47(1), device: { gymSource: 'gps' } });
    const loc = page.getByRole('button', { name: /City Gym Odenplan/ });
    await expect(loc).toContainText('At home? Tap');
    await expect(page.getByText('Detected', { exact: true })).toHaveCount(0);
  });

  test('no gym shows a Choose a gym link', async ({ page }) => {
    await setup(page, at(17, 10), { sessions: week47(1), gyms: null });
    await page.getByRole('link', { name: 'Choose a gym' }).click();
    await expect(page).toHaveURL(/\/session\/gym$/);
  });

  test('different session chooser: opens, picks, persists chosen slot, close toggles', async ({ page }) => {
    await setup(page, at(17, 10), { sessions: week47(1) });
    const toggle = page.getByRole('button', { name: 'Do a different session' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    const close = page.getByRole('button', { name: 'Close' });
    await expect(close).toHaveAttribute('aria-expanded', 'true');
    // the three other slots are offered, not the current one
    await expect(page.locator('.grid3 button')).toHaveCount(3);
    await expect(page.locator('.grid3').getByText('Lower body')).toHaveCount(0);
    await close.click();
    await expect(page.locator('.grid3')).toHaveCount(0);
    await toggle.click();
    await page.locator('.grid3 button', { hasText: 'Prehab & mobility' }).click();
    await expect(page.getByText('Chosen · Session 3 of rotation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prehab & mobility' })).toBeVisible();
    await expect(page.locator('.grid3')).toHaveCount(0);
    await expect.poll(async () => (await readState(page)).device.chosenSlot).toBe(3);
    await page.getByRole('button', { name: 'Start session 3' }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    await expect.poll(async () => (await readState(page)).device.draft?.slot).toBe(3);
    // choosing the rotation's own slot clears the override
    await page.goBack();
    await page.getByRole('button', { name: 'Do a different session' }).click();
    await page.locator('.grid3 button', { hasText: 'Lower body' }).click();
    await expect(page.getByText('Up next · Session 2 of rotation')).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.chosenSlot).toBeNull();
  });

  test('queued coach plan: tag and its exercises, start', async ({ page, errors }) => {
    const plan = { id: 'plan-1', title: 'Heavy day', note: 'Go heavy', slot: 2, exercises: [{ exerciseId: 'back_squat' }, { exerciseId: 'rdl' }], status: 'pending', createdBy: 'coach', createdAt: 1 };
    await setup(page, at(17, 10), { sessions: week47(1) }, [plan]);
    await expect(page.getByText('Coach plan', { exact: true })).toBeVisible();
    await expect(page.locator('.chip.dark')).toHaveCount(2);
    await page.getByRole('button', { name: 'Start session 2' }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    await expect.poll(async () => (await readState(page)).device.draft?.source).toBe('coach');
    expect(errors).toEqual([]);
  });

  test('no coach tag for a plan aimed at another slot', async ({ page }) => {
    const plan = { id: 'plan-2', title: 'Other', slot: 4, exercises: [{ exerciseId: 'deadlift' }], status: 'pending', createdBy: 'coach', createdAt: 1 };
    await setup(page, at(17, 10), { sessions: week47(1) }, [plan]);
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible();
    await expect(page.getByText('Coach plan', { exact: true })).toHaveCount(0);
  });

  test('plan-trimmed banner only when warm-ups really ran long', async ({ page }) => {
    const slow = [placed(1, at(13), { warmMin: 12 }), placed(2, at(14), { warmMin: 12 }), placed(3, at(16), { warmMin: 12 })];
    await setup(page, at(17, 10), { sessions: slow, settings: { targetMinutes: 30, warmupTargetMinutes: 10 } });
    await expect(page.getByText('Plan will trim to fit 30 min')).toBeVisible();
    await expect(page.getByText('Your last 3 warm-ups took 12 min (planned 10), so an accessory exercise is dropped first if time runs short.')).toBeVisible();
  });

  test('no banner when warm-ups are on plan, or fit-to-time is off', async ({ page }) => {
    const ok = [placed(1, at(13), { warmMin: 9 }), placed(2, at(14), { warmMin: 9 }), placed(3, at(16), { warmMin: 9 })];
    await setup(page, at(17, 10), { sessions: ok, settings: { targetMinutes: 30 } });
    await expect(page.getByText('Up next', { exact: false })).toBeVisible();
    await expect(page.getByText(/Plan (will )?trim/)).toHaveCount(0);
    const p2 = await (await page.context().browser()!.newContext({ viewport: { width: 440, height: 956 } })).newPage();
    await p2.clock.install({ time: new Date(at(17, 10)) });
    await seed(p2, { sessions: [placed(1, at(13), { warmMin: 12 }), placed(2, at(14), { warmMin: 12 }), placed(3, at(16), { warmMin: 12 })], settings: { targetMinutes: 30, fitToTime: false } });
    await p2.goto('');
    await expect(p2.getByText('Up next', { exact: false })).toBeVisible();
    await expect(p2.getByText(/Plan (will )?trim/)).toHaveCount(0);
  });

  test('no sessions yet this week (carried over from last week)', async ({ page }) => {
    await setup(page, at(23, 9), { sessions: [placed(1, at(20))] });
    await expect(page.getByText('0/4')).toBeVisible();
    await expect(page.getByText('Week 48', { exact: true })).toBeVisible();
    await expect(page.getByText('No sessions yet this week.')).toBeVisible();
    await expect(page.getByText('4 sessions left before Sunday. No set days.')).toBeVisible();
    await expect(page.getByText('Up next · Session 2 of rotation')).toBeVisible();
  });

  test('week boundary: Sunday night to Monday resets the counter', async ({ page, errors }) => {
    await setup(page, at(22, 23, 59), { sessions: week47(4) }); // Sunday 23:59 local
    await expect(page.getByText('Weekly goal reached')).toBeVisible();
    await expect(page.getByText('Sunday, 22 November')).toBeVisible();
    await page.clock.fastForward(120_000);
    await expect(page.getByText('Monday, 23 November')).toBeVisible();
    await expect(page.getByText('Week 48', { exact: true })).toBeVisible();
    await expect(page.getByText('0/4')).toBeVisible();
    await expect(page.getByText('Weekly goal reached')).toHaveCount(0);
    await expect(dayCell(page, 23)).toHaveClass(/today/);
    expect(errors).toEqual([]);
  });

  test('Monday 00:00 and Sunday 23:59 belong to the right weeks', async ({ page }) => {
    await setup(page, at(23, 0, 0), { sessions: [placed(1, at(22, 23, 59)), placed(2, at(23, 0, 0))] });
    await expect(page.getByText('1/4')).toBeVisible();
    await expect(page.getByText('Week 48', { exact: true })).toBeVisible();
  });
});

test.describe('week done', () => {
  test('4/4: goal reached, strip, stats, bonus session, recap', async ({ page, errors }) => {
    const sessions = [placed(1, at(16), { weight: 30 }), placed(2, at(17)), placed(3, at(19)), placed(4, at(20), { weight: 45 })];
    await setup(page, at(20, 21), { sessions });
    await expect(page.getByRole('heading', { name: 'Weekly goal reached' })).toBeVisible();
    await expect(page.getByText('Friday, 20 November')).toBeVisible();
    await expect(page.getByRole('img', { name: '4 of 4 sessions, goal reached' })).toBeVisible();
    await expect(page.getByText('4/4')).toBeVisible();
    await expect(page.getByText('Every area got a session. The counter resets Monday. Extra sessions still count.')).toBeVisible();
    await expect(dayCell(page, 20)).toHaveClass(/trained.*today|today.*trained/);
    await expect(dayCell(page, 18)).not.toHaveClass(/trained/);
    await expect(page.getByText('Time trained')).toBeVisible();
    await expect(page.locator('.stat-v').nth(0)).toHaveText(/^\d+h \d\d$/);
    await expect(page.locator('.stat-v').nth(1)).toHaveText(/^\d/);
    await expect(page.getByText('kg volume')).toBeVisible();
    // slot 4 bench at 45 beats slot 1 bench at 30 (and later sessions at 40 each beat it too): at least 1 weight increase
    await expect(page.locator('.stat-v').nth(2)).toHaveText(/^[1-9]/);
    await expect(page.getByText('Feeling good? Rotation continues')).toBeVisible();
    await expect(page.getByLabel('Bonus session').getByText('Upper body')).toBeVisible();
    await expect(page.getByText("This would be session 5 this week. It counts toward the rotation, not next week's goal.")).toBeVisible();
    await expect(page.getByText('Week recap')).toBeVisible();
    await expect(page.getByRole('link', { name: /Prehab & mobility.*Thu/ })).toBeVisible();
    await shot(page, 'week-done'); await noOverflow(page);
    await page.setViewportSize({ width: 375, height: 667 }); await shot(page, 'week-done'); await noOverflow(page);
    await page.setViewportSize({ width: 360, height: 800 }); await noOverflow(page);
    const recap = page.getByRole('button', { name: 'Week recap' });
    await expect(recap).toHaveAttribute('aria-expanded', 'true');
    await recap.click();
    await expect(page.getByRole('link', { name: /Prehab & mobility.*Thu/ })).toHaveCount(0);
    await recap.click();
    await expect(page.getByRole('link', { name: /Prehab & mobility.*Thu/ })).toBeVisible();
    await page.getByRole('button', { name: 'Start bonus session' }).click();
    await expect(page).toHaveURL(/\/session\/preview$/);
    await expect.poll(async () => (await readState(page)).device.draft?.slot).toBe(1);
    expect(errors).toEqual([]);
  });

  test('5/4: bonus counts up, ring stays full', async ({ page }) => {
    await setup(page, at(20, 21), { sessions: week47(5) });
    await expect(page.getByText('5/4')).toBeVisible();
    await expect(page.getByText(/session 6 this week/)).toBeVisible();
    await expect(page.getByRole('img', { name: '5 of 4 sessions, goal reached' })).toBeVisible();
    await expect(page.getByText('Weekly goal reached')).toBeVisible();
  });

  test('goal reached with repeated areas does not claim every area got a session', async ({ page }) => {
    const s = [placed(1, at(16)), placed(1, at(17)), placed(2, at(18)), placed(2, at(19))];
    await setup(page, at(20, 10), { sessions: s });
    await expect(page.getByText('Weekly goal reached')).toBeVisible();
    await expect(page.getByText('Every area got a session.')).toHaveCount(0);
    await expect(page.getByText('The counter resets Monday. Extra sessions still count.')).toBeVisible();
  });

  test('a lower goal (2) reaches week done sooner and avatar opens settings', async ({ page }) => {
    await setup(page, at(17, 10), { sessions: week47(2), settings: { weeklyGoal: 2 } });
    await expect(page.getByText('2/2')).toBeVisible();
    await expect(page.getByText('Weekly goal reached')).toBeVisible();
    await page.getByRole('link', { name: 'Profile and settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});

// ───────────── At home, no equipment (built-in location) ─────────────
test.describe('at home, no equipment', () => {
  const SEEDED = { sessions: week47(1), device: { chosenSlot: null } as Record<string, unknown> };
  const chipNames = (page: Page) => page.locator('.card.dark .chip.dark').allInnerTexts();
  const minutes = async (page: Page) => Number((await page.locator('.card.dark').getByText(/≈ \d+ min/).first().innerText()).match(/≈ (\d+) min/)![1]);
  const isBodyweight = async (names: string[]) => {
    const { SEED_EXERCISES } = await import('../../src/shared/exercises');
    return names.every((n) => { const e = SEED_EXERCISES.find((x) => x.name === n)!; return e && e.equipment.every((q) => q === 'mat'); });
  };

  test('the location line is a pressed-state button: gym ↔ At home · no equipment, bodyweight chips, updated minutes', async ({ page, errors }) => {
    await setup(page, at(17, 10), SEEDED);
    const gymBtn = page.getByRole('button', { name: /City Gym Odenplan/ });
    await expect(gymBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(gymBtn).toContainText('At home? Tap');
    await expect(gymBtn.locator('.ic-pin')).toHaveCount(1);
    await expect.poll(async () => (await chipNames(page)).length).toBeGreaterThan(2);
    const gymChips = await chipNames(page);
    const gymMin = await minutes(page);
    expect(await isBodyweight(gymChips)).toBe(false);
    await shot(page, 'today-gym');

    await gymBtn.click();
    const homeBtn = page.getByRole('button', { name: /At home · no equipment/ });
    await expect(homeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(homeBtn).toContainText('Switch to gym');
    await expect(homeBtn.locator('.ic-home')).toHaveCount(1);
    await expect(page.locator('.card.dark').getByText('City Gym Odenplan')).toHaveCount(0);
    await expect.poll(async () => await isBodyweight(await chipNames(page))).toBe(true);
    const homeChips = await chipNames(page);
    expect(homeChips.length).toBeGreaterThanOrEqual(4);
    expect(homeChips).not.toEqual(gymChips);
    expect(await minutes(page)).not.toBe(gymMin); // computed from the planner, not a constant
    await expect(page.getByRole('heading', { name: 'Lower body' })).toBeVisible(); // same area, same rotation slot
    await expect(page.getByText('Up next · Session 2 of rotation')).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.currentGymId).toBe('none');
    expect((await readState(page)).gyms.none).toBeUndefined(); // never stored as a gym
    await shot(page, 'today-home');
    await noOverflow(page);

    await homeBtn.click();
    await expect(page.getByRole('button', { name: /City Gym Odenplan/ })).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await readState(page)).device.currentGymId).toBe(GYM_ID);
    await expect.poll(async () => (await chipNames(page)).join('|')).not.toBe(homeChips.join('|'));
    expect(errors).toEqual([]);
  });

  test('the choice survives a reload and carries into the preview and session start', async ({ page }) => {
    await setup(page, at(17, 10), SEEDED);
    await page.getByRole('button', { name: /City Gym Odenplan/ }).click();
    await expect.poll(async () => (await readState(page)).device.draft?.gymId).toBe('none');
    const homeChips = await chipNames(page);
    await page.reload();
    await expect(page.getByRole('button', { name: /At home · no equipment/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Start session 2' }).click();
    await expect(page).toHaveURL(/session\/preview/);
    await expect(page.getByRole('button', { name: 'At home, no equipment' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Start at home' })).toBeEnabled();
    const planned = await page.locator('.group .li .li-t').allInnerTexts();
    expect(planned.sort()).toEqual([...homeChips].sort());
    await page.getByRole('button', { name: 'Start at home' }).click();
    await expect(page).toHaveURL(/session\/warmup/);
    await expect.poll(async () => Object.values<any>((await readState(page)).sessions).some((x) => x.status === 'active')).toBe(true);
    const s = Object.values<any>((await readState(page)).sessions).find((x) => x.status === 'active');
    expect(s).toMatchObject({ gymId: 'none', gymName: 'No equipment', areaName: 'Lower body' });
  });

  test('first session card has the same toggle', async ({ page }) => {
    await setup(page, at(17, 10), {});
    const btn = page.getByRole('button', { name: /City Gym Odenplan/ });
    await expect(btn).toContainText('At home? Tap');
    await btn.click();
    await expect(page.getByRole('button', { name: /At home · no equipment/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/≈ \d+ min · \d+ exercises?/)).toBeVisible();
    await expect.poll(async () => (await readState(page)).device.draft?.gymId).toBe('none');
    await noOverflow(page);
  });

  test('no gym saved: Choose a gym stays, and At home is one tap away', async ({ page }) => {
    await setup(page, at(17, 10), { sessions: week47(1), gyms: null });
    await expect(page.getByRole('link', { name: 'Choose a gym' })).toBeVisible();
    await page.getByRole('button', { name: 'At home, no equipment' }).click();
    await expect(page.getByRole('button', { name: /At home · no equipment/ })).toContainText('Switch to gym');
    await expect.poll(async () => await isBodyweight(await chipNames(page))).toBe(true);
    // back with no gym: the link returns
    await page.getByRole('button', { name: /At home · no equipment/ }).click();
    await expect(page.getByRole('link', { name: 'Choose a gym' })).toBeVisible();
  });

  test('375px: no overflow in either location', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setup(page, at(17, 10), SEEDED);
    await noOverflow(page);
    await shot(page, 'today-gym');
    await page.getByRole('button', { name: /City Gym Odenplan/ }).click();
    await expect(page.getByRole('button', { name: /At home · no equipment/ })).toBeVisible();
    await noOverflow(page);
    await shot(page, 'today-home');
  });
});
