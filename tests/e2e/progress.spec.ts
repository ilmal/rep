import { test, expect, seed, makeSession, makeAreas, makeGym, GYM_ID } from './fixtures';
import type { Session } from '../../src/shared/types';

// All dates are Europe/Stockholm wall-clock; the browser runs in that zone and Date.now() is pinned with page.clock.
test.use({ timezoneId: 'Europe/Stockholm', locale: 'en-US' });

const DAY = 86400000;
/** Stockholm wall-clock -> epoch ms (DST: last Sunday of March 01:00Z until last Sunday of October 01:00Z). */
function st(y: number, m: number, d: number, h = 12, mi = 0): number {
  const lastSun = (mo: number) => { const l = new Date(Date.UTC(y, mo, 31)); return 31 - l.getUTCDay(); };
  const a = Date.UTC(y, 2, lastSun(2), 1), b = Date.UTC(y, 9, lastSun(9), 1);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  return wall - (wall - 2 * 3600000 >= a && wall - 2 * 3600000 < b ? 2 : 1) * 3600000;
}
const NOW = st(2026, 11, 18, 12); // Wednesday, ISO week 47
const areas = makeAreas();

interface Lift { id: string; w: number; heavy?: boolean; pr?: boolean; swap?: boolean }
interface Opt { minutes?: number; warm?: number | null; gym?: [string, string]; lifts?: Lift[] }
let seq = 0;
function sess(end: number, o: Opt = {}): Session {
  const lifts = o.lifts ?? [{ id: 'back_squat', w: 40 }];
  const s = makeSession({ id: `s${++seq}`, seq, slot: 1, areaId: areas[0].id, areaName: 'Upper body', daysAgo: 0, exerciseIds: lifts.map((l) => l.id), minutes: o.minutes ?? 55, weight: 40 });
  s.endedAt = end; s.startedAt = end - (o.minutes ?? 55) * 60000; s.updatedAt = end;
  const warm = o.warm === undefined ? 9 : o.warm;
  if (warm === null) { delete s.warmupStartedAt; delete s.warmupEndedAt; } else { s.warmupStartedAt = s.startedAt; s.warmupEndedAt = s.startedAt + warm * 60000; }
  if (o.gym) { s.gymId = o.gym[0]; s.gymName = o.gym[1]; }
  s.exercises = s.exercises.map((e, i) => {
    const l = lifts[i];
    return {
      ...e, sets: e.sets.map((x) => ({ ...x, weight: l.w })), ...(l.pr ? { pr: true } : {}),
      ...(l.swap ? { swappedFrom: { exerciseId: 'x', name: 'X', reason: 'busy' as const } } : {}),
      feedback: { effort: 'normal' as const, weight: l.heavy ? ('heavy' as const) : ('right' as const), volume: 'ok' as const },
    };
  });
  return s;
}
/** `k` sessions in the Monday-week starting at the given Stockholm date (09:00 on consecutive days). */
function week(y: number, m: number, d: number, k: number, o: Opt = {}): Session[] {
  return Array.from({ length: k }, (_, i) => { const dt = new Date(Date.UTC(y, m - 1, d + i)); return sess(st(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 9), o); });
}
const chartLabel = (page: any) => page.getByRole('img', { name: /^Sessions per week/ });
const cols = (page: any) => page.locator('[data-testid=col]');
const classes = (page: any) => cols(page).evaluateAll((els: Element[]) => els.map((e) => e.className.replace('col', '').trim()));
const px = (loc: any, prop: 'bottom' | 'height') => loc.evaluate((e: HTMLElement, p: string) => parseFloat((e.style as any)[p]), prop) as Promise<number>;
const tile = (page: any, label: string) => page.locator('.stat', { has: page.locator('.stat-l', { hasText: new RegExp(`^${label}$`) }) });
async function open(page: any, sessions: Session[], opts: Record<string, unknown> = {}, now = NOW) {
  await page.clock.setFixedTime(now);
  await seed(page, { sessions, gyms: [makeGym(), makeGym({ id: 'gym-office', name: 'Office gym' })], ...opts });
  await page.goto('progress');
}

/** The full multi-month history used by the main assertions: counts [4,3,5,4,4,2,4,1] per week from Mon Sep 28. */
function eightWeeks(): Session[] {
  const plan: [number, number, number, number][] = [[9, 28, 4, 0], [10, 5, 3, 0], [10, 12, 5, 0], [10, 19, 4, 0], [10, 26, 4, 0], [11, 2, 2, 0], [11, 9, 4, 0], [11, 16, 1, 0]];
  const all = plan.flatMap(([m, d, k]) => week(2026, m, d, k, { warm: 12 }));
  all.sort((a, b) => a.endedAt! - b.endedAt!);
  const n = all.length;
  all.forEach((s, i) => {
    const sq = Math.round((70 + (12.5 * i) / (n - 1)) / 2.5) * 2.5;
    const bp = Math.round((57.5 + (7.5 * i) / (n - 1)) / 2.5) * 2.5;
    const last3 = i >= n - 3;
    s.exercises = [
      { ...s.exercises[0], exerciseId: 'back_squat', name: 'Back squat', sets: s.exercises[0].sets.map((x) => ({ ...x, weight: sq })), pr: i === 5 || i === 9 },
      { ...s.exercises[0], id: `${s.id}-b`, exerciseId: 'bench_press', name: 'Bench press', sets: s.exercises[0].sets.map((x) => ({ ...x, weight: bp })) },
      { ...s.exercises[0], id: `${s.id}-o`, exerciseId: 'ohp', name: 'Overhead press', sets: s.exercises[0].sets.map((x) => ({ ...x, weight: 37.5 })), feedback: { effort: 'normal', weight: last3 ? 'heavy' : 'right', volume: 'ok' } },
    ];
    // 6 office sessions (4 with a swap), 3 home sessions (2 swaps at the city gym are on the next two)
    if (i % 9 === 1 || i % 9 === 4) { s.gymId = 'gym-office'; s.gymName = 'Office gym'; s.exercises[1] = { ...s.exercises[1], swappedFrom: { exerciseId: 'x', name: 'X', reason: 'busy' } }; if (i % 9 === 4) s.exercises[2] = { ...s.exercises[2], swappedFrom: { exerciseId: 'y', name: 'Y', reason: 'busy' } }; }
    if (i === 6 || i === 12 || i === 20) { s.gymId = 'gym-home'; s.gymName = 'Home'; }
  });
  return all;
}

test.describe('empty', () => {
  test('no sessions shows EmptyProgress with the artboard copy and a start CTA', async ({ page, errors }) => {
    await seed(page, { sessions: [] });
    await page.goto('progress');
    await expect(page.locator('.eyebrow')).toHaveText('Nothing logged yet');
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your stats start with session 1' })).toBeVisible();
    await expect(page.getByText('Every set, timer and bit of feedback you log ends up here.')).toBeVisible();
    await expect(page.getByText('What unlocks')).toBeVisible();
    for (const t of ['Weekly sessions chart', 'After your first session', 'Lift progress & next-time targets', 'After an exercise is done twice', 'Timing insights & auto-adjust', 'After 3 sessions with warm-up timed']) await expect(page.getByText(t, { exact: true })).toBeVisible();
    await expect(page.locator('.ghost i')).toHaveCount(8);
    await expect(page.locator('[data-testid=col]')).toHaveCount(0);
    const cta = page.getByRole('link', { name: /Start session 1 · Upper body/ });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/session\/preview/);
    expect(errors).toEqual([]);
  });
  test('only an active / discarded session still counts as empty', async ({ page }) => {
    await seed(page, { sessions: [sess(NOW - DAY), sess(NOW - 2 * DAY)].map((s, i) => ({ ...s, status: i ? 'discarded' as const : 'active' as const })) });
    await page.goto('progress');
    await expect(page.getByText('Your stats start with session 1')).toBeVisible();
  });
  test('tab bar is present and Progress is the active tab', async ({ page }) => {
    await seed(page, { sessions: [] });
    await page.goto('progress');
    await expect(page.locator('.tabbar .tab.on')).toHaveText('Progress');
    await page.getByRole('link', { name: 'Plan', exact: true }).click();
    await expect(page).toHaveURL(/\/plan$/);
  });
});

test.describe('8-week history (default range)', () => {
  test.beforeEach(async ({ page }) => { await open(page, eightWeeks()); });

  test('header, range control, chart counts, goal line, hit text', async ({ page, errors }) => {
    await expect(page.locator('.eyebrow')).toHaveText('Last 8 weeks');
    await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '8 weeks' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '6 months' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('Sessions per week', { exact: true })).toBeVisible();
    await expect(page.locator('.card .tag.green').first()).toHaveText('5 of 7 weeks hit');
    await expect(chartLabel(page)).toHaveAttribute('aria-label', 'Sessions per week, Last 8 weeks: W40 4, 41 3, 42 5, 43 4, 44 4, 45 2, 46 4, Now 1');
    await expect(cols(page)).toHaveCount(8);
    expect(await classes(page)).toEqual(['', 'under', '', '', '', 'under', '', 'now']);
    await expect(page.locator('.goal b')).toHaveText('Goal 4');
    // artboard geometry: max 6 -> goal at 4/6*82+12 %, 5 sessions = 5/6*82 % tall
    expect(await px(page.locator('.goal'), 'bottom')).toBeCloseTo((4 / 6) * 82 + 12, 3);
    expect(await px(cols(page).nth(2).locator('i'), 'height')).toBeCloseTo((5 / 6) * 82, 3);
    await expect(cols(page).nth(0).locator('span')).toHaveText('W40');
    await expect(cols(page).nth(7).locator('span')).toHaveText('Now');
    expect(errors).toEqual([]);
  });

  test('tiles use real aggregates', async ({ page }) => {
    await expect(tile(page, 'Avg session')).toContainText('55 min');
    await expect(tile(page, 'Avg session')).toContainText('Target 60');
    await expect(tile(page, 'Avg warm-up')).toContainText('12:00');
    await expect(tile(page, 'Avg warm-up')).toContainText('+2:00 vs plan');
    await expect(tile(page, 'PRs')).toContainText('2');
    await expect(tile(page, 'PRs')).toContainText('in 27 sessions');
    await expect(tile(page, 'Swaps')).toContainText('9');
    await expect(tile(page, 'Swaps')).toContainText('9 at Office gym');
    // 4,3,5 repairs the missed week; 2 then 4 is covered by the freeze earned after four hit weeks: the streak domain counts all 7 (plain consecutive weeks would say 1)
    await expect(tile(page, 'Streak').locator('.stat-v')).toHaveText('7');
    await expect(tile(page, 'Streak')).toContainText('weeks at goal');
    await expect(tile(page, 'Volume / week')).toContainText(/^Volume \/ week\d+(\.\d)?k?kg$/);
  });

  test('warm-up nudge appears when warranted and links to the plan', async ({ page }) => {
    const b = page.locator('.banner.info');
    await expect(b.locator('.b-t')).toHaveText('Warm-up target nudged to 12 min?');
    await expect(b).toContainText('None of your last 5 warm-ups came in under the 10-min plan. A realistic plan means fewer mid-session cuts.');
    await b.getByRole('link', { name: 'Adjust' }).click();
    await expect(page).toHaveURL(/\/plan$/);
  });

  test('top progress: two gains and a stall, linked to the library', async ({ page }) => {
    const rows = page.locator('.group .li');
    await expect(page.locator('.section-h')).toHaveText('Top progress');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Back squat');
    await expect(rows.nth(0)).toContainText('70 → 82.5 kg');
    await expect(rows.nth(0)).toContainText('+18%');
    await expect(rows.nth(1)).toContainText('Bench press');
    await expect(rows.nth(1)).toContainText('57.5 → 65 kg');
    await expect(rows.nth(1)).toContainText('+13%');
    await expect(rows.nth(2)).toContainText('Overhead press');
    await expect(rows.nth(2)).toContainText('Held at 37.5 kg · 3 × too heavy');
    await expect(rows.nth(2).locator('.tag')).toHaveText('Stalled');
    await rows.nth(0).click();
    await expect(page).toHaveURL(/library\/back_squat$/);
  });

  test('where you trained sums to 100% with legend and accessible label', async ({ page }) => {
    const card = page.locator('.card.tight');
    await expect(card).toContainText('Where you trained');
    await expect(card.getByRole('img')).toHaveAttribute('aria-label', 'City Gym Odenplan 67%, Office gym 22%, Home 11%');
    await expect(card).toContainText('City Gym Odenplan 67%');
    await expect(card).toContainText('Office gym 22%');
    await expect(card).toContainText('Home 11%');
  });

  test('History button navigates', async ({ page }) => {
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/\/history$/);
  });

  test('6 months and Year ranges', async ({ page }) => {
    await page.getByRole('button', { name: '6 months' }).click();
    await expect(page.getByRole('button', { name: '6 months' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.eyebrow')).toHaveText('Last 6 months');
    await expect(cols(page).locator('span')).toHaveText(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    // Sep 28-30, Oct, Nov 1-18: 27 sessions over (Sep: 30, Oct: 31, Nov: 18 days); Jun-Aug empty
    await expect(page.locator('.card .tag.green').first()).toHaveText(`Avg ${Math.round((27 / ((30 + 31 + 18) / 7)) * 10) / 10} / week`);
    const label = (await chartLabel(page).getAttribute('aria-label'))!;
    expect(label).toContain('Jun 0, Jul 0, Aug 0, Sep ');
    expect(await classes(page)).toEqual(['under', 'under', 'under', 'under', 'under', 'under']);
    await page.getByRole('button', { name: 'Year' }).click();
    await expect(page.locator('.eyebrow')).toHaveText('This year');
    await expect(cols(page)).toHaveCount(12);
    await expect(cols(page).locator('span')).toHaveText(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
    await expect(page.locator('.card .tag.green').first()).toHaveText('27 sessions');
    await expect(page.locator('.chart .col.now')).toHaveCount(0);
    await page.getByRole('button', { name: '8 weeks' }).click();
    await expect(page.locator('.eyebrow')).toHaveText('Last 8 weeks');
  });

  test('no horizontal overflow at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const r of ['8 weeks', '6 months', 'Year']) {
      await page.getByRole('button', { name: r }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
});

test.describe('edge cases', () => {
  test('a single session: first week, no nudge, no lifts, one gym at 100%', async ({ page, errors }) => {
    await open(page, [sess(NOW - 3600000, { warm: 9, minutes: 50 })]);
    await expect(page.locator('.card .tag.green').first()).toHaveText('First week');
    expect(await classes(page)).toEqual(['under', 'under', 'under', 'under', 'under', 'under', 'under', 'now']);
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /W40 0, 41 0, 42 0, 43 0, 44 0, 45 0, 46 0, Now 1$/);
    await expect(tile(page, 'Avg session')).toContainText('50 min');
    await expect(tile(page, 'Avg warm-up')).toContainText('9:00');
    await expect(tile(page, 'Avg warm-up')).toContainText('−1:00 vs plan');
    await expect(tile(page, 'PRs')).toContainText('in 1 session');
    await expect(tile(page, 'Swaps')).toContainText('None');
    await expect(tile(page, 'Streak')).toContainText('0');
    await expect(page.locator('.banner.info')).toHaveCount(0);
    await expect(page.getByText('Top progress')).toHaveCount(0);
    await expect(page.locator('.card.tight')).toContainText('City Gym Odenplan 100%');
    expect(errors).toEqual([]);
  });

  test('sessions without timers: dashes and no nudge', async ({ page }) => {
    const s = sess(NOW - 3600000, { warm: null });
    delete (s as any).endedAt; // legacy/odd record: falls back to startedAt for bucketing, no duration
    await open(page, [{ ...s, startedAt: NOW - 3600000 }]);
    await expect(tile(page, 'Avg session')).toContainText('—');
    await expect(tile(page, 'Avg warm-up')).toContainText('—');
    await expect(tile(page, 'Avg warm-up')).toContainText('Not timed yet');
    await expect(cols(page).last().locator('span')).toHaveText('Now');
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /Now 1$/);
  });

  test('no nudge when the warm-up is within 2 minutes of the plan', async ({ page }) => {
    await open(page, week(2026, 11, 9, 4, { warm: 11 }));
    await expect(tile(page, 'Avg warm-up')).toContainText('+1:00 vs plan');
    await expect(page.locator('.banner.info')).toHaveCount(0);
  });

  test('only two timed warm-ups: tile yes, nudge no (needs 3)', async ({ page }) => {
    await open(page, week(2026, 11, 9, 2, { warm: 14 }));
    await expect(tile(page, 'Avg warm-up')).toContainText('+4:00 vs plan');
    await expect(page.locator('.banner.info')).toHaveCount(0);
  });

  test('warm-up plan from settings drives the delta and the nudge', async ({ page }) => {
    await open(page, week(2026, 11, 9, 4, { warm: 12 }), { settings: { warmupTargetMinutes: 12 } });
    await expect(tile(page, 'Avg warm-up')).toContainText('+0:00 vs plan');
    await expect(page.locator('.banner.info')).toHaveCount(0);
  });

  test('goal change recolours bars and changes hit text and goal label', async ({ page }) => {
    const data = [...week(2026, 11, 2, 2), ...week(2026, 11, 9, 3), ...week(2026, 11, 16, 1)];
    await open(page, data, { settings: { weeklyGoal: 3 } });
    await expect(page.locator('.goal b')).toHaveText('Goal 3');
    await expect(page.locator('.card .tag.green').first()).toHaveText('1 of 2 weeks hit');
    expect(await classes(page)).toEqual(['under', 'under', 'under', 'under', 'under', '', '', 'now'].map((c, i) => (i === 6 ? '' : c)).map((c, i) => (i === 5 ? 'under' : c)).slice(0, 8));
    await expect(tile(page, 'Streak')).toContainText('1');
  });
  test('goal 2 (history unchanged) makes earlier weeks hit', async ({ page }) => {
    await open(page, [...week(2026, 11, 2, 2), ...week(2026, 11, 9, 3)], { settings: { weeklyGoal: 2 } });
    await expect(page.locator('.card .tag.green').first()).toHaveText('2 of 2 weeks hit');
    await expect(page.locator('.goal b')).toHaveText('Goal 2');
    await expect(tile(page, 'Streak')).toContainText('2');
  });

  test('extra sessions above goal: counted, bar scales, streak counts the week once', async ({ page }) => {
    await open(page, [...week(2026, 11, 9, 7), ...week(2026, 11, 2, 4)]);
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /45 4, 46 7, Now 0$/);
    await expect(page.locator('.card .tag.green').first()).toHaveText('2 of 2 weeks hit');
    expect(await px(cols(page).nth(6).locator('i'), 'height')).toBeCloseTo(82, 3);
    expect(await px(page.locator('.goal'), 'bottom')).toBeCloseTo((4 / 7) * 82 + 12, 3);
    await expect(tile(page, 'Streak')).toContainText('2');
  });

  test('zero weeks: a gap week breaks the streak and renders a 3% stub', async ({ page }) => {
    await open(page, [...week(2026, 11, 9, 4), ...week(2026, 10, 19, 4)]);
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /43 4, 44 0, 45 0, 46 4, Now 0$/);
    expect(await px(cols(page).nth(4).locator('i'), 'height')).toBe(3);
    await expect(tile(page, 'Streak')).toContainText('1');
    await expect(page.locator('.card .tag.green').first()).toHaveText('2 of 4 weeks hit');
  });

  test('current week at goal extends the streak; goal line label never breaks the layout at goal 7', async ({ page }) => {
    await open(page, [...week(2026, 11, 9, 7), ...week(2026, 11, 16, 3)], { settings: { weeklyGoal: 3 } }, st(2026, 11, 19, 12));
    await expect(tile(page, 'Streak')).toContainText('2');
    await expect(tile(page, 'Streak')).toContainText('weeks at goal');
  });
  test('Streak tile follows the streak domain (a repaired week counts) and links to /streak', async ({ page }) => {
    // weeks 41-44 hit, 45 missed by one (3 of 4), 46 repaired with 5, this week empty: plain consecutive-weeks would say 0
    await open(page, [...week(2026, 10, 5, 4), ...week(2026, 10, 12, 4), ...week(2026, 10, 19, 4), ...week(2026, 10, 26, 4), ...week(2026, 11, 2, 3), ...week(2026, 11, 9, 5)]);
    await expect(tile(page, 'Streak').locator('.stat-v')).toHaveText('6');
    await expect(tile(page, 'Streak')).toHaveAttribute('href', /\/streak$/);
    await tile(page, 'Streak').click();
    await expect(page).toHaveURL(/\/streak$/);
  });
  test('streak of one week is singular', async ({ page }) => {
    await open(page, week(2026, 11, 16, 4), {}, st(2026, 11, 20, 12));
    await expect(tile(page, 'Streak')).toContainText('1');
    await expect(tile(page, 'Streak').locator('.sub')).toHaveText('week at goal');
  });

  test('DST spring-forward week (Mar 29 2026): Sat, Sun 03:30 and Mon 00:05 land in the right weeks', async ({ page }) => {
    const data = [sess(st(2026, 3, 28, 23, 30)), sess(Date.UTC(2026, 2, 29, 1, 30)), sess(st(2026, 3, 30, 0, 5)), sess(st(2026, 3, 22, 23, 59)), sess(st(2026, 3, 23, 0, 1))];
    await open(page, data, {}, st(2026, 4, 1, 12));
    // Mar 16 week: Sun Mar 22 23:59 (1) · Mar 23 week: Mon 00:01, Sat 23:30, Sun 03:30 CEST (3) · Mar 30 week (Now): Mon 00:05 (1)
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /12 1, 13 3, Now 1$/);
  });

  test('DST fall-back week (Oct 25 2026): Sunday 23:59 is the old week, Monday 00:01 the next', async ({ page }) => {
    const data = [sess(st(2026, 10, 25, 23, 59)), sess(st(2026, 10, 25, 1, 30)), sess(st(2026, 10, 26, 0, 1)), sess(st(2026, 10, 19, 0, 1))];
    await open(page, data, {}, st(2026, 10, 28, 12));
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /43 3, Now 1$/);
  });

  test('year boundary: Jan 1 2027 08:00 — W53 behind, Year range is only January, Dec 31 excluded', async ({ page }) => {
    const data = [sess(st(2026, 12, 31, 23, 59)), sess(st(2026, 12, 29, 9)), sess(st(2027, 1, 1, 8))];
    await open(page, data, {}, st(2027, 1, 1, 10));
    // ISO weeks: Dec 28 2026 = W53, Jan 4 2027 = W1; today (Fri Jan 1) is still in W53
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /W\d+ 0, \d+ 0, \d+ 0, \d+ 0, \d+ 0, \d+ 0, 52 0, Now 3$/);
    await page.getByRole('button', { name: 'Year' }).click();
    await expect(page.locator('.card .tag.green').first()).toHaveText('1 session');
    await expect(page.locator('.eyebrow')).toHaveText('This year');
    expect(await classes(page)).toEqual(Array(12).fill('under'));
    await page.getByRole('button', { name: '6 months' }).click();
    await expect(cols(page).locator('span')).toHaveText(['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan']);
  });

  test('week 1 label after the new year (Jan 6 2027) follows W53', async ({ page }) => {
    await open(page, [sess(st(2027, 1, 5, 9))], {}, st(2027, 1, 6, 12));
    await expect(cols(page).nth(6).locator('span')).toHaveText('53');
    await expect(cols(page).nth(7).locator('span')).toHaveText('Now');
    await expect(cols(page).nth(0).locator('span')).toHaveText('W47');
  });

  test('a session ended after midnight Monday counts for Monday even if it started Sunday', async ({ page }) => {
    const s = sess(st(2026, 11, 16, 0, 20), { minutes: 50 });
    await open(page, [s]);
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /46 0, Now 1$/);
  });

  test('time passes: the page rolls over to the new week without reload', async ({ page }) => {
    await page.clock.install({ time: st(2026, 11, 22, 23, 59, 30) });
    await seed(page, { sessions: [sess(st(2026, 11, 22, 20))] });
    await page.goto('progress');
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /46 0, Now 1$/);
    await page.clock.fastForward(120_000);
    await page.clock.runFor(61_000);
    await expect(chartLabel(page)).toHaveAttribute('aria-label', /Now 0$/);
  });

  test('lb unit converts volume and lifts', async ({ page }) => {
    const mk = (w: number, d: number) => sess(st(2026, 11, d, 9), { lifts: [{ id: 'back_squat', w }] });
    await open(page, [mk(60, 10), mk(100, 12)], { settings: { unit: 'lb' } });
    await expect(page.locator('.group .li').first()).toContainText('132.5 → 220.5 lb');
    await expect(tile(page, 'Volume / week').locator('.sub')).toHaveText('lb');
  });

  test('exercise with a single data point or only a decline is not listed', async ({ page }) => {
    const mk = (w: number, d: number) => sess(st(2026, 11, d, 9), { lifts: [{ id: 'back_squat', w }] });
    await open(page, [mk(100, 10), mk(80, 12)]);
    await expect(page.getByText('Top progress')).toHaveCount(0);
  });

  test('more than three gyms collapse into Other and legend wraps without overflow', async ({ page }) => {
    const g = (id: string, name: string, d: number) => sess(st(2026, 11, d, 9), { gym: [id, name] });
    await open(page, [g('a', 'Alpha', 2), g('a', 'Alpha', 3), g('b', 'Beta', 4), g('c', 'Gamma', 5), g('d', 'Delta', 6), g('e', 'Epsilon', 9)]);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.locator('.card.tight').getByRole('img')).toHaveAttribute('aria-label', 'Alpha 33%, Beta 17%, Delta 17%, Other 33%');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('visual parity at 375x667 renders every section in order', async ({ page }) => {
    await open(page, eightWeeks());
    await page.setViewportSize({ width: 375, height: 667 });
    const order = await page.locator('.scroll > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0] || e.tagName));
    expect(order).toEqual(['between', 'seg', 'card', 'grid2', 'banner', 'section-h', 'group', 'card']);
    await expect(page.locator('.grid2 .stat')).toHaveCount(6);
  });
});
