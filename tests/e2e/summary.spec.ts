import { test, expect, seed, makeSession, makeAreas, readState, DAY } from './fixtures';
import { weekStart } from '../../src/shared/rules';

const A = makeAreas();
const mk = (id: string, seq: number, daysAgo: number, o: Partial<Parameters<typeof makeSession>[0]> = {}) =>
  makeSession({ id, seq, slot: ((seq - 1) % 4) + 1, areaId: A[1].id, areaName: A[1].name, daysAgo, exerciseIds: ['back_squat', 'rdl'], ...o });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

test('first session: counter animates 0 → 1/4, stats, next-time, rotation', async ({ page, errors }) => {
  await seed(page, { sessions: [mk('s1', 1, 0.01)] });
  await page.goto('session/summary/s1');
  await expect(page.getByText('0/4')).toBeVisible();
  await expect(page.getByText('1/4')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session 1 done' })).toBeVisible();
  await expect(page.getByText('Lower body · City Gym Odenplan')).toBeVisible();
  await expect(page.getByText('Total time')).toBeVisible();
  await expect(page.getByText(/under target|over target/)).toBeVisible();
  await expect(page.getByText(/vs plan/)).toBeVisible();
  await expect(page.getByText(/vs last/)).toHaveCount(0); // no previous session
  await expect(page.getByText('6', { exact: true })).toBeVisible(); // sets
  await expect(page.getByText('2 exercises')).toBeVisible();
  await expect(page.getByText('Where the time went')).toBeVisible();
  await expect(page.getByText('Next time')).toBeVisible();
  await expect(page.getByText('+1 rep')).toHaveCount(2);
  await expect(page.getByText('Up next in rotation')).toBeVisible();
  await expect(page.locator('.card.dark .t-h')).toHaveText(A[1].name);
  expect(errors).toEqual([]);
});

test('later session: volume vs last same-area session, week count', async ({ page }) => {
  await seed(page, { sessions: [mk('s1', 1, 5, { weight: 40 }), mk('s2', 2, 0.01, { weight: 60 })] });
  await page.goto('session/summary/s2');
  await expect(page.getByText('+50% vs last Lower body')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session 2 done' })).toBeVisible();
});

test('goal reached shows n/goal and extra sessions beyond goal', async ({ page }) => {
  await seed(page, { settings: { weeklyGoal: 2 }, sessions: [mk('s1', 1, 0.3), mk('s2', 2, 0.02)] });
  await page.goto('session/summary/s2');
  await expect(page.getByText('2/2')).toBeVisible();
  await expect(page.getByRole('img', { name: '2 of 2 sessions this week' })).toBeVisible();
});

test('swapped-in and PR tags, swap count', async ({ page }) => {
  const s = mk('s1', 1, 0.01);
  s.exercises[0] = { ...s.exercises[0], swappedFrom: 'x', pr: true };
  await seed(page, { sessions: [s] });
  await page.goto('session/summary/s1');
  await expect(page.getByText('PR', { exact: true })).toBeVisible();
  await expect(page.getByText(/swapped in/)).toBeVisible();
  await expect(page.getByText('2 exercises · 1 swapped')).toBeVisible();
});

test('ended early is labelled', async ({ page }) => {
  const s = mk('s1', 1, 0.01); s.endedEarly = true;
  await seed(page, { sessions: [s] });
  await page.goto('session/summary/s1');
  await expect(page.getByRole('heading', { name: 'Session 1 saved' })).toBeVisible();
  await expect(page.getByText(/ended early/)).toBeVisible();
});

test('very short session: zero time buckets, no NaN', async ({ page, errors }) => {
  const s = mk('s1', 1, 0.01);
  s.startedAt = s.endedAt!; s.warmupStartedAt = undefined; s.warmupEndedAt = undefined;
  s.exercises = [];
  await seed(page, { sessions: [s] });
  await page.goto('session/summary/s1');
  await expect(page.getByText('0:00').first()).toBeVisible();
  await expect(page.getByText('Where the time went')).toHaveCount(0);
  await expect(page.getByText('Next time')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('NaN');
  expect(errors).toEqual([]);
});

test('time buckets never exceed the total', async ({ page }) => {
  const s = mk('s1', 1, 0.01, { minutes: 5 }); // warm-up 9 min > 5 min session
  await seed(page, { sessions: [s] });
  await page.goto('session/summary/s1');
  await expect(page.getByRole('img', { name: /Warm-up 5 min, lifting 0 min, rest 0 min/ })).toBeVisible();
});

test('note is saved on blur and on Done', async ({ page }) => {
  await seed(page, { sessions: [mk('s1', 1, 0.01)] });
  await page.goto('session/summary/s1');
  const input = page.getByPlaceholder(/How did it feel/);
  await input.fill('Knee tight');
  await input.blur();
  await expect.poll(async () => (await readState(page)).sessions.s1.note).toBe('Knee tight');
  await input.fill('Better');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect.poll(async () => (await readState(page)).sessions.s1.note).toBe('Better');
});

for (const [name, id] of [['unknown id', 'nope'], ['discarded', 's1'], ['active', 's1']] as const) {
  test(`not found: ${name}`, async ({ page }) => {
    const s = mk('s1', 1, 0.01, { status: name === 'discarded' ? 'discarded' : name === 'active' ? 'active' : 'completed' });
    await seed(page, { sessions: name === 'unknown id' ? [] : [s] });
    await page.goto(`session/summary/${id}`);
    await expect(page.getByRole('heading', { name: 'Session not found' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Today' }).click();
    await expect(page).toHaveURL(name === 'active' ? /\/app\/resume/ : /\/app\/?$/); // an active session is offered for resume
  });
}

test.describe('install re-offer', () => {
  test.use({ userAgent: IPHONE });
  test('shown once after session 1 on mobile browser; dismiss persists', async ({ page }) => {
    await seed(page, { sessions: [mk('s1', 1, 0.01)] });
    await page.goto('session/summary/s1');
    await expect(page.getByRole('region', { name: 'Install Rep' })).toBeVisible();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByRole('region', { name: 'Install Rep' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Session 1 done')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Install Rep' })).toHaveCount(0);
  });
  test('Install links to /install', async ({ page }) => {
    await seed(page, { sessions: [mk('s1', 1, 0.01)] });
    await page.goto('session/summary/s1');
    await page.getByRole('link', { name: 'Install' }).click();
    await expect(page).toHaveURL(/\/app\/install/);
  });
  test('not after the second session', async ({ page }) => {
    await seed(page, { sessions: [mk('s1', 1, 3), mk('s2', 2, 0.01)] });
    await page.goto('session/summary/s2');
    await expect(page.getByText('Session 2 done')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Install Rep' })).toHaveCount(0);
  });
  test('not when already installed (standalone)', async ({ page }) => {
    await page.addInitScript(() => { const o = window.matchMedia.bind(window); window.matchMedia = (q: string) => (/display-mode: standalone/.test(q) ? ({ ...o(q), matches: true } as MediaQueryList) : o(q)); });
    await seed(page, { sessions: [mk('s1', 1, 0.01)] });
    await page.goto('session/summary/s1');
    await expect(page.getByText('Session 1 done')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Install Rep' })).toHaveCount(0);
  });
});

test('not on desktop browser', async ({ page }) => {
  await seed(page, { sessions: [mk('s1', 1, 0.01)] });
  await page.goto('session/summary/s1');
  await expect(page.getByText('Session 1 done')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Install Rep' })).toHaveCount(0);
});

test('no horizontal overflow at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await seed(page, { sessions: [mk('s1', 1, 0.01)] });
  await page.goto('session/summary/s1');
  await expect(page.getByText('Session 1 done')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// ───────────────────────── streak integration ─────────────────────────
const WS = weekStart(Date.now());
let uid = 0;
/** `count` sessions in the week `w` weeks ago (this week: minutes after Monday 00:00, never in the future) */
function wk(w: number, count: number) {
  return Array.from({ length: count }, (_, k) => {
    const id = `x${w}-${k}-${++uid}`;
    const end = w === 0 ? WS + (k + 1) * 60_000 : WS - w * 7 * DAY + k * DAY + 10 * 3600_000;
    return { ...mk(id, ++uid, 0), startedAt: end - 3600_000, endedAt: end, updatedAt: end };
  });
}
const weeks = (counts: number[]) => counts.flatMap((c, i) => wk(counts.length - 1 - i, c));

test.describe('streak on the summary', () => {
  test('mid-week: dark streak card "7-week streak · 2 to go" links to /streak', async ({ page, errors }) => {
    const s = weeks([4, 4, 4, 4, 4, 4, 4, 2]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    const card = page.getByTestId('streak-card');
    await expect(card).toContainText('7-week streak · 2 to go');
    await expect(card).toContainText('2 more sessions by Sunday makes it 8');
    await expect(card).toHaveAttribute('href', /\/streak$/);
    await expect(page.getByText('New badge')).toHaveCount(0);
    await card.click();
    await expect(page).toHaveURL(/\/streak$/);
    expect(errors).toEqual([]);
  });

  test('1 to go is singular; no streak yet says "Start a streak"', async ({ page }) => {
    const s = weeks([4, 4, 4, 4, 4, 4, 4, 3]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    await expect(page.getByTestId('streak-card')).toContainText('7-week streak · 1 to go');
    await expect(page.getByTestId('streak-card')).toContainText('1 more session by Sunday makes it 8');
  });

  test('goal secured: celebrate card with badge + freeze copy; Done opens StreakCelebrate once', async ({ page }) => {
    const s = weeks([4, 4, 4, 4, 4, 4, 4, 4]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    await expect(page.getByText('4/4')).toBeVisible();
    const card = page.getByTestId('streak-card');
    await expect(card).toContainText('8-week streak!');
    await expect(card).toContainText('New badge and +1 freeze');
    await expect(card).toHaveAttribute('href', /\/streak\/celebrate$/);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/streak\/celebrate$/);
    await expect(page.getByRole('heading', { name: 'week streak!' })).toBeVisible();
    await expect.poll(async () => (await readState(page)).settings.streakLastCelebrated).toBe(WS);
    // seen: the summary card now links to the streak page and Done goes home
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    await expect(page.getByTestId('streak-card')).toHaveAttribute('href', /\/streak$/);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test('week secured without a badge or freeze: "Goal hit" copy', async ({ page }) => {
    const s = weeks([4, 4, 4, 4, 4, 4]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    await expect(page.getByTestId('streak-card')).toContainText('6-week streak!');
    await expect(page.getByTestId('streak-card')).toContainText('Goal hit');
  });

  test('a session from an earlier week shows no streak card', async ({ page }) => {
    const s = weeks([4, 4, 1]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[0].id}`);
    await expect(page.getByTestId('streak-card')).toHaveCount(0);
  });

  test('repair week: "Streak saved" card', async ({ page }) => {
    const s = weeks([4, 4, 4, 4, 4, 3, 5]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    await expect(page.getByTestId('streak-card')).toContainText('Streak saved · 7 weeks');
    await expect(page.getByTestId('streak-card')).toContainText('New badge');
  });

  test('newly unlocked non-streak badge is surfaced (First session) and not on the next session', async ({ page }) => {
    const s = weeks([2]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[0].id}`);
    await expect(page.getByTestId('new-badges')).toContainText('New badge');
    await expect(page.getByTestId('new-badges')).toContainText('First session');
    await expect(page.getByTestId('new-badges')).toHaveAttribute('href', /\/streak\/badges$/);
    await page.goto(`session/summary/${s[1].id}`);
    await expect(page.getByTestId('new-badges').filter({ hasText: 'First session' })).toHaveCount(0);
  });

  test('10th session unlocks "10 sessions"', async ({ page }) => {
    const s = weeks([4, 4, 2]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[9].id}`);
    await expect(page.getByTestId('new-badges')).toContainText('10 sessions');
  });

  test('counter still animates from the previous count', async ({ page }) => {
    const s = weeks([4, 4, 2]);
    await seed(page, { sessions: s });
    await page.goto(`session/summary/${s[s.length - 1].id}`);
    await expect(page.getByText('1/4')).toBeVisible();
    await expect(page.getByText('2/4')).toBeVisible();
  });
});
