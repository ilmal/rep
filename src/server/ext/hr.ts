// Heart-rate ingest + read API. Mounted at /api/hr.
//   POST   /ingest            Bearer <ingest key>  → {accepted, rejected}   write-only key (cannot read or touch anything else)
//   GET    /?from&to&limit    Bearer <session>     → {samples, latest}      limit <= 5000
//   GET    /latest            Bearer <session>     → {latest}
//   GET    /key               Bearer <session>     → {hasKey, prefix, createdAt, lastUsedAt, lastSampleAt, count}
//   POST   /key               Bearer <session>     → {key}   creates or ROTATES the ingest key; the key is shown once
//   DELETE /key               Bearer <session>     revokes it
// Formats accepted by /ingest: see shared/heartrate.ts (Health Auto Export JSON, or simple {bpm, at?}).
import { Hono, type Context } from 'hono';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db';
import { parseIngest, type HrSample } from '../../shared/heartrate';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY_PREFIX = 'rephr_';
const MAX_BODY = 2 * 1024 * 1024;
const RETAIN_MS = 400 * 24 * 3600_000;

function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string, now: number): boolean => {
    if (hits.size > 2000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    if (h.n >= max) return false;
    h.n++; return true;
  };
}

export default function build(db: Db, opts: { now?: () => number } = {}): Hono {
  const clock = opts.now ?? Date.now;
  const app = new Hono();
  db.exec(`
    CREATE TABLE IF NOT EXISTS heart_rate (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      bpm REAL NOT NULL,
      min REAL, max REAL,
      PRIMARY KEY (user_id, at, source)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS hr_keys (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used INTEGER
    );
  `);
  const q = {
    session: db.query<{ user_id: string }, [string]>('SELECT user_id FROM tokens WHERE hash=?'),
    key: db.query<{ user_id: string }, [string]>('SELECT user_id FROM hr_keys WHERE hash=?'),
    touchKey: db.query('UPDATE hr_keys SET last_used=? WHERE user_id=?'),
    put: db.query('INSERT INTO heart_rate(user_id,at,source,bpm,min,max) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,at,source) DO UPDATE SET bpm=excluded.bpm,min=excluded.min,max=excluded.max'),
    prune: db.query('DELETE FROM heart_rate WHERE user_id=? AND at<?'),
    range: db.query<{ at: number; bpm: number; min: number | null; max: number | null; source: string }, [string, number, number, number]>(
      'SELECT at,bpm,min,max,source FROM heart_rate WHERE user_id=? AND at>=? AND at<=? ORDER BY at DESC LIMIT ?'),
    latest: db.query<{ at: number; bpm: number; min: number | null; max: number | null; source: string }, [string]>(
      'SELECT at,bpm,min,max,source FROM heart_rate WHERE user_id=? ORDER BY at DESC LIMIT 1'),
    count: db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM heart_rate WHERE user_id=?'),
    keyRow: db.query<{ prefix: string; created_at: number; last_used: number | null }, [string]>('SELECT prefix,created_at,last_used FROM hr_keys WHERE user_id=?'),
    setKey: db.query('INSERT INTO hr_keys(user_id,hash,prefix,created_at,last_used) VALUES(?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET hash=excluded.hash,prefix=excluded.prefix,created_at=excluded.created_at,last_used=NULL'),
    delKey: db.query('DELETE FROM hr_keys WHERE user_id=?'),
  };
  const rlIngest = limiter(120, 60_000);
  const rlRead = limiter(240, 60_000);
  const bearer = (c: Context) => { const h = c.req.header('authorization') ?? ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : (c.req.header('x-api-key') ?? '').trim(); };
  const row = (r: { at: number; bpm: number; min: number | null; max: number | null; source: string }): HrSample => ({ at: r.at, bpm: r.bpm, ...(r.min !== null ? { min: r.min } : {}), ...(r.max !== null ? { max: r.max } : {}), ...(r.source ? { source: r.source } : {}) });

  app.post('/ingest', async (c) => {
    const tok = bearer(c);
    const own = tok.startsWith(KEY_PREFIX) ? q.key.get(sha(tok)) : null;
    if (!own) return c.json({ error: 'unauthorized' }, 401);
    const now = clock();
    if (!rlIngest(`i:${own.user_id}`, now)) { c.header('Retry-After', '60'); return c.json({ error: 'rate_limited' }, 429); }
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_BODY) return c.json({ error: 'too_large' }, 413);
    const text = await c.req.text();
    if (text.length > MAX_BODY) return c.json({ error: 'too_large' }, 413);
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* maybe a bare number below */ }
    if (typeof body === 'number') body = { bpm: body }; // a bare "72" body (the simplest Shortcut)
    if (body === null) { const n = Number(text.trim()); if (text.trim() && Number.isFinite(n)) body = { bpm: n }; }
    const q2 = c.req.query('bpm');
    if (body === null && q2) body = { bpm: Number(q2) };
    if (body === null) return c.json({ error: 'invalid_body' }, 400);
    const { samples, rejected } = parseIngest(body, now);
    if (!samples.length && rejected) return c.json({ error: 'no_valid_samples', rejected }, 422);
    db.transaction(() => {
      for (const s of samples) q.put.run(own.user_id, s.at, s.source ?? '', s.bpm, s.min ?? null, s.max ?? null);
      q.touchKey.run(now, own.user_id);
      if (Math.random() < 0.02) q.prune.run(own.user_id, now - RETAIN_MS);
    })();
    return c.json({ accepted: samples.length, rejected });
  });

  const auth = async (c: Context, next: () => Promise<void>) => {
    const tok = bearer(c);
    const u = tok && !tok.startsWith(KEY_PREFIX) ? q.session.get(sha(tok)) : null;
    if (!u) return c.json({ error: 'unauthorized' }, 401);
    if (!rlRead(`r:${u.user_id}`, clock())) return c.json({ error: 'rate_limited' }, 429);
    c.set('uid' as never, u.user_id as never);
    await next();
  };
  app.use('/latest', auth); app.use('/key', auth); app.use('/', auth);
  const uid = (c: Context) => c.get('uid' as never) as string;

  app.get('/', (c) => {
    const now = clock();
    const num = (k: string, d: number) => { const v = Number(c.req.query(k)); return Number.isFinite(v) && c.req.query(k) !== undefined ? v : d; };
    const from = num('from', now - 24 * 3600_000), to = num('to', now + FUTURE);
    const limit = Math.min(5000, Math.max(1, Math.floor(num('limit', 1000))));
    const rows = q.range.all(uid(c), from, to, limit).map(row).reverse();
    const l = q.latest.get(uid(c));
    return c.json({ samples: rows, latest: l ? row(l) : null });
  });
  const FUTURE = 10 * 60_000;
  app.get('/latest', (c) => { const l = q.latest.get(uid(c)); return c.json({ latest: l ? row(l) : null }); });

  app.get('/key', (c) => {
    const k = q.keyRow.get(uid(c));
    const l = q.latest.get(uid(c));
    return c.json({ hasKey: !!k, prefix: k?.prefix ?? null, createdAt: k?.created_at ?? null, lastUsedAt: k?.last_used ?? null, lastSampleAt: l?.at ?? null, count: q.count.get(uid(c))?.n ?? 0 });
  });
  app.post('/key', (c) => {
    const key = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    q.setKey.run(uid(c), sha(key), key.slice(0, 10), clock());
    return c.json({ key, prefix: key.slice(0, 10) });
  });
  app.delete('/key', (c) => { q.delKey.run(uid(c)); return c.json({ ok: true }); });
  return app;
}
