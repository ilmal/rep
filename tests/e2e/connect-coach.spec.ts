import { test, expect, seed, readState } from './fixtures';
import type { Page } from '@playwright/test';

// The API limits anonymous account creation to 20/hour per IP; every test gets its own forwarded IP so reruns never starve.
let n = 0;
test.beforeEach(async ({ page }) => { n++; await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.${process.pid % 250}.${Date.now() % 250}.${n}` }); });

const rpc = (page: Page, token: string | null, method: string, params?: unknown) =>
  page.evaluate(async ([t, m, p]) => {
    const r = await fetch(`${location.origin}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [token, method, params] as const);

async function create(page: Page, name: string, access?: 'Read-only' | 'Read & write'): Promise<string> {
  await page.getByLabel('Name').fill(name);
  if (access) await page.getByRole('button', { name: access, exact: true }).click();
  await page.getByRole('button', { name: 'Create token' }).click();
  const code = page.locator('code', { hasText: /^rep_/ });
  await expect(code).toBeVisible();
  return (await code.textContent())!.trim();
}

test('layout, real server URL, copy, empty state, no horizontal overflow', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seed(page);
  await page.goto('settings/coach');
  await expect(page.locator('.topbar .title')).toHaveText('Connect a coach');
  await expect(page.getByText('Let a coach agent help')).toBeVisible();
  const origin = await page.evaluate(() => location.origin);
  await expect(page.locator('code', { hasText: `${origin}/mcp` }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Copy URL' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${origin}/mcp`);
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  await expect(page.locator('code', { hasText: '"authorization": "Bearer <your token>"' })).toBeVisible();
  await expect(page.getByText(/Banned and paused exercises are never planned/)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 360)).toBe(true);
});

test('tool list matches the real MCP tools/list (names and read/write split)', async ({ page }) => {
  await seed(page);
  await page.goto('settings/coach');
  await page.getByLabel('Name').fill('Lister');
  await page.getByRole('button', { name: 'Create token' }).click();
  const tok = ((await page.locator('code', { hasText: /^rep_/ }).textContent()) ?? '').trim();
  const list = (await rpc(page, tok, 'tools/list')).body.result.tools as { name: string; description: string }[];
  const writeNames = list.filter((t) => t.description.endsWith('[write]')).map((t) => t.name).sort();
  const readNames = list.filter((t) => !t.description.endsWith('[write]')).map((t) => t.name).sort();
  const shown = async (label: string) => (await page.getByLabel(label).locator('code').allTextContents()).map((s) => s.trim()).sort();
  expect(await shown('Read tools')).toEqual(readNames);
  expect(await shown('Write tools')).toEqual(writeNames);
  await expect(page.getByLabel('Write tools')).toContainText('pause for days or sessions');
  const pref = list.find((t) => t.name === 'set_exercise_pref')!;
  for (const k of ['pauseDays', 'pauseSessions', 'banned', 'resume']) expect(JSON.stringify(pref)).toContain(k);
});

test('create token: account bootstrap, one-time display, copy, list, config snippet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seed(page);
  await page.goto('settings/coach');
  expect((await readState(page)).device.token).toBeFalsy();
  const tok = await create(page, 'Grok');
  expect(tok).toMatch(/^rep_[\w-]{20,}$/);
  expect((await readState(page)).device.token).toBeTruthy(); // anonymous account bootstrapped
  await expect(page.getByText('shown only once')).toBeVisible();
  await page.getByRole('button', { name: 'Copy token' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tok);
  const origin = await page.evaluate(() => location.origin);
  await expect(page.locator('code', { hasText: `"authorization": "Bearer ${tok}"` })).toBeVisible();
  await expect(page.locator('code', { hasText: `"url": "${origin}/mcp"` })).toBeVisible();
  const row = page.locator('.group .li', { hasText: 'Grok' });
  await expect(row).toContainText('Read & write');
  await expect(row).toContainText('never used');
  await expect(row).toContainText(tok.slice(0, 8));
  await expect(row).not.toContainText(tok);
  // the full token is never shown again once dismissed or after a reload
  await page.getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(page.locator('code', { hasText: tok })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.group .li', { hasText: 'Grok' })).toBeVisible();
  await expect(page.locator('code', { hasText: tok })).toHaveCount(0);
  // usage is reflected in the list
  await rpc(page, tok, 'tools/list');
  await page.reload();
  await expect(page.locator('.group .li', { hasText: 'Grok' })).toContainText(/used /);
});

test('read-only scope hides write tools and refuses writes', async ({ page }) => {
  await seed(page);
  await page.goto('settings/coach');
  const tok = await create(page, 'Viewer', 'Read-only');
  await expect(page.locator('.group .li', { hasText: 'Viewer' }).locator('.tag')).toHaveText('Read-only');
  const names = ((await rpc(page, tok, 'tools/list')).body.result.tools as { name: string }[]).map((t) => t.name);
  expect(names).toContain('get_overview');
  expect(names).not.toContain('set_exercise_pref');
  const w = await rpc(page, tok, 'tools/call', { name: 'set_exercise_pref', arguments: { exerciseId: 'x', favorite: true } });
  expect(w.body.result.isError).toBe(true);
});

test('MCP write changes what the app shows after sync; revoke gives 401', async ({ page }) => {
  await seed(page);
  await page.goto('settings/coach');
  const tok = await create(page, 'Coach');
  await page.goto('plan/planner');
  const firstPick = page.locator('.group').first().locator('a.li').first();
  await expect(firstPick).toBeVisible();
  const id = (await firstPick.getAttribute('href'))!.split('/').pop()!;
  const ex = await rpc(page, tok, 'tools/call', { name: 'set_exercise_pref', arguments: { exerciseId: id, banned: true } });
  expect(ex.body.result.isError).toBe(false);
  await page.reload(); // startup sync pulls the coach's change
  await expect.poll(async () => (await readState(page)).prefs[id]?.avoid, { timeout: 15000 }).toBe(true);
  await expect(page.locator(`a.li[href$="/library/${id}"]`)).toHaveCount(0); // banned exercise vanished from the planner preview
  await expect(page.getByText(/1 banned or paused exercise is left out/)).toBeVisible();
  // profile notes written by the coach show up in the app
  await page.goto('settings/coach');
  const ta0 = page.getByLabel(/Goals, injuries/);
  await ta0.fill('Mine'); await ta0.blur(); // pushes the athlete's settings so the server has a real settings entity
  const serverNotes = async () => JSON.parse((await rpc(page, tok, 'tools/call', { name: 'get_settings', arguments: {} })).body.result.content[0].text).profileNotes;
  await expect.poll(serverNotes, { timeout: 15000 }).toBe('Mine');
  await rpc(page, tok, 'tools/call', { name: 'update_settings', arguments: { profileNotes: 'Left shoulder cranky' } });
  await page.reload();
  await expect(page.getByLabel(/Goals, injuries/)).toHaveValue('Left shoulder cranky', { timeout: 15000 });
  // revoke
  await page.getByRole('button', { name: 'Revoke Coach' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Revoke token' })).toContainText('Anything using this token loses access immediately.');
  await page.getByRole('button', { name: 'Keep token' }).click();
  expect((await rpc(page, tok, 'tools/list')).status).toBe(200);
  await page.getByRole('button', { name: 'Revoke Coach' }).click();
  await page.getByRole('button', { name: 'Revoke token' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  expect((await rpc(page, tok, 'tools/list')).status).toBe(401);
  expect((await rpc(page, null, 'tools/list')).status).toBe(401);
});

test('profile notes: edit saves on blur and syncs to the coach', async ({ page }) => {
  await seed(page);
  await page.goto('settings/coach');
  const tok = await create(page, 'Notes');
  const ta = page.getByLabel(/Goals, injuries/);
  await ta.fill('Goal: stronger squat');
  await ta.blur();
  await expect.poll(async () => (await readState(page)).settings.profileNotes).toBe('Goal: stronger squat');
  await expect.poll(async () => {
    const r = await rpc(page, tok, 'tools/call', { name: 'get_settings', arguments: {} });
    return JSON.parse(r.body.result.content[0].text).profileNotes;
  }, { timeout: 15000 }).toBe('Goal: stronger squat');
});

test('offline: banner shows and create/revoke are disabled', async ({ page, context }) => {
  await seed(page);
  await page.goto('settings/coach');
  await create(page, 'Before');
  await page.getByRole('button', { name: 'I’ve saved it' }).click();
  await context.setOffline(true);
  await expect(page.getByText('You’re offline')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create token' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Revoke Before' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Create token' })).toBeEnabled();
});

test('create fails gracefully when the server is unreachable', async ({ page }) => {
  await seed(page);
  await page.goto('settings/coach');
  await page.route('**/api/auth/anon', (r) => r.fulfill({ status: 500, body: '{}' }));
  await page.getByRole('button', { name: 'Create token' }).click();
  await expect(page.getByRole('alert')).toContainText('Couldn’t reach the server');
  await expect(page.locator('code', { hasText: /^rep_/ })).toHaveCount(0);
});

test('back button leaves the screen', async ({ page }) => {
  await seed(page);
  await page.goto('settings');
  await page.goto('settings/coach');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
