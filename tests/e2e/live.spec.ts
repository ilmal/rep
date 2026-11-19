import { test, expect, seed, banBodyweight, makeSession, makeAreas, makeGym, readState, GYM_ID, DAY, type SeedOpts } from './fixtures';
import type { Page } from '@playwright/test';
import { T0, LOWER, live, history, open, sess, settled, stubVibrate, vibrations, startSet, h1 } from './live-helpers';

// ───────────────────────── Up next ─────────────────────────
test.describe('Up next', () => {
  test('shows everything the design lists and nothing else', async ({ page }) => {
    await open(page, live({ exOver: () => ({}) }), { sessions: [history('back_squat', 80, 'light') as never] });
    await expect(page.getByText('Up next · exercise 1 of 4')).toBeVisible();
    await expect(h1(page)).toHaveText('Back squat');
    await expect(page.getByText('Barbell (20 kg)', { exact: true })).toBeVisible();
    await expect(page.getByText('Squat rack', { exact: true })).toBeVisible();
    await expect(page.getByText('Today', { exact: true })).toBeVisible();
    await expect(page.getByTestId('plan-line')).toHaveText('4 × 6 @ 82.5 kg');
    await expect(page.getByText('2:00 rest between sets · about 11 min')).toBeVisible();
    await expect(page.getByText('Last time 3 × 8 @ 80 kg felt too light. +2.5 kg today.')).toBeVisible();
    await expect(page.getByText('First time doing this')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Swap' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start set 1' })).toBeVisible();
    // not on this screen: steppers, set counter, options
    await expect(page.getByRole('button', { name: 'More weight' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Exercise options/ })).toHaveCount(0);
  });

  test('first time: starting-guess note, no last-time line', async ({ page }) => {
    await open(page, live());
    await expect(page.getByText('First time doing this')).toBeVisible();
    await expect(page.getByText(/The weight is a starting guess/)).toBeVisible();
    await expect(page.locator('.banner.ok, .banner.warn')).toHaveCount(0);
  });

  test('a progress entry (calibrated before) is not "first time" either', async ({ page }) => {
    await page.clock.install({ time: T0 });
    const st = { sessions: [live() as never] } as SeedOpts;
    await seed(page, st);
    await page.addInitScript(() => {
      const raw = localStorage.getItem('rep-state-v1'); if (!raw || localStorage.getItem('__p')) return;
      const s = JSON.parse(raw); s.progress = { back_squat: { exerciseId: 'back_squat', weight: 82.5, reps: 6, sets: 4, updatedAt: 1 } };
      localStorage.setItem('rep-state-v1', JSON.stringify(s)); localStorage.setItem('__p', '1');
    });
    await page.goto('session/live');
    await expect(page.getByText('First time doing this')).toHaveCount(0);
  });

  for (const [name, w, fb, cls, text] of [
    ['up', 80, 'light', 'ok', 'Last time 3 × 8 @ 80 kg felt too light. +2.5 kg today.'],
    ['same', 82.5, 'right', 'info', 'Last time 3 × 8 @ 82.5 kg felt just right. Same weight, aim for all 6s.'],
    ['down', 85, 'heavy', 'warn', 'Last time 3 × 8 @ 85 kg felt too heavy. −2.5 kg today.'],
  ] as const) {
    test(`last-time banner: ${name}`, async ({ page }) => {
      await open(page, live(), { sessions: [history('back_squat', w, fb) as never] });
      const b = page.locator(`.banner.${cls}`).filter({ hasText: text });
      await expect(b).toBeVisible();
    });
  }

  test('Start set 1 moves to the set screen and persists the begun flag', async ({ page }) => {
    await open(page, live());
    await startSet(page);
    await expect(page.getByText('Exercise 1 of 4')).toBeVisible();
    await expect(page.getByText('Set 1 of 4')).toBeVisible();
    await expect(page.getByText('Up next · exercise')).toHaveCount(0);
    await settled(page, (s) => !!s.exercises[0].begunAt);
  });

  test('Skip marks it skipped and opens the next exercise on Up next', async ({ page }) => {
    await open(page, live());
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(page.getByText('Back squat skipped')).toBeVisible();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await expect(h1(page)).toHaveText('Romanian deadlift');
    await settled(page, (s) => s.exercises[0].status === 'skipped' && s.cursor === 1 && s.exercises[1].status === 'active');
  });

  test('Swap opens the swap sheet directly; no equipment is touched until an alternative is picked', async ({ page }) => {
    await open(page, live());
    await page.getByRole('button', { name: 'Swap' }).click();
    await expect(page.getByRole('dialog', { name: 'Exercise options' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Swap Back squat' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const s = await sess(page);
    expect(s.busyEquip).toEqual([]);
  });

  test('exercise 2 is Up next again after feedback, with its own last-time line', async ({ page }) => {
    await open(page, live({ phase: 'fb', exOver: (i) => (i === 0 ? { sets: [1, 2, 3, 4].map((k) => ({ weight: 82.5, reps: 6, doneAt: T0 - 300000 + k * 1000, restSec: 90 })) } : {}) }),
      { sessions: [history('rdl', 70, 'right') as never] });
    await page.getByRole('button', { name: 'Just right' }).click();
    await page.getByRole('button', { name: /^Save · next: Romanian deadlift/ }).click();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await expect(page.getByText('Last time 3 × 8 @ 70 kg felt just right. Same weight, aim for all 8s.')).toBeVisible();
  });
});

// ───────────────────────── the set screen ─────────────────────────
const setScreen = (o: Parameters<typeof live>[0] = {}) => live({ ...o, exOver: (i) => ({ ...(i === 0 ? { begunAt: T0 - 1000 } : {}), ...(o.exOver?.(i) ?? {}) }) });
const weightVal = (page: Page) => page.getByTestId('weight-val');
const repsVal = (page: Page) => page.getByTestId('reps-val');
const done = (page: Page, n = 1) => page.getByRole('button', { name: `Done · set ${n}` });

test.describe('Set screen', () => {
  test('shows only name, set n of N, weight, reps (target), Done and the options button', async ({ page }) => {
    await open(page, setScreen());
    await expect(page.getByText('Exercise 1 of 4')).toBeVisible();
    await expect(h1(page)).toHaveText('Back squat');
    await expect(page.getByText('Set 1 of 4')).toBeVisible();
    await expect(page.locator('.setdots span')).toHaveCount(4);
    await expect(page.locator('.setdots span.now')).toHaveCount(1);
    await expect(page.getByText('Weight', { exact: true })).toBeVisible();
    await expect(weightVal(page)).toContainText('82.5');
    await expect(page.getByText('Reps · target 6')).toBeVisible();
    await expect(repsVal(page)).toHaveText('6');
    await expect(done(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /Exercise options/ })).toBeVisible();
    await expect(page.getByText('Pick a weight you could lift')).toBeVisible(); // first time, set 1
    await expect(page.getByText('about 8 times')).toBeVisible();
    await expect(page.getByText('Rest', { exact: true })).toHaveCount(0);
  });

  test('first-set hint disappears once a history exists', async ({ page }) => {
    await open(page, setScreen(), { sessions: [history('back_squat', 80, 'right') as never] });
    await expect(page.getByText('Pick a weight you could lift')).toHaveCount(0);
  });

  test('weight stepper uses the exercise step, floors at BW; reps stepper floors at 0', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'back_squat', sets: 3, reps: 6, w: 5 }] }));
    await page.getByRole('button', { name: 'More weight' }).click();
    await expect(weightVal(page)).toContainText('7.5');
    await page.getByRole('button', { name: 'Less weight' }).click({ clickCount: 2 });
    await expect(weightVal(page)).toContainText('2.5');
    await page.getByRole('button', { name: 'Less weight' }).click({ clickCount: 3 });
    await expect(weightVal(page)).toHaveText('BW');
    await page.getByRole('button', { name: 'More weight' }).click();
    await expect(weightVal(page)).toContainText('2.5');
    await page.getByRole('button', { name: 'More reps' }).click();
    await expect(repsVal(page)).toHaveText('7');
    await page.getByRole('button', { name: 'Fewer reps' }).click({ clickCount: 9 });
    await expect(repsVal(page)).toHaveText('0');
  });

  test('Done logs exactly what the steppers show and starts the rest', async ({ page }) => {
    await open(page, setScreen());
    await page.getByRole('button', { name: 'More weight' }).click({ clickCount: 2 });
    await page.getByRole('button', { name: 'Fewer reps' }).click();
    await expect(weightVal(page)).toContainText('87.5');
    await done(page).click();
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await settled(page, (s) => s.phase === 'rest' && s.exercises[0].sets.length === 1);
    const s = await sess(page);
    expect(s.exercises[0].sets[0]).toMatchObject({ weight: 87.5, reps: 5 });
    expect(s.restTotalSec).toBe(120);
    expect(s.restEndsAt).toBeGreaterThan(T0);
  });

  test('reps-only exercise (push-ups): no weight card, logs weight 0', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'pushup', sets: 3, reps: 12, w: 0, rest: 60 }, ...LOWER.slice(1)] }));
    await expect(page.getByText('Weight', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More weight' })).toHaveCount(0);
    await expect(page.getByText('Reps · target 12')).toBeVisible();
    await expect(page.getByText('Pick a weight you could lift')).toHaveCount(0);
    await page.getByRole('button', { name: 'More reps' }).click({ clickCount: 3 });
    await expect(repsVal(page)).toHaveText('15');
    await done(page).click();
    await settled(page, (s) => s.exercises[0].sets.length === 1);
    expect((await sess(page)).exercises[0].sets[0]).toMatchObject({ weight: 0, reps: 15 });
    await expect(page.getByTestId('next-line')).toHaveText('Bodyweight × 12');
    await expect(page.getByTestId('logged-line')).toHaveText('Logged set 1: 15');
  });

  test('time exercise (plank): seconds stepper moves by 5, label and unit', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'plank', sets: 3, reps: 45, w: 0, rest: 45 }, ...LOWER.slice(1)] }));
    await expect(page.getByText('Seconds · target 45')).toBeVisible();
    await expect(repsVal(page)).toHaveText('45s');
    await page.getByRole('button', { name: 'More seconds' }).click({ clickCount: 2 });
    await expect(repsVal(page)).toHaveText('55s');
    await page.getByRole('button', { name: 'Fewer seconds' }).click();
    await expect(repsVal(page)).toHaveText('50s');
    await done(page).click();
    await expect(page.getByTestId('logged-line')).toHaveText('Logged set 1: 50 s');
    await expect(page.getByTestId('next-line')).toHaveText('45 s');
    await settled(page, (s) => s.exercises[0].sets.length === 1);
    expect((await sess(page)).exercises[0].sets[0]).toMatchObject({ weight: 0, reps: 50 });
  });

  test('per-hand exercise: "each hand" label and kg each in the plan', async ({ page }) => {
    await open(page, live({ cursor: 2, exOver: (i) => (i === 2 ? { status: 'active', begunAt: T0 - 1 } : i < 2 ? { status: 'done' } : {}) }));
    await expect(page.getByText('Weight · each hand')).toBeVisible();
    await expect(page.getByText('Exercise 3 of 4')).toBeVisible();
    await page.getByRole('button', { name: 'More weight' }).click();
    await expect(weightVal(page)).toContainText('12');
  });

  test('lb: weights display and step in pounds, stored in kg', async ({ page }) => {
    await open(page, setScreen(), { settings: { unit: 'lb' } });
    // 82.5 kg = 181.9 lb -> 182 lb on the stepper (0.5 lb resolution)
    await expect(weightVal(page)).toHaveText('182lb');
    await page.getByRole('button', { name: 'More weight' }).click();
    await expect(weightVal(page)).toHaveText('187lb');
    await page.getByRole('button', { name: 'Less weight' }).click({ clickCount: 2 });
    await expect(weightVal(page)).toHaveText('177lb');
    await done(page).click();
    await expect(page.getByTestId('logged-line')).toHaveText('Logged set 1: 177 × 6');
    await expect(page.getByTestId('next-line')).toHaveText('177 lb × 6');
    await settled(page, (s) => s.exercises[0].sets.length === 1);
    const w = (await sess(page)).exercises[0].sets[0].weight;
    expect(w).toBeCloseTo(177 * 0.45359237, 1);
  });

  test('lb on the Up next plan line', async ({ page }) => {
    await open(page, live(), { settings: { unit: 'lb' } });
    await expect(page.getByTestId('plan-line')).toHaveText('4 × 6 @ 182 lb');
  });

  test('the next set is prefilled with the last logged weight, reps back to target', async ({ page }) => {
    await open(page, setScreen());
    await page.getByRole('button', { name: 'More weight' }).click();
    await page.getByRole('button', { name: 'More reps' }).click();
    await done(page).click();
    await page.getByRole('button', { name: 'Start set 2 now' }).click();
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    await expect(weightVal(page)).toContainText('85');
    await expect(repsVal(page)).toHaveText('6');
    await expect(page.locator('.setdots span.done')).toHaveCount(1);
  });
});

// ───────────────────────── rest ─────────────────────────
const rest = (leftSec = 100, total = 120, over: Record<string, unknown> = {}) => live({
  phase: 'rest', over: { restEndsAt: T0 + leftSec * 1000, restTotalSec: total, ...over },
  exOver: (i) => (i === 0 ? { begunAt: T0 - 150000, sets: [{ weight: 82.5, reps: 6, doneAt: T0 - (total - leftSec) * 1000, startedAt: T0 - 150000 }] } : {}),
});
const clock = (page: Page) => page.getByRole('timer').filter({ hasText: /^\d:\d\d$/ });

test.describe('Rest', () => {
  test('ring countdown from the timestamp, total, next set preview, logged line', async ({ page }) => {
    await open(page, rest(100, 120));
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await expect(clock(page)).toHaveText('1:40');
    await expect(page.getByText('of 2:00')).toBeVisible();
    await expect(page.getByText('Up next · set 2 of 4')).toBeVisible();
    await expect(page.getByTestId('next-line')).toHaveText('82.5 kg × 6');
    await expect(page.getByText('Adjust when you start')).toBeVisible();
    await expect(page.getByTestId('logged-line')).toHaveText('Logged set 1: 82.5 × 6');
    await expect(page.getByRole('button', { name: 'Start set 2 now' })).toBeVisible();
    // ring: 100/120 left -> offset = 653.45 * (1 - 100/120)
    const off = Number(await page.getByTestId('ring').getAttribute('stroke-dashoffset'));
    expect(off).toBeGreaterThan(105); expect(off).toBeLessThan(113);
    await page.clock.fastForward(30_000);
    await expect(clock(page)).toHaveText('1:10');
    const off2 = Number(await page.getByTestId('ring').getAttribute('stroke-dashoffset'));
    expect(off2).toBeGreaterThan(off);
  });

  test('±15 s adjusts the timestamp (and the total when extended)', async ({ page }) => {
    await open(page, rest(100, 120));
    await page.getByRole('button', { name: '15 seconds less' }).click();
    await expect(clock(page)).toHaveText('1:25');
    await page.getByRole('button', { name: '15 seconds more' }).click({ clickCount: 3 });
    await expect(clock(page)).toHaveText('2:10');
    await expect(page.getByText('of 2:10')).toBeVisible();
    await settled(page, (s) => s.restTotalSec === 130);
  });

  test('−15 s never ends the rest by itself (floor 1 s)', async ({ page }) => {
    await open(page, rest(10, 120));
    await page.getByRole('button', { name: '15 seconds less' }).click();
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await expect(clock(page)).toHaveText(/0:0[01]/);
  });

  test('auto-returns to the set when the rest runs out: beep/vibrate once, toast, rest time recorded', async ({ page }) => {
    await stubVibrate(page);
    await open(page, rest(20, 120));
    await page.clock.fastForward(21_000);
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    await expect(page.getByText('Rest over. Go!')).toBeVisible();
    expect(await vibrations(page)).toBe(1);
    await page.clock.fastForward(5000);
    expect(await vibrations(page)).toBe(1);
    await settled(page, (s) => s.phase === 'set' && s.exercises[0].sets[0].restSec >= 119);
    expect((await sess(page)).restEndsAt).toBeUndefined();
  });

  test('sound off: no vibration on auto-return', async ({ page }) => {
    await stubVibrate(page);
    await open(page, rest(5, 120), { settings: { sound: false } });
    await page.clock.fastForward(6_000);
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    expect(await vibrations(page)).toBe(0);
  });

  test('"Start set 2 now" returns immediately, without an alert', async ({ page }) => {
    await stubVibrate(page);
    await open(page, rest(100, 120));
    await page.getByRole('button', { name: 'Start set 2 now' }).click();
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    expect(await vibrations(page)).toBe(0);
    await settled(page, (s) => s.phase === 'set' && typeof s.exercises[0].sets[0].restSec === 'number');
  });

  test('Undo returns to the set with the logged values filled in', async ({ page }) => {
    await open(page, setScreen());
    await page.getByRole('button', { name: 'More weight' }).click({ clickCount: 2 });
    await page.getByRole('button', { name: 'More reps' }).click();
    await done(page).click();
    await expect(page.getByTestId('logged-line')).toHaveText('Logged set 1: 87.5 × 7');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Set 1 of 4')).toBeVisible();
    await expect(weightVal(page)).toContainText('87.5');
    await expect(repsVal(page)).toHaveText('7');
    await settled(page, (s) => s.phase === 'set' && s.exercises[0].sets.length === 0 && !s.restEndsAt);
    // and the exercise stays on the set screen (not Up next)
    await expect(page.getByText('Up next · exercise')).toHaveCount(0);
  });

  test('a long rest (time jump while the app was in the background) is over on return, silently', async ({ page }) => {
    await stubVibrate(page);
    await open(page, rest(100, 120));
    await page.clock.fastForward(20 * 60_000);
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    expect(await vibrations(page)).toBe(0);
    await expect(page.getByText('Rest over. Go!')).toHaveCount(0);
    await settled(page, (s) => s.phase === 'set');
  });

  test('session clock keeps running from timestamps across the jump', async ({ page }) => {
    await open(page, rest(100, 120));
    await expect(page.getByRole('timer', { name: 'Session time' })).toHaveText('0:10:00');
    await page.clock.fastForward(5 * 60_000);
    await expect(page.getByRole('timer', { name: 'Session time' })).toHaveText('0:15:00');
    await expect(page.getByTestId('time-left')).toHaveText('45 min left');
  });
});

// ───────────────────────── feedback ─────────────────────────
const sets4 = (w = 82.5, r = 6, base = T0) => [1, 2, 3, 4].map((k) => ({ weight: w, reps: r, doneAt: base - 600_000 + k * 120_000, startedAt: base - 600_000, restSec: 90 }));
const fbPhase = (o: Parameters<typeof live>[0] = {}) => live({ phase: 'fb', ...o, exOver: (i) => (i === 0 ? { begunAt: T0 - 1, startedAt: T0 - 480_000, endedAt: T0, sets: sets4() } : {}) });
const saveBtn = (page: Page) => page.locator('.bottombar .btn-primary');
const nextTime = (page: Page) => page.getByTestId('next-time');

test.describe('Feedback', () => {
  test('what you did, three ratings, weight required, waiting state', async ({ page }) => {
    await open(page, fbPhase());
    await expect(page.getByRole('heading', { name: 'Back squat done' })).toBeVisible();
    await expect(page.getByTestId('done-line')).toHaveText('4 × 6 @ 82.5 kg · 8:00 · 2.0k kg');
    for (const g of ['Effort today', 'The weight was', 'Volume']) await expect(page.getByRole('group', { name: g })).toBeVisible();
    await expect(page.getByText('Your energy, not the lift')).toBeVisible();
    await expect(page.getByText('Required', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Right amount' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Too light' })).toHaveAttribute('aria-pressed', 'false');
    await expect(saveBtn(page)).toBeDisabled();
    await expect(saveBtn(page)).toHaveText('Rate the weight to continue');
    await expect(page.getByText('Waiting')).toBeVisible();
    await expect(page.getByText('Rate the weight to see the recommendation.')).toBeVisible();
    await expect(nextTime(page)).toHaveText('4 × 6 @ 82.5 kg');
    // the bottom bar is a real, fixed save + skip; upcoming exercises are not listed
    await expect(page.getByRole('button', { name: 'Skip feedback' })).toBeVisible();
    await expect(page.getByText('Seated leg curl')).toHaveCount(0);
  });

  const cases: [string, string[], string, string, string[]][] = [
    ['too light -> +1 step', ['Too light'], '4 × 6 @ 85 kg', 'Progress', ['Too light: +2.5 kg.']],
    ['just right + all hit -> +1 rep', ['Just right'], '4 × 7 @ 82.5 kg', 'Progress', ['Just right, all sets hit: +1 rep.']],
    ['too heavy -> -1 step', ['Too heavy'], '4 × 6 @ 80 kg', 'Ease off', ['Too heavy: −2.5 kg.']],
    ['chill holds', ['Chill today', 'Just right'], '4 × 6 @ 82.5 kg', 'Hold', ['Held: you took it easy today.']],
    ['chill but too heavy still eases off', ['Chill today', 'Too heavy'], '4 × 6 @ 80 kg', 'Ease off', ['Too heavy: −2.5 kg.']],
    ['too many reps', ['Just right', 'Too many reps'], '4 × 5 @ 82.5 kg', 'Adjusted', ['Fewer reps.']],
    ['too many sets', ['Too heavy', 'Too many sets'], '3 × 6 @ 80 kg', 'Ease off', ['One set less.']],
  ];
  for (const [name, picks, line, tag, why] of cases) {
    test(`live next-time preview: ${name}`, async ({ page }) => {
      await open(page, fbPhase());
      for (const p of picks) await page.getByRole('button', { name: p, exact: true }).click();
      await expect(nextTime(page)).toHaveText(line);
      await expect(page.locator('.card.dark .tag')).toHaveText(tag);
      for (const w of why) await expect(page.locator('.card.dark')).toContainText(w);
      await expect(saveBtn(page)).toBeEnabled();
    });
  }

  test('ratings are single-choice per group', async ({ page }) => {
    await open(page, fbPhase());
    await page.getByRole('button', { name: 'Too light' }).click();
    await page.getByRole('button', { name: 'Too heavy' }).click();
    await expect(page.getByRole('button', { name: 'Too light' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Too heavy' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Save writes feedback + recommendation and opens the next exercise on Up next', async ({ page }) => {
    await open(page, fbPhase());
    await page.getByRole('button', { name: 'Too light' }).click();
    await page.getByRole('button', { name: 'Trying hard' }).click();
    await expect(saveBtn(page)).toHaveText('Save · next: Romanian deadlift');
    await saveBtn(page).click();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await expect(h1(page)).toHaveText('Romanian deadlift');
    await settled(page, (s) => s.exercises[0].status === 'done' && s.cursor === 1);
    const s = await sess(page);
    expect(s.exercises[0].feedback).toEqual({ effort: 'hard', weight: 'light', volume: 'ok' });
    expect(s.exercises[0].recommendation).toMatchObject({ weight: 85, reps: 6, sets: 4, kind: 'weight_up' });
    expect(s.exercises[1].status).toBe('active');
  });

  test('Skip feedback: exercise done, no recommendation, next exercise', async ({ page }) => {
    await open(page, fbPhase());
    await page.getByRole('button', { name: 'Skip feedback' }).click();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await settled(page, (s) => s.exercises[0].status === 'done' && s.cursor === 1);
    const s = await sess(page);
    expect(s.exercises[0].feedback).toBeUndefined();
    expect(s.exercises[0].recommendation).toBeUndefined();
  });

  test('back chevron returns to the last set with its values filled in (undo)', async ({ page }) => {
    await open(page, fbPhase());
    await page.getByRole('button', { name: 'Back to sets' }).click();
    await expect(page.getByText('Set 4 of 4')).toBeVisible();
    await expect(weightVal(page)).toContainText('82.5');
    await settled(page, (s) => s.phase === 'set' && s.exercises[0].sets.length === 3);
  });

  test('the feedback screen has no End/overview (design), and no rest/set controls', async ({ page }) => {
    await open(page, fbPhase());
    await expect(page.getByRole('link', { name: 'End' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Session overview' })).toHaveCount(0);
  });

  test('time exercise done line has seconds and no weight', async ({ page }) => {
    await open(page, live({ phase: 'fb', ex: [{ id: 'plank', sets: 3, reps: 45, w: 0, rest: 45 }, ...LOWER.slice(1)], exOver: (i) => (i === 0 ? { begunAt: 1, startedAt: T0 - 200_000, endedAt: T0, sets: [45, 45, 40].map((r, k) => ({ weight: 0, reps: r, doneAt: T0 - 60_000 + k * 1000 })) } : {}) }));
    await expect(page.getByTestId('done-line')).toHaveText('3 × 45 / 45 / 40 s · 3:20');
    await page.getByRole('button', { name: 'Just right' }).click();
    await expect(nextTime(page)).toHaveText('3 × 45 s');
  });

  test('lb: done line and next time in pounds', async ({ page }) => {
    await open(page, fbPhase(), { settings: { unit: 'lb' } });
    await expect(page.getByTestId('done-line')).toHaveText('4 × 6 @ 182 lb · 8:00 · 4.4k lb');
    await page.getByRole('button', { name: 'Too light' }).click();
    await expect(nextTime(page)).toHaveText('4 × 6 @ 187.5 lb');
  });

  test('last exercise: "Save · last exercise done" then the done state', async ({ page }) => {
    await open(page, live({ phase: 'fb', ex: [LOWER[0]], exOver: () => ({ begunAt: 1, startedAt: T0 - 480_000, endedAt: T0, sets: sets4() }) }));
    await page.getByRole('button', { name: 'Just right' }).click();
    await expect(saveBtn(page)).toHaveText('Save · last exercise done');
    await saveBtn(page).click();
    await expect(page.getByRole('heading', { name: 'All exercises done' })).toBeVisible();
    await settled(page, (s) => s.phase === 'done' && s.exercises[0].status === 'done');
  });

  test('dropped exercises are passed: next is the next TODO exercise', async ({ page }) => {
    await open(page, live({ phase: 'fb', exOver: (i) => (i === 0 ? { begunAt: T0 - 1, startedAt: T0 - 480_000, endedAt: T0, sets: sets4() } : i === 1 ? { status: 'dropped' } : {}) }));
    await page.getByRole('button', { name: 'Just right' }).click();
    await expect(saveBtn(page)).toHaveText('Save · next: Bulgarian split squat');
    await expect(page.getByRole('img', { name: 'Exercise 1 of 3' })).toBeVisible();
    await saveBtn(page).click();
    await expect(h1(page)).toHaveText('Bulgarian split squat');
    await expect(page.getByText('Up next · exercise 2 of 3')).toBeVisible();
  });
});

// ───────────────────────── done ─────────────────────────
const allDone = (over: Record<string, unknown> = {}) => live({ phase: 'done', cursor: 3, over, exOver: (i) => ({ status: i === 2 ? 'skipped' : 'done' }) });

test.describe('Done', () => {
  test('summary line, finish and review', async ({ page }) => {
    await open(page, allDone());
    await expect(page.getByRole('heading', { name: 'All exercises done' })).toBeVisible();
    await expect(page.getByTestId('done-summary')).toHaveText('3 of 4 exercises · 10:00 in the gym');
    await expect(page.getByRole('button', { name: 'Finish session' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review before finishing' })).toHaveAttribute('href', /\/session\/plan$/);
    await expect(page.locator('.segs span.now')).toHaveCount(0);
    await expect(page.locator('.segs span.on')).toHaveCount(4);
  });
  test('over an hour shows h:mm:ss', async ({ page }) => {
    await open(page, allDone({ startedAt: T0 - 3725_000 }));
    await expect(page.getByTestId('done-summary')).toHaveText('3 of 4 exercises · 1:02:05 in the gym');
  });
  test('Finish session completes it and goes to the summary', async ({ page }) => {
    await open(page, allDone());
    await page.getByRole('button', { name: 'Finish session' }).click();
    await expect(page).toHaveURL(/session\/summary\/act$/);
    await settled(page, (s) => s.status === 'completed' && !!s.endedAt);
  });
  test('Review before finishing opens the overview and leaves the session active', async ({ page }) => {
    await open(page, allDone());
    await page.getByRole('link', { name: 'Review before finishing' }).click();
    await expect(page).toHaveURL(/session\/plan$/);
    expect((await sess(page)).status).toBe('active');
  });
});

// ───────────────────────── options sheet ─────────────────────────
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Exercise options' });
const openMenu = (page: Page) => page.getByRole('button', { name: /Exercise options/ }).click();
const item = (page: Page, name: string | RegExp) => sheet(page).getByRole('button', { name }).or(sheet(page).getByRole('link', { name }));

test.describe('Options sheet', () => {
  test('lists every action from the design', async ({ page }) => {
    await open(page, setScreen());
    await openMenu(page);
    await expect(sheet(page).getByRole('heading', { name: 'Back squat' })).toBeVisible();
    for (const n of [/^Swap exercise/, /^It hurts or feels off/, 'Add a set', 'Remove a set', 'Skip this exercise', /^History & how-to/]) await expect(item(page, n)).toBeVisible();
    await expect(sheet(page).getByText("Taken, not here, or you'd rather not")).toBeVisible();
  });

  test('scrim closes it', async ({ page }) => {
    await open(page, setScreen());
    await openMenu(page);
    await page.locator('.scrim').click({ position: { x: 20, y: 20 } });
    await expect(sheet(page)).toHaveCount(0);
  });

  test('Add a set: 4 -> 5, toast, set counter and dots', async ({ page }) => {
    await open(page, setScreen());
    await openMenu(page);
    await item(page, 'Add a set').click();
    await expect(page.getByText('Set added: 5 sets')).toBeVisible();
    await expect(page.getByText('Set 1 of 5')).toBeVisible();
    await expect(page.locator('.setdots span')).toHaveCount(5);
    await settled(page, (s) => s.exercises[0].plannedSets === 5);
  });

  test('Add a set is capped at 12', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'back_squat', sets: 12, reps: 6, w: 60 }] }));
    await openMenu(page);
    await expect(item(page, 'Add a set')).toBeDisabled();
  });

  test('Remove a set: 4 -> 3 with toast; never below the current set', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'back_squat', sets: 2, reps: 6, w: 60 }] }));
    await openMenu(page);
    await item(page, 'Remove a set').click();
    await expect(page.getByText('Set removed: 1 sets')).toBeVisible();
    await expect(page.getByText('Set 1 of 1')).toBeVisible();
    await openMenu(page);
    await expect(item(page, 'Remove a set')).toBeDisabled();
    await settled(page, (s) => s.exercises[0].plannedSets === 1);
  });

  test('Remove a set is disabled when the current set is the last one', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'back_squat', sets: 3, reps: 6, w: 60 }], exOver: (i) => (i === 0 ? { begunAt: 1, sets: [1, 2].map((k) => ({ weight: 60, reps: 6, doneAt: T0 - k * 1000, restSec: 90 })) } : {}) }));
    await expect(page.getByText('Set 3 of 3')).toBeVisible();
    await openMenu(page);
    await expect(item(page, 'Remove a set')).toBeDisabled();
    await expect(item(page, 'Add a set')).toBeEnabled();
  });

  test('added set after the last one: set 4 of 4 -> feedback only after the extra set', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'back_squat', sets: 1, reps: 6, w: 60 }, LOWER[1]] }));
    await openMenu(page);
    await item(page, 'Add a set').click();
    await done(page).click();
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start set 2 now' }).click();
    await done(page, 2).click();
    await expect(page.getByRole('heading', { name: 'Back squat done' })).toBeVisible();
  });

  test('Skip this exercise: toast, next exercise on Up next, status skipped', async ({ page }) => {
    await open(page, setScreen());
    await openMenu(page);
    await item(page, 'Skip this exercise').click();
    await expect(page.getByText('Back squat skipped')).toBeVisible();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await settled(page, (s) => s.exercises[0].status === 'skipped' && s.cursor === 1);
  });

  test('skipping the last exercise ends in the done state', async ({ page }) => {
    await open(page, setScreen({ ex: [LOWER[0]] }));
    await openMenu(page);
    await item(page, 'Skip this exercise').click();
    await expect(page.getByRole('heading', { name: 'All exercises done' })).toBeVisible();
    await expect(page.getByTestId('done-summary')).toHaveText('0 of 1 exercises · 10:00 in the gym');
  });

  test('History & how-to opens the exercise page and the live session is still there', async ({ page }) => {
    await open(page, setScreen());
    await openMenu(page);
    await item(page, /History/).click();
    await expect(page).toHaveURL(/library\/back_squat$/);
    await page.goBack();
    await expect(page.getByText('Set 1 of 4')).toBeVisible();
  });

  test('the sheet is not offered on rest / feedback', async ({ page }) => {
    await open(page, rest(100));
    await expect(page.getByRole('button', { name: /Exercise options/ })).toHaveCount(0);
  });
});

// ───────────────────────── swap reasons ─────────────────────────
const alt = (page: Page, i = 0) => sheet(page).locator('.li').nth(i);
const reason = (page: Page, n: string) => sheet(page).getByRole('group', { name: 'Why swap' }).getByRole('button', { name: n });
async function openSwap(page: Page) { await openMenu(page); await item(page, /^Swap exercise/).click(); }

test.describe('Swap reasons', () => {
  test('sheet: Taken is default, three alternatives with match %, available here, back, none-of-these', async ({ page }) => {
    await open(page, setScreen());
    await openSwap(page);
    await expect(sheet(page).getByRole('heading', { name: 'Swap Back squat' })).toBeVisible();
    await expect(reason(page, 'Taken')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet(page).getByText('Someone’s on it. Swapped for this session only.')).toBeVisible();
    expect(await sheet(page).locator('.li').count()).toBeLessThanOrEqual(3);
    expect(await sheet(page).locator('.li').count()).toBeGreaterThan(0);
    await expect(sheet(page).locator('.li .match').first()).toHaveText(/^\d+%$/);
    await expect(sheet(page).locator('.li .li-s').first()).toContainText('available here');
    // alternatives that need the squat rack are not offered when the rack is "taken"
    await expect(sheet(page).locator('.li-t', { hasText: 'Front squat' })).toHaveCount(0);
    await expect(sheet(page).getByRole('link', { name: 'None of these work' })).toHaveAttribute('href', /\/session\/swap\?none=1$/);
    await sheet(page).getByRole('button', { name: 'Back' }).click();
    await expect(sheet(page).getByRole('heading', { name: 'Back squat' })).toBeVisible();
  });

  test('reason help text changes per reason; durations only for Don’t want', async ({ page }) => {
    await open(page, setScreen());
    await openSwap(page);
    await expect(sheet(page).getByRole('group', { name: 'For how long' })).toHaveCount(0);
    await reason(page, 'Not here').click();
    await expect(sheet(page).getByText('Removes the equipment from City Gym Odenplan, so it’s never planned here again.')).toBeVisible();
    await reason(page, 'Don’t want').click();
    await expect(sheet(page).getByText('Swapped now. Choose how long to stop suggesting it.')).toBeVisible();
    await expect(sheet(page).getByText('Stop suggesting Back squat')).toBeVisible();
    const durs = sheet(page).getByRole('group', { name: 'For how long' });
    await expect(durs.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'true');
    await durs.getByRole('button', { name: 'Never (ban)' }).click();
    await expect(durs.getByRole('button', { name: 'Never (ban)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(durs.getByRole('button', { name: '2 weeks' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('Taken: this session only. busyEquip gets the rack, gym and prefs untouched, new exercise is Up next', async ({ page }) => {
    await open(page, setScreen());
    await openSwap(page);
    const name = (await alt(page).locator('.li-t').textContent())!;
    await alt(page).click();
    await expect(page.getByText(`Swapped to ${name}`, { exact: true })).toBeVisible();
    await expect(h1(page)).toHaveText(name);
    await expect(page.getByText('Up next · exercise 1 of 4')).toBeVisible();
    await settled(page, (s) => s.exercises[0].name === name);
    const st = await readState(page);
    const s = st.sessions.act;
    expect(s.busyEquip).toEqual(['squat_rack']);
    expect(s.exercises[0].swappedFrom).toMatchObject({ exerciseId: 'back_squat', reason: 'busy' });
    expect(s.exercises[0].exerciseId).not.toBe('back_squat');
    expect(st.gyms[GYM_ID].equipment.squat_rack).toBe('ok');
    expect(st.prefs.back_squat).toBeUndefined();
    expect(s.exercises).toHaveLength(4);
  });

  test('Not here: the equipment is removed from the gym (never planned here again), session not marked busy', async ({ page }) => {
    await open(page, setScreen());
    await openSwap(page);
    await reason(page, 'Not here').click();
    const name = (await alt(page).locator('.li-t').textContent())!;
    await alt(page).click();
    await expect(page.getByText(`Swapped to ${name}. Removed from City Gym Odenplan.`)).toBeVisible();
    await settled(page, (s) => s.exercises[0].name === name);
    const st = await readState(page);
    expect(st.gyms[GYM_ID].equipment.squat_rack).toBeUndefined();
    expect(st.sessions.act.busyEquip).toEqual([]);
    expect(st.sessions.act.exercises[0].swappedFrom.reason).toBe('gone');
    expect(st.prefs.back_squat).toBeUndefined();
  });

  for (const [label, word, check] of [
    ['Today', 'for today', (p: any) => expect(p).toMatchObject({ pausedSessions: 1 })],
    ['2 weeks', 'until', (p: any) => { expect(p.pausedUntil).toBeGreaterThan(T0 + 13.9 * DAY); expect(p.pausedUntil).toBeLessThan(T0 + 14.1 * DAY); }],
    ['Never (ban)', 'permanently (banned)', (p: any) => expect(p.avoid).toBe(true)],
  ] as const) {
    test(`Don’t want / ${label}: writes the exercise preference only`, async ({ page }) => {
      await open(page, setScreen());
      await openSwap(page);
      await reason(page, 'Don’t want').click();
      await sheet(page).getByRole('group', { name: 'For how long' }).getByRole('button', { name: label }).click();
      const name = (await alt(page).locator('.li-t').textContent())!;
      await alt(page).click();
      await expect(page.getByText(new RegExp(`Swapped to ${name}\\. Back squat off ${word.replace(/[()]/g, '\\$&')}`))).toBeVisible();
      await settled(page, (s) => s.exercises[0].name === name);
      const st = await readState(page);
      check(st.prefs.back_squat);
      expect(st.sessions.act.busyEquip).toEqual([]);
      expect(st.gyms[GYM_ID].equipment.squat_rack).toBe('ok');
      expect(st.sessions.act.exercises[0].swappedFrom).toMatchObject({ exerciseId: 'back_squat', reason: 'dont' });
    });
  }

  test('Don’t want does not offer the banned/paused exercise back, and Taken may still offer rack lifts', async ({ page }) => {
    await open(page, setScreen());
    await openSwap(page);
    await reason(page, 'Don’t want').click();
    // for "don't want" the rack itself is fine: rack lifts are valid alternatives
    const names = await sheet(page).locator('.li-t').allTextContents();
    expect(names).not.toContain('Back squat');
  });

  test('swapping after sets were logged keeps the done sets (old exercise skipped) and starts the new one on Up next', async ({ page }) => {
    await open(page, setScreen({ exOver: (i) => (i === 0 ? { begunAt: 1, sets: sets4().slice(0, 2) } : {}) }));
    await openSwap(page);
    const name = (await alt(page).locator('.li-t').textContent())!;
    await alt(page).click();
    await expect(h1(page)).toHaveText(name);
    await expect(page.getByText('Up next · exercise 2 of 5')).toBeVisible();
    await settled(page, (s) => s.exercises.length === 5);
    const s = await sess(page);
    expect(s.exercises[0]).toMatchObject({ name: 'Back squat', status: 'skipped' });
    expect(s.exercises[0].sets).toHaveLength(2);
    expect(s.cursor).toBe(1);
  });

  test('no alternative fits: message and a way out', async ({ page }) => {
    await open(page, setScreen(), { gyms: [makeGym({ equipment: { barbell: 'ok', squat_rack: 'ok' } })], prefs: banBodyweight() }); // bodyweight fits anywhere: ban it for a dead end
    await openSwap(page);
    await expect(sheet(page).getByText('Nothing else fits at City Gym Odenplan right now.')).toBeVisible();
    await sheet(page).getByRole('link', { name: 'None of these work' }).click();
    await expect(page).toHaveURL(/session\/swap\?none=1$/);
  });

  test('swap from Up next works the same way', async ({ page }) => {
    await open(page, live());
    await page.getByRole('button', { name: 'Swap' }).click();
    await reason(page, 'Not here').click();
    const name = (await alt(page).locator('.li-t').textContent())!;
    await alt(page).click();
    await expect(h1(page)).toHaveText(name);
    await settled(page, (s) => s.exercises[0].name === name);
    expect((await readState(page)).gyms[GYM_ID].equipment.squat_rack).toBeUndefined();
  });
});

// ───────────────────────── It hurts ─────────────────────────
async function openPain(page: Page) { await openMenu(page); await item(page, /^It hurts or feels off/).click(); }
const pain = (page: Page, n: string | RegExp) => sheet(page).getByRole('button', { name: n });

test.describe('It hurts', () => {
  test('menu: four outcomes, note promise, pause date', async ({ page }) => {
    await open(page, setScreen());
    await openPain(page);
    await expect(sheet(page).getByRole('heading', { name: 'Something feels off' })).toBeVisible();
    await expect(sheet(page).getByText('Stop the set if anything hurts. Pick what to do. A note is saved with the session.')).toBeVisible();
    await expect(pain(page, /^Go lighter/)).toContainText('−20% weight for the remaining sets');
    await expect(pain(page, /^Swap to a gentler alternative/)).toBeVisible();
    await expect(pain(page, /^Skip it today/)).toBeVisible();
    const until = new Date(T0 + 14 * DAY);
    const txt = `It won't be planned until ${until.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][until.getMonth()]}`;
    await expect(pain(page, /^Skip and pause for 2 weeks/)).toContainText(txt);
    await sheet(page).getByRole('button', { name: 'Back' }).click();
    await expect(sheet(page).getByRole('heading', { name: 'Back squat' })).toBeVisible();
  });

  test('Go lighter: -20% rounded to the step, applies to every remaining set, note saved', async ({ page }) => {
    await open(page, setScreen({ over: { note: 'felt tired' } }));
    await openPain(page);
    await pain(page, /^Go lighter/).click();
    await expect(page.getByText('Weight lowered 20%. Note saved.')).toBeVisible();
    await expect(weightVal(page)).toContainText('65'); // 82.5 * 0.8 = 66 -> 65 (2.5 step)
    await done(page).click();
    await expect(page.getByTestId('next-line')).toHaveText('65 kg × 6');
    await page.getByRole('button', { name: 'Start set 2 now' }).click();
    await expect(weightVal(page)).toContainText('65');
    await settled(page, (s) => s.exercises[0].sets.length === 1 && !!s.note);
    const s = await sess(page);
    expect(s.exercises[0].sets[0].weight).toBe(65);
    expect(s.exercises[0].plannedWeight).toBe(65);
    expect(s.note).toMatch(/^felt tired\n\d\d:\d\d Back squat: felt off, went lighter \(−20% weight\)$/);
    expect(s.exercises[0].name).toBe('Back squat');
  });

  test('Go lighter takes the weight currently dialled in', async ({ page }) => {
    await open(page, setScreen());
    await page.getByRole('button', { name: 'More weight' }).click({ clickCount: 2 }); // 87.5
    await openPain(page);
    await pain(page, /^Go lighter/).click();
    await expect(weightVal(page)).toContainText('70'); // 70 exactly
  });

  test('Go lighter mid-exercise (after 2 sets) keeps the lower weight for the rest', async ({ page }) => {
    await open(page, setScreen({ exOver: (i) => (i === 0 ? { begunAt: 1, sets: sets4().slice(0, 2) } : {}) }));
    await expect(weightVal(page)).toContainText('82.5');
    await openPain(page);
    await pain(page, /^Go lighter/).click();
    await expect(weightVal(page)).toContainText('65');
    await done(page, 3).click();
    await page.getByRole('button', { name: 'Start set 4 now' }).click();
    await expect(weightVal(page)).toContainText('65');
  });

  test('Go lighter on a reps-only exercise lowers the rep target by 20%', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'pushup', sets: 3, reps: 12, w: 0 }] }));
    await openPain(page);
    await expect(pain(page, /^Go lighter/)).toContainText('−20% reps for the remaining sets');
    await pain(page, /^Go lighter/).click();
    await expect(page.getByText('Reps lowered 20%. Note saved.')).toBeVisible();
    await expect(page.getByText('Reps · target 10')).toBeVisible();
    await expect(repsVal(page)).toHaveText('10');
  });

  test('Go lighter on a time exercise lowers the seconds target by 20% in 5 s steps', async ({ page }) => {
    await open(page, setScreen({ ex: [{ id: 'plank', sets: 3, reps: 45, w: 0 }] }));
    await openPain(page);
    await pain(page, /^Go lighter/).click();
    await expect(page.getByText('Seconds · target 35')).toBeVisible();
  });

  test('Skip it today: skipped, note, no preference', async ({ page }) => {
    await open(page, setScreen());
    await openPain(page);
    await pain(page, /^Skip it today/).click();
    await expect(page.getByText('Skipped. Note saved for Back squat')).toBeVisible();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await settled(page, (s) => s.exercises[0].status === 'skipped' && s.cursor === 1);
    const st = await readState(page);
    expect(st.sessions.act.note).toMatch(/Back squat: hurt, skipped$/);
    expect(st.prefs.back_squat).toBeUndefined();
  });

  test('Skip and pause for 2 weeks: skipped + pausedUntil + note', async ({ page }) => {
    await open(page, setScreen());
    await openPain(page);
    await pain(page, /^Skip and pause for 2 weeks/).click();
    await expect(page.getByText(/^Back squat paused until \d+ \w+$/)).toBeVisible();
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await settled(page, (s) => s.exercises[0].status === 'skipped');
    const st = await readState(page);
    expect(st.prefs.back_squat.pausedUntil).toBeGreaterThan(T0 + 13.9 * DAY);
    expect(st.prefs.back_squat.pausedUntil).toBeLessThan(T0 + 14.1 * DAY);
    expect(st.sessions.act.note).toMatch(/Back squat: hurt, skipped and paused for 2 weeks$/);
  });

  test('gentler alternative: easier first, no equipment marked, note saved, new exercise Up next', async ({ page }) => {
    await open(page, setScreen());
    await openPain(page);
    await pain(page, /^Swap to a gentler alternative/).click();
    await expect(sheet(page).getByRole('heading', { name: 'Gentler than Back squat' })).toBeVisible();
    await expect(sheet(page).getByRole('group', { name: 'Why swap' })).toHaveCount(0);
    const n = await sheet(page).locator('.li').count();
    expect(n).toBeGreaterThan(0); expect(n).toBeLessThanOrEqual(3);
    const name = (await alt(page).locator('.li-t').textContent())!;
    await alt(page).click();
    await expect(page.getByText(`Swapped to ${name}. Note saved.`)).toBeVisible();
    await expect(h1(page)).toHaveText(name);
    await expect(page.getByText('Up next · exercise 1 of 4')).toBeVisible();
    await settled(page, (s) => s.exercises[0].name === name);
    const st = await readState(page);
    expect(st.sessions.act.busyEquip).toEqual([]);
    expect(st.gyms[GYM_ID].equipment.squat_rack).toBe('ok');
    expect(st.prefs.back_squat).toBeUndefined();
    expect(st.sessions.act.note).toContain(`Back squat: hurt, swapped to ${name}`);
    expect(st.sessions.act.exercises[0].swappedFrom).toMatchObject({ exerciseId: 'back_squat', reason: 'pain' });
  });

  test('notes from several pain actions accumulate', async ({ page }) => {
    await open(page, setScreen());
    await openPain(page);
    await pain(page, /^Go lighter/).click();
    await openPain(page);
    await pain(page, /^Skip it today/).click();
    await settled(page, (s) => s.exercises[0].status === 'skipped');
    const note = (await sess(page)).note as string;
    expect(note.split('\n')).toHaveLength(2);
    expect(note).toContain('went lighter');
    expect(note).toContain('hurt, skipped');
  });
});

// ───────────────────────── top bar, progress, banner, offline ─────────────────────────
test.describe('Top bar, progress, banner, offline', () => {
  test('session name, elapsed, minutes left vs target, overview and End links', async ({ page }) => {
    await open(page, setScreen());
    await expect(page.getByText('Session 2 · Lower body')).toBeVisible();
    await expect(page.getByRole('timer', { name: 'Session time' })).toHaveText('0:10:00');
    await expect(page.getByTestId('time-left')).toHaveText('50 min left');
    await expect(page.getByRole('link', { name: 'Session overview' })).toHaveAttribute('href', /\/session\/plan$/);
    await expect(page.getByRole('link', { name: 'End' })).toHaveAttribute('href', /\/session\/end$/);
    await page.clock.fastForward(60_000);
    await expect(page.getByRole('timer', { name: 'Session time' })).toHaveText('0:11:00');
    await expect(page.getByTestId('time-left')).toHaveText('49 min left');
  });
  test('past the target it says minutes over', async ({ page }) => {
    await open(page, setScreen({ ago: 4000 }));
    await expect(page.getByTestId('time-left')).toHaveText('7 min over');
  });
  test('End and overview navigate', async ({ page }) => {
    await open(page, setScreen());
    await page.getByRole('link', { name: 'End' }).click();
    await expect(page).toHaveURL(/session\/end$/);
  });
  test('progress segments: done/skipped on, current now, todo empty, dropped hidden', async ({ page }) => {
    await open(page, live({ cursor: 2, exOver: (i) => ({ 0: { status: 'done' }, 1: { status: 'skipped' }, 2: { status: 'active', begunAt: 1 } } as Record<number, object>)[i] ?? {} }));
    const segs = page.locator('.segs > span');
    await expect(segs).toHaveCount(4);
    await expect(segs.nth(0)).toHaveClass(/on/);
    await expect(segs.nth(1)).toHaveClass(/on/);
    await expect(segs.nth(2)).toHaveClass(/now/);
    await expect(segs.nth(3)).toHaveClass(/^$/);
    await expect(page.getByRole('img', { name: 'Exercise 3 of 4' })).toBeVisible();
  });
  test('dropped exercises are not counted', async ({ page }) => {
    await open(page, live({ exOver: (i) => (i === 3 ? { status: 'dropped' } : {}) }));
    await expect(page.locator('.segs > span')).toHaveCount(3);
    await expect(page.getByText('Up next · exercise 1 of 3')).toBeVisible();
  });

  const adj = (at: number, extra: Record<string, unknown> = {}) => ({ id: 'a1', at, type: 'trim_rest', savedSec: 90, text: 'Rest trimmed by 30 s to finish near the target.', prevRestSec: { x1: 90, x2: 90 }, ...extra });
  test('auto-adjust banner with Undo restores the plan', async ({ page }) => {
    await open(page, setScreen({ over: { adjustments: [adj(T0 - 60_000)] }, exOver: (i) => (i === 1 || i === 2 ? { restSec: 60 } : {}) }));
    const b = page.locator('.banner').filter({ hasText: 'Plan adjusted' });
    await expect(b).toContainText('Rest trimmed by 30 s to finish near the target.');
    await b.getByRole('button', { name: 'Undo' }).click();
    await expect(b).toHaveCount(0);
    await settled(page, (s) => s.adjustments[0].undone === true);
    const s = await sess(page);
    expect(s.exercises[1].restSec).toBe(90);
    expect(s.exercises[2].restSec).toBe(90);
  });
  test('banner hides after 5 minutes and when already undone', async ({ page }) => {
    await open(page, setScreen({ over: { adjustments: [adj(T0 - 60_000)] } }));
    await expect(page.getByText('Plan adjusted')).toBeVisible();
    await page.clock.fastForward(5 * 60_000);
    await expect(page.getByText('Plan adjusted')).toHaveCount(0);
  });
  test('an undone adjustment shows no banner', async ({ page }) => {
    await open(page, setScreen({ over: { adjustments: [adj(T0 - 60_000, { undone: true })] } }));
    await expect(page.getByText('Plan adjusted')).toHaveCount(0);
  });
  test('banner shows on Up next, rest and feedback too', async ({ page }) => {
    await open(page, live({ over: { adjustments: [adj(T0 - 1000)] } }));
    await expect(page.getByText('Plan adjusted')).toBeVisible();
  });

  test('offline strip appears, work continues and is queued, then green confirmation', async ({ page, context }) => {
    await open(page, setScreen());
    await context.setOffline(true);
    await expect(page.getByText(/^Offline\./)).toBeVisible();
    await done(page).click();
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ queued/)).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText(/^Back online\./)).toBeVisible();
  });
});

// ───────────────────────── guards ─────────────────────────
test.describe('Guards', () => {
  test('warm-up phase goes to the warm-up screen', async ({ page }) => {
    await open(page, live({ phase: 'warmup' }));
    await expect(page).toHaveURL(/session\/warmup$/);
  });
  test('no active session goes home', async ({ page }) => {
    await seed(page, {});
    await page.goto('session/live');
    await expect(page).not.toHaveURL(/session\/live/);
  });
});

// ───────────────────────── reload restores every phase ─────────────────────────
// Real clock here (a reload re-installs the fake clock), timestamps relative to "now".
test.describe('Reload restores exactly', () => {
  const B = () => Date.now();
  const real = (o: Parameters<typeof live>[0]) => live({ base: B(), ...o });
  const openReal = (page: Page, s: ReturnType<typeof live>, opts: SeedOpts = {}) => open(page, s, opts, false);
  const reloaded = async (page: Page) => { await page.waitForTimeout(400); await page.reload(); };

  test('Up next', async ({ page }) => {
    await openReal(page, real({}));
    await reloaded(page);
    await expect(page.getByText('Up next · exercise 1 of 4')).toBeVisible();
    await expect(page.getByText('First time doing this')).toBeVisible();
  });
  test('set screen right after Start, with the dialled-in weight and reps', async ({ page }) => {
    await openReal(page, real({}));
    await startSet(page);
    await page.getByRole('button', { name: 'More weight' }).click({ clickCount: 2 });
    await page.getByRole('button', { name: 'More reps' }).click();
    await reloaded(page);
    await expect(page.getByText('Set 1 of 4')).toBeVisible();
    await expect(page.getByText('Up next · exercise')).toHaveCount(0);
    await expect(weightVal(page)).toContainText('87.5');
    await expect(repsVal(page)).toHaveText('7');
  });
  test('second set after a logged set', async ({ page }) => {
    await openReal(page, real({}));
    await startSet(page);
    await done(page).click();
    await page.getByRole('button', { name: 'Start set 2 now' }).click();
    await page.getByRole('button', { name: 'More weight' }).click();
    await reloaded(page);
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    await expect(weightVal(page)).toContainText('85');
  });
  test('rest: same phase, countdown from the timestamp, then auto-returns', async ({ page }) => {
    const b = B();
    await openReal(page, real({ base: b, phase: 'rest', over: { restEndsAt: b + 6000, restTotalSec: 90 }, exOver: (i) => (i === 0 ? { begunAt: 1, sets: [{ weight: 82.5, reps: 6, doneAt: b - 84_000 }] } : {}) }));
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await reloaded(page);
    await expect(page.getByText('Rest', { exact: true })).toBeVisible();
    await expect(page.getByRole('timer').filter({ hasText: /^0:0[0-6]$/ })).toBeVisible();
    await expect(page.getByText('of 1:30')).toBeVisible();
    await expect(page.getByText('Set 2 of 4')).toBeVisible({ timeout: 9000 });
  });
  test('rest that ended while the app was closed lands on the set screen', async ({ page }) => {
    const b = B();
    await openReal(page, real({ base: b, phase: 'rest', over: { restEndsAt: b + 1500, restTotalSec: 90 }, exOver: (i) => (i === 0 ? { begunAt: 1, sets: [{ weight: 82.5, reps: 6, doneAt: b - 88_000 }] } : {}) }));
    await page.goto('about:blank');
    await page.waitForTimeout(2200);
    await page.goto('session/live');
    await expect(page.getByText('Set 2 of 4')).toBeVisible();
    await expect(page.getByText('Rest', { exact: true })).toHaveCount(0);
  });
  test('feedback: phase and the chosen ratings', async ({ page }) => {
    const b = B();
    await openReal(page, real({ base: b, phase: 'fb', exOver: (i) => (i === 0 ? { begunAt: 1, startedAt: b - 480_000, endedAt: b, sets: sets4(82.5, 6, b) } : {}) }));
    await page.getByRole('button', { name: 'Too heavy' }).click();
    await page.getByRole('button', { name: 'Chill today' }).click();
    await reloaded(page);
    await expect(page.getByRole('heading', { name: 'Back squat done' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Too heavy' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Chill today' })).toHaveAttribute('aria-pressed', 'true');
    await expect(nextTime(page)).toHaveText('4 × 6 @ 80 kg');
  });
  test('feedback ratings do not leak into the next exercise', async ({ page }) => {
    const b = B();
    await openReal(page, real({ base: b, phase: 'fb', exOver: (i) => (i === 0 ? { begunAt: 1, startedAt: b - 480_000, endedAt: b, sets: sets4(82.5, 6, b) } : {}) }));
    await page.getByRole('button', { name: 'Too light' }).click();
    await saveBtn(page).click();
    await startSet(page);
    for (let k = 1; k <= 3; k++) { await done(page, k).click(); if (k < 3) await page.getByRole('button', { name: `Start set ${k + 1} now` }).click(); }
    await expect(page.getByRole('heading', { name: 'Romanian deadlift done' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Too light' })).toHaveAttribute('aria-pressed', 'false');
    await expect(saveBtn(page)).toBeDisabled();
  });
  test('done', async ({ page }) => {
    await openReal(page, real({ phase: 'done', cursor: 3, exOver: () => ({ status: 'done' }) }));
    await reloaded(page);
    await expect(page.getByRole('heading', { name: 'All exercises done' })).toBeVisible();
  });
  test('swapped exercise is still Up next after a reload; skipped stays skipped', async ({ page }) => {
    await openReal(page, real({}));
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await reloaded(page);
    await expect(page.getByText('Up next · exercise 2 of 4')).toBeVisible();
    await expect(h1(page)).toHaveText('Romanian deadlift');
    await startSet(page);
    await reloaded(page);
    await expect(page.getByText('Set 1 of 3')).toBeVisible();
  });
  test('lb preference and undone set survive a reload (full walk)', async ({ page }) => {
    await openReal(page, real({}), { settings: { unit: 'lb' } });
    await startSet(page);
    await done(page).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await reloaded(page);
    await expect(page.getByText('Set 1 of 4')).toBeVisible();
    await expect(weightVal(page)).toHaveText('182lb');
  });
});

// ───────────────────────── small screens ─────────────────────────
test.describe('Small screens', () => {
  const adjBanner = [{ id: 'a1', at: T0 - 1000, type: 'trim_rest', savedSec: 90, text: 'Rest trimmed by 30 s on 2 exercises to finish near the target.', prevRestSec: {} }];
  const fits = async (page: Page, btn: RegExp) => {
    const box = await page.getByRole('button', { name: btn }).boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    const over = await page.evaluate(() => { const f = document.querySelector('.focus') as HTMLElement; return { sh: f.scrollHeight, ch: f.clientHeight, sw: document.documentElement.scrollWidth }; });
    expect(over.sh).toBeLessThanOrEqual(over.ch + 1);
    expect(over.sw).toBeLessThanOrEqual(vp.width);
  };
  for (const [w, h] of [[375, 667], [360, 640]] as const) {
    test(`set screen stays on ONE screen at ${w}x${h} (first-time hint + adjust banner + offline strip)`, async ({ page, context }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, setScreen({ over: { adjustments: adjBanner } }));
      await context.setOffline(true);
      await expect(page.getByText(/^Offline\./)).toBeVisible();
      await expect(page.getByText('Pick a weight you could lift')).toBeVisible();
      await fits(page, /^Done · set 1/);
    });
    test(`Up next, rest at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, live({ over: { adjustments: adjBanner } }), { sessions: [history('back_squat', 80, 'light') as never] });
      await fits(page, /^Start set 1/);
    });
    test(`rest fits at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page, rest(100));
      await fits(page, /^Start set 2 now/);
    });
  }
  test('feedback: save button visible without scrolling, no horizontal overflow at 360x640', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, fbPhase());
    const box = await saveBtn(page).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
  test('options sheet fits and scrolls on 375x667', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page, setScreen());
    await openMenu(page);
    const box = await sheet(page).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667 + 1);
  });
});
