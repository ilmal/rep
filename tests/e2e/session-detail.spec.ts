import { test, expect, seed, readState, makeSession, makeAreas } from './fixtures';
import type { Session } from '../../src/shared/types';

const AREAS = makeAreas();
const U = { areaId: 'area-1', areaName: 'Upper body' };

/** Rich session: PR, swap, hold, rep-up, skipped, time-tracked, with varied rests. */
function rich(): Session {
  const s = makeSession({ id: 'r1', seq: 47, slot: 1, ...U, daysAgo: 0, exerciseIds: ['bench_press', 'ohp', 'lat_pulldown', 'pushup', 'plank'].filter(Boolean), minutes: 58, weight: 62.5 });
  const [bench, ohp, lat, third, fourth] = s.exercises;
  bench.pr = true;
  bench.sets = bench.sets.map((x, i) => ({ ...x, restSec: [125, 130, 0][i] }));
  ohp.recommendation = { weight: 62.5, reps: 8, sets: 3, kind: 'hold', tag: 'Hold', why: 'Too heavy; hold.', ruleVersion: 1 };
  ohp.feedback = { effort: 'hard', weight: 'heavy', volume: 'reps' };
  ohp.sets = ohp.sets.map((x, i) => ({ ...x, reps: [8, 7, 5][i] }));
  lat.swappedFrom = { id: 'x', name: 'Reverse fly machine' } as never;
  lat.recommendation = undefined; lat.feedback = undefined;
  third.status = 'skipped'; third.sets = []; third.recommendation = undefined; third.feedback = undefined;
  fourth.recommendation = undefined; fourth.feedback = undefined;
  return s;
}
const mk = (o: Partial<Session> = {}) => ({ ...rich(), ...o });
const accord = (page: import('@playwright/test').Page, name: string) => page.locator('button.li', { hasText: name });

test('header, timeline, stats and area tile', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [rich()] });
  await page.goto('history/r1');
  await expect(page.locator('.topbar .title')).toHaveText('Session #47');
  await expect(page.getByRole('heading', { name: 'Upper body' })).toBeVisible();
  await expect(page.locator('.tile.lg')).toHaveText('1');
  const sub = page.locator('h1 + .sub');
  await expect(sub).toContainText('City Gym Odenplan');
  await expect(sub).toContainText(/^\w{3} \d{1,2} \w{3} · \d\d:\d\d–\d\d:\d\d · /);
  await expect(page.locator('.card .lbl', { hasText: 'Timeline' })).toBeVisible();
  await expect(page.locator('.card.tight .small.strong').first()).toHaveText('58:00');
  await expect(page.getByText('Warm-up 9:00')).toBeVisible();
  await expect(page.locator('.tl')).toHaveAttribute('aria-label', 'Warm-up 9 minutes then 4 exercises');
  await expect(page.locator('.stat')).toHaveCount(3);
  await expect(page.locator('.stat-l')).toHaveText(['kg volume', 'Sets', 'PRs']);
  await expect(page.locator('.stat-v').nth(1)).toHaveText('12'); // 4 logged exercises x 3 sets (one skipped, none logged)
  await expect(page.locator('.stat-v').nth(2)).toHaveText('1');
  await expect(page.locator('.section-h')).toHaveText('Exercises');
  await expect(page.getByText('Ended early')).toHaveCount(0);
});

test('every accordion: tags, meta, set table, feedback line; one open at a time', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [rich()] });
  await page.goto('history/r1');
  const items = page.locator('.group > div');
  await expect(items).toHaveCount(5);
  // first is open by default
  const bench = accord(page, 'Bench press');
  await expect(bench).toHaveAttribute('aria-expanded', 'true');
  await expect(bench.locator('.tag')).toHaveText('PR');
  await expect(bench.locator('.tag')).toHaveClass(/green/);
  await expect(bench.locator('.li-s')).toContainText('3 × 8 @ 62.5 kg');
  const tbl = items.nth(0).locator('div[style*="grid"]');
  await expect(tbl.locator('b')).toHaveText(['Set', 'kg', 'Reps', 'Rest']);
  await expect(tbl).toContainText('2:05');
  await expect(tbl).toContainText('2:10');
  await expect(tbl.locator('.sub')).toHaveText(['2:05', '2:10', '—']);
  await expect(tbl.locator('.strong')).toHaveText(['1', '2', '3']);
  await expect(items.nth(0)).toContainText('Feedback: Normal · just right · right amount → 3 × 9 @ 62.5 kg. Just right, all sets hit: +1 rep.');

  // Overhead press: Hold + varying reps
  await accord(page, 'Overhead press').click();
  await expect(bench).toHaveAttribute('aria-expanded', 'false'); // single-open
  await expect(accord(page, 'Overhead press')).toHaveAttribute('aria-expanded', 'true');
  await expect(accord(page, 'Overhead press').locator('.tag')).toHaveText('Hold');
  await expect(items.nth(1)).toContainText('Feedback: Trying hard · too heavy · too many reps → hold. Too heavy; hold.');
  await expect(items.nth(1).locator('div[style*="grid"] span').filter({ hasText: /^(8|7|5)$/ })).toHaveCount(3);

  // Swap
  await accord(page, 'Lat pulldown').click();
  await expect(accord(page, 'Lat pulldown').locator('.tag')).toHaveText('Swap');
  await expect(accord(page, 'Lat pulldown').locator('.tag')).toHaveClass(/blue/);
  await expect(accord(page, 'Lat pulldown').locator('.li-s')).toContainText('swapped from Reverse fly machine');
  await expect(items.nth(2)).not.toContainText('Feedback:');

  // Skipped: no table
  await accord(page, 'Push-up').click();
  await expect(accord(page, 'Push-up').locator('.tag')).toHaveText('Skipped');
  await expect(accord(page, 'Push-up').locator('.li-s')).toContainText('Not performed');
  await expect(items.nth(3).locator('div[style*="grid"]')).toHaveCount(0);

  // collapse the open one
  await accord(page, 'Push-up').click();
  await expect(accord(page, 'Push-up')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('div[style*="grid-template-columns: 40px"]')).toHaveCount(0);
});

test('lb display converts weights and labels', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [rich()], settings: { unit: 'lb' } });
  await page.goto('history/r1');
  await expect(page.locator('.stat-l').first()).toHaveText('lb volume');
  await expect(accord(page, 'Bench press').locator('.li-s')).toContainText('3 × 8 @ 138 lb'); // 62.5 kg = 137.8 lb, rounded to 0.5
  const tbl = page.locator('div[style*="grid"]').first();
  await expect(tbl.locator('b').nth(1)).toHaveText('lb');
  await expect(tbl).toContainText('138');
  await expect(page.getByText('3 × 9 @ 138 lb')).toBeVisible();
});

test('ended early + coach plan header tags and coach note', async ({ page }) => {
  const s = mk({ endedEarly: true, source: 'coach', coachPlanId: 'p1' } as never);
  await seed(page, { areas: AREAS, sessions: [s] });
  await page.addInitScript(() => {
    const k = 'rep-state-v1'; if (localStorage.getItem('__plan')) return; localStorage.setItem('__plan', '1');
    const st = JSON.parse(localStorage.getItem(k)!); st.plans = { p1: { id: 'p1', title: 'Coach plan', note: 'Keep the bar path close.', exercises: [], status: 'used', createdBy: 'mcp', createdAt: 1 } }; localStorage.setItem(k, JSON.stringify(st));
  });
  await page.goto('history/r1');
  await expect(page.locator('.tile.lg')).toHaveClass(/warm/);
  await expect(page.locator('.tag.accent', { hasText: 'Ended early' })).toBeVisible();
  await expect(page.locator('.tag.blue', { hasText: 'Coach plan' })).toBeVisible();
  await expect(page.locator('.card .lbl', { hasText: 'Coach note' })).toBeVisible();
  await expect(page.getByText('Keep the bar path close.')).toBeVisible();
});

test('no coach note card without a plan note', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [rich()] });
  await page.goto('history/r1');
  await expect(page.getByText('Coach note')).toHaveCount(0);
});

test('session note: edit saves on blur, persists, reload shows it', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [rich()] });
  await page.goto('history/r1');
  const ta = page.getByPlaceholder('How did it feel?');
  await expect(ta).toHaveValue('');
  await ta.fill('Shoulder felt good. Bench moved fast.');
  await expect(page.getByRole('status')).toHaveText('');
  await ta.blur();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect.poll(async () => (await readState(page)).sessions.r1.note).toBe('Shoulder felt good. Bench moved fast.');
  await page.reload();
  await expect(page.getByPlaceholder('How did it feel?')).toHaveValue('Shoulder felt good. Bench moved fast.');
  // clearing saves too
  await page.getByPlaceholder('How did it feel?').fill('');
  await page.getByPlaceholder('How did it feel?').blur();
  await expect.poll(async () => (await readState(page)).sessions.r1.note).toBe('');
});

test('existing note is prefilled; unchanged blur does not show Saved', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [mk({ note: 'Old note' })] });
  await page.goto('history/r1');
  const ta = page.getByPlaceholder('How did it feel?');
  await expect(ta).toHaveValue('Old note');
  await ta.focus(); await ta.blur();
  await expect(page.getByRole('status')).toHaveText('');
});

test('delete: confirm dialog, keep, then delete updates Today counter, Progress and History', async ({ page }) => {
  const a = makeSession({ id: 'a', seq: 1, slot: 1, ...U, daysAgo: 0, exerciseIds: ['bench_press'] });
  const b = makeSession({ id: 'b', seq: 2, slot: 2, areaId: 'area-2', areaName: 'Lower body', daysAgo: 0, exerciseIds: ['back_squat'] });
  await seed(page, { areas: AREAS, sessions: [a, b], settings: { weeklyGoal: 4 } });
  await page.goto('');
  await expect(page.getByRole('img', { name: /^2 of 4 sessions/ })).toBeVisible();
  await page.goto('progress');
  await expect(page.getByText('in 2 sessions')).toBeVisible();

  await page.goto('history/b');
  await page.getByRole('button', { name: 'Delete session' }).click();
  const dlg = page.getByRole('alertdialog', { name: 'Delete session?' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('Delete this session?');
  await expect(dlg).toContainText('It stops counting towards your weeks and stats. Progression targets already set from it are kept.');
  await dlg.getByRole('button', { name: 'Keep it' }).click();
  await expect(dlg).toHaveCount(0);
  expect((await readState(page)).sessions.b).toBeTruthy();

  await page.getByRole('button', { name: 'Delete session' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete session' }).click();
  await expect(page).toHaveURL(/history$/);
  await expect(page.locator('a.li')).toHaveCount(1);
  await expect(page.getByText('#2')).toHaveCount(0);
  await expect.poll(async () => { const st = await readState(page); return st.sessions.b ?? null; }).toBeNull();
  expect((await readState(page)).sessions.a).toBeTruthy();

  await page.goto('');
  await expect(page.getByRole('img', { name: /^1 of 4 sessions/ })).toBeVisible();
  await page.goto('progress');
  await expect(page.getByText('in 1 session', { exact: false }).first()).toBeVisible();
  await page.goto('history/b');
  await expect(page.getByText("This session isn't on this device.")).toBeVisible();
});

test('unknown id shows not-found state with a way back', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [rich()] });
  await page.goto('history/nope');
  await expect(page.getByText("This session isn't on this device.")).toBeVisible();
  await expect(page.locator('.topbar .title')).toHaveText('Session');
  await page.getByRole('link', { name: 'Back to History', exact: true }).last().click();
  await expect(page).toHaveURL(/history$/);
});

test('session with no logged exercises', async ({ page }) => {
  const s = rich(); s.exercises = [];
  await seed(page, { areas: AREAS, sessions: [s] });
  await page.goto('history/r1');
  await expect(page.getByText('No exercises were logged.')).toBeVisible();
  await expect(page.locator('.stat-v').nth(1)).toHaveText('0');
});

test('375px and 360px: no horizontal overflow, delete button reachable', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [mk({ endedEarly: true })] });
  for (const [w, h] of [[375, 667], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('history/r1');
    await expect(page.getByRole('button', { name: 'Delete session' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Delete session' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.querySelector('.scroll')!.scrollWidth - document.querySelector('.scroll')!.clientWidth)).toBeLessThanOrEqual(0);
  }
});
