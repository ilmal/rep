// Streak + rewards domain (pure, no DOM, no clock: callers pass `now`). Runs identically on every device, on the server
// (MCP, push reminders) and in tests, because EVERYTHING is derived by deterministic replay from completed sessions + a
// few settings fields. Nothing derived is ever stored.
//
// ───────────────────────── PUBLIC API (for screens, store, MCP, push) ─────────────────────────
//  computeStreak(sessions, settings, now, opts?: { tz?: number }): StreakView
//      tz = minutes as returned by Date#getTimezoneOffset() (UTC − local). Omit on the client (device-local weeks).
//      The server passes the user's tz from the push subscription when it has one.
//  StreakView
//      current, best                 streak length in weeks (frozen/repaired weeks count; the in-progress week counts once it
//                                    is secured). `best` is never lowered by a reset.
//      freezes (0–2)                 freezes held NOW (a manual freeze on the open week is already subtracted).
//      tier / tierIndex / tierLabel / tierText   'none'|'spark'|'flame'|'blaze'|'inferno', 0–4, 'Flame', 'Flame · tier 2'
//      nextTier                      null | { tier, tierIndex, label, at, weeksToGo }
//      nextMilestone                 null | { weeks, name, badgeId, progress: { n, of, unit: 'weeks' } }
//      milestones                    6 MilestoneView for the Streak page strip
//      weeksUntilFreeze, nextFreezeAtWeek, freezeCapped, countedWeeks
//      weeks: WeekResult[]           ALL weeks oldest → newest, last = the current week (status 'open' until secured)
//      last16: WeekResult[]          the last 16 weeks (≥ 1)
//      currentWeek                   { weekStart, goal, target, done, left, daysLeft, dayRange, pace, paceTone, paceLabel,
//                                      paceText, secured }
//                                    target = goal, or goal + deficit while a repair is open. left/pace/secured use `target`.
//      repairOffer                   null | { missedWeekStart, deficit, target, done, left, daysLeft, freezeAvailable, canRepair }
//      frozenThisWeek, canUseFreezeNow, freezeTarget ('current'|'missed'|null), undoFreezeWeek (weekStart|null)
//      atRisk                        pace tight/lastchance/repair, left > 0, not frozen, and a streak to lose (current > 0)
//      lost, lostStreak              the streak was reset at the end of LAST week ("New streak starts today. Your best is N")
//      goalPending                   null | { from, goal }  goal change that starts next Monday
//      badges: BadgeView[]           18 badges, design order; { id, category, name, icon, how, got, unlockedAt?, progress? }
//      badgesGot
//      celebrate                     null | { kind: 'week'|'repair'|'milestone', streak, badge?, freezeEarned, freezes,
//                                      tier..., tierChanged, nextTier, weekStart, unseen }
//                                    non-null while the current week is secured; `unseen` is true until markCelebrated.
//  goalForWeek(settings, ts, tz?)  the goal in force for a week; use it (not settings.weeklyGoal) for anything about THIS week.
//  Copy / constants: paceOf, paceCopy, tierOf, TIERS, MILESTONES, weeksUntilFreeze, weekLabel, last16Of, streakReminder.
//  Settings patches (pure, return a Partial<Settings>, the store/MCP write them):
//      applyGoalChange, freezePatch, undoFreezePatch, celebratedPatch.
//
// ───────────────────────── RULES (design handoff) ─────────────────────────
//  - Week = Monday–Sunday, local time. Replay starts at the week of the first completed session.
//  - A week COUNTS when Hit (done ≥ goal), Repaired or Frozen. The week in progress never breaks the streak.
//  - Goal changes apply from next Monday: the goal of a week is looked up in `goalHistory` (stored on Settings).
//  - Repair: a past week missed by 1–2 (while a streak is running) makes next week's target goal + deficit. Reaching it marks the
//    missed week 'repaired' (and the repair week 'hit'): current = before-the-miss + 2. While the repair is open the missed week
//    shows 'missed' (with repairTarget) and is NOT in `current` (7 weeks stay 7). Deficit 3+ cannot be repaired.
//  - Freeze: earned 1 per 4 counted (hit/repaired) weeks of the running streak, max 2 held (an earn at the cap is wasted).
//    Auto-used when a repair fails (the repair week ended below target) or is impossible (deficit 3+): the missed week becomes
//    'frozen' and counts. Manual: `manualFreezeWeeks` holds the weekStart of the frozen week. On the OPEN week it is refunded
//    if the goal is still hit. While a repair is open the manual freeze covers the MISSED week instead (freezeTarget 'missed'),
//    so the repair target disappears. A manual freeze replay cannot afford (none held / no streak) is ignored.
//    No freeze and no repair: streak resets to 0 (best is kept) and the freeze counter restarts.
//  - Pace of the open week: left = target − done, days = days left incl. today (Mon = 7 … Sun = 1).
//    secured left==0 · onpace left <= days−2 · tight left == days−1 · lastchance left == days · repair left > days.
//  - Tiers: Spark 1–3, Flame 4–11, Blaze 12–25, Inferno 26+. Milestone badges at 2, 4, 8, 12, 26, 52 weeks.
//
// Differences from rules.ts#streakWeeks (kept, still used by older callers/tests): that one is the plain "consecutive weeks at
// goal" count with ONE constant goal and no repair/freeze. For a constant goal and no freezes computeStreak().current >= it
// (repair/freeze only extend a run); the property tests pin that.
//
// `celebrate.unseen` / Settings.streakLastCelebrated: the stored number is the weekStart (ms) of the last celebrated week, NOT a
// streak length, so celebrations survive resets (1 → miss → 1 celebrates again).
import { isoWeek, weekStart as localWeekStart } from './rules';
import type { Session, Settings } from './types';
import { isNoEquipment } from './location';

// ───────────────────────── types ─────────────────────────
export type WeekStatus = 'hit' | 'repaired' | 'frozen' | 'missed' | 'open';
export type Pace = 'secured' | 'onpace' | 'tight' | 'lastchance' | 'repair';
export type TierId = 'none' | 'spark' | 'flame' | 'blaze' | 'inferno';
export type BadgeCategory = 'Streaks' | 'Consistency' | 'Strength' | 'Explorer';

export interface WeekResult {
  /** local Monday 00:00 (ms) */
  weekStart: number;
  goal: number;
  done: number;
  status: WeekStatus;
  /** set on a week missed by 1–2 with a running streak: what the following week needs (goal + deficit); kept once repaired */
  repairTarget?: number;
  freezeUsed: boolean;
  freezeKind?: 'auto' | 'manual';
  /** a freeze was earned (or wasted at the cap, see freezeWasted) when this week counted */
  freezeEarned?: boolean;
  freezeWasted?: boolean;
  /** streak length after this week was processed */
  streakAfter: number;
}

export interface TierInfo { tier: TierId; index: 0 | 1 | 2 | 3 | 4; label: string; /** first streak week of the tier */ from: number }
export interface BadgeView {
  id: string;
  category: BadgeCategory;
  name: string;
  /** icon class from the design sprite, e.g. 'ic-flame' */
  icon: string;
  how: string;
  got: boolean;
  unlockedAt?: number;
  progress?: { n: number; of: number; unit: string };
}
export interface MilestoneView { weeks: number; badgeId: string; name: string; short: string; icon: string; state: 'got' | 'next' | 'lock'; progress: { n: number; of: number; unit: 'weeks' } }
export interface PaceCopy { tone: 'green' | 'accent' | 'red'; label: string; text: string }
export interface RepairOffer { missedWeekStart: number; deficit: number; target: number; done: number; left: number; daysLeft: number; freezeAvailable: boolean; canRepair: boolean }
export interface Celebrate {
  kind: 'week' | 'repair' | 'milestone';
  streak: number;
  badge?: BadgeView;
  freezeEarned: boolean;
  freezes: number;
  tier: TierId; tierIndex: number; tierLabel: string; tierChanged: boolean;
  nextTier: { tier: TierId; tierIndex: number; label: string; at: number; weeksToGo: number } | null;
  weekStart: number;
  unseen: boolean;
}
export interface CurrentWeek {
  weekStart: number; goal: number; target: number; done: number; left: number; daysLeft: number; dayRange: string;
  pace: Pace; paceTone: PaceCopy['tone']; paceLabel: string; paceText: string; secured: boolean;
}
export interface StreakView {
  current: number; best: number; freezes: number;
  tier: TierId; tierIndex: number; tierLabel: string; tierText: string;
  nextTier: Celebrate['nextTier'];
  nextMilestone: { weeks: number; name: string; badgeId: string; progress: { n: number; of: number; unit: 'weeks' } } | null;
  milestones: MilestoneView[];
  weeksUntilFreeze: number; nextFreezeAtWeek: number; freezeCapped: boolean; countedWeeks: number;
  weeks: WeekResult[]; last16: WeekResult[];
  currentWeek: CurrentWeek;
  repairOffer: RepairOffer | null;
  frozenThisWeek: boolean; canUseFreezeNow: boolean; freezeTarget: 'current' | 'missed' | null; undoFreezeWeek: number | null;
  atRisk: boolean; lost: boolean; lostStreak: number;
  goalPending: { from: number; goal: number } | null;
  badges: BadgeView[]; badgesGot: number;
  celebrate: Celebrate | null;
}

export interface StreakOpts { /** Date#getTimezoneOffset() minutes (UTC − local); omit for the runtime's local zone */ tz?: number }

// ───────────────────────── constants ─────────────────────────
export const MAX_FREEZES = 2;
export const WEEKS_PER_FREEZE = 4;
export const MAX_REPAIR_DEFICIT = 2;
export const MILESTONES = [2, 4, 8, 12, 26, 52] as const;
export const TIERS: TierInfo[] = [
  { tier: 'none', index: 0, label: 'No streak', from: 0 },
  { tier: 'spark', index: 1, label: 'Spark', from: 1 },
  { tier: 'flame', index: 2, label: 'Flame', from: 4 },
  { tier: 'blaze', index: 3, label: 'Blaze', from: 12 },
  { tier: 'inferno', index: 4, label: 'Inferno', from: 26 },
];
const DAY = 86400000;
const DEFAULT_GOAL = 4;
const MAX_WEEKS = 2000;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const tierOf = (weeks: number): TierInfo => {
  let t = TIERS[0];
  for (const x of TIERS) if (weeks >= x.from && x.index > 0) t = x;
  return t;
};
const nextTierOf = (weeks: number): Celebrate['nextTier'] => {
  const n = TIERS.find((x) => x.from > weeks && x.index > 0);
  return n ? { tier: n.tier, tierIndex: n.index, label: n.label, at: n.from, weeksToGo: n.from - weeks } : null;
};

/** Counted weeks until the next freeze is earned (1–4). */
export const weeksUntilFreeze = (counted: number): number => WEEKS_PER_FREEZE - (Math.max(0, Math.floor(counted)) % WEEKS_PER_FREEZE);

/** 'W47' for a week row, 'Now' for the current one (Streak "Last 16 weeks"). */
export const weekLabel = (w: Pick<WeekResult, 'weekStart' | 'status'>, isCurrent: boolean): string => (isCurrent ? 'Now' : `W${isoWeek(w.weekStart + 12 * 3600_000)}`);
export const last16Of = (weeks: WeekResult[]): WeekResult[] => weeks.slice(-16);

// ───────────────────────── pace + copy ─────────────────────────
/** Pace of the open week. `left` = sessions still needed, `days` = days left incl. today. */
export function paceOf(left: number, days: number): Pace {
  if (left <= 0) return 'secured';
  if (left <= days - 2) return 'onpace';
  if (left === days - 1) return 'tight';
  if (left === days) return 'lastchance';
  return 'repair';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Copy from Streak.dc.html (paceLabel / paceText / tone). `streak` = the streak shown once the week is secured. */
export function paceCopy(pace: Pace, o: { left: number; daysLeft: number; goal: number; streak: number; dayRange?: string }): PaceCopy {
  const { left, daysLeft } = o;
  switch (pace) {
    case 'secured': return { tone: 'green', label: 'Secured', text: `Week secured. Your streak is now ${plural(o.streak, 'week', 'weeks')}. Anything extra is a bonus.` };
    case 'onpace': return { tone: 'green', label: 'On pace', text: `${left} more in ${daysLeft} days${o.dayRange ? ` (${o.dayRange})` : ''}. Room for rest days.` };
    case 'tight': return { tone: 'accent', label: 'Tight', text: `${left} more in ${daysLeft} days. Train today to keep a rest day.` };
    case 'lastchance': return {
      tone: 'red', label: 'Last chance',
      text: daysLeft === 1 ? 'Last day: 1 session today.' : `${left} sessions in ${daysLeft} days: one every day from today.`,
    };
    default: return { tone: 'red', label: 'Repair next week', text: `Can’t reach ${o.goal} this week. Make up the rest next week to keep the streak.` };
  }
}

// ───────────────────────── calendar (local or fixed-offset) ─────────────────────────
export interface Cal {
  weekStart(ts: number): number;
  /** calendar-week step from a week start (DST safe) */
  addWeeks(ws: number, n: number): number;
  /** 0 = Monday … 6 = Sunday */
  dow(ts: number): number;
  hour(ts: number): number;
  /** [year, month0] of a timestamp */
  ym(ts: number): [number, number];
  mondaysIn(y: number, m: number): number;
  /** start (00:00) of the local day */
  dayStart(ts: number): number;
}

const validTz = (tz: unknown): tz is number => typeof tz === 'number' && Number.isFinite(tz) && Math.abs(tz) <= 840;

export function makeCal(tz?: number): Cal {
  if (!validTz(tz)) {
    return {
      weekStart: localWeekStart,
      addWeeks: (ws, n) => { const d = new Date(ws); d.setDate(d.getDate() + 7 * n); return localWeekStart(d.getTime() + 12 * 3600_000); },
      dow: (ts) => (new Date(ts).getDay() + 6) % 7,
      hour: (ts) => new Date(ts).getHours(),
      ym: (ts) => { const d = new Date(ts); return [d.getFullYear(), d.getMonth()]; },
      mondaysIn: (y, m) => { let c = 0; for (let d = 1; d <= 31; d++) { const x = new Date(y, m, d, 12); if (x.getMonth() !== m) break; if (x.getDay() === 1) c++; } return c; },
      dayStart: (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); },
    };
  }
  const shift = tz * 60_000;
  const L = (ts: number) => new Date(ts - shift);
  return {
    weekStart: (ts) => { const d = L(ts); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime() + shift; },
    addWeeks: (ws, n) => { const d = L(ws); d.setUTCDate(d.getUTCDate() + 7 * n); return d.getTime() + shift; },
    dow: (ts) => (L(ts).getUTCDay() + 6) % 7,
    hour: (ts) => L(ts).getUTCHours(),
    ym: (ts) => { const d = L(ts); return [d.getUTCFullYear(), d.getUTCMonth()]; },
    mondaysIn: (y, m) => { let c = 0; for (let d = 1; d <= 31; d++) { const x = new Date(Date.UTC(y, m, d, 12)); if (x.getUTCMonth() !== m) break; if (x.getUTCDay() === 1) c++; } return c; },
    dayStart: (ts) => { const d = L(ts); d.setUTCHours(0, 0, 0, 0); return d.getTime() + shift; },
  };
}

// ───────────────────────── settings sanitising (never throws on garbage) ─────────────────────────
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampGoal = (v: unknown): number => (isNum(v) ? Math.min(14, Math.max(1, Math.round(v))) : DEFAULT_GOAL);

/** goalHistory entries that are well formed, ascending by `from`. */
function cleanHistory(h: unknown): { from: number; goal: number }[] {
  if (!Array.isArray(h)) return [];
  return h
    .filter((e): e is { from: number; goal: number } => !!e && typeof e === 'object' && isNum((e as { from: unknown }).from) && isNum((e as { goal: unknown }).goal) && (e as { goal: number }).goal >= 1)
    .map((e) => ({ from: e.from, goal: clampGoal(e.goal) }))
    .sort((a, b) => a.from - b.from);
}
const cleanWeeks = (a: unknown): number[] => (Array.isArray(a) ? a.filter(isNum) : []);
/** A stored week key written on another device/tz (or before a DST shift) resolves to the same week by looking at mid-week. */
const normKey = (cal: Cal, k: number) => (k <= 0 ? 0 : cal.weekStart(k + 3 * DAY));

// ───────────────────────── replay ─────────────────────────
interface Wk extends WeekResult { times: number[]; deficit?: number }
const when = (s: Session) => s.endedAt ?? s.startedAt;

const BADGE_DEFS: { id: string; category: BadgeCategory; name: string; icon: string; how: string }[] = [
  { id: 'streak_2', category: 'Streaks', name: '2 weeks', icon: 'ic-flame', how: 'Hit your goal two weeks in a row.' },
  { id: 'streak_4', category: 'Streaks', name: 'One month', icon: 'ic-flame', how: '4-week streak.' },
  { id: 'streak_8', category: 'Streaks', name: 'Two months strong', icon: 'ic-flame', how: '8-week streak.' },
  { id: 'streak_12', category: 'Streaks', name: 'Blaze', icon: 'ic-flame', how: '12-week streak. Unlocks the Blaze tier.' },
  { id: 'streak_26', category: 'Streaks', name: 'Half a year', icon: 'ic-trophy', how: '26-week streak.' },
  { id: 'streak_52', category: 'Streaks', name: 'Inferno', icon: 'ic-trophy', how: '52-week streak. A full year.' },
  { id: 'first_session', category: 'Consistency', name: 'First session', icon: 'ic-play', how: 'Finish your first session.' },
  { id: 'full_week', category: 'Consistency', name: 'Full week', icon: 'ic-check', how: 'Hit your weekly goal once.' },
  { id: 'comeback', category: 'Consistency', name: 'Comeback', icon: 'ic-wrench', how: 'Repair a streak by making up a missed session.' },
  { id: 'sessions_10', category: 'Consistency', name: '10 sessions', icon: 'ic-target', how: 'Finish 10 sessions.' },
  { id: 'sessions_50', category: 'Consistency', name: '50 sessions', icon: 'ic-target', how: 'Finish 50 sessions.' },
  { id: 'perfect_month', category: 'Consistency', name: 'Perfect month', icon: 'ic-calendar', how: 'Hit your goal every week of a calendar month.' },
  { id: 'first_pr', category: 'Strength', name: 'First PR', icon: 'ic-arrow-up', how: 'Beat your best on any lift.' },
  { id: 'triple_digits', category: 'Strength', name: 'Triple digits', icon: 'ic-dumbbell', how: 'Lift 100 kg on any exercise.' },
  { id: 'prs_10', category: 'Strength', name: '10 PRs', icon: 'ic-arrow-up', how: 'Set 10 personal records.' },
  { id: 'full_rotation', category: 'Explorer', name: 'Full rotation', icon: 'ic-repeat', how: 'Do all four areas in one week.' },
  { id: 'gym_hopper', category: 'Explorer', name: 'Gym hopper', icon: 'ic-building', how: 'Train at 3 different gyms.' },
  { id: 'variety', category: 'Explorer', name: 'Variety', icon: 'ic-shuffle', how: 'Do 25 different exercises.' },
];
const MILESTONE_SHORT: Record<number, string> = { 2: '2 weeks', 4: '1 month', 8: '2 months', 12: '3 months', 26: '6 months', 52: '1 year' };

/** goalHistory lookup shared by computeStreak and goalForWeek. `curWs` = the week "now" is in (a weeklyGoal edited without history applies from it). */
function goalResolver(settings: Partial<Settings>, cal: Cal, curWs: number) {
  const baseGoal = clampGoal(settings.weeklyGoal);
  let hist = cleanHistory(settings.goalHistory).map((e) => ({ from: normKey(cal, e.from), goal: e.goal }));
  if (hist.length && hist[hist.length - 1].goal !== baseGoal) hist = [...hist.filter((e) => e.from < curWs), { from: curWs, goal: baseGoal }]; // weeklyGoal edited without history: applies from now on
  const goalAt = (ws: number): number => {
    if (!hist.length) return baseGoal;
    let g = hist[0].goal;
    for (const e of hist) if (e.from <= ws) g = e.goal;
    return g;
  };
  return { goalAt, hist };
}

/**
 * The weekly goal in force for the week containing `ts` (default: now-ish callers pass Date.now()). Use this, NOT settings.weeklyGoal,
 * for anything about "this week" (Today ring, icon badge, push copy): after a goal change settings.weeklyGoal is already the NEW goal
 * while this week still runs on the old one until Monday.
 */
export function goalForWeek(settings: Partial<Settings>, ts: number, tz?: number): number {
  const cal = makeCal(tz);
  const ws = cal.weekStart(isNum(ts) ? ts : 0);
  return goalResolver(settings, cal, ws).goalAt(ws);
}

export function computeStreak(sessions: Session[], settings: Partial<Settings>, now: number, opts: StreakOpts = {}): StreakView {
  const cal = makeCal(opts.tz);
  const nowTs = isNum(now) ? now : 0;
  const curWs = cal.weekStart(nowTs);
  const curEnd = cal.addWeeks(curWs, 1);

  // completed sessions in time order (equal times are indistinguishable for every derived value, so input order never matters)
  const done = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => s && s.status === 'completed' && isNum(when(s)) && when(s) < curEnd)
    .sort((a, b) => when(a) - when(b));

  // ── goals per week
  const { goalAt, hist } = goalResolver(settings, cal, curWs);
  const pendingGoal = hist.find((e) => e.from > curWs) ?? null;

  // ── week buckets
  const byWeek = new Map<number, number[]>();
  for (const s of done) { const k = cal.weekStart(when(s)); (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(when(s)); }
  const first = done.length ? cal.weekStart(when(done[0])) : curWs;
  const weeks: Wk[] = [];
  for (let ws = Math.max(Math.min(first, curWs), cal.addWeeks(curWs, 1 - MAX_WEEKS)), i = 0; ws <= curWs && i < MAX_WEEKS; ws = cal.addWeeks(ws, 1), i++) {
    const times = byWeek.get(ws) ?? [];
    weeks.push({ weekStart: ws, goal: goalAt(ws), done: times.length, status: 'open', freezeUsed: false, streakAfter: 0, times });
  }
  const n = weeks.length;
  const manual = new Set(cleanWeeks(settings.manualFreezeWeeks).map((k) => normKey(cal, k)));

  // ── replay
  let streak = 0, best = 0, freezes = 0, counted = 0;
  let pending: { i: number; deficit: number } | null = null;
  let lost: { idx: number; streak: number } | null = null;
  const milestoneAt = new Map<number, number>();
  let firstRepairAt: number | undefined;
  let repairedInCur = false;
  const bump = (holder: Wk, ts: number, earn: boolean) => {
    streak++;
    if (streak > best) best = streak;
    for (const m of MILESTONES) if (streak === m && !milestoneAt.has(m)) milestoneAt.set(m, ts);
    if (earn) {
      counted++;
      if (counted % WEEKS_PER_FREEZE === 0) {
        if (freezes < MAX_FREEZES) { freezes++; holder.freezeEarned = true; } else holder.freezeWasted = true;
      }
    }
  };

  for (let i = 0; i < n; i++) {
    const w = weeks[i];
    const isCur = i === n - 1;
    let evaluate = true;
    if (pending) {
      const m = weeks[pending.i];
      const target = w.goal + pending.deficit;
      if (w.done >= target) {
        const ts = w.times[target - 1];
        m.status = 'repaired'; m.repairTarget = target;
        bump(w, ts, true);
        m.streakAfter = streak;
        firstRepairAt ??= ts;
        if (isCur) repairedInCur = true;
        pending = null;
      } else if (isCur) {
        evaluate = false; // repair still open: undecided until the week is over
      } else {
        if (freezes > 0) { freezes--; m.status = 'frozen'; m.freezeUsed = true; m.freezeKind = 'auto'; bump(w, w.weekStart, false); m.streakAfter = streak; }
        else { lost = { idx: i, streak }; streak = 0; counted = 0; m.streakAfter = 0; }
        pending = null;
      }
    }
    if (evaluate) {
      const manualHere = manual.has(w.weekStart);
      if (w.done >= w.goal) {
        w.status = 'hit';
        bump(w, w.times[w.goal - 1], true);
      } else if (manualHere && streak > 0 && freezes > 0) {
        freezes--; w.status = 'frozen'; w.freezeUsed = true; w.freezeKind = 'manual';
        bump(w, cal.addWeeks(w.weekStart, 1), false);
      } else if (!isCur) {
        const deficit = w.goal - w.done;
        w.status = 'missed';
        if (streak === 0) { /* nothing to protect */ }
        else if (deficit <= MAX_REPAIR_DEFICIT) { pending = { i, deficit }; w.repairTarget = weeks[i + 1].goal + deficit; w.deficit = deficit; }
        else if (freezes > 0) { freezes--; w.status = 'frozen'; w.freezeUsed = true; w.freezeKind = 'auto'; bump(w, cal.addWeeks(w.weekStart, 1), false); }
        else { lost = { idx: i, streak }; streak = 0; counted = 0; }
      }
    }
    w.streakAfter = streak;
  }

  const cur = weeks[n - 1];
  const penultimate = n >= 2 ? weeks[n - 2] : null;

  // ── current week / pace
  const dow = cal.dow(nowTs);
  const daysLeft = 7 - dow;
  const goal = cur.goal;
  const target = pending ? goal + pending.deficit : goal;
  const left = Math.max(0, target - cur.done);
  const pace = paceOf(left, daysLeft);
  const dayRange = `${DOW[dow]}–Sun`;
  const secured = left === 0;
  const frozenThisWeek = cur.status === 'frozen';
  const shownStreak = streak; // already includes this week once secured
  const copy = paceCopy(pace, { left, daysLeft, goal, streak: shownStreak, dayRange });
  const currentWeek: CurrentWeek = { weekStart: curWs, goal, target, done: cur.done, left, daysLeft, dayRange, pace, paceTone: copy.tone, paceLabel: copy.label, paceText: copy.text, secured };

  const repairOffer: RepairOffer | null = pending
    ? { missedWeekStart: weeks[pending.i].weekStart, deficit: pending.deficit, target, done: cur.done, left, daysLeft, freezeAvailable: freezes > 0, canRepair: left <= daysLeft }
    : null;

  const freezeTarget: StreakView['freezeTarget'] = pending ? (freezes > 0 ? 'missed' : null) : cur.status === 'open' && freezes > 0 && streak > 0 && !secured ? 'current' : null;
  const undoFreezeWeek = cur.freezeKind === 'manual' && manual.has(curWs) ? curWs
    : penultimate && penultimate.freezeKind === 'manual' && penultimate.status === 'frozen' && manual.has(penultimate.weekStart) ? penultimate.weekStart : null;

  const atRisk = !secured && !frozenThisWeek && streak > 0 && (pace === 'tight' || pace === 'lastchance' || pace === 'repair');
  const lostNow = !!lost && lost.idx === n - 2 && streak === 0 && best > 0;

  // ── tiers / milestones
  const tier = tierOf(streak);
  const nextMilestoneWeeks = MILESTONES.find((m) => m > streak);
  const badgeOfMilestone = (m: number) => `streak_${m}`;
  const milestones: MilestoneView[] = MILESTONES.map((m) => {
    const d = BADGE_DEFS.find((b) => b.id === badgeOfMilestone(m))!;
    const got = milestoneAt.has(m);
    return { weeks: m, badgeId: d.id, name: d.name, short: MILESTONE_SHORT[m], icon: d.icon, state: got ? 'got' : m === nextMilestoneWeeks ? 'next' : 'lock', progress: { n: Math.min(streak, m), of: m, unit: 'weeks' } };
  });
  const nm = nextMilestoneWeeks ? milestones.find((x) => x.weeks === nextMilestoneWeeks)! : null;

  // ── badges
  const badges = computeBadges({ done, weeks, cal, settings, streak, curWs, milestoneAt, firstRepairAt, nowTs });

  // ── celebrate
  let celebrate: Celebrate | null = null;
  if (cur.status === 'hit' && streak > 0) {
    const inWeek = (ts: number | undefined) => ts !== undefined && ts >= curWs && ts < curEnd;
    const msThisWeek = MILESTONES.filter((m) => inWeek(milestoneAt.get(m))).pop();
    const repairedNow = repairedInCur;
    const kind: Celebrate['kind'] = msThisWeek ? 'milestone' : repairedNow ? 'repair' : 'week';
    const badge = msThisWeek ? badges.find((b) => b.id === badgeOfMilestone(msThisWeek)) : repairedNow ? badges.find((b) => b.id === 'comeback' && inWeek(b.unlockedAt)) : undefined;
    const prevTier = tierOf(weeks[n - 2]?.streakAfter ?? 0);
    const lastCel = isNum(settings.streakLastCelebrated) ? normKey(cal, settings.streakLastCelebrated) : -1;
    celebrate = {
      kind, streak, ...(badge ? { badge } : {}), freezeEarned: !!cur.freezeEarned, freezes,
      tier: tier.tier, tierIndex: tier.index, tierLabel: tier.label, tierChanged: tier.index > prevTier.index, nextTier: nextTierOf(streak),
      weekStart: curWs, unseen: lastCel !== curWs,
    };
  }

  return {
    current: streak, best, freezes,
    tier: tier.tier, tierIndex: tier.index, tierLabel: tier.label, tierText: tier.index ? `${tier.label} · tier ${tier.index}` : 'No streak yet',
    nextTier: nextTierOf(streak),
    nextMilestone: nm ? { weeks: nm.weeks, name: nm.name, badgeId: nm.badgeId, progress: nm.progress } : null,
    milestones,
    weeksUntilFreeze: weeksUntilFreeze(counted), nextFreezeAtWeek: streak + weeksUntilFreeze(counted), freezeCapped: freezes >= MAX_FREEZES, countedWeeks: counted,
    weeks: weeks.map(publicWeek), last16: last16Of(weeks.map(publicWeek)),
    currentWeek, repairOffer, frozenThisWeek,
    canUseFreezeNow: freezeTarget !== null, freezeTarget, undoFreezeWeek,
    atRisk, lost: lostNow, lostStreak: lostNow ? lost!.streak : 0,
    goalPending: pendingGoal,
    badges, badgesGot: badges.filter((b) => b.got).length,
    celebrate,
  };
}

function publicWeek(w: Wk): WeekResult {
  const { times: _t, deficit: _d, ...rest } = w;
  void _t; void _d;
  const out: WeekResult = { ...rest };
  for (const k of ['repairTarget', 'freezeKind', 'freezeEarned', 'freezeWasted'] as const) if (out[k] === undefined) delete out[k];
  return out;
}

// ───────────────────────── badges ─────────────────────────
interface BadgeCtx {
  done: Session[]; weeks: Wk[]; cal: Cal; settings: Partial<Settings>; streak: number; curWs: number;
  milestoneAt: Map<number, number>; firstRepairAt?: number; nowTs: number;
}

function computeBadges(c: BadgeCtx): BadgeView[] {
  const { done, weeks, cal, settings } = c;
  const out: BadgeView[] = [];
  const add = (id: string, at: number | undefined, progress?: { n: number; of: number; unit: string }) => {
    const d = BADGE_DEFS.find((b) => b.id === id)!;
    const got = at !== undefined;
    out.push({ id, category: d.category, name: d.name, icon: d.icon, how: d.how, got, ...(got ? { unlockedAt: at } : {}), ...(progress ? { progress: { n: Math.min(progress.n, progress.of), of: progress.of, unit: progress.unit } } : {}) });
  };

  for (const m of MILESTONES) add(`streak_${m}`, c.milestoneAt.get(m), { n: c.streak, of: m, unit: 'weeks' });

  // consistency
  add('first_session', done.length ? when(done[0]) : undefined, { n: done.length ? 1 : 0, of: 1, unit: 'sessions' });
  const fullWeek = weeks.find((w) => w.done >= w.goal);
  const bestDone = weeks.reduce((m, w) => Math.max(m, Math.min(w.done, w.goal)), 0);
  add('full_week', fullWeek ? fullWeek.times[fullWeek.goal - 1] : undefined, { n: bestDone, of: weeks[weeks.length - 1].goal, unit: 'sessions' });
  add('comeback', c.firstRepairAt, { n: c.firstRepairAt === undefined ? 0 : 1, of: 1, unit: 'repairs' });
  add('sessions_10', done.length >= 10 ? when(done[9]) : undefined, { n: done.length, of: 10, unit: 'sessions' });
  add('sessions_50', done.length >= 50 ? when(done[49]) : undefined, { n: done.length, of: 50, unit: 'sessions' });

  // perfect month: every Monday-week of a calendar month is in the replay and hit
  const months = new Map<string, Wk[]>();
  for (const w of weeks) { const [y, m] = cal.ym(w.weekStart); const k = `${y}-${m}`; (months.get(k) ?? months.set(k, []).get(k)!).push(w); }
  let perfectAt: number | undefined;
  for (const [k, ws] of months) {
    const [y, m] = k.split('-').map(Number);
    if (ws.length !== cal.mondaysIn(y, m) || !ws.every((w) => w.done >= w.goal)) continue;
    const last = ws[ws.length - 1];
    perfectAt = last.times[last.goal - 1]; // months are visited oldest first: the first complete one is the unlock
    break;
  }
  const [cy, cm] = cal.ym(c.nowTs);
  const monthWeeks = months.get(`${cy}-${cm}`) ?? [];
  add('perfect_month', perfectAt, { n: monthWeeks.filter((w) => w.done >= w.goal).length, of: cal.mondaysIn(cy, cm), unit: 'weeks' });

  // strength
  const prTimes: number[] = [];
  let heaviest = 0, tripleAt: number | undefined;
  for (const s of done) {
    for (const e of s.exercises ?? []) {
      if (e.pr) prTimes.push(when(s));
      for (const set of e.sets ?? []) {
        if (e.tracking !== 'weight_reps' || !isNum(set.weight)) continue;
        heaviest = Math.max(heaviest, set.weight);
        if (set.weight >= 100 && tripleAt === undefined) tripleAt = isNum(set.doneAt) ? set.doneAt : when(s);
      }
    }
  }
  add('first_pr', prTimes[0], { n: prTimes.length, of: 1, unit: 'PRs' });
  add('triple_digits', tripleAt, { n: Math.round(heaviest * 10) / 10, of: 100, unit: 'kg' });
  add('prs_10', prTimes[9], { n: prTimes.length, of: 10, unit: 'PRs' });

  // explorer
  const rot = new Set((Array.isArray(settings.rotation) ? settings.rotation : []).filter((x) => typeof x === 'string'));
  let rotAt: number | undefined;
  let rotNow = 0;
  if (rot.size >= 2) {
    const perWeek = new Map<number, Set<string>>();
    for (const s of done) {
      const k = cal.weekStart(when(s));
      const set = perWeek.get(k) ?? perWeek.set(k, new Set()).get(k)!;
      if (rot.has(s.areaId)) set.add(s.areaId);
      if (set.size === rot.size && rotAt === undefined) rotAt = when(s);
    }
    rotNow = perWeek.get(c.curWs)?.size ?? 0;
  }
  add('full_rotation', rotAt, { n: rotNow, of: Math.max(rot.size, 2), unit: 'areas' });
  const gyms = new Set<string>(); let gymAt: number | undefined;
  const exs = new Set<string>(); let varAt: number | undefined;
  for (const s of done) {
    if (s.gymId && !isNoEquipment(s.gymId)) { gyms.add(s.gymId); if (gyms.size === 3 && gymAt === undefined) gymAt = when(s); }
    for (const e of s.exercises ?? []) if (e.exerciseId && (e.sets?.length ?? 0) > 0) { exs.add(e.exerciseId); if (exs.size === 25 && varAt === undefined) varAt = when(s); }
  }
  add('gym_hopper', gymAt, { n: gyms.size, of: 3, unit: 'gyms' });
  add('variety', varAt, { n: exs.size, of: 25, unit: 'exercises' });
  return out;
}

// ───────────────────────── settings patches ─────────────────────────
/**
 * Patch for changing `weeklyGoal`. Effective NEXT Monday (the current week keeps its goal) unless `immediate`
 * (onboarding, or an athlete who has never finished a session). Returns {} when nothing changes. Merge into the settings write.
 * A change back to the goal in force before a pending change cancels that pending change.
 */
export function applyGoalChange(settings: Partial<Settings>, newGoal: number, now: number, o: { immediate?: boolean; tz?: number } = {}): Partial<Settings> {
  const goal = clampGoal(newGoal);
  const cal = makeCal(o.tz);
  const curWs = cal.weekStart(now);
  let patch: Partial<Settings>;
  if (o.immediate) patch = { weeklyGoal: goal, goalHistory: undefined };
  else {
    const all = cleanHistory(settings.goalHistory).map((e) => ({ from: normKey(cal, e.from), goal: e.goal }));
    let hist = all.filter((e) => e.from <= curWs); // a pending (future) change is replaced
    const inForce = hist.length ? hist[hist.length - 1].goal : all.length ? all[0].goal : clampGoal(settings.weeklyGoal);
    if (!hist.length) hist = [{ from: 0, goal: inForce }];
    if (goal !== inForce) hist.push({ from: cal.addWeeks(curWs, 1), goal });
    if (hist.length > 100) hist = [{ from: 0, goal: hist[hist.length - 100].goal }, ...hist.slice(-99)];
    patch = { weeklyGoal: goal, goalHistory: hist.length === 1 && hist[0].from === 0 ? undefined : hist };
  }
  const same = patch.weeklyGoal === settings.weeklyGoal && JSON.stringify(patch.goalHistory) === JSON.stringify(settings.goalHistory);
  return same ? {} : patch;
}

const keepRecent = (a: number[]) => [...new Set(a)].sort((x, y) => x - y).slice(-52);

/** Patch that uses a freeze now (on `view.freezeTarget`); null when none can be used. */
export function freezePatch(settings: Partial<Settings>, view: StreakView): Partial<Settings> | null {
  if (!view.canUseFreezeNow || !view.freezeTarget) return null;
  const ws = view.freezeTarget === 'missed' ? view.repairOffer!.missedWeekStart : view.currentWeek.weekStart;
  return { manualFreezeWeeks: keepRecent([...cleanWeeks(settings.manualFreezeWeeks), ws]) };
}
/** Patch that undoes the manual freeze reported by `view.undoFreezeWeek`; null when there is none. */
export function undoFreezePatch(settings: Partial<Settings>, view: StreakView, tz?: number): Partial<Settings> | null {
  if (view.undoFreezeWeek === null) return null;
  const cal = makeCal(tz);
  const target = view.undoFreezeWeek;
  return { manualFreezeWeeks: cleanWeeks(settings.manualFreezeWeeks).filter((k) => normKey(cal, k) !== target) };
}
/** Patch that marks the current week's celebration as seen. */
export function celebratedPatch(view: StreakView): Partial<Settings> { return { streakLastCelebrated: view.currentWeek.weekStart }; }

// ───────────────────────── push reminders (Flows.dc.html §5) ─────────────────────────
export const STREAK_QUIET_FROM_H = 21; // never from 21:00 …
export const STREAK_QUIET_TO_H = 7; //   … until 07:00
export const REMINDER_HOUR = 8;
export const DEFAULT_TRAIN_HOUR = 17;
export interface StreakReminder { kind: 'repair' | 'lastchance' | 'tight' | 'lost'; title: string; body: string; url: string; tag: string }

export const inStreakQuietHours = (hour: number) => hour >= STREAK_QUIET_FROM_H || hour < STREAK_QUIET_TO_H;

/** Median local start hour of the last 8 weeks of sessions ("usual training time", learned); 17 when unknown. */
export function usualTrainHour(sessions: Session[], now: number, tz?: number): number {
  const cal = makeCal(tz);
  const since = cal.addWeeks(cal.weekStart(now), -8);
  const hrs = (Array.isArray(sessions) ? sessions : []).filter((s) => s && s.status === 'completed' && isNum(s.startedAt) && s.startedAt >= since && s.startedAt <= now).map((s) => cal.hour(s.startedAt)).sort((a, b) => a - b);
  if (hrs.length < 3) return DEFAULT_TRAIN_HOUR;
  const h = hrs[hrs.length >> 1];
  return Math.min(Math.max(h, REMINDER_HOUR), STREAK_QUIET_FROM_H - 1);
}

/**
 * The ONE reminder (or null) that applies right now, by precedence repair > lost > lastchance > tight. Never inside quiet hours.
 * The caller enforces "at most one a day" (push_streak) and the user's pref. Celebrate is client-triggered (no push).
 *  - repair: Monday from 08:00, a repair is open (copy depends on whether the target is still reachable).
 *  - lost: Monday from 08:00, the streak was just reset. Gentle copy.
 *  - lastchance: every day from 08:00 while left == days left.
 *  - tight: from the usual training hour while left == days − 1.
 */
export function streakReminder(view: StreakView, o: { now: number; tz?: number; trainHour?: number }): StreakReminder | null {
  const cal = makeCal(o.tz);
  const hour = cal.hour(o.now);
  if (inStreakQuietHours(hour) || hour < REMINDER_HOUR) return null;
  const monday = cal.dow(o.now) === 0;
  const cw = view.currentWeek;
  if (monday && view.repairOffer) {
    const r = view.repairOffer;
    if (r.canRepair) return { kind: 'repair', title: 'Save your streak.', body: `Do ${r.target} this week and your ${view.current} ${view.current === 1 ? 'week' : 'weeks'} stay.`, url: '/app/', tag: 'streak' };
    if (r.freezeAvailable) return { kind: 'repair', title: 'Save your streak.', body: `Use a freeze to keep your ${view.current} ${view.current === 1 ? 'week' : 'weeks'}.`, url: '/app/', tag: 'streak' };
    return null;
  }
  if (monday && view.lost) return { kind: 'lost', title: 'New streak starts today.', body: `Your best is ${view.best}.`, url: '/app/streak', tag: 'streak' };
  if (!view.atRisk || view.repairOffer) return null;
  if (cw.pace === 'lastchance') return { kind: 'lastchance', title: 'Last chance this week.', body: `${cw.left} to go, ${cw.daysLeft} ${cw.daysLeft === 1 ? 'day' : 'days'} left.`, url: '/app/', tag: 'streak' };
  if (cw.pace === 'tight' && hour >= (o.trainHour ?? DEFAULT_TRAIN_HOUR)) {
    return { kind: 'tight', title: `Your ${view.current}-week streak is at risk.`, body: `${plural(cw.left, 'session', 'sessions')}, ${cw.daysLeft} days left.`, url: '/app/', tag: 'streak' };
  }
  return null;
}
