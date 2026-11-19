import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:8792';
const OUT = process.env.OUT ?? '/tmp/shots';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 59.343, longitude: 18.055 }, permissions: ['geolocation'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let n = 0;
const shot = (name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { console.log('✗', name, '-', String(e.message).split('\n')[0]); await shot('FAIL-' + name.replace(/\W+/g, '_')); process.exitCode = 1; throw e; } };
const click = (re, opts = {}) => p.getByRole(opts.role ?? 'button', { name: re }).first().click();
const link = (re) => p.getByRole('link', { name: re }).first().click();

try {
  await step('welcome', async () => { await p.goto(BASE); await p.getByRole('link', { name: /get started/i }).waitFor(); await shot('welcome'); });
  await step('goal', async () => { await link(/get started/i); await p.waitForURL(/onboarding\/goal/); await shot('goal'); });
  await step('goal → gyms', async () => { await p.getByRole('button', { name: /continue|next/i }).or(p.getByRole('link', { name: /continue|next/i })).first().click(); await p.waitForURL(/onboarding\/gyms/); await shot('gyms'); });
  await step('location', async () => { await click(/turn on location/i); await p.waitForTimeout(1500); await shot('gyms-found'); });
  await step('gyms → areas', async () => { await p.getByRole('button', { name: /continue|next|looks good/i }).or(p.getByRole('link', { name: /continue|next|looks good/i })).first().click(); await p.waitForURL(/onboarding\/areas/); await shot('areas'); });
  await step('finish onboarding', async () => { await p.getByRole('button', { name: /finish|done|start|build/i }).or(p.getByRole('link', { name: /finish|done|start|build/i })).first().click(); await p.waitForURL(`${BASE}/`); await p.waitForTimeout(500); await shot('today'); });
  await step('preview', async () => { await p.getByText(/start session 1/i).first().click(); await p.waitForURL(/session\/preview/); await p.waitForTimeout(800); await shot('preview'); });
  await step('start → warmup', async () => { await click(/at the gym/i, { role: 'link' }).catch(() => click(/at the gym/i)); await p.waitForURL(/session\/warmup/); await shot('warmup'); });
  await step('warmup done → live', async () => { await click(/warm-up done/i); await p.waitForURL(/session\/live/); await p.waitForTimeout(500); await shot('live-set'); });
  await step('log set → rest', async () => { await click(/^done/i); await p.getByText(/^rest$/i).first().waitFor(); await shot('rest'); });
  await step('skip rest, finish sets', async () => {
    for (let i = 0; i < 12; i++) {
      if (await p.getByText(/effort today/i).first().isVisible().catch(() => false)) break;
      const start = p.getByRole('button', { name: /start set \d+ now/i });
      if (await start.isVisible().catch(() => false)) await start.click();
      const done = p.getByRole('button', { name: /^done/i });
      if (await done.isVisible().catch(() => false)) await done.click();
      await p.waitForTimeout(150);
    }
    await shot('feedback');
  });
  await step('feedback → next exercise', async () => { await click(/just right/i); await click(/^next:/i); await p.waitForTimeout(400); await shot('live-ex2'); });
  await step('swap sheet', async () => { await click(/exercise options/i); await p.waitForTimeout(200); await click(/machine busy or broken/i); await p.waitForTimeout(300); await shot('swap-sheet'); });
  await step('pick swap alt', async () => { await p.getByRole('button', { name: /chest-supported row|one-arm|barbell row/i }).first().click(); await p.waitForTimeout(400); await shot('after-swap'); });
  await step('reload mid-session resumes', async () => { await p.reload(); await p.waitForTimeout(800); await shot('resume'); await p.waitForURL(/session\/live/); await p.getByText(/chest-supported row|one-arm|barbell row/i).first().waitFor(); });
  await step('offline mid-session', async () => { await ctx.setOffline(true); await p.evaluate(() => window.dispatchEvent(new Event('offline'))); await p.waitForTimeout(400); await shot('offline'); });
  await step('finish all exercises (offline)', async () => {
    for (let i = 0; i < 80; i++) {
      if (await p.getByText(/all exercises done/i).first().isVisible().catch(() => false)) break;
      const rate = p.getByRole('button', { name: /^just right$/i });
      if (await rate.isVisible().catch(() => false)) { await rate.click(); await p.getByRole('button', { name: /^(next:|save)/i }).click(); continue; }
      const start = p.getByRole('button', { name: /start set \d+ now/i });
      if (await start.isVisible().catch(() => false)) { await start.click(); continue; }
      const done = p.getByRole('button', { name: /^done/i });
      if (await done.isVisible().catch(() => false)) await done.click();
      await p.waitForTimeout(80);
    }
    await shot('all-done');
  });
  await step('back online → sync drains', async () => {
    await ctx.setOffline(false); await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForFunction(async () => { const r = await fetch('/api/health'); return r.ok; });
  });
  await step('finish → summary', async () => { await p.getByRole('button', { name: /finish session/i }).or(p.getByRole('link', { name: /finish session/i })).first().click(); await p.waitForURL(/session\/summary/); await p.waitForTimeout(900); await shot('summary'); });
  await step('summary → today shows 1/4', async () => { await p.getByRole('button', { name: /^done$/i }).or(p.getByRole('link', { name: /^done$/i })).first().click(); await p.waitForURL(`${BASE}/`); await p.getByText('1/4').first().waitFor(); await shot('today-after'); });
  for (const [name, path] of [['progress', '/progress'], ['history', '/history'], ['plan', '/plan'], ['planner', '/plan/planner'], ['library', '/library'], ['gyms', '/gyms'], ['settings', '/settings'], ['coach', '/settings/coach']]) {
    await step(name, async () => { await p.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, path); await p.waitForTimeout(700); await shot(name); });
  }
  await step('create coach token + MCP round trip', async () => {
    const tok = await p.evaluate(async () => {
      const s = JSON.parse(JSON.stringify(await new Promise((res) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => { const g = r.result.transaction('keyval').objectStore('keyval').get('rep-state-v1'); g.onsuccess = () => res(g.result.device); }; })));
      const r = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + s.token }, body: JSON.stringify({ name: 'e2e', scope: 'write' }) });
      return (await r.json()).token;
    });
    const rpc = async (name, args) => (await (await fetch(BASE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })).json()).result.content[0].text;
    let ov;
    for (let i = 0; i < 12; i++) { ov = JSON.parse(await rpc('get_overview', {})); if (ov.counts.completedSessions === 1) break; await p.waitForTimeout(1000); }
    if (ov.counts.completedSessions !== 1) throw new Error('server did not receive the offline-completed session: ' + ov.counts.completedSessions);
    await rpc('set_exercise_pref', { exerciseId: 'goblet_squat', favorite: true, relevance: 90 });
    await rpc('create_coach_plan', { title: 'Coach test', note: 'From Grok', slot: 2, exercises: [{ exerciseId: 'back_squat', sets: 3, reps: 5 }, { exerciseId: 'goblet_squat' }] });
    console.log('  mcp ok; completed sessions on server =', ov.counts.completedSessions);
  });
  await step('app pulls coach edits', async () => {
    await p.goto(BASE); await p.waitForTimeout(2500);
    await p.getByText(/coach plan/i).first().waitFor({ timeout: 8000 });
    await shot('today-coach');
  });
} finally {
  console.log('errors:', errors.length ? errors : 'none');
  await b.close();
}
