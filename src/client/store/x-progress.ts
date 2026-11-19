// Pure aggregation for the Progress screen. No DOM, no clock access (callers pass `now`).
// Weeks are local-time Monday buckets keyed with weekStart(); all date stepping is calendar based
// (setDate / new Date(y, m, d)) so DST transitions (23h / 25h days) never shift a bucket.
import { completed, isoWeek, median, sessionDurationSec, topWeight, volumeOf, weekStart } from '../../shared/rules';
import type { Session } from '../../shared/types';

export type Range = 'w8' | 'm6' | 'y1';
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const HOUR = 3600000;

export const r1 = (n: number) => Math.round(n * 10) / 10;
/** Timestamp a session counts at (same rule as the week counter in shared/rules). */
export const when = (s: Session) => s.endedAt ?? s.startedAt;

/** Calendar-day shift (keeps local wall-clock time, DST safe). */
export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
/** Calendar days between two timestamps (DST safe, rounds the 23h/25h days). */
export const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY);

// ───────────────────────── weekly buckets ─────────────────────────
export interface WeekBucket { start: number; count: number }

/** Sessions per local Monday-week for the last `n` weeks, oldest → current (zero weeks included). */
export function weekBuckets(done: Session[], now: number, n: number): WeekBucket[] {
  const counts = new Map<number, number>();
  for (const s of done) { const k = weekStart(when(s)); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const cur = weekStart(now);
  const out: WeekBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = weekStart(addDays(cur, -7 * i) + 12 * HOUR);
    out.push({ start, count: counts.get(start) ?? 0 });
  }
  return out;
}

/** Consecutive weeks at/above goal, ending at this week (the in-progress week never breaks the run). */
export function streak(done: Session[], goal: number, now: number): number {
  if (goal < 1 || !done.length) return 0;
  const counts = new Map<number, number>();
  let earliest = Infinity;
  for (const s of done) { const k = weekStart(when(s)); counts.set(k, (counts.get(k) ?? 0) + 1); earliest = Math.min(earliest, k); }
  const cur = weekStart(now);
  let n = 0;
  for (let i = 0; i < 2000; i++) {
    const start = weekStart(addDays(cur, -7 * i) + 12 * HOUR);
    if (start < earliest) break;
    if ((counts.get(start) ?? 0) >= goal) n++;
    else if (i > 0) break;
  }
  return n;
}

// ───────────────────────── chart ─────────────────────────
export interface Chart {
  label: string;
  vals: number[];
  labels: string[];
  hit: string;
  /** start of the range window (ms) */
  start: number;
  lastIsNow: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

export function rangeStart(range: Range, now: number): number {
  const d = new Date(now);
  if (range === 'w8') return weekBuckets([], now, 8)[0].start;
  if (range === 'm6') return new Date(d.getFullYear(), d.getMonth() - 5, 1).getTime();
  return new Date(d.getFullYear(), 0, 1).getTime();
}

/** Days a calendar month counts for: full month, or elapsed days (min 7) while it is the current one. */
function monthDays(y: number, m: number, now: number, floorWeek: boolean): number {
  const d = new Date(now);
  const full = daysInMonth(y, m);
  if (y === d.getFullYear() && m === d.getMonth()) return Math.min(full, Math.max(floorWeek ? 7 : 1, d.getDate()));
  return full;
}

/** Sessions per week for one calendar month. */
export function monthAvg(done: Session[], y: number, m: number, now: number): number {
  const a = new Date(y, m, 1).getTime();
  const b = new Date(y, m + 1, 1).getTime();
  const n = done.filter((s) => when(s) >= a && when(s) < b).length;
  return n / (monthDays(y, m, now, true) / 7);
}

export function chartFor(done: Session[], range: Range, now: number, goal: number): Chart {
  const d = new Date(now);
  const first = done.reduce((m, s) => Math.min(m, when(s)), Infinity);
  if (range === 'w8') {
    const wc = weekBuckets(done, now, 8);
    const vals = wc.map((w) => w.count);
    const labels = wc.map((w, i) => (i === wc.length - 1 ? 'Now' : i === 0 ? `W${isoWeek(w.start + 12 * HOUR)}` : String(isoWeek(w.start + 12 * HOUR))));
    // Only weeks since the first ever session can be "missed".
    const past = wc.slice(0, -1).filter((w) => weekStart(first) <= w.start);
    const hits = past.filter((w) => w.count >= goal).length;
    const hit = past.length ? `${hits} of ${past.length} weeks hit` : 'First week';
    return { label: 'Last 8 weeks', vals, labels, hit, start: wc[0].start, lastIsNow: true };
  }
  if (range === 'm6') {
    const items = Array.from({ length: 6 }, (_, i) => { const m = new Date(d.getFullYear(), d.getMonth() - 5 + i, 1); return { y: m.getFullYear(), m: m.getMonth() }; });
    const vals = items.map((x) => r1(monthAvg(done, x.y, x.m, now)));
    const start = new Date(items[0].y, items[0].m, 1).getTime();
    return { label: 'Last 6 months', vals, labels: items.map((x) => MONTHS[x.m]), hit: `Avg ${avgPerWeek(done, items, start, first, now)} / week`, start, lastIsNow: false };
  }
  const y = d.getFullYear();
  const vals = Array.from({ length: 12 }, (_, m) => (m > d.getMonth() ? 0 : r1(monthAvg(done, y, m, now))));
  const start = new Date(y, 0, 1).getTime();
  const total = done.filter((s) => when(s) >= start).length;
  return { label: 'This year', vals, labels: MONTHS.map((m) => m[0]), hit: plural(total, 'session', 'sessions'), start, lastIsNow: false };
}

/** Average sessions/week over the months in the window, skipping months before the first-ever session. */
function avgPerWeek(done: Session[], items: { y: number; m: number }[], start: number, first: number, now: number): number {
  if (!isFinite(first)) return 0;
  const from = Math.max(start, new Date(new Date(first).getFullYear(), new Date(first).getMonth(), 1).getTime());
  const total = done.filter((s) => when(s) >= from).length;
  const days = items.filter((x) => new Date(x.y, x.m + 1, 1).getTime() > from).reduce((a, x) => a + monthDays(x.y, x.m, now, false), 0);
  return r1(total / (Math.max(7, days) / 7));
}

/** Goal line geometry shared with the artboard: bars use 82% of the column, goal sits above the label row. */
export function chartScale(vals: number[], goal: number) {
  const max = Math.max(6, goal + 1, Math.ceil(Math.max(0, ...vals)));
  return { max, goalPos: (goal / max) * 100 * 0.82 + 12, barH: (v: number) => Math.max(3, (v / max) * 82) };
}

// ───────────────────────── tiles ─────────────────────────
export const inRange = (done: Session[], start: number) => done.filter((s) => when(s) >= start);

export function avgSessionMin(xs: Session[]): number | null {
  const d = xs.map(sessionDurationSec).filter((x) => x > 0);
  return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length / 60) : null;
}

const warmupSec = (s: Session) => (s.warmupStartedAt && s.warmupEndedAt ? Math.round((s.warmupEndedAt - s.warmupStartedAt) / 1000) : 0);

export interface Warmup { medianSec: number; samples: number[] }
/** Median of the latest (up to 5) timed warm-ups in the given sessions. */
export function warmupStats(xs: Session[]): Warmup | null {
  const samples = [...xs].sort((a, b) => when(a) - when(b)).map(warmupSec).filter((x) => x > 0).slice(-5);
  const m = median(samples);
  return m == null ? null : { medianSec: m, samples };
}

export interface Nudge { title: string; body: string; minutes: number }
/** Only with >= 3 timed warm-ups and a >= 2 min gap to the plan, and only if the suggestion differs from the plan. */
export function warmupNudge(w: Warmup | null, targetMin: number): Nudge | null {
  if (!w || w.samples.length < 3) return null;
  const gap = w.medianSec - targetMin * 60;
  if (Math.abs(gap) < 120) return null;
  const minutes = Math.max(1, Math.round(w.medianSec / 60));
  if (minutes === targetMin) return null;
  const under = w.samples.filter((x) => x <= targetMin * 60).length;
  const n = w.samples.length;
  const body = gap > 0
    ? `${under === 0 ? `None of your last ${n} warm-ups` : `Only ${under} of your last ${n} warm-ups`} came in under the ${targetMin}-min plan. A realistic plan means fewer mid-session cuts.`
    : `${under === n ? `All ${n}` : `${under} of your last ${n}`} warm-ups came in under the ${targetMin}-min plan. A shorter plan leaves more time for lifting.`;
  return { title: `Warm-up target nudged to ${minutes} min?`, body, minutes };
}

export interface Volume { perWeek: number; deltaPct: number | null }
const sessionVolume = (s: Session) => s.exercises.reduce((a, e) => a + (e.status === 'done' ? volumeOf(e) : 0), 0);

/** kg per week over the range window, and % change vs the equally long window just before it. */
export function volumePerWeek(done: Session[], start: number, now: number): Volume {
  const span = Math.max(7, daysBetween(start, now) + 1);
  const weeks = span / 7;
  const prevStart = addDays(start, -span);
  let cur = 0, prev = 0;
  for (const s of done) {
    const t = when(s);
    if (t >= start) cur += sessionVolume(s);
    else if (t >= prevStart) prev += sessionVolume(s);
  }
  const perWeek = cur / weeks;
  const prevPerWeek = prev / weeks;
  return { perWeek, deltaPct: prevPerWeek > 0 ? Math.round(((perWeek - prevPerWeek) / prevPerWeek) * 100) : null };
}

export const countPRs = (xs: Session[]) => xs.reduce((a, s) => a + s.exercises.filter((e) => e.pr).length, 0);

export interface Swaps { count: number; topGym: { name: string; n: number } | null }
export function swapStats(xs: Session[]): Swaps {
  const by = new Map<string, number>();
  let count = 0;
  for (const s of xs) for (const e of s.exercises) if (e.swappedFrom) { count++; const g = s.gymName || 'Unknown'; by.set(g, (by.get(g) ?? 0) + 1); }
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { count, topGym: top ? { name: top[0], n: top[1] } : null };
}

// ───────────────────────── where you trained ─────────────────────────
export interface GymShare { name: string; pct: number; n: number }
/** Share of sessions per gym (top 3 + Other); integer percents that always sum to 100 (largest remainder). */
export function gymShares(xs: Session[]): GymShare[] {
  if (!xs.length) return [];
  const by = new Map<string, { name: string; n: number; last: number }>();
  for (const s of xs) {
    const k = s.gymId ?? `n:${s.gymName}`;
    const r = by.get(k) ?? { name: s.gymName || 'Unknown', n: 0, last: 0 };
    r.n++;
    if (when(s) >= r.last) { r.last = when(s); r.name = s.gymName || r.name; }
    by.set(k, r);
  }
  const rows = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const shown = rows.slice(0, 3).map((r) => ({ name: r.name, n: r.n }));
  const rest = rows.slice(3).reduce((a, r) => a + r.n, 0);
  if (rest) shown.push({ name: 'Other', n: rest });
  const total = xs.length;
  const raw = shown.map((r) => (r.n / total) * 100);
  const pct = raw.map(Math.floor);
  let left = 100 - pct.reduce((a, b) => a + b, 0);
  raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i).forEach(({ i }) => { if (left > 0) { pct[i]++; left--; } });
  return shown.map((r, i) => ({ ...r, pct: pct[i] }));
}

// ───────────────────────── top progress ─────────────────────────
export interface Lift { id: string; name: string; first: number; last: number; pct: number; stalled: boolean; heavy: number }

/** First vs latest top weight per exercise within the sessions given (>= 2 data points each). */
export function liftProgress(xs: Session[]): Lift[] {
  const by = new Map<string, { name: string; pts: { top: number; heavy: boolean }[] }>();
  for (const s of [...xs].sort((a, b) => when(a) - when(b))) {
    for (const e of s.exercises) {
      if (e.tracking !== 'weight_reps' || e.status !== 'done') continue;
      const top = topWeight(e);
      if (top <= 0) continue;
      const r = by.get(e.exerciseId) ?? { name: e.name, pts: [] };
      r.name = e.name;
      r.pts.push({ top, heavy: e.feedback?.weight === 'heavy' });
      by.set(e.exerciseId, r);
    }
  }
  const out: Lift[] = [];
  for (const [id, v] of by) {
    if (v.pts.length < 2) continue;
    const first = v.pts[0].top, last = v.pts[v.pts.length - 1].top;
    const l3 = v.pts.slice(-3);
    const stalled = l3.length === 3 && l3.every((p) => p.top === l3[0].top);
    out.push({ id, name: v.name, first, last, pct: Math.round(((last - first) / first) * 100), stalled, heavy: l3.filter((p) => p.heavy).length });
  }
  return out;
}

/** Up to 3 rows: best gains first, always leaving room for one stall (flat/down lift held 3x) when there is one. */
export function topProgress(lifts: Lift[]): Lift[] {
  const byName = (a: Lift, b: Lift) => a.name.localeCompare(b.name);
  const gains = lifts.filter((l) => l.pct > 0).sort((a, b) => b.pct - a.pct || byName(a, b));
  const stalls = lifts.filter((l) => l.stalled && l.pct <= 0).sort((a, b) => b.heavy - a.heavy || byName(a, b));
  const picked = gains.slice(0, 3 - Math.min(stalls.length, 1));
  return [...picked, ...stalls.slice(0, 3 - picked.length)];
}

export const fmtVol = (v: number) => (Math.round(v) >= 1000 ? `${r1(v / 1000)}k` : String(Math.round(v)));
