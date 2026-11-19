import { test, seed } from './fixtures';
import { live, history, T0 } from './live-helpers';
test.skip(!process.env.LIVE_SHOTS, 'manual parity screenshots');
test('shots', async ({ page }) => {
  await page.clock.install({ time: T0 - 1000 }); await page.clock.pauseAt(T0);
  await seed(page, { sessions: [live() as never, history('back_squat', 80, 'light') as never] });
  await page.goto('session/live');
  await page.screenshot({ path: '/tmp/live-intro.png' });
  await page.getByRole('button', { name: 'Start set 1' }).click();
  await page.getByRole('button', { name: /Exercise options/ }).click();
  await page.screenshot({ path: '/tmp/live-menu.png' });
});
