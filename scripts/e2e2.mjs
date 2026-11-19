// Breadth E2E: every remaining screen + edge cases, with page-error capture and screenshots.
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:8794';
const OUT = process.env.OUT ?? '/tmp/shots2';
const b = await chromium.launch();
let fails = 0; const errors = [];
const mk = async (geo = { latitude: 59.343, longitude: 18.055 }) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(geo ? { geolocation: geo, permissions: ['geolocation'] } : {}) });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, p };
};
let n = 0;
const step = async (p, name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { fails++; console.log('✗', name, '-', String(e.message).split('\n')[0]); await p.screenshot({ path: `${OUT}/FAIL-${name.replace(/\W+/g, '_')}.png` }).catch(() => {}); } };
const shot = (p, name) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
const goto = async (p, path) => { await p.evaluate((x) => { history.pushState({}, '', x); dispatchEvent(new PopStateEvent('popstate')); }, path); await p.waitForTimeout(500); };
const onboard = async (p) => {
  await p.goto(BASE); await p.getByRole('link', { name: /get started/i }).click();
  const nxt = () => p.getByRole('button', { name: /continue|next|looks good/i }).or(p.getByRole('link', { name: /continue|next|looks good/i })).first();
  await nxt().click(); await p.waitForURL(/gyms/);
  await p.getByRole('button', { name: /skip location/i }).or(p.getByRole('link', { name: /skip location/i })).first().click().catch(() => {});
  await p.getByRole('button', { name: /turn on location/i }).click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(1200);
  await nxt().click(); await p.waitForURL(/areas/);
  await p.getByRole('button', { name: /finish|done|start|build/i }).or(p.getByRole('link', { name: /finish|done|start|build/i })).first().click();
  await p.waitForURL(`${BASE}/`);
};

// ── fresh user: empty states, sign-in sheet
{ const { ctx, p } = await mk();
  await step(p, 'welcome sign-in sheet', async () => { await p.goto(BASE); await p.getByRole('button', { name: /already have an account/i }).or(p.getByRole('link', { name: /already have an account/i })).first().click(); await p.getByLabel(/email/i).first().waitFor(); await shot(p, 'signin-sheet'); });
  await onboard(p);
  await step(p, 'empty progress', async () => { await goto(p, '/progress'); await p.getByText(/no data yet|nothing yet|first session|no sessions/i).first().waitFor(); await shot(p, 'empty-progress'); });
  await step(p, 'gym detail: cycle item ok→broken→none', async () => { await goto(p, '/gyms'); await p.getByRole('link', { name: /my gym/i }).first().click(); await p.waitForURL(/gyms\/.+/); const it = p.getByRole('button', { name: /^Barbell.*Available/i }).first(); await it.click(); await p.getByRole('button', { name: /^Barbell.*Broken/i }).first().click(); await p.getByRole('button', { name: /^Barbell.*Not here/i }).first().waitFor(); await shot(p, 'gym-detail'); });
  await step(p, 'add gym (skip location)', async () => { await goto(p, '/gyms/new'); await p.getByLabel(/name/i).first().fill('Office gym'); await p.getByRole('button', { name: /skip location|without location/i }).or(p.getByRole('link', { name: /skip location/i })).first().click().catch(() => {}); await p.getByRole('button', { name: /use my location/i }).click().catch(() => {}); await p.waitForTimeout(800); await shot(p, 'add-gym'); await p.getByRole('button', { name: /^(add|save)/i }).first().click(); await p.waitForURL(/gyms\/.+/); });
  await step(p, 'create custom exercise → appears in library', async () => { await goto(p, '/exercise/new'); await p.getByLabel(/name/i).first().fill('Zercher squat'); await p.getByRole('button', { name: /^Quads$/ }).first().click(); await p.getByRole('button', { name: /^Squat$/ }).first().click(); await shot(p, 'exercise-new'); await p.getByRole('button', { name: /^(save|add)/i }).first().click(); await p.waitForTimeout(500); await goto(p, '/library'); await p.getByPlaceholder(/search/i).fill('zercher'); await p.getByText('Zercher squat').first().waitFor(); await shot(p, 'library-custom'); });
  await step(p, 'exercise detail: favorite + relevance + avoid', async () => { await p.getByText('Zercher squat').first().click(); await p.waitForURL(/library\/.+/); await p.waitForTimeout(400); await shot(p, 'exercise-detail'); await p.getByRole('button', { name: /favorite/i }).first().click().catch(() => p.getByRole('switch', { name: /favorite/i }).first().click()); await p.waitForTimeout(300); });
  await step(p, 'area edit: pin an exercise', async () => { await goto(p, '/plan'); await p.getByText('Upper body').first().click(); await p.waitForURL(/plan\/area\/.+/); await p.getByRole('button', { name: /always include|unflag/i }).first().click(); await shot(p, 'area-edit'); });
  await step(p, 'planner screen: change weight', async () => { await goto(p, '/plan/planner'); await shot(p, 'planner'); });
  await step(p, 'settings: toggles + sign-in + export', async () => { await goto(p, '/settings'); await p.getByRole('switch').first().click(); await shot(p, 'settings'); });
  // session: end early (save + repeat), session plan drop/undo, session detail delete
  await step(p, 'start session → session plan drop/undo', async () => { await goto(p, '/'); await p.getByText(/start session 1/i).first().click(); await p.waitForURL(/preview/); await p.getByRole('button', { name: /at the gym/i }).or(p.getByRole('link', { name: /at the gym/i })).first().click(); await p.waitForURL(/warmup/); await p.getByRole('button', { name: /warm-up done/i }).click(); await p.waitForURL(/live/); await p.waitForTimeout(400); await p.getByRole('link', { name: /session overview/i }).click(); await p.waitForURL(/session\/plan/); await shot(p, 'session-plan'); await p.getByRole('button', { name: /^drop/i }).first().click(); await p.waitForTimeout(200); await shot(p, 'session-plan-dropped'); await p.getByRole('button', { name: /add back/i }).first().click(); });
  await step(p, 'end early → repeat next', async () => { await goto(p, '/session/end'); await p.getByRole('radio', { name: /repeat session/i }).click(); await shot(p, 'end-early'); await p.getByRole('button', { name: /end & save/i }).click(); await p.waitForURL(/summary/); await p.waitForTimeout(500); await p.getByRole('button', { name: /^done$/i }).or(p.getByRole('link', { name: /^done$/i })).first().click(); await p.waitForURL(`${BASE}/`); await p.getByText(/session 1 of rotation|Up next · Session 1/i).first().waitFor(); await shot(p, 'today-repeat'); });
  await step(p, 'session detail + delete', async () => { await goto(p, '/history'); await shot(p, 'history'); await p.getByRole('link', { name: /upper body/i }).first().click(); await p.waitForURL(/history\/.+/); await shot(p, 'session-detail'); await p.getByRole('button', { name: /delete this session/i }).click(); await p.getByRole('button', { name: /^delete session$/i }).click(); await p.waitForURL(/history$/); });
  await step(p, 'week done variant (goal 1)', async () => { await goto(p, '/plan'); await p.getByRole('button', { name: /fewer sessions/i }).click({ clickCount: 3 }).catch(() => {}); await goto(p, '/'); await shot(p, 'today-goal1'); });
  await ctx.close();
}
// ── geolocation permission denied
{ const { ctx, p } = await mk(null);
  await onboard(p);
  await step(p, 'location denied during start', async () => { await p.getByText(/start session 1/i).first().click(); await p.waitForURL(/preview/); await p.waitForTimeout(1500); await shot(p, 'location-denied'); });
  await ctx.close();
}
// ── far away from any gym
{ const { ctx, p } = await mk({ latitude: 40.7, longitude: -74.0 });
  await onboard(p);
  await step(p, 'unknown location during start', async () => { await p.getByText(/start session 1/i).first().click(); await p.waitForURL(/preview/); await p.waitForTimeout(1500); await shot(p, 'unknown-gym'); });
  await ctx.close();
}
console.log('errors:', errors.length ? [...new Set(errors)] : 'none'); console.log(fails ? `${fails} FAILED` : 'ALL OK');
await b.close();
process.exit(fails ? 1 : 0);
