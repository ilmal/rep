// Exercise how-to content: detail view, editor (built-in override + reset, custom), media (image lightbox, direct video, YouTube/Vimeo
// click-to-load facades), live "Up next" sheet, PreSession info button, library indicator, 375px, offline.
// Run against a production build (E2E_PROD=1) the CSP header is real too: the `errors` fixture fails on any CSP console error.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { test, expect, seed, readState } from './fixtures';
import { live, open as openLive, h1, startSet } from './live-helpers';
import { BUILTIN_CONTENT } from '../../src/shared/exercise-content';
import type { ExercisePref, MediaItem } from '../../src/shared/types';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const PNG = readFileSync(join(ASSETS, 'squat.png'));
const WEBM = readFileSync(join(ASSETS, 'tiny.webm'));
const CDN = 'https://cdn.example.test';
const IMG = `${CDN}/squat.png`;
const VID = `${CDN}/squat.webm`;
const YT = 'https://youtu.be/dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/123456789';
const SQ = BUILTIN_CONTENT.back_squat;
// Playwright cannot route requests the service worker makes itself: block the SW so the fake CDN is what the page talks to.
test.use({ serviceWorkers: 'block' });

/** Serve the fake CDN + stub the embed hosts; records every request that would leave the app for YouTube/Vimeo. */
async function stubNet(page: Page) {
  const third: string[] = [];
  await page.route(`${CDN}/**`, (r: Route) => (r.request().url().endsWith('.png') ? r.fulfill({ body: PNG, contentType: 'image/png' }) : r.request().url().endsWith('.webm') ? r.fulfill({ body: WEBM, contentType: 'video/webm' }) : r.fulfill({ status: 404, body: '' })));
  await page.route(/youtube(-nocookie)?\.com|vimeo\.com|ytimg\.com/, (r: Route) => { third.push(r.request().url()); return r.fulfill({ body: '<!doctype html><title>stub</title>', contentType: 'text/html' }); });
  return third;
}
const pref = (id: string, content: ExercisePref['content'], over: Partial<ExercisePref> = {}): Record<string, ExercisePref> => ({ [id]: { exerciseId: id, favorite: false, avoid: false, relevance: 50, content, ...over } });
const MEDIA: MediaItem[] = [
  { id: 'm1', kind: 'image', url: IMG, caption: 'Bottom position' },
  { id: 'm2', kind: 'video', url: VID, title: 'Tempo demo' },
  { id: 'm3', kind: 'video', url: YT, title: 'Squat form check' },
  { id: 'm4', kind: 'video', url: VIMEO, title: 'Vimeo cue' },
  { id: 'm5', kind: 'video', url: 'https://example.org/article/squat', title: 'Read: bracing' },
];
const prefs = async (page: Page) => (await readState(page)).prefs as Record<string, ExercisePref>;
const noOverflow = (page: Page) => page.evaluate(() => {
  const bad = [document.documentElement, document.body, ...document.querySelectorAll<HTMLElement>('.app, .scroll, .sheet')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'auto');
  return bad.map((e) => `${e.tagName}.${e.className}:${e.scrollWidth}>${e.clientWidth}`);
});

test.describe('detail: how to', () => {
  test('built-in text: summary, numbered steps, cues, good to know, built-in demo video; no "Your edits"', async ({ page, errors }) => {
    await seed(page);
    await page.goto('library/back_squat');
    const card = page.getByTestId('how-to-card');
    await expect(card.getByRole('heading', { name: 'How to' })).toBeVisible();
    await expect(card.getByText(SQ.summary!)).toBeVisible();
    const steps = card.locator('ol.guide-steps > li');
    await expect(steps).toHaveCount(SQ.steps!.length);
    await expect(steps.first()).toHaveText(SQ.steps![0]);
    expect(await steps.first().evaluate((e) => getComputedStyle(e).display)).toBe('list-item'); // real numbered list
    await expect(card.getByRole('heading', { name: 'Think about' })).toBeVisible();
    await expect(card.locator('.guide-cues li')).toHaveCount(SQ.cues!.length);
    await expect(card.getByRole('heading', { name: 'Good to know' })).toBeVisible();
    await expect(card.locator('.guide-tips li')).toHaveCount(SQ.goodToKnow!.length);
    await expect(card.getByRole('heading', { name: 'Watch it done' })).toBeVisible();
    await expect(card.locator('.vfacade')).toHaveCount(1); // in-app player, no outbound link
    await expect(card.locator('iframe')).toHaveCount(0); // nothing loads until tapped
    await expect(card.getByRole('link', { name: /Find a video/ })).toHaveCount(0);
    await expect(page.getByTestId('your-edits')).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Edit how-to' })).toHaveAttribute('href', /exercise\/back_squat\/edit#how-to$/);
    expect(errors).toEqual([]);
  });

  test('user text wins per field, other fields keep the built-in text', async ({ page }) => {
    await seed(page, { prefs: pref('back_squat', { steps: ['Only my step'], summary: 'My own summary' }) });
    await page.goto('library/back_squat');
    const card = page.getByTestId('how-to-card');
    await expect(card.getByText('My own summary')).toBeVisible();
    await expect(card.locator('ol.guide-steps > li')).toHaveText(['Only my step']);
    await expect(card.locator('.guide-cues li')).toHaveCount(SQ.cues!.length); // default kept
    await expect(page.getByTestId('your-edits')).toBeVisible();
  });

  test('every built-in has content on its page (spot check across groups)', async ({ page }) => {
    await seed(page);
    for (const [id, name] of [['pushup', 'Push-ups'], ['plank', 'Plank'], ['face_pull', 'Cable face pull'], ['bike_intervals', 'Bike intervals'], ['pistol_squat', 'Pistol squat']]) {
      await page.goto(`library/${id}`);
      await expect(page.getByRole('heading', { name })).toBeVisible();
      expect(await page.locator('ol.guide-steps > li').count()).toBeGreaterThanOrEqual(3);
      await expect(page.getByTestId('how-to-card').getByText('No how-to for this exercise yet')).toHaveCount(0);
    }
  });
});

test.describe('media rendering', () => {
  test('image: lazy, alt from caption, sized; tap opens the lightbox; Escape / close button / backdrop close it and focus returns', async ({ page, errors }) => {
    await stubNet(page);
    await seed(page, { prefs: pref('back_squat', { media: [MEDIA[0]] }) });
    await page.goto('library/back_squat');
    const img = page.locator('.gm-img img');
    await expect(img).toHaveAttribute('alt', 'Bottom position');
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveAttribute('width', '400');
    await expect(page.getByText('Bottom position', { exact: true }).first()).toBeVisible();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
    const thumb = page.getByRole('button', { name: 'Enlarge: Bottom position' });
    await thumb.click();
    const lb = page.getByRole('dialog', { name: 'Bottom position' });
    await expect(lb).toBeVisible();
    await expect(lb).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('button', { name: 'Close image' })).toBeFocused();
    await expect(lb.locator('img')).toHaveAttribute('src', IMG);
    await page.keyboard.press('Tab'); // trap: focus never leaves the dialog
    expect(await lb.evaluate((e) => e.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(lb).toHaveCount(0);
    await expect(thumb).toBeFocused();
    await thumb.click();
    await page.getByRole('button', { name: 'Close image' }).click();
    await expect(lb).toHaveCount(0);
    await thumb.click();
    await page.mouse.click(5, 300); // backdrop
    await expect(lb).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a broken image degrades to a link instead of a broken icon', async ({ page }) => {
    await page.route(`${CDN}/**`, (r) => r.abort());
    await seed(page, { prefs: pref('back_squat', { media: [MEDIA[0]] }) });
    await page.goto('library/back_squat');
    await expect(page.getByText('Image not available right now')).toBeVisible();
    await expect(page.locator('a.gm-broken')).toHaveAttribute('href', IMG);
  });

  test('direct video file: <video controls playsinline preload=metadata>', async ({ page, errors }) => {
    await stubNet(page);
    await seed(page, { prefs: pref('back_squat', { media: [MEDIA[1]] }) });
    await page.goto('library/back_squat');
    const v = page.locator('video.gm-video');
    await expect(v).toBeVisible();
    await expect(v).toHaveAttribute('src', VID);
    await expect(v).toHaveAttribute('controls', '');
    await expect(v).toHaveAttribute('playsinline', '');
    await expect(v).toHaveAttribute('preload', 'metadata');
    await expect(page.getByText('Tempo demo')).toBeVisible();
    await expect.poll(() => v.evaluate((e: HTMLVideoElement) => e.readyState)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('YouTube and Vimeo are click-to-load facades: nothing third-party is requested until the tap, then a privacy embed', async ({ page, errors }) => {
    const third = await stubNet(page);
    await seed(page, { prefs: pref('back_squat', { media: [MEDIA[2], MEDIA[3]] }) });
    await page.goto('library/back_squat');
    const yt = page.getByRole('button', { name: 'Play video: Squat form check' });
    await expect(yt).toBeVisible();
    await expect(yt).toContainText('Tap to play');
    await expect(page.locator('iframe')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(third.filter((u) => !u.startsWith('https://i.ytimg.com/vi/'))).toEqual([]); // only the poster thumbnail, no player
    await yt.click();
    const frame = page.locator('iframe').first();
    await expect(frame).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1&playsinline=1');
    await expect(frame).toHaveAttribute('loading', 'lazy');
    expect(await frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
    expect(await frame.getAttribute('allow')).toContain('encrypted-media');
    expect(await frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    await expect(page.getByRole('link', { name: 'Open on YouTube' })).toHaveAttribute('href', YT);
    await expect(page.locator('iframe')).toHaveCount(1); // Vimeo still not loaded
    await page.getByRole('button', { name: 'Play video: Vimeo cue' }).click();
    await expect(page.locator('iframe').nth(1)).toHaveAttribute('src', 'https://player.vimeo.com/video/123456789?dnt=1&autoplay=1&playsinline=1');
    expect(third.every((u) => /youtube-nocookie\.com|i\.ytimg\.com|player\.vimeo\.com/.test(u))).toBe(true); // never plain youtube.com
    expect(errors).toEqual([]);
  });

  test('other https links are plain links in a new tab; hostile / non-https media never reaches the DOM (hydrate sanitises)', async ({ page, errors }) => {
    await stubNet(page);
    const bad = [
      { id: 'b1', kind: 'image', url: 'javascript:alert(1)' }, { id: 'b2', kind: 'image', url: 'http://insecure.example/x.jpg' }, { id: 'b3', kind: 'video', url: 'data:text/html,<script>1</script>' },
      { id: 'b4', kind: 'image', url: 'https://u:p@cdn.example.test/squat.png' }, MEDIA[4], MEDIA[0],
    ];
    await seed(page, { prefs: { ...pref('back_squat', { summary: 5, steps: 'not-a-list', cues: [1, null], media: bad } as never), ...pref('rdl', 'garbage' as never) } });
    await page.goto('library/back_squat');
    const link = page.getByRole('link', { name: /Read: bracing/ });
    await expect(link).toHaveAttribute('href', 'https://example.org/article/squat');
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await link.getAttribute('rel')).toMatch(/noopener/);
    await expect(page.locator('.gm')).toHaveCount(2); // the article link and the one valid image
    await expect(page.locator('img[src^="http:"], [href^="javascript"], [src^="javascript"], [src^="data:text"]')).toHaveCount(0);
    await expect(page.locator('ol.guide-steps > li').first()).toHaveText(SQ.steps![0]); // corrupt fields fall back to the built-in text
    await page.goto('library/rdl'); // a non-object content is dropped too
    await expect(page.locator('ol.guide-steps > li').first()).toBeVisible();
    await expect.poll(async () => (await prefs(page)).back_squat).toBeTruthy();
    expect(errors).toEqual([]);
  });
});

test.describe('editor', () => {
  test.beforeEach(async ({ page }) => { await stubNet(page); await seed(page); });

  test('built-in: edit steps/cues/tips/media, save the override only (no label copy), view it, reset per field then all', async ({ page, errors }) => {
    await page.goto('library/back_squat');
    await page.getByTestId('how-to-card').getByRole('link', { name: 'Edit how-to' }).click();
    await expect(page).toHaveURL(/exercise\/back_squat\/edit#how-to$/);
    const ed = page.getByTestId('content-editor');
    await expect(ed).toBeVisible();
    await expect(ed.getByRole('button', { name: /Reset all to default/ })).toHaveCount(0); // nothing customised yet
    await expect(ed.getByLabel('Step 1', { exact: true })).toHaveValue(SQ.steps![0]);

    await ed.getByLabel('Step 1', { exact: true }).fill('Set the bar low on the traps');
    await ed.getByRole('button', { name: 'Move step 2 up' }).click();
    await expect(ed.getByLabel('Step 1', { exact: true })).toHaveValue(SQ.steps![1]);
    await ed.getByRole('button', { name: 'Remove tip 1' }).click();
    await ed.getByRole('button', { name: 'Add cue' }).click();
    await ed.getByLabel(`Cue ${SQ.cues!.length + 1}`, { exact: true }).fill('Knees out');
    await ed.getByLabel('Summary').fill('My squat summary');

    // media: live kind detection + validation
    const link = ed.getByLabel('Media link');
    await link.fill('javascript:alert(1)');
    await expect(page.getByTestId('media-kind')).toHaveText(/Not a valid link/);
    await expect(ed.getByRole('button', { name: 'Add to exercise' })).toBeDisabled();
    await link.fill('http://cdn.example.test/squat.png');
    await expect(ed.getByRole('button', { name: 'Add to exercise' })).toBeDisabled();
    await link.fill(IMG);
    await expect(page.getByTestId('media-kind')).toHaveText('Image');
    await expect(ed.locator('img.ced-prev')).toBeVisible();
    await ed.getByLabel('Media caption').fill('Depth check');
    await ed.getByRole('button', { name: 'Add to exercise' }).click();
    await expect(link).toHaveValue('');
    await link.fill(VID);
    await expect(page.getByTestId('media-kind')).toHaveText('Video file');
    await ed.getByRole('button', { name: 'Add to exercise' }).click();
    await link.fill(YT);
    await expect(page.getByTestId('media-kind')).toContainText('YouTube video');
    await ed.getByLabel('Media title').fill('Form check');
    await ed.getByRole('button', { name: 'Add to exercise' }).click();
    await link.fill(YT);
    await ed.getByRole('button', { name: 'Add to exercise' }).click();
    await expect(page.getByText('That link is already attached.')).toBeVisible();
    await link.fill('https://img.example.test/p/42');
    await expect(page.getByTestId('media-kind')).toContainText('Web page');
    await ed.getByLabel('This link is an image').check();
    await expect(page.getByTestId('media-kind')).toHaveText('Image');

    await page.getByRole('button', { name: 'Save exercise' }).click();
    await expect(page.locator('.toast')).toContainText('Back squat saved');
    await expect.poll(async () => (await prefs(page)).back_squat?.content?.media?.length).toBe(4);
    const st = await readState(page);
    const c = st.prefs.back_squat.content;
    expect(c.summary).toBe('My squat summary');
    expect(c.steps[0]).toBe(SQ.steps![1]);
    expect(c.steps[1]).toBe('Set the bar low on the traps');
    expect(c.cues).toEqual([...SQ.cues!, 'Knees out']);
    expect(c.goodToKnow).toEqual(SQ.goodToKnow!.slice(1));
    expect(c.media.map((m: MediaItem) => [m.kind, m.url, m.caption ?? m.title])).toEqual([['video', expect.stringContaining('youtube.com/watch?v='), expect.any(String)], ['image', IMG, 'Depth check'], ['video', VID, undefined], ['video', YT, 'Form check']]);
    expect(Object.keys(st.exercises)).toEqual([]); // built-in labels untouched: no personal copy was created
    expect(st.prefs.back_squat).toMatchObject({ favorite: false, avoid: false, relevance: 50 });
    expect(st.outbox['pref:back_squat']).toBeTruthy();
    expect(st.device.draft).toBeNull(); // (no draft existed; content never creates or clears one)

    // detail shows it
    await page.getByRole('link', { name: 'View' }).click();
    await expect(page).toHaveURL(/library\/back_squat$/);
    await expect(page.getByTestId('your-edits')).toBeVisible();
    await expect(page.getByText('My squat summary')).toBeVisible();
    await expect(page.locator('.gm')).toHaveCount(4);

    // reset one field in the editor, save: only that override is dropped
    await page.getByRole('link', { name: 'Edit exercise' }).click();
    const ed2 = page.getByTestId('content-editor');
    await expect(ed2.getByLabel('Step 2', { exact: true })).toHaveValue('Set the bar low on the traps');
    await page.getByTestId('edit-steps').getByRole('button', { name: 'Reset to default' }).click();
    await expect(ed2.getByLabel('Step 2', { exact: true })).toHaveValue(SQ.steps![1]);
    await page.getByRole('button', { name: 'Save exercise' }).click();
    await expect.poll(async () => (await prefs(page)).back_squat?.content?.steps).toBeUndefined();
    expect((await prefs(page)).back_squat.content.summary).toBe('My squat summary');
    // reset everything
    await ed2.getByRole('button', { name: 'Reset all to default' }).click();
    await expect(ed2.getByLabel('Summary')).toHaveValue(SQ.summary!);
    await expect(ed2.getByLabel('Media link')).toHaveValue('');
    await expect(ed2.locator('.ced-media')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save exercise' }).click();
    await expect.poll(async () => (await prefs(page)).back_squat?.content).toBeUndefined();
    await page.getByRole('link', { name: 'View' }).click();
    await expect(page.getByTestId('your-edits')).toHaveCount(0);
    await expect(page.locator('.gm')).toHaveCount(1);
    await expect(page.getByTestId('how-to-card').getByText(SQ.summary!)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('built-in: adding then removing media leaves no override and no label copy', async ({ page }) => {
    await page.goto('exercise/back_squat/edit');
    await page.getByLabel('Media link').fill(IMG);
    await page.getByRole('button', { name: 'Add to exercise' }).click();
    await page.getByRole('button', { name: 'Remove cdn.example.test' }).click();
    await expect(page.locator('.ced-media')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save exercise' }).click();
    await expect(page.locator('.toast')).toContainText('saved');
    const st = await readState(page);
    expect(st.prefs.back_squat?.content).toBeUndefined();
    expect(Object.keys(st.exercises)).toEqual([]);
  });

  test('custom exercise: write how-to while creating; it lives on the pref, the legacy cue seeds the steps', async ({ page, errors }) => {
    await page.goto('exercise/new');
    await page.getByPlaceholder('e.g. Landmine press').fill('Zercher squat');
    await page.getByRole('button', { name: 'Quads', exact: true }).first().click();
    await page.getByRole('button', { name: 'Squat', exact: true }).click();
    await page.getByPlaceholder('How to do it, in one or two lines').fill('Hold the bar in the elbows');
    const ed = page.getByTestId('content-editor');
    await expect(ed.getByLabel('Step 1', { exact: true })).toHaveCount(0); // new: the form's cue only becomes steps once saved
    await ed.getByRole('button', { name: 'Add step' }).click();
    await ed.getByLabel('Step 1', { exact: true }).fill('Unrack and walk out');
    await ed.getByRole('button', { name: 'Add tip' }).click();
    await ed.getByLabel('Tip 1', { exact: true }).fill('Pad the bar');
    await page.getByRole('button', { name: 'Save exercise' }).click();
    await expect(page.locator('.toast')).toContainText('added to your library');
    await page.getByRole('link', { name: 'View' }).click();
    await expect(page.getByTestId('how-to-card').locator('ol.guide-steps > li')).toHaveText(['Unrack and walk out']);
    await expect(page.getByTestId('how-to-card').locator('.guide-tips li')).toHaveText(['Pad the bar']);
    await expect.poll(async () => Object.keys((await readState(page)).exercises).length).toBe(1);
    const st = await readState(page);
    const id = Object.keys(st.exercises)[0];
    expect(st.exercises[id]).toMatchObject({ name: 'Zercher squat', cue: 'Hold the bar in the elbows', isCustom: true });
    expect(st.exercises[id].content).toBeUndefined(); // content is NOT on the exercise entity
    expect(st.prefs[id].content).toEqual({ steps: ['Unrack and walk out'], goodToKnow: ['Pad the bar'] });
    // custom without steps shows the one-line cue as the step
    await page.goto(`exercise/${id}/edit`);
    await page.getByTestId('edit-steps').getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByLabel('Step 1', { exact: true })).toHaveValue('Hold the bar in the elbows');
    expect(errors).toEqual([]);
  });

  test('empty custom exercise shows the empty state with a way to add', async ({ page }) => {
    await page.goto('exercise/new');
    await page.getByPlaceholder('e.g. Landmine press').fill('Odd lift');
    await page.getByRole('button', { name: 'Core', exact: true }).first().click();
    await page.getByRole('button', { name: 'Core', exact: true }).last().click();
    await page.getByRole('button', { name: 'Save exercise' }).click();
    await page.getByRole('link', { name: 'View' }).click();
    await expect(page.getByText('No how-to for this exercise yet')).toBeVisible();
    await expect(page.getByRole('link', { name: /Find a video/ })).toHaveCount(0);
  });
});

test.describe('in a session', () => {
  test('Up next: "How to do it" opens a sheet (Escape/close/scrim), and the set screen stays clean', async ({ page, errors }) => {
    await stubNet(page);
    await openLive(page, live(), { prefs: pref('back_squat', { cues: ['My bracing cue'], media: [MEDIA[0]] }) });
    await expect(h1(page)).toHaveText('Back squat');
    const btn = page.getByRole('button', { name: 'How to do it' });
    await expect(btn).toBeVisible();
    await expect(btn).toHaveCSS('min-height', '44px');
    await btn.click();
    const sheet = page.getByRole('dialog', { name: 'How to do Back squat' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('ol.guide-steps > li')).toHaveCount(SQ.steps!.length);
    await expect(sheet.locator('.guide-cues li')).toHaveText(['My bracing cue']);
    await expect(sheet.locator('.gm-img')).toHaveCount(1);
    await expect(sheet.getByRole('link', { name: 'Edit how-to' })).toHaveCount(0); // a tap can never leave the workout
    await expect(sheet.getByRole('button', { name: 'Close how-to' })).toBeFocused();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab'); // focus trap
    expect(await sheet.evaluate((e) => e.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(btn).toBeFocused();
    await btn.click();
    await page.locator('button.scrim').click({ position: { x: 20, y: 40 } }); // the scrim
    await expect(sheet).toHaveCount(0);
    await btn.click();
    await sheet.getByRole('button', { name: 'Close how-to' }).click();
    await expect(sheet).toHaveCount(0);
    // lightbox over the sheet: Escape closes only the lightbox first
    await btn.click();
    await page.getByRole('button', { name: /Enlarge/ }).click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('lightbox')).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // during a set: only exercise, set n of N, weight, reps, Done: no guide, no How-to button
    await startSet(page);
    await expect(page.getByRole('button', { name: 'How to do it' })).toHaveCount(0);
    await expect(page.locator('.guide, [data-testid="exercise-guide"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Find a video/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Up next fits one screen on a small phone with the extra button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openLive(page, live());
    await expect(page.getByRole('button', { name: 'How to do it' })).toBeVisible();
    const start = page.getByRole('button', { name: 'Start set 1' });
    await expect(start).toBeVisible();
    const box = (await start.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(667);
    expect(await page.locator('.live-intro').evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
    expect(await noOverflow(page)).toEqual([]);
  });

  test('PreSession: info button on each row opens the same guide sheet', async ({ page, errors }) => {
    await seed(page);
    await page.goto('session/preview');
    const rows = page.locator('.group .li').filter({ has: page.locator('.ord') });
    await expect(rows.first()).toBeVisible();
    const name = await rows.first().locator('.li-t').innerText();
    await rows.first().getByRole('button', { name: `How to do ${name}` }).click();
    const sheet = page.getByRole('dialog', { name: `How to do ${name}` });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('ol.guide-steps > li').first()).toBeVisible();
    await expect(sheet.locator('.vfacade')).toHaveCount(1);
    await expect(sheet.getByRole('link', { name: 'Edit how-to' })).toHaveAttribute('href', /\/edit#how-to$/);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // the planned session is untouched by looking
    expect(await rows.count()).toBeGreaterThan(2);
    expect(errors).toEqual([]);
  });
});

test.describe('library + layout + offline', () => {
  test('library rows flag exercises with your own notes (book) or photos/videos (image); others have no flag', async ({ page }) => {
    await seed(page, { prefs: { ...pref('back_squat', { steps: ['x'] }), ...pref('rdl', { media: [MEDIA[0]] }), ...pref('deadlift', {}) } });
    await page.goto('library/all?reset=1');
    const row = (n: string) => page.locator('.exrow').filter({ hasText: n }).first();
    await expect(row('Back squat').getByRole('img', { name: 'Has your how-to notes' })).toBeVisible();
    await expect(row('Romanian deadlift').getByRole('img', { name: 'Has your photos or videos' })).toBeVisible();
    await expect(row('Deadlift').getByTestId('has-howto')).toHaveCount(0);
    await expect(page.getByTestId('has-howto')).toHaveCount(2);
  });

  test('375px: detail with every media kind, the editor and the sheet have no horizontal overflow', async ({ page }) => {
    await stubNet(page);
    await page.setViewportSize({ width: 375, height: 667 });
    const long = { id: 'm9', kind: 'video', url: `https://example.org/${'a-very-long-path-segment/'.repeat(8)}index`, title: 'A really quite long title for a link that must wrap properly on a small phone' };
    await seed(page, { prefs: pref('back_squat', { summary: 'S '.repeat(100), steps: ['word'.repeat(60)], media: [...MEDIA, long as MediaItem] }) });
    await page.goto('library/back_squat');
    await expect(page.locator('.gm').first()).toBeVisible();
    expect(await noOverflow(page)).toEqual([]);
    await page.goto('exercise/back_squat/edit');
    await expect(page.getByTestId('content-editor')).toBeVisible();
    expect(await noOverflow(page)).toEqual([]);
    for (const b of await page.getByTestId('content-editor').locator('button, .iconbtn').all()) {
      const bb = await b.boundingBox();
      if (bb) expect(bb.height, `target height of ${await b.getAttribute('aria-label')}`).toBeGreaterThanOrEqual(36);
    }
    await page.goto('session/preview');
    await page.getByRole('button', { name: /^How to do / }).first().click();
    await expect(page.getByTestId('guide-sheet')).toBeVisible();
    expect(await noOverflow(page)).toEqual([]);
    // the preview rows still fit with a third icon button
    await page.keyboard.press('Escape');
    expect(await noOverflow(page)).toEqual([]);
  });

  test('offline: the how-to text is available without a network; unreachable images degrade gracefully', async ({ page, context }) => {
    await page.route(`${CDN}/**`, (r) => r.abort());
    await seed(page, { prefs: pref('back_squat', { goodToKnow: ['Offline tip'], media: [MEDIA[0]] }) });
    await page.goto('library/all?reset=1');
    await expect(page.locator('.exrow').first()).toBeVisible();
    await context.setOffline(true);
    await page.locator('.exrow').filter({ hasText: 'Back squat' }).first().getByText('Back squat').click(); // in-app navigation, no network
    await expect(page.getByTestId('how-to-card')).toBeVisible();
    await expect(page.getByText('Offline tip')).toBeVisible();
    await expect(page.locator('ol.guide-steps > li')).toHaveCount(SQ.steps!.length);
    await expect(page.getByText('Image not available right now')).toBeVisible();
    await context.setOffline(false);
  });

  test('production build: sw.js carries the bounded stale-while-revalidate image cache', async ({ request, baseURL }) => {
    test.skip(!process.env.E2E_PROD, 'needs the built service worker');
    const sw = await (await request.get(new URL('sw.js', baseURL!).toString())).text();
    expect(sw).toContain('rep-exercise-images');
    expect(sw).toContain('StaleWhileRevalidate');
    expect(sw).toMatch(/maxEntries:40/);
    expect(sw).toMatch(/statuses:\[0,200\]/);
  });

  test('production build: the CSP header allows exactly the media origins', async ({ request, baseURL }) => {
    test.skip(!process.env.E2E_PROD, 'the CSP is set by the Bun server, not the Vite dev server');
    const r = await request.get(baseURL!);
    const csp = r.headers()['content-security-policy'];
    expect(csp).toContain('frame-src https://www.youtube-nocookie.com https://player.vimeo.com');
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("media-src 'self' blob: https:");
  });
});
