// Staying signed in + never seeing the marketing page inside the app.
import { test, expect, seed, readState } from './fixtures';

const origin = () => new URL(process.env.E2E_BASE ?? 'http://localhost:5173/app/').origin;
test.use({ serviceWorkers: 'block' });

test.describe('landing vs app', () => {
  test('a browser that has used the app (cookie) is sent from / to the app', async ({ page, context }) => {
    await context.addCookies([{ name: 'rep_seen', value: '1', url: origin() }]);
    await page.goto(`${origin()}/`);
    await expect(page).toHaveURL(/\/app\//);
  });
  test('rep.seen in localStorage also forwards the landing page (no cookie)', async ({ page }) => {
    await page.goto(`${origin()}/robots.txt`);
    await page.evaluate(() => localStorage.setItem('rep.seen', '1'));
    await page.goto(`${origin()}/`);
    await expect(page).toHaveURL(/\/app\//);
  });
  test('a first-time visitor still gets the landing page', async ({ page }) => {
    await page.goto(`${origin()}/`);
    await expect(page).toHaveURL(new RegExp(`${origin().replace(/[.:/]/g, '\\$&')}/?$`));
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });
});

test.describe('signed out after having been signed in', () => {
  test('no session cookie: the app opens the sign-in page, data stays, "Not now" continues', async ({ page }) => {
    await seed(page, { device: { email: 'me@example.se', wasSignedIn: true, token: undefined, userId: undefined } });
    await page.goto('');
    await expect(page).toHaveURL(/\/app\/signin/);
    await expect(page.getByTestId('signed-out-note')).toContainText("You've been signed out");
    await page.getByRole('link', { name: 'Not now', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/?(\?.*)?$/);
    await expect(page).not.toHaveURL(/signin/);
  });

  test('valid session cookie: storage was wiped of the token, the app restores it and stays on Today', async ({ page, context, request }) => {
    const anon = await request.post(`${origin()}/api/auth/anon`, { data: { name: 'x' } });
    const { token, userId } = await anon.json();
    const sc = anon.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value.split(';')[0]!);
    const sess = sc.find((c) => c.startsWith('rep_session='))!.split('=')[1]!;
    await context.addCookies([{ name: 'rep_session', value: sess, url: `${origin()}/api/auth` }]);
    await seed(page, { device: { wasSignedIn: true, email: 'me@example.se', token: undefined, userId: undefined } });
    await page.goto('');
    await expect.poll(async () => (await readState(page)).device.token).toBe(token);
    expect((await readState(page)).device.userId).toBe(userId);
    await expect(page).not.toHaveURL(/signin/);
  });

  test('an anonymous (never signed in) user is not sent to sign-in', async ({ page }) => {
    await seed(page, { device: { token: undefined, userId: undefined } });
    await page.goto('');
    await expect(page).not.toHaveURL(/signin/);
  });
});
