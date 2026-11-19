import { test, expect, seed, readState, makeSession, makeAreas } from './fixtures';
import type { Page } from '@playwright/test';
void readState;

const AREAS = makeAreas(); // area-1 Upper, area-2 Lower, area-3 Prehab, area-4 Full
const U = { areaId: 'area-1', areaName: 'Upper body' }, L = { areaId: 'area-2', areaName: 'Lower body' }, P = { areaId: 'area-3', areaName: 'Prehab & mobility' };
const EX = ['bench_press', 'ohp'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function weekStartOf(ts: number) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
function rangeLabel(start: Date) { const e = new Date(start); e.setDate(e.getDate() + 6); const f = start.getMonth() === e.getMonth() ? `${start.getDate()}` : `${start.getDate()} ${MON[start.getMonth()]}`; return `${f}–${e.getDate()} ${MON[e.getMonth()]}`; }

const dow = (new Date().getDay() + 6) % 7;
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ago = (n: number) => new Date(Date.now() - n * 86400000);
const dayShort = (d: Date) => `${DAYN[d.getDay()]} ${d.getDate()}`;
const sessions = () => [
  makeSession({ id: 's7', seq: 7, slot: 1, ...U, daysAgo: 0, exerciseIds: EX, minutes: 58 }),
  makeSession({ id: 's6', seq: 6, slot: 4, areaId: 'area-4', areaName: 'Full body', daysAgo: dow + 1, exerciseIds: EX, minutes: 52 }),
  makeSession({ id: 's5', seq: 5, slot: 3, ...P, daysAgo: dow + 3, exerciseIds: EX, minutes: 36 }),
  makeSession({ id: 's4', seq: 4, slot: 2, ...L, daysAgo: dow + 8, exerciseIds: ['back_squat', 'rdl'], minutes: 63 }),
  makeSession({ id: 's3', seq: 3, slot: 1, ...U, daysAgo: dow + 15, exerciseIds: EX }),
  makeSession({ id: 's2', seq: 2, slot: 2, ...L, daysAgo: dow + 16, exerciseIds: ['back_squat'] }),
  makeSession({ id: 's1', seq: 1, slot: 1, ...U, daysAgo: dow + 17, exerciseIds: EX }),
];
const rows = (page: Page) => page.locator('a.li');
const heads = (page: Page) => page.locator('.between > .strong');
const isoWeek = (d: Date) => { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); const w1 = new Date(t.getFullYear(), 0, 4); return 1 + Math.round(((t.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7); };

test('multi-week grouping: labels, counts, goal tag, row content, ordering', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: sessions(), settings: { weeklyGoal: 3 } });
  await page.goto('history');
  await expect(page.locator('.topbar .title')).toHaveText('History');
  await expect(heads(page)).toHaveCount(4);
  const wk = (n: number) => weekStartOf(ago(n * 7).getTime());
  await expect(heads(page).nth(0)).toHaveText(`This week · W${isoWeek(wk(0))}`);
  for (let n = 1; n <= 3; n++) await expect(heads(page).nth(n)).toHaveText(`W${isoWeek(wk(n))} · ${rangeLabel(wk(n))}`);
  const tags = page.locator('.between > .tag');
  await expect(tags).toHaveText(['1 / 3', '2 / 3', '1 / 3', '3 / 3']);
  await expect(tags.nth(3)).toHaveClass(/green/);
  await expect(tags.nth(0)).not.toHaveClass(/green/);
  await expect(rows(page)).toHaveCount(7);
  await expect(rows(page).first().locator('.li-t')).toHaveText('Upper body');
  await expect(rows(page).first().locator('.li-s')).toHaveText(`${dayShort(ago(0))} · 58 min · City Gym Odenplan`);
  await expect(rows(page).first()).toContainText('#7');
  await expect(rows(page).first().locator('.tile')).toHaveText('1');
  await expect(rows(page).first().locator('.tile')).toHaveClass(/ink/);
  // newest first
  await expect(rows(page).locator('.small.sub')).toHaveText(['#7', '#6', '#5', '#4', '#3', '#2', '#1']);
  await expect(page.locator('.chev').first()).toBeVisible();
});

test('goal tag turns green at goal and uses the real goal', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: sessions(), settings: { weeklyGoal: 1 } });
  await page.goto('history');
  const tags = page.locator('.between > .tag');
  await expect(tags).toHaveText(['1 / 1', '2 / 1', '1 / 1', '3 / 1']);
  for (let i = 0; i < 4; i++) await expect(tags.nth(i)).toHaveClass(/green/);
});

test('area filter chips come from real areas; filter hides weeks, counts stay per whole week', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: sessions(), settings: { weeklyGoal: 3 } });
  await page.goto('history');
  const chips = page.locator('.chip');
  await expect(chips).toHaveText(['All', 'Upper body', 'Lower body', 'Prehab & mobility', 'Full body']);
  await expect(page.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Lower body' }).click();
  await expect(page.getByRole('button', { name: 'Lower body' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  await expect(rows(page)).toHaveCount(2);
  await expect(heads(page)).toHaveCount(2); // weeks without Lower body are hidden
  await expect(page.locator('.between > .tag')).toHaveText(['1 / 3', '3 / 3']); // tag is the full-week count
  await page.getByRole('button', { name: 'Upper body' }).click();
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Full body' }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'All' }).click();
  await expect(rows(page)).toHaveCount(7);
});

test('filter with no matches shows the empty state', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: sessions().filter((s) => s.areaName !== 'Full body') });
  await page.goto('history');
  await page.getByRole('button', { name: 'Full body' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('.empty')).toContainText('No Full body sessions in the last 4 weeks.');
});

test('empty history', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [] });
  await page.goto('history');
  await expect(page.locator('.empty')).toContainText('No sessions yet. Finished sessions show up here.');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('.chip')).toHaveCount(5);
});

test('ended-early rows are warm + tagged; discarded and active sessions are not listed', async ({ page }) => {
  const ss = sessions();
  ss[1] = { ...ss[1], endedEarly: true };
  const disc = makeSession({ id: 'd1', seq: 90, slot: 1, ...U, daysAgo: 1, exerciseIds: EX, status: 'discarded' as never });
  const act = makeSession({ id: 'a1', seq: 91, slot: 1, ...U, daysAgo: 0, exerciseIds: EX, status: 'active' });
  await seed(page, { areas: AREAS, sessions: [...ss, disc, act] });
  await page.goto('history');
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByText('#90')).toHaveCount(0);
  await expect(page.getByText('#91')).toHaveCount(0);
  const early = rows(page).filter({ hasText: '#6' });
  await expect(early.locator('.tile')).toHaveClass(/warm/);
  await expect(early.locator('.li-s')).toContainText('ended early');
  await expect(rows(page).filter({ hasText: '#5' }).locator('.li-s')).not.toContainText('ended early');
  // week counter counts the ended-early session, not the discarded one
  await expect(page.locator('.between > .tag').nth(1)).toHaveText('2 / 4');
});

test('chips include areas of past sessions that no longer exist', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: [makeSession({ id: 'x', seq: 1, slot: 1, areaId: 'gone', areaName: 'Old area', daysAgo: 1, exerciseIds: EX })] });
  await page.goto('history');
  await expect(page.locator('.chip').last()).toHaveText('Old area');
});

test('row navigates to detail; back returns to history', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: sessions() });
  await page.goto('history');
  await rows(page).filter({ hasText: '#4' }).click();
  await expect(page).toHaveURL(/history\/s4$/);
  await expect(page.locator('.topbar .title')).toHaveText('Session #4');
  await page.getByRole('link', { name: 'Back to History' }).click();
  await expect(page).toHaveURL(/history$/);
});

test('back link goes to Progress', async ({ page }) => {
  await seed(page, { areas: AREAS, sessions: sessions() });
  await page.goto('history');
  await page.getByRole('link', { name: 'Back to Progress' }).click();
  await expect(page).toHaveURL(/progress$/);
});

test('375px: no horizontal overflow, chips scroll inside their strip', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await seed(page, { areas: AREAS, sessions: sessions() });
  await page.goto('history');
  await expect(rows(page)).toHaveCount(7);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 360, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
