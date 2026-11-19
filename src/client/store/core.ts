// Offline-first store: in-memory state, persisted to IndexedDB, with an outbox for sync.
// Domain entities (synced) vs device-local state (never synced).
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, withDefaults } from '../../shared/defaults';
import { sanitizeContent } from '../../shared/content';
import type {
  AppEvent, CoachPlan, ExercisePref, Area, EntityChange, EntityType, Exercise, Gym, ProgressEntry, Session, SessionExercise, Settings,
} from '../../shared/types';

export interface Draft {
  slot: number;
  areaId: string;
  gymId: string | null;
  variant: number;
  targetMin: number;
  exercises: SessionExercise[];
  hiddenNames: string[];
  createdAt: number;
  source?: 'auto' | 'coach';
  coachPlanId?: string;
  coachNote?: string;
}

export type GeoStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable' | 'nomatch' | 'matched';

export interface DeviceState {
  token?: string;
  userId?: string;
  email?: string | null;
  /** this device has been signed in to an account: if the session is ever lost, ask to sign in again instead of starting a blank account */
  wasSignedIn?: boolean;
  cursor: number;
  lastSyncAt?: number;
  lastSyncError?: string;
  currentGymId: string | null;
  gymSource: 'gps' | 'manual' | 'last' | 'none';
  /** where "Switch to gym" goes back to after picking the built-in no-equipment location */
  homeReturn?: { gymId: string | null; source: 'gps' | 'manual' | 'last' | 'none' };
  geo: GeoStatus;
  geoDistanceM?: number;
  /** reported GPS accuracy (m) of the match that selected the gym */
  geoAccuracyM?: number;
  currentPos?: { lat: number; lng: number };
  /** user explicitly picked a slot other than the rotation pointer */
  chosenSlot: number | null;
  draft: Draft | null;
  /** already offered "resume" in this app load */
  resumeShown: boolean;
}

export interface State {
  hydrated: boolean;
  settings: Settings;
  gyms: Record<string, Gym>;
  areas: Record<string, Area>;
  exercises: Record<string, Exercise>; // custom only
  progress: Record<string, ProgressEntry>;
  sessions: Record<string, Session>;
  prefs: Record<string, ExercisePref>;
  plans: Record<string, CoachPlan>;
  device: DeviceState;
  outbox: Record<string, EntityChange>; // key `${type}:${id}`
  events: AppEvent[];
  online: boolean;
  syncing: boolean;
}

export { DEFAULT_SETTINGS };

const freshDevice = (): DeviceState => ({
  cursor: 0, currentGymId: null, gymSource: 'none', geo: 'idle', chosenSlot: null, draft: null, resumeShown: false,
});

export const initialState = (): State => ({
  hydrated: false,
  settings: { ...DEFAULT_SETTINGS },
  gyms: {}, areas: {}, exercises: {}, progress: {}, sessions: {}, prefs: {}, plans: {},
  device: freshDevice(),
  outbox: {}, events: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
});

let state: State = initialState();
const listeners = new Set<() => void>();
const IDB_KEY = 'rep-state-v1';
const LS_FALLBACK = 'rep-state-v1';

export const getState = () => state;

export function setState(fn: (s: State) => State | void) {
  const next = fn(state);
  state = next ?? state;
  // Always create a new top-level reference so useSyncExternalStore sees the change.
  state = { ...state };
  schedulePersist();
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useStore<T>(sel: (s: State) => T): T {
  // Selectors must return stable references (pick existing objects, don't build new ones).
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state));
}

// ── ids / time ──
export const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
export const now = () => Date.now();

// ── entity writes (state + outbox atomically) ──
const COLL = { settings: 'settings', gym: 'gyms', area: 'areas', exercise: 'exercises', progress: 'progress', session: 'sessions', pref: 'prefs', plan: 'plans' } as const;

export function putEntity<T extends object>(s: State, type: EntityType, id: string, data: T, deleted = false): void {
  // Stamps are strictly increasing per entity: a second edit in the same millisecond (or after a clock step back) must not
  // look identical to the change already in flight / on the server, or sync would drop it as "already sent" and LWW would tie.
  const prevStamp = Math.max(s.outbox[`${type}:${id}`]?.updatedAt ?? 0, type === 'settings' ? s.settings.updatedAt ?? 0 : (s[COLL[type] as 'gyms'] as Record<string, { updatedAt?: number }>)[id]?.updatedAt ?? 0);
  const t = Math.max(now(), prevStamp + 1);
  const stamped = { ...data, updatedAt: t } as T & { updatedAt: number };
  if (type === 'settings') s.settings = stamped as unknown as Settings;
  else {
    const coll = { ...(s[COLL[type] as 'gyms'] as Record<string, unknown>) };
    if (deleted) delete coll[id];
    else coll[id] = stamped;
    (s as unknown as Record<string, unknown>)[COLL[type]] = coll;
  }
  s.outbox = { ...s.outbox, [`${type}:${id}`]: { type, id, updatedAt: t, deleted, data: stamped } };
}

export function logEvent(s: State, kind: string, sessionId?: string, payload?: unknown) {
  const ev: AppEvent = { id: uid(), at: now(), kind, sessionId, payload };
  s.events = [...s.events, ev].slice(-5000);
}

/** Mutate within a single setState with outbox bookkeeping handled by putEntity. */
export function mutate(fn: (s: State) => void) {
  setState((s) => {
    const draft: State = { ...s };
    fn(draft);
    return draft;
  });
}

// ── persistence ──
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (!state.hydrated) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 250);
}

const persistable = (s: State) => ({
  settings: s.settings, gyms: s.gyms, areas: s.areas, exercises: s.exercises, progress: s.progress, sessions: s.sessions, prefs: s.prefs, plans: s.plans,
  device: { ...s.device, geo: 'idle' as GeoStatus, resumeShown: false },
  outbox: s.outbox, events: s.events,
});

export async function persistNow() {
  persistTimer = null;
  const snap = persistable(state);
  try { await idbSet(IDB_KEY, snap); } catch {
    try { localStorage.setItem(LS_FALLBACK, JSON.stringify(snap)); } catch { /* quota: nothing more we can do */ }
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keepValid = (coll: unknown, ok: (v: Record<string, any>) => boolean): Record<string, any> => {
  const out: Record<string, any> = {};
  if (!isObj(coll)) return out;
  for (const [k, v] of Object.entries(coll)) if (isObj(v) && ok(v)) out[k] = v;
  return out;
};
/** Prefs: keep every record, but re-sanitise its how-to `content` (corrupt / over-long / non-https media never reaches the UI). */
export function cleanPrefs(coll: unknown): Record<string, any> {
  const out = keepValid(coll, () => true);
  for (const [k, p] of Object.entries(out)) {
    if (!('content' in p)) continue;
    const { content, ...rest } = p;
    const clean = sanitizeContent(content);
    out[k] = clean ? { ...rest, content: clean } : rest;
  }
  return out;
}
/** Drop individually malformed entities (never the whole store) so one bad record can't lock the user out. */
export function sanitizeSaved(saved: any) {
  return {
    gyms: keepValid(saved.gyms, (g) => isObj(g.equipment)),
    areas: keepValid(saved.areas, (a) => Array.isArray(a.focusMuscles) && Array.isArray(a.poolExerciseIds) && Array.isArray(a.pinnedExerciseIds)),
    exercises: keepValid(saved.exercises, (e) => Array.isArray(e.primary) && Array.isArray(e.equipment)),
    progress: keepValid(saved.progress, () => true),
    sessions: keepValid(saved.sessions, (x) => Array.isArray(x.exercises) && Array.isArray(x.adjustments) && x.exercises.every((e: any) => isObj(e) && Array.isArray(e.sets))),
    prefs: cleanPrefs(saved.prefs),
    plans: keepValid(saved.plans, (p) => Array.isArray(p.exercises)),
    outbox: keepValid(saved.outbox, (o) => typeof o.type === 'string'),
    events: Array.isArray(saved.events) ? saved.events.filter(isObj) : [],
  };
}

export async function hydrate() {
  let saved: ReturnType<typeof persistable> | undefined;
  try { saved = await idbGet(IDB_KEY); } catch { /* fall through */ }
  if (!saved) {
    try { const raw = localStorage.getItem(LS_FALLBACK); if (raw) saved = JSON.parse(raw); } catch { /* ignore */ }
  }
  setState((s) => {
    if (isObj(saved)) {
      try {
        const clean = sanitizeSaved(saved);
        const dropped = JSON.stringify(Object.keys(clean).map((k) => Object.keys((saved as any)[k] ?? {}).length - Object.keys((clean as any)[k] ?? {}).length));
        if (/[1-9]/.test(dropped)) { try { localStorage.setItem(LS_FALLBACK + '-corrupt', JSON.stringify(saved)); } catch { /* quota */ } }
        s = {
          ...s,
          settings: withDefaults(isObj(saved.settings) ? (saved.settings as never) : null),
          ...clean,
          device: { ...freshDevice(), ...(isObj(saved.device) ? saved.device : {}), geo: 'idle', resumeShown: false },
        } as State;
      } catch { /* unreadable blob: start fresh rather than crash */ }
    }
    return { ...s, hydrated: true };
  });
}

/** Wipe everything local (sign-out / delete). Keeps nothing. */
/** Bumped by every resetLocal(): in-flight syncs compare it and drop their results so a wipe can't be undone by a late response. */
export let resetEpoch = 0;
export async function resetLocal(keepDeviceAuth = false) {
  const auth = keepDeviceAuth ? { token: state.device.token, userId: state.device.userId, email: state.device.email } : {};
  try { await idbDel(IDB_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(LS_FALLBACK); } catch { /* ignore */ }
  resetEpoch++;
  const fresh = initialState();
  state = { ...fresh, hydrated: true, device: { ...fresh.device, ...auth } };
  for (const l of listeners) l();
  await persistNow();
}

export const getOnline = () => state.online;
