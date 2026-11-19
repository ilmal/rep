// Not a test: renders the README screenshots from the real app with deterministic seed data.
//   SHOTS=1 SHOTS_DIR=docs/screenshots E2E_PROD=1 E2E_BASE=http://localhost:5290/app/ bunx playwright test tests/e2e/screenshots.spec.ts
import { test, seed } from './fixtures';
import type { Page } from '@playwright/test';
import { NOW, week } from './streak-seed';
import { live, open as openLive, startSet } from './live-helpers';

test.skip(!process.env.SHOTS, 'screenshot generator: set SHOTS=1');
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, serviceWorkers: 'block', isMobile: true, hasTouch: true });
const OUT = process.env.SHOTS_DIR ?? 'docs/screenshots';
const shot = (page: Page, name: string, full = false) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: 'disabled' });
const settle = (page: Page) => page.waitForTimeout(700);

async function pinned(page: Page, o: Parameters<typeof seed>[1] = {}) {
  await page.clock.install({ time: new Date(NOW) });
  await seed(page, { ...o, settings: { weeklyGoal: 3, ...(o.settings ?? {}) } });
}
const GOOD = () => [...week(5, 3), ...week(4, 3), ...week(3, 3), ...week(2, 3), ...week(1, 3), ...week(0, 2)];

test('today', async ({ page }) => { await pinned(page, { sessions: GOOD() }); await page.goto(''); await settle(page); await shot(page, 'today'); });
test('streak', async ({ page }) => { await pinned(page, { sessions: GOOD() }); await page.goto('streak'); await settle(page); await shot(page, 'streak'); });
test('badges', async ({ page }) => {
  await pinned(page, { sessions: Array.from({ length: 14 }, (_, i) => week(i, 3)).flat() });
  await page.goto('streak/badges'); await settle(page); await shot(page, 'badges');
});
test('guide', async ({ page }) => { await pinned(page, { sessions: GOOD() }); await page.goto('library/back_squat'); await settle(page); await page.waitForTimeout(1500); await shot(page, 'guide'); });
test('library', async ({ page }) => { await pinned(page, { sessions: GOOD() }); await page.goto('library/all'); await settle(page); await shot(page, 'library'); });
test('progress', async ({ page }) => { await pinned(page, { sessions: GOOD() }); await page.goto('progress'); await settle(page); await shot(page, 'progress'); });
test('plan', async ({ page }) => { await pinned(page, { sessions: GOOD() }); await page.goto('plan'); await settle(page); await shot(page, 'plan'); });
test('live-next', async ({ page }) => { await openLive(page, live({ phase: 'set', ago: 900 })); await settle(page); await shot(page, 'live-next'); });
test('live-set', async ({ page }) => { await openLive(page, live({ phase: 'set', ago: 900 })); await startSet(page); await settle(page); await shot(page, 'live-set'); });
test('landing', async ({ browser }) => {
  const base = (process.env.E2E_LANDING ?? 'http://localhost:5290/');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${OUT}/landing.png`, animations: 'disabled' });
  await ctx.close();
});
