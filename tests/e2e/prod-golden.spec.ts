// Run against the LIVE deployment:  E2E_BASE=https://rep.ilmal.se/app/ bunx playwright test tests/e2e/prod-golden.spec.ts
// Creates one throwaway anonymous account and deletes it at the end.
import { test, expect, readState } from './fixtures';

test('live: onboard → session → sync → MCP coach round trip → cleanup', async ({ page, request, baseURL }) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL!).origin;
  await page.goto('');
  await page.getByRole('link', { name: /get started/i }).click();
  await page.getByRole('link', { name: /continue/i }).first().click();
  await page.getByRole('button', { name: /turn on location/i }).click();
  await expect(page.getByRole('button', { name: /continue|looks good/i }).or(page.getByRole('link', { name: /continue|looks good/i })).first()).toBeVisible();
  await page.getByRole('button', { name: /continue|looks good/i }).or(page.getByRole('link', { name: /continue|looks good/i })).first().click();
  await page.getByRole('button', { name: /finish|done|start|build/i }).or(page.getByRole('link', { name: /finish|done|start|build/i })).first().click();
  // setup finishes on the optional "save progress" offer: skip it
  const skip = page.getByRole('link', { name: /skip|not now/i }).or(page.getByRole('button', { name: /skip|not now/i })).first();
  if (await skip.isVisible({ timeout: 4000 }).catch(() => false)) await skip.click();
  await expect(page.getByText(/See today.s plan|Start session 1/i).first()).toBeVisible();

  // a real workout: start → warm-up → every exercise (1 set each is enough: plannedSets is reduced via the options sheet? no: log all sets)
  await page.getByText(/See today.s plan|Start session 1/i).first().click();
  await page.getByRole('button', { name: /at the gym/i }).or(page.getByRole('link', { name: /at the gym/i })).first().click();
  await page.getByRole('button', { name: /warm-up done/i }).click();
  for (let i = 0; i < 120; i++) {
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

  // it reaches the live server and a real MCP client can read it
  const token = (await readState(page)).device.token as string;
  expect(token).toBeTruthy();
  const tok = (await (await request.post(`${origin}/api/tokens`, { headers: { authorization: `Bearer ${token}` }, data: { name: 'e2e', scope: 'write' } })).json()).token as string;
  const rpc = async (name: string, args: unknown = {}) => JSON.parse((await (await request.post(`${origin}/mcp`, { headers: { authorization: `Bearer ${tok}` }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).json()).result.content[0].text);
  await expect.poll(async () => (await rpc('get_overview')).counts.completedSessions, { timeout: 30_000 }).toBe(1);
  const ov = await rpc('get_overview');
  expect(ov.thisWeek.done).toBe(1);
  // coach edits arrive in the app
  await rpc('set_exercise_pref', { exerciseId: 'goblet_squat', favorite: true, relevance: 90 });
  await rpc('create_coach_plan', { title: 'Live check', note: 'From the coach', slot: 2, exercises: [{ exerciseId: 'back_squat', sets: 3, reps: 5 }] });
  await page.getByRole('link', { name: /^done$/i }).or(page.getByRole('button', { name: /^done$/i })).first().click();
  await page.reload();
  await expect(page.getByText(/coach plan/i).first()).toBeVisible({ timeout: 30_000 });
  // cleanup: delete the throwaway account
  expect((await request.delete(`${origin}/api/account`, { headers: { authorization: `Bearer ${token}` } })).ok()).toBe(true);
});
