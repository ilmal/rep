import { test, expect, type Page } from '@playwright/test';

const ORIGIN = (process.env.E2E_LANDING ?? 'http://localhost:8825/').replace(/\/?$/, '/');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const go = async (page: Page) => { await page.goto(ORIGIN); await page.waitForLoadState('load'); };
const errs = (page: Page) => {
  const e: string[] = [];
  page.on('pageerror', (x) => e.push(String(x)));
  page.on('console', (m) => { if (m.type() === 'error') e.push(m.text()); });
  return e;
};

test.describe('landing', () => {
  test.use({ viewport: { width: 1440, height: 900 }, userAgent: DESKTOP });

  test('all sections render with the design copy', async ({ page }) => {
    const e = errs(page);
    await go(page);
    await expect(page).toHaveTitle('Gym Tracker — train by the week');
    await expect(page.locator('h1')).toHaveText('Train by the week, not the calendar.');
    for (const id of ['top', 'how', 'features', 'install', 'faq']) await expect(page.locator('#' + id)).toBeAttached();
    await expect(page.locator('h2')).toHaveText([
      'No schedule to fall behind on.', 'Built for real gym sessions.', 'Only what you need, when you need it.',
      'Get the exercises you actually like.', 'On your phone in 20 seconds.', 'Questions', 'Your next session is waiting.',
    ]);
    await expect(page.locator('#how .lp-card h3')).toHaveText(['Pick a weekly goal', 'Train when it suits you', 'Rate, and it adapts']);
    await expect(page.locator('#features .lp-card h3')).toHaveText(['Weekly counter', 'Progress that follows you', 'Fits your time', 'Knows your gym', 'One-tap swaps', 'Works offline']);
    await expect(page.locator('.lp-dark .lp-trio figcaption')).toHaveText(['Set', 'Rest', 'Done']);
    await expect(page.locator('.lp-chip')).toHaveCount(3);
    await expect(page.locator('.lp-float')).toHaveCount(2);
    await expect(page.locator('footer')).toContainText('rep.ilmal.se · © 2026 ilmal');
    await expect(page.locator('.lp-q')).toHaveCount(6);
    expect(e).toEqual([]);
  });

  test('every Open the app CTA goes to /app; QR section keeps domain text', async ({ page }) => {
    await go(page);
    const ctas = page.getByRole('link', { name: /Open the app|use it here in the browser/ });
    expect(await ctas.count()).toBeGreaterThanOrEqual(5);
    for (const h of await ctas.evaluateAll((a) => a.map((x) => x.getAttribute('href')))) expect(h).toBe('/app');
    await page.getByRole('button', { name: 'Computer' }).click();
    await expect(page.locator('img[alt="QR code for rep.ilmal.se/app"]')).toBeVisible();
  });

  test('nav anchors scroll to their sections', async ({ page }) => {
    await go(page);
    for (const [name, id] of [['How it works', 'how'], ['Features', 'features'], ['Install', 'install'], ['FAQ', 'faq']]) {
      await page.locator('.lp-links').getByRole('link', { name }).click();
      await expect(page).toHaveURL(new RegExp('#' + id + '$'));
      await expect.poll(() => page.locator('#' + id).evaluate((el) => Math.abs(el.getBoundingClientRect().top)), { timeout: 5000 }).toBeLessThan(120);
    }
    await expect(page.locator('.lp-menu')).toBeHidden();
  });

  test('install tabs switch', async ({ page }) => {
    await go(page);
    const pressed = (n: string) => page.getByRole('button', { name: n, exact: true });
    await pressed('iPhone').click();
    await expect(pressed('iPhone')).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed('Computer')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-panel=ios]')).toBeVisible();
    await expect(page.locator('[data-panel=ios] li')).toHaveCount(4);
    await expect(page.locator('[data-panel=android]')).toBeHidden();
    await pressed('Android').click();
    await expect(page.locator('[data-panel=android] li')).toHaveCount(4);
    await expect(page.locator('[data-panel=ios]')).toBeHidden();
    await pressed('Computer').click();
    await expect(page.locator('.lp-qr')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Or use it here in the browser' })).toHaveAttribute('href', '/app');
  });

  test('FAQ accordion: click, one open at a time, keyboard', async ({ page }) => {
    await go(page);
    const btns = page.locator('.lp-q > button');
    await expect(btns.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#faq-a0')).toBeVisible();
    await btns.nth(1).click();
    await expect(btns.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(btns.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#faq-a0')).toBeHidden();
    await expect(page.locator('#faq-a1')).toContainText('Nothing to download or update.');
    await btns.nth(1).click(); // toggle closed
    await expect(btns.nth(1)).toHaveAttribute('aria-expanded', 'false');
    // keyboard: focus, arrow, Enter, Space
    await btns.nth(2).focus();
    await page.keyboard.press('Enter');
    await expect(btns.nth(2)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(btns.nth(3)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(btns.nth(3)).toHaveAttribute('aria-expanded', 'true');
    await expect(btns.nth(2)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('End');
    await expect(btns.nth(5)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(btns.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(btns.nth(5)).toBeFocused();
  });

  test('meta tags, canonical, OG/Twitter, JSON-LD, robots, sitemap', async ({ page, request }) => {
    await go(page);
    const meta = (sel: string) => page.locator(sel).getAttribute('content');
    expect((await meta('meta[name=description]'))!.length).toBeGreaterThan(50);
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://rep.ilmal.se/');
    expect(await meta('meta[property="og:title"]')).toBeTruthy();
    expect(await meta('meta[property="og:image"]')).toBe('https://rep.ilmal.se/og-image.png');
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks.length).toBe(1);
    const ld = JSON.parse(blocks[0]);
    const types = ld.map((x: any) => x['@type']);
    expect(types).toEqual(['SoftwareApplication', 'FAQPage']);
    expect(ld[1].mainEntity).toHaveLength(6);
    expect(ld[1].mainEntity[0].acceptedAnswer.text).toBe('Yes. Gym Tracker is a free web app at rep.ilmal.se.');
    const robots = await request.get(ORIGIN + 'robots.txt');
    expect(await robots.text()).toContain('Sitemap: https://rep.ilmal.se/sitemap.xml');
    const sm = await request.get(ORIGIN + 'sitemap.xml');
    expect(await sm.text()).toContain('<loc>https://rep.ilmal.se/</loc>');
    for (const p of ['og-image.png', 'favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
      expect((await request.get(ORIGIN + p)).status(), p).toBe(200);
    }
  });

  test('images load (no 404s), sized, below-fold lazy; alt text and heading order', async ({ page }) => {
    const bad: string[] = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
    page.on('requestfailed', (r) => bad.push('fail ' + r.url()));
    await go(page);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
    await page.getByRole('button', { name: 'Computer' }).click();
    await page.waitForLoadState('networkidle');
    const imgs = await page.locator('img').evaluateAll((l) => l.map((i: any) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.getAttribute('width'), h: i.getAttribute('height'), alt: i.getAttribute('alt'), lazy: i.getAttribute('loading') })));
    expect(imgs.length).toBe(9);
    for (const i of imgs) { expect(i.ok, i.src).toBe(true); expect(i.w && i.h, i.src).toBeTruthy(); expect(i.alt, i.src).not.toBeNull(); }
    expect(imgs.filter((i) => i.lazy === 'lazy').length).toBeGreaterThanOrEqual(6);
    expect(imgs.filter((i) => i.src!.includes('phone-today'))[0].lazy).toBeNull();
    expect(bad).toEqual([]);
    const levels = await page.locator('h1,h2,h3').evaluateAll((l) => l.map((h) => +h.tagName[1]));
    expect(levels.filter((x) => x === 1)).toHaveLength(1);
    levels.forEach((x, i) => { if (i) expect(x - levels[i - 1]).toBeLessThanOrEqual(1); });
  });

  test('no layout shift from lazy images', async ({ page }) => {
    await go(page);
    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(h0);
  });
});

test.describe('mobile menu', () => {
  test.use({ viewport: { width: 440, height: 900 }, userAgent: IPHONE, hasTouch: true });
  test('opens, shows links, navigates and closes', async ({ page }) => {
    await go(page);
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(page.locator('.lp-links')).toBeHidden();
    await expect(page.locator('.lp-drop')).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.lp-drop')).toBeVisible();
    await expect(page.locator('.lp-drop a')).toHaveText(['How it works', 'Features', 'Install', 'FAQ', 'Open the app']);
    await expect(page.locator('.lp-drop .ic').first).toBeDefined();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lp-drop')).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await page.locator('.lp-drop').getByRole('link', { name: 'FAQ' }).click();
    await expect(page.locator('.lp-drop')).toBeHidden();
    await expect(page).toHaveURL(/#faq$/);
    await page.evaluate(() => scrollTo(0, 0));
    await menu.click();
    await menu.click();
    await expect(page.locator('.lp-drop')).toBeHidden();
  });
  test('menu also works on tablet width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await go(page);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.locator('.lp-drop')).toBeVisible();
  });
});

test.describe('UA-based install tab default', () => {
  for (const [name, ua, tab, label] of [['iPhone', IPHONE, 'ios', 'iPhone'], ['Android', ANDROID, 'android', 'Android'], ['desktop', DESKTOP, 'desktop', 'Computer']] as const) {
    test.describe(name, () => {
      test.use({ userAgent: ua });
      test('defaults to ' + label, async ({ page }) => {
        await go(page);
        await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(`[data-panel=${tab}]`)).toBeVisible();
        await expect(page.locator('.lp-panel:visible')).toHaveCount(1);
      });
    });
  }
});

test.describe('responsive overflow', () => {
  for (const w of [360, 390, 440, 768, 1024, 1440]) {
    test('no horizontal overflow at ' + w, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await go(page);
      for (const tab of ['iPhone', 'Android', 'Computer']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
        expect(m.s, tab).toBeLessThanOrEqual(m.c);
      }
      // nothing inside the page extends past the viewport either
      const wide = await page.evaluate((vw) => [...document.querySelectorAll('.lp *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 1 || r.left < -1) && !e.closest('.lp-skip'); }).map((e) => e.className || e.tagName).slice(0, 5), w);
      expect(wide).toEqual([]);
      await page.screenshot({ path: process.env.PW_OUT ? `${process.env.PW_OUT}/landing-${w}.png` : undefined, fullPage: true }).catch(() => {});
    });
  }
});

test('404 for unknown paths', async ({ request }) => {
  expect((await request.get(ORIGIN + 'no-such-page')).status()).toBe(404);
});
