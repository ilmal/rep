import { Hono, type Context } from 'hono';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from './db';
import type { AppEvent, EntityChange, EntityType } from '../shared/types';
import { sanitizeContent } from '../shared/content';

const TYPES: EntityType[] = ['settings', 'gym', 'area', 'exercise', 'progress', 'session', 'pref', 'plan'];
const MAX_CHANGES = 500;
const MAX_JSON = 512 * 1024;
const PAGE = 500;

const MAX_PAYLOAD = 20000;
/** A pref's how-to `content` is re-sanitised on push (caps, https-only media URLs): the stored copy is what the MCP and every other device read. */
const cleanPref = (d: unknown): unknown => {
  if (!d || typeof d !== 'object' || !('content' in d)) return d ?? null;
  const { content, ...rest } = d as Record<string, unknown>;
  const clean = sanitizeContent(content);
  return clean ? { ...rest, content: clean } : rest;
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Event payloads are stored as JSON text; an oversized one is replaced by a valid marker (a sliced string would not parse and 500s /export). */
const storePayload = (p: unknown): string | null => {
  if (p == null) return null;
  const j = JSON.stringify(p);
  return j.length > MAX_PAYLOAD ? JSON.stringify({ truncated: true }) : j;
};
const parseOrNull = (s: string | null): unknown => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };

// Tiny in-memory fixed-window rate limiter (per key). Fine for a single process.
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n++;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return h.n <= max;
  };
}

interface AuthEnv { Variables: { uid: string; tokenHash: string } }

import { setSession, clearSession, sessionCookie } from './ext/session';

export function buildApi(db: Db) {
  const api = new Hono<AuthEnv>();

  const q = {
    userById: db.query<{ id: string; email: string | null; name: string; seq: number }, [string]>('SELECT id,email,name,seq FROM users WHERE id=?'),
    userByEmail: db.query<{ id: string; pass_hash: string | null }, [string]>('SELECT id,pass_hash FROM users WHERE email=?'),
    insertUser: db.query('INSERT INTO users(id,name,created_at) VALUES(?,?,?)'),
    setCreds: db.query('UPDATE users SET email=?, pass_hash=? WHERE id=?'),
    setName: db.query('UPDATE users SET name=? WHERE id=?'),
    insertToken: db.query('INSERT INTO tokens(hash,user_id,created_at,last_used) VALUES(?,?,?,?)'),
    tokenUser: db.query<{ user_id: string }, [string]>('SELECT user_id FROM tokens WHERE hash=?'),
    touchToken: db.query('UPDATE tokens SET last_used=? WHERE hash=?'),
    delToken: db.query('DELETE FROM tokens WHERE hash=?'),
    delUser: db.query('DELETE FROM users WHERE id=?'),
    bumpSeq: db.query<{ seq: number }, [string]>('UPDATE users SET seq=seq+1 WHERE id=? RETURNING seq'),
    getEnt: db.query<{ updated_at: number }, [string, string, string]>('SELECT updated_at FROM entities WHERE user_id=? AND type=? AND id=?'),
    putEnt: db.query('INSERT INTO entities(user_id,type,id,json,updated_at,deleted,seq) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,type,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, deleted=excluded.deleted, seq=excluded.seq'),
    entsSince: db.query<{ type: string; id: string; json: string; updated_at: number; deleted: number; seq: number }, [string, number, number]>('SELECT type,id,json,updated_at,deleted,seq FROM entities WHERE user_id=? AND seq>? ORDER BY seq LIMIT ?'),
    putEvent: db.query('INSERT OR IGNORE INTO events(user_id,id,at,kind,session_id,payload) VALUES(?,?,?,?,?,?)'),
    allEvents: db.query<{ id: string; at: number; kind: string; session_id: string | null; payload: string | null }, [string]>('SELECT id,at,kind,session_id,payload FROM events WHERE user_id=? ORDER BY at'),
    allEnts: db.query<{ type: string; id: string; json: string; updated_at: number; deleted: number }, [string]>('SELECT type,id,json,updated_at,deleted FROM entities WHERE user_id=?'),
  };

  // per-IP; many users share one IP (carrier NAT, offices), so keep the default generous. Override with ANON_RATE_LIMIT.
  const rlAnon = limiter(Number(process.env.ANON_RATE_LIMIT ?? 60), 60 * 60 * 1000);
  const rlLogin = limiter(Number(process.env.LOGIN_RATE_LIMIT ?? 10), 15 * 60 * 1000);
  const ip = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';

  function issueToken(uid: string) {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    q.insertToken.run(sha(token), uid, now, now);
    return token;
  }

  const auth = async (c: Context<AuthEnv>, next: () => Promise<void>) => {
    const h = c.req.header('authorization') ?? '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!tok) return c.json({ error: 'unauthorized' }, 401);
    const hash = sha(tok);
    const row = q.tokenUser.get(hash);
    if (!row) return c.json({ error: 'unauthorized' }, 401);
    q.touchToken.run(Date.now(), hash);
    c.set('uid', row.user_id);
    c.set('tokenHash', hash);
    await next();
  };

  api.get('/health', (c) => { try { db.query('SELECT 1').get(); return c.json({ ok: true, time: Date.now() }); } catch { return c.json({ ok: false }, 503); } });

  api.post('/auth/anon', async (c) => {
    if (!rlAnon(ip(c))) return c.json({ error: 'rate_limited' }, 429);
    const body = await c.req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.slice(0, 60) : '';
    const id = randomUUID();
    q.insertUser.run(id, name, Date.now());
    const t = issueToken(id); setSession(c, t);
    return c.json({ token: t, userId: id });
  });

  api.post('/auth/login', async (c) => {
    if (!rlLogin(ip(c))) return c.json({ error: 'rate_limited' }, 429);
    const b = await c.req.json().catch(() => ({}));
    const email = String(b?.email ?? '').trim().toLowerCase();
    const password = String(b?.password ?? '');
    const row = email ? q.userByEmail.get(email) : null;
    // Always verify something to keep timing uniform.
    const ok = row?.pass_hash ? await Bun.password.verify(password, row.pass_hash) : (await Bun.password.verify(password, DUMMY_HASH), false);
    if (!row || !ok) return c.json({ error: 'invalid_credentials' }, 401);
    const t = issueToken(row.id); setSession(c, t);
    return c.json({ token: t, userId: row.id });
  });

  /** Cookie -> token. The app calls this when it has no valid token (storage wiped). Needs the x-rep header so a cross-site form cannot trigger it. */
  api.post('/auth/restore', (c) => {
    const tok = sessionCookie(c);
    const row = c.req.header('x-rep') && tok ? q.tokenUser.get(sha(tok)) : null;
    if (!row) { clearSession(c); return c.json({ error: 'unauthorized' }, 401); }
    q.touchToken.run(Date.now(), sha(tok));
    setSession(c, tok); // sliding: another 400 days
    const u = db.query<{ email: string }, [string]>('SELECT email FROM users WHERE id=?').get(row.user_id);
    return c.json({ token: tok, userId: row.user_id, email: u?.email || null });
  });

  api.use('/me', auth);
  api.use('/sync', auth);
  api.use('/account', auth);
  api.use('/account/*', auth);
  api.use('/export', auth);
  api.use('/tokens', auth);
  api.use('/tokens/*', auth);
  api.use('/auth/register', auth);
  api.use('/auth/logout', auth);

  api.post('/auth/register', async (c) => {
    if (!rlLogin(ip(c))) return c.json({ error: 'rate_limited' }, 429);
    const uid = c.get('uid');
    const b = await c.req.json().catch(() => ({}));
    const email = String(b?.email ?? '').trim().toLowerCase();
    const password = String(b?.password ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return c.json({ error: 'invalid_email' }, 400);
    if (password.length < 8 || password.length > 200) return c.json({ error: 'weak_password' }, 400);
    if (q.userByEmail.get(email)) return c.json({ error: 'email_taken' }, 409);
    q.setCreds.run(email, await Bun.password.hash(password), uid);
    return c.json({ ok: true, email });
  });

  api.post('/auth/logout', (c) => { q.delToken.run(c.get('tokenHash')); clearSession(c); return c.json({ ok: true }); });

  api.get('/me', (c) => {
    const u = q.userById.get(c.get('uid'));
    return u ? c.json({ userId: u.id, email: u.email, name: u.name, seq: u.seq }) : c.json({ error: 'not_found' }, 404);
  });

  api.delete('/account', (c) => { q.delUser.run(c.get('uid')); clearSession(c); return c.json({ ok: true }); });

  /** Wipe synced data but keep the account (Settings → "Delete my data"). */
  api.delete('/account/data', (c) => {
    const uid = c.get('uid');
    db.run('DELETE FROM entities WHERE user_id=?', [uid]);
    db.run('DELETE FROM events WHERE user_id=?', [uid]);
    db.run('UPDATE users SET seq=0 WHERE id=?', [uid]);
    return c.json({ ok: true });
  });

  api.get('/export', (c) => {
    const uid = c.get('uid');
    const u = q.userById.get(uid);
    const entities = q.allEnts.all(uid).map((r) => ({ type: r.type, id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: JSON.parse(r.json) }));
    const events = q.allEvents.all(uid).map((r) => ({ id: r.id, at: r.at, kind: r.kind, sessionId: r.session_id, payload: parseOrNull(r.payload) }));
    c.header('Content-Disposition', 'attachment; filename="rep-export.json"');
    return c.json({ exportedAt: Date.now(), user: { id: uid, email: u?.email ?? null }, entities, events });
  });

  /**
   * Single push+pull endpoint. Last-write-wins per entity by the client's updatedAt
   * (a stale write is ignored and the newer server copy comes back in `changes`).
   */
  api.post('/sync', async (c) => {
    const uid = c.get('uid');
    const raw = await c.req.text();
    if (raw.length > 8 * 1024 * 1024) return c.json({ error: 'too_large' }, 413);
    let body: { cursor?: number; changes?: EntityChange[]; events?: AppEvent[]; name?: string };
    try { body = JSON.parse(raw); } catch { return c.json({ error: 'bad_json' }, 400); }
    const changes = Array.isArray(body.changes) ? body.changes : [];
    const events = Array.isArray(body.events) ? body.events : [];
    if (changes.length > MAX_CHANGES || events.length > 2000) return c.json({ error: 'too_many' }, 413);
    const cursor = Number.isFinite(body.cursor) ? Number(body.cursor) : 0;

    const accepted: string[] = [];
    const rejected: { type: string; id: string; reason: string }[] = [];
    const pushedKeys = new Set<string>();

    const tx = db.transaction(() => {
      for (const ch of changes) {
        if (!ch || !TYPES.includes(ch.type) || typeof ch.id !== 'string' || ch.id.length > 80 || !Number.isFinite(ch.updatedAt)) {
          rejected.push({ type: String(ch?.type), id: String(ch?.id), reason: 'invalid' });
          continue;
        }
        const json = JSON.stringify(ch.type === 'pref' ? cleanPref(ch.data) : ch.data ?? null);
        if (json.length > MAX_JSON) { rejected.push({ type: ch.type, id: ch.id, reason: 'too_large' }); continue; }
        const cur = q.getEnt.get(uid, ch.type, ch.id);
        if (cur && cur.updated_at > ch.updatedAt) { rejected.push({ type: ch.type, id: ch.id, reason: 'stale' }); continue; }
        const { seq } = q.bumpSeq.get(uid)!;
        q.putEnt.run(uid, ch.type, ch.id, json, ch.updatedAt, ch.deleted ? 1 : 0, seq);
        pushedKeys.add(`${ch.type}:${ch.id}:${seq}`);
        accepted.push(`${ch.type}:${ch.id}`);
      }
      for (const ev of events) {
        if (!ev || typeof ev.id !== 'string' || typeof ev.kind !== 'string' || !Number.isFinite(ev.at)) continue;
        q.putEvent.run(uid, ev.id.slice(0, 80), ev.at, ev.kind.slice(0, 60), ev.sessionId ? String(ev.sessionId).slice(0, 80) : null, storePayload(ev.payload));
      }
      if (typeof body.name === 'string') q.setName.run(body.name.slice(0, 60), uid);
    });
    tx();

    const rows = q.entsSince.all(uid, cursor, PAGE + 1);
    const more = rows.length > PAGE;
    const page = more ? rows.slice(0, PAGE) : rows;
    const out = page
      // don't echo the client's own just-accepted writes back
      .filter((r) => !pushedKeys.has(`${r.type}:${r.id}:${r.seq}`))
      .map((r) => ({ type: r.type as EntityType, id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: JSON.parse(r.json) }));
    const newCursor = page.length ? page[page.length - 1].seq : cursor;
    return c.json({ accepted, rejected, changes: out, cursor: more ? newCursor : Math.max(newCursor, q.userById.get(uid)!.seq), more, serverTime: Date.now() });
  });

  // ── API tokens for MCP / coach agents ──
  api.get('/tokens', (c) => {
    const rows = db.query<{ id: string; name: string; scope: string; prefix: string; created_at: number; last_used: number | null }, [string]>(
      'SELECT id,name,scope,prefix,created_at,last_used FROM api_tokens WHERE user_id=? AND revoked=0 ORDER BY created_at DESC').all(c.get('uid'));
    return c.json({ tokens: rows.map((r) => ({ id: r.id, name: r.name, scope: r.scope, prefix: r.prefix, createdAt: r.created_at, lastUsed: r.last_used })) });
  });
  api.post('/tokens', async (c) => {
    const uid = c.get('uid');
    const b = await c.req.json().catch(() => ({}));
    const name = String(b?.name ?? 'Coach').trim().slice(0, 60) || 'Coach';
    const scope = b?.scope === 'read' ? 'read' : 'write';
    const n = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id=? AND revoked=0').get(uid)!.n;
    if (n >= 10) return c.json({ error: 'too_many_tokens' }, 400);
    const token = 'rep_' + randomBytes(32).toString('base64url');
    const id = randomUUID();
    db.query('INSERT INTO api_tokens(id,user_id,name,scope,hash,prefix,created_at) VALUES(?,?,?,?,?,?,?)').run(id, uid, name, scope, sha(token), token.slice(0, 8), Date.now());
    return c.json({ id, name, scope, token }); // the only time the token is shown
  });
  api.delete('/tokens/:id', (c) => {
    db.query('UPDATE api_tokens SET revoked=1 WHERE id=? AND user_id=?').run(c.req.param('id'), c.get('uid'));
    return c.json({ ok: true });
  });

  api.all('*', (c) => c.json({ error: 'not_found' }, 404));
  return api;
}

// Valid argon2 hash of a random string, used only to equalise login timing.
const DUMMY_HASH = Bun.password.hashSync(randomBytes(16).toString('hex'));
