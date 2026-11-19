// Exercise scoring + session generation. Everything here is configurable (PlannerConfig, per-exercise
// ExercisePref, area pools/pins) so a human or a coach agent (MCP) can steer the algorithm.
import type {
  Area, CoachPlan, Exercise, ExercisePref, Gym, Muscle, PlannerConfig, ProgressEntry, Session, SessionExercise,
} from './types';
import { HOME_REST_SEC, isNoEquipment } from './location';
import {
  availableEquipment, completed, estimateExerciseSec, isAvailable, prescriptionFor, rankAlternatives, round1,
  swapPrescription, toSessionExercise,
} from './rules';

export const DEFAULT_PLANNER: PlannerConfig = {
  wRelevance: 1.0,
  wRecency: 1.2,
  wFrequency: 0.6,
  wCoverage: 0.8,
  wVariety: 0.7,
  wFavorite: 0.5,
  cooldownSessions: 1,
  minDaysBetween: 2,
  freshDays: 14,
  windowDays: 28,
  muscleOverdueDays: 10,
  jitter: 0.2,
};

export const DEFAULT_PREF = (exerciseId: string): ExercisePref => ({ exerciseId, favorite: false, avoid: false, relevance: 50 });
export const PAUSE_FOREVER = 8.64e15;
export type ExerciseStatus = 'ready' | 'favorite' | 'paused' | 'banned';
export function isPaused(p: ExercisePref, now: number): boolean {
  return (p.pausedUntil != null && p.pausedUntil > now) || (p.pausedSessions ?? 0) > 0;
}
/** banned > paused > favorite > ready */
export function statusOf(p: ExercisePref, now: number): ExerciseStatus {
  if (p.avoid) return 'banned';
  if (isPaused(p, now)) return 'paused';
  return p.favorite ? 'favorite' : 'ready';
}
/** Exercises that must never be planned, generated or swapped in right now. */
export function blockedIds(prefs: Record<string, ExercisePref>, now: number): string[] {
  return Object.values(prefs).filter((p) => p.avoid || isPaused(p, now)).map((p) => p.exerciseId);
}
export const prefOf = (prefs: Record<string, ExercisePref>, id: string): ExercisePref => prefs[id] ?? DEFAULT_PREF(id);

const DAY = 86400000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface ScoreContext {
  library: Exercise[];
  prefs: Record<string, ExercisePref>;
  sessions: Session[];
  planner: PlannerConfig;
  now: number;
  area?: Pick<Area, 'focusMuscles'> | null;
}

export interface ScoreBreakdown {
  exerciseId: string;
  name: string;
  /** final 0–100 (can dip lower when cooling down) */
  total: number;
  relevance: number;
  recency: number;
  frequency: number;
  coverage: number;
  favorite: number;
  coolingDown: boolean;
  avoided: boolean;
  paused: boolean;
  daysSince: number | null;
  sessionsSince: number | null;
  timesInWindow: number;
  reasons: string[];
}

interface History {
  lastAt: Map<string, number>;
  sessionsSince: Map<string, number>;
  count: Map<string, number>;
  muscleLast: Map<Muscle, number>;
}

/** One pass over history; reuse the result when scoring many exercises. */
export function buildHistory(ctx: Pick<ScoreContext, 'library' | 'sessions' | 'planner' | 'now'>): History {
  const lib = new Map(ctx.library.map((e) => [e.id, e]));
  const done = completed(ctx.sessions).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const h: History = { lastAt: new Map(), sessionsSince: new Map(), count: new Map(), muscleLast: new Map() };
  const since = ctx.now - ctx.planner.windowDays * DAY;
  done.forEach((s, idx) => {
    const t = s.endedAt ?? s.startedAt;
    for (const e of s.exercises) {
      if (e.status !== 'done' || !e.sets.length) continue;
      if (!h.lastAt.has(e.exerciseId)) { h.lastAt.set(e.exerciseId, t); h.sessionsSince.set(e.exerciseId, idx); }
      if (t >= since) h.count.set(e.exerciseId, (h.count.get(e.exerciseId) ?? 0) + 1);
      const ex = lib.get(e.exerciseId);
      if (ex) for (const m of ex.primary) if (!h.muscleLast.has(m)) h.muscleLast.set(m, t);
    }
  });
  return h;
}

export function scoreExercise(ctx: ScoreContext, ex: Exercise, hist: History = buildHistory(ctx), maxCount = 0): ScoreBreakdown {
  const p = ctx.planner;
  const pref = prefOf(ctx.prefs, ex.id);
  const last = hist.lastAt.get(ex.id);
  const daysSince = last == null ? null : (ctx.now - last) / DAY;
  const sinceSessions = hist.sessionsSince.get(ex.id) ?? null;
  const cd = pref.cooldownSessions ?? p.cooldownSessions;
  const minDays = pref.minDaysBetween ?? p.minDaysBetween;
  const cooling = sinceSessions != null && daysSince != null && (sinceSessions < cd || daysSince < minDays);
  const reasons: string[] = [];

  const relevance = clamp(pref.relevance, 0, 100);
  const recency = cooling ? 0 : daysSince == null ? 100 : clamp((daysSince / p.freshDays) * 100, 0, 100);
  const timesInWindow = hist.count.get(ex.id) ?? 0;
  const frequency = maxCount > 0 ? clamp(100 * (1 - timesInWindow / (maxCount + 1)), 0, 100) : 100;

  // coverage: how overdue are this exercise's primary muscles (scaled by fit to the area's focus)?
  let cov = 0;
  if (ex.primary.length) {
    cov = ex.primary.reduce((a, m) => {
      const l = hist.muscleLast.get(m);
      const d = l == null ? p.muscleOverdueDays : (ctx.now - l) / DAY;
      return a + clamp(d / p.muscleOverdueDays, 0, 1);
    }, 0) / ex.primary.length * 100;
  }
  const focus = ctx.area?.focusMuscles ?? [];
  if (focus.length) {
    const fit = ex.primary.filter((m) => focus.includes(m)).length / Math.max(1, ex.primary.length);
    cov *= 0.5 + 0.5 * fit;
  }
  const favorite = pref.favorite ? 100 : 0;

  const wSum = p.wRelevance + p.wRecency + p.wFrequency + p.wCoverage + p.wFavorite || 1;
  let total = (p.wRelevance * relevance + p.wRecency * recency + p.wFrequency * frequency + p.wCoverage * cov + p.wFavorite * favorite) / wSum;
  if (cooling) { total -= 40; reasons.push(`Cooling down: done ${sinceSessions === 0 ? 'last session' : `${sinceSessions} sessions ago`}${daysSince != null ? ` (${round1(daysSince)} d)` : ''}.`); }
  if (pref.avoid) reasons.push('Banned: never planned or swapped in.');
  else if (isPaused(pref, ctx.now)) reasons.push('Paused: skipped until it returns automatically.');
  if (pref.favorite) reasons.push('Favorite.');
  if (daysSince == null) reasons.push('Never done: fresh.');
  else if (!cooling && daysSince > p.freshDays) reasons.push(`Not done for ${Math.round(daysSince)} days.`);
  if (cov > 70) reasons.push('Covers muscles that are overdue.');
  else if (cov < 25) reasons.push('Covers muscles trained recently.');
  if (timesInWindow >= 3) reasons.push(`Done ${timesInWindow}× in ${p.windowDays} d.`);

  return {
    exerciseId: ex.id, name: ex.name, total: round1(total), relevance: round1(relevance), recency: round1(recency),
    frequency: round1(frequency), coverage: round1(cov), favorite, coolingDown: cooling, avoided: pref.avoid, paused: isPaused(pref, ctx.now),
    daysSince: daysSince == null ? null : round1(daysSince), sessionsSince: sinceSessions, timesInWindow, reasons,
  };
}

export function scoreAll(ctx: ScoreContext, exercises: Exercise[] = ctx.library): ScoreBreakdown[] {
  const hist = buildHistory(ctx);
  let maxCount = 0;
  for (const e of exercises) maxCount = Math.max(maxCount, hist.count.get(e.id) ?? 0);
  return exercises.map((e) => scoreExercise(ctx, e, hist, maxCount));
}

/** Per-muscle freshness and training volume. */
export function muscleReport(sessions: Session[], library: Exercise[], now: number, windowDays = 28) {
  const lib = new Map(library.map((e) => [e.id, e]));
  const rows = new Map<Muscle, { muscle: Muscle; lastTrainedDaysAgo: number | null; sets: number; secondarySets: number; volumeKg: number; sessions: number }>();
  const since = now - windowDays * DAY;
  const get = (m: Muscle) => {
    if (!rows.has(m)) rows.set(m, { muscle: m, lastTrainedDaysAgo: null, sets: 0, secondarySets: 0, volumeKg: 0, sessions: 0 });
    return rows.get(m)!;
  };
  for (const s of completed(sessions)) {
    const t = s.endedAt ?? s.startedAt;
    for (const e of s.exercises) {
      const ex = lib.get(e.exerciseId);
      if (!ex || e.status !== 'done' || !e.sets.length) continue;
      const days = (now - t) / DAY;
      for (const m of ex.primary) {
        const r = get(m);
        if (r.lastTrainedDaysAgo == null || days < r.lastTrainedDaysAgo) r.lastTrainedDaysAgo = round1(days);
        if (t >= since) { r.sets += e.sets.length; r.volumeKg += e.sets.reduce((a, x) => a + x.weight * x.reps, 0); r.sessions++; }
      }
      if (t >= since) for (const m of ex.secondary) get(m).secondarySets += e.sets.length;
    }
  }
  for (const m of new Set(library.flatMap((e) => [...e.primary, ...e.secondary]))) get(m);
  return [...rows.values()].sort((a, b) => (b.lastTrainedDaysAgo ?? 9999) - (a.lastTrainedDaysAgo ?? 9999));
}

// ───────────────────────── generation ─────────────────────────
export interface GenResult {
  exercises: SessionExercise[];
  hiddenNames: string[];
  warmupMin: number;
  source: 'auto' | 'coach';
  coachPlanId?: string;
  coachNote?: string;
  scores: ScoreBreakdown[];
}

export interface GenInput {
  area: Area;
  gym: Gym | null;
  library: Exercise[];
  prefs: Record<string, ExercisePref>;
  progress: Record<string, ProgressEntry>;
  sessions: Session[];
  planner: PlannerConfig;
  restSec: number;
  targetMin: number;
  warmupMin: number;
  now: number;
  busy?: string[];
  /** bump to produce a different mix ("New mix") */
  variant?: number;
  excludeIds?: string[];
  coachPlan?: CoachPlan | null;
  /** substitute unavailable exercises automatically (default true); false = just skip them */
  autoSwap?: boolean;
  slot?: number;
  newId: () => string;
}

function hash(s: string, v: number) {
  let h = 2166136261 ^ v;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function similarity(a: Exercise, b: Exercise): number {
  const sharePrimary = a.primary.filter((m) => b.primary.includes(m)).length;
  const same = sharePrimary === a.primary.length && sharePrimary === b.primary.length;
  if (same && a.pattern === b.pattern) return 1;
  if (sharePrimary && a.pattern === b.pattern) return 0.7;
  if (sharePrimary) return 0.45;
  return a.pattern === b.pattern ? 0.2 : 0;
}

/** Pending coach plan applicable to this slot/area (specific beats generic; oldest first). */
export function pickCoachPlan(plans: CoachPlan[], slot: number, areaId: string): CoachPlan | null {
  const ok = plans.filter((p) => p.status === 'pending' && (p.slot == null || p.slot === slot) && (!p.areaId || p.areaId === areaId));
  const rank = (p: CoachPlan) => (p.slot != null ? 0 : p.areaId ? 1 : 2);
  return ok.sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)[0] ?? null;
}

export function generateSession(g: GenInput): GenResult {
  const lib = new Map(g.library.map((e) => [e.id, e]));
  const avail = availableEquipment(g.gym, g.busy);
  const ctx: ScoreContext = { library: g.library, prefs: g.prefs, sessions: g.sessions, planner: g.planner, now: g.now, area: g.area };
  const hiddenNames: string[] = [];
  const noEquip = isNoEquipment(g.gym?.id);

  const finish = (list: { ex: Exercise; rx?: Partial<{ weight: number; reps: number; sets: number; restSec: number }> }[], source: 'auto' | 'coach', extra: Partial<GenResult> = {}): GenResult => {
    const exercises = list.map(({ ex, rx }, i) => {
      const base = prescriptionFor(ex, g.progress);
      const sets = rx?.sets ?? base.sets;
      const rest = rx?.restSec ?? (noEquip ? Math.min(g.restSec, HOME_REST_SEC) : g.restSec);
      const prescription = { weight: rx?.weight ?? base.weight, reps: rx?.reps ?? base.reps, sets, ...(base.tempo && !rx ? { tempo: true } : {}) };
      return toSessionExercise(ex, i, prescription, rest, estimateExerciseSec(g.sessions, ex, sets, rest), g.area.pinnedExerciseIds.includes(ex.id), g.newId());
    });
    return { exercises, hiddenNames, warmupMin: g.warmupMin, source, scores: [], ...extra };
  };

  // ── Coach plan: use it as written, hot-swapping anything this gym can't do ──
  if (g.coachPlan) {
    const out: { ex: Exercise; rx?: { weight: number; reps: number; sets: number; restSec: number } }[] = [];
    const used = new Set<string>();
    for (const item of g.coachPlan.exercises) {
      const ex = lib.get(item.exerciseId);
      if (!ex || ex.archived || blockedIds(g.prefs, g.now).includes(ex.id)) continue;
      let pick = ex;
      let rxFromSwap: { weight: number; reps: number; sets: number } | null = null;
      if (!isAvailable(ex, avail)) {
        if (!noEquip) hiddenNames.push(ex.name);
        if (g.autoSwap === false) continue;
        const alt = rankAlternatives(ex, g.library, avail, [...used, ...out.map((o) => o.ex.id), ...blockedIds(g.prefs, g.now)], g.progress, g.sessions)[0];
        if (!alt) continue;
        pick = alt.exercise;
        rxFromSwap = swapPrescription({ plannedSets: item.sets ?? ex.defaultSets, repTarget: item.reps ?? ex.repMin } as SessionExercise, pick, g.progress);
      }
      used.add(pick.id);
      const rx: { weight?: number; reps?: number; sets?: number; restSec?: number } = { restSec: item.restSec };
      if (!rxFromSwap) { if (item.weight != null) rx.weight = item.weight; if (item.reps != null) rx.reps = item.reps; if (item.sets != null) rx.sets = item.sets; }
      else Object.assign(rx, rxFromSwap);
      out.push({ ex: pick, rx: rx as never });
    }
    if (out.length) return finish(out, 'coach', { coachPlanId: g.coachPlan.id, coachNote: g.coachPlan.note ?? g.coachPlan.title });
  }

  // ── Auto: score the pool ──
  const focusHit = (e: Exercise) => e.primary.some((m) => g.area.focusMuscles.includes(m));
  const poolIds = g.area.poolExerciseIds.length ? g.area.poolExerciseIds : g.library.filter(focusHit).map((e) => e.id);
  // At "No equipment" the area keeps its focus: bodyweight versions of the same muscles join the pool (an area pool is mostly gym lifts).
  // Advanced variations (difficulty 3 that follow an easier one) only appear once earned: they have progress, or the easier one graduated.
  const harderTargets = new Set(g.library.map((e) => e.harder).filter(Boolean));
  const earned = (e: Exercise) => e.difficulty < 3 || !harderTargets.has(e.id) || !!g.progress[e.id] || Object.values(g.progress).some((p) => p.lastRec?.harderId === e.id);
  const extra = noEquip && g.area.mode === 'auto' ? g.library.filter((e) => !poolIds.includes(e.id) && isAvailable(e, avail) && focusHit(e) && earned(e)).map((e) => e.id) : [];
  let pool = [...poolIds, ...extra].map((id) => lib.get(id)).filter((e): e is Exercise => !!e && !e.archived);
  const excluded = new Set([...(g.excludeIds ?? []), ...blockedIds(g.prefs, g.now)]);
  if (g.area.mode === 'auto') {
    // Bodyweight progression: an exercise whose last recommendation was "harder variation" is planned as that variation (when usable here).
    const graduated = new Map<string, Exercise>();
    for (const e of pool) {
      const rec = g.progress[e.id]?.lastRec;
      const next = rec?.kind === 'harder' && rec.harderId ? lib.get(rec.harderId) : undefined;
      if (next && !next.archived && !g.area.pinnedExerciseIds.includes(e.id) && isAvailable(next, avail) && !excluded.has(next.id)) graduated.set(e.id, next);
    }
    if (graduated.size) {
      const kept = pool.filter((e) => !graduated.has(e.id));
      for (const next of graduated.values()) if (!kept.includes(next)) kept.push(next);
      pool = kept;
    }
  }
  if (!noEquip) for (const e of pool) if (!isAvailable(e, avail)) hiddenNames.push(e.name);
  const usable = pool.filter((e) => isAvailable(e, avail) && !excluded.has(e.id));
  const n = Math.max(1, g.area.exercisesPerSession);
  const scores = scoreAll(ctx, usable);
  const byId = new Map(scores.map((s) => [s.exerciseId, s]));

  let chosen: Exercise[] = [];
  if (g.area.mode === 'fixed') {
    chosen = usable.slice(0, n);
    if (chosen.length < n && g.autoSwap !== false) {
      for (const miss of pool.filter((e) => !isAvailable(e, avail)).slice(0, n - chosen.length)) {
        const alt = rankAlternatives(miss, g.library, avail, [...chosen.map((c) => c.id), ...excluded], g.progress, g.sessions)[0];
        if (alt) chosen.push(alt.exercise);
      }
    }
  } else {
    const pinned = g.area.pinnedExerciseIds.map((id) => usable.find((e) => e.id === id)).filter((e): e is Exercise => !!e);
    chosen = pinned.slice(0, n);
    const v = g.variant ?? 0;
    const noise = (id: string) => (hash(id, v * 7919 + 1) - 0.5) * (10 * g.planner.jitter * 2 + (v > 0 ? 30 : 0));
    const candidates = usable.filter((e) => !chosen.includes(e) && !byId.get(e.id)!.avoided);
    const warm = candidates.filter((e) => !byId.get(e.id)!.coolingDown);
    const cool = candidates.filter((e) => byId.get(e.id)!.coolingDown);
    const fill = (from: Exercise[]) => {
      const left = [...from];
      while (chosen.length < n && left.length) {
        let best = -1, bestScore = -Infinity;
        left.forEach((e, i) => {
          const sim = chosen.length ? Math.max(...chosen.map((c) => similarity(e, c))) : 0;
          const s = byId.get(e.id)!.total - 35 * g.planner.wVariety * sim + noise(e.id);
          if (s > bestScore) { bestScore = s; best = i; }
        });
        chosen.push(left.splice(best, 1)[0]);
      }
    };
    fill(warm);
    fill(cool); // only if there aren't enough non-cooling exercises
  }

  // Order: heavy compounds first, small isolation/core/mobility last.
  const rank = (e: Exercise) => (e.difficulty === 3 ? 0 : e.pattern === 'core' || e.pattern === 'mobility' ? 3 : e.difficulty === 2 ? 1 : 2);
  const ordered = g.area.mode === 'auto' ? chosen.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e) : chosen;
  return finish(ordered.map((ex) => ({ ex })), 'auto', { scores: scores.sort((a, b) => b.total - a.total) });
}
