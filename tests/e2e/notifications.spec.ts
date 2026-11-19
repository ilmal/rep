import { readFileSync } from 'node:fs';
import { createECDH } from 'node:crypto';
import vm from 'node:vm';
import { test, expect, seed, readState, makeSession, makeAreas } from './fixtures';
import type { Page } from '@playwright/test';

const areas = makeAreas();
const P256DH = createECDH('prime256v1').generateKeys().length ? (() => { const e = createECDH('prime256v1'); e.generateKeys(); return e.getPublicKey().toString('base64url'); })() : '';
const AUTH = Buffer.from('0123456789abcdef').toString('base64url');
const ENDPOINT = 'https://push.example.test/e/abc123';
const SYNC_OK = { accepted: [], rejected: [], changes: [], cursor: 1, more: false };
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

interface Stub {
  /** Notification.permission at load */ perm?: NotificationPermission;
  /** what requestPermission() resolves to */ answer?: NotificationPermission;
  /** expose Notification/PushManager/serviceWorker.pushManager */ api?: boolean;
  /** an existing browser subscription */ existing?: boolean;
  /** display-mode: standalone */ standalone?: boolean;
}

/** Replace the browser push surface with a controllable fake; calls are recorded on window.__push. */
async function stub(page: Page, o: Stub = {}) {
  await page.addInitScript(([cfg, p256dh, auth, endpoint]) => {
    const c = cfg as Required<Stub>;
    const w = window as any;
    w.__push = { requests: 0, subscribes: 0, unsubscribes: 0, perm: sessionStorage.getItem('__push_perm') ?? c.perm, sub: c.existing || sessionStorage.getItem('__push_sub') ? endpoint : null };
    if (c.standalone) {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = ((q: string) => (/display-mode:\s*standalone/.test(q) ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList) : mm(q))) as typeof window.matchMedia;
    }
    if (!c.api) { try { delete (w as any).PushManager; delete (w as any).Notification; } catch { /* */ } return; }
    function N() {}
    Object.defineProperty(N, 'permission', { get: () => w.__push.perm });
    (N as any).requestPermission = async () => { w.__push.requests++; w.__push.perm = c.answer; sessionStorage.setItem('__push_perm', c.answer); return c.answer; };
    w.Notification = N;
    w.PushManager = function PushManager() {};
    const mkSub = () => ({
      endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
      unsubscribe: async () => { w.__push.unsubscribes++; w.__push.sub = null; sessionStorage.removeItem('__push_sub'); return true; },
    });
    const reg = {
      pushManager: {
        getSubscription: async () => (w.__push.sub ? mkSub() : null),
        subscribe: async (opts: any) => { w.__push.subscribes++; w.__push.subscribeOpts = { userVisibleOnly: opts.userVisibleOnly, keyLen: opts.applicationServerKey.byteLength }; w.__push.sub = endpoint; sessionStorage.setItem('__push_sub', '1'); return mkSub(); },
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(reg), register: async () => reg, addEventListener() {}, removeEventListener() {} } });
  }, [{ perm: 'default', answer: 'granted', api: true, existing: false, standalone: false, ...o }, P256DH, AUTH, ENDPOINT] as const);
}

interface Calls { method: string; path: string; body: any }
/** Mock the push + sync API. Records every push call. */
async function mockApi(page: Page, o: { subscribeStatus?: number; serverHas?: boolean; prefs?: object } = {}) {
  const calls: Calls[] = [];
  await page.route('**/api/sync', (r) => r.fulfill({ json: SYNC_OK }));
  await page.route('**/api/push/**', (r) => {
    const u = new URL(r.request().url());
    const path = u.pathname.replace(/^.*\/api\/push/, '');
    const body = r.request().postData() ? JSON.parse(r.request().postData()!) : null;
    calls.push({ method: r.request().method(), path: path + u.search, body });
    if (path === '/key') return r.fulfill({ json: { key: Buffer.from(new Uint8Array(65).fill(4)).toString('base64url') } });
    if (path === '/subscribe') return r.fulfill({ status: o.subscribeStatus ?? 200, json: o.subscribeStatus && o.subscribeStatus >= 400 ? { error: 'boom' } : { ok: true } });
    if (path === '/status') return r.fulfill({ json: { subscribed: o.serverHas ?? false, prefs: { rest: true, left: true, nudge: false, badge: true, streak: true, ...(o.prefs ?? {}) } } });
    return r.fulfill({ json: { ok: true } });
  });
  return calls;
}
const withAccount = { device: { token: 'tok', userId: 'u1' } };
const pushState = (page: Page) => page.evaluate(() => (window as any).__push);
const lsPrefs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('rep-push-prefs') ?? 'null'));
const sw = (page: Page, name: string) => page.getByRole('switch', { name }).or(page.locator('label.li', { hasText: name }).locator('input'));
const row = (page: Page, name: string) => page.locator('label.li', { hasText: name }).locator('input.switch');

test.describe('Notifications screen', () => {
  test('renders the design: copy, default toggles, real badge count, idle actions', async ({ page, errors }) => {
    const now = Date.now();
    await seed(page, { ...withAccount, sessions: [makeSession({ id: 'a', seq: 1, slot: 0, areaId: areas[0].id, areaName: 'Upper body', daysAgo: 0, exerciseIds: ['bench_press'] })] });
    await stub(page); await mockApi(page);
    await page.goto('notifications');
    await expect(page.getByRole('heading', { name: 'A tap on the shoulder' })).toBeVisible();
    await expect(page.getByText('The icon badge shows sessions left this week.')).toBeVisible();
    await expect(page.getByText('Your phone can tell you when rest is over, even with the screen locked. You choose which alerts you get.')).toBeVisible();
    for (const [t, s] of [['Rest is over', 'Next set and weight, on the lock screen'], ['Session left running', 'After 30 min with nothing logged'], ['Streak reminders', 'Only when your streak is at risk. Max one a day, never after 21:00'], ['Icon badge', 'Sessions left this week']]) {
      const li = page.locator('label.li', { hasText: t });
      await expect(li.locator('.li-t')).toHaveText(t);
      await expect(li.locator('.li-s')).toHaveText(s);
    }
    await expect(row(page, 'Rest is over')).toBeChecked();
    await expect(row(page, 'Session left running')).toBeChecked();
    await expect(row(page, 'Streak reminders')).toBeChecked();
    await expect(page.locator('label.li')).toHaveCount(4); // design: four toggles; the legacy weekly nudge row only shows when it is already on
    await expect(page.getByText('Weekly nudge')).toHaveCount(0);
    await expect(row(page, 'Icon badge')).toBeChecked();
    // goal 4 (default), 1 session completed today → 3 left (unless it is Monday 00:00 edge: session is "today" so it is in this week)
    expect(now).toBeGreaterThan(0);
    await expect(page.locator('.badgeicon b')).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await expect(page.locator('.banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('badge is hidden when no sessions are left this week', async ({ page }) => {
    const ss = [0, 0, 0, 0].map((_, i) => makeSession({ id: `s${i}`, seq: i + 1, slot: i, areaId: areas[0].id, areaName: 'Upper body', daysAgo: 0, exerciseIds: ['bench_press'] }));
    await seed(page, { ...withAccount, sessions: ss }); await stub(page); await mockApi(page);
    await page.goto('notifications');
    await expect(page.locator('.badgeicon img')).toBeVisible();
    await expect(page.locator('.badgeicon b')).toHaveCount(0);
  });

  test('each switch toggles and persists locally', async ({ page }) => {
    await seed(page, withAccount); await stub(page); await mockApi(page);
    await page.goto('notifications');
    await row(page, 'Rest is over').uncheck();
    await row(page, 'Session left running').uncheck();
    await row(page, 'Streak reminders').uncheck();
    await row(page, 'Icon badge').uncheck();
    expect(await lsPrefs(page)).toEqual({ rest: false, left: false, nudge: false, badge: false, streak: false });
    await page.reload();
    await expect(row(page, 'Rest is over')).not.toBeChecked();
    await expect(row(page, 'Streak reminders')).not.toBeChecked();
    await expect(row(page, 'Icon badge')).not.toBeChecked();
  });

  test('lock screen preview shows the three notification designs', async ({ page }) => {
    await seed(page, withAccount); await stub(page); await mockApi(page);
    await page.goto('notifications');
    const btn = page.getByRole('button', { name: 'See how they look on the lock screen' });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    const prev = page.getByLabel('Lock screen preview');
    await expect(prev.getByText('Rest over: set 3 of 4')).toBeVisible();
    await expect(prev.getByText('Back squat · 82.5 kg × 6. Let’s go.')).toBeVisible();
    await expect(prev.getByText('Session 2 is still running')).toBeVisible();
    await expect(prev.getByText('Last set logged 19:21. Tap to finish and save it.')).toBeVisible();
    await expect(prev.getByText('Your 7-week streak is at risk')).toBeVisible();
    await expect(prev.getByText('4 sessions, 5 days left. Tap to plan the week.')).toBeVisible();
    await page.getByRole('button', { name: 'Hide the lock screen preview' }).click();
    await expect(prev).toHaveCount(0);
  });

  test('turn on: permission → subscribe → server registration with the chosen prefs; banner + Done', async ({ page, errors }) => {
    await seed(page, withAccount); await stub(page); const calls = await mockApi(page);
    await page.goto('notifications');
    await row(page, 'Streak reminders').uncheck();
    await row(page, 'Session left running').uncheck();
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.locator('.banner.ok')).toContainText('Notifications on');
    await expect(page.locator('.banner.ok')).toContainText('Change them any time in Settings.');
    const st = await pushState(page);
    expect(st.requests).toBe(1); expect(st.subscribes).toBe(1);
    expect(st.subscribeOpts).toEqual({ userVisibleOnly: true, keyLen: 65 });
    const sub = calls.find((c) => c.path === '/subscribe')!;
    expect(sub.method).toBe('POST');
    expect(sub.body.subscription).toEqual({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } });
    expect(sub.body.prefs).toEqual({ rest: true, left: false, nudge: false, badge: true, streak: false });
    expect(sub.body.tz).toBe(await page.evaluate(() => new Date().getTimezoneOffset()));
    expect(calls.some((c) => c.path === '/key')).toBe(true);
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible(); // design keeps it
    await expect(page.getByRole('button', { name: 'Turn off notifications' })).toHaveCount(0); // only when it was already on
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
    expect(errors).toEqual([]);
  });

  test('toggling after it is on saves prefs to the server for this device', async ({ page }) => {
    await seed(page, withAccount); await stub(page); const calls = await mockApi(page);
    await page.goto('notifications');
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.locator('.banner.ok')).toBeVisible();
    await row(page, 'Streak reminders').uncheck();
    await expect.poll(() => calls.filter((c) => c.method === 'PUT').length).toBe(1);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/prefs');
    expect(put.body.endpoint).toBe(ENDPOINT);
    expect(put.body.prefs).toEqual({ rest: true, left: true, nudge: false, badge: true, streak: false });
  });

  test('denied at the system prompt: warning banner (iPhone wording only on iOS), no subscription, switches locked', async ({ page }) => {
    await seed(page, withAccount); await stub(page, { answer: 'denied' }); const calls = await mockApi(page);
    await page.goto('notifications');
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    const b = page.locator('.banner.warn');
    await expect(b).toContainText('Notifications are off');
    await expect(b).toContainText('The app works the same. To turn them on later:');
    await expect(b).toContainText('Notifications › Rep');
    await expect(b).not.toContainText('iPhone Settings');
    expect((await pushState(page)).subscribes).toBe(0);
    expect(calls.filter((c) => c.path === '/subscribe')).toHaveLength(0);
    for (const n of ['Rest is over', 'Session left running', 'Streak reminders', 'Icon badge']) await expect(row(page, n)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not now' })).toBeVisible();
  });

  test('already denied when the screen opens: same state without asking again', async ({ page }) => {
    await seed(page, withAccount); await stub(page, { perm: 'denied' }); await mockApi(page);
    await page.goto('notifications');
    await expect(page.locator('.banner.warn .b-t')).toHaveText('Notifications are off');
    expect((await pushState(page)).requests).toBe(0);
  });

  test('system prompt dismissed (stays "default"): nothing changes, can ask again', async ({ page }) => {
    await seed(page, withAccount); await stub(page, { answer: 'default' }); await mockApi(page);
    await page.goto('notifications');
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeEnabled();
    await expect(page.locator('.banner')).toHaveCount(0);
    expect((await pushState(page)).subscribes).toBe(0);
  });

  test('unsupported browser: explanation, locked switches, only Done', async ({ page }) => {
    await seed(page, withAccount); await stub(page, { api: false }); await mockApi(page);
    await page.goto('notifications');
    await expect(page.locator('.banner.warn .b-t')).toHaveText('Notifications aren’t available here');
    await expect(row(page, 'Rest is over')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  test.describe('iPhone in a Safari tab (not installed)', () => {
    test.use({ userAgent: IOS_UA });
    test('asks to install first and links to the install guide; never requests permission', async ({ page }) => {
      await seed(page, withAccount); await stub(page, { api: false }); await mockApi(page);
      await page.goto('notifications');
      await expect(page.locator('.banner.info .b-t')).toHaveText('Add Rep to your Home Screen first');
      await expect(page.locator('.banner.info')).toContainText('On iPhone, notifications only work in the installed app.');
      await expect(row(page, 'Rest is over')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Turn on notifications' })).toHaveCount(0);
      await page.getByRole('link', { name: 'Show me how' }).click();
      await expect(page).toHaveURL(/\/app\/install$/);
    });
    test('even if the APIs exist in the tab, it still asks to install', async ({ page }) => {
      await seed(page, withAccount); await stub(page, { api: true }); await mockApi(page);
      await page.goto('notifications');
      await expect(page.locator('.banner.info')).toBeVisible();
      expect((await pushState(page)).requests).toBe(0);
    });
    test('installed (standalone) on iPhone: works, with the iPhone Settings wording when denied', async ({ page }) => {
      await seed(page, withAccount); await stub(page, { standalone: true, answer: 'denied' }); await mockApi(page);
      await page.goto('notifications');
      await expect(page.locator('.banner.info')).toHaveCount(0);
      await page.getByRole('button', { name: 'Turn on notifications' }).click();
      await expect(page.locator('.banner.warn')).toContainText('iPhone Settings › Notifications › Rep');
    });
  });

  test('already subscribed: opens in the on state with server prefs; Turn off unsubscribes everywhere', async ({ page }) => {
    await seed(page, withAccount); await stub(page, { perm: 'granted', existing: true }); const calls = await mockApi(page, { serverHas: true, prefs: { nudge: true, badge: false } });
    await page.goto('notifications');
    await expect(page.locator('.banner.ok .b-t')).toHaveText('Notifications on');
    await expect(row(page, 'Weekly nudge')).toBeChecked();
    await expect(row(page, 'Icon badge')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
    expect(calls.filter((c) => c.path === '/subscribe')).toHaveLength(0);
    await page.getByRole('button', { name: 'Turn off notifications' }).click();
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
    await expect(page.locator('.banner.ok')).toHaveCount(0);
    expect((await pushState(page)).unsubscribes).toBe(1);
    expect(calls.find((c) => c.path === '/unsubscribe')!.body).toEqual({ endpoint: ENDPOINT });
  });

  test('server forgot the subscription (e.g. purged): re-registered silently on open', async ({ page }) => {
    await seed(page, withAccount); await stub(page, { perm: 'granted', existing: true }); const calls = await mockApi(page, { serverHas: false });
    await page.goto('notifications');
    await expect.poll(() => calls.filter((c) => c.path === '/subscribe').length).toBe(1);
    await expect(page.locator('.banner.ok')).toBeVisible();
  });

  test('server error while subscribing: error banner, retry works', async ({ page }) => {
    await seed(page, withAccount); await stub(page);
    let fail = true;
    await page.route('**/api/sync', (r) => r.fulfill({ json: SYNC_OK }));
    await page.route('**/api/push/**', (r) => {
      const p = new URL(r.request().url()).pathname;
      if (p.endsWith('/key')) return r.fulfill({ json: { key: Buffer.from(new Uint8Array(65).fill(4)).toString('base64url') } });
      if (p.endsWith('/subscribe')) return fail ? r.fulfill({ status: 500, json: { error: 'x' } }) : r.fulfill({ json: { ok: true } });
      return r.fulfill({ json: { subscribed: false, prefs: {} } });
    });
    await page.goto('notifications');
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.locator('.banner.warn .b-t')).toHaveText('Couldn’t turn on notifications');
    fail = false;
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.locator('.banner.ok')).toBeVisible();
  });

  test('offline: says so instead of failing silently', async ({ page, context }) => {
    await seed(page, withAccount); await stub(page); await mockApi(page);
    await page.goto('notifications');
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.locator('.banner.warn .b-t')).toHaveText('You’re offline');
    await context.setOffline(false);
  });

  test('Close / Not now go back where you came from, or to Today when opened directly', async ({ page }) => {
    await seed(page, withAccount); await stub(page); await mockApi(page);
    await page.goto('settings');
    await page.getByRole('link', { name: /Alerts & icon badge/ }).click();
    await expect(page).toHaveURL(/\/app\/notifications$/);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);
    await page.getByRole('link', { name: /Alerts & icon badge/ }).click();
    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);
    await page.goto('notifications');
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL(/\/app\/?$/);
  });

  for (const [w, h] of [[360, 740], [375, 667], [440, 956]] as const) {
    test(`no horizontal overflow at ${w}px (idle, preview open, denied)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await seed(page, withAccount); await stub(page, { perm: 'denied' }); await mockApi(page);
      await page.goto('notifications');
      await page.getByRole('button', { name: 'See how they look on the lock screen' }).click();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
      await expect(page.getByRole('button', { name: 'Done' })).toBeInViewport();
    });
  }
});

test.describe('live-session helpers (src/client/push)', () => {
  test.skip(!!process.env.E2E_PROD, 'needs the Vite dev server (imports app source modules / dev-only UI)');
  const PUSH = '/app/src/client/push/index.ts';
  const subscribedPage = async (page: Page, prefs?: object) => {
    await seed(page, withAccount); await stub(page, { perm: 'granted', existing: true });
    const calls = await mockApi(page, { serverHas: true });
    await page.addInitScript(([e, p]) => { localStorage.setItem('rep-push-endpoint', e as string); if (p) localStorage.setItem('rep-push-prefs', JSON.stringify(p)); }, [ENDPOINT, prefs ?? null]);
    await page.goto('settings');
    return calls;
  };

  test('scheduleRestPush / cancelRestPush hit the server in order; replace keeps one per user', async ({ page, errors }) => {
    const calls = await subscribedPage(page);
    const ends = Date.now() + 90_000;
    await page.evaluate(async ([p, ends]) => {
      const m = await import(/* @vite-ignore */ p as string);
      m.scheduleRestPush(ends, 'Back squat · 82.5 kg × 6', 'Rest over: set 3 of 4');
      m.scheduleRestPush((ends as number) + 15_000, 'Back squat · 82.5 kg × 6', 'Rest over: set 3 of 4');
      m.cancelRestPush();
    }, [PUSH, ends]);
    await expect.poll(() => calls.filter((c) => c.path === '/rest').length).toBe(3);
    const rest = calls.filter((c) => c.path === '/rest');
    expect(rest.map((c) => c.method)).toEqual(['POST', 'POST', 'DELETE']);
    expect(rest[0].body).toMatchObject({ endsAt: ends, label: 'Back squat · 82.5 kg × 6', title: 'Rest over: set 3 of 4' });
    expect(Math.abs(rest[0].body.now - Date.now())).toBeLessThan(10_000);
    expect(rest[1].body.endsAt).toBe(ends + 15_000);
    expect(errors).toEqual([]);
  });

  test('they are silent no-ops when push is not enabled on this device, or the rest alert is switched off', async ({ page }) => {
    await seed(page, withAccount); await stub(page); const calls = await mockApi(page);
    await page.goto('settings');
    await page.evaluate(async (p) => { const m = await import(/* @vite-ignore */ p); m.scheduleRestPush(Date.now() + 5000, 'x'); m.cancelRestPush(); m.pushSessionBeat({ seq: 1, startedAt: Date.now() }); m.pushSessionEnd(); }, PUSH);
    await page.waitForTimeout(400);
    expect(calls.filter((c) => /rest|session/.test(c.path))).toHaveLength(0);
    // enabled but rest + left off
    const p2 = await page.context().newPage();
    const calls2 = await subscribedPage(p2, { rest: false, left: false, nudge: false, badge: true });
    await p2.evaluate(async (p) => { const m = await import(/* @vite-ignore */ p); m.scheduleRestPush(Date.now() + 5000, 'x'); m.pushSessionBeat({ seq: 1, startedAt: Date.now() }); }, PUSH);
    await p2.waitForTimeout(400);
    expect(calls2.filter((c) => /rest|session/.test(c.path))).toHaveLength(0);
  });

  test('session heartbeat + end', async ({ page }) => {
    const calls = await subscribedPage(page);
    const t = Date.now();
    await page.evaluate(async ([p, t]) => { const m = await import(/* @vite-ignore */ p as string); m.pushSessionBeat({ seq: 2, startedAt: (t as number) - 600_000, lastLoggedAt: (t as number) - 60_000 }); m.pushSessionEnd(); }, [PUSH, t]);
    await expect.poll(() => calls.filter((c) => c.path === '/session').length).toBe(2);
    const s = calls.filter((c) => c.path === '/session');
    expect(s[0]).toMatchObject({ method: 'POST', body: { seq: 2, startedAt: t - 600_000, lastLoggedAt: t - 60_000 } });
    expect(s[1].method).toBe('DELETE');
  });

  test('restPushText builds the lock-screen copy from the live set position', async ({ page }) => {
    await seed(page, withAccount); await stub(page); await mockApi(page);
    await page.goto('settings');
    const out = await page.evaluate(async (p) => {
      const m = await import(/* @vite-ignore */ p);
      const ex = (o: object) => ({ id: 'e', exerciseId: 'back_squat', name: 'Back squat', tracking: 'weight_reps', plannedSets: 4, plannedWeight: 82.5, repTarget: 6, sets: [{ weight: 82.5, reps: 6, doneAt: 1 }, { weight: 82.5, reps: 6, doneAt: 2 }], ...o });
      const s = (e: object) => ({ cursor: 0, exercises: [e] });
      return [
        m.restPushText(s(ex({})), 'kg'),
        m.restPushText(s(ex({ sets: [] })), 'lb'),
        m.restPushText(s(ex({ sets: [1, 2, 3, 4].map((i) => ({ weight: 80, reps: 6, doneAt: i })) })), 'kg'),
        m.restPushText(s(ex({ tracking: 'reps', name: 'Push-up', plannedSets: 3 })), 'kg'),
        m.restPushText(s(ex({ tracking: 'time', name: 'Plank' })), 'kg'),
        m.restPushText({ cursor: 5, exercises: [] }, 'kg'),
      ];
    }, PUSH);
    expect(out).toEqual([
      { title: 'Rest over: set 3 of 4', label: 'Back squat · 82.5 kg × 6' },
      { title: 'Rest over: set 1 of 4', label: 'Back squat · 182 lb × 6' },
      { title: 'Rest over', label: 'Back squat · 80 kg × 6' },
      { title: 'Rest over: set 3 of 3', label: 'Push-up · 6 reps' },
      { title: 'Rest over: set 3 of 4', label: 'Plank' },
      { title: 'Rest over', label: '' },
    ]);
  });

  test('startPushBackground follows the store: rest scheduled, rescheduled on ±15 s, cancelled; heartbeat on set log; ends with the session', async ({ page }) => {
    const done = makeSession({ id: 'act', seq: 7, slot: 1, areaId: areas[0].id, areaName: 'Upper body', daysAgo: 0, exerciseIds: ['back_squat'], weight: 82.5 });
    const t0 = Date.now();
    const sess = (over: object) => ({ ...done, status: 'active', phase: 'set', endedAt: undefined, startedAt: t0 - 600_000, cursor: 0, exercises: done.exercises.map((e) => ({ ...e, status: 'active', plannedSets: 4, sets: e.sets.slice(0, 2).map((x, i) => ({ ...x, doneAt: t0 - 120_000 + i * 1000 })) })), ...over });
    await seed(page, { ...withAccount, sessions: [sess({}) as never] }); await stub(page, { perm: 'granted', existing: true });
    const calls = await mockApi(page, { serverHas: true });
    await page.addInitScript((e) => localStorage.setItem('rep-push-endpoint', e), ENDPOINT);
    await page.goto('welcome'); // any route; the guard may redirect, the store is what matters
    await page.waitForLoadState('networkidle');
    const run = (fn: string, arg?: unknown) => page.evaluate(async ([p, fn, arg]) => {
      const m = await import(/* @vite-ignore */ p as string); // the dev server stamps HMR-invalidated modules with ?t=…: import the exact URL the app itself loaded
      const names = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\/store\/core\.ts(\?|$)/.test(n));
      const core = await import(/* @vite-ignore */ names.find((n) => n.includes('?t=')) ?? names[0]);
      if (fn === 'start') { (window as any).__stop = m.startPushBackground(); return; }
      if (fn === 'patch') core.setState((s: any) => { const a = Object.values(s.sessions)[0] as any; s.sessions = { ...s.sessions, [a.id]: { ...a, ...(arg as object) } }; });
    }, [PUSH, fn, arg]);
    await run('start');
    await expect.poll(() => calls.filter((c) => c.path === '/session' && c.method === 'POST').length).toBe(1);
    expect(calls.find((c) => c.path === '/session')!.body).toMatchObject({ seq: 7, startedAt: t0 - 600_000 });
    // rest begins
    await run('patch', { phase: 'rest', restEndsAt: t0 + 90_000 });
    await expect.poll(() => calls.filter((c) => c.path === '/rest' && c.method === 'POST').length).toBe(1);
    expect(calls.find((c) => c.path === '/rest')!.body).toMatchObject({ endsAt: t0 + 90_000, title: 'Rest over: set 3 of 4', label: 'Back squat · 82.5 kg × 8' });
    // +15 s
    await run('patch', { restEndsAt: t0 + 105_000 });
    await expect.poll(() => calls.filter((c) => c.path === '/rest' && c.method === 'POST').length).toBe(2);
    expect(calls.filter((c) => c.path === '/rest' && c.method === 'POST')[1].body.endsAt).toBe(t0 + 105_000);
    // rest ends early
    await run('patch', { phase: 'set', restEndsAt: undefined });
    await expect.poll(() => calls.filter((c) => c.path === '/rest' && c.method === 'DELETE').length).toBe(1);
    // session completes
    await run('patch', { status: 'completed', phase: 'done', endedAt: Date.now() });
    await expect.poll(() => calls.filter((c) => c.path === '/session' && c.method === 'DELETE').length).toBe(1);
  });
});

test.describe('real server round trip', () => {
  test('subscribe → status → prefs → rest schedule/cancel → session → unsubscribe, through the UI and the live API', async ({ page, request, errors }) => {
    const anon = await (await request.post('/api/auth/anon', { data: {} })).json();
    const auth = { authorization: `Bearer ${anon.token}` };
    const key = (await (await request.get('/api/push/key', { headers: auth })).json()).key as string;
    expect(Buffer.from(key, 'base64url').length).toBe(65);
    expect((await request.get('/api/push/key')).status()).toBe(401);

    await seed(page, { device: { token: anon.token, userId: anon.userId } }); await stub(page);
    await page.route('**/api/sync', (r) => r.fulfill({ json: SYNC_OK }));
    await page.goto('notifications');
    await row(page, 'Streak reminders').uncheck();
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.locator('.banner.ok')).toBeVisible();
    const status = async () => (await (await request.get(`/api/push/status?endpoint=${encodeURIComponent(ENDPOINT)}`, { headers: auth })).json());
    expect(await status()).toEqual({ subscribed: true, prefs: { rest: true, left: true, nudge: false, badge: true, streak: false } });
    await row(page, 'Icon badge').uncheck();
    await expect.poll(async () => (await status()).prefs.badge).toBe(false);

    const j = { headers: auth, data: {} };
    expect((await request.post('/api/push/rest', { headers: auth, data: { endsAt: Date.now() + 90_000, label: 'Back squat · 82.5 kg × 6' } })).status()).toBe(200);
    expect((await request.post('/api/push/rest', { headers: auth, data: { endsAt: 'soon' } })).status()).toBe(400);
    expect((await request.delete('/api/push/rest', j)).status()).toBe(200);
    expect((await request.post('/api/push/session', { headers: auth, data: { seq: 1, startedAt: Date.now() - 1000 } })).status()).toBe(200);
    expect((await request.delete('/api/push/session', j)).status()).toBe(200);
    // SSRF: the server refuses internal endpoints
    const bad = await request.post('/api/push/subscribe', { headers: auth, data: { subscription: { endpoint: 'https://127.0.0.1/x', keys: { p256dh: P256DH, auth: AUTH } } } });
    expect(bad.status()).toBe(400);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Turn off notifications' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn off notifications' }).click();
    await expect.poll(async () => (await status()).subscribed).toBe(false);
    expect(errors).toEqual([]);
  });
});

test.describe('service worker push handler (public/push-sw.js)', () => {
  /** Run the real file in a vm with a fake ServiceWorkerGlobalScope. */
  function boot(opts: { clients?: any[] } = {}) {
    const listeners: Record<string, (e: any) => void> = {};
    const shown: any[] = []; const opened: string[] = []; const badges: (number | 'clear')[] = [];
    const self: any = {
      location: { origin: 'https://gym.example.com' },
      addEventListener: (t: string, f: (e: any) => void) => { listeners[t] = f; },
      registration: { showNotification: async (title: string, o: any) => { shown.push({ title, ...o }); } },
      navigator: { setAppBadge: async (n: number) => { badges.push(n); }, clearAppBadge: async () => { badges.push('clear'); } },
      clients: { matchAll: async () => opts.clients ?? [], openWindow: async (u: string) => { opened.push(u); } },
    };
    vm.runInNewContext(readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8'), { self, URL, Promise, Date, JSON });
    const fire = async (type: string, e: any) => { let p: Promise<unknown> = Promise.resolve(); await listeners[type]({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
    return { listeners, shown, opened, badges, fire };
  }
  const data = (o: object) => ({ data: { json: () => o, text: () => JSON.stringify(o) } });

  test('push shows the notification from the payload, sets the badge, and registers both listeners', async () => {
    const sw = boot();
    expect(Object.keys(sw.listeners).sort()).toEqual(['notificationclick', 'push']);
    await sw.fire('push', data({ type: 'rest', title: 'Rest over: set 3 of 4', body: 'Back squat · 82.5 kg × 6. Let\'s go.', tag: 'rest', url: '/app/session/live', badge: 2, ts: 1234 }));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]).toMatchObject({ title: 'Rest over: set 3 of 4', body: 'Back squat · 82.5 kg × 6. Let\'s go.', tag: 'rest', renotify: true, timestamp: 1234, icon: '/app/icon-192.png', data: { url: '/app/session/live', type: 'rest' } });
    expect(sw.badges).toEqual([2]);
    await sw.fire('push', data({ title: 'x', badge: 0 }));
    expect(sw.badges).toEqual([2, 'clear']);
  });

  test('always shows something (userVisibleOnly), even for empty or malformed payloads', async () => {
    const sw = boot();
    await sw.fire('push', {});
    await sw.fire('push', { data: { json: () => { throw new Error('bad'); }, text: () => 'plain text body' } });
    await sw.fire('push', { data: { json: () => { throw new Error('bad'); }, text: () => { throw new Error('bad'); } } });
    expect(sw.shown.map((n) => [n.title, n.body])).toEqual([['Rep', ''], ['Rep', 'plain text body'], ['Rep', '']]);
    expect(sw.badges).toEqual([]);
  });

  test('click focuses and routes an open app window; opens a new one otherwise', async () => {
    const calls: string[] = [];
    const win = { url: 'https://gym.example.com/app/today', focus: async () => { calls.push('focus'); return win; }, navigate: async (u: string) => { calls.push('nav:' + u); }, postMessage: (m: any) => calls.push('msg:' + m.url) };
    const closed: number[] = [];
    const click = (url: unknown) => ({ notification: { data: { url }, close: () => closed.push(1) } });
    const a = boot({ clients: [{ url: 'https://gym.example.com/elsewhere', focus: async () => { throw new Error('wrong window'); } }, win] });
    await a.fire('notificationclick', click('/app/session/live'));
    expect(calls).toEqual(['focus', 'nav:/app/session/live']);
    expect(closed).toHaveLength(1);
    expect(a.opened).toEqual([]);
    const b = boot({ clients: [] });
    await b.fire('notificationclick', click('/app/resume'));
    expect(b.opened).toEqual(['/app/resume']);
  });

  test('click falls back to postMessage when the window cannot navigate', async () => {
    const msgs: string[] = [];
    const win: any = { url: 'https://gym.example.com/app/', focus: async () => win, postMessage: (m: any) => msgs.push(m.type + ':' + m.url) };
    const sw = boot({ clients: [win] });
    await sw.fire('notificationclick', { notification: { data: { url: '/app/resume' }, close() {} } });
    expect(msgs).toEqual(['push-open:/app/resume']);
  });

  test('only same-origin /app/ URLs are ever opened (payload URLs are untrusted)', async () => {
    const sw = boot();
    for (const u of ['https://evil.example/app/', '//evil.example/app/', '/admin', 'javascript:alert(1)', '/app/../admin', undefined, 42])
      await sw.fire('push', data({ title: 't', url: u }));
    expect(sw.shown.map((n) => n.data.url)).toEqual(['/app/', '/app/', '/app/', '/app/', '/app/', '/app/', '/app/']);
    for (const n of sw.shown) await sw.fire('notificationclick', { notification: { data: n.data, close() {} } });
    expect(sw.opened.every((u) => u.startsWith('/app/'))).toBe(true);
  });
});

test.describe('Icon badge (Badging API)', () => {
  /** records navigator.setAppBadge / clearAppBadge calls on window.__badge */
  const spyBadge = (page: Page) => page.addInitScript(() => {
    const w = window as any; w.__badge = [];
    (navigator as any).setAppBadge = async (n: number) => { w.__badge.push(n); };
    (navigator as any).clearAppBadge = async () => { w.__badge.push(0); };
  });
  const last = (page: Page) => page.evaluate(() => { const b = (window as any).__badge as number[]; return b[b.length - 1]; });
  const done = (n: number) => Array.from({ length: n }, (_, i) => makeSession({ id: `b${i}`, seq: i + 1, slot: i, areaId: areas[0].id, areaName: 'Upper body', daysAgo: 0, exerciseIds: ['bench_press'] }));

  test('shows sessions left this week on the icon, even before notifications are enabled', async ({ page }) => {
    await spyBadge(page); await stub(page); await mockApi(page);
    await seed(page, { ...withAccount, sessions: done(1) });
    await page.goto('settings');
    await expect.poll(() => last(page)).toBe(3);
  });

  test('cleared once the week is secured', async ({ page }) => {
    await spyBadge(page); await stub(page); await mockApi(page);
    await seed(page, { ...withAccount, sessions: done(4) });
    await page.goto('settings');
    await expect.poll(() => last(page)).toBe(0);
  });

  test('the Icon badge switch clears it and brings it back', async ({ page }) => {
    await spyBadge(page); await stub(page); await mockApi(page);
    await seed(page, { ...withAccount, sessions: done(1) });
    await page.goto('notifications');
    await expect.poll(() => last(page)).toBe(3);
    await row(page, 'Icon badge').uncheck();
    await expect.poll(() => last(page)).toBe(0);
    await row(page, 'Icon badge').check();
    await expect.poll(() => last(page)).toBe(3);
  });

  test('pref off from the start: never set', async ({ page }) => {
    await spyBadge(page); await stub(page); await mockApi(page);
    await page.addInitScript(() => localStorage.setItem('rep-push-prefs', JSON.stringify({ rest: true, left: true, nudge: false, badge: false, streak: true })));
    await seed(page, { ...withAccount, sessions: done(1) });
    await page.goto('settings');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => ((window as any).__badge as number[]).filter((n) => n > 0))).toEqual([]);
  });
});
