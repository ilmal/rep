import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { openDb } from './db';
import { buildApi } from './api';
import { buildMcp } from './mcp';
import { buildExtensions } from './ext';
import { appSecurityHeaders } from './security';
import { relative, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
// hono's serveStatic joins `root` onto the cwd, so always hand it a cwd-relative path (absolute env values work too)
const rel = (p: string) => relative(process.cwd(), resolve(p)) || '.';
const DIST = rel(process.env.GYM_DIST ?? './dist');
import { hasSeen } from './ext/session';
const LANDING = rel(process.env.GYM_LANDING ?? './landing');

export function buildApp(dbPath = process.env.GYM_DB ?? './data/gym.db') {
  const db = openDb(dbPath);
  const app = new Hono();
  // extensions first: buildApi ends with a catch-all 404 that would otherwise shadow /api/magic/* and /api/push/*
  for (const [path, sub] of buildExtensions(db)) app.route(`/api${path}`, sub);
  app.route('/api', buildApi(db));
  app.route('/mcp', buildMcp(db));

  // ── Web app at /app (SPA). Service worker + index must never be cached stale.
  const noCache = async (c: any, next: any) => { await next(); c.header('Cache-Control', 'no-cache'); };
  // Cloudflare rewrites browser TTL for plain `no-cache` on static .js, but honours no-store: keep update checks fresh
  const noStore = async (c: any, next: any) => { await next(); c.header('Cache-Control', 'no-store, max-age=0, must-revalidate'); };
  app.use('/app/*', appSecurityHeaders);
  app.use('/app/sw.js', noStore);
  app.use('/app/registerSW.js', noStore);
  app.use('/app/workbox-*.js', noStore);
  app.use('/app/push-sw.js', noStore);
  app.use('/app/manifest.webmanifest', noCache);
  app.use('/app/index.html', noCache);
  app.use('/app/assets/*', async (c, next) => { await next(); c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
  app.use('/app/*', serveStatic({ root: DIST, rewriteRequestPath: (p) => p.replace(/^\/app/, '') }));
  app.get('/app', (c) => c.redirect('/app/', 301));
  app.get('/app/*', async (c, next) => { c.header('Cache-Control', 'no-cache'); return serveStatic({ path: `${DIST}/index.html` })(c, next); });

  // ── Landing site at / (static, SEO). Anyone who has used the app (rep_seen cookie) goes straight to the app, never the marketing page.
  const toApp = (c: any, next: any) => { if (hasSeen(c)) { c.header('Cache-Control', 'private, no-store'); return c.redirect('/app/', 302); } c.header('Vary', 'Cookie'); return next(); };
  app.use('/', toApp);
  app.use('/index.html', toApp);
  // static landing assets: fonts/images are immutable-ish (30d); css/js/html revalidate daily so a deploy shows up fast
  app.use('/*', async (c, next) => {
    await next();
    if (c.res.status !== 200 || c.res.headers.has('Cache-Control')) return;
    const p = new URL(c.req.url).pathname;
    if (/^\/(fonts|img|icons)\//.test(p) || /\.(png|jpe?g|webp|avif|svg|ico|woff2?)$/.test(p)) c.header('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=86400');
    else if (/\.(css|js)$/.test(p)) c.header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=86400');
  });
  app.use('/*', serveStatic({ root: LANDING }));
  app.get('*', async (c) => {
    const html = await Bun.file(`${LANDING}/404.html`).text().catch(() => null);
    return html ? c.html(html, 404) : c.notFound();
  });
  return { app, db };
}

if (import.meta.main) {
  const { app, db } = buildApp();
  // sync pushes are capped (400 changes + 1500 events per round); 8 MB is far above any legitimate body
  const server = Bun.serve({ port: PORT, fetch: app.fetch, maxRequestBodySize: 8 * 1024 * 1024, idleTimeout: 30 });
  console.log(`gym-tracker listening on :${PORT}`);
  // graceful stop (k8s SIGTERM): finish in-flight requests, fold the WAL into the main file, close the DB
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await server.stop();
    try { db.exec('PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch { /* already closed */ }
    process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
