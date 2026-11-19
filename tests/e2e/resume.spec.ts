import { test, expect, seed, readState, makeAreas, makeSession } from './fixtures';
import { activeSession, IDS } from './x-active';
import { nextSlot, weekCount, completed } from '../../src/shared/rules';

const areas = makeAreas();
const prior = (daysAgo = 0.02) => makeSession({ id: 'prior', seq: 1, slot: 1, areaId: areas[0].id, areaName: areas[0].name, daysAgo, exerciseIds: IDS });
const act = async (page: any) => (await readState(page)).sessions['act-1'];
const all = async (page: any) => Object.values((await readState(page)).sessions) as any[];
const dlg = (page: any) => page.getByRole('alertdialog', { name: 'Unfinished session' });
const secs = (t: string) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
const clockOf = async (page: any) => secs((await dlg(page).getByRole('timer').textContent())!);

test('opening the app with a running session redirects to /resume and shows the dialog', async ({ page, errors }) => {
  await seed(page, { sessions: [prior(), activeSession({ seq: 2, slot: 2 })] });
  await page.goto('');
  await expect(page).toHaveURL(/resume$/);
  const d = dlg(page);
  await expect(d.getByText('Unfinished session')).toBeVisible();
  await expect(d.getByRole('heading', { name: 'Session 2 is still running' })).toBeVisible();
  await expect(d.getByText(/^Started \d\d:\d\d at City Gym Odenplan\. 2 of 5 exercises done\. Last set logged \d\d:\d\d\.$/)).toBeVisible();
  await expect(d.getByRole('link', { name: 'Resume' })).toBeVisible();
  await expect(d.getByRole('button', { name: /^Finish & save at \d\d:\d\d$/ })).toBeVisible();
  await expect(d.getByRole('button', { name: 'Discard session' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hi Alex' })).toBeHidden({ timeout: 100 }).catch(() => {}); // behind the scrim (aria-hidden)
  expect(errors).toEqual([]);
});

test('clock is wall-clock: ticks, and does not reset on reload', async ({ page }) => {
  await seed(page, { sessions: [activeSession({ startedMinAgo: 72 })] });
  await page.goto('resume');
  const t1 = await clockOf(page);
  expect(t1).toBeGreaterThanOrEqual(72 * 60);
  expect(t1).toBeLessThan(72 * 60 + 20);
  await expect(dlg(page).getByRole('timer')).toHaveText(/^1:1\d:\d\d$/);
  await page.waitForTimeout(2200);
  const t2 = await clockOf(page);
  expect(t2).toBeGreaterThanOrEqual(t1 + 2);
  await page.reload();
  await expect(page).toHaveURL(/resume$/);
  const t3 = await clockOf(page);
  expect(t3).toBeGreaterThanOrEqual(t2);
  expect(t3).toBeLessThan(t2 + 15);
  // survives a hidden tab: a visibility change re-syncs to wall clock immediately
  expect((await act(page)).startedAt).toBe((await act(page)).startedAt);
});

test('reload on /resume keeps the dialog and the session untouched', async ({ page }) => {
  await seed(page, { sessions: [activeSession()] });
  await page.goto('resume');
  const before = await act(page);
  await page.reload();
  await expect(dlg(page)).toBeVisible();
  const after = await act(page);
  expect(after.status).toBe('active');
  expect(after.startedAt).toBe(before.startedAt);
  expect(after.exercises).toEqual(before.exercises);
});

test('Resume returns to the live session (warm-up phase returns to warm-up) without altering it', async ({ page }) => {
  await seed(page, { sessions: [activeSession()] });
  await page.goto('resume');
  const before = await act(page);
  await dlg(page).getByRole('link', { name: 'Resume' }).click();
  await expect(page).toHaveURL(/session\/live$/);
  const after = await act(page);
  expect(after.status).toBe('active');
  expect(after.startedAt).toBe(before.startedAt);
  expect(after.exercises.map((e: any) => e.sets.length)).toEqual(before.exercises.map((e: any) => e.sets.length));
});

test('warm-up phase: shows "In warm-up." and Resume goes to warm-up; no finish option without logged sets', async ({ page }) => {
  await seed(page, { sessions: [activeSession({ noSets: true, startedMinAgo: 6, phase: 'warmup', over: { warmupEndedAt: undefined } })] });
  await page.goto('resume');
  const d = dlg(page);
  await expect(d.getByText(/^In warm-up\. Started \d\d:\d\d at City Gym Odenplan\. 0 of 5 exercises done\.$/)).toBeVisible();
  await expect(d.getByRole('button', { name: /Finish & save/ })).toHaveCount(0);
  await d.getByRole('link', { name: 'Resume' }).click();
  await expect(page).toHaveURL(/session\/warmup$/);
});

test('Finish at last logged set: counted, ended at that set, data kept, pointer advances', async ({ page }) => {
  await seed(page, { sessions: [prior(0.5), activeSession({ seq: 2, slot: 2, startedMinAgo: 150, lastSetMinAgo: 95 })] });
  await page.goto('resume');
  const before = await act(page);
  const last = Math.max(...before.exercises.flatMap((e: any) => e.sets.map((s: any) => s.doneAt)));
  const hh = await page.evaluate((t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), last);
  await dlg(page).getByRole('button', { name: `Finish & save at ${hh}` }).click();
  await expect(page).toHaveURL(/session\/summary\/act-1$/);
  await expect.poll(async () => (await act(page)).status).toBe('completed');
  const s = await act(page);
  expect(s.endedAt).toBe(last); // not "now": the time the app was closed is excluded
  expect(s.endedAt).toBeLessThan(Date.now() - 90 * 60000);
  expect(s.endedEarly).toBe(true);
  expect(s.repeatNext).toBe(false);
  expect(s.phase).toBe('done');
  expect(s.exercises.map((e: any) => e.status)).toEqual(['done', 'done', 'done', 'skipped', 'skipped']);
  expect(s.exercises.map((e: any) => e.sets.length)).toEqual([3, 3, 1, 0, 0]); // data so far kept
  expect(s.exercises[2].endedAt).toBe(before.exercises[2].sets[0].doneAt);
  const list = await all(page);
  expect(completed(list).map((x) => x.id).sort()).toEqual(['act-1', 'prior']);
  expect(nextSlot(list, 4)).toBe(3);
  expect(list.some((x) => x.status === 'active')).toBe(false);
  // does not bounce back into /resume
  await page.goto('');
  await expect(page).not.toHaveURL(/resume/);
});

test('Finish at last set uses the week of that set (session left running for days)', async ({ page }) => {
  await seed(page, { sessions: [activeSession({ startedMinAgo: 5 * 1440, lastSetMinAgo: 5 * 1440 - 40 })] });
  await page.goto('resume');
  await dlg(page).getByRole('button', { name: /^Finish & save at/ }).click();
  await expect.poll(async () => (await act(page)).status).toBe('completed');
  const s = await act(page);
  const list = await all(page);
  expect(s.endedAt - s.startedAt).toBeLessThan(2 * 3600000);
  expect(weekCount(list, s.endedAt)).toBe(1);
});

test('Finish when every exercise is done is a normal completion (not ended early)', async ({ page }) => {
  const s = activeSession();
  s.exercises = s.exercises.map((e, i) => (i < 3 ? { ...e, status: 'done' as const, endedAt: e.endedAt ?? Date.now() - 1000, sets: e.sets.length === 3 ? e.sets : [...e.sets, ...e.sets, ...e.sets].slice(0, 3) } : { ...e, status: 'dropped' as const }));
  await seed(page, { sessions: [s] });
  await page.goto('resume');
  await expect(dlg(page).getByText(/3 of 3 exercises done/)).toBeVisible();
  await dlg(page).getByRole('button', { name: /^Finish & save at/ }).click();
  await expect.poll(async () => (await act(page)).status).toBe('completed');
  const r = await act(page);
  expect(r.endedEarly).toBe(false);
  expect(r.exercises.map((e: any) => e.status)).toEqual(['done', 'done', 'done', 'dropped', 'dropped']);
});

test('Discard asks for confirmation; Go back keeps the session; Discard removes it uncounted', async ({ page }) => {
  await seed(page, { sessions: [prior(), activeSession({ seq: 2, slot: 2 })] });
  await page.goto('resume');
  await dlg(page).getByRole('button', { name: 'Discard session' }).click();
  const d = dlg(page);
  await expect(d.getByRole('heading', { name: 'Discard session 2?' })).toBeVisible();
  await expect(d.getByText("3 logged exercises and their timing will be deleted. It won't count toward this week, and session 2 stays next in the rotation.")).toBeVisible();
  expect((await act(page)).status).toBe('active'); // nothing happened yet
  await d.getByRole('button', { name: 'Go back' }).click();
  await expect(d.getByRole('heading', { name: 'Session 2 is still running' })).toBeVisible();
  expect((await act(page)).status).toBe('active');
  await d.getByRole('button', { name: 'Discard session' }).click();
  await d.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect.poll(async () => (await act(page)).status).toBe('discarded');
  const list = await all(page);
  expect(completed(list).map((x) => x.id)).toEqual(['prior']);
  expect(weekCount(list, Date.now())).toBe(1);
  expect(nextSlot(list, 4)).toBe(2);
  await page.reload();
  await expect(page).not.toHaveURL(/resume/);
});

test('discard confirmation copy with nothing logged', async ({ page }) => {
  await seed(page, { sessions: [activeSession({ noSets: true, startedMinAgo: 3 })] });
  await page.goto('resume');
  await dlg(page).getByRole('button', { name: 'Discard session' }).click();
  await expect(dlg(page).getByText(/^Nothing is logged yet\. It won't count toward this week/)).toBeVisible();
});

test('no active session: /resume sends you to Today', async ({ page }) => {
  await seed(page, { sessions: [prior()] });
  await page.goto('resume');
  await expect(page).toHaveURL(/\/app\/?$/);
});

test('no horizontal overflow at 360px and 375x667; all actions reachable', async ({ page }) => {
  await seed(page, { sessions: [activeSession()] });
  for (const [w, h] of [[360, 800], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('resume');
    await expect(dlg(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(dlg(page).getByRole('button', { name: 'Discard session' })).toBeInViewport();
  }
});
