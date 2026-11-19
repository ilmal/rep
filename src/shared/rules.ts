// Pure domain rules: progression, auto-adjust, swap scoring, week counter, rotation, geo, generation.
// No DOM, no storage, no clock access (callers pass `now`). Runs on-device so sessions work offline.

import type {
  Adjustment, Area, Exercise, Feedback, Gym, ProgressEntry, Recommendation, Session, SessionExercise, SetLog,
} from './types';

export const RULES_VERSION = 1;
export const MIN_REST_SEC = 60;
export const OVERRUN_TOLERANCE_SEC = 5 * 60;

// ───────────────────────── helpers ─────────────────────────
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmtWeight = (n: number) => String(round1(n));
export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ───────────────────────── week & rotation ─────────────────────────
/** Local Monday 00:00 of the week containing `ts`. */
export function weekStart(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

/** ISO-8601 week number (1–53). */
export function isoWeek(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

export const completed = (sessions: Session[]) => sessions.filter((s) => s.status === 'completed');

export function sessionsInWeek(sessions: Session[], ts: number): Session[] {
  const a = weekStart(ts);
  const d = new Date(a);
  d.setDate(d.getDate() + 7);
  const b = d.getTime();
  return completed(sessions).filter((s) => (s.endedAt ?? s.startedAt) >= a && (s.endedAt ?? s.startedAt) < b);
}

export function weekCount(sessions: Session[], now: number): number {
  return sessionsInWeek(sessions, now).length;
}

/**
 * Rotation pointer: next slot (1-based) = (last completed slot mod N) + 1.
 * Independent of week — never resets, so numbering stays continuous.
 */
export function nextSlot(sessions: Session[], slotCount: number): number {
  if (slotCount <= 0) return 1;
  const done = completed(sessions).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  if (!done.length) return 1;
  if (done[0].repeatNext && done[0].slot <= slotCount) return done[0].slot;
  return (done[0].slot % slotCount) + 1;
}

export function nextSeq(sessions: Session[]): number {
  return sessions.reduce((m, s) => Math.max(m, s.seq), 0) + 1;
}

// ───────────────────────── geo ─────────────────────────
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface GymMatch { gym: Gym; distanceM: number; confidence: number }

/** Gyms whose geofence contains `pos`, best first. `accuracyM` widens the fence slightly. */
export function matchGyms(pos: { lat: number; lng: number; accuracyM?: number }, gyms: Gym[]): GymMatch[] {
  const out: GymMatch[] = [];
  for (const g of gyms) {
    if (g.deleted || g.lat == null || g.lng == null) continue;
    const d = haversineM(pos, { lat: g.lat, lng: g.lng });
    const fence = g.radiusM + Math.min(pos.accuracyM ?? 0, 50);
    if (d <= fence) out.push({ gym: g, distanceM: d, confidence: Math.max(0, 1 - d / fence) });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

// ───────────────────────── availability ─────────────────────────
export function availableEquipment(gym: Gym | null | undefined, busy: string[] = []): Set<string> {
  const s = new Set<string>();
  if (!gym) return s;
  for (const [id, st] of Object.entries(gym.equipment)) if (st === 'ok' && !busy.includes(id)) s.add(id);
  return s;
}

export const isAvailable = (ex: Exercise, avail: Set<string>) => ex.equipment.every((id) => avail.has(id));

export function missingEquipment(ex: Exercise, avail: Set<string>): string[] {
  return ex.equipment.filter((id) => !avail.has(id));
}

// ───────────────────────── progression ─────────────────────────
export interface Prescription { weight: number; reps: number; sets: number; tempo?: boolean }

/** Step for the non-weight "load" on reps/time exercises. */
const nonWeightStep = (t: Exercise['tracking']) => (t === 'time' ? 5 : 1);

/** Bodyweight progression context for recommend(): the stage the athlete is at and the next-harder variation. */
export interface BodyweightState { tempo?: boolean; harder?: string; harderName?: string }

/**
 * Next-time recommendation from raw feedback. Handoff rules:
 *  - Too light → +1 step. Too heavy → −1 step.
 *  - Just right + all sets hit → +1 rep; at top of the rep range → +1 step and reset reps.
 *  - Too many reps → −2 reps. Too many sets → −1 set (min 2).
 *  - Effort "chill" damps progression (hold) unless the weight was too heavy.
 *  - Bodyweight (reps/time tracking, no weight): +1 rep (+5 s) up to the ceiling, then a slow 3 s tempo (reps exercises, reps reset),
 *    then the exercise's `harder` variation. Time exercises go straight from the ceiling to the harder variation.
 */
export function recommend(
  ex: Pick<Exercise, 'tracking' | 'weightStep' | 'repMin' | 'repMax'>,
  prev: Prescription,
  sets: SetLog[],
  fb: Feedback,
  bw: BodyweightState = {},
): Recommendation {
  let { weight, reps, sets: nSets } = prev;
  let tempo = bw.tempo;
  let harderId: string | undefined;
  const parts: string[] = [];
  let kind: Recommendation['kind'] = 'hold';
  let tag = 'Hold';
  const step = ex.tracking === 'weight_reps' ? ex.weightStep || 2.5 : nonWeightStep(ex.tracking);
  const allHit = sets.length > 0 && sets.every((s) => s.reps >= prev.reps);
  const unit = ex.tracking === 'weight_reps' ? 'kg' : ex.tracking === 'time' ? 's' : 'reps';
  const hold = fb.effort === 'chill' && fb.weight !== 'heavy';

  const bump = (dir: 1 | -1) => {
    if (ex.tracking === 'weight_reps') weight = Math.max(0, round1(weight + dir * step));
    else reps = Math.max(1, reps + dir * step);
  };

  if (hold) {
    parts.push('Held: you took it easy today.');
  } else if (fb.weight === 'light') {
    bump(1);
    kind = 'weight_up';
    tag = `+${fmtWeight(step)} ${unit}`;
    parts.push(`Too light: +${fmtWeight(step)} ${unit}.`);
  } else if (fb.weight === 'heavy') {
    bump(-1);
    kind = 'weight_down';
    tag = `−${fmtWeight(step)} ${unit}`;
    parts.push(`Too heavy: −${fmtWeight(step)} ${unit}.`);
  } else if (allHit) {
    if (reps >= ex.repMax) {
      if (ex.tracking === 'weight_reps') {
        weight = round1(weight + step);
        reps = ex.repMin;
        kind = 'weight_up';
        tag = `+${fmtWeight(step)} kg`;
        parts.push(`Top of the range: +${fmtWeight(step)} kg, reps reset.`);
      } else if (ex.tracking === 'reps' && !bw.tempo) {
        // Bodyweight progression: reps → tempo (or time for hold exercises) → harder variation.
        reps = ex.repMin;
        tempo = true;
        kind = 'tempo';
        tag = '3 s tempo';
        parts.push(`Top of the range: same movement with a slow 3 s lowering, reps reset to ${reps}.`);
      } else if (bw.harder) {
        reps = ex.repMin;
        tempo = false;
        harderId = bw.harder;
        kind = 'harder';
        tag = 'Harder variation';
        parts.push(bw.harderName ? `Top of the range${ex.tracking === 'reps' ? ' at tempo' : ''}: time for ${bw.harderName}.` : `Top of the range${ex.tracking === 'reps' ? ' at tempo' : ''}: time for a harder variation.`);
      } else {
        parts.push('Top of the range: you are at the ceiling. Hold.');
      }
    } else {
      reps += ex.tracking === 'time' ? 5 : 1;
      kind = 'rep_up';
      tag = ex.tracking === 'time' ? '+5 s' : '+1 rep';
      parts.push(`Just right, all sets hit: ${ex.tracking === 'time' ? '+5 s' : '+1 rep'}.`);
    }
  } else {
    parts.push('Not every set hit target: hold the same.');
  }

  if (fb.volume === 'reps' && ex.tracking !== 'time') {
    reps = Math.max(Math.min(3, ex.repMin), reps - 2);
    parts.push('Fewer reps.');
    if (kind === 'hold') { kind = 'volume_down'; tag = '−2 reps'; }
  }
  if (fb.volume === 'sets') {
    nSets = Math.max(2, nSets - 1);
    parts.push('One set less.');
    if (kind === 'hold') { kind = 'volume_down'; tag = '−1 set'; }
  }
  if (ex.tracking !== 'weight_reps' && fb.volume === 'reps' && kind === 'hold') {
    tag = 'Hold';
  }

  const rec: Recommendation = { weight, reps, sets: nSets, kind, tag, why: parts.join(' '), ruleVersion: RULES_VERSION };
  if (harderId) rec.harderId = harderId;
  if (tempo) rec.tempo = true;
  return rec;
}

/** Live preview of recommend() before weight is rated. */
export function fbIncomplete(fb: Partial<Feedback>): fb is Feedback {
  return !!fb.weight && !!fb.effort && !!fb.volume;
}

// ───────────────────────── prescription / history ─────────────────────────
export function defaultPrescription(ex: Exercise): Prescription {
  const startWeights: Record<string, number> = {};
  void startWeights;
  return { weight: ex.tracking === 'weight_reps' ? defaultStartWeight(ex) : 0, reps: ex.repMin + Math.floor((ex.repMax - ex.repMin) / 3), sets: ex.defaultSets };
}

/** A conservative first-time guess from difficulty/pattern. The first sessions self-correct via feedback. */
export function defaultStartWeight(ex: Exercise): number {
  const barbell = ex.equipment.includes('barbell') || ex.equipment.includes('smith') || ex.equipment.includes('trap_bar');
  const base = barbell ? 40 : ex.equipment.includes('dumbbells') || ex.equipment.includes('kettlebells') ? 10 : 25;
  const m = ex.difficulty === 3 ? 1.25 : ex.difficulty === 2 ? 1 : 0.8;
  const step = ex.weightStep || 2.5;
  return Math.max(step, Math.round((base * m) / step) * step);
}

export function prescriptionFor(ex: Exercise, progress: Record<string, ProgressEntry>): Prescription {
  const p = progress[ex.id];
  if (p) return { weight: p.weight, reps: p.reps, sets: p.sets, ...(p.tempo ? { tempo: true } : {}) };
  return defaultPrescription(ex);
}

/** All finished SessionExercises for an exercise id, oldest first. */
export function exerciseHistory(sessions: Session[], exerciseId: string): { session: Session; ex: SessionExercise }[] {
  const out: { session: Session; ex: SessionExercise }[] = [];
  for (const s of completed(sessions).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))) {
    for (const e of s.exercises) if (e.exerciseId === exerciseId && e.status === 'done' && e.sets.length) out.push({ session: s, ex: e });
  }
  return out;
}

export const topWeight = (e: SessionExercise) => e.sets.reduce((m, s) => Math.max(m, s.weight), 0);
export const volumeOf = (e: SessionExercise) => e.sets.reduce((a, s) => a + s.weight * s.reps, 0);
export const exerciseSeconds = (e: SessionExercise) => (e.startedAt && e.endedAt ? Math.round((e.endedAt - e.startedAt) / 1000) : 0);

/** Estimated epley 1RM; ranks a set for PR detection. */
export const e1rm = (w: number, r: number) => (r <= 1 ? w : w * (1 + r / 30));

export function isPR(sessions: Session[], ex: SessionExercise): boolean {
  if (ex.tracking === 'time') return false;
  const best = (e: SessionExercise) => e.sets.reduce((m, s) => Math.max(m, ex.tracking === 'reps' ? s.reps : e1rm(s.weight, s.reps)), 0);
  const prior = exerciseHistory(sessions, ex.exerciseId).map((h) => best(h.ex));
  if (!prior.length) return false; // first time is a baseline, not a PR
  return best(ex) > Math.max(...prior) + 1e-9;
}

// ───────────────────────── duration estimates ─────────────────────────
export const FALLBACK_SET_SEC = 45;

/** Rolling median of the last 5 durations; fallback sets × (45 s + rest). */
export function estimateExerciseSec(sessions: Session[], ex: Pick<Exercise, 'id'>, sets: number, restSec: number): number {
  const durs = exerciseHistory(sessions, ex.id).slice(-5).map((h) => exerciseSeconds(h.ex)).filter((x) => x > 0);
  const m = median(durs);
  if (m != null) return Math.round(m);
  return sets * (FALLBACK_SET_SEC + restSec);
}

/** Rolling median warm-up duration of the last 5 completed sessions (seconds), or null. */
export function warmupMedianSec(sessions: Session[]): number | null {
  const d = completed(sessions)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    .slice(-5)
    .map((s) => (s.warmupStartedAt && s.warmupEndedAt ? Math.round((s.warmupEndedAt - s.warmupStartedAt) / 1000) : 0))
    .filter((x) => x > 0);
  return median(d);
}

// ───────────────────────── session building ─────────────────────────
export function toSessionExercise(ex: Exercise, i: number, rx: Prescription, restSec: number, estSec: number, pinned = false, id = ''): SessionExercise {
  return {
    id, exerciseId: ex.id, name: ex.name, order: i, tracking: ex.tracking, perHand: ex.perHand,
    weightStep: ex.weightStep, repMin: ex.repMin, repMax: ex.repMax,
    plannedSets: rx.sets, repTarget: rx.reps, plannedWeight: rx.weight, restSec, estSec, status: 'todo', sets: [], pinned,
    ...(rx.tempo ? { tempo: true } : {}),
  };
}

export function totalPlannedSec(exs: SessionExercise[], warmupMin: number): number {
  return warmupMin * 60 + exs.filter((e) => e.status !== 'dropped' && e.status !== 'skipped').reduce((a, e) => a + e.estSec, 0);
}

// ───────────────────────── hot-swap ─────────────────────────
export interface Alternative { exercise: Exercise; score: number; match: number }

const overlap = (a: string[], b: string[]) => {
  if (!a.length) return 0;
  const s = new Set(b);
  return a.filter((x) => s.has(x)).length / a.length;
};
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
};

/**
 * Score = 0.45 primary-muscle overlap + 0.25 movement pattern + 0.15 secondary muscles
 *       + 0.10 difficulty proximity + 0.05 user history. Top 4 above a floor.
 */
export function rankAlternatives(
  current: Exercise,
  library: Exercise[],
  avail: Set<string>,
  excludeIds: string[],
  progress: Record<string, ProgressEntry> = {},
  _sessions: Session[] = [],
  limit = 4,
): Alternative[] {
  const ex = new Set(excludeIds);
  const out: Alternative[] = [];
  for (const c of library) {
    if (c.id === current.id || ex.has(c.id) || c.archived || !isAvailable(c, avail)) continue;
    if (overlap(current.primary, c.primary) === 0) continue; // never offer something that misses the target muscle
    const primary = jaccard(current.primary, c.primary); // penalise candidates that drift to other muscles
    const pattern = c.pattern === current.pattern ? 1 : 0;
    const secondary = jaccard(current.secondary, c.secondary);
    const diff = 1 - Math.abs(current.difficulty - c.difficulty) / 2;
    const history = progress[c.id] ? 1 : 0;
    const score = 0.45 * primary + 0.25 * pattern + 0.15 * secondary + 0.1 * diff + 0.05 * history;
    out.push({ exercise: c, score, match: Math.round(score * 100) });
  }
  return out.filter((a) => a.match >= 35).sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name)).slice(0, limit);
}

/** Carry over sets / rep target; weight from history, else estimated from the swapped-out lift. */
export function swapPrescription(from: SessionExercise, to: Exercise, progress: Record<string, ProgressEntry>): Prescription {
  const own = progress[to.id];
  if (own) return { weight: own.weight, reps: own.reps, sets: from.plannedSets, ...(own.tempo ? { tempo: true } : {}) };
  const rx = defaultPrescription(to);
  return { weight: rx.weight, reps: Math.min(Math.max(from.repTarget, to.repMin), to.repMax), sets: from.plannedSets };
}

// ───────────────────────── auto-adjust ─────────────────────────
export interface AdjustInput {
  now: number;
  sessionStartedAt: number;
  targetMin: number;
  exercises: SessionExercise[];
  /** index of current exercise (not droppable) */
  cursor: number;
  /** seconds spent so far already; if the current exercise is mid-flight its remainder is ignored */
  newId: () => string;
}

export interface AdjustResult {
  applied: boolean;
  projectedEndSec: number;
  adjustments: Adjustment[];
  exercises: SessionExercise[];
  overrunBeforeSec: number;
}

const remainingSec = (e: SessionExercise) => (e.status === 'todo' ? e.estSec : 0);

/**
 * If projected end > target + 5 min: first trim rest (min 60 s) across remaining exercises,
 * then drop the lowest-priority remaining exercise (never the current one; unpinned and last first).
 */
export function autoAdjust(inp: AdjustInput): AdjustResult {
  const elapsed = Math.max(0, Math.round((inp.now - inp.sessionStartedAt) / 1000));
  const target = inp.targetMin * 60;
  let exs = inp.exercises.map((e) => ({ ...e }));
  const projected = () => elapsed + exs.reduce((a, e) => a + remainingSec(e), 0);
  const overrun0 = projected() - target;
  const adjustments: Adjustment[] = [];
  if (overrun0 <= OVERRUN_TOLERANCE_SEC) return { applied: false, projectedEndSec: projected(), adjustments, exercises: exs, overrunBeforeSec: overrun0 };

  // 1) trim rest
  const prevRest: Record<string, number> = {};
  let savedRest = 0;
  for (const e of exs) {
    if (e.status !== 'todo' || e.restSec <= MIN_REST_SEC) continue;
    const cut = Math.min(e.restSec - MIN_REST_SEC, 30);
    if (cut <= 0) continue;
    prevRest[e.id] = e.restSec;
    const sets = Math.max(0, e.plannedSets - 1);
    e.restSec -= cut;
    const saved = cut * sets;
    e.estSec = Math.max(0, e.estSec - saved);
    savedRest += saved;
  }
  if (savedRest > 0) {
    adjustments.push({
      id: inp.newId(), at: inp.now, type: 'trim_rest', savedSec: savedRest, prevRestSec: prevRest,
      text: `Rest trimmed by up to 30 s to save ~${Math.round(savedRest / 60)} min.`,
    });
  }

  // 2) drop lowest-priority remaining exercises until within tolerance
  while (projected() - target > OVERRUN_TOLERANCE_SEC) {
    const cands = exs
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.status === 'todo' && x.i !== inp.cursor);
    if (cands.length === 0) break;
    cands.sort((a, b) => Number(!!a.e.pinned) - Number(!!b.e.pinned) || b.i - a.i);
    const victim = cands[0];
    // Don't drop if it's the only remaining exercise.
    if (cands.length === 1 && victim.e.pinned) break;
    victim.e.status = 'dropped';
    adjustments.push({
      id: inp.newId(), at: inp.now, type: 'drop', exerciseId: victim.e.id, savedSec: victim.e.estSec,
      text: `${victim.e.name} dropped to save ~${Math.round(victim.e.estSec / 60)} min.`,
    });
  }
  return { applied: adjustments.length > 0, projectedEndSec: projected(), adjustments, exercises: exs, overrunBeforeSec: overrun0 };
}

/** Undo one adjustment, returning the updated exercise list. */
export function undoAdjustment(exs: SessionExercise[], adj: Adjustment): SessionExercise[] {
  if (adj.type === 'drop' && adj.exerciseId) {
    return exs.map((e) => (e.id === adj.exerciseId && e.status === 'dropped' ? { ...e, status: 'todo' as const } : e));
  }
  if (adj.type === 'trim_rest' && adj.prevRestSec) {
    const prev = adj.prevRestSec;
    return exs.map((e) => {
      const r = prev[e.id];
      if (r == null || (e.status !== 'todo' && e.status !== 'dropped')) return e;
      const restored = (r - e.restSec) * Math.max(0, e.plannedSets - 1);
      return { ...e, restSec: r, estSec: e.estSec + restored };
    });
  }
  return exs;
}

// ───────────────────────── stats ─────────────────────────
export function sessionDurationSec(s: Session): number {
  return s.endedAt ? Math.max(0, Math.round((s.endedAt - s.startedAt) / 1000)) : 0;
}

/** Sessions per week for the last `n` weeks (oldest → current). */
export function weeklyCounts(sessions: Session[], now: number, n: number): { start: number; count: number }[] {
  const cur = weekStart(now);
  const out: { start: number; count: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - 7 * i);
    out.push({ start: d.getTime(), count: sessionsInWeek(sessions, d.getTime() + 3600_000).length });
  }
  return out;
}

export function streakWeeks(sessions: Session[], goal: number, now: number): number {
  let n = 0;
  const cur = weekStart(now);
  for (let i = 0; i < 520; i++) {
    const d = new Date(cur);
    d.setDate(d.getDate() - 7 * i);
    const c = sessionsInWeek(sessions, d.getTime() + 3600_000).length;
    if (c >= goal) n++;
    else if (i === 0) continue; // current week still in progress
    else break;
  }
  return n;
}
