// Headless test harness for the store (NOT a test file). Stubs browser globals, a controllable clock,
// a scripted geolocation and an in-memory fake /api server that mimics src/server/api.ts (LWW sync).
// Usage at the top of every state.*.test.ts:  `import { useHarness, ... } from './state-kit';  useHarness();`
import { afterAll, afterEach, beforeAll, beforeEach, setSystemTime } from 'bun:test';
import { getState, initialState, setState, type State } from './core';
import * as A from './actions';
import type { EntityChange, Session } from '../../shared/types';

// ───────────── clock ─────────────
/** Wed 18 Nov 2026 12:00 local (mid-week: week boundaries are local Monday 00:00). */
export const T0 = new Date(2026, 10, 18, 12, 0, 0).getTime();
export const SEC = 1000, MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
let clockNow = T0;
export const setClock = (t: number) => { clockNow = t; setSystemTime(new Date(t)); };
export const tick = (ms = 1000) => setClock(clockNow + ms);
export const clock = () => clockNow;

// ───────────── deterministic ids & PRNG ─────────────
let idCounter = 0;
export const resetIds = () => { idCounter = 0; };
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────── browser stubs ─────────────
export interface GeoScript { mode: 'ok' | 'err' | 'pending'; lat: number; lng: number; accuracy: number; code: number }
export const geo: GeoScript = { mode: 'ok', lat: 0, lng: 0, accuracy: 10, code: 1 };
let geoPending: (() => void)[] = [];
/** Resolve a geolocation request left pending with mode 'pending'. */
export const flushGeo = () => { const p = geoPending; geoPending = []; p.forEach((f) => f()); };
export const nav: { onLine: boolean; geolocation: unknown } = { onLine: true, geolocation: undefined };
const geolocationImpl = {
  getCurrentPosition(ok: (p: unknown) => void, err: (e: { code: number }) => void) {
    const fire = () => (geo.mode === 'err' ? err({ code: geo.code }) : ok({ coords: { latitude: geo.lat, longitude: geo.lng, accuracy: geo.accuracy } }));
    if (geo.mode === 'pending') geoPending.push(fire); else fire();
  },
};
export const setGeolocationAvailable = (on: boolean) => { nav.geolocation = on ? geolocationImpl : undefined; };

const ls = new Map<string, string>();
const lsStub = {
  getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
  setItem: (k: string, v: string) => { ls.set(k, String(v)); },
  removeItem: (k: string) => { ls.delete(k); },
  clear: () => ls.clear(),
  key: (i: number) => [...ls.keys()][i] ?? null,
  get length() { return ls.size; },
};
export const localStorageData = ls;

const G = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, PropertyDescriptor | undefined> = {};
function define(name: string, value: unknown) {
  if (!(name in saved)) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function installGlobals() {
  define('localStorage', lsStub);
  define('sessionStorage', lsStub);
  define('navigator', nav);
  define('window', { addEventListener() {}, removeEventListener() {} });
  define('crypto', { randomUUID: () => `id-${String(++idCounter).padStart(6, '0')}`, getRandomValues: (a: Uint8Array) => a });
  define('fetch', (url: string, init?: RequestInit) => server.handle(String(url), init));
  setGeolocationAvailable(true);
}
function restoreGlobals() {
  for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete G[k]; }
  for (const k of Object.keys(saved)) delete saved[k];
  setSystemTime();
}

// ───────────── fake server (mirrors src/server/api.ts semantics) ─────────────
export interface Ent { type: string; id: string; updatedAt: number; deleted: boolean; data: unknown; seq: number }
export class FakeServer {
  users = new Map<string, { seq: number; ents: Map<string, Ent>; email?: string; events: unknown[] }>();
  tokens = new Map<string, string>();
  accounts = new Map<string, { password: string; userId: string }>(); // email -> creds
  calls: { path: string; body: any; token?: string }[] = [];
  /** 'down' = fetch rejects (network error); 'hold' = syncs wait for release(); 'ok' */
  mode: 'ok' | 'down' | 'hold' = 'ok';
  status: number | null = null; // force an HTTP status on /sync
  private held: (() => void)[] = [];
  private n = 0;
  pageSize = 400;
  release() { const h = this.held; this.held = []; h.forEach((f) => f()); }
  reset() { this.users.clear(); this.tokens.clear(); this.accounts.clear(); this.calls = []; this.mode = 'ok'; this.status = null; this.held = []; this.n = 0; }
  newUser(): { userId: string; token: string } {
    const userId = `u${++this.n}`; const token = `t${this.n}-${this.tokens.size}`;
    this.users.set(userId, { seq: 0, ents: new Map(), events: [] });
    this.tokens.set(token, userId);
    return { userId, token };
  }
  /** Out-of-band edit from another device/coach: returns the entity as stored. */
  putRemote(userId: string, ch: Omit<EntityChange, 'deleted'> & { deleted?: boolean }) {
    const u = this.users.get(userId)!;
    u.seq++;
    u.ents.set(`${ch.type}:${ch.id}`, { type: ch.type, id: ch.id, updatedAt: ch.updatedAt, deleted: !!ch.deleted, data: ch.data, seq: u.seq });
  }
  entity(userId: string, type: string, id: string) { return this.users.get(userId)?.ents.get(`${type}:${id}`); }
  async handle(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.mode === 'down') throw new TypeError('network down');
    const path = url.replace(/^\/api/, '');
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const h = (init.headers ?? {}) as Record<string, string>;
    const token = h.authorization?.replace('Bearer ', '');
    this.calls.push({ path, body, token });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/auth/anon') { const u = this.newUser(); return json(u); }
    if (path === '/auth/login') {
      const a = this.accounts.get(String(body.email).trim().toLowerCase());
      if (!a || a.password !== body.password) return json({ error: 'invalid_credentials' }, 401);
      const token2 = `t-login-${++this.n}`; this.tokens.set(token2, a.userId);
      return json({ token: token2, userId: a.userId });
    }
    if (path === '/auth/logout') { if (token) this.tokens.delete(token); return json({ ok: true }); }
    const uid = token ? this.tokens.get(token) : undefined;
    if (!uid) return json({ error: 'unauthorized' }, 401);
    if (path === '/auth/register') { this.accounts.set(String(body.email).trim().toLowerCase(), { password: body.password, userId: uid }); return json({ ok: true }); }
    if (path === '/account' || path === '/account/data') { const u = this.users.get(uid)!; u.ents.clear(); u.seq = 0; return json({ ok: true }); }
    if (path === '/sync') {
      if (this.mode === 'hold') await new Promise<void>((r) => this.held.push(r));
      if (this.status) return json({ error: 'boom' }, this.status);
      const u = this.users.get(uid)!;
      const accepted: string[] = []; const rejected: unknown[] = []; const pushed = new Set<string>();
      for (const ch of (body.changes ?? []) as EntityChange[]) {
        const key = `${ch.type}:${ch.id}`; const cur = u.ents.get(key);
        if (cur && cur.updatedAt > ch.updatedAt) { rejected.push({ type: ch.type, id: ch.id, reason: 'stale' }); continue; }
        u.seq++; u.ents.set(key, { type: ch.type, id: ch.id, updatedAt: ch.updatedAt, deleted: !!ch.deleted, data: ch.data, seq: u.seq });
        pushed.add(`${key}:${u.seq}`); accepted.push(key);
      }
      u.events.push(...(body.events ?? []));
      const rows = [...u.ents.values()].filter((e) => e.seq > (body.cursor ?? 0)).sort((a, b) => a.seq - b.seq);
      const more = rows.length > this.pageSize;
      const page = more ? rows.slice(0, this.pageSize) : rows;
      const out = page.filter((r) => !pushed.has(`${r.type}:${r.id}:${r.seq}`)).map((r) => ({ type: r.type, id: r.id, updatedAt: r.updatedAt, deleted: r.deleted, data: r.data }));
      const cursor = page.length ? page[page.length - 1].seq : (body.cursor ?? 0);
      return json({ accepted, rejected, changes: out, cursor: more ? cursor : Math.max(cursor, u.seq), more });
    }
    return json({ error: 'not_found' }, 404);
  }
}
export const server = new FakeServer();

// ───────────── lifecycle ─────────────
/** Call once at the top of a test file. */
export function useHarness() {
  beforeAll(installGlobals);
  afterAll(restoreGlobals);
  beforeEach(() => {
    installGlobals();
    resetIds(); ls.clear(); server.reset(); geoPending = [];
    nav.onLine = true; Object.assign(geo, { mode: 'ok', lat: 0, lng: 0, accuracy: 10, code: 1 });
    setClock(T0);
    resetStore();
  });
  afterEach(() => { server.release(); setSystemTime(); });
}

/** Fresh hydrated empty state. */
export function resetStore() {
  setState(() => ({ ...initialState(), hydrated: true, online: true }));
}
export const S = (): State => getState();

// ───────────── fixtures ─────────────
export function onboard(over: Partial<Parameters<typeof A.completeOnboarding>[0]> = {}) {
  A.completeOnboarding({ name: 'Tester', goal: 4, targetMinutes: 60, warmupMinutes: 10, gyms: [{ name: 'Main gym', template: 'full', lat: 59.33, lng: 18.06, radiusM: 150 }], areaNames: [], ...over });
  return { gymId: S().device.currentGymId!, rotation: S().settings.rotation };
}
export const gymId = () => S().device.currentGymId!;
export const active = (): Session | undefined => A.getActiveSession();
export const ex = (s: Session | undefined = active()) => s!.exercises[s!.cursor];

/** Onboard + draft ready to begin. */
export function ready(over: Partial<Parameters<typeof A.completeOnboarding>[0]> = {}) {
  onboard(over);
  A.prepareDraft(true);
  return S().device.draft!;
}
/** Start a session and move into the first set. */
export function startLive(): Session {
  if (!S().device.draft) ready();
  const id = A.beginSession();
  if (!id) throw new Error('beginSession returned null');
  tick(); A.endWarmup(); tick();
  return S().sessions[id];
}
/** Log every planned set of the cursor exercise (resting in between) and stop in 'fb'. */
export function doAllSets(weight = 20, reps = 8) {
  for (let guard = 0; guard < 20; guard++) {
    const a = active()!;
    if (a.phase !== 'set') break;
    tick(30 * SEC); A.logSet(weight, reps);
    if (active()!.phase === 'rest') { tick(60 * SEC); A.endRest(); }
  }
}
export const FB = { effort: 'normal', weight: 'right', volume: 'ok' } as const;
/** Play the whole session to phase 'done' (not finished). */
export function playAll(fb: typeof FB | { effort: 'chill' | 'normal' | 'hard'; weight: 'light' | 'right' | 'heavy'; volume: 'reps' | 'sets' | 'ok' } = FB) {
  for (let guard = 0; guard < 60 && active() && active()!.phase !== 'done'; guard++) {
    const a = active()!;
    if (a.phase === 'warmup') { A.endWarmup(); continue; }
    if (a.phase === 'set') doAllSets();
    else if (a.phase === 'rest') A.endRest();
    if (active()!.phase === 'fb') { tick(); A.saveFeedback(fb); }
  }
}
/** Pending change in the outbox for an entity (undefined if none). */
export const queued = (type: string, id: string) => S().outbox[`${type}:${id}`];
export const clearOutbox = () => setState((s) => { s.outbox = {}; });

// ───────────── global invariants ─────────────
import { effectiveSlot, pointerSlot } from './actions';
import { weekCount, weekStart } from '../../shared/rules';
import { blockedIds } from '../../shared/planner';

const COLLS = { gym: 'gyms', area: 'areas', exercise: 'exercises', progress: 'progress', session: 'sessions', pref: 'prefs', plan: 'plans' } as const;
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);

/**
 * Every global invariant of the store. Returns human-readable violations (empty = healthy).
 * `noSync`: the outbox must contain EVERY entity (nothing was ever drained), which proves no write bypassed putEntity.
 */
export function invariants(s: State = getState(), opts: { noSync?: boolean } = {}): string[] {
  const bad: string[] = [];
  const v = (c: boolean, m: string) => { if (!c) bad.push(m); };
  const sessions = Object.values(s.sessions);
  const act = sessions.filter((x) => x.status === 'active');
  v(act.length <= 1, `more than one active session (${act.length})`);
  const seqs = sessions.map((x) => x.seq);
  v(new Set(seqs).size === seqs.length, 'duplicate session seq');
  for (const x of sessions) {
    const tag = `session ${x.id.slice(-6)} [${x.status}/${x.phase}]`;
    v(['active', 'completed', 'discarded'].includes(x.status), `${tag}: unexpected status`);
    v(x.exercises.length === 0 || (x.cursor >= 0 && x.cursor < x.exercises.length) || x.status !== 'active', `${tag}: cursor ${x.cursor} out of range ${x.exercises.length}`);
    v(x.exercises.map((e) => e.order).join() === x.exercises.map((_, i) => i).join(), `${tag}: exercise order not 0..n-1`);
    v(new Set(x.exercises.map((e) => e.id)).size === x.exercises.length, `${tag}: duplicate session-exercise ids`);
    if (x.status === 'completed') {
      v(x.endedAt != null && x.endedAt >= x.startedAt, `${tag}: completed without sane endedAt`);
      v(x.phase === 'done', `${tag}: completed but phase ${x.phase}`);
      v(!x.exercises.some((e) => e.status === 'todo' || e.status === 'active'), `${tag}: completed with todo/active exercise`);
    }
    if (x.status === 'discarded') v(x.endedAt != null, `${tag}: discarded without endedAt`);
    for (const e of x.exercises) {
      const et = `${tag} ${e.name}[${e.status}]`;
      v(['todo', 'active', 'done', 'skipped', 'dropped'].includes(e.status), `${et}: bad status`);
      v((e.status !== 'todo' && e.status !== 'dropped') || e.sets.length === 0, `${et}: todo/dropped with sets`);
      v(e.status !== 'done' || e.sets.length > 0, `${et}: done without sets`);
      v(e.plannedSets >= 1 && e.plannedSets <= 12, `${et}: plannedSets ${e.plannedSets}`);
      v(finite(e.plannedWeight) && e.plannedWeight >= 0 && finite(e.repTarget) && finite(e.restSec) && finite(e.estSec) && e.estSec >= 0, `${et}: NaN/negative prescription`);
      v(e.restSec >= 0, `${et}: negative rest`);
      for (const st of e.sets) v(finite(st.weight) && st.weight >= 0 && finite(st.reps) && st.reps >= 0 && finite(st.doneAt), `${et}: bad set ${JSON.stringify(st)}`);
      if (e.recommendation) v(finite(e.recommendation.weight) && e.recommendation.weight >= 0 && finite(e.recommendation.reps) && e.recommendation.sets >= 1, `${et}: bad recommendation`);
    }
    if (x.status === 'active') {
      const cur = x.exercises[x.cursor];
      const actives = x.exercises.filter((e) => e.status === 'active');
      v(['warmup', 'set', 'rest', 'fb', 'done'].includes(x.phase), `${tag}: bad phase`);
      if (x.phase === 'warmup') v(x.cursor === 0 && actives.length === 0 && x.exercises.every((e) => e.status === 'todo' || e.status === 'dropped'), `${tag}: warmup but exercises already moved`);
      if (x.phase === 'set' || x.phase === 'rest' || x.phase === 'fb') {
        v(!!cur && cur.status === 'active', `${tag}: cursor exercise not active (${cur?.status})`);
        v(actives.length === 1, `${tag}: ${actives.length} active exercises`);
        v(x.warmupEndedAt != null, `${tag}: past warm-up without warmupEndedAt`);
      }
      if (cur && x.phase === 'set') v(cur.sets.length < cur.plannedSets, `${tag}: phase set but all sets logged`);
      if (cur && x.phase === 'rest') v(cur.sets.length >= 1 && cur.sets.length < cur.plannedSets && x.restEndsAt != null, `${tag}: bad rest state (${cur.sets.length}/${cur.plannedSets}, endsAt ${x.restEndsAt})`);
      if (cur && x.phase === 'fb') v(cur.sets.length >= cur.plannedSets && x.restEndsAt == null, `${tag}: bad fb state`);
      if (x.phase === 'done') v(actives.length === 0 && !x.exercises.some((e) => e.status === 'todo'), `${tag}: done but exercises owed`);
      if (x.phase !== 'rest') v(x.restEndsAt == null, `${tag}: restEndsAt outside rest`);
    }
  }
  // rotation / slots
  const N = s.settings.rotation.length;
  v(s.settings.rotation.every((id) => !!s.areas[id]), 'rotation references a missing area');
  const ptr = pointerSlot(s);
  v(ptr >= 1 && ptr <= Math.max(1, N), `rotation pointer ${ptr} outside 1..${N}`);
  const eff = effectiveSlot(s);
  v(eff >= 1 && eff <= Math.max(1, N), `effective slot ${eff} outside 1..${N}`);
  // week count never counts discarded / active, matches an independent recount
  const t = Date.now(); const ws = weekStart(t);
  const recount = sessions.filter((x) => x.status === 'completed' && (x.endedAt ?? x.startedAt) >= ws && (x.endedAt ?? x.startedAt) < ws + 7 * DAY + HOUR).length;
  const wc = weekCount(sessions, t);
  v(wc <= recount && wc >= recount - 1, `weekCount ${wc} vs recount ${recount}`);
  v(wc <= sessions.filter((x) => x.status === 'completed').length, 'weekCount > completed sessions');
  // numbers in progress / settings
  for (const p of Object.values(s.progress)) v(finite(p.weight) && p.weight >= 0 && finite(p.reps) && p.reps >= 1 && p.sets >= 1, `progress ${p.exerciseId}: ${JSON.stringify(p)}`);
  for (const p of Object.values(s.prefs)) v((p.pausedSessions ?? 0) >= 0 && Number.isInteger(p.pausedSessions ?? 0), `pref ${p.exerciseId}: pausedSessions ${p.pausedSessions}`);
  v(['kg', 'lb'].includes(s.settings.unit), 'unit');
  // draft
  const d = s.device.draft;
  if (d) {
    v(d.exercises.map((e) => e.order).join() === d.exercises.map((_, i) => i).join(), 'draft order not 0..n-1');
    v(d.slot >= 1 && d.slot <= Math.max(1, N), `draft slot ${d.slot}`);
    v(d.gymId === (s.device.currentGymId ?? null), 'draft gym != current gym');
    v(d.exercises.every((e) => finite(e.plannedWeight)), 'draft NaN weight');
  }
  // coach plans
  for (const p of Object.values(s.plans)) {
    v(['pending', 'used', 'cancelled'].includes(p.status), 'plan status');
    v(p.status === 'used' ? !!p.usedBySessionId : !p.usedBySessionId, `plan ${p.id}: usedBySessionId inconsistent with ${p.status}`);
  }
  // outbox: every entity the app holds has a pending change with the SAME updatedAt (proves writes went through putEntity)
  if (opts.noSync) {
    for (const [type, key] of Object.entries(COLLS)) {
      for (const [id, e] of Object.entries(s[key] as Record<string, { updatedAt?: number }>)) {
        const o = s.outbox[`${type}:${id}`];
        v(!!o && !o.deleted && o.updatedAt === e.updatedAt && o.data === e, `outbox missing/stale for ${type}:${id}`);
      }
    }
    if (s.settings.updatedAt > 0) v(s.outbox['settings:settings']?.updatedAt === s.settings.updatedAt, 'outbox missing settings');
    for (const o of Object.values(s.outbox)) if (o.deleted) v(!(s[COLLS[o.type as keyof typeof COLLS]] as Record<string, unknown>)?.[o.id], `outbox says deleted but ${o.type}:${o.id} still present`);
  }
  v(blockedIds(s.prefs, Date.now()).every((id) => typeof id === 'string'), 'blockedIds');
  return bad.filter(Boolean);
}
