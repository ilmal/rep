// Server-side access to a user's entities (same shapes the client syncs). Used by sync + MCP.
import type { Db } from './db';
import type {
  Area, CoachPlan, Exercise, ExercisePref, EntityType, Gym, ProgressEntry, Session, Settings, AppEvent,
} from '../shared/types';
import { withDefaults } from '../shared/defaults';
import { sanitizeContent } from '../shared/content';

export interface UserData {
  /** true once the athlete's app has synced a settings entity (setup completed on a device) */
  hasSettings: boolean;
  settings: Settings;
  gyms: Gym[];
  areas: Area[];
  exercises: Exercise[]; // custom + overrides
  prefs: Record<string, ExercisePref>;
  progress: Record<string, ProgressEntry>;
  sessions: Session[];
  plans: CoachPlan[];
}

export function loadData(db: Db, uid: string): UserData {
  const rows = db.query<{ type: string; id: string; json: string }, [string]>('SELECT type,id,json FROM entities WHERE user_id=? AND deleted=0').all(uid);
  const d: UserData = { hasSettings: false, settings: withDefaults(null), gyms: [], areas: [], exercises: [], prefs: {}, progress: {}, sessions: [], plans: [] };
  for (const r of rows) {
    const v = JSON.parse(r.json);
    if (!v) continue;
    switch (r.type) {
      case 'settings': d.settings = withDefaults(v); d.hasSettings = true; break;
      case 'gym': if (!v.deleted) d.gyms.push(v); break;
      case 'area': d.areas.push(v); break;
      case 'exercise': d.exercises.push(v); break;
      case 'pref': { const content = sanitizeContent(v.content); const { content: _c, ...rest } = v; d.prefs[v.exerciseId ?? r.id] = content ? { ...rest, content } : rest; break; }
      case 'progress': d.progress[v.exerciseId ?? r.id] = v; break;
      case 'session': d.sessions.push(v); break;
      case 'plan': d.plans.push(v); break;
    }
  }
  return d;
}

/** Write one entity with a fresh server timestamp; bumps the user's sync sequence so clients pull it. */
export function writeEntity(db: Db, uid: string, type: EntityType, id: string, data: unknown, deleted = false): number {
  const now = Date.now();
  const stamped = data && typeof data === 'object' ? { ...(data as object), updatedAt: now } : data;
  const { seq } = db.query<{ seq: number }, [string]>('UPDATE users SET seq=seq+1 WHERE id=? RETURNING seq').get(uid)!;
  db.query('INSERT INTO entities(user_id,type,id,json,updated_at,deleted,seq) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,type,id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, deleted=excluded.deleted, seq=excluded.seq')
    .run(uid, type, id, JSON.stringify(stamped), now, deleted ? 1 : 0, seq);
  return now;
}

export function recordEvent(db: Db, uid: string, kind: string, payload?: unknown, sessionId?: string) {
  const ev: AppEvent = { id: crypto.randomUUID(), at: Date.now(), kind, sessionId, payload };
  db.query('INSERT OR IGNORE INTO events(user_id,id,at,kind,session_id,payload) VALUES(?,?,?,?,?,?)')
    .run(uid, ev.id, ev.at, ev.kind, ev.sessionId ?? null, ev.payload == null ? null : JSON.stringify(ev.payload));
}

/** Tolerate rows written before oversized payloads were replaced by a marker (sliced, unparseable JSON). */
function parsePayload(s: string | null): unknown { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

export function listEvents(db: Db, uid: string, opts: { since?: number; kind?: string; limit?: number }) {
  const rows = db.query<{ id: string; at: number; kind: string; session_id: string | null; payload: string | null }, [string, number, number]>(
    'SELECT id,at,kind,session_id,payload FROM events WHERE user_id=? AND at>=? ORDER BY at DESC LIMIT ?',
  ).all(uid, opts.since ?? 0, Math.min(opts.limit ?? 200, 1000));
  return rows.filter((r) => !opts.kind || r.kind === opts.kind).map((r) => ({ id: r.id, at: r.at, kind: r.kind, sessionId: r.session_id, payload: parsePayload(r.payload) }));
}
