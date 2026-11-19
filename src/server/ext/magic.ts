// Email magic-link sign-in. Mounted at /api/magic.
//   POST /request {email}  → always {ok:true} for a valid address (never reveals whether it has an account)
//   POST /verify  {token}  → single-use; finds/creates the user for the email, returns a session token
import { Hono, type Context } from 'hono';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db';
import { createMailer, type Mail } from './mailer';
import { setSession } from './session';

export const TOKEN_TTL_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Fixed-window limiter; `take` returns 0 when allowed, else the seconds until the window resets. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string): number => {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return 0; }
    if (h.n >= max) return Math.max(1, Math.ceil((h.reset - now) / 1000));
    h.n++;
    return 0;
  };
}

export interface MagicOpts { now?: () => number; fetch?: typeof fetch }

export default function build(db: Db, opts: MagicOpts = {}): Hono {
  const clock = opts.now ?? Date.now;
  const app = new Hono();
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_links (
      hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS magic_links_email ON magic_links(email, created_at);
    CREATE INDEX IF NOT EXISTS magic_links_expires ON magic_links(expires_at);
    -- durable outbox: the HTTP request only enqueues; a worker sends with retries (nothing slow stays in the request path)
    CREATE TABLE IF NOT EXISTS mail_queue (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mail_queue_due ON mail_queue(next_at);
  `);
  const q = {
    insert: db.query('INSERT INTO magic_links(hash,email,created_at,expires_at) VALUES(?,?,?,?)'),
    // Atomic single-use claim: only one caller can flip used_at from NULL.
    claim: db.query<{ email: string }, [number, string, number]>('UPDATE magic_links SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>? RETURNING email'),
    prune: db.query('DELETE FROM magic_links WHERE expires_at<?'),
    userByEmail: db.query<{ id: string }, [string]>('SELECT id FROM users WHERE email=?'),
    insertUser: db.query('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)'),
    insertToken: db.query('INSERT INTO tokens(hash,user_id,created_at,last_used) VALUES(?,?,?,?)'),
    enqueue: db.query('INSERT INTO mail_queue(id,payload,attempts,next_at,created_at) VALUES(?,?,0,?,?)'),
    due: db.query<{ id: string }, [number]>('SELECT id FROM mail_queue WHERE next_at<=? ORDER BY next_at LIMIT 10'),
    // claim = push next_at out; atomic, so concurrent flushes never send the same message twice
    claimMail: db.query<{ payload: string; attempts: number }, [number, string, number]>('UPDATE mail_queue SET next_at=? WHERE id=? AND next_at<=? RETURNING payload,attempts'),
    mailOk: db.query('DELETE FROM mail_queue WHERE id=?'),
    mailRetry: db.query('UPDATE mail_queue SET attempts=?, next_at=? WHERE id=?'),
  };
  const rlIp = limiter(20, 60 * 60 * 1000);
  const rlEmail = limiter(5, 60 * 60 * 1000);
  const rlVerify = limiter(30, 15 * 60 * 1000);
  const ip = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'local';
  const limited = (c: Context, retryAfter: number) => { c.header('Retry-After', String(retryAfter)); return c.json({ error: 'rate_limited', retryAfter }, 429); };

  const mailer = () => createMailer(process.env, opts.fetch ?? fetch, clock);
  const mailJob = (email: string, link: string): Mail => ({
      to: email, subject: 'Your sign-in link',
      text: `Open this link on your phone to sign in. It works once and expires in 15 minutes.\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
      html: `<p>Open this link on your phone to sign in. It works once and expires in 15 minutes.</p><p><a href="${link}">Sign in</a></p><p style="color:#777">If you didn't ask for this, ignore this email.</p>`,
  });

  const MAX_ATTEMPTS = 6;
  /** Send every due queued mail. Failures back off 15s, 30s, 1m... (max 10m) and are dropped after MAX_ATTEMPTS. */
  async function flushMail(): Promise<void> {
    const t = clock();
    for (const { id } of q.due.all(t)) {
      const row = q.claimMail.get(t + 60_000, id, t);
      if (!row) continue;
      const ok = await mailer().send(JSON.parse(row.payload) as Mail).catch(() => false);
      if (ok) { q.mailOk.run(id); continue; }
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) { console.error(`[mail] giving up on ${id} after ${attempts} attempts`); q.mailOk.run(id); }
      else q.mailRetry.run(attempts, clock() + Math.min(15_000 * 2 ** (attempts - 1), 600_000), id);
    }
  }
  const timer = setInterval(() => { void flushMail(); }, 5000);
  (timer as { unref?: () => void }).unref?.();
  void flushMail(); // pick up anything left over from before a restart
  (app as unknown as { flushMail: () => Promise<void> }).flushMail = flushMail;

  app.post('/request', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 200) return c.json({ error: 'invalid_email' }, 400);
    const wait = rlIp(`ip:${ip(c)}`) || rlEmail(`em:${email}`);
    if (wait) return limited(c, wait);

    const configured = mailer().provider !== null;
    const prod = process.env.NODE_ENV === 'production';
    if (!configured && prod) return c.json({ error: 'email_not_configured' }, 503);

    const now = clock();
    const token = randomBytes(32).toString('base64url');
    q.prune.run(now - 24 * 3600 * 1000);
    q.insert.run(sha(token), email, now, now + TOKEN_TTL_MS);
    const base = (process.env.PUBLIC_URL ?? new URL(c.req.url).origin).replace(/\/+$/, '');
    const link = `${base}/app/signin?token=${token}`;
    if (!configured) {
      console.log(`[magic] sign-in link for ${email}: ${link}`);
      return c.json({ ok: true, devLink: link });
    }
    q.enqueue.run(randomUUID(), JSON.stringify(mailJob(email, link)), now, now);
    void flushMail(); // starts the send now; the response does not wait for it
    return c.json({ ok: true });
  });

  app.post('/verify', async (c) => {
    const wait = rlVerify(`ip:${ip(c)}`);
    if (wait) return limited(c, wait);
    const b = await c.req.json().catch(() => ({}));
    const token = typeof b?.token === 'string' ? b.token : '';
    if (token.length < 20 || token.length > 200) return c.json({ error: 'invalid_or_expired' }, 400);
    const now = clock();
    const row = q.claim.get(now, sha(token), now); // lookup by hash: no secret-dependent comparison
    if (!row) return c.json({ error: 'invalid_or_expired' }, 400);

    let user = q.userByEmail.get(row.email);
    let isNew = false;
    if (!user) {
      user = { id: randomUUID() };
      q.insertUser.run(user.id, row.email, '', now);
      isNew = true;
    }
    const session = randomBytes(32).toString('base64url');
    q.insertToken.run(sha(session), user.id, now, now);
    setSession(c, session);
    return c.json({ token: session, userId: user.id, email: row.email, isNew });
  });

  return app;
}
